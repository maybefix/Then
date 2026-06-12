import { Decoration } from "@codemirror/view";
import type { EditorSelection, Range, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { selectionTouchesLineRange } from "../util/selection.js";
import { children } from "../util/tree.js";
import { pushRevealableMark } from "./shared.js";

const LINE_CLASS = Decoration.line({ class: "sd-blockquote" });

export function decorateBlockquote(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  let pos = node.from;
  while (pos <= node.to) {
    const line = doc.lineAt(pos);
    ranges.push(LINE_CLASS.range(line.from));
    if (line.to >= node.to) break;
    pos = line.to + 1;
  }

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  for (const child of children(node)) {
    if (child.name !== "QuoteMark") continue;
    // Cover the "> " prefix (mark plus the trailing space) when present.
    const next = doc.sliceString(child.to, child.to + 1);
    const markTo = next === " " ? child.to + 1 : child.to;
    pushRevealableMark(ranges, atomicRanges, revealed, child.from, markTo);
  }
}
