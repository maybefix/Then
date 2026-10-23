// コードを「中身を変えずに」別ファイルへ移す。行番号と先頭・末尾の行の文字列で範囲を確かめ、
// 合わなければ何も書かずに止まる。改行（CRLF/LF）は元のファイルに合わせる。
//
// 使い方（リポジトリのルートで）: node .claude/skills/then-safe-change/scripts/move-lines.mjs <spec.json> [--dry-run]
//
// spec.json:
// {
//   "source": "src/App.tsx",
//   "target": "src/fooModel.ts",            // 新しいファイル（既にあれば止まる）
//   "blocks": [
//     { "name": "model", "from": 922, "to": 983,          // 両端を含む行番号（今のファイル）
//       "first": "const INBOX_THREAD_ID = \"idea-inbox\";", // from 行の中身（完全一致）
//       "last": "}",                                       // to 行の中身（完全一致）
//       "removeTrailingBlank": true,   // 直後の空行も source から消す
//       "dedent": 0,                   // target に書くとき先頭から削る空白の数
//       "replace": [["event.payload.", "request."]],  // target に書くときだけの置き換え
//       "export": ["function nextIdeaId"],            // この文字列で始まる行の先頭に export を付ける
//       "leave": ["  receive(event.payload);"] }      // source のその場所に残す行（なければ消すだけ）
//   ],
//   "targetLayout": ["import ...;", "", {"block": "model"}, ""],  // target の中身。{"block"} が塊
//   "sourceImport": { "after": "} from \"./ideaReferenceModel\";", "lines": ["import { x } from \"./fooModel\";"] }
// }
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [specPath, flag] = process.argv.slice(2);
if (!specPath) throw new Error("usage: move-lines.mjs <spec.json> [--dry-run]");
const dryRun = flag === "--dry-run";
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const raw = readFileSync(spec.source, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(eol);
if (spec.target && existsSync(spec.target)) throw new Error(`${spec.target} already exists`);

const blocks = new Map();
const problems = [];
for (const block of spec.blocks) {
  if (blocks.has(block.name)) problems.push(`duplicate block name ${block.name}`);
  const first = lines[block.from - 1];
  const last = lines[block.to - 1];
  if (first !== block.first) problems.push(`${block.name}: line ${block.from} is ${JSON.stringify(first)}, expected ${JSON.stringify(block.first)}`);
  if (last !== block.last) problems.push(`${block.name}: line ${block.to} is ${JSON.stringify(last)}, expected ${JSON.stringify(block.last)}`);
  if (block.removeTrailingBlank && lines[block.to] !== "") problems.push(`${block.name}: line ${block.to + 1} is not blank`);
  blocks.set(block.name, block);
}
const sorted = [...spec.blocks].sort((a, b) => a.from - b.from);
for (let i = 1; i < sorted.length; i++) {
  const previousEnd = sorted[i - 1].to + (sorted[i - 1].removeTrailingBlank ? 1 : 0);
  if (sorted[i].from <= previousEnd) problems.push(`${sorted[i - 1].name} and ${sorted[i].name} overlap`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const targetLinesOf = (block) => {
  const exportPrefixes = block.export ?? [];
  return lines.slice(block.from - 1, block.to).map((line) => {
    let next = line;
    if (block.dedent) {
      if (next !== "" && !next.startsWith(" ".repeat(block.dedent))) throw new Error(`${block.name}: cannot dedent ${JSON.stringify(line)}`);
      next = next === "" ? next : next.slice(block.dedent);
    }
    for (const [from, to] of block.replace ?? []) next = next.split(from).join(to);
    if (exportPrefixes.some((prefix) => next.startsWith(prefix))) next = `export ${next}`;
    return next;
  });
};
for (const block of spec.blocks) {
  for (const prefix of block.export ?? []) {
    if (!targetLinesOf(block).some((line) => line.startsWith(`export ${prefix}`))) throw new Error(`${block.name}: no line starts with ${prefix}`);
  }
}

const used = new Set();
const targetLines = [];
for (const item of spec.targetLayout ?? []) {
  if (typeof item === "string") targetLines.push(item);
  else {
    const block = blocks.get(item.block);
    if (!block) throw new Error(`targetLayout names unknown block ${item.block}`);
    used.add(block.name);
    targetLines.push(...targetLinesOf(block));
  }
}
const unused = spec.blocks.filter((block) => !used.has(block.name)).map((block) => block.name);
if (spec.target && unused.length) throw new Error(`blocks not placed in targetLayout: ${unused.join(", ")}`);

const next = [...lines];
for (const block of [...spec.blocks].sort((a, b) => b.from - a.from)) {
  const count = block.to - block.from + 1 + (block.removeTrailingBlank ? 1 : 0);
  next.splice(block.from - 1, count, ...(block.leave ?? []));
}
if (spec.sourceImport) {
  const index = next.indexOf(spec.sourceImport.after);
  if (index < 0 || next.indexOf(spec.sourceImport.after, index + 1) >= 0) throw new Error("sourceImport.after must match exactly one line");
  next.splice(index + 1, 0, ...spec.sourceImport.lines);
}

const movedCount = spec.blocks.reduce((sum, block) => sum + block.to - block.from + 1, 0);
console.log(`${spec.source}: ${lines.length} -> ${next.length} lines; moved ${movedCount} lines in ${spec.blocks.length} blocks${spec.target ? ` to ${spec.target} (${targetLines.length} lines)` : ""}; line endings ${eol === "\r\n" ? "CRLF" : "LF"}`);
if (dryRun) process.exit(0);
if (spec.target) writeFileSync(spec.target, targetLines.join(eol));
writeFileSync(spec.source, next.join(eol));
