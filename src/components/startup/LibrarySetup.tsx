import { useEffect, useState } from "react";
import type { FolderInspection, ProjectImportReport } from "../../types";

export type LibrarySetupCandidate = {
  path: string;
  name: string;
};

type ImportStatus =
  | { state: "waiting" }
  | { state: "running" }
  | { state: "done"; report: ProjectImportReport }
  | { state: "failed"; error: string };

type CandidateRow = LibrarySetupCandidate & { selected: boolean; status: ImportStatus };

export type LibrarySetupResult = {
  libraryPath: string;
  libraryName: string;
  imported: { sourcePath: string; report: ProjectImportReport }[];
};

type LibrarySetupProps = {
  candidates: LibrarySetupCandidate[];
  loadDefaultParent: () => Promise<string>;
  pickFolder: (title: string, defaultPath?: string) => Promise<string | null>;
  inspectFolder: (path: string) => Promise<FolderInspection>;
  createLibrary: (parentPath: string, name: string) => Promise<string>;
  importProject: (sourcePath: string, libraryPath: string) => Promise<ProjectImportReport>;
  onImported: (sourcePath: string, report: ProjectImportReport, libraryName: string) => void;
  onOpenLibrary: (result: LibrarySetupResult) => void;
  /** 失敗したときはその理由を返す。 */
  onOpenExistingLibrary: () => Promise<string | null>;
  onLater: () => void;
};

const DEFAULT_LIBRARY_NAME = "わたしの作品集";

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, "")}\\${name}`;
}

function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/** ライブラリをまだ持っていないときに出す、ライブラリ作成と作品取り込みの画面。 */
export function LibrarySetup({
  candidates,
  loadDefaultParent,
  pickFolder,
  inspectFolder,
  createLibrary,
  importProject,
  onImported,
  onOpenLibrary,
  onOpenExistingLibrary,
  onLater,
}: LibrarySetupProps) {
  const [name, setName] = useState(DEFAULT_LIBRARY_NAME);
  const [parentPath, setParentPath] = useState("");
  const [rows, setRows] = useState<CandidateRow[]>(() =>
    candidates.map((candidate) => ({ ...candidate, selected: true, status: { state: "waiting" } })),
  );
  const [phase, setPhase] = useState<"edit" | "running" | "finished">("edit");
  const [error, setError] = useState("");
  const [result, setResult] = useState<LibrarySetupResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDefaultParent()
      .then((path) => {
        if (!cancelled) setParentPath((current) => current || path);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadDefaultParent]);

  const trimmedName = name.trim();
  const libraryPathPreview = parentPath && trimmedName ? joinPath(parentPath, trimmedName) : "";
  const selectedRows = rows.filter((row) => row.selected);

  const updateRow = (path: string, patch: Partial<CandidateRow>) =>
    setRows((current) => current.map((row) => (row.path === path ? { ...row, ...patch } : row)));

  const handleChangeParent = async () => {
    const picked = await pickFolder("ライブラリを作る場所を選ぶ", parentPath || undefined);
    if (picked) setParentPath(picked);
  };

  const handleAddCandidate = async () => {
    setError("");
    const picked = await pickFolder("取り込む作品のフォルダを選ぶ");
    if (!picked) return;
    if (rows.some((row) => row.path.toLowerCase() === picked.toLowerCase())) return;
    const inspection = await inspectFolder(picked);
    if (inspection.libraryPath) {
      setError(`「${inspection.name}」は既にライブラリの中にあります。`);
      return;
    }
    setRows((current) => [
      ...current,
      { path: picked, name: inspection.name, selected: true, status: { state: "waiting" } },
    ]);
  };

  const handleRun = async () => {
    if (!trimmedName || !parentPath) {
      setError("ライブラリ名と作成する場所を指定してください。");
      return;
    }
    setError("");
    setPhase("running");
    let libraryPath: string;
    try {
      libraryPath = await createLibrary(parentPath, trimmedName);
    } catch (createError) {
      setError(`ライブラリを作成できませんでした: ${String(createError)}`);
      setPhase("edit");
      return;
    }

    const imported: LibrarySetupResult["imported"] = [];
    for (const row of selectedRows) {
      updateRow(row.path, { status: { state: "running" } });
      try {
        const report = await importProject(row.path, libraryPath);
        imported.push({ sourcePath: row.path, report });
        onImported(row.path, report, trimmedName);
        updateRow(row.path, { status: { state: "done", report } });
      } catch (importError) {
        updateRow(row.path, { status: { state: "failed", error: String(importError) } });
      }
    }
    setResult({ libraryPath, libraryName: trimmedName, imported });
    setPhase("finished");
  };

  const statusLabel = (status: ImportStatus) => {
    switch (status.state) {
      case "waiting":
        return phase === "edit" ? "" : "待機中";
      case "running":
        return "コピーして検証中…";
      case "done":
        return status.report.warnings.length
          ? `完了（注意 ${status.report.warnings.length}件）`
          : "完了";
      case "failed":
        return "失敗";
    }
  };

  const failedRows = rows.filter((row) => row.status.state === "failed");

  return (
    <section className="librarySetup" aria-label="ライブラリの準備">
      <div className="librarySetupPanel">
        <header>
          <p className="librarySetupEyebrow">はじめに</p>
          <h1>ライブラリを準備します</h1>
          <p>
            作品はライブラリの中で管理します。最初に一度だけ、ライブラリを作る場所を決めてください。
            これまでの作品は、ライブラリの中へコピーして取り込みます。
          </p>
        </header>

        <div className="librarySetupFields">
          <label className="librarySetupField">
            <span>ライブラリ名</span>
            <input
              value={name}
              disabled={phase !== "edit"}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="librarySetupField">
            <span>作成する場所</span>
            <div className="librarySetupLocation">
              <span className="librarySetupPath" title={parentPath}>
                {parentPath || "…"}
              </span>
              <button type="button" disabled={phase !== "edit"} onClick={() => void handleChangeParent()}>
                変更…
              </button>
            </div>
            {libraryPathPreview && (
              <small>
                新しいフォルダ <code>{libraryPathPreview}</code> を作ります。
              </small>
            )}
          </div>
        </div>

        <div className="librarySetupImports">
          <div className="librarySetupImportsHeader">
            <span>取り込む作品</span>
            <small>元のフォルダは変更しません</small>
          </div>
          {rows.length === 0 && (
            <p className="librarySetupEmpty">
              取り込む作品はありません。空のライブラリから始めることもできます。
            </p>
          )}
          <ul>
            {rows.map((row) => (
              <li key={row.path} data-state={row.status.state}>
                <label>
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={phase !== "edit"}
                    onChange={(event) => updateRow(row.path, { selected: event.target.checked })}
                  />
                  <span className="librarySetupImportName">{row.name || folderName(row.path)}</span>
                  <span className="librarySetupImportPath" title={row.path}>
                    {row.path}
                  </span>
                </label>
                <span className="librarySetupImportStatus">{statusLabel(row.status)}</span>
                {row.status.state === "failed" && (
                  <span className="librarySetupImportError">{row.status.error}</span>
                )}
              </li>
            ))}
          </ul>
          {phase === "edit" && (
            <button className="librarySetupAdd" type="button" onClick={() => void handleAddCandidate()}>
              ＋ ほかの作品フォルダを追加…
            </button>
          )}
        </div>

        {error && <p className="librarySetupError" role="alert">{error}</p>}
        {phase === "finished" && failedRows.length > 0 && (
          <p className="librarySetupError" role="alert">
            {failedRows.length}件を取り込めませんでした。元のフォルダは変更していません。
            ライブラリを開いたあと、サイドバーの「既存の作品を取り込む…」からやり直せます。
          </p>
        )}

        <footer className="librarySetupActions">
          {phase === "edit" && (
            <>
              <button
                className="librarySetupLink"
                type="button"
                onClick={() => {
                  setError("");
                  void onOpenExistingLibrary().then((message) => message && setError(message));
                }}
              >
                作成済みのライブラリを開く…
              </button>
              <button type="button" onClick={onLater}>
                あとで
              </button>
              <button className="librarySetupPrimary" type="button" onClick={() => void handleRun()}>
                {selectedRows.length ? `作成して${selectedRows.length}件を取り込む` : "ライブラリを作成"}
              </button>
            </>
          )}
          {phase === "running" && <span className="librarySetupRunning">作成しています…</span>}
          {phase === "finished" && result && (
            <button className="librarySetupPrimary" type="button" onClick={() => onOpenLibrary(result)}>
              ライブラリを開く
            </button>
          )}
        </footer>
      </div>
    </section>
  );
}
