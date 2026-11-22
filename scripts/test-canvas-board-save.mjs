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
assert.equal(queue.flush(), saving);
gate.resolve(); await saving;
assert.deepEqual(writes.map(w => w.name), ["first", "latest", "other project"]);
assert.deepEqual(writes.map(w => [w.scope, w.rootPath]), [["project", "one"], ["project", "one"], ["project", "two"]]);
let fail = true, recovered;
const retryQueue = new CanvasBoardSaveQueue(async (...args) => { if (fail) throw Error("disk full"); recovered = args; });
retryQueue.enqueue(target, board("unsaved"));
await assert.rejects(retryQueue.flush(), /disk full/);
fail = false; await retryQueue.flush();
assert.equal(recovered[3].then.name, "unsaved");
console.log("PASS queue: immutable destinations and snapshots, serialized edits, separate projects, retry after failure");

const fileQueueUrl = await compile("src/canvasFileWriteQueue.ts");
const pendingSavesUrl = await compile("src/pendingSaves.ts");
const canvasUrl = await compile("src/CanvasWindowApp.tsx", {
  react: pathToFileURL(require.resolve("react")).href,
  "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
  "@tauri-apps/api/core": url("export const invoke = (...args) => globalThis.canvasTestInvoke(...args);"),
  "@tauri-apps/api/event": url("export const emit = async () => {}; export const emitTo = emit; export const listen = async (event, handler) => { const list = (globalThis.canvasTestListeners ??= {})[event] ??= new Set(); list.add(handler); return () => list.delete(handler); };"),
  "./utils/fontStack": await compile("src/utils/fontStack.ts"),
  "./canvasAppearance": await compile("src/canvasAppearance.ts", {
    "./utils/fontStack": await compile("src/utils/fontStack.ts"),
  }),
  "./canvasTypes": await compile("src/canvasTypes.ts"),
  "./canvasThreads": await compile("src/canvasThreads.ts"),
  "./canvasResize": await compile("src/canvasResize.ts"),
  "./utils/latestFrameScheduler": await compile("src/utils/latestFrameScheduler.ts"),
  "./components/references/ReferenceLayer": url("export const ReferenceReadOnlyPreview = () => null;"),
  // 「この順で原稿を作る」（BINDER 4-4）。このテストはボードの保存だけを見るので、画面は空にする。
  "./components/canvas/CanvasToManuscriptDialog": url("export default () => null;"),
  "./canvasToManuscript": await compile("src/canvasToManuscript.ts", {
    "./posts/postModel": await compile("src/posts/postModel.ts"),
  }),
  "./utils/libraryTransfer": url("export const boardReferencePaths = () => []; export const rewriteBoard = (board) => board; export const boardFilePaths = () => []; export const fileCardsToTextCards = (board) => board;"),
  "./ideaReferenceModel": url("export const normalizedReferenceKey = (path) => path;"),
  "./canvasBoardSaveQueue": queueUrl,
  // ファイルのカード（BINDER 4-2）の部品。このテストはボードの保存だけを見るので、概要の読み取りは空にする。
  "./canvasFileWriteQueue": fileQueueUrl,
  "./pendingSaves": pendingSavesUrl,
  "./utils/frontmatter": await compile("src/utils/frontmatter.ts"),
  "./corkboard/synopsis": url("export const readSynopsis = () => ({ kind: 'none' });"),
  "./canvasFileDrop": await compile("src/canvasFileDrop.ts"),
  "./canvasBoardStore": await compile("src/canvasBoardStore.ts", {
    "@tauri-apps/api/core": url("export const invoke = (...args) => globalThis.canvasTestInvoke(...args);"),
    "./canvasTypes": await compile("src/canvasTypes.ts"),
    "./canvasBoardSaveQueue": queueUrl,
    "./canvasFileWriteQueue": fileQueueUrl,
  }),
});
const { default: Canvas } = await import(canvasUrl);
window.__TAURI_INTERNALS__ = {};
let docs, calls, loadGate, writeGate, failingWrite;
const key = (scope, rootPath, boardId) => JSON.stringify([scope, rootPath, boardId]);
let versions = new Map();
const boardHash = (k) => (docs.has(k) ? `v${versions.get(k) ?? 0}` : null);
globalThis.canvasTestInvoke = async (command, args) => {
  calls.push({ command, ...structuredClone(args) });
  const k = key(args.scope, args.rootPath, args.boardId);
  if (command === "list_canvas_boards") return [...docs].filter(([id]) => {
    const [scope, root] = JSON.parse(id); return scope === args.scope && root === args.rootPath;
  }).map(([id, doc]) => ({ id: JSON.parse(id)[2], name: doc.then.name, scope: args.scope, nodeCount: doc.nodes.length, edgeCount: 0 }));
  if (command === "load_canvas_board") {
    if (loadGate?.key === k) await loadGate.promise;
    return structuredClone(docs.get(k));
  }
  // BINDER 4-3: ボードのファイルのハッシュ。書くたび・外で書き換えるたびに版が進む。
  if (command === "load_canvas_board_with_hash") {
    if (loadGate?.key === k) await loadGate.promise;
    return { board: structuredClone(docs.get(k)), hash: boardHash(k) };
  }
  if (command === "canvas_board_hash") return boardHash(k);
  if (command === "save_canvas_board") {
    if (failingWrite) throw Error("disk full");
    if (writeGate) await writeGate.promise;
    if (args.expectedHash && args.expectedHash !== boardHash(k)) {
      throw Error("document content conflict: ボードのファイルが外部で変更されたため保存しませんでした");
    }
    docs.set(k, structuredClone(args.board));
    versions.set(k, (versions.get(k) ?? 0) + 1);
    return boardHash(k);
  }
  if (command === "trash_canvas_board") { docs.delete(k); return; }
  throw Error(`Unexpected command ${command}`);
};
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
let root, payload, strict = false, extraProps = {};
async function mount() {
  docs = new Map([[key("project", "one", "a"), board("A")], [key("project", "one", "b"), board("B")],
    [key("project", "one", "c"), board("C")], [key("project", "two", "a"), board("Other")]]);
  calls = []; loadGate = null; writeGate = null; failingWrite = false; versions = new Map();
  payload = { requestId: "test", scope: "project", rootPath: "one", boardId: "a", workspaceName: "Test",
    theme: "light", uiFontScale: 1, referenceFiles: [] };
  root = createRoot(document.getElementById("root"));
  await render();
}
async function render() {
  await act(async () => {
    const canvas = React.createElement(Canvas, { embedded: true, embeddedPayload: payload, ...extraProps });
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
async function setTitle(title) {
  const input = document.querySelector('[aria-label="カードのタイトル"]'); assert.ok(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, title);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); await settle();
  });
  assert.equal(input.value, title);
}
const textAt = (scope, project, id) => docs.get(key(scope, project, id)).nodes[0].text;
const titleAt = (scope, project, id) => docs.get(key(scope, project, id)).nodes[0].title;
const colorAt = (scope, project, id) => docs.get(key(scope, project, id)).nodes[0].color;
const shownText = () => document.querySelector('[aria-label="カードの本文"]')?.value
  ?? document.querySelector(".canvasCardText")?.textContent;
async function unmount() { await act(async () => { root.unmount(); await settle(); }); }

await mount();
const viewport = document.querySelector(".canvasViewport"); assert.ok(viewport);
const world = document.querySelector(".canvasWorld"); assert.ok(world);
const transformBeforeWheel = world.style.transform;
await act(async () => {
  for (let index = 0; index < 2; index += 1) {
    viewport.dispatchEvent(new dom.window.WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 420,
      clientY: 280,
      deltaY: -120,
    }));
  }
  await settle();
});
assert.notEqual(world.style.transform, transformBeforeWheel);
assert.ok(Number.parseInt(document.querySelector(".canvasZoomValue").textContent, 10) > 130);
console.log("PASS navigation: plain wheel zooms smoothly around the pointer");
await edit("A edited");
await setTitle("導入");
await click('[aria-label="表示設定"]');
await click('[aria-label="カード色: 緑"]');
await select("B"); await unmount();
assert.equal(textAt("project", "one", "a"), "A edited");
assert.equal(titleAt("project", "one", "a"), "導入");
assert.equal(colorAt("project", "one", "a"), "4");
assert.equal(textAt("project", "one", "b"), "B");
console.log("PASS regression: title, color, and body survive an immediate board switch");

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

await mount(); await edit("First project");
payload = { ...payload, rootPath: "two", requestId: "two" }; await render();
assert.equal(shownText(), "Other"); await unmount();
assert.equal(textAt("project", "one", "a"), "First project");
assert.equal(textAt("project", "two", "a"), "Other");
console.log("PASS projects: changing projects never saves an old board to a new destination");

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

// BINDER 2-6: 作品の中の改名・移動を受けると、持っているボード（と履歴）の資料カードを付け替えて保存する。
strict = false; await mount(); await unmount();
const ref = (id, sourcePath, kind, scope = "project") => ({ id, type: "reference", x: 0, y: 0, width: 200, height: 120, scope, sourcePath, name: sourcePath.split("/").pop(), kind });
docs.get(key("project", "one", "a")).nodes.push(ref("r1", "素材/資料/地図.png", "image"), ref("r2", "素材/資料/年表/メモ.md", "markdown"), ref("r3", "本編.md", "markdown"));
calls = [];
root = createRoot(document.getElementById("root"));
await render();
const emitPathChanges = async (payload) => { await act(async () => { for (const handler of globalThis.canvasTestListeners["then-canvas-path-changes"] ?? []) handler({ payload }); await settle(); }); };
await emitPathChanges({ rootPath: "two", changes: [{ oldPath: "素材/資料/地図.png", newPath: "素材/港.png" }] });
await emitPathChanges({ rootPath: "one", changes: [{ oldPath: "素材/資料/地図.png", newPath: "素材/資料/港.png" }] });
await emitPathChanges({ rootPath: "one", changes: [{ oldPath: "素材/資料", newPath: "素材/参考" }] });
await emitPathChanges({ rootPath: "one", changes: [{ oldPath: "素材/参考", newPath: "素材/参考" }] });
await unmount();
const nodesOfA = docs.get(key("project", "one", "a")).nodes;
const refOf = (id) => nodesOfA.find((node) => node.id === id);
assert.deepEqual([refOf("r1").sourcePath, refOf("r1").name, refOf("r1").kind], ["素材/参考/港.png", "港.png", "image"]);
assert.equal(refOf("r2").sourcePath, "素材/参考/年表/メモ.md", "フォルダの中の資料も付いていく");
assert.equal(refOf("r3").sourcePath, "本編.md", "関係ない資料カードはそのまま");
assert.equal(nodesOfA[0].text, "A", "テキストカードはそのまま");
assert.equal(calls.some((c) => c.command === "save_canvas_board" && c.boardId !== "a"), false, "開いていないボードは保存しない（Rust が書き換える）");
assert.equal(calls.some((c) => c.command === "save_canvas_board" && c.rootPath === "two"), false, "ほかの作品の知らせでは保存しない");
console.log("PASS path changes: open board and history follow renames and moves inside the work");

// ---- BINDER 4-3（確認1の 3）: 外で書き換えられたボードは上書きせず、選ばせる ----
{
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitSave = () => act(async () => { await sleep(650); });
  const outside = (id, text) => {
    const k = key("project", "one", id);
    docs.get(k).nodes[0].text = text;
    versions.set(k, (versions.get(k) ?? 0) + 1000);
  };
  const modal = () => document.querySelector('[aria-labelledby="canvas-board-conflict-title"]');
  const choose = async (label) => {
    const button = [...(modal()?.querySelectorAll("button") ?? [])].find((item) => item.textContent.includes(label));
    assert.ok(button, label);
    await act(async () => { button.click(); await settle(); });
    await act(async () => { await settle(); await settle(); });
  };

  // 読み込む: 待っている保存を捨て、ファイルの中身を出す。そのあとはそのファイルの上に書ける。
  await mount();
  const loadCall = calls.find((c) => c.command === "load_canvas_board_with_hash" && c.boardId === "a");
  assert.ok(loadCall, "直すボードは、ハッシュと一緒に読む");
  outside("a", "外で直した");
  await edit("Then で直した");
  await waitSave();
  assert.equal(textAt("project", "one", "a"), "外で直した", "外で書き換えたボードは上書きしない");
  assert.equal(calls.filter((c) => c.command === "save_canvas_board").at(-1).expectedHash, "v0", "読んだときのハッシュを送る");
  assert.ok(modal(), "選ぶ画面が出る");
  assert.match(modal().textContent, /ほかのアプリでファイルが変更されました/);
  assert.match(modal().textContent, /「A」/);
  const statusText = document.querySelector(".canvasSaveStatus")?.textContent ?? "";
  assert.doesNotMatch(statusText, /CanvasBoardConflictError|document content conflict/, "状態の欄には、型の名前や内部の印を出さない");
  assert.match(statusText, /外部で変更されたため保存しませんでした/);
  await choose("ファイルの内容を読み込む");
  assert.equal(modal(), null);
  assert.equal(shownText(), "外で直した", "読み込むと、ファイルの中身を出す");
  await edit("読み込んだあとに直す");
  await waitSave();
  assert.equal(textAt("project", "one", "a"), "読み込んだあとに直す", "読み直したあとは、そのファイルの上に書ける");
  assert.equal(modal(), null);
  await unmount();

  // 上書きする: 画面の中身で書く。次の保存は、書いたあとのハッシュで確かめる。
  await mount();
  outside("a", "外で直した2");
  await edit("上書きする中身");
  await waitSave();
  assert.ok(modal());
  await choose("この内容で上書きする");
  assert.equal(modal(), null);
  assert.equal(textAt("project", "one", "a"), "上書きする中身", "上書きすると、画面の中身で書く");
  await edit("上書きのあとに直す");
  await waitSave();
  assert.equal(textAt("project", "one", "a"), "上書きのあとに直す");
  assert.equal(modal(), null, "上書きのあとの保存は止まらない");
  await unmount();

  // 閉じる直前の書き切りが断られたら、次に開いたときに選ぶ画面を出す（断られた保存は残っている）。
  await mount();
  await edit("閉じる直前");
  outside("a", "外で直した3");
  await unmount();
  assert.equal(textAt("project", "one", "a"), "外で直した3", "閉じるときも上書きしない");
  root = createRoot(document.getElementById("root"));
  await render();
  await act(async () => { await settle(); await settle(); });
  assert.ok(modal(), "次に開いたときに選ぶ画面が出る");
  await choose("この内容で上書きする");
  await act(async () => { await settle(); await settle(); });
  assert.equal(textAt("project", "one", "a"), "閉じる直前", "閉じる直前の変更を選んで書ける");
  await unmount();

  // Then 自身がボードを書き換えた（改名・移動）あとは、取り直したハッシュで書く。外の変更と取り違えない。
  await mount(); await unmount();
  docs.get(key("project", "one", "a")).nodes.push(ref("r9", "素材/旧.png", "image"));
  root = createRoot(document.getElementById("root"));
  await render();
  const k = key("project", "one", "a");
  docs.get(k).nodes.find((node) => node.id === "r9").sourcePath = "素材/新.png";
  versions.set(k, (versions.get(k) ?? 0) + 1); // Rust の retarget_boards が書いた
  await emitPathChanges({ rootPath: "one", changes: [{ oldPath: "素材/旧.png", newPath: "素材/新.png" }] });
  await edit("改名のあとに直す");
  await waitSave();
  assert.equal(modal(), null, "改名・移動のあとは選ぶ画面を出さない");
  assert.equal(textAt("project", "one", "a"), "改名のあとに直す");
  assert.ok(calls.some((c) => c.command === "canvas_board_hash" && c.boardId === "a"), "書く前にハッシュを取り直す");
  await unmount();
}
console.log("PASS outside changes: a board changed outside is not written over; reload or overwrite; close-time refusals are asked next time; renames are not taken for outside changes");

// ---- BINDER 4-5（確認1の 7）: 作品を開くときの移行がボードを書き換えたら、開いているボードを読み直す ----
{
  await mount();
  const emitRewritten = async (payload) => { await act(async () => { for (const handler of globalThis.canvasTestListeners["then-canvas-boards-rewritten"] ?? []) handler({ payload }); await settle(); }); };
  const k = key("project", "one", "a");
  docs.get(k).nodes[0].text = "移行で書き換えた";
  versions.set(k, (versions.get(k) ?? 0) + 1); // Rust の migrate_copy_cards が書いた
  calls = [];
  await emitRewritten({ rootPath: "two", boardIds: ["a"] });
  assert.equal(shownText(), "A", "ほかの作品の知らせでは読み直さない");
  await emitRewritten({ rootPath: "one", boardIds: ["b"] });
  assert.equal(shownText(), "A", "開いていないボードの知らせでは読み直さない");
  await emitRewritten({ rootPath: "one", boardIds: ["a"] });
  assert.equal(shownText(), "移行で書き換えた", "開いているボードは読み直す");
  assert.equal(calls.some((c) => c.command === "save_canvas_board"), false, "読み直すときに古い中身を書かない");
  await edit("移行のあとに直す");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  assert.equal(textAt("project", "one", "a"), "移行のあとに直す", "読み直したあとの保存は外の変更と取り違えない");
  await unmount();
}
console.log("PASS boards rewritten: the open board is read again after the opening migration rewrote it");

// ---- BINDER 4-3（確認1の 4）: 中央の Canvas の「別ウィンドウで開く」 ----
{
  await mount();
  assert.equal(document.querySelector('[aria-label="別ウィンドウで開く"]'), null, "移す先がなければボタンを出さない");
  await unmount();
  const moved = [];
  extraProps = { onOpenInWindow: (boardId) => moved.push(boardId) };
  await mount();
  await select("B");
  await click('[aria-label="別ウィンドウで開く"]');
  assert.deepEqual(moved, ["b"], "今のボードを別ウィンドウへ移す");
  await unmount();
  extraProps = {};
}
console.log("PASS open in window: the centre Canvas hands its board to the window");
dom.window.close();
