import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  CSS: { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&") },
  IS_REACT_ACT_ENVIRONMENT: true });
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compile(path, replacements = {}) {
  let source = ts.transpileModule(await readFile(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [key, value] of Object.entries(replacements)) source = source.replaceAll(`"${key}"`, `"${value}"`);
  return url(source);
}
const queueUrl = await compile("src/canvasBoardSaveQueue.ts");
const { CanvasBoardSaveQueue } = await import(queueUrl);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const board = (name) => ({ nodes: [{ id: name, type: "text", text: name, x: 0, y: 0, width: 300, height: 200 }],
  edges: [], then: { version: 1, name, scope: "project", updatedAt: 1 } });
const target = { scope: "project", rootPath: "one", boardId: "a" };
const gate = deferred(), writes = [];
const queue = new CanvasBoardSaveQueue(async (scope, rootPath, boardId, doc) => {
  writes.push({ scope, rootPath, boardId, name: doc.then.name });
  if (writes.length === 1) await gate.promise;
});
const original = board("first");
queue.enqueue(target, original);
original.then.name = "mutated after enqueue";
const saving = queue.flush();
await Promise.resolve();
queue.enqueue(target, board("latest"));
queue.enqueue({ ...target, rootPath: "two" }, board("other project"));
queue.enqueue({ ...target, scope: "global" }, board("global"));
assert.equal(queue.flush(), saving);
gate.resolve(); await saving;
assert.deepEqual(writes.map(w => w.name), ["first", "latest", "other project", "global"]);
assert.deepEqual(writes.map(w => [w.scope, w.rootPath]), [["project", "one"], ["project", "one"], ["project", "two"], ["global", "one"]]);
let fail = true, recovered;
const retryQueue = new CanvasBoardSaveQueue(async (...args) => { if (fail) throw Error("disk full"); recovered = args; });
retryQueue.enqueue(target, board("unsaved"));
await assert.rejects(retryQueue.flush(), /disk full/);
fail = false; await retryQueue.flush();
assert.equal(recovered[3].then.name, "unsaved");
console.log("PASS queue: immutable destinations and snapshots, serialized edits, separate projects/scopes, retry after failure");

const canvasUrl = await compile("src/CanvasWindowApp.tsx", {
  react: pathToFileURL(require.resolve("react")).href,
  "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
  "@tauri-apps/api/core": url("export const invoke = (...args) => globalThis.canvasTestInvoke(...args);"),
  "@tauri-apps/api/event": url("export const emit = async () => {}; export const emitTo = emit; export const listen = async () => () => {};"),
  "./canvasTypes": await compile("src/canvasTypes.ts"),
  "./canvasThreads": await compile("src/canvasThreads.ts"),
  "./utils/latestFrameScheduler": await compile("src/utils/latestFrameScheduler.ts"),
  "./components/references/ReferenceLayer": url("export const ReferenceReadOnlyPreview = () => null;"),
  "./components/canvas/IntermediateDraftPane": url("export default () => null;"),
  "./intermediateDraft": await compile("src/intermediateDraft.ts"),
  "./intermediateDraftStore": url("export const prepareDraftBoardTrash = async () => {};"),
  "./canvasBoardSaveQueue": queueUrl,
});
const { default: Canvas } = await import(canvasUrl);
window.__TAURI_INTERNALS__ = {};
let docs, calls, loadGate, writeGate, failingWrite;
const key = (scope, rootPath, boardId) => JSON.stringify([scope, scope === "global" ? null : rootPath, boardId]);
globalThis.canvasTestInvoke = async (command, args) => {
  calls.push({ command, ...structuredClone(args) });
  const k = key(args.scope, args.rootPath, args.boardId);
  if (command === "list_canvas_boards") return [...docs].filter(([id]) => {
    const [scope, root] = JSON.parse(id); return scope === args.scope && root === (scope === "global" ? null : args.rootPath);
  }).map(([id, doc]) => ({ id: JSON.parse(id)[2], name: doc.then.name, scope: args.scope, nodeCount: doc.nodes.length, edgeCount: 0 }));
  if (command === "load_canvas_board") {
    if (loadGate?.key === k) await loadGate.promise;
    return structuredClone(docs.get(k));
  }
  if (command === "save_canvas_board") {
    if (failingWrite) throw Error("disk full");
    if (writeGate) await writeGate.promise;
    docs.set(k, structuredClone(args.board)); return;
  }
  if (command === "trash_canvas_board") { docs.delete(k); return; }
  throw Error(`Unexpected command ${command}`);
};
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
let root, payload, strict = false;
async function mount() {
  docs = new Map([[key("project", "one", "a"), board("A")], [key("project", "one", "b"), board("B")],
    [key("project", "one", "c"), board("C")], [key("global", null, "g"), board("G")],
    [key("project", "two", "a"), board("Other")]]);
  calls = []; loadGate = null; writeGate = null; failingWrite = false;
  payload = { requestId: "test", scope: "project", rootPath: "one", boardId: "a", workspaceName: "Test",
    theme: "light", uiFontScale: 1, ideaThreads: [], referenceFiles: [] };
  root = createRoot(document.getElementById("root"));
  await render();
}
async function render() {
  await act(async () => {
    const canvas = React.createElement(Canvas, { embedded: true, embeddedPayload: payload });
    root.render(strict ? React.createElement(React.StrictMode, null, canvas) : canvas);
    await settle();
  });
  await act(settle);
}
async function click(selector) {
  const element = document.querySelector(selector); assert.ok(element, selector);
  await act(async () => { element.click(); await settle(); });
}
async function select(id) { await click('[aria-label="ボードを切り替え"]'); await click(`.canvasBoardSelectButton[title="${id}"]`); }
async function edit(text) {
  if (!document.querySelector('[aria-label="カードの本文"]')) {
    const card = document.querySelector(".canvasTextNode"); assert.ok(card);
    await act(async () => {
      card.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      await settle();
    });
  }
  const area = document.querySelector('[aria-label="カードの本文"]'); assert.ok(area);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(area, text);
    area.dispatchEvent(new dom.window.Event("input", { bubbles: true })); await settle();
  });
  assert.equal(area.value, text);
}
const textAt = (scope, project, id) => docs.get(key(scope, project, id)).nodes[0].text;
const shownText = () => document.querySelector('[aria-label="カードの本文"]')?.value
  ?? document.querySelector(".canvasCardText")?.textContent;
async function unmount() { await act(async () => { root.unmount(); await settle(); }); }

await mount();
await edit("A edited"); await select("B"); await unmount();
assert.equal(textAt("project", "one", "a"), "A edited");
assert.equal(textAt("project", "one", "b"), "B");
console.log("PASS regression: edit A, switch to B within debounce, unmount preserves both boards");

await mount(); await edit("A newest");
writeGate = deferred();
await select("B");
assert.equal(shownText(), "A newest", "switch waits for outgoing save");
await act(async () => { writeGate.resolve(); await settle(); });
assert.equal(shownText(), "B");
await unmount();

await mount(); await edit("Keep A");
failingWrite = true; await select("B");
assert.equal(shownText(), "Keep A");
assert.match(document.body.textContent, /disk full/);
failingWrite = false; await select("B"); await unmount();
assert.equal(textAt("project", "one", "a"), "Keep A");
console.log("PASS switch: waits for saving and retains failed edits for retry");

await mount(); await edit("Project A");
loadGate = { ...deferred(), key: key("global", null, "g") };
await click('[title="すべての作品で使えるボード"]');
await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
assert.equal(docs.has(key("global", null, "a")), false, "scope change must not create a copy in global boards");
await act(async () => { loadGate.resolve(); await settle(); });
assert.equal(shownText(), "G"); await edit("Global edited"); await unmount();
assert.equal(textAt("project", "one", "a"), "Project A");
assert.equal(textAt("global", null, "g"), "Global edited");

await mount(); await edit("First project");
payload = { ...payload, rootPath: "two", requestId: "two" }; await render();
assert.equal(shownText(), "Other"); await unmount();
assert.equal(textAt("project", "one", "a"), "First project");
assert.equal(textAt("project", "two", "a"), "Other");
console.log("PASS scopes and projects: delayed loading never saves an old board to a new destination");

await mount();
loadGate = { ...deferred(), key: key("project", "one", "b") };
await select("B"); await select("C");
assert.equal(shownText(), "C");
await act(async () => { loadGate.resolve(); await settle(); });
assert.equal(shownText(), "C", "late B response cannot replace C"); await unmount();

await mount(); await edit("Last edit"); await unmount();
assert.equal(textAt("project", "one", "a"), "Last edit");
assert.equal(calls.filter(c => c.command === "save_canvas_board").length, 1);
console.log("PASS loading and unmount: stale responses ignored, pending snapshot flushed exactly once");

await mount(); await edit("Saved across remount"); writeGate = deferred(); await unmount();
root = createRoot(document.getElementById("root"));
await render();
assert.equal(shownText(), undefined, "remounted Canvas waits for the previous instance's save");
await act(async () => { writeGate.resolve(); await settle(); });
assert.equal(shownText(), "Saved across remount"); await unmount();
console.log("PASS remount: a new Canvas instance waits for outstanding saves before reading");

await mount(); await edit("Before trash");
await click('[aria-label="ボードを切り替え"]');
await click('[aria-label="「A」をゴミ箱へ移動"]');
await click('.canvasDeleteModal .dangerCanvasButton');
await unmount();
assert.equal(docs.has(key("project", "one", "a")), false);
const trashIndex = calls.findIndex(c => c.command === "trash_canvas_board");
assert.ok(trashIndex > calls.findIndex(c => c.command === "save_canvas_board"));
assert.equal(calls.slice(trashIndex + 1).some(c => c.command === "save_canvas_board" && c.boardId === "a"), false);
console.log("PASS trash: saves pending edits before moving to trash and does not recreate the deleted board");

strict = true; await mount();
assert.equal(shownText(), "A"); await edit("Strict A"); await select("B"); await unmount();
assert.equal(textAt("project", "one", "a"), "Strict A");
assert.equal(textAt("project", "one", "b"), "B");
console.log("PASS StrictMode: effect setup/cleanup replay preserves board contents");
dom.window.close();
