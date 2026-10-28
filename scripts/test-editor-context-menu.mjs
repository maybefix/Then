// Appからの受け渡しと、実際に描画したツールバー・階層メニューの全操作を検証する。
// 寸法とCSSは test-editor-context-menu-layout.mjs が実際のブラウザで確認する。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<main class="appShell" style="--ui-font-scale:1"><div id="root"></div></main>', { pretendToBeVisual: true, url: "http://localhost" });
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window) };
const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { flushSync } = await import("react-dom");
const names = ["editorContextMenu", "editorContextMenuRef", "pluginSelectionCommands", "pluginRuntimeHostRef",
  "copyEditorSelection", "cutEditorSelection", "pasteIntoEditorSelection", "handTextToAi", "closeEditorContextMenu",
  "openRubyNotationModal", "applyInlineNotation", "clearSelectionNotation", "openDirectionNotationModal", "openManuscriptTidy"];
const app = await readFile("src/App.tsx", "utf8");
const menuCalls = [...app.matchAll(/<EditorContextMenu\b/g)];
assert.equal(menuCalls.length, 1, "App renders one menu");
const start = menuCalls[0].index;
assert.match(app.slice(start - 70, start), /\{editorContextMenu && \(/);
const markup = app.slice(start, app.indexOf("/>", start) + 2);
const bundled = await build({
  stdin: { contents: `import { EditorContextMenu } from "./src/components/editor/EditorContextMenu"; export const renderFromApp = ({ ${names.join(", ")} }) => (${markup});`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" },
  external: ["react", "react-dom", "react/jsx-runtime"], write: false, logLevel: "error",
});
await mkdir(".tmp", { recursive: true });
const compiled = path.resolve(".tmp", `editor-context-menu-${process.pid}.mjs`);
await writeFile(compiled, bundled.outputFiles[0].text);
const { renderFromApp } = await import(pathToFileURL(compiled).href).finally(() => unlink(compiled));
const container = document.getElementById("root");
const root = createRoot(container);
const selection = { from: 2, to: 5, text: "対象語", x: 150, y: 200 };
const commands = [{ pluginId: "qa.first", id: "run", title: "追加項目1" }, { pluginId: "qa.second", id: "run", title: "追加項目2" }];
let calls = [], inlineSucceeds = true, serial = 0;
const spy = name => (...args) => { calls.push([name, ...args]); };
const props = {
  editorContextMenu: selection, editorContextMenuRef: { current: null }, pluginSelectionCommands: [],
  pluginRuntimeHostRef: { current: { executeCommand: spy("executeCommand") } },
  ...Object.fromEntries(names.slice(4).map(name => [name, spy(name)])),
  applyInlineNotation: (...args) => { calls.push(["applyInlineNotation", ...args]); return inlineSucceeds; },
};
const mount = (overrides = {}) => {
  calls = []; inlineSucceeds = true;
  const values = { ...props, ...overrides };
  const element = renderFromApp(values);
  for (const name of names) assert.equal(element.props[name], values[name], `App passes ${name} unchanged`);
  flushSync(() => root.render(React.cloneElement(element, { key: ++serial })));
  assert.equal(values.editorContextMenuRef.current, container.firstElementChild, "all panels use App's ref");
  return values;
};
const toolbar = () => container.querySelector('[role="toolbar"]');
const main = () => container.querySelector('[role="menu"][aria-label="本文メニュー"]');
const byText = (panel, label) => {
  const found = [...panel.querySelectorAll("button")].filter(button => button.textContent.trim() === label);
  assert.equal(found.length, 1, `${label} appears once in this panel`);
  return found[0];
};
const quick = label => toolbar().querySelector(`[aria-label="${label}"]`);
const click = button => { assert.ok(button); assert.equal(button.disabled, false, "target is enabled"); flushSync(() => button.click()); };
const group = label => {
  const trigger = main().querySelector(`[aria-label="${label}"]`);
  const before = calls.length;
  click(trigger);
  assert.equal(calls.length, before, "opening a submenu does not edit text");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const panel = container.querySelector(`[role="menu"][aria-label="${label}"]`);
  assert.ok(props.editorContextMenuRef.current.contains(panel), "submenu remains inside App's dismiss ref");
  return panel;
};
const expectClick = (button, expected, label) => { calls = []; click(button); assert.deepEqual(calls, expected, label); };
const key = (button, value) => flushSync(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));

try {
  mount();
  assert.equal(toolbar().querySelectorAll("button").length, 6);
  assert.deepEqual([...toolbar().querySelectorAll("button")].map(button => button.getAttribute("aria-label")), ["切り取り", "コピー", "貼り付け", "ルビ", "縦中横", "圏点"]);
  assert.deepEqual([...main().querySelectorAll("button")].map(button => button.getAttribute("aria-label") || button.textContent.trim()), ["AIに渡す", "独自記法", "行の操作"]);
  for (const [label, handler] of [["コピー", "copyEditorSelection"], ["切り取り", "cutEditorSelection"], ["貼り付け", "pasteIntoEditorSelection"], ["ルビ", "openRubyNotationModal"]]) {
    expectClick(quick(label), [[handler, selection]], `${label}: exact selection`);
  }
  for (const [label, kind] of [["縦中横", "tcy"], ["圏点", "emphasis"]]) {
    inlineSucceeds = true;
    expectClick(quick(label), [["applyInlineNotation", selection, kind], ["closeEditorContextMenu"]], `${label}: close on success`);
    inlineSucceeds = false;
    expectClick(quick(label), [["applyInlineNotation", selection, kind]], `${label}: remain on failure`);
  }
  inlineSucceeds = true;
  expectClick(byText(main(), "AIに渡す"), [["handTextToAi", selection.text], ["closeEditorContextMenu"]], "AI: hand over then close");
  const notation = group("独自記法");
  click(main().querySelector('[aria-label="独自記法"]'));
  assert.equal(document.activeElement.textContent, "ルビ...", "an already open group can still receive keyboard focus");
  assert.deepEqual([...notation.querySelectorAll("button")].map(button => button.textContent.trim()), ["ルビ...", "縦中横", "圏点", "記法をクリア"]);
  expectClick(byText(notation, "ルビ..."), [["openRubyNotationModal", selection]], "ruby from submenu");
  expectClick(byText(notation, "記法をクリア"), [["clearSelectionNotation", selection]], "clear notation");
  for (const [label, kind] of [["縦中横", "tcy"], ["圏点", "emphasis"]]) {
    inlineSucceeds = true;
    expectClick(byText(notation, label), [["applyInlineNotation", selection, kind], ["closeEditorContextMenu"]], label + " from submenu");
    inlineSucceeds = false;
    expectClick(byText(notation, label), [["applyInlineNotation", selection, kind]], label + " failed from submenu");
  }
  const lines = group("行の操作");
  expectClick(byText(lines, "文章方向..."), [["openDirectionNotationModal", selection]], "direction");
  expectClick(byText(lines, "原稿を整える..."), [["openManuscriptTidy", selection]], "tidy");
  assert.equal(container.querySelector('[role="menu"][aria-label="独自記法"]'), null, "one child menu at a time");

  mount({ pluginSelectionCommands: commands });
  const plugin = group("プラグイン");
  for (const command of commands) expectClick(byText(plugin, command.title), [["executeCommand", command.pluginId, command.id], ["closeEditorContextMenu"]], "plugin identifiers and order");
  mount({ pluginSelectionCommands: commands, pluginRuntimeHostRef: { current: null } });
  expectClick(byText(group("プラグイン"), commands[0].title), [["closeEditorContextMenu"]], "missing host is safe");

  for (const snapshot of [{ ...selection, from: 3, to: 3, text: "" }, { ...selection, text: "一行\n二行", to: 7 }]) {
    mount({ editorContextMenu: snapshot, pluginSelectionCommands: commands });
    const empty = snapshot.from === snapshot.to;
    for (const label of ["ルビ", "縦中横", "圏点"]) assert.equal(quick(label).disabled, true);
    for (const label of ["コピー", "切り取り"]) assert.equal(quick(label).disabled, empty);
    assert.equal(quick("貼り付け").disabled, false);
    assert.equal(byText(main(), "AIに渡す").disabled, empty);
    assert.equal(!!main().querySelector('[aria-label="プラグイン"]'), !empty);
    const panel = group("独自記法");
    for (const label of ["ルビ...", "縦中横", "圏点"]) assert.equal(byText(panel, label).disabled, true);
    expectClick(byText(panel, "記法をクリア"), [["clearSelectionNotation", snapshot]], "clear is available without inline selection");
    expectClick(quick("貼り付け"), [["pasteIntoEditorSelection", snapshot]], "paste keeps snapshot");
    const linePanel = group("行の操作");
    expectClick(byText(linePanel, "文章方向..."), [["openDirectionNotationModal", snapshot]], "multi-line/caret direction");
    expectClick(byText(linePanel, "原稿を整える..."), [["openManuscriptTidy", snapshot]], "multi-line/caret tidy");
  }

  mount();
  assert.equal(document.activeElement.textContent, "AIに渡す");
  key(document.activeElement, "ArrowDown");
  assert.equal(document.activeElement.getAttribute("aria-label"), "独自記法");
  key(document.activeElement, "ArrowRight");
  assert.equal(document.activeElement.textContent, "ルビ...");
  key(document.activeElement, "ArrowDown");
  assert.equal(document.activeElement.textContent, "縦中横");
  key(document.activeElement, "ArrowLeft");
  assert.equal(document.activeElement.getAttribute("aria-label"), "独自記法");
  key(document.activeElement, "ArrowRight");
  calls = [];
  key(document.activeElement, "Escape");
  assert.equal(container.querySelector('[role="menu"][aria-label="独自記法"]'), null);
  assert.deepEqual(calls, [], "Escape from child returns to parent");
  key(document.activeElement, "Escape");
  assert.deepEqual(calls, [["closeEditorContextMenu"]], "Escape at parent closes whole popup");
  mount({ editorContextMenu: { ...selection, from: 2, to: 2, text: "" } });
  key(document.activeElement, "ArrowRight");
  assert.equal(document.activeElement.textContent, "記法をクリア", "keyboard skips disabled child items");
  console.log("editor context menu: unchanged App contract, six quick actions, all ten actions, submenus, guards, refs and keyboard passed");
} finally {
  flushSync(() => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
