import { useMemo, useRef, useState } from "react";

// This screen is mounted as the complete contents of a dedicated Tauri window.
import { exportBlockHtml } from "../../export/linkedDocument";
import {
  prepareExportDocx,
  prepareExportPdf,
} from "../../export/typesetClient";
import type {
  ExportErrorKind,
  ExportFormat,
  ExportJob,
  ExportLayoutProfile,
  ExportPageModel,
  ExportResult,
  ExportStartMode,
  ExportViewState,
  LinkedExportDocument,
  LoadedExportSource,
} from "../../export/types";
import {
  DEFAULT_EXPORT_LAYOUT,
  resolvePageDimensions,
} from "../../export/types";

// The heavy typesetting now runs in a worker (see typesetClient), so the screen
// hands already-serialized assets to the window host instead of a live document.
export type PreparedPdfExport = {
  css: string;
  markup: string;
  vivliostyleHtml: string;
  pageCount: number;
  layout: ExportLayoutProfile;
  title: string;
};

export type PreparedDocxExport = {
  bytes: Uint8Array;
  title: string;
};

type ExportProgress = {
  percent: number;
  currentPage: number;
  totalPages: number;
  message: string;
};

type ExportFailure = {
  kind: ExportErrorKind;
  message: string;
  detail: string;
  sourcePath?: string;
};

type LinkedExportScreenProps = {
  title: string;
  initialSources: LoadedExportSource[];
  sourceError?: string;
  onClose: () => void;
  onOpenSource: (path: string) => void;
  onExportPdf: (
    assets: PreparedPdfExport,
    onProgress: (progress: ExportProgress) => void,
  ) => Promise<ExportResult>;
  onExportDocx: (
    assets: PreparedDocxExport,
    onProgress: (progress: ExportProgress) => void,
  ) => Promise<ExportResult>;
  onOpenResult: (path: string) => void;
};

const LAST_LAYOUT_KEY = "then-linked-export-layout-v1";

const startModeLabels: Record<ExportStartMode, string> = {
  continue: "前の続き",
  "new-page": "改ページ",
  "odd-page": "奇数ページ開始",
  "even-page": "偶数ページ開始",
};

function cloneLayout(layout: ExportLayoutProfile): ExportLayoutProfile {
  return JSON.parse(JSON.stringify(layout)) as ExportLayoutProfile;
}

function readLastLayout(): ExportLayoutProfile | null {
  try {
    const stored = localStorage.getItem(LAST_LAYOUT_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as ExportLayoutProfile;
    return parsed?.body?.writingMode === "vertical-rl" ? parsed : null;
  } catch {
    return null;
  }
}

function initialLayout(sources: LoadedExportSource[]): ExportLayoutProfile {
  const stored = readLastLayout();
  const layout = cloneLayout(stored ?? DEFAULT_EXPORT_LAYOUT);
  if (sources.length > 0 && !stored) layout.body.fontFamily = "Noto Serif CJK JP";
  return layout;
}

function withOrder(sources: LoadedExportSource[]): LoadedExportSource[] {
  return sources.map((source, order) => ({ ...source, order }));
}

function errorKindFor(format: ExportFormat): ExportErrorKind {
  return format === "pdf" ? "pdf-generate" : "docx-generate";
}

function headerText(
  document: LinkedExportDocument,
  page: ExportPageModel,
): string {
  const header = document.layout.header;
  if (!header.enabled || header.content === "none") return "";
  if (header.hideOnFirstPage && page.pageNumber === document.layout.footer.startPageNumber) return "";
  if (header.hideOnTitlePage && page.isSourceFirstPage) return "";
  if (header.differentOddEven && page.pageNumber % 2 === 0) return document.title;
  if (header.content === "title") return document.title;
  if (header.content === "chapter") return page.chapterTitle;
  if (header.content === "file") return page.sourceName;
  return header.customText ?? "";
}

function footerText(
  document: LinkedExportDocument,
  page: ExportPageModel,
): string {
  const footer = document.layout.footer;
  if (!footer.enabled || footer.content === "none") return "";
  if (footer.hideOnFirstPage && page.pageNumber === footer.startPageNumber) return "";
  if (footer.hideOnTitlePage && page.isSourceFirstPage) return "";
  if (footer.content === "page-number") return footer.pageNumber ? String(page.pageNumber) : "";
  if (footer.content === "title") return document.title;
  return footer.customText ?? "";
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

// URL of the bundled Vivliostyle Viewer rendering the flowing export HTML. The
// same engine and document are used for the PDF, so the preview is WYSIWYG.
function vivliostyleViewerSrc(html: string): string {
  const dataUrl = `data:text/html;charset=utf-8;base64,${base64Utf8(html)}`;
  const params = `src=${encodeURIComponent(dataUrl)}&bookMode=true&spreadView=true&renderAllPages=true`;
  return `/vendor/vivliostyle-viewer/index.html#${params}`;
}

function PreviewPage({
  document,
  page,
}: {
  document: LinkedExportDocument;
  page: ExportPageModel;
}) {
  const [width, height] = resolvePageDimensions(document.layout);
  const header = headerText(document, page);
  const footer = footerText(document, page);
  const isEven = page.pageNumber % 2 === 0;
  const contentStyle = {
    top: `${document.layout.page.marginTopMm / height * 100}%`,
    bottom: `${document.layout.page.marginBottomMm / height * 100}%`,
    left: `${(isEven ? document.layout.page.marginInnerMm : document.layout.page.marginOuterMm) / width * 100}%`,
    right: `${(isEven ? document.layout.page.marginOuterMm : document.layout.page.marginInnerMm) / width * 100}%`,
    fontFamily: `"${document.layout.body.fontFamily}", serif`,
    fontSize: `${Math.max(7.5, document.layout.body.fontSize * 0.68)}px`,
    lineHeight: document.layout.body.lineHeight,
    columnCount: document.layout.body.columns,
    columnGap: `${document.layout.body.columnGapMm / width * 100}%`,
  };
  return (
    <div className="exportPreviewPaper" style={{ aspectRatio: `${width} / ${height}` }}>
      {header && <div className="exportPreviewHeader">{header}</div>}
      <div
        className="exportPreviewContent"
        style={contentStyle}
        dangerouslySetInnerHTML={{
          __html: page.isBlank ? "" : page.blocks.map(exportBlockHtml).join(""),
        }}
      />
      {footer && (
        <div className={`exportPreviewFooter exportPreviewFooter-${document.layout.footer.pageNumberPosition}`}>
          {footer}
        </div>
      )}
      {page.isBlank && <span className="exportBlankPageLabel">空白ページ</span>}
    </div>
  );
}

export function LinkedExportScreen({
  title,
  initialSources,
  sourceError,
  onClose,
  onOpenSource,
  onExportPdf,
  onExportDocx,
  onOpenResult,
}: LinkedExportScreenProps) {
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [sources, setSources] = useState(() => withOrder(initialSources));
  const [layout, setLayout] = useState(() => initialLayout(initialSources));
  const [viewState, setViewState] = useState<ExportViewState>(sourceError ? "preview-error" : "no-preview");
  const [activeTab, setActiveTab] = useState<"files" | "settings" | "preview">("files");
  const [openSections, setOpenSections] = useState(() => new Set(["page"]));
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [failure, setFailure] = useState<ExportFailure | null>(sourceError ? {
    kind: "source-read",
    message: "本文ファイルを読み込めませんでした",
    detail: sourceError,
  } : null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>({
    percent: 0,
    currentPage: 0,
    totalPages: 0,
    message: "本文を連結しています",
  });
  const [completed, setCompleted] = useState<{ result: ExportResult; format: ExportFormat; pageCount: number } | null>(null);
  const [savedLabel, setSavedLabel] = useState("");
  const dragIndexRef = useRef<number | null>(null);

  const job = useMemo<ExportJob>(() => ({
    format,
    title,
    sources: sources.map(({ content: _content, ...source }) => source),
    layout,
  }), [format, layout, sources, title]);
  const includedCount = sources.filter((source) => source.enabled).length;

  const patchLayout = (updater: (current: ExportLayoutProfile) => ExportLayoutProfile) => {
    setLayout((current) => updater(cloneLayout(current)));
    if (viewState === "preview-ready") setViewState("no-preview");
  };

  const toggleSection = (name: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const updateSources = (updater: (current: LoadedExportSource[]) => LoadedExportSource[]) => {
    setSources((current) => withOrder(updater(current)));
    if (viewState === "preview-ready") setViewState("no-preview");
  };

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

  const refreshPreview = () => {
    setFailure(null);
    setViewState("preview-loading");
    // The HTML is built off-thread, then rendered by the bundled Vivliostyle
    // Viewer — the exact same engine and document the PDF uses, so the preview
    // matches the output page-for-page.
    void prepareExportPdf(job, sources)
      .then((assets) => {
        setPreviewSrc(vivliostyleViewerSrc(assets.vivliostyleHtml));
        setViewState("preview-ready");
        setActiveTab("preview");
      })
      .catch((error) => {
        setFailure({
          kind: "typeset",
          message: "組版処理に失敗しました",
          detail: String(error),
        });
        setViewState("preview-error");
      });
  };

  const applyPreset = (preset: "standard" | "doujin" | "a5-2col") => {
    const next = cloneLayout(DEFAULT_EXPORT_LAYOUT);
    if (preset === "doujin") {
      next.name = "同人誌 B6・1段";
      next.page.marginTopMm = 16;
      next.page.marginBottomMm = 16;
      next.page.marginInnerMm = 20;
      next.page.marginOuterMm = 14;
      next.body.fontSize = 12.5;
    } else if (preset === "a5-2col") {
      next.name = "A5・2段組";
      next.page.size = "A5";
      next.page.marginInnerMm = 18;
      next.page.marginOuterMm = 15;
      next.body.columns = 2;
      next.body.columnGapMm = 8;
      next.body.fontSize = 11.5;
    }
    patchLayout(() => next);
  };

  const saveLayout = () => {
    localStorage.setItem(LAST_LAYOUT_KEY, JSON.stringify(layout));
    setSavedLabel("設定を保存しました");
    window.setTimeout(() => setSavedLabel(""), 1800);
  };

  const runExport = async (targetFormat: ExportFormat) => {
    setFormat(targetFormat);
    setFailure(null);
    setCompleted(null);
    try {
      const nextJob = { ...job, format: targetFormat };
      setProgress({
        percent: 10,
        currentPage: 0,
        totalPages: 0,
        message: "本文ファイルを連結しています",
      });
      setViewState("pdf-generating");
      // Concatenation, pagination and serialization happen in the worker; the UI
      // thread only injects the result and drives the native save/print step.
      let pageCount = 0;
      const reportProgress = (value: ExportProgress) => setProgress({
        ...value,
        totalPages: value.totalPages || pageCount,
      });
      let result: ExportResult;
      if (targetFormat === "pdf") {
        const assets = await prepareExportPdf(nextJob, sources);
        pageCount = assets.pageCount;
        result = await onExportPdf(
          { ...assets, layout: nextJob.layout, title },
          reportProgress,
        );
      } else {
        const assets = await prepareExportDocx(nextJob, sources);
        pageCount = assets.pageCount;
        result = await onExportDocx({ bytes: assets.bytes, title }, reportProgress);
      }
      setProgress({
        percent: 100,
        currentPage: pageCount,
        totalPages: pageCount,
        message: `${targetFormat.toUpperCase()}を書き出しました`,
      });
      setCompleted({ result, format: targetFormat, pageCount });
      setViewState("pdf-complete");
    } catch (error) {
      setFailure({
        kind: errorKindFor(targetFormat),
        message: `${targetFormat.toUpperCase()}を書き出せませんでした`,
        detail: String(error),
      });
      setViewState("preview-error");
    }
  };

  const renderSectionHeader = (id: string, label: string, summary: string) => (
    <button type="button" className="exportSettingsSectionHeader" onClick={() => toggleSection(id)}>
      <span>{openSections.has(id) ? "▾" : "▸"} {label}</span>
      <small>{summary}</small>
    </button>
  );

  const [pageWidth, pageHeight] = resolvePageDimensions(layout);
  const pageSummary = `${layout.page.size}・余白 ${layout.page.marginTopMm}mm`;
  const bodySummary = `${layout.body.fontFamily.includes("Serif") ? "明朝" : "ゴシック"} ${layout.body.fontSize}${layout.body.fontSizeUnit}・${layout.body.columns}段`;

  return (
    <div className="exportModalBackdrop" role="presentation">
      <section className="linkedExportScreen" aria-labelledby="linked-export-title">
        <header className="exportModalHeader">
          <div>
            <h2 id="linked-export-title">エクスポート</h2>
            <p>本文ファイルを連結して書き出します</p>
          </div>
          <div className="exportHeaderActions">
            <span>出力形式</span>
            <div className="exportFormatSwitch" role="group" aria-label="出力形式">
              <button type="button" className={format === "pdf" ? "active" : ""} onClick={() => setFormat("pdf")}>PDF</button>
              <button type="button" className={format === "docx" ? "active" : ""} onClick={() => setFormat("docx")}>DOCX</button>
            </div>
            <button type="button" className="exportCloseButton" onClick={onClose} aria-label="閉じる">×</button>
          </div>
        </header>

        <nav className="exportResponsiveTabs" aria-label="エクスポート画面">
          {(["files", "settings", "preview"] as const).map((tab) => (
            <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
              {tab === "files" ? "出力対象" : tab === "settings" ? "設定" : "プレビュー"}
            </button>
          ))}
        </nav>

        <div className="exportModalBody">
          <aside className={`exportFilesPanel ${activeTab === "files" ? "mobileActive" : ""}`}>
            <div className="exportPanelHeading">
              <div><strong>出力対象ファイル</strong><span>{includedCount} / {sources.length}</span></div>
              <p>⋮⋮ をドラッグで並べ替え・チェックで出力対象を切替</p>
            </div>
            <div className="exportSourceList">
              {sources.map((source, index) => (
                <article
                  key={source.id}
                  className={`exportSourceRow ${source.enabled ? "" : "disabled"}`}
                  draggable
                  onDragStart={() => { dragIndexRef.current = index; }}
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
                    <label>開始
                      <select
                        value={source.startMode}
                        onChange={(event) => updateSources((current) => current.map((item) => item.id === source.id ? { ...item, startMode: event.target.value as ExportStartMode } : item))}
                      >
                        {Object.entries(startModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </div>
                </article>
              ))}
            </div>
            <div className="exportPanelFoot"><span>出力 {includedCount} / 全 {sources.length} ファイル</span><span>連結順 = 上から</span></div>
          </aside>

          <section className={`exportPreviewPanel ${activeTab === "preview" ? "mobileActive" : ""}`}>
            <div className="exportPreviewToolbar">
              <button type="button" className="exportRefreshButton" onClick={refreshPreview} disabled={includedCount === 0}>↻ プレビュー更新</button>
              <span className="exportToolbarSpacer" />
              <span className="exportPreviewEngineTag">Vivliostyle 組版（出力と同じ）</span>
            </div>
            <div className="exportPreviewStage">
              {viewState === "no-preview" && (
                <div className="exportEmptyState">
                  <span>▤</span><strong>まだプレビューがありません</strong>
                  <p>「プレビュー更新」を押すと、出力対象ファイルを連結して組版プレビューを生成します。</p>
                  <button type="button" onClick={refreshPreview}>↻ プレビュー更新</button>
                </div>
              )}
              {viewState === "preview-loading" && (
                <div className="exportEmptyState"><span className="exportSpinner"/><strong>プレビュー生成中…</strong><p>本文を連結して組版しています</p></div>
              )}
              {viewState === "preview-ready" && previewSrc && (
                <iframe
                  key={previewSrc}
                  className="exportVivliostyleFrame"
                  src={previewSrc}
                  title="組版プレビュー"
                />
              )}
              {viewState === "preview-error" && failure && (
                <div className="exportErrorState" role="alert">
                  <span>!</span><strong>{failure.message}</strong>
                  <p>本文の連結結果を紙面に流し込む処理でエラーが発生しました。設定と本文記法を確認してください。</p>
                  <button type="button" className="exportLogToggle" onClick={() => setShowErrorDetail((value) => !value)}>{showErrorDetail ? "▾" : "▸"} 詳細ログを表示</button>
                  {showErrorDetail && <pre>[{failure.kind}] {failure.detail}</pre>}
                  <div>{failure.sourcePath && <button type="button" onClick={() => onOpenSource(failure.sourcePath!)}>該当ファイルを開く</button>}<button type="button" onClick={refreshPreview}>↻ 再試行</button></div>
                </div>
              )}
            </div>
          </section>

          <aside className={`exportSettingsPanel ${activeTab === "settings" ? "mobileActive" : ""}`}>
            {renderSectionHeader("page", "ページ設定", pageSummary)}
            {openSections.has("page") && <div className="exportSettingsContent">
              <label>ページサイズ<select value={layout.page.size} onChange={(event) => patchLayout((next) => { next.page.size = event.target.value as ExportLayoutProfile["page"]["size"]; return next; })}>{["B6", "A5", "A6", "B5", "A4", "custom"].map((size) => <option key={size} value={size}>{size === "custom" ? "カスタム" : size}</option>)}</select></label>
              <div className="exportFieldGrid two"><label>幅 (mm)<input type="number" value={pageWidth} disabled={layout.page.size !== "custom"} onChange={(event) => patchLayout((next) => { next.page.widthMm = Number(event.target.value); return next; })}/></label><label>高さ (mm)<input type="number" value={pageHeight} disabled={layout.page.size !== "custom"} onChange={(event) => patchLayout((next) => { next.page.heightMm = Number(event.target.value); return next; })}/></label></div>
              <span className="exportFieldLabel">余白 (mm)</span>
              <div className="exportFieldGrid four">
                {([['天','marginTopMm'],['地','marginBottomMm'],['ノド','marginInnerMm'],['小口','marginOuterMm']] as const).map(([label, key]) => <label key={key}>{label}<input type="number" min="0" value={layout.page[key]} onChange={(event) => patchLayout((next) => { next.page[key] = Number(event.target.value); return next; })}/></label>)}
              </div><p className="exportHelp">ノド = 綴じ側の余白 ／ 小口 = ページを開く側の余白</p>
            </div>}

            {renderSectionHeader("body", "本文設定", bodySummary)}
            {openSections.has("body") && <div className="exportSettingsContent">
              <label>本文フォント<select value={layout.body.fontFamily} onChange={(event) => patchLayout((next) => { next.body.fontFamily = event.target.value as ExportLayoutProfile["body"]["fontFamily"]; return next; })}><option value="Noto Serif CJK JP">源ノ明朝（明朝体）</option><option value="Noto Sans CJK JP">源ノ角ゴシック（ゴシック体）</option></select></label>
              <div className="exportFieldGrid two"><label>文字サイズ (Q)<input type="number" min="6" step="0.5" value={layout.body.fontSize} onChange={(event) => patchLayout((next) => { next.body.fontSize = Number(event.target.value); next.body.fontSizeUnit = "Q"; return next; })}/></label><label>行間<input type="number" min="1" step="0.05" value={layout.body.lineHeight} onChange={(event) => patchLayout((next) => { next.body.lineHeight = Number(event.target.value); return next; })}/></label></div>
              <span className="exportFieldLabel">段組</span><div className="exportPillGroup"><button type="button" className={layout.body.columns === 1 ? "active" : ""} onClick={() => patchLayout((next) => { next.body.columns = 1; return next; })}>1段</button><button type="button" className={layout.body.columns === 2 ? "active" : ""} onClick={() => patchLayout((next) => { next.body.columns = 2; return next; })}>2段</button></div>
              <label>段間 (mm)<input type="number" min="0" value={layout.body.columnGapMm} disabled={layout.body.columns === 1} onChange={(event) => patchLayout((next) => { next.body.columnGapMm = Number(event.target.value); return next; })}/></label>
            </div>}

            {renderSectionHeader("header", "ヘッダー", layout.header.enabled ? "表示" : "なし")}
            {openSections.has("header") && <div className="exportSettingsContent">
              <label>表示内容<select value={layout.header.content} onChange={(event) => patchLayout((next) => { next.header.content = event.target.value as ExportLayoutProfile["header"]["content"]; next.header.enabled = next.header.content !== "none"; return next; })}><option value="none">なし</option><option value="title">作品名</option><option value="chapter">現在の章タイトル</option><option value="file">現在のファイル名</option><option value="custom">任意テキスト</option></select></label>
              {layout.header.content === "custom" && <input type="text" placeholder="ヘッダー文字列" value={layout.header.customText ?? ""} onChange={(event) => patchLayout((next) => { next.header.customText = event.target.value; return next; })}/>} 
              {([['章扉では非表示','hideOnTitlePage'],['先頭ページでは非表示','hideOnFirstPage'],['奇数・偶数ページで出し分け','differentOddEven']] as const).map(([label, key]) => <label className="exportCheckRow" key={key}><input type="checkbox" checked={layout.header[key]} onChange={() => patchLayout((next) => { next.header[key] = !next.header[key]; return next; })}/>{label}</label>)}
            </div>}

            {renderSectionHeader("footer", "フッター・ページ番号", layout.footer.enabled ? `ページ番号 ${layout.footer.pageNumberPosition}` : "非表示")}
            {openSections.has("footer") && <div className="exportSettingsContent">
              <label className="exportCheckRow"><input type="checkbox" checked={layout.footer.enabled} onChange={() => patchLayout((next) => { next.footer.enabled = !next.footer.enabled; return next; })}/>ページ番号を表示 <small>（ノンブル）</small></label>
              <label>フッター内容<select value={layout.footer.content} onChange={(event) => patchLayout((next) => { next.footer.content = event.target.value as ExportLayoutProfile["footer"]["content"]; return next; })}><option value="none">なし</option><option value="page-number">ページ番号</option><option value="title">作品名</option><option value="custom">任意テキスト</option></select></label>
              {layout.footer.content === "custom" && <input type="text" placeholder="フッター文字列" value={layout.footer.customText ?? ""} onChange={(event) => patchLayout((next) => { next.footer.customText = event.target.value; return next; })}/>} 
              <div className="exportFieldGrid two"><label>開始番号<input type="number" min="1" value={layout.footer.startPageNumber} onChange={(event) => patchLayout((next) => { next.footer.startPageNumber = Number(event.target.value); return next; })}/></label><label>位置<select value={layout.footer.pageNumberPosition} onChange={(event) => patchLayout((next) => { next.footer.pageNumberPosition = event.target.value as ExportLayoutProfile["footer"]["pageNumberPosition"]; return next; })}><option value="bottom-center">下中央</option><option value="top-center">上中央</option><option value="outer">外側</option><option value="inner">内側</option></select></label></div>
              <p className="exportHelp">外側 = 見開きの左右端 ／ 内側 = 綴じ側</p>
            </div>}

            {renderSectionHeader("preset", "プリセット", layout.name ?? "カスタム")}
            {openSections.has("preset") && <div className="exportSettingsContent exportPresetButtons"><button type="button" onClick={() => applyPreset("standard")}>標準・縦書き文庫</button><button type="button" onClick={() => applyPreset("doujin")}>同人誌 B6・1段</button><button type="button" onClick={() => applyPreset("a5-2col")}>A5・2段組</button><button type="button" onClick={() => { const stored = readLastLayout(); if (stored) patchLayout(() => stored); }}>前回設定を読み込む</button><button type="button" onClick={saveLayout}>この設定を保存</button></div>}
          </aside>
        </div>

        <footer className="exportModalFooter">
          <span className="exportSavedLabel">{savedLabel}</span>
          <button type="button" onClick={onClose}>キャンセル</button>
          <button type="button" onClick={saveLayout}>設定を保存</button>
          <button type="button" className={format === "docx" ? "primary" : ""} onClick={() => void runExport("docx")} disabled={includedCount === 0}>DOCXを書き出す</button>
          <button type="button" className={format === "pdf" ? "primary" : ""} onClick={() => void runExport("pdf")} disabled={includedCount === 0}>PDFを書き出す</button>
        </footer>

        {viewState === "pdf-generating" && (
          <div className="exportProgressOverlay"><div><span className="exportSpinner"/><strong>{format.toUpperCase()}生成中…</strong><p>{progress.message}</p><div className="exportProgressBar"><i style={{ width: `${progress.percent}%` }}/></div><div className="exportProgressMeta"><span>{progress.currentPage} / {progress.totalPages} ページ</span><span>{Math.round(progress.percent)}%</span></div></div></div>
        )}
        {viewState === "pdf-complete" && completed && (
          <div className="exportProgressOverlay"><div className="exportCompleteCard"><span>✓</span><strong>{completed.format.toUpperCase()}を書き出しました</strong><p>全 {completed.pageCount} ページ・{includedCount} ファイルを連結しました。<br/>{completed.result.name}</p><div><button type="button" onClick={onClose}>閉じる</button><button type="button" className="primary" onClick={() => onOpenResult(completed.result.path)}>保存先を開く</button></div></div></div>
        )}
      </section>
    </div>
  );
}
