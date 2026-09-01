import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// v0.6.0 ページ編集の監査（docs/V0.6.0_PAGING_AUDIT_AND_FIX_PROPOSAL.md）で
// 再現した3件の不具合を、実装側の経路が残っていることで固定する。
// 実DOMを伴う確認は同ドキュメントの手順で行う。

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
const appSource = await readFile("src/App.tsx", "utf8");
const appCss = await readFile("src/App.css", "utf8");
const pageBreaksSource = await readFile("src/editor/pageBreaks.ts", "utf8");

// --- バグ1: ページ寸法変更で読書位置が失われ、白紙ページが見える ---

assert.match(
  editorSource,
  /textLayoutSignature: string/,
  "the editor must accept a signature for text metrics that CSS-locked layouts cannot observe",
);

assert.match(
  editorSource,
  /const capturePagedAnchor = \(\) => \{[\s\S]*?posAtCoords/,
  "paged mode must capture a content anchor from the top of the current page",
);

assert.match(
  editorSource,
  /if \(pagedAnchorRestoreFrameRef\.current !== null\) return;/,
  "an in-flight restore must not overwrite the anchor with an intermediate position",
);

// ページの先頭位置は段落の実位置から出す。行送りの積み上げで出すと端数が溜まり、
// ページ境界が実際の行の境目からずれて、前のページの行が版面へ覗く（そこへ
// カーソルも置けてしまう）。
assert.match(
  pageBreaksSource,
  /return measure\.blockStart \+ first\.lineStart \* measure\.linePitch;/,
  "page offsets must come from the measured paragraph position, not accumulated line pitch",
);

// ページの最後の行の次の行は、版面の中から始まって外へはみ出す。paginate は
// まるごと収まる行までを1ページにするため、収まらない次の行の頭が版面の残り幅へ
// 食い込む。切る位置を版面の幅ではなく次のページが始まる位置にしないと、その頭が
// 見切れとして出る。
assert.match(
  editorSource,
  /const nextOffset = breaks\.offsets\[current\] \?\? pageOffset \+ pageBlockSize;[\s\S]*?const visibleExtent = Math\.max\(0, Math\.min\(pageBlockSize, nextOffset - pageOffset\)\)/,
  "the visible extent must end where the next page begins, not at the text block width",
);

// 行番号や折返し記号の層はスクロール領域いっぱいに置いてあるので、前後のページの
// 行に対する印まで出る。ただし行番号は版面の外側の余白へ出す作りなので、切るのは
// 行が並ぶ向き（ブロック方向）だけにする。四辺で切ると番号そのものが消える。
assert.match(
  editorSource,
  /const clipLayerToTextBlock = [\s\S]*?writingModeRef\.current === "vertical-rl"[\s\S]*?inset\(0px \$\{right\}px 0px \$\{left\}px\)/,
  "overlay layers must be clipped along the block axis only",
);

// 版面の寸法が変わるとページの割りも変わる。以前は multicol の段送り
// (columnStep) の変化で見ていたが、断片化をやめたので版面の内寸で見る。
assert.match(
  editorSource,
  /previousLayout\.contentHeight !== contentHeight[\s\S]*?requestPagedAnchorRestoreRef\.current\?\.\(\)/,
  "a page-dimension change must trigger the anchor restore, not just a metrics resync",
);

assert.match(
  editorSource,
  /previousLayout !== DEFAULT_PAGE_LAYOUT/,
  "the first measurement must not be treated as a layout change",
);

assert.match(
  editorSource,
  /const requestPagedAnchorRestore = \(\) => \{[\s\S]*?pageContainingPosition\([\s\S]*?scrollToPage\(clampedTarget, "auto"\)/,
  "the restore must scroll to the page that owns the anchor position",
);

assert.match(
  editorSource,
  /const startInitialViewportRestore = \(\) => \{[\s\S]*?editorDisplayModeRef\.current === "paged"[\s\S]*?pageContainingPosition\(editor, anchorPos\)[\s\S]*?scrollToPage\(clampedTarget, "auto"\)/,
  "tab revisit in paged mode must restore the anchor by page instead of a continuous pixel delta",
);

assert.match(
  editorSource,
  /getViewportState: \(\) => \{[\s\S]*?editorDisplayModeRef\.current === "paged"[\s\S]*?capturePagedAnchor\(\)[\s\S]*?pagedAnchorPosRef\.current/,
  "paged tabs must save a page-content anchor even when viewport center points land in blank space",
);

// 復元は総ページ数の更新が遅れて届くため、目標ページに載るまで追従する。
assert.match(
  editorSource,
  /const requestPagedAnchorRestore = \(\) => \{[\s\S]*?remainingFrames -= 1;[\s\S]*?requestAnimationFrame\(step\)/,
  "the restore must retry across frames while React updates the page surface",
);

// --- バグ2: 文字設定の変更後にページ分割が再同期されない ---

assert.match(
  appSource,
  /textLayoutSignature=\{\[[\s\S]*?settings\.fontSize,[\s\S]*?settings\.lineHeight,[\s\S]*?\]\.join\("\|"\)\}/,
  "App must feed font size and line height into the text layout signature",
);

for (const setting of [
  "editorFontFamily",
  "headingFontSource",
  "headingFontFamily",
  "editorMeasureHorizontal",
  "editorMeasureVertical",
]) {
  assert.match(
    appSource,
    new RegExp(`textLayoutSignature=\\{\\[[\\s\\S]*?settings\\.${setting},`),
    `${setting} changes text metrics and must be part of the signature`,
  );
}

assert.match(
  editorSource,
  /\}, \[editorDisplayMode, pageFlowDirection, writingMode, textLayoutSignature\]\);/,
  "display mode, flow direction, writing mode and text metrics must share the recovery effect",
);

assert.match(
  editorSource,
  /const handleFontLoadingDone = \(\) => \{[\s\S]*?requestPagedAnchorRestoreRef\.current\?\.\(\)/,
  "webfont loading completion must resync paged layout as well",
);

// --- バグ3: IME変換中にページ境界を越えると変換中テキストが見えなくなる ---

assert.match(
  editorSource,
  /const handleCompositionUpdate = \(\) => \{[\s\S]*?if \(caretStart >= areaStart && caretEnd <= areaEnd\) return;[\s\S]*?scrollToPage\(target, "auto"\)/,
  "composition must move a whole page at a time, never park between pages",
);

assert.match(
  editorSource,
  /onSelectionUpdate: \(\) => \{[\s\S]*?prepareImeLayoutTarget\(\)/,
  "the selected kinsoku span must release nowrap before composition starts",
);

assert.match(
  editorSource,
  /const handleCompositionEnd = \(\) => \{[\s\S]*?compositionSettleFrame = requestAnimationFrame\([\s\S]*?if \(composingRef\.current\) return;[\s\S]*?scrollToPage\(/,
  "the page must be re-snapped one frame after composition really ends (IME sends end/start between segments)",
);

assert.match(
  editorSource,
  /if \(compositionRevealFrame !== null\) cancelAnimationFrame\(compositionRevealFrame\);/,
  "the composition tracking frame must be cancelled on unmount",
);

assert.match(
  appCss,
  /\.ks-line-head-ban\[data-ime-layout-target="true"\][\s\S]*?white-space:\s*pre-wrap/,
  "only the selected kinsoku span must drop nowrap, or global reflow can stale the native IME position",
);

assert.doesNotMatch(
  appCss,
  /\[data-composing="true"\][\s\S]*?\.ks-line-head-ban[\s\S]*?white-space:\s*pre-wrap/,
  "composition must not release every kinsoku span and reflow all pages",
);

assert.match(
  editorSource,
  /const handleCompositionEnd = \(\) => \{[\s\S]*?compositionSettleFrame = requestAnimationFrame\([\s\S]*?if \(composingRef\.current\) return;[\s\S]*?scrollToPage\(/,
  "the page must be re-snapped one frame after composition really ends (IME sends end/start between segments)",
);

assert.match(
  editorSource,
  /if \(compositionRevealFrame !== null\) cancelAnimationFrame\(compositionRevealFrame\);/,
  "the composition tracking frame must be cancelled on unmount",
);

// --- 軽微: 改行記号を現在ページに絞る ---

assert.match(
  editorSource,
  /editorDisplayModeRef\.current === "paged" &&\s*\(rect\.right < scrollerRect\.left - 24/,
  "line-break marks must be clipped to the visible page in paged mode",
);

console.log("v0.6.0 paged layout recovery tests passed");
