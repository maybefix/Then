import type { PlotCard } from "../../types";

const PLOT_REFERENCE_LINK_PATTERN = /@\[\[([^\]]+)\]\]/g;

export const replacePlotReferencePath = (
  body: string,
  oldSourcePath: string,
  newSourcePath: string,
) => {
  const oldNormalized = oldSourcePath.replace(/\\/g, "/");
  const newNormalized = newSourcePath.replace(/\\/g, "/");
  if (!oldNormalized || oldNormalized === newNormalized) return body;

  return body.replace(PLOT_REFERENCE_LINK_PATTERN, (match, target: string) => {
    const normalizedTarget = target.replace(/\\/g, "/");
    if (normalizedTarget === oldNormalized) return `@[[${newNormalized}]]`;
    if (normalizedTarget.startsWith(`${oldNormalized}/`)) {
      return `@[[${newNormalized}${normalizedTarget.slice(oldNormalized.length)}]]`;
    }
    return match;
  });
};

export const renumberPlotCards = (cards: PlotCard[]) => {
  let sectionIndex = 0;
  return cards.map((card) => {
    if (card.kind === "chapter") return { ...card, num: "" };
    sectionIndex += 1;
    return { ...card, num: String(sectionIndex).padStart(3, "0") };
  });
};

const newPlotCardId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const createPlotSection = (patch: Partial<Pick<PlotCard, "title" | "body">> = {}): PlotCard => ({
  id: newPlotCardId("plot"),
  kind: "section",
  num: "",
  title: "",
  body: "",
  ...patch,
  // 追加直後にそのままタイトルを打てるよう、新しいセクションは展開状態で作る。
  expanded: true,
  managerCollapsed: false,
});

export const createPlotChapter = (): PlotCard => ({
  id: newPlotCardId("chapter"),
  kind: "chapter",
  num: "",
  title: "",
  body: "",
  expanded: true,
  managerCollapsed: false,
});

/** 章カードの位置から、その章に属するセクション群の直後（次の章 or 末尾）の index を返す。 */
export const plotChapterGroupEnd = (cards: PlotCard[], chapterIndex: number) => {
  let end = chapterIndex + 1;
  while (end < cards.length && cards[end].kind !== "chapter") end += 1;
  return end;
};

export const insertPlotCard = (cards: PlotCard[], index: number, card: PlotCard) =>
  renumberPlotCards([...cards.slice(0, index), card, ...cards.slice(index)]);

export const appendPlotSection = (cards: PlotCard[]) =>
  insertPlotCard(cards, cards.length, createPlotSection());

export const appendPlotChapter = (cards: PlotCard[]) =>
  insertPlotCard(cards, cards.length, createPlotChapter());
