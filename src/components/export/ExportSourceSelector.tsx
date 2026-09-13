import { useRef } from "react";
import type { LoadedExportSource, ExportStartMode } from "../../export/types";

const startModeLabels: Record<ExportStartMode, string> = {
  continue: "前の続き",
  "new-page": "改ページ",
  "odd-page": "奇数ページ開始",
  "even-page": "偶数ページ開始",
};

export function ExportSourceSelector({ sources, activeTab, showStartMode, updateSources, onOpenSource }: {
  sources: LoadedExportSource[];
  activeTab: "files" | "settings" | "preview";
  showStartMode: boolean;
  updateSources: (updater: (current: LoadedExportSource[]) => LoadedExportSource[]) => void;
  onOpenSource: (path: string) => void;
}) {
  const includedCount = sources.filter(source => source.enabled).length;
  const dragIndexRef = useRef<number | null>(null);
  const moveSource = (index: number, direction: -1 | 1) => {
    updateSources((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const moveDraggedSource = (targetIndex: number) => {
    const sourceIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (sourceIndex === null || sourceIndex === targetIndex) return;
    updateSources((current) => {
      const next = [...current];
      const [dragged] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, dragged);
      return next;
    });
  };

  return (
          <aside className={`exportFilesPanel ${activeTab === "files" ? "mobileActive" : ""}`}>
            <div className="exportPanelHeading" title="⋮⋮ をドラッグまたは ▲▼ で並べ替え・チェックで出力対象を切替">
              <div><strong>出力対象ファイル</strong><span>{includedCount} / {sources.length}</span></div>
              <div className="exportSelectAllRow">
                <button
                  type="button"
                  className="exportBtn exportSelectAllButton"
                  disabled={includedCount === sources.length}
                  onClick={() => updateSources((current) => current.map((item) => ({ ...item, enabled: true })))}
                >
                  すべて選択
                </button>
                <button
                  type="button"
                  className="exportBtn exportSelectAllButton"
                  disabled={includedCount === 0}
                  onClick={() => updateSources((current) => current.map((item) => ({ ...item, enabled: false })))}
                >
                  すべて解除
                </button>
              </div>
            </div>
            <div className="exportSourceList">
              {sources.map((source, index) => (
                <article
                  key={source.id}
                  className={`exportSourceRow ${source.enabled ? "" : "disabled"}`}
                  draggable
                  onDragStart={() => { dragIndexRef.current = index; }}
                  onDragEnd={() => { dragIndexRef.current = null; }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveDraggedSource(index)}
                >
                  <div className="exportSourceMainRow">
                    <span className="exportDragHandle" aria-hidden="true">⋮⋮</span>
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      aria-label={`${source.displayName}を出力に含める`}
                      onChange={() => updateSources((current) => current.map((item) => item.id === source.id ? { ...item, enabled: !item.enabled } : item))}
                    />
                    <button type="button" className="exportSourceName" title={source.path} onClick={() => source.path && onOpenSource(source.path)}>
                      {source.displayName}
                    </button>
                    <span className={`exportExtensionBadge ext-${source.extension.toLowerCase()}`}>{source.extension.toUpperCase()}</span>
                    <span className="exportMoveButtons">
                      <button type="button" onClick={() => moveSource(index, -1)} disabled={index === 0} aria-label="上へ移動">▲</button>
                      <button type="button" onClick={() => moveSource(index, 1)} disabled={index === sources.length - 1} aria-label="下へ移動">▼</button>
                    </span>
                  </div>
                  <div className="exportSourceMeta">
                    <span>{source.chars ?? source.content.length}字</span>
                    {showStartMode && <label>開始
                      <select
                        value={source.startMode}
                        onChange={(event) => updateSources((current) => current.map((item) => item.id === source.id ? { ...item, startMode: event.target.value as ExportStartMode } : item))}
                      >
                        {Object.entries(startModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>}
                  </div>
                </article>
              ))}
            </div>
            <div className="exportPanelFoot"><span>出力 {includedCount} / 全 {sources.length} ファイル</span><span>連結順 = 上から</span></div>
          </aside>
  );

}
