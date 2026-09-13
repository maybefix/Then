import { createDocumentAst } from "../../editor/ast/documentAst";
import type { DocumentAst } from "../../editor/ast/types";
import type { ExportSourceFile, LoadedExportSource } from "../types";
import type { SubmissionDocument, SubmissionInline, SubmissionSection } from "./types";

export function createSubmissionSection(ast: Readonly<DocumentAst>, source: ExportSourceFile): SubmissionSection {
  return {
    source: { ...source },
    lines: ast.blocks.map((block) => {
      const inlines: SubmissionInline[] = [];
      let cursor = block.kind === "heading" || block.jitsuki ? block.marker.length : 0;
      for (const markup of block.inlineMarkups) {
        if (markup.fullRange.offset < cursor) continue;
        if (markup.fullRange.offset > cursor) {
          inlines.push({ kind: "text", text: block.source.slice(cursor, markup.fullRange.offset) });
        }
        inlines.push({ kind: "markup", markup: structuredClone(markup) });
        cursor = markup.fullRange.offset + markup.fullRange.length;
      }
      if (cursor < block.source.length) inlines.push({ kind: "text", text: block.source.slice(cursor) });
      return { sourceLine: block.lineIndex + 1, kind: block.kind, level: block.level, inlines };
    }),
  };
}

/** Input content must already have frontmatter removed by the export host. */
export function createSubmissionDocument(sources: readonly LoadedExportSource[], title = ""): SubmissionDocument {
  const selected = sources.filter((source) => source.enabled).sort((a, b) => a.order - b.order);
  if (!selected.length) throw new Error("出力対象の本文ファイルを1つ以上選択してください");
  return { schemaVersion: 1, title, sections: selected.map(({ content, ...source }) =>
    createSubmissionSection(createDocumentAst({ text: content, name: source.displayName, path: source.path }), source)) };
}
