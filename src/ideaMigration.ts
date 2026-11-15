import { invoke } from "@tauri-apps/api/core";
import { alignIdeaLayoutToMode, reconcileIdeaThreadLayouts } from "./ideaReferenceModel";
import { normalizeIdeaThreads } from "./ideaThreadModel";
import { localIsoNow } from "./posts/postModel";
import { normalizeReferenceLayout } from "./storedStateModel";
import type { IdeaThread, IdeaThreadLayout } from "./types";

/**
 * Idea → 投稿・ノート、資料 → 素材フォルダ（BINDER 2-4・2-5、docs/BINDER_IDEA_MIGRATION_PLAN.md）。
 * 1-3 の期待値を作ったのと同じ読み込み（`normalizeIdeaThreads` → `reconcileIdeaThreadLayouts`）で見え方を作り、
 * インボックスの断片を投稿に、名前の付いたスレッドをノートにする中身を決めて Rust へ渡す。
 * 資料を移すこと、パスの書き換え、書く順と失敗したときの戻しは Rust（src-tauri/src/idea_migration.rs）が行う。
 */

export type PlannedPost = {
  fragmentId: string;
  /** 断片を書いた時刻（時差つきの ISO 8601）。 */
  at: string;
  body: string;
  /** 書いたあとで直していれば、その時刻。 */
  edited?: string;
  /** 本文へ入れた断片（`used`）は受信箱から外す（決めてほしいこと 3）。 */
  filed: boolean;
  /** Canvas から来た断片の元。 */
  origin?: unknown;
};

/** ノートの1段落。断片の本文か、資料リンクのパス（移した先へは Rust が書き換える）。 */
export type PlannedParagraph = { text: string } | { link: string };

export type PlannedNote = {
  threadId: string;
  title: string;
  paragraphs: PlannedParagraph[];
  fragmentIds: string[];
};

export type IdeaMigrationPlan = { posts: PlannedPost[]; notes: PlannedNote[] };

export type IdeaMigrationResult = {
  /** migrated: 今回移した。empty: 移すものがない、または移行済み。 */
  status: "migrated" | "empty";
  posts: number;
  notes: string[];
  moved: number;
};

/** サンプルの ID のスレッド。今の読み込みは中身ごと隠すが、移行では利用者の断片を拾う（決めてほしいこと 5）。 */
const SAMPLE_THREAD_IDS = new Set(["idea-sample-scene", "idea-sample-foreshadow"]);
const RESCUED_SUFFIX = ":rescued";

const rescueId = (id: unknown) => (typeof id === "string" && SAMPLE_THREAD_IDS.has(id) ? `${id}${RESCUED_SUFFIX}` : id);

function rescueSampleThreads(raw: unknown[]): unknown[] {
  return raw.map((thread) =>
    thread && typeof thread === "object" ? { ...(thread as object), id: rescueId((thread as { id?: unknown }).id) } : thread,
  );
}

function rescueSampleLayouts(layouts: IdeaThreadLayout[]): IdeaThreadLayout[] {
  return layouts.map((layout) => ({ ...layout, threadId: rescueId(layout.threadId) as string }));
}

/** ミリ秒の時刻を、投稿と同じ時差つきの ISO 8601（地方時）にする。 */
export function isoAt(millis: number): string {
  return localIsoNow(new Date(millis));
}

/** スレッドと並び順から、投稿とノートの中身を作る。並び順は画面に見えていた順（`reconcileIdeaThreadLayouts`）。 */
export function planFromThreads(threads: IdeaThread[], layouts: IdeaThreadLayout[]): IdeaMigrationPlan {
  const plan: IdeaMigrationPlan = { posts: [], notes: [] };
  const itemsOf = new Map(layouts.map((layout) => [layout.threadId, layout.items]));
  const usedIds = new Set<string>();
  for (const thread of threads) {
    const fragments = new Map(thread.fragments.map((fragment) => [fragment.id, fragment]));
    const items = itemsOf.get(thread.id) ?? [];
    if (thread.kind === "inbox") {
      // インボックスの資料リンクは投稿にしない（決めてほしいこと 2）。ファイルは Rust が素材フォルダへ移す。
      for (const item of items) {
        if (item.sourceType !== "idea") continue;
        const fragment = fragments.get(item.fragmentId);
        if (!fragment || !fragment.body.trim()) continue;
        // 同じ ID の断片が2つあっても、投稿の ID（断片の ID から決まる）が重ならないようにする。
        let fragmentId = fragment.id;
        for (let index = 2; usedIds.has(fragmentId); index += 1) fragmentId = `${fragment.id}#${index}`;
        usedIds.add(fragmentId);
        // 投稿の時刻は秒まで。秒まで同じなら「直した」は付けない。
        const at = isoAt(fragment.createdAt);
        const edited = isoAt(fragment.updatedAt);
        plan.posts.push({
          fragmentId,
          at,
          body: fragment.body,
          ...(fragment.updatedAt > fragment.createdAt && edited !== at ? { edited } : {}),
          filed: fragment.used,
          ...(fragment.originRef ? { origin: fragment.originRef } : {}),
        });
      }
      continue;
    }
    const paragraphs: PlannedParagraph[] = [];
    const fragmentIds: string[] = [];
    for (const item of items) {
      if (item.sourceType === "reference") {
        paragraphs.push({ link: item.sourcePath });
        continue;
      }
      const fragment = fragments.get(item.fragmentId);
      if (!fragment) continue;
      fragmentIds.push(fragment.id);
      if (fragment.body.trim()) paragraphs.push({ text: fragment.body });
    }
    plan.notes.push({ threadId: thread.id, title: thread.title, paragraphs, fragmentIds });
  }
  return plan;
}

/**
 * 作品の Idea（読んだときのまま）と資料の並びから、移行の中身を作る。`mode` は並び順のどちらの側を使うか
 * （作品の Idea は "workspace"、アプリ側の Idea は "profile"）。
 */
export function ideaMigrationPlan(
  storedThreads: unknown,
  rawLayout: unknown,
  mode: "workspace" | "profile",
): IdeaMigrationPlan {
  if (!Array.isArray(storedThreads) || storedThreads.length === 0) return { posts: [], notes: [] };
  const threads = normalizeIdeaThreads(rescueSampleThreads(storedThreads));
  const aligned = alignIdeaLayoutToMode(normalizeReferenceLayout(rawLayout), mode);
  const layouts = reconcileIdeaThreadLayouts(rescueSampleLayouts(aligned.ideaThreads), threads, []);
  return planFromThreads(threads, layouts);
}

async function readLayout(rootPath: string): Promise<unknown> {
  return invoke<unknown>("load_reference_layout", { rootPath });
}

/** 作品（またはライブラリ直下）の Idea を移す。何度呼んでも1回しか移さない。 */
export async function migrateWorkspaceIdeas(rootPath: string): Promise<IdeaMigrationResult> {
  const storedThreads = await invoke<unknown[]>("load_project_snippets", { rootPath });
  const plan = ideaMigrationPlan(storedThreads, await readLayout(rootPath), "workspace");
  return invoke<IdeaMigrationResult>("migrate_project_ideas", {
    rootPath,
    expectedIdeaThreads: storedThreads,
    plan,
  });
}

export type ProfileIdeas = {
  /** 最初に開いたライブラリの直下。 */
  libraryRoot: string;
  /** アプリ状態の `profileSnippets`。 */
  threads: IdeaThread[];
};

export type IdeaMigrationSummary = {
  migrated: string[];
  failed: { rootPath: string; error: unknown }[];
  /** アプリ側の Idea を移せたか（移すものがなければ偽）。真ならアプリ状態の `profileSnippets` を空にしてよい。 */
  profileMigrated: boolean;
  profileFailed: boolean;
};

const hasIdeas = (threads: IdeaThread[]) =>
  threads.some((thread) => thread.kind !== "inbox" || thread.fragments.length > 0);

/**
 * いくつかの作品（ライブラリ直下を含む）を順に移す。起動時のライブラリ全体と、作品を開いたときに使う。
 * 1つの失敗はほかを止めない。同じパスは1回だけ。`profile` があれば、作品のあとでアプリ側の Idea を移す
 * （並び順はライブラリ直下の資料の並びの「アプリ側」のものを、直下を移す前に読んでおく）。
 */
export async function migrateIdeas(rootPaths: string[], profile?: ProfileIdeas): Promise<IdeaMigrationSummary> {
  const summary: IdeaMigrationSummary = { migrated: [], failed: [], profileMigrated: false, profileFailed: false };
  let profilePlan: IdeaMigrationPlan | null = null;
  if (profile && hasIdeas(profile.threads)) {
    try {
      profilePlan = ideaMigrationPlan(profile.threads, await readLayout(profile.libraryRoot), "profile");
    } catch {
      profilePlan = ideaMigrationPlan(profile.threads, null, "profile");
    }
  }
  const seen = new Set<string>();
  for (const rootPath of rootPaths) {
    const key = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const result = await migrateWorkspaceIdeas(rootPath);
      if (result?.status === "migrated") summary.migrated.push(rootPath);
    } catch (error) {
      summary.failed.push({ rootPath, error });
    }
  }
  if (profile && profilePlan) {
    try {
      await invoke<IdeaMigrationResult>("migrate_profile_snippets", {
        libraryRoot: profile.libraryRoot,
        profileSnippets: profile.threads,
        plan: profilePlan,
      });
      summary.profileMigrated = true;
    } catch {
      summary.profileFailed = true;
    }
  }
  return summary;
}

/** 移した結果の通知の文。何も起きなければ null。 */
export function ideaMigrationMessage(summary: IdeaMigrationSummary): string | null {
  if (summary.failed.length > 0 || summary.profileFailed) return "Idea を投稿とノートに移せませんでした";
  const count = summary.migrated.length;
  if (count === 0 && !summary.profileMigrated) return null;
  return count > 1 ? `${count}作品の Idea を投稿とノートに移しました` : "Idea を投稿とノートに移しました";
}
