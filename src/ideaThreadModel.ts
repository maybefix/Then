import type { IdeaFragment, IdeaOriginRef, IdeaThread, Snippet } from "./types";

const INBOX_THREAD_ID = "idea-inbox";
const sampleIdeaThreadIds = new Set(["idea-sample-scene", "idea-sample-foreshadow"]);
const sampleIdeaFragmentBodies = new Set([
  "主人公が改札の前で一瞬立ち止まる描写を入れる。",
  "風呂のシーンはテンポよく、1分で終わらせる緊張感を持たせたい。",
  "夜明けの光が、山の稜線を白く縁どり始めた頃。",
  "主人公は決断する。しかしその足は、一歩踏み出すことを躊躇っていた。",
  "「お前には、まだ知らないことがある」老人は静かに言った。",
]);

let ideaIdCounter = 0;

export function nextIdeaId(prefix: string): string {
  ideaIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${ideaIdCounter}`;
}

function normalizeIdeaOriginRef(value: unknown): IdeaOriginRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const origin = value as Partial<IdeaOriginRef>;
  if (origin.source !== "canvas") return undefined;
  if (typeof origin.sourceId !== "string" || typeof origin.sourceBoardId !== "string") {
    return undefined;
  }
  if (origin.sourceBoardScope === "global") return undefined;
  return {
    source: "canvas",
    sourceId: origin.sourceId,
    sourceBoardId: origin.sourceBoardId,
    sourceBoardScope: "project",
    copiedAt: typeof origin.copiedAt === "number" ? origin.copiedAt : Date.now(),
  };
}

export function makeIdeaFragment(
  body: string,
  used = false,
  originRef?: IdeaOriginRef,
): IdeaFragment {
  const now = Date.now();
  return {
    id: nextIdeaId("frag"),
    body,
    used,
    createdAt: now,
    updatedAt: now,
    originRef,
  };
}

function makeInboxThread(fragments: IdeaFragment[] = []): IdeaThread {
  const now = Date.now();
  return {
    id: INBOX_THREAD_ID,
    kind: "inbox",
    title: "インボックス",
    starred: false,
    createdAt: now,
    updatedAt: now,
    fragments,
  };
}

export function defaultIdeaThreads(): IdeaThread[] {
  return [makeInboxThread()];
}

/** 値を {@link IdeaThread}[] へ正規化する。旧フラット Snippet[] からの移行も担う。 */
export function normalizeIdeaThreads(value: unknown): IdeaThread[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [makeInboxThread()];
  }

  const looksLegacy = value.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "text" in (entry as Record<string, unknown>) &&
      !("fragments" in (entry as Record<string, unknown>)),
  );

  let threads: IdeaThread[];
  if (looksLegacy) {
    const fragments = (value as Snippet[])
      .map((snippet) =>
        makeIdeaFragment(
          typeof snippet?.text === "string" && snippet.text.trim()
            ? snippet.text
            : String(snippet?.title ?? "").trim(),
        ),
      )
      .filter((fragment) => fragment.body.trim().length > 0);
    threads = [makeInboxThread(fragments)];
  } else {
    threads = (value as Array<Partial<IdeaThread>>)
      .filter((thread) => thread && typeof thread === "object")
      .map((thread) => {
        const now = Date.now();
        const fragments = Array.isArray(thread.fragments)
          ? thread.fragments
              .filter((fragment) => fragment && typeof fragment.body === "string")
              .map((fragment) => ({
                id: typeof fragment.id === "string" ? fragment.id : nextIdeaId("frag"),
                body: fragment.body,
                used: Boolean(fragment.used),
                createdAt:
                  typeof fragment.createdAt === "number" ? fragment.createdAt : now,
                updatedAt:
                  typeof fragment.updatedAt === "number" ? fragment.updatedAt : now,
                originRef: normalizeIdeaOriginRef(
                  (fragment as Partial<IdeaFragment>).originRef,
                ),
              }))
          : [];
        return {
          id: typeof thread.id === "string" ? thread.id : nextIdeaId("thread"),
          kind: thread.kind === "inbox" ? "inbox" : "thread",
          title: typeof thread.title === "string" ? thread.title : "スレッド",
          starred: Boolean(thread.starred),
          createdAt: typeof thread.createdAt === "number" ? thread.createdAt : now,
          updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : now,
          fragments,
        } satisfies IdeaThread;
      });
  }

  threads = threads
    .filter((thread) => !sampleIdeaThreadIds.has(thread.id))
    .map((thread) => ({
      ...thread,
      fragments: thread.fragments.filter(
        (fragment) => !sampleIdeaFragmentBodies.has(fragment.body.trim()),
      ),
    }));

  // インボックスを必ず1つ、先頭に置く。
  const inboxes = threads.filter((thread) => thread.kind === "inbox");
  const others = threads.filter((thread) => thread.kind !== "inbox");
  const inbox =
    inboxes.length > 0
      ? { ...inboxes[0], id: INBOX_THREAD_ID, fragments: inboxes.flatMap((t) => t.fragments) }
      : makeInboxThread();
  return [inbox, ...others];
}
