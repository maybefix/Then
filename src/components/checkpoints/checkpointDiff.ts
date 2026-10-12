import type { ComparisonEntry, ComparisonFile } from "./checkpointComparison";

/**
 * チェックポイント画面の差分計算。画面から独立した純粋関数だけを置く。
 * 段落（改行区切り）単位の比較を全ファイル分まとめて行い、文字単位の比較は
 * 表示する段落ペアにだけ後からかける（`diffChars`）。
 */

type EditOp = { kind: "same" | "removed" | "added"; oldIndex: number; newIndex: number };

/**
 * Myers の最短編集列。編集距離が `maxEditDistance` を超えたら諦めて null を返す。
 * 呼び出し側は前後の一致部分を取り除いてから渡すので、通常の推敲ならここまで届かない。
 */
function myersDiff<T>(before: readonly T[], after: readonly T[], maxEditDistance: number): EditOp[] | null {
  const limit = Math.min(before.length + after.length, maxEditDistance);
  const vectors = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let distance = 0; distance <= limit; distance += 1) {
    trace.push(new Map(vectors));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const movedDown = diagonal === -distance || (
        diagonal !== distance &&
        (vectors.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) < (vectors.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY)
      );
      let x = movedDown ? vectors.get(diagonal + 1) ?? 0 : (vectors.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) { x += 1; y += 1; }
      vectors.set(diagonal, x);
      if (x < before.length || y < after.length) continue;

      const operations: EditOp[] = [];
      let cx = before.length;
      let cy = after.length;
      for (let step = trace.length - 1; step > 0; step -= 1) {
        const previous = trace[step];
        const currentDiagonal = cx - cy;
        const cameFromDown = currentDiagonal === -step || (
          currentDiagonal !== step &&
          (previous.get(currentDiagonal - 1) ?? Number.NEGATIVE_INFINITY) < (previous.get(currentDiagonal + 1) ?? Number.NEGATIVE_INFINITY)
        );
        const previousDiagonal = cameFromDown ? currentDiagonal + 1 : currentDiagonal - 1;
        const previousX = previous.get(previousDiagonal) ?? 0;
        const previousY = previousX - previousDiagonal;
        while (cx > previousX && cy > previousY) { cx -= 1; cy -= 1; operations.push({ kind: "same", oldIndex: cx, newIndex: cy }); }
        if (cx === previousX) { cy -= 1; operations.push({ kind: "added", oldIndex: cx, newIndex: cy }); }
        else { cx -= 1; operations.push({ kind: "removed", oldIndex: cx, newIndex: cy }); }
      }
      while (cx > 0 && cy > 0) { cx -= 1; cy -= 1; operations.push({ kind: "same", oldIndex: cx, newIndex: cy }); }
      while (cx > 0) { cx -= 1; operations.push({ kind: "removed", oldIndex: cx, newIndex: cy }); }
      while (cy > 0) { cy -= 1; operations.push({ kind: "added", oldIndex: cx, newIndex: cy }); }
      return operations.reverse();
    }
  }
  return null;
}

/** 前後の一致を落としてから Myers にかけ、届かなければ中央部を「全削除 + 全追加」にする。 */
function diffSequences<T>(before: readonly T[], after: readonly T[], maxEditDistance: number): EditOp[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore -= 1; endAfter -= 1; }

  const operations: EditOp[] = [];
  for (let index = 0; index < start; index += 1) operations.push({ kind: "same", oldIndex: index, newIndex: index });
  const middleBefore = before.slice(start, endBefore);
  const middleAfter = after.slice(start, endAfter);
  const middle = myersDiff(middleBefore, middleAfter, maxEditDistance) ?? [
    ...middleBefore.map((_, index) => ({ kind: "removed" as const, oldIndex: index, newIndex: 0 })),
    ...middleAfter.map((_, index) => ({ kind: "added" as const, oldIndex: middleBefore.length, newIndex: index })),
  ];
  for (const operation of middle) operations.push({ ...operation, oldIndex: operation.oldIndex + start, newIndex: operation.newIndex + start });
  for (let offset = 0; offset < before.length - endBefore; offset += 1) {
    operations.push({ kind: "same", oldIndex: endBefore + offset, newIndex: endAfter + offset });
  }
  return operations;
}

const WHITESPACE = /[\s　]/g;
/** 字数は既存の「表示文字数」と同じく空白を数えない。 */
export const visibleLength = (text: string) => Array.from(text.replace(WHITESPACE, "")).length;
export const splitParagraphs = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");
const isBlank = (text: string | null) => !text || !text.replace(WHITESPACE, "");

/** 段落ペアの増減字数。前後の一致を除いた中央部だけを数える（文字単位の差分を待たずに出せる近似）。 */
function pairDelta(before: string, after: string): { plus: number; minus: number } {
  const left = Array.from(before);
  const right = Array.from(after);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) { endLeft -= 1; endRight -= 1; }
  return {
    plus: visibleLength(right.slice(start, endRight).join("")),
    minus: visibleLength(left.slice(start, endLeft).join("")),
  };
}

export type ParagraphRow = {
  /** 1始まり。旧側にない段落は null。 */
  oldLine: number | null;
  newLine: number | null;
  oldText: string | null;
  newText: string | null;
  /** この行の直前に畳んだ「変更のない段落」の数（空行は数えない）。 */
  gapBefore: number;
};

export type ParagraphDiff = { rows: ParagraphRow[]; plus: number; minus: number };

export function diffParagraphs(oldText: string, newText: string): ParagraphDiff {
  const before = splitParagraphs(oldText);
  const after = splitParagraphs(newText);
  const operations = diffSequences(before, after, 1000);
  const rows: ParagraphRow[] = [];
  let plus = 0;
  let minus = 0;
  let gap = 0;
  let removed: number[] = [];
  let added: number[] = [];

  const flush = () => {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1) {
      const oldIndex = removed[index];
      const newIndex = added[index];
      const oldValue = oldIndex === undefined ? null : before[oldIndex];
      const newValue = newIndex === undefined ? null : after[newIndex];
      // 空行が増えた・減っただけの行は見せない。
      if (isBlank(oldValue) && isBlank(newValue)) continue;
      if (oldValue !== null && newValue !== null) {
        const delta = pairDelta(oldValue, newValue);
        plus += delta.plus;
        minus += delta.minus;
      } else if (oldValue !== null) minus += visibleLength(oldValue);
      else if (newValue !== null) plus += visibleLength(newValue);
      rows.push({
        oldLine: oldIndex === undefined ? null : oldIndex + 1,
        newLine: newIndex === undefined ? null : newIndex + 1,
        oldText: oldValue,
        newText: newValue,
        gapBefore: gap,
      });
      gap = 0;
    }
    removed = [];
    added = [];
  };

  for (const operation of operations) {
    if (operation.kind === "same") {
      flush();
      if (!isBlank(before[operation.oldIndex])) gap += 1;
    } else if (operation.kind === "removed") removed.push(operation.oldIndex);
    else added.push(operation.newIndex);
  }
  flush();
  return { rows, plus, minus };
}

/** s = 共通 / d = 旧にだけある / a = 新にだけある */
export type Segment = ["s" | "d" | "a", string];

/**
 * 段落ペアの文字単位の差分。日本語は単語区切りがないので文字単位で取り、
 * 変更に挟まれた2字以下の一致は変更側へ吸収して細切れを防ぐ。
 */
export function diffChars(oldText: string, newText: string): Segment[] {
  const before = Array.from(oldText);
  const after = Array.from(newText);
  const operations = diffSequences(before, after, 400);
  const runs: Segment[] = [];
  for (const operation of operations) {
    const kind = operation.kind === "same" ? "s" : operation.kind === "removed" ? "d" : "a";
    const char = operation.kind === "added" ? after[operation.newIndex] : before[operation.oldIndex];
    const last = runs[runs.length - 1];
    if (last && last[0] === kind) last[1] += char;
    else runs.push([kind, char]);
  }

  const segments: Segment[] = [];
  let deleted = "";
  let inserted = "";
  const flushChange = () => {
    if (deleted) segments.push(["d", deleted]);
    if (inserted) segments.push(["a", inserted]);
    deleted = "";
    inserted = "";
  };
  runs.forEach(([kind, text], index) => {
    if (kind === "d") deleted += text;
    else if (kind === "a") inserted += text;
    else {
      const betweenChanges = index > 0 && index < runs.length - 1 && Array.from(text).length <= 2;
      if (betweenChanges && (deleted || inserted)) {
        deleted += text;
        inserted += text;
        return;
      }
      flushChange();
      segments.push(["s", text]);
    }
  });
  flushChange();
  return segments;
}

export type FileDiffKind = "changed" | "added" | "removed" | "relocated";

export type FileDiff = {
  key: string;
  name: string;
  /** プロジェクト直下からのフォルダ。直下なら空文字。 */
  folder: string;
  kind: FileDiffKind;
  /** 移動・名前変更のときの見出し（「移動」「名前変更」など）。 */
  relocationLabel: string | null;
  oldFile: ComparisonFile | null;
  newFile: ComparisonFile | null;
  plus: number;
  minus: number;
  rows: ParagraphRow[];
};

export type OrderChange = { folder: string; before: string[]; after: string[] };

export type ProjectDiff = {
  files: FileDiff[];
  unchangedCount: number;
  orderChanges: OrderChange[];
  plus: number;
  minus: number;
  summary: string;
  empty: boolean;
};

type TreeNode = { path: string; name: string; kind?: "folder" | "file"; children: readonly TreeNode[] };

const pathKey = (path: string) => path.replace(/[\\/]+/g, "\\").toLocaleLowerCase();
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const parentPath = (path: string) => path.replace(/[\\/][^\\/]+$/, "");
const sameText = (left: string, right: string) => left.replace(/\r\n?/g, "\n") === right.replace(/\r\n?/g, "\n");

function relativeParts(rootPath: string, path: string): string[] {
  const root = pathKey(rootPath);
  const key = pathKey(path);
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (!key.startsWith(root)) return parts.slice(-1);
  const rootDepth = rootPath.split(/[\\/]+/).filter(Boolean).length;
  return parts.slice(rootDepth);
}

export function relocationLabel(left: ComparisonFile, right: ComparisonFile): string {
  const renamed = fileName(left.path).toLocaleLowerCase() !== fileName(right.path).toLocaleLowerCase();
  const moved = pathKey(parentPath(left.path)) !== pathKey(parentPath(right.path));
  if (renamed && moved) return "名前変更・移動";
  if (renamed) return "名前変更";
  return "移動";
}

/**
 * フォルダごとの並び順を比べる。両方にある項目だけで比べるので、
 * 追加・削除されたファイルがあるだけでは「並び順が変わった」とは言わない。
 */
export function compareTreeOrder(oldTree: TreeNode, newTree: TreeNode): OrderChange[] {
  const collect = (tree: TreeNode) => {
    const orders = new Map<string, { label: string; names: string[] }>();
    const visit = (node: TreeNode) => {
      const parts = relativeParts(tree.path, node.path);
      orders.set(parts.join("\\").toLocaleLowerCase(), { label: parts.join(" / "), names: node.children.map((child) => child.name) });
      for (const child of node.children) if (child.kind === "folder") visit(child);
    };
    visit(tree);
    return orders;
  };
  const before = collect(oldTree);
  const after = collect(newTree);
  const changes: OrderChange[] = [];
  for (const [key, oldOrder] of before) {
    const newOrder = after.get(key);
    if (!newOrder) continue;
    const newNames = new Set(newOrder.names.map((name) => name.toLocaleLowerCase()));
    const oldNames = new Set(oldOrder.names.map((name) => name.toLocaleLowerCase()));
    const left = oldOrder.names.filter((name) => newNames.has(name.toLocaleLowerCase()));
    const right = newOrder.names.filter((name) => oldNames.has(name.toLocaleLowerCase()));
    if (left.length < 2) continue;
    if (left.some((name, index) => name.toLocaleLowerCase() !== right[index]?.toLocaleLowerCase())) {
      changes.push({ folder: newOrder.label, before: left, after: right });
    }
  }
  return changes;
}

export function summarizeDiff(files: readonly FileDiff[], orderChanged: boolean): string {
  const count = (kind: FileDiffKind) => files.filter((file) => file.kind === kind).length;
  const changed = count("changed");
  const added = count("added");
  const removed = count("removed");
  const relocated = count("relocated");
  const nouns = [
    changed ? `${changed}ファイルの本文` : "",
    relocated ? `${relocated}ファイルの名前や場所` : "",
    orderChanged ? "フォルダの並び順" : "",
  ].filter(Boolean);
  const clauses = [
    added ? [`${added}ファイルが加わり`, `${added}ファイルが加わっています`] : null,
    removed ? [`${removed}ファイルがなくなり`, `${removed}ファイルがなくなっています`] : null,
  ].filter((clause): clause is string[] => clause !== null);
  if (nouns.length) return `${clauses.map(([joined]) => `${joined}、`).join("")}${nouns.join("と、")}が変わっています`;
  if (clauses.length) return clauses.map(([joined, final], index) => index === clauses.length - 1 ? final : `${joined}、`).join("");
  return "変更はありません";
}

/**
 * プロジェクト全体の差分。`entries` は旧 → 新の向きで `buildComparisonEntries` から作ったもの。
 * 段落単位までをここで計算し、文字単位は表示時に `diffChars` で行う。
 */
export function buildProjectDiff(entries: readonly ComparisonEntry[], oldTree: TreeNode, newTree: TreeNode): ProjectDiff {
  const files: FileDiff[] = [];
  let unchangedCount = 0;
  for (const entry of entries) {
    const { left, right } = entry;
    const reference = right ?? left;
    if (!reference) continue;
    const rootPath = right ? newTree.path : oldTree.path;
    const folder = relativeParts(rootPath, reference.path).slice(0, -1).join(" / ");
    const base = { key: entry.key, name: reference.name, folder, oldFile: left, newFile: right, relocationLabel: null };
    if (left && right) {
      const textChanged = !sameText(left.text, right.text);
      const relocated = entry.match === "relocated";
      if (!textChanged && !relocated) { unchangedCount += 1; continue; }
      const diff = textChanged ? diffParagraphs(left.text, right.text) : { rows: [], plus: 0, minus: 0 };
      files.push({
        ...base,
        kind: relocated ? "relocated" : "changed",
        relocationLabel: relocated ? relocationLabel(left, right) : null,
        ...diff,
      });
    } else if (right) {
      files.push({ ...base, kind: "added", plus: visibleLength(right.text), minus: 0, rows: [] });
    } else if (left) {
      files.push({ ...base, kind: "removed", plus: 0, minus: visibleLength(left.text), rows: [] });
    }
  }
  const orderChanges = compareTreeOrder(oldTree, newTree);
  return {
    files,
    unchangedCount,
    orderChanges,
    plus: files.reduce((sum, file) => sum + file.plus, 0),
    minus: files.reduce((sum, file) => sum + file.minus, 0),
    summary: summarizeDiff(files, orderChanges.length > 0),
    empty: files.length === 0 && orderChanges.length === 0,
  };
}

/** 追加ファイルの冒頭として見せる段落（空行を除く先頭 n 段落）。 */
export function leadingParagraphs(text: string, count: number): Array<{ line: number; text: string }> {
  const result: Array<{ line: number; text: string }> = [];
  for (const [index, paragraph] of splitParagraphs(text).entries()) {
    if (isBlank(paragraph)) continue;
    result.push({ line: index + 1, text: paragraph });
    if (result.length >= count) break;
  }
  return result;
}
