import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { ManuscriptSnapshot, ProjectFolder } from "../../types";
import { hash16 } from "../../editor/ast/documentAst";
import { buildComparisonEntries } from "./checkpointComparison";
import type { ComparisonEntry } from "./checkpointComparison";
import { buildProjectDiff, diffChars, leadingParagraphs } from "./checkpointDiff";
import type { FileDiff, OrderChange, ParagraphRow, ProjectDiff, Segment } from "./checkpointDiff";
import "../studio/studio.css";
import "./checkpointStudio.css";

export type SnapshotConflictPolicy = "overwrite" | "copy" | "skip";

export type CheckpointCurrentProjectFile = {
  path: string;
  name: string;
  text: string;
};

export type CheckpointCurrentProjectStatus = "idle" | "loading" | "ready" | "error";

export type SnapshotRelocation = {
  snapshotPath: string;
  currentPath: string;
};

type Props = {
  projectFolder: ProjectFolder | null;
  snapshots: ManuscriptSnapshot[];
  currentProjectFiles: ReadonlyMap<string, CheckpointCurrentProjectFile>;
  currentProjectStatus: CheckpointCurrentProjectStatus;
  unavailableCurrentProjectPaths: ReadonlySet<string>;
  /** 既存の文字数カウント（表示文字数）による現在のプロジェクトの合計。 */
  currentProjectStats: { fileCount: number; visibleTextLength: number } | null;
  /** サイドバーや通知から開いたとき、選んでおく保存点。nonce が変わるたびに選び直す。 */
  focusRequest?: { id: string; nonce: number } | null;
  onClose: () => void;
  /** 保存点を作り、作れたらその ID を返す。 */
  onCreate: (label: string) => Promise<string | null>;
  onEditDetails: (snapshot: ManuscriptSnapshot) => void;
  onDelete: (snapshot: ManuscriptSnapshot) => void;
  /** 以下の復元は画面側で確認済み。復元前の退避は呼び出し先が先に作る。 */
  onRestore: (snapshot: ManuscriptSnapshot) => Promise<boolean>;
  onRestoreFile: (snapshot: ManuscriptSnapshot, path: string, relocation: SnapshotRelocation | null) => Promise<boolean>;
  onRestoreOrder: (snapshot: ManuscriptSnapshot) => Promise<boolean>;
};

type CompareId = "current" | "prev" | string;
type ViewMode = "inline" | "side";
type ConfirmState =
  | { scope: "all" }
  | { scope: "file"; path: string; name: string; relocation: SnapshotRelocation | null }
  | { scope: "order" };

const SHELTER_LABEL = "復元前の退避";
const MAX_ROWS = 120;
const pathKey = (path: string) => path.replace(/[\\/]+/g, "\\").toLocaleLowerCase();
const isShelter = (snapshot: ManuscriptSnapshot) => snapshot.reason === "auto-before-restore";
const pad = (value: number) => String(value).padStart(2, "0");
const timeOf = (value: number) => { const date = new Date(value); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };
const monthDay = (value: number) => { const date = new Date(value); return `${date.getMonth() + 1}月${date.getDate()}日`; };
const stamp = (snapshot: ManuscriptSnapshot) => `${monthDay(snapshot.createdAt)} ${timeOf(snapshot.createdAt)}`;
const chars = (value: number) => value.toLocaleString("ja-JP");

function dayLabel(value: number, now = new Date()): string {
  const date = new Date(value);
  const startOfDay = (target: Date) => new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "今日";
  if (days === 1) return "昨日";
  return date.getFullYear() === now.getFullYear() ? monthDay(value) : `${date.getFullYear()}年${monthDay(value)}`;
}

/* 差分は「保存点 + 比較先 + 本文ハッシュ」で覚えておき、保存点を行き来しても再計算しない。 */
const diffCache = new Map<string, ProjectDiff>();
function cachedDiff(key: string, compute: () => ProjectDiff): ProjectDiff {
  const hit = diffCache.get(key);
  if (hit) return hit;
  const value = compute();
  diffCache.set(key, value);
  if (diffCache.size > 12) diffCache.delete(diffCache.keys().next().value as string);
  return value;
}

function treeSignature(tree: ProjectFolder | null): string {
  if (!tree) return "";
  const parts: string[] = [];
  const visit = (children: ProjectFolder["children"]) => { for (const child of children) { parts.push(child.path); if (child.kind === "folder") { parts.push("{"); visit(child.children); parts.push("}"); } } };
  visit(tree.children);
  return hash16(parts.join("\u0000"));
}

const Icon = {
  back: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>,
  restore: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5v5h5" /><path d="M4.6 14.5A8 8 0 1 0 6 7.2L4 10" /></svg>,
  more: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>,
  chevron: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>,
};

function Segments({ segments }: { segments: Segment[] }) {
  return <>{segments.map(([kind, text], index) => kind === "d" ? <del key={index}>{text}</del> : kind === "a" ? <ins key={index}>{text}</ins> : <span key={index}>{text}</span>)}</>;
}

function rowSegments(row: ParagraphRow): Segment[] {
  if (row.oldText !== null && row.newText !== null) return diffChars(row.oldText, row.newText);
  if (row.oldText !== null) return [["d", row.oldText]];
  return [["a", row.newText ?? ""]];
}

const Gap = ({ count }: { count: number }) => count > 0 ? <div className="cpGap">⋯ {count}段落 変更なし</div> : null;

type Labels = { oldLabel: string; newLabel: string };

/** 開いたカードの中身。マウントされたときに初めて文字単位の差分を取る。 */
function FileBody({ file, view, labels, newSide }: { file: FileDiff; view: ViewMode; labels: Labels; newSide: string }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => showAll ? file.rows : file.rows.slice(0, MAX_ROWS), [file.rows, showAll]);
  const segments = useMemo(() => rows.map(rowSegments), [rows]);
  const side = view === "side";
  const content: ReactNode[] = [];

  if (file.kind === "relocated" && file.oldFile && file.newFile) {
    content.push(<div className="cpOrder" key="relocation"><span className="cpOrderKey">{labels.oldLabel}</span><span>{file.oldFile.path}</span><span className="cpOrderKey">{labels.newLabel}</span><span>{file.newFile.path}</span></div>);
  }
  if (file.kind === "added" || file.kind === "removed") {
    const source = file.kind === "added" ? file.newFile : file.oldFile;
    content.push(<div className="cpAddNote" key="note">{file.kind === "added" ? `新しく加わったファイルです（+${chars(file.plus)}字）` : `${newSide}にはないファイルです（−${chars(file.minus)}字）`}</div>);
    for (const paragraph of leadingParagraphs(source?.text ?? "", 3)) {
      content.push(<div className="cpHunk" key={paragraph.line}><div className="cpInlineRow"><span className="cpLn">{paragraph.line}</span><p className="cpProse">{file.kind === "added" ? <ins>{paragraph.text}</ins> : <del>{paragraph.text}</del>}</p></div></div>);
    }
  }
  if (rows.length && side) {
    content.push(<div className="cpColHead" key="side-head"><div>{labels.oldLabel}</div><div>{labels.newLabel}</div></div>);
  }
  rows.forEach((row, index) => {
    const key = `${row.oldLine ?? "-"}:${row.newLine ?? "-"}`;
    if (!side) {
      content.push(<div className="cpHunk" key={key}><Gap count={row.gapBefore} /><div className="cpInlineRow"><span className="cpLn">{row.newLine ?? row.oldLine}</span><p className="cpProse"><Segments segments={segments[index]} /></p></div></div>);
      return;
    }
    const oldSegments = segments[index].filter(([kind]) => kind !== "a");
    const newSegments = segments[index].filter(([kind]) => kind !== "d");
    content.push(<div className="cpHunk" key={key}><Gap count={row.gapBefore} /><div className="cpSideRow">
      <div className="cpSideCol">{row.oldLine !== null && <span className="cpLn">{row.oldLine}</span>}{row.oldText !== null ? <p className="cpProse"><Segments segments={oldSegments} /></p> : <p className="cpMissing">（この時点ではまだありません）</p>}</div>
      <div className="cpSideCol">{row.newLine !== null && <span className="cpLn">{row.newLine}</span>}{row.newText !== null ? <p className="cpProse"><Segments segments={newSegments} /></p> : <p className="cpMissing">（この段落はなくなっています）</p>}</div>
    </div></div>);
  });
  if (file.rows.length > rows.length) {
    content.push(<div className="cpMore" key="more"><span>ほかに {file.rows.length - rows.length} 段落の変更があります</span><button type="button" className="stBtnLine" onClick={() => setShowAll(true)}>すべて表示</button></div>);
  }
  if (file.kind === "changed" && !file.rows.length) {
    content.push(<div className="cpAddNote" key="blank">空行だけが変わっています。</div>);
  }
  return <>{content}</>;
}

const KIND_LABEL: Record<FileDiff["kind"], string> = { changed: "変更", added: "追加", removed: "削除", relocated: "移動" };

function FileCard(props: {
  file: FileDiff; open: boolean; view: ViewMode; labels: Labels; newSide: string;
  onToggle: () => void; restore: { label: string; onClick: () => void } | null;
}) {
  const { file, open, view, labels, newSide, onToggle, restore } = props;
  return <section className="cpFile">
    <div className="cpFileHead">
      <button type="button" className="cpFileToggle" aria-expanded={open} onClick={onToggle}>
        {Icon.chevron}
        <span className="cpFileName">{file.name}</span>
        {file.folder && <span className="cpFileFolder">{file.folder}</span>}
        <span className={`cpBadge ${file.kind === "added" ? "add" : ""}`}>{file.relocationLabel ?? KIND_LABEL[file.kind]}</span>
      </button>
      {(file.plus > 0 || file.minus > 0) && <span className="cpStats">{file.plus > 0 && <span className="cpPlus">+{chars(file.plus)}</span>}{file.minus > 0 && <span className="cpMinus">−{chars(file.minus)}</span>}</span>}
      {restore && <button type="button" className="stBtnLine" onClick={restore.onClick}>{restore.label}</button>}
    </div>
    {open && <FileBody file={file} view={view} labels={labels} newSide={newSide} />}
  </section>;
}

function OrderCard({ changes, open, labels, onToggle, onRestore }: { changes: OrderChange[]; open: boolean; labels: Labels; onToggle: () => void; onRestore: () => void }) {
  return <section className="cpFile">
    <div className="cpFileHead">
      <button type="button" className="cpFileToggle" aria-expanded={open} onClick={onToggle}>
        {Icon.chevron}<span className="cpFileName">フォルダの並び順</span><span className="cpBadge">並び順</span>
      </button>
      <button type="button" className="stBtnLine" onClick={onRestore}>並び順だけ戻す</button>
    </div>
    {open && changes.map((change) => <div className="cpOrder" key={change.folder}>
      {changes.length > 1 && <span className="cpOrderFolder">{change.folder || "プロジェクト直下"}</span>}
      <span className="cpOrderKey">{labels.oldLabel}</span><span>{change.before.join(" → ")}</span>
      <span className="cpOrderKey">{labels.newLabel}</span><span>{change.after.join(" → ")}</span>
    </div>)}
  </section>;
}

export function CheckpointStudio(props: Props) {
  const { projectFolder, snapshots, currentProjectFiles, currentProjectStatus, unavailableCurrentProjectPaths, currentProjectStats, focusRequest, onClose, onCreate, onEditDetails, onDelete, onRestore, onRestoreFile, onRestoreOrder } = props;
  const sorted = useMemo(() => snapshots.slice().sort((left, right) => right.createdAt - left.createdAt), [snapshots]);
  const [selectedId, setSelectedId] = useState<string | null>(() => focusRequest?.id ?? sorted[0]?.id ?? null);
  const [compareId, setCompareId] = useState<CompareId>("current");
  const [view, setView] = useState<ViewMode>("inline");
  const [showAuto, setShowAuto] = useState(true);
  const [query, setQuery] = useState("");
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);

  const selected = sorted.find((item) => item.id === selectedId) ?? sorted[0] ?? null;
  const selectedIndex = selected ? sorted.indexOf(selected) : -1;
  const prev = selectedIndex >= 0 ? sorted[selectedIndex + 1] ?? null : null;
  const effectiveCompare: CompareId = compareId === "prev" && !prev ? "current" : compareId;
  const target = effectiveCompare === "current" ? null : effectiveCompare === "prev" ? prev : sorted.find((item) => item.id === effectiveCompare) ?? null;
  const targetOlder = Boolean(selected && target && target.createdAt < selected.createdAt);
  const currentReady = currentProjectStatus === "ready" || currentProjectStatus === "error";

  const labels: Labels & { oldSide: string; newSide: string } = !selected
    ? { oldLabel: "", newLabel: "", oldSide: "", newSide: "" }
    : !target
      ? { oldLabel: `この保存点（${stamp(selected)}）`, newLabel: "現在のプロジェクト", oldSide: "保存点", newSide: "現在" }
      : targetOlder
        ? { oldLabel: `${target.label}（${stamp(target)}）`, newLabel: `この保存点（${stamp(selected)}）`, oldSide: "比較先", newSide: "この保存点" }
        : { oldLabel: `この保存点（${stamp(selected)}）`, newLabel: `${target.label}（${stamp(target)}）`, oldSide: "この保存点", newSide: "比較先" };

  const currentFiles = useMemo(() => [...currentProjectFiles.values()], [currentProjectFiles]);
  const currentFingerprint = useMemo(() => currentReady
    ? hash16(currentFiles.map((file) => `${file.path}\u0000${file.text}`).join("\u0001")) + treeSignature(projectFolder)
    : "", [currentFiles, currentReady, projectFolder]);
  // 保存点 → 現在。比較先が別の保存点でも、復元時の移動判定と「後から加わったファイル」の数に使う。
  const currentEntries = useMemo<ComparisonEntry[] | null>(() => {
    if (!selected || !currentReady) return null;
    const left = selected.files.filter((file) => !unavailableCurrentProjectPaths.has(pathKey(file.path)));
    return buildComparisonEntries(left, currentFiles, currentProjectStatus === "ready");
  }, [currentFiles, currentProjectStatus, currentReady, selected, unavailableCurrentProjectPaths]);

  const diffKey = selected ? `${selected.id}:${selected.storageHash || selected.revision}|${target ? `${target.id}:${target.storageHash || target.revision}` : `current:${currentFingerprint}`}` : "";
  const diff = useMemo<ProjectDiff | null>(() => {
    if (!selected) return null;
    if (!target) {
      if (!currentEntries || !projectFolder) return null;
      return cachedDiff(diffKey, () => buildProjectDiff(currentEntries, selected.projectTree, projectFolder));
    }
    const [older, newer] = targetOlder ? [target, selected] : [selected, target];
    return cachedDiff(diffKey, () => buildProjectDiff(buildComparisonEntries(older.files, newer.files), older.projectTree, newer.projectTree));
  }, [currentEntries, diffKey, projectFolder, selected, target, targetOlder]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sorted.filter((item) =>
      (showAuto || !isShelter(item) || item.id === selected?.id) &&
      (!needle || `${item.label}\n${item.memo}`.toLocaleLowerCase().includes(needle)));
  }, [query, selected?.id, showAuto, sorted]);
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: ManuscriptSnapshot[] }> = [];
    for (const item of visible) {
      const label = dayLabel(item.createdAt);
      const last = result[result.length - 1];
      if (last?.label === label) last.items.push(item);
      else result.push({ label, items: [item] });
    }
    return result;
  }, [visible]);
  const autoCount = sorted.filter(isShelter).length;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);
  useEffect(() => { if (confirm) confirmButtonRef.current?.focus(); }, [confirm]);
  // 別の保存点・比較先は別の内容なので先頭から読む。表示モードの切り替えでは位置を保つ。
  useEffect(() => { if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0; }, [selected?.id, effectiveCompare]);
  useEffect(() => {
    if (!focusRequest) return;
    setSelectedId(focusRequest.id);
    setCompareId("current");
  }, [focusRequest]);

  const choose = (snapshot: ManuscriptSnapshot) => { setSelectedId(snapshot.id); setCompareId("current"); setMenuOpen(false); };
  const saveCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await onCreate(draft.trim() || "名前のない保存点");
      if (id) { setSelectedId(id); setCompareId("current"); setCreating(false); setDraft(""); setBanner(""); }
    } finally { setBusy(false); }
  };
  const onDraftKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); void saveCreate(); }
    if (event.key === "Escape") { event.preventDefault(); setCreating(false); }
  };
  const runRestore = async () => {
    if (!selected || !confirm || busy) return;
    setBusy(true);
    try {
      const ok = confirm.scope === "all" ? await onRestore(selected)
        : confirm.scope === "order" ? await onRestoreOrder(selected)
          : await onRestoreFile(selected, confirm.path, confirm.relocation);
      if (ok) {
        const what = confirm.scope === "all" ? `「${selected.label}」の時点に戻しました。` : confirm.scope === "order" ? "フォルダの並び順を戻しました。" : `「${confirm.name}」を戻しました。`;
        setBanner(`${what}直前の状態は「${SHELTER_LABEL}」として保存してあります。`);
      }
      setConfirm(null);
    } finally { setBusy(false); }
  };

  if (!projectFolder) return <section className="checkpointStudio stStudio cpEmptyScreen"><h1>チェックポイント</h1><p>プロジェクトを開くと、保存点を確認・復元できます。</p><button type="button" className="stBtnPrimary" onClick={onClose}>本文へ戻る</button></section>;

  const currentMeta = currentProjectStats
    ? `${currentProjectStats.fileCount}ファイル · ${chars(currentProjectStats.visibleTextLength)}字`
    : `${currentProjectFiles.size}ファイル`;
  const snapshotIsOld = !target || !targetOlder;
  const addedSinceCount = currentEntries?.filter((entry) => !entry.left && entry.right).length ?? 0;
  const restoreFor = (file: FileDiff) => {
    const snapshotFile = snapshotIsOld ? file.oldFile : file.newFile;
    if (!snapshotFile) return null;
    const entry = currentEntries?.find((item) => item.left && pathKey(item.left.path) === pathKey(snapshotFile.path));
    const relocation = entry?.match === "relocated" && entry.left && entry.right ? { snapshotPath: entry.left.path, currentPath: entry.right.path } : null;
    return { label: "このファイルだけ戻す", onClick: () => { setMenuOpen(false); setConfirm({ scope: "file", path: snapshotFile.path, name: snapshotFile.name, relocation }); } };
  };
  const isOpen = (key: string, index: number) => openCards[`${diffKey}|${key}`] ?? index === 0;
  const toggle = (key: string, index: number) => setOpenCards((current) => ({ ...current, [`${diffKey}|${key}`]: !isOpen(key, index) }));

  const sidebar = <aside className="cpSide" aria-label="保存点">
    <div className="cpSideHead"><h2>保存点</h2><span className="cpCount">{sorted.length}件</span></div>
    <div className="cpCurrentCard">
      <div className="cpCurrentRow"><span className="cpRing" aria-hidden="true" /><div><span className="cpCurrentName">現在のプロジェクト</span><span className="cpCurrentMeta">{currentMeta}</span></div></div>
      {creating
        ? <div className="cpCreateForm">
            <label htmlFor="cp-snapshot-name">保存点の名前</label>
            <input id="cp-snapshot-name" type="text" autoFocus value={draft} placeholder="例：第2稿に入る前" onChange={(event) => setDraft(event.target.value)} onKeyDown={onDraftKeyDown} />
            <div className="cpRowEnd">
              <button type="button" className="stBtnGhost" onClick={() => setCreating(false)}>やめる</button>
              <button type="button" className="stBtnPrimary sm" disabled={busy} onClick={() => void saveCreate()}>保存する</button>
            </div>
          </div>
        : <button type="button" className="stBtnOutline" onClick={() => { setCreating(true); setDraft(""); }}>{Icon.plus}今の状態を保存点にする</button>}
    </div>
    <div className="cpTools">
      <label className="stSearch">{Icon.search}<input type="search" value={query} aria-label="名前・メモで絞り込む" placeholder="名前・メモで絞り込む" onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="cpAutoToggle"><input type="checkbox" checked={showAuto} onChange={(event) => setShowAuto(event.target.checked)} />自動退避も表示（{autoCount}件）</label>
    </div>
    <nav className="cpGroups" aria-label="保存点の一覧">
      {groups.map((group) => <div className="cpGroup" key={group.label}>
        <div className="cpGroupDate">{group.label}</div>
        {group.items.map((item) => {
          const on = item.id === selected?.id;
          return isShelter(item)
            ? <button type="button" key={item.id} className={`cpSnap auto ${on ? "isSelected" : ""}`} aria-current={on} onClick={() => choose(item)}>
                <span className="cpDot" /><span className="cpSnapName">{item.label}</span><span className="cpSnapMeta">{timeOf(item.createdAt)} · {item.fileCount}ファイル</span>
              </button>
            : <button type="button" key={item.id} className={`cpSnap ${on ? "isSelected" : ""}`} aria-current={on} onClick={() => choose(item)}>
                <span className="cpDot" />
                <span className="cpSnapBody">
                  <span className="cpSnapName">{item.label}</span>
                  <span className="cpSnapMeta">{timeOf(item.createdAt)} · {item.fileCount}ファイル · {chars(item.totalVisibleTextLength)}字</span>
                  {item.memo && <span className="cpSnapMemo">{item.memo}</span>}
                </span>
              </button>;
        })}
      </div>)}
      {!groups.length && <p className="cpNoResults">{sorted.length ? "一致する保存点はありません" : "保存点はまだありません"}</p>}
    </nav>
  </aside>;

  const compareOptions = selected ? [
    { value: "current", label: "現在のプロジェクト" },
    ...(prev ? [{ value: "prev", label: `ひとつ前の保存点（${stamp(prev)}）` }] : []),
    ...sorted.filter((item) => item.id !== selected.id && item.id !== prev?.id).map((item) => ({ value: item.id, label: `${item.label}（${stamp(item)}）` })),
  ] : [];

  let diffBody: ReactNode;
  if (!diff) {
    diffBody = <div className="cpEmpty">現在のプロジェクトを読み込んでいます…</div>;
  } else {
    const cards: ReactNode[] = diff.files.map((file, index) => <FileCard key={file.key} file={file} open={isOpen(file.key, index)} view={view} labels={labels} newSide={labels.newSide} onToggle={() => toggle(file.key, index)} restore={restoreFor(file)} />);
    if (diff.orderChanges.length) {
      const index = diff.files.length;
      cards.push(<OrderCard key="order" changes={diff.orderChanges} open={isOpen("order", index)} labels={labels} onToggle={() => toggle("order", index)} onRestore={() => { setMenuOpen(false); setConfirm({ scope: "order" }); }} />);
    }
    diffBody = <>
      <div className="cpSummary">
        <p>{diff.empty ? "変更はありません" : diff.summary}</p>
        <span className="cpDir">{labels.oldLabel} → {labels.newLabel}</span>
        {(diff.plus > 0 || diff.minus > 0) && <span className="cpStats">{diff.plus > 0 && <span className="cpPlus">+{chars(diff.plus)}字</span>}{diff.minus > 0 && <span className="cpMinus">−{chars(diff.minus)}字</span>}</span>}
      </div>
      {!target && currentProjectStatus === "error" && <p className="cpWarning">読み込めなかった現在のファイル{unavailableCurrentProjectPaths.size}件は比較から外しています。</p>}
      {!diff.empty && <div className="cpLegend"><span><del>消えた文</del>{labels.oldSide}にだけある</span><span><ins>加わった文</ins>{labels.newSide}にだけある</span></div>}
      <div className="cpFiles">
        {cards}
        {!diff.empty && diff.unchangedCount > 0 && <div className="cpUnchanged">{Icon.check}<span>変更のないファイル {diff.unchangedCount}件は省略しています</span></div>}
        {diff.empty && <div className="cpEmpty">比較先と同じ内容です。戻しても何も変わりません。</div>}
        <p className="cpFootnote">戻すときは、直前の状態を「{SHELTER_LABEL}」として自動で保存します。</p>
      </div>
    </>;
  }

  const main = <main className="cpMain"><div className="cpMainHead"><div className="cpWrap">
    {banner && <div className="cpBanner" role="status"><span>{banner}</span><button type="button" onClick={() => setBanner("")}>閉じる</button></div>}
    {selected && <>
      <div className="cpDetailHead">
        <div className="cpDetailTitle">
          <h2>{selected.label}</h2>
          <div className="cpDetailMeta">{stamp(selected)} · {selected.fileCount}ファイル · {chars(selected.totalVisibleTextLength)}字</div>
          {selected.memo && <p className="cpDetailMemo">{selected.memo}</p>}
          {isShelter(selected) && <p className="cpDetailAuto">復元を実行する直前に、自動で作られた保存点です。</p>}
        </div>
        <div className="cpDetailActions" ref={menuRef}>
          <button type="button" className="stBtnPrimary" onClick={() => { setMenuOpen(false); setConfirm({ scope: "all" }); }}>{Icon.restore}この時点に戻す</button>
          {!isShelter(selected) && <>
            <button type="button" className="stBtnIcon" aria-label="その他の操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}>{Icon.more}</button>
            {menuOpen && <div className="stMenu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEditDetails(selected); }}>名前とメモを編集</button>
              <button type="button" role="menuitem" className="cpDanger" onClick={() => { setMenuOpen(false); onDelete(selected); }}>この保存点を削除</button>
            </div>}
          </>}
        </div>
      </div>
      <div className="cpCompareBar">
        <label>比較先
          <select value={effectiveCompare} onChange={(event) => setCompareId(event.target.value)}>
            {compareOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="stSeg" role="group" aria-label="差分の表示方法">
          <button type="button" aria-pressed={view === "inline"} onClick={() => setView("inline")}>変わった所だけ</button>
          <button type="button" aria-pressed={view === "side"} onClick={() => setView("side")}>左右に並べる</button>
        </div>
      </div>
    </>}
  </div></div>
  <div className="cpMainScroll" ref={mainScrollRef}><div className="cpWrap">
    {selected ? diffBody : <div className="cpEmpty">保存点はまだありません。左の「今の状態を保存点にする」から作れます。</div>}
  </div></div></main>;

  let dialog: ReactNode = null;
  if (confirm && selected) {
    const at = stamp(selected);
    const [title, body] = confirm.scope === "all"
      ? [`「${selected.label}」の時点に戻す`, `${selected.fileCount}ファイルの本文と、フォルダの並び順を ${at} の状態に戻します。${addedSinceCount ? `保存点のあとで加わった${addedSinceCount}ファイルはごみ箱へ移します。` : ""}`]
      : confirm.scope === "order"
        ? ["フォルダの並び順だけ戻す", `本文には手を触れず、フォルダの並び順だけを ${at} の状態に戻します。`]
        : [`「${confirm.name}」だけ戻す`, `このファイルの本文を ${at} の状態に戻します。ほかのファイルはそのままです。`];
    dialog = <div className="cpOverlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirm(null); }}>
      <div className="cpDialog" role="dialog" aria-modal="true" aria-labelledby="cp-confirm-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); setConfirm(null); } }}>
        <h3 id="cp-confirm-title">{title}</h3>
        <p>{body}</p>
        <p className="cpSafe">今の状態は「{SHELTER_LABEL}」として自動で保存されるので、あとから元に戻せます。</p>
        <div className="cpRowEnd">
          <button type="button" className="stBtnGhost" disabled={busy} onClick={() => setConfirm(null)}>キャンセル</button>
          <button type="button" className="stBtnPrimary" ref={confirmButtonRef} disabled={busy} onClick={() => void runRestore()}>戻す</button>
        </div>
      </div>
    </div>;
  }

  return <section className="checkpointStudio stStudio" aria-label="チェックポイント">
    <header className="stTopbar">
      <button type="button" className="stBack" onClick={onClose}>{Icon.back}本文へ戻る</button>
      <h1>チェックポイント</h1>
    </header>
    <div className="cpLayout">{sidebar}{main}</div>
    {dialog}
  </section>;
}
