import { invoke } from "@tauri-apps/api/core";
import { normalizeAppTheme } from "./themes";
import { listen } from "@tauri-apps/api/event";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  LinkedExportScreen,
  type PreparedPdfExport,
} from "./components/export/LinkedExportScreen";
import {
  exportDocxWithDialog,
  exportFileName,
  exportPdfWithVivliostyle,
} from "./export/exportHostActions";
import { applyPrintAssets } from "./export/nativePrint";
import type {
  ExportResult,
  LoadedExportSource,
} from "./export/types";
import { resolvePageDimensions } from "./export/types";

type ExportWindowPayload = {
  requestId: string;
  title: string;
  sources: LoadedExportSource[];
  sourceError?: string;
};

type ExportProgress = {
  percent: number;
  currentPage: number;
  totalPages: number;
  message: string;
};

const previewFixture: ExportWindowPayload | null =
  new URLSearchParams(window.location.search).get("fixture") === "1"
  ? {
      requestId: "fixture",
      title: "Then開発記",
      sources: [
        ["001_物語の始まり.txt", "# 物語の始まり\n\n縦書きの物語が始まる。"],
        ["002_シーン 2.txt", "# シーン 2\n\nこれは[日本語(rb,にほんご)]のルビを含む本文です。"],
        ["003_シーン 3.txt", "# シーン 3\n\n西暦[2026(tcy)]年、物語は続いていく。"],
        ["004_シーン 4.txt", "# シーン 4\n\n[基本的(em,goma)]にはいい感じに実装できた。"],
        ["Thenの残課題について.md", "# 残課題\n\n組版と出力を確認する。"],
        ["テスト作成その1.md", "# テスト\n\n複数本文を連結する。"],
        ["Then開発ログ.txt", "# 第二章 縦書きが成功している\n\n一日中縦書きエディタと向き合っていた。"],
      ].map(([name, content], index) => ({
        id: `fixture-${index}`,
        path: `C:\\fixture\\${name}`,
        extension: name.endsWith(".md") ? "md" : "txt",
        displayName: name,
        chars: content.length,
        enabled: index !== 4,
        order: index,
        startMode: index === 0 ? "continue" as const : "new-page" as const,
        markupMode: "then-markup" as const,
        content,
      })),
    }
  : null;

export default function ExportWindowApp() {
  const [payload, setPayload] = useState<ExportWindowPayload | null>(previewFixture);
  const [loadError, setLoadError] = useState("");
  const [theme, setTheme] = useState("dark");
  const [uiFont, setUiFont] = useState("");
  const [uiFontScale, setUiFontScale] = useState(1);
  const printViewportRef = useRef<HTMLDivElement>(null);

  const loadPayload = useCallback(async () => {
    try {
      const value = await invoke<ExportWindowPayload | null>("get_export_window_payload");
      if (!value) throw new Error("エクスポート対象が渡されていません");
      setPayload(value);
      setLoadError("");
    } catch (error) {
      setLoadError(String(error));
    }
  }, []);

  useEffect(() => {
    if (previewFixture) return;
    void loadPayload();
    let dispose: (() => void) | undefined;
    void listen<ExportWindowPayload>("then-export-payload", (event) => {
      setPayload(event.payload);
      setLoadError("");
    }).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, [loadPayload]);

  // Match the main window's theme colours and UI font.
  useEffect(() => {
    if (previewFixture) return;
    void invoke<{ settings?: { theme?: string; uiFontFamily?: string; uiFontScale?: number } } | null>("load_app_state")
      .then((state) => {
        const settings = state?.settings;
        if (settings?.theme) setTheme(normalizeAppTheme(settings.theme));
        if (settings?.uiFontFamily) setUiFont(settings.uiFontFamily);
        if (typeof settings?.uiFontScale === "number" && Number.isFinite(settings.uiFontScale)) {
          setUiFontScale(settings.uiFontScale);
        }
      })
      .catch(() => {});
  }, []);

  const themeStyle = {
    ...(uiFont ? { "--ui-font-family": uiFont } : {}),
    "--ui-font-scale": uiFontScale,
  } as CSSProperties;

  // Active PDF engine: Vivliostyle lays out the flowing HTML (CSS Paged Media)
  // in a hidden bundled-viewer webview, then WebView2 PrintToPdf serializes it.
  const exportPdf = exportPdfWithVivliostyle;

  // Native fallback engine: our own pagination + WebView2 PrintToPdf. Retained
  // (not wired) so the previous output path is preserved.
  const exportPdfNative = async (
    assets: PreparedPdfExport,
    onProgress: (progress: ExportProgress) => void,
  ): Promise<ExportResult> => {
    if (assets.pageCount < 1) throw new Error("PDFに出力するページがありません");
    const destination = await invoke<ExportResult | null>("pick_export_path", {
      fileName: exportFileName(assets.title, "pdf"),
      extension: "pdf",
      description: "PDF文書",
    });
    if (!destination) throw new Error("保存先の選択をキャンセルしました");
    const viewport = printViewportRef.current;
    if (!viewport) throw new Error("PDF組版用の表示領域を初期化できませんでした");

    const [widthMm, heightMm] = resolvePageDimensions(assets.layout);
    window.document.body.classList.add("thenPdfExporting");
    window.document.documentElement.setAttribute("data-export-paginated", "true");
    try {
      onProgress({ percent: 40, currentPage: assets.pageCount, totalPages: assets.pageCount, message: "紙面を組版しています" });
      await applyPrintAssets(assets.css, assets.markup, viewport);
      onProgress({ percent: 68, currentPage: assets.pageCount, totalPages: assets.pageCount, message: "PDFファイルを生成しています" });
      return await invoke<ExportResult>("export_pdf", {
        path: destination.path,
        pageWidthMm: widthMm,
        pageHeightMm: heightMm,
        marginTopMm: 0,
        marginRightMm: 0,
        marginBottomMm: 0,
        marginLeftMm: 0,
      });
    } finally {
      window.document.body.classList.remove("thenPdfExporting");
      window.document.documentElement.removeAttribute("data-export-paginated");
      viewport.replaceChildren();
    }
  };
  void exportPdfNative;

  const exportDocx = exportDocxWithDialog;

  if (loadError) {
    return <main className="appShell exportWindowLoadState" data-theme={theme} style={themeStyle}><strong>エクスポート画面を開けませんでした</strong><pre>{loadError}</pre><button type="button" onClick={() => void loadPayload()}>再試行</button></main>;
  }
  if (!payload) return <main className="appShell exportWindowLoadState" data-theme={theme} style={themeStyle}><span className="exportSpinner"/><strong>本文ファイルを読み込んでいます…</strong></main>;

  return (
    <main className="appShell exportWindowRoot" data-theme={theme} style={themeStyle}>
      <LinkedExportScreen
        key={payload.requestId}
        title={payload.title}
        initialSources={payload.sources}
        sourceError={payload.sourceError}
        onClose={() => void invoke("close_export_window")}
        onOpenSource={(path) => {
          void invoke("focus_source_in_main", { path }).then(() => invoke("close_export_window"));
        }}
        onExportPdf={exportPdf}
        onExportDocx={exportDocx}
        onOpenResult={(path) => void invoke("open_export_location", { path })}
      />
      <div ref={printViewportRef} className="printExportViewport" aria-hidden="true" />
    </main>
  );
}
