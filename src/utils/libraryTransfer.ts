import type { CanvasNode, JsonCanvasDocument } from "../canvasTypes";
import { normalizedReferenceKey } from "../ideaReferenceModel";
import type { IdeaThreadItemLink, PlotCard, ReferenceFileInfo } from "../types";

/**
 * Moving or copying an item between a library root and one of its projects
 * must not leave it pointing at reference files of the scope it came from.
 * Its references are either copied along (paths rewritten to the copies) or
 * dropped. These helpers find and rewrite those references.
 */
export type ReferenceRewrite = {
  /** normalizedReferenceKey(old path) -> the copy in the destination */
  copied: Map<string, ReferenceFileInfo>;
  /** References to remove (by normalizedReferenceKey). */
  dropped: Set<string>;
};

const PLOT_REFERENCE_PATTERN = /@\[\[([^\]]+)\]\]/g;

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function uniqueReferencePaths(paths: string[]): string[] {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const key = normalizedReferenceKey(path);
    if (!seen.has(key)) seen.set(key, path);
  }
  return [...seen.values()];
}

export function plotCardReferencePaths(cards: PlotCard[]): string[] {
  return uniqueReferencePaths(
    cards.flatMap((card) => [...card.body.matchAll(PLOT_REFERENCE_PATTERN)].map((match) => match[1])),
  );
}

/** A dropped reference keeps its file name as plain text so the sentence still reads. */
export function rewritePlotCard(card: PlotCard, rewrite: ReferenceRewrite): PlotCard {
  const body = card.body.replace(PLOT_REFERENCE_PATTERN, (whole, path: string) => {
    const key = normalizedReferenceKey(path);
    const copy = rewrite.copied.get(key);
    if (copy) return `@[[${copy.sourcePath.replace(/\\/g, "/")}]]`;
    if (rewrite.dropped.has(key)) return baseName(path);
    return whole;
  });
  return body === card.body ? card : { ...card, body };
}

export function threadItemReferencePaths(items: IdeaThreadItemLink[]): string[] {
  return uniqueReferencePaths(
    items.flatMap((item) => (item.sourceType === "reference" ? [item.sourcePath] : [])),
  );
}

export function rewriteThreadItems(
  items: IdeaThreadItemLink[],
  rewrite: ReferenceRewrite,
): IdeaThreadItemLink[] {
  return items.flatMap<IdeaThreadItemLink>((item) => {
    if (item.sourceType !== "reference") return [item];
    const key = normalizedReferenceKey(item.sourcePath);
    const copy = rewrite.copied.get(key);
    if (copy) return [{ ...item, sourcePath: copy.sourcePath }];
    return rewrite.dropped.has(key) ? [] : [item];
  });
}

export function boardReferencePaths(board: JsonCanvasDocument): string[] {
  return uniqueReferencePaths(
    board.nodes.flatMap((node) => (node.type === "reference" ? [node.sourcePath] : [])),
  );
}

/** Dropped reference nodes go away together with the edges attached to them. */
export function rewriteBoard(board: JsonCanvasDocument, rewrite: ReferenceRewrite): JsonCanvasDocument {
  const removed = new Set<string>();
  const nodes = board.nodes.flatMap<CanvasNode>((node) => {
    if (node.type !== "reference") return [node];
    const key = normalizedReferenceKey(node.sourcePath);
    const copy = rewrite.copied.get(key);
    if (copy) {
      return [{
        ...node,
        scope: "project" as const,
        sourcePath: copy.sourcePath,
        name: copy.name,
        kind: copy.kind,
        size: copy.size,
        imported: copy.imported,
      }];
    }
    if (rewrite.dropped.has(key)) {
      removed.add(node.id);
      return [];
    }
    return [node];
  });
  const edges = board.edges.filter((edge) => !removed.has(edge.fromNode) && !removed.has(edge.toNode));
  return { ...board, nodes, edges };
}
