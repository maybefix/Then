// BINDER 3-3: the 「素材」 section of 「この場面」 (docs/BINDER_MATERIAL_LIST_PLAN.md).
// It shows the manuscript's front matter `materials`, opens an item the way a
// link in the body opens (3-2), and adds notes with 「＋」 or by dropping them
// from the binder. Every write goes into the shown tab's front matter, like
// the synopsis; the tab's autosave writes the file.
//
// Where a name goes, which notes there are and the shortest name of a note are
// the link index's (src/links/); this file only shows and writes.
import { useEffect, useMemo, useRef, useState } from "react";
import { linkDestination, suggestNames, type LinkDestinationState } from "../../editor/linkDecorations";
import type { LinkIndex } from "../../links/linkIndex";
import type { ActivatedLink } from "../../links/linkOpenActions";
import { canWriteNameLink } from "../../links/linkSyntax";
import { loadMaterialList, loadedMaterialList } from "../../links/loadMaterialList";
import type { MaterialList } from "../../links/materialList";
import { parseFrontMatter, replaceFrontMatter } from "../../utils/frontmatter";
import { MATERIALS_DROP_ATTRIBUTE, MATERIALS_DROP_EVENT, type MaterialsDropDetail } from "./materialsDrop";

export type SceneMaterials = {
  /** The open work's link index (3-1); null until it has been read, and outside the desktop app. */
  index: LinkIndex | null;
  /** Changes whenever what the index holds may have changed. */
  version: number;
  /** Opens a link the way a link in the body opens (3-2's linkOpenActions). */
  onOpen: (link: ActivatedLink) => void;
};

type Props = {
  documentKey: string;
  /** The shown document's front matter text. */
  metadata: string;
  materials: SceneMaterials;
  /** The shown document's text as of now (not as of the last render). */
  latestMarkdown: () => string | null;
  onChangeMarkdown: (next: string) => void;
};

const comparable = (path: string) => path.replace(/[\\/]+/g, "/").toLocaleLowerCase();

function NoteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></svg>;
}
function AddIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>;
}
function RemoveIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

export function MaterialsSection({ documentKey, metadata, materials, latestMarkdown, onChangeMarkdown }: Props) {
  const { index, version, onOpen } = materials;
  const [module, setModule] = useState(loadedMaterialList);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (module) return;
    let cancelled = false;
    void loadMaterialList().then((loaded) => {
      if (!cancelled) setModule(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [module]);

  // Another document: the picker closes.
  useEffect(() => {
    setPicking(false);
    setQuery("");
  }, [documentKey]);

  const list: MaterialList | null = useMemo(() => (module ? module.readMaterials(metadata) : null), [metadata, module]);
  const writable = list?.kind === "list" || list?.kind === "none";
  const items = useMemo(() => (list && (list.kind === "list" || list.kind === "readonly") ? list.items : []), [list]);

  // Where each item goes, and which notes are in the list already. Asked of the
  // index only when the list or the index changed.
  const resolved = useMemo(() => {
    void version;
    const states: LinkDestinationState[] = [];
    const added = new Set<string>();
    for (const item of items) {
      if (item.target === null) {
        states.push("none");
        continue;
      }
      const link = { kind: "name" as const, target: item.target };
      states.push(linkDestination(index, link));
      for (const path of index?.candidatesFor(link) ?? []) added.add(comparable(path));
    }
    return { states, added };
  }, [index, items, version]);

  // Notes that can still be added: not in the list, and with a name a link can hold (決定5).
  const notes = useMemo(() => {
    void version;
    return suggestNames(index, "").filter((note) => canWriteNameLink(note.name) && !resolved.added.has(comparable(note.path)));
  }, [index, resolved, version]);
  const shownNotes = useMemo(() => {
    if (!picking) return [];
    const matching = new Set(suggestNames(index, query).map((note) => comparable(note.path)));
    return notes.filter((note) => matching.has(comparable(note.path)));
  }, [index, notes, picking, query]);

  const write = (edit: (current: string) => string) => {
    const markdown = latestMarkdown();
    if (markdown === null || !module) return;
    const current = parseFrontMatter(markdown).metadata;
    const next = edit(current);
    if (next === current) return;
    onChangeMarkdown(replaceFrontMatter(markdown, next));
  };

  const addNames = (names: string[]) => {
    if (!module || names.length === 0) return;
    write((current) => {
      const now = module.readMaterials(current);
      if (now.kind !== "list" && now.kind !== "none") return current;
      return module.addMaterials(current, names);
    });
  };

  // Drops from the binder (WorkspaceSidebar): only notes of this work.
  const dropRef = useRef<(paths: string[]) => void>(() => undefined);
  dropRef.current = (paths) => {
    const byPath = new Map(notes.map((note) => [comparable(note.path), note.name]));
    addNames(paths.flatMap((path) => {
      const name = byPath.get(comparable(path));
      return name ? [name] : [];
    }));
  };
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onDrop = (event: Event) => dropRef.current((event as CustomEvent<MaterialsDropDetail>).detail.paths);
    section.addEventListener(MATERIALS_DROP_EVENT, onDrop);
    return () => section.removeEventListener(MATERIALS_DROP_EVENT, onDrop);
  }, [list]);

  if (!list || list.kind === "error") return null;

  const closePicker = (refocus: boolean) => {
    setPicking(false);
    setQuery("");
    if (refocus) addButtonRef.current?.focus();
  };
  const choose = (name: string) => {
    addNames([name]);
    closePicker(true);
  };
  const at = shownNotes.length ? Math.min(active, shownNotes.length - 1) : 0;

  /** Edits the item at `itemIndex` only while it still says `text` (the list may have changed since). */
  const editItem = (itemIndex: number, text: string, edit: (current: string) => string) => {
    if (!module) return;
    write((current) => {
      const now = module.readMaterials(current);
      return now.kind === "list" && now.items[itemIndex]?.text === text ? edit(current) : current;
    });
  };

  const open = (itemIndex: number, text: string, target: string) => {
    onOpen({
      kind: "name",
      target,
      // 3-2's 「リンクを直して開く」: the item's name is rewritten in the front matter.
      rewriteTarget: (next) => editItem(itemIndex, text, (current) => module!.renameMaterial(current, itemIndex, next)),
    });
  };

  const dropProps = writable ? { [MATERIALS_DROP_ATTRIBUTE]: "" } : {};
  return (
    <section ref={sectionRef} className="sceneSection sceneMaterials" aria-label="素材" {...dropProps}>
      <div className="sceneSectionHead">
        <h3 className="sceneSectionTitle">素材</h3>
        <span className="sceneSectionCount">{items.length}</span>
        {writable && (
          <button
            ref={addButtonRef}
            type="button"
            className="sceneIconButton sceneMaterialAdd"
            aria-label="素材を追加"
            title="素材を追加"
            aria-expanded={picking}
            disabled={notes.length === 0 && !picking}
            onClick={() => {
              if (picking) closePicker(false);
              else {
                setActive(0);
                setPicking(true);
              }
            }}
          >
            <AddIcon />
          </button>
        )}
      </div>
      {picking && (
        <div
          className="sceneMaterialPicker"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closePicker(false);
          }}
        >
          <input
            className="sceneMaterialQuery"
            aria-label="ノートの名前"
            value={query}
            autoFocus
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closePicker(true);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (shownNotes.length === 0) return;
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive((at + step + shownNotes.length) % shownNotes.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (shownNotes[at]) choose(shownNotes[at].name);
              }
            }}
          />
          <div className="sceneMaterialOptions" role="listbox" aria-label="ノート">
            {shownNotes.map((note, noteIndex) => (
              <button
                key={note.path}
                type="button"
                role="option"
                aria-selected={noteIndex === at}
                className={`sceneMaterialOption${noteIndex === at ? " isActive" : ""}`}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(noteIndex)}
                onClick={() => choose(note.name)}
              >
                <NoteIcon />
                <span>{note.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <ul className="sceneMaterialList">
          {items.map((item, itemIndex) => {
            const state = resolved.states[itemIndex] ?? "unknown";
            const label = item.target ?? item.text;
            const canOpen = item.target !== null && state !== "none";
            return (
              <li key={`${itemIndex}:${item.text}`} className="sceneMaterial" data-link-state={item.target === null ? "text" : state}>
                <button
                  type="button"
                  className="sceneMaterialOpen"
                  disabled={!canOpen}
                  onClick={() => {
                    if (item.target !== null) open(itemIndex, item.text, item.target);
                  }}
                >
                  {item.target !== null && <NoteIcon />}
                  <span>{label}</span>
                </button>
                {list.kind === "list" && (
                  <button
                    type="button"
                    className="sceneIconButton sceneMaterialRemove"
                    aria-label={`「${label}」を素材から外す`}
                    title={`「${label}」を素材から外す`}
                    onClick={() => editItem(itemIndex, item.text, (current) => module!.removeMaterial(current, itemIndex))}
                  >
                    <RemoveIcon />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
