import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ページ表示のIME入力を EditContext で補う経路の監査。
//
// 素の contenteditable のままなら、ブラウザが縦書きであることを OS へ伝えるので
// 変換候補ウィンドウは列の横へ正しく開く。EditContext を付けるとアプリが座標だけ
// を渡す形になり、その向きの情報が落ちて候補が真下＝書いている列の続きへ出る。
// 仕様に書字方向を渡す口はない。だから EditContext は常用せず、ブラウザの座標が
// 壊れる場合＝段落がページの境目にかかって断片化し、前のページの座標を拾って
// しまう場合にだけ使う。この切り分けを実装側のパターンで固定する。
// 実DOMを伴う確認（変換候補ウィンドウの位置）は Windows 実機で行う。

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
const appCss = await readFile("src/App.css", "utf8");

// --- EditContext はブラウザの座標が壊れるときだけ使う ---

assert.match(
  editorSource,
  /function caretBlockIsFragmented\(view: EditorView\): boolean \{[\s\S]{0,200}?getClientRects\(\)\.length > 1/,
  "the fragmented-block probe must count layout fragments, which is what breaks the browser's caret coordinates",
);

assert.match(
  editorSource,
  /const updateEditContextNeed = \(\) => \{[\s\S]{0,320}?editorDisplayModeRef\.current === "paged" && caretBlockIsFragmented\(editor\.view\)/,
  "EditContext must be limited to paged mode with a fragmented block; elsewhere the native path keeps the vertical-writing hint",
);

assert.match(
  editorSource,
  /const updateEditContextNeed = \(\) => \{\s*\n\s*if \(composingRef\.current \|\| !editorIsLive\(\)\) return;/,
  "the switch must never fire mid-composition, or the IME is interrupted",
);

assert.match(
  editorSource,
  /onSelectionUpdate: \(\) => \{[\s\S]{0,120}?configureEditContextRef\.current\?\.\(\);/,
  "moving the caret must re-evaluate whether the browser's coordinates can be trusted",
);

assert.match(
  editorSource,
  /const configureEditContext = \(enabled: boolean\) => \{[\s\S]{0,160}?attachEditContext\(\);[\s\S]{0,80}?detachEditContext\(\);/,
  "the switch must both attach and detach the EditContext",
);

assert.match(
  editorSource,
  /if \(!EditContextConstructor\) \{[\s\S]{0,240}?dataset\.editContext = "unsupported";[\s\S]{0,40}?return;/,
  "an environment without EditContext must fall back to the plain contenteditable path",
);

assert.match(
  editorSource,
  /return \(\) => \{\s*\n\s*detachEditContext\(\);/,
  "tearing down the editor must detach the EditContext before the view goes away",
);

// --- 位置は実測した矩形で渡す ---

assert.match(
  editorSource,
  /function imeCharacterBounds\([\s\S]*?domRangeRect\(view, from, to, false\)/,
  "character bounds must be measured from live DOM ranges, not derived from layout constants",
);

assert.match(
  editorSource,
  /handleEditContextCharacterBoundsUpdate[\s\S]*?context\.updateCharacterBounds\(\s*event\.rangeStart,\s*imeCharacterBounds\(/,
  "characterboundsupdate must answer with the measured rectangles",
);

assert.match(
  editorSource,
  /publishPageMetrics\(\{ current, total \}\);[\s\S]{0,240}?requestEditContextBoundsRef\.current\?\.\(\)/,
  "a page-metrics sync must re-send the input bounds, or the candidate window is left on the old page",
);

assert.match(
  editorSource,
  /if \(imeRange\) \{\s*\n\s*context\.updateCharacterBounds\(/,
  "a bounds resync during composition must refresh the character rectangles too",
);

assert.match(
  editorSource,
  /function imeSelectionBounds\([\s\S]*?getSelection\(\)[\s\S]*?getBoundingClientRect\(\)/,
  "the caret bounds must come from the rendered DOM selection first",
);

// --- 本文と EditContext のバッファを双方向に保つ ---

assert.match(
  editorSource,
  /if \(!composingRef\.current && context\.text !== next\) \{\s*\n\s*context\.updateText\(/,
  "updateText must be skipped while composing, or the IME preedit is destroyed",
);

assert.match(
  editorSource,
  /handleEditContextTextUpdate[\s\S]*?editor\.state\.tr\.replace\([\s\S]*?plainTextSlice\(editor\.state\.schema, inserted\)/,
  "textupdate must be applied to the document as a ProseMirror transaction",
);

assert.match(
  editorSource,
  /if \(composingRef\.current\) handleCompositionUpdate\(\);/,
  "composition updates must still drive the paged reveal, which no longer arrives as a DOM event",
);

assert.match(
  editorSource,
  /\["compositionstart", handleEditContextCompositionStart\],\s*\n\s*\["compositionend", handleEditContextCompositionEnd\],/,
  "composition start/end must be bridged from the EditContext to the existing paged handlers",
);

// --- ブラウザ既定の編集が止まる分を補う ---

assert.match(
  editorSource,
  /function deleteSegmentCommand\([\s\S]*?dataset\.editContext !== "active"\) return false;/,
  "the delete fallback must stay inert unless the EditContext owns input",
);

assert.match(
  editorSource,
  /keymap\(\{\s*\n\s*Backspace: deleteSegmentCommand\(-1, "grapheme"\),[\s\S]*?Delete: deleteSegmentCommand\(1, "grapheme"\),/,
  "Backspace and Delete must be bound, since EditContext suppresses the browser's own deletion",
);

assert.match(
  editorSource,
  /const graphemeSegmenter = createSegmenter\("grapheme"\)/,
  "deletion must respect grapheme boundaries (variation selectors, combining marks)",
);

// --- 変換中の下線はアプリ側で描く ---

assert.match(
  editorSource,
  /handleEditContextTextFormatUpdate[\s\S]*?imeUnderlineStyle\(format\)/,
  "textformatupdate must be turned into decorations; the browser no longer draws the preedit underline",
);

assert.match(
  appCss,
  /\.verticalTypewriterEditor \.ime-composition \{[\s\S]*?text-decoration-line: underline;/,
  "the composition decoration needs a fallback underline for when the OS sends no format",
);

console.log("EditContext IME tests passed");
