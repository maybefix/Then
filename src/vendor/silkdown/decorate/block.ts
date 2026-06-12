import { Decoration } from "@codemirror/view";
import type { EditorSelection, Range, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { selectionTouchesLineRange } from "../util/selection.js";
import { HIDE, pushAtomicRange, pushRevealableMark } from "./shared.js";

const HR_LINE = Decoration.line({ class: "sd-hr" });
const HR_LINE_RENDERED = Decoration.line({ class: "sd-hr sd-hr-rendered" });
const HTML_BLOCK_LINE = Decoration.line({ class: "sd-html-block" });

export function decorateHorizontalRule(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  const line = doc.lineAt(node.from);
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  if (revealed) {
    ranges.push(HR_LINE.range(line.from));
    return;
  }
  ranges.push(HR_LINE_RENDERED.range(line.from));
  pushAtomicRange(ranges, atomicRanges, HIDE, node.from, node.to);
}

export function decorateHtmlBlock(ranges: Range<Decoration>[], node: SyntaxNode, doc: Text): void {
  let pos = node.from;
  while (pos <= node.to) {
    const line = doc.lineAt(pos);
    ranges.push(HTML_BLOCK_LINE.range(line.from));
    if (line.to >= node.to) break;
    pos = line.to + 1;
  }
}

export function decorateHardBreak(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  const markTo = Math.max(node.from, node.to - 1);
  if (node.from < markTo) {
    pushRevealableMark(ranges, atomicRanges, revealed, node.from, markTo);
  }
}
