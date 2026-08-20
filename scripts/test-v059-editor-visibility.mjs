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

assert.doesNotMatch(
  editorSource,
  /"data-line-number": String\(index \+ 1\)/,
  "line numbers must never be derived from top-level paragraph indexes",
);
assert.match(editorSource, /class: "japanese-quote"/);
assert.match(editorSource, /className="visibleLineNumberLayer"/);
assert.match(editorSource, /createVisualLineBands/);
assert.match(editorSource, /findClosestVisualLineBand/);
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
  /data-zone-mode="true"[\s\S]*?> \.leftWorkspaceCluster[\s\S]*?position: absolute/,
  "hover sidebars must leave normal layout flow so the editor becomes full width",
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
assert.match(
  foundationsCss,
  /> \.zoneRightSidebarHoverTarget:hover\s*\+ \.rightSidebar/,
  "hovering the fixed right-edge target must reveal the right sidebar",
);

console.log("v0.5.9 editor visibility tests passed");
