import type { DocumentLineDiff } from "./documentIndex";

type SourceLine = {
  source: string;
};

function materializeText(lines: readonly SourceLine[]): string {
  return lines.map((line) => line.source).join("\n");
}

function hasValidDiff(
  oldLines: readonly SourceLine[],
  nextLines: readonly SourceLine[],
  diff: DocumentLineDiff,
): boolean {
  return (
    Number.isInteger(diff.from) &&
    Number.isInteger(diff.toOld) &&
    Number.isInteger(diff.toNew) &&
    diff.from >= 0 &&
    diff.from <= diff.toOld &&
    diff.from <= diff.toNew &&
    diff.toOld <= oldLines.length &&
    diff.toNew <= nextLines.length &&
    oldLines.length - diff.toOld === nextLines.length - diff.toNew
  );
}

/**
 * Applies a whole-line replacement without re-reading or joining unchanged
 * lines. The returned string is still newly allocated because React owns the
 * complete source text, but only the changed line window is materialized.
 */
export function updateTextFromLineDiff(
  previousText: string,
  oldLines: readonly SourceLine[],
  nextLines: readonly SourceLine[],
  diff: DocumentLineDiff,
): string {
  if (!hasValidDiff(oldLines, nextLines, diff)) {
    return materializeText(nextLines);
  }

  if (diff.from === diff.toOld && diff.from === diff.toNew) {
    return previousText;
  }

  let start = 0;
  for (let index = 0; index < diff.from; index += 1) {
    start += oldLines[index].source.length;
    if (index < oldLines.length - 1) start += 1;
  }

  let end = start;
  for (let index = diff.from; index < diff.toOld; index += 1) {
    end += oldLines[index].source.length;
    if (index < oldLines.length - 1) end += 1;
  }

  const addedCount = diff.toNew - diff.from;
  const hasSuffix = diff.toOld < oldLines.length;
  let replacement = nextLines
    .slice(diff.from, diff.toNew)
    .map((line) => line.source)
    .join("\n");

  if (addedCount > 0 && diff.from === oldLines.length && oldLines.length > 0) {
    replacement = `\n${replacement}`;
  }
  if (addedCount > 0 && hasSuffix) {
    replacement += "\n";
  }
  if (addedCount === 0 && !hasSuffix && diff.toOld > diff.from && start > 0) {
    start -= 1;
  }

  return `${previousText.slice(0, start)}${replacement}${previousText.slice(end)}`;
}
