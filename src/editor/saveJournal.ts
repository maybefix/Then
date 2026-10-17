// Feeds each open document's changes to its recovery journal in the backend
// (src-tauri/src/save_journal) and routes autosave through it.
//
// Every change is a numbered generation and goes out as soon as it is made;
// while one batch is on its way the next changes wait and leave together, so
// sending keeps pace with the disk and the editor never waits for it. A save
// writes the text of the generation fixed when it was requested; changes made
// meanwhile keep being recorded and are left for the next save.
import { invoke } from "@tauri-apps/api/core";
import { computeTextChange } from "../plugins/anchors";
import type { TextDocument } from "../types";

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

/** Record one change of a saved document's full text. */
export function recordDocumentChange(key: string, path: string, previous: string, next: string) {
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
  const change = computeTextChange(previous, next);
  push(journal, {
    replace: false,
    length: previous.length,
    from: change.from,
    to: change.to,
    insert: change.insertedText,
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

/** The tab closed after the person chose what to keep: drop its journal. */
export function forgetDocumentJournal(key: string) {
  if (!journals.delete(key)) return;
  void invoke("journal_forget", { key, discard: true }).catch(() => undefined);
}
