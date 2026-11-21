// Canvas のボードを読み書きする層（src/canvasBoardStore.ts）を実際に動かす回帰テスト。
// Tauri の中では、どの命令をどの引数で呼ぶか。ブラウザで動かすときは、localStorage の
// ボード・並び順・ゴミ箱（4-4b からはボードだけ。中間稿はもう一緒に動かさない）がどう変わるか。BINDER 4-1 で CanvasWindowApp.tsx から移した。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div></div>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function compile(path, replacements = {}) {
  let source = ts.transpileModule(await readFile(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  for (const [key, value] of Object.entries(replacements)) source = source.replaceAll(`"${key}"`, `"${value}"`);
  return url(source);
}

const store = await import(await compile("src/canvasBoardStore.ts", {
  "@tauri-apps/api/core": url("export const invoke = (...args) => globalThis.storeTestInvoke(...args);"),
  "./canvasTypes": await compile("src/canvasTypes.ts"),
  "./canvasBoardSaveQueue": await compile("src/canvasBoardSaveQueue.ts"),
  "./canvasFileWriteQueue": await compile("src/canvasFileWriteQueue.ts"),
}));

const board = (name, updatedAt, nodes = 0) => ({
  nodes: Array.from({ length: nodes }, (_, index) => ({ id: `${name}-${index}`, type: "text", text: name, x: 0, y: 0, width: 300, height: 200 })),
  edges: [],
  then: { version: 1, name, scope: "project", createdAt: 1, updatedAt },
});

// ---- Tauri の中: 命令の名前と引数 ----
let events = [];
globalThis.storeTestEvents = events;
window.__TAURI_INTERNALS__ = {};
assert.equal(store.isTauriRuntime(), true);
const answers = {
  list_canvas_boards: [{ id: "a" }],
  create_canvas_board: { id: "new" },
  load_canvas_board: { nodes: [], edges: [] },
  list_trashed_canvas_boards: [{ trashId: "t" }],
  restore_canvas_board: { id: "back" },
};
globalThis.storeTestInvoke = async (command, args) => {
  events.push([command, structuredClone(args)]);
  return answers[command];
};
const doc = board("A", 5, 1);
assert.deepEqual(await store.listBoards("project", "one"), [{ id: "a" }]);
assert.deepEqual(await store.createBoard("project", "one", "新しい"), { id: "new" });
assert.deepEqual(await store.loadBoard("project", "one", "a"), { nodes: [], edges: [] });
assert.equal(await store.saveBoard("project", "one", "a", doc), undefined);
assert.equal(await store.reorderBoards("project", "one", ["b", "a"]), undefined);
assert.equal(await store.trashBoard("project", "one", "a"), undefined);
assert.deepEqual(await store.listTrashedBoards("project", "one"), [{ trashId: "t" }]);
assert.deepEqual(await store.restoreTrashedBoard("project", "one", "t"), { id: "back" });
store.canvasBoardSaveQueue.enqueue({ scope: "project", rootPath: "two", boardId: "q" }, doc);
await store.canvasBoardSaveQueue.flush();
assert.deepEqual(events, [
  ["list_canvas_boards", { scope: "project", rootPath: "one" }],
  ["create_canvas_board", { scope: "project", rootPath: "one", name: "新しい" }],
  ["load_canvas_board", { scope: "project", rootPath: "one", boardId: "a" }],
  ["save_canvas_board", { scope: "project", rootPath: "one", boardId: "a", board: doc, expectedHash: null }],
  ["reorder_canvas_boards", { scope: "project", rootPath: "one", boardIds: ["b", "a"] }],
  ["trash_canvas_board", { scope: "project", rootPath: "one", boardId: "a" }],
  ["list_trashed_canvas_boards", { scope: "project", rootPath: "one" }],
  ["restore_canvas_board", { scope: "project", rootPath: "one", trashId: "t" }],
  ["save_canvas_board", { scope: "project", rootPath: "two", boardId: "q", board: doc, expectedHash: null }],
]);
assert.equal(localStorage.length, 0, "Tauri の中では localStorage に書かない");
console.log("PASS tauri: each store function sends its command with the same arguments; the queue writes with save_canvas_board");

// ---- ブラウザで動かすとき: localStorage ----
delete window.__TAURI_INTERNALS__;
assert.equal(store.isTauriRuntime(), false);
events = []; globalThis.storeTestEvents = events;
globalThis.storeTestInvoke = async (command) => { throw new Error(`invoke in browser: ${command}`); };
let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;
const KEY = "then.canvas-board.project.one";
const boardsIn = (key = KEY) => JSON.parse(localStorage.getItem(key) ?? "{}");
const orderIn = () => JSON.parse(localStorage.getItem(`${KEY}.order`) ?? "null");
const trashIn = () => JSON.parse(localStorage.getItem(`${KEY}.trash`) ?? "{}");

const first = await store.createBoard("project", "one", "一つ目");
assert.equal(first.id, `idea-board-${now.toString(36)}`);
assert.deepEqual(first, { id: first.id, name: "一つ目", path: first.id, scope: "project", updatedAt: now, nodeCount: 0, edgeCount: 0 });
now += 10;
const second = await store.createBoard("project", "one", "二つ目");
now += 10;
await store.saveBoard("project", "one", "c", board("三つ目", 500, 2));
await store.saveBoard("project", "one", "d", board("四つ目", 2_000_000));
await store.saveBoard("project", "two", "c", board("別の作品", 1));
assert.deepEqual(Object.keys(boardsIn()), [first.id, second.id, "c", "d"]);
assert.deepEqual(Object.keys(boardsIn("then.canvas-board.project.two")), ["c"], "作品ごとにキーが分かれる");
assert.equal(localStorage.getItem("then.canvas-board.project.unbound"), null);
await store.saveBoard("project", null, "x", board("作品なし", 1));
assert.deepEqual(Object.keys(boardsIn("then.canvas-board.project.unbound")), ["x"], "作品がなければ unbound");

const names = async () => (await store.listBoards("project", "one")).map((item) => item.name);
assert.deepEqual(await names(), ["四つ目", "二つ目", "一つ目", "三つ目"], "並び順がなければ、直した時刻の新しい順");
const loaded = await store.loadBoard("project", "one", "c");
assert.equal(loaded.nodes.length, 2);
assert.equal(loaded.then.name, "三つ目");
const missing = await store.loadBoard("project", "one", "none");
assert.deepEqual([missing.nodes, missing.edges, missing.then.name, missing.then.scope], [[], [], "Idea Board", "project"],
  "ないボードを読むと空のボード（手順書の癖8）");

await store.reorderBoards("project", "one", ["c", first.id]);
assert.deepEqual(orderIn(), ["c", first.id]);
assert.deepEqual(await names(), ["三つ目", "一つ目", "四つ目", "二つ目"], "並び順にあるものが先、ないものは直した時刻の新しい順");
const summary = (await store.listBoards("project", "one"))[0];
assert.deepEqual(summary, { id: "c", name: "三つ目", path: "c", scope: "project", updatedAt: 500, nodeCount: 2, edgeCount: 0 });

// 中間稿（4-4b でなくなった）の写しは、もうゴミ箱へ入れも戻しもしない。
localStorage.setItem("then.draft.old", JSON.stringify({ boardId: "c", versions: [{ text: "稿" }] }));
now = 3_000_000;
await store.trashBoard("project", "one", "c");
assert.deepEqual(events, [], "ゴミ箱へ入れる前に、ほかの処理を呼ばない");
assert.equal(boardsIn().c, undefined);
assert.deepEqual(orderIn(), [first.id], "ゴミ箱へ入れたボードは並び順から外れる");
assert.notEqual(localStorage.getItem("then.draft.old"), null, "ボードと関係のないキーには触らない");
assert.deepEqual(Object.keys(trashIn()), [`${now}--c`]);
assert.deepEqual(Object.keys(trashIn()[`${now}--c`]).sort(), ["board", "boardId", "deletedAt"], "ゴミ箱の項目はボードだけ");
now = 3_000_100;
await store.trashBoard("project", "one", "d");
await assert.rejects(store.trashBoard("project", "one", "none"), /canvas board does not exist/);

const trashed = await store.listTrashedBoards("project", "one");
assert.deepEqual(trashed.map((item) => [item.trashId, item.boardId, item.name, item.deletedAt, item.nodeCount]), [
  ["3000100--d", "d", "四つ目", 3_000_100, 0],
  ["3000000--c", "c", "三つ目", 3_000_000, 2],
], "消した時刻の新しい順");

// 同じ ID のボードがあれば -2、-3 と付け直して戻す。並び順の最後に付く。
await store.saveBoard("project", "one", "c", board("後から作った c", 1));
await store.saveBoard("project", "one", "c-2", board("後から作った c-2", 1));
const restored = await store.restoreTrashedBoard("project", "one", "3000000--c");
assert.equal(restored.id, "c-3");
assert.equal(restored.name, "三つ目");
assert.equal(boardsIn()["c-3"].then.name, "三つ目");
assert.equal(boardsIn().c.then.name, "後から作った c", "同じ ID のボードは上書きしない");
assert.deepEqual(Object.keys(localStorage).filter((key) => key.startsWith("then.draft.")), ["then.draft.old"], "戻しても中間稿は作らない");
assert.deepEqual(Object.keys(trashIn()), ["3000100--d"]);
assert.equal(orderIn().at(-1), "c-3");
assert.equal(new Set(orderIn()).size, orderIn().length);
await assert.rejects(store.restoreTrashedBoard("project", "one", "3000000--c"), /trashed canvas board does not exist/);
await store.saveBoard("project", "one", "d", board("後から作った d", 1));
const restoredD = await store.restoreTrashedBoard("project", "one", "3000100--d");
assert.equal(restoredD.id, "d-2", "同じ ID が1つだけなら -2");
assert.equal(boardsIn().d.then.name, "後から作った d");
now = 4_000_000;
await store.trashBoard("project", "one", second.id);
const restoredSecond = await store.restoreTrashedBoard("project", "one", `4000000--${second.id}`);
assert.equal(restoredSecond.id, second.id, "空いていれば元の ID で戻す");
assert.equal(boardsIn()[second.id].then.name, "二つ目");

// 順番待ちの実体も、ブラウザでは localStorage に書く。
store.canvasBoardSaveQueue.enqueue({ scope: "project", rootPath: "one", boardId: first.id }, board("順番待ちから", 7));
await store.canvasBoardSaveQueue.flush();
assert.equal(boardsIn()[first.id].then.name, "順番待ちから");

assert.equal(store.boardName(null), "Idea Board");
assert.equal(store.boardName(board("  ", 1)), "Idea Board");
assert.equal(store.boardName(board(" 名前 ", 1)), "名前");
Date.now = realNow;
console.log("PASS browser: create, list order, load (missing → empty), save per work, reorder, trash (board only), trashed list, restore with renamed id, queue, boardName");
dom.window.close();
