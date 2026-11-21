import { invoke } from "@tauri-apps/api/core";

/**
 * 中間稿を素材のノート「（ボード名）の中間稿」へ移す（BINDER 4-4b、docs/BINDER_INTERMEDIATE_DRAFT_RETIRE_PLAN.md）。
 * 読む・書く・消すのは Rust の `migrate_intermediate_drafts`。ここでは、終了前の一時保存（localStorage の
 * `then.draft-recovery.<窓の名前>.["project","<作品>","<ボード ID>"]`）からその作品の分を拾って渡し、
 * 移せたらそのキーを消す。
 */

const RECOVERY_PREFIX = "then.draft-recovery.";

export type DraftRecovery = { boardId: string; text: string; raw: unknown };
type FoundRecovery = DraftRecovery & { key: string };

const samePath = (left: string, right: string) => {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  return normalize(left) === normalize(right);
};

/** この作品の一時保存。版がない・形の分からないものは本文を空にして渡す（バックアップには残す）。 */
export function draftRecoveriesFor(rootPath: string, storage: Storage = localStorage): FoundRecovery[] {
  const found: FoundRecovery[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(RECOVERY_PREFIX)) continue;
    const start = key.indexOf(".[", RECOVERY_PREFIX.length - 1);
    if (start < 0) continue;
    let target: unknown;
    try { target = JSON.parse(key.slice(start + 1)); } catch { continue; }
    if (!Array.isArray(target) || target[0] !== "project" || typeof target[1] !== "string"
      || typeof target[2] !== "string" || !samePath(target[1], rootPath)) continue;
    let raw: unknown = null;
    try { raw = JSON.parse(storage.getItem(key) ?? "null"); } catch { raw = storage.getItem(key); }
    const versions = (raw as { history?: { versions?: { version?: number; text?: unknown }[] } } | null)?.history?.versions;
    const latest = Array.isArray(versions)
      ? versions.reduce<{ version?: number; text?: unknown } | null>((best, item) =>
        !best || (item?.version ?? 0) >= (best.version ?? 0) ? item : best, null)
      : null;
    found.push({ key, boardId: target[2], text: typeof latest?.text === "string" ? latest.text : "", raw });
  }
  return found;
}

export type DraftMigrationResult = { status: "migrated" | "empty"; notes: string[]; backupPath?: string };
export type DraftMigrationSummary = {
  /** 移した作品。 */
  migrated: string[];
  /** 作ったノート（作品からの相対パス）。 */
  notes: string[];
  failed: { rootPath: string; error: unknown }[];
};

export async function migrateWorkspaceDrafts(rootPath: string, storage: Storage = localStorage): Promise<DraftMigrationResult> {
  const found = draftRecoveriesFor(rootPath, storage);
  const result = await invoke<DraftMigrationResult>("migrate_intermediate_drafts", {
    rootPath,
    recoveries: found.map(({ boardId, text, raw }) => ({ boardId, text, raw })),
  });
  // 移せた（または移すものがなかった）ので、一時保存はもう要らない。中身はバックアップにある。
  for (const { key } of found) storage.removeItem(key);
  return result;
}

/** いくつかの作品を順に移す。1つの失敗はほかを止めない。同じパスは1回だけ。 */
export async function migrateIntermediateDrafts(rootPaths: string[], storage: Storage = localStorage): Promise<DraftMigrationSummary> {
  const summary: DraftMigrationSummary = { migrated: [], notes: [], failed: [] };
  const seen = new Set<string>();
  for (const rootPath of rootPaths) {
    const key = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const result = await migrateWorkspaceDrafts(rootPath, storage);
      if (result?.status === "migrated") {
        summary.migrated.push(rootPath);
        summary.notes.push(...result.notes);
      }
    } catch (error) {
      summary.failed.push({ rootPath, error });
    }
  }
  return summary;
}

const noteTitle = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** 移した結果の通知の文。ノートができなければ null。 */
export function draftMigrationMessage(summary: DraftMigrationSummary): string | null {
  if (summary.failed.length > 0) return "中間稿をノートに移せませんでした";
  if (summary.notes.length === 0) return null;
  return summary.notes.length === 1
    ? `中間稿をノート「${noteTitle(summary.notes[0])}」に移しました`
    : `中間稿を${summary.notes.length}本のノートに移しました`;
}
