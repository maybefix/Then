import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const helperSource = await readFile("src/editor/selectionMetrics.ts", "utf8");
const helperCode = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperCode).toString("base64")}`;
const { lineNumberFromTopLevelIndex } = await import(helperUrl);

assert.equal(lineNumberFromTopLevelIndex(0), 1, "the first ProseMirror block is line 1");
assert.equal(lineNumberFromTopLevelIndex(41), 42, "line numbers must derive directly from block indices");
assert.equal(lineNumberFromTopLevelIndex(-1), 1, "invalid negative indices must clamp to line 1");

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
assert.match(
  editorSource,
  /line:\s*lineNumberFromTopLevelIndex\(selection\.\$head\.index\(0\)\)/,
  "the editor selection snapshot must expose the ProseMirror top-level line",
);
assert.match(
  editorSource,
  /\{ from: 0, to: 0, head: 0, line: 1 \}/,
  "the editor-not-ready selection fallback must still provide a valid first line",
);

const appSource = await readFile("src/App.tsx", "utf8");
assert.match(
  appSource,
  /const \[editorSelectionLine, setEditorSelectionLine\] = useState\(1\)/,
  "App must retain the line supplied by the editor selection snapshot",
);
assert.match(
  appSource,
  /const activeEditorLine = editorSelectionLine;/,
  "active outline lookup must use the editor-provided line",
);
assert.doesNotMatch(
  appSource,
  /getLineNumberAtOffset\(editorText, editorSelectionHead\)/,
  "selection updates must not rescan the document prefix to find the active line",
);

console.log("v0.5.8 selection metric tests passed");
