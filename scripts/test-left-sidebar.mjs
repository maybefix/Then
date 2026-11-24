// 左サイドバー（LeftSidebar）が、App から受け取った値と関数を、正しい相手に正しく渡すかを確かめる。
// LeftSidebar はフックを使わないので、関数として呼んで返ってきた要素の木をたどる。
// WorkspaceSidebar は、受け取った props を見るだけの代わりの部品に差し替える。
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
    pluginBuild.onResolve({ filter: /^\.\/WorkspaceSidebar$/ }, () => ({
      path: "WorkspaceSidebar",
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
const { LeftSidebar, WorkspaceSidebar } = await import(pathToFileURL(compiledPath).href)
  .finally(() => unlink(compiledPath));

// App の関数の代わり。呼ばれた名前と引数を順に記録する。
const calls = [];
const functionNames = [
  "onAddToCanvas", "handleCreateProjectFolder", "handleOpenProjectFolder",
  "handleSetFileProgress", "handleFolderCollapsedChange", "handleOutlineCollapsedChange",
  "handleOutlineHeadingCollapsedChange", "jumpToOutlineItem", "handleProjectOutlineJump", "handleHeadingMove",
  "handleHeadingExtract", "handleCreateProjectFile", "handleProjectFileSelect",
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
  outlineScope: "all",
  panelVisible: true,
  projectFolder: { path: "C:/work", name: "work", children: [] },
  focusedFolderPath: "C:/work/第一部",
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
  currentWorkspaceSnapshots: mark("currentWorkspaceSnapshots"),
  libraryContext: mark("libraryContext"),
  starredNotePaths: mark("starredNotePaths"),
  libraryReferencesFolderPath: mark("libraryReferencesFolderPath"),
};

const render = (overrides = {}) => LeftSidebar({ ...baseValues, ...spies, ...overrides });

// 1つの操作で、決めた App の関数が、決めた引数で1回だけ呼ばれることを確かめる。
const expectCall = (label, action, name, args) => {
  calls.length = 0;
  action();
  assert.deepEqual(calls, [{ name, args }], `${label} must call ${name} once`);
};
{
  const pane = render({ outlineScope: "current", panelVisible: false });
  assert.equal(pane.type, WorkspaceSidebar);
  assert.equal(pane.props.outlineScope, "current");
  assert.equal(pane.props.panelHidden, true);
}

// --- ファイルツリー（WorkspaceSidebar）へのつなぎ ---
{
  const sidebar = render();
  assert.equal(sidebar.type, WorkspaceSidebar);
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
    outlineScope: "all",
    panelHidden: false,
    snapshots: mark("currentWorkspaceSnapshots"),
    isSnapshotSectionCollapsed: mark("settings.checkpointSectionCollapsed"),
    showSnapshotSection: mark("settings.showCheckpointSection"),
    library: mark("libraryContext"),
    postInboxCount: 3,
  };

  // 関数の props ごとに、渡す見本の引数と、届くべき App の関数と引数。
  const entry = { path: "C:/work/a.md", name: "a.md" };
  const snapshot = { id: "snapshot-1" };
  const heading = { path: "C:/work/a.md", line: 3, blockId: "h3", title: "見出し" };
  const expectedFunctions = {
    onAddToCanvas: { args: [{ paths: ["C:/work/a.md"] }], name: "onAddToCanvas" },
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
      expectedArgs: ["素材/資料/map.png", baseValues.sortedReferenceCandidates[0]],
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

  const noOutline = render({ activeOutlineChain: [] });
  assert.equal(noOutline.props.activeOutlineBlockId, null);
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
  assert.match(app, /state\.leftSidebarCollapsed \? null : "files"/);
  // 画面の値を直接書くのは、保存もする関数と起動時の復元の2か所だけ（ほかの変更は全部、保存する関数を通る）。
  assert.match(app, /canvasLeftSidebarCollapsed: normalizeCanvasLeftSidebarCollapsed\(value\?\.canvasLeftSidebarCollapsed\)/);
}

console.log("left sidebar tests passed");
