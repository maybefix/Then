import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  appCss,
  silkdownCss,
  types,
  catalog,
  defaultCss,
  standardCss,
  redCss,
  workbenchCss,
  indexCardCss,
  nightLibraryCss,
  flatCss,
  newsroomCss,
  senCss,
  blueSkyCss,
  orchestratingCss,
  techCss,
  graphiteCss,
  themeIndex,
  sharedVariants,
] =
  await Promise.all([
    readFile("src/App.css", "utf8"),
    readFile("src/vendor/silkdown/theme.css", "utf8"),
    readFile("src/types.ts", "utf8"),
    readFile("src/themes.ts", "utf8"),
    readFile("src/styles/themes/default.css", "utf8"),
    readFile("src/styles/themes/standard.css", "utf8"),
    readFile("src/styles/themes/signal-red.css", "utf8"),
    readFile("src/styles/themes/workbench.css", "utf8"),
    readFile("src/styles/themes/index-card.css", "utf8"),
    readFile("src/styles/themes/night-library.css", "utf8"),
    readFile("src/styles/themes/flat.css", "utf8"),
    readFile("src/styles/themes/newsroom.css", "utf8"),
    readFile("src/styles/themes/sen.css", "utf8"),
    readFile("src/styles/themes/blue-sky.css", "utf8"),
    readFile("src/styles/themes/orchestrating.css", "utf8"),
    readFile("src/styles/themes/tech.css", "utf8"),
    readFile("src/styles/themes/graphite.css", "utf8"),
    readFile("src/styles/themes/index.css", "utf8"),
    readFile("src/styles/themes/shared-variants.css", "utf8"),
  ]);

assert.match(types, /"default",\s+"standard",/s, "Default and Standard must have distinct IDs");
assert.match(catalog, /id: "default", label: "Default"/);
assert.match(catalog, /id: "standard", label: "Standard"/);
assert.match(catalog, /id: "signal-red-light", label: "Red"/);
assert.match(catalog, /id: "workbench-light", label: "Workbench"/);
assert.match(catalog, /id: "index-light", label: "Index"/);
assert.match(catalog, /id: "night-library-dark", label: "Night Library"[\s\S]*?mode: "dark"/);
assert.doesNotMatch(catalog, /label: "(?:Aero Glass|Note)"/);
assert.match(catalog, /id: "flat-light", label: "Flat"/);
assert.match(catalog, /id: "flat-dark", label: "Flat"/);
assert.match(catalog, /id: "newsroom-light", label: "Newsroom"/);
assert.match(catalog, /id: "newsroom-dark", label: "Newsroom"/);
assert.match(catalog, /id: "sen-light", label: "Shuboku"/);
assert.match(catalog, /id: "sen-dark", label: "Shuboku"[\s\S]*?mode: "dark"/);
assert.doesNotMatch(catalog, /label: "Modern Skeuo"/);

assert.match(defaultCss, /data-theme="default"/);
assert.doesNotMatch(defaultCss, /data-theme="standard"/);
assert.match(standardCss, /data-theme="standard"/);
assert.match(themeIndex, /@import "\.\/standard\.css";/);
assert.match(themeIndex, /@import "\.\/workbench\.css";/);
assert.match(themeIndex, /@import "\.\/index-card\.css";/);
assert.match(themeIndex, /@import "\.\/night-library\.css";/);
assert.doesNotMatch(themeIndex, /@import "\.\/(?:acrylic|note)\.css";/);
assert.match(themeIndex, /@import "\.\/newsroom\.css";/);
assert.match(themeIndex, /@import "\.\/sen\.css";/);
assert.doesNotMatch(themeIndex, /modern-skeuo/);
assert.match(sharedVariants, /data-theme="standard"/);
assert.match(
  appCss,
  /\.appShell\[data-theme\]:not\(:is\(\[data-theme="dark"\], \[data-theme\$="-dark"\]\)\)[\s\S]*?\.workspaceSidebar:not\(\.referenceWorkspaceSidebar\)[\s\S]*?:is\(\.sidebarScroll, \.sidebarFooter\)[\s\S]*?background: var\(--bg-panel\);/,
  "Light file/search sidebars must use the same content surface as references",
);

assert.match(types, /"workbench-light"/);
for (const themeId of ["index-light", "night-library-dark"]) {
  assert.match(types, new RegExp(`"${themeId}"`));
}
assert.doesNotMatch(types, /"(?:acrylic-(?:light|dark)|note-light)"/);
assert.match(workbenchCss, /data-theme="workbench-light"/);
assert.match(indexCardCss, /data-theme="index-light"/);
assert.match(nightLibraryCss, /data-theme="night-library-dark"/);
assert.match(catalog, /"note-light": "worker-light"/);
assert.match(catalog, /"acrylic-light": "workbench-light"/);
assert.match(catalog, /"acrylic-dark": "dark"/);

for (const themeId of ["flat-light", "flat-dark"]) {
  assert.match(flatCss, new RegExp(`data-theme="${themeId}"`));
}

assert.match(types, /"newsroom-light"/);
assert.match(types, /"newsroom-dark"/);
assert.doesNotMatch(types, /"skeuo-(?:light|dark)"/);
assert.match(newsroomCss, /data-theme="newsroom-light"/);
assert.match(newsroomCss, /data-theme="newsroom-dark"/);
assert.match(types, /"sen-light"/);
assert.match(types, /"sen-dark"/);
assert.match(senCss, /data-theme\|="sen"/);
assert.match(senCss, /data-theme="sen-dark"/);
assert.match(senCss, /--sen-ink: #1c1b18/);
assert.match(senCss, /--sen-vermilion: #b33b25/);
assert.match(senCss, /data-theme="sen-dark"[\s\S]*?--sen-paper: #1c1b18/);
assert.match(senCss, /data-theme="sen-dark"[\s\S]*?--sen-vermilion: #d85f46/);
assert.match(senCss, /\.themePreview-sen-dark/);
assert.match(
  senCss,
  /\.appFrame \{[\s\S]*?border: 0;[\s\S]*?box-shadow: none;[\s\S]*?\.appFrame::after \{[\s\S]*?z-index: 100;[\s\S]*?inset: 0;[\s\S]*?border: 3px double var\(--sen-ink\);[\s\S]*?pointer-events: none;/,
  "Shuboku's sheet edge must overlay sidebars without insetting or blocking edge hover targets",
);
assert.doesNotMatch(senCss, /linear-gradient/);
assert.doesNotMatch(senCss, /Yu Gothic UI/, "Shuboku must inherit the configured UI font");
assert.match(
  senCss,
  /\.plotRightSidebarBody > \.plotPane,[\s\S]*?\.plotCard:not\(:last-child\),[\s\S]*?\.expandedPlotCard \.plotCardNum,[\s\S]*?\.plotCardTitle, \.plotCardBody, \.plotToolButton\)[\s\S]*?border: 0;/,
  "Shuboku plot surfaces must be borderless when collapsed or expanded",
);
assert.ok(
  [...senCss.matchAll(/(?:^|\n)\s*box-shadow:\s*([^;]+);/g)]
    .every(([, value]) => value.trim() === "none"),
  "SEN must not use elevation shadows",
);

for (const token of [
  "--focus-ring:",
  "--success:",
  "--warning:",
  "--danger:",
]) {
  assert.ok(workbenchCss.includes(token), `Workbench must define ${token}`);
  assert.ok(indexCardCss.includes(token), `Index must define ${token}`);
  assert.ok(nightLibraryCss.includes(token), `Night Library must define ${token}`);
}

for (const token of [
  "--success:",
  "--warning:",
  "--danger:",
]) {
  assert.ok(flatCss.includes(token), `Flat must define ${token}`);
}

assert.match(workbenchCss, /--topbar-bg: #1d252a/);
assert.match(workbenchCss, /--sidebar-bg: #232a2f/);
assert.match(workbenchCss, /\.activeTreeItem,[\s\S]*?background: #087ea4/);
assert.match(workbenchCss, /--primary-hover: #066887/);
assert.match(workbenchCss, /--primary-pressed: #044a63/);
assert.match(indexCardCss, /background-size: 24px 24px/);
assert.match(indexCardCss, /box-shadow: inset 3px 0 #1e5a7a/);
assert.match(nightLibraryCss, /\.editorColumn \{[\s\S]*?color-scheme: light;[\s\S]*?--editor-bg: #fff9ed/);
assert.match(nightLibraryCss, /--editor-heading-color: #6f2230/);
assert.match(flatCss, /--radius-control: 14px/);
assert.match(flatCss, /--radius-card: 20px/);
assert.match(flatCss, /--radius-button: 999px/);
assert.match(flatCss, /--brand-gradient: linear-gradient\(/);
assert.doesNotMatch(flatCss, /--card-float-shadow: none/);

assert.match(appCss, /color: var\(--editor-heading-color, var\(--accent-strong\)\)/);
assert.match(silkdownCss, /color: var\(--editor-heading-color, inherit\)/);
for (const [name, css] of [
  ["BlueSky", blueSkyCss],
  ["Orchestrating", orchestratingCss],
  ["Tech", techCss],
  ["Graphite", graphiteCss],
]) {
  assert.match(css, /data-theme="[^"]+-dark"[\s\S]*?--editor-heading-color: #fff;/, `${name} dark headings must be white`);
}
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
