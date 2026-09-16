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
    node("parent", 0, 0, { threadCollapsed: true }),
    node("child", 30, 120, { threadParentId: "parent", threadOrder: 1 }),
    node("orphan", 400, 0, { threadParentId: "missing", threadOrder: 2 }),
  ]),
);
assert.equal(normalized.nodes[1].threadParentId, "parent");
assert.equal(normalized.nodes[2].threadParentId, undefined);
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
  node("root", 0, 0),
  node("moving", 500, 500),
  node("leaf", 520, 620, { threadParentId: "moving" }),
]);
const attached = threads.attachNodeToThread(tree, "moving", "root");
const attachedMoving = attached.nodes.find((item) => item.id === "moving");
const attachedLeaf = attached.nodes.find((item) => item.id === "leaf");
assert.equal(attachedMoving.threadParentId, "root");
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
  threads.findThreadDropTarget([near, far], node("moving", 210, 0), new Set(["moving"])),
  "near",
);
const collapsedNodes = [
  node("parent", -1000, 0, { threadCollapsed: true }),
  node("hidden", 230, 0, { threadParentId: "parent" }),
  far,
];
assert.equal(
  threads.findThreadDropTarget(collapsedNodes, node("moving", 210, 0), new Set(["moving"])),
  null,
  "collapsed descendants are not drop targets",
);

console.log("PASS v0.6.4 canvas: thread normalization, attach/detach, cycles, collapse, proximity");
