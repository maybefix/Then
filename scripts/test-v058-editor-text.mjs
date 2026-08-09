import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
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

const transactionDiffSource = await readFile("src/editor/transactionLineDiff.ts", "utf8");
const transactionDiffCode = ts.transpileModule(transactionDiffSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const transactionDiffUrl = `data:text/javascript;base64,${Buffer.from(transactionDiffCode).toString("base64")}`;
const { lineDiffFromSelectionTransaction } = await import(transactionDiffUrl);

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

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

function pmDoc(lines) {
  return schema.node(
    "doc",
    null,
    lines.map((line) => schema.node("paragraph", null, line ? schema.text(line) : null)),
  );
}

function lineStart(doc, lineIndex) {
  let position = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    position += doc.child(index).nodeSize;
  }
  return position;
}

function referenceTopLevelDiff(oldDoc, newDoc) {
  let from = 0;
  const maxPrefix = Math.min(oldDoc.childCount, newDoc.childCount);
  while (from < maxPrefix && oldDoc.child(from).eq(newDoc.child(from))) from += 1;

  let suffix = 0;
  const maxSuffix = Math.min(oldDoc.childCount - from, newDoc.childCount - from);
  while (
    suffix < maxSuffix &&
    oldDoc.child(oldDoc.childCount - 1 - suffix).eq(newDoc.child(newDoc.childCount - 1 - suffix))
  ) {
    suffix += 1;
  }
  return {
    from,
    toOld: oldDoc.childCount - suffix,
    toNew: newDoc.childCount - suffix,
  };
}

function select(state, from, to = from) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function applyFastTransaction(state, transaction, label) {
  const nextState = state.apply(transaction);
  const actual = lineDiffFromSelectionTransaction(transaction, state, nextState);
  const reference = referenceTopLevelDiff(state.doc, nextState.doc);
  const detail = JSON.stringify({
    actual,
    reference,
    oldSelection: { from: state.selection.from, to: state.selection.to },
    newSelection: { from: nextState.selection.from, to: nextState.selection.to },
    oldCount: state.doc.childCount,
    newCount: nextState.doc.childCount,
  });
  assert.notEqual(actual, null, `${label}: expected the transaction fast path; ${detail}`);
  assert.equal(
    state.doc.childCount - actual.toOld,
    nextState.doc.childCount - actual.toNew,
    `${label}: unchanged suffix lengths must remain aligned`,
  );
  for (let index = 0; index < actual.from; index += 1) {
    assert.ok(state.doc.child(index).eq(nextState.doc.child(index)), `${label}: unchanged prefix`);
  }
  const suffixCount = state.doc.childCount - actual.toOld;
  for (let offset = 0; offset < suffixCount; offset += 1) {
    assert.ok(
      state.doc.child(actual.toOld + offset).eq(nextState.doc.child(actual.toNew + offset)),
      `${label}: unchanged suffix`,
    );
  }
  return nextState;
}

let transactionState = EditorState.create({
  schema,
  doc: pmDoc(["一行目", "二行目", "三行目", "四行目"]),
});
transactionState = select(transactionState, lineStart(transactionState.doc, 2) + 2);
transactionState = applyFastTransaction(
  transactionState,
  transactionState.tr.insertText("追"),
  "inline insertion must use the selected line",
);
transactionState = select(transactionState, lineStart(transactionState.doc, 1) + 1);
transactionState = applyFastTransaction(
  transactionState,
  transactionState.tr.delete(
    lineStart(transactionState.doc, 1) - 1,
    lineStart(transactionState.doc, 1) + 1,
  ),
  "joining adjacent lines must cover both old lines",
);
transactionState = select(transactionState, lineStart(transactionState.doc, 1) + 2);
transactionState = applyFastTransaction(
  transactionState,
  transactionState.tr.split(transactionState.selection.head),
  "splitting a line must cover both resulting lines",
);

const selectionFrom = lineStart(transactionState.doc, 0) + 2;
const selectionTo = lineStart(transactionState.doc, 2) + 2;
transactionState = select(transactionState, selectionFrom, selectionTo);
transactionState = applyFastTransaction(
  transactionState,
  transactionState.tr.insertText("置換範囲"),
  "a multiline selection replacement must retain the unchanged suffix",
);

const selectedForFallback = select(transactionState, lineStart(transactionState.doc, 0) + 1);
const awayFromSelection = lineStart(selectedForFallback.doc, selectedForFallback.doc.childCount - 1) + 1;
const programmaticTransaction = selectedForFallback.tr.insertText("外", awayFromSelection);
const programmaticNextState = selectedForFallback.apply(programmaticTransaction);
assert.equal(
  lineDiffFromSelectionTransaction(
    programmaticTransaction,
    selectedForFallback,
    programmaticNextState,
  ),
  null,
  "programmatic edits away from the selection must use the compatibility fallback",
);

const fullReplacementState = select(transactionState, lineStart(transactionState.doc, 1) + 2);
const fullReplacementTransaction = fullReplacementState.tr.replaceWith(
  0,
  fullReplacementState.doc.content.size,
  pmDoc(["全体", "置換", "内容"]).content,
);
const fullReplacementNextState = fullReplacementState.apply(fullReplacementTransaction);
assert.equal(
  lineDiffFromSelectionTransaction(
    fullReplacementTransaction,
    fullReplacementState,
    fullReplacementNextState,
  ),
  null,
  "whole-document replacement surrounding the selection must use the compatibility fallback",
);

const multiStepState = select(transactionState, lineStart(transactionState.doc, 0) + 1);
const multiStepTransaction = multiStepState.tr
  .insertText("A")
  .insertText("B", multiStepState.doc.content.size - 1);
const multiStepNextState = multiStepState.apply(multiStepTransaction);
assert.equal(
  lineDiffFromSelectionTransaction(multiStepTransaction, multiStepState, multiStepNextState),
  null,
  "multi-step transactions must use the compatibility fallback",
);

let transactionFuzzState = EditorState.create({
  schema,
  doc: pmDoc(Array.from({ length: 80 }, (_, index) => `段落${index}`)),
});
for (let iteration = 0; iteration < 500; iteration += 1) {
  const operation = randomInt(4);
  const lineIndex = randomInt(transactionFuzzState.doc.childCount);
  const line = transactionFuzzState.doc.child(lineIndex);
  const start = lineStart(transactionFuzzState.doc, lineIndex);

  if (operation === 0 || transactionFuzzState.doc.childCount <= 2) {
    const offset = randomInt(line.content.size + 1);
    transactionFuzzState = select(transactionFuzzState, start + 1 + offset);
    transactionFuzzState = applyFastTransaction(
      transactionFuzzState,
      transactionFuzzState.tr.insertText(iteration % 2 === 0 ? "追" : "😀"),
      `transaction insertion ${iteration}`,
    );
  } else if (operation === 1 && line.content.size > 0) {
    const offset = 1 + randomInt(line.content.size);
    const cursor = start + 1 + offset;
    transactionFuzzState = select(transactionFuzzState, cursor);
    transactionFuzzState = applyFastTransaction(
      transactionFuzzState,
      transactionFuzzState.tr.delete(cursor - 1, cursor),
      `transaction deletion ${iteration}`,
    );
  } else if (operation === 2 && transactionFuzzState.doc.childCount < 140) {
    const offset = randomInt(line.content.size + 1);
    const cursor = start + 1 + offset;
    transactionFuzzState = select(transactionFuzzState, cursor);
    transactionFuzzState = applyFastTransaction(
      transactionFuzzState,
      transactionFuzzState.tr.split(cursor),
      `transaction split ${iteration}`,
    );
  } else {
    const joinIndex = Math.max(1, lineIndex);
    const boundary = lineStart(transactionFuzzState.doc, joinIndex);
    transactionFuzzState = select(transactionFuzzState, boundary + 1);
    transactionFuzzState = applyFastTransaction(
      transactionFuzzState,
      transactionFuzzState.tr.join(boundary),
      `transaction join ${iteration}`,
    );
  }
}

assert.doesNotMatch(
  transactionDiffSource,
  /\.child\(|\.eq\(/,
  "the transaction fast path must not compare top-level document children",
);

const benchmarkLines = Array.from(
  { length: 15_625 },
  (_, index) => `性能測定用の本文${index.toString().padStart(5, "0")}あいうえおかきくけこ`,
);
let benchmarkState = EditorState.create({ schema, doc: pmDoc(benchmarkLines) });
benchmarkState = select(
  benchmarkState,
  lineStart(benchmarkState.doc, Math.floor(benchmarkLines.length / 2)) + 8,
);
const benchmarkTransaction = benchmarkState.tr.insertText("追");
const benchmarkNextState = benchmarkState.apply(benchmarkTransaction);
const benchmarkIterations = 200;

let startedAt = performance.now();
for (let iteration = 0; iteration < benchmarkIterations; iteration += 1) {
  referenceTopLevelDiff(benchmarkState.doc, benchmarkNextState.doc);
}
const exhaustiveDiffMs = performance.now() - startedAt;

startedAt = performance.now();
for (let iteration = 0; iteration < benchmarkIterations; iteration += 1) {
  lineDiffFromSelectionTransaction(
    benchmarkTransaction,
    benchmarkState,
    benchmarkNextState,
  );
}
const transactionDiffMs = performance.now() - startedAt;

assert.ok(
  transactionDiffMs < exhaustiveDiffMs,
  "transaction line detection must be faster than comparing every top-level node",
);
console.log(JSON.stringify({
  transactionDiffBenchmark: {
    characters: benchmarkLines.join("\n").length,
    lines: benchmarkLines.length,
    iterations: benchmarkIterations,
    exhaustiveDiffMs: Number(exhaustiveDiffMs.toFixed(2)),
    transactionDiffMs: Number(transactionDiffMs.toFixed(2)),
    ratio: Number((transactionDiffMs / exhaustiveDiffMs).toFixed(4)),
  },
}));

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
assert.match(
  editorSource,
  /const diff = lineDiffFromSelectionTransaction\(tr, _oldState, newState\)\s*\?\? diffTopLevelNodes\(_oldState\.doc, newState\.doc\)/,
  "ordinary selection edits must derive their line range from the transaction before falling back",
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
