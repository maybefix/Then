import type { DocumentAst, InlineMarkup, LineNode } from "../editor/ast/types";
import { sliceWithoutSlashEscape } from "../editor/ast/documentAst";
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
  if (markup.type === "code") return [{ kind: "code", text: markup.contentText }];
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
  if (markup.type === "image") {
    return [{ kind: "image", text: "", alt: markup.contentText, src: markup.imageSrc ?? "", url: null }];
  }
  return [{ kind: "bold", text: markup.contentText }];
}

function blockToExportBlock(block: LineNode & { kind: Exclude<ExportBlock["kind"], "code"> }): ExportBlock {
  const source = block.source;
  const inlines: ExportInline[] = [];
  let cursor = contentStartForBlock(block);

  for (const markup of block.inlineMarkups) {
    const from = Math.max(cursor, markup.fullRange.offset);
    const to = markup.fullRange.offset + markup.fullRange.length;
    if (from > cursor) inlines.push({ kind: "text", text: sliceWithoutSlashEscape(source, cursor, from) });
    inlines.push(...markupToInlines(markup));
    cursor = Math.max(cursor, to);
  }

  if (cursor < source.length) inlines.push({ kind: "text", text: sliceWithoutSlashEscape(source, cursor) });

  const visible = inlines.filter((inline) => inline.kind !== "text" || inline.text.trim() !== "");
  const isFigure = block.kind === "paragraph" && visible.length === 1 && visible[0].kind === "image";
  return {
    kind: isFigure ? "figure" : block.kind,
    level: block.level,
    align: block.align ?? (block.jitsuki ? "end" : "start"),
    inlines,
  };
}

/**
 * Comments are dropped; each fenced code block becomes one "code" block whose
 * lines are kept verbatim (fence lines are not printed).
 */
function toExportBlocks(lines: readonly LineNode[]): ExportBlock[] {
  const blocks: ExportBlock[] = [];
  let code: ExportBlock | null = null;
  for (const line of lines) {
    if (line.kind === "comment") continue;
    if (line.kind === "code") {
      if (line.codeFence) {
        if (code && code.inlines.length > 0) blocks.push(code);
        code = code ? null : { kind: "code", level: 0, align: "start", inlines: [] };
        continue;
      }
      if (!code) continue;
      if (code.inlines.length > 0) code.inlines.push({ kind: "break", text: "" });
      code.inlines.push({ kind: "text", text: line.source });
      continue;
    }
    blocks.push(blockToExportBlock(line as LineNode & { kind: Exclude<ExportBlock["kind"], "code"> }));
  }
  return blocks;
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
    blocks: toExportBlocks(ast.blocks),
  };
}
