// Where an edited synopsis goes (BINDER 3.9): a manuscript open in a tab gets it
// in that tab's front matter, and the tab saves it as it saves the body; a file
// no tab has open is rewritten on disk, only if it is still the text that was
// read (expected hash, as in 1-3a and the project-wide replace).
import type { TextDocument } from "../types";
import { writeSynopsis } from "./synopsis";

export type SynopsisWriterHost = {
  /** The tab showing `path` in the editor, if any. */
  activeTabPath: () => string | null;
  /** Text of the tab that has `path` open (active or not), or null when no tab has it. */
  openTabMarkdown: (path: string) => string | null;
  /** Put new front matter into the active tab, like the properties pane does. */
  updateActiveMarkdown: (markdown: string) => void;
  /** Put a new text into a tab that is open but not active, and save it. */
  updateBackgroundTab: (path: string, markdown: string) => void;
  readFile: (path: string) => Promise<TextDocument>;
  /** Rejects with a document conflict when the file is not `expectedHash` any more. */
  saveFile: (path: string, content: string, expectedHash: string | null) => Promise<TextDocument>;
  isConflict: (error: unknown) => boolean;
};

export type SynopsisWriteResult =
  | { status: "unchanged" }
  | { status: "tab" }
  | { status: "saved"; document: TextDocument }
  /** The file changed after `base` was read; nothing was written. `current` is the file now. */
  | { status: "conflict"; current: TextDocument };

/**
 * `base`: the file as the corkboard read it (its text and hash). Only used when
 * no tab has the file open; then the synopsis is written over that text, and the
 * save is refused if the file is not that text any more.
 */
export async function saveSynopsis(
  host: SynopsisWriterHost,
  path: string,
  text: string,
  base: { content: string; contentHash: string | null } | null,
): Promise<SynopsisWriteResult> {
  const tabMarkdown = host.openTabMarkdown(path);
  if (tabMarkdown !== null) {
    const next = writeSynopsis(tabMarkdown, text);
    if (next === tabMarkdown) return { status: "unchanged" };
    if (host.activeTabPath() === path) host.updateActiveMarkdown(next);
    else host.updateBackgroundTab(path, next);
    return { status: "tab" };
  }

  const source = base ?? (await host.readFile(path));
  const next = writeSynopsis(source.content, text);
  if (next === source.content) return { status: "unchanged" };
  try {
    return { status: "saved", document: await host.saveFile(path, next, source.contentHash ?? null) };
  } catch (error) {
    if (!host.isConflict(error)) throw error;
    return { status: "conflict", current: await host.readFile(path) };
  }
}

/**
 * 「この概要で上書きする」: the synopsis goes onto the file as it is now (its body
 * and other properties from the other app are kept). Refused again if the file
 * changed once more.
 */
export function overwriteSynopsis(
  host: SynopsisWriterHost,
  path: string,
  text: string,
  current: TextDocument,
): Promise<SynopsisWriteResult> {
  return saveSynopsis(host, path, text, { content: current.content, contentHash: current.contentHash ?? null });
}
