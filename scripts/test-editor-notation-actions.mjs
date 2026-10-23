import assert from "node:assert/strict";
import { build } from "esbuild";

// App.tsx から移した、記法を本文に入れる操作（右クリックメニュー・記法のダイアログ・Ctrl+B など）と、
// 右クリックメニューのコピー・切り取り・貼り付けを、実際に動かして確かめる
// （docs/EDITOR_NOTATION_ACTIONS_SEPARATION_PLAN.md）。エディタとクリップボードは入れ物で代える。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/editor/editorNotationActions.ts"; export * from "./src/editor/editorClipboardActions.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { createEditorClipboardActions, createEditorNotationActions, customNotationSpecs } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

// App の値と道具の代わり。操作のたびに最新の値で create… を作り直す（App の描画と同じ形）。
function setup(text, from, to = from, { editor: withEditor = true, clipboard = "" } = {}) {
  const app = {
    toasts: [],
    menuClosed: 0,
    notationModal: null,
    clipboard,
    clipboardFails: false,
  };
  const editor = {
    text,
    selection: { from, to },
    focused: 0,
    selected: null,
    getValue: () => editor.text,
    getSelection: () => ({ from: editor.selection.from, to: editor.selection.to, anchor: editor.selection.from, head: editor.selection.to }),
    replaceRange(rangeFrom, rangeTo, insert, cursorPos) {
      editor.text = editor.text.slice(0, rangeFrom) + insert + editor.text.slice(rangeTo);
      editor.selection = { from: cursorPos, to: cursorPos };
    },
    selectRange(rangeFrom, rangeTo) {
      editor.selection = { from: rangeFrom, to: rangeTo };
      editor.selected = [rangeFrom, rangeTo];
    },
    focus() {
      editor.focused += 1;
    },
  };
  const editorInstanceRef = { current: withEditor ? editor : null };
  const showToast = (message) => app.toasts.push(message);
  const closeEditorContextMenu = () => {
    app.menuClosed += 1;
  };
  const setNotationModal = (next) => {
    app.notationModal = typeof next === "function" ? next(app.notationModal) : next;
  };
  const writeClipboardText = async (value) => {
    if (app.clipboardFails) throw new Error("denied");
    app.clipboard = value;
  };
  const notation = () =>
    createEditorNotationActions({
      editorInstanceRef,
      notationModal: app.notationModal,
      setNotationModal,
      showToast,
      closeEditorContextMenu,
    });
  const clip = () => createEditorClipboardActions({ editorInstanceRef, writeClipboardText, showToast, closeEditorContextMenu });
  // 右クリックやパレットを開いたときの選択の控え。
  const snapshot = (a = editor.selection.from, b = editor.selection.to) => ({ from: a, to: b, text: editor.text.slice(a, b) });
  return { app, editor, notation, clip, snapshot };
}

const lastToast = (app) => app.toasts.at(-1);

// ---------------------------------------------------------------------------
// 右クリック →「縦中横」「圏点」（applyInlineNotation）
// ---------------------------------------------------------------------------
{
  const t = setup("西暦12年。", 2, 4);
  assert.equal(t.notation().applyInlineNotation(t.snapshot(), "tcy"), true);
  assert.equal(t.editor.text, "西暦[12(tcy)]年。");
  assert.deepEqual(t.editor.selection, { from: 11, to: 11 }, "cursor after the inserted notation");
  assert.equal(t.editor.focused, 1);
  assert.deepEqual(t.app.toasts, ["縦中横を反映しました"]);
  assert.equal(t.app.menuClosed, 0, "the menu is closed by the JSX, not here");
}
{
  const t = setup("大事な話", 0, 2);
  assert.equal(t.notation().applyInlineNotation(t.snapshot(), "emphasis"), true);
  assert.equal(t.editor.text, "[大事(em,goma)]な話");
  assert.deepEqual(t.app.toasts, ["圏点を反映しました"]);

  // 癖1: 右クリックの「圏点」は、すでに圏点の付いた範囲にも外側へ足す（Ctrl+I は外す）。
  const marked = t.snapshot(0, "[大事(em,goma)]".length);
  assert.equal(t.notation().applyInlineNotation(marked, "emphasis"), true);
  assert.equal(t.editor.text, "[[大事(em,goma)](em,goma)]な話");
}
{
  // 複数行・空の選択は断る。本文はそのまま。
  const t = setup("一行目\n二行目", 1, 5);
  assert.equal(t.notation().applyInlineNotation(t.snapshot(), "tcy"), false);
  assert.equal(t.editor.text, "一行目\n二行目");
  assert.deepEqual(t.app.toasts, ["単一行の範囲を選択してください"]);
  assert.equal(t.editor.focused, 0);
  assert.equal(t.notation().applyInlineNotation(t.snapshot(2, 2), "emphasis"), false);
  assert.equal(t.app.toasts.length, 2);
}
{
  // 控えが古くても、今の本文の長さに収め直す。
  const t = setup("短い", 0, 2);
  assert.equal(t.notation().applyInlineNotation({ from: 0, to: 99, text: "短いはずだった" }, "tcy"), true);
  assert.equal(t.editor.text, "[短い(tcy)]");
}
{
  // エディタが無ければ何もしない。
  const t = setup("本文", 0, 2, { editor: false });
  assert.equal(t.notation().applyInlineNotation({ from: 0, to: 2, text: "本文" }, "tcy"), false);
  assert.deepEqual(t.app.toasts, []);
}

// ---------------------------------------------------------------------------
// ルビ: 右クリック →「ルビ…」→ ダイアログ（openRubyNotationModal / submitRubyNotation）
// ---------------------------------------------------------------------------
{
  const t = setup("東京へ行く", 0, 2);
  const selection = t.snapshot();
  t.notation().openRubyNotationModal(selection);
  assert.deepEqual(t.app.notationModal, { type: "ruby", selection, reading: "", error: "" });
  assert.equal(t.app.menuClosed, 1);
  assert.deepEqual(t.app.toasts, []);

  // 読みが空なら、ダイアログに誤りの文を出して閉じない。
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  t.notation().submitRubyNotation(event);
  assert.equal(prevented, 1);
  assert.equal(t.app.notationModal?.error, "ルビを入力してください");
  assert.equal(t.editor.text, "東京へ行く");
  assert.deepEqual(t.app.toasts, []);

  // 読みの改行と ] ) は空白になり、前後の空白は外れる。
  t.app.notationModal = { ...t.app.notationModal, reading: " とう)\nきょう] " };
  t.notation().submitRubyNotation(event);
  assert.equal(t.editor.text, "[東京(rb,とう きょう)]へ行く");
  assert.equal(t.app.notationModal, null, "the dialog closes after applying");
  assert.deepEqual(t.app.toasts, ["ルビを反映しました"]);
  assert.equal(t.editor.focused, 1);
}
{
  // 1行の中の選択でなければ開かない。メニューは閉じる。
  const t = setup("一\n二", 0, 3);
  t.notation().openRubyNotationModal(t.snapshot());
  assert.equal(t.app.notationModal, null);
  assert.deepEqual(t.app.toasts, ["ルビを付ける単一行の範囲を選択してください"]);
  assert.equal(t.app.menuClosed, 1);
  t.notation().openRubyNotationModal(null);
  assert.equal(t.app.toasts.length, 2);
  assert.equal(t.app.menuClosed, 2);
}
{
  // 行指示のダイアログが開いているときの送信は何もしない。
  const t = setup("本文", 0, 2);
  t.app.notationModal = { type: "direction", selection: t.snapshot() };
  t.notation().submitRubyNotation({ preventDefault() {} });
  assert.equal(t.editor.text, "本文");
  assert.equal(t.app.notationModal?.type, "direction");
}

// ---------------------------------------------------------------------------
// 文章方向: 右クリック →「文章方向…」→ ダイアログ（openDirectionNotationModal / chooseDirectionNotation）
// ---------------------------------------------------------------------------
{
  const t = setup("一行目\n二行目\n三行目", 1, 5);
  const selection = t.snapshot();
  t.notation().openDirectionNotationModal(selection);
  assert.deepEqual(t.app.notationModal, { type: "direction", selection });
  assert.equal(t.app.menuClosed, 1);

  t.notation().chooseDirectionNotation("center");
  assert.equal(t.editor.text, "一行目[(al:center)]\n二行目[(al:center)]\n三行目");
  assert.equal(t.app.notationModal, null);
  assert.deepEqual(t.app.toasts, ["文章方向を反映しました"]);
  assert.equal(t.editor.focused, 1);

  // 癖4: 文章方向を付けると、行頭の >> は外れる。
  const u = setup(">> 見出し", 4, 4);
  u.notation().openDirectionNotationModal(u.snapshot());
  u.notation().chooseDirectionNotation("end");
  assert.equal(u.editor.text, "見出し[(al:end)]");
}
{
  const t = setup("本文", 0, 0);
  t.notation().openDirectionNotationModal(null);
  assert.equal(t.app.notationModal, null);
  assert.equal(t.app.menuClosed, 0, "nothing happens without a selection");
  // ルビのダイアログが開いているときの選択は何もしない。
  t.app.notationModal = { type: "ruby", selection: t.snapshot(0, 2), reading: "", error: "" };
  t.notation().chooseDirectionNotation("start");
  assert.equal(t.editor.text, "本文");
  assert.equal(t.app.notationModal?.type, "ruby");
}

// ---------------------------------------------------------------------------
// 右クリック →「記法をクリア」（clearSelectionNotation）
// ---------------------------------------------------------------------------
{
  const t = setup("[東京(rb,とうきょう)]と[12(tcy)]", 0, 14);
  assert.equal(t.notation().clearSelectionNotation(t.snapshot()), true);
  assert.equal(t.editor.text, "東京と[12(tcy)]");
  assert.deepEqual(t.app.toasts, ["記法をクリアしました"]);
  assert.equal(t.app.menuClosed, 1);
  assert.equal(t.editor.focused, 1);

  assert.equal(t.notation().clearSelectionNotation(t.snapshot(0, 2)), false);
  assert.equal(t.editor.text, "東京と[12(tcy)]");
  assert.equal(lastToast(t.app), "クリアできる記法がありません");
  assert.equal(t.app.menuClosed, 2, "the menu closes even when nothing is cleared");
  assert.equal(t.editor.focused, 1);

  assert.equal(t.notation().clearSelectionNotation(null), false);
  assert.equal(t.app.menuClosed, 2);
}

// ---------------------------------------------------------------------------
// Ctrl+B（applyBoldShortcut）
// ---------------------------------------------------------------------------
{
  const t = setup("強い言葉", 0, 2);
  t.notation().applyBoldShortcut();
  assert.equal(t.editor.text, "**強い**言葉");
  assert.equal(t.editor.focused, 1);
  assert.deepEqual(t.app.toasts, [], "癖3: success shows no toast");

  // パレットの控えを渡すと、エディタの今の選択ではなく控えを使う。
  t.editor.selection = { from: 0, to: 0 };
  t.notation().applyBoldShortcut(t.snapshot(0, 6));
  assert.equal(t.editor.text, "強い言葉", "the same range toggles bold off");

  const empty = setup("あい", 1, 1);
  empty.notation().applyBoldShortcut();
  assert.equal(empty.editor.text, "あ****い");
  assert.deepEqual(empty.editor.selection, { from: 3, to: 3 }, "cursor between the markers");

  const multi = setup("一\n二", 0, 3);
  multi.notation().applyBoldShortcut();
  assert.equal(multi.editor.text, "一\n二");
  assert.deepEqual(multi.app.toasts, ["太字にする単一行の範囲を選択してください"]);
  assert.equal(multi.editor.focused, 0);
}

// ---------------------------------------------------------------------------
// Ctrl+I（applyEmphasisShortcut）
// ---------------------------------------------------------------------------
{
  const t = setup("大事な話", 0, 2);
  t.notation().applyEmphasisShortcut();
  assert.equal(t.editor.text, "[大事(em,goma)]な話");
  assert.deepEqual(t.app.toasts, []);
  t.notation().applyEmphasisShortcut(t.snapshot(0, "[大事(em,goma)]".length));
  assert.equal(t.editor.text, "大事な話", "Ctrl+I removes emphasis (unlike the menu, 癖1)");

  const multi = setup("一\n二", 0, 3);
  multi.notation().applyEmphasisShortcut();
  assert.deepEqual(multi.app.toasts, ["圏点を付ける単一行の範囲を選択してください"]);
  assert.equal(multi.editor.text, "一\n二");
}

// ---------------------------------------------------------------------------
// Ctrl+数字（applyHeadingShortcut）
// ---------------------------------------------------------------------------
{
  const t = setup("章の題\n本文", 1, 1);
  t.notation().applyHeadingShortcut(2);
  assert.equal(t.editor.text, "## 章の題\n本文");
  assert.deepEqual(t.app.toasts, ["見出し2を設定しました"]);
  t.notation().applyHeadingShortcut(0, t.snapshot(4, 4));
  assert.equal(t.editor.text, "章の題\n本文");
  assert.deepEqual(t.app.toasts, ["見出し2を設定しました", "見出しを解除しました"]);
  assert.equal(t.editor.focused, 2);
}

// ---------------------------------------------------------------------------
// Ctrl+/（applyLineCommentToggle）
// ---------------------------------------------------------------------------
{
  const t = setup("一行目\n二行目", 0, 5);
  t.notation().applyLineCommentToggle();
  assert.equal(t.editor.text, "// 一行目\n// 二行目");
  assert.deepEqual(t.editor.selected, [0, t.editor.text.length], "a multi-line toggle reselects the lines");
  assert.equal(t.editor.focused, 1);
  t.notation().applyLineCommentToggle();
  assert.equal(t.editor.text, "一行目\n二行目");
  assert.deepEqual(t.app.toasts, []);

  const code = setup("```\nx = 1\n```", 5, 5);
  code.notation().applyLineCommentToggle();
  assert.equal(code.editor.text, "```\nx = 1\n```");
  assert.deepEqual(code.app.toasts, ["コード内ではコメントにできません（ブロック全体を選ぶとまとめてコメントにできます）"]);
  assert.equal(code.editor.focused, 0);
}

// エディタが無いときのショートカットは何もしない。
{
  const t = setup("本文", 0, 2, { editor: false });
  const actions = t.notation();
  actions.applyBoldShortcut();
  actions.applyEmphasisShortcut();
  actions.applyHeadingShortcut(1);
  actions.applyLineCommentToggle();
  assert.deepEqual(t.app.toasts, []);
}

// 名前と書き方（メニューの title・ダイアログ・通知に使う）。
assert.deepEqual(
  customNotationSpecs.map((spec) => [spec.id, spec.label, spec.syntax]),
  [
    ["ruby", "ルビ", "[本文(rb,ルビ)]"],
    ["tcy", "縦中横", "[本文(tcy)]"],
    ["emphasis", "圏点", "[本文(em,goma)]"],
    ["direction", "文章方向", "[(al:start|center|end)]"],
  ],
);

// ---------------------------------------------------------------------------
// 右クリック →「コピー」「切り取り」「貼り付け」
// ---------------------------------------------------------------------------
{
  const t = setup("あいうえお", 1, 3);
  await t.clip().copyEditorSelection(t.snapshot());
  assert.equal(t.app.clipboard, "いう");
  assert.equal(t.editor.text, "あいうえお");
  assert.deepEqual(t.app.toasts, ["コピーしました"]);
  assert.equal(t.app.menuClosed, 1);

  await t.clip().copyEditorSelection(t.snapshot(2, 2));
  assert.equal(lastToast(t.app), "コピーする範囲を選択してください");
  assert.equal(t.app.menuClosed, 1, "an empty selection leaves the menu open");
  await t.clip().copyEditorSelection(null);
  assert.equal(t.app.menuClosed, 1);

  t.app.clipboardFails = true;
  await t.clip().copyEditorSelection(t.snapshot());
  assert.equal(lastToast(t.app), "クリップボードへコピーできませんでした");
  assert.equal(t.app.menuClosed, 2);
}
{
  const t = setup("あいうえお", 1, 3);
  await t.clip().cutEditorSelection(t.snapshot());
  assert.equal(t.app.clipboard, "いう");
  assert.equal(t.editor.text, "あえお");
  assert.deepEqual(t.editor.selection, { from: 1, to: 1 });
  assert.equal(t.editor.focused, 1);
  assert.deepEqual(t.app.toasts, ["切り取りました"]);
  assert.equal(t.app.menuClosed, 1);

  await t.clip().cutEditorSelection(t.snapshot(1, 1));
  assert.equal(lastToast(t.app), "切り取る範囲を選択してください");
  assert.equal(t.app.menuClosed, 1);

  // クリップボードへ書けなければ、本文は切り取らない。
  t.app.clipboardFails = true;
  await t.clip().cutEditorSelection(t.snapshot(0, 1));
  assert.equal(t.editor.text, "あえお");
  assert.equal(lastToast(t.app), "クリップボードへ切り取れませんでした");
  assert.equal(t.app.menuClosed, 2);

  const none = setup("あい", 0, 1, { editor: false });
  await none.clip().cutEditorSelection({ from: 0, to: 1, text: "あ" });
  assert.deepEqual(none.app.toasts, ["切り取る範囲を選択してください"]);
}
{
  // 貼り付けはブラウザのクリップボードを読むので、navigator.clipboard を差し替える。
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const setClipboard = (clipboard) =>
    Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true, writable: true });
  try {
    const t = setup("あいうえお", 1, 3);
    setClipboard({ readText: async () => "かき" });
    await t.clip().pasteIntoEditorSelection(t.snapshot());
    assert.equal(t.editor.text, "あかきえお");
    assert.deepEqual(t.editor.selection, { from: 3, to: 3 }, "cursor after the pasted text");
    assert.equal(t.editor.focused, 1);
    assert.deepEqual(t.app.toasts, ["貼り付けました"]);
    assert.equal(t.app.menuClosed, 1);

    // 空のクリップボードは何も変えないが、メニューは閉じる。
    setClipboard({ readText: async () => "" });
    await t.clip().pasteIntoEditorSelection(t.snapshot(0, 0));
    assert.equal(t.editor.text, "あかきえお");
    assert.equal(t.app.toasts.length, 1);
    assert.equal(t.app.menuClosed, 2);

    setClipboard({ readText: async () => { throw new Error("denied"); } });
    await t.clip().pasteIntoEditorSelection(t.snapshot(0, 0));
    assert.equal(lastToast(t.app), "クリップボードから貼り付けできませんでした");
    assert.equal(t.app.menuClosed, 3);

    setClipboard(undefined);
    await t.clip().pasteIntoEditorSelection(t.snapshot(0, 0));
    assert.equal(lastToast(t.app), "クリップボードから貼り付けできませんでした", "no Clipboard API");
    assert.equal(t.app.menuClosed, 4);

    await t.clip().pasteIntoEditorSelection(null);
    assert.equal(t.app.menuClosed, 4, "nothing happens without a selection");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
}

console.log("editor notation actions: ok");
