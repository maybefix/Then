import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { readAppCss } from "./lib/read-app-css.mjs";

const bundle = await build({
  stdin: {
    contents: `export { buildAppShellAppearance, buildAppShellStyle } from "./src/appShellStyle";
      export { canvasAppearanceSettings, buildCanvasThemeStyle, canvasAppearanceAttributes } from "./src/canvasAppearance";
      export { themeCatalog } from "./src/themes";`,
    resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "error",
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { buildAppShellAppearance, buildAppShellStyle, canvasAppearanceSettings, buildCanvasThemeStyle, canvasAppearanceAttributes, themeCatalog } = api;
const settings = {
  editorFontFamily: '"Yu Mincho", serif', uiFontFamily: '"Yu Gothic UI", sans-serif',
  plotFontSource: "ui", startPageFontSource: "editor", uiFontScale: 1.25,
  fontSize: 18, lineHeight: 1.9, editorMeasureHorizontal: 80, editorMeasureVertical: 65,
  typewriterOffset: 45, zoneModeOpacity: 0.6,
};
for (const { id: theme } of themeCatalog) {
  const current = Object.freeze({ ...settings, theme });
  const shell = buildAppShellAppearance(current, '"Then Vertical Body"', '"Then Vertical Heading"');
  assert.equal(shell["data-theme"], theme);
  assert.deepEqual(shell.style, buildAppShellStyle(current, '"Then Vertical Body"', '"Then Vertical Heading"'));
  assert.equal(shell.style["--editor-font-family"], '"Then Ideographic Space", "Then Vertical Body"');
  assert.equal(shell.style["--editor-heading-font-family"], '"Then Ideographic Space", "Then Vertical Heading"');
  assert.equal(shell.style["--plot-font-family"], current.uiFontFamily);
  assert.equal(shell.style["--start-page-font-family"], '"Then Ideographic Space", "Yu Mincho", serif');
  const transferred = canvasAppearanceSettings(current);
  assert.deepEqual(transferred, { theme, editorFontFamily: current.editorFontFamily, uiFontFamily: current.uiFontFamily, uiFontScale: 1.25 });
  const payload = Object.freeze({ requestId: "first", ...transferred });
  const style = buildCanvasThemeStyle(payload);
  assert.deepEqual(style, {
    "--editor-font-family": '"Then Ideographic Space", "Yu Mincho", serif',
    "--ui-font-family": current.uiFontFamily, "--ui-font-scale": 1.25,
  });
  const windowAttributes = canvasAppearanceAttributes(false, payload, style);
  assert.equal(windowAttributes["data-theme"], theme);
  assert.equal(windowAttributes.style, style, "preserve the style object held by the existing useMemo");
  assert.deepEqual(canvasAppearanceAttributes(true, payload, style), { "data-theme": undefined, style: undefined }, "embedded canvas inherits the parent without stale overrides");
}
const emptyStyle = buildCanvasThemeStyle(null);
assert.deepEqual(emptyStyle, { "--editor-font-family": undefined, "--ui-font-family": undefined, "--ui-font-scale": undefined });
assert.deepEqual(canvasAppearanceAttributes(false, null, emptyStyle), { "data-theme": "dark", style: emptyStyle });
assert.deepEqual(canvasAppearanceAttributes(true, null, emptyStyle), { "data-theme": undefined, style: undefined });
const changed = canvasAppearanceSettings({ ...settings, theme: "rose-dark", uiFontScale: 0.8, editorFontFamily: "serif" });
assert.equal(changed.theme, "rose-dark");
assert.equal(changed.uiFontScale, 0.8);
assert.equal(buildCanvasThemeStyle(changed)["--editor-font-family"], '"Then Ideographic Space", serif');

// 読み込み先が分かれても、上書きの順番・重複したimport・参照先の階層を保つ。
await mkdir("tmp", { recursive: true });
const dir = await mkdtemp(path.resolve("tmp/appearance-reader-"));
try {
  await mkdir(path.join(dir, "nested"));
  await writeFile(path.join(dir, "entry.css"), '@import "./one.css";\r\n@import "./nested/two.css";\r\n@import "./one.css";\r\n');
  await writeFile(path.join(dir, "one.css"), ".same { color: red; }\r\n");
  await writeFile(path.join(dir, "nested/two.css"), '@import "../three.css";\r\n.same { color: blue; }\r\n');
  await writeFile(path.join(dir, "three.css"), ".same { color: green; }\r\n");
  const expanded = await readAppCss(path.join(dir, "entry.css"));
  assert.deepEqual([...expanded.matchAll(/color: (\w+)/g)].map(m => m[1]), ["red", "green", "blue", "red"]);
  await writeFile(path.join(dir, "cycle.css"), '@import "./cycle.css";\r\n');
  await assert.rejects(readAppCss(path.join(dir, "cycle.css")), /CSS import cycle/);
} finally {
  await rm(dir, { recursive: true, force: true });
}

// 分離前のファイルが指定されたときは、空行以外の全行とその順番も突き合わせる。
const beforeIndex = process.argv.indexOf("--before-css");
if (beforeIndex >= 0) {
  const normalize = s => s.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join("\n");
  assert.equal(normalize(await readAppCss()), normalize(await readFile(process.argv[beforeIndex + 1], "utf8")));
  console.log("PASS CSS: every nonblank line and its original order are unchanged");
}
console.log(`PASS appearance: ${themeCatalog.length} themes, resolved fonts, payload, canvas inheritance, fallback, CSS import order and cycles`);
