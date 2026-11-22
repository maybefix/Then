// Canvas の投稿のカード（docs/BINDER_POST_CARD_PLAN.md）。
// 本物の CanvasWindowApp・保存の層・投稿の書き戻しの順番待ちを1つに束ねて jsdom で動かし、Tauri の命令とメイン画面の
// 投稿（usePostStream の writeBody と同じ答え方をする入れ物）を受ける。カードに何が出て、ボードに何が書かれ、
// 投稿の書き戻しが、いつ・どの本文・どのハッシュで頼まれるかを確かめる。場面の番号（T1〜）は
// docs/BINDER_POST_CARD_SCENARIOS.md と同じ。
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

// ---- 束ねる ----
const stub = (contents) => ({ contents, loader: "js" });
const stubs = {
  "@tauri-apps/api/core": stub("export const invoke = (...args) => globalThis.postTest.invoke(...args);"),
  "@tauri-apps/api/event": stub(`
    export const listen = async (event, handler) => globalThis.postTest.listen(event, handler);
    export const emit = async (event, payload) => globalThis.postTest.emit(event, payload);
    export const emitTo = async (target, event, payload) => globalThis.postTest.emit(event, payload, target);`),
  "./components/references/ReferenceLayer": stub("export const ReferenceReadOnlyPreview = () => null;"),
  "./components/canvas/CanvasToManuscriptDialog": stub("export default () => null;"),
};
const external = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];
const entry = `
export { default as Canvas } from "./src/CanvasWindowApp.tsx";
export { canvasPostWriteQueue } from "./src/canvasBoardStore.ts";
export { CanvasPostWriteQueue } from "./src/canvasPostWriteQueue.ts";
export { flushPendingSaves } from "./src/pendingSaves.ts";
export { normalizeCanvasDocument, serializeCanvasDocument } from "./src/canvasTypes.ts";
export { boardFilePaths, fileCardsToTextCards } from "./src/utils/libraryTransfer.ts";
export { manuscriptSourceCards } from "./src/canvasToManuscript.ts";
`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts", sourcefile: "post-cards-entry.ts" },
  bundle: true, format: "esm", platform: "neutral", write: false, jsx: "automatic",
  plugins: [{
    name: "post-card-test",
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
const lib = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const { Canvas, canvasPostWriteQueue, CanvasPostWriteQueue, flushPendingSaves, normalizeCanvasDocument, serializeCanvasDocument } = lib;

// ---- 入れ物（Tauri の命令・知らせ・ボード・メイン画面の投稿） ----
const ROOT = "/library/作品A";
const WORK = { id: "w-a", name: "作品A" };
const hashOf = (post) => `h${[...JSON.stringify([post.id, post.body, post.edited ?? ""])].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) >>> 0, 7)}`;
const makePost = (fields) => { const post = { filed: false, noted: false, ...fields }; return { ...post, hash: hashOf(post) }; };
const listeners = new Map();
let store, docs, calls, emitted, writeRequests, opened, writeGate;
const boardKey = (rootPath, boardId) => JSON.stringify([rootPath, boardId]);
globalThis.postTest = {
  invoke: async (command, args = {}) => {
    calls.push({ command, ...structuredClone(args) });
    if (command === "list_canvas_boards") {
      return [...docs].filter(([id]) => JSON.parse(id)[0] === args.rootPath)
        .map(([id, doc]) => ({ id: JSON.parse(id)[1], name: doc.then.name, scope: "project", nodeCount: doc.nodes.length, edgeCount: 0 }));
    }
    if (command === "load_canvas_board") return structuredClone(docs.get(boardKey(args.rootPath, args.boardId)));
    if (command === "load_canvas_board_with_hash") {
      return { board: structuredClone(docs.get(boardKey(args.rootPath, args.boardId))), hash: null };
    }
    if (command === "canvas_board_hash") return null;
    if (command === "save_canvas_board") { docs.set(boardKey(args.rootPath, args.boardId), structuredClone(args.board)); return null; }
    if (command === "create_canvas_board") {
      const id = `created-${docs.size}`;
      docs.set(boardKey(args.rootPath, id), { nodes: [], edges: [], then: { version: 1, name: args.name } });
      return { id, name: args.name, scope: "project", nodeCount: 0, edgeCount: 0 };
    }
    if (command === "read_text_file") throw new Error("not found");
    if (command === "library_transfer_destinations") return [{ path: "/library", label: "ライブラリ「本棚」の直下" }];
    if (command === "get_canvas_window_payload") return structuredClone(globalThis.postTest.windowPayload);
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

/** メイン画面の writeBody と同じ答え方（外で直されていれば書かず、今の投稿を返す）。 */
async function mainWriteBody(request) {
  writeRequests.push(structuredClone(request));
  if (writeGate) await writeGate;
  const current = store.get(request.id);
  if (!current || current.hash !== request.baseHash) return { status: "conflict", post: current ? structuredClone(current) : undefined };
  const text = request.text.trim();
  if (!text) return { status: "unchanged" };
  const next = makePost({ ...current, body: text, edited: `e${writeRequests.length}` });
  store.set(next.id, next);
  return { status: "saved", post: structuredClone(next) };
}
const postsOf = () => ({ posts: [...store.values()].map((post) => structuredClone(post)), work: WORK });

const P1 = "p-dream";
const P2 = "p-harbor";
const P3 = "p-office";
const P4 = "p-reply";
const initialPosts = () => new Map([
  [P1, makePost({ id: P1, at: "2026-11-20T09:05:00+09:00", work: WORK, body: "灯台の夢" })],
  [P2, makePost({ id: P2, at: "2026-11-19T21:30:00+09:00", work: { id: "w-b", name: "作品B" }, body: "港で拾った言葉\n二行目" })],
  [P3, makePost({ id: P3, at: "2026-11-18T08:00:00+09:00", work: WORK, body: "夜の郵便局", noted: true,
    note: { work: "w-a", path: "素材/夜の郵便局.md", workRoot: ROOT, workName: "作品A", exists: true } })],
  [P4, makePost({ id: P4, at: "2026-11-20T09:10:00+09:00", work: WORK, replyTo: P1, body: "続き：波の音" })],
]);
const postNode = (id, post, x = 0) => ({ id, type: "post", post, x, y: 0, width: 280, height: 180 });
const boardA = () => ({
  nodes: [
    postNode("c1", P1),
    postNode("c2", P2, 300),
    postNode("c3", P3, 600),
    postNode("c4", P4, 900),
    postNode("gone", "p-deleted", 1200),
    { id: "t1", type: "text", text: "潮の匂い", x: 0, y: 400, width: 260, height: 150 },
  ],
  edges: [{ id: "e1", fromNode: "c1", toNode: "t1" }],
  then: { version: 1, name: "構想", scope: "project", updatedAt: 1 },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(0);
let root, props;
async function render() {
  await act(async () => {
    root.render(React.createElement(Canvas, props));
    await settle();
  });
  await act(async () => { await settle(); await settle(); });
}
async function mount({ embedded = true } = {}) {
  store = initialPosts();
  docs = new Map([[boardKey(ROOT, "a"), boardA()]]);
  calls = []; emitted = []; writeRequests = []; opened = []; writeGate = null;
  const payload = { requestId: `r${Date.now()}`, scope: "project", rootPath: ROOT, boardId: "a", workspaceName: "作品A",
    theme: "light", uiFontScale: 1, referenceFiles: [], projectFiles: [], openTabPaths: [], posts: postsOf() };
  props = embedded
    ? { embedded: true, embeddedPayload: payload, liveProjectFiles: [], liveOpenTabPaths: [], liveReferenceFiles: [],
      livePosts: postsOf(), onWritePost: mainWriteBody, onOpenPost: (id, target) => opened.push([id, target]) }
    : {};
  if (!embedded) globalThis.postTest.windowPayload = payload;
  root = createRoot(document.getElementById("root"));
  await render();
  await act(async () => { await sleep(20); });
}
async function unmount() { await act(async () => { root.unmount(); await settle(); }); }
/** メイン画面が投稿の一覧を新しくして、Canvas へ渡し直す。 */
async function republish() { props = { ...props, livePosts: postsOf() }; await render(); }
const card = (id) => document.querySelector(`[data-node-id="${id}"]`);
const shown = (id) => { const element = card(id)?.querySelector(".canvasFileText, textarea"); return element?.value ?? element?.textContent; };
async function dblclick(id) {
  await act(async () => {
    card(id).dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await settle();
  });
}
async function type(id, text) {
  const area = card(id).querySelector("textarea");
  assert.ok(area, `${id} is being edited`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(area, text);
    area.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await settle();
  });
}
async function blur(id) {
  await act(async () => {
    card(id).querySelector("textarea").dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    await settle();
  });
}
async function click(selector) {
  const element = typeof selector === "string" ? document.querySelector(selector) : selector;
  assert.ok(element, String(selector));
  await act(async () => { element.click(); await settle(); });
}
const buttonWithText = (text, scope = document) => [...scope.querySelectorAll("button")].find((button) => button.textContent.includes(text));
const waitWrites = () => act(async () => { await sleep(650); });
const savedBoard = (id = "a") => docs.get(boardKey(ROOT, id));
const conflictModal = () => document.querySelector('[aria-labelledby="canvas-post-conflict-title"]');

// ---- 1. 読み込みと保存の形 ----
{
  const raw = {
    nodes: [
      { id: "p", type: "post", post: P1, x: 1, y: 2, width: 280, height: 180, color: "3" },
      // post の欄が読めない投稿のカードは、知らない種類のカードと同じく書き戻す（落とさない）。
      { id: "broken", type: "post", x: 0, y: 0, width: 100, height: 100 },
    ],
    edges: [{ id: "e", fromNode: "p", toNode: "broken" }],
  };
  const read = normalizeCanvasDocument(raw);
  assert.deepEqual(read.nodes, [{ id: "p", type: "post", post: P1, x: 1, y: 2, width: 280, height: 180, color: "3" }]);
  const written = JSON.parse(JSON.stringify(serializeCanvasDocument(read)));
  assert.deepEqual(written.nodes.map((node) => node.id), ["p", "broken"]);
  assert.deepEqual(written.nodes[1], raw.nodes[1], "読めない投稿のカードはそのまま");
  assert.deepEqual(written.edges, raw.edges, "読めないカードにつながる線も残す");
}
console.log("PASS shape: a post card keeps only its place and the post id; one without a post id survives untouched");

// ---- 2. 表示（T1・T4・T6・T7・T8） ----
await mount();
assert.equal(card("c1").querySelector("header span").textContent, "投稿");
assert.equal(shown("c1"), "灯台の夢");
assert.equal(card("c1").querySelector("time").textContent, "9:05");
assert.equal(card("c1").querySelector(".canvasPostMeta").textContent, "9:05", "この作品の投稿には作品名を出さない");
assert.equal(card("c2").querySelector(".canvasPostMeta").textContent, "21:30作品B", "T4: ほかの作品の投稿は作品名を出す");
assert.equal(shown("c2"), "港で拾った言葉\n二行目");
assert.equal(card("c3").querySelector(".canvasPostNoteTag").textContent, "夜の郵便局", "T7: ノートにした投稿はノートの札");
assert.equal(card("c1").querySelector(".canvasPostNoteTag"), null);
assert.equal(shown("c4"), "続き：波の音", "T8: 返信はその投稿の本文だけ");
assert.ok(card("gone").classList.contains("isMissing"), "T6: 消えた投稿のカードは薄く出す");
assert.equal(shown("gone"), "");
assert.equal(card("gone").querySelector(".canvasFileOpenButton"), null, "消えた投稿は開けない");
await dblclick("gone");
assert.equal(card("gone").querySelector("textarea"), null, "消えた投稿のカードは直せない");
// 開く・札
await click(card("c1").querySelector(".canvasFileOpenButton"));
await click(card("c3").querySelector(".canvasPostNoteTag"));
assert.deepEqual(opened, [[P1, "post"], [P3, "note"]], "「開く」はアイデアのペインのその投稿、札はノート");
console.log("PASS show: body, time, other work, note tag, reply body only, a deleted post is a faint card; open and note tag");

// ---- 3. 置く（T1）: 「資料を追加」の一覧に投稿が新しい順で並び、本文で当たる ----
await click('[aria-label="資料を追加"]');
const popover = document.querySelector(".canvasReferencePopover");
const postRows = [...popover.querySelectorAll("button")].filter((button) => button.querySelector("span")?.textContent === "投稿");
assert.deepEqual(postRows.map((button) => button.querySelector("strong").textContent),
  ["続き：波の音", "灯台の夢", "港で拾った言葉", "夜の郵便局"], "投稿は新しい順。名前は書き出しの1行目");
assert.equal(postRows[2].querySelector("small").textContent, "2026/11/19 21:30 · 作品B");
await act(async () => {
  const input = popover.querySelector('input[aria-label="資料を検索"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "二行目");
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await settle();
});
const hits = [...document.querySelectorAll(".canvasReferencePopover button")].filter((button) => button.querySelector("span")?.textContent === "投稿");
assert.deepEqual(hits.map((button) => button.querySelector("strong").textContent), ["港で拾った言葉"], "本文の2行目でも当たる");
await click(hits[0]);
await act(async () => { await sleep(650); });
const placed = savedBoard().nodes.filter((node) => node.type === "post" && node.post === P2);
assert.equal(placed.length, 2, "同じ投稿のカードを2枚置ける（5-6）");
const added = placed.find((node) => node.id !== "c2");
assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(added))).sort(), ["height", "id", "post", "type", "width", "x", "y"],
  "投稿のカードは場所と投稿の ID だけを書く（本文・日時・作品・ハッシュは書かない）");
assert.equal(shown(added.id), "港で拾った言葉\n二行目");
assert.equal(writeRequests.length, 0, "置くだけでは投稿に書かない");
console.log("PASS place: posts listed newest first, found by body, placing writes only the id");

// ---- 4. 直して書き戻す（T2） ----
await dblclick("c1");
await type("c1", "灯台の夢。光が三回");
assert.equal(writeRequests.length, 0, "0.5 秒たつまでは書かない");
await type("c1", "灯台の夢。光が三回、二度目");
await waitWrites();
assert.equal(writeRequests.length, 1, "続けて直しても、書き戻しは1回にまとめる");
assert.deepEqual(writeRequests[0], { rootPath: ROOT, id: P1, text: "灯台の夢。光が三回、二度目", baseHash: initialPosts().get(P1).hash },
  "読んだときの行のハッシュを付ける");
assert.equal(store.get(P1).body, "灯台の夢。光が三回、二度目");
// メイン画面の一覧がまだ届かないうちに続けて直しても（別ウィンドウ）、書けたあとのハッシュを基準にする。
await type("c1", "三度目");
await waitWrites();
assert.equal(writeRequests.length, 2);
assert.equal(writeRequests[1].baseHash, makePost({ ...initialPosts().get(P1), body: "灯台の夢。光が三回、二度目", edited: "e1" }).hash);
assert.equal(store.get(P1).body, "三度目");
assert.equal(conflictModal(), null, "自分の書き戻しを外の変更と取り違えない");
// 書いているあいだに入れた編集は、書けたあとの行のハッシュで書く。
writeGate = sleep(300);
await type("c1", "四度目");
await act(async () => { await sleep(550); });
await type("c1", "五度目");
await act(async () => { await sleep(900); });
writeGate = null;
assert.equal(store.get(P1).body, "五度目");
assert.equal(conflictModal(), null);
await republish();
await blur("c1");
assert.equal(shown("c1"), "五度目", "一覧が届いたあとも、書けた本文を出す");
assert.equal(savedBoard().nodes.find((node) => node.id === "c1").post, P1, "ボードには ID のまま");
console.log("PASS write-back: debounced once, read hash sent, next base follows the save even before the list arrives");

// ---- 5. 空にしたら書かない ----
{
  const before = writeRequests.length;
  await dblclick("c4");
  await type("c4", "   ");
  await waitWrites();
  assert.equal(writeRequests.length, before, "空のあいだは書かない（投稿は空にできない）");
  await blur("c4");
  assert.equal(shown("c4"), "続き：波の音", "直し終えたら、投稿の本文に戻す");
}
console.log("PASS empty: an emptied card is not written and shows the post again when editing ends");

// ---- 6. 外で直された（T3・5-8） ----
{
  // 投稿のペインで直した（メイン画面の一覧はまだ Canvas に届いていない）。
  const outside = makePost({ ...store.get(P2), body: "ペインで直した", edited: "pane" });
  store.set(P2, outside);
  await dblclick("c2");
  await type("c2", "カードで直した");
  await waitWrites();
  const modal = conflictModal();
  assert.ok(modal, "書かずに選ぶ画面を出す");
  assert.equal(store.get(P2).body, "ペインで直した", "外の変更を上書きしない");
  assert.ok(buttonWithText("投稿の内容を読み込む", modal) && buttonWithText("この内容で上書きする", modal));
  await click(buttonWithText("この内容で上書きする", modal));
  await waitWrites();
  assert.equal(store.get(P2).body, "カードで直した", "「この内容で上書きする」は今の投稿の上に書く");
  assert.equal(writeRequests.at(-1).baseHash, outside.hash);
  // もう一度ぶつけて、今度は読み込む。
  store.set(P2, makePost({ ...store.get(P2), body: "またペインで", edited: "pane2" }));
  await republish();
  store.set(P2, makePost({ ...store.get(P2), body: "さらにペインで", edited: "pane3" }));
  await type("c2", "捨てる文");
  await waitWrites();
  assert.ok(conflictModal());
  await click(buttonWithText("投稿の内容を読み込む", conflictModal()));
  await republish();
  await blur("c2");
  assert.equal(shown("c2"), "さらにペインで", "「投稿の内容を読み込む」は直した本文を捨てる");
  assert.equal(store.get(P2).body, "さらにペインで");
  // 直しているあいだに投稿が消えた。上書きは出さない。
  await dblclick("c4");
  store.delete(P4);
  await type("c4", "消えた投稿へ");
  await waitWrites();
  assert.ok(conflictModal());
  assert.equal(buttonWithText("この内容で上書きする", conflictModal()), undefined, "消えた投稿には上書きできない");
  await click(buttonWithText("投稿の内容を読み込む", conflictModal()));
  await republish();
  assert.ok(card("c4").classList.contains("isMissing"));
}
console.log("PASS conflict: not written over; overwrite writes on the current post, reload drops the edit, a deleted post cannot be overwritten");

// ---- 7. 消して戻す（T6） ----
{
  const p1 = store.get(P1);
  store.delete(P1);
  await republish();
  assert.ok(card("c1").classList.contains("isMissing"), "消すとカードは薄くなる");
  assert.ok(savedBoard().nodes.some((node) => node.id === "c1"), "カードはボードに残る");
  store.set(P1, p1);
  await republish();
  assert.equal(card("c1").classList.contains("isMissing"), false, "元に戻すと元のカードに戻る");
  assert.equal(shown("c1"), "五度目");
}
console.log("PASS delete: the card stays as a faint card and comes back when the post is restored");

// ---- 8. ほかの機能（T9・T10・「投稿にする」） ----
{
  // 「この順で原稿を作る」「投稿にする」はテキストのカードだけを見る。
  const board = normalizeCanvasDocument(savedBoard());
  assert.deepEqual(lib.manuscriptSourceCards(board, new Set(board.nodes.map((node) => node.id))).map((node) => node.id), ["t1"],
    "T10: この順で原稿を作るに投稿のカードは入らない");
  // 送る: 投稿のカードのまま送る（送り先は同じライブラリ）。
  assert.deepEqual(lib.fileCardsToTextCards(board, new Map()).nodes.filter((node) => node.type === "post").map((node) => node.id).sort(),
    board.nodes.filter((node) => node.type === "post").map((node) => node.id).sort(), "T9: 送っても投稿のカードのまま");
}
await click('[aria-label="ボードを切り替え"]');
await click('[aria-label="「構想」を移動・コピー"]');
await act(async () => { await sleep(20); });
await act(async () => {
  document.querySelector(".canvasRenameModal").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
});
const sent = [...docs].find(([id]) => JSON.parse(id)[0] === "/library")?.[1];
assert.ok(sent, "送り先にボードを作る");
// Tauri へは JSON で渡るので、undefined の欄は書かれない。
assert.deepEqual(JSON.parse(JSON.stringify(sent.nodes.find((node) => node.id === "c1"))), postNode("c1", P1),
  "T9: 送り先でも同じ投稿を指す");
await unmount();
console.log("PASS around: not in make-manuscript; a sent board keeps its post cards");

// ---- 9. 閉じる前と、閉じたとき ----
await mount();
await dblclick("c1");
await type("c1", "閉じる前の書き切り");
await act(async () => { await flushPendingSaves(); });
assert.equal(store.get(P1).body, "閉じる前の書き切り", "閉じる前の書き切りで、0.5 秒を待たずに書く");
await type("c1", "閉じる直前");
await unmount();
await act(async () => { await sleep(20); });
assert.equal(store.get(P1).body, "閉じる直前", "Canvas を閉じても書き戻す");
console.log("PASS flush: before close and on unmount, the card edit is written without waiting 0.5 s");

// ---- 10. 別ウィンドウ: 書き戻しも開くも、メイン画面に頼む ----
const mainSide = globalThis.postTest.listen("then-canvas-post-write", async ({ payload }) => {
  const result = await mainWriteBody(payload.request);
  globalThis.postTest.emit("then-canvas-post-write-result", { requestId: payload.requestId, result }, "idea-canvas");
});
await mount({ embedded: false });
assert.equal(shown("c2"), "港で拾った言葉\n二行目", "開いた時点の一覧で映す");
// メイン画面の一覧が変わると、ライブの知らせで新しくなる。
store.set(P2, makePost({ ...store.get(P2), body: "メイン画面で直した", edited: "main" }));
globalThis.postTest.emit("then-canvas-live-data", { referenceFiles: [], projectFiles: [], openTabPaths: [], posts: postsOf() }, "idea-canvas");
await act(async () => { await sleep(20); });
assert.equal(shown("c2"), "メイン画面で直した");
await dblclick("c1");
await type("c1", "別ウィンドウで直した");
globalThis.postTest.emit("then-canvas-flush", { requestId: "close-1" }, "idea-canvas");
await act(async () => { await sleep(50); });
assert.equal(store.get(P1).body, "別ウィンドウで直した", "メイン画面に頼んで書く");
assert.ok(emitted.some((item) => item.event === "then-canvas-post-write" && item.target === "main"), "書くのはメイン画面");
assert.ok(emitted.some((item) => item.event === "then-canvas-flush-done" && item.payload.requestId === "close-1"));
await click(card("c3").querySelector(".canvasFileOpenButton"));
assert.ok(emitted.some((item) => item.event === "then-canvas-open-post" && item.target === "main" &&
  item.payload.id === P3 && item.payload.target === "post"), "「開く」はメイン画面に頼む");
await act(async () => { await sleep(20); });
assert.ok(calls.some((call) => call.command === "focus_main_window"), "メイン画面を前に出す（ページの窓の API は使えない）");
await unmount();
mainSide();
console.log("PASS separate window: the list comes with the payload and live data; write-back and open go through the main window");

// ---- 11. 順番待ちそのもの ----
{
  const writes = [];
  let gate;
  const queue = new CanvasPostWriteQueue(async (request) => {
    writes.push(structuredClone(request));
    if (gate) await gate.promise;
    if (request.text === "fail") throw new Error("disk full");
    return { status: "saved", post: { id: request.id, body: request.text, hash: `hash:${request.text}` } };
  });
  queue.enqueue({ rootPath: ROOT, id: P1, text: "one", baseHash: "h0" });
  queue.enqueue({ rootPath: ROOT, id: P1, text: "two", baseHash: "h0" });
  queue.enqueue({ rootPath: ROOT, id: P2, text: "other", baseHash: "g0" });
  await queue.flush();
  assert.deepEqual(writes.map((write) => write.text), ["two", "other"], "同じ投稿は新しい本文で置き換える");
  gate = Promise.withResolvers();
  queue.enqueue({ rootPath: ROOT, id: P1, text: "three", baseHash: "hash:two" });
  const flushing = queue.flush();
  await Promise.resolve(); await Promise.resolve();
  queue.enqueue({ rootPath: ROOT, id: P1, text: "four", baseHash: "hash:two" });
  gate.resolve(); gate = null;
  await flushing;
  assert.deepEqual(writes.slice(2).map((write) => [write.text, write.baseHash]), [["three", "hash:two"], ["four", "hash:three"]],
    "書いている途中に入った分は、書けたあとのハッシュへつなぐ");
  queue.enqueue({ rootPath: ROOT, id: P1, text: "fail", baseHash: "x" });
  await assert.rejects(queue.flush(), /disk full/);
  assert.equal(queue.size, 1, "書けなかったものは残す");
  const unclaimed = new CanvasPostWriteQueue(async () => ({ status: "conflict" }));
  unclaimed.enqueue({ rootPath: ROOT, id: P1, text: "lost?", baseHash: "x" });
  await unclaimed.flush();
  const late = [];
  unclaimed.subscribe((outcome) => late.push(outcome.request.text));
  assert.deepEqual(late, ["lost?"], "聞く Canvas がいないあいだの外の変更は、次に聞いた Canvas に渡す");
}
assert.equal(canvasPostWriteQueue.size, 0, "テストの終わりに残った書き戻しはない");
console.log("PASS queue: coalesce per post, hash hand-over, failures stay, unclaimed conflicts are kept");
