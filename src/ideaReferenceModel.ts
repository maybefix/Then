import type {
  IdeaFragmentLink,
  IdeaReferenceLink,
  IdeaThread,
  IdeaThreadItemLink,
  IdeaThreadLayout,
  ReferenceFileInfo,
} from "./types";

export const normalizeIdeaReferencePath = (sourcePath: string): string =>
  sourcePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");

export const ideaThreadItemKey = (item: IdeaThreadItemLink): string =>
  item.sourceType === "idea"
    ? `idea:${item.fragmentId}`
    : `reference:${item.id}`;

export const normalizedReferenceKey = (sourcePath: string): string =>
  normalizeIdeaReferencePath(sourcePath).toLocaleLowerCase();

export const makeIdeaItem = (fragmentId: string): IdeaFragmentLink => ({
  sourceType: "idea",
  fragmentId,
});

export const makeReferenceLink = (
  sourcePath: string,
  createdAt = Date.now(),
): IdeaReferenceLink => ({
  id: `reference-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  sourceType: "reference",
  sourcePath: normalizeIdeaReferencePath(sourcePath),
  createdAt,
});

const isRawIdeaItem = (value: unknown): value is IdeaFragmentLink => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.sourceType === "idea" && typeof item.fragmentId === "string";
};

const isRawReferenceItem = (value: unknown): value is IdeaReferenceLink => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.sourceType === "reference" &&
    typeof item.id === "string" &&
    typeof item.sourcePath === "string"
  );
};

function normalizeRawItems(
  value: unknown,
  fragmentIds: ReadonlySet<string>,
): IdeaThreadItemLink[] {
  if (!Array.isArray(value)) return [];
  const seenItemIds = new Set<string>();
  const seenReferencePaths = new Set<string>();
  const items: IdeaThreadItemLink[] = [];

  for (const raw of value) {
    if (isRawIdeaItem(raw)) {
      if (!fragmentIds.has(raw.fragmentId)) continue;
      const key = `idea:${raw.fragmentId}`;
      if (seenItemIds.has(key)) continue;
      seenItemIds.add(key);
      items.push(makeIdeaItem(raw.fragmentId));
      continue;
    }
    if (!isRawReferenceItem(raw)) continue;
    const sourcePath = normalizeIdeaReferencePath(raw.sourcePath);
    const pathKey = normalizedReferenceKey(sourcePath);
    if (!sourcePath || seenReferencePaths.has(pathKey)) continue;
    const key = `reference:${raw.id}`;
    if (seenItemIds.has(key)) continue;
    seenItemIds.add(key);
    seenReferencePaths.add(pathKey);
    items.push({
      id: raw.id,
      sourceType: "reference",
      sourcePath,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    });
  }
  return items;
}

/**
 * 旧 fragments-only データ、消えた profile スレッド、既存 imports をまとめて
 * 現在の作品用混在順序へ移行する。常に全 Idea 断片を1回だけ含める。
 */
export function reconcileIdeaThreadLayouts(
  rawLayouts: unknown,
  threads: IdeaThread[],
  existingImportedFiles: ReferenceFileInfo[] = [],
): IdeaThreadLayout[] {
  const rawByThread = new Map<string, unknown>();
  const orphanReferences: IdeaReferenceLink[] = [];
  if (Array.isArray(rawLayouts)) {
    for (const raw of rawLayouts) {
      if (!raw || typeof raw !== "object") continue;
      const layout = raw as { threadId?: unknown; items?: unknown };
      if (typeof layout.threadId !== "string") continue;
      rawByThread.set(layout.threadId, layout.items);
    }
  }

  const liveThreadIds = new Set(threads.map((thread) => thread.id));
  for (const [threadId, rawItems] of rawByThread) {
    if (liveThreadIds.has(threadId) || !Array.isArray(rawItems)) continue;
    for (const item of rawItems) {
      if (!isRawReferenceItem(item)) continue;
      orphanReferences.push({
        id: item.id,
        sourceType: "reference",
        sourcePath: normalizeIdeaReferencePath(item.sourcePath),
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
      });
    }
  }

  const inbox = threads.find((thread) => thread.kind === "inbox") ?? threads[0];
  const layouts = threads.map((thread) => {
    const fragmentIds = new Set(thread.fragments.map((fragment) => fragment.id));
    const items = normalizeRawItems(rawByThread.get(thread.id), fragmentIds);
    const presentIdeas = new Set(
      items.filter((item): item is IdeaFragmentLink => item.sourceType === "idea")
        .map((item) => item.fragmentId),
    );
    for (const fragment of thread.fragments) {
      if (!presentIdeas.has(fragment.id)) items.push(makeIdeaItem(fragment.id));
    }
    return { threadId: thread.id, items };
  });

  if (!inbox) return layouts;
  const inboxLayout = layouts.find((layout) => layout.threadId === inbox.id);
  if (!inboxLayout) return layouts;
  const referencedPaths = new Set(
    layouts.flatMap((layout) =>
      layout.items
        .filter((item): item is IdeaReferenceLink => item.sourceType === "reference")
        .map((item) => normalizedReferenceKey(item.sourcePath)),
    ),
  );
  const inboxPaths = new Set(
    inboxLayout.items
      .filter((item): item is IdeaReferenceLink => item.sourceType === "reference")
      .map((item) => normalizedReferenceKey(item.sourcePath)),
  );

  for (const link of orphanReferences) {
    const key = normalizedReferenceKey(link.sourcePath);
    if (!key || inboxPaths.has(key)) continue;
    inboxLayout.items.push(link);
    inboxPaths.add(key);
    referencedPaths.add(key);
  }

  existingImportedFiles.forEach((file, index) => {
    if (!file.imported || file.scope !== "project") return;
    const key = normalizedReferenceKey(file.sourcePath);
    if (!key || referencedPaths.has(key)) return;
    const link = makeReferenceLink(file.sourcePath, index + 1);
    inboxLayout.items.push(link);
    inboxPaths.add(key);
    referencedPaths.add(key);
  });

  return layouts;
}

export function countIdeaReferenceLinks(
  layouts: IdeaThreadLayout[],
  sourcePath: string,
): number {
  const key = normalizedReferenceKey(sourcePath);
  return layouts.reduce(
    (count, layout) =>
      count + layout.items.filter(
        (item) => item.sourceType === "reference" && normalizedReferenceKey(item.sourcePath) === key,
      ).length,
    0,
  );
}
