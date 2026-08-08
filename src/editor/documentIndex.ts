export type DocumentIndexLine = {
  source: string;
  /** JavaScript string length (UTF-16 code units). */
  utf16Length: number;
  /** Unicode code-point count, matching the existing application counter. */
  textLength: number;
  /** Code-point count after excluding half/full-width whitespace. */
  visibleTextLength: number;
};

export type DocumentLineDiff = {
  from: number;
  toOld: number;
  toNew: number;
};

export type DocumentIndex = {
  lines: readonly DocumentIndexLine[];
  lineCount: number;
  utf16Length: number;
  textLength: number;
  visibleTextLength: number;
};

const WHITESPACE_PATTERN = /[\s　]/g;

function createDocumentIndexLine(source: string): DocumentIndexLine {
  return {
    source,
    utf16Length: source.length,
    textLength: Array.from(source).length,
    visibleTextLength: Array.from(source.replace(WHITESPACE_PATTERN, "")).length,
  };
}

function newlineCount(lineCount: number): number {
  return Math.max(0, lineCount - 1);
}

function sumLineMetrics(lines: readonly DocumentIndexLine[]): {
  utf16Length: number;
  textLength: number;
  visibleTextLength: number;
} {
  let utf16Length = 0;
  let textLength = 0;
  let visibleTextLength = 0;
  for (const line of lines) {
    utf16Length += line.utf16Length;
    textLength += line.textLength;
    visibleTextLength += line.visibleTextLength;
  }
  return { utf16Length, textLength, visibleTextLength };
}

function assembleDocumentIndex(lines: readonly DocumentIndexLine[]): DocumentIndex {
  const totals = sumLineMetrics(lines);
  const lineBreaks = newlineCount(lines.length);
  return {
    lines,
    lineCount: lines.length,
    utf16Length: totals.utf16Length + lineBreaks,
    textLength: totals.textLength + lineBreaks,
    visibleTextLength: totals.visibleTextLength,
  };
}

export function createDocumentIndexFromLines(sources: readonly string[]): DocumentIndex {
  const normalizedSources = sources.length > 0 ? sources : [""];
  return assembleDocumentIndex(normalizedSources.map(createDocumentIndexLine));
}

function hasValidDiffShape(
  previous: DocumentIndex,
  nextLineCount: number,
  diff: DocumentLineDiff,
): boolean {
  return (
    Number.isInteger(diff.from) &&
    Number.isInteger(diff.toOld) &&
    Number.isInteger(diff.toNew) &&
    diff.from >= 0 &&
    diff.from <= diff.toOld &&
    diff.from <= diff.toNew &&
    diff.toOld <= previous.lines.length &&
    diff.toNew <= nextLineCount &&
    previous.lines.length - diff.toOld === nextLineCount - diff.toNew
  );
}

/**
 * Updates aggregate metrics from the changed line window. Prefix and suffix
 * line records retain identity so later caches can reuse their work. An
 * invalid diff falls back to a complete, deterministic rebuild.
 */
export function updateDocumentIndex(
  previous: DocumentIndex,
  nextSourcesInput: readonly string[],
  diff: DocumentLineDiff,
): DocumentIndex {
  const nextSources = nextSourcesInput.length > 0 ? nextSourcesInput : [""];
  if (!hasValidDiffShape(previous, nextSources.length, diff)) {
    return createDocumentIndexFromLines(nextSources);
  }

  const removedLines = previous.lines.slice(diff.from, diff.toOld);
  const addedLines = nextSources.slice(diff.from, diff.toNew).map(createDocumentIndexLine);
  const removed = sumLineMetrics(removedLines);
  const added = sumLineMetrics(addedLines);
  const lines = [
    ...previous.lines.slice(0, diff.from),
    ...addedLines,
    ...previous.lines.slice(diff.toOld),
  ];
  const previousLineBreaks = newlineCount(previous.lineCount);
  const nextLineBreaks = newlineCount(lines.length);

  return {
    lines,
    lineCount: lines.length,
    utf16Length:
      previous.utf16Length -
      previousLineBreaks -
      removed.utf16Length +
      added.utf16Length +
      nextLineBreaks,
    textLength:
      previous.textLength -
      previousLineBreaks -
      removed.textLength +
      added.textLength +
      nextLineBreaks,
    visibleTextLength:
      previous.visibleTextLength - removed.visibleTextLength + added.visibleTextLength,
  };
}

/** Expensive reference comparison intended for tests and development shadow checks. */
export function areDocumentIndexesEquivalent(
  left: DocumentIndex,
  right: DocumentIndex,
): boolean {
  if (
    left.lineCount !== right.lineCount ||
    left.utf16Length !== right.utf16Length ||
    left.textLength !== right.textLength ||
    left.visibleTextLength !== right.visibleTextLength ||
    left.lines.length !== right.lines.length
  ) {
    return false;
  }

  for (let index = 0; index < left.lines.length; index += 1) {
    const leftLine = left.lines[index];
    const rightLine = right.lines[index];
    if (
      leftLine.source !== rightLine.source ||
      leftLine.utf16Length !== rightLine.utf16Length ||
      leftLine.textLength !== rightLine.textLength ||
      leftLine.visibleTextLength !== rightLine.visibleTextLength
    ) {
      return false;
    }
  }
  return true;
}

/** Expensive full materialization; keep it outside the per-keystroke production path. */
export function serializeDocumentIndex(index: DocumentIndex): string {
  return index.lines.map((line) => line.source).join("\n");
}
