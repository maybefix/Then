import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/editor/documentIndex.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const {
  areDocumentIndexesEquivalent,
  createDocumentIndexFromLines,
  serializeDocumentIndex,
  updateDocumentIndex,
} = await import(moduleUrl);

function changedRange(previousLines, nextLines) {
  let from = 0;
  const maxPrefix = Math.min(previousLines.length, nextLines.length);
  while (from < maxPrefix && previousLines[from] === nextLines[from]) from += 1;

  let suffix = 0;
  const maxSuffix = Math.min(previousLines.length - from, nextLines.length - from);
  while (
    suffix < maxSuffix &&
    previousLines[previousLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    from,
    toOld: previousLines.length - suffix,
    toNew: nextLines.length - suffix,
  };
}

function fullMetrics(lines) {
  const text = lines.join("\n");
  return {
    utf16Length: text.length,
    textLength: Array.from(text).length,
    visibleTextLength: Array.from(text.replace(/[\s　]/g, "")).length,
    lineCount: lines.length,
  };
}

function assertMatchesFull(index, lines, message) {
  assert.equal(serializeDocumentIndex(index), lines.join("\n"), `${message}: serialized text`);
  assert.deepEqual(
    {
      utf16Length: index.utf16Length,
      textLength: index.textLength,
      visibleTextLength: index.visibleTextLength,
      lineCount: index.lineCount,
    },
    fullMetrics(lines),
    `${message}: aggregate metrics`,
  );
  assert.equal(
    areDocumentIndexesEquivalent(index, createDocumentIndexFromLines(lines)),
    true,
    `${message}: incremental and rebuilt indexes`,
  );
}

const initialLines = ["# 見出し", "本文😀", "空　白", ""];
let index = createDocumentIndexFromLines(initialLines);
assertMatchesFull(index, initialLines, "initial index");
assert.equal(index.lines[1].utf16Length, 4, "emoji occupies two UTF-16 code units");
assert.equal(index.lines[1].textLength, 3, "emoji counts as one display code point");
assert.equal(index.lines[2].visibleTextLength, 2, "full-width whitespace is excluded");

const editedLines = ["# 見出し", "本文😀追記", "空　白", ""];
const editedIndex = updateDocumentIndex(index, editedLines, changedRange(initialLines, editedLines));
assertMatchesFull(editedIndex, editedLines, "single-line edit");
assert.equal(editedIndex.lines[0], index.lines[0], "unchanged prefix line metrics must be reused");
assert.equal(editedIndex.lines[2], index.lines[2], "unchanged suffix line metrics must be reused");
assert.notEqual(editedIndex.lines[1], index.lines[1], "the changed line must be rebuilt");

const emptyIndex = createDocumentIndexFromLines([]);
assertMatchesFull(emptyIndex, [""], "empty document normalization");
const invalidDiffFallback = updateDocumentIndex(index, editedLines, {
  from: -1,
  toOld: initialLines.length,
  toNew: editedLines.length,
});
assertMatchesFull(invalidDiffFallback, editedLines, "invalid diff fallback");

let seed = 0x5e1ec710;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const pick = (values) => values[Math.floor(random() * values.length)];
const fragments = ["あ", "Z", "😀", " ", "　", "\t", "《ルビ》", "**強調**"];

let lines = editedLines;
index = editedIndex;
const operations = { edit: 0, insert: 0, delete: 0, paste: 0 };

for (let iteration = 0; iteration < 1_000; iteration += 1) {
  const previousLines = lines;
  const nextLines = [...previousLines];
  const operation = Math.floor(random() * 4);

  if (operation === 0) {
    const lineIndex = Math.floor(random() * nextLines.length);
    const sourceLine = nextLines[lineIndex];
    const offset = Math.floor(random() * (sourceLine.length + 1));
    nextLines[lineIndex] = `${sourceLine.slice(0, offset)}${pick(fragments)}${sourceLine.slice(offset)}`;
    operations.edit += 1;
  } else if (operation === 1) {
    const lineIndex = Math.floor(random() * (nextLines.length + 1));
    nextLines.splice(lineIndex, 0, `${pick(fragments)}${pick(fragments)}`);
    operations.insert += 1;
  } else if (operation === 2 && nextLines.length > 1) {
    const lineIndex = Math.floor(random() * nextLines.length);
    nextLines.splice(lineIndex, 1);
    operations.delete += 1;
  } else {
    const from = Math.floor(random() * nextLines.length);
    const removeCount = Math.min(nextLines.length - from, 1 + Math.floor(random() * 3));
    const inserted = [pick(fragments), `${pick(fragments)}${pick(fragments)}`];
    nextLines.splice(from, removeCount, ...inserted);
    operations.paste += 1;
  }

  const diff = changedRange(previousLines, nextLines);
  index = updateDocumentIndex(index, nextLines, diff);
  lines = nextLines;
  assertMatchesFull(index, lines, `fuzz iteration ${iteration}`);
}

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
assert.match(
  editorSource,
  /documentIndex:\s*DocumentIndex \| null/,
  "the editor AST plugin must allow the development-only index to be absent in production",
);
assert.match(
  editorSource,
  /if \(!import\.meta\.env\.DEV \|\| !previous\) return null;/,
  "the production input path must not maintain an unused shadow index",
);
assert.match(
  editorSource,
  /areDocumentIndexesEquivalent\(incremental, rebuilt\)/,
  "development builds must compare incremental metrics with a complete rebuild",
);
assert.match(
  editorSource,
  /return rebuilt;/,
  "a shadow mismatch must fall back to the completely rebuilt index",
);

console.log(
  JSON.stringify({ iterations: 1_000, finalLines: lines.length, operations }, null, 2),
);
console.log("v0.5.8 incremental document index tests passed");
