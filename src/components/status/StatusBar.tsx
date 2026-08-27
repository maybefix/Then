import type { SaveStatus } from "../../types";

type StatusBarProps = {
  saveStatus: SaveStatus;
  currentFilePath: string | null;
  showFilePath: boolean;
  lastError: string;
  charCount: number;
  selectionCharCount: number | null;
  pageMetrics: { current: number; total: number } | null;
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
      <span className="statusRight">
        {selectionCharCount !== null ? `${selectionCharCount} / ` : ""}
        {charCount}文字
      </span>
    </footer>
  );
}
