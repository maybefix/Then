// Undo/Redo for property edits (FM-22). Each document keeps its own history of
// the front matter text, separate from the body editor's history, so undoing a
// property never touches the body and body undo never touches properties.

const HISTORY_LIMIT = 100;
const DOCUMENT_LIMIT = 50;

type History = { undo: string[]; redo: string[] };

export class PropertiesHistory {
  private readonly histories = new Map<string, History>();

  private historyFor(documentKey: string): History {
    let history = this.histories.get(documentKey);
    if (!history) {
      history = { undo: [], redo: [] };
      this.histories.set(documentKey, history);
      // Forget the documents edited longest ago.
      while (this.histories.size > DOCUMENT_LIMIT) {
        const oldest = this.histories.keys().next().value as string;
        this.histories.delete(oldest);
      }
    }
    return history;
  }

  /** The metadata changed from `previous` by an edit (not by undo/redo). */
  record(documentKey: string, previous: string): void {
    const history = this.historyFor(documentKey);
    if (history.undo[history.undo.length - 1] !== previous) history.undo.push(previous);
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo = [];
  }

  /** The text to go back to, or null when there is nothing to undo. */
  undo(documentKey: string, current: string): string | null {
    const history = this.historyFor(documentKey);
    let target = history.undo.pop();
    while (target === current) target = history.undo.pop();
    if (target === undefined) return null;
    history.redo.push(current);
    return target;
  }

  redo(documentKey: string, current: string): string | null {
    const history = this.historyFor(documentKey);
    let target = history.redo.pop();
    while (target === current) target = history.redo.pop();
    if (target === undefined) return null;
    history.undo.push(current);
    return target;
  }

  canUndo(documentKey: string): boolean {
    return (this.histories.get(documentKey)?.undo.length ?? 0) > 0;
  }

  canRedo(documentKey: string): boolean {
    return (this.histories.get(documentKey)?.redo.length ?? 0) > 0;
  }
}

/** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. */
export function historyShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}
