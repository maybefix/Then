// U5: 素材のノート・画像・PDF を、同じライブラリのほかの作品・ライブラリ直下へ送る（移動・コピー）。
// 手順書は docs/BINDER_REMAINING_PLAN.md。ファイルを動かすのは Rust（transfer_project_entries）で、
// ここは聞く画面・一緒に送ったもの同士の `@[[ ]]` の書き換え・投稿の札・通知と元に戻すを受け持つ。
import { rewriteLinks } from "./links/linkSyntax";

export type TransferDestination = { path: string; label: string };

export type TransferredEntry = {
  oldPath: string;
  newPath: string;
  kind: "text" | "material";
  contentHash: string;
  sourceOrderIndex?: number;
};

export type TransferResult = { entries: TransferredEntry[]; createdMaterialsFolder?: string };
export type TransferUndoResult = { undone: TransferredEntry[]; skipped: number };
export type TransferMode = "move" | "copy";

type MultiInputField = {
  id: string;
  label: string;
  initialValue: string;
  options?: { value: string; label: string }[];
};

/** 聞く画面の欄。ボードの「移動・コピー」と同じ言葉と初期値（コピー）。 */
export function transferDialogFields(destinations: TransferDestination[]): MultiInputField[] {
  return [
    {
      id: "destination",
      label: "送り先",
      initialValue: destinations[0]?.path ?? "",
      options: destinations.map((item) => ({ value: item.path, label: item.label })),
    },
    {
      id: "mode",
      label: "方法",
      initialValue: "copy",
      options: [
        { value: "copy", label: "コピー（元に残す）" },
        { value: "move", label: "移動（元から取り除く）" },
      ],
    },
  ];
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 拡張子を除いた名前（ノート）か、ファイル名（画像・PDF）。 */
export function shownName(path: string): string {
  const name = fileName(path);
  return /\.(md|txt)$/i.test(name) ? name.replace(/\.(md|txt)$/i, "") : name;
}

export function transferTitle(paths: string[]): string {
  return paths.length === 1 ? `「${shownName(paths[0])}」を移動・コピー` : `${paths.length}件を移動・コピー`;
}

export function transferMessage(paths: string[], destinationLabel: string, mode: TransferMode): string {
  const what = paths.length === 1 ? `「${shownName(paths[0])}」` : `${paths.length}件`;
  return `${what}を${destinationLabel}へ${mode === "move" ? "移動" : "コピー"}しました`;
}

export function undoMessage(result: TransferUndoResult): string {
  const kept = result.skipped ? `（送り先で変更された${result.skipped}件は戻していません）` : "";
  if (!result.undone.length) return `元に戻せませんでした${kept}`;
  return `元に戻しました${kept}`;
}

/** 作品のフォルダからの相対パス（`/` 区切り）。外なら null。 */
export function relativePath(rootPath: string, path: string): string | null {
  const root = rootPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const target = path.replace(/[\\/]+/g, "/");
  if (target.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`)) return target.slice(root.length + 1);
  return null;
}

const linkKey = (path: string) => path.replace(/[\\/]+/g, "/").replace(/^\/+/, "").toLocaleLowerCase();

/**
 * 一緒に送ったもの同士の対応（送り元からのパス → 送り先からのパス）。送った本文の `@[[ ]]` がこのどれかを
 * 指していれば、送り先のパスへ書き換える。送らなかったものを指すリンクはそのまま（行き先のないリンクになる）。
 */
export function sentPathChanges(sourceRoot: string, targetRoot: string, entries: TransferredEntry[]): Map<string, string> {
  const changes = new Map<string, string>();
  for (const entry of entries) {
    const from = relativePath(sourceRoot, entry.oldPath);
    const to = relativePath(targetRoot, entry.newPath);
    if (from && to) changes.set(linkKey(from), to);
  }
  return changes;
}

export function rewriteSentPathLinks(text: string, changes: Map<string, string>): { text: string; count: number } {
  if (!changes.size) return { text, count: 0 };
  return rewriteLinks(text, true, (link) => (link.kind === "path" ? changes.get(linkKey(link.target)) ?? null : null));
}

export type TransferIo = {
  readText: (path: string) => Promise<{ content: string; contentHash: string | null }>;
  /** 書いて、書いたあとの中身のハッシュを返す。 */
  writeText: (path: string, content: string, expectedHash: string | null) => Promise<string | null>;
};

/**
 * 送った本文の `@[[ ]]` を書き換える。書き換えたファイルは、元に戻すときの比べる相手（contentHash）を
 * 書いたあとのものにする。読めない・書けないものは、そのまま（送るのは済んでいる）。
 */
export async function rewriteSentLinks(
  sourceRoot: string,
  targetRoot: string,
  entries: TransferredEntry[],
  io: TransferIo,
): Promise<TransferredEntry[]> {
  const changes = sentPathChanges(sourceRoot, targetRoot, entries);
  const next: TransferredEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== "text") {
      next.push(entry);
      continue;
    }
    try {
      const read = await io.readText(entry.newPath);
      const rewritten = rewriteSentPathLinks(read.content, changes);
      if (!rewritten.count) {
        next.push(entry);
        continue;
      }
      const hash = await io.writeText(entry.newPath, rewritten.text, read.contentHash);
      next.push(hash ? { ...entry, contentHash: hash } : entry);
    } catch {
      next.push(entry);
    }
  }
  return next;
}
