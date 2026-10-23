// 移したコードが元と同じかを確かめる。source から消えた行（git diff の「-」）と、
// 移し先のファイルの行を、字下げ・空行・先頭の export を無視して突き合わせる。
//
// 使い方: node .claude/skills/then-safe-change/scripts/verify-move.mjs <source> <target>... [--base <ref>]
//   --base: 比べる元（既定は HEAD。移す前にコミットしてあれば、そのコミット）
// 出力:
//   lost  … source から消えたのに、移し先のどこにもない行（＝書き換えた・落とした行。0 が理想）
//   added … source に足した行（import や呼び出しの行。意図したものだけのはず）
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD";
const files = args.filter((arg, index) => !arg.startsWith("--") && (baseIndex < 0 || index !== baseIndex + 1));
const [source, ...targets] = files;
if (!source || !targets.length) throw new Error("usage: verify-move.mjs <source> <target>... [--base <ref>]");

const normalize = (line) => line.replace(/\r$/, "").trim().replace(/^export /, "");
const diff = execFileSync("git", ["diff", "-U0", base, "--", source], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const removed = [];
const added = [];
for (const line of diff.split(/\r?\n/)) {
  if (line.startsWith("---") || line.startsWith("+++")) continue;
  if (line.startsWith("-")) removed.push(normalize(line.slice(1)));
  if (line.startsWith("+")) added.push(line.slice(1).replace(/\r$/, ""));
}
const targetCounts = new Map();
for (const target of targets) {
  for (const line of readFileSync(target, "utf8").split(/\r?\n/).map(normalize)) {
    if (line) targetCounts.set(line, (targetCounts.get(line) ?? 0) + 1);
  }
}
const lost = [];
for (const line of removed.filter(Boolean)) {
  const count = targetCounts.get(line) ?? 0;
  if (count > 0) targetCounts.set(line, count - 1);
  else lost.push(line);
}
console.log(`removed from ${source}: ${removed.filter(Boolean).length} lines, lost: ${lost.length}, added to source: ${added.length}`);
if (lost.length) console.log(`\nlost (not found in ${targets.join(", ")}):\n${lost.map((line) => `  ${line}`).join("\n")}`);
if (added.length) console.log(`\nadded to ${source}:\n${added.map((line) => `  ${line}`).join("\n")}`);
process.exit(lost.length ? 1 : 0);
