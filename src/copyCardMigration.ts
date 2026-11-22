import { invoke } from "@tauri-apps/api/core";

/**
 * Canvas のコピーのカード（Idea の「Canvas へ送る」で作ったテキストカード）を、元が今あるノートのカードへ置き換える
 * （BINDER 4-5、docs/BINDER_COPY_CARD_MIGRATION_PLAN.md）。読む・書くのは Rust の `migrate_copy_cards`。
 * ここでは作品ごとに呼び、置き換えたボードを開いている Canvas に読み直してもらうための一覧と、通知の文を作る。
 */

export type CopyCardMigrationResult = { status: "migrated" | "empty"; replaced: number; boards: string[]; backupPath?: string };
export type CopyCardMigrationSummary = {
  /** 置き換えた作品と、書き換えたボードの ID。 */
  migrated: { rootPath: string; boards: string[] }[];
  /** 置き換えたカードの数（全作品）。 */
  replaced: number;
  failed: { rootPath: string; error: unknown }[];
};

/** いくつかの作品を順に移す。1つの失敗はほかを止めない。同じパスは1回だけ。 */
export async function migrateCopyCards(rootPaths: string[]): Promise<CopyCardMigrationSummary> {
  const summary: CopyCardMigrationSummary = { migrated: [], replaced: 0, failed: [] };
  const seen = new Set<string>();
  for (const rootPath of rootPaths) {
    const key = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const result = await invoke<CopyCardMigrationResult>("migrate_copy_cards", { rootPath });
      if (result?.status === "migrated" && result.replaced > 0) {
        summary.migrated.push({ rootPath, boards: result.boards });
        summary.replaced += result.replaced;
      }
    } catch (error) {
      summary.failed.push({ rootPath, error });
    }
  }
  return summary;
}

/** 移した結果の通知の文。置き換えがなければ null。 */
export function copyCardMigrationMessage(summary: CopyCardMigrationSummary): string | null {
  if (summary.failed.length > 0) return "コピーのカードを置き換えられませんでした";
  if (summary.replaced === 0) return null;
  return `コピーのカード${summary.replaced}枚をノートのカードに置き換えました`;
}
