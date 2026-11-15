// BINDER 3-1: after a rename or move, rewrites the links that pointed at what
// moved (docs/BINDER_LINK_INDEX_PLAN.md, 5-3 and 5-4).
//
// - Files not open in a tab are read now, rewritten and written with the hash
//   they were read at, as the project-wide replace does. A file another app
//   wrote in between is left as it is and counted.
// - The tab in front gets the new text as one change in the editor, which keeps
//   the caret where it was; its autosave writes it through the save journal.
// - A tab behind gets the new text and is saved through its own save queue.
// - A tab waiting for the person to choose between its text and the file's
//   (1-3a) is left as it is and counted.
import type { LinkIndex, LinkPathChange, LinkStamp } from "./linkIndex";

export type LinkRewriteTab = {
  id: string;
  /** Path after the change. */
  path: string;
  text: string;
  isActive: boolean;
  inConflict: boolean;
};

export type LinkRewriteResult = { rewritten: number; skipped: number };

function samePath(left: string, right: string): boolean {
  const normalize = (path: string) => path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  return normalize(left) === normalize(right);
}

export async function rewriteLinksAfterPathChange({
  index,
  changes,
  stampsAfter,
  openTabs,
  readFile,
  writeFile,
  isConflict,
  applyToActiveTab,
  applyToBackgroundTab,
}: {
  index: LinkIndex;
  changes: readonly LinkPathChange[];
  stampsAfter: readonly LinkStamp[];
  openTabs: readonly LinkRewriteTab[];
  readFile: (path: string) => Promise<{ content: string; contentHash: string | null }>;
  writeFile: (path: string, content: string, expectedHash: string | null) => Promise<string>;
  isConflict: (error: unknown) => boolean;
  applyToActiveTab: (tab: LinkRewriteTab, text: string) => void;
  applyToBackgroundTab: (tab: LinkRewriteTab, text: string) => Promise<void>;
}): Promise<LinkRewriteResult> {
  const result: LinkRewriteResult = { rewritten: 0, skipped: 0 };
  const files = index.filesLinkingTo(changes, stampsAfter);
  if (!files.length) return result;
  const plan = index.planRewrite(changes, stampsAfter);
  for (const path of files) {
    const tab = openTabs.find((item) => samePath(item.path, path));
    if (tab) {
      const next = index.rewriteText(plan, path, tab.text);
      if (!next.count) continue;
      if (tab.inConflict) {
        result.skipped += 1;
        continue;
      }
      if (tab.isActive) {
        applyToActiveTab(tab, next.text);
      } else {
        try {
          await applyToBackgroundTab(tab, next.text);
        } catch {
          result.skipped += 1;
          continue;
        }
      }
      index.setFileText(path, next.text);
      result.rewritten += 1;
      continue;
    }
    let read: { content: string; contentHash: string | null };
    try {
      read = await readFile(path);
    } catch {
      result.skipped += 1;
      continue;
    }
    const next = index.rewriteText(plan, path, read.content);
    if (!next.count) continue;
    try {
      await writeFile(path, next.text, read.contentHash);
    } catch (error) {
      if (!isConflict(error)) throw error;
      result.skipped += 1;
      continue;
    }
    index.setFileText(path, next.text);
    result.rewritten += 1;
  }
  return result;
}

/**
 * The notice after a rename or move: 「「汐見」をリネームしました」 becomes
 * 「「汐見」をリネームし、3ファイルのリンクを書き換えました」. Null when nothing was rewritten or skipped.
 */
export function linkRewriteMessage(message: string, result: LinkRewriteResult): string | null {
  if (!result.rewritten && !result.skipped) return null;
  const skipped = result.skipped ? `（ほかのアプリで変更された${result.skipped}ファイルは書き換えていません）` : "";
  if (!result.rewritten) return `${message}${skipped}`;
  const stem = message.endsWith("しました") ? message.slice(0, -"ました".length) : `${message}。`;
  return `${stem}、${result.rewritten}ファイルのリンクを書き換えました${skipped}`;
}
