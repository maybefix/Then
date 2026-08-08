export type TextEditorSelection = {
  from: number;
  to: number;
  head: number;
  /** One-based top-level document line containing the selection head. */
  line: number;
};

/**
 * Converts ProseMirror's zero-based top-level child index into the one-based
 * line number used by the outline and sidebar. This avoids scanning the text
 * preceding the caret on every selection update.
 */
export function lineNumberFromTopLevelIndex(index: number): number {
  return Math.max(1, index + 1);
}
