import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [appCss, types, catalog, defaultCss, standardCss, redCss, acrylicCss, flatCss, newsroomCss, themeIndex, sharedVariants] =
  await Promise.all([
    readFile("src/App.css", "utf8"),
    readFile("src/types.ts", "utf8"),
    readFile("src/themes.ts", "utf8"),
    readFile("src/styles/themes/default.css", "utf8"),
    readFile("src/styles/themes/standard.css", "utf8"),
    readFile("src/styles/themes/signal-red.css", "utf8"),
    readFile("src/styles/themes/acrylic.css", "utf8"),
    readFile("src/styles/themes/flat.css", "utf8"),
    readFile("src/styles/themes/newsroom.css", "utf8"),
    readFile("src/styles/themes/index.css", "utf8"),
    readFile("src/styles/themes/shared-variants.css", "utf8"),
  ]);

assert.match(types, /"default",\s+"standard",/s, "Default and Standard must have distinct IDs");
assert.match(catalog, /id: "default", label: "Default"/);
assert.match(catalog, /id: "standard", label: "Standard"/);
assert.match(catalog, /id: "signal-red-light", label: "Red"/);
assert.match(catalog, /id: "acrylic-light", label: "Aero Glass"/);
assert.match(catalog, /id: "acrylic-dark", label: "Aero Glass"/);
assert.match(catalog, /id: "flat-light", label: "Flat"/);
assert.match(catalog, /id: "flat-dark", label: "Flat"/);
assert.match(catalog, /id: "newsroom-light", label: "Newsroom"/);
assert.match(catalog, /id: "newsroom-dark", label: "Newsroom"/);
assert.doesNotMatch(catalog, /label: "Modern Skeuo"/);

assert.match(defaultCss, /data-theme="default"/);
assert.doesNotMatch(defaultCss, /data-theme="standard"/);
assert.match(standardCss, /data-theme="standard"/);
assert.match(themeIndex, /@import "\.\/standard\.css";/);
assert.match(themeIndex, /@import "\.\/acrylic\.css";/);
assert.match(themeIndex, /@import "\.\/newsroom\.css";/);
assert.doesNotMatch(themeIndex, /modern-skeuo/);
assert.match(sharedVariants, /data-theme="standard"/);
assert.match(
  appCss,
  /\.appShell\[data-theme\]:not\(:is\(\[data-theme="dark"\], \[data-theme\$="-dark"\]\)\)[\s\S]*?\.workspaceSidebar:not\(\.referenceWorkspaceSidebar\)[\s\S]*?:is\(\.sidebarScroll, \.sidebarFooter\)[\s\S]*?background: var\(--bg-panel\);/,
  "Light file/search sidebars must use the same content surface as references",
);

for (const themeId of ["acrylic-light", "acrylic-dark"]) {
  assert.match(types, new RegExp(`"${themeId}"`));
  assert.match(acrylicCss, new RegExp(`data-theme="${themeId}"`));
}

for (const themeId of ["flat-light", "flat-dark"]) {
  assert.match(flatCss, new RegExp(`data-theme="${themeId}"`));
}

assert.match(types, /"newsroom-light"/);
assert.match(types, /"newsroom-dark"/);
assert.doesNotMatch(types, /"skeuo-(?:light|dark)"/);
assert.match(newsroomCss, /data-theme="newsroom-light"/);
assert.match(newsroomCss, /data-theme="newsroom-dark"/);

for (const token of [
  "--focus-ring:",
  "--success:",
  "--warning:",
  "--danger:",
]) {
  assert.ok(acrylicCss.includes(token), `Acrylic must define ${token}`);
}

for (const token of [
  "--success:",
  "--warning:",
  "--danger:",
]) {
  assert.ok(flatCss.includes(token), `Flat must define ${token}`);
}

assert.match(acrylicCss, /--radius-control: 9px/);
assert.match(flatCss, /--radius-control: 14px/);
assert.match(flatCss, /--radius-card: 20px/);
assert.match(flatCss, /--radius-button: 999px/);
assert.match(flatCss, /--brand-gradient: linear-gradient\(/);
assert.match(acrylicCss, /--panel-backdrop: blur\(/);
assert.match(acrylicCss, /@supports not \(backdrop-filter: blur\(1px\)\)/);
assert.match(acrylicCss, /linear-gradient[\s\S]*?backdrop-filter: var\(--panel-backdrop\)/);
assert.doesNotMatch(flatCss, /--card-float-shadow: none/);
assert.match(newsroomCss, /--bg-primary: #fff/);
assert.match(newsroomCss, /--text-primary: #0a0a03/);
assert.match(newsroomCss, /--accent: #b21f24/);
assert.match(newsroomCss, /data-theme="newsroom-dark"[\s\S]*?--bg-primary: #141413/);
assert.match(newsroomCss, /data-theme="newsroom-dark"[\s\S]*?--text-primary: #f2f1eb/);
assert.match(newsroomCss, /data-theme="newsroom-dark"[\s\S]*?--accent: #c73f45/);
assert.match(newsroomCss, /themePreview-newsroom-dark/);
assert.match(newsroomCss, /--radius-card: 2px/);
assert.match(newsroomCss, /--card-float-shadow: none/);
assert.doesNotMatch(newsroomCss, /(?:linear-gradient|backdrop-filter)/);
assert.match(catalog, /"skeuo-light": "newsroom-light"/);
assert.match(catalog, /"skeuo-dark": "newsroom-dark"/);

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
