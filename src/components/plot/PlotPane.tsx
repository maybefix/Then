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
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type WheelEvent,
} from "react";
import type { PlotCard } from "../../types";

type PlotIconName = "grip" | "trash" | "list" | "up" | "down";

type PlotCardStyle = CSSProperties & {
  "--plot-body-columns"?: number;
};

const DEFAULT_ROWS_PER_COLUMN = 24;

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

const renumberPlotCards = (cards: PlotCard[]) =>
  cards.map((card, index) => ({ ...card, num: String(index + 1).padStart(3, "0") }));

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
    case "trash":
      return (
        <svg {...common}>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
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
    case "up":
      return (
        <svg {...common}>
          <path d="m6 15 6-6 6 6" />
        </svg>
      );
    case "down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
  }
}

function usePlotBodyColumns(cards: PlotCard[], forceExpanded: boolean) {
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
      if (!forceExpanded && !card.expanded) return;
      if (composingCardIds.current.has(card.id)) return;

      const element = bodyRefs.current.get(card.id);
      syncBodyColumns(card.id, card.body, element);
    });
  }, [cards, forceExpanded, syncBodyColumns]);

  return { bodyColumns, setBodyRef, syncBodyColumns, composingCardIds };
}

type PlotBoardProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
  /** When true every card is rendered expanded and the collapse toggle is hidden. */
  forceExpanded?: boolean;
  onOpenManager?: () => void;
  className?: string;
};

function PlotBoard({
  cards,
  onCardsChange,
  forceExpanded = false,
  onOpenManager,
  className,
}: PlotBoardProps) {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToRightRef = useRef(true);
  const draggingCardIdRef = useRef<string | null>(null);
  const { bodyColumns, setBodyRef, syncBodyColumns, composingCardIds } = usePlotBodyColumns(
    cards,
    forceExpanded,
  );

  const visualCards = [...cards].reverse();

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
    if (!pane || !isPinnedToRightRef.current) return;

    pane.scrollLeft = Math.max(0, pane.scrollWidth - pane.clientWidth);
  }, [bodyColumns, cards.length]);

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
    isPinnedToRightRef.current = maxScrollLeft <= 0 || Math.abs(pane.scrollLeft - maxScrollLeft) < 2;
  };

  const toggleCard = (cardId: string) => {
    if (forceExpanded) return;

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
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;

    const label = card.title.trim() || card.num;
    if (!window.confirm(`プロット「${label}」を削除しますか？`)) return;

    onCardsChange((current) => renumberPlotCards(current.filter((item) => item.id !== cardId)));
  };

  const addCard = () => {
    onCardsChange((current) => {
      const nextIndex = current.length + 1;
      return [
        ...current,
        {
          id: `plot-${Date.now()}`,
          num: String(nextIndex).padStart(3, "0"),
          title: "",
          body: "",
          expanded: forceExpanded,
        },
      ];
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
    <div
      ref={paneRef}
      className={`plotPane ${className ?? ""}`.trim()}
      aria-label="Plot"
      onScroll={handleScroll}
      onWheel={handleWheel}
    >
      <div className="plotTrack">
        <div className="plotTrackActions">
          <button
            className="plotAddButton"
            type="button"
            aria-label="プロットを追加"
            title="プロットを追加"
            onClick={addCard}
          >
            ＋
          </button>
          {onOpenManager && (
            <button
              className="plotToolButton"
              type="button"
              aria-label="プロットを管理"
              title="プロットを管理"
              onClick={onOpenManager}
            >
              <PlotIcon name="list" />
            </button>
          )}
        </div>
        {visualCards.map((card) => {
          const expanded = forceExpanded || card.expanded;

          return (
            <article
              className={`plotCard ${expanded ? "expandedPlotCard" : ""} ${
                draggingCardId === card.id ? "draggingPlotCard" : ""
              }`}
              key={card.id}
              data-plot-card-id={card.id}
              style={getPlotCardStyle(card, expanded)}
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
                <button
                  className="plotToolButton dangerPlotToolButton"
                  type="button"
                  aria-label={`${card.num} を削除`}
                  title="プロットを削除"
                  onClick={() => deleteCard(card.id)}
                >
                  <PlotIcon name="trash" />
                </button>
              </div>
              <button
                className="plotCardNum"
                type="button"
                onClick={() => toggleCard(card.id)}
                title={forceExpanded ? undefined : "クリックで展開/折りたたみ"}
                aria-disabled={forceExpanded || undefined}
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
              {!forceExpanded && (
                <button
                  className="plotCardToggle"
                  type="button"
                  aria-label={card.expanded ? "折りたたむ" : "展開する"}
                  title={card.expanded ? "折りたたむ" : "展開する"}
                  onClick={() => toggleCard(card.id)}
                >
                  {card.expanded ? "›" : "‹"}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

type PlotPaneProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
};

export function PlotPane({ cards, onCardsChange }: PlotPaneProps) {
  const [isManagerOpen, setIsManagerOpen] = useState(false);

  return (
    <>
      <PlotBoard
        cards={cards}
        onCardsChange={onCardsChange}
        onOpenManager={() => setIsManagerOpen(true)}
      />
      {isManagerOpen && (
        <PlotManagerModal
          cards={cards}
          onCardsChange={onCardsChange}
          onClose={() => setIsManagerOpen(false)}
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
  return (
    <div className="modalBackdrop" role="presentation">
      <section
        className="modal plotManagerModal"
        aria-label="プロットを管理"
        role="dialog"
        aria-modal="true"
      >
        <header className="modalHeader">
          <h2>プロットを管理</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <PlotBoard
          cards={cards}
          onCardsChange={onCardsChange}
          forceExpanded
          className="plotManagerBoard"
        />
        <footer className="modalActions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>
  );
}
