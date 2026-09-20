import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const [app, css, controls, portal, packageJson, packageLock, tauriConfig, cargoToml] =
  await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/App.css", "utf8"),
    readFile("src/components/layout/WindowControls.tsx", "utf8"),
    readFile("src/components/startup/StartupPortal.tsx", "utf8"),
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("package-lock.json", "utf8").then(JSON.parse),
    readFile("src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
    readFile("src-tauri/Cargo.toml", "utf8"),
  ]);

assert.equal(packageJson.version, "0.6.5");
assert.equal(packageLock.version, "0.6.5");
assert.equal(packageLock.packages[""].version, "0.6.5");
assert.equal(tauriConfig.version, "0.6.5");
assert.match(cargoToml, /^version = "0\.6\.5"$/m);

const mainWindow = tauriConfig.app.windows[0];
assert.equal(mainWindow.decorations, false, "the Windows-native titlebar must be disabled");
assert.equal(mainWindow.shadow, true, "the frameless window must retain its native shadow");

assert.match(app, /<WindowControls \/>/);
assert.match(app, /className="topbar" data-tauri-drag-region="deep"/);
assert.match(portal, /className="startupPortalHeader" data-tauri-drag-region="deep"/);
assert.match(controls, /appWindow\.minimize\(\)/);
assert.match(controls, /appWindow\.toggleMaximize\(\)/);
assert.match(controls, /appWindow\.close\(\)/);
assert.match(controls, /appWindow\.onResized/);

assert.match(css, /body\s*\{[^}]*user-select:\s*none;/s);
assert.match(css, /\[contenteditable="true"\][^{]*\{[^}]*user-select:\s*text;/s);
assert.match(css, /\.windowCloseButton:hover\s*\{[^}]*#c42b1c;/s);

const sidebarStateSource = await readFile("src/utils/rightSidebarState.ts", "utf8");
const sidebarStateCode = ts.transpileModule(sidebarStateSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const sidebarState = await import(
  `data:text/javascript;base64,${Buffer.from(sidebarStateCode).toString("base64")}`
);
for (const tab of ["idea", "plot", "proof", "draft"]) {
  assert.equal(sidebarState.normalizeRightSidebarTab(tab), tab);
}
assert.equal(sidebarState.normalizeRightSidebarTab("plugin:missing:view"), "plot");
assert.match(app, /setRightSidebarTabState\(state\.rightSidebarTab\)/);
assert.match(app, /current\.rightSidebarTab === tab/);

const capability = JSON.parse(
  await readFile("src-tauri/capabilities/main-window-controls.json", "utf8"),
);
assert.deepEqual(capability.windows, ["main"]);
for (const permission of [
  "core:window:allow-start-dragging",
  "core:window:allow-minimize",
  "core:window:allow-toggle-maximize",
  "core:window:allow-close",
]) {
  assert.ok(capability.permissions.includes(permission), `${permission} must be scoped to main`);
}

console.log("PASS v0.6.5 native shell: selection policy, frameless titlebar, controls, permissions");
