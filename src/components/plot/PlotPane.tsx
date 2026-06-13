import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type CSSProperties,
  type KeyboardEvent,
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

export function PlotPane() {
  const [cards, setCards] = useState<PlotCard[]>(initialPlotCards);
  const [bodyColumns, setBodyColumns] = useState<Record<string, number>>({});
  const paneRef = useRef<HTMLDivElement | null>(null);
  const bodyRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const composingCardIds = useRef<Set<string>>(new Set());
  const isPinnedToRightRef = useRef(true);

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
    <div
      ref={paneRef}
      className="plotPane"
      aria-label="Plot"
      onScroll={handleScroll}
      onWheel={handleWheel}
    >
      <div className="plotTrack">
        <button
          className="plotAddButton"
          type="button"
          aria-label="プロットを追加"
          title="プロットを追加"
          onClick={addCard}
        >
          ＋
        </button>
        {visualCards.map((card) => (
          <article
            className={`plotCard ${card.expanded ? "expandedPlotCard" : ""}`}
            key={card.id}
            style={getPlotCardStyle(card)}
          >
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
  );
}
