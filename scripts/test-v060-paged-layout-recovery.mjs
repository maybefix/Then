import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// v0.6.0 ページ編集の監査（docs/V0.6.0_PAGING_AUDIT_AND_FIX_PROPOSAL.md）で
// 再現した3件の不具合を、実装側の経路が残っていることで固定する。
// 実DOMを伴う確認は同ドキュメントの手順で行う。

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
const appSource = await readFile("src/App.tsx", "utf8");
const appCss = await readFile("src/App.css", "utf8");

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

assert.match(
  editorSource,
  /previousLayout\.columnStep !== columnStep[\s\S]*?requestPagedAnchorRestoreRef\.current\?\.\(\)/,
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
  /const handleCompositionStart = \(\) => \{[\s\S]*?setAttribute\("data-composing", "true"\)/,
  "composition must mark the shell so the kinsoku spans can release nowrap",
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
  /\[data-composing="true"\][\s\S]*?\.ks-line-head-ban[\s\S]*?white-space:\s*pre-wrap/,
  "kinsoku spans must drop nowrap while composing, or the IME preedit lands inside one and never wraps",
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
