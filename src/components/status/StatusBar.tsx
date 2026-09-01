import type { SaveStatus } from "../../types";

type StatusBarProps = {
  saveStatus: SaveStatus;
  currentFilePath: string | null;
  showFilePath: boolean;
  lastError: string;
  charCount: number;
  selectionCharCount: number | null;
  pageMetrics: { current: number; total: number } | null;
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
