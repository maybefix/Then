import assert from "node:assert/strict";
import { build } from "esbuild";

// 文書タブモデルの実行時の依存先も含めて読み込む。検証する入出力は変えない。
const bundled = await build({
  entryPoints: ["src/editor/documentTabState.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
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
