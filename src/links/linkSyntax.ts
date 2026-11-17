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
  /** The whole notation, `@` and brackets included, for drawing it (3-2). */
  fullFrom: number;
  fullTo: number;
};

const OPEN = "[[";
const CLOSE = "]]";

/** Front matter, as a character range of the full text (BOM included). */
function frontMatterEnd(text: string): number {
  const parts = parseFrontMatter(text);
  return parts.hasFrontMatter ? text.length - parts.body.length : 0;
}

/**
 * The links written between `from` and `to` of `text`, which hold no line
 * break. `names` says whether `[[name]]` counts there; `@[[path]]` always does.
 * Every reader of the rule goes through here, so it lives in one place.
 */
function scanLine(text: string, from: number, to: number, names: boolean, out: FoundLink[]): void {
  let search = from;
  while (search < to) {
    const open = text.indexOf(OPEN, search);
    if (open < 0 || open >= to) break;
    const innerStart = open + OPEN.length;
    const close = text.indexOf(CLOSE, innerStart);
    const inner = close < 0 || close > to ? null : text.slice(innerStart, close);
    // A link stays on one line and does not hold another opener.
    if (inner === null || inner.includes(OPEN)) {
      search = innerStart;
      continue;
    }
    search = close + CLOSE.length;
    const isPath = open > 0 && text.charCodeAt(open - 1) === 64; /* @ */
    const fullFrom = isPath ? open - 1 : open;
    const fullTo = close + CLOSE.length;
    if (isPath) {
      if (inner.trim()) out.push({ kind: "path", target: inner, from: innerStart, to: close, fullFrom, fullTo });
      continue;
    }
    if (!names) continue;
    const cut = inner.search(/[|#]/);
    const target = cut < 0 ? inner : inner.slice(0, cut);
    if (!target.trim()) continue;
    out.push({ kind: "name", target, from: innerStart, to: innerStart + target.length, fullFrom, fullTo });
  }
}

/**
 * Links of one line (no line break inside). `names` says whether `[[name]]`
 * counts on it: every line of a note, and the `//` lines of a manuscript.
 * The editor (3-2) draws links with this, so it reads exactly what the index
 * counts.
 */
export function findLinksInLine(line: string, names: boolean): FoundLink[] {
  const out: FoundLink[] = [];
  scanLine(line, 0, line.length, names, out);
  return out;
}

/** Links of `text`, in order. `isNote` is the file's role (material = note). */
export function findLinks(text: string, isNote: boolean): FoundLink[] {
  const links: FoundLink[] = [];
  if (!text.includes(OPEN)) return links;
  const metadataEnd = frontMatterEnd(text);
  // Only the lines that hold an opener are cut out and classified.
  let search = 0;
  while (search <= text.length) {
    const open = text.indexOf(OPEN, search);
    if (open < 0) break;
    const lineStart = open === 0 ? 0 : text.lastIndexOf("\n", open - 1) + 1;
    const nextBreak = text.indexOf("\n", open);
    const lineEnd = nextBreak < 0 ? text.length : nextBreak;
    const names = isNote || lineStart < metadataEnd ||
      isSlashCommentLine(text.slice(lineStart, lineEnd).replace(/\r$/, ""));
    scanLine(text, lineStart, lineEnd, names, links);
    search = lineEnd + 1;
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
