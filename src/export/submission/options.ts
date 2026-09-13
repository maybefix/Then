import { DEFAULT_SUBMISSION_OPTIONS, type SubmissionExportOptions } from "./types";

export const SUBMISSION_OPTIONS_KEY = "then-submission-export-options-v1";

export function readSubmissionOptions(): SubmissionExportOptions {
  const defaults = { ...DEFAULT_SUBMISSION_OPTIONS };
  try {
    const stored = JSON.parse(localStorage.getItem(SUBMISSION_OPTIONS_KEY) ?? "null");
    if (stored?.version !== 1 || !stored.options) return defaults;
    const value = stored.options;
    return {
      target: ["kakuyomu", "narou", "plain"].includes(value.target) ? value.target : defaults.target,
      headingMode: ["keep-text", "remove-first", "remove-all"].includes(value.headingMode) ? value.headingMode : defaults.headingMode,
      sourceSeparator: typeof value.sourceSeparator === "string" ? value.sourceSeparator : defaults.sourceSeparator,
      lineEnding: ["crlf", "lf"].includes(value.lineEnding) ? value.lineEnding : defaults.lineEnding,
      narouEmphasisMode: ["ruby-dots", "plain"].includes(value.narouEmphasisMode) ? value.narouEmphasisMode : defaults.narouEmphasisMode,
    };
  } catch { return defaults; }
}

export function saveSubmissionOptions(options: SubmissionExportOptions): void {
  localStorage.setItem(SUBMISSION_OPTIONS_KEY, JSON.stringify({ version: 1, options }));
}
