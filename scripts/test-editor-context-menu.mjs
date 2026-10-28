// 右クリックメニューの実物を読み、表示条件と、全項目の呼び先・引数・順序を確かめる。
// Appの呼び出し部分も評価して、propsの渡し忘れや取り違えを検出する。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const names = [
  "editorContextMenu", "editorContextMenuRef", "pluginSelectionCommands", "pluginRuntimeHostRef",
  "copyEditorSelection", "cutEditorSelection", "pasteIntoEditorSelection", "handTextToAi",
  "closeEditorContextMenu", "openRubyNotationModal", "applyInlineNotation", "clearSelectionNotation",
  "openDirectionNotationModal", "openManuscriptTidy",
];
const app = await readFile("src/App.tsx", "utf8");
const menuCalls = [...app.matchAll(/<EditorContextMenu\b/g)];
const start = menuCalls[0]?.index ?? -1;
assert.ok(start >= 0, "App must render the extracted menu");
assert.equal(menuCalls.length, 1, "App must render one menu");
assert.match(app.slice(start - 70, start), /\{editorContextMenu && \(/, "App must keep the open condition");
const markup = app.slice(start, app.indexOf("/>", start) + 2);
const bundled = await build({
  stdin: {
    contents: [
      'import { EditorContextMenu } from "./src/components/editor/EditorContextMenu";',
      'export { EditorContextMenu };',
      `export const renderFromApp = ({ ${names.join(", ")} }) => (${markup});`,
    ].join("\n"),
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, platform: "node", format: "esm", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"], write: false, logLevel: "error",
});
await mkdir(".tmp", { recursive: true });
const compiled = path.resolve(".tmp", `editor-context-menu-${process.pid}.mjs`);
await writeFile(compiled, bundled.outputFiles[0].text);
const { EditorContextMenu, renderFromApp } = await import(pathToFileURL(compiled).href)
  .finally(() => unlink(compiled));

const originalGlobals = Object.fromEntries(["window", "document"].map((key) => [
  key, Object.getOwnPropertyDescriptor(globalThis, key),
]));
let scale = 1;
const shell = {};
globalThis.window = { innerWidth: 1200, innerHeight: 800, getComputedStyle: (element) => {
  assert.equal(element, shell);
  return { getPropertyValue: (name) => { assert.equal(name, "--ui-font-scale"); return String(scale); } };
} };
globalThis.document = { querySelector: (selector) => { assert.equal(selector, ".appShell"); return shell; } };

const elements = (node) => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...elements(node.props.children)];
};
const text = (node) => {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
};
const buttons = (tree) => elements(tree).filter((node) => node.type === "button");
const button = (tree, label) => {
  const found = buttons(tree).filter((node) => text(node) === label);
  assert.equal(found.length, 1, `${label} appears exactly once`);
  return found[0];
};
const selection = { from: 2, to: 5, text: "対象語", x: 150, y: 200 };
const commands = [
  { pluginId: "qa.first", id: "run", title: "追加項目1" },
  { pluginId: "qa.second", id: "run", title: "追加項目2" },
];
let calls = [];
let inlineSucceeds = true;
const spy = (name) => (...args) => { calls.push([name, ...args]); };
const props = {
  editorContextMenu: selection,
  editorContextMenuRef: { current: null }, pluginSelectionCommands: [],
  pluginRuntimeHostRef: { current: { executeCommand: spy("executeCommand") } },
  ...Object.fromEntries(names.slice(4).map((name) => [name, spy(name)])),
  applyInlineNotation: (...args) => { calls.push(["applyInlineNotation", ...args]); return inlineSucceeds; },
};
const render = (overrides = {}) => {
  const values = { ...props, ...overrides };
  const element = renderFromApp(values);
  assert.equal(element.type, EditorContextMenu);
  for (const name of names) assert.equal(element.props[name], values[name], `App passes ${name} unchanged`);
  return EditorContextMenu(element.props);
};
const expectClick = (tree, label, expected) => {
  calls = [];
  const item = button(tree, label);
  assert.notEqual(item.props.disabled, true, `${label} is enabled`);
  item.props.onClick();
  assert.deepEqual(calls, expected, `${label}: exact handler, arguments and order`);
};

try {
  const menu = render();
  assert.equal(menu.type, "div", "extraction adds no wrapper DOM");
  assert.equal(menu.props.className, "editorContextMenu");
  assert.equal(menu.props.role, "menu");
  assert.equal(menu.ref, props.editorContextMenuRef, "outside-click dismissal keeps the same ref");
  assert.deepEqual(menu.props.style, { left: 150, top: 200 });
  assert.deepEqual(buttons(menu).map(text), [
    "コピー", "切り取り", "貼り付け", "AIに渡す", "ルビ...", "縦中横", "圏点",
    "記法をクリア", "文章方向...", "原稿を整える...",
  ]);
  assert.ok(buttons(menu).every((node) => node.props.role === "menuitem"));
  for (const [label, handler] of [
    ["コピー", "copyEditorSelection"], ["切り取り", "cutEditorSelection"],
    ["貼り付け", "pasteIntoEditorSelection"], ["ルビ...", "openRubyNotationModal"],
    ["記法をクリア", "clearSelectionNotation"], ["文章方向...", "openDirectionNotationModal"],
    ["原稿を整える...", "openManuscriptTidy"],
  ]) expectClick(menu, label, [[handler, selection]]);
  expectClick(menu, "AIに渡す", [["handTextToAi", selection.text], ["closeEditorContextMenu"]]);
  for (const [label, kind] of [["縦中横", "tcy"], ["圏点", "emphasis"]]) {
    inlineSucceeds = true;
    expectClick(menu, label, [["applyInlineNotation", selection, kind], ["closeEditorContextMenu"]]);
    inlineSucceeds = false;
    expectClick(menu, label, [["applyInlineNotation", selection, kind]]);
  }
  inlineSucceeds = true;
  const withPlugins = render({ pluginSelectionCommands: commands });
  assert.deepEqual(buttons(withPlugins).map(text).slice(0, 7), [
    "コピー", "切り取り", "貼り付け", "AIに渡す", "追加項目1", "追加項目2", "ルビ...",
  ]);
  commands.forEach((command) => {
    expectClick(withPlugins, command.title, [["executeCommand", command.pluginId, command.id], ["closeEditorContextMenu"]]);
    assert.equal(button(withPlugins, command.title).key, `${command.pluginId}:${command.id}`);
  });
  const noRuntime = render({ pluginSelectionCommands: commands, pluginRuntimeHostRef: { current: null } });
  expectClick(noRuntime, commands[0].title, [["closeEditorContextMenu"]]);

  for (const [snapshot, disabledLabels] of [
    [{ ...selection, from: 3, to: 3, text: "" }, ["コピー", "切り取り", "AIに渡す", "ルビ...", "縦中横", "圏点"]],
    [{ ...selection, text: "一行\n二行", to: 7 }, ["ルビ...", "縦中横", "圏点"]],
  ]) {
    const tree = render({ editorContextMenu: snapshot, pluginSelectionCommands: commands });
    assert.deepEqual(buttons(tree).filter((item) => item.props.disabled).map(text), disabledLabels);
    const pluginLabels = buttons(tree).map(text).filter((label) => label.startsWith("追加項目"));
    assert.equal(pluginLabels.length, snapshot.from === snapshot.to ? 0 : commands.length);
    expectClick(tree, "貼り付け", [["pasteIntoEditorSelection", snapshot]]);
    expectClick(tree, "文章方向...", [["openDirectionNotationModal", snapshot]]);
    expectClick(tree, "原稿を整える...", [["openManuscriptTidy", snapshot]]);
  }
  for (const nextScale of [1, 1.25, 2]) {
    scale = nextScale;
    for (const snapshot of [selection, { ...selection, x: -100, y: -100 }, { ...selection, x: 1199, y: 799 },
      { ...selection, from: 3, to: 3, text: "", x: 1199, y: 799 }]) {
      for (const pluginSelectionCommands of [[], commands]) {
        const tree = render({ editorContextMenu: snapshot, pluginSelectionCommands });
        const height = 322 + (pluginSelectionCommands.length ? 31 + pluginSelectionCommands.length * 30 : 0);
        assert.deepEqual(tree.props.style, {
          left: Math.min(Math.max(8, snapshot.x / scale), Math.max(8, 1200 / scale - 236 - 8)),
          top: Math.min(Math.max(8, snapshot.y / scale), Math.max(8, 800 / scale - height - 8)),
        }, `menu position at scale ${scale}, ${pluginSelectionCommands.length} plugins`);
      }
    }
  }
  console.log("editor context menu: App props, all 10 items, plugin commands, selection guards, dismissal order, ref and scaled position passed");
} finally {
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
