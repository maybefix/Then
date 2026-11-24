import type { CanvasHeadingLocation } from "./canvasTypes";
import { flattenOutline } from "./editor/ast/documentAst";
import type { DocumentAst } from "./editor/ast/types";

export function resolveCanvasHeading(ast: DocumentAst, location: CanvasHeadingLocation) {
  const outline = flattenOutline(ast.outline);
  const byBlock = outline.filter((item) => item.blockId === location.blockId);
  const byTitle = outline.filter((item) => item.title === location.title);
  const item = byBlock.find((candidate) => candidate.line === location.line)
    ?? (byBlock.length === 1 ? byBlock[0] : undefined)
    ?? (byTitle.length === 1 ? byTitle[0] : undefined);
  if (!item) return null;

  const start = item.line - 1;
  const next = ast.blocks.findIndex((block, index) =>
    index > start && block.kind === "heading" && block.level <= item.level,
  );
  return {
    item,
    text: ast.blocks.slice(start + 1, next < 0 ? undefined : next)
      .map((block) => block.source)
      .join("\n")
      .trim(),
  };
}
