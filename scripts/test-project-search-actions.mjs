// 左サイドバーの検索と置換（createProjectSearchActions）を実際に動かして確かめる。
// invoke はメモリの中のファイルに読み書きする入れ物に差し替え、App の値の代わりの入れ物を用意する。
// App の描画と同じく、操作のたびにその時点の値で createProjectSearchActions を作り直す。
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const stubTauri = {
  name: "stub-tauri",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "core", namespace: "stub-tauri" }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "stub-tauri" }, () => ({
      contents: "export const invoke = (command, args) => globalThis.__invoke(command, args);",
      loader: "js",
    }));
  },
};

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `project-search-actions-${process.pid}.mjs`);
const bundled = await build({
  entryPoints: ["src/projectSearchActions.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
  plugins: [stubTauri],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
globalThis.window ??= globalThis;
const { createProjectSearchActions } = await import(pathToFileURL(compiledPath).href)
  .finally(() => unlink(compiledPath));

// requestAnimationFrame は、呼ばれた順にためて、あとでまとめて流す。
let frames = [];
globalThis.requestAnimationFrame = (callback) => {
  frames.push(callback);
  return frames.length;
};
const flushFrames = () => {
  while (frames.length) {
    const pending = frames;
    frames = [];
    pending.forEach((callback) => callback(0));
  }
};
const tauri = (on) => {
  if (on) globalThis.__TAURI_INTERNALS__ = {};
  else delete globalThis.__TAURI_INTERNALS__;
};

const ROOT = "C:/work";
const file = (name) => ({ path: `${ROOT}/${name}`, name, kind: "file", children: [] });
const folder = (name, children) => ({ path: `${ROOT}/${name}`, name, kind: "folder", children });
const tab = (name, markdown, extra = {}) => ({
  id: `tab-${name}`,
  path: `${ROOT}/${name}`,
  name,
  markdown,
  savedMarkdown: markdown,
  saveStatus: "saved",
  editorRevision: 7,
  ...extra,
});

// App の値の代わり。
let s;
const reset = (overrides = {}) => {
  frames = [];
  tauri(true);
  s = {
    disk: {
      [`${ROOT}/a.md`]: "# A\n照合語がある。\n",
      [`${ROOT}/b.md`]: "# B\n照合語と照合語。\n",
      [`${ROOT}/章/c.md`]: "# C\n照合語。\n",
      [`${ROOT}/d.md`]: "# D\n何もない。\n",
    },
    projectFolder: {
      path: ROOT,
      name: "work",
      children: [file("a.md"), file("b.md"), folder("章", [{ ...file("c.md"), path: `${ROOT}/章/c.md` }]), file("d.md")],
    },
    currentFilePath: `${ROOT}/a.md`,
    // a.md は編集中（未保存）、b.md は開いているだけ（ディスクと違う本文を持つ）、c.md と d.md は開いていない。
    openTabs: [
      tab("a.md", "# A\n照合語がある。\n", { saveStatus: "dirty" }),
      tab("b.md", "# B\n照合語と照合語。追記\n"),
      tab("other.md", "# 他\n照合語\n"),
    ],
    markdown: "# A\n照合語がある。編集中\n",
    projectSearchQuery: "照合語",
    projectReplaceValue: "照合済",
    projectSearchOptions: { useRegex: false, matchCase: false },
    hasPropertyConditions: false,
    projectSearchOutcome: { results: [], total: 4, matchedFileCount: 3, truncated: false, error: null },
    pendingSearchJumpRef: { current: null },
    editorCalls: [],
    lastSavedMarkdownRef: { current: "# A\n照合語がある。\n" },
    appState: { markdown: "# A\n照合語がある。編集中\n", lastFilePath: `${ROOT}/a.md`, other: "keep" },
    projectAst: { rootPath: ROOT, files: [] },
    activeMarkdowns: [],
    saveStatuses: [],
    replacing: [],
    lastErrors: [],
    focusedFolderPaths: [],
    toasts: [],
    confirms: [],
    confirmAnswer: true,
    openWorkspaceCalls: [],
    openWorkspaceResult: true,
    fileSelects: [],
    lineJumps: [],
    invokes: [],
    failSavePath: null,
    ...overrides,
  };
  globalThis.__invoke = async (command, args) => {
    s.invokes.push({ command, path: args.path });
    if (command === "read_text_file") {
      if (!(args.path in s.disk)) throw new Error(`missing ${args.path}`);
      return { path: args.path, name: args.path.split("/").pop(), content: s.disk[args.path] };
    }
    if (command === "save_text_file") {
      if (args.path === s.failSavePath) throw new Error(`disk full: ${args.path}`);
      s.disk[args.path] = args.content;
      return { path: args.path, name: args.path.split("/").pop(), content: args.content };
    }
    throw new Error(`unexpected command ${command}`);
  };
};
const actions = () =>
  createProjectSearchActions({
    projectFolder: s.projectFolder,
    currentFilePath: s.currentFilePath,
    openTabs: s.openTabs,
    setOpenTabs: (update) => { s.openTabs = typeof update === "function" ? update(s.openTabs) : update; },
    markdown: s.markdown,
    projectSearchQuery: s.projectSearchQuery,
    projectReplaceValue: s.projectReplaceValue,
    projectSearchOptions: s.projectSearchOptions,
    hasPropertyConditions: s.hasPropertyConditions,
    projectSearchOutcome: s.projectSearchOutcome,
    pendingSearchJumpRef: s.pendingSearchJumpRef,
    editorInstanceRef: {
      current: {
        selectRange: (from, to) => s.editorCalls.push(["selectRange", from, to]),
        focus: () => s.editorCalls.push(["focus"]),
      },
    },
    lastSavedMarkdownRef: s.lastSavedMarkdownRef,
    setAppState: (update) => { s.appState = typeof update === "function" ? update(s.appState) : update; },
    setProjectAst: (update) => { s.projectAst = typeof update === "function" ? update(s.projectAst) : update; },
    setActiveMarkdown: (next) => s.activeMarkdowns.push(next),
    setSaveStatus: (status) => s.saveStatuses.push(status),
    setIsProjectReplacing: (value) => s.replacing.push(value),
    setLastError: (value) => s.lastErrors.push(value),
    setFocusedFolderPath: (value) => s.focusedFolderPaths.push(value),
    showToast: (message) => s.toasts.push(message),
    requestConfirm: async (options) => {
      s.confirms.push(options);
      return s.confirmAnswer;
    },
    openWorkspace: async (workspacePath) => {
      s.openWorkspaceCalls.push(workspacePath);
      return s.openWorkspaceResult;
    },
    handleProjectFileSelect: async (filePath) => { s.fileSelects.push(filePath); },
    jumpToEditorLine: (line) => s.lineJumps.push(line),
  });

// --- 作品全体の置換: 前の条件で止まるとき ---
for (const [label, overrides, toast] of [
  ["作品なし", { projectFolder: null }, "先にフォルダを開いてください"],
  ["検索語なし", { projectSearchQuery: "" }, "検索語句を入力してください"],
  ["プロパティの条件", { hasPropertyConditions: true }, "プロパティの条件を含む検索では置換できません"],
  ["正規表現の誤り", { projectSearchOutcome: { results: [], total: 0, matchedFileCount: 0, truncated: false, error: "bad" } }, "正規表現に誤りがあります"],
]) {
  reset(overrides);
  await actions().handleReplaceInProject();
  assert.deepEqual(s.toasts, [toast], label);
  assert.equal(s.confirms.length, 0, `${label}: no confirmation`);
  assert.equal(s.invokes.length, 0, `${label}: nothing read or written`);
  assert.deepEqual(s.replacing, [], `${label}: never marked as replacing`);
}
reset();
tauri(false);
await actions().handleReplaceInProject();
assert.deepEqual(s.toasts, ["プロジェクト置換はTauri版で利用できます"]);
assert.equal(s.invokes.length, 0);

// 確認の文と、断ったとき。
reset({ confirmAnswer: false });
await actions().handleReplaceInProject();
assert.deepEqual(s.confirms, [{
  title: "プロジェクト全体を置換",
  message: "3ファイルの4件を置換します。",
  detail: "検索: 照合語 / 置換: 照合済\n開いているフォルダ内の本文を保存しながら置換します。",
  confirmLabel: "置換",
  danger: true,
}]);
assert.equal(s.invokes.length, 0, "declining writes nothing");
assert.deepEqual(s.replacing, []);
assert.deepEqual(s.toasts, []);

// 置換語が空のときの確認の文。
reset({ confirmAnswer: false, projectReplaceValue: "" });
await actions().handleReplaceInProject();
assert.equal(s.confirms[0].detail, "検索: 照合語 / 置換: 空文字\n開いているフォルダ内の本文を保存しながら置換します。");

// --- 作品全体の置換: 確定したとき ---
reset();
await actions().handleReplaceInProject();
assert.deepEqual(s.replacing, [true, false], "replacing flag is raised and lowered");
assert.deepEqual(s.lastErrors, [""]);
// 今のファイルは編集中の本文、開いているタブはタブの本文、開いていないファイルだけをディスクから読む。
assert.deepEqual(s.invokes, [
  { command: "save_text_file", path: `${ROOT}/a.md` },
  { command: "save_text_file", path: `${ROOT}/b.md` },
  { command: "read_text_file", path: `${ROOT}/章/c.md` },
  { command: "save_text_file", path: `${ROOT}/章/c.md` },
  { command: "read_text_file", path: `${ROOT}/d.md` },
]);
assert.equal(s.disk[`${ROOT}/a.md`], "# A\n照合済がある。編集中\n");
assert.equal(s.disk[`${ROOT}/b.md`], "# B\n照合済と照合済。追記\n");
assert.equal(s.disk[`${ROOT}/章/c.md`], "# C\n照合済。\n");
assert.equal(s.disk[`${ROOT}/d.md`], "# D\n何もない。\n");
// 保存したファイルのタブは、保存した本文で保存済みになる。ほかのタブはそのまま。
assert.deepEqual(s.openTabs.map((item) => [item.name, item.markdown, item.savedMarkdown, item.saveStatus, item.editorRevision]), [
  ["a.md", "# A\n照合済がある。編集中\n", "# A\n照合済がある。編集中\n", "saved", null],
  ["b.md", "# B\n照合済と照合済。追記\n", "# B\n照合済と照合済。追記\n", "saved", null],
  ["other.md", "# 他\n照合語\n", "# 他\n照合語\n", "saved", 7],
]);
assert.deepEqual(s.projectAst.files.map((item) => item.path).sort(), [`${ROOT}/a.md`, `${ROOT}/b.md`, `${ROOT}/章/c.md`]);
assert.equal(s.lastSavedMarkdownRef.current, "# A\n照合済がある。編集中\n");
assert.deepEqual(s.appState, { markdown: "# A\n照合済がある。編集中\n", lastFilePath: `${ROOT}/a.md`, other: "keep" });
assert.deepEqual(s.saveStatuses, ["saved"]);
assert.deepEqual(s.toasts, ["4件をプロジェクト全体で置換しました"]);

// 今のファイルに一致がないときは、今のファイルの状態に触らない。別の作品の索引にも書かない。
reset({ markdown: "# A\n何もない。\n", projectAst: { rootPath: "C:/other", files: [] } });
await actions().handleReplaceInProject();
assert.equal(s.lastSavedMarkdownRef.current, "# A\n照合語がある。\n");
assert.deepEqual(s.appState.markdown, "# A\n照合語がある。編集中\n");
assert.deepEqual(s.saveStatuses, []);
assert.deepEqual(s.projectAst, { rootPath: "C:/other", files: [] });
assert.deepEqual(s.toasts, ["3件をプロジェクト全体で置換しました"]);

// 正規表現の置換（$1）。
reset({ projectSearchQuery: "照合(語)", projectReplaceValue: "[$1]", projectSearchOptions: { useRegex: true, matchCase: false } });
await actions().handleReplaceInProject();
assert.equal(s.disk[`${ROOT}/b.md`], "# B\n[語]と[語]。追記\n");

// 一致がひとつもないとき。
reset({ projectSearchQuery: "存在しない語" });
await actions().handleReplaceInProject();
assert.deepEqual(s.toasts, ["置換できる一致がありません"]);
assert.deepEqual(s.replacing, [true, false]);
assert.equal(s.invokes.filter((call) => call.command === "save_text_file").length, 0);

// 保存に失敗したとき: 誤りを残し、保存の状態をエラーにし、置換中の印を下ろす。
reset({ failSavePath: `${ROOT}/b.md` });
await actions().handleReplaceInProject();
assert.deepEqual(s.lastErrors, ["", `Error: disk full: ${ROOT}/b.md`]);
assert.deepEqual(s.saveStatuses, ["error"]);
assert.deepEqual(s.replacing, [true, false]);
assert.deepEqual(s.toasts, []);

// --- 今のファイルの中の置換 ---
reset({ projectSearchQuery: "" });
actions().handleReplaceInCurrentFile();
assert.deepEqual(s.toasts, ["検索語句を入力してください"]);
assert.deepEqual(s.activeMarkdowns, []);

reset({ projectSearchQuery: "(", projectSearchOptions: { useRegex: true, matchCase: false } });
actions().handleReplaceInCurrentFile();
assert.deepEqual(s.toasts, ["正規表現に誤りがあります"]);
assert.deepEqual(s.activeMarkdowns, []);

reset({ projectSearchQuery: "存在しない語" });
actions().handleReplaceInCurrentFile();
assert.deepEqual(s.toasts, ["置換できる一致がありません"]);
assert.deepEqual(s.saveStatuses, []);

reset();
actions().handleReplaceInCurrentFile();
assert.deepEqual(s.activeMarkdowns, ["# A\n照合済がある。編集中\n"], "replaces the editor text, not the tab or disk text");
assert.deepEqual(s.saveStatuses, ["dirty"]);
assert.deepEqual(s.toasts, ["1件をファイル内で置換しました"]);
assert.equal(s.invokes.length, 0, "the in-file replace writes nothing itself");

// --- 検索の結果を開く ---
// 同じ作品の別のファイル。位置があれば2フレーム後に選ぶ。
reset();
await actions().handleProjectSearchResultOpen({ path: `${ROOT}/b.md`, line: 2, absoluteFrom: 5, absoluteTo: 8 });
assert.deepEqual(s.fileSelects, [`${ROOT}/b.md`]);
assert.deepEqual(s.editorCalls, []);
flushFrames();
assert.deepEqual(s.editorCalls, [["selectRange", 5, 8], ["focus"]]);
assert.deepEqual(s.lineJumps, []);

// 今のファイルで、位置がなければ行へ飛ぶ。ファイルは開き直さない。
reset();
await actions().handleProjectSearchResultOpen({ path: `${ROOT}/a.md`, line: 2 });
assert.deepEqual(s.fileSelects, []);
assert.deepEqual(s.lineJumps, [2]);

// ライブラリの別の作品の結果: その作品を開き、開き終わった後に開き直すため ref に入れる。
const library = { path: "C:/library", projects: [{ path: "C:/library/作品B" }, { path: "C:/library/作品C" }] };
reset({ projectFolder: { path: ROOT, name: "work", children: [], library } });
const elsewhere = { path: "C:/library/作品B/本文.txt", line: 1 };
await actions().handleProjectSearchResultOpen(elsewhere);
assert.deepEqual(s.openWorkspaceCalls, ["C:/library/作品B"]);
assert.equal(s.pendingSearchJumpRef.current, elsewhere);
assert.deepEqual(s.fileSelects, []);

// 開けなかったら ref を空に戻す。
reset({ projectFolder: { path: ROOT, name: "work", children: [], library }, openWorkspaceResult: false });
await actions().handleProjectSearchResultOpen(elsewhere);
assert.equal(s.pendingSearchJumpRef.current, null);

// ライブラリ直下の結果はライブラリを開く。どの範囲にも入らない結果は何もしない。
reset({ projectFolder: { path: ROOT, name: "work", children: [], library } });
await actions().handleProjectSearchResultOpen({ path: "C:/library/直下.txt", line: 1 });
assert.deepEqual(s.openWorkspaceCalls, ["C:/library"]);
reset({ projectFolder: { path: ROOT, name: "work", children: [], library } });
await actions().handleProjectSearchResultOpen({ path: "D:/elsewhere/x.txt", line: 1 });
assert.deepEqual(s.openWorkspaceCalls, []);
assert.equal(s.pendingSearchJumpRef.current, null);
assert.deepEqual(s.fileSelects, []);
assert.deepEqual(s.lineJumps, []);

// --- ツリーの見出しから飛ぶ ---
reset();
await actions().handleProjectOutlineJump(`${ROOT}/b.md`, { line: 9 });
assert.deepEqual(s.fileSelects, [`${ROOT}/b.md`]);
assert.deepEqual(s.lineJumps, [9]);
assert.deepEqual(s.focusedFolderPaths, [null]);
reset();
await actions().handleProjectOutlineJump(`${ROOT}/a.md`, { line: 3 });
assert.deepEqual(s.fileSelects, []);
assert.deepEqual(s.lineJumps, [3]);

console.log("project search action tests passed");
