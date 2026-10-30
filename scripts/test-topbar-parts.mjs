// 上部の帯の3つの部品（TopbarFileMenu・TopbarBreadcrumbs・TopbarActions）が、App から受け取った値と関数を、
// 正しい相手に正しく渡すかを確かめる。部品はフックを使わないので、関数として呼んで返ってきた要素の木をたどる。
// 値は名前ごとに違う目印にし、関数は呼ばれた名前と引数を記録する入れ物にして、
// 取り違え（たとえば「名前の変更」に削除の関数をつなぐこと）を、どの組でも見つけられるようにする。
import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `topbar-parts-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: [
      'export { TopbarFileMenu } from "./TopbarFileMenu";',
      'export { TopbarBreadcrumbs } from "./TopbarBreadcrumbs";',
      'export { TopbarActions } from "./TopbarActions";',
      'export { AppIcon } from "./AppIcon";',
    ].join("\n"),
    resolveDir: path.join(process.cwd(), "src/components/layout"),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
const { TopbarFileMenu, TopbarBreadcrumbs, TopbarActions, AppIcon } = await import(pathToFileURL(compiledPath).href)
  .finally(() => unlink(compiledPath));

// App の関数の代わり。呼ばれた名前と引数を順に記録する。関数の引数（state の更新関数や、
// メニューを閉じてから走らせる処理）は "<fn>" と記録し、中身は lastFunctionArg から取り出して確かめる。
const calls = [];
const exercised = new Set();
let lastFunctionArg = null;
const record = (name, args) => {
  exercised.add(name);
  calls.push({ name, args: args.map((arg) => (typeof arg === "function" ? "<fn>" : arg)) });
  const fn = args.find((arg) => typeof arg === "function");
  if (fn) lastFunctionArg = fn;
};
const spy = (name, result) => (...args) => {
  record(name, args);
  return result === undefined ? Promise.resolve() : result;
};
const spiesOf = (names) => Object.fromEntries(names.map((name) => [name, spy(name)]));

const mark = (name) => `<${name}>`;
const refOf = (name) => ({ current: null, name });
const eventOf = (extra = {}) => ({
  ...extra,
  preventDefault: () => record("event.preventDefault", []),
});

// 要素の木を深さ優先でたどる。
const elementsOf = (node) => {
  const found = [];
  const visit = (current) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object" || !("props" in current)) return;
    found.push(current);
    visit(current.props.children);
  };
  visit(node);
  return found;
};
const textOf = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
};
const findAll = (tree, predicate) => elementsOf(tree).filter(predicate);
const findOne = (tree, predicate, label) => {
  const matches = findAll(tree, predicate);
  assert.equal(matches.length, 1, `${label} must appear exactly once (found ${matches.length})`);
  return matches[0];
};
const hasClass = (element, name) => typeof element.props.className === "string"
  && element.props.className.split(/\s+/).includes(name);
const byClass = (tree, name) => findOne(tree, (element) => hasClass(element, name), `.${name}`);
const button = (tree, label) => findOne(
  tree,
  (element) => element.type === "button" && element.props["aria-label"] === label,
  `button ${label}`,
);
const hasButton = (tree, label) =>
  findAll(tree, (element) => element.type === "button" && element.props["aria-label"] === label).length > 0;
const menuItem = (tree, text) => findOne(
  tree,
  (element) => element.type === "button" && /^menuitem/.test(element.props.role ?? "") && textOf(element) === text,
  `menu item ${text}`,
);

// 1つの操作で、決めた App の関数が、決めた引数で、決めた順に呼ばれることを確かめる。
const expectCalls = (label, action, expected) => {
  calls.length = 0;
  lastFunctionArg = null;
  action();
  assert.deepEqual(calls, expected, `${label} must call ${expected.map((call) => call.name).join(", ") || "nothing"}`);
};
// 「開く／閉じる」を反転する更新関数であることを確かめる。
const expectToggle = (label) => {
  assert.equal(typeof lastFunctionArg, "function", `${label} must pass an updater`);
  assert.equal(lastFunctionArg(false), true, `${label} must open a closed menu`);
  assert.equal(lastFunctionArg(true), false, `${label} must close an open menu`);
};
// メニューを閉じてから走らせる処理を取り出して動かし、その中で呼ばれるものを確かめる。
const expectDeferred = (label, expected) => {
  const action = lastFunctionArg;
  assert.equal(typeof action, "function", `${label} must hand over an action`);
  expectCalls(`${label} (deferred)`, () => action(), expected);
};
const expectExercised = (label, names) => {
  const missing = names.filter((name) => !exercised.has(name));
  assert.deepEqual(missing, [], `${label}: every function prop must be wired to something`);
};

// --- ファイルメニュー ---
{
  const functionNames = [
    "setIsFileMenuOpen", "closeFileMenuAndRun", "handleNewDocument", "handleOpenTextFile", "saveCurrentDocument",
    "handleSaveAs", "handleRegisterCurrentFileAsTemplate", "openManuscriptTidy", "handleOpenLinkedExport",
    "handleOpenProjectFolder",
  ];
  const spies = {
    ...spiesOf(functionNames),
    getCurrentEditorSelection: spy("getCurrentEditorSelection", mark("selection")),
  };
  const fileMenuRef = refOf("fileMenuRef");
  const base = { fileMenuRef, isEditorFocusMode: false, isFileMenuOpen: false, appMode: "write", canRegisterTemplate: true };
  const render = (overrides = {}) => TopbarFileMenu({ ...base, ...spies, ...overrides });

  const closed = render();
  assert.equal(closed.type, "div");
  assert.equal(closed.props.className, "fileMenu");
  assert.equal(closed.ref, fileMenuRef, "the file menu must hand its element to App's ref");
  assert.equal(closed.props["aria-hidden"], false);
  assert.equal("inert" in closed.props, false);
  assert.equal(findAll(closed, (element) => hasClass(element, "menuPopover")).length, 0);
  const menuButton = button(closed, "ファイルメニュー");
  assert.equal(menuButton.props["aria-expanded"], false);
  expectCalls("ファイルメニューのボタン", () => menuButton.props.onClick(), [{ name: "setIsFileMenuOpen", args: ["<fn>"] }]);
  expectToggle("ファイルメニューのボタン");

  const focused = render({ isEditorFocusMode: true });
  assert.equal(focused.props["aria-hidden"], true);
  assert.equal(focused.props.inert, "");

  const open = render({ isFileMenuOpen: true });
  assert.equal(button(open, "ファイルメニュー").props["aria-expanded"], true);
  assert.deepEqual(
    findAll(open, (element) => element.props.role === "menuitem").map(textOf),
    ["新規ファイル", "ファイルを開く", "保存", "別名で保存", "このファイルをテンプレートとして登録…", "原稿を整える…", "エクスポート…", "フォルダを開く"],
  );
  for (const [text, name] of [
    ["新規ファイル", "handleNewDocument"],
    ["ファイルを開く", "handleOpenTextFile"],
    ["保存", "saveCurrentDocument"],
    ["別名で保存", "handleSaveAs"],
    ["このファイルをテンプレートとして登録…", "handleRegisterCurrentFileAsTemplate"],
    ["エクスポート…", "handleOpenLinkedExport"],
    ["フォルダを開く", "handleOpenProjectFolder"],
  ]) {
    expectCalls(text, () => menuItem(open, text).props.onClick(), [{ name: "closeFileMenuAndRun", args: ["<fn>"] }]);
    assert.equal(lastFunctionArg, spies[name], `${text} must run ${name}`);
    expectDeferred(text, [{ name, args: [] }]);
  }
  assert.equal(menuItem(open, "原稿を整える…").props.disabled, false);
  expectCalls("原稿を整える…", () => menuItem(open, "原稿を整える…").props.onClick(), [
    { name: "closeFileMenuAndRun", args: ["<fn>"] },
  ]);
  expectDeferred("原稿を整える…", [
    { name: "getCurrentEditorSelection", args: [] },
    { name: "openManuscriptTidy", args: [mark("selection")] },
  ]);
  for (const appMode of ["canvas", "export", "checkpoint", "plugin"]) {
    assert.equal(menuItem(render({ isFileMenuOpen: true, appMode }), "原稿を整える…").props.disabled, true,
      `原稿を整える must be disabled in ${appMode}`);
  }
  // 開始画面と空のタブでは、テンプレートとして登録する本文がないので押せない。
  assert.equal(menuItem(open, "このファイルをテンプレートとして登録…").props.disabled, false);
  assert.equal(
    menuItem(render({ isFileMenuOpen: true, canRegisterTemplate: false }), "このファイルをテンプレートとして登録…").props.disabled,
    true,
    "template registration must be disabled without a document",
  );
  expectExercised("TopbarFileMenu", [...functionNames, "getCurrentEditorSelection"]);
}

// --- 右のアイコンと画面モード ---
{
  const functionNames = [
    "toggleEditorFocusMode", "setIsRightSidebarCollapsed", "handleQuickCreateManuscriptSnapshot", "updateSettings",
    "setShouldReturnToSettingsAfterThemePicker", "setIsThemePickerModalOpen", "setIsSettingsModalOpen",
    "setIsModeMenuOpen", "handleModeMenuKeyDown",
  ];
  const spies = spiesOf(functionNames);
  const modeMenuRef = refOf("modeMenuRef");
  const modeMenuButtonRef = { current: { focus: () => record("modeMenuButtonRef.current.focus", []) }, name: "modeMenuButtonRef" };
  const modeMenuEntries = [
    { key: "write", label: "本文", title: "本文モード", icon: mark("icon.write"), isActive: true, opensInWindow: false, select: spy("select:write") },
    { key: "canvas", label: "Canvas", title: "Canvas モード", icon: mark("icon.canvas"), isActive: false, opensInWindow: true, select: spy("select:canvas") },
  ];
  const base = {
    appMode: "write",
    isEditorFocusMode: false,
    settings: { focusModeUsesNativeFullscreen: false, writingMode: "vertical-rl" },
    isRightSidebarCollapsed: true,
    projectFolder: { path: "C:/work", name: "work", children: [] },
    modeMenuRef,
    modeMenuButtonRef,
    isModeMenuOpen: false,
    activeModeMenuEntry: modeMenuEntries[0],
    modeMenuEntries,
  };
  const render = (overrides = {}) => TopbarActions({ ...base, ...spies, ...overrides });

  const tree = render();
  assert.equal(tree.type, "div");
  assert.equal(tree.props.className, "topbarActions");
  assert.equal(tree.props["aria-hidden"], false);
  assert.equal("inert" in tree.props, false);
  const focusedTree = render({ isEditorFocusMode: true });
  assert.equal(focusedTree.props["aria-hidden"], true);
  assert.equal(focusedTree.props.inert, "");

  // 集中モード
  const focusButton = button(tree, "エディタをフルスクリーン表示");
  assert.equal(focusButton.props["aria-pressed"], false);
  assert.equal(focusButton.props.title, "エディタをフルスクリーン表示");
  assert.doesNotMatch(focusButton.props.className, /activeIconButton/);
  assert.equal(focusButton.props.onClick, spies.toggleEditorFocusMode);
  exercised.add("toggleEditorFocusMode");
  assert.equal(button(focusedTree, "エディタをフルスクリーン表示").props["aria-pressed"], true);
  assert.match(button(focusedTree, "エディタをフルスクリーン表示").props.className, /activeIconButton/);
  const nativeTree = render({ settings: { ...base.settings, focusModeUsesNativeFullscreen: true } });
  assert.equal(button(nativeTree, "エディタを完全フルスクリーン表示").props.title, "エディタを完全フルスクリーン表示");

  // 右サイドバー、保存点
  expectCalls("右サイドバーを表示", () => button(tree, "右サイドバーを表示").props.onClick(), [
    { name: "setIsRightSidebarCollapsed", args: [false] },
  ]);
  expectCalls("保存点", () => button(tree, "今の状態を保存点にする（Ctrl+Shift+S）").props.onClick(), [
    { name: "handleQuickCreateManuscriptSnapshot", args: [] },
  ]);
  assert.equal(hasButton(render({ isRightSidebarCollapsed: false }), "右サイドバーを表示"), false);
  assert.equal(hasButton(render({ projectFolder: null }), "今の状態を保存点にする（Ctrl+Shift+S）"), false);
  const visibility = {
    write: [true, true, true],
    canvas: [false, true, true],
    export: [false, false, true],
    checkpoint: [false, false, false],
    plugin: [false, false, true],
  };
  for (const [appMode, [focus, rightSidebar, checkpoint]] of Object.entries(visibility)) {
    const modeTree = render({ appMode });
    assert.equal(hasButton(modeTree, "エディタをフルスクリーン表示"), focus, `focus mode button in ${appMode}`);
    assert.equal(hasButton(modeTree, "右サイドバーを表示"), rightSidebar, `right sidebar button in ${appMode}`);
    assert.equal(hasButton(modeTree, "今の状態を保存点にする（Ctrl+Shift+S）"), checkpoint, `checkpoint button in ${appMode}`);
  }

  // 縦書き・横書き
  const toHorizontal = button(tree, "横書きに切り替え");
  assert.equal(toHorizontal.props.title, "横書きに切り替え");
  assert.doesNotMatch(toHorizontal.props.className, /activeIconButton/);
  assert.equal(findOne(toHorizontal, (element) => element.type === AppIcon, "writing mode icon").props.name, "vertical");
  expectCalls("横書きに切り替え", () => toHorizontal.props.onClick(), [
    { name: "updateSettings", args: ["writingMode", "horizontal-tb"] },
  ]);
  const horizontalTree = render({ settings: { ...base.settings, writingMode: "horizontal-tb" } });
  const toVertical = button(horizontalTree, "縦書きに切り替え");
  assert.match(toVertical.props.className, /activeIconButton/);
  assert.equal(findOne(toVertical, (element) => element.type === AppIcon, "writing mode icon").props.name, "horizontal");
  expectCalls("縦書きに切り替え", () => toVertical.props.onClick(), [
    { name: "updateSettings", args: ["writingMode", "vertical-rl"] },
  ]);

  // テーマ、設定
  expectCalls("テーマを選択", () => button(tree, "テーマを選択").props.onClick(), [
    { name: "setShouldReturnToSettingsAfterThemePicker", args: [false] },
    { name: "setIsThemePickerModalOpen", args: [true] },
  ]);
  expectCalls("設定", () => button(tree, "設定").props.onClick(), [{ name: "setIsSettingsModalOpen", args: [true] }]);

  // 画面モード
  const modeMenu = byClass(tree, "modeMenu");
  assert.equal(modeMenu.ref, modeMenuRef, "the mode menu must hand its element to App's ref");
  const modeButton = byClass(tree, "modeMenuButton");
  assert.equal(modeButton.ref, modeMenuButtonRef, "the mode button must hand its element to App's ref");
  assert.equal(modeButton.props["aria-label"], "画面モード：本文");
  assert.equal(modeButton.props["aria-expanded"], false);
  assert.equal(textOf(byClass(tree, "modeMenuButtonLabel")), "本文");
  assert.ok(modeButton.props.children.includes(mark("icon.write")), "the mode button shows the active icon");
  assert.equal(findAll(tree, (element) => hasClass(element, "modeMenuPopover")).length, 0);
  expectCalls("画面モードのボタン", () => modeButton.props.onClick(), [{ name: "setIsModeMenuOpen", args: ["<fn>"] }]);
  expectToggle("画面モードのボタン");
  for (const key of ["ArrowDown", "ArrowUp"]) {
    expectCalls(`画面モードのボタンで ${key}`, () => modeButton.props.onKeyDown(eventOf({ key })), [
      { name: "event.preventDefault", args: [] },
      { name: "setIsModeMenuOpen", args: [true] },
    ]);
  }
  expectCalls("画面モードのボタンで Enter", () => modeButton.props.onKeyDown(eventOf({ key: "Enter" })), []);
  assert.equal(button(render({ activeModeMenuEntry: undefined }), "画面モード：").props["aria-label"], "画面モード：");

  const openTree = render({ isModeMenuOpen: true });
  assert.equal(byClass(openTree, "modeMenuButton").props["aria-expanded"], true);
  const popover = byClass(openTree, "modeMenuPopover");
  assert.equal(popover.props.onKeyDown, spies.handleModeMenuKeyDown);
  exercised.add("handleModeMenuKeyDown");
  const items = findAll(popover, (element) => element.props.role === "menuitemradio");
  assert.deepEqual(items.map((element) => element.key), ["write", "canvas"]);
  assert.deepEqual(items.map((element) => element.props["aria-checked"]), [true, false]);
  assert.deepEqual(items.map((element) => element.props.className), ["activeMenuItem", ""]);
  assert.deepEqual(items.map((element) => element.props.title), ["本文モード", "Canvas モード"]);
  assert.deepEqual(
    items.map((element) => findAll(element, (child) => child.type === AppIcon && child.props.name === "openExternal").length),
    [0, 1],
  );
  expectCalls("画面モードの項目", () => items[1].props.onClick(), [
    { name: "setIsModeMenuOpen", args: [false] },
    { name: "modeMenuButtonRef.current.focus", args: [] },
    { name: "select:canvas", args: [] },
  ]);
  expectExercised("TopbarActions", functionNames);
}

// --- パンくず ---
{
  const functionNames = [
    "handleBreadcrumbKeyDown", "enterLibraryRoot", "setActiveBreadcrumbPath", "setBreadcrumbBrowsePath",
    "setIsWorkspaceSwitcherOpen", "setWorkspaceSwitcherQuery", "closeBreadcrumbMenuAndRun", "openWorkspace",
    "handleBreadcrumbEntryDragStart", "handleBreadcrumbEntryDragOver", "handleBreadcrumbEntryDrop",
    "handleBreadcrumbEntryDragEnd", "handleProjectFileSelect", "handleBreadcrumbFolderSelect",
    "handleMoveProjectEntry", "handleRenameProjectEntry", "handleDeleteProjectEntry", "handleCreateProjectFile",
    "handleCreateProjectFolder", "setOpenOutlineMenuId", "setOutlineQuery", "jumpToOutlineItem",
    "toggleWorkspaceFolderCollapse", "handleWorkspaceFolderTreeSelect", "setIsBreadcrumbOverflowOpen",
  ];
  const spies = spiesOf(functionNames);
  const file = (folder, name) => ({ path: `${folder}/${name}`, name, kind: "file", children: [] });
  const root = "C:/lib/作品A";
  const chapter1 = file(`${root}/第一部`, "一章.md");
  const chapter2 = file(`${root}/第一部`, "二章.md");
  const person = file(`${root}/第一部/資料`, "人物.md");
  const notes = { path: `${root}/第一部/資料`, name: "資料", kind: "folder", children: [person] };
  const part1 = { path: `${root}/第一部`, name: "第一部", kind: "folder", children: [chapter1, chapter2, notes] };
  const memo = file(root, "メモ.md");
  const empty = { path: `${root}/空`, name: "空", kind: "folder", children: [] };
  const projectFolder = { path: root, name: "作品A", children: [part1, memo, empty] };
  const breadcrumbMenuRef = refOf("breadcrumbMenuRef");
  const outlineParent = { id: "h-1", title: "第一章", level: 1, line: 1 };
  const outlineChild = { id: "h-2", title: "場面一", level: 2, line: 5 };
  const base = {
    breadcrumbLayout: "full",
    breadcrumbMenuRef,
    breadcrumbOverflowItems: [],
    libraryContext: null,
    projectFolder,
    breadcrumbTrail: [projectFolder, part1, chapter1],
    activeBreadcrumbPath: null,
    breadcrumbBrowsePath: null,
    hasActiveOutlineBreadcrumb: false,
    isWorkspaceSwitcherOpen: false,
    settings: { showWorkspacePaths: true },
    workspaceSwitcherQuery: mark("workspaceSwitcherQuery"),
    visibleRecentWorkspaces: [
      { path: root, name: "作品A", lastOpenedAt: 2 },
      { path: "C:/lib/作品B", name: "作品B", lastOpenedAt: 1 },
    ],
    breadcrumbDropTarget: null,
    draggingBreadcrumbEntryPath: null,
    currentFilePath: chapter1.path,
    visibleKnownLibraries: [],
    currentFileName: mark("currentFileName"),
    outlineItems: [],
    activeOutlineChain: [],
    openOutlineMenuId: null,
    outlineQuery: mark("outlineQuery"),
    filteredOutlineItems: [],
    collapsedWorkspaceFolderPaths: new Set(),
    focusedFolderPath: null,
    isBreadcrumbOverflowOpen: false,
    scratchWorkspaceName: mark("scratchWorkspaceName"),
  };
  const render = (overrides = {}) => TopbarBreadcrumbs({ ...base, ...spies, ...overrides });
  const segments = (tree) => findAll(tree, (element) => hasClass(element, "breadcrumbSegment"));

  // 外枠
  {
    const tree = render();
    assert.equal(tree.type, "nav");
    assert.equal(tree.props.className, "breadcrumbs");
    assert.equal(tree.props["aria-label"], "パンくず");
    assert.equal(tree.props["data-layout"], "full");
    assert.equal(tree.ref, breadcrumbMenuRef, "the breadcrumbs must hand their element to App's ref");
    assert.equal(tree.props.onKeyDown, spies.handleBreadcrumbKeyDown);
    exercised.add("handleBreadcrumbKeyDown");
    assert.deepEqual(segments(tree).map((element) => textOf(element)), ["作品A", "›第一部", "›一章.md"]);
    assert.equal(findAll(tree, (element) => hasClass(element, "breadcrumbLibrarySegment")).length, 0);
    assert.equal(textOf(byClass(tree, "activeCrumb")), "一章.md");
    assert.equal(findAll(tree, (element) => hasClass(element, "menuPopover")).length, 0);
    assert.equal(findAll(tree, (element) => hasClass(element, "breadcrumbOverflowMenu")).length, 0);
  }

  // ライブラリの中の作品
  {
    const library = { path: "C:/lib", name: "書庫", role: "project", projects: [], misplacedProjects: [] };
    const tree = render({ libraryContext: library });
    const libraryButton = byClass(tree, "breadcrumbLibraryButton");
    assert.equal(libraryButton.props.title, "ライブラリ「書庫」へ戻る");
    assert.equal(textOf(libraryButton), "書庫");
    assert.equal(libraryButton.props.onClick, spies.enterLibraryRoot);
    exercised.add("enterLibraryRoot");
    assert.equal(findAll(render({ libraryContext: { ...library, role: "root" } }),
      (element) => hasClass(element, "breadcrumbLibrarySegment")).length, 0);
  }

  // 作品の切り替え（作品のあるとき）
  {
    const tree = render();
    const switcher = button(tree, "プロジェクトを切り替え");
    assert.equal(switcher.props["aria-expanded"], false);
    assert.equal(findAll(switcher, (element) => element.type === AppIcon && element.props.name === "book").length, 1);
    expectCalls("作品名", () => switcher.props.onClick(), [
      { name: "setActiveBreadcrumbPath", args: [null] },
      { name: "setBreadcrumbBrowsePath", args: [null] },
      { name: "setIsWorkspaceSwitcherOpen", args: ["<fn>"] },
    ]);
    expectToggle("作品名");
    expectCalls("作品名を右クリック", () => switcher.props.onContextMenu(eventOf()), []);

    const open = render({ isWorkspaceSwitcherOpen: true, focusedFolderPath: part1.path });
    assert.equal(button(open, "プロジェクトを切り替え").props["aria-expanded"], true);
    const popover = byClass(open, "workspaceSwitcherPopover");
    assert.equal(textOf(byClass(popover, "workspaceSwitcherTitle")), "作品A");
    assert.equal(textOf(byClass(popover, "workspaceSwitcherPath")), root);
    const search = findOne(popover, (element) => element.type === "input", "search box");
    assert.equal(search.props.value, mark("workspaceSwitcherQuery"));
    expectCalls("作品の検索", () => search.props.onChange({ target: { value: "作" } }), [
      { name: "setWorkspaceSwitcherQuery", args: ["作"] },
    ]);
    assert.deepEqual(
      findAll(popover, (element) => hasClass(element, "workspaceSwitcherSectionLabel")).map(textOf),
      ["現在のプロジェクト", "最近開いたプロジェクト"],
    );

    // フォルダの木
    const rows = findAll(popover, (element) => hasClass(element, "workspaceFolderTreeNode"));
    assert.deepEqual(rows.map((element) => element.key), [
      root, part1.path, chapter1.path, chapter2.path, notes.path, person.path, memo.path, empty.path,
    ]);
    const treeButton = (entryPath) => findOne(
      popover,
      (element) => hasClass(element, "workspaceFolderTreeButton") && element.props.title === entryPath,
      `tree button ${entryPath}`,
    );
    assert.match(treeButton(part1.path).props.className, /activeWorkspaceFolderTreeButton/);
    assert.match(treeButton(chapter1.path).props.className, /activeWorkspaceFolderTreeButton/);
    assert.doesNotMatch(treeButton(root).props.className, /activeWorkspaceFolderTreeButton/);
    assert.equal(findOne(treeButton(notes.path), (element) => element.type === AppIcon, "folder icon").props.name, "folder");
    expectCalls("木のファイル", () => treeButton(chapter2.path).props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("木のファイル", [{ name: "handleProjectFileSelect", args: [chapter2.path] }]);
    expectCalls("木のフォルダ", () => treeButton(notes.path).props.onClick(), [
      { name: "handleWorkspaceFolderTreeSelect", args: [notes.path] },
    ]);
    const disclosure = button(popover, "第一部 を折りたたむ");
    expectCalls("木の開閉", () => disclosure.props.onClick(), [
      { name: "toggleWorkspaceFolderCollapse", args: [part1.path] },
    ]);
    assert.equal(button(popover, "空 を折りたたむ").props.disabled, true);
    const collapsed = render({
      isWorkspaceSwitcherOpen: true,
      collapsedWorkspaceFolderPaths: new Set([part1.path]),
    });
    assert.equal(hasButton(collapsed, "第一部 を展開"), true);
    assert.deepEqual(
      findAll(collapsed, (element) => hasClass(element, "workspaceFolderTreeNode")).map((element) => element.key),
      [root, part1.path, memo.path, empty.path],
    );

    // 最近開いた作品
    const records = findAll(popover, (element) => hasClass(element, "workspaceRecordButton"));
    assert.deepEqual(records.map((element) => element.key), [root, "C:/lib/作品B"]);
    assert.deepEqual(records.map((element) => element.props.className), [
      "workspaceRecordButton activeMenuItem", "workspaceRecordButton",
    ]);
    assert.equal(textOf(byClass(records[0], "workspaceRecordBadge")), "現在");
    assert.equal(textOf(byClass(records[1], "workspaceRecordPath")), "C:/lib/作品B");
    expectCalls("今の作品", () => records[0].props.onClick(), [{ name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] }]);
    expectDeferred("今の作品", []);
    expectCalls("ほかの作品", () => records[1].props.onClick(), [{ name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] }]);
    expectDeferred("ほかの作品", [{ name: "openWorkspace", args: ["C:/lib/作品B"] }]);
    expectCalls("別のフォルダを開く", () => menuItem(popover, "別のフォルダを開く...").props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("別のフォルダを開く", [{ name: "openWorkspace", args: [] }]);

    const noPaths = render({ isWorkspaceSwitcherOpen: true, settings: { showWorkspacePaths: false } });
    assert.equal(findAll(noPaths, (element) => hasClass(element, "workspaceSwitcherPath")).length, 0);
    assert.equal(findAll(noPaths, (element) => hasClass(element, "workspaceRecordPath")).length, 0);
    const noRecents = render({ isWorkspaceSwitcherOpen: true, visibleRecentWorkspaces: [] });
    assert.equal(textOf(byClass(noRecents, "emptyMenuMessage")), "一致するプロジェクトがありません");

    // 作品を開いているときも、ライブラリの一覧を出す（作品のないときと同じく、最近の作品の後ろ）。
    const libraries = [
      { path: "C:/lib", name: "QAライブラリ", lastOpenedAt: 2, library: { name: "QAライブラリ", role: "root" } },
      { path: "C:/別館", name: "別館", lastOpenedAt: 1, library: { name: "別館", role: "root" } },
    ];
    const withLibraries = render({ isWorkspaceSwitcherOpen: true, visibleKnownLibraries: libraries });
    const libraryPopover = byClass(withLibraries, "workspaceSwitcherPopover");
    assert.deepEqual(
      findAll(libraryPopover, (element) => hasClass(element, "workspaceSwitcherSectionLabel")).map(textOf),
      ["現在のプロジェクト", "最近開いたプロジェクト", "ライブラリ"],
    );
    const libraryRows = findAll(libraryPopover, (element) => hasClass(element, "workspaceRecordButton"));
    assert.deepEqual(libraryRows.map((element) => element.key), [root, "C:/lib/作品B", "C:/lib", "C:/別館"]);
    assert.equal(findOne(libraryRows[3], (element) => element.type === AppIcon, "library icon").props.name, "book");
    assert.equal(libraryRows[2].props.className, "workspaceRecordButton", "the library holding the open work is not the open folder");
    expectCalls("作品からライブラリへ", () => libraryRows[3].props.onClick(), [{ name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] }]);
    expectDeferred("作品からライブラリへ", [{ name: "openWorkspace", args: ["C:/別館"] }]);
    expectCalls("作品から自分のライブラリへ", () => libraryRows[2].props.onClick(), [{ name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] }]);
    expectDeferred("作品から自分のライブラリへ", [{ name: "openWorkspace", args: ["C:/lib"] }]);

    // ライブラリそのものを開いているときは、今のライブラリに「現在」の印を付け、押しても閉じるだけにする。
    // フォルダ名（lib）とライブラリ名（QAライブラリ）が違うときも、ライブラリ名を出す。
    const libraryRoot = { path: "C:/lib", name: "lib", children: [projectFolder], library: { name: "QAライブラリ", role: "root" } };
    const inLibrary = render({
      projectFolder: libraryRoot,
      breadcrumbTrail: [libraryRoot],
      currentFilePath: null,
      isWorkspaceSwitcherOpen: true,
      visibleKnownLibraries: libraries,
    });
    const inLibraryPopover = byClass(inLibrary, "workspaceSwitcherPopover");
    assert.equal(textOf(byClass(inLibraryPopover, "workspaceSwitcherTitle")), "QAライブラリ");
    const libraryTreeRoot = findOne(
      inLibraryPopover,
      (element) => hasClass(element, "workspaceFolderTreeButton") && element.props.title === "C:/lib",
      "library tree root",
    );
    assert.equal(textOf(libraryTreeRoot), "QAライブラリ", "the tree root of a library shows the library name");
    const inLibraryRows = findAll(inLibraryPopover, (element) => hasClass(element, "workspaceRecordButton"));
    const currentLibrary = inLibraryRows.find((element) => element.key === "C:/lib");
    const otherLibrary = inLibraryRows.find((element) => element.key === "C:/別館");
    assert.equal(currentLibrary.props.className, "workspaceRecordButton activeMenuItem");
    assert.equal(textOf(byClass(currentLibrary, "workspaceRecordBadge")), "現在");
    assert.equal(otherLibrary.props.className, "workspaceRecordButton");
    expectCalls("今のライブラリ", () => currentLibrary.props.onClick(), [{ name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] }]);
    expectDeferred("今のライブラリ", []);
    expectCalls("ほかのライブラリ", () => otherLibrary.props.onClick(), [{ name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] }]);
    expectDeferred("ほかのライブラリ", [{ name: "openWorkspace", args: ["C:/別館"] }]);
  }

  // フォルダのパンくずとメニュー
  {
    const tree = render();
    const folderButton = button(tree, "第一部 の項目");
    assert.equal(folderButton.props["aria-expanded"], false);
    expectCalls("フォルダ名（閉じているとき）", () => folderButton.props.onClick(), [
      { name: "setIsWorkspaceSwitcherOpen", args: [false] },
      { name: "setActiveBreadcrumbPath", args: [part1.path] },
      { name: "setBreadcrumbBrowsePath", args: [part1.path] },
    ]);
    expectCalls("フォルダ名を右クリック", () => folderButton.props.onContextMenu(eventOf()), [
      { name: "event.preventDefault", args: [] },
      { name: "setActiveBreadcrumbPath", args: [part1.path] },
      { name: "setBreadcrumbBrowsePath", args: [part1.path] },
    ]);

    const open = render({
      activeBreadcrumbPath: part1.path,
      breadcrumbBrowsePath: part1.path,
      breadcrumbDropTarget: { folderPath: part1.path, entryPath: chapter2.path, position: "after" },
      draggingBreadcrumbEntryPath: chapter1.path,
    });
    assert.equal(button(open, "第一部 の項目").props["aria-expanded"], true);
    expectCalls("フォルダ名（開いているとき）", () => button(open, "第一部 の項目").props.onClick(), [
      { name: "setIsWorkspaceSwitcherOpen", args: [false] },
      { name: "setActiveBreadcrumbPath", args: [null] },
      { name: "setBreadcrumbBrowsePath", args: [null] },
    ]);
    const popover = byClass(open, "breadcrumbPopover");
    assert.equal(findAll(popover, (element) => hasClass(element, "breadcrumbBrowseHeader")).length, 0);
    const rows = findAll(popover, (element) => hasClass(element, "menuRow"));
    assert.deepEqual(rows.map((element) => element.key), [chapter1.path, chapter2.path, notes.path]);
    assert.deepEqual(rows.map((element) => element.props.draggable), [true, true, true]);
    assert.match(rows[0].props.className, /draggingBreadcrumbEntry/);
    assert.match(rows[1].props.className, /breadcrumbDrop-after/);
    assert.doesNotMatch(rows[2].props.className, /breadcrumbDrop|draggingBreadcrumbEntry/);
    const dragEvent = { kind: "drag-event" };
    for (const [handler, name] of [
      ["onDragStart", "handleBreadcrumbEntryDragStart"],
      ["onDragOver", "handleBreadcrumbEntryDragOver"],
      ["onDrop", "handleBreadcrumbEntryDrop"],
    ]) {
      expectCalls(handler, () => rows[1].props[handler](dragEvent), [
        { name, args: [dragEvent, part1.path, chapter2.path] },
      ]);
    }
    assert.equal(rows[1].props.onDragEnd, spies.handleBreadcrumbEntryDragEnd);
    exercised.add("handleBreadcrumbEntryDragEnd");

    const primary = (row) => byClass(row, "breadcrumbPrimaryMenuItem");
    assert.equal(primary(rows[0]).props.className, "activeMenuItem breadcrumbPrimaryMenuItem");
    assert.equal(primary(rows[1]).props.className, "breadcrumbPrimaryMenuItem");
    assert.equal(findOne(primary(rows[2]), (element) => element.type === AppIcon, "row icon").props.name, "folder");
    assert.equal(findOne(primary(rows[1]), (element) => element.type === AppIcon, "row icon").props.name, "file");
    expectCalls("メニューのファイル", () => primary(rows[1]).props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("メニューのファイル", [{ name: "handleProjectFileSelect", args: [chapter2.path] }]);
    expectCalls("メニューのフォルダ", () => primary(rows[2]).props.onClick(), [
      { name: "handleBreadcrumbFolderSelect", args: [notes.path] },
    ]);

    assert.equal(button(popover, "一章.md を上へ移動").props.disabled, true);
    assert.equal(button(popover, "二章.md を上へ移動").props.disabled, false);
    assert.equal(button(popover, "資料 を下へ移動").props.disabled, true);
    assert.equal(button(popover, "二章.md を下へ移動").props.disabled, false);
    expectCalls("上へ移動", () => button(popover, "二章.md を上へ移動").props.onClick(), [
      { name: "handleMoveProjectEntry", args: [part1.path, chapter2.path, -1] },
    ]);
    expectCalls("下へ移動", () => button(popover, "二章.md を下へ移動").props.onClick(), [
      { name: "handleMoveProjectEntry", args: [part1.path, chapter2.path, 1] },
    ]);
    expectCalls("リネーム", () => button(popover, "二章.md をリネーム").props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("リネーム", [{ name: "handleRenameProjectEntry", args: [chapter2] }]);
    expectCalls("削除", () => button(popover, "二章.md を削除").props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("削除", [{ name: "handleDeleteProjectEntry", args: [chapter2] }]);
    expectCalls("新規ファイルを作成", () => menuItem(popover, "新規ファイルを作成").props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("新規ファイルを作成", [{ name: "handleCreateProjectFile", args: [part1.path] }]);
    expectCalls("新規フォルダを作成", () => menuItem(popover, "新規フォルダを作成").props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("新規フォルダを作成", [{ name: "handleCreateProjectFolder", args: [part1.path] }]);

    // メニューの中でフォルダを辿ったとき
    const browsed = render({ activeBreadcrumbPath: part1.path, breadcrumbBrowsePath: notes.path });
    const browsedPopover = byClass(browsed, "breadcrumbPopover");
    assert.equal(textOf(byClass(browsedPopover, "breadcrumbBrowseFolderName")), "資料");
    const back = button(browsedPopover, "第一部 に戻る");
    expectCalls("辿った先から戻る", () => back.props.onClick(), [
      { name: "setBreadcrumbBrowsePath", args: [part1.path] },
    ]);
    assert.deepEqual(findAll(browsedPopover, (element) => hasClass(element, "menuRow")).map((element) => element.key), [person.path]);
    expectCalls("辿った先の新規ファイル", () => menuItem(browsedPopover, "新規ファイルを作成").props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("辿った先の新規ファイル", [{ name: "handleCreateProjectFile", args: [notes.path] }]);
    assert.equal(button(browsedPopover, "人物.md を上へ移動").props.disabled, true);
    expectCalls("辿った先の移動", () => button(browsedPopover, "人物.md を上へ移動").props.onClick(), [
      { name: "handleMoveProjectEntry", args: [notes.path, person.path, -1] },
    ]);
    expectCalls("辿った先のドラッグ", () => findOne(browsedPopover, (element) => hasClass(element, "menuRow"), "row")
      .props.onDrop(dragEvent), [{ name: "handleBreadcrumbEntryDrop", args: [dragEvent, notes.path, person.path] }]);

    const emptyTree = render({
      breadcrumbTrail: [projectFolder, empty],
      activeBreadcrumbPath: empty.path,
      breadcrumbBrowsePath: empty.path,
    });
    assert.equal(textOf(byClass(byClass(emptyTree, "breadcrumbPopover"), "emptyMenuMessage")),
      "テキストファイルまたはフォルダがありません");
  }

  // 作品のないとき
  {
    const tree = render({ projectFolder: null, breadcrumbTrail: [], currentFilePath: null });
    const switcher = button(tree, "プロジェクトを切り替え");
    assert.equal(textOf(switcher), mark("scratchWorkspaceName"));
    expectCalls("一時ファイルの切り替え", () => switcher.props.onClick(), [
      { name: "setActiveBreadcrumbPath", args: [null] },
      { name: "setBreadcrumbBrowsePath", args: [null] },
      { name: "setIsWorkspaceSwitcherOpen", args: ["<fn>"] },
    ]);
    expectToggle("一時ファイルの切り替え");
    assert.equal(textOf(byClass(tree, "activeCrumb")), mark("currentFileName"));
    assert.equal(findOne(tree, (element) => element.type === "div" && hasClass(element, "breadcrumbMenu"), "scratch menu")
      .props.className.includes("breadcrumbCollapsedSegment"), false);
    const minimal = render({ projectFolder: null, breadcrumbTrail: [], breadcrumbLayout: "minimal" });
    assert.ok(findOne(minimal, (element) => hasClass(element, "breadcrumbMenu") && !hasClass(element, "breadcrumbOverflowMenu"),
      "scratch menu").props.className.includes("breadcrumbCollapsedSegment"));

    const libraries = [{ path: "C:/書庫", name: "書庫", lastOpenedAt: 1, library: { name: "書庫", role: "root" } }];
    const open = render({ projectFolder: null, breadcrumbTrail: [], isWorkspaceSwitcherOpen: true, visibleKnownLibraries: libraries });
    const popover = byClass(open, "workspaceSwitcherPopover");
    assert.equal(textOf(byClass(popover, "workspaceSwitcherTitle")), mark("scratchWorkspaceName"));
    assert.deepEqual(
      findAll(popover, (element) => hasClass(element, "workspaceSwitcherSectionLabel")).map(textOf),
      ["最近開いたプロジェクト", "ライブラリ"],
    );
    const search = findOne(popover, (element) => element.type === "input", "search box");
    assert.equal(search.props.value, mark("workspaceSwitcherQuery"));
    expectCalls("一時ファイルの検索", () => search.props.onChange({ target: { value: "書" } }), [
      { name: "setWorkspaceSwitcherQuery", args: ["書"] },
    ]);
    const records = findAll(popover, (element) => hasClass(element, "workspaceRecordButton"));
    assert.deepEqual(records.map((element) => element.key), [root, "C:/lib/作品B", "C:/書庫"]);
    assert.equal(findAll(popover, (element) => hasClass(element, "workspaceRecordBadge")).length, 0);
    for (const [index, target] of [[0, root], [2, "C:/書庫"]]) {
      expectCalls(`一時ファイルから ${target}`, () => records[index].props.onClick(), [
        { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
      ]);
      expectDeferred(`一時ファイルから ${target}`, [{ name: "openWorkspace", args: [target] }]);
    }
    assert.equal(findOne(records[2], (element) => element.type === AppIcon, "library icon").props.name, "book");
    expectCalls("一時ファイルから別のフォルダ", () => menuItem(popover, "別のフォルダを開く...").props.onClick(), [
      { name: "closeBreadcrumbMenuAndRun", args: ["<fn>"] },
    ]);
    expectDeferred("一時ファイルから別のフォルダ", [{ name: "openWorkspace", args: [] }]);
    const noLibraries = render({ projectFolder: null, breadcrumbTrail: [], isWorkspaceSwitcherOpen: true });
    assert.deepEqual(
      findAll(noLibraries, (element) => hasClass(element, "workspaceSwitcherSectionLabel")).map(textOf),
      ["最近開いたプロジェクト"],
    );
    const noRecords = render({
      projectFolder: null, breadcrumbTrail: [], isWorkspaceSwitcherOpen: true, visibleRecentWorkspaces: [],
    });
    assert.equal(textOf(byClass(noRecords, "emptyMenuMessage")), "一致するプロジェクトがありません");
  }

  // 見出しのパンくずとアウトラインのメニュー
  {
    const outline = {
      outlineItems: [outlineParent, outlineChild],
      activeOutlineChain: [outlineParent, outlineChild],
      hasActiveOutlineBreadcrumb: true,
      filteredOutlineItems: [outlineParent, outlineChild],
    };
    const tree = render(outline);
    assert.equal(textOf(byClass(tree, "outlineSeparator")), "/");
    const crumbs = findAll(tree, (element) => hasClass(element, "outlineBreadcrumbSegment"));
    assert.deepEqual(crumbs.map((element) => element.key), ["h-1", "h-2"]);
    assert.deepEqual(crumbs.map((element) => textOf(element)), ["第一章", "›場面一"]);
    assert.deepEqual(
      ["第一章 のアウトライン", "場面一 のアウトライン"].map((label) => button(tree, label).props["aria-expanded"]),
      [false, false],
    );
    assert.equal(findAll(tree, (element) => hasClass(element, "outlinePopover")).length, 0);
    // 押した見出しを開き、開いている見出しをもう一度押すと閉じる。
    expectCalls("見出しのパンくず（場面一）", () => button(tree, "場面一 のアウトライン").props.onClick(), [
      { name: "setOpenOutlineMenuId", args: ["<fn>"] },
    ]);
    assert.equal(lastFunctionArg(null), "h-2", "a closed menu opens under the clicked heading");
    assert.equal(lastFunctionArg("h-1"), "h-2", "a menu open under another heading moves to the clicked heading");
    assert.equal(lastFunctionArg("h-2"), null, "the open heading closes its menu");
    expectCalls("見出しのパンくず（第一章）", () => button(tree, "第一章 のアウトライン").props.onClick(), [
      { name: "setOpenOutlineMenuId", args: ["<fn>"] },
    ]);
    assert.equal(lastFunctionArg(null), "h-1");
    assert.equal(findAll(render({ ...outline, currentFilePath: null }), (element) => hasClass(element, "outlineSeparator")).length, 0);
    assert.equal(findAll(render({ ...outline, outlineItems: [] }), (element) => hasClass(element, "outlineSeparator")).length, 0);

    // メニューは、押した見出しの下に開く。
    for (const [openId, index] of [["h-1", 0], ["h-2", 1]]) {
      const openTree = render({ ...outline, openOutlineMenuId: openId });
      const openCrumbs = findAll(openTree, (element) => hasClass(element, "outlineBreadcrumbSegment"));
      const openPopovers = findAll(openTree, (element) => hasClass(element, "outlinePopover"));
      assert.equal(openPopovers.length, 1, `one outline menu for ${openId}`);
      assert.ok(elementsOf(openCrumbs[index]).includes(openPopovers[0]), `the outline menu opens under ${openId}`);
      assert.deepEqual(
        ["第一章 のアウトライン", "場面一 のアウトライン"].map((label) => button(openTree, label).props["aria-expanded"]),
        [index === 0, index === 1],
      );
    }
    assert.equal(findAll(render({ ...outline, openOutlineMenuId: "h-gone" }), (element) => hasClass(element, "outlinePopover")).length, 0,
      "a heading that left the chain has no menu");

    const open = render({ ...outline, openOutlineMenuId: "h-2" });
    const popovers = findAll(open, (element) => hasClass(element, "outlinePopover"));
    assert.equal(popovers.length, 1);
    const search = findOne(popovers[0], (element) => element.type === "input", "outline search");
    assert.equal(search.props.value, mark("outlineQuery"));
    expectCalls("見出しの検索", () => search.props.onChange({ target: { value: "場" } }), [
      { name: "setOutlineQuery", args: ["場"] },
    ]);
    const items = findAll(popovers[0], (element) => hasClass(element, "outlineMenuItem"));
    assert.deepEqual(items.map((element) => element.key), ["h-1", "h-2"]);
    assert.deepEqual(items.map((element) => element.props.style.paddingLeft), ["10px", "28px"]);
    expectCalls("見出しへ移動", () => items[1].props.onClick(), [{ name: "jumpToOutlineItem", args: [outlineChild] }]);

    const compact = render({ ...outline, breadcrumbLayout: "compact" });
    assert.deepEqual(
      findAll(compact, (element) => hasClass(element, "outlineBreadcrumbSegment")).map((element) => hasClass(element, "breadcrumbCollapsedSegment")),
      [true, false],
    );
    assert.deepEqual(
      findAll(compact, (element) => hasClass(element, "outlineBreadcrumbSegment")).map((element) => textOf(element)),
      ["第一章", "場面一"],
    );
  }

  // 省いたパンくずの「…」
  {
    const overflowItems = [
      { kind: "folder", name: "第一部", path: part1.path },
      { kind: "file", name: "一章.md", path: chapter1.path },
      { kind: "outline", item: outlineParent },
      { kind: "scratch", name: "一時ファイル" },
    ];
    const minimal = render({ breadcrumbLayout: "minimal", breadcrumbOverflowItems: overflowItems });
    const navChildren = minimal.props.children.filter((child) => child && typeof child === "object" && "props" in child);
    assert.equal(navChildren[0].key, "breadcrumb-overflow-minimal", "minimal layout puts the overflow menu first");
    assert.deepEqual(
      segments(minimal).filter((element) => hasClass(element, "breadcrumbTrailSegment"))
        .map((element) => hasClass(element, "breadcrumbCollapsedSegment")),
      [true, true, false],
    );
    const overflowButton = button(minimal, "省略されたパンくずを表示");
    assert.equal(overflowButton.props["aria-expanded"], false);
    expectCalls("「…」", () => overflowButton.props.onClick(), [
      { name: "setActiveBreadcrumbPath", args: [null] },
      { name: "setBreadcrumbBrowsePath", args: [null] },
      { name: "setIsWorkspaceSwitcherOpen", args: [false] },
      { name: "setOpenOutlineMenuId", args: [null] },
      { name: "setIsBreadcrumbOverflowOpen", args: ["<fn>"] },
    ]);
    expectToggle("「…」");

    const compact = render({ breadcrumbLayout: "compact", breadcrumbOverflowItems: overflowItems });
    const overflowMenus = findAll(compact, (element) => hasClass(element, "breadcrumbOverflowMenu"));
    assert.deepEqual(overflowMenus.map((element) => element.key), ["breadcrumb-overflow-compact"]);
    const firstFragment = compact.props.children.flat().find((child) => child?.key === root);
    assert.ok(firstFragment, "the first crumb is wrapped with its overflow menu");
    assert.ok(elementsOf(firstFragment).includes(overflowMenus[0]), "compact layout puts the overflow menu after the first crumb");
    assert.equal(findAll(render({ breadcrumbLayout: "compact" }), (element) => hasClass(element, "breadcrumbOverflowMenu")).length, 0);

    const open = render({ breadcrumbLayout: "minimal", breadcrumbOverflowItems: overflowItems, isBreadcrumbOverflowOpen: true });
    assert.equal(button(open, "省略されたパンくずを表示").props["aria-expanded"], true);
    const items = findAll(byClass(open, "breadcrumbOverflowPopover"), (element) => element.props.role === "menuitem");
    assert.deepEqual(items.map((element) => element.key), [`folder:${part1.path}`, `file:${chapter1.path}`, "outline:h-1", "scratch"]);
    assert.deepEqual(items.map((element) => element.props.title), ["第一部", "一章.md", "第一章", "一時ファイル"]);
    assert.deepEqual(items.map((element) => textOf(byClass(element, "breadcrumbOverflowItemIcon"))), ["▸", "▤", "#", "⌂"]);
    const expectations = [
      { name: "handleBreadcrumbFolderSelect", args: [part1.path] },
      { name: "handleProjectFileSelect", args: [chapter1.path] },
      { name: "jumpToOutlineItem", args: [outlineParent] },
      { name: "openWorkspace", args: [] },
    ];
    items.forEach((item, index) => {
      expectCalls(`「…」の ${item.props.title}`, () => item.props.onClick(), [
        { name: "setIsBreadcrumbOverflowOpen", args: [false] },
        expectations[index],
      ]);
    });
  }
  expectExercised("TopbarBreadcrumbs", functionNames);
}

// --- App が帯のメニューを、帯の外のクリックと Escape で閉じる ---
// この処理は App の useEffect の中に残っているので、App.tsx からその部分を切り出して動かす。
// ref は「その要素の中か」だけを答える入れ物にし、state を書く関数は記録する入れ物にする。
{
  const app = await readFile("src/App.tsx", "utf8");
  const start = app.indexOf("    const handlePointerDown = (event: MouseEvent) => {");
  const end = app.indexOf('    window.addEventListener("pointerdown", handlePointerDown);', start);
  assert.ok(start >= 0 && end > start, "App must keep the menu dismiss handlers");
  const body = app.slice(start, end);
  const names = [...new Set(body.match(/\b(?:set[A-Z]\w*|\w+Ref)\b/g))];
  const { code } = await transform(
    `export default ({ ${names.join(", ")} }) => {\n${body}\nreturn { handlePointerDown, handleKeyDown };\n};`,
    { loader: "ts" },
  );
  const { default: createHandlers } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  globalThis.Node ??= class Node {};
  const targetIn = (owner) => Object.assign(new globalThis.Node(), { owner });
  const deps = Object.fromEntries(names.map((name) => [
    name,
    name.endsWith("Ref") ? { current: { contains: (target) => target.owner === name } } : spy(name),
  ]));
  const { handlePointerDown, handleKeyDown } = createHandlers(deps);
  const closesOutline = () => calls.some((call) => call.name === "setOpenOutlineMenuId" && call.args[0] === null);
  const closes = (name) => calls.some((call) => call.name === name && call.args[0] === false);

  calls.length = 0;
  handlePointerDown({ target: targetIn("breadcrumbMenuRef") });
  assert.equal(closesOutline(), false, "a click inside the breadcrumbs must keep the outline menu open");
  assert.equal(closes("setIsWorkspaceSwitcherOpen"), false, "a click inside the breadcrumbs keeps its menus");
  assert.equal(closes("setIsFileMenuOpen"), true, "a click outside the file menu closes it");

  calls.length = 0;
  handlePointerDown({ target: targetIn("editor") });
  assert.equal(closes("setIsFileMenuOpen"), true);
  assert.equal(closes("setIsModeMenuOpen"), true);
  assert.equal(closes("setIsWorkspaceSwitcherOpen"), true);
  assert.equal(closesOutline(), true, "a click outside the breadcrumbs must close the outline menu");

  calls.length = 0;
  handleKeyDown({ key: "Escape" });
  assert.equal(closes("setIsFileMenuOpen"), true);
  assert.equal(closes("setIsWorkspaceSwitcherOpen"), true);
  assert.equal(closesOutline(), true, "Escape must close the outline menu wherever the focus is");

  calls.length = 0;
  handleKeyDown({ key: "a" });
  assert.deepEqual(calls, [], "other keys close nothing");
}

// --- App は、本文の代わりに開始画面を出している間、テンプレート登録を押せなくする ---
// 開始画面を出す条件（本文の欄の JSX）と同じ式を渡していることを、文字で確かめる。
{
  const app = await readFile("src/App.tsx", "utf8");
  const startPage = 'isNewTabStartPage || activeTab?.kind === "empty"';
  assert.ok(app.includes(") : " + startPage + " ? ("), "App must show the start page on this condition");
  assert.ok(app.includes("canRegisterTemplate: !(" + startPage + "),"), "App must disable registration on the same condition");
}

console.log("topbar parts tests passed");
