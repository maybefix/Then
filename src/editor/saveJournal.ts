// Feeds each open document's changes to its recovery journal in the backend
// (src-tauri/src/save_journal) and routes autosave through it.
//
// Every change is a numbered generation and goes out as soon as it is made;
// while one batch is on its way the next changes wait and leave together, so
// sending keeps pace with the disk and the editor never waits for it. A save
// writes the text of the generation fixed when it was requested; changes made
// meanwhile keep being recorded and are left for the next save.
import { invoke } from "@tauri-apps/api/core";
import type { TextDocument } from "../types";
import type { TextSplice } from "./lineTextUpdate";

const CHUNK = 4096;

/**
 * The single replacement that turns `previous` into `next`. Compares whole
 * chunks natively before narrowing to characters, which keeps the scan of a
 * long manuscript cheap; used only when the editor did not say what changed.
 */
export function textChangeBetween(previous: string, next: string): TextSplice {
  const limit = Math.min(previous.length, next.length);
  let from = 0;
  while (from + CHUNK <= limit && previous.slice(from, from + CHUNK) === next.slice(from, from + CHUNK)) from += CHUNK;
  while (from < limit && previous.charCodeAt(from) === next.charCodeAt(from)) from += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd - CHUNK >= from &&
    nextEnd - CHUNK >= from &&
    previous.slice(previousEnd - CHUNK, previousEnd) === next.slice(nextEnd - CHUNK, nextEnd)
  ) {
    previousEnd -= CHUNK;
    nextEnd -= CHUNK;
  }
  while (previousEnd > from && nextEnd > from && previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return { from, to: previousEnd, insert: next.slice(from, nextEnd) };
}

type Edit = {
  gen: number;
  /** The whole text, replacing whatever the backend holds. */
  replace: boolean;
  /** UTF-16 length of the text the change applies to (a cheap check that both sides agree). */
  length: number;
  from: number;
  to: number;
  insert: string;
};

type DocumentJournal = {
  path: string;
  /** Text of generation 0; sent with every batch until the backend has it. */
  base: string | null;
  queue: Edit[];
  /** Latest generation recorded here. */
  gen: number;
  /** Latest generation the backend has confirmed. */
  acknowledged: number;
  sending: Promise<void> | null;
  /** A batch was lost: the whole text goes out with the next one. */
  needsResync: boolean;
  /** The text of generation `gen`. */
  lastText: string;
};

const journals = new Map<string, DocumentJournal>();

function push(journal: DocumentJournal, edit: Omit<Edit, "gen">) {
  journal.gen += 1;
  journal.queue.push({ gen: journal.gen, ...edit });
}

function pushReplace(journal: DocumentJournal, text: string) {
  push(journal, { replace: true, length: 0, from: 0, to: 0, insert: text });
}

function send(key: string, journal: DocumentJournal) {
  if (journal.sending) return;
  if (journal.needsResync) {
    journal.needsResync = false;
    journal.queue.length = 0;
    pushReplace(journal, journal.lastText);
  }
  if (journal.queue.length === 0) return;
  const edits = journal.queue.splice(0);
  const last = edits[edits.length - 1].gen;
  journal.sending = invoke<void>("journal_edits", { key, path: journal.path, base: journal.base, edits })
    .then(() => {
      journal.base = null;
      journal.acknowledged = Math.max(journal.acknowledged, last);
    })
    .catch(() => {
      // Retried with the next change or save, not in a loop.
      journal.needsResync = true;
    })
    .finally(() => {
      journal.sending = null;
      if (!journal.needsResync) send(key, journal);
    });
}

/**
 * Places the editor's body splice in the full markdown text, or null when the
 * body does not sit verbatim behind the same header in both texts (CRLF
 * files, a BOM or front matter added): the caller then compares the texts.
 */
export function placeBodyChange(
  previousMarkdown: string,
  layout: { bodyStart: number; verbatim: boolean },
  nextBody: string,
  change: TextSplice | null | undefined,
): TextSplice | null {
  if (!change || !layout.verbatim) return null;
  const previousBodyLength = nextBody.length - change.insert.length + (change.to - change.from);
  if (previousMarkdown.length - layout.bodyStart !== previousBodyLength) return null;
  return { from: layout.bodyStart + change.from, to: layout.bodyStart + change.to, insert: change.insert };
}

/**
 * Record one change of a saved document's full text. `change`, when the
 * caller knows it, is exactly what turned `previous` into `next`.
 */
export function recordDocumentChange(
  key: string,
  path: string,
  previous: string,
  next: string,
  change: TextSplice | null = null,
) {
  let journal = journals.get(key);
  if (!journal) {
    journal = {
      path,
      base: previous,
      queue: [],
      gen: 0,
      acknowledged: 0,
      sending: null,
      needsResync: false,
      lastText: previous,
    };
    journals.set(key, journal);
  }
  // A renamed or moved file keeps its tab; the backend follows the new path.
  journal.path = path;
  if (previous !== journal.lastText) {
    // The tab's text was replaced without passing through here (a reload).
    pushReplace(journal, previous);
  }
  const splice = change ?? textChangeBetween(previous, next);
  if (import.meta.env.DEV && change && previous.slice(0, change.from) + change.insert + previous.slice(change.to) !== next) {
    console.error("[save-journal] the editor's change does not produce the new text", change);
  }
  push(journal, {
    replace: false,
    length: previous.length,
    from: splice.from,
    to: splice.to,
    insert: splice.insert,
  });
  journal.lastText = next;
  send(key, journal);
}

/**
 * The generation `text` is, fixed when a save is requested (typing may go on
 * before the save runs). `text` is the tab's current text: if it changed
 * without passing through here (a reload), it is recorded now.
 */
export function journalPositionOf(key: string, text: string): number {
  const journal = journals.get(key);
  if (!journal) return 0;
  if (text !== journal.lastText) {
    pushReplace(journal, text);
    journal.lastText = text;
    send(key, journal);
  }
  return journal.gen;
}

/**
 * Autosave through the journal: writes `content`, the text of generation
 * `gen` (from journalPositionOf at request time). Changes after it keep being
 * recorded meanwhile and stay for the next save.
 */
export async function saveThroughJournal(
  key: string,
  path: string,
  content: string,
  gen?: number | null,
): Promise<TextDocument> {
  const journal = journals.get(key);
  if (!journal) {
    return invoke<TextDocument>("journal_save", { key, path, gen: 0, content });
  }
  // Without a position, the text names its own generation only if it is the
  // current one; otherwise the backend keeps the text itself in its intent.
  const target = gen ?? journal.gen;
  while (journal.acknowledged < target) {
    send(key, journal);
    if (!journal.sending) break;
    await journal.sending;
  }
  try {
    return await invoke<TextDocument>("journal_save", { key, path, gen: target, content });
  } catch (error) {
    if (journal.acknowledged < target) journal.needsResync = true;
    throw error;
  }
}

/**
 * Text a run that ended without closing left for one manuscript (see
 * scan_recovery in the backend). The manuscript itself was not written.
 */
export type RecoveryItem = {
  id: string;
  path: string | null;
  content: string;
  state: "completed" | "notStarted" | "ownPartial" | "unknown" | "idMismatch" | "missing";
};

/**
 * Where a recovered text goes: back into the manuscript's tab as an unsaved
 * change when the file is as Then left it; into a checkpoint when it changed
 * outside Then (the file is not touched); into a new unsaved tab when the
 * file is gone.
 */
export function recoveryDestination(item: RecoveryItem): "tab" | "checkpoint" | "scratch" {
  if (!item.path || item.state === "missing") return "scratch";
  if (item.state === "unknown" || item.state === "idMismatch") return "checkpoint";
  return "tab";
}

export function scanRecovery(): Promise<RecoveryItem[]> {
  return invoke<RecoveryItem[]>("journal_recovery_scan");
}

/** The person restored or let go of the item: its recovery folder goes. */
export function discardRecovery(id: string): Promise<void> {
  return invoke<void>("journal_recovery_discard", { id });
}

/**
 * Record a restored text as the tab's change from `savedText` (the file) and
 * resolve once the backend has it, so the earlier run's folder can go.
 */
export async function recordRestoredText(key: string, path: string, savedText: string, text: string) {
  recordDocumentChange(key, path, savedText, text);
  const journal = journals.get(key)!;
  const target = journal.gen;
  // A lost batch goes out again as the whole text; a few tries, not a loop.
  for (let attempt = 0; attempt < 3 && journal.acknowledged < target; attempt += 1) {
    send(key, journal);
    while (journal.sending) await journal.sending;
  }
  if (journal.acknowledged < target) throw new Error("復旧用の記録を書けませんでした");
}

/** The tab closed after the person chose what to keep: drop its journal. */
export function forgetDocumentJournal(key: string) {
  if (!journals.delete(key)) return;
  void invoke("journal_forget", { key, discard: true }).catch(() => undefined);
}
