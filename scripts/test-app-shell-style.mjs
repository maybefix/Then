// main.appShell に置く CSS 変数（src/appShellStyle.ts の buildAppShellStyle）を、設定の値から実際に作って確かめる。
// 本文のフォントは縦書きのために選び直した名前（引数）を、プロットと起動画面は設定のフォント名を使う。
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `
      export { buildAppShellStyle } from "./src/appShellStyle";
      export { withIdeographicSpaceFont } from "./src/utils/fontStack";
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  logLevel: "error",
});
const { buildAppShellStyle, withIdeographicSpaceFont } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const settings = {
  editorFontFamily: "\"Yu Mincho\", serif",
  uiFontFamily: "\"Yu Gothic UI\", sans-serif",
  plotFontSource: "ui",
  startPageFontSource: "ui",
  uiFontScale: 1.25,
  fontSize: 18,
  lineHeight: 1.9,
  editorMeasureHorizontal: 80,
  editorMeasureVertical: 65,
  typewriterOffset: 45,
  zoneModeOpacity: 0.6,
};
const resolvedEditor = "\"Then Vertical Yu Mincho\"";
const resolvedHeading = "\"Then Vertical Yu Gothic\"";

const style = buildAppShellStyle(settings, resolvedEditor, resolvedHeading);
assert.deepEqual(Object.keys(style), [
  "--editor-font-family",
  "--ui-font-family",
  "--plot-font-family",
  "--start-page-font-family",
  "--ui-font-scale",
  "--editor-font-size",
  "--editor-line-height",
  "--editor-measure-h-ratio",
  "--editor-measure-v-ratio",
  "--editor-heading-font-family",
  "--typewriter-guide-position",
  "--zone-sidebar-opacity",
]);
assert.equal(style["--editor-font-family"], withIdeographicSpaceFont(resolvedEditor), "the body uses the re-resolved family");
assert.notEqual(style["--editor-font-family"], resolvedEditor, "the ideographic space font is appended");
assert.equal(style["--editor-heading-font-family"], withIdeographicSpaceFont(resolvedHeading));
assert.equal(style["--ui-font-family"], settings.uiFontFamily);
assert.equal(style["--plot-font-family"], settings.uiFontFamily);
assert.equal(style["--start-page-font-family"], settings.uiFontFamily);
assert.equal(style["--ui-font-scale"], 1.25);
assert.equal(style["--editor-font-size"], "18px");
assert.equal(style["--editor-line-height"], 1.9);
assert.equal(style["--editor-measure-h-ratio"], 0.8);
assert.equal(style["--editor-measure-v-ratio"], 0.65);
assert.equal(style["--typewriter-guide-position"], "45%");
assert.equal(style["--zone-sidebar-opacity"], 0.6);

// プロットと起動画面を本文のフォントにすると、設定のフォント名（選び直す前）を使う。
const editorSourced = buildAppShellStyle(
  { ...settings, plotFontSource: "editor", startPageFontSource: "editor" },
  resolvedEditor,
  resolvedHeading,
);
assert.equal(editorSourced["--plot-font-family"], withIdeographicSpaceFont(settings.editorFontFamily));
assert.equal(editorSourced["--start-page-font-family"], withIdeographicSpaceFont(settings.editorFontFamily));
assert.equal(editorSourced["--editor-font-family"], withIdeographicSpaceFont(resolvedEditor));

console.log(`app shell style tests passed (${path.basename("src/appShellStyle.ts")})`);
