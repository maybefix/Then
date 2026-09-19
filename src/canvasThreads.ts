import type { CanvasNode, CanvasTextNode, JsonCanvasDocument } from "./canvasTypes";

/** カード本体の外側にも少しだけ許容する、スレッド投入領域の余白。 */
export const THREAD_DROP_MARGIN = 20;
/** スレッドから意図せず外れないための、リスト領域外側の解除余白。 */
export const THREAD_DETACH_MARGIN = 72;
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

function pointDistanceFromCenter(node: CanvasNode, point: { x: number; y: number }): number {
  return Math.hypot(
    node.x + node.width / 2 - point.x,
    node.y + node.height / 2 - point.y,
  );
}

function containsPoint(
  node: CanvasNode,
  point: { x: number; y: number },
  margin: number,
): boolean {
  return (
    point.x >= node.x - margin &&
    point.x <= node.x + node.width + margin &&
    point.y >= node.y - margin &&
    point.y <= node.y + node.height + margin
  );
}

export function findThreadDropTarget(
  nodes: CanvasNode[],
  movingNode: CanvasTextNode,
  movingIds: Set<string>,
  dropPoint: { x: number; y: number },
  margin = THREAD_DROP_MARGIN,
): string | null {
  const descendants = collectThreadDescendantIds(nodes, movingNode.id);
  const hidden = hiddenThreadNodeIds(nodes);
  const candidates = nodes
    .map((node, index) => ({ node, index }))
    .filter(
      (entry): entry is { node: CanvasTextNode; index: number } =>
        isTextNode(entry.node) &&
        !movingIds.has(entry.node.id) &&
        !descendants.has(entry.node.id) &&
        !hidden.has(entry.node.id) &&
        containsPoint(entry.node, dropPoint, margin),
    )
    .map(({ node, index }) => ({
      node,
      index,
      distance: pointDistanceFromCenter(node, dropPoint),
    }))
    // 重なったカードでは、画面上で手前に描かれる後方の node を優先する。
    .sort((left, right) => right.index - left.index || left.distance - right.distance);
  return candidates[0]?.node.id ?? null;
}

/**
 * 現在の親スレッドの周辺を出たときだけ解除する。移動中の部分木は
 * 領域計算から除外し、ドラッグしたカード自身で解除範囲が広がらないようにする。
 */
export function shouldDetachFromThread(
  nodes: CanvasNode[],
  nodeId: string,
  releasePoint: { x: number; y: number },
  margin = THREAD_DETACH_MARGIN,
): boolean {
  const node = nodes.find(
    (item): item is CanvasTextNode => item.id === nodeId && isTextNode(item),
  );
  if (!node?.threadParentId) return false;
  const parent = nodes.find(
    (item): item is CanvasTextNode => item.id === node.threadParentId && isTextNode(item),
  );
  if (!parent) return true;

  const movingIds = new Set([node.id, ...collectThreadDescendantIds(nodes, node.id)]);
  const threadIds = new Set([parent.id, ...collectThreadDescendantIds(nodes, parent.id)]);
  const fixedThreadNodes = nodes.filter(
    (item) => threadIds.has(item.id) && !movingIds.has(item.id),
  );
  const left = Math.min(...fixedThreadNodes.map((item) => item.x));
  const right = Math.max(...fixedThreadNodes.map((item) => item.x + item.width));
  const top = Math.min(...fixedThreadNodes.map((item) => item.y));
  const bottom = Math.max(...fixedThreadNodes.map((item) => item.y + item.height));

  return !(
    releasePoint.x >= left - margin &&
    releasePoint.x <= right + margin &&
    releasePoint.y >= top - margin &&
    releasePoint.y <= bottom + node.height + THREAD_GAP + margin
  );
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
