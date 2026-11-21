import type { CanvasNode, JsonCanvasDocument } from "../canvasTypes";
import { normalizedReferenceKey } from "../ideaReferenceModel";
import type { ReferenceFileInfo } from "../types";

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

export function uniqueReferencePaths(paths: string[]): string[] {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const key = normalizedReferenceKey(path);
    if (!seen.has(key)) seen.set(key, path);
  }
  return [...seen.values()];
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

/** The work's notes and manuscripts that the board's file cards point at (BINDER 4-2). */
export function boardFilePaths(board: JsonCanvasDocument): string[] {
  return uniqueReferencePaths(board.nodes.flatMap((node) => (node.type === "file" ? [node.file] : [])));
}

/**
 * The destination work has none of these notes or manuscripts, so each file
 * card goes as a text card holding what it showed: the title, and the note's
 * body or the manuscript's synopsis (BINDER 4-2 の確認1の 5). `shown` is keyed
 * by normalizedReferenceKey(path); a card whose file could not be read keeps
 * just its title.
 */
export function fileCardsToTextCards(
  board: JsonCanvasDocument,
  shown: Map<string, { title: string; text: string }>,
): JsonCanvasDocument {
  const nodes = board.nodes.map<CanvasNode>((node) => {
    if (node.type !== "file") return node;
    const card = shown.get(normalizedReferenceKey(node.file));
    const title = card?.title ?? node.file.split("/").pop()?.replace(/\.(md|txt)$/i, "") ?? node.file;
    return {
      id: node.id,
      type: "text",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      title,
      text: card?.text ?? "",
      color: node.color,
    };
  });
  return { ...board, nodes };
}
