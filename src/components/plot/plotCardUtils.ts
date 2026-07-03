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
