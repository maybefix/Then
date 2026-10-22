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
let failRelease = false;
let listener, snapshot; const copies = [], releases = [];
const invoke = async (name, args) => {
  if (name === "native_ime_sync") { snapshot = args.snapshot; return { focused: true, keysSeen: 1, keysConsumed: 0, geometryQueries: 1, attributeQueries: 1, edits: 1 }; }
  if (name === "native_ime_release") { releases.push(args.session); if (failRelease) throw new Error("release failed"); return; }
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
    posAtDOM: (node, offset) => node === root.firstChild.firstChild ? offset + 1 : 1,
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
// TSFの状態とDOMフォーカスの対応を、どの操作の後でも崩さない。
// active（ドラッグ中を除く）なら本文にフォーカスがない、active でなければ受け皿にない。
let invariantChecks = 0;
function assertFocusInvariant() {
  const focus = root.nativeImeFocusState?.();
  if (!focus?.enabled) return;
  invariantChecks++;
  if (focus.active && !focus.pointerSelecting) assert.notEqual(focus.focus, "editor", "TSF is active but the editor holds DOM focus (full-text scan)");
  if (!focus.active) assert.notEqual(focus.focus, "sink", "TSF is not active but the sink holds DOM focus (keys are swallowed)");
}
async function flush() {
  for (let i = 0; i < 12; i++) {
    await new Promise(setImmediate);
    const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn();
  }
  assertFocusInvariant();
}
const dispose = loaded.exports.installNativeImeExperiment(editor, shell, { start() {}, update() {}, end() {} });
await flush();
const toggle = shell.querySelector("button"); toggle.click(); await flush();
assert.ok(snapshot); const firstSession = snapshot.session;
assert.ok(root.classList.contains("nativeImeActive"));
// TSFが入力を受けている間、本文はDOMフォーカスを持たない（Chromiumの全文走査を避ける）。
// PMが書かなくなる範囲選択は、本文へ書き写されている。
assert.equal(document.activeElement?.className, "nativeImeFocusSink");
assert.equal(document.getSelection().toString(), "あいう");
root.focus(); await flush();
assert.equal(document.activeElement?.className, "nativeImeFocusSink", "refocusing the editor must hand DOM focus back to the sink");
// クリック・ドラッグで作った選択は、フォーカスを外す前にPMへ取り込む。
root.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
root.focus(); document.getSelection().setBaseAndExtent(root.firstChild.firstChild, 1, root.firstChild.firstChild, 2);
await flush(); assert.equal(document.activeElement, root, "keep focus until the pointer selection is finished");
w.dispatchEvent(new w.MouseEvent("mouseup")); await flush();
assert.deepEqual([state.selection.from, state.selection.to], [2, 3]);
assert.equal(document.activeElement?.className, "nativeImeFocusSink");
assert.equal(document.getSelection().toString(), "い");
editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 4))); await flush();
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
// 段落をまたぐ選択では標準入力へ戻す。受け皿のDOMフォーカスを本文へ返さないと、
// 続くキー（Shift+矢印で次の段落へ伸ばす）が受け皿に吸われて何も起きない。
root.focus(); await flush(); assert.equal(document.activeElement?.className, "nativeImeFocusSink");
const sessionBeforeSpan = snapshot.session;
editor.view.dispatch(state.tr.insert(state.doc.content.size, schema.node("paragraph", null, schema.text("えお")))); await flush();
editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, state.doc.content.size - 1))); await flush();
assert.ok(releases.includes(sessionBeforeSpan), "a selection spanning paragraphs must release TSF");
assert.equal(document.activeElement, root, "standard input needs the editor focused again");
editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2))); await flush();
assert.ok(root.classList.contains("nativeImeActive"), "TSF reconnects once the selection is inside one paragraph");
assert.equal(document.activeElement?.className, "nativeImeFocusSink");
editor.view.dispatch(state.tr.delete(state.doc.child(0).nodeSize, state.doc.content.size)); await flush();
// 解除の要求が失敗しても、受け皿にフォーカスを残さない（解除の前に本文へ返している）。
root.focus(); await flush(); assert.equal(document.activeElement?.className, "nativeImeFocusSink");
failRelease = true;
editor.view.dispatch(state.tr.insert(state.doc.content.size, schema.node("paragraph", null, schema.text("か")))); await flush();
editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, state.doc.content.size - 1))); await flush();
assert.equal(document.activeElement, root, "a failed release must still leave the editor focused");
failRelease = false;
editor.view.dispatch(state.tr.delete(state.doc.child(0).nodeSize, state.doc.content.size)); await flush();
if (toggle.getAttribute("aria-pressed") !== "true") { toggle.click(); await flush(); }
toggle.click(); await flush(); assert.equal(document.querySelector(".nativeImeCaret").hidden, true);
toggle.click(); await flush(); assert.notEqual(snapshot.session, firstSession);
assert.ok(releases.includes(firstSession)); assert.ok(root.classList.contains("nativeImeActive"));
dispose(); await flush(); assert.equal(document.querySelector(".nativeImeCaret"), null);
assert.equal(shell.querySelector(".nativeImeExperiment"), null);
assert.equal(document.querySelector(".nativeImeFocusSink"), null);
console.log(JSON.stringify({ unfocusedCopyCutPaste: true, browserClipboardCalls: webClipboardCalls, caretVisible: true, domFocusReleased: true, focusInvariantChecks: invariantChecks, reconnectAndDispose: true }));
dom.window.close();
