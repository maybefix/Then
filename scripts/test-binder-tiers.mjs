// 左のバインダーの三段（原稿／素材／投稿。BINDER 1-4、docs/BINDER_TIERS_PLAN.md）を、本物の WorkspaceSidebar で確かめる。
//   - 段の分け方（role だけで決める。名前では決めない）と、段の順の並び
//   - 段の見出し・字数・素材の段の中身・投稿の段・素材フォルダがないときのボタン・絞り込み・ライブラリ直下
//   - 段の折りたたみ、段の見出しへのドラッグ（段をまたぐ移動）、段の見出しと行の右クリックのメニュー
// 素材フォルダのない作品が今までどおりであることは test:binder-tree-baseline が確かめる。
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `binder-tiers-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: [
      'export { collectProjectTextFiles, createProjectAstSkeleton, upsertProjectAstDocumentAsts } from "./src/editor/ast/projectAst";',
      'export { createDocumentAst } from "./src/editor/ast/documentAst";',
      'export { WorkspaceSidebar } from "./src/components/layout/WorkspaceSidebar";',
      'export { splitBinderTiers, orderRootEntriesByTier } from "./src/components/layout/binderTiers";',
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
  WorkspaceSidebar,
  collectProjectTextFiles,
  createDocumentAst,
  createProjectAstSkeleton,
  orderRootEntriesByTier,
  splitBinderTiers,
  upsertProjectAstDocumentAsts,
} = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));

// ---- 見本の作品。素材フォルダ「資料」が一覧の先頭にある（段の順と一覧の順が違う）。 ----
const root = "C:\\work";
const p = (relative) => [root, ...relative.split("/")].join("\\");
const rel = (absolute) => (absolute === root ? "." : absolute.slice(root.length + 1).split("\\").join("/"));
const file = (relative, extra = {}) => ({
  path: p(relative), name: relative.split("/").pop(), kind: "file", children: [], modifiedAt: 1, ...extra,
});
const folderEntry = (relative, children, extra = {}) => ({
  path: p(relative), name: relative.split("/").pop(), kind: "folder", children, ...extra,
});
const texts = {
  "資料/人物.md": "# 人物\n\n汐見。",
  "資料/年表/年表.md": "# 年表\n\n十歳。",
  "本編.md": "# 本編\n\n汐見が来た。",
  "第一章/港.md": "# 港\n\n手紙を開いた。",
  "素材/メモ.md": "# メモ\n\n港の地図。",
};
const withMaterials = {
  path: root,
  name: "work",
  children: [
    folderEntry("資料", [
      file("資料/人物.md", { role: "material" }),
      folderEntry("資料/年表", [file("資料/年表/年表.md", { role: "material" })], { role: "material" }),
    ], { role: "material" }),
    file("本編.md"),
    folderEntry("第一章", [file("第一章/港.md")]),
    // 「素材」という名前でも、role がなければ原稿。
    folderEntry("素材", [file("素材/メモ.md")]),
  ],
};
const stripRoles = (entry) => {
  const { role: _role, ...rest } = entry;
  return { ...rest, children: entry.children.map(stripRoles) };
};
const withoutMaterials = { ...withMaterials, children: withMaterials.children.map(stripRoles) };
const astOf = (folder) =>
  upsertProjectAstDocumentAsts(
    createProjectAstSkeleton(folder, null),
    collectProjectTextFiles(folder).map((entry) =>
      createDocumentAst({ path: entry.path, name: entry.name, text: texts[rel(entry.path)] }),
    ),
  );

// ---- 段の分け方 ----
{
  const tiers = splitBinderTiers(withMaterials);
  assert.equal(tiers.materialsFolder?.path, p("資料"), "role の付いた作品直下のフォルダが素材フォルダ");
  assert.deepEqual(tiers.manuscriptEntries.map((entry) => rel(entry.path)), ["本編.md", "第一章", "素材"]);
  assert.deepEqual(
    orderRootEntriesByTier(withMaterials).map((entry) => rel(entry.path)),
    ["本編.md", "第一章", "素材", "資料"],
    "段の順は原稿→素材",
  );
  const none = splitBinderTiers(withoutMaterials);
  assert.equal(none.materialsFolder, null, "名前が「素材」でも role がなければ素材フォルダではない");
  assert.equal(orderRootEntriesByTier(withoutMaterials), withoutMaterials.children, "素材がなければ一覧の順のまま");
}

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
dom.window.HTMLElement.prototype.setPointerCapture = function (id) { this.__pointer = id; };
dom.window.HTMLElement.prototype.hasPointerCapture = function (id) { return this.__pointer === id; };
dom.window.HTMLElement.prototype.releasePointerCapture = function (id) { if (this.__pointer === id) this.__pointer = null; };
const rowRect = () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON() {} });
const pointerEvent = (type, pointerId, clientY, init = {}) => {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY, ...init });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
};

const calls = [];
const mapArg = (value) =>
  typeof value === "string" && value.startsWith(root) ? rel(value)
    : Array.isArray(value) ? value.map(mapArg)
    : value && typeof value === "object" && typeof value.path === "string" ? rel(value.path)
    : value;
const spy = (name) => (...args) => calls.push([name, ...args.map(mapArg)]);
const takeCalls = () => calls.splice(0);

function props(folder, overrides = {}) {
  const noop = () => {};
  return {
    projectFolder: folder,
    currentFilePath: p("本編.md"),
    currentFileName: "本編.md",
    currentFileCharCount: 0,
    focusedFolderPath: null,
    activeDocumentOutline: [],
    activeOutlineIds: new Set(),
    activeOutlineBlockId: null,
    projectAst: astOf(folder),
    countWhitespace: false,
    countCode: true,
    showOutlineGuides: true,
    fileProgress: {},
    onSetFileProgress: noop,
    collapsedFolderPaths: new Set(),
    onFolderCollapsedChange: spy("onFolderCollapsedChange"),
    collapsedOutlinePaths: new Set(collectProjectTextFiles(folder).map((entry) => entry.path)),
    onOutlineCollapsedChange: noop,
    collapsedOutlineHeadingKeys: new Set(),
    onOutlineHeadingCollapsedChange: noop,
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
    onJumpOutline: noop,
    onJumpProjectOutline: noop,
    onMoveHeadings: noop,
    onExtractHeading: noop,
    onOpenProjectFolder: noop,
    onCreateFile: spy("onCreateFile"),
    onCreateFolder: spy("onCreateFolder"),
    onSelectFile: spy("onSelectFile"),
    onSelectFolder: spy("onSelectFolder"),
    onRenameEntry: spy("onRenameEntry"),
    onDeleteEntry: spy("onDeleteEntry"),
    onMoveEntry: spy("onMoveEntry"),
    onReorderEntry: spy("onReorderEntry"),
    snapshots: [],
    isSnapshotSectionCollapsed: true,
    onSnapshotSectionCollapsedChange: noop,
    showSnapshotSection: false,
    onCreateSnapshot: noop,
    onOpenSnapshot: noop,
    onEditSnapshotDetails: noop,
    onRestoreSnapshot: noop,
    onDeleteSnapshot: noop,
    onCollapse: noop,
    library: null,
    onEnterLibraryRoot: noop,
    onEnterProject: noop,
    onCreateLibraryProject: noop,
    onImportProject: noop,
    onReorderLibraryProjects: noop,
    isLibrarySearchLoading: false,
    ideaThreadCount: 3,
    onOpenIdeas: spy("onOpenIdeas"),
    onCreateMaterialsFolder: spy("onCreateMaterialsFolder"),
    onSetMaterialsFolder: spy("onSetMaterialsFolder"),
    ...overrides,
  };
}

async function mount(sidebarProps) {
  const container = document.createElement("div");
  document.querySelector(".appShell").append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(React.createElement(WorkspaceSidebar, sidebarProps)));
  return { container, unmount: () => act(async () => reactRoot.unmount()).then(() => container.remove()) };
}
const text = (element) => element?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const sections = (container) =>
  [...container.querySelectorAll(".binderSection")].map((section) => ({
    label: section.getAttribute("aria-label"),
    header: text(section.querySelector(".binderSectionHeader")),
    rows: [...section.querySelectorAll("[data-tree-entry-path]")].map((row) => [
      rel(row.dataset.treeEntryPath),
      row.style.getPropertyValue("--tree-item-indent"),
      rel(row.dataset.treeFolderPath ?? ""),
    ]),
  }));
const row = (container, relative) =>
  [...container.querySelectorAll("[data-tree-entry-path]")].find((element) => rel(element.dataset.treeEntryPath) === relative);
const header = (container, section) => container.querySelector(`[data-binder-section="${section}"]`);
const click = (element, init = {}) =>
  act(async () => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
let pointerId = 1;
async function drag(source, target, clientY = 10) {
  const button = source.querySelector(".treeItemPrimary");
  target.getBoundingClientRect = rowRect;
  pointerTarget = target;
  await act(async () => {
    button.dispatchEvent(pointerEvent("pointerdown", pointerId, 0));
    button.dispatchEvent(pointerEvent("pointermove", pointerId, clientY));
    button.dispatchEvent(pointerEvent("pointerup", pointerId, clientY));
  });
  pointerId += 1;
  pointerTarget = null;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function menu(target) {
  await act(async () =>
    target.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })),
  );
  return [...document.querySelectorAll(".treeContextMenu [role=menuitem]")];
}
const closeMenu = () => act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })));
const menuLabels = async (target) => {
  const labels = (await menu(target)).map(text);
  await closeMenu();
  return labels;
};
async function choose(target, label) {
  const item = (await menu(target)).find((element) => text(element) === label);
  assert.ok(item, `メニューに「${label}」がある`);
  await click(item);
}

// 素材フォルダのある作品: 段の並びと中身。
{
  localStorage.removeItem("then.sidebar.progressFilter");
  const view = await mount(props(withMaterials));
  const view_ = sections(view.container);
  assert.deepEqual(view_.map((section) => section.label), ["原稿", "素材", "投稿"]);
  assert.deepEqual(
    view_[0].rows,
    [["本編.md", "24px", "."], ["第一章", "24px", "."], ["第一章/港.md", "38px", "第一章"], ["素材", "24px", "."], ["素材/メモ.md", "38px", "素材"]],
    "原稿の段は見出しから一段下げて、「素材」という名前の原稿のフォルダも原稿",
  );
  assert.deepEqual(
    view_[1].rows,
    [["資料/人物.md", "24px", "資料"], ["資料/年表", "24px", "資料"], ["資料/年表/年表.md", "38px", "資料/年表"]],
    "素材の段は素材フォルダの中身を見出しから一段下げて。素材フォルダそのものは行にしない",
  );
  assert.equal(row(view.container, "資料"), undefined);
  const ast = astOf(withMaterials);
  const chars = (relative) => ast.files.find((entry) => rel(entry.path) === relative).visibleTextLength;
  const manuscript = chars("本編.md") + chars("第一章/港.md") + chars("素材/メモ.md");
  const materials = chars("資料/人物.md") + chars("資料/年表/年表.md");
  assert.equal(view_[0].header, `原稿${manuscript}`, "原稿の段の数は合計の字数");
  assert.equal(view_[1].header, `素材${materials}`, "素材の段の数は素材フォルダの字数");
  assert.equal(view_[2].header, "投稿");
  assert.match(text(view.container.querySelector(".fileViewSummary strong")), new RegExp(`合計 ${manuscript}字`), "下の合計は原稿だけのまま");
  assert.equal(view.container.querySelector(".binderSectionAction"), null, "素材フォルダがあれば作るボタンは出さない");
  assert.equal(row(view.container, "資料/人物.md").querySelector(".fileProgressMarker"), null, "素材には進捗記号を出さない");
  assert.ok(row(view.container, "本編.md").querySelector(".fileProgressMarker"));

  // 投稿の段: アイデアの件数と、右のペインを開く。
  const post = view.container.querySelector(".binderPostItemPrimary");
  assert.equal(text(post), "アイデア3");
  takeCalls();
  await click(post);
  assert.deepEqual(takeCalls(), [["onOpenIdeas"]]);

  // 段の折りたたみ: 原稿＝作品のルート、素材＝素材フォルダのパスで、フォルダの折りたたみに渡す。
  await click(header(view.container, "manuscript").querySelector("button"));
  await click(header(view.container, "materials").querySelector("button"));
  assert.deepEqual(takeCalls(), [["onFolderCollapsedChange", ".", true], ["onFolderCollapsedChange", "資料", true]]);

  // 段をまたぐドラッグ。
  await drag(row(view.container, "本編.md"), header(view.container, "materials"));
  assert.deepEqual(takeCalls(), [["onMoveEntry", ["本編.md"], "資料"]], "原稿を素材の段の見出しへ＝素材フォルダの中へ");
  await drag(row(view.container, "資料/年表/年表.md"), header(view.container, "manuscript"));
  assert.deepEqual(takeCalls(), [["onMoveEntry", ["資料/年表/年表.md"], "."]], "素材を原稿の段の見出しへ＝作品直下へ");
  await drag(row(view.container, "資料/人物.md"), header(view.container, "materials"));
  assert.deepEqual(takeCalls(), [], "すでに素材フォルダの直下にあるものは動かさない");
  await drag(row(view.container, "本編.md"), header(view.container, "manuscript"));
  assert.deepEqual(takeCalls(), [], "すでに作品直下にあるものは動かさない");
  await drag(row(view.container, "資料/人物.md"), row(view.container, "第一章/港.md"), 18);
  assert.deepEqual(takeCalls(), [["onMoveEntry", ["資料/人物.md"], "第一章", "第一章/港.md", "after"]], "素材を原稿の行の後ろへ");
  await drag(row(view.container, "資料/人物.md"), row(view.container, "資料/年表"), 5);
  assert.deepEqual(takeCalls(), [["onReorderEntry", "資料", ["資料/人物.md"], "資料/年表", "before"]], "素材の段の中の並べ替え");
  await drag(row(view.container, "資料/年表"), header(view.container, "manuscript"));
  assert.deepEqual(takeCalls(), [["onMoveEntry", ["資料/年表"], "."]], "素材のフォルダも原稿へ移せる");
  await drag(row(view.container, "第一章/港.md"), row(view.container, "第一章"), 10);
  assert.deepEqual(takeCalls(), [], "自分の親フォルダの真ん中へ落としても外へ出さない（確認1の 11）");

  // 段をまたぐ複数選択は、段の順（原稿→素材）で渡す。
  await click(row(view.container, "資料/人物.md").querySelector(".fileTreeItemPrimary"));
  await click(row(view.container, "本編.md").querySelector(".fileTreeItemPrimary"), { ctrlKey: true });
  takeCalls();
  await drag(row(view.container, "資料/人物.md"), row(view.container, "第一章"), 10);
  assert.deepEqual(takeCalls(), [["onMoveEntry", ["本編.md", "資料/人物.md"], "第一章"]]);

  // メニュー。
  assert.deepEqual(await menuLabels(header(view.container, "manuscript")), ["ファイルを追加", "フォルダを追加"]);
  assert.deepEqual(await menuLabels(header(view.container, "materials")), ["ファイルを追加", "フォルダを追加", "リネーム"]);
  assert.deepEqual(await menuLabels(header(view.container, "posts")), [], "投稿の段の見出しにはメニューがない");
  await choose(header(view.container, "manuscript"), "ファイルを追加");
  await choose(header(view.container, "materials"), "フォルダを追加");
  await choose(header(view.container, "materials"), "リネーム");
  assert.deepEqual(takeCalls(), [["onCreateFile", "."], ["onCreateFolder", "資料"], ["onRenameEntry", "資料"]]);
  assert.deepEqual(
    await menuLabels(row(view.container, "第一章")),
    ["開く", "ファイルを追加", "フォルダを追加", "リネーム", "削除"],
    "素材フォルダがある作品では「素材フォルダにする」を出さない",
  );
  await view.unmount();
}

// 段の折りたたみの見え方。
{
  const view = await mount(props(withMaterials, { collapsedFolderPaths: new Set([root, p("資料")]) }));
  assert.deepEqual(sections(view.container).map((section) => section.rows.length), [0, 0, 0]);
  assert.equal(header(view.container, "manuscript").querySelector("button").getAttribute("aria-expanded"), "false");
  await view.unmount();
}

// 絞り込み（「すべて」以外）では素材の段を隠す。投稿の段は残す。
{
  localStorage.setItem("then.sidebar.progressFilter", "todo");
  const view = await mount(props(withMaterials));
  assert.deepEqual(sections(view.container).map((section) => section.label), ["原稿", "投稿"]);
  await view.unmount();
  localStorage.removeItem("then.sidebar.progressFilter");
}

// 素材フォルダがない作品: 素材の段に作るボタン。作品直下のフォルダだけ「素材フォルダにする」。
{
  const view = await mount(props(withoutMaterials));
  const view_ = sections(view.container);
  assert.deepEqual(view_.map((section) => section.label), ["原稿", "素材", "投稿"]);
  assert.equal(view_[1].rows.length, 0);
  assert.equal(view_[0].rows[0][0], "資料", "素材でないなら一覧の順のまま原稿の段に出す");
  const create = view.container.querySelector(".binderSectionAction");
  assert.equal(text(create), "素材フォルダを作る");
  takeCalls();
  await click(create);
  assert.deepEqual(takeCalls(), [["onCreateMaterialsFolder"]]);
  assert.deepEqual(
    await menuLabels(row(view.container, "素材")),
    ["開く", "ファイルを追加", "フォルダを追加", "素材フォルダにする", "リネーム", "削除"],
  );
  assert.ok(!(await menuLabels(row(view.container, "資料/年表"))).includes("素材フォルダにする"), "作品直下でないフォルダはできない");
  assert.ok(!(await menuLabels(row(view.container, "本編.md"))).includes("素材フォルダにする"), "ファイルはできない");
  await choose(row(view.container, "素材"), "素材フォルダにする");
  assert.deepEqual(takeCalls(), [["onSetMaterialsFolder", "素材"]]);
  assert.deepEqual(await menuLabels(header(view.container, "materials")), [], "素材フォルダがないと素材の段の見出しにメニューはない");
  await view.unmount();
}

// ライブラリ直下では段を出さない。
{
  const library = { path: root, name: "ライブラリ", role: "root", projects: [], misplacedProjects: [] };
  const view = await mount(props(withMaterials, { library }));
  assert.equal(view.container.querySelectorAll(".binderSection").length, 0);
  assert.ok(row(view.container, "資料"), "ライブラリ直下は今のツリーのまま");
  await view.unmount();
}

dom.window.close();
console.log("binder tiers: ok (split by role, sections, counts, posts, collapse, cross-tier drag, menus, filter, library root)");
