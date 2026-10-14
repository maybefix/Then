import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const verify = process.argv.includes("--verify");
const directory = resolve("test-artifacts/sidebar-move-lock", `${Date.now()}`);
await mkdir(directory, { recursive: true });
console.log(`Artifacts: ${directory}`);
const build = spawn("cargo", ["test", "--offline", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--no-run", "--message-format=json"], {
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let buildOutput = "";
let buildErrors = "";
build.stdout.on("data", (data) => { buildOutput += data; });
build.stderr.on("data", (data) => { buildErrors += data; process.stdout.write(data); });
const exitCode = await new Promise((accept, reject) => {
  build.on("error", reject);
  build.on("exit", accept);
});
await writeFile(resolve(directory, "build.jsonl"), buildOutput);
await writeFile(resolve(directory, "build.log"), buildErrors);
const messages = buildOutput.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
if (exitCode !== 0) {
  for (const item of messages) if (item.reason === "compiler-message") process.stderr.write(item.message.rendered ?? "");
  throw new Error(`Diagnostic test build failed: ${exitCode}`);
}
const executable = messages
  .find((item) => item.reason === "compiler-artifact" && item.profile?.test && item.executable)?.executable;
if (!executable) throw new Error("No Rust test executable returned by cargo");
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
const results = [];
const cases = ["single", "folder", "multi", "same-parent", "collision", "reorder"];
if (verify) cases.push("ordered-before", "ordered-after", "library-single", "library-multi", "library-folder", "empty-multi", "rollback");
for (const caseName of cases) {
  const root = caseName.startsWith("library-")
    ? resolve(directory, caseName, "Library", "Work") : resolve(directory, caseName);
  await mkdir(resolve(root, "destination"), { recursive: true });
  await mkdir(resolve(root, "source-folder"), { recursive: true });
  await writeFile(resolve(root, "a.md"), "# Probe A\n");
  await writeFile(resolve(root, "b.md"), "# Probe B\n");
  await writeFile(resolve(root, "source-folder", "nested.md"), "# Nested\n");
  if (caseName === "collision") await writeFile(resolve(root, "destination", "a.md"), "existing\n");
  if (caseName.startsWith("ordered-")) await writeFile(resolve(root, "destination", "anchor.md"), "anchor\n");
  const started = Date.now();
  const probe = spawnSync(executable, ["--exact", "file_move_diagnostics::command_probe", "--ignored", "--nocapture"], {
    env: { ...process.env, THEN_MOVE_PROBE_ROOT: root, THEN_MOVE_PROBE_CASE: caseName },
    timeout: 5000, encoding: "utf8", windowsHide: true,
  });
  await writeFile(resolve(root, "probe.log"), (probe.stdout ?? "") + (probe.stderr ?? ""));
  const result = {
    case: caseName, elapsedMs: Date.now() - started,
    timedOut: probe.error?.code === "ETIMEDOUT", exitCode: probe.status,
    baselineReturned: probe.stdout?.includes("BASELINE_TREE_READ_RETURNED") ?? false,
    commandReturned: probe.stdout?.includes("COMMAND_RETURNED") ?? false,
    sourceAExists: await exists(resolve(root, "a.md")),
    destinationAExists: await exists(resolve(root, "destination", "a.md")),
    sourceBExists: await exists(resolve(root, "b.md")),
    destinationBExists: await exists(resolve(root, "destination", "b.md")),
    movedFolderExists: await exists(resolve(root, "destination", "source-folder", "nested.md")),
    configExists: await exists(resolve(root, ".then", "project.json")),
    error: probe.error?.message ?? null,
    returned: probe.stdout?.split(/\r?\n/).find((line) => line.startsWith("COMMAND_RESULT "))?.slice("COMMAND_RESULT ".length) ?? null,
  };
  if (result.returned) result.returned = JSON.parse(result.returned);
  if (result.configExists) result.config = JSON.parse(await readFile(resolve(root, ".then", "project.json"), "utf8"));
  results.push(result);
  console.log(JSON.stringify({ case: caseName, elapsedMs: result.elapsedMs, timedOut: result.timedOut, commandReturned: result.commandReturned, exitCode: result.exitCode }));
  await writeFile(resolve(directory, "results.json"), JSON.stringify(results, null, 2));
  if (!result.baselineReturned) throw new Error(`Probe did not reach command: ${caseName}`);
  if (probe.error && !result.timedOut) throw probe.error;
  if (verify) {
    assert.equal(result.timedOut, false, `${caseName}: command must not deadlock`);
    assert.equal(result.exitCode, 0, `${caseName}: Rust assertions failed; see ${root}/probe.log`);
    assert.ok(result.commandReturned && result.returned, `${caseName}: complete command result required`);
    const expectsError = ["same-parent", "collision", "rollback"].includes(caseName);
    assert.equal(result.returned.ok, !expectsError, `${caseName}: unexpected command outcome`);
    assert.deepEqual(result.returned.config, result.config, "returned config must match disk");
    if (expectsError) continue; // Rust checks original content, order, progress and rollback revisions.

    const folder = result.returned.value.projectFolder;
    assert.equal(folder.path, root);
    const flatten = (entries) => entries.flatMap((entry) => [entry.path, ...flatten(entry.children)]);
    const treePaths = flatten(folder.children);
    const destinationEntry = folder.children.find((entry) => entry.name === "destination");
    if (caseName.startsWith("library-")) {
      assert.equal(folder.library.role, "project", "library metadata must also finish loading");
      assert.ok(folder.library.projects.some((project) => project.path === root));
    }
    const movingFolder = caseName === "folder" || caseName === "library-folder";
    const movingFiles = caseName.includes("multi") ? (caseName === "empty-multi" ? [] : ["a.md", "b.md"])
      : movingFolder || caseName === "reorder" ? [] : ["a.md"];
    for (const name of movingFiles) {
      assert.equal(await exists(resolve(root, name)), false, "old file path must be gone");
      const destination = resolve(root, "destination", name);
      assert.ok(treePaths.includes(destination), "returned tree must include moved file");
      assert.ok(!treePaths.includes(resolve(root, name)), "returned tree must exclude old path");
      assert.equal(await readFile(destination, "utf8"), name === "a.md" ? "# Probe A\n" : "# Probe B\n");
      assert.equal(result.config.fileProgress[`destination/${name}`].status, name === "a.md" ? "writing" : "revising");
      assert.equal(result.config.fileProgress[name], undefined);
    }
    if (movingFolder) {
      assert.equal(await exists(resolve(root, "source-folder")), false);
      assert.equal(await readFile(resolve(root, "destination/source-folder/nested.md"), "utf8"), "# Nested\n");
      assert.ok(treePaths.includes(resolve(root, "destination/source-folder/nested.md")));
      assert.deepEqual(result.config.order["destination/source-folder"], ["nested.md"]);
      assert.equal(result.config.order["source-folder"], undefined);
      assert.equal(result.config.fileProgress["destination/source-folder/nested.md"].status, "done");
      assert.equal(result.config.fileProgress["source-folder/nested.md"], undefined);
    }
    if (caseName.startsWith("ordered-") || caseName === "multi" || caseName === "library-multi") {
      const expected = caseName === "ordered-before" ? ["a.md", "anchor.md"]
        : caseName === "ordered-after" ? ["anchor.md", "a.md"] : ["a.md", "b.md"];
      assert.deepEqual(result.config.order.destination, expected);
      assert.deepEqual(destinationEntry.children.map((entry) => entry.name), expected);
    }
    if (caseName === "reorder") assert.deepEqual(folder.children.slice(0, 2).map((entry) => entry.name), ["b.md", "a.md"]);
  }
}
await writeFile(resolve("test-artifacts/sidebar-move-lock/latest.json"), JSON.stringify({ directory, results }, null, 2));
if (verify) console.log(`PASS: ${results.length} filesystem move regression cases`);
