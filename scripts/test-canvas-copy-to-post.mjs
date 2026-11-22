// Canvas の「投稿にする」で、投稿にしたテキストカードを投稿のカードへ置き換える（docs/BINDER_POST_CARD_FOLLOWUPS_PLAN.md）。
// 本物の CanvasWindowApp を jsdom で動かし、メイン画面への頼み（埋め込みは onCopyToPostRequest、別ウィンドウは知らせ）と
// 通知からの「元に戻す」（onRegisterManuscriptRevert）は入れ物で受ける。場面の番号（C1〜）は
// docs/BINDER_POST_CARD_FOLLOWUPS_SCENARIOS.md と同じ。あわせて K1（書けたかを待たずに成功と出す）・K5（対象の決め方）・
// K8（状態の欄の知らせが保存ですぐ上書きされる）を確かめる。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Node: dom.window.Node,
  CustomEvent: dom.window.CustomEvent,
  CSS: { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&") },
  IS_REACT_ACT_ENVIRONMENT: true,
});
const consoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  consoleError(...args);
};
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const stub = (contents) => ({ contents, loader: "js" });
const stubs = {
  "@tauri-apps/api/core": stub("export const invoke = (...args) => globalThis.copyTest.invoke(...args);"),
  "@tauri-apps/api/event": stub(`
    export const listen = async (event, handler) => globalThis.copyTest.listen(event, handler);
    export const emit = async (event, payload) => globalThis.copyTest.emit(event, payload);
    export const emitTo = async (target, event, payload) => globalThis.copyTest.emit(event, payload, target);`),
  "./components/references/ReferenceLayer": stub("export const ReferenceReadOnlyPreview = () => null;"),
};
const external = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];
const bundled = await build({
  stdin: { contents: 'export { default as Canvas } from "./src/CanvasWindowApp.tsx";', resolveDir: process.cwd(), loader: "ts", sourcefile: "copy-to-post-entry.ts" },
  bundle: true, format: "esm", platform: "neutral", write: false, jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{
    name: "copy-to-post-test",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (stubs[args.path]) return { path: args.path, namespace: "stub" };
        if (external.includes(args.path)) return { path: pathToFileURL(require.resolve(args.path)).href, external: true };
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => stubs[args.path]);
    },
  }],
});
const { Canvas } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const ROOT = "/library/作品A";
const listeners = new Map();
let board, saved, requests, revert, emitted, windowPayload, respond;
globalThis.copyTest = {
  invoke: async (command, args = {}) => {
    if (command === "list_canvas_boards") return [{ id: "a", name: board.then.name, scope: "project", nodeCount: 0, edgeCount: 0 }];
    if (command === "load_canvas_board") return structuredClone(saved ?? board);
    if (command === "load_canvas_board_with_hash") return { board: structuredClone(saved ?? board), hash: null };
    if (command === "canvas_board_hash") return null;
    if (command === "save_canvas_board") { saved = structuredClone(args.board); return null; }
    if (command === "read_text_file") throw new Error("not found");
    if (command === "library_transfer_destinations") return [];
    if (command === "get_canvas_window_payload") return structuredClone(windowPayload);
    if (command === "finish_canvas_close_preparation" || command === "focus_main_window") return;
    throw new Error(`Unexpected command ${command}`);
  },
  listen: (event, handler) => {
    const list = listeners.get(event) ?? new Set();
    listeners.set(event, list);
    list.add(handler);
    return () => list.delete(handler);
  },
  emit: (event, payload, target) => {
    emitted.push({ event, target, payload: structuredClone(payload) });
    for (const handler of listeners.get(event) ?? []) handler({ event, payload: structuredClone(payload) });
  },
};
window.__TAURI_INTERNALS__ = {};

const text = (id, x, y, body, extra = {}) => ({ id, type: "text", x, y, width: 200, height: 120, text: body, ...extra });
const startBoard = () => ({
  nodes: [
    text("s1", 40, 20, "潮の匂い", { color: "3" }),
    text("s2", 0, 300, "朝の港。", { title: "港" }),
    text("s3", 400, 0, "子のカード", { threadParentId: "s1", threadOrder: 0 }),
    { id: "g", type: "group", x: 800, y: 0, width: 600, height: 500, label: "まとめ" },
    text("s4", 850, 50, "中の一"),
    text("s5", 850, 250, "中の二"),
    text("s6", 1600, 0, "外の一枚"),
    { id: "f", type: "file", x: 0, y: 700, width: 300, height: 240, file: "素材/汐見.md" },
  ],
  edges: [{ id: "e1", fromNode: "s1", toNode: "s2", connector: "arrow" }],
  then: { version: 1, name: "構想", scope: "project", updatedAt: 1 },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(0);
let root, props;
async function render() {
  await act(async () => { root.render(React.createElement(Canvas, props)); await settle(); });
  await act(async () => { await settle(); await settle(); });
}
let made = 0;
/** メイン画面の答え方の入れ物。カード1枚ずつに新しい投稿の ID を返す。 */
const respondMade = (request) => {
  if (request.kind === "cards") {
    return { kind: "cards", failed: [], made: request.cards.map((item) => ({ id: item.id, post: `p-new-${++made}` })) };
  }
  return { kind: "undo", done: true, deleted: request.conversionId ? 1 : 0, kept: 0 };
};
async function mount(answer = respondMade, { embedded = true } = {}) {
  board = startBoard(); saved = null; requests = []; revert = null; emitted = []; respond = answer;
  listeners.clear();
  const payload = { requestId: `r${Date.now()}`, scope: "project", rootPath: ROOT, boardId: "a", workspaceName: "作品A",
    theme: "light", uiFontScale: 1, referenceFiles: [], projectFiles: [], openTabPaths: [] };
  if (embedded) {
    props = {
      embedded: true, embeddedPayload: payload, liveProjectFiles: [], liveOpenTabPaths: [], liveReferenceFiles: [],
      onWriteFile: async () => ({ status: "unchanged" }),
      onCopyToPostRequest: async (request) => { requests.push(structuredClone(request)); return respond(request); },
      onRegisterManuscriptRevert: (handler) => { revert = handler; },
    };
  } else {
    props = {};
    windowPayload = payload;
    // メイン画面の役: 頼みを受けて、答えの知らせを返す。
    globalThis.copyTest.listen("then-canvas-copy-to-post", ({ payload: event }) => {
      requests.push(structuredClone(event.request));
      Promise.resolve()
        .then(() => respond(event.request))
        .then((result) => globalThis.copyTest.emit("then-canvas-copy-to-post-result", { requestId: event.requestId, result }, "idea-canvas"))
        .catch((error) => globalThis.copyTest.emit("then-canvas-copy-to-post-result", { requestId: event.requestId, error: error.message }, "idea-canvas"));
    });
  }
  root = createRoot(document.getElementById("root"));
  await render();
  await act(async () => { await sleep(20); });
}
async function unmount() { await act(async () => { root.unmount(); await settle(); }); }
const card = (id) => document.querySelector(`[data-node-id="${id}"]`);
const nodeOf = (id) => (saved ?? board).nodes.find((node) => node.id === id);
const plain = (value) => JSON.parse(JSON.stringify(value));
async function select(ids) {
  for (const [index, id] of ids.entries()) {
    await act(async () => {
      card(id).dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ctrlKey: index > 0 }));
      window.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true }));
      await settle();
    });
  }
}
async function click(element) {
  assert.ok(element, "element exists");
  await act(async () => { element.click(); await settle(); await settle(); });
}
async function key(keyName, options = {}) {
  await act(async () => {
    document.body.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...options }));
    await settle(); await settle();
  });
}
const button = (label) => document.querySelector(`[aria-label="${label}"]`);
const waitSave = () => act(async () => { await sleep(650); });
const status = () => document.querySelector(".canvasSaveStatus")?.textContent ?? "";
const postIt = async (ids) => { await select(ids); await click(button("投稿にする")); await act(async () => { await settle(); await settle(); }); };

// ---- 1. C1・C6・K1・K8: 書けたカードを、同じ ID・位置・大きさ・色の投稿のカードに置き換える ----
await mount();
await postIt(["s1"]);
assert.deepEqual(requests[0], {
  kind: "cards", rootPath: ROOT, conversionId: requests[0].conversionId, cards: [{ id: "s1", text: "潮の匂い" }],
}, "メイン画面に、カードの ID と本文を頼む");
assert.match(status(), /1件を投稿にしました/);
await waitSave();
assert.deepEqual(plain(nodeOf("s1")), { id: "s1", type: "post", x: 40, y: 20, width: 200, height: 120, post: "p-new-1", color: "3" },
  "C1: 投稿のカードに置き換わる（ID・位置・大きさ・色）");
assert.equal(nodeOf("s3").threadParentId, undefined, "C6: 置き換えたカードの子は、その場に残ってスレッドから外れる");
assert.deepEqual(plain(saved.edges), board.edges, "線は残る");
assert.match(status(), /1件を投稿にしました/, "K8: 置き換えの保存のあとも、知らせは「保存済み」で上書きされない");
console.log("PASS replace: the posted card becomes a post card in place, its thread child is detached, the notice survives the save");

// ---- 2. C2: Ctrl+Z で戻すと、テキストに戻り、メイン画面に消すのを頼む。やり直しても投稿のカードに戻らない ----
await key("z", { ctrlKey: true });
await waitSave();
assert.deepEqual(plain(nodeOf("s1")), board.nodes[0], "テキストのカードに戻る");
assert.equal(nodeOf("s3").threadParentId, "s1", "スレッドの子は付け直す");
assert.deepEqual(requests.at(-1), { kind: "undo", rootPath: ROOT, conversionId: requests[0].conversionId });
assert.match(status(), /カードを元に戻し、投稿 1 件を消しました/);
await key("y", { ctrlKey: true });
await waitSave();
assert.equal(nodeOf("s1").type, "text", "やり直しても、消した投稿を指すカードには戻らない");
assert.equal(requests.filter((request) => request.kind === "undo").length, 1);
console.log("PASS undo: Ctrl+Z restores the card and the thread and asks once to delete the post; redo does not bring the post card back");

// ---- 3. C3: 通知の「元に戻す」から（登録された処理）。一度だけ ----
await postIt(["s1"]);
await waitSave();
assert.equal(nodeOf("s1").type, "post");
const second = requests.at(-1).conversionId;
let answer;
await act(async () => { answer = revert(second); await settle(); });
assert.equal(answer, true);
await waitSave();
assert.equal(nodeOf("s1").type, "text");
assert.equal(revert(second), false, "2回目は外さない");
const before = requests.length;
await key("z", { ctrlKey: true });
await waitSave();
assert.equal(requests.length, before, "通知から戻したあとの Ctrl+Z は、消すのを頼まない");
console.log("PASS toast undo: the registered revert restores once; Ctrl+Z after it asks nothing");

// ---- 4. C5: タイトルは本文の1行目に入れる ----
await postIt(["s2"]);
assert.deepEqual(requests.at(-1).cards, [{ id: "s2", text: "港\n朝の港。" }], "タイトルを本文の1行目に入れて投稿にする");
await waitSave();
assert.equal(nodeOf("s2").type, "post");
console.log("PASS title: a card's title becomes the first line of the post");

// ---- 5. K5・C7・C8: 選んだカードと、選んだグループの中のカードの和。グループの枠は残る ----
await postIt(["g", "s6"]);
assert.deepEqual(requests.at(-1).cards.map((item) => item.id).sort(), ["s4", "s5", "s6"],
  "K5: グループと外のカードを一緒に選ぶと、グループの中も入れる（「この順で原稿を作る」と同じ）");
await waitSave();
assert.deepEqual(["s4", "s5", "s6"].map((id) => nodeOf(id).type), ["post", "post", "post"]);
assert.equal(nodeOf("g").type, "group", "グループの枠は残る");
assert.equal(nodeOf("f").type, "file", "ファイルのカードは入らない");
console.log("PASS selection: the selected cards and the cards inside a selected group, the group frame stays");

// ---- 6. K8: 知らせのあとに利用者がボードを変えたら、保存の状態に戻る ----
await select(["s6"]);
await key("Delete");
await waitSave();
assert.match(status(), /保存済み/, "次にボードを変えたら、知らせは消えて保存の状態が出る");
console.log("PASS notice: the next board change brings the save state back");
await unmount();

// ---- 7. C9・K1: 書けなかったカードはテキストのまま。断られたら失敗と出す ----
await mount((request) => request.kind === "cards"
  ? { kind: "cards", failed: ["s2"], made: [{ id: "s1", post: "p-one" }] }
  : { kind: "undo", done: true, deleted: 1, kept: 0 });
await postIt(["s1", "s2"]);
await waitSave();
assert.equal(nodeOf("s1").type, "post");
assert.equal(nodeOf("s2").type, "text", "書けなかったカードはテキストのまま");
assert.match(status(), /1件を投稿にしました（1件は投稿にできませんでした）/);
await unmount();
await mount(() => { throw new Error("disk full"); });
await postIt(["s1"]);
await waitSave();
assert.equal(nodeOf("s1").type, "text");
assert.match(status(), /投稿にできませんでした: disk full/, "K1: 書けなかったら成功と出さない");
await unmount();
await mount((request) => request.kind === "cards"
  ? { kind: "cards", failed: [], made: request.cards.map((item) => ({ id: item.id, post: "p-x" })) }
  : { kind: "undo", done: true, deleted: 0, kept: 1 });
await postIt(["s1"]);
await waitSave();
await key("z", { ctrlKey: true });
await waitSave();
assert.match(status(), /カードを元に戻しました（投稿 1 件は直してあるので残しました）/, "C4: 直してある投稿は残す");
await unmount();
console.log("PASS failures: cards that could not be posted stay text; a refused request says so; an edited post is kept on undo");

// ---- 8. C11: 別ウィンドウは知らせでメイン画面に頼み、答えを待つ ----
await mount(respondMade, { embedded: false });
await postIt(["s1"]);
await waitSave();
const sent = emitted.find((item) => item.event === "then-canvas-copy-to-post");
assert.equal(sent.target, "main", "メイン画面に頼む");
assert.equal(sent.payload.request.kind, "cards");
assert.equal(nodeOf("s1").type, "post", "答えを待って置き換える");
await unmount();
console.log("PASS window: the separate window asks the main window by event and replaces the card after the answer");
