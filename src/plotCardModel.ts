import { invoke } from "@tauri-apps/api/core";
import { normalizePlotCards } from "./storedStateModel";
import type { PlotCard } from "./types";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

/**
 * 作品の Plot を、画面に見えていた形で読む。Plot の画面は BINDER 1-6 でなくなり、Plot は作品を開くときに
 * ノート「プロット（移行）」へ移す（src/plotMigration.ts）。これは、1-3 の期待値（test:binder-baseline）が
 * 「移行の前の見え方」を作るのに使う読み込みとして残す。
 */
export async function loadWorkspacePlotCards(folderPath: string): Promise<PlotCard[]> {
  if (!isTauriRuntime()) return [];
  const plotCards = await invoke<PlotCard[]>("load_project_plot_cards", { rootPath: folderPath });
  return normalizePlotCards(plotCards);
}
