import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/utils/libraryTransfer.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
// Idea のスレッドの移動・コピー（threadItemReferencePaths・rewriteThreadItems）は、BINDER 2-4 で Idea を投稿と
// ノートへ移したので消した。ボードの資料の書き換えは Canvas のボードの移動・コピーが使う。
const { boardReferencePaths, rewriteBoard, boardFilePaths, fileCardsToTextCards } = await import(moduleUrl);

const copiedMap = {
  scope: "project",
  sourcePath: ".then/references/imports/map (2).png",
  name: "map (2).png",
  kind: "image",
  size: 10,
  imported: true,
};
const rewrite = {
  copied: new Map([["資料/map.png", copiedMap]]),
  dropped: new Set(["資料/memo.md"]),
};


const board = {
  nodes: [
    { id: "t", type: "text", x: 0, y: 0, width: 1, height: 1, text: "x" },
    { id: "m", type: "reference", x: 0, y: 0, width: 1, height: 1, scope: "project", sourcePath: "資料/map.png", name: "map.png", kind: "image" },
    { id: "d", type: "reference", x: 0, y: 0, width: 1, height: 1, scope: "project", sourcePath: "資料/memo.md", name: "memo.md", kind: "markdown" },
  ],
  edges: [
    { id: "e1", fromNode: "t", toNode: "m" },
    { id: "e2", fromNode: "t", toNode: "d" },
  ],
};
assert.deepEqual(boardReferencePaths(board), ["資料/map.png", "資料/memo.md"]);
const rewritten = rewriteBoard(board, rewrite);
assert.deepEqual(rewritten.nodes.map((node) => node.id), ["t", "m"]);
assert.equal(rewritten.nodes[1].sourcePath, copiedMap.sourcePath);
assert.equal(rewritten.nodes[1].name, "map (2).png");
assert.deepEqual(rewritten.edges.map((edge) => edge.id), ["e1"], "edges of dropped nodes go too");

// BINDER 4-2: file cards go as text cards holding what they showed; their edges stay.
const withFiles = {
  nodes: [
    { id: "n", type: "file", file: "素材/汐見.md", x: 1, y: 2, width: 300, height: 240, color: "3" },
    { id: "s", type: "file", file: "第一章/港.md", x: 3, y: 4, width: 300, height: 240 },
    { id: "gone", type: "file", file: "素材/消えた.md", x: 5, y: 6, width: 300, height: 240 },
  ],
  edges: [{ id: "e", fromNode: "n", toNode: "s" }],
};
assert.deepEqual(boardFilePaths(withFiles), ["素材/汐見.md", "第一章/港.md", "素材/消えた.md"]);
const asText = fileCardsToTextCards(withFiles, new Map([
  ["素材/汐見.md", { title: "汐見", text: "本文" }],
  ["第一章/港.md", { title: "港", text: "概要" }],
]));
assert.deepEqual(asText.nodes, [
  { id: "n", type: "text", x: 1, y: 2, width: 300, height: 240, title: "汐見", text: "本文", color: "3" },
  { id: "s", type: "text", x: 3, y: 4, width: 300, height: 240, title: "港", text: "概要", color: undefined },
  { id: "gone", type: "text", x: 5, y: 6, width: 300, height: 240, title: "消えた", text: "", color: undefined },
]);
assert.deepEqual(asText.edges, withFiles.edges);

console.log("library transfer tests passed");
