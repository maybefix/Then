import { findCommentLineRanges } from "../editor/ast/documentAst";
import type { DocumentAst } from "../editor/ast/types";
import { parseFrontMatter, updateMarkdownBody } from "../utils/frontmatter";
import { replaceTextSearchMatches, type TextSearchOptions } from "./textSearch";

export type EditorFindMatch = {
  id: string;
  from: number;
  to: number;
  line: number;
  column: number;
  excerpt: string;
};

export function replaceLiteralMatches(
  text: string,
  rawQuery: string,
  replacement: string,
  includeComments: boolean,
): { text: string; count: number } {
  const query = rawQuery.trim();
  if (!query) return { text, count: 0 };

  if (!includeComments) {
    const comments = findCommentLineRanges(text);
    if (comments.length > 0) {
      // コメント行の間の区間ごとに置換し、コメント行はそのまま残す。
      const chunks: string[] = [];
      let count = 0;
      let cursor = 0;
      for (const range of [...comments, { from: text.length, to: text.length }]) {
        const segment = replaceLiteralMatches(text.slice(cursor, range.from), rawQuery, replacement, true);
        chunks.push(segment.text, text.slice(range.from, range.to));
        count += segment.count;
        cursor = range.to;
      }
      return { text: count > 0 ? chunks.join("") : text, count };
    }
  }

  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const chunks: string[] = [];
  let from = 0;
  let count = 0;

  while (from <= text.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    chunks.push(text.slice(from, index), replacement);
    from = index + query.length;
    count += 1;
  }

  if (count === 0) return { text, count: 0 };
  chunks.push(text.slice(from));
  return { text: chunks.join(""), count };
}

export function replaceMarkdownBodyMatches(
  markdown: string,
  query: string,
  replacement: string,
  options: TextSearchOptions,
): { markdown: string; count: number; error: string | null } {
  const frontMatter = parseFrontMatter(markdown);
  const result = replaceTextSearchMatches(
    frontMatter.body,
    query,
    replacement,
    options,
    options.includeComments ? [] : findCommentLineRanges(frontMatter.body),
  );
  if (result.count === 0) return { markdown, count: 0, error: result.error };
  return {
    markdown: updateMarkdownBody(markdown, result.text),
    count: result.count,
    error: null,
  };
}

export function collectEditorFindMatches(
  documentAst: DocumentAst,
  rawQuery: string,
  includeComments: boolean,
  maxResults = 500,
): EditorFindMatch[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  const matches: EditorFindMatch[] = [];

  for (const block of documentAst.blocks) {
    if (!includeComments && block.kind === "comment") continue;
    const source = block.source;
    const normalizedSource = source.toLocaleLowerCase();
    let from = 0;
    let matchIndex = 0;

    while (from <= normalizedSource.length) {
      const index = normalizedSource.indexOf(normalizedQuery, from);
      if (index < 0) break;

      const absoluteFrom = block.from + index;
      matches.push({
        id: `editor-find:${block.lineIndex}:${index}:${matchIndex}:${normalizedQuery}`,
        from: absoluteFrom,
        to: absoluteFrom + query.length,
        line: block.lineIndex + 1,
        column: index + 1,
        excerpt: source,
      });

      if (matches.length >= maxResults) return matches;
      from = index + Math.max(1, normalizedQuery.length);
      matchIndex += 1;
    }
  }

  return matches;
}
