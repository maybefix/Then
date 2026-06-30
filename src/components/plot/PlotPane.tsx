import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import type { PlotCard } from "../../types";
import { getScaledFixedMenuPosition } from "../../utils/contextMenuPosition";

// Portal target for plot dialogs. PlotPane lives inside the right sidebar, which
// is scaled by the UI zoom (--ui-font-scale); rendering a modal there would
// double-zoom it and clip it to the sidebar. Mount at the .appShell root instead
// so it inherits the theme + scale variables but escapes the chrome zoom.
const modalRoot = (): HTMLElement =>
  (document.querySelector(".appShell") as HTMLElement | null) ?? document.body;

type PlotIconName = "grip" | "list" | "bookmark";

type PlotCardStyle = CSSProperties & {
  "--plot-body-columns"?: number;
};

const PLOT_CONTEXT_MENU_WIDTH = 180;
const PLOT_CONTEXT_MENU_HEIGHT = 92;
const DEFAULT_ROWS_PER_COLUMN = 24;
const SCROLL_PIN_TOLERANCE = 16;

const countTextUnits = (text: string) => Array.from(text).length;

const estimatePlotColumns = (text: string, rowsPerColumn = DEFAULT_ROWS_PER_COLUMN) => {
  const rows = Math.max(1, rowsPerColumn);
  const lines = text.split("\n");

  return Math.max(
    1,
    lines.reduce((total, line) => total + Math.max(1, Math.ceil(countTextUnits(line) / rows)), 0),
  );
};

const getRowsPerColumn = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  const fontSize = Number.parseFloat(style.fontSize);
  const letterSpacing = style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const availableHeight = element.clientHeight - paddingTop - paddingBottom;
  const glyphAdvance = fontSize + (Number.isFinite(letterSpacing) ? letterSpacing : 0);

  if (!Number.isFinite(glyphAdvance) || glyphAdvance <= 0 || availableHeight <= 0) {
    return DEFAULT_ROWS_PER_COLUMN;
  }

  return Math.max(1, Math.floor(availableHeight / glyphAdvance));
};

export const renumberPlotCards = (cards: PlotCard[]) => {
  let sectionIndex = 0;
  return cards.map((card) => {
    if (card.kind === "chapter") return { ...card, num: "" };
    sectionIndex += 1;
    return { ...card, num: String(sectionIndex).padStart(3, "0") };
  });
};

export const appendPlotSection = (cards: PlotCard[]) =>
  renumberPlotCards([
    ...cards,
    {
      id: `plot-${Date.now()}`,
      kind: "section",
      num: "",
      title: "",
      body: "",
      expanded: false,
      managerCollapsed: false,
    },
  ]);

export const appendPlotChapter = (cards: PlotCard[]) =>
  renumberPlotCards([
    ...cards,
    {
      id: `chapter-${Date.now()}`,
      kind: "chapter",
      num: "",
      title: "",
      body: "",
      expanded: true,
      managerCollapsed: false,
    },
  ]);

const getPlotContextMenuStyle = (x: number, y: number): CSSProperties => {
  return getScaledFixedMenuPosition(x, y, {
    width: PLOT_CONTEXT_MENU_WIDTH,
    height: PLOT_CONTEXT_MENU_HEIGHT,
  });
};

/** 章ごとに [章カード, ...配下のセクション] をまとめたグループ列を返す。
 *  先頭の章ラベルが付く前のセクション群は chapter=null の「冒頭」グループになる。 */
type PlotChapterGroup = { chapter: PlotCard | null; sections: PlotCard[] };

const groupByChapter = (cards: PlotCard[]): PlotChapterGroup[] => {
  const groups: PlotChapterGroup[] = [];
  let current: PlotChapterGroup = { chapter: null, sections: [] };
  let hasCurrent = false;

  for (const card of cards) {
    if (card.kind === "chapter") {
      if (hasCurrent || current.sections.length > 0) groups.push(current);
      current = { chapter: card, sections: [] };
      hasCurrent = true;
    } else {
      current.sections.push(card);
    }
  }
  if (hasCurrent || current.sections.length > 0) groups.push(current);

  return groups;
};

function PlotIcon({ name }: { name: PlotIconName }) {
  const common = {
    "aria-hidden": true,
    focusable: false,
    viewBox: "0 0 24 24",
  };

  switch (name) {
    case "grip":
      return (
        <svg {...common}>
          <circle cx="9" cy="6" r="1.2" />
          <circle cx="15" cy="6" r="1.2" />
          <circle cx="9" cy="12" r="1.2" />
          <circle cx="15" cy="12" r="1.2" />
          <circle cx="9" cy="18" r="1.2" />
          <circle cx="15" cy="18" r="1.2" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case "bookmark":
      return (
        <svg {...common}>
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
        </svg>
      );
  }
}

function usePlotBodyColumns(cards: PlotCard[], isExpanded: (card: PlotCard) => boolean) {
  const [bodyColumns, setBodyColumns] = useState<Record<string, number>>({});
  const bodyRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const composingCardIds = useRef<Set<string>>(new Set());

  const setBodyRef = useCallback(
    (cardId: string) => (element: HTMLTextAreaElement | null) => {
      if (element) {
        bodyRefs.current.set(cardId, element);
        return;
      }

      bodyRefs.current.delete(cardId);
    },
    [],
  );

  const setCardColumns = useCallback((cardId: string, columns: number) => {
    setBodyColumns((current) =>
      current[cardId] === columns ? current : { ...current, [cardId]: columns },
    );
  }, []);

  const syncBodyColumns = useCallback(
    (cardId: string, text: string, element?: HTMLElement | null) => {
      if (composingCardIds.current.has(cardId)) return;

      const rowsPerColumn = element ? getRowsPerColumn(element) : DEFAULT_ROWS_PER_COLUMN;
      const columns = estimatePlotColumns(text, rowsPerColumn);
      setCardColumns(cardId, columns);
    },
    [setCardColumns],
  );

  useLayoutEffect(() => {
    cards.forEach((card) => {
      if (card.kind === "chapter") return;
      if (!isExpanded(card)) return;
      if (composingCardIds.current.has(card.id)) return;

      const element = bodyRefs.current.get(card.id);
      syncBodyColumns(card.id, card.body, element);
    });
  }, [cards, isExpanded, syncBodyColumns]);

  return { bodyColumns, setBodyRef, syncBodyColumns, composingCardIds };
}

type PlotBoardProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
  /** 管理画面モード: 折りたたみ状態を保存データではなくローカルに持ち、初期は全展開。 */
  managerMode?: boolean;
  className?: string;
};

function PlotBoard({
  cards,
  onCardsChange,
  managerMode = false,
  className,
}: PlotBoardProps) {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ cardId: string; x: number; y: number } | null>(
    null,
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToRightRef = useRef(true);
  const draggingCardIdRef = useRef<string | null>(null);
  // 初回表示で先頭（右端）に合わせたかどうかの判定に使う直前の scrollWidth。
  const prevScrollWidthRef = useRef(0);
  const prevClientWidthRef = useRef(0);

  // セクションは本文表示、章は配下セクションの表示可否を表す共通の「展開」状態。
  // 管理画面は card.managerCollapsed（右サイドバーの expanded とは独立・保存対象）を見る。
  const isCardExpanded = useCallback(
    (card: PlotCard) => (managerMode ? !card.managerCollapsed : card.expanded),
    [managerMode],
  );

  const { bodyColumns, setBodyRef, syncBodyColumns, composingCardIds } = usePlotBodyColumns(
    cards,
    isCardExpanded,
  );

  const visualCards = [...cards].reverse();

  // 章ごとのセクション数と、折りたたまれた章の配下セクション（描画しない）を求める。
  const sectionCountByChapter = new Map<string, number>();
  const hiddenSectionIds = new Set<string>();
  {
    let currentChapter: PlotCard | null = null;
    for (const card of cards) {
      if (card.kind === "chapter") {
        currentChapter = card;
        sectionCountByChapter.set(card.id, 0);
      } else if (currentChapter) {
        sectionCountByChapter.set(
          currentChapter.id,
          (sectionCountByChapter.get(currentChapter.id) ?? 0) + 1,
        );
        if (!isCardExpanded(currentChapter)) hiddenSectionIds.add(card.id);
      }
    }
  }

  const moveCard = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;

      onCardsChange((current) => {
        const visualOrder = [...current].reverse();
        const draggedIndex = visualOrder.findIndex((card) => card.id === draggedId);
        const targetVisualIndex = visualOrder.findIndex((card) => card.id === targetId);
        const draggedCard = visualOrder.find((card) => card.id === draggedId);
        if (!draggedCard || draggedIndex < 0 || targetVisualIndex < 0) return current;

        const withoutDragged = visualOrder.filter((card) => card.id !== draggedId);
        const targetIndex = withoutDragged.findIndex((card) => card.id === targetId);
        if (targetIndex < 0) return current;

        const nextVisualOrder = [...withoutDragged];
        const insertIndex = draggedIndex < targetVisualIndex ? targetIndex + 1 : targetIndex;
        nextVisualOrder.splice(insertIndex, 0, draggedCard);

        return renumberPlotCards([...nextVisualOrder].reverse());
      });
    },
    [onCardsChange],
  );

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    const maxScrollLeft = Math.max(0, pane.scrollWidth - pane.clientWidth);
    const prevMaxScrollLeft = Math.max(
      0,
      prevScrollWidthRef.current - prevClientWidthRef.current,
    );
    const wasPinnedBeforeLayout =
      prevScrollWidthRef.current === 0 ||
      isPinnedToRightRef.current ||
      Math.abs(pane.scrollLeft - prevMaxScrollLeft) < SCROLL_PIN_TOLERANCE;

    if (wasPinnedBeforeLayout) {
      let frames = 4;
      let frameId = 0;
      const pinToRight = () => {
        const nextMaxScrollLeft = Math.max(0, pane.scrollWidth - pane.clientWidth);
        pane.scrollLeft = nextMaxScrollLeft;
        isPinnedToRightRef.current = true;
        prevScrollWidthRef.current = pane.scrollWidth;
        prevClientWidthRef.current = pane.clientWidth;

        if (--frames > 0) {
          frameId = requestAnimationFrame(pinToRight);
        }
      };

      pinToRight();
      return () => {
        if (frameId) cancelAnimationFrame(frameId);
      };
    }
    prevScrollWidthRef.current = pane.scrollWidth;
    prevClientWidthRef.current = pane.clientWidth;
  }, [bodyColumns, cards, managerMode]);

  useLayoutEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const handleKeyDown = (event: WindowEventMap["keydown"]) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!draggingCardId) return;

    const handlePointerMove = (event: PointerEvent) => {
      const draggedId = draggingCardIdRef.current;
      if (!draggedId) return;

      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-plot-card-id]");
      const targetId = target?.dataset.plotCardId;

      if (targetId && targetId !== draggedId) {
        event.preventDefault();
        moveCard(draggedId, targetId);
      }
    };

    const handlePointerUp = () => {
      draggingCardIdRef.current = null;
      setDraggingCardId(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingCardId, moveCard]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const pane = event.currentTarget;
    const maxScrollLeft = pane.scrollWidth - pane.clientWidth;

    if (maxScrollLeft <= 0) return;

    const dominantDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    if (dominantDelta === 0) return;

    event.preventDefault();
    pane.scrollLeft = Math.min(maxScrollLeft, Math.max(0, pane.scrollLeft - dominantDelta));
    isPinnedToRightRef.current = Math.abs(pane.scrollLeft - maxScrollLeft) < 2;
  };

  const handleScroll = () => {
    const pane = paneRef.current;
    if (!pane) return;

    const maxScrollLeft = pane.scrollWidth - pane.clientWidth;
    isPinnedToRightRef.current =
      maxScrollLeft <= 0 || Math.abs(pane.scrollLeft - maxScrollLeft) < SCROLL_PIN_TOLERANCE;
  };

  /** トグル対象カードの柱（番号バッジ）の画面位置。再レイアウト後に同じ位置へ戻すための基準。 */
  const numScreenRight = (cardId: string): number | null => {
    const pane = paneRef.current;
    const numEl = pane?.querySelector<HTMLElement>(
      `[data-plot-card-id="${CSS.escape(cardId)}"] .plotCardNum`,
    );
    if (!pane || !numEl) return null;
    return numEl.getBoundingClientRect().right - pane.getBoundingClientRect().left;
  };

  const toggleCard = (cardId: string) => {
    // トグル前に柱の画面位置を記録。開閉で本文幅が変わっても柱の見た目位置を据え置く。
    // 再レイアウトが複数フレームに分かれても追従できるよう、数フレーム合わせ直す。
    const pane = paneRef.current;
    const beforeRight = numScreenRight(cardId);
    if (pane && beforeRight !== null) {
      let frames = 4;
      const repin = () => {
        const currentRight = numScreenRight(cardId);
        if (currentRight !== null) {
          const maxScrollLeft = Math.max(0, pane.scrollWidth - pane.clientWidth);
          pane.scrollLeft = Math.max(
            0,
            Math.min(maxScrollLeft, pane.scrollLeft + (currentRight - beforeRight)),
          );
        }
        if (--frames > 0) requestAnimationFrame(repin);
      };
      requestAnimationFrame(repin);
    }

    if (managerMode) {
      onCardsChange((current) =>
        current.map((card) =>
          card.id === cardId ? { ...card, managerCollapsed: !card.managerCollapsed } : card,
        ),
      );
      return;
    }

    onCardsChange((current) =>
      current.map((card) =>
        card.id === cardId ? { ...card, expanded: !card.expanded } : card,
      ),
    );
  };

  const updateCard = (cardId: string, patch: Partial<Pick<PlotCard, "title" | "body">>) => {
    onCardsChange((current) =>
      current.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
  };

  const deleteCard = (cardId: string) => {
    setDeletingCardId(cardId);
  };

  const confirmDelete = () => {
    if (!deletingCardId) return;
    const id = deletingCardId;
    onCardsChange((current) => renumberPlotCards(current.filter((item) => item.id !== id)));
    setDeletingCardId(null);
  };

  const handleCardContextMenu = (cardId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ cardId, x: event.clientX, y: event.clientY });
  };

  /** セクションを指定章（chapterId===null は冒頭グループ）の末尾へ移動する。 */
  const moveSectionToChapter = (sectionId: string, chapterId: string | null) => {
    onCardsChange((current) => {
      const section = current.find((card) => card.id === sectionId);
      if (!section || section.kind !== "section") return current;

      const without = current.filter((card) => card.id !== sectionId);

      let insertAt: number;
      if (chapterId === null) {
        const firstChapter = without.findIndex((card) => card.kind === "chapter");
        insertAt = firstChapter === -1 ? without.length : firstChapter;
      } else {
        const chapterIndex = without.findIndex((card) => card.id === chapterId);
        if (chapterIndex === -1) return current;
        let end = chapterIndex + 1;
        while (end < without.length && without[end].kind !== "chapter") end += 1;
        insertAt = end;
      }

      const next = [...without];
      next.splice(insertAt, 0, section);
      return renumberPlotCards(next);
    });
  };

  const handleCardDragStart = (cardId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDraggingCardId(cardId);
    draggingCardIdRef.current = cardId;
  };

  const handleBodyChange = (cardId: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    const body = event.currentTarget.value;
    updateCard(cardId, { body });

    if (!composingCardIds.current.has(cardId)) {
      syncBodyColumns(cardId, body, event.currentTarget);
    }
  };

  const handleBodyCompositionStart = (cardId: string) => {
    composingCardIds.current.add(cardId);
  };

  const handleBodyCompositionEnd = (
    cardId: string,
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composingCardIds.current.delete(cardId);
    const body = event.currentTarget.value;
    updateCard(cardId, { body });
    syncBodyColumns(cardId, body, event.currentTarget);
  };

  const handleTitleChange = (cardId: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    updateCard(cardId, { title: event.currentTarget.value.replace(/\r?\n/g, " ") });
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.blur();
  };

  const getPlotCardStyle = (card: PlotCard, expanded: boolean): PlotCardStyle => ({
    "--plot-body-columns": expanded
      ? bodyColumns[card.id] ?? estimatePlotColumns(card.body)
      : 1,
  });

  return (
    <>
      <div
        ref={paneRef}
        className={`plotPane ${className ?? ""}`.trim()}
        aria-label="Plot"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        <div className="plotTrack">
          {visualCards.map((card) => {
            if (card.kind === "chapter") {
              const chapterOpen = isCardExpanded(card);
              const count = sectionCountByChapter.get(card.id) ?? 0;

              return (
                <section
                  className={`plotChapterBand ${chapterOpen ? "" : "collapsedPlotChapterBand"} ${
                    draggingCardId === card.id ? "draggingPlotCard" : ""
                  }`}
                  key={card.id}
                  data-plot-card-id={card.id}
                  onContextMenu={(event) => handleCardContextMenu(card.id, event)}
                >
                  <div className="plotCardToolbar">
                    <button
                      className="plotToolButton plotDragHandle"
                      type="button"
                      aria-label="章をドラッグして並び替え"
                      title="ドラッグして並び替え"
                      onPointerDown={(event) => handleCardDragStart(card.id, event)}
                    >
                      <PlotIcon name="grip" />
                    </button>
                  </div>
                  <span className="plotChapterMark" aria-hidden="true">
                    <PlotIcon name="bookmark" />
                  </span>
                  <textarea
                    className="plotChapterTitle"
                    value={card.title}
                    placeholder="章のタイトル…"
                    spellCheck={false}
                    wrap="off"
                    aria-label="章のタイトル"
                    onChange={(event) => handleTitleChange(card.id, event)}
                    onKeyDown={handleTitleKeyDown}
                  />
                  {!chapterOpen && count > 0 && (
                    <span className="plotChapterCount" aria-hidden="true">
                      {count}
                    </span>
                  )}
                  <button
                    className="plotCardToggle"
                    type="button"
                    aria-label={chapterOpen ? "章を折りたたむ" : "章を展開する"}
                    title={chapterOpen ? "章を折りたたむ" : "章を展開する"}
                    onClick={() => toggleCard(card.id)}
                  >
                    {chapterOpen ? "›" : "‹"}
                  </button>
                </section>
              );
            }

            if (hiddenSectionIds.has(card.id)) return null;

            const expanded = isCardExpanded(card);

            return (
              <article
                className={`plotCard ${expanded ? "expandedPlotCard" : ""} ${
                  draggingCardId === card.id ? "draggingPlotCard" : ""
                }`}
                key={card.id}
                data-plot-card-id={card.id}
                style={getPlotCardStyle(card, expanded)}
                onContextMenu={(event) => handleCardContextMenu(card.id, event)}
              >
                <div className="plotCardToolbar">
                  <button
                    className="plotToolButton plotDragHandle"
                    type="button"
                    aria-label={`${card.num} をドラッグして並び替え`}
                    title="ドラッグして並び替え"
                    onPointerDown={(event) => handleCardDragStart(card.id, event)}
                  >
                    <PlotIcon name="grip" />
                  </button>
                </div>
                <button
                  className="plotCardNum"
                  type="button"
                  onClick={() => toggleCard(card.id)}
                  title="クリックで展開/折りたたみ"
                >
                  {card.num}
                </button>
                <div className="plotCardContent">
                  <textarea
                    className="plotCardTitle"
                    value={card.title}
                    placeholder="タイトル…"
                    readOnly={!expanded}
                    spellCheck={false}
                    tabIndex={expanded ? 0 : -1}
                    wrap="off"
                    aria-label={`${card.num} タイトル`}
                    onChange={(event) => handleTitleChange(card.id, event)}
                    onKeyDown={handleTitleKeyDown}
                  />
                  {expanded && (
                    <textarea
                      ref={setBodyRef(card.id)}
                      className="plotCardBody"
                      value={card.body}
                      placeholder="本文…"
                      aria-multiline="true"
                      aria-label={`${card.num} 本文`}
                      spellCheck={false}
                      wrap="soft"
                      onChange={(event) => handleBodyChange(card.id, event)}
                      onCompositionStart={() => handleBodyCompositionStart(card.id)}
                      onCompositionEnd={(event) => handleBodyCompositionEnd(card.id, event)}
                    />
                  )}
                </div>
                <button
                  className="plotCardToggle"
                  type="button"
                  aria-label={expanded ? "折りたたむ" : "展開する"}
                  title={expanded ? "折りたたむ" : "展開する"}
                  onClick={() => toggleCard(card.id)}
                >
                  {expanded ? "›" : "‹"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
      {movingCardId && (
        <PlotMoveModal
          cards={cards}
          sectionId={movingCardId}
          onClose={() => setMovingCardId(null)}
          onMove={(chapterId) => {
            moveSectionToChapter(movingCardId, chapterId);
            setMovingCardId(null);
          }}
        />
      )}
      {deletingCardId && (
        <PlotDeleteDialog
          card={cards.find((card) => card.id === deletingCardId) ?? null}
          onCancel={() => setDeletingCardId(null)}
          onConfirm={confirmDelete}
        />
      )}
      {contextMenu &&
        createPortal(
          (() => {
          const card = cards.find((item) => item.id === contextMenu.cardId);
          if (!card) return null;
          const isChapter = card.kind === "chapter";

          return (
            <div
              ref={contextMenuRef}
              className="editorContextMenu plotContextMenu"
              role="menu"
              style={getPlotContextMenuStyle(contextMenu.x, contextMenu.y)}
            >
              <div className="contextMenuSection">
                {!isChapter && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMovingCardId(card.id);
                      setContextMenu(null);
                    }}
                  >
                    章へ移動…
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="plotContextDanger"
                  onClick={() => {
                    setContextMenu(null);
                    deleteCard(card.id);
                  }}
                >
                  {isChapter ? "章を削除" : "削除"}
                </button>
              </div>
            </div>
          );
        })(),
          modalRoot(),
        )}
    </>
  );
}

type PlotMoveModalProps = {
  cards: PlotCard[];
  sectionId: string;
  onClose: () => void;
  onMove: (chapterId: string | null) => void;
};

function PlotMoveModal({ cards, sectionId, onClose, onMove }: PlotMoveModalProps) {
  const groups = groupByChapter(cards);
  const currentChapterId =
    groups.find((group) => group.sections.some((section) => section.id === sectionId))?.chapter?.id ??
    null;
  const hasLeadingGroup = groups.some((group) => group.chapter === null);

  const options: { id: string | null; label: string }[] = [];
  if (hasLeadingGroup) {
    options.push({ id: null, label: "冒頭（章なし）" });
  }
  for (const group of groups) {
    if (!group.chapter) continue;
    options.push({ id: group.chapter.id, label: group.chapter.title.trim() || "（無題の章）" });
  }

  return createPortal(
    <div className="modalBackdrop" role="presentation" onClick={onClose}>
      <section
        className="modal compactModal plotMoveModal"
        aria-label="章へ移動"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modalHeader">
          <h2>章へ移動</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modalForm">
          {options.length === 0 ? (
            <p className="plotMoveEmpty">章がありません。先に「章を追加」してください。</p>
          ) : (
            <ul className="plotMoveList">
              {options.map((option) => (
                <li key={option.id ?? "__lead__"}>
                  <button
                    className="plotMoveOption"
                    type="button"
                    disabled={option.id === currentChapterId}
                    onClick={() => onMove(option.id)}
                  >
                    <span>{option.label}</span>
                    {option.id === currentChapterId && <small>現在の章</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="modalActions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>,
    modalRoot(),
  );
}

type PlotDeleteDialogProps = {
  card: PlotCard | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function PlotDeleteDialog({ card, onCancel, onConfirm }: PlotDeleteDialogProps) {
  if (!card) return null;

  const isChapter = card.kind === "chapter";
  const label = card.title.trim() || (isChapter ? "（無題の章）" : card.num);

  return createPortal(
    <div className="modalBackdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal compactModal"
        aria-label={isChapter ? "章を削除" : "プロットを削除"}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modalHeader">
          <h2>{isChapter ? "章を削除" : "プロットを削除"}</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onCancel}>
            ×
          </button>
        </header>
        <div className="modalForm">
          <div className="dialogMessage">
            <p>
              {isChapter ? `章「${label}」を削除しますか？` : `プロット「${label}」を削除しますか？`}
            </p>
            <span>
              {isChapter
                ? "配下のプロットは前の章に統合されます。この操作は取り消せません。"
                : "この操作は取り消せません。"}
            </span>
          </div>
          <footer className="modalActions">
            <button type="button" onClick={onCancel}>
              キャンセル
            </button>
            <button className="dangerAction" type="button" onClick={onConfirm}>
              削除
            </button>
          </footer>
        </div>
      </section>
    </div>,
    modalRoot(),
  );
}

type PlotPaneProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
  isManagerOpen?: boolean;
  onManagerOpenChange?: (open: boolean) => void;
};

type PlotPaneHeaderActionsProps = {
  onAddSection: () => void;
  onAddChapter: () => void;
  onOpenManager?: () => void;
};

export function PlotPaneHeaderActions({
  onAddSection,
  onAddChapter,
  onOpenManager,
}: PlotPaneHeaderActionsProps) {
  return (
    <div className="plotPaneHeaderActions" aria-label="プロット操作">
      <button
        className="sidebarIconButton plotHeaderActionButton"
        type="button"
        aria-label="セクションを追加"
        title="セクションを追加"
        onClick={onAddSection}
      >
        <span aria-hidden="true">＋</span>
      </button>
      <button
        className="sidebarIconButton plotHeaderActionButton"
        type="button"
        aria-label="章を追加"
        title="章を追加"
        onClick={onAddChapter}
      >
        <PlotIcon name="bookmark" />
      </button>
      {onOpenManager && (
        <button
          className="sidebarIconButton plotHeaderActionButton"
          type="button"
          aria-label="プロットを管理"
          title="プロットを管理"
          onClick={onOpenManager}
        >
          <PlotIcon name="list" />
        </button>
      )}
    </div>
  );
}

export function PlotPane({
  cards,
  onCardsChange,
  isManagerOpen,
  onManagerOpenChange,
}: PlotPaneProps) {
  const [localManagerOpen, setLocalManagerOpen] = useState(false);
  const managerOpen = isManagerOpen ?? localManagerOpen;
  const setManagerOpen = onManagerOpenChange ?? setLocalManagerOpen;

  return (
    <>
      <PlotBoard cards={cards} onCardsChange={onCardsChange} />
      {managerOpen && (
        <PlotManagerModal
          cards={cards}
          onCardsChange={onCardsChange}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </>
  );
}

type PlotManagerModalProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
  onClose: () => void;
};

function PlotManagerModal({ cards, onCardsChange, onClose }: PlotManagerModalProps) {
  const addSection = () => onCardsChange((current) => appendPlotSection(current));
  const addChapter = () => onCardsChange((current) => appendPlotChapter(current));

  return createPortal(
    <div className="modalBackdrop" role="presentation">
      <section
        className="modal plotManagerModal"
        aria-label="プロットを管理"
        role="dialog"
        aria-modal="true"
      >
        <header className="modalHeader">
          <h2>プロットを管理</h2>
          <PlotPaneHeaderActions onAddSection={addSection} onAddChapter={addChapter} />
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <PlotBoard
          cards={cards}
          onCardsChange={onCardsChange}
          managerMode
          className="plotManagerBoard"
        />
        <footer className="modalActions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>,
    modalRoot(),
  );
}
