// 今のコードから、ふだんの Then と別の識別子の QA 用アプリを build する（配布物は作らない）。
// 出来上がりは src-tauri/target/release/Then.exe（ふだん用の build はここで上書きされる）。
// build が src-tauri/Cargo.toml の改行だけを書き換えたときは、git の内容に戻す。
//
// 使い方（リポジトリのルートで、3〜4分）:
//   node .claude/skills/then-safe-change/scripts/qa/qa-build.mjs <identifier> [--log <file>]
//   identifier の例: local.then.qa.ideasplit1023（ふだんの local.then と重ならないこと）
// 同時に npm run build（suite.mjs など）を動かさない。どちらも dist を書き換える。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [identifier, ...rest] = process.argv.slice(2);
if (!identifier || identifier === "local.then" || !identifier.startsWith("local.then.qa.")) {
  throw new Error("usage: qa-build.mjs local.then.qa.<topic><date> [--log <file>]");
}
const logIndex = rest.indexOf("--log");
const log = logIndex >= 0 ? rest[logIndex + 1] : null;

const configDir = mkdtempSync(path.join(os.tmpdir(), "qa-config-"));
const config = path.join(configDir, "tauri.qa.json");
writeFileSync(config, JSON.stringify({ identifier, productName: `Then QA ${identifier.split(".").pop()}`, bundle: { active: false } }, null, 2));
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
console.log(`building QA app ${identifier} from ${commit} ...`);
const started = Date.now();
const result = spawnSync("npx", ["tauri", "build", "--config", `"${config}"`], { shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60_000 });
rmSync(configDir, { recursive: true, force: true });
if (log) writeFileSync(log, `${result.stdout}\n${result.stderr}`);
const tail = `${result.stdout}${result.stderr}`.split(/\r?\n/).filter(Boolean).slice(-4).join("\n");

// tauri build は Cargo.toml を LF で書き直すことがある。中身が同じなら元に戻す。
const cargo = "src-tauri/Cargo.toml";
// autocrlf があるので git diff には出ない。git status で「変わった」と出るかで見る。
const changed = spawnSync("git", ["status", "--porcelain", "--", cargo], { encoding: "utf8" }).stdout.trim() !== "";
if (changed) {
  const contentChanged = spawnSync("git", ["diff", "--quiet", "--ignore-all-space", "--ignore-cr-at-eol", "--", cargo]).status !== 0;
  if (contentChanged) console.log(`WARNING: ${cargo} content changed during the build; left as is`);
  else {
    spawnSync("git", ["checkout", "--", cargo]);
    console.log(`${cargo}: only line endings changed during the build; restored from git`);
  }
}
const exe = path.resolve("src-tauri/target/release/Then.exe");
const fresh = existsSync(exe) && statSync(exe).mtimeMs >= started;
console.log(`${tail}\n\nexit ${result.status}${result.error ? ` (${result.error.code})` : ""}, ${Math.round((Date.now() - started) / 1000)}s, exe ${fresh ? exe : "NOT rebuilt"}`);
process.exit(result.status === 0 && fresh ? 0 : 1);
