import { formatManuscriptSheets } from "../../editor/manuscriptLayout";
import type { ManuscriptProgress, SaveStatus } from "../../types";
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
  manuscriptProgress?: ManuscriptProgress | null;
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
      <span className="statusDot" aria-hidden="true" />
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
      {manuscriptProgress && (
        <span
          className="statusManuscript"
          title={`${manuscriptProgress.fullPages}枚と${manuscriptProgress.usedLinesOnCurrentPage}行（1枚${manuscriptProgress.linesPerPage}行）`}
        >
          原稿用紙 {formatManuscriptSheets(manuscriptProgress)}枚
        </span>
      )}
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
