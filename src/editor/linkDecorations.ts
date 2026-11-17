// BINDER 3-2: the `[[ ]]` links as the editor draws and opens them
// (docs/BINDER_LINK_SYNTAX_PLAN.md).
//
// The rule for which links count lives in src/links/linkSyntax.ts, the same one
// the index reads with; this module only cuts one line into spans and asks the
// index where each span goes. Nothing here touches the text of a file.
import type { LinkIndex } from "../links/linkIndex";
import { type LinkKind, findLinksInLine } from "../links/linkSyntax";
import { isSlashCommentLine } from "./ast/documentAst";

/** Where a link sits in one line. `from`/`to` cover the whole notation. */
export type LinkSpan = {
  kind: LinkKind;
  /** What it points at: the name before any `|` or `#`, or the path. */
  target: string;
  from: number;
  to: number;
  /** Just `target`, so rewriting it leaves `|shown` and `#heading` alone. */
  targetFrom: number;
  targetTo: number;
};

/**
 * - `one`: it goes to exactly one file.
 * - `none`: nothing of that name is there (a deleted file keeps its links, 3-1).
 * - `many`: more than one file fits, so which one is not decided (3-1 の決定4).
 * - `unknown`: the index has not been read yet, so links are drawn as usual.
 */
export type LinkDestinationState = "one" | "none" | "many" | "unknown";

/** What the editor needs to draw links, as of one state of the index. */
export type LinkLookup = {
  /** The open file's role: a note counts `[[name]]` on every line. */
  isNote: boolean;
  destination: (kind: LinkKind, target: string) => LinkDestinationState;
};

/**
 * Whether `[[name]]` counts on this line: every line of a note, and the `//`
 * lines of a manuscript. Read from the line as written, exactly as the index
 * does (so a `//` line inside a code block counts in both, and a `\//` line
 * counts in neither).
 */
export function namesCountedOn(isNote: boolean, source: string): boolean {
  return isNote || isSlashCommentLine(source);
}

/** The links to draw in one line. `names` comes from `namesCountedOn`. */
export function linkSpansInLine(source: string, names: boolean): LinkSpan[] {
  if (!source.includes("[[")) return [];
  return findLinksInLine(source, names).map((link) => ({
    kind: link.kind,
    target: link.target,
    from: link.fullFrom,
    to: link.fullTo,
    targetFrom: link.from,
    targetTo: link.to,
  }));
}

/** Where one link goes, by the files that exist now. */
export function linkDestination(
  index: LinkIndex | null,
  link: { kind: LinkKind; target: string },
): LinkDestinationState {
  if (!index) return "unknown";
  const found = index.candidatesFor(link);
  return found.length === 0 ? "none" : found.length === 1 ? "one" : "many";
}

/**
 * What pressing a link does: open `path`, or ask which of `choices` is meant
 * (more than one file fits). Both empty: nothing happens.
 */
export function linkOpenTarget(
  index: LinkIndex | null,
  link: { kind: LinkKind; target: string },
): { path: string | null; choices: Array<{ path: string; name: string }> } {
  if (!index) return { path: null, choices: [] };
  const found = index.candidatesFor(link);
  if (found.length === 1) return { path: found[0], choices: [] };
  if (found.length < 2) return { path: null, choices: [] };
  return {
    path: null,
    choices: found.map((path) => ({ path, name: index.shortestName(path) ?? path })),
  };
}

/** The notes to offer for `query`, by the name itself or by its last part. */
export function suggestNames(index: LinkIndex | null, query: string): Array<{ name: string; path: string }> {
  if (!index) return [];
  const key = query.trim().toLocaleLowerCase();
  const names = index.noteNames();
  if (!key) return names;
  return names.filter((item) => {
    const name = item.name.toLocaleLowerCase();
    if (name.startsWith(key)) return true;
    const last = name.slice(name.lastIndexOf("/") + 1);
    return last.startsWith(key);
  });
}

/**
 * The part of `line` the caret is typing a name into: right after `[[`, with no
 * `]]`, `|`, `#` or another `[[` in between, and not after `@`. Null when the
 * caret is not inside a name.
 */
export function suggestQueryAt(
  line: string,
  caret: number,
): { from: number; to: number; query: string } | null {
  if (caret < 2 || caret > line.length) return null;
  const before = line.slice(0, caret);
  const open = before.lastIndexOf("[[");
  if (open < 0) return null;
  if (open > 0 && line.charCodeAt(open - 1) === 64 /* @ */) return null;
  const query = before.slice(open + 2);
  if (/[[\]|#]/.test(query)) return null;
  return { from: open + 2, to: caret, query };
}

/**
 * The lookup the editor holds, with each name asked of the index only once.
 * Thrown away and made again whenever the index changes (its `version`).
 */
export function createLinkLookup(index: LinkIndex | null, isNote: boolean): LinkLookup {
  const known = new Map<string, LinkDestinationState>();
  return {
    isNote,
    destination: (kind, target) => {
      const key = `${kind}:${target}`;
      const found = known.get(key);
      if (found) return found;
      const state = linkDestination(index, { kind, target });
      known.set(key, state);
      return state;
    },
  };
}
