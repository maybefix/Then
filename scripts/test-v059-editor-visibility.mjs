import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importStandaloneTypeScript(path) {
  const source = await readFile(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(moduleUrl);
}

const { findJapaneseQuoteRanges } = await importStandaloneTypeScript(
  "src/editor/japaneseQuoteRanges.ts",
);
const { createVisualLineBands, findClosestVisualLineBand } =
  await importStandaloneTypeScript("src/editor/visualLineLayout.ts");

assert.deepEqual(findJapaneseQuoteRanges("地の文「会話」地の文"), [{ from: 3, to: 7 }]);
assert.deepEqual(findJapaneseQuoteRanges("「一」そして「二」"), [
  { from: 0, to: 3 },
  { from: 6, to: 9 },
]);
assert.deepEqual(
  findJapaneseQuoteRanges("😀「入れ子「内側」まで」"),
  [{ from: 2, to: 13 }],
  "ranges must use UTF-16 offsets and keep nested quotes together",
);
assert.deepEqual(
  findJapaneseQuoteRanges("閉じない「会話"),
  [],
  "an unmatched opening bracket is not an enclosed quote",
);

const verticalBands = createVisualLineBands(
  [
    {
      left: 227.82,
      right: 300.14,
      top: 20,
      bottom: 420,
      fragments: [
        // 同じ列がインライン装飾で二断片になっても、一行として扱う。
        { left: 276.31, right: 300.14, top: 32, bottom: 210 },
        { left: 276.28, right: 300.14, top: 210, bottom: 401 },
        { left: 252.07, right: 276.31, top: 32, bottom: 401 },
        { left: 227.82, right: 252.07, top: 32, bottom: 180 },
      ],
    },
    {
      left: 179.21,
      right: 227.82,
      top: 20,
      bottom: 420,
      fragments: [
        { left: 203.66, right: 227.82, top: 32, bottom: 401 },
        { left: 179.21, right: 203.66, top: 32, bottom: 120 },
      ],
    },
  ],
  "vertical-rl",
);
assert.deepEqual(
  verticalBands.map(({ number, blockIndex, lineIndex }) => ({
    number,
    blockIndex,
    lineIndex,
  })),
  [
    { number: 1, blockIndex: 0, lineIndex: 0 },
    { number: 2, blockIndex: 0, lineIndex: 1 },
    { number: 3, blockIndex: 0, lineIndex: 2 },
    { number: 4, blockIndex: 1, lineIndex: 0 },
    { number: 5, blockIndex: 1, lineIndex: 1 },
  ],
  "native fragments must merge into real vertical columns and receive consecutive numbers",
);
assert.equal(
  findClosestVisualLineBand(verticalBands, 0, 258, 200)?.number,
  2,
  "the active vertical line must be resolved from the caret column, not the whole paragraph",
);
assert.equal(
  findClosestVisualLineBand(
    verticalBands,
    0,
    252.07,
    401,
    { x: 239.95, y: 390 },
  )?.number,
  3,
  "Noto Serif JP final-end caret on a shared subpixel boundary must follow the preceding glyph into the final column",
);

const horizontalBands = createVisualLineBands(
  [
    {
      left: 40,
      right: 440,
      top: 100,
      bottom: 160.25,
      fragments: [
        { left: 40, right: 210, top: 100, bottom: 120.1 },
        { left: 210, right: 430, top: 100.05, bottom: 120.1 },
        { left: 40, right: 430, top: 120.1, bottom: 140.2 },
        { left: 40, right: 190, top: 140.2, bottom: 160.25 },
      ],
    },
    {
      left: 40,
      right: 440,
      top: 160.25,
      bottom: 180.4,
      fragments: [{ left: 40, right: 140, top: 160.25, bottom: 180.4 }],
    },
  ],
  "horizontal-tb",
);
assert.deepEqual(
  horizontalBands.map(({ number, blockIndex, lineIndex }) => ({
    number,
    blockIndex,
    lineIndex,
  })),
  [
    { number: 1, blockIndex: 0, lineIndex: 0 },
    { number: 2, blockIndex: 0, lineIndex: 1 },
    { number: 3, blockIndex: 0, lineIndex: 2 },
    { number: 4, blockIndex: 1, lineIndex: 0 },
  ],
  "native fragments must merge into real horizontal rows and receive consecutive numbers",
);
assert.equal(
  findClosestVisualLineBand(horizontalBands, 0, 200, 151)?.number,
  3,
  "the active horizontal line must be resolved from the caret row",
);
assert.equal(
  createVisualLineBands(
    [
      {
        left: 0,
        right: 96,
        top: 0,
        bottom: 400,
        fragments: [
          { left: 72, right: 96, top: 0, bottom: 400 },
          { left: 48, right: 72, top: 0, bottom: 400 },
          { left: 24, right: 48, top: 0, bottom: 400 },
          { left: 0, right: 24, top: 0, bottom: 80 },
        ],
      },
    ],
    "vertical-rl",
  ).length,
  4,
  "a layout-width change must recalculate the number of wrapped visual columns",
);

const pagedVerticalBands = createVisualLineBands(
  [
    {
      left: 200,
      right: 248,
      top: 100,
      bottom: 940,
      fragments: [
        { left: 224, right: 248, top: 100, bottom: 480 },
        { left: 200, right: 224, top: 100, bottom: 260 },
        // 次ページでは同じ列位置が再利用される。これを1ページ目と
        // 統合すると、後続番号が先頭番号へ重なってしまう。
        { left: 224, right: 248, top: 600, bottom: 940 },
        { left: 200, right: 224, top: 600, bottom: 780 },
      ],
    },
  ],
  "vertical-rl",
  { fragmented: true, fragmentOrigin: 100, fragmentStep: 500 },
);
assert.deepEqual(
  pagedVerticalBands.map(({ number, top, bottom }) => ({ number, top, bottom })),
  [
    { number: 1, top: 100, bottom: 480 },
    { number: 2, top: 100, bottom: 260 },
    { number: 3, top: 600, bottom: 940 },
    { number: 4, top: 600, bottom: 780 },
  ],
  "paged vertical lines must stay separated and ordered by fragmentainer",
);
assert.deepEqual(
  pagedVerticalBands
    .filter((band) => band.bottom >= 100 && band.top <= 480)
    .map((band) => band.number),
  [1, 2],
  "the first page must not render line numbers from a later page at the same column position",
);

// 非展開の太字・ルビ等では、同じ列の通常テキストと装飾spanが離れた順序で
// Range#getClientRects() に現れる。ページ内では再統合し、同じ座標を再利用する
// 次ページの列とは分離して、通し番号を欠番なく付ける。
const decoratedPagedVerticalBands = createVisualLineBands(
  [
    {
      left: 176,
      right: 224,
      top: 100,
      bottom: 940,
      fragments: [
        { left: 200, right: 224, top: 100, bottom: 260 },
        { left: 176, right: 200, top: 100, bottom: 300 },
        // inline spanから返る、1ページ目の同じ2列の追加矩形。
        { left: 200, right: 224, top: 220, bottom: 460 },
        { left: 176, right: 200, top: 260, bottom: 480 },
        // 2ページ目は同じX座標を使うが、別fragmentainerなので別の行。
        { left: 200, right: 224, top: 600, bottom: 760 },
        { left: 176, right: 200, top: 600, bottom: 800 },
        // 2ページ目でも装飾矩形をそれぞれ元の列へ統合する。
        { left: 200, right: 224, top: 720, bottom: 900 },
        { left: 176, right: 200, top: 760, bottom: 940 },
      ],
    },
  ],
  "vertical-rl",
  { fragmented: true, fragmentOrigin: 100, fragmentStep: 500 },
);
assert.deepEqual(
  decoratedPagedVerticalBands.map(({ number, centerX, top }) => ({
    number,
    centerX,
    page: top < 600 ? 1 : 2,
  })),
  [
    { number: 1, centerX: 212, page: 1 },
    { number: 2, centerX: 188, page: 1 },
    { number: 3, centerX: 212, page: 2 },
    { number: 4, centerX: 188, page: 2 },
  ],
  "decorated columns must merge within each page and keep consecutive numbers across pages",
);

const reversePagedBands = createVisualLineBands(
  [
    {
      left: 224,
      right: 248,
      top: -400,
      bottom: 480,
      fragments: [
        { left: 224, right: 248, top: 100, bottom: 480 },
        { left: 224, right: 248, top: -400, bottom: -20 },
      ],
    },
  ],
  "vertical-rl",
  {
    fragmented: true,
    fragmentOrigin: 100,
    fragmentStep: 500,
    fragmentDirection: -1,
  },
);
assert.deepEqual(
  reversePagedBands.map(({ number, top }) => ({ number, top })),
  [
    { number: 1, top: 100 },
    { number: 2, top: -400 },
  ],
  "reverse physical fragmentation must retain document-order line numbers",
);

const [appSource, editorSource, settingsSource, appCss, foundationsCss] = await Promise.all([
  readFile("src/App.tsx", "utf8"),
  readFile("src/VerticalTextEditor.tsx", "utf8"),
  readFile("src/components/dialogs/SettingsModal.tsx", "utf8"),
  readFile("src/App.css", "utf8"),
  readFile("src/styles/themes/foundations.css", "utf8"),
]);

for (const setting of [
  "showLineNumbers",
  "highlightCurrentLine",
  "colorizeJapaneseQuotes",
]) {
  assert.match(appSource, new RegExp(`${setting}: false`), `${setting} must default to off`);
  assert.match(settingsSource, new RegExp(`settings\\.${setting}`), `${setting} needs a setting control`);
  assert.match(editorSource, new RegExp(setting), `${setting} must reach the editor`);
}

assert.match(
  appCss,
  /data-page-flow="horizontal-rtl"[\s\S]*?\.verticalTypewriterScroller\s*\{[\s\S]*?direction:\s*rtl/,
  "horizontal paging must retain the traditional right-to-left scroll direction",
);
// 本文は断片化させず1つの流れのまま置き、表示するページはブロック方向の始端を
// ずらして出す。縦書きは右から左へ流れるので、始端はページの右端になる。
// transform ではなくレイアウト上の位置で動かすのは、ブラウザのキャレット座標
// 計算に後段の変換を挟ませないため。断片化した要素では、その座標が前の断片
// （＝前のページ）のものになり、IMEの変換候補ウィンドウが前のページへ出る。
assert.match(
  editorSource,
  /root\.style\.setProperty\("--paged-root-right", `\$\{paddingX - pageOffset\}px`\)/,
  "vertical pagination must reveal the page by moving the block-start edge in layout coordinates",
);
assert.match(
  editorSource,
  /root\.style\.setProperty\("--paged-root-top", `\$\{paddingY - pageOffset\}px`\)/,
  "horizontal pagination must move the block-start edge the same way",
);
assert.doesNotMatch(
  editorSource,
  /getComputedStyle\(root\)\.transform/,
  "the page position must not be recomputed from a transform it is about to overwrite",
);
assert.doesNotMatch(
  appCss,
  /data-editor-display="paged"[\s\S]*?\.pm-root\s*\{[\s\S]*?column-width/,
  "the paged body must not be fragmented by multicol; fragments break the browser's caret coordinates",
);
assert.match(
  editorSource,
  /host\.scrollTop !== 0\) host\.scrollTop = 0/,
  "the paged clip host must never keep an internal scroll offset",
);
assert.match(
  appCss,
  /data-editor-display="paged"\]\s*\.verticalTypewriterEditor\s*\{[\s\S]*?overflow:\s*clip/,
  "the paged clip host must use overflow: clip so the browser cannot scroll it",
);
assert.match(
  editorSource,
  /pageFlowDirectionRef\.current === "horizontal-rtl"[\s\S]*?lastHorizontalPagedWheelAt[\s\S]*?movePage\(event\.deltaY > 0 \? 1 : -1\)/,
  "horizontal paged mode must map mouse-wheel gestures to page navigation",
);
assert.match(
  editorSource,
  /pageFlowDirectionRef\.current === "vertical"[\s\S]*?lastPagedWheelAt[\s\S]*?movePage\(event\.deltaY > 0 \? 1 : -1\)/,
  "vertical paged mode must retain its independent wheel navigation path",
);
assert.match(
  editorSource,
  /const movePage = \(delta: -1 \| 1\) => \{[\s\S]*?scrollToPage\(pageMetricsRef\.current\.current \+ delta, "auto"\)/,
  "paged navigation must not expose the single-fragment editor during an intermediate smooth-scroll frame",
);
// ページ送りはdeltaYだけを見る。RTLではdeltaXの符号解釈がネイティブと逆に
// なり得るうえ、チルトホイールの横成分でページが飛ぶのを避ける。
assert.doesNotMatch(
  editorSource,
  /lastHorizontalPagedWheelAt = now;\s*movePage\(delta /,
  "paged wheel navigation must not fall back to the mixed deltaX/deltaY value",
);
assert.match(
  editorSource,
  /if \(isHorizontalWriting\(writingModeRef\.current\)\) \{\s*scroller\.scrollTop \+= delta;\s*\} else \{\s*scroller\.scrollLeft -= delta;/,
  "continuous-mode wheel behavior must remain unchanged",
);
assert.match(
  editorSource,
  /requestPagedSelectionAfterReflow[\s\S]*?syncPageMetricsRef\.current\?\.\(\);[\s\S]*?revealSelectionPageNow\(currentEditor\);[\s\S]*?requestLineBreakMarks\(\)/,
  "paged edits must re-sync pagination, caret ownership, and line overlays after reflow",
);
assert.match(
  editorSource,
  /requestPagedScrollSettle[\s\S]*?--paged-root-right[\s\S]*?signature === previousSignature[\s\S]*?syncPageMetricsRef\.current\?\.\(\);[\s\S]*?requestVisualLinesRef\.current\?\.\(\)/,
  "paged scrolling must re-normalize the page position after the scroll position settles",
);
assert.match(
  editorSource,
  /const handleScroll = \(\) => \{[\s\S]*?editorDisplayModeRef\.current !== "paged" \|\| scrollFrame !== null[\s\S]*?requestAnimationFrame[\s\S]*?syncPageMetricsRef\.current\?\.\(\);[\s\S]*?requestPagedScrollSettle\(\)/,
  "scroll work must be frame-coalesced while retaining the paged settle path",
);
assert.doesNotMatch(
  editorSource,
  /pagedEditorCounter/,
  "the editor must not duplicate the page counter already shown in the app status bar",
);
assert.match(
  appCss,
  /data-editor-display="paged"\] \.verticalTypewriterScroller \{[\s\S]*?inset:\s*30px 36px;/,
  "removing the duplicate page counter must return its bottom space to the page viewport",
);
assert.match(
  appCss,
  /data-editor-display="paged"\] \.verticalTypewriterScroller \{[\s\S]*?scrollbar-gutter:\s*auto/,
  "paged RTL scrolling must not reserve an unused vertical scrollbar gutter",
);

assert.doesNotMatch(
  editorSource,
  /"data-line-number": String\(index \+ 1\)/,
  "line numbers must never be derived from top-level paragraph indexes",
);
assert.match(editorSource, /class: "japanese-quote"/);
assert.match(editorSource, /className="visibleLineNumberLayer"/);
assert.match(
  editorSource,
  /className="verticalTypewriterScroller">[\s\S]*?<div ref=\{editorHostRef\}[\s\S]*?<\/div>\s*<div\s+ref=\{visualLineLayerRef\}/,
  "visual overlays must be siblings of the scroller so filtered themes cannot shift their coordinate space",
);
assert.match(editorSource, /createVisualLineBands/);
assert.match(editorSource, /findClosestVisualLineBand/);
assert.match(
  editorSource,
  /VERTICAL_LINE_NUMBER_TOP_OFFSET_PX = 18/,
  "vertical line numbers need readable separation above the body text",
);
assert.match(
  editorSource,
  /contentRange\.getClientRects\(\)/,
  "visual lines must come from browser-rendered Range rectangles",
);
assert.doesNotMatch(
  await readFile("src/editor/visualLineLayout.ts", "utf8"),
  /extent \/ count|visualLineCount|lineHeight/,
  "font-sensitive paragraph-size division must never return",
);
assert.match(
  editorSource,
  /coordsAtPos\(characterFrom, 1\)[\s\S]*?coordsAtPos\(characterTo, -1\)/,
  "a boundary caret must be disambiguated using the adjacent rendered character",
);
assert.match(
  editorSource,
  /new ResizeObserver\(\(\) => requestVisualLines\(\)\)/,
  "font, measure, and viewport reflow must schedule fresh visual-line measurement",
);
assert.match(
  editorSource,
  /addEventListener\("loadingdone", handleFontLoadingDone\)/,
  "a completed web-font load must trigger real-line remeasurement",
);
assert.match(
  editorSource,
  /fullDecorations: showLineNumbers/,
  "line-number mode must keep every block in the same rendered markup state for stable prefixes",
);
assert.doesNotMatch(
  appCss,
  /content: attr\(data-line-number\)/,
  "CSS may not render one number per paragraph",
);
assert.match(appCss, /\.visibleLineNumber/);
assert.match(appCss, /\.activeVisualLineHighlight/);
assert.match(
  appCss,
  /\.visibleLineNumberLayer\s*\{[^}]*position:\s*absolute/s,
  "visual line overlays must use the editor shell as their containing block",
);
assert.doesNotMatch(
  appCss,
  /\.verticalTypewriterEditor \.pm-root\s*\{[^}]*padding:\s*0 50vw;/,
  "half-viewport gutters cannot move the first vertical line to targets below 50%",
);
assert.match(
  appCss,
  /\.verticalTypewriterEditor \.pm-root\s*\{[^}]*padding:\s*0 100vw;/,
  "vertical typewriter scrolling needs a full viewport gutter at both document edges",
);
assert.match(
  appCss,
  /data-show-line-numbers="true"[\s\S]*?content-visibility: visible/,
  "line-number mode must measure real wrapped blocks instead of intrinsic placeholders",
);
assert.match(appCss, /data-colorize-japanese-quotes="true"[\s\S]*?\.japanese-quote/);
assert.match(
  foundationsCss,
  /data-zone-mode="true"\]\[data-zone-left="true"\][\s\S]*?> \.leftWorkspaceCluster[\s\S]*?position: absolute/,
  "the left sidebar must leave normal layout flow only when left hover display is selected",
);
assert.match(
  foundationsCss,
  /data-zone-mode="true"\]\[data-zone-right="true"\][\s\S]*?> \.rightSidebar[\s\S]*?position: absolute/,
  "the right sidebar must leave normal layout flow only when right hover display is selected",
);
assert.match(foundationsCss, /translateX\(calc\(-100% \+ 7px\)\)/);
assert.match(foundationsCss, /translateX\(calc\(100% - 7px\)\)/);
assert.match(
  appCss,
  /\.appShell\s*\{[\s\S]*?min-width:\s*0;/,
  "the editor shell must fit the native 720px minimum window instead of overflowing at 920px",
);
assert.doesNotMatch(
  appCss,
  /\.appShell\s*\{[^}]*min-width:\s*(?:920|980)px;/,
  "no later shell rule may restore the obsolete desktop-only minimum width",
);
assert.match(
  appSource,
  /className="zoneRightSidebarHoverTarget"/,
  "zone mode needs a viewport-edge hover target independent of the scaled sidebar",
);
assert.match(appSource, /data-zone-left=/);
assert.match(appSource, /data-zone-right=/);
assert.match(appSource, /legacyZoneMode === true[\s\S]*?\? "both"/);
assert.match(appSource, /sidebarHoverMode !== "none"/);
assert.match(appSource, /settings\.sidebarHoverMode === "both" \|\| settings\.sidebarHoverMode === "left"/);
assert.match(appSource, /settings\.sidebarHoverMode === "both" \|\| settings\.sidebarHoverMode === "right"/);
assert.match(settingsSource, /<option value="none">左右とも常に表示<\/option>/);
assert.match(settingsSource, /<option value="both">左右ともホバー表示<\/option>/);
assert.match(settingsSource, /<option value="left">左側のみホバー表示<\/option>/);
assert.match(settingsSource, /<option value="right">右側のみホバー表示<\/option>/);
assert.match(
  foundationsCss,
  /> \.zoneRightSidebarHoverTarget:hover\s*\+ \.rightSidebar/,
  "hovering the fixed right-edge target must reveal the right sidebar",
);
assert.match(
  foundationsCss,
  /workspace:is\(\[data-app-mode="write"\], \[data-app-mode="plugin"\]\)[\s\S]*?> \.rightSidebar[\s\S]*?transform:\s*translateX\(calc\(100% - 7px\)\)/,
  "a Zone sidebar must keep its final editor position while covered by a plugin screen",
);
assert.match(
  foundationsCss,
  /data-zone-right="true"[\s\S]*?\.pluginRuntimeDetachedHost:not\(\.pluginModalRuntimeHost\)[\s\S]*?pointer-events:\s*none/,
  "a parked detached plugin frame must not cover the right-edge hover target",
);
assert.match(
  foundationsCss,
  /data-zone-right="true"\]:has\(\.workspace\[data-app-mode="write"\]\)[\s\S]*?\.pluginRuntimeDetachedHost:not\(\.pluginModalRuntimeHost\)[\s\S]*?opacity:\s*0/,
  "Zone hiding must apply only to a plugin docked beside the editor, never to a full plugin screen",
);
assert.doesNotMatch(
  foundationsCss,
  /data-zone-right="true"\]\s+\.pluginRuntimeDetachedHost:not\(\.pluginModalRuntimeHost\)[\s\S]*?opacity:\s*0/,
  "a full plugin screen must stay visible when the pointer enters the breadcrumb bar",
);
assert.match(
  foundationsCss,
  /:has\(\.zoneRightSidebarHoverTarget:hover\)[\s\S]*?\.activePluginRuntimeFrame[\s\S]*?pointer-events:\s*auto/,
  "revealing the Zone sidebar must restore interaction with its active plugin frame",
);
assert.match(
  foundationsCss,
  /:has\(\.pluginRuntimeDetachedHost:not\(\.pluginModalRuntimeHost\):hover\)[\s\S]*?> \.rightSidebar[\s\S]*?transform:\s*translateX\(0\)/,
  "moving from the sidebar into its detached plugin frame must keep the sidebar revealed",
);
assert.doesNotMatch(
  foundationsCss,
  /:has\(\.pluginRuntimeDetachedHost:hover\)\s*\r?\n\s*\.workspace\[data-app-mode="write"\]\s*\r?\n\s*> \.rightSidebar\s*\{/,
  "a full-window plugin modal must not reveal the right sidebar merely because the modal is hovered",
);

console.log("v0.5.9 editor visibility tests passed");
