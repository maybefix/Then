// QA のあと片付け。QA の Then と WebView2・テストの node と Edge が残っていれば止め、
// QA アプリのデータフォルダと一時ライブラリを消し、最後に残りの数を出す（全部 0 のはず）。
//
// 使い方: node .claude/skills/then-safe-change/scripts/qa/qa-cleanup.mjs <identifier> [--library <dir>] [--exe <path>]
import { existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { countLeftovers, formatLeftovers, stopLeftovers } from "../lib/processes.mjs";

const [identifier, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : fallback;
};
if (!identifier?.startsWith("local.then.qa.")) throw new Error("usage: qa-cleanup.mjs local.then.qa.<topic> [--library <dir>] [--exe <path>]");
const exe = path.resolve(option("exe", "src-tauri/target/release/Then.exe"));
const options = { exe, identifier };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 止めている途中のもの（q.mjs stop の直後の qa-session など）は、自分で終わるのを8秒まで待つ。
for (let waited = 0; waited < 8000 && Object.values(countLeftovers(options)).some(Boolean); waited += 1000) await sleep(1000);
const stopped = stopLeftovers(options);
await sleep(1500);
const removed = [];
for (const dir of [path.join(process.env.APPDATA, identifier), path.join(process.env.LOCALAPPDATA, identifier), option("library")].filter(Boolean)) {
  if (!existsSync(dir)) continue;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  removed.push(`${dir}${existsSync(dir) ? " (STILL THERE)" : ""}`);
}
// テスト用 Edge のプロファイル（%TEMP%\then-*-qa-* など）。dist などの build 出力は名前に -dist を持つので除く。
const profiles = readdirSync(os.tmpdir()).filter((name) => /^then-.*-(qa|bench)-\w+$/.test(name) && !name.endsWith("-dist"));
console.log(`stopped ${stopped} processes`);
console.log(`removed: ${removed.length ? `\n  ${removed.join("\n  ")}` : "nothing"}`);
console.log(`leftovers: ${formatLeftovers(countLeftovers(options))}, test profiles in %TEMP%: ${profiles.length}${profiles.length ? ` (${profiles.join(", ")})` : ""}`);
