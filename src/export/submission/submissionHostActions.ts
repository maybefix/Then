import { invoke } from "@tauri-apps/api/core";
import type { ExportResult, LoadedExportSource } from "../types";
import type { SubmissionTarget } from "./types";

export function submissionFileName(title: string, sources: readonly LoadedExportSource[], target: SubmissionTarget): string {
  const selected = sources.filter(source => source.enabled);
  const base = selected.length === 1 ? selected[0].displayName.replace(/\.(?:txt|md)$/i, "") : title;
  const safe = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "本文連結";
  return `${safe}_${target}.txt`;
}

export async function saveSubmissionText(text: string, fileName: string): Promise<ExportResult | null> {
  return invoke<ExportResult | null>("save_submission_text_dialog", { content: text, fileName });
}

export async function copySubmissionText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("クリップボードへ書き込めません");
  await navigator.clipboard.writeText(text);
}
