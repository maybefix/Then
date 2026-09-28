import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><button id='opener'>開く</button><div id='root'></div>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
// jsdom has no layout. Supply visible rectangles for the focusable-element check.
dom.window.HTMLElement.prototype.getClientRects = function () {
  return this.isConnected ? [{ width: 1, height: 1 }] : [];
};

const require = createRequire(import.meta.url);
const source = await readFile("src/components/dialogs/PluginManagerModal.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const pluginModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (id) => id === "../plugins/PluginIcon" ? { PluginIcon: () => null } : require(id),
  pluginModule,
  pluginModule.exports,
);

const React = require("react");
const { createRoot } = require("react-dom/client");
const { PluginManagerModal } = pluginModule.exports;
const { act, createElement, useState } = React;
const opener = document.getElementById("opener");
opener.focus();

const plugin = {
  manifest: {
    id: "example.plugin",
    name: "Example",
    version: "1.0.0",
    permissions: [],
  },
};
let resolveReload;
let closeCount = 0;

function Harness() {
  const [open, setOpen] = useState(true);
  const [plugins, setPlugins] = useState([plugin]);
  return open ? createElement(PluginManagerModal, {
    plugins,
    onClose: () => {
      closeCount += 1;
      setOpen(false);
    },
    onInstall: () => {},
    onReload: () => new Promise((resolve) => { resolveReload = resolve; }),
    onUninstall: () => { setPlugins([]); },
  }) : null;
}

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(createElement(Harness)); });
const dialog = document.querySelector(".pluginManagerModal");
const closeButton = dialog.querySelector(".modalClose");
const reloadButton = dialog.querySelector(".pluginManagerToolbar button");
const deleteButton = dialog.querySelector(".pluginManagerDeleteButton");
assert.equal(document.activeElement, closeButton, "opening the modal focuses its close button");
assert.equal(dialog.getAttribute("aria-labelledby"), "plugin-manager-title");

const pressKey = (key, shiftKey = false) =>
  window.dispatchEvent(new window.KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  }));
pressKey("Tab", true);
assert.equal(document.activeElement, deleteButton, "Shift+Tab wraps to the last button");
pressKey("Tab");
assert.equal(document.activeElement, closeButton, "Tab wraps to the first button");
opener.focus();
assert.equal(document.activeElement, closeButton, "focus cannot move behind the modal");

await act(async () => { reloadButton.click(); });
assert.equal(closeButton.disabled, true);
assert.equal(document.activeElement, dialog, "a busy modal retains focus when its buttons are disabled");
pressKey("Escape");
assert.equal(closeCount, 0, "Escape cannot close an in-progress operation");
await act(async () => { resolveReload(); });
assert.equal(document.activeElement, reloadButton, "focus returns to the completed action");

await act(async () => { deleteButton.click(); });
assert.equal(document.activeElement, closeButton, "focus falls back when deletion removes its button");

const topmost = document.createElement("section");
topmost.setAttribute("aria-modal", "true");
document.body.append(topmost);
pressKey("Escape");
assert.equal(closeCount, 0, "the manager ignores Escape while another dialog is on top");
topmost.remove();

await act(async () => { pressKey("Escape"); });
assert.equal(closeCount, 1);
assert.equal(document.activeElement, opener, "closing restores focus to the opener");
await act(async () => { root.unmount(); });
dom.window.close();
console.log("plugin manager modal keyboard tests passed");
