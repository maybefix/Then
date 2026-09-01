import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ページ表示のIME入力を EditContext 経由へ切り替えた変更の監査。
// multicol の断片化と transform を通した後の実座標を OS へ渡す経路と、
// 変換候補ウィンドウを書いている列の外へ開かせる経路が残っていることを、
// 実装側のパターンで固定する。
// 実DOMを伴う確認（変換候補ウィンドウの位置）は Windows 実機で行う。

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
const appCss = await readFile("src/App.css", "utf8");

// --- EditContext はページ表示のときだけ使う ---

assert.match(
  editorSource,
  /configureEditContextRef\.current\?\.\(editorDisplayMode === "paged"\)/,
  "EditContext must be attached only while the paged editor is shown",
);

assert.match(
  editorSource,
  /const configureEditContext = \(enabled: boolean\) => \{[\s\S]{0,160}?attachEditContext\(\);[\s\S]{0,80}?detachEditContext\(\);/,
  "the display-mode switch must attach and detach the EditContext",
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

// --- 候補ウィンドウは書いている列の外へ開かせる ---
//
// IME は渡された矩形の下へ窓を開く。縦書きではそれが書いている列の続きに
// あたるため、実座標をそのまま渡すと本文が隠れる。片方の軸だけ列の外へ移す。

assert.match(
  editorSource,
  /const imeBoundsForOs = \(rect: DOMRect\): DOMRect => \{[\s\S]{0,200}?if \(isHorizontalWriting\(writingModeRef\.current\)\) return rect;/,
  "only vertical writing relocates the window; horizontal keeps the real coordinates",
);

assert.match(
  editorSource,
  /const columnAdvance = rect\.width > 0 \? rect\.width : lineAdvancePx\(editor\.view\);/,
  "the column advance must be measured, so the placement follows font-size changes",
);

// 逃げ幅を px で持つと、文字寸法を変えたときにここだけ追従しなくなる。
assert.match(
  editorSource,
  /rect\.right \+ columnAdvance \* IME_CANDIDATE_COLUMN_GAP/,
  "the window must sit one column over, offset by a share of the measured column advance",
);

assert.match(
  editorSource,
  /updateSelectionBounds\(imeBoundsForOs\(caret\)\)/,
  "the caret bounds handed to the OS must go through the placement transform",
);

assert.match(
  editorSource,
  /imeCharacterBounds\(editor\.view, event\.rangeStart, event\.rangeEnd\)\.map\(imeBoundsForOs\)/,
  "character bounds must use the same transform, or the window and the caret disagree",
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
