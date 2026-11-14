import { invoke } from "@tauri-apps/api/core";
import { normalizePlotCards } from "./storedStateModel";
import type { PlotCard } from "./types";

/** Plot を移したノートの名前（BINDER 1-6、計画書 3.5）。 */
export const PLOT_MIGRATION_NOTE_NAME = "プロット（移行）";

/** 題が空の章の見出し。章を消したときの通知と同じ語にする。 */
const UNTITLED_CHAPTER = "無題の章";

/**
 * Plot のカードを、ノート1本の文字にする。章は `#` の見出し、セクションは `## 番号 題` の小見出しと本文。
 * 番号・題・本文は、画面に見えていたもの（`normalizePlotCards` を通したもの）を1文字も変えずに書く。
 * カードのあいだは空行1つ。カードがなければ null（ノートを作らない）。
 */
export function plotCardsToNote(cards: PlotCard[]): string | null {
  if (cards.length === 0) return null;
  const blocks = cards.map((card) => {
    const heading =
      card.kind === "chapter"
        ? `# ${card.title || UNTITLED_CHAPTER}`
        : `## ${[card.num, card.title].filter(Boolean).join(" ")}`;
    return card.body ? `${heading}\n${card.body}` : heading;
  });
  return `${blocks.join("\n\n")}\n`;
}

export type PlotMigrationResult = {
  /** migrated: 今回移した。empty: Plot が空なので何もしなかった。 */
  status: "migrated" | "empty";
  /** 作品のフォルダからのノートの相対パス（migrated のときだけ）。 */
  notePath?: string;
};

/**
 * 作品（またはライブラリ直下）の Plot を、ノート「プロット（移行）」へ移す。何度呼んでも1回しか移さない。
 * 画面に見えていた形（`normalizePlotCards`）で文字を作り、読んだときのままの `plotCards` を Rust へ返す。
 * Rust は `project.json` を読み直して同じであることを確かめてから、バックアップ・ノート・空の `plotCards` を書く。
 */
export type PlotMigrationSummary = { migrated: string[]; failed: { rootPath: string; error: unknown }[] };

/**
 * いくつかの作品（ライブラリ直下を含む）を順に移す。起動時のライブラリ全体と、作品を開いたときに使う。
 * 1つの失敗はほかを止めない。同じパスは1回だけ。
 */
export async function migratePlotToNotes(rootPaths: string[]): Promise<PlotMigrationSummary> {
  const summary: PlotMigrationSummary = { migrated: [], failed: [] };
  const seen = new Set<string>();
  for (const rootPath of rootPaths) {
    const key = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const result = await migrateWorkspacePlotToNote(rootPath);
      if (result.status === "migrated") summary.migrated.push(rootPath);
    } catch (error) {
      summary.failed.push({ rootPath, error });
    }
  }
  return summary;
}

/** 移した結果の通知の文。何も起きなければ null。 */
export function plotMigrationMessage(summary: PlotMigrationSummary): string | null {
  if (summary.failed.length > 0) return "プロットをノートに移せませんでした";
  if (summary.migrated.length === 0) return null;
  return summary.migrated.length === 1
    ? `プロットをノート「${PLOT_MIGRATION_NOTE_NAME}」に移しました`
    : `${summary.migrated.length}作品のプロットをノート「${PLOT_MIGRATION_NOTE_NAME}」に移しました`;
}

export async function migrateWorkspacePlotToNote(rootPath: string): Promise<PlotMigrationResult> {
  const storedCards = await invoke<unknown[]>("load_project_plot_cards", { rootPath });
  const note = plotCardsToNote(normalizePlotCards(storedCards));
  if (note === null) return { status: "empty" };
  return invoke<PlotMigrationResult>("migrate_project_plot_to_note", {
    rootPath,
    expectedPlotCards: storedCards,
    noteName: PLOT_MIGRATION_NOTE_NAME,
    noteText: note,
  });
}
