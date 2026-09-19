import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const toUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function compile(path) {
  return toUrl(
    ts.transpileModule(await readFile(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ES2020,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
  );
}

const canvasTypes = await import(await compile("src/canvasTypes.ts"));
const threads = await import(await compile("src/canvasThreads.ts"));
const resize = await import(await compile("src/canvasResize.ts"));

const node = (id, x, y, extra = {}) => ({
  id,
  type: "text",
  x,
  y,
  width: 200,
  height: 100,
  text: id,
  ...extra,
});
const document = (nodes) => ({ nodes, edges: [] });

const normalized = canvasTypes.normalizeCanvasDocument(
  document([
    node("parent", 0, 0, { title: "親カード", color: "4", threadCollapsed: true }),
    node("child", 30, 120, { threadParentId: "parent", threadOrder: 1 }),
    node("orphan", 400, 0, { threadParentId: "missing", threadOrder: 2 }),
  ]),
);
assert.equal(normalized.nodes[1].threadParentId, "parent");
assert.equal(normalized.nodes[2].threadParentId, undefined);
assert.equal(normalized.nodes[0].title, "親カード");
assert.equal(normalized.nodes[0].color, "4");
assert.deepEqual([...threads.hiddenThreadNodeIds(normalized.nodes)], ["child"]);

const cyclic = canvasTypes.normalizeCanvasDocument(
  document([
    node("a", 0, 0, { threadParentId: "b" }),
    node("b", 0, 120, { threadParentId: "a" }),
  ]),
);
assert.equal(cyclic.nodes[0].threadParentId, undefined);
assert.equal(cyclic.nodes[1].threadParentId, undefined);

const tree = document([
  node("root", 0, 0, { threadCollapsed: true }),
  node("moving", 500, 500),
  node("leaf", 520, 620, { threadParentId: "moving" }),
]);
const attached = threads.attachNodeToThread(tree, "moving", "root");
const attachedMoving = attached.nodes.find((item) => item.id === "moving");
const attachedLeaf = attached.nodes.find((item) => item.id === "leaf");
assert.equal(attachedMoving.threadParentId, "root");
assert.equal(attached.nodes.find((item) => item.id === "root").threadCollapsed, false);
assert.deepEqual(
  [attachedMoving.x, attachedMoving.y],
  [threads.THREAD_INDENT, 100 + threads.THREAD_GAP],
);
assert.deepEqual(
  [attachedLeaf.x - attachedMoving.x, attachedLeaf.y - attachedMoving.y],
  [20, 120],
  "descendants move with the attached card",
);
const reattached = threads.attachNodeToThread(attached, "moving", "root");
const reattachedMoving = reattached.nodes.find((item) => item.id === "moving");
assert.deepEqual(
  [reattachedMoving.x, reattachedMoving.y],
  [attachedMoving.x, attachedMoving.y],
  "reattaching to the same parent must not drift downward",
);
const detached = threads.detachNodeFromThread(attached, "moving");
assert.equal(detached.nodes.find((item) => item.id === "moving").threadParentId, undefined);
assert.equal(
  threads.attachNodeToThread(attached, "root", "leaf"),
  attached,
  "a card cannot be attached below its descendant",
);

const near = node("near", 230, 0);
const far = node("far", 1000, 0);
assert.equal(
  threads.findThreadDropTarget(
    [near, far],
    node("moving", 0, 0),
    new Set(["moving"]),
    { x: 240, y: 50 },
  ),
  "near",
  "the target card body acts as the drop area",
);
assert.equal(
  threads.findThreadDropTarget(
    [near],
    node("moving", 0, 0),
    new Set(["moving"]),
    { x: 205, y: 50 },
    20,
  ),
  null,
  "a nearby card does not attach until the pointer enters the drop area",
);
assert.equal(
  threads.findThreadDropTarget(
    [near],
    node("moving", 0, 0),
    new Set(["moving"]),
    { x: 215, y: 50 },
    20,
  ),
  "near",
  "the small outer margin makes deliberate drops forgiving",
);
const collapsedNodes = [
  node("parent", -1000, 0, { threadCollapsed: true }),
  node("hidden", 230, 0, { threadParentId: "parent" }),
  far,
];
assert.equal(
  threads.findThreadDropTarget(
    collapsedNodes,
    node("moving", 210, 0),
    new Set(["moving"]),
    { x: 240, y: 50 },
  ),
  null,
  "collapsed descendants are not drop targets",
);

const draggedThread = [
  node("parent", 0, 0),
  node("child", 40, 140, { threadParentId: "parent", threadOrder: 1 }),
];
assert.equal(
  threads.shouldDetachFromThread(draggedThread, "child", { x: 150, y: 180 }),
  false,
  "small movement within the list region keeps the card attached",
);
assert.equal(
  threads.shouldDetachFromThread(draggedThread, "child", { x: 380, y: 180 }),
  true,
  "dragging clearly sideways out of the list detaches the card",
);
assert.equal(
  threads.shouldDetachFromThread(draggedThread, "child", { x: 150, y: 420 }),
  true,
  "dragging clearly below the list detaches the card",
);

const originalRect = { x: 100, y: 80, width: 240, height: 160 };
assert.deepEqual(
  resize.resizeCanvasRect(originalRect, "nw", 20, 30, 150, 90),
  { x: 120, y: 110, width: 220, height: 130 },
  "north-west resize keeps the south-east corner fixed",
);
assert.deepEqual(
  resize.resizeCanvasRect(originalRect, "ne", 30, 20, 150, 90),
  { x: 100, y: 100, width: 270, height: 140 },
  "north-east resize keeps the south-west corner fixed",
);
assert.deepEqual(
  resize.resizeCanvasRect(originalRect, "sw", -20, 30, 150, 90),
  { x: 80, y: 80, width: 260, height: 190 },
  "south-west resize keeps the north-east corner fixed",
);
assert.deepEqual(
  resize.resizeCanvasRect(originalRect, "se", 30, 40, 150, 90),
  { x: 100, y: 80, width: 270, height: 200 },
  "south-east resize keeps the north-west corner fixed",
);
assert.deepEqual(
  resize.resizeCanvasRect(originalRect, "nw", 500, 500, 150, 90),
  { x: 190, y: 150, width: 150, height: 90 },
  "minimum size stops north-west edges without flipping the card",
);

console.log("PASS v0.6.4 canvas: thread drop zones, detach threshold, collapse, four-corner resize");
