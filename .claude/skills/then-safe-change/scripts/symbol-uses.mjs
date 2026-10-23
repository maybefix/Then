// 名前ごとに、ファイルの中で出てくる行番号を並べる（語の境界で数える）。
// - 調査: 「どこから呼ばれているか」「使われていない関数はどれか」（定義の1回だけ＝uses 1）
// - 分離のあと: 「使わなくなった import はどれか」（import の行の1回だけ＝uses 1）
// - --call-site <行>: 移した関数を呼び出す位置より前で名前が出てくる行に「before」を付ける。
//   そこが関数の中（クリックなどで後から呼ばれる）なら問題ない。描画の途中で直接読む所
//   （useCallback/useMemo/useEffect の依存の配列、JSX の外での呼び出し）なら、その値はまだ
//   作られていないので壊れる（TDZ）。before の行は1つずつ目で確かめる。
//
// 使い方: node .claude/skills/then-safe-change/scripts/symbol-uses.mjs <file> <name>... [--call-site <line>]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const siteIndex = args.indexOf("--call-site");
const callSite = siteIndex >= 0 ? Number(args[siteIndex + 1]) : null;
const [file, ...names] = args.filter((arg, index) => !arg.startsWith("--") && (siteIndex < 0 || index !== siteIndex + 1));
if (!file || !names.length) throw new Error("usage: symbol-uses.mjs <file> <name>... [--call-site <line>]");

const lines = readFileSync(file, "utf8").split(/\r?\n/);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const name of names) {
  const pattern = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`);
  const hits = lines.flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
  const marks = hits.map((line) => (callSite && line < callSite ? `${line}(before)` : String(line)));
  const note = hits.length === 0 ? "  <- not found" : hits.length === 1 ? "  <- only once (unused, or only declared/imported)" : "";
  console.log(`${name.padEnd(32)} uses ${String(hits.length).padStart(3)}: ${marks.join(" ")}${note}`);
}
