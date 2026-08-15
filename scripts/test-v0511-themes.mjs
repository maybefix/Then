import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [types, catalog, defaultCss, standardCss, redCss, themeIndex, sharedVariants] =
  await Promise.all([
    readFile("src/types.ts", "utf8"),
    readFile("src/themes.ts", "utf8"),
    readFile("src/styles/themes/default.css", "utf8"),
    readFile("src/styles/themes/standard.css", "utf8"),
    readFile("src/styles/themes/signal-red.css", "utf8"),
    readFile("src/styles/themes/index.css", "utf8"),
    readFile("src/styles/themes/shared-variants.css", "utf8"),
  ]);

assert.match(types, /"default",\s+"standard",/s, "Default and Standard must have distinct IDs");
assert.match(catalog, /id: "default", label: "Default"/);
assert.match(catalog, /id: "standard", label: "Standard"/);
assert.match(catalog, /id: "signal-red-light", label: "Red"/);

assert.match(defaultCss, /data-theme="default"/);
assert.doesNotMatch(defaultCss, /data-theme="standard"/);
assert.match(standardCss, /data-theme="standard"/);
assert.match(themeIndex, /@import "\.\/standard\.css";/);
assert.match(sharedVariants, /data-theme="standard"/);

for (const token of [
  "--bg-root: #eeeeee",
  "--bg-primary: #fff",
  "--bg-panel: #fff",
  "--editor-bg: #fff",
  "--sidebar-bg: #fff",
  "--canvas-bg: #eeeeee",
]) {
  assert.ok(standardCss.includes(token), `Standard must preserve Red's ${token} surface`);
  assert.ok(redCss.includes(token), `Red must continue to define ${token}`);
}

assert.match(standardCss, /--text-primary: #171717/);
assert.match(standardCss, /--accent: #171717/);
assert.match(standardCss, /--accent-strong: #000/);
assert.match(standardCss, /--action-gradient: #171717/);
assert.match(standardCss, /--topbar-bg: #fff/);
assert.match(redCss, /--accent: #e60012/);

console.log("v0.5.11 theme tests passed");
