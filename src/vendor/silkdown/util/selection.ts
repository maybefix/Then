import type { EditorSelection, Text } from "@codemirror/state";

/**
 * Obsidian-style line-level reveal predicate.
 *
 * Returns true if any selection range shares at least one line with [from, to].
 *
 * Why a line range and not just lineAt(head):
 *   - Multi-line selections must reveal nodes inside the spanned lines.
 *   - A multi-line node (fenced code) must reveal when the cursor is on any of its lines.
 *
 * Why iterate selection.ranges instead of selection.main:
 *   - CM6 supports multi-cursor; each cursor independently triggers reveal.
 */
export function selectionTouchesLineRange(
  doc: Text,
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  // CM6 node `to` is exclusive. If `to` lands at the start of the next line,
  // back off one so we get the node's actual end-line.
  const safeTo = to > from ? Math.max(from, to - 1) : to;
  const nodeStartLine = doc.lineAt(from).number;
  const nodeEndLine = doc.lineAt(safeTo).number;

  for (const range of selection.ranges) {
    const selStartLine = doc.lineAt(range.from).number;
    const selEndLine = doc.lineAt(range.to).number;
    if (selStartLine <= nodeEndLine && nodeStartLine <= selEndLine) return true;
  }
  return false;
}
