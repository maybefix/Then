import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { REFERENCE_FILE_DRAG_MIME } from "../../canvasTypes";
import {
  ideaThreadItemKey,
  makeIdeaItem,
  normalizedReferenceKey,
} from "../../ideaReferenceModel";
import type {
  IdeaFragment,
  IdeaReferenceLink,
  IdeaThread,
  IdeaThreadItemLink,
  IdeaThreadLayout,
  ReferenceBinary,
  ReferenceFileInfo,
} from "../../types";

type IdeaFilter = "all" | "starred";

type IdeaPaneProps = {
  rootPath: string | null;
  threads: IdeaThread[];
  threadLayouts: IdeaThreadLayout[];
  candidates: ReferenceFileInfo[];
  draggingId: string | null;
  focusRequest?: { threadId: string; fragmentId?: string; nonce: number } | null;
  onFocusRequestConsumed?: (nonce: number) => void;
  onCapture: (body: string, destId: string) => void;
  onCreateThread: () => string;
  onRenameThread: (threadId: string, title: string) => void;
  onToggleStar: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onAddFragment: (threadId: string, body: string) => void;
  onUpdateFragment: (threadId: string, fragmentId: string, body: string) => void;
  onOpenFragmentCard: (threadId: string, fragmentId: string) => void;
  onDeleteFragment: (threadId: string, fragmentId: string) => void;
  onMoveFragment: (fromThreadId: string, fragmentId: string, toThreadId: string) => void;
  onMoveFragmentToNewThread: (fromThreadId: string, fragmentId: string) => void;
  onFragmentDragStart: (event: DragEvent<HTMLElement>, threadId: string, fragmentId: string) => void;
  onFragmentDragEnd: () => void;
  onAddReference: (threadId: string) => void;
  onCreateReference: (threadId: string) => void;
  onOpenReference: (file: ReferenceFileInfo) => void;
  onMoveReference: (fromThreadId: string, linkId: string, toThreadId: string, copy: boolean) => void;
  onMoveReferenceToNewThread: (fromThreadId: string, linkId: string, copy: boolean) => void;
  onRemoveReference: (threadId: string, linkId: string) => void;
  onDeleteReferenceFile: (file: ReferenceFileInfo) => void;
  onReorderItem: (
    threadId: string,
    itemKey: string,
    targetKey: string,
    position: "before" | "after",
  ) => void;
};

const FILTERS: Array<[IdeaFilter, string]> = [["all", "すべて"], ["starred", "スター"]];
const NEW_THREAD_VALUE = "__new_thread__";
const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;
const candidateKey = (file: Pick<ReferenceFileInfo, "sourcePath">) =>
  normalizedReferenceKey(file.sourcePath);

function PlusIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>;
}
function ClipIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 12 6.7-6.7a3.2 3.2 0 0 1 4.5 4.5l-9 9a5 5 0 0 1-7.1-7.1l8.6-8.6" /></svg>;
}
function OpenIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="6" width="12" height="12" rx="2" /><path d="M13 3h8v8m-1-7-8 8" /></svg>;
}
function ChevronRightIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>;
}
function ChevronLeftIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6" /></svg>;
}
function StarIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><polygon points="12 3 15 9 22 9.8 17 14.5 18.2 21.4 12 18.1 5.8 21.4 7 14.5 2 9.8 9 9" /></svg>;
}
function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>;
}
function GripIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="ideaGripGlyph"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg>;
}
function ReferenceKindIcon({ kind }: { kind: ReferenceFileInfo["kind"] }) {
  if (kind === "image") return <span title="画像資料">▧</span>;
  if (kind === "pdf") return <span title="PDF資料">▤</span>;
  if (kind === "markdown") return <span title="Markdown資料">M↓</span>;
  return <span title="テキスト資料">≡</span>;
}

function ReferenceThumbnail({ rootPath, file }: { rootPath: string | null; file: ReferenceFileInfo }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!rootPath || file.kind !== "image" || !isTauriRuntime()) return;
    let cancelled = false;
    invoke<ReferenceBinary>("read_reference_binary", {
      rootPath,
      sourcePath: file.sourcePath,
      scope: "project",
    }).then((binary) => {
      if (!cancelled) setSrc(`data:${binary.mime};base64,${binary.dataBase64}`);
    }).catch(() => {
      if (!cancelled) setSrc(null);
    });
    return () => { cancelled = true; };
  }, [file.kind, file.sourcePath, rootPath]);
  return (
    <span className="ideaReferenceVisual" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <ReferenceKindIcon kind={file.kind} />}
    </span>
  );
}

function threadItems(thread: IdeaThread, layouts: IdeaThreadLayout[]): IdeaThreadItemLink[] {
  return layouts.find((layout) => layout.threadId === thread.id)?.items
    ?? thread.fragments.map((fragment) => makeIdeaItem(fragment.id));
}

function fragmentForItem(thread: IdeaThread, item: IdeaThreadItemLink): IdeaFragment | null {
  return item.sourceType === "idea"
    ? thread.fragments.find((fragment) => fragment.id === item.fragmentId) ?? null
    : null;
}

export function IdeaPane(props: IdeaPaneProps) {
  const {
    rootPath, threads, threadLayouts, candidates, draggingId, focusRequest,
    onFocusRequestConsumed, onCapture, onCreateThread, onRenameThread,
    onToggleStar, onDeleteThread, onAddFragment, onUpdateFragment,
    onOpenFragmentCard, onDeleteFragment, onMoveFragment,
    onMoveFragmentToNewThread,
    onFragmentDragStart, onFragmentDragEnd, onAddReference,
    onCreateReference, onOpenReference, onMoveReference, onRemoveReference,
    onMoveReferenceToNewThread,
    onDeleteReferenceFile, onReorderItem,
  } = props;
  const inbox = useMemo(() => threads.find((thread) => thread.kind === "inbox"), [threads]);
  const inboxId = inbox?.id ?? "";
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IdeaFilter>("all");
  const [query, setQuery] = useState("");
  const [destId, setDestId] = useState(inboxId);
  const [captureText, setCaptureText] = useState("");
  const [fragmentText, setFragmentText] = useState("");
  const [focusedFragmentId, setFocusedFragmentId] = useState<string | null>(null);
  const [clipMenuThreadId, setClipMenuThreadId] = useState<string | null>(null);
  const [referenceMenuId, setReferenceMenuId] = useState<string | null>(null);
  const [referencePreviews, setReferencePreviews] = useState<Record<string, string>>({});
  const [reorderTarget, setReorderTarget] = useState<{ key: string; position: "before" | "after" } | null>(null);
  const composingRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const itemListRef = useRef<HTMLDivElement>(null);
  const focusTitleRef = useRef(false);
  const dragSourceRef = useRef<{ threadId: string; key: string } | null>(null);
  const lastFocusNonceRef = useRef<number | null>(null);

  const candidateByPath = useMemo(
    () => new Map(candidates.map((file) => [candidateKey(file), file])),
    [candidates],
  );
  const selected = useMemo(() => threads.find((thread) => thread.id === selectedId) ?? null, [threads, selectedId]);

  useEffect(() => {
    if (!threads.some((thread) => thread.id === destId)) setDestId(inboxId);
  }, [destId, inboxId, threads]);
  useEffect(() => {
    if (view === "detail" && !selected) { setView("list"); setSelectedId(null); }
  }, [selected, view]);
  useEffect(() => {
    if (view === "detail" && focusTitleRef.current && titleInputRef.current) {
      focusTitleRef.current = false;
      titleInputRef.current.focus({ preventScroll: true });
      titleInputRef.current.select();
    }
  }, [selectedId, view]);
  useEffect(() => { if (stageRef.current) stageRef.current.scrollLeft = 0; }, [selectedId, view]);
  useEffect(() => {
    if (!focusRequest || lastFocusNonceRef.current === focusRequest.nonce) return;
    lastFocusNonceRef.current = focusRequest.nonce;
    setSelectedId(focusRequest.threadId);
    setView("detail");
    setFocusedFragmentId(focusRequest.fragmentId ?? null);
    onFocusRequestConsumed?.(focusRequest.nonce);
  }, [focusRequest, onFocusRequestConsumed]);
  useEffect(() => {
    if (!focusedFragmentId) return;
    const frame = requestAnimationFrame(() => {
      const target = itemListRef.current?.querySelector<HTMLElement>(`[data-idea-fragment-id="${CSS.escape(focusedFragmentId)}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const timer = window.setTimeout(() => setFocusedFragmentId(null), 2200);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [focusedFragmentId]);

  useEffect(() => {
    if (!rootPath || !isTauriRuntime()) return;
    const needed = candidates.filter(
      (file) => (file.kind === "text" || file.kind === "markdown") && referencePreviews[candidateKey(file)] === undefined,
    );
    if (!needed.length) return;
    let cancelled = false;
    Promise.all(needed.map(async (file) => {
      try {
        const text = await invoke<string>("read_reference_text", { rootPath, sourcePath: file.sourcePath, scope: "project" });
        return [candidateKey(file), text.replace(/\s+/g, " ").trim().slice(0, 180)] as const;
      } catch {
        return [candidateKey(file), ""] as const;
      }
    })).then((entries) => {
      if (!cancelled) setReferencePreviews((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [candidates, referencePreviews, rootPath]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const itemMatches = (thread: IdeaThread, item: IdeaThreadItemLink) => {
    if (!normalizedQuery) return true;
    if (item.sourceType === "idea") {
      return (fragmentForItem(thread, item)?.body ?? "").toLocaleLowerCase().includes(normalizedQuery);
    }
    const file = candidateByPath.get(normalizedReferenceKey(item.sourcePath));
    return `${file?.name ?? item.sourcePath}\n${referencePreviews[normalizedReferenceKey(item.sourcePath)] ?? ""}`
      .toLocaleLowerCase().includes(normalizedQuery);
  };
  const visibleThreads = useMemo(() => threads.filter((thread) => {
    if (thread.kind !== "inbox" && filter === "starred" && !thread.starred) return false;
    if (!normalizedQuery || thread.title.toLocaleLowerCase().includes(normalizedQuery)) return true;
    return threadItems(thread, threadLayouts).some((item) => itemMatches(thread, item));
  }).sort((a, b) => a.kind === "inbox" ? -1 : b.kind === "inbox" ? 1 : 0),
  [candidateByPath, filter, normalizedQuery, referencePreviews, threadLayouts, threads]);

  const submit = (body: string, threadId: string, reset: () => void) => {
    const text = body.trim();
    if (!text) return;
    onCapture(text, threadId);
    reset();
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, action: () => void) => {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault(); action();
  };
  const openThread = (threadId: string) => { setSelectedId(threadId); setView("detail"); };
  const createThread = () => { const id = onCreateThread(); focusTitleRef.current = true; openThread(id); };
  const toggleClipMenu = (threadId: string) => setClipMenuThreadId((current) => current === threadId ? null : threadId);

  const beginIdeaDrag = (event: DragEvent<HTMLElement>, threadId: string, fragmentId: string) => {
    dragSourceRef.current = { threadId, key: `idea:${fragmentId}` };
    onFragmentDragStart(event, threadId, fragmentId);
  };
  const beginReferenceDrag = (event: DragEvent<HTMLElement>, threadId: string, link: IdeaReferenceLink, file: ReferenceFileInfo) => {
    dragSourceRef.current = { threadId, key: `reference:${link.id}` };
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(REFERENCE_FILE_DRAG_MIME, JSON.stringify(file));
  };
  const endDrag = () => { dragSourceRef.current = null; setReorderTarget(null); onFragmentDragEnd(); };
  const dragOverItem = (event: DragEvent<HTMLElement>, threadId: string, targetKey: string) => {
    const source = dragSourceRef.current;
    if (!source || source.threadId !== threadId || source.key === targetKey) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setReorderTarget({ key: targetKey, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
  };
  const dropItem = (event: DragEvent<HTMLElement>, threadId: string, targetKey: string) => {
    const source = dragSourceRef.current;
    if (!source || source.threadId !== threadId || source.key === targetKey) return;
    event.preventDefault(); event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onReorderItem(threadId, source.key, targetKey, event.clientY < rect.top + rect.height / 2 ? "before" : "after");
    setReorderTarget(null);
  };

  const renderClipButton = (threadId: string, menuAlign: "start" | "end" = "end") => (
    <span className="ideaClipHost">
      <button type="button" className="ideaClipButton" aria-label="資料を追加" title="資料を追加" onClick={() => toggleClipMenu(threadId)}><ClipIcon /></button>
      {clipMenuThreadId === threadId && (
        <span className={`referenceContextMenu ideaClipMenu align-${menuAlign}`}>
          <button type="button" onClick={() => { setClipMenuThreadId(null); onAddReference(threadId); }}>ファイルを追加</button>
          <button type="button" onClick={() => { setClipMenuThreadId(null); onCreateReference(threadId); }}>新しいテキスト資料</button>
        </span>
      )}
    </span>
  );

  const renderItem = (thread: IdeaThread, item: IdeaThreadItemLink) => {
    const key = ideaThreadItemKey(item);
    const targetClass = reorderTarget?.key === key ? `isReorderTarget isReorder${reorderTarget.position}` : "";
    if (item.sourceType === "idea") {
      const fragment = fragmentForItem(thread, item);
      if (!fragment || !itemMatches(thread, item)) return null;
      return (
        <article key={key} className={`ideaFragment ${draggingId === fragment.id ? "isDragging" : ""} ${focusedFragmentId === fragment.id ? "isFocusedOrigin" : ""} ${targetClass}`} data-idea-fragment-id={fragment.id} onDragOver={(event) => dragOverItem(event, thread.id, key)} onDrop={(event) => dropItem(event, thread.id, key)}>
          <span className="ideaDragHandle" draggable title="ドラッグで並び替え / Canvasへ" onDragStart={(event) => beginIdeaDrag(event, thread.id, fragment.id)} onDragEnd={endDrag}><GripIcon /></span>
          <div className="ideaMixedItemMain">
            <div className="ideaFragmentBody" contentEditable spellCheck={false} suppressContentEditableWarning onBlur={(event) => { const next = event.currentTarget.textContent ?? ""; if (next.trim()) onUpdateFragment(thread.id, fragment.id, next); else event.currentTarget.textContent = fragment.body; }}>{fragment.body}</div>
            <div className="ideaFragmentFoot">
              <select className="ideaMoveSelect" aria-label="別スレッドへ移動" value="" onChange={(event) => { const value = event.target.value; if (value === NEW_THREAD_VALUE) onMoveFragmentToNewThread(thread.id, fragment.id); else if (value) onMoveFragment(thread.id, fragment.id, value); }}><option value="">移動…</option>{threads.filter((entry) => entry.id !== thread.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}<option value={NEW_THREAD_VALUE}>＋ 新規スレッドに移動…</option></select>
              <span className="ideaFragmentBtns"><button className="ideaMiniIcon ideaOpenCardBtn" type="button" aria-label="ポップアップで開く" title="ポップアップで開く" onClick={() => onOpenFragmentCard(thread.id, fragment.id)}><OpenIcon /></button><button className="ideaMiniIcon ideaDeleteBtn" type="button" aria-label="削除" title="削除" onClick={() => onDeleteFragment(thread.id, fragment.id)}><TrashIcon /></button></span>
            </div>
          </div>
        </article>
      );
    }

    const file = candidateByPath.get(normalizedReferenceKey(item.sourcePath));
    if (file && !itemMatches(thread, item)) return null;
    const fallback: ReferenceFileInfo = file ?? { scope: "project", sourcePath: item.sourcePath, name: item.sourcePath.split("/").pop() ?? item.sourcePath, kind: "unknown", size: 0, imported: true };
    const textual = file?.kind === "text" || file?.kind === "markdown";
    const primary = file
      ? textual
        ? referencePreviews[candidateKey(file)] || "（内容なし）"
        : file.name
      : "ファイルが見つかりません";
    return (
      <article key={key} className={`ideaFragment ideaReferenceItem ${!file ? "isMissing" : ""} ${targetClass}`} onDragOver={(event) => dragOverItem(event, thread.id, key)} onDrop={(event) => dropItem(event, thread.id, key)}>
        <span className="ideaDragHandle" draggable={Boolean(file)} title="ドラッグで並び替え / Canvasへ" onDragStart={(event) => file && beginReferenceDrag(event, thread.id, item, file)} onDragEnd={endDrag}><GripIcon /></span>
        <div className="ideaMixedItemMain">
          <button type="button" className="ideaReferenceOpen" disabled={!file} onClick={() => file && onOpenReference(file)}>
            {file?.kind === "image" ? <ReferenceThumbnail rootPath={rootPath} file={file} /> : <span className="ideaReferenceVisual"><ReferenceKindIcon kind={fallback.kind} /></span>}
            <span className="ideaReferenceCopy"><span className="ideaReferencePreview">{primary}</span>{(!file || textual) && <strong>{fallback.name}</strong>}</span>
            <OpenIcon />
          </button>
          <div className="ideaReferenceMenuHost">
            <button type="button" className="ideaMiniIcon" aria-label="資料の操作" title="資料の操作" onClick={() => setReferenceMenuId((current) => current === item.id ? null : item.id)}>…</button>
            {referenceMenuId === item.id && (
              <div className="referenceContextMenu ideaReferenceMenu">
                <label>別スレッドへ移動<select value="" onChange={(event) => { const value = event.target.value; if (value === NEW_THREAD_VALUE) onMoveReferenceToNewThread(thread.id, item.id, false); else if (value) onMoveReference(thread.id, item.id, value, false); if (value) setReferenceMenuId(null); }}><option value="">選択…</option>{threads.filter((entry) => entry.id !== thread.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}<option value={NEW_THREAD_VALUE}>＋ 新規スレッドに移動…</option></select></label>
                <label>別スレッドにも追加<select value="" onChange={(event) => { const value = event.target.value; if (value === NEW_THREAD_VALUE) onMoveReferenceToNewThread(thread.id, item.id, true); else if (value) onMoveReference(thread.id, item.id, value, true); if (value) setReferenceMenuId(null); }}><option value="">選択…</option>{threads.filter((entry) => entry.id !== thread.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}<option value={NEW_THREAD_VALUE}>＋ 新規スレッドに追加…</option></select></label>
                <button type="button" onClick={() => { setReferenceMenuId(null); onRemoveReference(thread.id, item.id); }}>このスレッドから削除</button>
                {file && <button type="button" className="dangerMenuItem" onClick={() => { setReferenceMenuId(null); onDeleteReferenceFile(file); }}>資料ファイルを削除</button>}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };

  return (
    <section className="ideaPane" aria-label="Idea">
      <div className="ideaStage" ref={stageRef}><div className={`ideaTrack ${view === "detail" ? "showDetail" : ""}`}>
        <section className="ideaView" aria-label="スレッド一覧">
          <div className="ideaViewTop">
            <div className="ideaTopRow"><input className="ideaSearchInput" type="search" value={query} placeholder="Ideaと資料を検索" onChange={(event) => setQuery(event.target.value)} /><button className="ideaNewThread" type="button" onClick={createThread}><PlusIcon /><span>スレッド</span></button></div>
            <div className="ideaCapture"><div className="ideaCaptureBox ideaCaptureStacked">
              <textarea value={captureText} rows={2} placeholder="Ideaを入力…" onChange={(event) => setCaptureText(event.target.value)} onCompositionStart={() => (composingRef.current = true)} onCompositionEnd={() => (composingRef.current = false)} onKeyDown={(event) => handleComposerKeyDown(event, () => submit(captureText, destId || inboxId, () => setCaptureText("")))} />
              <div className="ideaCaptureControls">
                <select className="ideaDestSelect" aria-label="追加先スレッド" value={destId} onChange={(event) => setDestId(event.target.value)}>{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.kind === "inbox" ? "・" : ""}{thread.title}</option>)}</select>
                {renderClipButton(destId || inboxId, "end")}
                <span className="ideaCaptureSpacer" />
                <button className="ideaPrimaryBtn" type="button" disabled={!captureText.trim()} onClick={() => submit(captureText, destId || inboxId, () => setCaptureText(""))}><PlusIcon /><span>追加</span></button>
              </div>
            </div></div>
            <div className="ideaChipsRow"><div className="ideaChips" aria-label="フィルタ">{FILTERS.map(([value, label]) => <button key={value} type="button" className={`ideaChip ${filter === value ? "isActive" : ""}`} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
          </div>
          <div className="ideaScroll">{visibleThreads.length === 0 ? <div className="ideaEmpty">該当するスレッドがありません</div> : visibleThreads.map((thread) => { const items = threadItems(thread, threadLayouts); const first = items.find((item) => itemMatches(thread, item)); const fragment = first ? fragmentForItem(thread, first) : null; const ref = first?.sourceType === "reference" ? candidateByPath.get(normalizedReferenceKey(first.sourcePath)) : null; return <article key={thread.id} className={`ideaThreadRow ${thread.kind === "inbox" ? "isInbox" : ""}`} onClick={() => openThread(thread.id)}><div className="ideaRowMain"><div className="ideaRowTitle">{thread.starred && <span className="ideaRowStar"><StarIcon /></span>}{thread.title}</div><div className="ideaRowSummary">{fragment?.body ?? ref?.name ?? "（項目なし）"}</div><div className="ideaRowMeta"><span>{items.length} 項目</span></div></div><div className="ideaRowChevron"><ChevronRightIcon /></div></article>; })}</div>
        </section>

        <section className="ideaView" aria-label="スレッド詳細">{selected && <>
          <div className="ideaViewTop ideaDetailTop">
            <div className="ideaDetailNav"><button className="ideaBackBtn" type="button" onClick={() => setView("list")}><ChevronLeftIcon /><span>一覧</span></button><div className="ideaDetailActions">{selected.kind !== "inbox" && <button className={`ideaIconBtn ${selected.starred ? "isOn" : ""}`} type="button" aria-label="スター" onClick={() => onToggleStar(selected.id)}><StarIcon /></button>}{selected.kind !== "inbox" && <button className="ideaIconBtn" type="button" aria-label="スレッドを削除" onClick={() => onDeleteThread(selected.id)}><TrashIcon /></button>}</div></div>
            <input ref={titleInputRef} className="ideaDetailTitle" aria-label="スレッド名" value={selected.title} readOnly={selected.kind === "inbox"} onChange={(event) => onRenameThread(selected.id, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
            <div className="ideaDetailStats"><span>{threadItems(selected, threadLayouts).length} 項目</span></div>
            <div className="ideaCapture ideaCaptureInline"><div className="ideaCaptureBox ideaCaptureStacked"><textarea value={fragmentText} rows={2} placeholder="Ideaを入力…" onChange={(event) => setFragmentText(event.target.value)} onCompositionStart={() => (composingRef.current = true)} onCompositionEnd={() => (composingRef.current = false)} onKeyDown={(event) => handleComposerKeyDown(event, () => { const text = fragmentText.trim(); if (text) { onAddFragment(selected.id, text); setFragmentText(""); } })} /><div className="ideaCaptureControls">{renderClipButton(selected.id, "start")}<span className="ideaCaptureSpacer" /><button className="ideaPrimaryBtn" type="button" disabled={!fragmentText.trim()} onClick={() => { const text = fragmentText.trim(); if (text) { onAddFragment(selected.id, text); setFragmentText(""); } }}><PlusIcon /><span>追加</span></button></div></div></div>
          </div>
          <div className="ideaScroll" ref={itemListRef}>{threadItems(selected, threadLayouts).filter((item) => itemMatches(selected, item)).length === 0 ? <div className="ideaEmpty">{normalizedQuery ? "一致するIdea・資料はありません。" : "まだIdea・資料がありません。"}</div> : threadItems(selected, threadLayouts).map((item) => renderItem(selected, item))}</div>
        </>}</section>
      </div></div>
    </section>
  );
}
