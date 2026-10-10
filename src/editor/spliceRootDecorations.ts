import { DecorationSet, type Decoration } from "@tiptap/pm/view";
import type { DocumentLineDiff } from "./documentIndex";

type SourceLine = { source: string };
type RootTree = {
  local: readonly Decoration[];
  children: readonly (number | DecorationSet)[];
};
type CopyableDecoration = Decoration & { inline: boolean; widget: boolean; copy: (from: number, to: number) => Decoration };

/** Retain the immutable branches of content-equal prefix/suffix paragraphs.
 * This is the same flat root shape used by indexRootDecorations. The normal
 * input, full setContent and off-caret edits use the parser's validated line
 * alignment. Composition keeps the browser-owned DOM on its existing path.
 *
 * Calling DecorationSet.map across a paragraph boundary can gather its root
 * node decorations and build the tree quadratically. Splicing the root keeps
 * every untouched child branch by identity and only shifts its root offsets.
 * Unsupported library shapes return null for the caller's standard rebuild. */
export function spliceRootDecorations(
  set: DecorationSet,
  previous: readonly SourceLine[],
  next: readonly SourceLine[],
  diff: DocumentLineDiff,
): DecorationSet | null {
  const tree = set as unknown as RootTree;
  if (!Array.isArray(tree.local) || !Array.isArray(tree.children) || tree.children.length % 3 !== 0 ||
    tree.local.some(value => {
      const decoration = value as CopyableDecoration;
      return decoration.inline !== false || decoration.widget !== false || typeof decoration.copy !== "function";
    })) return null;
  let start = 0, removed = 0, added = 0;
  for (let i = 0; i < diff.from; i++) start += previous[i].source.length + 2;
  for (let i = diff.from; i < diff.toOld; i++) removed += previous[i].source.length + 2;
  for (let i = diff.from; i < diff.toNew; i++) added += next[i].source.length + 2;
  if (!removed && !added) return set;
  const end = start + removed, shift = added - removed;
  const local: Decoration[] = [];
  for (const value of tree.local) {
    if (value.to <= start) local.push(value);
    else if (value.from >= end) local.push(shift
      ? (value as CopyableDecoration).copy(value.from + shift, value.to + shift) : value);
  }
  const children: (number | DecorationSet)[] = [];
  for (let i = 0; i < tree.children.length; i += 3) {
    const from = tree.children[i], to = tree.children[i+1], child = tree.children[i+2];
    if (typeof from !== "number" || typeof to !== "number" || !(child instanceof DecorationSet)) return null;
    if (to <= start) children.push(from, to, child);
    else if (from >= end) children.push(from + shift, to + shift, child);
  }
  // The runtime constructor is internal; validate its output before exposing
  // it. Never change the original tree or retain a prototype chain of sets.
  const RootSet = DecorationSet as unknown as new (local: Decoration[], children: (number | DecorationSet)[]) => DecorationSet;
  const result = new RootSet(local, children);
  const resultTree = result as unknown as RootTree;
  // Empty arrays are replaced with the library's shared empty arrays.
  const sameLocal = local.length ? resultTree.local === local
    : Array.isArray(resultTree.local) && resultTree.local.length === 0;
  const sameChildren = children.length ? resultTree.children === children
    : Array.isArray(resultTree.children) && resultTree.children.length === 0;
  return result instanceof DecorationSet && sameLocal && sameChildren
    ? !local.length && !children.length ? DecorationSet.empty : result
    : null;
}
