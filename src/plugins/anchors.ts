import type { ThenPluginAnchor } from "./types";

const CONTEXT_SIZE = 32;

export type TextChange = {
  from: number;
  to: number;
  insertedText: string;
};

export function computeTextChange(previous: string, next: string): TextChange {
  let from = 0;
  const sharedLimit = Math.min(previous.length, next.length);
  while (from < sharedLimit && previous[from] === next[from]) from += 1;

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > from &&
    nextEnd > from &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return { from, to: previousEnd, insertedText: next.slice(from, nextEnd) };
}

function mapOffset(
  offset: number,
  change: TextChange,
  association: "before" | "after",
): number {
  const removedLength = change.to - change.from;
  const delta = change.insertedText.length - removedLength;
  if (offset < change.from) return offset;
  if (offset > change.to) return offset + delta;
  if (offset === change.from && association === "before") return change.from;
  return change.from + change.insertedText.length;
}

function withContext(anchor: ThenPluginAnchor, text: string): ThenPluginAnchor {
  const from = Math.max(0, Math.min(text.length, anchor.from));
  const to = Math.max(from, Math.min(text.length, anchor.to));
  return {
    ...anchor,
    from,
    to,
    selectedText: text.slice(from, to),
    contextBefore: text.slice(Math.max(0, from - CONTEXT_SIZE), from),
    contextAfter: text.slice(to, Math.min(text.length, to + CONTEXT_SIZE)),
    updatedAt: Date.now(),
  };
}

export function createThenPluginAnchor(input: {
  id: string;
  pluginId: string;
  documentPath: string;
  from: number;
  to: number;
  text: string;
}): ThenPluginAnchor {
  return withContext(
    {
      id: input.id,
      pluginId: input.pluginId,
      documentPath: input.documentPath,
      from: input.from,
      to: input.to,
      selectedText: "",
      contextBefore: "",
      contextAfter: "",
      updatedAt: Date.now(),
    },
    input.text,
  );
}

export function mapAnchorsThroughTextChange(
  anchors: readonly ThenPluginAnchor[],
  documentPath: string,
  previous: string,
  next: string,
): { anchors: ThenPluginAnchor[]; change: TextChange; changed: boolean } {
  const change = computeTextChange(previous, next);
  if (change.from === change.to && change.insertedText.length === 0) {
    return { anchors: [...anchors], change, changed: false };
  }

  let changed = false;
  const mapped = anchors.map((anchor) => {
    if (anchor.documentPath !== documentPath) return anchor;
    changed = true;
    const from = mapOffset(anchor.from, change, "before");
    const to = Math.max(from, mapOffset(anchor.to, change, "after"));
    return withContext({ ...anchor, from, to }, next);
  });
  return { anchors: mapped, change, changed };
}

function contextScore(anchor: ThenPluginAnchor, text: string, from: number, to: number): number {
  let score = 0;
  const before = text.slice(Math.max(0, from - anchor.contextBefore.length), from);
  const after = text.slice(to, to + anchor.contextAfter.length);
  for (let index = 1; index <= Math.min(before.length, anchor.contextBefore.length); index += 1) {
    if (before[before.length - index] !== anchor.contextBefore[anchor.contextBefore.length - index]) break;
    score += 2;
  }
  for (let index = 0; index < Math.min(after.length, anchor.contextAfter.length); index += 1) {
    if (after[index] !== anchor.contextAfter[index]) break;
    score += 2;
  }
  score -= Math.min(20, Math.abs(from - anchor.from) / 100);
  return score;
}

export function resolveThenPluginAnchor(
  anchor: ThenPluginAnchor,
  text: string,
): ThenPluginAnchor | null {
  const clampedFrom = Math.max(0, Math.min(text.length, anchor.from));
  const clampedTo = Math.max(clampedFrom, Math.min(text.length, anchor.to));
  const beforeAtStoredPosition = text.slice(
    Math.max(0, clampedFrom - anchor.contextBefore.length),
    clampedFrom,
  );
  const afterAtStoredPosition = text.slice(
    clampedTo,
    clampedTo + anchor.contextAfter.length,
  );
  const storedContextMatches =
    beforeAtStoredPosition === anchor.contextBefore &&
    afterAtStoredPosition === anchor.contextAfter;
  if (
    text.slice(clampedFrom, clampedTo) === anchor.selectedText &&
    (storedContextMatches || (!anchor.contextBefore && !anchor.contextAfter))
  ) {
    return withContext({ ...anchor, from: clampedFrom, to: clampedTo }, text);
  }

  const candidates: Array<{ from: number; to: number; score: number }> = [];
  if (anchor.selectedText) {
    let from = text.indexOf(anchor.selectedText);
    while (from >= 0) {
      const to = from + anchor.selectedText.length;
      candidates.push({ from, to, score: contextScore(anchor, text, from, to) });
      from = text.indexOf(anchor.selectedText, from + 1);
    }
  } else {
    const needle = `${anchor.contextBefore}${anchor.contextAfter}`;
    if (needle) {
      let start = text.indexOf(needle);
      while (start >= 0) {
        const from = start + anchor.contextBefore.length;
        candidates.push({ from, to: from, score: contextScore(anchor, text, from, from) + 8 });
        start = text.indexOf(needle, start + 1);
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best || (candidates[1] && candidates[1].score === best.score)) return null;
  return withContext({ ...anchor, from: best.from, to: best.to }, text);
}
