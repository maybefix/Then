import { useRef, useState } from "react";
import type { LoadedExportSource, ExportStartMode } from "../../export/types";
import type { ExportMobileTab } from "./ExportTopbar";

const startModeLabels: Record<ExportStartMode, string> = {
  continue: "前の続き",
  "new-page": "改ページ",
  "odd-page": "奇数ページ開始",
  "even-page": "偶数ページ開始",
};

const SearchIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>;

function folderOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

// チェックポイントの保存点一覧と同じ文法の、軽い行の一覧。並びがそのまま
// 連結順で、出力するファイルには連結順の番号を付ける。
export function ExportSourceSelector({ sources, activeTab, showStartMode, updateSources, onOpenSource }: {
  sources: LoadedExportSource[];
  activeTab: ExportMobileTab;
  showStartMode: boolean;
  updateSources: (updater: (current: LoadedExportSource[]) => LoadedExportSource[]) => void;
  onOpenSource: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const includedCount = sources.filter(source => source.enabled).length;
  const dragIndexRef = useRef<number | null>(null);
  const filtering = query.trim() !== "";
  const needle = query.trim().toLowerCase();
  const orderNumber = new Map<string, number>();
  for (const source of sources) if (source.enabled) orderNumber.set(source.id, orderNumber.size + 1);

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

  const rows = sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => !filtering || source.displayName.toLowerCase().includes(needle));

  return (
    <aside className={`exSide${activeTab === "files" ? " mobileActive" : ""}`} aria-label="出力するファイル">
      <div className="exSideHead"><h2>出力するファイル</h2><span className="exCount">{includedCount} / {sources.length}</span></div>
      <label className="stSearch"><SearchIcon/><input type="search" value={query} placeholder="ファイル名で絞り込む" aria-label="ファイル名で絞り込む" onChange={(event) => setQuery(event.target.value)}/></label>
      <div className="exBulk">
        <button type="button" className="stBtnGhost sm" disabled={includedCount === sources.length}
          onClick={() => updateSources((current) => current.map((item) => ({ ...item, enabled: true })))}>すべて選択</button>
        <button type="button" className="stBtnGhost sm" disabled={includedCount === 0}
          onClick={() => updateSources((current) => current.map((item) => ({ ...item, enabled: false })))}>すべて解除</button>
      </div>
      <div className="exFiles">
        {rows.length === 0 && <p className="exNoResults">一致するファイルはありません</p>}
        {rows.map(({ source, index }) => {
          const folder = folderOf(source.path);
          const extension = source.extension.toLowerCase();
          return (
            <article
              key={source.id}
              className={`exFile${source.enabled ? " isOn" : ""}`}
              draggable={!filtering}
              onDragStart={() => { dragIndexRef.current = index; }}
              onDragEnd={() => { dragIndexRef.current = null; }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => moveDraggedSource(index)}
            >
              <input
                type="checkbox"
                id={`ex-source-${source.id}`}
                checked={source.enabled}
                onChange={() => updateSources((current) => current.map((item) => item.id === source.id ? { ...item, enabled: !item.enabled } : item))}
              />
              <div className="exFileBody">
                <label htmlFor={`ex-source-${source.id}`} className="exFileLabel" title={source.path || source.displayName}>
                  {source.enabled && <span className="exOrder" aria-label={`${orderNumber.get(source.id)}番目`}>{orderNumber.get(source.id)}</span>}
                  <span className="exFileName">{source.displayName.replace(/\.txt$/i, "")}</span>
                  {extension !== "txt" && <span className="exExt">{extension.toUpperCase()}</span>}
                </label>
                <div className="exFileMeta">
                  {folder && <span className="exFolder">{folder}</span>}
                  <span>{(source.chars ?? source.content.length).toLocaleString()}字</span>
                  {source.enabled && showStartMode && <label className="exStart">開始
                    <select
                      value={source.startMode}
                      onChange={(event) => updateSources((current) => current.map((item) => item.id === source.id ? { ...item, startMode: event.target.value as ExportStartMode } : item))}
                    >
                      {Object.entries(startModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>}
                </div>
              </div>
              <span className="exFileTools">
                {!filtering && <>
                  <button type="button" onClick={() => moveSource(index, -1)} disabled={index === 0} aria-label="上へ移動">▲</button>
                  <button type="button" onClick={() => moveSource(index, 1)} disabled={index === sources.length - 1} aria-label="下へ移動">▼</button>
                </>}
                {source.path && <button type="button" onClick={() => onOpenSource(source.path)} aria-label={`${source.displayName}を本文で開く`} title="本文で開く">↗</button>}
              </span>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
