import { findCommentLineRanges, normalizeText } from "../editor/ast/documentAst";
import type { DocumentAst } from "../editor/ast/types";
import { parseFrontMatter, updateMarkdownBody } from "../utils/frontmatter";
import { compileTextSearchPattern, findTextSearchEdits, replaceTextSearchMatches, type TextSearchOptions } from "./textSearch";

export type EditorFindMatch = {
  id: string;
  from: number;
  to: number;
  line: number;
  column: number;
  excerpt: string;
};

/** 検索バーの探し方。検索サイドバーの既定（文字どおり・大文字小文字を区別しない）と同じ。 */
const EDITOR_FIND_OPTIONS: TextSearchOptions = { useRegex: false, matchCase: false };

export function replaceLiteralMatches(
  text: string,
  query: string,
  replacement: string,
  includeComments: boolean,
): { text: string; count: number } {
  const result = replaceTextSearchMatches(
    text,
    query,
    replacement,
    EDITOR_FIND_OPTIONS,
    includeComments ? [] : findCommentLineRanges(text),
  );
  return { text: result.text, count: result.count };
}

export function replaceMarkdownBodyMatches(
  markdown: string,
  query: string,
  replacement: string,
  options: TextSearchOptions,
): { markdown: string; count: number; error: string | null } {
  const { body } = parseFrontMatter(markdown);
  const searchText = normalizeText(body);
  const { edits, error } = findTextSearchEdits(
    searchText,
    query,
    replacement,
    options,
    options.includeComments ? [] : findCommentLineRanges(searchText),
  );
  if (edits.length === 0) return { markdown, count: 0, error };

  // Search uses the editor's LF offsets. Apply edits to the original body so
  // untouched bytes, including mixed line endings, survive the replacement.
  const crlfOffsets = Array.from(body.matchAll(/\r\n/g), (match) => match.index);
  let removed = 0;
  const originalOffset = (offset: number) => {
    while (removed < crlfOffsets.length && crlfOffsets[removed] - removed < offset) removed += 1;
    return offset + removed;
  };
  const chunks: string[] = [];
  let cursor = 0;
  for (const { from, to, insert } of edits) {
    chunks.push(body.slice(cursor, originalOffset(from)), insert);
    cursor = originalOffset(to);
  }
  chunks.push(body.slice(cursor));
  return {
    markdown: updateMarkdownBody(markdown, chunks.join("")),
    count: edits.length,
    error: null,
  };
}

export function collectEditorFindMatches(
  documentAst: DocumentAst,
  query: string,
  includeComments: boolean,
  maxResults = 500,
): EditorFindMatch[] {
  const { pattern } = compileTextSearchPattern(query, EDITOR_FIND_OPTIONS);
  if (!pattern) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  const matches: EditorFindMatch[] = [];

  for (const block of documentAst.blocks) {
    if (!includeComments && block.kind === "comment") continue;
    const source = block.source;
    let matchIndex = 0;

    // 位置は元の本文の上で数える（小文字にすると長さが変わる文字があっても、ずれない）。
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const absoluteFrom = block.from + index;
      matches.push({
        id: `editor-find:${block.lineIndex}:${index}:${matchIndex}:${normalizedQuery}`,
        from: absoluteFrom,
        to: absoluteFrom + match[0].length,
        line: block.lineIndex + 1,
        column: index + 1,
        excerpt: source,
      });

      if (matches.length >= maxResults) return matches;
      matchIndex += 1;
    }
  }

  return matches;
}
