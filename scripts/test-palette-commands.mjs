import assert from "node:assert/strict";
import { build } from "esbuild";

// App.tsx から移した、コマンドパレットの一覧を作る処理を、実際に動かして確かめる
// （docs/PALETTE_COMMANDS_SEPARATION_PLAN.md）。App の値と道具は入れ物で代え、
// 一覧の並び・文言・使えない理由と、項目を選んだときに呼ぶ処理を見る。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/paletteCommands.ts"; export { createMarkdownTable, tableAlignmentEdit } from "./src/editor/markdownTables.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { createPaletteCommands, createMarkdownTable, tableAlignmentEdit } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const snapshot = (text, from, to = from) => ({ from, to, text: text.slice(from, to) });

const makeEditor = (text, from = 0, to = from) => {
  const editor = {
    text,
    selection: { from, to },
    calls: [],
    getValue: () => editor.text,
    getSelection: () => ({ ...editor.selection, head: editor.selection.to }),
    replaceRange(start, end, insert, cursor) {
      editor.calls.push(["replaceRange", start, end, insert, cursor]);
      editor.text = editor.text.slice(0, start) + insert + editor.text.slice(end);
    },
    selectRange(start, end) {
      editor.calls.push(["selectRange", start, end]);
    },
    focus() {
      editor.calls.push(["focus"]);
    },
  };
  return editor;
};

const recentWorkspaces = [
  { path: "C:\\Novel", name: "Novel" },
  { path: "D:\\Essay", name: "Essay" },
];
const pluginCommands = [
  { pluginId: "word-count", id: "count", title: "文字数を数える", keybinding: "Ctrl+Alt+W" },
  { pluginId: "outline", id: "export", title: "書き出す" },
];

function setup({
  editor = makeEditor("一行目の本文\n二行目", 0, 3),
  captured = editor ? snapshot(editor.text, 0, 3) : null,
  current = editor ? snapshot(editor.text, editor.selection.from, editor.selection.to) : null,
  projectFolder = { path: "C:\\Novel", name: "Novel", children: [] },
  showComments = false,
  showWorkspacePaths = false,
  answer = async () => ({ columns: "2", rows: "1" }),
  pluginHost = true,
} = {}) {
  const log = [];
  const record = (name) => (...args) => {
    log.push([name, ...args]);
  };
  const deps = {
    commandPaletteSelectionRef: { current: captured },
    getCurrentEditorSelection: () => current,
    editorInstanceRef: { current: editor },
    applyHeadingShortcut: record("applyHeadingShortcut"),
    openWorkspace: async (...args) => {
      log.push(["openWorkspace", ...args]);
      return true;
    },
    appState: { recentWorkspaces },
    settings: { showComments, showWorkspacePaths },
    requestMultiInput: async (request) => {
      log.push(["requestMultiInput", request]);
      return answer(deps);
    },
    showToast: record("showToast"),
    applyLineCommentToggle: record("applyLineCommentToggle"),
    toggleShowComments: record("toggleShowComments"),
    applyBoldShortcut: record("applyBoldShortcut"),
    applyEmphasisShortcut: record("applyEmphasisShortcut"),
    projectFolder,
    handleQuickCreateManuscriptSnapshot: async (...args) => {
      log.push(["handleQuickCreateManuscriptSnapshot", ...args]);
    },
    openCheckpointStudio: record("openCheckpointStudio"),
    setIsQuickIdeaModalOpen: record("setIsQuickIdeaModalOpen"),
    openIdeaCanvasBoard: async (...args) => {
      log.push(["openIdeaCanvasBoard", ...args]);
    },
    openRubyNotationModal: record("openRubyNotationModal"),
    applyInlineNotation: record("applyInlineNotation"),
    openDirectionNotationModal: record("openDirectionNotationModal"),
    clearSelectionNotation: record("clearSelectionNotation"),
    openManuscriptTidy: record("openManuscriptTidy"),
    loadedPlugins: [{ id: "word-count" }, { id: "outline" }],
    setIsPluginManagerOpen: record("setIsPluginManagerOpen"),
    pluginCommands,
    pluginRuntimeHostRef: { current: pluginHost ? { executeCommand: record("executeCommand") } : null },
  };
  const commands = createPaletteCommands(deps);
  const run = async (id) => {
    const command = commands.find((item) => item.id === id);
    assert.ok(command, `missing command ${id}`);
    log.length = 0;
    command.run();
    await flush();
    await flush();
    return log;
  };
  return { deps, commands, run, log, editor };
}

const rows = (commands) => commands.map((command) => [command.id, command.label, command.hint, command.disabledReason]);

// 並び順・文言・補助の文字（本文があり、表の外で単一行を選んでいて、作品を開いているとき）
{
  const { commands } = setup();
  const noTable = "表のセルにカーソルを置いてください";
  assert.deepEqual(rows(commands), [
    ["table-insert", "表を挿入…", "行数・列数を指定", undefined],
    ["table-align-start", "表：この列を開始揃え（横書き：左／縦書き：上）", "列の配置", noTable],
    ["table-align-center", "表：この列を中央揃え", "列の配置", noTable],
    ["table-align-end", "表：この列を終了揃え（横書き：右／縦書き：下）", "列の配置", noTable],
    ["line-comment-toggle", "行をコメントにする／戻す", "Ctrl+/", undefined],
    ["comments-visibility", "コメントを表示する", "Ctrl+Shift+/", undefined],
    ["bold", "太字", "Ctrl+B", undefined],
    ["emphasis", "圏点（傍点）", "Ctrl+I", undefined],
    ["checkpoint-create", "今の状態を保存点にする", "Ctrl+Shift+S", undefined],
    ["checkpoint-open", "チェックポイントを開く", "チェックポイント", undefined],
    ["idea-quick-capture", "Idea にメモを追加…", "Ctrl+Alt+I", undefined],
    ["idea-board-open", "Idea Board を開く", "Ctrl+Alt+B", undefined],
    ["ruby", "ルビ…", "[本文(rb,ルビ)]", undefined],
    ["tcy", "縦中横", "[本文(tcy)]", undefined],
    ["heading-1", "見出し1", "Ctrl+1", undefined],
    ["heading-2", "見出し2", "Ctrl+2", undefined],
    ["heading-3", "見出し3", "Ctrl+3", undefined],
    ["heading-4", "見出し4", "Ctrl+4", undefined],
    ["heading-5", "見出し5", "Ctrl+5", undefined],
    ["heading-6", "見出し6", "Ctrl+6", undefined],
    ["heading-clear", "見出しを解除", "Ctrl+0", undefined],
    ["direction", "文章方向…", "[(al:start|center|end)]", undefined],
    ["clear-notation", "記法をクリア", undefined, undefined],
    ["manuscript-tidy", "原稿を整える…", "字下げ・！？の後の空き", undefined],
    ["workspace-open", "別のプロジェクトを開く...", "プロジェクト", undefined],
    ["workspace-open-D:\\Essay", "プロジェクトを開く: Essay", "プロジェクト", undefined],
    ["plugin-manage", "プラグインを管理…", "2個を導入済み", undefined],
    ["plugin:word-count:count", "文字数を数える", "Ctrl+Alt+W", undefined],
    ["plugin:outline:export", "書き出す", "outline", undefined],
  ]);
}

// 設定で変わる文言
{
  const { commands } = setup({ showComments: true, showWorkspacePaths: true });
  const byId = Object.fromEntries(commands.map((command) => [command.id, command]));
  assert.equal(byId["comments-visibility"].label, "コメントを非表示にする");
  assert.equal(byId["workspace-open"].hint, "プロジェクト", "the generic open entry keeps its hint");
  assert.equal(byId["workspace-open-D:\\Essay"].hint, "D:\\Essay");
}

// 今開いている作品は「プロジェクトを開く」に出さない（パンくずのメニューと同じく、パスが同じものを今の作品とみなす）
{
  const workspaceIds = (options) =>
    setup(options).commands.map((command) => command.id).filter((id) => id.startsWith("workspace-open-"));
  assert.deepEqual(workspaceIds(), ["workspace-open-D:\\Essay"]);
  assert.deepEqual(workspaceIds({ projectFolder: { path: "D:\\Essay", name: "Essay", children: [] } }), ["workspace-open-C:\\Novel"]);
  assert.deepEqual(workspaceIds({ projectFolder: null }), ["workspace-open-C:\\Novel", "workspace-open-D:\\Essay"]);
}

// 使えない理由の出し分け
{
  const disabled = (options) =>
    Object.fromEntries(setup(options).commands.filter((command) => command.disabledReason).map((command) => [command.id, command.disabledReason]));
  const noTable = "表のセルにカーソルを置いてください";
  const noWrap = "単一行の範囲を選択してください";
  const tableOnly = { "table-align-start": noTable, "table-align-center": noTable, "table-align-end": noTable };

  // 本文を使う項目は、本文がなければ全部「本文を開いてください」で使えなくする
  const noEditor = "本文を開いてください";
  assert.deepEqual(
    disabled({ editor: null }),
    {
      "table-insert": noEditor,
      "table-align-start": noEditor,
      "table-align-center": noEditor,
      "table-align-end": noEditor,
      "line-comment-toggle": noEditor,
      bold: noEditor,
      emphasis: noEditor,
      ruby: noEditor,
      tcy: noEditor,
      "heading-1": noEditor,
      "heading-2": noEditor,
      "heading-3": noEditor,
      "heading-4": noEditor,
      "heading-5": noEditor,
      "heading-6": noEditor,
      "heading-clear": noEditor,
      direction: noEditor,
      "clear-notation": noEditor,
      "manuscript-tidy": noEditor,
    },
    "without an editor every entry that edits the text is disabled with the same reason",
  );

  const project = "プロジェクトを開いてください";
  assert.deepEqual(disabled({ projectFolder: null }), {
    ...tableOnly,
    "checkpoint-create": project,
    "checkpoint-open": project,
    "idea-board-open": project,
  });

  const multiLine = makeEditor("一行目の本文\n二行目", 2, 9);
  assert.deepEqual(disabled({ editor: multiLine, captured: snapshot(multiLine.text, 2, 9) }), {
    ...tableOnly,
    emphasis: noWrap,
    ruby: noWrap,
    tcy: noWrap,
  });

  const caretOnly = makeEditor("一行目の本文", 2);
  assert.deepEqual(disabled({ editor: caretOnly, captured: snapshot(caretOnly.text, 2) }), {
    ...tableOnly,
    emphasis: noWrap,
    ruby: noWrap,
    tcy: noWrap,
  });

  // 覚えた選択範囲がなければ、今の選択範囲で決める
  const fallback = makeEditor("一行目の本文", 0, 3);
  assert.deepEqual(disabled({ editor: fallback, captured: null, current: snapshot(fallback.text, 0, 3) }), tableOnly);

  // 表のセルの中では列の揃えが使え、補助の文字が列の番号になる
  const tableText = "前\n\n|名前|年|\n|---|---|\n|太郎|20|\n";
  const inSecondColumn = tableText.indexOf("20");
  const tableEditor = makeEditor(tableText, inSecondColumn);
  const { commands } = setup({ editor: tableEditor, captured: snapshot(tableText, inSecondColumn) });
  const align = commands.filter((command) => command.id.startsWith("table-align-"));
  assert.deepEqual(
    align.map((command) => [command.hint, command.disabledReason]),
    [["2列目", undefined], ["2列目", undefined], ["2列目", undefined]],
  );
}

// 記法などの操作は、開いたときに覚えた選択範囲を渡す
{
  const editor = makeEditor("一行目の本文\n二行目", 0, 3);
  const captured = snapshot(editor.text, 0, 3);
  const current = snapshot(editor.text, 8, 10);
  const { run } = setup({ editor, captured, current });
  assert.deepEqual(await run("bold"), [["applyBoldShortcut", captured]]);
  assert.deepEqual(await run("emphasis"), [["applyEmphasisShortcut", captured]]);
  assert.deepEqual(await run("heading-3"), [["applyHeadingShortcut", 3, captured]]);
  assert.deepEqual(await run("heading-clear"), [["applyHeadingShortcut", 0, captured]]);
  assert.deepEqual(await run("line-comment-toggle"), [["applyLineCommentToggle", captured]]);
  assert.deepEqual(await run("ruby"), [["openRubyNotationModal", captured]]);
  assert.deepEqual(await run("tcy"), [["applyInlineNotation", captured, "tcy"]]);
  assert.deepEqual(await run("direction"), [["openDirectionNotationModal", captured]]);
  assert.deepEqual(await run("clear-notation"), [["clearSelectionNotation", captured]]);
  assert.deepEqual(await run("manuscript-tidy"), [["openManuscriptTidy", captured]]);

  // 覚えた選択範囲がなければ、今の選択範囲を渡す
  const fallback = setup({ editor, captured: null, current });
  assert.deepEqual(await fallback.run("bold"), [["applyBoldShortcut", current]]);
  assert.deepEqual(await fallback.run("ruby"), [["openRubyNotationModal", current]]);

  // どちらもなければ、選択範囲なしで呼ぶ（縦中横は何もしない）
  const none = setup({ editor: null });
  assert.deepEqual(await none.run("bold"), [["applyBoldShortcut", undefined]]);
  assert.deepEqual(await none.run("heading-2"), [["applyHeadingShortcut", 2, undefined]]);
  assert.deepEqual(await none.run("ruby"), [["openRubyNotationModal", null]]);
  assert.deepEqual(await none.run("tcy"), []);
  assert.deepEqual(await none.run("manuscript-tidy"), [["openManuscriptTidy", null]]);
}

// ほかの機能を呼ぶ項目
{
  const { run } = setup();
  assert.deepEqual(await run("comments-visibility"), [["toggleShowComments"]]);
  assert.deepEqual(await run("checkpoint-create"), [["handleQuickCreateManuscriptSnapshot"]]);
  assert.deepEqual(await run("checkpoint-open"), [["openCheckpointStudio"]]);
  assert.deepEqual(await run("idea-quick-capture"), [["setIsQuickIdeaModalOpen", true]]);
  assert.deepEqual(await run("idea-board-open"), [["openIdeaCanvasBoard", "project"]]);
  assert.equal(setup().commands.some((command) => command.id === "idea-board-project"), false, "only one entry opens the Project Canvas");
  assert.deepEqual(await run("workspace-open"), [["openWorkspace"]]);
  assert.deepEqual(await run("workspace-open-D:\\Essay"), [["openWorkspace", "D:\\Essay"]]);
  assert.deepEqual(await run("plugin-manage"), [["setIsPluginManagerOpen", true]]);
  assert.deepEqual(await run("plugin:word-count:count"), [["executeCommand", "word-count", "count"]]);
  assert.deepEqual(await run("plugin:outline:export"), [["executeCommand", "outline", "export"]]);

  const withoutHost = setup({ pluginHost: false });
  assert.deepEqual(await withoutHost.run("plugin:outline:export"), [], "a missing plugin host is ignored");
}

// 表を挿入
{
  const table = createMarkdownTable(2, 1);

  // ダイアログの中身
  {
    const { run } = setup();
    const log = await run("table-insert");
    const request = log.find(([name]) => name === "requestMultiInput")[1];
    assert.equal(request.title, "表を挿入");
    assert.equal(request.confirmLabel, "挿入");
    assert.deepEqual(
      request.fields.map((field) => [field.id, field.label, field.initialValue, field.options.length, field.options[0], field.options.at(-1)]),
      [
        ["columns", "列数", "3", 10, { value: "1", label: "1列" }, { value: "10", label: "10列" }],
        ["rows", "データ行数（見出しを除く）", "3", 20, { value: "1", label: "1行" }, { value: "20", label: "20行" }],
      ],
    );
  }

  // 前後の空行の足し方と、入れた後の選択
  const cases = [
    // [本文, 入れる位置, 前に足すもの, 後に足すもの]
    ["前\n後", 2, "\n", "\n\n"],
    ["前", 1, "\n\n", "\n\n"],
    ["", 0, "", "\n\n"],
    ["前\n\n\n\n後", 3, "", ""],
    ["前\n\n後", 2, "\n", "\n"],
  ];
  for (const [text, at, prefix, suffix] of cases) {
    const editor = makeEditor(text, at);
    const { run } = setup({ editor, captured: snapshot(text, at) });
    const log = await run("table-insert");
    const cursor = at + prefix.length + 1;
    assert.deepEqual(
      editor.calls,
      [["replaceRange", at, at, prefix + table + suffix, cursor], ["selectRange", cursor, cursor + "見出し1".length], ["focus"]],
      `insert into ${JSON.stringify(text)} at ${at}`,
    );
    assert.equal(editor.text.slice(cursor, cursor + "見出し1".length), "見出し1");
    assert.deepEqual(log.filter(([name]) => name === "showToast"), [["showToast", "表を挿入しました。セルを編集できます"]]);
  }

  // 選んだ範囲を表に置き換える
  {
    const editor = makeEditor("前\n選んだ\n後", 2, 5);
    const { run } = setup({ editor, captured: snapshot(editor.text, 2, 5) });
    await run("table-insert");
    assert.deepEqual(editor.calls[0], ["replaceRange", 2, 5, `\n${table}\n`, 4]);
  }

  // 断ったら何もしない
  {
    const editor = makeEditor("前\n後", 2);
    const { run } = setup({ editor, captured: snapshot(editor.text, 2), answer: async () => null });
    const log = await run("table-insert");
    assert.deepEqual(editor.calls, []);
    assert.deepEqual(log.map(([name]) => name), ["requestMultiInput"]);
  }

  // 答えるあいだに本文が変わったら入れない
  {
    const editor = makeEditor("前\n後", 2);
    const { run } = setup({
      editor,
      captured: snapshot(editor.text, 2),
      answer: async () => {
        editor.text = "前\n書き足した\n後";
        return { columns: "2", rows: "1" };
      },
    });
    const log = await run("table-insert");
    assert.deepEqual(editor.calls, []);
    assert.deepEqual(log.slice(1), [["showToast", "本文が変わったため、挿入位置を選び直してください"]]);
  }

  // 答えるあいだに別のファイルに替わったら入れない
  {
    const editor = makeEditor("前\n後", 2);
    const other = makeEditor("前\n後", 2);
    const { run } = setup({
      editor,
      captured: snapshot(editor.text, 2),
      answer: async (deps) => {
        deps.editorInstanceRef.current = other;
        return { columns: "2", rows: "1" };
      },
    });
    const log = await run("table-insert");
    assert.deepEqual(editor.calls, []);
    assert.deepEqual(other.calls, []);
    assert.deepEqual(log.slice(1), [["showToast", "本文が変わったため、挿入位置を選び直してください"]]);
  }

  // 本文や選択範囲がなければ、ダイアログを開かない
  {
    const { run } = setup({ editor: null });
    assert.deepEqual(await run("table-insert"), []);
    const editor = makeEditor("前", 0);
    const noSelection = setup({ editor, captured: null, current: null });
    assert.deepEqual(await noSelection.run("table-insert"), []);
  }
}

// 表の列の揃え
{
  const text = "|名前|年|\n|---|---|\n|太郎|20|\n";
  const at = text.indexOf("20");
  for (const [alignment, label] of [
    ["start", "開始揃え（横書き：左／縦書き：上）"],
    ["center", "中央揃え"],
    ["end", "終了揃え（横書き：右／縦書き：下）"],
  ]) {
    const editor = makeEditor(text, at);
    const { run } = setup({ editor, captured: snapshot(text, at) });
    const expected = tableAlignmentEdit(text, at, alignment);
    assert.ok(expected, `alignment edit for ${alignment}`);
    const log = await run(`table-align-${alignment}`);
    assert.deepEqual(editor.calls, [["replaceRange", expected.from, expected.to, expected.insert, expected.cursorPos], ["focus"]]);
    assert.deepEqual(log, [["showToast", `列を${label}にしました`]]);
  }
}

console.log("palette commands: ok");
