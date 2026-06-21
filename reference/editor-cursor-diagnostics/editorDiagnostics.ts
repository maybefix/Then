/**
 * Archived cursor-jump diagnostics used during the 2026-06 investigation.
 *
 * This file is intentionally outside `src` and is not bundled into production.
 * Copy it under `src` and wire `record()` calls into VerticalTextEditor when
 * cursor synchronization needs to be investigated again.
 */

export type EditorDiagnosticValue = string | number | boolean | null;

export type EditorDiagnosticEntry = {
  sequence: number;
  timestamp: string;
  event: string;
  data: Record<string, EditorDiagnosticValue>;
};

const ENTRY_LIMIT = 180;
const STORAGE_KEY = "then.editor-diagnostics.v1";

export function createEditorDiagnostics() {
  const entries: EditorDiagnosticEntry[] = [];
  let sequence = 0;
  let incident = 0;

  const record = (
    event: string,
    data: Record<string, EditorDiagnosticValue> = {},
  ): void => {
    entries.push({
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      event,
      data,
    });
    if (entries.length > ENTRY_LIMIT) {
      entries.splice(0, entries.length - ENTRY_LIMIT);
    }
  };

  const buildReport = (): string =>
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        incident,
        platform: navigator.userAgent,
        entries,
      },
      null,
      2,
    );

  const persist = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, buildReport());
    } catch {
      // Diagnostics must never interfere with editing.
    }
  };

  const recordIncident = (
    event: string,
    data: Record<string, EditorDiagnosticValue>,
  ): number => {
    incident += 1;
    record(event, { incident, ...data });
    persist();
    return incident;
  };

  const attachCopyShortcut = (onReport: (report: string) => void): (() => void) => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyD")) return;
      event.preventDefault();
      record("report-requested", { incident });
      onReport(buildReport());
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  };

  return {
    record,
    recordIncident,
    buildReport,
    persist,
    attachCopyShortcut,
  };
}

export function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

export function sharedSuffixLength(
  left: string,
  right: string,
  prefixLength: number,
): number {
  const limit = Math.min(left.length, right.length) - prefixLength;
  let length = 0;
  while (
    length < limit &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}
