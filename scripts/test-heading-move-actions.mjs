// ファイルツリーの見出しの移動と切り出し（createHeadingMoveActions）を実際に動かして確かめる。
// invoke はメモリの中のファイルに読み書きする入れ物に差し替え、App の値の代わりの入れ物を用意する。
// App の描画と同じく、操作のたびにその時点の値で createHeadingMoveActions を作り直す。
// 本文の組み替えそのもの（headingMove.ts）は test:heading-move が確かめるので、ここでは同じ関数の結果を期待に使う。
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
const compiledPath = path.join(tmpDir, `heading-move-actions-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: [
      'export { createHeadingMoveActions } from "./src/headingMoveActions";',
      'export { moveHeadingSections, extractHeadingSection } from "./src/editor/ast/headingMove";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
  define: { "import.meta.env.DEV": "false" },
  plugins: [stubTauri],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
globalThis.window ??= globalThis;
const { createHeadingMoveActions, moveHeadingSections, extractHeadingSection } =
  await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));

let frames = [];
globalThis.requestAnimationFrame = (callback) => {
  frames.push(callback);
  return frames.length;
};
globalThis.document ??= { querySelectorAll: () => [] };

const ROOT = "C:/work";
const A = `${ROOT}/第一部/a.md`;
const B = `${ROOT}/第一部/b.md`;
const C = `${ROOT}/c.md`;
const tab = (id, filePath, markdown, extra = {}) => ({
  id,
  path: filePath,
  name: filePath.split("/").pop(),
  markdown,
  savedMarkdown: markdown,
  saveStatus: "saved",
  editorRevision: 3,
  viewportState: { textLength: 1, writingMode: "vertical", anchorOffset: 0, anchorRatio: 0.2 },
  ...extra,
});
const heading = (filePath, line, title, blockId = `${title}-block`) => ({ path: filePath, line, blockId, title });

let s;
const reset = (overrides = {}) => {
  frames = [];
  s = {
    disk: {
      [A]: "# A\nA本文\n## A1\nA1本文\n## A2\nA2本文\n",
      [B]: "# B\nB本文\n",
      [C]: "# C\nC本文\n",
    },
    projectFolder: { path: ROOT, name: "work", children: [] },
    currentFilePath: A,
    // a.md は今のファイルで未保存の編集がある。b.md は開いているだけ。c.md は開いていない。
    openTabs: [
      tab("tab-a", A, "# A\nA本文（編集中）\n## A1\nA1本文\n## A2\nA2本文\n", { saveStatus: "dirty" }),
      tab("tab-b", B, "# B\nB本文\n"),
    ],
    activeTabIdRef: { current: "tab-a" },
    headingMoveInProgressRef: { current: false },
    flagDuringSave: [],
    editorViewport: { textLength: 40, writingMode: "vertical", anchorOffset: 5, anchorRatio: 0.75 },
    settings: { writingMode: "vertical", typewriterOffset: 40 },
    lastSavedMarkdownRef: { current: "# A\nA本文\n## A1\nA1本文\n## A2\nA2本文\n" },
    appState: { markdown: "# A\nA本文（編集中）\n## A1\nA1本文\n## A2\nA2本文\n", lastFilePath: A, cursorPositions: { [B]: { offset: 1, length: 9 } } },
    projectAst: { rootPath: ROOT, files: [] },
    lastErrors: [],
    toasts: [],
    choices: [],
    choiceAnswer: "primary",
    inputs: [],
    inputAnswer: "切り出し.md",
    loaded: [],
    refreshed: [],
    invokes: [],
    fail: null,
    ...overrides,
  };
  globalThis.__invoke = async (command, args) => {
    s.invokes.push({ command, args });
    s.flagDuringSave.push(s.headingMoveInProgressRef.current);
    if (command === s.fail) throw new Error(`${command} failed`);
    if (command === "read_text_file") {
      return { path: args.path, name: args.path.split("/").pop(), content: s.disk[args.path] };
    }
    if (command === "save_heading_move") {
      for (const document of args.documents) s.disk[document.path] = document.content;
      return {
        documents: args.documents.map((document) => ({
          path: document.path,
          name: document.path.split("/").pop(),
          content: document.content,
        })),
      };
    }
    if (command === "extract_heading_to_file") {
      const folder = args.sourcePath.slice(0, args.sourcePath.lastIndexOf("/"));
      const target = `${folder}/${args.fileName}`;
      s.disk[args.sourcePath] = args.sourceContent;
      s.disk[target] = args.extractedContent;
      return {
        sourceDocument: { path: args.sourcePath, name: args.sourcePath.split("/").pop(), content: args.sourceContent },
        extractedDocument: { path: target, name: args.fileName, content: args.extractedContent },
      };
    }
    throw new Error(`unexpected command ${command}`);
  };
};
const actions = () =>
  createHeadingMoveActions({
    projectFolder: s.projectFolder,
    currentFilePath: s.currentFilePath,
    openTabs: s.openTabs,
    setOpenTabs: (update) => { s.openTabs = typeof update === "function" ? update(s.openTabs) : update; },
    settings: s.settings,
    headingMoveInProgressRef: s.headingMoveInProgressRef,
    activeTabIdRef: s.activeTabIdRef,
    editorInstanceRef: { current: { getViewportState: () => s.editorViewport } },
    lastSavedMarkdownRef: s.lastSavedMarkdownRef,
    setAppState: (update) => { s.appState = typeof update === "function" ? update(s.appState) : update; },
    setProjectAst: (update) => { s.projectAst = typeof update === "function" ? update(s.projectAst) : update; },
    setLastError: (value) => s.lastErrors.push(value),
    showToast: (message) => s.toasts.push(message),
    requestChoice: async (options) => {
      s.choices.push(options);
      return s.choiceAnswer;
    },
    requestInput: async (options) => {
      s.inputs.push(options);
      return s.inputAnswer;
    },
    loadDocumentIntoEditor: (document) => {
      // 本物と同じく、開いたファイルのタブを今のタブにする。
      s.loaded.push(document.path);
      s.openTabs = [...s.openTabs, tab("tab-new", document.path, document.content)];
      s.activeTabIdRef.current = "tab-new";
    },
    refreshProjectFolder: async (folderPath) => {
      s.refreshed.push(folderPath);
      return null;
    },
  });
const saves = () => s.invokes.filter((call) => call.command !== "read_text_file");
const tabRow = (item) => [item.id, item.markdown, item.savedMarkdown, item.saveStatus, item.editorRevision];

// --- 見出しの移動: 前の条件で止まるとき ---
reset();
await actions().handleHeadingMove([], B, null, null, "append");
assert.equal(s.invokes.length, 0, "no sources does nothing");
assert.deepEqual(s.toasts, []);

reset({ headingMoveInProgressRef: { current: true } });
await actions().handleHeadingMove([heading(A, 3, "A1")], B, null, null, "append");
assert.deepEqual(s.toasts, ["見出しを移動中です"]);
assert.equal(s.invokes.length, 0);
assert.equal(s.headingMoveInProgressRef.current, true, "a refused move leaves the other operation's flag alone");

reset();
s.openTabs[1].saveStatus = "saving";
await actions().handleHeadingMove([heading(A, 3, "A1")], B, null, null, "append");
assert.deepEqual(s.toasts, ["保存完了後に見出しを移動してください"]);
assert.equal(s.invokes.length, 0);
assert.equal(s.headingMoveInProgressRef.current, false);

// --- 別のファイルへの移動 ---
reset();
await actions().handleHeadingMove([heading(A, 3, "A1")], B, null, null, "append");
const crossFile = moveHeadingSections({
  documents: [
    { path: A, markdown: "# A\nA本文（編集中）\n## A1\nA1本文\n## A2\nA2本文\n" },
    { path: B, markdown: "# B\nB本文\n" },
  ],
  sources: [{ path: A, line: 3 }],
  targetPath: B,
  targetLine: null,
  position: "append",
});
// 開いているファイルはタブの本文（未保存の編集を含む）を読み、ディスクからは読まない。
assert.deepEqual(s.invokes.map((call) => call.command), ["save_heading_move"]);
assert.deepEqual(saves()[0].args.documents, crossFile.documents.map((document) => ({ path: document.path, content: document.markdown })));
assert.match(s.disk[B], /## A1\nA1本文/);
assert.doesNotMatch(s.disk[A], /A1/);
assert.match(s.disk[A], /A本文（編集中）/, "the unsaved edit of the open file is saved with the move");
assert.deepEqual(s.flagDuringSave, [true], "the flag is up while saving");
assert.equal(s.headingMoveInProgressRef.current, false, "the flag is lowered afterwards");
assert.deepEqual(s.openTabs.map(tabRow), [
  ["tab-a", s.disk[A], s.disk[A], "saved", null],
  ["tab-b", s.disk[B], s.disk[B], "saved", null],
]);
assert.deepEqual(s.projectAst.files.map((file) => file.path).sort(), [A, B]);
assert.equal(s.lastSavedMarkdownRef.current, s.disk[A]);
assert.equal(s.appState.markdown, s.disk[A]);
assert.equal(s.appState.lastFilePath, A);
assert.deepEqual(s.lastErrors, [""]);
assert.deepEqual(s.toasts, ["見出し「A1」を別ファイルへ移動しました"]);

// 開いていないファイルへの移動は、そのファイルだけディスクから読む。ほかの作品の索引には書かない。
reset({ projectAst: { rootPath: "C:/other", files: [] } });
await actions().handleHeadingMove([heading(A, 5, "A2")], C, 1, "C-block", "after");
assert.deepEqual(s.invokes.map((call) => [call.command, call.args.path ?? null]), [
  ["read_text_file", C],
  ["save_heading_move", null],
]);
assert.match(s.disk[C], /## A2\nA2本文/);
assert.deepEqual(s.projectAst, { rootPath: "C:/other", files: [] });
assert.deepEqual(s.openTabs.map((item) => item.id), ["tab-a", "tab-b"]);
assert.equal(s.openTabs[1].editorRevision, 3, "a tab whose file did not change keeps its editor state");

// 同じファイルの中の移動。
reset();
await actions().handleHeadingMove([heading(A, 5, "A2")], A, 3, "A1-block", "before");
assert.deepEqual(saves()[0].args.documents.map((document) => document.path), [A]);
assert.match(s.disk[A], /## A2\nA2本文\n## A1\nA1本文/);
assert.deepEqual(s.toasts, ["見出し「A2」を移動しました"]);

// 複数の見出し。
reset();
await actions().handleHeadingMove([heading(A, 3, "A1"), heading(A, 5, "A2")], B, null, null, "append");
assert.deepEqual(s.toasts, ["2件の見出しを移動しました"]);
assert.match(s.disk[B], /## A1[\s\S]*## A2/);

// 変わらないとき。保存しない。
reset();
await actions().handleHeadingMove([heading(A, 3, "A1")], A, 3, "A1-block", "before");
assert.deepEqual(saves(), []);
assert.deepEqual(s.toasts, ["見出しの移動先が同じため変更はありません"]);
assert.equal(s.headingMoveInProgressRef.current, false);

// 保存に失敗したとき。
reset({ fail: "save_heading_move" });
const tabsBeforeFailure = structuredClone(s.openTabs);
await actions().handleHeadingMove([heading(A, 3, "A1")], B, null, null, "append");
assert.deepEqual(s.lastErrors, ["Error: save_heading_move failed"]);
assert.deepEqual(s.toasts, ["save_heading_move failed"]);
assert.deepEqual(s.openTabs, tabsBeforeFailure);
assert.equal(s.headingMoveInProgressRef.current, false, "the flag is lowered after a failure");

// --- 見出しの切り出し ---
reset({ headingMoveInProgressRef: { current: true } });
await actions().handleHeadingExtract(heading(A, 3, "A1"));
assert.deepEqual(s.toasts, ["見出しを移動中です"]);
assert.deepEqual(s.choices, []);

reset();
s.openTabs[0].saveStatus = "saving";
await actions().handleHeadingExtract(heading(A, 3, "A1"));
assert.deepEqual(s.toasts, ["保存完了後に見出しを切り出してください"]);
assert.deepEqual(s.choices, []);

// 選択を閉じたとき、名前を閉じたとき。
reset({ choiceAnswer: null });
await actions().handleHeadingExtract(heading(A, 3, "A1"));
assert.deepEqual(s.choices, [{
  title: "見出しを別ファイルへ切り出す",
  message: "「A1」の子階層も一緒に切り出しますか？",
  detail: "「この見出しのみ」では、下位レベルの見出しを元ファイルに残します。",
  primaryLabel: "子階層も含める",
  secondaryLabel: "この見出しのみ",
}]);
assert.deepEqual(s.inputs, []);
assert.equal(s.invokes.length, 0);

reset({ inputAnswer: null });
await actions().handleHeadingExtract(heading(A, 3, "A1"));
assert.deepEqual(s.inputs, [{
  title: "切り出すファイル名",
  label: "テキストファイル名",
  initialValue: "A1.md",
  confirmLabel: "切り出す",
  placeholder: "例: 第一章.md",
}]);
assert.equal(s.invokes.length, 0);
assert.equal(s.headingMoveInProgressRef.current, false);

// 名前の候補: ファイル名に使えない文字を空白にし、末尾の点と空白を落とし、元の拡張子を付ける。
for (const [title, sourcePath, expected] of [
  ["第1章: 始まり/終わり?", A, "第1章 始まり 終わり.md"],
  ["まとめ...", `${ROOT}/メモ.txt`, "まとめ.txt"],
  ["  ", `${ROOT}/x.MD`, "切り出した見出し.MD"],
  ["名前", `${ROOT}/拡張子なし`, "名前.txt"],
]) {
  reset({ inputAnswer: null });
  await actions().handleHeadingExtract({ ...heading(sourcePath, 1, title), path: sourcePath });
  assert.equal(s.inputs[0]?.initialValue, expected, `suggested name for ${JSON.stringify(title)}`);
}

// 入れた名前に拡張子（.md・.txt）がなければ、元のファイルの拡張子を足して渡す（Rust に任せると .txt になる）。
// 拡張子を書いたときは、そのまま渡す。空白だけの名前は足さずに渡す（Rust が名前なしとして断る）。
for (const [answer, sourcePath, expected] of [
  ["切り出し", A, "切り出し.md"],
  ["  切り出し  ", A, "切り出し.md"],
  ["切り出し", `${ROOT}/メモ.txt`, "切り出し.txt"],
  ["切り出し", `${ROOT}/x.MD`, "切り出し.MD"],
  ["切り出し.txt", A, "切り出し.txt"],
  ["切り出し.MD", `${ROOT}/メモ.txt`, "切り出し.MD"],
  ["版1.2", A, "版1.2.md"],
  ["   ", A, "   "],
]) {
  reset({ inputAnswer: answer, disk: { [sourcePath]: "# 見出し\n本文\n" }, openTabs: [], currentFilePath: null });
  await actions().handleHeadingExtract({ ...heading(sourcePath, 1, "見出し"), path: sourcePath });
  const call = s.invokes.find((item) => item.command === "extract_heading_to_file");
  assert.equal(call?.args.fileName, expected, `file name for ${JSON.stringify(answer)} from ${sourcePath}`);
}

// 子階層も含めて切り出す（今のファイルから）。
reset();
await actions().handleHeadingExtract(heading(A, 1, "A"));
const withChildren = extractHeadingSection({
  sourceMarkdown: "# A\nA本文（編集中）\n## A1\nA1本文\n## A2\nA2本文\n",
  sourceLine: 1,
  includeChildren: true,
});
assert.deepEqual(s.invokes.map((call) => call.command), ["extract_heading_to_file"]);
assert.deepEqual(s.invokes[0].args, {
  sourcePath: A,
  fileName: "切り出し.md",
  sourceContent: withChildren.sourceMarkdown,
  extractedContent: withChildren.extractedMarkdown,
});
assert.deepEqual(s.flagDuringSave, [true]);
assert.equal(s.headingMoveInProgressRef.current, false);
assert.deepEqual(s.loaded, [`${ROOT}/第一部/切り出し.md`], "the extracted file is opened");
// 元のタブは保存済みにし、表示の位置を切り出した所に置く（エディタの今の位置の比率を引き継ぐ）。
const sourceTab = s.openTabs.find((item) => item.id === "tab-a");
assert.deepEqual(tabRow(sourceTab), ["tab-a", withChildren.sourceMarkdown, withChildren.sourceMarkdown, "saved", null]);
const sourceBodyLength = withChildren.sourceMarkdown.length;
assert.deepEqual(sourceTab.viewportState, {
  textLength: sourceBodyLength,
  writingMode: "vertical",
  anchorOffset: Math.min(withChildren.sourceCursorOffset, sourceBodyLength),
  anchorRatio: 0.75,
});
assert.equal(s.lastSavedMarkdownRef.current, withChildren.sourceMarkdown);
assert.equal(s.appState.markdown, withChildren.sourceMarkdown);
assert.deepEqual(s.appState.cursorPositions, {
  [B]: { offset: 1, length: 9 },
  [A]: { offset: Math.min(withChildren.sourceCursorOffset, sourceBodyLength), length: sourceBodyLength },
});
assert.deepEqual(s.projectAst.files.map((file) => file.path).sort(), [A, `${ROOT}/第一部/切り出し.md`].sort());
assert.deepEqual(s.refreshed, [`${ROOT}/第一部`]);
assert.deepEqual(s.lastErrors, [""]);
assert.deepEqual(s.toasts, ["見出し「A」を切り出しました"]);

// この見出しのみ（開いていないファイルから）。ディスクから読み、今の本文には触らない。
reset({ choiceAnswer: "secondary", currentFilePath: B });
s.activeTabIdRef.current = "tab-b";
await actions().handleHeadingExtract(heading(C, 1, "C"));
const onlyHeading = extractHeadingSection({ sourceMarkdown: "# C\nC本文\n", sourceLine: 1, includeChildren: false });
assert.deepEqual(s.invokes.map((call) => call.command), ["read_text_file", "extract_heading_to_file"]);
assert.equal(s.invokes[1].args.extractedContent, onlyHeading.extractedMarkdown);
assert.equal(s.lastSavedMarkdownRef.current, "# A\nA本文\n## A1\nA1本文\n## A2\nA2本文\n");
assert.equal(s.appState.markdown, "# A\nA本文（編集中）\n## A1\nA1本文\n## A2\nA2本文\n");
assert.equal(s.appState.cursorPositions[C].length, onlyHeading.sourceMarkdown.length);
assert.deepEqual(s.refreshed, [ROOT]);

// 開いていないファイルで、エディタの位置がないとき: タイプライターの位置を比率にする。
reset({ currentFilePath: B });
s.activeTabIdRef.current = "tab-b";
await actions().handleHeadingExtract(heading(C, 1, "C"));
assert.equal(s.openTabs.some((item) => item.path === C), false, "no tab is created for the unopened source");

// 切り出せる内容がないとき。
reset();
s.openTabs[0].markdown = "本文だけ\n";
await actions().handleHeadingExtract(heading(A, 1, "なし"));
assert.ok(s.toasts.length === 1, "one message for an extraction that cannot run");
assert.equal(s.invokes.filter((call) => call.command === "extract_heading_to_file").length, 0);
assert.equal(s.headingMoveInProgressRef.current, false);

// 保存に失敗したとき。
reset({ fail: "extract_heading_to_file" });
await actions().handleHeadingExtract(heading(A, 3, "A1"));
assert.deepEqual(s.lastErrors, ["Error: extract_heading_to_file failed"]);
assert.deepEqual(s.toasts, ["extract_heading_to_file failed"]);
assert.deepEqual(s.loaded, []);
assert.equal(s.headingMoveInProgressRef.current, false);

console.log("heading move action tests passed");
