// BINDER 4-3（確認1の 2・4）: キャンバスはメイン画面の中央に出し、別ウィンドウは「別ウィンドウで開く」で移す。
// 同じボードを中央と別ウィンドウで同時に直さないよう、別ウィンドウが開いているあいだは中央に出さない。
// 移すときは、中央で待っている保存を書き切ってから別ウィンドウを開く（本物の保存の順番待ちで確かめる）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const load = async (path) => {
  const code = ts.transpileModule(await readFile(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
};
const place = await load("src/canvasWindowPlace.ts");
const { CanvasBoardSaveQueue } = await load("src/canvasBoardSaveQueue.ts");

// ---- メニューの「キャンバス」 ----
assert.equal(place.chooseCanvasMode({ windowOpen: true, hasCenterBoard: true }), "focus-window",
  "別ウィンドウが開いていれば、中央に出さずに別ウィンドウを前に出す");
assert.equal(place.chooseCanvasMode({ windowOpen: true, hasCenterBoard: false }), "focus-window");
assert.equal(place.chooseCanvasMode({ windowOpen: false, hasCenterBoard: true }), "resume-center",
  "中央に前のボードがあれば、そのまま戻る");
assert.equal(place.chooseCanvasMode({ windowOpen: false, hasCenterBoard: false }), "open-center");
console.log("PASS mode menu: the open window is brought forward instead of a second copy in the centre");

// ---- 別ウィンドウへ移す ----
const doc = (text) => ({ nodes: [{ id: "n", type: "text", text }], edges: [] });
const target = { scope: "project", rootPath: "/work", boardId: "a" };
function makeHost({ failBoards = false, failFiles = false } = {}) {
  const log = [];
  const written = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queue = new CanvasBoardSaveQueue(async (scope, rootPath, boardId, board) => {
    log.push("write-start");
    await gate;
    if (failBoards) throw new Error("document content conflict: 外で変更");
    written.push([boardId, board.nodes[0].text]);
    log.push("write-done");
  });
  // 中央のキャンバスが外れるときに、待っている保存を順番待ちへ渡す（CanvasWindowApp の外れるときの書き切り）。
  const host = {
    showBody: () => { log.push("body"); queue.enqueue(target, doc("移す直前")); void queue.flush().catch(() => {}); },
    afterUnmount: async () => { log.push("unmounted"); setTimeout(release, 20); },
    flushBoards: () => { log.push("flush-boards"); return queue.flush(); },
    flushFileWrites: async () => { log.push("flush-files"); if (failFiles) throw new Error("file"); },
    showCanvas: () => log.push("canvas"),
    forgetCenter: () => log.push("forget"),
    openWindow: async (boardId) => { log.push(`open:${boardId}`); },
  };
  return { host, log, written };
}

{
  const { host, log, written } = makeHost();
  assert.equal(await place.moveCanvasToWindow(host, "a"), true);
  assert.deepEqual(written, [["a", "移す直前"]], "中央で待っていた保存は書かれる");
  assert.ok(log.indexOf("write-done") < log.indexOf("open:a"), "書き切ってから別ウィンドウを開く");
  assert.deepEqual(log.filter((item) => !item.startsWith("write")),
    ["body", "unmounted", "flush-boards", "flush-files", "forget", "open:a"],
    "本文へ戻り、外れるのを待ち、ボードと書き戻しを書き切り、中央のボードを忘れてから開く");
}
{
  const { host, log, written } = makeHost({ failBoards: true });
  assert.equal(await place.moveCanvasToWindow(host, "a"), false);
  assert.deepEqual(written, []);
  assert.equal(log.some((item) => item.startsWith("open:")), false, "書けなければ別ウィンドウを開かない");
  assert.equal(log.includes("forget"), false, "中央のボードは忘れない");
  assert.equal(log.at(-1), "canvas", "中央へ戻して、開き直したキャンバスで選んでもらう");
}
{
  const { host, log } = makeHost({ failFiles: true });
  assert.equal(await place.moveCanvasToWindow(host, null), true, "書き戻しの失敗（外の変更など）は移すのを止めない");
  assert.equal(log.at(-1), "open:null");
}
console.log("PASS move to window: pending saves are written first; a refused board save keeps the Canvas in the centre");
