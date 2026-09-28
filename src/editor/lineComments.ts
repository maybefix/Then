import { detectCommentLines, isSlashCommentLine } from "./ast/documentAst";

export type LineCommentEdit = {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
};

const LEADING_SPACE = /^[ \t　]*/;
const HTML_CLOSER = /-->[ \t　]*$/;

type LineSpan = { start: number; text: string };

function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (const line of text.split("\n")) {
    spans.push({ start, text: line });
    start += line.length + 1;
  }
  return spans;
}

function lineIndexAt(spans: readonly LineSpan[], offset: number): number {
  let low = 0;
  let high = spans.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (spans[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

function uncommentSlash(line: string): string {
  const indent = LEADING_SPACE.exec(line)?.[0] ?? "";
  return indent + line.slice(indent.length + 2).replace(/^ /, "");
}

function commentSlash(line: string): string {
  const indent = LEADING_SPACE.exec(line)?.[0] ?? "";
  return `${indent}//${line.slice(indent.length)}`;
}

function unwrapHtmlOpener(line: string): string {
  const indent = LEADING_SPACE.exec(line)?.[0] ?? "";
  return indent + line.slice(indent.length + 4).replace(/^ /, "");
}

function unwrapHtmlCloser(line: string): string {
  return line.replace(/ ?-->[ \t　]*$/, "");
}

/**
 * Ctrl+/ (docs/COMMENT_OUT_SPEC.md §1.3). Toggles `//` on every line the
 * selection touches; lines inside `<!-- -->` are only ever unwrapped.
 * Returns null when there is nothing to change.
 */
export function toggleLineComments(
  text: string,
  selectionFrom: number,
  selectionTo: number,
): LineCommentEdit | null {
  const spans = lineSpans(text);
  const comments = detectCommentLines(spans.map((span) => span.text));
  const from = Math.min(selectionFrom, selectionTo);
  const to = Math.max(selectionFrom, selectionTo);
  let first = lineIndexAt(spans, from);
  // A selection ending at the start of a line does not include that line.
  let last = lineIndexAt(spans, to > from && text[to - 1] === "\n" ? to - 1 : to);

  const html = comments.slice(first, last + 1);
  let replaced: string[];

  if (html.every((kind) => kind === "html")) {
    // Unwrap every HTML comment group the selection touches. Within a group
    // only its last line ends with `-->`, so that marks the group boundaries.
    while (first > 0 && comments[first - 1] === "html" && !HTML_CLOSER.test(spans[first - 1].text)) first -= 1;
    while (last < spans.length - 1 && comments[last + 1] === "html" && !HTML_CLOSER.test(spans[last].text)) last += 1;
    replaced = spans.slice(first, last + 1).map((span, offset, group) => {
      let line = span.text;
      if (offset === 0 || HTML_CLOSER.test(group[offset - 1].text)) line = unwrapHtmlOpener(line);
      if (HTML_CLOSER.test(span.text)) line = unwrapHtmlCloser(line);
      return line;
    });
  } else {
    const targets = spans.slice(first, last + 1);
    const commentable = targets.filter((_span, offset) => html[offset] !== "html");
    const allSlash = commentable.every((span) => isSlashCommentLine(span.text));
    const skipBlank = targets.length > 1 && commentable.some((span) => span.text.trim() !== "");
    replaced = targets.map((span, offset) => {
      if (html[offset] === "html") return span.text;
      if (allSlash) return uncommentSlash(span.text);
      if (isSlashCommentLine(span.text)) return span.text;
      if (skipBlank && span.text.trim() === "") return span.text;
      return commentSlash(span.text);
    });
  }

  const rangeFrom = spans[first].start;
  const lastSpan = spans[last];
  const rangeTo = lastSpan.start + lastSpan.text.length;
  const original = text.slice(rangeFrom, rangeTo);
  const insert = replaced.join("\n");
  if (insert === original) return null;

  if (from === to) {
    // Keep a collapsed caret on the same character of its line.
    const caretLine = lineIndexAt(spans, from) - first;
    const before = spans[first + caretLine];
    const after = replaced[caretLine];
    const column = from - before.start;
    const indent = LEADING_SPACE.exec(before.text)?.[0].length ?? 0;
    const delta = column >= indent ? after.length - before.text.length : 0;
    const lineStart = rangeFrom + replaced.slice(0, caretLine).reduce((sum, line) => sum + line.length + 1, 0);
    const caret = Math.max(lineStart, Math.min(lineStart + after.length, from - before.start + lineStart + delta));
    return { from: rangeFrom, to: rangeTo, insert, selectionFrom: caret, selectionTo: caret };
  }
  return { from: rangeFrom, to: rangeTo, insert, selectionFrom: rangeFrom, selectionTo: rangeFrom + insert.length };
}
