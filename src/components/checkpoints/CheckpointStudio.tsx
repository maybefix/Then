import { useMemo, useState } from "react";
import type { ManuscriptSnapshot, ProjectEntry, ProjectFolder } from "../../types";

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
  currentFilePath: string | null;
  currentProjectFiles: ReadonlyMap<string, CheckpointCurrentProjectFile>;
  currentProjectStatus: CheckpointCurrentProjectStatus;
  unavailableCurrentProjectPaths: ReadonlySet<string>;
  conflictsBySnapshot: ReadonlyMap<string, ReadonlySet<string>>;
  onClose: () => void;
  onCreate: () => void;
  onDelete: (snapshot: ManuscriptSnapshot) => void;
  onRestore: (snapshot: ManuscriptSnapshot) => void;
  onRestoreFiles: (snapshot: ManuscriptSnapshot, paths: string[], folderPaths: string[], policy: SnapshotConflictPolicy, restoreOrder: boolean, relocations: SnapshotRelocation[]) => void;
};

type LineOperation = { kind: "same" | "removed" | "added"; text: string };
type DiffLine = { number: number; text: string; kind: LineOperation["kind"] };
type DiffRow = { left?: DiffLine; right?: DiffLine };
type ComparisonFile = { path: string; name: string; text: string };
type ComparisonEntry = {
  key: string;
  path: string;
  name: string;
  left: ComparisonFile | null;
  right: ComparisonFile | null;
  match: "path" | "relocated" | "left-only" | "right-only";
};

const date = (value: number) => new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
const pathKey = (path: string) => path.replace(/[\\/]+/g, "\\").toLocaleLowerCase();
const splitLines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const parentPath = (path: string) => path.replace(/[\\/][^\\/]+$/, "");
const fileStem = (path: string) => fileName(path).replace(/\.[^.]+$/, "").toLocaleLowerCase();
const compactPath = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-2).join(" / ");

function RestoreItemIcon({ type }: { type: "file" | "folder" }) {
  return type === "file" ? (
    <svg className="checkpointRestoreItemIcon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M6.75 3.75h7.5l3 3v13.5H6.75z" />
      <path d="M14.25 3.75v3h3" />
    </svg>
  ) : (
    <svg className="checkpointRestoreItemIcon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M3.75 6.75h6l1.5 2.25h9v9.75H3.75z" />
    </svg>
  );
}

function normalizedSimilarityText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\s　]+/g, " ").trim();
}

function ngramDice(left: string, right: string, size: number): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  if (left.length < size || right.length < size) return left === right ? 1 : 0;
  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();
  for (let index = 0; index <= left.length - size; index += 1) {
    const gram = left.slice(index, index + size);
    leftCounts.set(gram, (leftCounts.get(gram) ?? 0) + 1);
  }
  for (let index = 0; index <= right.length - size; index += 1) {
    const gram = right.slice(index, index + size);
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (const [gram, count] of leftCounts) overlap += Math.min(count, rightCounts.get(gram) ?? 0);
  const leftTotal = left.length - size + 1;
  const rightTotal = right.length - size + 1;
  return (2 * overlap) / (leftTotal + rightTotal);
}

function relocationScore(left: ComparisonFile, right: ComparisonFile): number | null {
  const leftText = normalizedSimilarityText(left.text);
  const rightText = normalizedSimilarityText(right.text);
  const nameSimilarity = ngramDice(fileStem(left.path), fileStem(right.path), 2);
  if (leftText === rightText) {
    if (leftText.length >= 16 || fileName(left.path).toLocaleLowerCase() === fileName(right.path).toLocaleLowerCase()) {
      return 1 + nameSimilarity * 0.02;
    }
    return null;
  }
  if (leftText.length < 24 || rightText.length < 24) return null;
  const contentSimilarity = ngramDice(leftText, rightText, 3);
  const lengthRatio = Math.min(leftText.length, rightText.length) / Math.max(leftText.length, rightText.length);
  const reliableByContent = contentSimilarity >= 0.9;
  const reliableByName = contentSimilarity >= 0.62 && nameSimilarity >= 0.55;
  if (!reliableByContent && !reliableByName) return null;
  return contentSimilarity * 0.82 + nameSimilarity * 0.12 + lengthRatio * 0.06;
}

function relocationLabel(left: ComparisonFile, right: ComparisonFile): string {
  const renamed = fileName(left.path).toLocaleLowerCase() !== fileName(right.path).toLocaleLowerCase();
  const moved = pathKey(parentPath(left.path)) !== pathKey(parentPath(right.path));
  if (renamed && moved) return "名前変更・移動";
  if (renamed) return "名前変更";
  return "移動";
}

function buildComparisonEntries(leftFiles: ComparisonFile[], rightFiles: ComparisonFile[]): ComparisonEntry[] {
  const rightByPath = new Map(rightFiles.map((file) => [pathKey(file.path), file] as const));
  const exactRightPaths = new Set<string>();
  const unmatchedLeft: ComparisonFile[] = [];
  for (const left of leftFiles) {
    const key = pathKey(left.path);
    if (rightByPath.has(key)) exactRightPaths.add(key);
    else unmatchedLeft.push(left);
  }
  const unmatchedRight = rightFiles.filter((file) => !exactRightPaths.has(pathKey(file.path)));
  const candidates = unmatchedLeft.flatMap((left) => unmatchedRight.flatMap((right) => {
    const score = relocationScore(left, right);
    return score === null ? [] : [{ left, right, score }];
  })).sort((left, right) => right.score - left.score);
  const ambiguousLeftPaths = new Set<string>();
  const ambiguousRightPaths = new Set<string>();
  for (const left of unmatchedLeft) {
    const matches = candidates.filter((candidate) => candidate.left === left);
    if (matches.length > 1 && Math.abs(matches[0].score - matches[1].score) < 0.001) ambiguousLeftPaths.add(pathKey(left.path));
  }
  for (const right of unmatchedRight) {
    const matches = candidates.filter((candidate) => candidate.right === right);
    if (matches.length > 1 && Math.abs(matches[0].score - matches[1].score) < 0.001) ambiguousRightPaths.add(pathKey(right.path));
  }
  const relocationByLeft = new Map<string, ComparisonFile>();
  const relocatedRightPaths = new Set<string>();
  for (const candidate of candidates) {
    const leftKey = pathKey(candidate.left.path);
    const rightKey = pathKey(candidate.right.path);
    if (ambiguousLeftPaths.has(leftKey) || ambiguousRightPaths.has(rightKey)) continue;
    if (relocationByLeft.has(leftKey) || relocatedRightPaths.has(rightKey)) continue;
    relocationByLeft.set(leftKey, candidate.right);
    relocatedRightPaths.add(rightKey);
  }

  const entries: ComparisonEntry[] = leftFiles.map((left) => {
    const leftKey = pathKey(left.path);
    const exact = rightByPath.get(leftKey) ?? null;
    if (exact) return { key: `path:${leftKey}`, path: left.path, name: left.name, left, right: exact, match: "path" };
    const relocated = relocationByLeft.get(leftKey) ?? null;
    if (relocated) return { key: `relocated:${leftKey}:${pathKey(relocated.path)}`, path: left.path, name: left.name, left, right: relocated, match: "relocated" };
    return { key: `left:${leftKey}`, path: left.path, name: left.name, left, right: null, match: "left-only" };
  });
  for (const right of unmatchedRight) {
    const rightKey = pathKey(right.path);
    if (!relocatedRightPaths.has(rightKey)) entries.push({ key: `right:${rightKey}`, path: right.path, name: right.name, left: null, right, match: "right-only" });
  }
  return entries;
}

/**
 * Myers の最短編集列。大規模な全面置換ではメモリを消費しすぎないよう、
 * 編集距離が大きい場合は「削除 + 追加」として全文を正しく表示する。
 */
function myersLineDiff(before: string[], after: string[]): LineOperation[] | null {
  const maxEditDistance = Math.min(before.length + after.length, 600);
  const vectors = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let distance = 0; distance <= maxEditDistance; distance += 1) {
    trace.push(new Map(vectors));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const movedDown = diagonal === -distance || (
        diagonal !== distance &&
        (vectors.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) < (vectors.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY)
      );
      let beforeIndex = movedDown
        ? vectors.get(diagonal + 1) ?? 0
        : (vectors.get(diagonal - 1) ?? 0) + 1;
      let afterIndex = beforeIndex - diagonal;

      while (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
        beforeIndex += 1;
        afterIndex += 1;
      }
      vectors.set(diagonal, beforeIndex);

      if (beforeIndex >= before.length && afterIndex >= after.length) {
        const operations: LineOperation[] = [];
        let x = before.length;
        let y = after.length;

        for (let step = trace.length - 1; step > 0; step -= 1) {
          const previous = trace[step];
          const currentDiagonal = x - y;
          const cameFromDown = currentDiagonal === -step || (
            currentDiagonal !== step &&
            (previous.get(currentDiagonal - 1) ?? Number.NEGATIVE_INFINITY) < (previous.get(currentDiagonal + 1) ?? Number.NEGATIVE_INFINITY)
          );
          const previousDiagonal = cameFromDown ? currentDiagonal + 1 : currentDiagonal - 1;
          const previousX = previous.get(previousDiagonal) ?? 0;
          const previousY = previousX - previousDiagonal;

          while (x > previousX && y > previousY) {
            operations.push({ kind: "same", text: before[x - 1] });
            x -= 1;
            y -= 1;
          }

          if (x === previousX) {
            operations.push({ kind: "added", text: after[previousY] });
            y -= 1;
          } else {
            operations.push({ kind: "removed", text: before[previousX] });
            x -= 1;
          }
        }

        while (x > 0 && y > 0) {
          operations.push({ kind: "same", text: before[x - 1] });
          x -= 1;
          y -= 1;
        }
        while (x > 0) { operations.push({ kind: "removed", text: before[--x] }); }
        while (y > 0) { operations.push({ kind: "added", text: after[--y] }); }
        return operations.reverse();
      }
    }
  }

  return null;
}

function createDiffRows(beforeText: string, afterText: string): DiffRow[] {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const operations = myersLineDiff(before, after)
    ?? [...before.map((text) => ({ kind: "removed" as const, text })), ...after.map((text) => ({ kind: "added" as const, text }))];
  const rows: DiffRow[] = [];
  const removed: DiffLine[] = [];
  const added: DiffLine[] = [];
  let beforeNumber = 1;
  let afterNumber = 1;

  const flushChanged = () => {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1) rows.push({ left: removed[index], right: added[index] });
    removed.length = 0;
    added.length = 0;
  };

  for (const operation of operations) {
    if (operation.kind === "same") {
      flushChanged();
      rows.push({
        left: { number: beforeNumber++, text: operation.text, kind: "same" },
        right: { number: afterNumber++, text: operation.text, kind: "same" },
      });
    } else if (operation.kind === "removed") {
      removed.push({ number: beforeNumber++, text: operation.text, kind: "removed" });
    } else {
      added.push({ number: afterNumber++, text: operation.text, kind: "added" });
    }
  }
  flushChanged();
  return rows;
}

function createOneSidedDiffRows(text: string, side: "left" | "right", kind: LineOperation["kind"]): DiffRow[] {
  return splitLines(text).map((line, index) => {
    const value = { number: index + 1, text: line, kind };
    return side === "left" ? { left: value } : { right: value };
  });
}

const renderDiffLine = (line: DiffLine | undefined) => line ? <code className={`checkpointDiffLine ${line.kind}`}><b>{String(line.number)}</b><span>{line.text || " "}</span></code> : <code className="checkpointDiffLine empty"><b> </b><span> </span></code>;

export function CheckpointStudio({ projectFolder, snapshots, currentFilePath, currentProjectFiles, currentProjectStatus, unavailableCurrentProjectPaths, conflictsBySnapshot, onClose, onCreate, onDelete, onRestore, onRestoreFiles }: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => snapshots[0]?.id ?? null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [policy, setPolicy] = useState<SnapshotConflictPolicy>("overwrite");
  const [restoreOrder, setRestoreOrder] = useState(true);
  const [comparisonId, setComparisonId] = useState("current");
  const [snapshotMenuId, setSnapshotMenuId] = useState<string | null>(null);
  const selected = snapshots.find((item) => item.id === selectedId) ?? snapshots[0] ?? null;
  const visible = useMemo(() => snapshots.filter((item) => `${item.label} ${item.memo}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, snapshots]);
  const comparisonSnapshot = comparisonId === "current" ? null : snapshots.find((item) => item.id === comparisonId) ?? null;
  const currentComparisonEntries = useMemo(() => buildComparisonEntries(selected?.files ?? [], [...currentProjectFiles.values()]), [currentProjectFiles, selected]);
  const comparisonEntries = useMemo(() => comparisonSnapshot
    ? buildComparisonEntries(selected?.files ?? [], comparisonSnapshot.files)
    : currentComparisonEntries, [comparisonSnapshot, currentComparisonEntries, selected]);
  const activeEntry = comparisonEntries.find((entry) => entry.key === filePath)
    ?? comparisonEntries.find((entry) => [entry.left, entry.right].some((file) => file && pathKey(file.path) === pathKey(currentFilePath ?? "")))
    ?? comparisonEntries[0]
    ?? null;
  const currentProjectFileUnavailable = !comparisonSnapshot && activeEntry
    ? unavailableCurrentProjectPaths.has(pathKey(activeEntry.right?.path ?? activeEntry.left?.path ?? ""))
    : false;
  const comparisonLabel = comparisonSnapshot?.label ?? "現在のプロジェクト";
  const diffRows = useMemo(() => {
    if (!activeEntry) return [];
    if (activeEntry.left && activeEntry.right) return createDiffRows(activeEntry.left.text, activeEntry.right.text);
    if (activeEntry.left) {
      const comparisonPending = !comparisonSnapshot && (currentProjectStatus === "idle" || currentProjectStatus === "loading");
      return createOneSidedDiffRows(activeEntry.left.text, "left", comparisonPending || currentProjectFileUnavailable ? "same" : "removed");
    }
    if (activeEntry.right) return createOneSidedDiffRows(activeEntry.right.text, "right", "added");
    return [];
  }, [activeEntry, comparisonSnapshot, currentProjectFileUnavailable, currentProjectStatus]);
  const comparisonStatus = !activeEntry
    ? "比較するファイルがありません"
    : !comparisonSnapshot && (currentProjectStatus === "loading" || currentProjectStatus === "idle")
      ? "現在のプロジェクトを読み込み中"
      : currentProjectFileUnavailable
        ? "現在のファイルを読み込めませんでした"
        : activeEntry.match === "relocated" && activeEntry.left && activeEntry.right
          ? `${relocationLabel(activeEntry.left, activeEntry.right)}として認識: ${compactPath(activeEntry.left.path)} → ${compactPath(activeEntry.right.path)}`
        : activeEntry.left && activeEntry.right
          ? comparisonSnapshot ? "保存点どうしを比較中" : "現在のプロジェクトと比較中"
          : activeEntry.left
            ? "比較先にはないファイル（削除）"
            : "比較元にはないファイル（追加）";
  const comparisonEntryStatus = (entry: ComparisonEntry) => {
    if (!comparisonSnapshot && unavailableCurrentProjectPaths.has(pathKey(entry.right?.path ?? entry.left?.path ?? ""))) return "読込失敗";
    if (!comparisonSnapshot && (currentProjectStatus === "idle" || currentProjectStatus === "loading")) return null;
    if (entry.match === "relocated" && entry.left && entry.right) return relocationLabel(entry.left, entry.right);
    if (!entry.left) return "追加";
    if (!entry.right) return "削除";
    return null;
  };
  const relocations = currentComparisonEntries.flatMap((entry) => entry.match === "relocated" && entry.left && entry.right
    ? [{ snapshotPath: entry.left.path, currentPath: entry.right.path }]
    : []);
  const relocationBySnapshotPath = new Map(relocations.map((item) => [pathKey(item.snapshotPath), item] as const));
  const relocatedConflictPaths = new Set(currentComparisonEntries.flatMap((entry) => entry.match === "relocated" && entry.left && entry.right && entry.left.text.replace(/\r\n?/g, "\n") !== entry.right.text.replace(/\r\n?/g, "\n")
    ? [pathKey(entry.left.path)]
    : []));
  const effectivePaths = scope === "all" ? selected?.files.map((file) => file.path) ?? [] : [...selectedPaths];
  const conflictPaths = selected ? conflictsBySnapshot.get(selected.id) ?? new Set<string>() : new Set<string>();
  const selectedConflictCount = effectivePaths.filter((path) => conflictPaths.has(pathKey(path)) || relocatedConflictPaths.has(pathKey(path))).length;
  const folders = useMemo(() => {
    const result: ProjectEntry[] = [];
    const visit = (entries: ProjectEntry[]) => entries.forEach((entry) => {
      if (entry.kind === "folder") { result.push(entry); visit(entry.children); }
    });
    if (selected) visit(selected.projectTree.children);
    return result;
  }, [selected]);

  const chooseSnapshot = (snapshot: ManuscriptSnapshot) => {
    setSelectedId(snapshot.id); setFilePath(null); setScope("all"); setSelectedPaths(new Set()); setSelectedFolderPaths(new Set()); setSnapshotMenuId(null);
  };
  const togglePath = (path: string) => setSelectedPaths((current) => {
    const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next;
  });
  const descendantFiles = (folder: ProjectEntry): string[] => folder.children.flatMap((entry) => entry.kind === "folder" ? descendantFiles(entry) : [entry.path]);
  const toggleFolder = (folder: ProjectEntry) => {
    const files = descendantFiles(folder);
    setSelectedFolderPaths((current) => { const next = new Set(current); next.has(folder.path) ? next.delete(folder.path) : next.add(folder.path); return next; });
    setSelectedPaths((current) => { const next = new Set(current); const selecting = !selectedFolderPaths.has(folder.path); files.forEach((path) => selecting ? next.add(path) : next.delete(path)); return next; });
  };

  if (!projectFolder) return <section className="checkpointStudio checkpointEmpty"><h1>チェックポイント</h1><p>プロジェクトを開くと、保存点を確認・復元できます。</p><button type="button" onClick={onClose}>本文へ戻る</button></section>;

  return <section className="checkpointStudio" aria-label="チェックポイント">
    <header className="checkpointStudioHeader"><h1>チェックポイント</h1><div className="checkpointStudioActions"><button type="button" className="checkpointButton checkpointCreateButton" onClick={onCreate}>＋ 保存点を作成</button><button type="button" className="checkpointButton" onClick={onClose}>本文へ戻る</button></div></header>
    <div className="checkpointStudioLayout">
      <aside className="checkpointHistory" aria-label="保存点"><header className="checkpointCompactHeader"><strong>保存点</strong><span>{snapshots.length} 件</span></header><label className="checkpointSearch"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・メモを検索" /></label><div className="checkpointSnapshotList">{visible.map((snapshot) => <div key={snapshot.id} className={`checkpointSnapshot ${snapshot.id === selected?.id ? "active" : ""} ${snapshot.reason === "auto-before-restore" ? "shelter" : ""}`}><button type="button" className="checkpointSnapshotSelect" aria-pressed={snapshot.id === selected?.id} onClick={() => chooseSnapshot(snapshot)}><i aria-hidden="true" /><span><strong>{snapshot.label}</strong><small>{date(snapshot.createdAt)} · {snapshot.fileCount}ファイル · {snapshot.totalVisibleTextLength.toLocaleString()}字</small>{snapshot.memo && <em>{snapshot.memo}</em>}</span>{snapshot.reason === "auto-before-restore" && <b>退避</b>}</button>{snapshot.reason === "manual" && <span className="checkpointSnapshotActions"><button type="button" className="checkpointSnapshotMore" aria-label={`${snapshot.label}のメニュー`} aria-expanded={snapshotMenuId === snapshot.id} aria-haspopup="menu" onClick={() => setSnapshotMenuId((current) => current === snapshot.id ? null : snapshot.id)}>…</button>{snapshotMenuId === snapshot.id && <span className="checkpointSnapshotMenu" role="menu"><button type="button" role="menuitem" onClick={() => { setSnapshotMenuId(null); onDelete(snapshot); }}>削除</button></span>}</span>}</div>)}{!visible.length && <p className="checkpointNoResult">該当する保存点はありません。</p>}</div></aside>
      <main className="checkpointCompare"><header className="checkpointCompareHeader"><strong>{selected?.label ?? "保存点を選択"}</strong><label className="checkpointCompareSelect"><span>比較先</span><select value={comparisonId} onChange={(event) => setComparisonId(event.target.value)}><option value="current">現在のプロジェクト</option>{snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{snapshot.label}</option>)}</select></label></header>{selected && activeEntry ? <><nav className="checkpointFileTabs" aria-label="比較するファイル">{comparisonEntries.map((entry) => { const status = comparisonEntryStatus(entry); const statusClass = status === "追加" ? "added" : status === "削除" ? "removed" : status === "読込失敗" ? "unavailable" : "relocated"; return <button type="button" key={entry.key} title={entry.left && entry.right && entry.match === "relocated" ? `${entry.left.path} → ${entry.right.path}` : entry.left?.path ?? entry.right?.path} className={entry.key === activeEntry.key ? "active" : ""} aria-current={entry.key === activeEntry.key ? "page" : undefined} onClick={() => setFilePath(entry.key)}><span>{entry.name}</span>{status && <em className={`checkpointFileStatus ${statusClass}`}>{status}</em>}</button>})}</nav><div className="checkpointDiffMeta" aria-live="polite">{comparisonStatus}</div><div className="checkpointDiff"><header className="checkpointDiffColumnHeaders"><span><b>{selected.label}</b><small>{activeEntry.left?.name ?? "この保存点にはありません"}</small></span><span><b>{comparisonLabel}</b><small>{activeEntry.right?.name ?? (currentProjectFileUnavailable ? "読み込み失敗" : "この比較先にはありません")}</small></span></header><div className="checkpointDiffRows">{diffRows.map((row, index) => <div className="checkpointDiffRow" key={`${row.left?.number ?? "-"}-${row.right?.number ?? "-"}-${index}`}>{renderDiffLine(row.left)}{renderDiffLine(row.right)}</div>)}</div></div></> : <div className="checkpointBlank">比較できるファイルがありません。</div>}</main>
      <aside className="checkpointPlan" aria-label="復元">{selected ? <><section className="checkpointRestoreHeading"><h2>復元</h2><p><b>{selected.label}</b> · {date(selected.createdAt)}</p></section><section className="checkpointScope" aria-label="復元する範囲"><button type="button" className={scope === "all" ? "active" : ""} aria-pressed={scope === "all"} onClick={() => setScope("all")}>全体</button><button type="button" className={scope === "selected" ? "active" : ""} aria-pressed={scope === "selected"} onClick={() => setScope("selected")}>選択</button></section>{scope === "all" ? <p className="checkpointRestoreSummary">{selected.files.length} ファイル・{folders.length} フォルダを復元します。フォルダの並び順も保存点に戻します。</p> : <section className="checkpointPlanSection"><h3>復元する項目</h3><div className="checkpointRestoreList">{selected.files.map((file) => { const key = pathKey(file.path); const conflicts = conflictPaths.has(key) || relocatedConflictPaths.has(key); const relocation = relocationBySnapshotPath.get(key); return <label key={file.path}><input type="checkbox" checked={selectedPaths.has(file.path)} onChange={() => togglePath(file.path)} /><RestoreItemIcon type="file" /><b>{file.name}</b>{conflicts ? <em className="checkpointConflictMark">変更あり</em> : relocation ? <em>{relocationLabel(file, currentProjectFiles.get(pathKey(relocation.currentPath)) ?? { path: relocation.currentPath, name: fileName(relocation.currentPath), text: file.text })}</em> : file.path === currentFilePath && <em>開いている</em>}</label>})}</div>{folders.length > 0 && <><h3 className="checkpointFolderTitle">フォルダ</h3><div className="checkpointRestoreList checkpointFolderList">{folders.map((folder) => <label key={folder.path}><input type="checkbox" checked={selectedFolderPaths.has(folder.path)} onChange={() => toggleFolder(folder)} /><RestoreItemIcon type="folder" /><b>{folder.name}</b><em>{folder.children.length} 項目</em></label>)}</div></>}{!effectivePaths.length && !selectedFolderPaths.size && <p className="checkpointCaution">復元する項目を選んでください。</p>}<label className="checkpointOrder"><input type="checkbox" checked={restoreOrder} onChange={(event) => setRestoreOrder(event.target.checked)} /><span>フォルダの並び順も戻す</span></label></section>}{scope === "selected" && selectedConflictCount > 0 && <section className="checkpointPlanSection"><h3>変更ありのファイル: {selectedConflictCount}件</h3><div className="checkpointConflictChoices"><label><input type="radio" name="checkpoint-conflict" checked={policy === "overwrite"} onChange={() => setPolicy("overwrite")} /><span><b>保存点の内容で置き換える</b><small>現在の本文を保存点の本文に戻します</small></span></label><label><input type="radio" name="checkpoint-conflict" checked={policy === "copy"} onChange={() => setPolicy("copy")} /><span><b>別ファイルとして残す</b><small>現在のファイルを残し、保存点の内容を別パスへ復元します</small></span></label><label><input type="radio" name="checkpoint-conflict" checked={policy === "skip"} onChange={() => setPolicy("skip")} /><span><b>変更ありのファイルは戻さない</b><small>変更のないファイルだけ復元します</small></span></label></div></section>}<footer><button type="button" className="checkpointRestoreButton" disabled={!effectivePaths.length && !selectedFolderPaths.size} onClick={() => scope === "all" ? onRestore(selected) : onRestoreFiles(selected, effectivePaths, [...selectedFolderPaths], policy, restoreOrder, relocations)}>{scope === "all" ? "この保存点を復元する" : `${effectivePaths.length + selectedFolderPaths.size} 件を復元する`}</button><small>実行前に現在の状態を自動で退避します。</small></footer></> : <p className="checkpointNoSelection">保存点を選ぶと復元できます。</p>}</aside>
    </div>
  </section>;
}
