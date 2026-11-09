import { invoke } from "@tauri-apps/api/core";
import { normalizePlotCards } from "./storedStateModel";
import type { PlotCard } from "./types";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export const defaultPlotCards: PlotCard[] = [
  {
    id: "plot-1",
    kind: "section",
    num: "001",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
    managerCollapsed: false,
  },
  {
    id: "plot-2",
    kind: "section",
    num: "002",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
    managerCollapsed: false,
  },
  {
    id: "plot-3",
    kind: "section",
    num: "003",
    title: "縦書きプロットテストです",
    body: "これは縦書きプロットテストです。ちゃんと書けていることを確かめるためにあります。",
    expanded: false,
    managerCollapsed: false,
  },
];

export async function loadWorkspacePlotCards(folderPath: string): Promise<PlotCard[]> {
  if (!isTauriRuntime()) return defaultPlotCards;
  const plotCards = await invoke<PlotCard[]>("load_project_plot_cards", { rootPath: folderPath });
  return normalizePlotCards(plotCards);
}

export async function saveWorkspacePlotCards(folderPath: string, plotCards: PlotCard[]): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_project_plot_cards", { rootPath: folderPath, plotCards });
}
