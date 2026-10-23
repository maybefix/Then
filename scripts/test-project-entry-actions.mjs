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
    },
    plotCards: [{ id: "plot", kind: "section", num: "001", title: "", body: "@[[第一章/a.txt]] と @[[c.txt]]", expanded: false, managerCollapsed: false }],
    referenceLayout: {
      cards: [referenceCard("第一章/a.txt"), referenceCard("c.txt")],
      recent: [referenceFile("第一章/a.txt")],
    },
    referenceCandidates: [referenceFile("第一章/a.txt"), referenceFile("c.txt")],
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
      setPlotCards: setter("plotCards"),
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
      setSaveStatus: setter("saveStatus"),
      setLastError: setter("lastError"),
      showToast: (message) => app.toasts.push(message),
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
    });
  };
  return { app, refs, actions };
}

const commandsOf = (app) => app.log.map((entry) => entry.command);
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
  assert.equal(app.plotCards[0].body, "@[[第一章/a2.txt]] と @[[c.txt]]");
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["第一章/a2.txt", "c.txt"]);
  assert.deepEqual(app.referenceLayout.recent.map((item) => [item.sourcePath, item.name]), [["第一章/a2.txt", "a2.txt"]]);
  assert.deepEqual(app.referenceCandidates.map((item) => item.sourcePath), ["第一章/a2.txt", "c.txt"]);
  assert.deepEqual(app.anchorRetargets, [[oldPath, newPath]]);
  assert.equal(app.focusedFolderPath, p("第一章"));
  assert.deepEqual([...app.collapsedWorkspaceFolderPaths], [p("第一章")], "a file rename leaves folders alone");
  assert.equal(refs.projectAstBuildIdRef.current, 1);
  assert.equal(app.projectAst, null);
  assert.equal(app.saveStatus, "saved");
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
  assert.equal(app.plotCards[0].body, "@[[第1章/a.txt]] と @[[c.txt]]");
  assert.equal(app.focusedFolderPath, p("第1章"));
  assert.deepEqual([...app.collapsedWorkspaceFolderPaths], [p("第1章")]);
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
{
  const { app, refs, actions } = setup();
  app.inputAnswers.push("x.txt");
  app.commands.rename_project_entry = () => {
    throw new Error("rename failed");
  };
  await actions().handleRenameProjectEntry(file(p("c.txt")));
  assert.equal(app.lastError, "Error: rename failed");
  assert.equal(app.saveStatus, "error");
  assert.equal(refs.projectEntryPathChangeInProgressRef.current, false, "the hold is released after a failure");
  assert.deepEqual(app.toasts, []);
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
  assert.deepEqual(app.loaded, [{ document: { path: p("第一章", "b.txt"), name: "b.txt", content: "B" }, options: { replaceActive: true } }]);
  // 消したファイルを指す資料カード・最近の資料・資料の候補は外し、プロットの本文（利用者の文章）は残す
  // （docs/PROJECT_ENTRY_RETARGET_FIX_PLAN.md の確認1）。
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["c.txt"]);
  assert.deepEqual(app.referenceLayout.recent, []);
  assert.deepEqual(app.referenceCandidates.map((item) => item.sourcePath), ["c.txt"]);
  assert.equal(app.plotCards[0].body, "@[[第一章/a.txt]] と @[[c.txt]]");
  assert.deepEqual(
    forgotten(app),
    [{ key: `file:${deleted}`, discard: true }],
    "the deleted tab's record is dropped, as the confirmation said its unsaved text would be",
  );
  assert.deepEqual(app.toasts, ["「a.txt」をゴミ箱へ移動しました"]);
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
  assert.equal(app.plotCards[0].body, "@[[a.txt]] と @[[c.txt]]");
  assert.deepEqual(app.referenceLayout.cards.map((card) => card.sourcePath), ["a.txt", "c.txt"]);
  assert.deepEqual(app.anchorRetargets, [[oldPath, newPath]]);
  assert.equal(app.focusedFolderPath, ROOT, "a moved file selects its new folder");
  assert.equal(app.projectFolder, movedFolder);
  assert.equal(app.saveStatus, "saved");
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
  assert.equal(app.log[1].pathChanging, true);
  assert.equal(refs.projectEntryPathChangeInProgressRef.current, false);
  assert.equal(app.openTabs[0].path, p("a.txt"));
  assert.equal(app.activeTabId, `file:${p("a.txt")}`);
  assert.equal(app.appState.lastFilePath, p("a.txt"));
  assert.equal(app.appState.fileProgress[p("a.txt")], "writing");
  assert.deepEqual(app.anchorRetargets, [[a, p("a.txt")], [b, p("b.txt")]]);
  assert.equal(app.plotCards[0].body, "@[[a.txt]] と @[[c.txt]]");
  assert.equal(app.focusedFolderPath, ROOT);
  assert.equal(app.projectFolder, movedFolder);
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
  assert.equal(app.saveStatus, "error");
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
}
{
  const { app, actions } = setup();
  app.inputAnswers.push("第二章");
  app.commands.create_project_folder = () => ({ path: p("第二章"), name: "第二章", children: [] });
  await actions().handleCreateProjectFolder(p("第一章"));
  assert.equal(app.inputs[0].initialValue, "新規フォルダ");
  assert.deepEqual(app.log[0].args, { folderPath: p("第一章"), name: "第二章" });
  assert.equal(app.saveStatus, "saved");
  assert.deepEqual(app.toasts, ["「第二章」を作成しました"]);
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
  assert.equal(app.saveStatus, "error");
  assert.deepEqual(app.toasts, []);
}

// ---- 資料ボードの読み込み（App に残る useEffect。文字で確かめ、動くことは実機で確かめる） ----
// 名前の変更・移動・並べ替え・新規・削除で作品のフォルダの木が替わっても、資料ボードはディスクから
// 読み直さない（保存を待っている付け替えを上書きしないため）。読み直すのは資料の候補だけ。
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

console.log("project entry actions: ok");
