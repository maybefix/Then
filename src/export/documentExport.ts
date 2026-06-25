import type { DocumentAst, InlineMarkup, LineNode } from "../editor/ast/types";
import {
  DEFAULT_EXPORT_PAGE,
  type ExportBlock,
  type ExportDocument,
  type ExportFontFamily,
  type ExportInline,
} from "./types";

function contentStartForBlock(block: LineNode): number {
  if (block.kind === "heading" || block.jitsuki) return block.marker.length;
  return 0;
}

function markupToInlines(markup: InlineMarkup): ExportInline[] {
  if (markup.type === "layoutAlign") return [];
  if (markup.type === "aozoraAnnotation") {
    return markup.contentText === "地付き"
      ? []
      : [{ kind: "text", text: markup.fullText }];
  }
  if (markup.type === "ruby") {
    if (markup.rubyMode === "mono" && markup.rubyItems?.length) {
      return markup.rubyItems.map((item) => ({
        kind: "ruby" as const,
        text: item.text,
        reading: item.reading,
        mode: "mono" as const,
      }));
    }
    return [{
      kind: "ruby",
      text: markup.contentText,
      reading: markup.rubyText ?? "",
      mode: "group",
    }];
  }
  if (markup.type === "emphasis") {
    return [{
      kind: "emphasis",
      text: markup.contentText,
      style: markup.emStyle ?? "auto",
    }];
  }
  if (markup.type === "tcy") return [{ kind: "tcy", text: markup.contentText }];
  return [{ kind: "bold", text: markup.contentText }];
}

function blockToExportBlock(block: LineNode): ExportBlock {
  const source = block.source;
  const inlines: ExportInline[] = [];
  let cursor = contentStartForBlock(block);

  for (const markup of block.inlineMarkups) {
    const from = Math.max(cursor, markup.fullRange.offset);
    const to = markup.fullRange.offset + markup.fullRange.length;
    if (from > cursor) inlines.push({ kind: "text", text: source.slice(cursor, from) });
    inlines.push(...markupToInlines(markup));
    cursor = Math.max(cursor, to);
  }

  if (cursor < source.length) inlines.push({ kind: "text", text: source.slice(cursor) });

  return {
    kind: block.kind,
    level: block.level,
    align: block.align ?? (block.jitsuki ? "end" : "start"),
    inlines,
  };
}

export function createExportDocument(
  ast: Readonly<DocumentAst>,
  fontFamily: ExportFontFamily,
): ExportDocument {
  return {
    schemaVersion: 1,
    sourceAstId: ast.id,
    sourceTextHash: ast.textHash,
    title: ast.name.replace(/\.(?:txt|md)$/i, ""),
    fontFamily,
    page: { ...DEFAULT_EXPORT_PAGE },
    blocks: ast.blocks.map(blockToExportBlock),
  };
}
