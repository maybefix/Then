import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LinkedExportScreen,
  type PreparedDocxExport,
  type PreparedPdfExport,
} from "./components/export/LinkedExportScreen";
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

function exportFileName(title: string, extension: "docx" | "pdf"): string {
  const safeTitle = title.replace(/[<>:\"/\\|?*\u0000-\u001f]/g, "_").trim() || "本文連結";
  return `${safeTitle}.${extension}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export default function ExportWindowApp() {
  const [payload, setPayload] = useState<ExportWindowPayload | null>(previewFixture);
  const [loadError, setLoadError] = useState("");
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

  // Active PDF engine: Vivliostyle lays out the flowing HTML (CSS Paged Media)
  // in a hidden bundled-viewer webview, then WebView2 PrintToPdf serializes it.
  const exportPdf = async (
    assets: PreparedPdfExport,
    onProgress: (progress: ExportProgress) => void,
  ): Promise<ExportResult> => {
    const destination = await invoke<ExportResult | null>("pick_export_path", {
      fileName: exportFileName(assets.title, "pdf"),
      extension: "pdf",
      description: "PDF文書",
    });
    if (!destination) throw new Error("保存先の選択をキャンセルしました");
    const [widthMm, heightMm] = resolvePageDimensions(assets.layout);
    onProgress({ percent: 45, currentPage: assets.pageCount, totalPages: assets.pageCount, message: "Vivliostyleで組版しています" });
    const result = await invoke<ExportResult>("export_pdf_vivliostyle", {
      html: assets.vivliostyleHtml,
      path: destination.path,
      pageWidthMm: widthMm,
      pageHeightMm: heightMm,
    });
    onProgress({ percent: 92, currentPage: assets.pageCount, totalPages: assets.pageCount, message: "PDFファイルを生成しています" });
    return result;
  };

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

  const exportDocx = async (
    assets: PreparedDocxExport,
    onProgress: (progress: ExportProgress) => void,
  ): Promise<ExportResult> => {
    onProgress({ percent: 76, currentPage: 0, totalPages: 0, message: "保存データを準備しています" });
    const result = await invoke<ExportResult | null>("save_export_file_dialog", {
      dataBase64: bytesToBase64(assets.bytes),
      fileName: exportFileName(assets.title, "docx"),
      extension: "docx",
      description: "Word文書",
    });
    if (!result) throw new Error("保存先の選択をキャンセルしました");
    return result;
  };

  if (loadError) {
    return <main className="exportWindowLoadState"><strong>エクスポート画面を開けませんでした</strong><pre>{loadError}</pre><button type="button" onClick={() => void loadPayload()}>再試行</button></main>;
  }
  if (!payload) return <main className="exportWindowLoadState"><span className="exportSpinner"/><strong>本文ファイルを読み込んでいます…</strong></main>;

  return (
    <main className="exportWindowRoot">
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
