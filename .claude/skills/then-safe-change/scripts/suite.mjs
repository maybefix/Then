// package.json の test:* を全部動かし、結果を JSON に残す。前後を比べる表も作る。
//
//   run:     node .claude/skills/then-safe-change/scripts/suite.mjs run <label> --out <dir> [--skip a,b] [--only a,b]
//            先に npm run build をして（test:v058-bundle は dist を読むだけなので）、test:* を順に動かす。
//            1本ごとに10分で打ち切り、打ち切ったら残ったテストの node と Edge を止める。
//            終わったら残ったプロセスを数えて出す。
//   compare: node .claude/skills/then-safe-change/scripts/suite.mjs compare <before.json> <after.json>
//
// 「前」は変更を始める前のチェックポイントで、変更を書き始める前に（作業中にブランチを切り替えずに
// 済むように）動かしておく。cargo を使う test:ai と test:sidebar-file-move は、Rust を変えないときは
// 既定で外す（--skip "" で外さない）。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { countLeftovers, formatLeftovers, stopLeftovers } from "./lib/processes.mjs";

const [mode, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : fallback;
};

function run(command, args, timeoutMs) {
  const started = Date.now();
  const result = spawnSync(command, args, { shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${result.stdout ?? ""}${result.stderr ?? ""}`.split(/\r?\n/)
    .filter((line) => line.trim() && !/^\s+at /.test(line) && !/DeprecationWarning|trace-deprecation/.test(line));
  return {
    status: result.status,
    timedOut: result.error?.code === "ETIMEDOUT",
    seconds: Math.round((Date.now() - started) / 1000),
    tail: lines.slice(-3).join(" | ").slice(0, 400),
    firstError: (lines.find((line) => /Error\b/.test(line)) ?? lines.find((line) => /\bFAIL\b|^NG |expected/.test(line)) ?? "").slice(0, 300),
  };
}

function mainChunkBytes() {
  try {
    const assets = path.join("dist", "assets");
    const sizes = readdirSync(assets).filter((name) => /^index-.*\.js$/.test(name)).map((name) => statSync(path.join(assets, name)).size);
    return sizes.length ? Math.max(...sizes) : null;
  } catch {
    return null;
  }
}

if (mode === "run") {
  const label = rest[0];
  const out = option("out");
  if (!label || !out) throw new Error("usage: suite.mjs run <label> --out <dir> [--skip a,b] [--only a,b]");
  mkdirSync(out, { recursive: true });
  const skip = new Set((option("skip", "test:ai,test:sidebar-file-move")).split(",").filter(Boolean));
  const only = option("only") ? new Set(option("only").split(",")) : null;
  const file = path.join(out, `suite-${label}.json`);
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).stdout.trim();
  const results = { label, commit, dirty: Boolean(dirty), startedAt: new Date().toISOString(), tests: {} };
  const save = () => writeFileSync(file, JSON.stringify(results, null, 2));
  results.build = run("npm", ["run", "build"], 600_000);
  results.mainChunkBytes = mainChunkBytes();
  save();
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  const names = Object.keys(scripts).filter((name) => name.startsWith("test:") && !skip.has(name) && (!only || only.has(name)));
  for (const name of names) {
    process.stdout.write(`${name} ... `);
    results.tests[name] = run("npm", ["run", "-s", name], 600_000);
    if (results.tests[name].timedOut) results.tests[name].stopped = stopLeftovers();
    console.log(results.tests[name].status === 0 ? "ok" : `FAILED (${results.tests[name].status}${results.tests[name].timedOut ? ", timed out" : ""})`);
    save();
  }
  results.finishedAt = new Date().toISOString();
  results.leftovers = countLeftovers();
  save();
  const failed = names.filter((name) => results.tests[name].status !== 0);
  console.log(`\n${label} @ ${commit}${results.dirty ? " (uncommitted changes)" : ""}: build ${results.build.status}, main chunk ${results.mainChunkBytes} bytes, ${names.length} tests, failed ${failed.length}: ${failed.join(", ") || "none"}`);
  console.log(`leftovers: ${formatLeftovers(results.leftovers)}`);
  console.log(`saved ${file}`);
} else if (mode === "compare") {
  const [beforeFile, afterFile] = rest;
  const before = JSON.parse(readFileSync(beforeFile, "utf8"));
  const after = JSON.parse(readFileSync(afterFile, "utf8"));
  const names = [...new Set([...Object.keys(before.tests), ...Object.keys(after.tests)])];
  const state = (entry) => (!entry ? "-" : entry.status === 0 ? "pass" : entry.timedOut ? "timeout" : "fail");
  const groups = { "both pass": [], "both fail": [], "new failure": [], "fixed": [], "only before": [], "only after": [] };
  for (const name of names) {
    const b = state(before.tests[name]);
    const a = state(after.tests[name]);
    if (b === "pass" && a === "pass") groups["both pass"].push(name);
    else if (b === "-") groups["only after"].push(`${name} (${a})`);
    else if (a === "-") groups["only before"].push(`${name} (${b})`);
    else if (b === "pass") groups["new failure"].push(`${name} (${a}): ${after.tests[name].firstError || after.tests[name].tail}`);
    else if (a === "pass") groups.fixed.push(name);
    else groups["both fail"].push(`${name}: before "${before.tests[name].firstError}" / after "${after.tests[name].firstError}"`);
  }
  console.log(`before ${before.commit} build ${before.build?.status} chunk ${before.mainChunkBytes} / after ${after.commit} build ${after.build?.status} chunk ${after.mainChunkBytes}`);
  for (const [group, items] of Object.entries(groups)) {
    if (!items.length) continue;
    console.log(`\n${group} (${items.length})`);
    if (group === "both pass") console.log(`  ${items.join(", ")}`);
    else for (const item of items) console.log(`  ${item}`);
  }
  if (groups["new failure"].length) {
    console.log("\nnew failures: rerun each alone (npm run -s <name>) before blaming the change; a first run can hang for reasons unrelated to it.");
    process.exitCode = 1;
  }
} else {
  throw new Error("usage: suite.mjs run <label> --out <dir> | suite.mjs compare <before.json> <after.json>");
}
