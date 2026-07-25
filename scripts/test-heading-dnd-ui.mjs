import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

const require = createRequire(import.meta.url);
const tauriConfig = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
assert.equal(
  tauriConfig.app.windows[0].dragDropEnabled,
  false,
  "Windows HTML5 drag and drop requires Tauri native file drop to be disabled",
);
const reactUrl = pathToFileURL(require.resolve("react")).href;
let sidebarSource = await readFile(
  "src/components/layout/WorkspaceSidebar.tsx",
  "utf8",
);
sidebarSource = sidebarSource
  .replace('from "react"', `from "${reactUrl}"`)
  .replace(
    'import { fileProgressLabels, fileProgressStatuses } from "../../types";',
    'const fileProgressStatuses = ["todo", "writing", "revising", "done"];\nconst fileProgressLabels = { todo: "未着手", writing: "執筆中", revising: "推敲中", done: "完了" };',
  )
  .replace(
    /import \{\s*buildFilePreview,\s*buildHeadingPreview,\s*\} from "\.\.\/\.\.\/utils\/previewText";/,
    'const buildFilePreview = () => [];\nconst buildHeadingPreview = () => [];',
  )
  .replace(
    'import { logHeadingDnd } from "../../utils/headingDndDiagnostics";',
    "const logHeadingDnd = (...args) => globalThis.__headingLogs.push(args);",
  );
const sidebarCode = ts.transpileModule(
  `import React from "${reactUrl}";\n${sidebarSource}`,
  {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const sidebarUrl = `data:text/javascript;base64,${Buffer.from(sidebarCode).toString("base64")}`;

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://127.0.0.1/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.Event = dom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__headingLogs = [];
globalThis.__folderSelectCalls = 0;
globalThis.__fileSelectCalls = 0;
globalThis.__fileMoveLogs = [];

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { WorkspaceSidebar } = await import(sidebarUrl);

const pathA = "C:\\fixture\\a.md";
const pathB = "C:\\fixture\\b.md";
const pathC = "C:\\fixture\\c.md";
const destinationFolderPath = "C:\\fixture\\destination";
const outlineByOrder = {
  original: [
    { id: "a:1", blockId: "block-alpha", title: "Alpha", level: 1, line: 1, children: [] },
    { id: "a:3", blockId: "block-beta", title: "Beta", level: 1, line: 3, children: [] },
  ],
  moved: [
    { id: "a:1", blockId: "block-beta", title: "Beta", level: 1, line: 1, children: [] },
    { id: "a:3", blockId: "block-alpha", title: "Alpha", level: 1, line: 3, children: [] },
  ],
};
const projectFolder = {
  path: "C:\\fixture",
  name: "fixture",
  children: [
    { path: pathA, name: "a.md", kind: "file", children: [] },
    { path: pathB, name: "b.md", kind: "file", children: [] },
    { path: pathC, name: "c.md", kind: "file", children: [] },
    {
      path: destinationFolderPath,
      name: "destination",
      kind: "folder",
      children: [],
    },
  ],
};

function astFile(path, name, outline) {
  return {
    path,
    name,
    status: "indexed",
    documentAst: { outline },
    textLength: 40,
  };
}

function Harness() {
  const [moved, setMoved] = React.useState(false);
  const [collapsedFolders, setCollapsedFolders] = React.useState(new Set());
  const [collapsedOutlinePaths, setCollapsedOutlinePaths] = React.useState(new Set());
  const [collapsedOutlineHeadingKeys, setCollapsedOutlineHeadingKeys] = React.useState(new Set());
  const outline = moved ? outlineByOrder.moved : outlineByOrder.original;
  const projectAst = {
    kind: "project",
    rootPath: projectFolder.path,
    name: projectFolder.name,
    status: "ready",
    files: [
      astFile(pathA, "a.md", outline),
      astFile(pathB, "b.md", []),
      astFile(pathC, "c.md", []),
    ],
    indexedCount: 3,
    pendingCount: 0,
    errorCount: 0,
    totalTextLength: 40,
    totalLineCount: 4,
    totalOutlineCount: 2,
    updatedAt: Date.now(),
  };
  return React.createElement(WorkspaceSidebar, {
    projectFolder,
    currentFilePath: pathA,
    currentFileName: "a.md",
    currentFileCharCount: 40,
    focusedFolderPath: null,
    activeDocumentOutline: outline,
    activeOutlineIds: new Set(),
    projectAst,
    sidebarMode: "tree",
    navigatorPreviewLines: 2,
    countWhitespace: true,
    fileProgress: {},
    onSetFileProgress() {},
    collapsedFolderPaths: collapsedFolders,
    onFolderCollapsedChange(path, collapsed) {
      setCollapsedFolders((current) => {
        const next = new Set(current);
        if (collapsed) next.add(path);
        else next.delete(path);
        return next;
      });
    },
    collapsedOutlinePaths,
    onOutlineCollapsedChange(path, collapsed) {
      setCollapsedOutlinePaths((current) => {
        const next = new Set(current);
        if (collapsed) next.add(path);
        else next.delete(path);
        return next;
      });
    },
    collapsedOutlineHeadingKeys,
    onOutlineHeadingCollapsedChange(key, collapsed) {
      setCollapsedOutlineHeadingKeys((current) => {
        const next = new Set(current);
        if (collapsed) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    projectSearchQuery: "",
    projectSearchResults: [],
    searchScope: "project",
    projectReplaceValue: "",
    isProjectReplacing: false,
    isProjectSearchMode: false,
    onProjectSearchModeChange() {},
    onProjectSearchQueryChange() {},
    onSearchScopeChange() {},
    onProjectReplaceValueChange() {},
    onOpenProjectSearchResult() {},
    onReplaceInCurrentFile() {},
    onReplaceInProject() {},
    onJumpOutline() {},
    onJumpProjectOutline() {},
    onMoveHeadings(sources, targetPath, targetLine, targetBlockId, position) {
      globalThis.__headingLogs.push([
        "reorder-handler-reached",
        { sources, targetPath, targetLine, targetBlockId, position },
      ]);
      setMoved(true);
    },
    onExtractHeading(source) {
      globalThis.__headingLogs.push(["extract-heading", { source }]);
    },
    onOpenProjectFolder() {},
    onNewDocument() {},
    onCreateFile() {},
    onCreateFolder() {},
    onSelectFile() { globalThis.__fileSelectCalls += 1; },
    onSelectFolder() { globalThis.__folderSelectCalls += 1; },
    onOpenFileInNewTab() {},
    onRenameEntry() {},
    onDeleteEntry() {},
    onMoveEntry(sourcePaths, targetFolderPath) {
      globalThis.__fileMoveLogs.push([
        "move-files",
        { sourcePaths, targetFolderPath },
      ]);
    },
    onReorderEntry(folderPath, sourcePaths, targetPath, position) {
      globalThis.__fileMoveLogs.push([
        "reorder-files",
        { folderPath, sourcePaths, targetPath, position },
      ]);
    },
    snapshots: [],
    isSnapshotSectionCollapsed: true,
    onSnapshotSectionCollapsedChange() {},
    onCreateSnapshot() {},
    onRenameSnapshot() {},
    onEditSnapshotMemo() {},
    onRestoreSnapshot() {},
    onDeleteSnapshot() {},
    onCollapse() {},
  });
}

class DataTransferStub {
  #data = new Map();
  effectAllowed = "none";
  dropEffect = "none";
  get types() {
    return [...this.#data.keys()];
  }
  setData(type, value) {
    this.#data.set(type, value);
  }
  getData(type) {
    return this.#data.get(type) ?? "";
  }
}

function dragEvent(type, dataTransfer, clientY = 0) {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
  });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

let treePointerTarget = null;
document.elementFromPoint = () => treePointerTarget;
dom.window.HTMLElement.prototype.setPointerCapture = function setPointerCapture(pointerId) {
  this.__capturedPointerId = pointerId;
};
dom.window.HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(pointerId) {
  return this.__capturedPointerId === pointerId;
};
dom.window.HTMLElement.prototype.releasePointerCapture = function releasePointerCapture(pointerId) {
  if (this.__capturedPointerId === pointerId) this.__capturedPointerId = null;
};

function pointerEvent(type, pointerId, clientX, clientY, init = {}) {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
    ...init,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

async function ctrlClickFile(element, pointerId) {
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerdown", pointerId, 0, 0));
  });
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerup", pointerId, 0, 0));
  });
  await act(async () => {
    element.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
    );
  });
}

async function clickFile(element, pointerId) {
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerdown", pointerId, 0, 0));
  });
  assert.equal(
    element.hasPointerCapture(pointerId),
    true,
    "the actual file button must own pointer capture so click remains targeted",
  );
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerup", pointerId, 0, 0));
  });
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

async function clickFileDisclosure(element, fileButton, pointerId) {
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerdown", pointerId, 0, 0));
  });
  assert.equal(
    fileButton.hasPointerCapture(pointerId),
    false,
    "the outline disclosure must not start or capture a file drag",
  );
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerup", pointerId, 0, 0));
  });
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

const root = createRoot(document.getElementById("root"));
await act(async () => root.render(React.createElement(Harness)));
const rootFolderButton = document.querySelector('.folderTreeItem .treeItemPrimary[aria-expanded="true"]');
assert.ok(rootFolderButton, "expanded project folder must render");
await act(async () => rootFolderButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
assert.equal(rootFolderButton.getAttribute("aria-expanded"), "false");
assert.equal(document.querySelector('[data-outline-block-id="block-alpha"]'), null);
assert.equal(globalThis.__folderSelectCalls, 0, "folder click must not change the selected breadcrumb folder");
await act(async () => rootFolderButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
assert.equal(rootFolderButton.getAttribute("aria-expanded"), "true");

const fileButton = Array.from(document.querySelectorAll(".fileTreeItem .treeItemPrimary"))
  .find((button) => button.getAttribute("title") === pathA);
const fileDisclosure = fileButton?.querySelector("[data-tree-outline-disclosure]");
assert.ok(fileButton && fileDisclosure, "file with headings must render an outline disclosure");
await clickFileDisclosure(fileDisclosure, fileButton, 20);
assert.equal(fileButton.getAttribute("aria-expanded"), "false");
assert.equal(document.querySelector('[data-outline-block-id="block-alpha"]'), null);
assert.equal(globalThis.__fileSelectCalls, 0, "outline disclosure must not open the file");
await clickFileDisclosure(fileDisclosure, fileButton, 21);
assert.equal(fileButton.getAttribute("aria-expanded"), "true");

const source = document.querySelector('[data-outline-block-id="block-alpha"]');
const target = document.querySelector('[data-outline-block-id="block-beta"]');
assert.ok(source && target, "fixture outline rows must render");
target.getBoundingClientRect = () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON() {} });
const transfer = new DataTransferStub();

await act(async () => {
  source.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
  source.dispatchEvent(dragEvent("dragstart", transfer));
  target.dispatchEvent(dragEvent("dragover", transfer, 15));
});
assert.ok(
  target.classList.contains("headingDrop-after"),
  "dragover must expose a visible insertion-guide class",
);
await act(async () => {
  target.dispatchEvent(dragEvent("drop", transfer, 15));
  source.dispatchEvent(dragEvent("dragend", transfer));
});

const domOrder = Array.from(
  document.querySelectorAll("[data-outline-file-path][data-outline-block-id]"),
)
  .filter((row) => row.getAttribute("data-outline-file-path") === pathA)
  .map((row) => row.getAttribute("data-outline-block-id"));
globalThis.__headingLogs.push(["state-dom-updated", { domOrder }]);
const stages = globalThis.__headingLogs.map(([stage]) => stage);
for (const required of [
  "pointerdown",
  "block-id-acquired",
  "dragstart",
  "dragover",
  "drop",
  "reorder-handler-reached",
  "state-dom-updated",
]) {
  assert.ok(stages.includes(required), `missing ${required}: ${stages.join(", ")}`);
}
assert.deepEqual(domOrder, ["block-beta", "block-alpha"]);

const selectedBeta = document.querySelector('[data-outline-block-id="block-beta"]');
const selectedAlpha = document.querySelector('[data-outline-block-id="block-alpha"]');
assert.ok(selectedBeta && selectedAlpha, "moved outline rows must remain selectable");
await act(async () => {
  selectedBeta.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
  selectedAlpha.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
});
assert.equal(
  document.querySelectorAll(".selectedOutlineTreeItem").length,
  2,
  "Ctrl+click must select multiple headings",
);
await act(async () => {
  selectedBeta.dispatchEvent(
    new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 18,
    }),
  );
});
const extractButton = Array.from(document.querySelectorAll(".headingContextMenu button"))
  .find((button) => button.textContent.includes("別ファイルへ切り出す"));
assert.ok(extractButton?.disabled, "extract must be disabled while multiple headings are selected");

const targetFileRow = Array.from(document.querySelectorAll(".fileTreeItem"))
  .find((row) => row.getAttribute("data-outline-file-path") === pathB);
assert.ok(targetFileRow, "cross-file drop target must render");
const multiTransfer = new DataTransferStub();
await act(async () => {
  selectedBeta.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
  selectedBeta.dispatchEvent(dragEvent("dragstart", multiTransfer));
  targetFileRow.dispatchEvent(dragEvent("dragover", multiTransfer));
  targetFileRow.dispatchEvent(dragEvent("drop", multiTransfer));
  selectedBeta.dispatchEvent(dragEvent("dragend", multiTransfer));
});
const moveLogs = globalThis.__headingLogs.filter(([stage]) => stage === "reorder-handler-reached");
assert.equal(
  moveLogs.at(-1)[1].sources.length,
  2,
  "dragging a selected heading must move the complete Ctrl+click selection",
);
const singleHeading = document.querySelector('[data-outline-block-id="block-beta"]');
await act(async () => {
  singleHeading.dispatchEvent(
    new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 18,
    }),
  );
});
const singleExtractButton = Array.from(document.querySelectorAll(".headingContextMenu button"))
  .find((button) => button.textContent.includes("別ファイルへ切り出す"));
assert.ok(singleExtractButton && !singleExtractButton.disabled, "one heading can be extracted");
await act(async () => singleExtractButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
assert.ok(
  globalThis.__headingLogs.some(([stage]) => stage === "extract-heading"),
  "extract menu must invoke its heading callback",
);

await act(async () =>
  root.render(React.createElement(Harness, { key: "restored-file-selection" })),
);
const fileButtonA = Array.from(document.querySelectorAll(".fileTreeItem .treeItemPrimary"))
  .find((button) => button.getAttribute("title") === pathA);
const fileButtonB = Array.from(document.querySelectorAll(".fileTreeItem .treeItemPrimary"))
  .find((button) => button.getAttribute("title") === pathB);
const fileRowA = fileButtonA?.closest(".fileTreeItem");
const fileRowC = Array.from(document.querySelectorAll(".fileTreeItem"))
  .find((row) => row.getAttribute("data-tree-entry-path") === pathC);
const destinationFolderRow = Array.from(document.querySelectorAll(".folderTreeItem"))
  .find((row) => row.getAttribute("data-tree-entry-path") === destinationFolderPath);
assert.ok(
  fileButtonA && fileButtonB && fileRowA && fileRowC && destinationFolderRow,
  "multiple file drag fixtures must render",
);

assert.equal(
  document.querySelectorAll(".selectedTreeEntry").length,
  1,
  "the restored active file must initialize the real file selection",
);
assert.equal(
  fileButtonA.getAttribute("aria-pressed"),
  "true",
  "the restored active file must be part of drag source selection",
);
assert.equal(globalThis.__fileSelectCalls, 0);
await ctrlClickFile(fileButtonB, 11);
assert.equal(
  document.querySelectorAll(".selectedTreeEntry").length,
  2,
  "Ctrl+click must add to the restored active-file selection without opening it",
);
assert.equal(globalThis.__fileSelectCalls, 0);

fileRowC.getBoundingClientRect = () => ({
  top: 0,
  height: 20,
  bottom: 20,
  left: 0,
  right: 200,
  width: 200,
  x: 0,
  y: 0,
  toJSON() {},
});
treePointerTarget = fileRowC;
await act(async () => {
  fileButtonA.dispatchEvent(pointerEvent("pointerdown", 1, 0, 0));
  assert.equal(
    fileButtonA.hasPointerCapture(1),
    true,
    "a modifier-free drag must keep pointer capture on the file button",
  );
  fileButtonA.dispatchEvent(pointerEvent("pointermove", 1, 0, 18));
  fileButtonA.dispatchEvent(pointerEvent("pointerup", 1, 0, 18));
});
assert.deepEqual(
  globalThis.__fileMoveLogs.at(-1),
  [
    "reorder-files",
    {
      folderPath: projectFolder.path,
      sourcePaths: [pathA, pathB],
      targetPath: pathC,
      position: "after",
    },
  ],
  "dragging a selected file block must reorder every selected file",
);

await clickFile(fileButtonA, 12);
assert.equal(
  document.querySelectorAll(".selectedTreeEntry").length,
  1,
  "an ordinary click must replace the file selection",
);
assert.equal(globalThis.__fileSelectCalls, 1, "an ordinary click must open the file");
await ctrlClickFile(fileButtonB, 13);
assert.equal(
  document.querySelectorAll(".selectedTreeEntry").length,
  2,
  "ordinary click followed by Ctrl+click must rebuild a two-file selection",
);
destinationFolderRow.getBoundingClientRect = () => ({
  top: 0,
  height: 20,
  bottom: 20,
  left: 0,
  right: 200,
  width: 200,
  x: 0,
  y: 0,
  toJSON() {},
});
treePointerTarget = destinationFolderRow;
await act(async () => {
  fileButtonA.dispatchEvent(pointerEvent("pointerdown", 2, 0, 0));
  assert.equal(
    fileButtonA.hasPointerCapture(2),
    true,
    "folder moves must not require Shift or another modifier",
  );
  fileButtonA.dispatchEvent(pointerEvent("pointermove", 2, 0, 10));
  fileButtonA.dispatchEvent(pointerEvent("pointerup", 2, 0, 10));
});
assert.deepEqual(
  globalThis.__fileMoveLogs.at(-1),
  [
    "move-files",
    {
      sourcePaths: [pathA, pathB],
      targetFolderPath: destinationFolderPath,
    },
  ],
  "dropping a selected file block into a folder must move every selected file",
);

await clickFile(fileButtonA, 14);
treePointerTarget = fileRowC;
await act(async () => {
  fileButtonB.dispatchEvent(
    pointerEvent("pointerdown", 3, 0, 0, { ctrlKey: true }),
  );
  fileButtonB.dispatchEvent(
    pointerEvent("pointermove", 3, 0, 18, { ctrlKey: true }),
  );
  fileButtonB.dispatchEvent(
    pointerEvent("pointerup", 3, 0, 18, { ctrlKey: true }),
  );
});
assert.deepEqual(
  globalThis.__fileMoveLogs.at(-1),
  [
    "reorder-files",
    {
      folderPath: projectFolder.path,
      sourcePaths: [pathA, pathB],
      targetPath: pathC,
      position: "after",
    },
  ],
  "Ctrl+pointerdown followed immediately by drag must use the additive selection",
);
console.log(JSON.stringify({ stages, domOrder, logs: globalThis.__headingLogs }, null, 2));
await act(async () => root.unmount());
dom.window.close();
