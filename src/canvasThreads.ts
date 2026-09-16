import type { CanvasNode, CanvasTextNode, JsonCanvasDocument } from "./canvasTypes";

export const THREAD_DROP_DISTANCE = 64;
export const THREAD_INDENT = 28;
export const THREAD_GAP = 16;

function isTextNode(node: CanvasNode): node is CanvasTextNode {
  return node.type === "text";
}

export function collectThreadDescendantIds(nodes: CanvasNode[], parentId: string): Set<string> {
  const descendants = new Set<string>();
  let frontier = [parentId];
  while (frontier.length > 0) {
    const parents = new Set(frontier);
    const children = nodes
      .filter(
        (node): node is CanvasTextNode =>
          isTextNode(node) && Boolean(node.threadParentId) && parents.has(node.threadParentId!),
      )
      .map((node) => node.id)
      .filter((id) => !descendants.has(id));
    children.forEach((id) => descendants.add(id));
    frontier = children;
  }
  return descendants;
}

export function hiddenThreadNodeIds(nodes: CanvasNode[]): Set<string> {
  const textNodes = new Map(
    nodes.filter(isTextNode).map((node) => [node.id, node] as const),
  );
  const hidden = new Set<string>();
  textNodes.forEach((node) => {
    const visited = new Set<string>([node.id]);
    let parentId = node.threadParentId;
    while (parentId) {
      const parent = textNodes.get(parentId);
      if (!parent || visited.has(parent.id)) break;
      if (parent.threadCollapsed) {
        hidden.add(node.id);
        break;
      }
      visited.add(parent.id);
      parentId = parent.threadParentId;
    }
  });
  return hidden;
}

function rectGap(left: CanvasNode, right: CanvasNode): number {
  const horizontal = Math.max(
    0,
    Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width),
  );
  const vertical = Math.max(
    0,
    Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height),
  );
  return Math.hypot(horizontal, vertical);
}

function centerDistance(left: CanvasNode, right: CanvasNode): number {
  return Math.hypot(
    left.x + left.width / 2 - (right.x + right.width / 2),
    left.y + left.height / 2 - (right.y + right.height / 2),
  );
}

export function findThreadDropTarget(
  nodes: CanvasNode[],
  movingNode: CanvasTextNode,
  movingIds: Set<string>,
  maxDistance = THREAD_DROP_DISTANCE,
): string | null {
  const descendants = collectThreadDescendantIds(nodes, movingNode.id);
  const hidden = hiddenThreadNodeIds(nodes);
  const candidates = nodes
    .filter(
      (node): node is CanvasTextNode =>
        isTextNode(node) &&
        !movingIds.has(node.id) &&
        !descendants.has(node.id) &&
        !hidden.has(node.id) &&
        rectGap(movingNode, node) <= maxDistance,
    )
    .map((node) => ({
      node,
      gap: rectGap(movingNode, node),
      center: centerDistance(movingNode, node),
    }))
    .sort((left, right) => left.gap - right.gap || left.center - right.center);
  return candidates[0]?.node.id ?? null;
}

function threadInsertionPoint(
  nodes: CanvasNode[],
  parent: CanvasTextNode,
  excludedIds: Set<string>,
): { x: number; y: number } {
  const descendants = collectThreadDescendantIds(nodes, parent.id);
  const related = nodes.filter(
    (node) => descendants.has(node.id) && !excludedIds.has(node.id),
  );
  const bottom = related.reduce(
    (value, node) => Math.max(value, node.y + node.height),
    parent.y + parent.height,
  );
  return { x: parent.x + THREAD_INDENT, y: bottom + THREAD_GAP };
}

export function attachNodeToThread(
  document: JsonCanvasDocument,
  nodeId: string,
  parentId: string,
): JsonCanvasDocument {
  const node = document.nodes.find((item): item is CanvasTextNode => item.id === nodeId && isTextNode(item));
  const parent = document.nodes.find(
    (item): item is CanvasTextNode => item.id === parentId && isTextNode(item),
  );
  if (!node || !parent || node.id === parent.id) return document;
  if (collectThreadDescendantIds(document.nodes, node.id).has(parent.id)) return document;

  const descendants = collectThreadDescendantIds(document.nodes, node.id);
  const movingIds = new Set([node.id, ...descendants]);
  const insertion = threadInsertionPoint(document.nodes, parent, movingIds);
  const dx = insertion.x - node.x;
  const dy = insertion.y - node.y;
  const nextOrder = document.nodes
    .filter(
      (item): item is CanvasTextNode =>
        isTextNode(item) && item.threadParentId === parent.id && item.id !== node.id,
    )
    .reduce((value, item) => Math.max(value, item.threadOrder ?? 0), 0) + 1;

  return {
    ...document,
    nodes: document.nodes.map((item) => {
      if (item.id === node.id && isTextNode(item)) {
        return {
          ...item,
          x: insertion.x,
          y: insertion.y,
          threadParentId: parent.id,
          threadOrder: nextOrder,
        };
      }
      if (item.id === parent.id && isTextNode(item) && item.threadCollapsed) {
        return { ...item, threadCollapsed: false };
      }
      return descendants.has(item.id)
        ? { ...item, x: item.x + dx, y: item.y + dy }
        : item;
    }),
  };
}

export function detachNodeFromThread(
  document: JsonCanvasDocument,
  nodeId: string,
): JsonCanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId && isTextNode(node)
        ? { ...node, threadParentId: undefined, threadOrder: undefined }
        : node,
    ),
  };
}
