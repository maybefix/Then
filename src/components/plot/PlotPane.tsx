import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";

type PlotCard = {
  id: string;
  num: string;
  title: string;
  body: string;
  expanded: boolean;
};

const initialPlotCards: PlotCard[] = [
  {
    id: "plot-1",
    num: "001",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
  },
  {
    id: "plot-2",
    num: "002",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
  },
  {
    id: "plot-3",
    num: "003",
    title: "縦書きプロットテストです",
    body: "これは縦書きプロットテストです。ちゃんと書けていることを確かめるためにあります。",
    expanded: false,
  },
];

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

export function PlotPane() {
  const [cards, setCards] = useState<PlotCard[]>(initialPlotCards);
  const [bodyColumns, setBodyColumns] = useState<Record<string, number>>({});
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const bodyRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const composingCardIds = useRef<Set<string>>(new Set());
  const isPinnedToRightRef = useRef(true);
  const draggingCardIdRef = useRef<string | null>(null);

  const visualCards = [...cards].reverse();

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

  const setCardColumns = (cardId: string, columns: number) => {
    setBodyColumns((current) =>
      current[cardId] === columns ? current : { ...current, [cardId]: columns },
    );
  };

  const syncBodyColumns = (cardId: string, text: string, element?: HTMLElement | null) => {
    if (composingCardIds.current.has(cardId)) return;

    const rowsPerColumn = element ? getRowsPerColumn(element) : DEFAULT_ROWS_PER_COLUMN;
    const columns = estimatePlotColumns(text, rowsPerColumn);
    setCardColumns(cardId, columns);
  };

  useLayoutEffect(() => {
    cards.forEach((card) => {
      if (!card.expanded) return;
      if (composingCardIds.current.has(card.id)) return;

      const element = bodyRefs.current.get(card.id);
      syncBodyColumns(card.id, card.body, element);
    });
  }, [cards]);

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
  }, [draggingCardId]);

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
    setCards((current) =>
      current.map((card) =>
        card.id === cardId ? { ...card, expanded: !card.expanded } : card,
      ),
    );
  };

  const updateCard = (cardId: string, patch: Partial<Pick<PlotCard, "title" | "body">>) => {
    setCards((current) =>
      current.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
  };

  const moveCard = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    setCards((current) => {
      const visualOrder = [...current].reverse();
      const draggedCard = visualOrder.find((card) => card.id === draggedId);
      if (!draggedCard) return current;

      const withoutDragged = visualOrder.filter((card) => card.id !== draggedId);
      const targetIndex = withoutDragged.findIndex((card) => card.id === targetId);
      if (targetIndex < 0) return current;

      const nextVisualOrder = [...withoutDragged];
      nextVisualOrder.splice(targetIndex, 0, draggedCard);

      return renumberPlotCards([...nextVisualOrder].reverse());
    });
  };

  const moveCardByIndex = (cardId: string, direction: -1 | 1) => {
    setCards((current) => {
      const currentIndex = current.findIndex((card) => card.id === cardId);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;

      const nextCards = [...current];
      const [card] = nextCards.splice(currentIndex, 1);
      nextCards.splice(nextIndex, 0, card);

      return renumberPlotCards(nextCards);
    });
  };

  const deleteCard = (cardId: string) => {
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;

    const label = card.title.trim() || card.num;
    if (!window.confirm(`プロット「${label}」を削除しますか？`)) return;

    setCards((current) => renumberPlotCards(current.filter((item) => item.id !== cardId)));
  };

  const addCard = () => {
    setCards((current) => {
      const nextIndex = current.length + 1;
      return [
        ...current,
        {
          id: `plot-${Date.now()}`,
          num: String(nextIndex).padStart(3, "0"),
          title: "",
          body: "",
          expanded: false,
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

  const getPlotCardStyle = (card: PlotCard): PlotCardStyle => ({
    "--plot-body-columns": card.expanded
      ? bodyColumns[card.id] ?? estimatePlotColumns(card.body)
      : 1,
  });

  return (
    <>
      <div
        ref={paneRef}
        className="plotPane"
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
            <button
              className="plotToolButton"
              type="button"
              aria-label="プロットを管理"
              title="プロットを管理"
              onClick={() => setIsManagerOpen(true)}
            >
              <PlotIcon name="list" />
            </button>
          </div>
          {visualCards.map((card) => (
            <article
              className={`plotCard ${card.expanded ? "expandedPlotCard" : ""} ${
                draggingCardId === card.id ? "draggingPlotCard" : ""
              }`}
              key={card.id}
              data-plot-card-id={card.id}
              style={getPlotCardStyle(card)}
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
                title="クリックで展開/折りたたみ"
              >
                {card.num}
              </button>
              <div className="plotCardContent">
                <textarea
                  className="plotCardTitle"
                  value={card.title}
                  placeholder="タイトル…"
                  readOnly={!card.expanded}
                  spellCheck={false}
                  tabIndex={card.expanded ? 0 : -1}
                  wrap="off"
                  aria-label={`${card.num} タイトル`}
                  onChange={(event) => handleTitleChange(card.id, event)}
                  onKeyDown={handleTitleKeyDown}
                />
                {card.expanded && (
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
                aria-label={card.expanded ? "折りたたむ" : "展開する"}
                title={card.expanded ? "折りたたむ" : "展開する"}
                onClick={() => toggleCard(card.id)}
              >
                {card.expanded ? "›" : "‹"}
              </button>
            </article>
          ))}
        </div>
      </div>
      {isManagerOpen && (
        <PlotManagerModal
          cards={cards}
          onClose={() => setIsManagerOpen(false)}
          onChange={updateCard}
          onDelete={deleteCard}
          onMove={moveCardByIndex}
        />
      )}
    </>
  );
}

type PlotManagerModalProps = {
  cards: PlotCard[];
  onClose: () => void;
  onChange: (cardId: string, patch: Partial<Pick<PlotCard, "title" | "body">>) => void;
  onDelete: (cardId: string) => void;
  onMove: (cardId: string, direction: -1 | 1) => void;
};

function PlotManagerModal({
  cards,
  onClose,
  onChange,
  onDelete,
  onMove,
}: PlotManagerModalProps) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modal plotManagerModal" aria-label="プロットを管理" role="dialog" aria-modal="true">
        <header className="modalHeader">
          <h2>プロットを管理</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="plotManagerList">
          {cards.map((card, index) => (
            <section className="plotManagerItem" key={card.id}>
              <div className="plotManagerOrder">
                <strong>{card.num}</strong>
                <button
                  className="plotToolButton"
                  type="button"
                  aria-label={`${card.num} を前へ`}
                  title="前へ"
                  disabled={index === 0}
                  onClick={() => onMove(card.id, -1)}
                >
                  <PlotIcon name="up" />
                </button>
                <button
                  className="plotToolButton"
                  type="button"
                  aria-label={`${card.num} を後ろへ`}
                  title="後ろへ"
                  disabled={index === cards.length - 1}
                  onClick={() => onMove(card.id, 1)}
                >
                  <PlotIcon name="down" />
                </button>
                <button
                  className="plotToolButton dangerPlotToolButton"
                  type="button"
                  aria-label={`${card.num} を削除`}
                  title="削除"
                  onClick={() => onDelete(card.id)}
                >
                  <PlotIcon name="trash" />
                </button>
              </div>
              <div className="modalForm plotManagerFields">
                <label>
                  <span>タイトル</span>
                  <textarea
                    className="plotManagerTitle"
                    value={card.title}
                    rows={1}
                    wrap="off"
                    onChange={(event) =>
                      onChange(card.id, { title: event.currentTarget.value.replace(/\r?\n/g, " ") })
                    }
                  />
                </label>
                <label>
                  <span>本文</span>
                  <textarea
                    className="plotManagerBody"
                    value={card.body}
                    rows={12}
                    onChange={(event) => onChange(card.id, { body: event.currentTarget.value })}
                  />
                </label>
              </div>
            </section>
          ))}
        </div>
        <footer className="modalActions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>
  );
}
