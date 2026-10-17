// Feeds each open document's changes to its recovery journal in the backend
// (src-tauri/src/save_journal) and routes autosave through it.
//
// A change goes out as soon as it is made. While one batch is on its way the
// next changes wait and leave together, so sending keeps pace with the disk
// and the editor never waits for it.
import { invoke } from "@tauri-apps/api/core";
import { computeTextChange } from "../plugins/anchors";
import type { TextDocument } from "../types";

/** `length`: UTF-16 length of the text the change applies to (a cheap check that both sides agree). */
type Edit = { seq: number; length: number; from: number; to: number; insert: string };

type DocumentJournal = {
  path: string;
  /** Text before the first change; sent once, with the first batch. */
  base: string | null;
  queue: Edit[];
  recorded: number;
  acknowledged: number;
  sending: Promise<void> | null;
  /** While a save runs, changes made after its text are held back. */
  holdAfter: number | null;
  /** A batch failed; the next save sends the whole text instead. */
  broken: boolean;
  /** The text after the last recorded change. */
  lastText: string;
};

const journals = new Map<string, DocumentJournal>();

function send(key: string, journal: DocumentJournal) {
  if (journal.sending || journal.broken) return;
  const limit = journal.holdAfter ?? Infinity;
  let count = 0;
  while (count < journal.queue.length && journal.queue[count].seq <= limit) count += 1;
  if (count === 0) return;
  const batch = journal.queue.splice(0, count);
  const last = batch[batch.length - 1].seq;
  const edits = batch.map(({ length, from, to, insert }) => ({ length, from, to, insert }));
  journal.sending = invoke<void>("journal_edits", { key, path: journal.path, base: journal.base, edits })
    .then(() => {
      journal.base = null;
      journal.acknowledged = last;
    })
    .catch(() => {
      journal.broken = true;
    })
    .finally(() => {
      journal.sending = null;
      send(key, journal);
    });
}

function push(journal: DocumentJournal, length: number, from: number, to: number, insert: string) {
  journal.recorded += 1;
  journal.queue.push({ seq: journal.recorded, length, from, to, insert });
}

/** Record one change of a saved document's full text. */
export function recordDocumentChange(key: string, path: string, previous: string, next: string) {
  let journal = journals.get(key);
  if (!journal) {
    journal = {
      path,
      base: previous,
      queue: [],
      recorded: 0,
      acknowledged: 0,
      sending: null,
      holdAfter: null,
      broken: false,
      lastText: previous,
    };
    journals.set(key, journal);
  }
  // A renamed or moved file keeps its tab; the backend follows the new path.
  journal.path = path;
  if (previous !== journal.lastText) {
    // The tab's text was replaced without passing through here (a reload):
    // one record replaces the whole text before the change.
    push(journal, journal.lastText.length, 0, journal.lastText.length, previous);
  }
  const change = computeTextChange(previous, next);
  push(journal, previous.length, change.from, change.to, change.insertedText);
  journal.lastText = next;
  send(key, journal);
}

/** Autosave through the journal: the changes up to `content` are recorded first. */
export async function saveThroughJournal(key: string, path: string, content: string): Promise<TextDocument> {
  const journal = journals.get(key);
  if (!journal) {
    return invoke<TextDocument>("journal_save", { key, path, content });
  }
  const upTo = journal.recorded;
  journal.holdAfter = upTo;
  try {
    while (!journal.broken && journal.acknowledged < upTo) {
      send(key, journal);
      await journal.sending;
    }
    if (journal.broken) {
      // The save sends the whole text; the changes it already contains go.
      journal.queue = journal.queue.filter((edit) => edit.seq > upTo);
    }
    const document = await invoke<TextDocument>("journal_save", { key, path, content });
    // The backend now holds exactly `content`.
    journal.broken = false;
    journal.base = null;
    journal.acknowledged = upTo;
    if (journal.queue.length === 0 && journal.lastText !== content && journal.recorded === upTo) {
      journal.lastText = content;
    }
    return document;
  } catch (error) {
    journal.broken = true;
    throw error;
  } finally {
    journal.holdAfter = null;
    send(key, journal);
  }
}

/** The tab closed after the person chose what to keep: drop its journal. */
export function forgetDocumentJournal(key: string) {
  if (!journals.delete(key)) return;
  void invoke("journal_forget", { key, discard: true }).catch(() => undefined);
}
