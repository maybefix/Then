/**
 * Maps a text offset in `oldText` to the corresponding offset in `newText`
 * when the whole document is swapped (replace-all, external reload, …) and no
 * ProseMirror step mapping exists.
 *
 * The changed window is located by common prefix/suffix. An offset inside that
 * window is mapped line by line when the window keeps its line count (the usual
 * shape of a search-and-replace), so the caret stays on its own line and only
 * shifts by the edits that happened before it on that line.
 */
export function mapTextOffsetThroughChange(oldText: string, newText: string, offset: number): number {
  const clamped = Math.max(0, Math.min(oldText.length, offset));
  if (oldText === newText) return clamped;

  const window = changedWindow(oldText, newText);
  if (clamped <= window.prefix) return clamped;
  if (clamped >= oldText.length - window.suffix) return clamped + newText.length - oldText.length;

  const oldMiddleFrom = window.prefix;
  const oldMiddle = oldText.slice(oldMiddleFrom, oldText.length - window.suffix);
  const newMiddle = newText.slice(oldMiddleFrom, newText.length - window.suffix);
  const oldLines = oldMiddle.split("\n");
  const newLines = newMiddle.split("\n");
  const innerOffset = clamped - oldMiddleFrom;

  if (oldLines.length !== newLines.length) {
    return oldMiddleFrom + Math.min(innerOffset, newMiddle.length);
  }

  let oldLineStart = 0;
  let newLineStart = 0;
  for (let index = 0; index < oldLines.length; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (innerOffset <= oldLineStart + oldLine.length) {
      return oldMiddleFrom + newLineStart + mapWithinLine(oldLine, newLine, innerOffset - oldLineStart);
    }
    oldLineStart += oldLine.length + 1;
    newLineStart += newLine.length + 1;
  }
  return oldMiddleFrom + Math.min(innerOffset, newMiddle.length);
}

function mapWithinLine(oldLine: string, newLine: string, column: number): number {
  if (oldLine === newLine) return column;
  const window = changedWindow(oldLine, newLine);
  if (column <= window.prefix) return column;
  if (column >= oldLine.length - window.suffix) return column + newLine.length - oldLine.length;
  const oldMiddle = oldLine.slice(window.prefix, oldLine.length - window.suffix);
  const newMiddle = newLine.slice(window.prefix, newLine.length - window.suffix);
  return window.prefix + mapThroughAlignment(oldMiddle, newMiddle, column - window.prefix);
}

const MAX_ALIGNMENT_CELLS = 1_000_000;

/**
 * Aligns two short strings by LCS so several edits on one line (replace-all)
 * each shift the caret only when they precede it. A caret inside replaced text
 * lands after the replacement.
 */
function mapThroughAlignment(oldText: string, newText: string, column: number): number {
  const rows = oldText.length;
  const cols = newText.length;
  if ((rows + 1) * (cols + 1) > MAX_ALIGNMENT_CELLS) return newText.length;

  // lcs[i][j] = LCS length of oldText[i..] and newText[j..]
  const width = cols + 1;
  const lcs = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = oldText.charCodeAt(i) === newText.charCodeAt(j)
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  // Walk the alignment. A caret right after a kept char stays right after it
  // (so a caret at the start of a match stays before its replacement);
  // otherwise it moves before the next kept char.
  let i = 0;
  let j = 0;
  let keptBeforeColumn = column === 0 ? 0 : -1;
  while (i < rows && j < cols) {
    if (oldText.charCodeAt(i) === newText.charCodeAt(j) && lcs[i * width + j] === lcs[(i + 1) * width + j + 1] + 1) {
      if (i >= column) return keptBeforeColumn >= 0 ? keptBeforeColumn : j;
      if (i === column - 1) keptBeforeColumn = j + 1;
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return keptBeforeColumn >= 0 ? keptBeforeColumn : newText.length;
}

/** Exact replacement window; common text outside it keeps its document nodes. */
export function findTextChange(oldText: string, newText: string): { from: number; to: number; insert: string } {
  const { prefix, suffix } = changedWindow(oldText, newText);
  return { from: prefix, to: oldText.length - suffix, insert: newText.slice(prefix, newText.length - suffix) };
}

function changedWindow(oldText: string, newText: string): { prefix: number; suffix: number } {
  const limit = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < limit && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}
