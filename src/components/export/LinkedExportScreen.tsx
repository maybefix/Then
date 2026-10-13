import { ExportSourceSelector } from "./ExportSourceSelector";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SubmissionExportPanel } from "./SubmissionExportPanel";
import { ExportTopbar, type ExportMobileTab } from "./ExportTopbar";
import "../studio/studio.css";
import "./exportStudio.css";

// This screen is mounted as the complete contents of a dedicated Tauri window.
import { exportBlockHtml } from "../../export/linkedDocument";
import {
  prepareExportDocx,
  prepareExportPdf,
} from "../../export/typesetClient";
import {
  clearCoverImage,
  loadFrontMatter,
  pickCoverImage,
  saveFrontMatterLayout,
  saveFrontMatterText,
} from "../../export/frontMatterStore";
import type {
  ExportCoverImage,
  ExportFrontMatterLayout,
  ExportErrorKind,
  ExportFormat,
  ExportJob,
  ExportLayoutProfile,
  ExportPageModel,
  ExportResult,
  ExportViewState,
  LinkedExportDocument,
  LoadedExportSource,
} from "../../export/types";
import {
  DEFAULT_EXPORT_LAYOUT,
  resolvePageDimensions,
  withFrontMatterDefaults,
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
  /** 作品フォルダ。表紙の文字列・画像の保存先で、無ければ保存しない。 */
  projectPath?: string | null;
  initialSources: LoadedExportSource[];
  sourceError?: string;
  embedded?: boolean;
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

const LAST_LAYOUT_KEY = "then-linked-export-layout-v2";
const SAVED_PRESETS_KEY = "then-linked-export-presets-v1";

type SavedPreset = { name: string; layout: ExportLayoutProfile };

function readSavedPresets(): SavedPreset[] {
  try {
    const stored = localStorage.getItem(SAVED_PRESETS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as SavedPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((preset) =>
      typeof preset?.name === "string" &&
      (preset.layout?.body?.writingMode === "vertical-rl" || preset.layout?.body?.writingMode === "horizontal-tb"))
      .map((preset) => ({ ...preset, layout: withFrontMatterDefaults(preset.layout) }));
  } catch {
    return [];
  }
}


const headerContentLabels: Record<ExportLayoutProfile["header"]["content"], string> = {
  none: "なし",
  title: "作品名",
  chapter: "章タイトル",
  file: "ファイル名",
  custom: "任意",
};

const footerContentLabels: Record<ExportLayoutProfile["footer"]["content"], string> = {
  none: "なし",
  "page-number": "ページ番号",
  title: "作品名",
  custom: "任意",
};

const pageNumberPositionLabels: Record<ExportLayoutProfile["footer"]["pageNumberPosition"], string> = {
  "bottom-center": "下中央",
  "top-center": "上中央",
  outer: "外側",
  inner: "内側",
};

const ChevronIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>;

function cloneLayout(layout: ExportLayoutProfile): ExportLayoutProfile {
  return JSON.parse(JSON.stringify(layout)) as ExportLayoutProfile;
}

function readLastLayout(): ExportLayoutProfile | null {
  try {
    const stored = localStorage.getItem(LAST_LAYOUT_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as ExportLayoutProfile;
    return parsed?.body?.writingMode === "vertical-rl" || parsed?.body?.writingMode === "horizontal-tb"
      ? withFrontMatterDefaults(parsed)
      : null;
  } catch {
    return null;
  }
}

// 表紙・目次の設定は書き出しを待たずに変更のたびに覚える。作品フォルダが
// あれば作品ごとに project.json へ、どの作品でも直前の値を localStorage へ。
const LAST_FRONT_MATTER_KEY = "then-linked-export-front-matter-v1";

function normalizeFrontMatter(value: Partial<ExportFrontMatterLayout> | null | undefined): ExportFrontMatterLayout {
  return withFrontMatterDefaults({ ...DEFAULT_EXPORT_LAYOUT, frontMatter: value as ExportFrontMatterLayout }).frontMatter;
}

function readLastFrontMatter(): ExportFrontMatterLayout | null {
  try {
    const stored = localStorage.getItem(LAST_FRONT_MATTER_KEY);
    return stored ? normalizeFrontMatter(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

function initialLayout(sources: LoadedExportSource[]): ExportLayoutProfile {
  const stored = readLastLayout();
  const layout = cloneLayout(stored ?? DEFAULT_EXPORT_LAYOUT);
  if (sources.length > 0 && !stored) layout.body.fontFamily = "Noto Serif CJK JP";
  const frontMatter = readLastFrontMatter();
  return frontMatter ? { ...layout, frontMatter } : layout;
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
  const params = `src=${dataUrl}&bookMode=true&spreadView=true&renderAllPages=true`;
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
    writingMode: document.layout.body.writingMode,
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

// An array keeps "file" first; object keys that look like integers sort first.
const tocDepthOptions = [
  ["file", "ファイル単位"],
  ["1", "見出し1まで"],
  ["2", "見出し2まで"],
] as const;

function tocDepthLabel(depth: ExportLayoutProfile["frontMatter"]["toc"]["depth"]): string {
  return tocDepthOptions.find(([value]) => value === String(depth))?.[1] ?? "";
}

function readableImageUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export function LinkedExportScreen({
  title,
  projectPath = null,
  initialSources,
  sourceError,
  embedded = false,
  onClose,
  onOpenSource,
  onExportPdf,
  onExportDocx,
  onOpenResult,
}: LinkedExportScreenProps) {
  const [purpose, setPurpose] = useState<"print" | "submission">("print");
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [sources, setSources] = useState(() => withOrder(initialSources));
  const [layout, setLayout] = useState(() => initialLayout(initialSources));
  const [viewState, setViewState] = useState<ExportViewState>(sourceError ? "preview-error" : "no-preview");
  const [previewStale, setPreviewStale] = useState(false);
  const [activeTab, setActiveTab] = useState<ExportMobileTab>("files");
  const [openSections, setOpenSections] = useState(() => new Set(["page"]));
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [unavailableImages, setUnavailableImages] = useState<string[]>([]);
  const [imageListOpen, setImageListOpen] = useState(false);
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
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>(readSavedPresets);
  const [presetChoice, setPresetChoice] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetFormOpen, setPresetFormOpen] = useState(false);
  const [frontText, setFrontText] = useState({ title: "", subtitle: "", author: "" });
  const [coverImage, setCoverImage] = useState<ExportCoverImage | null>(null);
  const frontLoaded = useRef(false);

  // 作品ごとの前付けの値を読み込み、編集したら少し待って保存する。
  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void loadFrontMatter(projectPath)
      .then((stored) => {
        if (cancelled) return;
        setFrontText({ title: stored.title, subtitle: stored.subtitle, author: stored.author });
        setCoverImage(stored.coverImage);
        // この作品で前回使った表紙・目次の設定を優先する。
        if (stored.layout) {
          const frontMatter = normalizeFrontMatter(stored.layout);
          setLayout((current) => ({ ...current, frontMatter }));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) frontLoaded.current = true; });
    return () => { cancelled = true; };
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath || !frontLoaded.current) return;
    const timer = window.setTimeout(() => {
      void saveFrontMatterText(projectPath, frontText)
        .catch(() => flashSavedLabel("表紙の情報を保存できませんでした"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [frontText, projectPath]);

  const frontMatterJson = JSON.stringify(layout.frontMatter);
  useEffect(() => {
    try {
      localStorage.setItem(LAST_FRONT_MATTER_KEY, frontMatterJson);
    } catch {
      // 記憶できなくても書き出しには影響しない。
    }
    if (!projectPath || !frontLoaded.current) return;
    const timer = window.setTimeout(() => {
      void saveFrontMatterLayout(projectPath, JSON.parse(frontMatterJson) as ExportFrontMatterLayout)
        .catch(() => flashSavedLabel("表紙・目次の設定を保存できませんでした"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [frontMatterJson, projectPath]);

  const workTitle = frontText.title.trim() || title;


  const job = useMemo<ExportJob>(() => ({
    format,
    title: workTitle,
    sources: sources.map(({ content: _content, ...source }) => source),
    layout,
    frontMatter: { subtitle: frontText.subtitle, author: frontText.author, coverImage },
  }), [coverImage, format, frontText.author, frontText.subtitle, layout, sources, workTitle]);
  const includedCount = sources.filter((source) => source.enabled).length;
  const includedChars = sources.reduce((sum, source) => sum + (source.enabled ? source.chars ?? source.content.length : 0), 0);

  // Keep the current preview on screen and flag it as stale instead of
  // dropping back to the empty state on every tweak.
  const markPreviewStale = () => {
    if (viewState === "preview-ready" || viewState === "preview-loading") setPreviewStale(true);
  };

  const patchFrontText = (patch: Partial<typeof frontText>) => {
    setFrontText((current) => ({ ...current, ...patch }));
    markPreviewStale();
  };

  const chooseCoverImage = async () => {
    if (!projectPath) return;
    try {
      const picked = await pickCoverImage(projectPath);
      if (!picked) return;
      setCoverImage(picked);
      markPreviewStale();
    } catch (error) {
      flashSavedLabel(String(error));
    }
  };

  const removeCoverImage = async () => {
    if (!projectPath) return;
    try {
      await clearCoverImage(projectPath);
      setCoverImage(null);
      markPreviewStale();
    } catch (error) {
      flashSavedLabel(String(error));
    }
  };

  const patchLayout = (updater: (current: ExportLayoutProfile) => ExportLayoutProfile) => {
    setLayout((current) => updater(cloneLayout(current)));
    markPreviewStale();
    // Manual edits detach the layout from the selected preset. applyPresetChoice
    // re-selects afterwards within the same batch, so preset loads keep theirs.
    setPresetChoice("");
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
    if (viewState === "preview-ready" || viewState === "preview-loading") setPreviewStale(true);
  };

  const refreshPreview = () => {
    setFailure(null);
    setPreviewStale(false);
    setViewState("preview-loading");
    // The HTML is built off-thread, then rendered by the bundled Vivliostyle
    // Viewer — the exact same engine and document the PDF uses, so the preview
    // matches the output page-for-page.
    void prepareExportPdf(job, sources)
      .then((assets) => {
        setPreviewSrc(vivliostyleViewerSrc(assets.vivliostyleHtml));
        setUnavailableImages(assets.unavailableImageUrls);
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

  const applyPreset = (preset: "standard" | "doujin" | "a5-2col" | "a4-horizontal") => {
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
    } else if (preset === "a4-horizontal") {
      next.name = "A4・横書き";
      next.page.size = "A4";
      next.page.marginTopMm = 20;
      next.page.marginBottomMm = 20;
      next.page.marginInnerMm = 22;
      next.page.marginOuterMm = 18;
      next.body.writingMode = "horizontal-tb";
      next.body.columns = 1;
      next.body.fontSize = 13;
      next.body.lineHeight = 1.75;
    }
    patchLayout((current) => ({ ...next, frontMatter: current.frontMatter }));
  };

  const flashSavedLabel = (message: string) => {
    setSavedLabel(message);
    window.setTimeout(() => setSavedLabel(""), 2400);
  };

  const applyPresetChoice = (value: string) => {
    if (!value) return;
    if (value.startsWith("builtin:")) {
      applyPreset(value.slice("builtin:".length) as Parameters<typeof applyPreset>[0]);
    } else if (value === "last") {
      const stored = readLastLayout();
      if (!stored) return;
      patchLayout((current) => ({ ...stored, frontMatter: current.frontMatter }));
    } else if (value.startsWith("saved:")) {
      const preset = savedPresets.find((item) => item.name === value.slice("saved:".length));
      if (!preset) return;
      // 表紙・目次は作品ごとの設定なので、プリセットでは切り替えない。
      patchLayout((current) => ({ ...cloneLayout(preset.layout), frontMatter: current.frontMatter }));
    }
    setPresetChoice(value);
  };

  const persistPresets = (next: SavedPreset[]) => {
    setSavedPresets(next);
    localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next));
  };

  const saveNamedPreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const snapshot = cloneLayout(layout);
    snapshot.name = name;
    const overwrite = savedPresets.some((item) => item.name === name);
    persistPresets([...savedPresets.filter((item) => item.name !== name), { name, layout: snapshot }]);
    setLayout(snapshot);
    setPresetChoice(`saved:${name}`);
    setPresetName("");
    flashSavedLabel(overwrite ? `「${name}」を上書き保存しました` : `「${name}」として保存しました`);
  };

  const deleteNamedPreset = () => {
    if (!presetChoice.startsWith("saved:")) return;
    const name = presetChoice.slice("saved:".length);
    persistPresets(savedPresets.filter((item) => item.name !== name));
    setPresetChoice("");
    flashSavedLabel(`「${name}」を削除しました`);
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
        setUnavailableImages(assets.unavailableImageUrls);
        result = await onExportPdf(
          { ...assets, layout: nextJob.layout, title: workTitle },
          reportProgress,
        );
      } else {
        const assets = await prepareExportDocx(nextJob, sources);
        pageCount = assets.pageCount;
        result = await onExportDocx({ bytes: assets.bytes, title: workTitle }, reportProgress);
      }
      setProgress({
        percent: 100,
        currentPage: pageCount,
        totalPages: pageCount,
        message: `${targetFormat.toUpperCase()}を書き出しました`,
      });
      setCompleted({ result, format: targetFormat, pageCount });
      setViewState("pdf-complete");
      // 書き出しに成功したレイアウトを次回の初期値として自動保存する。
      localStorage.setItem(LAST_LAYOUT_KEY, JSON.stringify(nextJob.layout));
    } catch (error) {
      setFailure({
        kind: errorKindFor(targetFormat),
        message: `${targetFormat.toUpperCase()}を書き出せませんでした`,
        detail: String(error),
      });
      setViewState("preview-error");
    }
  };

  const renderCard = (id: string, label: string, summary: string, body: () => ReactNode) => {
    const open = openSections.has(id);
    return (
      <section className="exCard">
        <button type="button" className="exCardToggle" aria-expanded={open} onClick={() => toggleSection(id)}>
          <ChevronIcon/><span className="exCardTitle">{label}</span><span className="exCardSum">{summary}</span>
        </button>
        {open && <div className="exCardBody">{body()}</div>}
      </section>
    );
  };

  const [pageWidth, pageHeight] = resolvePageDimensions(layout);
  const pageSummary = `${layout.page.size === "custom" ? "カスタム" : layout.page.size}・余白 ${layout.page.marginTopMm}mm`;
  const directionLabel = layout.body.writingMode === "horizontal-tb" ? "横書き" : "縦書き";
  const bodySummary = `${directionLabel}・${layout.body.fontFamily.includes("Serif") ? "明朝" : "ゴシック"} ${layout.body.fontSize}${layout.body.fontSizeUnit}・${layout.body.columns}段`;
  const headerHiddenSummary = [
    layout.header.hideOnTitlePage ? "章扉" : "",
    layout.header.hideOnFirstPage ? "先頭" : "",
  ].filter(Boolean).join("・");
  const footerHiddenSummary = [
    layout.footer.hideOnTitlePage ? "章扉" : "",
    layout.footer.hideOnFirstPage ? "先頭" : "",
  ].filter(Boolean).join("・");
  const headerSummary = layout.header.enabled && layout.header.content !== "none"
    ? `${headerContentLabels[layout.header.content]}${headerHiddenSummary ? `・${headerHiddenSummary}非表示` : ""}`
    : "なし";
  const footerSummary = layout.footer.enabled && layout.footer.content !== "none"
    ? `${footerContentLabels[layout.footer.content]}・${pageNumberPositionLabels[layout.footer.pageNumberPosition]}${footerHiddenSummary ? `・${footerHiddenSummary}非表示` : ""}`
    : "なし";
  const frontMatter = layout.frontMatter;
  const frontSummary = [
    frontMatter.cover.enabled
      ? `表紙（${frontMatter.cover.kind === "text" ? "文字" : frontMatter.cover.overlayText ? "画像＋文字" : "画像"}）`
      : "",
    frontMatter.toc.enabled ? `目次（${tocDepthLabel(frontMatter.toc.depth)}）` : "",
  ].filter(Boolean).join("・") || "なし";
  const busy = viewState === "pdf-generating";
  const sourceSelector = <ExportSourceSelector sources={sources} activeTab={activeTab}
    showStartMode={purpose === "print"} updateSources={updateSources} onOpenSource={onOpenSource} />;
  const topbarCommon = {
    embedded,
    purpose,
    onPurpose: setPurpose,
    purposeLocked: busy,
    onClose,
    activeTab,
    onTab: setActiveTab,
  };
  const imageLabel = (url: string) => {
    const base = job.imageUrlBase;
    return readableImageUrl(base && url.startsWith(base) ? url.slice(base.length) : url);
  };
  const seg = (pressed: boolean, label: string, onClick: () => void) =>
    <button type="button" aria-pressed={pressed} onClick={onClick}>{label}</button>;

  return (
    <div className="exportModalBackdrop" role="presentation">
      <section className="linkedExportScreen exStudio stStudio" aria-label="書き出し">
        {purpose === "submission" ? <SubmissionExportPanel title={title} sources={sources} sourceError={sourceError}
          activeTab={activeTab} sourceSelector={sourceSelector} topbar={topbarCommon} onOpenSource={onOpenSource} /> : <>
        <ExportTopbar
          {...topbarCommon}
          status={savedLabel || (includedCount > 0 ? `${includedCount}ファイル・${includedChars.toLocaleString()}字` : "ファイルを選んでください")}
          statusTone={savedLabel ? "ok" : undefined}
          menu={[
            { label: "DOCXで書き出す", onSelect: () => void runExport("docx"), disabled: includedCount === 0 || busy },
            "separator",
            { label: "今の設定をプリセットに保存…", onSelect: () => setPresetFormOpen(true) },
          ]}
          primary={<button type="button" className="stBtnPrimary" onClick={() => void runExport("pdf")} disabled={includedCount === 0 || busy}>PDFを書き出す</button>}
        />
        <div className="exLayout">
          {sourceSelector}

          <main className={`exMain${activeTab === "preview" ? " mobileActive" : ""}`} aria-label="組版プレビュー">
            <div className="exMainBar">
              <span className="exMainTitle">プレビュー</span>
              <span className="exMainMeta">{layout.name ?? "カスタム"}</span>
              <span className="exSpacer"/>
              {previewStale && viewState === "preview-ready" && (
                <span className="exStale" role="status">設定が変わりました
                  <button type="button" className="stBtnLine" onClick={refreshPreview} disabled={includedCount === 0}>プレビューを更新</button>
                </span>
              )}
            </div>
            {viewState === "preview-ready" && previewSrc && unavailableImages.length > 0 && (
              <div className="exNotice" role="status">
                <div className="exNoticeRow">
                  <span>画像{unavailableImages.length}件を読み込めません</span>
                  <button type="button" aria-expanded={imageListOpen} onClick={() => setImageListOpen((open) => !open)}>{imageListOpen ? "閉じる" : "どの画像か見る"}</button>
                </div>
                {imageListOpen && <ul>{unavailableImages.map((url) => <li key={url}><code>{imageLabel(url)}</code></li>)}</ul>}
              </div>
            )}
            <div className="exStage">
              {viewState === "no-preview" && (
                <div className="exEmpty">
                  <strong>まだプレビューがありません</strong>
                  <button type="button" className="stBtnPrimary sm" onClick={refreshPreview} disabled={includedCount === 0}>プレビューを表示</button>
                </div>
              )}
              {viewState === "preview-loading" && (
                <div className="exEmpty"><span className="exSpinner"/><strong>組版しています…</strong></div>
              )}
              {viewState === "preview-ready" && previewSrc && (
                // ツールバーとロゴは Vivliostyle Viewer のまま表示する（組み込み元の表示を消さない）。
                <iframe key={previewSrc} className="exViewer" src={previewSrc} title="組版プレビュー"/>
              )}
              {viewState === "preview-error" && failure && (
                <div className="exEmpty isError" role="alert">
                  <strong>{failure.message}</strong>
                  <button type="button" className="exLogToggle" aria-expanded={showErrorDetail} onClick={() => setShowErrorDetail((value) => !value)}>{showErrorDetail ? "詳細を隠す" : "詳細を表示"}</button>
                  {showErrorDetail && <pre>[{failure.kind}] {failure.detail}</pre>}
                  <div className="exRowEnd">
                    {failure.sourcePath && <button type="button" className="stBtnLine" onClick={() => onOpenSource(failure.sourcePath!)}>該当ファイルを開く</button>}
                    <button type="button" className="stBtnPrimary sm" onClick={refreshPreview}>もう一度試す</button>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className={`exSettings${activeTab === "settings" ? " mobileActive" : ""}`} aria-label="レイアウト設定">
            <div className="exPreset">
              <label className="exField">プリセット
                <select value={presetChoice} onChange={(event) => applyPresetChoice(event.target.value)}>
                  <option value="">{`${layout.name ?? "カスタム"}（現在の設定）`}</option>
                  <optgroup label="標準プリセット">
                    <option value="builtin:standard">標準・縦書き文庫</option>
                    <option value="builtin:doujin">同人誌 B6・1段</option>
                    <option value="builtin:a5-2col">A5・2段組</option>
                    <option value="builtin:a4-horizontal">A4・横書き</option>
                    <option value="last" disabled={!readLastLayout()}>前回の書き出し設定</option>
                  </optgroup>
                  {savedPresets.length > 0 && <optgroup label="保存した設定">
                    {savedPresets.map((preset) => <option key={preset.name} value={`saved:${preset.name}`}>{preset.name}</option>)}
                  </optgroup>}
                </select>
              </label>
              {presetChoice.startsWith("saved:") && !presetFormOpen && (
                <div className="exRowEnd"><button type="button" className="stBtnGhost sm exDanger" onClick={deleteNamedPreset}>「{presetChoice.slice("saved:".length)}」を削除</button></div>
              )}
              {presetFormOpen && (
                <div className="exPresetForm">
                  <label className="exField">今の設定に名前を付けて保存
                    <input
                      type="text"
                      autoFocus
                      placeholder="例：文庫用"
                      maxLength={40}
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing && presetName.trim()) { saveNamedPreset(); setPresetFormOpen(false); }
                        if (event.key === "Escape") setPresetFormOpen(false);
                      }}
                    />
                  </label>
                  <div className="exRowEnd">
                    <button type="button" className="stBtnGhost" onClick={() => { setPresetFormOpen(false); setPresetName(""); }}>やめる</button>
                    <button type="button" className="stBtnPrimary sm" disabled={!presetName.trim()} onClick={() => { saveNamedPreset(); setPresetFormOpen(false); }}>{savedPresets.some((item) => item.name === presetName.trim()) ? "上書き保存する" : "保存する"}</button>
                  </div>
                </div>
              )}
            </div>

            {renderCard("page", "ページ", pageSummary, () => <>
              <label className="exField">サイズ<select value={layout.page.size} onChange={(event) => patchLayout((next) => { next.page.size = event.target.value as ExportLayoutProfile["page"]["size"]; return next; })}>{["B6", "A5", "A6", "B5", "A4", "custom"].map((size) => <option key={size} value={size}>{size === "custom" ? "カスタム" : size}</option>)}</select></label>
              <div className="exGrid two"><label className="exField">幅 mm<input type="number" value={pageWidth} disabled={layout.page.size !== "custom"} onChange={(event) => patchLayout((next) => { next.page.widthMm = Number(event.target.value); return next; })}/></label><label className="exField">高さ mm<input type="number" value={pageHeight} disabled={layout.page.size !== "custom"} onChange={(event) => patchLayout((next) => { next.page.heightMm = Number(event.target.value); return next; })}/></label></div>
              <div className="exField">余白 mm
                <div className="exGrid four">
                  {([['天','marginTopMm'],['地','marginBottomMm'],['ノド','marginInnerMm'],['小口','marginOuterMm']] as const).map(([label, key]) => <label className="exField" key={key}>{label}<input type="number" min="0" value={layout.page[key]} onChange={(event) => patchLayout((next) => { next.page[key] = Number(event.target.value); return next; })}/></label>)}
                </div>
              </div>
            </>)}

            {renderCard("body", "本文", bodySummary, () => <>
              <div className="exField">組み方向
                <div className="stSeg" role="group" aria-label="組み方向">
                  {seg(layout.body.writingMode === "vertical-rl", "縦書き", () => patchLayout((next) => { next.body.writingMode = "vertical-rl"; return next; }))}
                  {seg(layout.body.writingMode === "horizontal-tb", "横書き", () => patchLayout((next) => { next.body.writingMode = "horizontal-tb"; return next; }))}
                </div>
              </div>
              <label className="exField">書体<select value={layout.body.fontFamily} onChange={(event) => patchLayout((next) => { next.body.fontFamily = event.target.value as ExportLayoutProfile["body"]["fontFamily"]; return next; })}><option value="Noto Serif CJK JP">源ノ明朝（明朝体）</option><option value="Noto Sans CJK JP">源ノ角ゴシック（ゴシック体）</option></select></label>
              <div className="exGrid two"><label className="exField">文字サイズ Q<input type="number" min="6" step="0.5" value={layout.body.fontSize} onChange={(event) => patchLayout((next) => { next.body.fontSize = Number(event.target.value); next.body.fontSizeUnit = "Q"; return next; })}/></label><label className="exField">行間<input type="number" min="1" step="0.05" value={layout.body.lineHeight} onChange={(event) => patchLayout((next) => { next.body.lineHeight = Number(event.target.value); return next; })}/></label></div>
              <div className="exGrid two">
                <div className="exField">段組
                  <div className="stSeg" role="group" aria-label="段組">
                    {seg(layout.body.columns === 1, "1段", () => patchLayout((next) => { next.body.columns = 1; return next; }))}
                    {seg(layout.body.columns === 2, "2段", () => patchLayout((next) => { next.body.columns = 2; return next; }))}
                  </div>
                </div>
                <label className="exField">段間 mm<input type="number" min="0" value={layout.body.columnGapMm} disabled={layout.body.columns === 1} onChange={(event) => patchLayout((next) => { next.body.columnGapMm = Number(event.target.value); return next; })}/></label>
              </div>
              <label className="exCheck"><input type="checkbox" checked={layout.body.figureCaptions !== false} onChange={() => patchLayout((next) => { next.body.figureCaptions = next.body.figureCaptions === false; return next; })}/>図版の説明をキャプションとして印字</label>
            </>)}

            {renderCard("header", "ヘッダー", headerSummary, () => <>
              <label className="exField">表示内容<select value={layout.header.content} onChange={(event) => patchLayout((next) => { next.header.content = event.target.value as ExportLayoutProfile["header"]["content"]; next.header.enabled = next.header.content !== "none"; return next; })}><option value="none">なし</option><option value="title">作品名</option><option value="chapter">現在の章タイトル</option><option value="file">現在のファイル名</option><option value="custom">任意テキスト</option></select></label>
              {layout.header.content === "custom" && <label className="exField">ヘッダーに表示する文字列<input type="text" placeholder="例：作品タイトル・章の名前など" value={layout.header.customText ?? ""} onChange={(event) => patchLayout((next) => { next.header.customText = event.target.value; return next; })}/></label>}
              {([['章扉では表示しない','hideOnTitlePage'],['先頭ページでは表示しない','hideOnFirstPage'],['奇数・偶数ページで出し分ける','differentOddEven']] as const).map(([label, key]) => <label className="exCheck" key={key}><input type="checkbox" checked={layout.header[key]} onChange={() => patchLayout((next) => { next.header[key] = !next.header[key]; return next; })}/>{label}</label>)}
            </>)}

            {renderCard("footer", "フッター・ノンブル", footerSummary, () => <>
              <label className="exCheck"><input type="checkbox" checked={layout.footer.enabled} onChange={() => patchLayout((next) => { next.footer.enabled = !next.footer.enabled; return next; })}/>フッターを表示する</label>
              <label className="exField">表示内容<select value={layout.footer.content} onChange={(event) => patchLayout((next) => { next.footer.content = event.target.value as ExportLayoutProfile["footer"]["content"]; return next; })}><option value="none">なし</option><option value="page-number">ページ番号</option><option value="title">作品名</option><option value="custom">任意テキスト</option></select></label>
              {layout.footer.content === "custom" && <label className="exField">フッターに表示する文字列<input type="text" placeholder="例：作品タイトル・発行情報など" value={layout.footer.customText ?? ""} onChange={(event) => patchLayout((next) => { next.footer.customText = event.target.value; return next; })}/></label>}
              <div className="exGrid two"><label className="exField">開始番号<input type="number" min="1" value={layout.footer.startPageNumber} onChange={(event) => patchLayout((next) => { next.footer.startPageNumber = Number(event.target.value); return next; })}/></label><label className="exField">位置<select value={layout.footer.pageNumberPosition} onChange={(event) => patchLayout((next) => { next.footer.pageNumberPosition = event.target.value as ExportLayoutProfile["footer"]["pageNumberPosition"]; return next; })}>{Object.entries(pageNumberPositionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
              {([['章扉では表示しない','hideOnTitlePage'],['先頭ページでは表示しない','hideOnFirstPage']] as const).map(([label, key]) => <label className="exCheck" key={key}><input type="checkbox" checked={layout.footer[key]} onChange={() => patchLayout((next) => { next.footer[key] = !next.footer[key]; return next; })}/>{label}</label>)}
            </>)}

            {renderCard("frontmatter", "表紙・目次", frontSummary, () => <>
              <label className="exField">作品名<input type="text" placeholder={title} value={frontText.title} onChange={(event) => patchFrontText({ title: event.target.value })}/></label>
              <label className="exCheck"><input type="checkbox" checked={frontMatter.cover.enabled} onChange={() => patchLayout((next) => { next.frontMatter.cover.enabled = !next.frontMatter.cover.enabled; return next; })}/>表紙を付ける</label>
              {frontMatter.cover.enabled && <>
                <div className="stSeg" role="group" aria-label="表紙の種類">
                  {seg(frontMatter.cover.kind === "text", "文字", () => patchLayout((next) => { next.frontMatter.cover.kind = "text"; return next; }))}
                  {seg(frontMatter.cover.kind === "image", "画像", () => patchLayout((next) => { next.frontMatter.cover.kind = "image"; return next; }))}
                </div>
                {frontMatter.cover.kind === "image" && <>
                  {coverImage && <img className="exCoverThumb" src={`data:${coverImage.mime};base64,${coverImage.dataBase64}`} alt="表紙画像"/>}
                  <div className="exRowStart">
                    <button type="button" className="stBtnLine" disabled={!projectPath} onClick={() => void chooseCoverImage()}>{coverImage ? "画像を差し替える…" : "画像を選ぶ…"}</button>
                    {coverImage && <button type="button" className="stBtnGhost" onClick={() => void removeCoverImage()}>外す</button>}
                  </div>
                  <label className="exCheck"><input type="checkbox" checked={frontMatter.cover.overlayText} onChange={() => patchLayout((next) => { next.frontMatter.cover.overlayText = !next.frontMatter.cover.overlayText; return next; })}/>画像の上にタイトルを重ねる</label>
                  {frontMatter.cover.overlayText && <div className="stSeg" role="group" aria-label="文字の色">
                    {seg(frontMatter.cover.textColor === "light", "白い文字", () => patchLayout((next) => { next.frontMatter.cover.textColor = "light"; return next; }))}
                    {seg(frontMatter.cover.textColor === "dark", "黒い文字", () => patchLayout((next) => { next.frontMatter.cover.textColor = "dark"; return next; }))}
                  </div>}
                </>}
                {(frontMatter.cover.kind === "text" || frontMatter.cover.overlayText) && <>
                  <label className="exField">副題<input type="text" value={frontText.subtitle} onChange={(event) => patchFrontText({ subtitle: event.target.value })}/></label>
                  <label className="exField">著者名<input type="text" value={frontText.author} onChange={(event) => patchFrontText({ author: event.target.value })}/></label>
                  <div className="exGrid two">
                    <label className="exField">配置<select value={frontMatter.cover.align} onChange={(event) => patchLayout((next) => { next.frontMatter.cover.align = event.target.value as ExportLayoutProfile["frontMatter"]["cover"]["align"]; return next; })}><option value="center">天地中央</option><option value="upper">やや上寄せ</option></select></label>
                    <label className="exField">タイトル倍率<input type="number" min="1" max="5" step="0.1" value={frontMatter.cover.titleScale} onChange={(event) => patchLayout((next) => { next.frontMatter.cover.titleScale = Number(event.target.value); return next; })}/></label>
                  </div>
                </>}
              </>}
              <label className="exCheck"><input type="checkbox" checked={frontMatter.toc.enabled} onChange={() => patchLayout((next) => { next.frontMatter.toc.enabled = !next.frontMatter.toc.enabled; return next; })}/>目次を付ける</label>
              {frontMatter.toc.enabled && <div className="exGrid two">
                <label className="exField">収録範囲<select value={String(frontMatter.toc.depth)} onChange={(event) => patchLayout((next) => { const value = event.target.value; next.frontMatter.toc.depth = value === "file" ? "file" : Number(value) as 1 | 2; return next; })}>{tocDepthOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="exField">目次見出し<input type="text" value={frontMatter.toc.title} onChange={(event) => patchLayout((next) => { next.frontMatter.toc.title = event.target.value; return next; })}/></label>
              </div>}
            </>)}
          </aside>
        </div>
        </>}

        {viewState === "pdf-generating" && (
          <div className="exOverlay"><div className="exDialog" role="status">
            <span className="exSpinner"/>
            <h3>{format.toUpperCase()}を書き出しています</h3>
            <p>{progress.message}</p>
            <div className="exProgress"><i style={{ width: `${progress.percent}%` }}/></div>
            <div className="exProgressMeta"><span>{progress.currentPage} / {progress.totalPages} ページ</span><span>{Math.round(progress.percent)}%</span></div>
          </div></div>
        )}
        {viewState === "pdf-complete" && completed && (
          <div className="exOverlay"><div className="exDialog" role="status">
            <h3>{completed.format.toUpperCase()}を書き出しました</h3>
            <p>{includedCount}ファイル・全{completed.pageCount}ページを連結しました。</p>
            <p className="exResultName">{completed.result.name}</p>
            <div className="exRowEnd">
              <button type="button" className="stBtnGhost" onClick={onClose}>閉じる</button>
              <button type="button" className="stBtnLine" onClick={() => { setCompleted(null); setViewState(previewSrc ? "preview-ready" : "no-preview"); }}>書き出し画面に戻る</button>
              <button type="button" className="stBtnPrimary sm" onClick={() => onOpenResult(completed.result.path)}>保存先を開く</button>
            </div>
          </div></div>
        )}
      </section>
    </div>
  );
}
