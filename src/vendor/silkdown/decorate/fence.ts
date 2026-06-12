import { Decoration } from "@codemirror/view";
import type { EditorSelection, Range, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { selectionTouchesLineRange } from "../util/selection.js";
import { firstChildNamed, lastChildNamed } from "../util/tree.js";
import { HIDE, pushAtomicRange } from "./shared.js";

const BLOCK_LINE = Decoration.line({ class: "sd-code-block" });
const BLOCK_LINE_FIRST = Decoration.line({ class: "sd-code-block sd-code-block-first" });
const BLOCK_LINE_LAST = Decoration.line({ class: "sd-code-block sd-code-block-last" });
const BLOCK_LINE_ONLY = Decoration.line({
  class: "sd-code-block sd-code-block-first sd-code-block-last",
});

export function decorateFencedCode(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);
  const lineCount = endLine.number - startLine.number + 1;

  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = doc.line(n);
    const deco =
      lineCount === 1
        ? BLOCK_LINE_ONLY
        : n === startLine.number
          ? BLOCK_LINE_FIRST
          : n === endLine.number
            ? BLOCK_LINE_LAST
            : BLOCK_LINE;
    ranges.push(deco.range(line.from));
  }

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  if (revealed) return;

  const openMark = firstChildNamed(node, "CodeMark");
  if (openMark) {
    const openLine = doc.lineAt(openMark.from);
    pushAtomicRange(ranges, atomicRanges, HIDE, openLine.from, openLine.to);
  }

  const closeMark = lastChildNamed(node, "CodeMark");
  if (closeMark && closeMark !== openMark) {
    const closeLine = doc.lineAt(closeMark.from);
    pushAtomicRange(ranges, atomicRanges, HIDE, closeLine.from, closeLine.to);
  }
}
