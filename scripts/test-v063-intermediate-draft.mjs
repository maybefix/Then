import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  IS_REACT_ACT_ENVIRONMENT: true });
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const toUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compile(path, replacements = {}) {
  let source = ts.transpileModule(await readFile(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  source = source.replace(/import "[^\"]+\.css";/g, "");
  for (const [key, value] of Object.entries(replacements)) source = source.replaceAll(`"${key}"`, `"${value}"`);
  return toUrl(source);
}
const canvasUrl = await compile("src/canvasTypes.ts");
const draftUrl = await compile("src/intermediateDraft.ts");
const { captureDraft, generateDraft, moveDraftCard, toggleDraftCard, draftBoardKey } = await import(draftUrl);
const invokeUrl = toUrl("export const invoke = (...args) => globalThis.draftTestInvoke(...args);");
const storeUrl = await compile("src/intermediateDraftStore.ts", {
  "@tauri-apps/api/window": toUrl('export const getCurrentWindow = () => ({ label: "test" });'),
  "@tauri-apps/api/core": invokeUrl, "./canvasTypes": canvasUrl, "./intermediateDraft": draftUrl,
});
const store = await import(storeUrl);
const paneUrl = await compile("src/components/canvas/IntermediateDraftPane.tsx", {
  react: pathToFileURL(require.resolve("react")).href,
  "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
  "@tauri-apps/api/core": invokeUrl,
  "../../intermediateDraft": draftUrl, "../../intermediateDraftStore": storeUrl,
});
const { default: Pane } = await import(paneUrl);
const node = (id, text, y) => ({ id, text, y, x: 0, type: "text", width: 100, height: 100 });
const board = { nodes: [node("b", "二番目\n段落", 0), node("a", "最初", 100), node("empty", "  ", 200),
  { id: "group", type: "group", label: "これは本文ではない", x: 0, y: 0 }],
  edges: [{ id: "edge", fromNode: "a", toNode: "b", connector: "arrow" }], then: { updatedAt: 10, name: "試験ボード" } };
const original = JSON.stringify(board);
const capture = captureDraft(board, 100);
assert.deepEqual(capture.order, ["a", "b", "empty"]);
assert.equal(generateDraft(capture, 1, 200).text, "最初\n\n二番目\n段落");
assert.equal(JSON.stringify(board), original, "capture must not modify Canvas");
const reordered = moveDraftCard(capture, "a", "b");
assert.deepEqual(reordered.order, ["b", "a", "empty"]);
assert.deepEqual(capture.order, ["a", "b", "empty"]);
const excluded = toggleDraftCard(capture, "b");
assert.deepEqual(excluded.excluded, ["b"]);
assert.equal(generateDraft(excluded, 1).text, "最初");
assert.deepEqual(toggleDraftCard(excluded, "b").excluded, []);
assert.throws(() => generateDraft({ ...capture, order: ["a", "a", "b"] }, 1));
assert.throws(() => generateDraft({ ...capture, excluded: ["missing"] }, 1));
for (const connector of ["line", "dashed", "bidirectional"]) {
  assert.deepEqual(captureDraft({ ...board, edges: [{ ...board.edges[0], connector }] }).order, ["b", "a", "empty"]);
}
const graph = { ...board, nodes: [node("c", "C", 0), node("b", "B", 1), node("a", "A", 2), node("d", "D", 3)],
  edges: [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["a", "b"]].map(([fromNode, toNode]) => ({ fromNode, toNode })) };
const order = captureDraft(graph).order;
assert.equal(order[0], "a"); assert.equal(order.at(-1), "d");
const cyclic = captureDraft({ ...graph, edges: [...graph.edges, { fromNode: "d", toNode: "a" }] });
assert.equal(new Set(cyclic.order).size, 4, "cycles retain every card exactly once");
assert.equal(captureDraft({ nodes: [], edges: [] }).order.length, 0);
console.log("PASS ordering: arrows, ties, branches, merges, duplicate edges, cycles, empty cards, snapshot isolation");

localStorage.setItem("then.canvas-board.global.global", JSON.stringify({ board }));
const target = { boardId: "board", scope: "global", rootPath: null };
const session = store.getDraftSession(target);
let root = createRoot(document.getElementById("root"));
let live = { ...target, board, selectedIds: ["a"] };
let selected;
const render = () => root.render(React.createElement(Pane, { rootPath: null, liveCanvas: live,
  onOpenCanvas: () => {}, onSelectNode: (id) => { selected = id; } }));
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 5)); };
await act(async () => { render(); await settle(); });
await act(settle);
const button = (text) => [...document.querySelectorAll("button")].find((element) => element.textContent.includes(text));
const click = async (element) => { assert.ok(element); await act(async () => { element.click(); await settle(); }); };
assert.equal(document.querySelectorAll(".draftOrderList li").length, 3);
assert.equal(document.body.textContent.includes("矢印から初期順序"), false);
assert.equal(document.body.textContent.includes("Canvas取得:"), false);
assert.equal(document.body.textContent.includes("保存済み"), false);
assert.equal(document.body.textContent.includes("Canvasを開く"), false);
assert.match(document.querySelector(".draftOrderList li.isSelected").textContent, /最初/);
await click(document.querySelector('[aria-label="カード2を中間稿から除外"]'));
assert.equal(document.querySelectorAll(".draftOrderList li.isExcluded").length, 1);
await click(document.querySelector('[aria-label="カード2を中間稿に戻す"]'));
assert.equal(document.querySelectorAll(".draftOrderList li.isExcluded").length, 0);
await act(async () => {
  const dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
  for (const [element, name] of [[document.querySelector(".draftDragHandle"), "dragstart"],
    [document.querySelectorAll(".draftOrderList li")[1], "drop"]]) {
    const event = new dom.window.Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    element.dispatchEvent(event);
    await settle();
  }
});
assert.match(document.querySelector(".draftExcerpt").textContent, /二番目/);
await click(document.querySelector('[aria-label="カード2を上へ"]'));
await click(document.querySelectorAll(".draftExcerpt")[1]); assert.equal(selected, "b");
await click(document.querySelector('[aria-label="カード1を下へ"]'));
await click(button("テキストを生成"));
assert.equal(document.querySelector("textarea").value, "二番目\n段落\n\n最初");
await click(button("並べ替え"));
assert.ok(document.querySelector('[aria-label="カード1を中間稿から除外"]'), "saved versions expose exclusion controls");
await click(button("テキスト"));
const edited = "編集済みの文章\n\n旧版に残す文章。";
await act(async () => {
  const textarea = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(textarea, edited);
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
});
assert.equal(session.snapshot.history.versions[0].text, edited);
await act(async () => { await session.flush(); });
live = { ...live, board: { ...board, nodes: [node("a", "Canvasの新しい本文", 0)] } };
await act(async () => { render(); await settle(); });
assert.equal(document.querySelector("textarea").value, edited, "Canvas changes do not overwrite draft edits");
await click(button("再取得"));
assert.equal(document.querySelectorAll(".draftOrderList li").length, 1);
await click(button("テキストを生成"));
assert.equal(document.querySelector("textarea").value, "Canvasの新しい本文");
await act(async () => { await session.flush(); });
assert.equal(session.snapshot.history.versions[0].text, edited);
await act(async () => {
  const select = document.querySelector('[aria-label="中間稿のバージョン"]');
  select.value = "1"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
assert.equal(document.querySelector("textarea").value, edited);
assert.equal(document.querySelector("textarea").readOnly, true);
let exported;
globalThis.draftTestInvoke = async (command, args) => {
  assert.equal(command, "save_submission_text_dialog");
  exported = args;
  return { name: args.fileName, path: `C:/tmp/${args.fileName}` };
};
await click(button("書き出し"));
assert.equal(exported.content, edited);
assert.equal(exported.fileName, "中間稿-v1.txt");
assert.match(document.body.textContent, /中間稿-v1\.txtを保存しました/);
await act(async () => { root.unmount(); });
root = createRoot(document.getElementById("root")); live = null;
await act(async () => { render(); await settle(); }); await act(settle);
assert.equal(document.querySelector("textarea").value, "Canvasの新しい本文", "write mode can read the saved draft");
await act(async () => { root.unmount(); });
const stored = JSON.parse(localStorage.getItem(`then.draft.${draftBoardKey(target)}`));
assert.equal(stored.versions.length, 2); assert.equal(stored.versions[0].text, edited);
console.log("PASS sidebar: reorder, card selection, generation, editing, regeneration, old versions, mode remount, persistence");

// Exercise serialized native saves with edits arriving while a write is pending.
window.__TAURI_INTERNALS__ = {};
const delayed = store.getDraftSession({ ...target, boardId: "delayed" });
let writes = [], complete;
globalThis.draftTestInvoke = async (command, args) => {
  if (command === "load_intermediate_draft") return { schemaVersion: 1, boardId: "delayed", revision: 0, versions: [] };
  writes.push(args);
  if (writes.length === 1) await new Promise((resolve) => { complete = resolve; });
  return writes.length;
};
await delayed.load();
delayed.change({ ...delayed.snapshot.history, versions: [generateDraft(capture, 1)] });
const saving = delayed.flush();
delayed.change({ ...delayed.snapshot.history, versions: [{ ...delayed.snapshot.history.versions[0], text: "保存中の追加編集" }] });
complete(); await saving;
assert.equal(writes.length, 2); assert.equal(writes[1].expectedRevision, 1);
assert.equal(writes[1].history.versions[0].text, "保存中の追加編集");
globalThis.draftTestInvoke = async () => { throw new Error("disk full"); };
delayed.change({ ...delayed.snapshot.history, versions: [{ ...delayed.snapshot.history.versions[0], text: "失敗時も保持" }] });
await delayed.flush();
assert.equal(delayed.dirty, true); assert.match(delayed.snapshot.error, /disk full/);
assert.equal(delayed.snapshot.history.versions[0].text, "失敗時も保持");
globalThis.draftTestInvoke = async () => 3;
await delayed.flush(); assert.equal(delayed.dirty, false);
assert.equal(localStorage.getItem(delayed.recoveryKey()), null, "successful saves clear the recovery journal");
const recoveryTarget = { ...target, boardId: "recovery" };
const recovering = store.getDraftSession(recoveryTarget);
const recoveredHistory = { schemaVersion: 1, boardId: "recovery", revision: 0, versions: [generateDraft(capture, 1)] };
localStorage.setItem(recovering.recoveryKey(), JSON.stringify({ history: recoveredHistory, expectedRevision: 0 }));
globalThis.draftTestInvoke = async (command) => command === "load_intermediate_draft"
  ? { ...recoveredHistory, versions: [] } : 1;
await recovering.load();
assert.equal(recovering.snapshot.history.versions[0].text, generateDraft(capture, 1).text);
assert.equal(recovering.dirty, true);
await recovering.flush();
assert.equal(localStorage.getItem(recovering.recoveryKey()), null);
delete window.__TAURI_INTERNALS__;
const other = { ...stored, revision: stored.revision + 10 };
localStorage.setItem(`then.draft.${draftBoardKey(target)}`, JSON.stringify(other));
session.change({ ...session.snapshot.history, versions: [...session.snapshot.history.versions] });
await session.flush();
assert.match(session.snapshot.error, /別の画面/); assert.equal(session.dirty, true);
assert.equal(JSON.parse(localStorage.getItem(`then.draft.${draftBoardKey(target)}`)).revision, other.revision);
session.dirty = false;
console.log("PASS persistence: in-flight edits, serial revisions, save failure/retry, close recovery, conflict protection");
dom.window.close();
