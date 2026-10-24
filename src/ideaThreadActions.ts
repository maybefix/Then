import type { Dispatch, DragEvent, SetStateAction } from "react";
import {
  createIdeaOriginRef,
  type CanvasCopyToIdeaRequest,
  type CanvasFocusIdeaRequest,
} from "./canvasTypes";
import {
  makeIdeaItem,
  makeReferenceLink,
  normalizedReferenceKey,
  reconcileIdeaThreadLayouts,
} from "./ideaReferenceModel";
import { makeIdeaFragment, nextIdeaId } from "./ideaThreadModel";
import {
  isIdeaBinderCard,
  type AppState,
  type BinderCardState,
  type IdeaReferenceLink,
  type IdeaThread,
  type IdeaThreadItemLink,
  type ReferenceLayout,
} from "./types";

const SNIPPET_DRAG_MIME = "application/x-brew-snippet-id";
const CANVAS_NEW_THREAD_TARGET = "__new__";

type ToastAction = {
  label: string;
  onClick: () => void;
};

export type IdeaFocusRequest = {
  threadId: string;
  fragmentId?: string;
  nonce: number;
};

export type IdeaThreadActionDeps = {
  snippets: IdeaThread[];
  referenceLayout: ReferenceLayout;
  setAppState: Dispatch<SetStateAction<AppState>>;
  setReferenceLayout: Dispatch<SetStateAction<ReferenceLayout>>;
  setDraggingId: Dispatch<SetStateAction<string | null>>;
  setIdeaFocusRequest: Dispatch<SetStateAction<IdeaFocusRequest | null>>;
  setRightSidebarTab: (tab: string) => void;
  setIsRightSidebarCollapsed: (collapsed: boolean) => void;
  showToast: (message: string, action?: ToastAction | null) => void;
  requestConfirm: (options: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
  requestNewIdeaThreadName: () => Promise<string | null>;
};

/**
 * Idea のスレッドと断片を書き換える操作。値は App が持ち、描画のたびに
 * その時点の値と書き換え用の関数を受け取る。
 */
export function createIdeaThreadActions(deps: IdeaThreadActionDeps) {
  const {
    snippets,
    referenceLayout,
    setAppState,
    setReferenceLayout,
    setDraggingId,
    setIdeaFocusRequest,
    setRightSidebarTab,
    setIsRightSidebarCollapsed,
    showToast,
    requestConfirm,
    requestNewIdeaThreadName,
  } = deps;

  const isSnippetDragEvent = (event: DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer.types).includes(SNIPPET_DRAG_MIME);
  };

  const handleFragmentDragStart = (
    event: DragEvent<HTMLElement>,
    threadId: string,
    fragmentId: string,
  ) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    setDraggingId(fragmentId);
    // スレッド内の並べ替えは移動、Canvas へのドロップはコピーとして受け取られる。
    // Canvas は本文の文字列からカードを作るので、Canvas の側面パネルと同じく本文も渡す。
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(SNIPPET_DRAG_MIME, fragmentId);
    event.dataTransfer.setData("text/plain", fragment.body);
  };

  const handleFragmentDragEnd = () => {
    setDraggingId(null);
  };

  const blockIdeaDropOnEditor = (event: DragEvent<HTMLDivElement>) => {
    if (!isSnippetDragEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "none";
  };

  const updateIdeaThreads = (updater: (threads: IdeaThread[]) => IdeaThread[]) => {
    setAppState((current) => {
      const nextThreads = updater(current.snippets);
      return {
        ...current,
        snippets: nextThreads,
        profileSnippets:
          current.settings.snippetStorageMode === "profile"
            ? nextThreads
            : current.profileSnippets,
      };
    });
  };

  /** 削除で外れた資料ボードの Idea カードを、まだ無いものだけ戻す。 */
  const restoreCards = (layout: ReferenceLayout, cards: BinderCardState[]): ReferenceLayout => {
    const present = new Set(layout.cards.map((card) => card.id));
    const missing = cards.filter((card) => !present.has(card.id));
    return missing.length ? { ...layout, cards: [...layout.cards, ...missing] } : layout;
  };

  /** スレッドを id で見つけて差し替える（updatedAt を更新）。 */
  const patchThread = (threadId: string, patch: (thread: IdeaThread) => IdeaThread) => {
    updateIdeaThreads((threads) =>
      threads.map((thread) =>
        thread.id === threadId ? { ...patch(thread), updatedAt: Date.now() } : thread,
      ),
    );
  };

  const captureFragment = (body: string, destId: string) => {
    const text = body.trim();
    if (!text) return;
    const dest = snippets.find((thread) => thread.id === destId) ?? snippets[0];
    if (!dest) return;
    const fragment = makeIdeaFragment(text);
    // 追加した Idea は、どのスレッドでも先頭（新しい順）に入れる。
    patchThread(dest.id, (thread) => ({ ...thread, fragments: [fragment, ...thread.fragments] }));
    setReferenceLayout((current) => ({
      ...current,
      ideaThreads: current.ideaThreads.map((layout) =>
        layout.threadId === dest.id
          ? {
              ...layout,
              items: [makeIdeaItem(fragment.id), ...layout.items],
            }
          : layout,
      ),
    }));
    showToast(`「${dest.title}」に追加しました`);
  };

  const addFragment = (threadId: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    const fragment = makeIdeaFragment(text);
    patchThread(threadId, (thread) => ({ ...thread, fragments: [fragment, ...thread.fragments] }));
    setReferenceLayout((current) => ({
      ...current,
      ideaThreads: current.ideaThreads.map((layout) =>
        layout.threadId === threadId
          ? {
              ...layout,
              items: [makeIdeaItem(fragment.id), ...layout.items],
            }
          : layout,
      ),
    }));
  };

  const updateFragmentBody = (threadId: string, fragmentId: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    patchThread(threadId, (thread) => ({
      ...thread,
      fragments: thread.fragments.map((fragment) =>
        fragment.id === fragmentId
          ? { ...fragment, body: text, updatedAt: Date.now() }
          : fragment,
      ),
    }));
  };

  const deleteFragment = async (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragmentIndex = thread?.fragments.findIndex((item) => item.id === fragmentId) ?? -1;
    const fragment = fragmentIndex >= 0 ? thread?.fragments[fragmentIndex] : null;
    if (!thread || !fragment) return;

    const preview = fragment.body.length > 36 ? `${fragment.body.slice(0, 36)}…` : fragment.body;
    const shouldDelete = await requestConfirm({
      title: "断片を削除",
      message: `「${preview}」を削除しますか？`,
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldDelete) return;

    // 表示順は並び順で決まり、資料ボードの Idea カードは断片が消えると外れる。
    // 元に戻すときに両方を戻せるよう、削除の時点の位置とカードを覚えておく。
    const isDeletedItem = (item: IdeaThreadItemLink) =>
      item.sourceType === "idea" && item.fragmentId === fragmentId;
    const layoutIndex = referenceLayout.ideaThreads
      .find((layout) => layout.threadId === threadId)
      ?.items.findIndex(isDeletedItem) ?? -1;
    const deletedCards = referenceLayout.cards.filter(
      (card) => isIdeaBinderCard(card) && card.threadId === threadId && card.fragmentId === fragmentId,
    );

    patchThread(threadId, (thread) => ({
      ...thread,
      fragments: thread.fragments.filter((fragment) => fragment.id !== fragmentId),
    }));
    showToast("断片を削除しました", {
      label: "元に戻す",
      onClick: () => {
        patchThread(threadId, (current) => {
          if (current.fragments.some((item) => item.id === fragmentId)) return current;
          const fragments = [...current.fragments];
          fragments.splice(Math.min(fragmentIndex, fragments.length), 0, fragment);
          return { ...current, fragments };
        });
        setReferenceLayout((current) => ({
          ...restoreCards(current, deletedCards),
          ideaThreads: current.ideaThreads.map((layout) => {
            if (layout.threadId !== threadId || layout.items.some(isDeletedItem)) return layout;
            const items = [...layout.items];
            items.splice(
              layoutIndex >= 0 ? Math.min(layoutIndex, items.length) : items.length,
              0,
              makeIdeaItem(fragmentId),
            );
            return { ...layout, items };
          }),
        }));
        showToast("削除を元に戻しました");
      },
    });
  };

  const moveFragment = (fromThreadId: string, fragmentId: string, toThreadId: string) => {
    if (fromThreadId === toThreadId) return;
    const fromThread = snippets.find((thread) => thread.id === fromThreadId);
    const fragment = fromThread?.fragments.find((item) => item.id === fragmentId);
    const fromIndex = fromThread?.fragments.findIndex((item) => item.id === fragmentId) ?? -1;
    const toThread = snippets.find((thread) => thread.id === toThreadId);
    if (!fragment || !toThread || fromIndex < 0) return;

    // 表示順はレイアウト側の並びで決まる。断片の配列だけを動かすと、整合処理が
    // 移動先の末尾に足してしまうので、レイアウトも同時に動かす。
    const isMovedItem = (item: IdeaThreadItemLink) =>
      item.sourceType === "idea" && item.fragmentId === fragmentId;
    const fromLayoutIndex = referenceLayout.ideaThreads
      .find((layout) => layout.threadId === fromThreadId)
      ?.items.findIndex(isMovedItem) ?? -1;

    const now = Date.now();
    setReferenceLayout((current) => ({
      ...current,
      ideaThreads: current.ideaThreads.map((layout) => {
        if (layout.threadId === fromThreadId) {
          return { ...layout, items: layout.items.filter((item) => !isMovedItem(item)) };
        }
        if (layout.threadId === toThreadId) {
          // 移動先でも、追加と同じく先頭に入れる。
          return {
            ...layout,
            items: [makeIdeaItem(fragmentId), ...layout.items.filter((item) => !isMovedItem(item))],
          };
        }
        return layout;
      }),
    }));
    updateIdeaThreads((threads) =>
      threads.map((thread) => {
        if (thread.id === fromThreadId) {
          return {
            ...thread,
            fragments: thread.fragments.filter((item) => item.id !== fragmentId),
            updatedAt: now,
          };
        }
        if (thread.id === toThreadId) {
          const movedFragment = { ...fragment, updatedAt: now };
          return {
            ...thread,
            fragments: [movedFragment, ...thread.fragments],
            updatedAt: now,
          };
        }
        return thread;
      }),
    );
    showToast(`「${toThread.title}」へ移動しました`, {
      label: "元に戻す",
      onClick: () => {
        const undoAt = Date.now();
        updateIdeaThreads((threads) => {
          const destination = threads.find((thread) => thread.id === toThreadId);
          const currentFragment = destination?.fragments.find((item) => item.id === fragmentId);
          if (!currentFragment) return threads;

          return threads.map((thread) => {
            if (thread.id === toThreadId) {
              return {
                ...thread,
                fragments: thread.fragments.filter((item) => item.id !== fragmentId),
                updatedAt: undoAt,
              };
            }
            if (thread.id === fromThreadId) {
              const fragments = [...thread.fragments];
              fragments.splice(
                Math.min(fromIndex, fragments.length),
                0,
                { ...currentFragment, updatedAt: undoAt },
              );
              return { ...thread, fragments, updatedAt: undoAt };
            }
            return thread;
          });
        });
        setReferenceLayout((current) => ({
          ...current,
          ideaThreads: current.ideaThreads.map((layout) => {
            if (layout.threadId === toThreadId) {
              return { ...layout, items: layout.items.filter((item) => !isMovedItem(item)) };
            }
            if (layout.threadId === fromThreadId) {
              const items = layout.items.filter((item) => !isMovedItem(item));
              items.splice(
                fromLayoutIndex >= 0 ? Math.min(fromLayoutIndex, items.length) : items.length,
                0,
                makeIdeaItem(fragmentId),
              );
              return { ...layout, items };
            }
            return layout;
          }),
        }));
        showToast("移動を元に戻しました");
      },
    });
  };

  const createIdeaThread = (initialTitle = "新しいスレッド"): string => {
    const id = nextIdeaId("thread");
    const now = Date.now();
    updateIdeaThreads((threads) => {
      const thread: IdeaThread = {
        id,
        kind: "thread",
        title: initialTitle.trim() || "新しいスレッド",
        starred: false,
        createdAt: now,
        updatedAt: now,
        fragments: [],
      };
      const inboxIndex = threads.findIndex((item) => item.kind === "inbox");
      const next = [...threads];
      next.splice(inboxIndex >= 0 ? inboxIndex + 1 : 0, 0, thread);
      return next;
    });
    return id;
  };

  const moveFragmentToNewThread = async (fromThreadId: string, fragmentId: string) => {
    const source = snippets.find((thread) => thread.id === fromThreadId);
    const fragment = source?.fragments.find((item) => item.id === fragmentId);
    if (!source || !fragment) return;
    const title = await requestNewIdeaThreadName();
    if (!title) return;
    const now = Date.now();
    const newThreadId = nextIdeaId("thread");
    const newThread: IdeaThread = {
      id: newThreadId,
      kind: "thread",
      title,
      starred: false,
      createdAt: now,
      updatedAt: now,
      fragments: [{ ...fragment, updatedAt: now }],
    };
    updateIdeaThreads((threads) => {
      const withoutFragment = threads.map((thread) =>
        thread.id === fromThreadId
          ? {
              ...thread,
              fragments: thread.fragments.filter((item) => item.id !== fragmentId),
              updatedAt: now,
            }
          : thread,
      );
      const inboxIndex = withoutFragment.findIndex((thread) => thread.kind === "inbox");
      const next = [...withoutFragment];
      next.splice(inboxIndex >= 0 ? inboxIndex + 1 : 0, 0, newThread);
      return next;
    });
    setReferenceLayout((current) => {
      const layouts = reconcileIdeaThreadLayouts(current.ideaThreads, snippets);
      return {
        ...current,
        version: 3,
        ideaThreads: [
          ...layouts.map((layout) =>
            layout.threadId === fromThreadId
              ? {
                  ...layout,
                  items: layout.items.filter(
                    (item) => item.sourceType !== "idea" || item.fragmentId !== fragmentId,
                  ),
                }
              : layout,
          ),
          { threadId: newThreadId, items: [makeIdeaItem(fragmentId)] },
        ],
      };
    });
    showToast(`新規スレッド「${title}」へ移動しました`);
  };

  const moveReferenceToNewThread = async (
    fromThreadId: string,
    linkId: string,
    copy: boolean,
  ) => {
    const sourceLayout = referenceLayout.ideaThreads.find(
      (layout) => layout.threadId === fromThreadId,
    );
    const sourceLink = sourceLayout?.items.find(
      (item): item is IdeaReferenceLink => item.sourceType === "reference" && item.id === linkId,
    );
    if (!sourceLink) return;
    const title = await requestNewIdeaThreadName();
    if (!title) return;
    const now = Date.now();
    const newThreadId = nextIdeaId("thread");
    const newThread: IdeaThread = {
      id: newThreadId,
      kind: "thread",
      title,
      starred: false,
      createdAt: now,
      updatedAt: now,
      fragments: [],
    };
    updateIdeaThreads((threads) => {
      const inboxIndex = threads.findIndex((thread) => thread.kind === "inbox");
      const next = [...threads];
      next.splice(inboxIndex >= 0 ? inboxIndex + 1 : 0, 0, newThread);
      return next;
    });
    setReferenceLayout((current) => {
      const layouts = reconcileIdeaThreadLayouts(current.ideaThreads, snippets);
      return {
        ...current,
        version: 3,
        ideaThreads: [
          ...layouts.map((layout) =>
            layout.threadId === fromThreadId && !copy
              ? {
                  ...layout,
                  items: layout.items.filter(
                    (item) => item.sourceType !== "reference" || item.id !== linkId,
                  ),
                }
              : layout,
          ),
          { threadId: newThreadId, items: [makeReferenceLink(sourceLink.sourcePath)] },
        ],
      };
    });
    showToast(`新規スレッド「${title}」へ${copy ? "追加" : "移動"}しました`);
  };

  const renameIdeaThread = (threadId: string, title: string) => {
    patchThread(threadId, (thread) =>
      thread.kind === "inbox" ? thread : { ...thread, title },
    );
  };

  const toggleThreadStar = (threadId: string) => {
    patchThread(threadId, (thread) => ({ ...thread, starred: !thread.starred }));
  };

  const deleteIdeaThread = async (threadId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const threadIndex = snippets.findIndex((item) => item.id === threadId);
    if (!thread || thread.kind === "inbox") return;
    const shouldDelete = await requestConfirm({
      title: "スレッドを削除",
      message: `「${thread.title}」を削除しますか？`,
      detail: `断片 ${thread.fragments.length} 件もまとめて削除されます。`,
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldDelete) return;
    // 削除すると、整合処理がこのスレッドの並び順を捨てて資料リンクを受信箱へ移し
    // （ID はそのまま）、資料ボードの Idea カードも外れる。元に戻すために覚えておく。
    const deletedLayout = referenceLayout.ideaThreads.find((layout) => layout.threadId === threadId);
    const deletedCards = referenceLayout.cards.filter(
      (card) => isIdeaBinderCard(card) && card.threadId === threadId,
    );
    const inboxId = snippets.find((item) => item.kind === "inbox")?.id ?? snippets[0]?.id;
    updateIdeaThreads((threads) => threads.filter((item) => item.id !== threadId));
    showToast("スレッドを削除しました", {
      label: "元に戻す",
      onClick: () => {
        updateIdeaThreads((threads) => {
          if (threads.some((item) => item.id === threadId)) return threads;
          const next = [...threads];
          next.splice(Math.min(Math.max(threadIndex, 0), next.length), 0, thread);
          return next;
        });
        if (deletedLayout) {
          setReferenceLayout((current) => {
            const inboxLinkIds = new Set(
              current.ideaThreads
                .find((layout) => layout.threadId === inboxId)
                ?.items.filter((item) => item.sourceType === "reference")
                .map((item) => (item as IdeaReferenceLink).id) ?? [],
            );
            const linkedPaths = new Set(
              current.ideaThreads
                .filter((layout) => layout.threadId !== threadId)
                .flatMap((layout) => layout.items)
                .filter((item): item is IdeaReferenceLink => item.sourceType === "reference")
                .map((item) => normalizedReferenceKey(item.sourcePath)),
            );
            // 受信箱にまだある資料リンクと、どこにも置かれていない資料リンクだけを戻す。
            // そのあいだに利用者が別の場所へ動かしたものは、そのままにする。
            const restoredLinkIds = new Set<string>();
            const items = deletedLayout.items.filter((item) => {
              if (item.sourceType === "idea") return true;
              if (!inboxLinkIds.has(item.id) && linkedPaths.has(normalizedReferenceKey(item.sourcePath))) {
                return false;
              }
              restoredLinkIds.add(item.id);
              return true;
            });
            const ideaThreads = current.ideaThreads
              .filter((layout) => layout.threadId !== threadId)
              .map((layout) =>
                layout.threadId === inboxId
                  ? {
                      ...layout,
                      items: layout.items.filter(
                        (item) => item.sourceType !== "reference" || !restoredLinkIds.has(item.id),
                      ),
                    }
                  : layout,
              );
            return { ...restoreCards(current, deletedCards), ideaThreads: [...ideaThreads, { threadId, items }] };
          });
        }
        showToast("スレッドの削除を元に戻しました");
      },
    });
  };

  /** Canvas の「Idea へ送る」から届いた断片を取り込む。 */
  const receiveCanvasCopyToIdea = (request: CanvasCopyToIdeaRequest) => {
    const items = request.items
      .map((item) => ({ ...item, text: item.text }))
      .filter((item) => item.text.trim().length > 0);
    if (items.length === 0) return;

    const copiedAt = Date.now();
    const newThreadId =
      request.targetThreadId === CANVAS_NEW_THREAD_TARGET ? nextIdeaId("thread") : null;
    updateIdeaThreads((threads) => {
      if (newThreadId) {
        const now = Date.now();
        const thread: IdeaThread = {
          id: newThreadId,
          kind: "thread",
          title: request.threadTitle?.trim() || request.boardName || "Canvas から",
          starred: false,
          createdAt: now,
          updatedAt: now,
          fragments: items.map((item) =>
            makeIdeaFragment(
              item.text,
              false,
              createIdeaOriginRef(request.boardScope, request.boardId, item.nodeId, copiedAt),
            ),
          ),
        };
        const inboxIndex = threads.findIndex((item) => item.kind === "inbox");
        const next = [...threads];
        next.splice(inboxIndex >= 0 ? inboxIndex + 1 : 0, 0, thread);
        return next;
      }

      const fallback = threads.find((thread) => thread.kind === "inbox") ?? threads[0];
      const targetId = threads.some((thread) => thread.id === request.targetThreadId)
        ? request.targetThreadId
        : fallback?.id;
      if (!targetId) return threads;
      return threads.map((thread) =>
        thread.id === targetId
          ? {
              ...thread,
              fragments: [
                ...thread.fragments,
                ...items.map((item) =>
                  makeIdeaFragment(
                    item.text,
                    false,
                    createIdeaOriginRef(
                      request.boardScope,
                      request.boardId,
                      item.nodeId,
                      copiedAt,
                    ),
                  ),
                ),
              ],
              updatedAt: copiedAt,
            }
          : thread,
      );
    });
    setRightSidebarTab("idea");
    setIsRightSidebarCollapsed(false);
    if (newThreadId) setIdeaFocusRequest({ threadId: newThreadId, nonce: copiedAt });
    showToast(`${items.length} 件を Idea へ取り込みました`);
  };

  /** Canvas の「元Idea」から、元の断片のあるスレッドを開く。 */
  const receiveCanvasFocusIdea = (request: CanvasFocusIdeaRequest) => {
    setRightSidebarTab("idea");
    setIsRightSidebarCollapsed(false);
    setIdeaFocusRequest({
      threadId: request.threadId,
      fragmentId: request.fragmentId,
      nonce: Date.now(),
    });
  };

  return {
    updateIdeaThreads,
    patchThread,
    handleFragmentDragStart,
    handleFragmentDragEnd,
    blockIdeaDropOnEditor,
    captureFragment,
    addFragment,
    updateFragmentBody,
    deleteFragment,
    moveFragment,
    createIdeaThread,
    moveFragmentToNewThread,
    moveReferenceToNewThread,
    renameIdeaThread,
    toggleThreadStar,
    deleteIdeaThread,
    receiveCanvasCopyToIdea,
    receiveCanvasFocusIdea,
  };
}
