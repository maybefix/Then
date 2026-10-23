// ソースの「文字列」を直接読んで確かめているテストを探す。コードを別ファイルへ移すと、
// 動きが同じでもこれらのテストは失敗する。移す前に一覧を作り、移した後は「読むファイル」
// だけを直す（確かめる正規表現は変えない）。
//
// 使い方: node .claude/skills/then-safe-change/scripts/text-deps.mjs <source> [<grep>...]
//   <grep>: 移す予定の名前や文言（例 captureFragment "断片を削除"）。指定すると、それを
//           含む行だけを出す。指定しなければ、そのファイルの中身を使う行を全部出す。
// readFile で読まずに import や esbuild で動かしているテストは「runtime」と出す（文字列では落ちない）。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [source, ...needles] = process.argv.slice(2);
if (!source) throw new Error("usage: text-deps.mjs <source> [<grep>...]");
const normalizedSource = source.replace(/\\/g, "/");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const scriptsDir = "scripts";
const files = readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs")).map((name) => path.join(scriptsDir, name));
const packageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const registered = (file) =>
  Object.entries(packageScripts).filter(([, command]) => command.includes(file.replace(/\\/g, "/"))).map(([name]) => name);

/** そのファイルの中身を受け取っている変数の名前（なければ null）。 */
function boundNames(text) {
  const names = new Set();
  const quoted = escapeRegExp(normalizedSource);
  const direct = new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*(?:await\\s+)?readFile\\(\\s*["'\`]${quoted}["'\`]`, "g");
  for (const match of text.matchAll(direct)) names.add(match[1]);
  // const [a, b] = await Promise.all([readFile("x"), readFile("y")]) の形
  for (const match of text.matchAll(/(?:const|let)\s+\[([^\]]+)\]\s*=\s*(?:await\s+)?Promise\.all\(\[([\s\S]*?)\]\s*\)/g)) {
    const variables = match[1].split(",").map((name) => name.trim());
    const reads = [...match[2].matchAll(/readFile\(\s*["'`]([^"'`]+)["'`]/g)].map((read) => read[1]);
    reads.forEach((read, index) => {
      if (read === normalizedSource && variables[index]) names.add(variables[index]);
    });
  }
  return names.size ? names : null;
}

/** 複数行にまたがる assert.match( … ); を1つの文にまとめる。 */
function statementsOf(text) {
  const statements = [];
  let current = null;
  text.split(/\r?\n/).forEach((line, index) => {
    if (current) {
      current.line += ` ${line.trim()}`;
      if (/\);\s*$/.test(line)) {
        statements.push(current);
        current = null;
      }
      return;
    }
    const entry = { line: line.trim(), number: index + 1 };
    if (/(assert\.\w+|section)\(\s*$/.test(line)) current = entry;
    else statements.push(entry);
  });
  if (current) statements.push(current);
  return statements;
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(normalizedSource)) continue;
  const names = registered(file);
  const label = `\n== ${file}${names.length ? ` (${names.join(", ")})` : " (not in package.json)"}`;
  const bound = boundNames(text);
  if (!bound) {
    if (!needles.length) console.log(`${label}: runtime (uses the file without reading it as text)`);
    continue;
  }
  const mentions = (line) => [...bound].some((name) => new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).test(line));
  const checks = statementsOf(text)
    .filter(({ line }) => mentions(line) && !/readFile\(/.test(line) && !/^(const|let)\s+\[/.test(line))
    .filter(({ line }) => !needles.length || needles.some((needle) => line.includes(needle) || line.includes(escapeRegExp(needle))));
  if (needles.length && !checks.length) continue;
  console.log(`${label}: ${checks.length} lines use ${[...bound].join(", ")}`);
  for (const { line, number } of checks.slice(0, 80)) console.log(`  ${number}: ${line.slice(0, 200)}`);
  if (checks.length > 80) console.log(`  ... ${checks.length - 80} more`);
}
