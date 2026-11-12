// The corkboard (BINDER 1-5, 3.5): the manuscripts directly inside one folder,
// one card per file, in the folder's order. A card shows the file's name, its
// progress mark, its synopsis and its length. Dragging a card reorders the files
// (the same order the binder shows); the synopsis is edited on the card.
// Loaded lazily; reading the synopsis loads the YAML parser.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { SynopsisState } from "../../corkboard/synopsis";
import { fileProgressLabels, type FileProgressStatus, type ProjectEntry, type TextDocument } from "../../types";
import "./corkboard.css";

const PROGRESS_MARKERS: Record<FileProgressStatus, string> = {
  todo: "未",
  writing: "執",
  revising: "推",
  done: "完",
  archived: "ア",
};

const charCountFormatter = new Intl.NumberFormat("ja-JP");

/** The binder's name for a file: .txt is left off on screen only. */
function displayName(name: string): string {
  return /\.txt$/i.test(name) && name.length > 4 ? name.slice(0, -4) : name;
}

type SynopsisModule = typeof import("../../corkboard/synopsis");
let loadedSynopsis: SynopsisModule | null = null;
function loadSynopsis(): Promise<SynopsisModule> {
  return loadedSynopsis
    ? Promise.resolve(loadedSynopsis)
    : import("../../corkboard/synopsis").then((module) => (loadedSynopsis = module));
}

/** What a card read from its file: the synopsis, and the text it was read from. */
export type CardSource = { state: SynopsisState; base: { content: string; contentHash: string | null } | null };

export type CorkboardProps = {
  folderName: string;
  /** The folder's direct children, in the binder's order. */
  entries: ProjectEntry[];
  fileProgress: Record<string, FileProgressStatus>;
  charCountOf: (path: string) => number | null;
  /** Text of the tab that has the file open, or null. Open files are read from their tab. */
  openTabMarkdown: (path: string) => string | null;
  readFile: (path: string) => Promise<TextDocument>;
  /**
   * Write the synopsis to the open tab or the file (BINDER 3.9). `base` is the
   * file as this card read it; null when a tab has the file open. The card reads
   * the file or tab again afterwards, whatever the outcome.
   */
  onSaveSynopsis: (path: string, text: string, base: CardSource["base"]) => Promise<void>;
  onOpen: (path: string) => void;
  onReorder: (draggedPath: string, targetPath: string, position: "before" | "after") => void;
};

export function Corkboard({
  folderName,
  entries,
  fileProgress,
  charCountOf,
  openTabMarkdown,
  readFile,
  onSaveSynopsis,
  onOpen,
  onReorder,
}: CorkboardProps) {
  // Only manuscripts: folders and materials are not cards (BINDER 3.5, 1-4).
  const files = useMemo(
    () => entries.filter((entry) => entry.kind === "file" && entry.role !== "material"),
    [entries],
  );
  const [sources, setSources] = useState<Record<string, CardSource>>({});
  const [reloadCount, setReloadCount] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ path: string; position: "before" | "after" } | null>(null);
  const draggingRef = useRef<string | null>(null);

  // A file a tab has open is read from the tab, so edits in the properties pane
  // show at once; other files are read again when the listing says they changed.
  const tabTexts = files.map((file) => openTabMarkdown(file.path));
  const readKey = files.map((file, index) => `${file.path}\u0000${tabTexts[index] === null ? file.contentHash ?? file.modifiedAt ?? "" : "tab"}`).join("\u0001");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const synopsis = await loadSynopsis();
      const next: Record<string, CardSource> = {};
      await Promise.all(files.map(async (file, index) => {
        const tabText = tabTexts[index];
        if (tabText !== null) {
          next[file.path] = { state: synopsis.readSynopsis(tabText), base: null };
          return;
        }
        try {
          const document = await readFile(file.path);
          next[file.path] = {
            state: synopsis.readSynopsis(document.content),
            base: { content: document.content, contentHash: document.contentHash ?? null },
          };
        } catch {
          next[file.path] = { state: { kind: "error" }, base: null };
        }
      }));
      if (!cancelled) setSources(next);
    })();
    return () => {
      cancelled = true;
    };
    // readKey covers the files, their tab texts and their listed hashes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, reloadCount, tabTexts.join("\u0002")]);

  const totalChars = files.reduce((sum, file) => sum + (charCountOf(file.path) ?? 0), 0);

  const commit = async (path: string, text: string) => {
    setEditingPath(null);
    const source = sources[path];
    const value = text.replace(/\r?\n/g, "");
    if (!source) return;
    const current = source.state.kind === "text" ? source.state.text : source.state.kind === "none" ? "" : null;
    if (current === null || current === value) return;
    // Shown at once; read again from the file (its new hash) or from the tab.
    setSources((all) => ({ ...all, [path]: { ...source, state: { kind: "text", text: value } } }));
    await onSaveSynopsis(path, value, source.base);
    setReloadCount((count) => count + 1);
  };

  const dragOver = (event: DragEvent<HTMLElement>, path: string) => {
    const dragging = draggingRef.current;
    if (!dragging || dragging === path) {
      setDrop(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    if (drop?.path !== path || drop.position !== position) setDrop({ path, position });
  };

  const endDrag = () => {
    draggingRef.current = null;
    setDrop(null);
  };

  return (
    <main className="corkboard" aria-label="コルクボード">
      <header className="corkboardHeader">
        <strong className="corkboardTitle">{folderName}</strong>
        <span className="corkboardSummary">
          {`${files.length} ファイル · ${charCountFormatter.format(totalChars)}字`}
        </span>
      </header>
      <ol className="corkboardGrid" role="list">
        {files.map((file) => {
          const status = fileProgress[file.path] ?? "todo";
          const chars = charCountOf(file.path);
          const source = sources[file.path];
          const state = source?.state ?? null;
          const editable = state?.kind === "text" || state?.kind === "none";
          const synopsisText = state && (state.kind === "text" || state.kind === "readonly") ? state.text : "";
          const name = displayName(file.name);
          return (
            <li
              key={file.path}
              className="corkboardCard"
              data-path={file.path}
              data-selected={selectedPath === file.path ? "true" : undefined}
              data-drop={drop?.path === file.path ? drop.position : undefined}
              data-dragging={draggingRef.current === file.path ? "true" : undefined}
              tabIndex={0}
              aria-label={name}
              draggable={editingPath !== file.path}
              onClick={() => setSelectedPath(file.path)}
              onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest(".corkboardSynopsis")) return;
                onOpen(file.path);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onOpen(file.path);
                }
              }}
              onDragStart={(event) => {
                draggingRef.current = file.path;
                setSelectedPath(file.path);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", name);
              }}
              onDragOver={(event) => dragOver(event, file.path)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
              }}
              onDrop={(event) => {
                const dragging = draggingRef.current;
                const target = drop;
                endDrag();
                if (!dragging || !target || target.path !== file.path) return;
                event.preventDefault();
                onReorder(dragging, file.path, target.position);
              }}
              onDragEnd={endDrag}
            >
              <div className="corkboardCardHead">
                <span className="corkboardCardName" title={file.name}>{name}</span>
                <span
                  className={`corkboardProgress progressText-${status}`}
                  title={fileProgressLabels[status]}
                  aria-label={fileProgressLabels[status]}
                >
                  {PROGRESS_MARKERS[status]}
                </span>
              </div>
              {editingPath === file.path ? (
                <SynopsisEditor
                  initial={synopsisText}
                  onCommit={(text) => void commit(file.path, text)}
                  onCancel={() => setEditingPath(null)}
                />
              ) : (
                <div
                  className="corkboardSynopsis"
                  data-editable={editable ? "true" : undefined}
                  aria-label="概要"
                  role={editable ? "button" : undefined}
                  tabIndex={editable ? 0 : undefined}
                  onClick={() => {
                    if (editable) setEditingPath(file.path);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (editable && event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditingPath(file.path);
                    }
                  }}
                >
                  {synopsisText}
                </div>
              )}
              <div className="corkboardCardFoot">
                {chars === null ? "" : `${charCountFormatter.format(chars)}字`}
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function SynopsisEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const doneRef = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [draft]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(draft);
    else onCancel();
  };
  return (
    <textarea
      ref={ref}
      className="corkboardSynopsisInput"
      aria-label="概要"
      rows={1}
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value.replace(/\r?\n/g, ""))}
      onBlur={() => finish(true)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

export default Corkboard;
