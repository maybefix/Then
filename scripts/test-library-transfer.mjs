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
const {
  boardReferencePaths,
  rewriteBoard,
  rewriteThreadItems,
  threadItemReferencePaths,
} = await import(moduleUrl);

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

const items = [
  { sourceType: "idea", fragmentId: "f1" },
  { id: "r1", sourceType: "reference", sourcePath: "資料\\map.png", createdAt: 1 },
  { id: "r2", sourceType: "reference", sourcePath: "資料/memo.md", createdAt: 1 },
];
assert.deepEqual(threadItemReferencePaths(items), ["資料\\map.png", "資料/memo.md"]);
assert.deepEqual(rewriteThreadItems(items, rewrite), [
  items[0],
  { ...items[1], sourcePath: copiedMap.sourcePath },
]);

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

console.log("library transfer tests passed");
