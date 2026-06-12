import { Decoration } from "@codemirror/view";
import type { EditorSelection, Range, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { HeadingLevel } from "../types.js";
import { selectionTouchesLineRange } from "../util/selection.js";
import { pushRevealableMark } from "./shared.js";

const LINE_CLASSES: Record<HeadingLevel, Decoration> = {
  1: Decoration.line({ class: "sd-h1" }),
  2: Decoration.line({ class: "sd-h2" }),
  3: Decoration.line({ class: "sd-h3" }),
  4: Decoration.line({ class: "sd-h4" }),
  5: Decoration.line({ class: "sd-h5" }),
  6: Decoration.line({ class: "sd-h6" }),
};

export function decorateHeading(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  // plugin.ts gates by HEADING_NODES so node.name is ATXHeading1..6 by construction.
  const level = Number.parseInt(node.name.slice(-1), 10) as HeadingLevel;
  const lineClass = LINE_CLASSES[level];

  const line = doc.lineAt(node.from);
  ranges.push(lineClass.range(line.from));

  const headerMark = node.firstChild;
  /* v8 ignore next -- ATXHeading always has a HeaderMark first child by Lezer's grammar. */
  if (headerMark?.name !== "HeaderMark") return;
  const markTo = Math.min(headerMark.to + 1, node.to);
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  pushRevealableMark(ranges, atomicRanges, revealed, headerMark.from, markTo);
}

export function decorateSetextHeading(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  const level = Number.parseInt(node.name.slice(-1), 10) as 1 | 2;
  const lineClass = LINE_CLASSES[level];
  const line = doc.lineAt(node.from);
  ranges.push(lineClass.range(line.from));

  const headerMark = node.lastChild;
  if (headerMark?.name !== "HeaderMark") return;
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  pushRevealableMark(ranges, atomicRanges, revealed, headerMark.from, headerMark.to);
}
