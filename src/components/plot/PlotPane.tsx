import { useState } from "react";

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
    expanded: true,
  },
];

export function PlotPane() {
  const [cards, setCards] = useState<PlotCard[]>(initialPlotCards);

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
          expanded: true,
        },
      ];
    });
  };

  return (
    <div className="plotPane" aria-label="Plot">
      <div className="plotTrack">
        {cards.map((card) => (
          <article
            className={`plotCard ${card.expanded ? "expandedPlotCard" : ""}`}
            key={card.id}
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
              <div
                className="plotCardTitle"
                contentEditable={card.expanded}
                data-placeholder="タイトル…"
                onBlur={(event) =>
                  updateCard(card.id, {
                    title: event.currentTarget.textContent ?? "",
                  })
                }
                suppressContentEditableWarning
              >
                {card.title}
              </div>
              {card.expanded && (
                <div
                  className="plotCardBody"
                  contentEditable
                  data-placeholder="本文…"
                  onBlur={(event) =>
                    updateCard(card.id, {
                      body: event.currentTarget.textContent ?? "",
                    })
                  }
                  suppressContentEditableWarning
                >
                  {card.body}
                </div>
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
        <button
          className="plotAddButton"
          type="button"
          aria-label="プロットを追加"
          title="プロットを追加"
          onClick={addCard}
        >
          ＋
        </button>
      </div>
    </div>
  );
}
