import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/utils/library.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
const { copyWorkspaceLocalState } = await import(moduleUrl);

const from = "D:\\執筆\\夏の終わり";
const to = "C:\\Lib\\夏の終わり";
const file = `${from}\\01.txt`;
const otherFile = "D:\\執筆\\別作品\\a.txt";
const tree = {
  path: from,
  name: "夏の終わり",
  children: [{ path: file, name: "01.txt", kind: "file", children: [] }],
};

const state = {
  collapsedFolderPathsByWorkspace: { [from]: [`${from}\\章`] },
  collapsedOutlinePathsByWorkspace: { [from]: [file] },
  collapsedOutlineHeadingKeysByWorkspace: { [from]: ["h1"] },
  fileProgress: { [file]: "writing", [otherFile]: "done" },
  fileProgressMigrationVersions: { "d:\\執筆\\夏の終わり": 1 },
  checkpointMigrationVersions: {},
  cursorPositions: { [file]: { from: 3, to: 3 } },
  documentTabsByWorkspace: {
    "d:\\執筆\\夏の終わり": {
      tabs: [{ path: file, name: "01.txt", fileId: null, contentHash: null, activeOutlineLine: null, viewportState: null }],
      activeIndex: 0,
      updatedAt: 1,
    },
  },
  snapshots: [{
    id: "s1",
    workspacePath: from,
    workspaceName: "夏の終わり",
    projectTree: tree,
    files: [{ path: file, name: "01.txt", text: "本文" }],
  }],
};

const next = copyWorkspaceLocalState(state, from, to, "夏の終わり");
const copiedFile = `${to}\\01.txt`;

assert.deepEqual(next.collapsedFolderPathsByWorkspace[to], [`${to}\\章`]);
assert.deepEqual(next.collapsedOutlinePathsByWorkspace[to], [copiedFile]);
assert.deepEqual(next.collapsedOutlineHeadingKeysByWorkspace[to], ["h1"]);
assert.equal(next.fileProgress[copiedFile], "writing");
assert.equal(next.fileProgress[file], "writing", "the source keeps its own entries");
assert.equal(Object.keys(next.fileProgress).length, 3, "unrelated projects are not copied");
assert.equal(next.fileProgressMigrationVersions["c:\\lib\\夏の終わり"], 1);
assert.deepEqual(next.cursorPositions[copiedFile], { from: 3, to: 3 });
assert.equal(next.documentTabsByWorkspace["c:\\lib\\夏の終わり"].tabs[0].path, copiedFile);
assert.equal(next.snapshots.length, 2);
const copiedSnapshot = next.snapshots[1];
assert.equal(copiedSnapshot.workspacePath, to);
assert.equal(copiedSnapshot.projectTree.path, to);
assert.equal(copiedSnapshot.projectTree.children[0].path, copiedFile);
assert.equal(copiedSnapshot.files[0].path, copiedFile);
assert.equal(state.snapshots.length, 1, "input state is not mutated");

console.log("library local state tests passed");
