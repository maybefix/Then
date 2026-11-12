// 左のツリー（WorkspaceSidebar）の、素材フォルダのない作品での見え方と操作の結果を固定する（BINDER 1-4 の前後比較用）。
// 見本データ scripts/fixtures/materials-baseline の一覧（expected/listing.json。test:materials-baseline-rust が Rust の
// list_project_folder の答えと同じことを確かめている）を本物の WorkspaceSidebar に通し、次を expected/sidebar-tree.json と比べる。
//   - 行の並び・深さ・名前・字数・進捗の印・選択／今のファイルの印（絞り込みの各状態で）
//   - 見出し（アウトライン）の行、ヘッダー、下の合計と凡例、ライブラリへ戻るボタン、ライブラリ直下の作品一覧
//   - クリック（開く・Ctrl で複数選択・フォルダの開閉・見出しの開閉）、右クリックのメニュー、ドラッグ（並べ替え・
//     フォルダへの移動・別のフォルダの前後へ）で呼ばれる関数と引数、折りたたみを渡したときの見え方
//   - スタートページの「最近編集した文書」
// 作品A は素材なし、作品B は「素材」という名前のフォルダを原稿として使う（materialsFolder 未設定）、作品C は1ファイル。
//
//   node scripts/test-binder-tree-baseline.mjs [--update]
//
// --update は期待値を書き直す。見本データや確かめる項目を足したときだけ使い、書き直した差分はコミットの前に人が読む。
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const update = process.argv.includes("--update");
const fixture = path.join("scripts", "fixtures", "materials-baseline");
const expectedDir = path.join(fixture, "expected");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `binder-tree-baseline-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: [
      'export { collectProjectTextFiles, createProjectAstSkeleton, upsertProjectAstDocumentAsts } from "./src/editor/ast/projectAst";',
      'export { createDocumentAst } from "./src/editor/ast/documentAst";',
      'export { parseFrontMatter } from "./src/utils/frontmatter";',
      'export { WorkspaceSidebar } from "./src/components/layout/WorkspaceSidebar";',
      'export { ScopeStartPage } from "./src/components/layout/ScopeStartPage";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react/jsx-runtime", "@tauri-apps/api", "@tauri-apps/api/*"],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
const {
  ScopeStartPage,
  WorkspaceSidebar,
  collectProjectTextFiles,
  createDocumentAst,
  createProjectAstSkeleton,
  parseFrontMatter,
  upsertProjectAstDocumentAsts,
} = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));

// ---- 見本データを、画面が受け取る形にする ----
const listing = readJson(path.join(expectedDir, "listing.json"));
const SEP = path.win32.sep;
const VIRTUAL_ROOT = ["C:", "materials-baseline"].join(SEP);
const workRoot = (work) => [VIRTUAL_ROOT, work].join(SEP);
const toAbsolute = (work, relative) => [workRoot(work), ...relative.split("/")].join(SEP);
const rel = (work, absolute) =>
  absolute === workRoot(work) ? "." : absolute.slice(workRoot(work).length + 1).split(SEP).join("/");

// 最終更新は、並びが決まるように一覧の順で振る（後ろほど新しい）。
let modifiedClock = 0;
function toEntry(work, entry) {
  const base = { path: toAbsolute(work, entry.path), name: entry.name, kind: entry.kind };
  if (entry.role) base.role = entry.role;
  if (entry.kind === "folder") return { ...base, children: entry.children.map((child) => toEntry(work, child)) };
  modifiedClock += 1000;
  return {
    ...base,
    children: [],
    fileId: entry.hasFileId ? `id:${entry.path}` : null,
    contentHash: entry.hasContentHash ? `hash:${entry.path}` : null,
    ...(entry.hasModifiedAt ? { modifiedAt: modifiedClock } : {}),
  };
}

function loadWork(work) {
  const value = listing.works[work];
  const folder = { path: workRoot(work), name: value.name, children: value.children.map((entry) => toEntry(work, entry)) };
  const documents = collectProjectTextFiles(folder).map((file) => {
    const text = readFileSync(path.join(fixture, "library", work, ...rel(work, file.path).split("/")), "utf8");
    return createDocumentAst({ path: file.path, name: file.name, text: parseFrontMatter(text).body });
  });
  const ast = upsertProjectAstDocumentAsts(createProjectAstSkeleton(folder, null), documents);
  const configPath = path.join(fixture, "library", work, ".then", "project.json");
  // アプリ状態の fileProgress は絶対パスで持つ。
  const fileProgress = existsSync(configPath)
    ? Object.fromEntries(
        Object.entries(readJson(configPath).fileProgress ?? {}).map(([key, item]) => [toAbsolute(work, key), item.status]),
      )
    : {};
  const files = collectProjectTextFiles(folder).map((file) => file.path);
  return { work, folder, ast, fileProgress, files };
}

const works = Object.fromEntries(Object.keys(listing.works).map((work) => [work, loadWork(work)]));

// ---- 画面 ----
const dom = new JSDOM("<!doctype html><html><body><div class='appShell'></div></body></html>", { url: "http://127.0.0.1/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
for (const name of ["HTMLElement", "Element", "Node", "MouseEvent", "Event", "KeyboardEvent", "getComputedStyle"]) {
  globalThis[name] = name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
}
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

let pointerTarget = null;
document.elementFromPoint = () => pointerTarget;
dom.window.HTMLElement.prototype.setPointerCapture = function setPointerCapture(pointerId) {
  this.__capturedPointerId = pointerId;
};
dom.window.HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(pointerId) {
  return this.__capturedPointerId === pointerId;
};
dom.window.HTMLElement.prototype.releasePointerCapture = function releasePointerCapture(pointerId) {
  if (this.__capturedPointerId === pointerId) this.__capturedPointerId = null;
};
const rowRect = () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON() {} });

function pointerEvent(type, pointerId, clientY, init = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY, ...init });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

// 呼ばれた関数を、作品からの相対パスにして記録する。
function recorder(work) {
  const calls = [];
  const map = (value) =>
    typeof value === "string" && value.startsWith(workRoot(work))
      ? rel(work, value)
      : Array.isArray(value)
        ? value.map(map)
        : value && typeof value === "object" && typeof value.path === "string"
          ? { path: map(value.path), name: value.name, kind: value.kind ?? "root" }
          : value;
  const fn = (name) => (...args) => calls.push([name, ...args.map(map)]);
  return { calls, fn };
}

function sidebarProps(state, record, overrides = {}) {
  const { folder, ast, fileProgress, files } = state;
  const noop = () => {};
  const firstFile = files[0] ?? null;
  return {
    projectFolder: folder,
    currentFilePath: firstFile,
    currentFileName: firstFile ? firstFile.split(SEP).pop() : "無題",
    currentFileCharCount: 0,
    focusedFolderPath: null,
    activeDocumentOutline: [],
    activeOutlineIds: new Set(),
    activeOutlineBlockId: null,
    projectAst: ast,
    countWhitespace: false,
    countCode: true,
    showOutlineGuides: true,
    fileProgress,
    onSetFileProgress: record.fn("onSetFileProgress"),
    collapsedFolderPaths: new Set(),
    onFolderCollapsedChange: record.fn("onFolderCollapsedChange"),
    collapsedOutlinePaths: new Set(),
    onOutlineCollapsedChange: record.fn("onOutlineCollapsedChange"),
    collapsedOutlineHeadingKeys: new Set(),
    onOutlineHeadingCollapsedChange: record.fn("onOutlineHeadingCollapsedChange"),
    projectSearchQuery: "",
    projectSearchResults: [],
    projectSearchTotal: 0,
    projectSearchMatchedFileCount: 0,
    projectSearchTruncated: false,
    projectSearchError: null,
    projectSearchUseRegex: false,
    projectSearchMatchCase: false,
    projectSearchIncludeComments: false,
    searchScope: "project",
    projectReplaceValue: "",
    isProjectReplacing: false,
    isProjectSearchMode: false,
    onProjectSearchQueryChange: noop,
    onProjectSearchUseRegexChange: noop,
    onProjectSearchMatchCaseChange: noop,
    onProjectSearchIncludeCommentsChange: noop,
    onSearchScopeChange: noop,
    onProjectReplaceValueChange: noop,
    onOpenProjectSearchResult: noop,
    onReplaceInCurrentFile: noop,
    onReplaceInProject: noop,
    onJumpOutline: record.fn("onJumpOutline"),
    onJumpProjectOutline: (filePath, item) => record.fn("onJumpProjectOutline")(filePath, item.title),
    onMoveHeadings: record.fn("onMoveHeadings"),
    onExtractHeading: record.fn("onExtractHeading"),
    onOpenProjectFolder: record.fn("onOpenProjectFolder"),
    onCreateFile: record.fn("onCreateFile"),
    onCreateFolder: record.fn("onCreateFolder"),
    onSelectFile: record.fn("onSelectFile"),
    onSelectFolder: record.fn("onSelectFolder"),
    onRenameEntry: record.fn("onRenameEntry"),
    onDeleteEntry: record.fn("onDeleteEntry"),
    onMoveEntry: record.fn("onMoveEntry"),
    onReorderEntry: record.fn("onReorderEntry"),
    snapshots: [],
    isSnapshotSectionCollapsed: true,
    onSnapshotSectionCollapsedChange: noop,
    showSnapshotSection: true,
    onCreateSnapshot: noop,
    onOpenSnapshot: noop,
    onEditSnapshotDetails: noop,
    onRestoreSnapshot: noop,
    onDeleteSnapshot: noop,
    onCollapse: noop,
    library: null,
    onEnterLibraryRoot: record.fn("onEnterLibraryRoot"),
    onEnterProject: record.fn("onEnterProject"),
    onCreateLibraryProject: noop,
    onImportProject: noop,
    onReorderLibraryProjects: noop,
    isLibrarySearchLoading: false,
    ...overrides,
  };
}

async function mount(element) {
  const container = document.createElement("div");
  document.querySelector(".appShell").append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    rerender: (next) => act(async () => root.render(next)),
    unmount: () => act(async () => root.unmount()).then(() => container.remove()),
  };
}

const text = (element) => element?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const ROW_FLAGS = ["activeTreeItem", "selectedTreeEntry", "focusedTreeItem", "draggableTreeItem"];

// ツリーの見え方を、比べやすい形に写す。
function snapshotTree(work, container) {
  const rows = [];
  for (const element of container.querySelectorAll("[data-tree-entry-path], .outlineTreeItem")) {
    if (element.matches(".outlineTreeItem")) {
      rows.push({
        heading: text(element.querySelector(".outlineItemTitle")),
        file: element.dataset.outlineFilePath ? rel(work, element.dataset.outlineFilePath) : null,
        indent: element.style.getPropertyValue("--outline-item-indent"),
        chars: text(element.querySelector(".treeItemCharCount")),
        classes: [...element.classList].filter((name) => name !== "outlineTreeItem").sort(),
      });
      continue;
    }
    const kind = element.dataset.treeEntryKind;
    const nameElement = element.querySelector(".treeItemName");
    rows.push({
      path: rel(work, element.dataset.treeEntryPath),
      kind,
      parent: element.dataset.treeFolderPath ? rel(work, element.dataset.treeFolderPath) : null,
      indent: element.style.getPropertyValue("--tree-item-indent"),
      name: text(nameElement),
      nameClass: [...(nameElement?.classList ?? [])].filter((name) => name !== "treeItemName").sort(),
      chars: text(element.querySelector(".treeItemCharCount")),
      progress: text(element.querySelector(".fileProgressMarker")),
      folderDot: element.querySelector(".folderProgressDot")?.className.replace("folderProgressDot", "").trim() ?? null,
      expanded: element.querySelector("[aria-expanded]")?.getAttribute("aria-expanded") ?? null,
      flags: ROW_FLAGS.filter((flag) => element.classList.contains(flag)),
    });
  }
  return {
    header: text(container.querySelector(".sidebarHeader")),
    libraryBack: text(container.querySelector(".libraryBackButton")),
    empty: text(container.querySelector(".outlineEmptyState")),
    rows,
    snapshotDock: Boolean(container.querySelector(".snapshotDock")),
    footer: text(container.querySelector(".fileViewSummary")),
    libraryProjects: text(container.querySelector(".libraryProjects")),
  };
}

const findRow = (work, container, relative) =>
  [...container.querySelectorAll("[data-tree-entry-path]")].find(
    (element) => rel(work, element.dataset.treeEntryPath) === relative,
  );

async function click(element, init = {}) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
}

async function drag(sourceRow, targetRow, pointerId, clientY, init = {}) {
  const sourceButton = sourceRow.querySelector(".treeItemPrimary");
  targetRow.getBoundingClientRect = rowRect;
  pointerTarget = targetRow;
  await act(async () => {
    sourceButton.dispatchEvent(pointerEvent("pointerdown", pointerId, 0, init));
    sourceButton.dispatchEvent(pointerEvent("pointermove", pointerId, clientY));
    sourceButton.dispatchEvent(pointerEvent("pointerup", pointerId, clientY));
  });
  pointerTarget = null;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function contextMenuItems(row) {
  await act(async () => {
    row.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  });
  const menu = document.querySelector(".treeContextMenu");
  const items = [...(menu?.querySelectorAll("[role=menuitem]") ?? [])].map((item) => text(item));
  await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })));
  return items;
}

const FILTERS = ["all", "todo", "writing", "revising", "done", "archived"];
const derived = {};

for (const [work, state] of Object.entries(works)) {
  const result = { files: state.files.map((file) => rel(work, file)), filters: {}, interactions: {} };

  // 絞り込みごとの見え方。ライブラリの作品として開いている（戻るボタンが出る）。
  const library = { path: VIRTUAL_ROOT, name: "見本ライブラリ", role: "project", projects: [], misplacedProjects: [] };
  for (const filter of FILTERS) {
    if (filter === "all") localStorage.removeItem("then.sidebar.progressFilter");
    else localStorage.setItem("then.sidebar.progressFilter", filter);
    const record = recorder(work);
    const view = await mount(React.createElement(WorkspaceSidebar, sidebarProps(state, record, { library })));
    result.filters[filter] = snapshotTree(work, view.container);
    await view.unmount();
  }
  localStorage.removeItem("then.sidebar.progressFilter");

  // 操作。
  {
    const record = recorder(work);
    const props = sidebarProps(state, record);
    const view = await mount(React.createElement(WorkspaceSidebar, props));
    const { container } = view;
    const fileRows = state.files.map((file) => findRow(work, container, rel(work, file)));
    const folderRows = [...container.querySelectorAll("[data-tree-entry-kind=folder]")];
    const steps = [];
    const step = async (label, action) => {
      record.calls.length = 0;
      await action();
      steps.push({
        label,
        calls: record.calls.map((call) => [...call]),
        selected: [...container.querySelectorAll(".selectedTreeEntry")].map((row) => rel(work, row.dataset.treeEntryPath)),
      });
    };

    if (fileRows[1]) {
      await step("2つ目のファイルをクリック", () => click(fileRows[1].querySelector(".fileTreeItemPrimary")));
      await step("1つ目を Ctrl+クリック", () => click(fileRows[0].querySelector(".fileTreeItemPrimary"), { ctrlKey: true }));
      await step("1つ目をもう一度 Ctrl+クリック（外す）", () =>
        click(fileRows[0].querySelector(".fileTreeItemPrimary"), { ctrlKey: true }),
      );
    }
    for (const folderRow of folderRows) {
      await step(`フォルダ ${rel(work, folderRow.dataset.treeEntryPath)} をクリック`, () =>
        click(folderRow.querySelector(".folderTreeItemPrimary")),
      );
    }
    const disclosure = container.querySelector(".treeFileDisclosure");
    if (disclosure) await step("見出しの開閉ボタン", () => click(disclosure));
    const headingDisclosure = container.querySelector(".outlineHeadingDisclosure");
    if (headingDisclosure) await step("子見出しの開閉ボタン", () => click(headingDisclosure));
    const heading = container.querySelector(".outlineTreeItem");
    if (heading) await step("見出しをクリック", () => click(heading));

    // 右クリックのメニュー。
    const menus = {};
    for (const row of [...container.querySelectorAll("[data-tree-entry-path]")]) {
      menus[rel(work, row.dataset.treeEntryPath)] = await contextMenuItems(row);
    }
    if (fileRows[0]) {
      await step("メニューの「削除」", async () => {
        await act(async () => {
          fileRows[0].dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        });
        const remove = [...document.querySelectorAll(".treeContextMenu [role=menuitem]")].find((item) => text(item) === "削除");
        await click(remove);
      });
      const menuFolder = folderRows[0];
      if (menuFolder) {
        await step("フォルダのメニューの「ファイルを追加」", async () => {
          await act(async () => {
            menuFolder.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
          });
          const add = [...document.querySelectorAll(".treeContextMenu [role=menuitem]")].find((item) => text(item) === "ファイルを追加");
          await click(add);
        });
      }
    }

    // ドラッグ。同じフォルダの中の並べ替え、フォルダの中へ、別のフォルダの前後へ。
    const rowsNow = () => state.files.map((file) => findRow(work, container, rel(work, file)));
    const sameParent = (a, b) => a?.dataset.treeFolderPath === b?.dataset.treeFolderPath;
    let pointerId = 1;
    for (let i = 0; i < state.files.length; i += 1) {
      for (let j = 0; j < state.files.length; j += 1) {
        if (i === j) continue;
        const [source, target] = [rowsNow()[i], rowsNow()[j]];
        if (!source || !target) continue;
        const label = `${rel(work, state.files[i])} を ${rel(work, state.files[j])} の後ろへ（${sameParent(source, target) ? "同じフォルダ" : "別のフォルダ"}）`;
        await step(label, () => drag(source, target, pointerId++, 18));
      }
      for (const folderRow of [...container.querySelectorAll("[data-tree-entry-kind=folder]")]) {
        const source = rowsNow()[i];
        if (!source) continue;
        await step(`${rel(work, state.files[i])} をフォルダ ${rel(work, folderRow.dataset.treeEntryPath)} の中へ`, () =>
          drag(source, folderRow, pointerId++, 10),
        );
      }
    }
    for (const folderRow of folderRows) {
      const source = findRow(work, container, rel(work, folderRow.dataset.treeEntryPath));
      const target = rowsNow()[0];
      if (!source || !target) continue;
      await step(`フォルダ ${rel(work, folderRow.dataset.treeEntryPath)} を ${rel(work, state.files[0])} の前へ`, () =>
        drag(source, target, pointerId++, 2),
      );
    }
    // 複数選択をドラッグ（同じフォルダの2つ／別のフォルダにまたがる2つ）。
    const pairs = [];
    for (let i = 0; i < state.files.length; i += 1) {
      for (let j = i + 1; j < state.files.length; j += 1) pairs.push([i, j]);
    }
    for (const [i, j] of pairs.slice(0, 3)) {
      const target = [...container.querySelectorAll("[data-tree-entry-kind=folder]")][0] ?? null;
      await step(`${rel(work, state.files[i])} と ${rel(work, state.files[j])} を選んで、${target ? `フォルダ ${rel(work, target.dataset.treeEntryPath)} の中へ` : "どこにも落とさない"}`, async () => {
        await click(rowsNow()[i].querySelector(".fileTreeItemPrimary"));
        await click(rowsNow()[j].querySelector(".fileTreeItemPrimary"), { ctrlKey: true });
        if (target) await drag(rowsNow()[i], target, pointerId++, 10);
      });
    }

    result.interactions.steps = steps;
    result.interactions.menus = menus;

    // 折りたたみを渡したときの見え方（フォルダと、ファイルの見出し）。
    await view.rerender(
      React.createElement(WorkspaceSidebar, {
        ...props,
        collapsedFolderPaths: new Set(folderRows.map((row) => row.dataset.treeEntryPath)),
        collapsedOutlinePaths: new Set(state.files),
      }),
    );
    result.interactions.collapsedAll = snapshotTree(work, container).rows;
    await view.unmount();
  }

  // スタートページの「最近編集した文書」。
  {
    const view = await mount(
      React.createElement(ScopeStartPage, {
        folder: state.folder,
        onOpenFile: () => {},
        onCreateFile: () => {},
        onOpenPlot: () => {},
        onOpenCanvas: () => {},
      }),
    );
    result.startPageRecent = [...view.container.querySelectorAll(".scopeStartRecent button")].map((button) =>
      rel(work, button.title),
    );
    await view.unmount();
  }

  derived[work] = result;
}

// ライブラリ直下を開いているとき（作品ではない）。直下の文書は作品C の中身を借り、作品一覧を出す。
{
  const state = works["作品C"];
  const record = recorder("作品C");
  const library = {
    path: workRoot("作品C"),
    name: "見本ライブラリ",
    role: "root",
    projects: Object.keys(works).map((work) => ({ path: toAbsolute("作品C", `../${work}`), name: work })),
    misplacedProjects: [],
  };
  const view = await mount(
    React.createElement(WorkspaceSidebar, sidebarProps(state, record, { library })),
  );
  derived["ライブラリ直下"] = snapshotTree("作品C", view.container);
  await view.unmount();
}

// フォルダを開いていないとき。
{
  const record = recorder("作品A");
  const view = await mount(
    React.createElement(
      WorkspaceSidebar,
      sidebarProps(works["作品A"], record, { projectFolder: null, currentFilePath: null, currentFileName: "無題" }),
    ),
  );
  derived["フォルダなし"] = snapshotTree("作品A", view.container);
  await view.unmount();
}

const expectedPath = path.join(expectedDir, "sidebar-tree.json");
if (update) {
  writeFileSync(expectedPath, `${JSON.stringify(derived, null, 2)}\n`.split("\n").join("\r\n"));
  console.log(`wrote ${expectedPath}`);
} else {
  const expected = readJson(expectedPath);
  for (const key of Object.keys(expected)) {
    assert.deepEqual(derived[key], expected[key], `${key} の左のツリーが期待値と違う`);
  }
  assert.deepEqual(derived, expected);
  console.log(`binder tree baseline ok (${Object.keys(derived).length} cases)`);
}
dom.window.close();
