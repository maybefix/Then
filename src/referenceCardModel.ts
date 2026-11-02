import type {
  BinderCardState,
  ReferenceCardState,
  ReferenceFileInfo,
  ReferenceLayout,
} from "./types";
import { referenceFileKey, referenceKey } from "./referenceFileKeys";
import {
  MAX_RECENT_REFERENCES,
} from "./storedStateModel";

const PINNED_REFERENCE_Z_BASE = 10000;
const NORMAL_REFERENCE_Z_LIMIT = PINNED_REFERENCE_Z_BASE - 1;

export function referenceCardKey(card: Pick<ReferenceCardState, "sourcePath" | "scope">): string {
  return referenceKey(card.sourcePath, card.scope);
}

export function upsertRecentReference(
  layout: ReferenceLayout,
  file: ReferenceFileInfo,
): ReferenceLayout {
  const key = referenceFileKey(file);
  return {
    ...layout,
    recent: [
      file,
      ...layout.recent.filter((item) => referenceFileKey(item) !== key),
    ].slice(0, MAX_RECENT_REFERENCES),
  };
}

export function upsertRecentReferences(
  layout: ReferenceLayout,
  files: ReferenceFileInfo[],
): ReferenceLayout {
  return files.reduce((current, file) => upsertRecentReference(current, file), layout);
}

export function nextReferenceZIndex(cards: BinderCardState[], pinned: boolean): number {
  const maxZ = cards
    .filter((card) => (pinned ? card.pinned : !card.pinned))
    .reduce((max, card) => Math.max(max, card.zIndex), pinned ? PINNED_REFERENCE_Z_BASE : 0);
  return pinned
    ? Math.max(PINNED_REFERENCE_Z_BASE, maxZ + 1)
    : Math.min(NORMAL_REFERENCE_Z_LIMIT, maxZ + 1);
}
