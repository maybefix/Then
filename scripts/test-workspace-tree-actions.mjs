// ファイルツリーの開閉の記録（createWorkspaceTreeActions）を実際に動かして、
// 今の作品の一覧だけに足し・外し、ほかの作品やほかの種類の一覧に触らないことを確かめる。
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `workspace-tree-actions-${process.pid}.mjs`);
const bundled = await build({
  entryPoints: ["src/workspaceTreeActions.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
const { createWorkspaceTreeActions } = await import(pathToFileURL(compiledPath).href)
  .finally(() => unlink(compiledPath));

// App の appState の代わり。setAppState は関数型の更新だけを受ける（App と同じ使い方）。
let appState;
let writes = 0;
const setAppState = (update) => {
  writes += 1;
  appState = typeof update === "function" ? update(appState) : update;
};
const reset = () => {
  appState = {
    markdown: "本文",
    collapsedFolderPathsByWorkspace: { "C:/other": ["C:/other/x"] },
    collapsedOutlinePathsByWorkspace: { "C:/other": ["C:/other/y.md"] },
    collapsedOutlineHeadingKeysByWorkspace: { "C:/other": ["C:/other/y.md#1"] },
  };
  writes = 0;
};
// App の描画と同じく、操作のたびにその時点の値で作り直す。
const actions = (projectFolder = { path: "C:/work", name: "work", children: [] }) =>
  createWorkspaceTreeActions({ projectFolder, setAppState });

const kinds = [
  ["handleFolderCollapsedChange", "collapsedFolderPathsByWorkspace", "C:/work/第一部", "C:/work/第二部"],
  ["handleOutlineCollapsedChange", "collapsedOutlinePathsByWorkspace", "C:/work/a.md", "C:/work/b.md"],
  ["handleOutlineHeadingCollapsedChange", "collapsedOutlineHeadingKeysByWorkspace", "C:/work/a.md#3", "C:/work/a.md#9"],
];

for (const [action, field, first, second] of kinds) {
  reset();
  const before = structuredClone(appState);

  actions()[action](first, true);
  assert.deepEqual(appState[field]["C:/work"], [first], `${action} adds to the open work`);
  actions()[action](second, true);
  actions()[action](first, true);
  assert.deepEqual(appState[field]["C:/work"], [first, second], `${action} keeps one entry per key, in order`);
  actions()[action](first, false);
  assert.deepEqual(appState[field]["C:/work"], [second], `${action} removes from the open work`);
  actions()[action]("C:/work/none", false);
  assert.deepEqual(appState[field]["C:/work"], [second], `${action} ignores removing an absent key`);

  assert.deepEqual(appState[field]["C:/other"], before[field]["C:/other"], `${action} leaves other works alone`);
  for (const [, otherField] of kinds.filter(([, candidate]) => candidate !== field)) {
    assert.deepEqual(appState[otherField], before[otherField], `${action} leaves ${otherField} alone`);
  }
  assert.equal(appState.markdown, "本文");
  assert.equal(writes, 5);

  reset();
  actions(null)[action](first, true);
  assert.equal(writes, 0, `${action} does nothing without an open work`);
}

console.log("workspace tree action tests passed");
