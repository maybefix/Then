import { DecorationSet } from "@tiptap/pm/view";

const indexed = new WeakMap<DecorationSet, DecorationSet>();

/** ProseMirror scans root decorations and child branches for every paragraph.
 * With full-document formatting this is quadratic even for a caret move.
 * For roots without cross-paragraph inline decorations, forChild only returns
 * an existing child branch. Index those branches once, retaining the original
 * immutable set and all of its mapping/equality/decoration behavior.
 * Fall back to ProseMirror if the tree shape changes or inline spans occur. */
export function indexRootDecorations(set: DecorationSet): DecorationSet {
  const existing = indexed.get(set);
  if (existing) return existing;
  const tree = set as unknown as {
    local?: readonly { inline?: boolean }[];
    children?: readonly (number | DecorationSet)[];
  };
  if (!Array.isArray(tree.local) || !Array.isArray(tree.children) ||
    tree.local.some(decoration => decoration.inline !== false) || tree.children.length % 3 !== 0) return set;
  const children = new Map<number, DecorationSet>();
  for (let i = 0; i < tree.children.length; i += 3) {
    const offset = tree.children[i], end = tree.children[i + 1], child = tree.children[i + 2];
    if (typeof offset !== "number" || typeof end !== "number" || !(child instanceof DecorationSet)) return set;
    children.set(offset, child);
  }
  // Preserve instanceof DecorationSet, which ProseMirror's decoration groups
  // require. The base tree is never mutated; only this view has an override.
  const result: DecorationSet = Object.create(set);
  result.forChild = (offset, node) => node.isLeaf ? DecorationSet.empty : children.get(offset) ?? DecorationSet.empty;
  indexed.set(set, result);
  return result;
}
