import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const helperSource = await readFile("src/editor/lineTextUpdate.ts", "utf8");
const helperCode = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperCode).toString("base64")}`;
const { updateTextFromLineDiff } = await import(helperUrl);

function sourceLines(lines) {
  return lines.map((source) => ({ source }));
}

function diffLines(previous, next) {
  let from = 0;
  while (from < previous.length && from < next.length && previous[from] === next[from]) {
    from += 1;
  }

  let suffix = 0;
  while (
    suffix < previous.length - from &&
    suffix < next.length - from &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    from,
    toOld: previous.length - suffix,
    toNew: next.length - suffix,
  };
}

function assertUpdate(previous, next, message) {
  const actual = updateTextFromLineDiff(
    previous.join("\n"),
    sourceLines(previous),
    sourceLines(next),
    diffLines(previous, next),
  );
  assert.equal(actual, next.join("\n"), message);
}

assertUpdate(["a", "b", "c"], ["a", "変更", "c"], "middle replacement");
assertUpdate(["a", "b"], ["a", "挿入", "b"], "middle insertion");
assertUpdate(["a", "b", "c"], ["a", "c"], "middle deletion");
assertUpdate(["a", "b"], ["a"], "last-line deletion removes its separator");
assertUpdate(["a"], ["a", ""], "appending an empty line keeps the newline");
assertUpdate([""], ["", "末尾"], "append after an initially blank line");
assertUpdate(["a", "b"], [""], "whole-document replacement with blank text");
assertUpdate(["😀", "漢字"], ["😀追記", "漢字", "終"], "UTF-16 text remains exact");

const observedPrevious = Array.from({ length: 10_000 }, (_, index) => ({ source: `旧${index}` }));
let nextSourceReads = 0;
const observedNext = observedPrevious.map((line, index) => ({
  get source() {
    nextSourceReads += 1;
    return index === 5_000 ? "変更" : line.source;
  },
}));
const observedResult = updateTextFromLineDiff(
  observedPrevious.map((line) => line.source).join("\n"),
  observedPrevious,
  observedNext,
  { from: 5_000, toOld: 5_001, toNew: 5_001 },
);
assert.equal(observedResult, observedPrevious
  .map((line, index) => (index === 5_000 ? "変更" : line.source))
  .join("\n"));
assert.equal(nextSourceReads, 1, "only the changed next line should be materialized");

let seed = 0x5eed1234;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x1_0000_0000;
}
function randomInt(limit) {
  return Math.floor(random() * limit);
}

let lines = Array.from({ length: 120 }, (_, index) => `行${index}`);
for (let iteration = 0; iteration < 1_000; iteration += 1) {
  const previous = lines;
  lines = previous.slice();
  const operation = randomInt(4);
  if (operation === 0) {
    lines[randomInt(lines.length)] += iteration % 2 === 0 ? "追" : "😀";
  } else if (operation === 1) {
    lines.splice(randomInt(lines.length + 1), 0, iteration % 3 === 0 ? "" : `挿入${iteration}`);
  } else if (operation === 2 && lines.length > 1) {
    lines.splice(randomInt(lines.length), 1);
  } else {
    const start = randomInt(lines.length);
    const remove = Math.min(lines.length - start, 1 + randomInt(3));
    const added = Array.from({ length: randomInt(4) }, (_, index) => `置換${iteration}-${index}`);
    lines.splice(start, remove, ...added);
    if (lines.length === 0) lines = [""];
  }
  assertUpdate(previous, lines, `deterministic edit ${iteration}`);
}

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
assert.match(
  editorSource,
  /const diff = diffTopLevelNodes\(_oldState\.doc, newState\.doc\)/,
  "document changes must locate changed top-level nodes without materializing every line",
);
assert.match(
  editorSource,
  /const text = updateTextFromLineDiff\(/,
  "the AST plugin must update its text from the changed line window",
);
assert.match(
  editorSource,
  /astKey\.getState\(currentEditor\.state\)\?\.text\s*\?\?\s*docToText/,
  "onUpdate must reuse the text already maintained by the AST plugin",
);
assert.doesNotMatch(
  editorSource,
  /const newTexts = topTexts\(newState\.doc\)/,
  "ordinary document changes must not extract text from every ProseMirror block",
);
assert.doesNotMatch(
  editorSource,
  /const next = docToText\(currentEditor\.state\.doc\)/,
  "onUpdate must not perform a second full ProseMirror text extraction",
);
assert.match(
  editorSource,
  /\[editor-text-shadow\].*using full materialization/,
  "development builds must retain a full-materialization fallback for text divergence",
);

console.log("v0.5.8 incremental editor text tests passed");
