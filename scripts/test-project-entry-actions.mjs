import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

// App.tsx から移した、作品のファイルとフォルダの操作（新規・名前の変更・削除・移動・並べ替え）を、
// 実際に動かして確かめる（docs/PROJECT_ENTRY_ACTIONS_SEPARATION_PLAN.md）。
// Rust の命令（invoke）と App の値・道具は入れ物で代える。保存ジャーナルは同じ束の中のものを使い、
// 書きかけの記録の片付けを確かめる（docs/PROJECT_ENTRY_RETARGET_FIX_PLAN.md）。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/projectEntryActions.ts"; export { recordDocumentChange } from "./src/editor/saveJournal.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  define: { "import.meta.env.DEV": "false" },
  plugins: [
    {
      name: "invoke-stub",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "invoke", namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export const invoke = (command, args) => globalThis.__projectEntryInvoke(command, args);",
          loader: "js",
        }));
      },
    },
  ],
});
const { createProjectEntryActions, recordDocumentChange } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const ROOT = "C:\\Novel";
const p = (...parts) => [ROOT, ...parts].join("\\");
const file = (path) => ({ path, name: path.split("\\").pop(), kind: "file", children: [] });
const folder = (path, children) => ({ path, name: path.split("\\").pop(), kind: "folder", children });
const projectFolder = (children) => ({ path: ROOT, name: "Novel", children });
const tab = (path, { markdown = "本文", savedMarkdown = markdown, saveStatus = "saved" } = {}) => ({
  id: `file:${path}`,
  kind: "file",
  path,
  fileId: null,
  contentHash: null,
  name: path.split("\\").pop(),
  markdown,
  savedMarkdown,
  editorRevision: null,
  saveStatus,
  documentKey: path,
  activeOutlineLine: null,
  viewportState: null,
});
const referenceCard = (sourcePath) => ({
  id: `card-${sourcePath}`,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  zIndex: 1,
  scope: "project",
  sourcePath,
  kind: "text",
});
const referenceFile = (sourcePath) => ({
  scope: "project",
  sourcePath,
  name: sourcePath.split("/").pop(),
  kind: "text",
  size: 1,
  imported: false,
});
// 見出しの開閉の記録の名前。サイドバーは `<ファイル>:<見出しの id>` で覚え、見出しの id も
// `<ファイル>:<行>:<階層>:<見出しの文字のハッシュ>` なので、ファイルの場所が2回入る。
const headingKey = (path) => `${path}:${path}:3:1:abcd1234`;
const closedTab = (path) => ({ workspacePath: ROOT, path, index: 0, viewportState: null });

// 第一章\a.txt（開いている、未保存）、第一章\b.txt、c.txt の作品。
function defaultWorld() {
  return {
    projectFolder: projectFolder([
      folder(p("第一章"), [file(p("第一章", "a.txt")), file(p("第一章", "b.txt"))]),
      file(p("c.txt")),
    ]),
    openTabs: [
      tab(p("第一章", "a.txt"), { markdown: "A2", savedMarkdown: "A1", saveStatus: "dirty" }),
      tab(p("c.txt")),
    ],
    activeTabId: `file:${p("第一章", "a.txt")}`,
  };
}

// App の値と道具の代わり。操作のたびに最新の値で createProjectEntryActions を作り直す（App の描画と同じ形）。
function setup(world = defaultWorld(), { tauri = true } = {}) {
  globalThis.window = tauri ? { __TAURI_INTERNALS__: {} } : {};
  const app = {
    projectFolder: world.projectFolder,
    openTabs: world.openTabs,
    activeTabId: world.activeTabId,
    appState: {
      markdown: "A2",
      lastFilePath: p("第一章", "a.txt"),
      fileProgress: { [p("第一章", "a.txt")]: "writing", [p("c.txt")]: "done" },
      cursorPositions: { [p("第一章", "a.txt")]: { offset: 1, length: 0 }, [p("c.txt")]: { offset: 2, length: 0 } },
      // サイドバーのフォルダの開閉、ファイルの見出しの一覧の開閉、見出しごとの開閉（作品ごと）。
      collapsedFolderPathsByWorkspace: { [ROOT]: [p("第一章")] },
      collapsedOutlinePathsByWorkspace: { [ROOT]: [p("第一章", "a.txt"), p("c.txt")] },
      collapsedOutlineHeadingKeysByWorkspace: { [ROOT]: [headingKey(p("第一章", "a.txt")), headingKey(p("c.txt"))] },
    },
    referenceLayout: {
      cards: [referenceCard("第一章/a.txt"), referenceCard("c.txt")],
      recent: [referenceFile("第一章/a.txt")],
    },
    referenceCandidates: [referenceFile("第一章/a.txt"), referenceFile("c.txt")],
    // 校正で「無視」にした指摘（作品からの相対パスごと）と、閉じたタブを開き直すための記録。
    proofreadIgnored: { "第一章/a.txt": ["ignore-a"], "c.txt": ["ignore-c"] },
    closedDocumentTabs: [closedTab(p("第一章", "a.txt")), closedTab(p("c.txt"))],
    projectAst: null,
    focusedFolderPath: p("第一章"),
    activeBreadcrumbPath: null,
    breadcrumbBrowsePath: null,
    collapsedWorkspaceFolderPaths: new Set([p("第一章")]),
    breadcrumbDropTarget: null,
    draggingBreadcrumbEntryPath: null,
    saveStatus: "dirty",
    lastError: "",
    toasts: [],
    log: [],
    inputs: [],
    inputAnswers: [],
    confirms: [],
    confirmAnswers: [],
    createFileAnswer: null,
    loaded: [],
    replaced: [],
    anchorRetargets: [],
    persistedAnchors: null,
    refreshedFolder: null,
    commands: {},
    journal: [],
    sequence: [],
  };
  const refs = {
    activeTabIdRef: { current: app.activeTabId },
    projectEntryPathChangeInProgressRef: { current: false },
    pluginAnchorsRef: {
      current: [
        { id: "x", documentPath: "第一章/a.txt" },
        { id: "y", documentPath: "c.txt" },
      ],
    },
    didMountEditorRef: { current: true },
    lastSavedMarkdownRef: { current: "A1" },
    breadcrumbDragEntryRef: { current: null },
    projectAstBuildIdRef: { current: 0 },
  };
  const setter = (key) => (next) => {
    app[key] = typeof next === "function" ? next(app[key]) : next;
  };
  globalThis.__projectEntryInvoke = async (command, args) => {
    app.sequence.push(command);
    if (command.startsWith("journal_")) {
      app.journal.push({ command, ...args });
      return undefined;
    }
    app.log.push({ command, args, pathChanging: refs.projectEntryPathChangeInProgressRef.current });
    const handler = app.commands[command];
    if (!handler) throw new Error(`unexpected invoke ${command}`);
    return handler(args);
  };
  const actions = () => {
    const activeTab = app.openTabs.find((item) => item.id === app.activeTabId) ?? null;
    return createProjectEntryActions({
      projectFolder: app.projectFolder,
      setProjectFolder: setter("projectFolder"),
      openTabs: app.openTabs,
      setOpenTabs: setter("openTabs"),
      activeTab,
      activeTabIdRef: refs.activeTabIdRef,
      setActiveTabId: (next) => {
        setter("activeTabId")(next);
        refs.activeTabIdRef.current = app.activeTabId;
      },
      currentFilePath: activeTab?.path ?? null,
      focusedFolderPath: app.focusedFolderPath,
      setFocusedFolderPath: setter("focusedFolderPath"),
      activeBreadcrumbPath: app.activeBreadcrumbPath,
      setActiveBreadcrumbPath: setter("activeBreadcrumbPath"),
      setBreadcrumbBrowsePath: setter("breadcrumbBrowsePath"),
      setCollapsedWorkspaceFolderPaths: setter("collapsedWorkspaceFolderPaths"),
      breadcrumbDropTarget: app.breadcrumbDropTarget,
      setBreadcrumbDropTarget: setter("breadcrumbDropTarget"),
      setDraggingBreadcrumbEntryPath: setter("draggingBreadcrumbEntryPath"),
      breadcrumbDragEntryRef: refs.breadcrumbDragEntryRef,
      setAppState: setter("appState"),
      setReferenceLayout: setter("referenceLayout"),
      setReferenceCandidates: setter("referenceCandidates"),
      setProjectAst: setter("projectAst"),
      projectAstBuildIdRef: refs.projectAstBuildIdRef,
      projectEntryPathChangeInProgressRef: refs.projectEntryPathChangeInProgressRef,
      pluginAnchorsRef: refs.pluginAnchorsRef,
      persistPluginAnchors: (anchors) => {
        app.persistedAnchors = anchors;
      },
      retargetPluginAnchors: (oldPath, newPath) => app.anchorRetargets.push([oldPath, newPath]),
      didMountEditorRef: refs.didMountEditorRef,
      lastSavedMarkdownRef: refs.lastSavedMarkdownRef,
      // 保存の印は今のタブの状態。ファイルの操作が書いたら、書いた値を順に記録する。
      setSaveStatus: (status) => {
        app.saveStatus = status;
        (app.saveStatusCalls ??= []).push(status);
      },
      setLastError: setter("lastError"),
      showToast: (message, action) => {
        app.toasts.push(message);
        (app.toastActions ??= []).push(action ?? null);
      },
      requestMultiInput: async (options) => {
        (app.multiInputs ??= []).push(options);
        return app.multiInputAnswer ?? null;
      },
      movePostNotes: async (sourceRoot, targetRoot, changes) => {
        (app.postNoteMoves ??= []).push([sourceRoot, targetRoot, changes]);
      },
      requestInput: async (options) => {
        app.inputs.push(options);
        return app.inputAnswers.shift() ?? null;
      },
      requestConfirm: async (options) => {
        app.confirms.push(options);
        return app.confirmAnswers.shift() ?? false;
      },
      requestCreateFile: async (templates) => {
        app.log.push({ command: "(create file dialog)", args: templates });
        return app.createFileAnswer;
      },
      loadTextTemplates: async () => [{ id: "t1", name: "章", scope: "workspace", extension: "txt" }],
      enqueueDocumentSave: async (request) => {
        app.log.push({ command: "(save)", args: request });
        return { path: request.path, name: request.path.split("\\").pop(), content: request.content };
      },
      refreshProjectFolder: async (folderPath) => {
        app.log.push({ command: "(refresh)", args: folderPath });
        if (app.refreshedFolder) app.projectFolder = app.refreshedFolder;
        return app.projectFolder;
      },
      loadDocumentIntoEditor: (document, options) => app.loaded.push({ document, options }),
      replaceActiveTab: (nextTab) => app.replaced.push(nextTab),
      setProjectProofreadIgnored: setter("proofreadIgnored"),
      setClosedDocumentTabs: setter("closedDocumentTabs"),
      retargetPostNotes: (rootPath, changes) => (app.postNoteRetargets ??= []).push([rootPath, changes]),
      notifyCanvasPathChanges: (rootPath, changes) => (app.canvasPathChanges ??= []).push([rootPath, changes]),
    });
  };
  return { app, refs, actions };
}

const commandsOf = (app) => app.log.map((entry) => entry.command);
// ファイルの操作は、今のタブの保存の印に触らない（印を書くのは保存の処理だけ）。
const assertSaveMarkUntouched = (app, label) =>
  assert.deepEqual(app.saveStatusCalls ?? [], [], `${label}: the save mark of the open tab is left to the save itself`);
// 書きかけの記録（保存ジャーナル）を、タブの名前で作っておく。本文を1度書き換えたのと同じ。
const recordEdit = (path) => recordDocumentChange(`file:${path}`, path, "前", "後");
const forgotten = (app) => app.journal.filter((entry) => entry.command === "journal_forget").map(({ key, discard }) => ({ key, discard }));

// ---- 名前の変更（ファイル） ----
{
  const { app, refs, actions } = setup();
  const oldPath = p("第一章", "a.txt");
  const newPath = p("第一章", "a2.txt");
  recordEdit(oldPath);
  recordEdit(p("c.txt"));
  app.inputAnswers.push("a2.txt");
  app.commands.rename_project_entry = () => ({ path: newPath, name: "a2.txt", content: "A2", fileId: "f1", contentHash: "h2" });
  await actions().handleRenameProjectEntry(file(oldPath));

  assert.equal(app.inputs[0].label, "テキストファイル名");
  assert.equal(app.inputs[0].initialValue, "a.txt");
  assert.deepEqual(commandsOf(app), ["(save)", "rename_project_entry", "(refresh)"], "dirty tabs are saved before the rename");
  assert.deepEqual(app.log[0].args, { tabId: `file:${oldPath}`, path: oldPath, content: "A2" });
  assert.deepEqual(app.log[1].args, { path: oldPath, name: "a2.txt" });
  assert.ok(app.sequence.indexOf("journal_forget") < app.sequence.indexOf("rename_project_entry"), "the old record is closed while the file is still where it was (closing checks the file)");
  assert.equal(app.log[1].pathChanging, true, "autosave is held while the path changes");
  assert.equal(refs.projectEntryPathChangeInProgressRef.current, false);
  assert.equal(app.log[2].args, p("第一章"));

  const renamed = app.openTabs[0];
  assert.equal(renamed.id, `file:${newPath}`);
  assert.equal(renamed.path, newPath);
  assert.equal(renamed.name, "a2.txt");
  assert.equal(renamed.fileId, "f1");
  assert.equal(renamed.contentHash, "h2");
  assert.equal(renamed.markdown, "A2");
  assert.equal(renamed.savedMarkdown, "A2");
  assert.equal(renamed.saveStatus, "saved");
  assert.equal(renamed.documentKey, newPath);
  assert.deepEqual(app.openTabs[1], tab(p("c.txt")), "other tabs are left alone");
  assert.equal(app.activeTabId, `file:${newPath}`);

  assert.equal(app.appState.lastFilePath, newPath);
  assert.equal(app.appState.markdown, "A2");
  assert.equal(refs.lastSavedMarkdownRef.current, "A2");
  assert.deepEqual(app.appState.fileProgress, { [newPath]: "writing", [p("c.txt")]: "done" });
  assert.deepEqual(Object.keys(app.appState.cursorPositions), [newPath, p("c.txt")]);
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["第一章/a2.txt", "c.txt"]);
  assert.deepEqual(app.referenceLayout.recent.map((item) => [item.sourcePath, item.name]), [["第一章/a2.txt", "a2.txt"]]);
  assert.deepEqual(app.referenceCandidates.map((item) => item.sourcePath), ["第一章/a2.txt", "c.txt"]);
  assert.deepEqual(app.anchorRetargets, [[oldPath, newPath]]);
  assert.deepEqual(app.postNoteRetargets, [[ROOT, [{ oldPath, newPath }]]], "links from posts to notes follow the rename (BINDER 2-3)");
  assert.equal(app.focusedFolderPath, p("第一章"));
  assert.deepEqual([...app.collapsedWorkspaceFolderPaths], [p("第一章")], "a file rename leaves folders alone");
  assert.equal(refs.projectAstBuildIdRef.current, 1);
  assert.equal(app.projectAst, null);
  assertSaveMarkUntouched(app, "rename");
  assert.deepEqual(app.appState.collapsedOutlinePathsByWorkspace[ROOT], [newPath, p("c.txt")]);
  assert.deepEqual(
    app.appState.collapsedOutlineHeadingKeysByWorkspace[ROOT],
    [headingKey(newPath), headingKey(p("c.txt"))],
    "both copies of the file path in a heading key follow the rename",
  );
  assert.deepEqual(app.proofreadIgnored, { "第一章/a2.txt": ["ignore-a"], "c.txt": ["ignore-c"] });
  assert.deepEqual(app.closedDocumentTabs.map((record) => record.path), [newPath, p("c.txt")]);
  assert.deepEqual(
    forgotten(app),
    [{ key: `file:${oldPath}`, discard: false }],
    "the record kept under the tab's old name is closed (kept only if something was not saved)",
  );
  assert.deepEqual(app.toasts, ["「a.txt」をリネームしました"]);
}

// ---- 名前の変更（フォルダ） ----
{
  const { app, actions } = setup();
  recordEdit(p("第一章", "a.txt"));
  app.inputAnswers.push("第1章");
  app.commands.rename_project_entry = () => ({ path: p("第1章"), name: "第1章", content: "" });
  await actions().handleRenameProjectEntry(folder(p("第一章"), []));

  assert.equal(app.inputs[0].label, "フォルダ名");
  assert.equal(app.openTabs[0].path, p("第1章", "a.txt"));
  assert.equal(app.openTabs[0].name, "a.txt");
  assert.equal(app.openTabs[0].markdown, "A2", "a folder rename keeps the tab text");
  assert.equal(app.openTabs[0].savedMarkdown, "A1");
  assert.equal(app.appState.lastFilePath, p("第1章", "a.txt"));
  assert.equal(app.appState.markdown, "A2");
  assert.equal(app.appState.fileProgress[p("第1章", "a.txt")], "writing");
  assert.equal(app.focusedFolderPath, p("第1章"));
  assert.deepEqual([...app.collapsedWorkspaceFolderPaths], [p("第1章")]);
  assert.deepEqual(app.appState.collapsedFolderPathsByWorkspace[ROOT], [p("第1章")], "a closed folder stays closed under its new name");
  assert.deepEqual(app.appState.collapsedOutlinePathsByWorkspace[ROOT], [p("第1章", "a.txt"), p("c.txt")]);
  assert.deepEqual(
    app.appState.collapsedOutlineHeadingKeysByWorkspace[ROOT],
    [headingKey(p("第1章", "a.txt")), headingKey(p("c.txt"))],
  );
  assert.deepEqual(app.proofreadIgnored, { "第1章/a.txt": ["ignore-a"], "c.txt": ["ignore-c"] });
  assert.deepEqual(app.closedDocumentTabs.map((record) => record.path), [p("第1章", "a.txt"), p("c.txt")]);
  assert.deepEqual(forgotten(app), [{ key: `file:${p("第一章", "a.txt")}`, discard: false }]);
  assert.deepEqual(app.toasts, ["「第一章」をリネームしました"]);
}

// ---- 名前の変更: 同じ名前、断った、失敗した ----
{
  const { app, actions } = setup();
  app.inputAnswers.push("a.txt");
  await actions().handleRenameProjectEntry(file(p("第一章", "a.txt")));
  await actions().handleRenameProjectEntry(file(p("第一章", "a.txt")));
  assert.deepEqual(app.log, [], "the same name or a cancelled dialog changes nothing");
}

// ---- 名前の変更: 拡張子を書かなければ、元のファイルの拡張子を足して渡す（Rust に任せると .txt になる） ----
for (const [oldName, answer, expected] of [
  ["一章.md", "序章", "序章.md"],
  ["一章.md", "  序章  ", "序章.md"],
  ["メモ.txt", "覚え書き", "覚え書き.txt"],
  ["一章.MD", "序章", "序章.MD"],
  ["一章.md", "序章.txt", "序章.txt"],
  ["一章.md", "版1.2", "版1.2.md"],
]) {
  const { app, actions } = setup();
  app.inputAnswers.push(answer);
  app.commands.rename_project_entry = (args) => ({ path: p(args.name), name: args.name, content: "" });
  await actions().handleRenameProjectEntry(file(p(oldName)));
  const call = app.log.find((entry) => entry.command === "rename_project_entry");
  assert.equal(call?.args.name, expected, `${oldName} renamed with ${JSON.stringify(answer)}`);
}
// 拡張子を書かずに今と同じ名前を入れたときは、同じ名前として何もしない。
{
  const { app, actions } = setup();
  app.inputAnswers.push("一章");
  await actions().handleRenameProjectEntry(file(p("一章.md")));
  assert.deepEqual(app.log, [], "the same name without its extension changes nothing");
}
// フォルダの名前には足さない。
{
  const { app, actions } = setup();
  app.inputAnswers.push("第1章");
  app.commands.rename_project_entry = () => ({ path: p("第1章"), name: "第1章", content: "" });
  await actions().handleRenameProjectEntry(folder(p("第一章"), []));
  assert.equal(app.log.find((entry) => entry.command === "rename_project_entry")?.args.name, "第1章");
}
{
  const { app, refs, actions } = setup();
  app.inputAnswers.push("x.txt");
  app.commands.rename_project_entry = () => {
    throw new Error("rename failed");
  };
  await actions().handleRenameProjectEntry(file(p("c.txt")));
  assert.equal(app.lastError, "Error: rename failed");
  // 名前の変更の失敗は保存の失敗ではないので、今のタブの印に触らず（未保存として数えられない）、通知で知らせる。
  assertSaveMarkUntouched(app, "rename failure");
  assert.equal(refs.projectEntryPathChangeInProgressRef.current, false, "the hold is released after a failure");
  assert.deepEqual(app.toasts, ["名前を変更できませんでした"]);
}

// ---- 削除（開いているファイル） ----
{
  const { app, refs, actions } = setup();
  const deleted = p("第一章", "a.txt");
  recordEdit(deleted);
  app.commands.plan_delete_project_entry = () => ({ rootKind: "file", textFileCount: 1, nonTextFileCount: 0, folderCount: 0, warnings: [] });
  app.commands.delete_project_entry_to_trash = () => ({ deletedPaths: [deleted], fallbackUsed: "none" });
  app.commands.read_text_file = ({ path }) => ({ path, name: "b.txt", content: "B" });
  app.refreshedFolder = projectFolder([folder(p("第一章"), [file(p("第一章", "b.txt"))]), file(p("c.txt"))]);
  app.focusedFolderPath = p("第一章");
  app.activeBreadcrumbPath = deleted;
  app.confirmAnswers.push(true);
  await actions().handleDeleteProjectEntry(file(deleted));

  assert.deepEqual(app.confirms[0], {
    title: "項目を削除",
    message: "「a.txt」を削除しますか？",
    detail: "ファイルをThenのTrashへ移動します。 チェックポイントには影響しません。 未保存のタブ 1 件は閉じられ、未保存内容は破棄されます。",
    confirmLabel: "削除",
    danger: true,
  });
  assert.deepEqual(commandsOf(app), ["plan_delete_project_entry", "delete_project_entry_to_trash", "(refresh)", "read_text_file"]);
  assert.deepEqual(app.log[1].args, { rootPath: ROOT, path: deleted });
  assert.deepEqual(app.persistedAnchors, [{ id: "y", documentPath: "c.txt" }]);
  assert.equal(refs.projectAstBuildIdRef.current, 1);
  assert.equal(app.focusedFolderPath, p("第一章"), "a deleted file keeps its folder selected");
  assert.equal(app.activeBreadcrumbPath, p("第一章"));
  assert.deepEqual(app.openTabs.map((item) => item.path), [p("c.txt")]);
  assert.deepEqual(app.appState.fileProgress, { [p("c.txt")]: "done" });
  assert.deepEqual(Object.keys(app.appState.cursorPositions), [p("c.txt")]);
  assert.equal(app.appState.lastFilePath, null);
  assert.deepEqual(app.log[3].args, { path: p("第一章", "b.txt") });
  // 消したタブの場所（ここでは先頭）に開く。すでに開いていれば、そのタブへ切り替える（docs/DELETE_DUPLICATE_TAB_PLAN.md）。
  assert.deepEqual(app.loaded, [{ document: { path: p("第一章", "b.txt"), name: "b.txt", content: "B" }, options: { index: 0 } }]);
  // 消したファイルを指す資料カード・最近の資料・資料の候補は外す
  // （docs/PROJECT_ENTRY_RETARGET_FIX_PLAN.md の確認1）。
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["c.txt"]);
  assert.deepEqual(app.referenceLayout.recent, []);
  assert.deepEqual(app.referenceCandidates.map((item) => item.sourcePath), ["c.txt"]);
  assert.deepEqual(app.appState.collapsedOutlinePathsByWorkspace[ROOT], [p("c.txt")]);
  assert.deepEqual(app.appState.collapsedOutlineHeadingKeysByWorkspace[ROOT], [headingKey(p("c.txt"))]);
  assert.deepEqual(app.proofreadIgnored, { "c.txt": ["ignore-c"] });
  assert.deepEqual(app.closedDocumentTabs.map((record) => record.path), [p("c.txt")]);
  assert.deepEqual(
    forgotten(app),
    [{ key: `file:${deleted}`, discard: true }],
    "the deleted tab's record is dropped, as the confirmation said its unsaved text would be",
  );
  assert.deepEqual(app.toasts, ["「a.txt」をゴミ箱へ移動しました"]);
}

// ---- 削除（開いているファイルが、タブの並びの途中にある） ----
// 次のファイルは、消したタブがあった場所に開く。置き換えで開くと、すでに開いているタブと同じタブが
// もう1つできていた（docs/DELETE_DUPLICATE_TAB_PLAN.md）。
{
  const world = defaultWorld();
  world.openTabs = [tab(p("c.txt")), world.openTabs[0], tab(p("第一章", "b.txt"))];
  const { app, actions } = setup(world);
  const deleted = p("第一章", "a.txt");
  app.commands.plan_delete_project_entry = () => ({ rootKind: "file", textFileCount: 1, nonTextFileCount: 0, folderCount: 0, warnings: [] });
  app.commands.delete_project_entry_to_trash = () => ({ deletedPaths: [deleted], fallbackUsed: "none" });
  app.commands.read_text_file = ({ path }) => ({ path, name: "b.txt", content: "B" });
  app.refreshedFolder = projectFolder([folder(p("第一章"), [file(p("第一章", "b.txt"))]), file(p("c.txt"))]);
  app.confirmAnswers.push(true);
  await actions().handleDeleteProjectEntry(file(deleted));

  assert.deepEqual(app.openTabs.map((item) => item.path), [p("c.txt"), p("第一章", "b.txt")]);
  assert.deepEqual(app.loaded.map(({ options }) => options), [{ index: 1 }], "the next file goes where the deleted tab was");
  assert.equal(app.loaded.some(({ options }) => options?.replaceActive), false, "the deleted tab is gone, so nothing is replaced");
}

// ---- 削除（フォルダ。消えるタブが、開いているタブより前にもある） ----
// 消したタブの場所は、残るタブだけで数える。
{
  const world = defaultWorld();
  world.openTabs = [world.openTabs[0], tab(p("c.txt")), tab(p("第一章", "b.txt"))];
  world.activeTabId = `file:${p("第一章", "b.txt")}`;
  const { app, actions } = setup(world);
  app.commands.plan_delete_project_entry = () => ({ rootKind: "folder", textFileCount: 2, nonTextFileCount: 0, folderCount: 1, warnings: [] });
  app.commands.delete_project_entry_to_trash = () => ({ deletedPaths: [p("第一章")], fallbackUsed: "none" });
  app.commands.read_text_file = ({ path }) => ({ path, name: "c.txt", content: "C" });
  app.refreshedFolder = projectFolder([file(p("c.txt"))]);
  app.confirmAnswers.push(true);
  await actions().handleDeleteProjectEntry(folder(p("第一章"), []));

  assert.deepEqual(app.openTabs.map((item) => item.path), [p("c.txt")]);
  assert.deepEqual(app.loaded.map(({ options }) => options), [{ index: 1 }], "only the tabs left are counted");
}

// ---- 削除（フォルダ、最後のファイルまで消える、Then の Trash） ----
{
  const { app, refs, actions } = setup();
  recordEdit(p("第一章", "a.txt"));
  app.commands.plan_delete_project_entry = () => ({ rootKind: "folder", textFileCount: 2, nonTextFileCount: 1, folderCount: 2, warnings: ["a", "b", "c"] });
  app.commands.delete_project_entry_to_trash = () => ({ deletedPaths: [p("第一章")], fallbackUsed: "appTrash" });
  app.refreshedFolder = projectFolder([]);
  app.confirmAnswers.push(true);
  await actions().handleDeleteProjectEntry(folder(p("第一章"), []));

  assert.equal(
    app.confirms[0].detail,
    "配下のテキストファイル 2 件、その他ファイル 1 件、フォルダ 1 件をThenのTrashへ移動します。 チェックポイントには影響しません。 未保存のタブ 1 件は閉じられ、未保存内容は破棄されます。 注意: a / b",
  );
  assert.equal(app.focusedFolderPath, ROOT);
  assert.equal(refs.didMountEditorRef.current, false);
  assert.equal(app.replaced.length, 1);
  assert.equal(app.replaced[0].kind, "scratch");
  assert.equal(app.replaced[0].saveStatus, "saved");
  assert.match(app.replaced[0].documentKey, /^workspace-empty-\d+$/);
  assert.equal(app.appState.markdown, "");
  assert.equal(app.appState.lastFilePath, null);
  assert.deepEqual([...app.collapsedWorkspaceFolderPaths], [], "a deleted folder leaves the closed-folder record");
  assert.deepEqual(app.appState.collapsedFolderPathsByWorkspace[ROOT], [], "a deleted folder leaves the sidebar's closed-folder record");
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["c.txt"]);
  assert.deepEqual(app.referenceLayout.recent, []);
  assert.deepEqual(forgotten(app), [{ key: `file:${p("第一章", "a.txt")}`, discard: true }]);
  assert.deepEqual(app.toasts, ["「第一章」をThenのTrashへ移動しました"]);
}

// ---- 削除: 断った、Tauri の外、確かめられなかった ----
{
  const { app, actions } = setup();
  app.commands.plan_delete_project_entry = () => ({ rootKind: "file", textFileCount: 1, nonTextFileCount: 0, folderCount: 0, warnings: [] });
  await actions().handleDeleteProjectEntry(file(p("c.txt")));
  assert.deepEqual(commandsOf(app), ["plan_delete_project_entry"], "declining the confirmation deletes nothing");
  assert.equal(app.confirms[0].detail, "ファイルをThenのTrashへ移動します。 チェックポイントには影響しません。");
}
{
  const { app, actions } = setup(defaultWorld(), { tauri: false });
  await actions().handleDeleteProjectEntry(file(p("c.txt")));
  assert.deepEqual(app.toasts, ["ファイル削除はTauri版で利用できます"]);
  assert.deepEqual(app.log, []);
}
{
  const { app, actions } = setup();
  app.commands.plan_delete_project_entry = () => {
    throw new Error("plan failed");
  };
  await actions().handleDeleteProjectEntry(file(p("c.txt")));
  assert.deepEqual(app.toasts, ["削除対象を確認できませんでした"]);
  assert.equal(app.confirms.length, 0);
}

// ---- 1件の移動（複数の移動に1件だけ渡すと、1件の移動へ回る。App のドラッグと同じ入口） ----
{
  const { app, refs, actions } = setup();
  const oldPath = p("第一章", "a.txt");
  const newPath = p("a.txt");
  const movedFolder = projectFolder([folder(p("第一章"), [file(p("第一章", "b.txt"))]), file(newPath), file(p("c.txt"))]);
  recordEdit(oldPath);
  app.commands.move_project_entry = () => ({
    projectFolder: movedFolder,
    movedDocument: { path: newPath, name: "a.txt", content: "A2", fileId: "f1", contentHash: "h3" },
    oldPath,
    newPath,
    oldParentPath: p("第一章"),
    newParentPath: ROOT,
  });
  await actions().handleMoveProjectEntriesToFolder([oldPath], ROOT, p("c.txt"), "before");

  assert.deepEqual(commandsOf(app), ["(save)", "move_project_entry"]);
  assert.deepEqual(app.log[1].args, { rootPath: ROOT, sourcePath: oldPath, targetFolderPath: ROOT, targetPath: p("c.txt"), position: "before" });
  assert.ok(app.sequence.indexOf("journal_forget") < app.sequence.indexOf("move_project_entry"), "the old record is closed while the file is still where it was (closing checks the file)");
  assert.equal(app.log[1].pathChanging, true);
  assert.equal(refs.projectEntryPathChangeInProgressRef.current, false);
  assert.equal(app.openTabs[0].id, `file:${newPath}`);
  assert.equal(app.openTabs[0].contentHash, "h3");
  assert.equal(app.openTabs[0].savedMarkdown, "A2");
  assert.equal(app.activeTabId, `file:${newPath}`);
  assert.equal(app.appState.lastFilePath, newPath);
  assert.equal(app.appState.markdown, "A2");
  assert.equal(refs.lastSavedMarkdownRef.current, "A2");
  assert.equal(app.appState.fileProgress[newPath], "writing");
  assert.equal(app.appState.fileProgress[oldPath], undefined);
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["a.txt", "c.txt"]);
  assert.deepEqual(app.anchorRetargets, [[oldPath, newPath]]);
  assert.deepEqual(app.postNoteRetargets, [[ROOT, [{ oldPath, newPath }]]], "links from posts to notes follow the move (BINDER 2-3)");
  assert.equal(app.focusedFolderPath, ROOT, "a moved file selects its new folder");
  assert.equal(app.projectFolder, movedFolder);
  assertSaveMarkUntouched(app, "move");
  assert.deepEqual(app.appState.collapsedOutlinePathsByWorkspace[ROOT], [newPath, p("c.txt")]);
  assert.deepEqual(app.proofreadIgnored, { "a.txt": ["ignore-a"], "c.txt": ["ignore-c"] });
  assert.deepEqual(app.closedDocumentTabs.map((record) => record.path), [newPath, p("c.txt")]);
  assert.deepEqual(forgotten(app), [{ key: `file:${oldPath}`, discard: false }]);
  assert.deepEqual(app.toasts, ["「a.txt」を移動しました"]);
}

// ---- 1件の移動: フォルダ、同じフォルダ、自分の中 ----
{
  const { app, actions } = setup();
  const oldPath = p("第一章");
  const newPath = p("部", "第一章");
  app.projectFolder = projectFolder([...app.projectFolder.children, folder(p("部"), [])]);
  app.commands.move_project_entry = () => ({
    projectFolder: app.projectFolder,
    movedDocument: null,
    oldPath,
    newPath,
    oldParentPath: ROOT,
    newParentPath: p("部"),
  });
  await actions().handleMoveProjectEntriesToFolder([oldPath], p("部"));
  assert.deepEqual(app.log.find((entry) => entry.command === "move_project_entry").args, {
    rootPath: ROOT, sourcePath: oldPath, targetFolderPath: p("部"), targetPath: null, position: null,
  });
  assert.equal(app.openTabs[0].path, p("部", "第一章", "a.txt"));
  assert.equal(app.openTabs[0].markdown, "A2");
  assert.equal(app.focusedFolderPath, newPath, "a moved folder selects itself");
  assert.deepEqual([...app.collapsedWorkspaceFolderPaths], [newPath]);
}
{
  const { app, actions } = setup();
  await actions().handleMoveProjectEntriesToFolder([p("第一章", "a.txt")], p("第一章"));
  await actions().handleMoveProjectEntriesToFolder([p("第一章")], p("第一章"));
  assert.deepEqual(app.log, []);
  assert.deepEqual(app.toasts, ["フォルダを自分自身の中へ移動できません"]);
}

// ---- 複数の移動 ----
{
  const { app, refs, actions } = setup();
  const a = p("第一章", "a.txt");
  const b = p("第一章", "b.txt");
  const movedFolder = projectFolder([folder(p("第一章"), []), file(p("a.txt")), file(p("b.txt")), file(p("c.txt"))]);
  recordEdit(a);
  app.commands.move_project_entries = () => ({
    projectFolder: movedFolder,
    moves: [
      { movedDocument: { path: p("a.txt"), name: "a.txt", content: "A2" }, oldPath: a, newPath: p("a.txt"), oldParentPath: p("第一章"), newParentPath: ROOT },
      { movedDocument: { path: p("b.txt"), name: "b.txt", content: "B" }, oldPath: b, newPath: p("b.txt"), oldParentPath: p("第一章"), newParentPath: ROOT },
    ],
  });
  await actions().handleMoveProjectEntriesToFolder([a, b, a, p("c.txt")], ROOT);

  assert.deepEqual(commandsOf(app), ["(save)", "move_project_entries"]);
  assert.deepEqual(app.log[1].args, { rootPath: ROOT, sourcePaths: [a, b], targetFolderPath: ROOT }, "files already in the target are skipped");
  assert.ok(app.sequence.indexOf("journal_forget") < app.sequence.indexOf("move_project_entries"), "the old record is closed while the file is still where it was (closing checks the file)");
  assert.equal(app.log[1].pathChanging, true);
  assert.equal(refs.projectEntryPathChangeInProgressRef.current, false);
  assert.equal(app.openTabs[0].path, p("a.txt"));
  assert.equal(app.activeTabId, `file:${p("a.txt")}`);
  assert.equal(app.appState.lastFilePath, p("a.txt"));
  assert.equal(app.appState.fileProgress[p("a.txt")], "writing");
  assert.deepEqual(app.anchorRetargets, [[a, p("a.txt")], [b, p("b.txt")]]);
  assert.deepEqual(app.postNoteRetargets.map(([root, changes]) => [root, changes.map(({ oldPath, newPath }) => [oldPath, newPath])]), [[ROOT, [[a, p("a.txt")], [b, p("b.txt")]]]], "links from posts to notes follow every move at once (BINDER 2-3)");
  assert.equal(app.focusedFolderPath, ROOT);
  assert.equal(app.projectFolder, movedFolder);
  assert.deepEqual(app.appState.collapsedOutlineHeadingKeysByWorkspace[ROOT], [headingKey(p("a.txt")), headingKey(p("c.txt"))]);
  assert.deepEqual(app.proofreadIgnored, { "a.txt": ["ignore-a"], "c.txt": ["ignore-c"] });
  assert.deepEqual(forgotten(app), [{ key: `file:${a}`, discard: false }]);
  assert.deepEqual(app.toasts, ["2件のファイルを移動しました"]);
}
{
  const { app, actions } = setup();
  await actions().handleMoveProjectEntriesToFolder([p("第一章", "a.txt"), p("第一章")], ROOT);
  assert.deepEqual(app.toasts, ["複数移動ではファイルだけを選択してください"]);
  assert.deepEqual(app.log, []);
}
{
  const { app, actions } = setup();
  app.commands.move_project_entry = () => {
    throw new Error("move failed");
  };
  await actions().handleMoveProjectEntriesToFolder([p("c.txt"), p("c.txt")], p("第一章"));
  assert.deepEqual(commandsOf(app), ["move_project_entry"], "one source goes through the single move");
  assert.equal(app.lastError, "Error: move failed");
  assertSaveMarkUntouched(app, "move failure");
  assert.deepEqual(app.toasts, ["移動できませんでした"]);
}
{
  const { app, actions } = setup();
  app.commands.move_project_entries = () => {
    throw new Error("moves failed");
  };
  await actions().handleMoveProjectEntriesToFolder([p("c.txt"), p("第一章", "b.txt")], p("第二部"));
  assert.equal(app.lastError, "Error: moves failed");
  assertSaveMarkUntouched(app, "multiple move failure");
  assert.deepEqual(app.toasts, ["選択したファイルを移動できませんでした"]);
}

// ---- 新規ファイル・新規フォルダ ----
{
  const { app, actions } = setup();
  app.createFileAnswer = { fileName: "新しい章.txt", templateId: null };
  app.commands.create_text_file = ({ folderPath, name }) => ({ path: `${folderPath}\\${name}`, name, content: "" });
  await actions().handleCreateProjectFile();
  assert.deepEqual(commandsOf(app), ["(create file dialog)", "create_text_file", "(refresh)"]);
  assert.deepEqual(app.log[1].args, { folderPath: ROOT, name: "新しい章.txt" }, "without a breadcrumb folder the project root is used");
  assert.deepEqual(app.loaded, [{ document: { path: p("新しい章.txt"), name: "新しい章.txt", content: "" }, options: undefined }]);
  assert.deepEqual(app.toasts, ["「新しい章.txt」を作成しました"]);
}
{
  const { app, actions } = setup();
  app.activeBreadcrumbPath = p("第一章");
  app.createFileAnswer = { fileName: "c2.txt", templateId: "t1" };
  app.commands.create_text_file_from_template = ({ folderPath, name }) => ({ path: `${folderPath}\\${name}`, name, content: "ひな形" });
  await actions().handleCreateProjectFile();
  assert.deepEqual(app.log[1].args, { folderPath: p("第一章"), name: "c2.txt", rootPath: ROOT, templateId: "t1" });
  assert.deepEqual(app.appState.cursorPositions[p("第一章", "c2.txt")], { offset: 3, length: 3 },
    "a file made from a template opens with the caret at the end of its text");
}
{
  // 見出しだけの新しいファイルは、見出しの次の行から書き始める（見出しの前に入らない）。
  const { app, actions } = setup();
  app.createFileAnswer = { fileName: "第三章.md", templateId: null };
  app.commands.create_text_file = ({ folderPath, name }) => ({ path: `${folderPath}\\${name}`, name, content: "# 第三章\n" });
  await actions().handleCreateProjectFile();
  assert.deepEqual(app.appState.cursorPositions[p("第三章.md")], { offset: 6, length: 6 },
    "a new file opens with the caret after its heading line");
  assert.deepEqual(Object.keys(app.appState.cursorPositions).filter((path) => path !== p("第三章.md")),
    Object.keys(setup().app.appState.cursorPositions), "other files keep their caret positions");
}
{
  const { app, actions } = setup();
  app.inputAnswers.push("第二章");
  app.commands.create_project_folder = () => ({ path: p("第二章"), name: "第二章", children: [] });
  await actions().handleCreateProjectFolder(p("第一章"));
  assert.equal(app.inputs[0].initialValue, "新規フォルダ");
  assert.deepEqual(app.log[0].args, { folderPath: p("第一章"), name: "第二章" });
  assertSaveMarkUntouched(app, "create folder");
  assert.deepEqual(app.toasts, ["「第二章」を作成しました"]);
}
// 作成の失敗も、印に触らず通知で知らせる。
{
  const { app, actions } = setup();
  app.inputAnswers.push("第二章");
  app.commands.create_project_folder = () => {
    throw new Error("folder failed");
  };
  await actions().handleCreateProjectFolder(p("第一章"));
  assert.equal(app.lastError, "Error: folder failed");
  assertSaveMarkUntouched(app, "create folder failure");
  assert.deepEqual(app.toasts, ["フォルダを作成できませんでした"]);
}
{
  const { app, actions } = setup();
  app.createFileAnswer = { fileName: "新しい章.txt", templateId: null };
  app.commands.create_text_file = () => {
    throw new Error("file failed");
  };
  await actions().handleCreateProjectFile();
  assert.equal(app.lastError, "Error: file failed");
  assertSaveMarkUntouched(app, "create file failure");
  assert.deepEqual(app.toasts, ["ファイルを作成できませんでした"]);
}
{
  const { app, actions } = setup({ ...defaultWorld(), projectFolder: null });
  await actions().handleCreateProjectFile();
  await actions().handleCreateProjectFolder();
  assert.deepEqual(app.toasts, ["先にフォルダを開いてください", "先にフォルダを開いてください"]);
}

// ---- 並べ替え（上下、パンくずのドラッグ、サイドバー） ----
const reorderWorld = () => {
  const world = setup();
  world.app.commands.reorder_project_entries = ({ folderPath, orderedPaths }) => ({
    path: folderPath,
    name: "第一章",
    children: orderedPaths.map(file),
  });
  return world;
};
{
  const { app, actions } = reorderWorld();
  await actions().handleMoveProjectEntry(p("第一章"), p("第一章", "a.txt"), 1);
  assert.deepEqual(app.log[0].args, { rootPath: ROOT, folderPath: p("第一章"), orderedPaths: [p("第一章", "b.txt"), p("第一章", "a.txt")] });
  assert.deepEqual(app.projectFolder.children[0].children.map((entry) => entry.name), ["b.txt", "a.txt"]);
  assert.deepEqual(app.toasts, ["並び順を保存しました"]);
  await actions().handleMoveProjectEntry(p("第一章"), p("第一章", "a.txt"), 1);
  assert.equal(app.log.length, 1, "moving past the end saves nothing");
}
{
  const { app, refs, actions } = reorderWorld();
  const data = {};
  const dragEvent = (clientY) => ({
    clientY,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 20 }) },
    dataTransfer: { effectAllowed: "", dropEffect: "", setData: (type, value) => (data[type] = value) },
  });
  const start = dragEvent(0);
  actions().handleBreadcrumbEntryDragStart(start, p("第一章"), p("第一章", "b.txt"));
  assert.deepEqual(refs.breadcrumbDragEntryRef.current, { folderPath: p("第一章"), entryPath: p("第一章", "b.txt") });
  assert.equal(app.draggingBreadcrumbEntryPath, p("第一章", "b.txt"));
  assert.equal(start.dataTransfer.effectAllowed, "copyMove");
  assert.deepEqual(data, { "application/x-brew-project-entry-path": p("第一章", "b.txt") });

  const otherFolder = dragEvent(105);
  actions().handleBreadcrumbEntryDragOver(otherFolder, ROOT, p("c.txt"));
  assert.equal(otherFolder.defaultPrevented, false, "dragging into another folder is not a reorder");

  const over = dragEvent(105);
  actions().handleBreadcrumbEntryDragOver(over, p("第一章"), p("第一章", "a.txt"));
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, "move");
  assert.deepEqual(app.breadcrumbDropTarget, { folderPath: p("第一章"), entryPath: p("第一章", "a.txt"), position: "before" });
  actions().handleBreadcrumbEntryDragOver(dragEvent(115), p("第一章"), p("第一章", "a.txt"));
  assert.equal(app.breadcrumbDropTarget.position, "after");
  app.breadcrumbDropTarget = { ...app.breadcrumbDropTarget, position: "before" };

  await actions().handleBreadcrumbEntryDrop(dragEvent(105), p("第一章"), p("第一章", "a.txt"));
  assert.deepEqual(app.log[0].args.orderedPaths, [p("第一章", "b.txt"), p("第一章", "a.txt")]);
  assert.equal(app.breadcrumbDropTarget, null);
  assert.equal(app.draggingBreadcrumbEntryPath, null);
  assert.equal(refs.breadcrumbDragEntryRef.current, null);

  actions().handleBreadcrumbEntryDragStart(dragEvent(0), p("第一章"), p("第一章", "a.txt"));
  actions().handleBreadcrumbEntryDragEnd();
  assert.equal(refs.breadcrumbDragEntryRef.current, null);
  assert.equal(app.draggingBreadcrumbEntryPath, null);
}
{
  const { app, actions } = reorderWorld();
  await actions().handleSidebarEntryReorder(p("第一章"), [p("第一章", "b.txt")], p("第一章", "a.txt"), "before");
  assert.deepEqual(app.log[0].args.orderedPaths, [p("第一章", "b.txt"), p("第一章", "a.txt")]);
}
{
  const { app, actions } = setup();
  app.commands.reorder_project_entries = () => {
    throw new Error("order failed");
  };
  await actions().handleSidebarEntryReorder(p("第一章"), [p("第一章", "b.txt")], p("第一章", "a.txt"), "before");
  assert.equal(app.lastError, "Error: order failed");
  assertSaveMarkUntouched(app, "reorder failure");
  assert.deepEqual(app.toasts, ["並び順を保存できませんでした"]);
}

// ---- 資料ボードの読み込み（App に残る useEffect。文字で確かめ、動くことは実機で確かめる） ----
// 名前の変更・移動・並べ替え・新規・削除で作品のフォルダの木が替わっても、資料ボードはディスクから
// 読み直さない（保存を待っている付け替えを上書きしないため）。読み直すのは資料の候補だけ。
// ---- 素材の段の画像・PDF の名前の変更と移動（BINDER 2-6） ----
// ファイルの一覧に入っていないので一覧は読み直さず、資料カード・最近の資料・資料の候補と、開いている Canvas
// への知らせだけを付け替える。
function imageWorld(app) {
  const image = (sourcePath) => ({ ...referenceFile(sourcePath), kind: "image" });
  app.referenceLayout = {
    cards: [{ ...referenceCard("素材/資料/地図.png"), kind: "image" }, referenceCard("c.txt")],
    recent: [image("素材/資料/地図.png")],
  };
  app.referenceCandidates = [image("素材/資料/地図.png"), referenceFile("c.txt")];
}
{
  const { app, actions } = setup();
  imageWorld(app);
  const reference = { path: p("素材", "資料", "地図.png"), name: "地図.png" };
  app.inputAnswers.push("地図");
  await actions().handleRenameMaterialReference(reference);
  assert.deepEqual(commandsOf(app), [], "拡張子を書かずに同じ名前なら何もしない");
  assert.equal(app.inputs[0].label, "ファイル名");
  assert.equal(app.inputs[0].initialValue, "地図.png");

  app.inputAnswers.push(" 港 ");
  app.commands.rename_project_entry = (args) => ({ path: p("素材", "資料", "港.png"), name: "港.png", content: "" });
  await actions().handleRenameMaterialReference(reference);
  assert.deepEqual(commandsOf(app), ["rename_project_entry"], "一覧は読み直さない");
  assert.deepEqual(app.log[0].args, { path: reference.path, name: "港" }, "拡張子は Rust が元のものを足す");
  assert.equal(app.log[0].pathChanging, true);
  assert.deepEqual(app.referenceLayout.cards.map((card) => [card.sourcePath, card.kind]), [["素材/資料/港.png", "image"], ["c.txt", "text"]]);
  assert.deepEqual(app.referenceLayout.recent.map((file) => [file.sourcePath, file.name]), [["素材/資料/港.png", "港.png"]]);
  assert.deepEqual(app.referenceCandidates.map((file) => file.sourcePath), ["素材/資料/港.png", "c.txt"]);
  assert.deepEqual(app.canvasPathChanges, [[ROOT, [{ oldPath: "素材/資料/地図.png", newPath: "素材/資料/港.png" }]]], "開いている Canvas に知らせる");
  assert.deepEqual(app.toasts, ["「地図.png」をリネームしました"]);

  app.inputAnswers.push("海");
  app.commands.rename_project_entry = () => { throw new Error("entry with that name already exists"); };
  await actions().handleRenameMaterialReference({ path: p("素材", "資料", "港.png"), name: "港.png" });
  assert.equal(app.toasts.at(-1), "名前を変更できませんでした");
  assert.match(app.lastError, /already exists/);
}
{
  const { app, actions } = setup();
  imageWorld(app);
  const reference = { path: p("素材", "資料", "地図.png"), name: "地図.png" };
  await actions().handleMoveMaterialReference(reference, p("素材", "資料"));
  assert.deepEqual(commandsOf(app), [], "同じフォルダへは動かさない");

  app.commands.move_project_entry = (args) => ({
    projectFolder: app.projectFolder,
    movedDocument: null,
    oldPath: args.sourcePath,
    newPath: p("素材", "年表", "地図.png"),
    oldParentPath: p("素材", "資料"),
    newParentPath: p("素材", "年表"),
  });
  await actions().handleMoveMaterialReference(reference, p("素材", "年表"));
  assert.deepEqual(commandsOf(app), ["move_project_entry"]);
  assert.deepEqual(app.log[0].args, {
    rootPath: ROOT,
    sourcePath: reference.path,
    targetFolderPath: p("素材", "年表"),
    targetPath: null,
    position: null,
  }, "並び順は渡さない");
  assert.equal(app.referenceLayout.cards[0].sourcePath, "素材/年表/地図.png");
  assert.equal(app.referenceLayout.recent[0].sourcePath, "素材/年表/地図.png");
  assert.equal(app.referenceCandidates[0].sourcePath, "素材/年表/地図.png");
  assert.deepEqual(app.canvasPathChanges, [[ROOT, [{ oldPath: "素材/資料/地図.png", newPath: "素材/年表/地図.png" }]]]);
  assert.equal(app.focusedFolderPath, p("素材", "年表"));
  assert.deepEqual(app.toasts, ["「地図.png」を移動しました"]);

  app.commands.move_project_entry = () => { throw new Error("images and PDFs stay inside the materials folder"); };
  await actions().handleMoveMaterialReference({ path: p("素材", "年表", "地図.png"), name: "地図.png" }, ROOT);
  assert.equal(app.toasts.at(-1), "移動できませんでした");
}
{
  // 本文のファイルの名前の変更も、開いている Canvas に作品からの相対パスで知らせる（確認1の 1）。
  const { app, actions } = setup();
  app.inputAnswers.push("a2");
  app.commands.rename_project_entry = () => ({ path: p("第一章", "a2.txt"), name: "a2.txt", content: "A2", fileId: "f1", contentHash: "h2" });
  await actions().handleRenameProjectEntry(file(p("第一章", "a.txt")));
  assert.deepEqual(app.canvasPathChanges, [[ROOT, [{ oldPath: "第一章/a.txt", newPath: "第一章/a2.txt" }]]]);
}

{
  const appSource = await readFile("src/App.tsx", "utf8");
  const effectDeps = (marker) => {
    const at = appSource.indexOf(marker);
    assert.notEqual(at, -1, `missing ${marker}`);
    return appSource.slice(at).match(/\n {2}\}, (\[[^\]]*\])\);/)[1];
  };
  assert.equal(
    effectDeps("loadReferenceLayout(rootPath),"),
    "[isHydrated, projectFolder?.path]",
    "the reference board loads when the project changes, not when its file tree does",
  );
  assert.equal(
    effectDeps("const candidates = await listReferenceCandidates(rootPath);"),
    "[isHydrated, projectFolder]",
    "the reference candidates follow the file tree",
  );
}

// ---- U5: 素材のノート・画像・PDF をほかの作品へ送る（docs/BINDER_REMAINING_PLAN.md） ----
// 聞く画面（送り先・方法）→ 直していないタブを保存 → Rust が送る → 一緒に送ったもの同士の @[[ ]] を書き換える →
// 移動なら投稿の札を送り先へ付け替え、この作品のタブ・索引から外す → 通知の「元に戻す」。
{
  const LIB_B = "C:\\Lib\\作品B";
  const note = p("素材", "灯台.md");
  const image = p("素材", "資料", "港.png");
  const world = {
    projectFolder: projectFolder([
      { ...folder(p("素材"), [{ ...file(note), role: "material" }]), role: "material" },
      file(p("c.txt")),
    ]),
    openTabs: [tab(note, { markdown: "直した", savedMarkdown: "前", saveStatus: "dirty" }), tab(p("c.txt"))],
    activeTabId: `file:${note}`,
  };
  const { app, refs, actions } = setup(world);
  app.commands.library_transfer_destinations = () => [
    { path: "C:\\Lib", label: "ライブラリ「本棚」の直下" },
    { path: LIB_B, label: "作品「作品B」" },
  ];
  // 何も選ばずに閉じたら、何もしない。
  await actions().handleTransferEntries([note, image]);
  assert.deepEqual(commandsOf(app), ["library_transfer_destinations"]);
  assert.equal(app.multiInputs[0].title, "2件を移動・コピー");
  assert.deepEqual(app.multiInputs[0].fields.map((field) => [field.id, field.initialValue]), [["destination", "C:\\Lib"], ["mode", "copy"]]);
  assert.equal(app.multiInputs[0].confirmLabel, "実行");
  app.log.length = 0;

  const sentNote = `${LIB_B}\\素材\\灯台.md`;
  const sentImage = `${LIB_B}\\素材\\資料\\港-2.png`;
  app.multiInputAnswer = { destination: LIB_B, mode: "move" };
  app.commands.transfer_project_entries = () => ({
    entries: [
      { oldPath: note, newPath: sentNote, kind: "text", contentHash: "h1", sourceOrderIndex: 0 },
      { oldPath: image, newPath: sentImage, kind: "material", contentHash: "img" },
    ],
  });
  app.commands.read_text_file = ({ path: readPath }) => {
    if (readPath === sentNote) return { path: readPath, name: "灯台.md", content: "@[[素材/資料/港.png]] と @[[素材/資料/地図.pdf]]", contentHash: "h1" };
    return { path: readPath, name: "c.txt", content: "C", contentHash: "c" };
  };
  app.commands.save_text_file = ({ path: savedPath, content }) => ({ path: savedPath, name: "灯台.md", content, contentHash: "h2" });
  await actions().handleTransferEntries([note, image]);

  const commands = commandsOf(app);
  assert.deepEqual(commands.slice(0, 3), ["library_transfer_destinations", "(save)", "transfer_project_entries"], "直していないタブを保存してから送る");
  const sent = app.log.find((entry) => entry.command === "transfer_project_entries");
  assert.deepEqual(sent.args, { sourceRoot: ROOT, targetRoot: LIB_B, sourcePaths: [note, image], mode: "move" });
  assert.equal(sent.pathChanging, true, "送るあいだは自動保存を止める");
  assert.equal(refs.projectEntryPathChangeInProgressRef.current, false);
  const saved = app.log.find((entry) => entry.command === "save_text_file");
  assert.deepEqual(saved.args, { path: sentNote, content: "@[[素材/資料/港-2.png]] と @[[素材/資料/地図.pdf]]", expectedHash: "h1" }, "一緒に送った画像だけを書き換える");
  assert.deepEqual(app.postNoteMoves, [[ROOT, LIB_B, [{ oldPath: note, newPath: sentNote }, { oldPath: image, newPath: sentImage }]]]);
  assert.deepEqual(app.openTabs.map((item) => item.path), [p("c.txt")], "送ったノートのタブは閉じる");
  assert.equal(app.loaded.length, 1, "開いていた文書が外れたので、作品の最初のファイルを開く");
  assert.ok(commands.includes("(refresh)"));
  assert.equal(app.toasts.at(-1), "2件を作品「作品B」へ移動しました");
  const undoAction = app.toastActions.at(-1);
  assert.equal(undoAction.label, "元に戻す");

  app.log.length = 0;
  app.postNoteMoves = [];
  app.commands.undo_transfer_project_entries = (args) => ({ undone: [args.entries[0]], skipped: 1 });
  undoAction.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const undo = app.log.find((entry) => entry.command === "undo_transfer_project_entries");
  assert.equal(undo.args.mode, "move");
  assert.equal(undo.args.entries[0].contentHash, "h2", "書き換えたあとの中身と比べる");
  assert.deepEqual(app.postNoteMoves, [[LIB_B, ROOT, [{ oldPath: sentNote, newPath: note }]]], "戻したノートの札も戻す");
  assert.equal(app.toasts.at(-1), "元に戻しました（送り先で変更された1件は戻していません）");
}
{
  // コピーは元に残し、タブも札も触らない。失敗は通知で知らせる。
  const note = p("第一章", "a.txt");
  const { app, actions } = setup();
  app.commands.library_transfer_destinations = () => [{ path: "C:\\Lib", label: "ライブラリ「本棚」の直下" }];
  app.multiInputAnswer = { destination: "C:\\Lib", mode: "copy" };
  app.commands.transfer_project_entries = () => ({ entries: [{ oldPath: note, newPath: "C:\\Lib\\a.txt", kind: "text", contentHash: "h" }] });
  app.commands.read_text_file = ({ path: readPath }) => ({ path: readPath, name: "a.txt", content: "本文", contentHash: "h" });
  await actions().handleTransferEntries([note]);
  assert.deepEqual(app.openTabs.map((item) => item.path), [note, p("c.txt")]);
  assert.equal(app.postNoteMoves, undefined);
  assert.ok(!commandsOf(app).includes("save_text_file"), "書き換えるリンクがなければ書かない");
  assert.equal(app.toasts.at(-1), "「a」をライブラリ「本棚」の直下へコピーしました");

  app.commands.transfer_project_entries = () => { throw new Error("only materials can be sent"); };
  await actions().handleTransferEntries([note]);
  assert.equal(app.toasts.at(-1), "移動・コピーできませんでした");
  assert.match(app.lastError, /only materials/);

  // 送り先がなければ（ライブラリの外）、聞かない。
  app.commands.library_transfer_destinations = () => [];
  const asked = app.multiInputs.length;
  await actions().handleTransferEntries([note]);
  assert.equal(app.multiInputs.length, asked);
}

// ---- Q4: まとめての移動に素材の画像・PDF（ファイルの一覧にないもの）を入れる ----
{
  const { app, actions } = setup();
  imageWorld(app);
  const image = p("素材", "資料", "地図.png");
  const moved = p("素材", "年表", "地図.png");
  app.commands.move_project_entries = () => ({
    projectFolder: app.projectFolder,
    moves: [
      { movedDocument: null, oldPath: image, newPath: moved, oldParentPath: p("素材", "資料"), newParentPath: p("素材", "年表") },
      { movedDocument: { path: p("素材", "年表", "c.txt"), name: "c.txt", content: "C" }, oldPath: p("c.txt"), newPath: p("素材", "年表", "c.txt"), oldParentPath: ROOT, newParentPath: p("素材", "年表") },
    ],
  });
  await actions().handleMoveProjectEntriesToFolder([image, p("c.txt")], p("素材", "年表"));
  const sent = app.log.find((entry) => entry.command === "move_project_entries");
  assert.deepEqual(sent.args, { rootPath: ROOT, sourcePaths: [image, p("c.txt")], targetFolderPath: p("素材", "年表") });
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["素材/年表/地図.png", "素材/年表/c.txt"], "資料カードも付いていく");
  assert.equal(app.toasts.at(-1), "2件のファイルを移動しました");

  // 画像が同じフォルダにあれば外す。画像だけ1つになったら、画像の移動と同じ。
  app.log.length = 0;
  app.commands.move_project_entry = () => ({ projectFolder: app.projectFolder, movedDocument: null, oldPath: image, newPath: moved, oldParentPath: p("素材", "資料"), newParentPath: p("素材", "年表") });
  await actions().handleMoveProjectEntriesToFolder([image], p("素材", "年表"));
  assert.deepEqual(app.log.find((entry) => entry.command === "move_project_entry").args, { rootPath: ROOT, sourcePath: image, targetFolderPath: p("素材", "年表"), targetPath: null, position: null });
  app.log.length = 0;
  await actions().handleMoveProjectEntriesToFolder([image, p("素材", "資料", "設定.pdf")], p("素材", "資料"));
  assert.deepEqual(commandsOf(app), [], "どれも同じフォルダにあれば何もしない");
}

console.log("project entry actions: ok");
