import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CanvasBoardSummary, CanvasScope } from "../../canvasTypes";
import { captureDraft, draftBoardKey, generateDraft, moveDraftCard, toggleDraftCard,
  type DraftBoard, type DraftCanvasContext, type DraftCapture } from "../../intermediateDraft";
import { getDraftSession, listDraftBoards, loadDraftBoard } from "../../intermediateDraftStore";
import "./intermediateDraft.css";

type Props = {
  rootPath: string | null;
  liveCanvas?: DraftCanvasContext | null;
  onOpenCanvas: (scope: CanvasScope, boardId?: string) => void;
  onSelectNode?: (id: string) => void;
};
export default function IntermediateDraftPane({ rootPath, liveCanvas, onOpenCanvas, onSelectNode }: Props) {
  const [boards, setBoards] = useState<CanvasBoardSummary[]>([]);
  const [target, setTarget] = useState<DraftBoard | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listDraftBoards("global", rootPath), rootPath ? listDraftBoards("project", rootPath) : []])
      .then(([global, project]) => {
        if (cancelled) return;
        const next = [...project, ...global];
        setBoards(next); setError("");
        setTarget((current) => {
          if (liveCanvas) return { boardId: liveCanvas.boardId, scope: liveCanvas.scope, rootPath };
          const match = next.find((board) => board.id === current?.boardId && board.scope === current?.scope) ?? next[0];
          return match ? { boardId: match.id, scope: match.scope, rootPath } : null;
        });
      }).catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [rootPath, liveCanvas?.boardId, liveCanvas?.scope, refresh]);
  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, []);
  const matchingLive = target && liveCanvas && draftBoardKey(target) === draftBoardKey(liveCanvas) ? liveCanvas : null;
  return <section className="intermediateDraftPane" aria-label="中間稿" onKeyDown={(event) => event.stopPropagation()}>
    <div className="draftBoardPicker">
      <select aria-label="中間稿のボード" value={target ? `${target.scope}:${target.boardId}` : ""}
        onChange={(event) => {
          const board = boards.find((item) => `${item.scope}:${item.id}` === event.target.value);
          if (!board) return;
          setTarget({ boardId: board.id, scope: board.scope, rootPath });
          if (liveCanvas) onOpenCanvas(board.scope, board.id);
        }}>
        {!target && <option value="">ボードを選択</option>}
        {boards.map((board) => <option key={`${board.scope}:${board.id}`} value={`${board.scope}:${board.id}`}>
          {board.scope === "global" ? "共通" : "作品"} · {board.name}
        </option>)}
      </select>
      {!matchingLive && <button type="button" className="draftUtilityButton" aria-label="Canvasを開く"
        onClick={() => onOpenCanvas(target?.scope ?? (rootPath ? "project" : "global"), target?.boardId)}>
        <OpenIcon />開く
      </button>}
    </div>
    {error && <p className="draftError" role="alert">{error}</p>}
    {target ? <DraftEditor key={draftBoardKey(target)} target={target} liveCanvas={matchingLive}
      onSelectNode={matchingLive ? onSelectNode : undefined} /> :
      <p className="draftHint">Canvasでボードを作成すると、ここで文章を並べ替えて中間稿を作れます。</p>}
  </section>;
}

function DraftEditor({ target, liveCanvas, onSelectNode }: {
  target: DraftBoard; liveCanvas: DraftCanvasContext | null; onSelectNode?: (id: string) => void;
}) {
  const session = useMemo(() => getDraftSession(target), [draftBoardKey(target)]);
  const { history, status, error } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [capture, setCapture] = useState<DraftCapture | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [tab, setTab] = useState<"order" | "text">("order");
  const dragged = useRef<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const latest = history?.versions[history.versions.length - 1];
  const version = history?.versions.find((item) => item.version === selectedVersion) ?? latest;
  const oldVersion = Boolean(version && latest && version.version !== latest.version);
  const shownCapture = capture ?? version;
  const cards = new Map(shownCapture?.cards.map((card) => [card.id, card.text]));
  const excluded = new Set(shownCapture?.excluded ?? []);
  useEffect(() => {
    void session.load();
    const refresh = () => void session.load();
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("focus", refresh); void session.flush(); };
  }, [session]);
  useEffect(() => {
    if (history?.versions.length && selectedVersion === null && !capture) setTab("text");
  }, [history?.versions.length]);
  // Obtain the first snapshot only once; subsequent Canvas edits require an explicit capture.
  useEffect(() => {
    if (!history || history.versions.length || capture) return;
    let cancelled = false;
    const load = async () => {
      try {
        const board = liveCanvas?.board ?? await loadDraftBoard(target);
        if (!cancelled) setCapture(captureDraft(board));
      } catch (reason) { if (!cancelled) setMessage(String(reason)); }
    };
    void load();
    return () => { cancelled = true; };
  }, [history, liveCanvas?.board, target, capture]);

  const recapture = async () => {
    setBusy(true); setMessage("");
    try {
      await session.flush();
      if (session.snapshot.error) return;
      setCapture(captureDraft(liveCanvas?.board ?? await loadDraftBoard(target)));
      setSelectedVersion(null); setTab("order");
    } catch (reason) { setMessage(String(reason)); }
    finally { setBusy(false); }
  };
  const generate = () => {
    if (!capture || !history) return;
    const next = generateDraft(capture, (latest?.version ?? 0) + 1);
    session.change({ ...history, versions: [...history.versions, next] });
    setSelectedVersion(next.version); setCapture(null); setTab("text"); setMessage("");
  };
  const editCapture = (change: (source: DraftCapture) => DraftCapture) => {
    if (!shownCapture) return;
    const source: DraftCapture = capture ?? {
      capturedAt: shownCapture.capturedAt,
      boardUpdatedAt: shownCapture.boardUpdatedAt,
      cards: shownCapture.cards.map((card) => ({ ...card })),
      order: [...shownCapture.order],
      excluded: [...(shownCapture.excluded ?? [])],
    };
    setCapture(change(source));
    setSelectedVersion(null);
  };
  const move = (id: string, targetId: string) => {
    editCapture((source) => moveDraftCard(source, id, targetId));
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("コピーしました");
      window.setTimeout(() => setMessage((current) => current === "コピーしました" ? "" : current), 1400);
    }
    catch { setMessage("コピーできませんでした。テキストを選択してコピーしてください。"); }
  };
  const download = async () => {
    if (!version) return;
    setExporting(true); setMessage("");
    try {
      const saved = await invoke<{ name: string; path: string } | null>("save_submission_text_dialog", {
        content: version.text,
        fileName: `中間稿-v${version.version}.txt`,
      });
      setMessage(saved ? `${saved.name}を保存しました` : "保存をキャンセルしました");
    } catch (reason) {
      setMessage(`書き出しに失敗しました: ${String(reason)}`);
    } finally {
      setExporting(false);
    }
  };
  return <>
    <div className="draftVersionActions">
      <select aria-label="中間稿のバージョン" disabled={!latest || busy} value={version?.version ?? ""}
        onChange={(event) => { setSelectedVersion(Number(event.target.value)); setCapture(null); setTab("text"); }}>
        {!latest && <option value="">未生成</option>}
        {[...(history?.versions ?? [])].reverse().map((item) => <option key={item.version} value={item.version}>
          v{item.version}{item === latest ? " · 最新" : ""}
        </option>)}
      </select>
      <button type="button" className="draftUtilityButton" aria-label={latest ? "Canvasから再生成" : "Canvasから取得"}
        disabled={!history || busy || Boolean(error)} onClick={() => void recapture()}>
        <RefreshIcon />{latest ? "再取得" : "取得"}
      </button>
    </div>
    <div className="draftTabs" role="tablist" aria-label="中間稿の表示">
      <button type="button" role="tab" aria-selected={tab === "order"} onClick={() => setTab("order")}>並べ替え</button>
      <button type="button" role="tab" aria-selected={tab === "text"} onClick={() => setTab("text")}>テキスト</button>
    </div>
    {tab === "order" ? <>
      <ol className="draftOrderList" aria-label="カード順">
        {shownCapture?.order.map((id, index) => <li key={id}
          className={`${(liveCanvas ? liveCanvas.selectedIds.includes(id) : selectedCard === id) ? "isSelected" : ""}${excluded.has(id) ? " isExcluded" : ""}`.trim()}
          onDragOver={(event) => { if (shownCapture && dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
          onDrop={(event) => { if (dragged.current) { event.preventDefault(); event.stopPropagation(); move(dragged.current, id); dragged.current = null; } }}>
          <button type="button" className="draftDragHandle" aria-label={`カード${index + 1}をドラッグで移動`}
            disabled={!shownCapture} draggable={Boolean(shownCapture)}
            onDragStart={(event) => { dragged.current = id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-then-draft-card", id); }}
            onDragEnd={() => { dragged.current = null; }}><GripIcon /></button>
          <span className="draftOrderNumber">{index + 1}</span>
          <button type="button" className="draftExcerpt" onClick={() => { setSelectedCard(id); onSelectNode?.(id); }}
            title={cards.get(id) || "空のカード"}>{cards.get(id)?.replace(/\s+/g, " ").slice(0, 160) || "空のカード"}</button>
          {shownCapture && <button type="button" className="draftExcludeButton"
            aria-label={`カード${index + 1}を${excluded.has(id) ? "中間稿に戻す" : "中間稿から除外"}`}
            title={excluded.has(id) ? "中間稿に戻す" : "中間稿から除外"}
            onClick={() => editCapture((source) => toggleDraftCard(source, id))}>
            <ExcludeIcon restore={excluded.has(id)} />
          </button>}
          {shownCapture && <div className="draftMoveActions">
            <button type="button" aria-label={`カード${index + 1}を上へ`} disabled={index === 0}
              onClick={() => move(id, shownCapture.order[index - 1])}><ChevronIcon direction="up" /></button>
            <button type="button" aria-label={`カード${index + 1}を下へ`} disabled={index === shownCapture.order.length - 1}
              onClick={() => move(id, shownCapture.order[index + 1])}><ChevronIcon direction="down" /></button>
          </div>}
        </li>)}
        {!shownCapture?.order.length && <li className="draftEmpty">テキストカードがありません。</li>}
      </ol>
      {capture && <div className="draftGenerateActions">
        <button className="draftPrimary" type="button"
          disabled={!capture.cards.some((card) => card.text.trim() && !excluded.has(card.id)) || !history || busy || Boolean(error)} onClick={generate}>
          テキストを生成
        </button>
      </div>}
    </> : <>
      {version ? <>
        <div className="draftTextActions">{oldVersion && <span>過去版</span>}
          <button type="button" onClick={() => void copy(version.text)}><CopyIcon />コピー</button>
          <button type="button" disabled={exporting} onClick={() => void download()}>
            <DownloadIcon />{exporting ? "保存中…" : "書き出し"}
          </button>
        </div>
        <textarea className="draftTextEditor" aria-label="中間稿テキスト" spellCheck={false}
          readOnly={oldVersion || Boolean(capture)} value={version.text}
          onChange={(event) => {
            if (!history || oldVersion) return;
            session.change({ ...history, versions: history.versions.map((item) => item.version === version.version
              ? { ...item, text: event.target.value, updatedAt: Date.now() } : item) });
          }} />
      </> : <p className="draftHint">並べ替えタブで順序を確定し、テキストを生成してください。</p>}
    </>}
    {(message || error || status === "終了前の未保存内容を復元しました") && <footer className="draftFooter">
      {message && <span role="status">{message}</span>}
      {!message && status === "終了前の未保存内容を復元しました" && <span role="status">未保存の編集を復元しました</span>}
      {error && <div className="draftError" role="alert">{error}
        <button type="button" onClick={() => void (history ? session.flush() : session.load())}>再試行</button>
        <button type="button" onClick={() => {
          if (session.dirty && !window.confirm("未保存の編集を破棄して読み直します。必要な文章をコピー済みですか？")) return;
          setCapture(null); setSelectedVersion(null); void session.discardAndReload();
        }}>保存版を読み直す</button>
      </div>}
    </footer>}
  </>;
}

function DraftIcon({ children }: { children: ReactNode }) {
  return <svg className="draftIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">{children}</svg>;
}
function OpenIcon() {
  return <DraftIcon><path d="M6.2 3.5H3.8a1.3 1.3 0 0 0-1.3 1.3v7.4a1.3 1.3 0 0 0 1.3 1.3h7.4a1.3 1.3 0 0 0 1.3-1.3V9.8M8.5 2.5h5v5M13.2 2.8 7.1 8.9" /></DraftIcon>;
}
function RefreshIcon() {
  return <DraftIcon><path d="M13 4.8V2.5m0 0h-2.3M13 2.5A5.5 5.5 0 1 0 13.4 9" /></DraftIcon>;
}
function GripIcon() {
  return <DraftIcon><circle cx="5.5" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="12" r=".8" fill="currentColor" stroke="none"/></DraftIcon>;
}
function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return <DraftIcon><path d={direction === "up" ? "m4.5 9.5 3.5-3 3.5 3" : "m4.5 6.5 3.5 3 3.5-3"} /></DraftIcon>;
}
function CopyIcon() {
  return <DraftIcon><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.3"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></DraftIcon>;
}
function DownloadIcon() {
  return <DraftIcon><path d="M8 2.5v7m-2.8-2.7L8 9.7l2.8-2.9M3 12.5h10" /></DraftIcon>;
}
function ExcludeIcon({ restore }: { restore: boolean }) {
  return <DraftIcon><circle cx="8" cy="8" r="5.25"/><path d="M5.5 8h5" />{restore && <path d="M8 5.5v5" />}</DraftIcon>;
}
