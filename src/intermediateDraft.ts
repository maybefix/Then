import type { CanvasScope, CanvasTextNode, JsonCanvasDocument } from "./canvasTypes";

export type DraftBoard = { boardId: string; scope: CanvasScope; rootPath: string | null };
export type DraftCanvasContext = DraftBoard & {
  board: JsonCanvasDocument;
  selectedIds: string[];
};
export type DraftCapture = {
  capturedAt: number;
  boardUpdatedAt: number;
  cards: { id: string; text: string }[];
  order: string[];
  excluded?: string[];
};
export type DraftVersion = DraftCapture & {
  version: number;
  createdAt: number;
  updatedAt: number;
  text: string;
};
export type DraftHistory = {
  schemaVersion: 1;
  boardId: string;
  revision: number;
  versions: DraftVersion[];
};

export function draftBoardKey(board: DraftBoard): string {
  return JSON.stringify([board.scope, board.scope === "global" ? null : board.rootPath, board.boardId]);
}

/** Stable topological order. Cycles are broken at the first spatially ordered card. */
export function captureDraft(board: JsonCanvasDocument, now = Date.now()): DraftCapture {
  const cards = board.nodes.filter((node): node is CanvasTextNode => node.type === "text")
    .slice().sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const remaining = new Set(cards.map((card) => card.id));
  const incoming = new Map(cards.map((card) => [card.id, new Set<string>()]));
  const outgoing = new Map(cards.map((card) => [card.id, new Set<string>()]));
  for (const edge of board.edges) {
    if ((edge.connector && edge.connector !== "arrow") || edge.fromNode === edge.toNode) continue;
    if (!remaining.has(edge.fromNode) || !remaining.has(edge.toNode)) continue;
    incoming.get(edge.toNode)!.add(edge.fromNode);
    outgoing.get(edge.fromNode)!.add(edge.toNode);
  }
  const order: string[] = [];
  while (remaining.size) {
    const id = cards.find((card) => remaining.has(card.id) && incoming.get(card.id)!.size === 0)?.id
      ?? cards.find((card) => remaining.has(card.id))!.id;
    order.push(id);
    remaining.delete(id);
    for (const target of outgoing.get(id)!) incoming.get(target)!.delete(id);
  }
  return {
    capturedAt: now, boardUpdatedAt: board.then?.updatedAt ?? now,
    cards: cards.map(({ id, text }) => ({ id, text })), order, excluded: [],
  };
}

export function generateDraft(capture: DraftCapture, version: number, now = Date.now()): DraftVersion {
  const byId = new Map(capture.cards.map((card) => [card.id, card.text]));
  const excluded = new Set(capture.excluded ?? []);
  if (new Set(capture.order).size !== capture.cards.length || capture.order.length !== capture.cards.length
    || capture.order.some((id) => !byId.has(id)) || excluded.size !== (capture.excluded?.length ?? 0)
    || [...excluded].some((id) => !byId.has(id))) throw new Error("カード順が不正です");
  return {
    ...capture, cards: capture.cards.map((card) => ({ ...card })), order: [...capture.order],
    excluded: [...excluded],
    version, createdAt: now, updatedAt: now,
    text: capture.order.filter((id) => !excluded.has(id)).map((id) => byId.get(id)!)
      .filter((text) => text.trim()).join("\n\n"),
  };
}

export function moveDraftCard(capture: DraftCapture, id: string, target: string): DraftCapture {
  const order = [...capture.order];
  const from = order.indexOf(id), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return capture;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { ...capture, order };
}

export function toggleDraftCard(capture: DraftCapture, id: string): DraftCapture {
  if (!capture.cards.some((card) => card.id === id)) return capture;
  const excluded = new Set(capture.excluded ?? []);
  if (excluded.has(id)) excluded.delete(id); else excluded.add(id);
  return { ...capture, excluded: [...excluded] };
}
