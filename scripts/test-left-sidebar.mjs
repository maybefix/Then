// 左サイドバー（LeftSidebar）が、App から受け取った値と関数を、正しい相手に正しく渡すかを確かめる。
// LeftSidebar はフックを使わないので、関数として呼んで返ってきた要素の木をたどる。
// WorkspaceSidebar と OpenCardsPane は、受け取った props を見るだけの代わりの部品に差し替える。
// 値は名前ごとに違う目印にし、関数は呼ばれた名前と引数を記録する入れ物にして、
// 取り違え（たとえば「名前の変更」に削除の関数をつなぐこと）を、どの組でも見つけられるようにする。
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const stubPanes = {
  name: "stub-panes",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^(\.\/WorkspaceSidebar|\.\.\/binder\/OpenCardsPane)$/ }, (args) => ({
      path: args.path.endsWith("WorkspaceSidebar") ? "WorkspaceSidebar" : "OpenCardsPane",
      namespace: "stub-pane",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "stub-pane" }, (args) => ({
      contents: `export function ${args.path}() { return null; }`,
      loader: "js",
    }));
  },
};

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `left-sidebar-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: [
      'export { LeftSidebar } from "./LeftSidebar";',
      'export { WorkspaceSidebar } from "./WorkspaceSidebar";',
      'export { OpenCardsPane } from "../binder/OpenCardsPane";',
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
  plugins: [stubPanes],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
const { LeftSidebar, WorkspaceSidebar, OpenCardsPane } = await import(pathToFileURL(compiledPath).href)
  .finally(() => unlink(compiledPath));

// App の関数の代わり。呼ばれた名前と引数を順に記録する。
const calls = [];
const functionNames = [
  "setIsLeftSidebarCollapsed", "setLeftSidebarView", "handleNewDocument", "handleCreateProjectFolder",
  "handleOpenProjectFolder", "focusReferenceCard", "closeReferenceCard", "pinReferenceCard", "collapseReferenceCard",
  "handleSetFileProgress", "handleFolderCollapsedChange", "handleOutlineCollapsedChange",
  "handleOutlineHeadingCollapsedChange", "jumpToOutlineItem", "handleProjectOutlineJump", "handleHeadingMove",
  "handleHeadingExtract", "setProjectSearchQuery", "setProjectSearchUseRegex", "setProjectSearchMatchCase",
  "setSearchIncludeComments", "setSearchScope", "setProjectReplaceValue", "handleProjectSearchResultOpen",
  "handleReplaceInCurrentFile", "handleReplaceInProject", "handleCreateProjectFile", "handleProjectFileSelect",
  "handleProjectFolderSelect", "handleRenameProjectEntry", "handleDeleteProjectEntry",
  "handleMoveProjectEntriesToFolder", "handleSidebarEntryReorder", "updateSettings",
  "handleQuickCreateManuscriptSnapshot", "openCheckpointStudio", "handleEditManuscriptSnapshotDetails",
  "handleRestoreManuscriptSnapshot", "handleDeleteManuscriptSnapshot", "enterLibraryRoot", "enterProject",
  "handleCreateLibraryProject", "handleImportProjectIntoLibrary", "reorderLibraryProjects",
  "openIdeaPane", "handleCreateMaterialsFolder", "handleSetMaterialsFolder", "handleCorkboardFolderClick",
  // BINDER 2-5: 素材の段の資料（取り込む・資料カードで開く・消す）。
  "handleAddReference", "openReferenceCard", "handleDeleteImportedReference",
  // BINDER 2-6: 素材の段の画像・PDF の改名・移動。
  "handleRenameMaterialReference", "handleMoveMaterialReference", "handleTransferEntries", "handleSetNoteStar",
];
const spies = Object.fromEntries(
  functionNames.map((name) => [name, (...args) => {
    calls.push({ name, args });
    return Promise.resolve();
  }]),
);

// 値は、名前ごとに違う目印にする（真偽値も文字列の目印にして、2つの値の入れ替えを見分ける）。
const mark = (name) => `<${name}>`;
const baseValues = {
  appMode: "write",
  isLeftSidebarCollapsed: false,
  isEditorFocusMode: false,
  leftSidebarView: "files",
  projectFolder: { path: "C:/work", name: "work", children: [] },
  focusedFolderPath: "C:/work/第一部",
  referenceLayout: { cards: mark("referenceLayout.cards") },
  // BINDER 2-1: 投稿の段に出すのは、受信箱の投稿の数。
  postInboxCount: 3,
  // 素材の段には、画像・PDF だけを置かれたフォルダの中に並べる（BINDER 2-5、確認1の 7）。
  sortedReferenceCandidates: [
    { scope: "project", sourcePath: "素材/資料/map.png", name: "map.png", kind: "image", size: 1, imported: true },
    { scope: "project", sourcePath: "素材/資料/memo.md", name: "memo.md", kind: "markdown", size: 1, imported: true },
  ],
  currentFilePath: mark("currentFilePath"),
  currentFileName: mark("currentFileName"),
  charCount: mark("charCount"),
  outlineItems: mark("outlineItems"),
  activeOutlineIds: mark("activeOutlineIds"),
  activeOutlineChain: [{ blockId: "block-parent" }, { blockId: "block-active" }],
  projectAst: mark("projectAst"),
  settings: {
    countWhitespace: mark("settings.countWhitespace"),
    countCode: mark("settings.countCode"),
    showOutlineGuides: mark("settings.showOutlineGuides"),
    checkpointSectionCollapsed: mark("settings.checkpointSectionCollapsed"),
    showCheckpointSection: mark("settings.showCheckpointSection"),
  },
  appState: { fileProgress: mark("appState.fileProgress") },
  collapsedTreeFolderPaths: mark("collapsedTreeFolderPaths"),
  collapsedTreeOutlinePaths: mark("collapsedTreeOutlinePaths"),
  collapsedTreeOutlineHeadingKeys: mark("collapsedTreeOutlineHeadingKeys"),
  projectSearchQuery: mark("projectSearchQuery"),
  workspaceSearchOutcome: {
    results: mark("outcome.results"),
    total: mark("outcome.total"),
    matchedFileCount: mark("outcome.matchedFileCount"),
    truncated: mark("outcome.truncated"),
    error: mark("outcome.error"),
  },
  projectSearchUseRegex: mark("projectSearchUseRegex"),
  projectSearchMatchCase: mark("projectSearchMatchCase"),
  searchIncludeComments: mark("searchIncludeComments"),
  searchScope: mark("searchScope"),
  projectReplaceValue: mark("projectReplaceValue"),
  isProjectReplacing: mark("isProjectReplacing"),
  currentWorkspaceSnapshots: mark("currentWorkspaceSnapshots"),
  libraryContext: mark("libraryContext"),
  libraryCorpus: { isLoading: true },
  starredNotePaths: mark("starredNotePaths"),
  libraryReferencesFolderPath: mark("libraryReferencesFolderPath"),
};

const render = (overrides = {}) => LeftSidebar({ ...baseValues, ...spies, ...overrides });

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
const findOne = (tree, predicate, label) => {
  const matches = elementsOf(tree).filter(predicate);
  assert.equal(matches.length, 1, `${label} must appear exactly once`);
  return matches[0];
};
const button = (tree, label) =>
  findOne(tree, (element) => element.type === "button" && element.props["aria-label"] === label, `button ${label}`);

// 1つの操作で、決めた App の関数が、決めた引数で1回だけ呼ばれることを確かめる。
const expectCall = (label, action, name, args) => {
  calls.length = 0;
  action();
  assert.deepEqual(calls, [{ name, args }], `${label} must call ${name} once`);
};
const expectCalls = (label, action, expected) => {
  calls.length = 0;
  action();
  assert.deepEqual(calls, expected, `${label} must call ${expected.map((call) => call.name).join(", ")}`);
};

// --- 左の枠と、左端のボタン列 ---
{
  const tree = render();
  assert.equal(tree.type, "div");
  assert.match(tree.props.className, /^leftWorkspaceCluster /);
  assert.doesNotMatch(tree.props.className, /modeHiddenPane/);
  assert.equal(tree.props["data-sidebar-collapsed"], false);
  assert.equal(tree.props["aria-hidden"], false);
  assert.equal("inert" in tree.props, false);
  const nav = findOne(tree, (element) => element.type === "nav", "activity bar");
  assert.equal(nav.props["aria-label"], "左サイドバー操作");
  assert.deepEqual(
    elementsOf(nav).filter((element) => element.type === "button").map((element) => element.props["aria-label"]),
    ["ファイルツリー", "プロジェクト検索", "開いているカード", "新規ファイル", "新規フォルダ"],
  );
  assert.equal(button(tree, "ファイルツリー").props["aria-pressed"], true);
  assert.equal(button(tree, "プロジェクト検索").props["aria-pressed"], false);
  assert.equal(button(tree, "開いているカード").props["aria-pressed"], false);
  assert.match(button(tree, "ファイルツリー").props.className, /activeWorkspaceActivityButton/);

  for (const [label, view] of [["ファイルツリー", "files"], ["プロジェクト検索", "search"], ["開いているカード", "reference"]]) {
    expectCalls(label, () => button(tree, label).props.onClick(), [
      { name: "setIsLeftSidebarCollapsed", args: [false] },
      { name: "setLeftSidebarView", args: [view] },
    ]);
  }
  assert.equal(button(tree, "新規ファイル").props.onClick, spies.handleNewDocument);
  expectCall("新規フォルダ（選んだフォルダ）", () => button(tree, "新規フォルダ").props.onClick(),
    "handleCreateProjectFolder", ["C:/work/第一部"]);
  expectCall("新規フォルダ（選んだフォルダなし）",
    () => button(render({ focusedFolderPath: null }), "新規フォルダ").props.onClick(),
    "handleCreateProjectFolder", ["C:/work"]);
  expectCall("新規フォルダ（作品なし）",
    () => button(render({ projectFolder: null }), "新規フォルダ").props.onClick(),
    "handleOpenProjectFolder", []);
}

// 畳んだとき、ほかの画面、集中モード、プラグイン画面。
{
  const collapsed = render({ isLeftSidebarCollapsed: true });
  assert.equal(collapsed.props["data-sidebar-collapsed"], true);
  for (const label of ["ファイルツリー", "プロジェクト検索", "開いているカード"]) {
    assert.equal(button(collapsed, label).props["aria-pressed"], false, `${label} is not pressed while collapsed`);
    assert.doesNotMatch(button(collapsed, label).props.className, /activeWorkspaceActivityButton/);
  }
  for (const appMode of ["export", "checkpoint"]) {
    assert.match(render({ appMode }).props.className, /modeHiddenPane/, `${appMode} hides the left cluster`);
  }
  // BINDER 4-3: コルクボードと同じく、Canvas でもバインダーを出す（ノート・原稿をボードへドラッグするため）。
  for (const appMode of ["corkboard", "canvas"]) {
    const shown = render({ appMode });
    assert.doesNotMatch(shown.props.className, /modeHiddenPane/, `${appMode} shows the left cluster`);
    assert.equal(shown.props["aria-hidden"], false);
    assert.equal("inert" in shown.props, false);
  }
  const plugin = render({ appMode: "plugin" });
  assert.doesNotMatch(plugin.props.className, /modeHiddenPane/);
  assert.equal(plugin.props["aria-hidden"], true);
  assert.equal(plugin.props.inert, "");
  const focus = render({ isEditorFocusMode: true });
  assert.equal(focus.props["aria-hidden"], true);
  assert.equal(focus.props.inert, "");
}

// --- ファイルツリーと検索（WorkspaceSidebar）へのつなぎ ---
{
  const tree = render();
  assert.equal(elementsOf(tree).some((element) => element.type === OpenCardsPane), false);
  const sidebar = findOne(tree, (element) => element.type === WorkspaceSidebar, "WorkspaceSidebar");
  const props = sidebar.props;

  const expectedValues = {
    projectFolder: baseValues.projectFolder,
    starredNotePaths: mark("starredNotePaths"),
    libraryReferencesFolderPath: mark("libraryReferencesFolderPath"),
    materialReferences: [{ path: "C:/work/素材/資料/map.png", sourcePath: "素材/資料/map.png", name: "map.png", kind: "image" }],
    currentFilePath: mark("currentFilePath"),
    currentFileName: mark("currentFileName"),
    currentFileCharCount: mark("charCount"),
    focusedFolderPath: "C:/work/第一部",
    activeDocumentOutline: mark("outlineItems"),
    activeOutlineIds: mark("activeOutlineIds"),
    activeOutlineBlockId: "block-active",
    projectAst: mark("projectAst"),
    countWhitespace: mark("settings.countWhitespace"),
    countCode: mark("settings.countCode"),
    showOutlineGuides: mark("settings.showOutlineGuides"),
    fileProgress: mark("appState.fileProgress"),
    collapsedFolderPaths: mark("collapsedTreeFolderPaths"),
    collapsedOutlinePaths: mark("collapsedTreeOutlinePaths"),
    collapsedOutlineHeadingKeys: mark("collapsedTreeOutlineHeadingKeys"),
    projectSearchQuery: mark("projectSearchQuery"),
    projectSearchResults: mark("outcome.results"),
    projectSearchTotal: mark("outcome.total"),
    projectSearchMatchedFileCount: mark("outcome.matchedFileCount"),
    projectSearchTruncated: mark("outcome.truncated"),
    projectSearchError: mark("outcome.error"),
    projectSearchUseRegex: mark("projectSearchUseRegex"),
    projectSearchMatchCase: mark("projectSearchMatchCase"),
    projectSearchIncludeComments: mark("searchIncludeComments"),
    searchScope: mark("searchScope"),
    projectReplaceValue: mark("projectReplaceValue"),
    isProjectReplacing: mark("isProjectReplacing"),
    isProjectSearchMode: false,
    snapshots: mark("currentWorkspaceSnapshots"),
    isSnapshotSectionCollapsed: mark("settings.checkpointSectionCollapsed"),
    showSnapshotSection: mark("settings.showCheckpointSection"),
    library: mark("libraryContext"),
    isLibrarySearchLoading: true,
    postInboxCount: 3,
  };

  // 関数の props ごとに、渡す見本の引数と、届くべき App の関数と引数。
  const entry = { path: "C:/work/a.md", name: "a.md" };
  const snapshot = { id: "snapshot-1" };
  const heading = { path: "C:/work/a.md", line: 3, blockId: "h3", title: "見出し" };
  const expectedFunctions = {
    onSetFileProgress: { args: ["C:/work/a.md", "done"], name: "handleSetFileProgress" },
    onFolderCollapsedChange: { args: ["C:/work/第一部", true], name: "handleFolderCollapsedChange" },
    onOutlineCollapsedChange: { args: ["C:/work/a.md", false], name: "handleOutlineCollapsedChange" },
    onOutlineHeadingCollapsedChange: { args: ["heading-key", true], name: "handleOutlineHeadingCollapsedChange" },
    onJumpOutline: { args: [{ id: "outline-1" }], name: "jumpToOutlineItem" },
    onJumpProjectOutline: { args: ["C:/work/b.md", { line: 9 }], name: "handleProjectOutlineJump" },
    onMoveHeadings: {
      args: [[heading], "C:/work/b.md", 12, "h12", "after"],
      name: "handleHeadingMove",
    },
    onExtractHeading: { args: [heading], name: "handleHeadingExtract" },
    onProjectSearchQueryChange: { args: ["語"], name: "setProjectSearchQuery" },
    onProjectSearchUseRegexChange: { args: ["regex-flag"], name: "setProjectSearchUseRegex" },
    onProjectSearchMatchCaseChange: { args: ["case-flag"], name: "setProjectSearchMatchCase" },
    onProjectSearchIncludeCommentsChange: { args: ["comment-flag"], name: "setSearchIncludeComments" },
    onSearchScopeChange: { args: ["project"], name: "setSearchScope" },
    onProjectReplaceValueChange: { args: ["新しい語"], name: "setProjectReplaceValue" },
    onOpenProjectSearchResult: { args: [{ path: "C:/work/c.md", line: 4 }], name: "handleProjectSearchResultOpen" },
    onReplaceInCurrentFile: { args: [], name: "handleReplaceInCurrentFile" },
    onReplaceInProject: { args: [], name: "handleReplaceInProject" },
    onOpenProjectFolder: { args: [], name: "handleOpenProjectFolder" },
    onCreateFile: { args: ["C:/work/第二部"], name: "handleCreateProjectFile" },
    onCreateFolder: { args: ["C:/work/第三部"], name: "handleCreateProjectFolder" },
    onSelectFile: { args: ["C:/work/d.md"], name: "handleProjectFileSelect" },
    onSelectFolder: { args: ["C:/work/第四部"], name: "handleProjectFolderSelect" },
    onRenameEntry: { args: [entry], name: "handleRenameProjectEntry" },
    onDeleteEntry: { args: [entry], name: "handleDeleteProjectEntry" },
    onMoveEntry: {
      args: [["C:/work/a.md", "C:/work/b.md"], "C:/work/第一部", "C:/work/第一部/z.md", "before"],
      name: "handleMoveProjectEntriesToFolder",
    },
    onReorderEntry: {
      args: ["C:/work", ["C:/work/a.md"], "C:/work/b.md", "after"],
      name: "handleSidebarEntryReorder",
    },
    onSnapshotSectionCollapsedChange: {
      args: [true],
      name: "updateSettings",
      expectedArgs: ["checkpointSectionCollapsed", true],
    },
    onCreateSnapshot: { args: [], name: "handleQuickCreateManuscriptSnapshot" },
    onOpenSnapshot: { args: [snapshot], name: "openCheckpointStudio", expectedArgs: ["snapshot-1"] },
    onEditSnapshotDetails: { args: [snapshot], name: "handleEditManuscriptSnapshotDetails" },
    onRestoreSnapshot: { args: [snapshot], name: "handleRestoreManuscriptSnapshot" },
    onDeleteSnapshot: { args: [snapshot], name: "handleDeleteManuscriptSnapshot" },
    onCollapse: { args: [], name: "setIsLeftSidebarCollapsed", expectedArgs: [true] },
    onEnterLibraryRoot: { args: [], name: "enterLibraryRoot" },
    onEnterProject: { args: ["C:/library/作品2"], name: "enterProject" },
    onCreateLibraryProject: { args: [], name: "handleCreateLibraryProject" },
    onImportProject: { args: [], name: "handleImportProjectIntoLibrary" },
    onReorderLibraryProjects: {
      args: [["C:/library/作品2", "C:/library/作品1"]],
      name: "reorderLibraryProjects",
    },
    onOpenIdeas: { args: [], name: "openIdeaPane" },
    onCreateMaterialsFolder: { args: [], name: "handleCreateMaterialsFolder" },
    onSetMaterialsFolder: { args: ["C:/work/資料"], name: "handleSetMaterialsFolder" },
    onImportReferences: { args: [], name: "handleAddReference" },
    onOpenReference: {
      args: [{ path: "C:/work/素材/資料/map.png", sourcePath: "素材/資料/map.png", name: "map.png", kind: "image" }],
      name: "openReferenceCard",
      expectedArgs: ["素材/資料/map.png", baseValues.sortedReferenceCandidates[0], { switchToReferenceTab: false }],
    },
    onDeleteReference: {
      args: [{ path: "C:/work/素材/資料/map.png", sourcePath: "素材/資料/map.png", name: "map.png", kind: "image" }],
      name: "handleDeleteImportedReference",
      expectedArgs: ["素材/資料/map.png"],
    },
    onRenameReference: { args: [{ path: "C:/work/素材/資料/map.png", sourcePath: "素材/資料/map.png", name: "map.png", kind: "image" }], name: "handleRenameMaterialReference" },
    onMoveReference: {
      args: [{ path: "C:/work/素材/資料/map.png", sourcePath: "素材/資料/map.png", name: "map.png", kind: "image" }, "C:/work/素材/年表"],
      name: "handleMoveMaterialReference",
    },
    // U5: 素材のノート・画像・PDF をほかの作品・直下へ送る（ライブラリの中でだけ渡す）。
    onTransferEntries: { args: [["C:/work/素材/人物.md"]], name: "handleTransferEntries" },
    // U10: ノートのスターを付ける・外す。
    onSetNoteStar: { args: ["C:/work/素材/人物.md", true], name: "handleSetNoteStar" },
    // BINDER 1-5: コルクボード中のフォルダの行のクリック。
    onFolderClick: { args: ["C:/work/第一部"], name: "handleCorkboardFolderClick" },
  };

  // 渡している props が、確かめる表と過不足なく一致すること（足したのに確かめていない、を防ぐ）。
  assert.deepEqual(
    Object.keys(props).sort(),
    [...Object.keys(expectedValues), ...Object.keys(expectedFunctions)].sort(),
  );
  for (const [key, value] of Object.entries(expectedValues)) {
    assert.deepEqual(props[key], value, `WorkspaceSidebar.${key}`);
  }
  for (const [key, expected] of Object.entries(expectedFunctions)) {
    assert.equal(typeof props[key], "function", `WorkspaceSidebar.${key} is a function`);
    expectCall(`WorkspaceSidebar.${key}`, () => props[key](...expected.args), expected.name,
      expected.expectedArgs ?? expected.args);
  }
  expectCall("WorkspaceSidebar.onOpenSnapshot(null)", () => props.onOpenSnapshot(null), "openCheckpointStudio", [undefined]);

  const searching = findOne(render({ leftSidebarView: "search" }), (element) => element.type === WorkspaceSidebar,
    "WorkspaceSidebar while searching");
  assert.equal(searching.props.isProjectSearchMode, true);
  assert.equal(button(render({ leftSidebarView: "search" }), "プロジェクト検索").props["aria-pressed"], true);
  const noOutline = findOne(render({ activeOutlineChain: [] }), (element) => element.type === WorkspaceSidebar,
    "WorkspaceSidebar without an active heading");
  assert.equal(noOutline.props.activeOutlineBlockId, null);
  const notLoading = findOne(render({ libraryCorpus: null }), (element) => element.type === WorkspaceSidebar,
    "WorkspaceSidebar without a library corpus");
  assert.equal(notLoading.props.isLibrarySearchLoading, false);
}

// --- 開いているカード（OpenCardsPane）へのつなぎ ---
{
  const tree = render({ leftSidebarView: "reference" });
  assert.equal(elementsOf(tree).some((element) => element.type === WorkspaceSidebar), false);
  assert.equal(button(tree, "開いているカード").props["aria-pressed"], true);
  const aside = findOne(tree, (element) => element.type === "aside", "reference sidebar");
  assert.equal(aside.props.className, "workspaceSidebar referenceWorkspaceSidebar");
  assert.equal(aside.props["aria-label"], "開いているカード");
  expectCall("左サイドバーを畳む", () => button(tree, "左サイドバーを畳む").props.onClick(),
    "setIsLeftSidebarCollapsed", [true]);

  const pane = findOne(tree, (element) => element.type === OpenCardsPane, "OpenCardsPane");
  assert.deepEqual(Object.keys(pane.props).sort(),
    ["candidates", "cards", "onCloseCard", "onCollapseCard", "onFocusCard", "onPinCard"]);
  assert.equal(pane.props.cards, mark("referenceLayout.cards"));
  assert.equal(pane.props.candidates, baseValues.sortedReferenceCandidates);
  for (const [key, args, name] of [
    ["onFocusCard", ["card-1"], "focusReferenceCard"],
    ["onCloseCard", ["card-2"], "closeReferenceCard"],
    ["onPinCard", ["card-3", true], "pinReferenceCard"],
    ["onCollapseCard", ["card-4", false], "collapseReferenceCard"],
  ]) {
    expectCall(`OpenCardsPane.${key}`, () => pane.props[key](...args), name, args);
  }
}

// --- ビューと畳みの保存と復元（再起動しても戻る。右サイドバーのタブと同じく、アプリ全体で1つ） ---
{
  const statePath = "src/utils/leftSidebarState.ts";
  assert.ok(existsSync(statePath), "the left sidebar view and collapse are read back through leftSidebarState.ts");
  const stateCode = ts.transpileModule(await readFile(statePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const state = await import(`data:text/javascript;base64,${Buffer.from(stateCode).toString("base64")}`);
  for (const view of ["files", "search", "reference"]) assert.equal(state.normalizeLeftSidebarView(view), view);
  // 古い状態（項目なし）と知らない値は、ファイルツリー・開いた状態として読む。
  for (const value of [undefined, null, "", "plugin:x", 1]) {
    assert.equal(state.normalizeLeftSidebarView(value), "files", `view ${JSON.stringify(value)}`);
  }
  assert.equal(state.normalizeLeftSidebarCollapsed(true), true);
  for (const value of [undefined, null, false, "true", 1]) {
    assert.equal(state.normalizeLeftSidebarCollapsed(value), false, `collapsed ${JSON.stringify(value)}`);
  }
  // BINDER 4-3: Canvas の畳みは別に覚え、古い状態（項目なし）では畳んだ状態として読む。
  assert.equal(state.normalizeCanvasLeftSidebarCollapsed(false), false);
  for (const value of [undefined, null, true, "false", 0]) {
    assert.equal(state.normalizeCanvasLeftSidebarCollapsed(value), true, `canvas collapsed ${JSON.stringify(value)}`);
  }
  // 画面ごとの畳み: Canvas は Canvas の値、ほかは本文の値。ホバー表示の設定では Canvas でも畳まない（重ねて出す）。
  const collapsedIn = (appMode, collapsed, canvasCollapsed, hoverSidebar) =>
    state.isLeftSidebarCollapsedIn(appMode, { collapsed, canvasCollapsed, hoverSidebar });
  for (const appMode of ["write", "corkboard", "plugin"]) {
    assert.equal(collapsedIn(appMode, true, false, false), true, `${appMode} uses the body's state`);
    assert.equal(collapsedIn(appMode, false, true, false), false, `${appMode} ignores the Canvas state`);
  }
  assert.equal(collapsedIn("canvas", false, true, false), true, "the Canvas uses its own state");
  assert.equal(collapsedIn("canvas", true, false, false), false, "the Canvas ignores the body's state");
  assert.equal(collapsedIn("canvas", false, true, true), false, "with the hover setting the Canvas binder floats instead");

  // App が、読み込み・起動時の復元・変えたときの保存をつないでいること（App は大きく node で組めないので、ソースで見る）。
  // 保存状態の正規化（normalizeState）は storedStateModel.ts へ移した。
  const app = [
    await readFile("src/App.tsx", "utf8"),
    await readFile("src/storedStateModel.ts", "utf8"),
  ].join("\n");
  assert.match(app, /leftSidebarView: normalizeLeftSidebarView\(value\?\.leftSidebarView\)/);
  assert.match(app, /leftSidebarCollapsed: normalizeLeftSidebarCollapsed\(value\?\.leftSidebarCollapsed\)/);
  assert.match(app, /setLeftSidebarViewState\(state\.leftSidebarView\)/);
  assert.match(app, /setIsLeftSidebarCollapsedState\(state\.leftSidebarCollapsed\)/);
  assert.match(app, /current\.leftSidebarView === view/);
  assert.match(app, /current\.leftSidebarCollapsed === collapsed/);
  // 画面の値を直接書くのは、保存もする関数と起動時の復元の2か所だけ（ほかの変更は全部、保存する関数を通る）。
  assert.equal(app.match(/setLeftSidebarViewState\(/g)?.length, 2, "only the saving setter and the restore set the view");
  assert.equal(app.match(/setIsLeftSidebarCollapsedState\(/g)?.length, 2, "only the saving setter and the restore set the collapse");
  assert.match(app, /canvasLeftSidebarCollapsed: normalizeCanvasLeftSidebarCollapsed\(value\?\.canvasLeftSidebarCollapsed\)/);
  assert.match(app, /setIsCanvasLeftSidebarCollapsedState\(state\.canvasLeftSidebarCollapsed\)/);
  assert.match(app, /current\.canvasLeftSidebarCollapsed === collapsed/);
  assert.equal(app.match(/setIsCanvasLeftSidebarCollapsedState\(/g)?.length, 2, "only the saving setter and the restore set the Canvas collapse");
}

console.log("left sidebar tests passed");
