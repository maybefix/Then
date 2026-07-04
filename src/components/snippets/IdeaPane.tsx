import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import type { IdeaOriginRef, IdeaThread } from "../../types";

type IdeaFilter = "all" | "unused" | "starred";

type IdeaPaneProps = {
  threads: IdeaThread[];
  /** ドラッグ中の断片 ID（見た目用）。 */
  draggingId: string | null;
  focusRequest?: {
    threadId: string;
    fragmentId?: string;
    nonce: number;
  } | null;
  onCapture: (body: string, destId: string) => void;
  /** 新規スレッドを作成し、その ID を返す。 */
  onCreateThread: () => string;
  onRenameThread: (threadId: string, title: string) => void;
  onToggleStar: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onAddFragment: (threadId: string, body: string) => void;
  onUpdateFragment: (threadId: string, fragmentId: string, body: string) => void;
  onToggleUsed: (threadId: string, fragmentId: string) => void;
  onDeleteFragment: (threadId: string, fragmentId: string) => void;
  onMoveFragment: (fromThreadId: string, fragmentId: string, toThreadId: string) => void;
  onReorderFragment: (
    threadId: string,
    fragmentId: string,
    targetFragmentId: string,
    position: "before" | "after",
  ) => void;
  onInsertFragment: (threadId: string, fragmentId: string) => void;
  onInsertThread: (threadId: string) => void;
  onSendFragmentToCanvas?: (threadId: string, fragmentId: string) => void;
  onSendThreadToCanvas?: (threadId: string) => void;
  onOpenCanvasOrigin?: (origin: IdeaOriginRef) => void;
  onFragmentDragStart: (
    event: DragEvent<HTMLElement>,
    threadId: string,
    fragmentId: string,
  ) => void;
  onFragmentDragEnd: () => void;
};

const FILTERS: Array<[IdeaFilter, string]> = [
  ["all", "すべて"],
  ["unused", "未使用"],
  ["starred", "スター"],
];

function summarize(thread: IdeaThread): string {
  const pick = thread.fragments.find((fragment) => !fragment.used) ?? thread.fragments[0];
  return pick ? pick.body : "（断片なし）";
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <polygon points="12 3 15 9 22 9.8 17 14.5 18.2 21.4 12 18.1 5.8 21.4 7 14.5 2 9.8 9 9" />
    </svg>
  );
}

function InsertAllIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M4 6h12M4 12h8M4 18h8" />
      <path d="m15 13 4 4 4-4" />
      <path d="M19 17V7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function CanvasSendIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <rect x="4" y="5" width="7" height="6" rx="1.5" />
      <rect x="13" y="13" width="7" height="6" rx="1.5" />
      <path d="M11 8h3.5A2.5 2.5 0 0 1 17 10.5V13" />
      <path d="M13 16H9.5A2.5 2.5 0 0 1 7 13.5V11" />
      <path d="M4 18h5" />
      <path d="m7 15 3 3-3 3" />
    </svg>
  );
}

function CanvasOriginIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <rect x="4" y="5" width="7" height="6" rx="1.5" />
      <rect x="13" y="13" width="7" height="6" rx="1.5" />
      <path d="M11 8h3.5A2.5 2.5 0 0 1 17 10.5V13" />
      <path d="M13 16H9.5A2.5 2.5 0 0 1 7 13.5V11" />
      <path d="M20 6h-5" />
      <path d="m17 3-3 3 3 3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m6 7 1 13h10l1-13" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="ideaGripGlyph">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

export function IdeaPane({
  threads,
  draggingId,
  focusRequest,
  onCapture,
  onCreateThread,
  onRenameThread,
  onToggleStar,
  onDeleteThread,
  onAddFragment,
  onUpdateFragment,
  onToggleUsed,
  onDeleteFragment,
  onMoveFragment,
  onReorderFragment,
  onInsertFragment,
  onInsertThread,
  onSendFragmentToCanvas,
  onSendThreadToCanvas,
  onOpenCanvasOrigin,
  onFragmentDragStart,
  onFragmentDragEnd,
}: IdeaPaneProps) {
  const inbox = useMemo(() => threads.find((thread) => thread.kind === "inbox"), [threads]);
  const inboxId = inbox?.id ?? "";

  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IdeaFilter>("all");
  const [query, setQuery] = useState("");
  const [destId, setDestId] = useState<string>(inboxId);
  const [captureText, setCaptureText] = useState("");
  const [fragmentText, setFragmentText] = useState("");
  const [focusedFragmentId, setFocusedFragmentId] = useState<string | null>(null);

  const composingRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fragmentListRef = useRef<HTMLDivElement>(null);
  const focusTitleRef = useRef(false);
  const fragmentDragSourceRef = useRef<{ threadId: string; fragmentId: string } | null>(null);
  const lastReorderRef = useRef<string | null>(null);
  const lastFocusNonceRef = useRef<number | null>(null);
  const [reorderTarget, setReorderTarget] = useState<{
    fragmentId: string;
    position: "before" | "after";
  } | null>(null);

  const selected = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [threads, selectedId],
  );

  // 追加先が消えていたらインボックスへ戻す。
  useEffect(() => {
    if (!threads.some((thread) => thread.id === destId)) {
      setDestId(inboxId);
    }
  }, [threads, destId, inboxId]);

  // 選択中スレッドが消えたら一覧へ戻す。
  useEffect(() => {
    if (view === "detail" && !selected) {
      setView("list");
      setSelectedId(null);
    }
  }, [view, selected]);

  // 新規スレッド作成直後はタイトルへフォーカス。
  useEffect(() => {
    if (view === "detail" && focusTitleRef.current && titleInputRef.current) {
      focusTitleRef.current = false;
      // preventScroll: overflow:hidden のトラックが横スクロールして崩れるのを防ぐ。
      titleInputRef.current.focus({ preventScroll: true });
      titleInputRef.current.select();
    }
  }, [view, selectedId]);

  useEffect(() => {
    if (stageRef.current) {
      stageRef.current.scrollLeft = 0;
    }
  }, [view, selectedId]);

  useEffect(() => {
    if (!focusRequest || lastFocusNonceRef.current === focusRequest.nonce) return;
    lastFocusNonceRef.current = focusRequest.nonce;
    setSelectedId(focusRequest.threadId);
    setView("detail");
    setFocusedFragmentId(focusRequest.fragmentId ?? null);
  }, [focusRequest]);

  useEffect(() => {
    if (!focusedFragmentId) return;
    const frame = requestAnimationFrame(() => {
      const selector = `[data-idea-fragment-id="${CSS.escape(focusedFragmentId)}"]`;
      const list = fragmentListRef.current;
      const target = list?.querySelector<HTMLElement>(selector);
      if (stageRef.current) {
        stageRef.current.scrollLeft = 0;
      }
      if (list && target) {
        const listRect = list.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetCenter = targetRect.top - listRect.top + list.scrollTop + targetRect.height / 2;
        list.scrollTo({
          top: Math.max(0, targetCenter - list.clientHeight / 2),
          behavior: "smooth",
        });
      }
      if (stageRef.current) {
        stageRef.current.scrollLeft = 0;
      }
    });
    const timer = window.setTimeout(() => setFocusedFragmentId(null), 2200);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusedFragmentId, selectedId]);

  const visibleThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = (thread: IdeaThread) => {
      if (!normalized) return true;
      if (thread.title.toLowerCase().includes(normalized)) return true;
      return thread.fragments.some((fragment) =>
        fragment.body.toLowerCase().includes(normalized),
      );
    };
    const matchesFilter = (thread: IdeaThread) => {
      if (thread.kind === "inbox") return true;
      if (filter === "starred") return thread.starred;
      if (filter === "unused") return thread.fragments.some((fragment) => !fragment.used);
      return true;
    };
    return threads
      .filter((thread) => matchesFilter(thread) && matchesQuery(thread))
      .sort((a, b) => {
        if (a.kind === "inbox") return -1;
        if (b.kind === "inbox") return 1;
        return 0;
      });
  }, [threads, filter, query]);

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    submit: () => void,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const submitCapture = () => {
    const body = captureText.trim();
    if (!body) return;
    onCapture(body, destId || inboxId);
    setCaptureText("");
  };

  const submitFragment = () => {
    const body = fragmentText.trim();
    if (!body || !selected) return;
    onAddFragment(selected.id, body);
    setFragmentText("");
    requestAnimationFrame(() => {
      const list = fragmentListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
  };

  const openThread = (threadId: string) => {
    setSelectedId(threadId);
    setView("detail");
  };

  const handleCreateThread = () => {
    const id = onCreateThread();
    focusTitleRef.current = true;
    openThread(id);
  };

  const handleFragmentDragStartLocal = (
    event: DragEvent<HTMLElement>,
    threadId: string,
    fragmentId: string,
  ) => {
    fragmentDragSourceRef.current = { threadId, fragmentId };
    lastReorderRef.current = null;
    event.dataTransfer.effectAllowed = "copyMove";
    onFragmentDragStart(event, threadId, fragmentId);
  };

  const handleFragmentDragEndLocal = () => {
    fragmentDragSourceRef.current = null;
    lastReorderRef.current = null;
    setReorderTarget(null);
    onFragmentDragEnd();
  };

  const handleFragmentDragOver = (
    event: DragEvent<HTMLElement>,
    threadId: string,
    targetFragmentId: string,
  ) => {
    const source = fragmentDragSourceRef.current;
    if (!source || source.threadId !== threadId || source.fragmentId === targetFragmentId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const reorderKey = `${source.fragmentId}:${targetFragmentId}:${position}`;
    setReorderTarget({ fragmentId: targetFragmentId, position });

    if (lastReorderRef.current === reorderKey) return;
    lastReorderRef.current = reorderKey;
    onReorderFragment(threadId, source.fragmentId, targetFragmentId, position);
  };

  const handleFragmentDrop = (event: DragEvent<HTMLElement>) => {
    if (!fragmentDragSourceRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    lastReorderRef.current = null;
    setReorderTarget(null);
  };

  return (
    <section className="ideaPane" aria-label="Idea">
      <div className="ideaStage" ref={stageRef}>
        <div className={`ideaTrack ${view === "detail" ? "showDetail" : ""}`}>
          {/* ① 一覧ビュー */}
          <section className="ideaView" aria-label="スレッド一覧">
            <div className="ideaViewTop">
              <div className="ideaTopRow">
                <input
                  className="ideaSearchInput"
                  type="search"
                  value={query}
                  placeholder="検索"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button className="ideaNewThread" type="button" onClick={handleCreateThread}>
                  <PlusIcon />
                  <span>スレッド</span>
                </button>
              </div>

              <div className="ideaCapture">
                <div className="ideaCaptureBox">
                  <textarea
                    value={captureText}
                    rows={2}
                    placeholder="メモを書いて Enter で追加…"
                    onChange={(event) => setCaptureText(event.target.value)}
                    onCompositionStart={() => (composingRef.current = true)}
                    onCompositionEnd={() => (composingRef.current = false)}
                    onKeyDown={(event) => handleComposerKeyDown(event, submitCapture)}
                  />
                  <div className="ideaCaptureRow">
                    <select
                      className="ideaDestSelect"
                      aria-label="追加先スレッド"
                      value={destId}
                      onChange={(event) => setDestId(event.target.value)}
                    >
                      {threads.map((thread) => (
                        <option key={thread.id} value={thread.id}>
                          {thread.kind === "inbox" ? "▾ " : ""}
                          {thread.title}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ideaPrimaryBtn"
                      type="button"
                      disabled={!captureText.trim()}
                      onClick={submitCapture}
                    >
                      <SendIcon />
                      <span>追加</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="ideaChipsRow">
                <div className="ideaChips" aria-label="フィルタ">
                  {FILTERS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`ideaChip ${filter === value ? "isActive" : ""}`}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="ideaScroll">
              {visibleThreads.length === 0 ? (
                <div className="ideaEmpty">該当するスレッドがありません</div>
              ) : (
                visibleThreads.map((thread) => {
                  const unused = thread.fragments.filter((fragment) => !fragment.used).length;
                  return (
                    <article
                      key={thread.id}
                      className={`ideaThreadRow ${thread.kind === "inbox" ? "isInbox" : ""}`}
                      onClick={() => openThread(thread.id)}
                    >
                      <div className="ideaRowMain">
                        <div className="ideaRowTitle">
                          {thread.starred && (
                            <span className="ideaRowStar" aria-label="スター">
                              <StarIcon />
                            </span>
                          )}
                          {thread.title}
                        </div>
                        <div className="ideaRowSummary">{summarize(thread)}</div>
                        <div className="ideaRowMeta">
                          <span>{thread.fragments.length} 断片</span>
                          {unused > 0 ? (
                            <span className="unused">{unused} 未使用</span>
                          ) : (
                            <span>消化済み</span>
                          )}
                        </div>
                      </div>
                      <div className="ideaRowChevron">
                        <ChevronRightIcon />
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          {/* ② 詳細ビュー */}
          <section className="ideaView" aria-label="スレッド詳細">
            {selected && (
              <>
                <div className="ideaViewTop ideaDetailTop">
                  <div className="ideaDetailNav">
                    <button
                      className="ideaBackBtn"
                      type="button"
                      onClick={() => setView("list")}
                    >
                      <ChevronLeftIcon />
                      <span>一覧</span>
                    </button>
                    <div className="ideaDetailActions">
                      {selected.kind !== "inbox" && (
                        <button
                          className={`ideaIconBtn ${selected.starred ? "isOn" : ""}`}
                          type="button"
                          aria-label="スター"
                          title="スター"
                          onClick={() => onToggleStar(selected.id)}
                        >
                          <StarIcon />
                        </button>
                      )}
                      <button
                        className="ideaIconBtn"
                        type="button"
                        aria-label="未使用をまとめて本文へ"
                        title="未使用をまとめて本文へ"
                        onClick={() => onInsertThread(selected.id)}
                      >
                        <InsertAllIcon />
                      </button>
                      {onSendThreadToCanvas && (
                        <button
                          className="ideaIconBtn"
                          type="button"
                          aria-label="スレッドを Canvas へ送る"
                          title="スレッドを Canvas へ送る"
                          onClick={() => onSendThreadToCanvas(selected.id)}
                        >
                          <CanvasSendIcon />
                        </button>
                      )}
                      {selected.kind !== "inbox" && (
                        <button
                          className="ideaIconBtn"
                          type="button"
                          aria-label="スレッドを削除"
                          title="スレッドを削除"
                          onClick={() => onDeleteThread(selected.id)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>

                  <input
                    ref={titleInputRef}
                    className="ideaDetailTitle"
                    aria-label="スレッド名"
                    value={selected.title}
                    readOnly={selected.kind === "inbox"}
                    onChange={(event) => onRenameThread(selected.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                  />

                  <div className="ideaDetailStats">
                    <span>{selected.fragments.length} 断片</span>
                    {selected.fragments.some((fragment) => !fragment.used) ? (
                      <span className="unused">
                        {selected.fragments.filter((fragment) => !fragment.used).length} 未使用
                      </span>
                    ) : (
                      <span>消化済み</span>
                    )}
                  </div>

                  <div className="ideaCapture ideaCaptureInline">
                    <div className="ideaCaptureBox">
                      <textarea
                        value={fragmentText}
                        rows={2}
                        placeholder="断片を書いて Enter で追加…"
                        onChange={(event) => setFragmentText(event.target.value)}
                        onCompositionStart={() => (composingRef.current = true)}
                        onCompositionEnd={() => (composingRef.current = false)}
                        onKeyDown={(event) => handleComposerKeyDown(event, submitFragment)}
                      />
                      <div className="ideaCaptureRow ideaCaptureRowEnd">
                        <button
                          className="ideaPrimaryBtn"
                          type="button"
                          disabled={!fragmentText.trim()}
                          onClick={submitFragment}
                        >
                          <PlusIcon />
                          <span>追加</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ideaScroll" ref={fragmentListRef}>
                  {selected.fragments.length === 0 ? (
                    <div className="ideaEmpty">
                      まだ断片がありません。
                      <br />
                      上の入力欄から書き溜めましょう。
                    </div>
                  ) : (
                    selected.fragments.map((fragment) => (
                      <article
                        key={fragment.id}
                        className={`ideaFragment ${fragment.used ? "isUsed" : ""} ${
                          draggingId === fragment.id ? "isDragging" : ""
                        } ${
                          focusedFragmentId === fragment.id ? "isFocusedOrigin" : ""
                        } ${
                          reorderTarget?.fragmentId === fragment.id
                            ? `isReorderTarget isReorder${reorderTarget.position}`
                            : ""
                        }`}
                        data-idea-fragment-id={fragment.id}
                        onDragOver={(event) =>
                          handleFragmentDragOver(event, selected.id, fragment.id)
                        }
                        onDrop={handleFragmentDrop}
                      >
                        <span
                          className="ideaDragHandle"
                          draggable
                          title="ドラッグで並び替え / 本文へ"
                          onDragStart={(event) =>
                            handleFragmentDragStartLocal(event, selected.id, fragment.id)
                          }
                          onDragEnd={handleFragmentDragEndLocal}
                        >
                          <GripIcon />
                        </span>
                        <div>
                          <div
                            className="ideaFragmentBody"
                            contentEditable
                            spellCheck={false}
                            suppressContentEditableWarning
                            onBlur={(event) => {
                              const next = event.currentTarget.textContent ?? "";
                              if (next.trim()) {
                                onUpdateFragment(selected.id, fragment.id, next);
                              } else {
                                event.currentTarget.textContent = fragment.body;
                              }
                            }}
                          >
                            {fragment.body}
                          </div>
                          <div className="ideaFragmentFoot">
                            <select
                              className="ideaMoveSelect"
                              aria-label="別スレッドへ移動"
                              title="別スレッドへ移動"
                              value=""
                              onChange={(event) => {
                                if (event.target.value) {
                                  onMoveFragment(selected.id, fragment.id, event.target.value);
                                }
                              }}
                            >
                              <option value="">移動…</option>
                              {threads
                                .filter((thread) => thread.id !== selected.id)
                                .map((thread) => (
                                  <option key={thread.id} value={thread.id}>
                                    {thread.kind === "inbox" ? "▾ " : ""}
                                    {thread.title}
                                  </option>
                                ))}
                            </select>
                            <span className="ideaFragmentBtns">
                              <button
                                className="ideaMiniIcon"
                                type="button"
                                aria-label="本文へ挿入"
                                title="本文へ挿入"
                                onClick={() => onInsertFragment(selected.id, fragment.id)}
                              >
                                <SendIcon />
                              </button>
                              {onSendFragmentToCanvas && (
                                <button
                                  className="ideaMiniIcon"
                                  type="button"
                                  aria-label="Canvas へ送る"
                                  title="Canvas へ送る"
                                  onClick={() => onSendFragmentToCanvas(selected.id, fragment.id)}
                                >
                                  <CanvasSendIcon />
                                </button>
                              )}
                              {fragment.originRef && onOpenCanvasOrigin && (
                                <button
                                  className="ideaMiniIcon"
                                  type="button"
                                  aria-label="元 Canvas を開く"
                                  title="元 Canvas を開く"
                                  onClick={() => onOpenCanvasOrigin(fragment.originRef!)}
                                >
                                  <CanvasOriginIcon />
                                </button>
                              )}
                              <button
                                className={`ideaMiniIcon ${fragment.used ? "isOn" : ""}`}
                                type="button"
                                aria-label="使用済み"
                                title="使用済み"
                                onClick={() => onToggleUsed(selected.id, fragment.id)}
                              >
                                <CheckIcon />
                              </button>
                              <button
                                className="ideaMiniIcon"
                                type="button"
                                aria-label="削除"
                                title="削除"
                                onClick={() => onDeleteFragment(selected.id, fragment.id)}
                              >
                                <TrashIcon />
                              </button>
                            </span>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
