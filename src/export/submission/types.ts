import type { ExportSourceFile } from "../types";
import type { InlineMarkup, LineKind } from "../../editor/ast/types";

export type SubmissionTarget = "kakuyomu" | "narou" | "plain";
export type SubmissionHeadingMode = "keep-text" | "remove-first" | "remove-all";
export type SubmissionLineEnding = "crlf" | "lf";
export type NarouEmphasisMode = "ruby-dots" | "plain";
export type SubmissionExportOptions = {
  target: SubmissionTarget;
  headingMode: SubmissionHeadingMode;
  sourceSeparator: string;
  lineEnding: SubmissionLineEnding;
  narouEmphasisMode: NarouEmphasisMode;
};
export const DEFAULT_SUBMISSION_OPTIONS: SubmissionExportOptions = {
  target: "kakuyomu", headingMode: "keep-text", sourceSeparator: "\n\n\n",
  lineEnding: "crlf", narouEmphasisMode: "ruby-dots",
};
export type SubmissionWarningKind = "unsupported-markup" | "ruby-limit" |
  "nested-decoration" | "literal-notation-conflict" | "decoration-removed";
export type SubmissionWarning = {
  sourceId: string; sourceName: string; line?: number;
  kind: SubmissionWarningKind; message: string;
};
export type SubmissionInline = { kind: "text"; text: string } |
  { kind: "markup"; markup: InlineMarkup };
export type SubmissionLine = {
  sourceLine: number; kind: LineKind; level: number; inlines: SubmissionInline[];
};
export type SubmissionSection = { source: ExportSourceFile; lines: SubmissionLine[] };
export type SubmissionDocument = { schemaVersion: 1; title: string; sections: SubmissionSection[] };
export type SubmissionExportResult = {
  target: SubmissionTarget; text: string;
  /** Unicode code points, with each logical newline counted once. */
  chars: number; sourceCount: number; warnings: SubmissionWarning[];
};
export type Warn = (kind: SubmissionWarningKind, message: string) => void;
