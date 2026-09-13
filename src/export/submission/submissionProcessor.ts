import type { LoadedExportSource } from "../types";
import { createSubmissionDocument } from "./createSubmissionDocument";
import { serializeSubmission } from "./serializeSubmission";
import type { SubmissionDocument, SubmissionExportOptions, SubmissionExportResult } from "./types";

export type SubmissionRequest = {
  id: number; sources?: LoadedExportSource[]; title: string; options: SubmissionExportOptions;
};
export type SubmissionResponse = { id: number; result: SubmissionExportResult } | { id: number; error: string };

export function createSubmissionProcessor() {
  let document: SubmissionDocument | null = null;
  return (request: SubmissionRequest): SubmissionExportResult => {
    if (request.sources) {
      document = null;
      document = createSubmissionDocument(request.sources, request.title);
    }
    if (!document) throw new Error("出力対象の本文ファイルを1つ以上選択してください");
    return serializeSubmission(document, request.options);
  };
}
