import assert from "node:assert/strict";
import { build } from "esbuild";

// 「この順で原稿を作る」（BINDER 4-4）の並べ替えの一覧の中身（src/canvasToManuscript.ts の captureCardOrder・
// moveOrderedCard・toggleOrderedCard）。もとは中間稿の並べ方で、4-4b で test:v063-draft から移した。

const bundled = await build({
  stdin: { contents: 'export * from "./src/canvasToManuscript.ts";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "esm", platform: "neutral", write: false,
});
const { captureCardOrder, moveOrderedCard, toggleOrderedCard, captureManuscriptCards, orderedManuscriptCards } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const node = (id, text, y) => ({ id, text, y, x: 0, type: "text", width: 100, height: 100 });
const board = { nodes: [node("b", "二番目\n段落", 0), node("a", "最初", 100), node("empty", "  ", 200),
  { id: "group", type: "group", label: "これは本文ではない", x: 0, y: 0 }],
  edges: [{ id: "edge", fromNode: "a", toNode: "b", connector: "arrow" }], then: { updatedAt: 10, name: "試験ボード" } };
const original = JSON.stringify(board);
const capture = captureCardOrder(board, 100);
assert.deepEqual(capture.order, ["a", "b", "empty"], "矢印の順。グループは入らない");
assert.deepEqual(capture.cards, [{ id: "b", text: "二番目\n段落" }, { id: "a", text: "最初" }, { id: "empty", text: "  " }]);
assert.equal(capture.capturedAt, 100);
assert.equal(capture.boardUpdatedAt, 10);
assert.equal(JSON.stringify(board), original, "ボードは変えない");
const reordered = moveOrderedCard(capture, "a", "b");
assert.deepEqual(reordered.order, ["b", "a", "empty"]);
assert.deepEqual(capture.order, ["a", "b", "empty"], "元の一覧は変えない");
assert.equal(moveOrderedCard(capture, "a", "missing"), capture, "知らない ID なら何もしない");
const excluded = toggleOrderedCard(capture, "b");
assert.deepEqual(excluded.excluded, ["b"]);
assert.deepEqual(toggleOrderedCard(excluded, "b").excluded, []);
assert.equal(toggleOrderedCard(capture, "missing"), capture);
for (const connector of ["line", "dashed", "bidirectional"]) {
  assert.deepEqual(captureCardOrder({ ...board, edges: [{ ...board.edges[0], connector }] }).order, ["b", "a", "empty"],
    `${connector}: 矢印でない線は順序に使わない（上 → 左）`);
}
const graph = { ...board, nodes: [node("c", "C", 0), node("b", "B", 1), node("a", "A", 2), node("d", "D", 3)],
  edges: [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["a", "b"]].map(([fromNode, toNode]) => ({ fromNode, toNode })) };
const order = captureCardOrder(graph).order;
assert.equal(order[0], "a"); assert.equal(order.at(-1), "d");
const cyclic = captureCardOrder({ ...graph, edges: [...graph.edges, { fromNode: "d", toNode: "a" }] });
assert.equal(new Set(cyclic.order).size, 4, "輪になっていても、どのカードも1回だけ");
assert.equal(captureCardOrder({ nodes: [], edges: [] }).order.length, 0);

// 4-4 の初期の並び: 選んだカードだけを並べ、名前を付けられない空のカードは最初から除外。
const picked = captureManuscriptCards(board, [board.nodes[0], board.nodes[1], board.nodes[2]]);
assert.deepEqual(picked.order, ["a", "b", "empty"]);
assert.deepEqual(picked.excluded, ["empty"]);
assert.deepEqual(orderedManuscriptCards(moveOrderedCard(picked, "b", "a"), board.nodes).map((card) => card.id), ["b", "a"]);
console.log("PASS card order: arrows, ties, branches, merges, duplicate edges, cycles, empty cards, board untouched, move, exclude");
