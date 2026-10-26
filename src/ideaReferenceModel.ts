import type {
  BinderCardState,
  EditorSettings,
  IdeaBinderCardState,
  IdeaFragmentLink,
  IdeaReferenceLink,
  IdeaThread,
  IdeaThreadItemLink,
  IdeaThreadLayout,
  ReferenceFileInfo,
  ReferenceLayout,
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

/**
 * 並び順が同じか。Rust は並び順の項目を serde_json::Value のまま読み書きし、キーを名前の順に
 * 並べ替えるので、整合処理が作り直した項目とはキーの順だけが違う。キーの順は見ない。
 */
export function sameIdeaThreadLayouts(a: IdeaThreadLayout[], b: IdeaThreadLayout[]): boolean {
  const sortedKeys = (_key: string, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : value;
  return JSON.stringify(a, sortedKeys) === JSON.stringify(b, sortedKeys);
}

/**
 * 並び順と資料ボードの Idea カードを、指定した「Ideaの管理単位」の側に合わせる。
 * スレッドの ID は管理単位ごとに別（受信箱だけは同じ ID）なので、違う側のまま整合処理に
 * かけると並び順が崩れる。違う側なら、表示していた側を預け、預けていた側を出す。
 * どちらの側か書いていない古いデータは、指定した側のものとして読む。
 */
export function alignIdeaLayoutToMode<T extends Pick<ReferenceLayout, "cards" | "ideaThreads" | "ideaThreadsMode" | "otherIdea">>(
  layout: T,
  mode: EditorSettings["snippetStorageMode"],
): T {
  if (!layout.ideaThreadsMode) return { ...layout, ideaThreadsMode: mode };
  if (layout.ideaThreadsMode === mode) return layout;
  const restored = layout.otherIdea?.mode === mode ? layout.otherIdea : null;
  const isIdeaCard = (card: BinderCardState): card is IdeaBinderCardState =>
    card.sourceType === "idea";
  return {
    ...layout,
    ideaThreadsMode: mode,
    ideaThreads: restored?.ideaThreads ?? [],
    cards: [...layout.cards.filter((card) => !isIdeaCard(card)), ...(restored?.cards ?? [])],
    otherIdea: {
      mode: layout.ideaThreadsMode,
      ideaThreads: layout.ideaThreads,
      cards: layout.cards.filter(isIdeaCard),
    },
  };
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
