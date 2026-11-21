// BINDER 4-4「この順で原稿を作る」の Canvas の側。本物の CanvasWindowApp を jsdom で埋め込みとして動かし、
// メイン画面への頼み（onManuscriptRequest）と通知からの「元に戻す」（onRegisterManuscriptRevert）は入れ物で受ける。
// 選んだカード → 並べ替えの画面 → 頼みの中身 → ボードの置き換え・スレッドの子 → Ctrl+Z / 通知からの取り消し、を確かめる。
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
  "@tauri-apps/api/core": stub("export const invoke = (...args) => globalThis.manuscriptTest.invoke(...args);"),
  "@tauri-apps/api/event": stub(`
    export const listen = async () => () => {};
    export const emit = async () => {};
    export const emitTo = async () => {};`),
  "./components/references/ReferenceLayer": stub("export const ReferenceReadOnlyPreview = () => null;"),
  "./components/canvas/IntermediateDraftPane": stub("export default () => null;"),
  "./intermediateDraftStore": stub("export const prepareDraftBoardTrash = async () => {}; export const flushDraftBoard = async () => {};"),
};
const external = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];
const bundled = await build({
  stdin: { contents: 'export { default as Canvas } from "./src/CanvasWindowApp.tsx";', resolveDir: process.cwd(), loader: "ts", sourcefile: "manuscript-entry.ts" },
  bundle: true, format: "esm", platform: "neutral", write: false, jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{
    name: "manuscript-test",
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

const ROOT = "/work";
let board, saved, requests, revert, files;
globalThis.manuscriptTest = {
  invoke: async (command, args = {}) => {
    if (command === "list_canvas_boards") return [{ id: "a", name: board.then.name, scope: "project", nodeCount: 0, edgeCount: 0 }];
    if (command === "load_canvas_board") return structuredClone(saved ?? board);
    if (command === "load_canvas_board_with_hash") return { board: structuredClone(saved ?? board), hash: null };
    if (command === "canvas_board_hash") return null;
    if (command === "save_canvas_board") { saved = structuredClone(args.board); return null; }
    if (command === "read_text_file") {
      const content = files.get(args.path);
      if (content === undefined) throw new Error("not found");
      return { path: args.path, name: args.path, content, contentHash: "h" };
    }
    if (command === "library_transfer_destinations") return [];
    if (command === "load_intermediate_draft") return { versions: [] };
    if (command === "focus_source_in_main" || command === "finish_canvas_close_preparation") return;
    throw new Error(`Unexpected command ${command}`);
  },
};
window.__TAURI_INTERNALS__ = {};

const text = (id, x, y, body, extra = {}) => ({ id, type: "text", x, y, width: 200, height: 120, text: body, ...extra });
const startBoard = () => ({
  nodes: [
    text("a", 0, 0, "朝の港。", { title: "港", color: "4" }),
    text("b", 0, 300, "夜の場面。\n\n二段落目。"),
    text("c", 0, 600, "  "),
    text("d", 400, 0, "子のカード", { threadParentId: "a", threadOrder: 0 }),
    { id: "f", type: "file", x: 800, y: 0, width: 300, height: 240, file: "第一章/既存.txt" },
  ],
  edges: [{ id: "e1", fromNode: "b", toNode: "a", connector: "arrow" }],
  then: { version: 1, name: "潮待ち", scope: "project", updatedAt: 1 },
});
const folders = { folders: [{ path: "", label: "作品" }, { path: "第一章", label: "作品/第一章" }], current: "第一章" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(0);
let root, props;
async function render() {
  await act(async () => { root.render(React.createElement(Canvas, props)); await settle(); });
  await act(async () => { await settle(); await settle(); });
}
async function mount(respond) {
  board = startBoard(); saved = null; requests = []; revert = null;
  files = new Map([[`${ROOT}/第一章/既存.txt`, "---\nsynopsis: 既存の概要\n---\n# 既存\n"]]);
  const payload = { requestId: `r${Date.now()}`, scope: "project", rootPath: ROOT, boardId: "a", workspaceName: "作品",
    theme: "light", uiFontScale: 1, referenceFiles: [], projectFiles: [], openTabPaths: [] };
  const projectFiles = [{ path: "第一章/既存.txt", role: "manuscript" }, { path: "第一章/港.txt", role: "manuscript" },
    { path: "第一章/夜の場面。.txt", role: "manuscript" }];
  props = {
    embedded: true, embeddedPayload: payload, liveProjectFiles: projectFiles, liveOpenTabPaths: [], liveReferenceFiles: [],
    liveManuscriptFolders: folders,
    onWriteFile: async () => ({ status: "unchanged" }),
    onManuscriptRequest: async (request) => { requests.push(JSON.parse(JSON.stringify(request))); return respond(request); },
    onRegisterManuscriptRevert: (handler) => { revert = handler; },
  };
  root = createRoot(document.getElementById("root"));
  await render();
  await act(async () => { await sleep(20); });
}
async function unmount() { await act(async () => { root.unmount(); await settle(); }); }
const card = (id) => document.querySelector(`[data-node-id="${id}"]`);
const nodeOf = (id) => (saved ?? board).nodes.find((node) => node.id === id);
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
const buttonWithText = (label) => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
const dialog = () => document.querySelector('[role="dialog"][aria-label="この順で原稿を作る"]');
const rows = () => [...dialog().querySelectorAll(".draftOrderList li")];
const waitSave = () => act(async () => { await sleep(650); });
const status = () => document.querySelector(".canvasSaveStatus")?.textContent ?? "";
let made = 0;
const respondCards = (request) => {
  if (request.kind === "cards") {
    made += 1;
    return { kind: "cards", failed: [], made: request.cards.map((item) => ({ id: item.id, path: `第一章/${item.name}.txt` })) };
  }
  if (request.kind === "undo") return { kind: "undo", done: true, trashed: 2, kept: 0 };
  return { kind: "joined", path: `第一章/${request.name}.txt` };
};

// ---- 1. ボタン、並べ替えの画面、カードごと ----
await mount(respondCards);
await select(["f"]);
assert.equal(button("この順で原稿を作る").disabled, true, "ファイルのカードだけを選んでいると押せない");
await select(["a", "b", "c", "f"]);
assert.equal(button("この順で原稿を作る").disabled, false);
await click(button("この順で原稿を作る"));
assert.ok(dialog(), "並べ替えの画面が出る");
assert.deepEqual(rows().map((row) => row.querySelector(".draftCardName")?.textContent ?? ""), ["夜の場面。", "港", ""],
  "初期の順序は矢印（b → a）、名前はタイトル → 書き出し。ファイルのカードは入らない");
assert.ok(rows()[2].classList.contains("isExcluded"), "空のカードは最初から除外");
assert.equal(dialog().querySelector("select").value, "第一章", "作る先の初期値はメイン画面が決めたフォルダ");
await click(button("カード2を上へ"));
assert.deepEqual(rows().map((row) => row.querySelector(".draftCardName")?.textContent ?? ""), ["港", "夜の場面。", ""]);
await act(async () => {
  dialog().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await settle();
});
assert.ok(dialog(), "画面の中のキーは Canvas の Ctrl+Z に届かない");
await click(buttonWithText("カードごとに原稿を作る"));
assert.equal(dialog(), null);
assert.deepEqual(requests[0], {
  kind: "cards", rootPath: ROOT, folder: "第一章", conversionId: requests[0].conversionId,
  cards: [{ id: "a", name: "港", text: "朝の港。" }, { id: "b", name: "夜の場面。", text: "夜の場面。\n\n二段落目。" }],
});
await waitSave();
assert.deepEqual(JSON.parse(JSON.stringify(nodeOf("a"))), { id: "a", type: "file", x: 0, y: 0, width: 200, height: 120, file: "第一章/港.txt", color: "4" });
assert.equal(nodeOf("b").type, "file");
assert.equal(nodeOf("c").type, "text", "除外したカードはテキストのまま");
assert.equal(nodeOf("d").threadParentId, undefined, "置き換えたカードの子はスレッドから外れる");
assert.deepEqual(JSON.parse(JSON.stringify(saved.edges)), board.edges, "線は残る");
console.log("PASS cards: button, initial order (arrows, names, empty excluded), reorder, request, replaced cards, thread child, edges");

// ---- 2. Ctrl+Z で戻すと、テキストに戻り、メイン画面にゴミ箱を頼む。やり直しても原稿のカードに戻らない ----
await key("z", { ctrlKey: true });
await waitSave();
assert.equal(nodeOf("a").type, "text");
assert.equal(nodeOf("a").title, "港");
assert.equal(nodeOf("b").text, "夜の場面。\n\n二段落目。");
assert.equal(nodeOf("d").threadParentId, "a", "スレッドの子は付け直す");
assert.deepEqual(requests.at(-1), { kind: "undo", rootPath: ROOT, conversionId: requests[0].conversionId });
await key("y", { ctrlKey: true });
await waitSave();
assert.equal(nodeOf("a").type, "text", "やり直しても、消した原稿を指すカードには戻らない");
assert.equal(requests.filter((request) => request.kind === "undo").length, 1);
console.log("PASS undo: Ctrl+Z restores the cards and the thread, asks the main window once; redo does not bring the file cards back");

// ---- 3. 通知の「元に戻す」から（登録された処理）。一度だけ。そのあとの Ctrl+Z は頼まない ----
await select(["a", "b"]);
await click(button("この順で原稿を作る"));
await click(buttonWithText("カードごとに原稿を作る"));
await waitSave();
assert.equal(nodeOf("a").type, "file");
const second = requests.at(-1).conversionId;
let answer;
await act(async () => { answer = revert(second); await settle(); });
assert.equal(answer, true);
await waitSave();
assert.equal(nodeOf("a").type, "text");
assert.equal(nodeOf("d").threadParentId, "a");
assert.equal(revert(second), false, "2回目は外さない");
assert.equal(revert("unknown"), false);
const before = requests.length;
await key("z", { ctrlKey: true });
await waitSave();
assert.equal(nodeOf("a").type, "text", "通知から戻したあとの Ctrl+Z でも、原稿のカードには戻らない");
assert.equal(requests.length, before, "通知から戻したあとは、Ctrl+Z でゴミ箱を頼まない");
console.log("PASS toast undo: the registered revert restores once, history copies too; Ctrl+Z after it asks nothing");

// ---- 4. 1本につなげる。名前はボード名から。ボードは変わらない。Escape で閉じる ----
await select(["a", "b"]);
await click(button("この順で原稿を作る"));
await act(async () => { dialog().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle(); });
assert.equal(dialog(), null, "Escape で閉じる");
await click(button("この順で原稿を作る"));
await click(buttonWithText("1本の原稿につなげる"));
const input = dialog().querySelector("input");
assert.equal(input.value, "潮待ち");
const boardBefore = JSON.stringify(saved.nodes);
await click(buttonWithText("原稿を作る"));
assert.deepEqual(requests.at(-1), {
  kind: "joined", rootPath: ROOT, folder: "第一章", name: "潮待ち", boardName: "潮待ち",
  cards: [{ id: "b", text: "夜の場面。\n\n二段落目。" }, { id: "a", title: "港", text: "朝の港。" }],
});
assert.equal(dialog(), null);
await waitSave();
assert.equal(JSON.stringify(saved.nodes), boardBefore, "1本につなげてもボードは変わらない");
assert.match(status(), /原稿「潮待ち」を作りました/);
console.log("PASS joined: name from the board, request in list order with titles, board unchanged, Escape closes");
await unmount();

// ---- 5. 作れなかったカードはテキストのまま ----
await mount((request) => request.kind === "cards"
  ? { kind: "cards", failed: ["b"], made: [{ id: "a", path: "第一章/港.txt" }] }
  : { kind: "undo", done: true, trashed: 1, kept: 0 });
await select(["a", "b"]);
await click(button("この順で原稿を作る"));
await click(buttonWithText("カードごとに原稿を作る"));
await waitSave();
assert.equal(nodeOf("a").type, "file");
assert.equal(nodeOf("b").type, "text");
await unmount();
await mount(() => { throw new Error("disk full"); });
await select(["a"]);
await click(button("この順で原稿を作る"));
await click(buttonWithText("カードごとに原稿を作る"));
assert.ok(dialog(), "頼みが断られたら、画面は閉じない");
assert.match(status(), /原稿を作れませんでした: disk full/);
await unmount();
console.log("PASS failures: cards that could not be made stay text; a refused request keeps the dialog open");
