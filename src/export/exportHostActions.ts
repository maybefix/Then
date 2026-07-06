import { invoke } from "@tauri-apps/api/core";
import type {
  PreparedDocxExport,
  PreparedPdfExport,
} from "../components/export/LinkedExportScreen";
import type { ExportResult } from "./types";
import { resolvePageDimensions } from "./types";

// LinkedExportScreen をホストする側（専用ウィンドウ／メイン画面のエクスポート
// モード）で共有する出力ハンドラ。組版済みアセットを受け取り、保存ダイアログと
// Rust コマンドの呼び出しだけを行う。

type ExportProgress = {
  percent: number;
  currentPage: number;
  totalPages: number;
  message: string;
};

const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*]|[\u0000-\u001f]/g;

export function exportFileName(title: string, extension: "docx" | "pdf"): string {
  const safeTitle = title.replace(INVALID_FILE_NAME_CHARS, "_").trim() || "本文連結";
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

// Active PDF engine: Vivliostyle lays out the flowing HTML (CSS Paged Media)
// in a hidden bundled-viewer webview, then WebView2 PrintToPdf serializes it.
export async function exportPdfWithVivliostyle(
  assets: PreparedPdfExport,
  onProgress: (progress: ExportProgress) => void,
): Promise<ExportResult> {
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
}

export async function exportDocxWithDialog(
  assets: PreparedDocxExport,
  onProgress: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  onProgress({ percent: 76, currentPage: 0, totalPages: 0, message: "保存データを準備しています" });
  const result = await invoke<ExportResult | null>("save_export_file_dialog", {
    dataBase64: bytesToBase64(assets.bytes),
    fileName: exportFileName(assets.title, "docx"),
    extension: "docx",
    description: "Word文書",
  });
  if (!result) throw new Error("保存先の選択をキャンセルしました");
  return result;
}
