import type { ProjectEntry, ProjectFolder } from "../../types";

const RECENT_LIMIT = 5;

function collectFiles(entries: ProjectEntry[], out: ProjectEntry[] = []): ProjectEntry[] {
  for (const entry of entries) {
    if (entry.kind === "file") out.push(entry);
    else collectFiles(entry.children, out);
  }
  return out;
}

function formatModified(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(timestamp);
}

/** 文書を一つも開いていないとき、編集面に出すライブラリ直下・作品のスタートページ。 */
export function ScopeStartPage({
  folder,
  onOpenFile,
  onCreateFile,
  onOpenPlot,
  onOpenCanvas,
  onEditWork,
}: {
  folder: ProjectFolder;
  /** ライブラリ内の作品のとき、状態とあらすじを編集する。 */
  onEditWork?: () => void;
  onOpenFile: (path: string) => void;
  onCreateFile: () => void;
  onOpenPlot: () => void;
  onOpenCanvas: () => void;
}) {
  const isLibraryRoot = folder.library?.role === "root";
  const recentFiles = collectFiles(folder.children)
    .filter((file) => typeof file.modifiedAt === "number")
    .sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0))
    .slice(0, RECENT_LIMIT);

  return (
    <section className="newTabStart scopeStartPage" aria-label="開いている文書はありません">
      <div>
        <p className="newTabEyebrow">{isLibraryRoot ? "Library" : "Project"}</p>
        <h1>{folder.library && isLibraryRoot ? folder.library.name : folder.name}</h1>
        <p>
          開いている文書はありません。
          {isLibraryRoot
            ? "左のツリーからライブラリ直下の文書を開くか、作品を選んでください。"
            : "左のツリーから文書を選ぶか、新しく作成してください。"}
        </p>
      </div>
      <div className="newTabActions">
        <button type="button" onClick={onCreateFile}>
          ＋ 新規ファイル
        </button>
        <button type="button" onClick={onOpenPlot}>
          プロットを開く
        </button>
        <button type="button" onClick={onOpenCanvas}>
          Canvas を開く
        </button>
        {onEditWork && (
          <button type="button" onClick={onEditWork}>
            作品情報（状態・あらすじ）
          </button>
        )}
      </div>
      {recentFiles.length > 0 && (
        <ul className="scopeStartRecent" aria-label="最近編集した文書">
          {recentFiles.map((file) => (
            <li key={file.path}>
              <button type="button" title={file.path} onClick={() => onOpenFile(file.path)}>
                <span className="scopeStartRecentName">{file.name.replace(/\.txt$/i, "")}</span>
                <span className="scopeStartRecentTime">{formatModified(file.modifiedAt!)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
