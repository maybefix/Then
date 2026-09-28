import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { CheckpointStudio } = await server.ssrLoadModule("/src/components/checkpoints/CheckpointStudio.tsx");
  const path = (name) => `C:\\book\\parent\\child\\${name}`;
  const files = ["01.md", "02.md"].map((name) => ({ path: path(name), name, text: name, textHash: "", semanticHash: "", lineCount: 1, textLength: 5, visibleTextLength: 5, outlineCount: 0 }));
  const projectTree = {
    path: "C:\\book", name: "book", children: [{
      path: "C:\\book\\parent", name: "parent", kind: "folder", children: [{
        path: "C:\\book\\parent\\child", name: "child", kind: "folder", children: files.map((file) => ({ path: file.path, name: file.name, kind: "file", children: [] })),
      }],
    }],
  };
  const snapshot = { id: "snapshot", revision: 1, storageHash: "", workspacePath: projectTree.path, workspaceName: "book", createdAt: Date.now(), reason: "manual", label: "saved", memo: "", parentIds: [], projectTree, files, fileCount: files.length, totalTextLength: 10, totalVisibleTextLength: 10 };
  const container = document.querySelector("#root");
  const root = createRoot(container);
  const props = {
    projectFolder: projectTree, snapshots: [snapshot], currentFilePath: null,
    currentProjectFiles: new Map(), currentProjectStatus: "ready", unavailableCurrentProjectPaths: new Set(), conflictsBySnapshot: new Map(),
    onClose() {}, onCreate() {}, onDelete() {}, onRestore() {}, onRestoreFiles() {},
  };
  const click = async (element) => { await act(async () => { element.click(); }); };
  await act(async () => { root.render(React.createElement(CheckpointStudio, props)); });
  await click([...container.querySelectorAll(".checkpointScope button")].find((button) => button.textContent === "選択"));
  const fileInputs = [...container.querySelectorAll(".checkpointRestoreList:not(.checkpointFolderList) input[type=checkbox]")];
  const folderInputs = [...container.querySelectorAll(".checkpointFolderList input[type=checkbox]")];
  assert.equal(fileInputs.length, 2);
  assert.equal(folderInputs.length, 2);
  await click(folderInputs[0]);
  assert.deepEqual(fileInputs.map((input) => input.checked), [true, true]);
  assert.deepEqual(folderInputs.map((input) => input.checked), [true, true]);
  await click(fileInputs[0]);
  assert.deepEqual(fileInputs.map((input) => input.checked), [false, true]);
  assert.equal(folderInputs[0].indeterminate, true, "a partially selected parent must be visibly partial");
  assert.equal(folderInputs[1].indeterminate, true);
  await click(folderInputs[0]);
  assert.deepEqual(fileInputs.map((input) => input.checked), [true, true], "clicking a partial folder selects all descendants");
  await click(folderInputs[0]);
  assert.deepEqual(fileInputs.map((input) => input.checked), [false, false]);
  assert.deepEqual(folderInputs.map((input) => input.checked), [false, false], "deselecting a parent clears child folders");

  await act(async () => { root.render(React.createElement(CheckpointStudio, {
    ...props,
    currentProjectStatus: "error",
    unavailableCurrentProjectPaths: new Set([files[0].path.toLocaleLowerCase()]),
  })); });
  assert.match(container.textContent, /読み込めませんでした/);
  assert.match(container.textContent, /未確認/);
  await act(async () => { root.unmount(); });
  console.log("checkpoint selection and partial-load UI tests passed");
} finally {
  await server.close();
  dom.window.close();
}
