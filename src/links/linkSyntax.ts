// BINDER 3-1: the two kinds of link written in a file, and how to rewrite them
// when what they point at is renamed or moved (docs/BINDER_LINK_INDEX_PLAN.md).
//
// - `@[[path]]` points at a file by its path from the work's folder, `/`
//   separated. It counts on every line of every file (the notes made by the
//   Plot and Idea migrations have them).
// - `[[name]]` points at a file by its name without the extension, as in
//   Obsidian. `[[name|shown]]` and `[[name#heading]]` point at the same file,
//   and `[[人物/汐見]]` adds the folders when two files share the name. It
//   counts on every line of a note (role "material"), on the `//` comment lines
//   of a manuscript (BINDER 3.2), and in the front matter of either.
//
// This is the one place the rules live; the editor (3-2) uses the same scan.
import { isSlashCommentLine } from "../editor/ast/documentAst";
import { parseFrontMatter } from "../utils/frontmatter";

export type LinkKind = "path" | "name";

export type FoundLink = {
  kind: LinkKind;
  /** What the link points at: the path, or the name (before any `|` or `#`). */
  target: string;
  /** Where `target` sits in the text, so a rewrite touches only it. */
  from: number;
  to: number;
};

const OPEN = "[[";
const CLOSE = "]]";

/** Front matter, as a character range of the full text (BOM included). */
function frontMatterEnd(text: string): number {
  const parts = parseFrontMatter(text);
  return parts.hasFrontMatter ? text.length - parts.body.length : 0;
}

/** Links of `text`, in order. `isNote` is the file's role (material = note). */
export function findLinks(text: string, isNote: boolean): FoundLink[] {
  const links: FoundLink[] = [];
  if (!text.includes(OPEN)) return links;
  const metadataEnd = frontMatterEnd(text);
  let lineStart = 0;
  let lineEnd = -1;
  let lineIsComment = false;
  let search = 0;
  while (true) {
    const open = text.indexOf(OPEN, search);
    if (open < 0) break;
    const innerStart = open + OPEN.length;
    const close = text.indexOf(CLOSE, innerStart);
    if (close < 0) break;
    const inner = text.slice(innerStart, close);
    // A link stays on one line and does not hold another opener.
    if (inner.includes("\n") || inner.includes(OPEN)) {
      search = innerStart;
      continue;
    }
    search = close + CLOSE.length;
    const isPath = open > 0 && text.charCodeAt(open - 1) === 64; /* @ */
    if (isPath) {
      if (inner.trim()) links.push({ kind: "path", target: inner, from: innerStart, to: close });
      continue;
    }
    if (!isNote && open >= metadataEnd) {
      if (open > lineEnd) {
        lineStart = text.lastIndexOf("\n", open - 1) + 1;
        const nextBreak = text.indexOf("\n", open);
        lineEnd = nextBreak < 0 ? text.length : nextBreak;
        lineIsComment = isSlashCommentLine(text.slice(lineStart, lineEnd).replace(/\r$/, ""));
      }
      if (!lineIsComment) continue;
    }
    const cut = inner.search(/[|#]/);
    const target = cut < 0 ? inner : inner.slice(0, cut);
    if (!target.trim()) continue;
    links.push({ kind: "name", target, from: innerStart, to: innerStart + target.length });
  }
  return links;
}

/** `text` with each link whose target `rewrite` answers replaced; other characters stay. */
export function rewriteLinks(
  text: string,
  isNote: boolean,
  rewrite: (link: FoundLink) => string | null,
): { text: string; count: number } {
  const links = findLinks(text, isNote);
  let out = "";
  let at = 0;
  let count = 0;
  for (const link of links) {
    const next = rewrite(link);
    if (next === null || next === link.target) continue;
    out += text.slice(at, link.from) + next;
    at = link.to;
    count += 1;
  }
  return count ? { text: out + text.slice(at), count } : { text, count: 0 };
}
