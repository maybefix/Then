// A DOM/PM integration test with a fake native transport; never uses OS input or clipboard.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

const dom = new JSDOM('<div id="shell"><div class="verticalTypewriterScroller"><div id="editor" contenteditable="true" tabindex="0"><p>あいう</p></div></div></div>', { url: "http://localhost/?native-ime=1" });
const w = dom.window;
for (const name of ["window","document","location","HTMLElement","Element","Node","Text","DOMRect","KeyboardEvent","MutationObserver","localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? w : w[name] });
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: w.navigator });
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID } });
globalThis.devicePixelRatio = 1.25;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const frames = new Map(); let nextFrame = 0;
globalThis.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
w.Range.prototype.getBoundingClientRect = function () { return new w.DOMRect(100, 200 + this.startOffset * 24, 24, this.collapsed ? 0 : 24); };
let webClipboardCalls = 0;
Object.defineProperty(w.navigator, "clipboard", { value: {
  writeText: async () => { webClipboardCalls++; throw new DOMException("Document is not focused", "NotAllowedError"); },
  readText: async () => { webClipboardCalls++; throw new DOMException("Document is not focused", "NotAllowedError"); },
} });
let listener, snapshot; const copies = [], releases = [];
const invoke = async (name, args) => {
  if (name === "native_ime_sync") { snapshot = args.snapshot; return { focused: true, keysSeen: 1, keysConsumed: 0, geometryQueries: 1, attributeQueries: 1, edits: 1 }; }
  if (name === "native_ime_release") { releases.push(args.session); return; }
  if (name === "native_clipboard_write") { copies.push(args.text); return; }
  if (name === "native_clipboard_read") return "日本語";
  throw new Error(`Unexpected command: ${name}`);
};
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: ["src/editor/nativeIme.ts"], bundle: true, platform: "node", format: "cjs", write: false,
  external: ["@tiptap/*", "@tauri-apps/*"], define: { "import.meta.env.VITE_NATIVE_TSF_LIMITED": '"0"' } });
const loaded = { exports: {} };
new Function("module","exports","require",bundle.outputFiles[0].text)(loaded,loaded.exports,name =>
  name === "@tauri-apps/api/core" ? { invoke, isTauri: () => true } :
  name === "@tauri-apps/api/event" ? { listen: async (_, fn) => { listener = fn; return () => {}; } } : require(name));

const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
let state = EditorState.create({ schema, doc: schema.node("doc", null, [schema.node("paragraph", null, schema.text("あいう"))]) });
state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 4)));
const root = document.getElementById("editor"); root.style.writingMode = "vertical-rl";
const shell = document.getElementById("shell"); const handlers = new Set();
const editor = {
  get state() { return state; },
  view: {
    dom: root, focus: () => root.focus(),
    coordsAtPos: () => ({ left: 100, top: 200, right: 124, bottom: 200 }),
    domAtPos: pos => ({ node: root.firstChild.firstChild, offset: Math.min(state.doc.child(0).textContent.length, pos - 1) }),
    dispatch: tr => {
      state = state.apply(tr); root.firstChild.textContent = state.doc.child(0).textContent;
      if (!root.firstChild.firstChild) root.firstChild.append(document.createTextNode(""));
      for (const handler of handlers) handler({ transaction: tr });
    },
  },
  registerPlugin: plugin => { state = state.reconfigure({ plugins: [...state.plugins, plugin] }); },
  unregisterPlugin: () => { state = state.reconfigure({ plugins: [] }); },
  on: (_, fn) => handlers.add(fn), off: (_, fn) => handlers.delete(fn),
};
async function flush() {
  for (let i = 0; i < 12; i++) {
    await new Promise(setImmediate);
    const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn();
  }
}
const dispose = loaded.exports.installNativeImeExperiment(editor, shell, { start() {}, update() {}, end() {} });
await flush();
const toggle = shell.querySelector("button"); toggle.click(); await flush();
assert.ok(snapshot); const firstSession = snapshot.session;
assert.ok(root.classList.contains("nativeImeActive"));
const sendKey = async vk => {
  listener({ payload: { session: snapshot.session, epoch: snapshot.epoch, serial: 0, kind: "key",
    value: { down: true, vk, ctrl: true, shift: false, alt: false, repeat: false } } });
  await flush();
};
// Deliberately remove browser focus, the condition that caused NotAllowedError.
root.blur(); assert.notEqual(document.activeElement, root);
await sendKey(67); assert.deepEqual(copies, ["あいう"]); assert.equal(state.doc.textContent, "あいう");
await sendKey(88); assert.deepEqual(copies, ["あいう", "あいう"]); assert.equal(state.doc.textContent, "");
await sendKey(86); assert.equal(state.doc.textContent, "日本語");
assert.equal(webClipboardCalls, 0, "native input must not use the browser Clipboard API");
assert.equal(document.querySelector(".nativeImeCaret").hidden, false);
assert.ok(parseFloat(document.querySelector(".nativeImeCaret").style.width) > 0);
assert.ok(parseFloat(document.querySelector(".nativeImeCaret").style.height) > 0);
toggle.click(); await flush(); assert.equal(document.querySelector(".nativeImeCaret").hidden, true);
toggle.click(); await flush(); assert.notEqual(snapshot.session, firstSession);
assert.ok(releases.includes(firstSession)); assert.ok(root.classList.contains("nativeImeActive"));
dispose(); await flush(); assert.equal(document.querySelector(".nativeImeCaret"), null);
assert.equal(shell.querySelector(".nativeImeExperiment"), null);
console.log(JSON.stringify({ unfocusedCopyCutPaste: true, browserClipboardCalls: webClipboardCalls, caretVisible: true, reconnectAndDispose: true }));
dom.window.close();
