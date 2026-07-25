import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/editor/documentTabState.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const { reconcileSavedDocumentTabs } = await import(moduleUrl);

const sourceTab = {
  id: "file:C:\\fixture\\source.md",
  kind: "file",
  path: "C:\\fixture\\source.md",
  name: "source.md",
  markdown: "# Source\nold body\n",
  savedMarkdown: "# Source\nold body\n",
  editorRevision: 7,
  saveStatus: "saved",
  documentKey: "C:\\fixture\\source.md",
  activeOutlineLine: 1,
  viewportState: null,
};
const otherTab = {
  ...sourceTab,
  id: "file:C:\\fixture\\other.md",
  path: "C:\\fixture\\other.md",
  name: "other.md",
  documentKey: "C:\\fixture\\other.md",
};
const savedSource = {
  path: sourceTab.path,
  name: sourceTab.name,
  content: "# Source\n",
};
const extractionViewport = {
  textLength: savedSource.content.length,
  writingMode: "vertical-rl",
  anchorOffset: savedSource.content.length,
  anchorRatio: 0.46,
};

const activeResult = reconcileSavedDocumentTabs(
  [sourceTab, otherTab],
  sourceTab.id,
  savedSource,
  { viewportState: extractionViewport },
);
assert.equal(
  activeResult.activeSavedMarkdown,
  savedSource.content,
  "the saved-value reference must be synchronized before autosave effects run",
);
assert.deepEqual(
  activeResult.tabs[0],
  {
    ...sourceTab,
    markdown: savedSource.content,
    savedMarkdown: savedSource.content,
    editorRevision: null,
    saveStatus: "saved",
    viewportState: extractionViewport,
  },
);
assert.equal(activeResult.tabs[1], otherTab, "unaffected tabs must retain their identity");

const backgroundResult = reconcileSavedDocumentTabs(
  [sourceTab, otherTab],
  otherTab.id,
  savedSource,
);
assert.equal(
  backgroundResult.activeSavedMarkdown,
  null,
  "saving a background source must not replace the active editor's saved-value reference",
);

console.log("heading extraction saved-state tests passed");
