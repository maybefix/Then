import { useMemo, useState } from "react";
import {
  fileProgressLabels,
  workStatusLabels,
  type FileProgressStatus,
  type WorkMeta,
  type WorkStats,
  type WorkStatus,
} from "../../types";

export type LibraryHomeItem = {
  path: string;
  name: string;
  work: WorkMeta | null;
  stats: WorkStats | null;
};

type SortKey = "updated" | "name" | "chars";
type ViewMode = "cards" | "table";

const STATUS_ORDER: WorkStatus[] = ["planning", "writing", "revising", "done", "paused"];
const PROGRESS_ORDER: FileProgressStatus[] = ["done", "revising", "writing", "todo"];
const VIEW_STORAGE_KEY = "then.libraryHome.view";

function readStoredView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }).format(
    timestamp,
  );
}

const formatChars = (value: number | undefined) =>
  value === undefined ? "—" : `${value.toLocaleString("ja-JP")}字`;

function ProgressBar({ stats }: { stats: WorkStats | null }) {
  if (!stats || stats.fileCount === 0) return <div className="libraryHomeBar" aria-hidden="true" />;
  const label = PROGRESS_ORDER.map((status) => `${fileProgressLabels[status]} ${stats.progress[status]}`).join("・");
  return (
    <div className="libraryHomeBar" role="img" aria-label={label} title={label}>
      {PROGRESS_ORDER.map((status) =>
        stats.progress[status] > 0 ? (
          <i
            key={status}
            className={`libraryHomeBarSegment progressFill-${status}`}
            style={{ flexGrow: stats.progress[status] }}
          />
        ) : null,
      )}
    </div>
  );
}

/** ライブラリ直下で文書を開いていないときに出す、作品の一覧。 */
export function LibraryHome({
  libraryName,
  items,
  isLoading,
  onOpenProject,
  onEditWork,
  onCreateProject,
  onRefresh,
}: {
  libraryName: string;
  items: LibraryHomeItem[];
  isLoading: boolean;
  onOpenProject: (path: string) => void;
  onEditWork: (item: LibraryHomeItem) => void;
  onCreateProject: () => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [view, setView] = useState<ViewMode>(readStoredView);

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // 表示形式を覚えられないだけなので無視する。
    }
  };

  const totalChars = items.reduce((sum, item) => sum + (item.stats?.charCount ?? 0), 0);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = items.filter((item) => {
      if (statusFilter !== "all" && (item.work?.status ?? "planning") !== statusFilter) return false;
      if (!needle) return true;
      return `${item.name}\n${item.work?.summary ?? ""}`.toLocaleLowerCase().includes(needle);
    });
    const updatedAt = (item: LibraryHomeItem) =>
      Math.max(item.stats?.lastModified ?? 0, item.work?.updatedAt ?? 0);
    return [...filtered].sort((left, right) => {
      if (sortKey === "name") return left.name.localeCompare(right.name, "ja");
      if (sortKey === "chars") return (right.stats?.charCount ?? -1) - (left.stats?.charCount ?? -1);
      return updatedAt(right) - updatedAt(left);
    });
  }, [items, query, sortKey, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = new Map<WorkStatus, number>();
    for (const item of items) {
      const status = item.work?.status ?? "planning";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  return (
    <section className="libraryHome" aria-label={`ライブラリ「${libraryName}」の作品`}>
      <header className="libraryHomeHeader">
        <div>
          <p className="newTabEyebrow">Library</p>
          <h1>{libraryName}</h1>
          <p className="libraryHomeSummary">
            {items.length}作品 · 合計 {totalChars.toLocaleString("ja-JP")}字
            {isLoading && <span className="libraryHomeLoading"> · 集計中…</span>}
          </p>
        </div>
        <div className="libraryHomeHeaderActions">
          <button type="button" onClick={onRefresh} disabled={isLoading} title="字数と進捗を集計し直す">
            再集計
          </button>
          <button type="button" onClick={onCreateProject}>
            ＋ 新しい作品
          </button>
        </div>
      </header>

      <div className="libraryHomeFilters">
        <input
          type="search"
          value={query}
          placeholder="作品名・あらすじで絞り込み"
          aria-label="作品を絞り込み"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="libraryHomeChips" role="group" aria-label="状態で絞り込み">
          <button
            type="button"
            aria-pressed={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            すべて
          </button>
          {STATUS_ORDER.filter((status) => statusCounts.has(status)).map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            >
              {workStatusLabels[status]} {statusCounts.get(status)}
            </button>
          ))}
        </div>
        <label className="libraryHomeSort">
          <span>並び</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="updated">更新日</option>
            <option value="name">作品名</option>
            <option value="chars">字数</option>
          </select>
        </label>
        <div className="libraryHomeViewToggle" role="group" aria-label="表示形式">
          <button type="button" aria-pressed={view === "cards"} onClick={() => changeView("cards")}>
            カード
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => changeView("table")}>
            表
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="libraryHomeEmpty">
          まだ作品がありません。「＋ 新しい作品」か、サイドバーの「既存の作品を取り込む…」から始めてください。
        </p>
      ) : visibleItems.length === 0 ? (
        <p className="libraryHomeEmpty">条件に合う作品はありません。</p>
      ) : view === "cards" ? (
        <div className="libraryHomeCards">
          {visibleItems.map((item) => {
            const status = item.work?.status ?? "planning";
            return (
              <article key={item.path} className="libraryHomeCard">
                <button
                  className="libraryHomeCardOpen"
                  type="button"
                  title={`「${item.name}」を開く`}
                  onClick={() => onOpenProject(item.path)}
                >
                  <span className="libraryHomeCardTitle">{item.name}</span>
                  <span className={`libraryHomeStatus workStatus-${status}`}>
                    {workStatusLabels[status]}
                  </span>
                  <span className="libraryHomeCardSummary">
                    {item.work?.summary || "（あらすじ未設定）"}
                  </span>
                  <ProgressBar stats={item.stats} />
                  <span className="libraryHomeCardFoot">
                    <span>{formatChars(item.stats?.charCount)}</span>
                    <span>{formatDate(item.stats?.lastModified ?? item.work?.updatedAt)}</span>
                  </span>
                </button>
                <button
                  className="libraryHomeEdit"
                  type="button"
                  aria-label={`「${item.name}」の状態とあらすじを編集`}
                  title="状態とあらすじを編集"
                  onClick={() => onEditWork(item)}
                >
                  編集
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <table className="libraryHomeTable">
          <thead>
            <tr>
              <th scope="col">作品名</th>
              <th scope="col">状態</th>
              <th scope="col">字数</th>
              <th scope="col">進捗</th>
              <th scope="col">更新</th>
              <th scope="col"><span className="visuallyHidden">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const status = item.work?.status ?? "planning";
              return (
                <tr key={item.path}>
                  <td>
                    <button className="libraryHomeTableOpen" type="button" onClick={() => onOpenProject(item.path)}>
                      {item.name}
                    </button>
                  </td>
                  <td>
                    <span className={`libraryHomeStatus workStatus-${status}`}>{workStatusLabels[status]}</span>
                  </td>
                  <td className="libraryHomeNumber">{formatChars(item.stats?.charCount)}</td>
                  <td>
                    <ProgressBar stats={item.stats} />
                  </td>
                  <td>{formatDate(item.stats?.lastModified ?? item.work?.updatedAt)}</td>
                  <td>
                    <button className="libraryHomeEdit" type="button" onClick={() => onEditWork(item)}>
                      編集
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
