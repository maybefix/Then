import { useSyncExternalStore } from "react";
import { formatManuscriptSheets } from "../../editor/manuscriptLayout";
import type { ManuscriptProgressStore } from "../../editor/manuscriptProgressStore";
import type { SaveStatus } from "../../types";
import { CheckpointStatus, type CheckpointStatusInfo } from "./CheckpointStatus";

type StatusBarProps = {
  saveStatus: SaveStatus;
  currentFilePath: string | null;
  showFilePath: boolean;
  lastError: string;
  charCount: number;
  selectionCharCount: number | null;
  pageMetrics: { current: number; total: number } | null;
  /** 原稿用紙モードのときだけ渡す。 */
  manuscriptProgress?: ManuscriptProgressStore | null;
  /** null なら出さない（設定で非表示、またはプロジェクト未選択）。 */
  checkpoint: CheckpointStatusInfo | null;
  pluginItems: Array<{
    pluginId: string;
    id: string;
    text: string;
    tooltip?: string;
    commandId?: string;
  }>;
  onPluginItemClick: (pluginId: string, commandId: string) => void;
};

const statusLabels: Record<SaveStatus, string> = {
  loading: "読み込み中",
  saved: "保存済み",
  dirty: "未保存",
  saving: "保存中",
  error: "保存失敗",
};

// 保存済みはチェック、まだ保存されていない間はサイクル、失敗は「!」。色は CSS の status-* で決める。
const saveIconShapes: Record<SaveStatus, "check" | "cycle" | "alert"> = {
  loading: "cycle",
  saved: "check",
  dirty: "cycle",
  saving: "cycle",
  error: "alert",
};

const saveIconPaths = {
  check: <path d="M5 12l5 5 9-10" />,
  cycle: (
    <>
      <path d="M20 12a8 8 0 0 0-13.66-5.66" />
      <path d="M6.34 2.34v4h4" />
      <path d="M4 12a8 8 0 0 0 13.66 5.66" />
      <path d="M17.66 21.66v-4h-4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.5h.01" />
    </>
  ),
};

function SaveStatusIcon({ status }: { status: SaveStatus }) {
  const shape = saveIconShapes[status];
  return (
    <svg
      className="statusSaveIcon"
      data-shape={shape}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {saveIconPaths[shape]}
    </svg>
  );
}

function ManuscriptStatus({ store }: { store: ManuscriptProgressStore }) {
  const manuscriptProgress = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!manuscriptProgress) return null;
  return (
    <span
      className="statusManuscript"
      title={`${manuscriptProgress.fullPages}枚と${manuscriptProgress.usedLinesOnCurrentPage}行（1枚${manuscriptProgress.linesPerPage}行）`}
    >
      原稿用紙 {formatManuscriptSheets(manuscriptProgress)}枚
    </span>
  );
}

export function StatusBar({
  saveStatus,
  currentFilePath,
  showFilePath,
  lastError,
  charCount,
  selectionCharCount,
  pageMetrics,
  manuscriptProgress = null,
  checkpoint,
  pluginItems,
  onPluginItemClick,
}: StatusBarProps) {
  return (
    <footer className={`statusbar status-${saveStatus}`}>
      <SaveStatusIcon status={saveStatus} />
      <span>{statusLabels[saveStatus]}</span>
      {showFilePath && (
        <span className="statusPath" title={currentFilePath ?? "保存先未指定"}>
          {currentFilePath ?? "保存先未指定"}
        </span>
      )}
      {lastError && <span className="statusError">{lastError}</span>}
      {pageMetrics && (
        <span className="statusPages">
          {pageMetrics.current} / {pageMetrics.total}ページ
        </span>
      )}
      {manuscriptProgress && <ManuscriptStatus store={manuscriptProgress} />}
      {checkpoint && <CheckpointStatus {...checkpoint} />}
      {pluginItems.length > 0 && (
        <span className="pluginStatusBarItems" aria-label="プラグインの状態">
          {pluginItems.map((item) => item.commandId ? (
            <button
              type="button"
              key={`${item.pluginId}:${item.id}`}
              title={item.tooltip}
              onClick={() => onPluginItemClick(item.pluginId, item.commandId!)}
            >
              {item.text}
            </button>
          ) : (
            <span key={`${item.pluginId}:${item.id}`} title={item.tooltip}>
              {item.text}
            </span>
          ))}
        </span>
      )}
      <span className="statusRight">
        {selectionCharCount !== null ? `${selectionCharCount} / ` : ""}
        {charCount}文字
      </span>
    </footer>
  );
}
