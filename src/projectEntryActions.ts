import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, DragEvent, MutableRefObject, SetStateAction } from "react";
import { replacePlotReferencePath } from "./components/plot/plotCardUtils";
import { createProjectAstSkeleton, removeProjectAstPaths } from "./editor/ast/projectAst";
import type { ProjectAst } from "./editor/ast/types";
import {
  createScratchDocumentTab,
  isDirtyDocumentTab,
  type ClosedDocumentTab,
} from "./editor/documentTabState";
import { closeDocumentJournal, forgetDocumentJournal } from "./editor/saveJournal";
import type { ThenPluginAnchor } from "./plugins/types";
import {
  referenceCardPointsInside,
  referenceFilePointsInside,
  retargetReferenceCard,
  retargetReferenceFileInfo,
  retargetReferenceSourcePath,
} from "./referencePathModel";
import type {
  AppState,
  BreadcrumbDropTarget,
  DeleteProjectEntryPlan,
  DeleteProjectEntryResult,
  DocumentTab,
  PlotCard,
  ProjectEntry,
  ProjectFolder,
  ReferenceFileInfo,
  ReferenceLayout,
  SaveStatus,
  TextDocument,
  TextTemplateSummary,
} from "./types";
import {
  findContainingFolderPath,
  findFirstTextFile,
  findProjectEntry,
  getFolderChildren,
  getParentPath,
  isPathInsideFolder,
  isPathSameOrInside,
  isSamePath,
  movePathInOrder,
  movePathToDropPosition,
  movePathsToDropPosition,
  replaceFolderChildren,
  retargetFilesystemPath,
  toProjectRelativePath,
} from "./utils/projectTree";
import { withSourceTextExtension } from "./utils/textFileName";

const BREADCRUMB_ENTRY_DRAG_MIME = "application/x-brew-project-entry-path";
const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

type MoveProjectEntryResult = {
  projectFolder: ProjectFolder;
  movedDocument: TextDocument | null;
  oldPath: string;
  newPath: string;
  oldParentPath: string;
  newParentPath: string;
};

type MovedProjectEntry = Omit<MoveProjectEntryResult, "projectFolder">;

type MoveProjectEntriesResult = {
  projectFolder: ProjectFolder;
  moves: MovedProjectEntry[];
};

type PathChange = { oldPath: string; newPath: string };

/**
 * サイドバーの見出しの開閉の記録の名前（`<ファイル>:<見出しの id>`。見出しの id も `<ファイル>:` で
 * 始まる）を、ファイルの場所とその後ろに分ける。形が違えば null。
 */
function splitOutlineHeadingKey(key: string): { path: string; rest: string } | null {
  for (let at = key.indexOf(":"); at >= 0; at = key.indexOf(":", at + 1)) {
    const path = key.slice(0, at);
    if (key.startsWith(`${path}:`, at + 1)) return { path, rest: key.slice(at + 1 + path.length) };
  }
  return null;
}

type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ProjectEntryActionDeps = {
  projectFolder: ProjectFolder | null;
  setProjectFolder: Dispatch<SetStateAction<ProjectFolder | null>>;
  openTabs: DocumentTab[];
  setOpenTabs: Dispatch<SetStateAction<DocumentTab[]>>;
  activeTab: DocumentTab | null;
  activeTabIdRef: MutableRefObject<string>;
  setActiveTabId: Dispatch<SetStateAction<string>>;
  currentFilePath: string | null;
  focusedFolderPath: string | null;
  setFocusedFolderPath: Dispatch<SetStateAction<string | null>>;
  activeBreadcrumbPath: string | null;
  setActiveBreadcrumbPath: Dispatch<SetStateAction<string | null>>;
  setBreadcrumbBrowsePath: Dispatch<SetStateAction<string | null>>;
  setCollapsedWorkspaceFolderPaths: Dispatch<SetStateAction<ReadonlySet<string>>>;
  breadcrumbDropTarget: BreadcrumbDropTarget;
  setBreadcrumbDropTarget: Dispatch<SetStateAction<BreadcrumbDropTarget>>;
  setDraggingBreadcrumbEntryPath: Dispatch<SetStateAction<string | null>>;
  breadcrumbDragEntryRef: MutableRefObject<{ folderPath: string; entryPath: string } | null>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  setPlotCards: Dispatch<SetStateAction<PlotCard[]>>;
  setReferenceLayout: Dispatch<SetStateAction<ReferenceLayout>>;
  setReferenceCandidates: Dispatch<SetStateAction<ReferenceFileInfo[]>>;
  setProjectAst: Dispatch<SetStateAction<ProjectAst | null>>;
  projectAstBuildIdRef: MutableRefObject<number>;
  projectEntryPathChangeInProgressRef: MutableRefObject<boolean>;
  pluginAnchorsRef: MutableRefObject<ThenPluginAnchor[]>;
  persistPluginAnchors: (anchors: ThenPluginAnchor[]) => void;
  retargetPluginAnchors: (oldAbsolutePath: string, newAbsolutePath: string) => void;
  didMountEditorRef: MutableRefObject<boolean>;
  lastSavedMarkdownRef: MutableRefObject<string>;
  setSaveStatus: (nextStatus: SaveStatus) => void;
  setLastError: Dispatch<SetStateAction<string>>;
  showToast: (message: string, action?: ToastAction | null) => void;
  requestInput: (options: {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    placeholder?: string;
    optional?: boolean;
  }) => Promise<string | null>;
  requestConfirm: (options: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
  requestCreateFile: (
    templates: TextTemplateSummary[],
  ) => Promise<{ fileName: string; templateId: string | null } | null>;
  loadTextTemplates: () => Promise<TextTemplateSummary[]>;
  enqueueDocumentSave: (request: { tabId: string; path: string; content: string }) => Promise<TextDocument>;
  refreshProjectFolder: (folderPath: string) => Promise<ProjectFolder | null>;
  loadDocumentIntoEditor: (document: TextDocument, options?: { replaceActive?: boolean }) => void;
  replaceActiveTab: (nextTab: DocumentTab) => void;
  setProjectProofreadIgnored: Dispatch<SetStateAction<Record<string, string[]>>>;
  setClosedDocumentTabs: Dispatch<SetStateAction<ClosedDocumentTab[]>>;
};

/**
 * 作品のファイルとフォルダを作る・名前を変える・消す・動かす・並べ替える操作。値は App が持ち、
 * 描画のたびにその時点の値と書き換え用の関数を受け取る。
 */
export function createProjectEntryActions(deps: ProjectEntryActionDeps) {
  const {
    projectFolder,
    setProjectFolder,
    openTabs,
    setOpenTabs,
    activeTab,
    activeTabIdRef,
    setActiveTabId,
    currentFilePath,
    focusedFolderPath,
    setFocusedFolderPath,
    activeBreadcrumbPath,
    setActiveBreadcrumbPath,
    setBreadcrumbBrowsePath,
    setCollapsedWorkspaceFolderPaths,
    breadcrumbDropTarget,
    setBreadcrumbDropTarget,
    setDraggingBreadcrumbEntryPath,
    breadcrumbDragEntryRef,
    setAppState,
    setPlotCards,
    setReferenceLayout,
    setReferenceCandidates,
    setProjectAst,
    projectAstBuildIdRef,
    projectEntryPathChangeInProgressRef,
    pluginAnchorsRef,
    persistPluginAnchors,
    retargetPluginAnchors,
    didMountEditorRef,
    lastSavedMarkdownRef,
    setSaveStatus,
    setLastError,
    showToast,
    requestInput,
    requestConfirm,
    requestCreateFile,
    loadTextTemplates,
    enqueueDocumentSave,
    refreshProjectFolder,
    loadDocumentIntoEditor,
    replaceActiveTab,
    setProjectProofreadIgnored,
    setClosedDocumentTabs,
  } = deps;

  /**
   * パスを覚えている置き場所を、名前の変更・移動に合わせて付け替える。タブと選んでいるフォルダは、
   * 操作ごとに扱いが違うので、それぞれの操作が書く。置き場所を足したら、removePathOwners にも足す。
   */
  const retargetPathOwners = (rootPath: string, changes: PathChange[]) => {
    const retargetPath = (path: string): string | null => {
      let nextPath = path;
      let changed = false;
      for (const change of changes) {
        const candidate = retargetFilesystemPath(nextPath, change.oldPath, change.newPath);
        if (!candidate) continue;
        nextPath = candidate;
        changed = true;
      }
      return changed ? nextPath : null;
    };

    for (const change of changes) {
      retargetPluginAnchors(change.oldPath, change.newPath);
      const oldReferencePath = toProjectRelativePath(rootPath, change.oldPath);
      const newReferencePath = toProjectRelativePath(rootPath, change.newPath);
      if (!oldReferencePath || !newReferencePath) continue;
      setPlotCards((current) =>
        current.map((card) => ({
          ...card,
          body: replacePlotReferencePath(card.body, oldReferencePath, newReferencePath),
        })),
      );
      setReferenceLayout((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          retargetReferenceCard(card, oldReferencePath, newReferencePath),
        ),
        recent: current.recent.map((file) =>
          retargetReferenceFileInfo(file, oldReferencePath, newReferencePath),
        ),
      }));
      setReferenceCandidates((current) =>
        current.map((file) =>
          retargetReferenceFileInfo(file, oldReferencePath, newReferencePath),
        ),
      );
      setProjectProofreadIgnored((current) => {
        const next: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(current)) {
          next[retargetReferenceSourcePath(key, oldReferencePath, newReferencePath) ?? key] = value;
        }
        return next;
      });
    }

    setAppState((current) => {
      const retargetRecord = <T,>(record: Record<string, T>): Record<string, T> => {
        const next: Record<string, T> = {};
        for (const [path, value] of Object.entries(record)) {
          next[retargetPath(path) ?? path] = value;
        }
        return next;
      };
      // サイドバーの開閉は作品ごとに持つ。この作品の分だけを付け替える。
      const retargetWorkspaceList = (
        byWorkspace: Record<string, string[]>,
        retargetItem: (item: string) => string | null,
      ): Record<string, string[]> => {
        const list = byWorkspace[rootPath];
        if (!list) return byWorkspace;
        return { ...byWorkspace, [rootPath]: list.map((item) => retargetItem(item) ?? item) };
      };
      const retargetHeadingKey = (key: string) => {
        const parts = splitOutlineHeadingKey(key);
        const nextPath = parts ? retargetPath(parts.path) : null;
        return parts && nextPath ? `${nextPath}:${nextPath}${parts.rest}` : null;
      };
      return {
        ...current,
        fileProgress: retargetRecord(current.fileProgress),
        cursorPositions: retargetRecord(current.cursorPositions),
        lastFilePath: current.lastFilePath
          ? retargetPath(current.lastFilePath) ?? current.lastFilePath
          : current.lastFilePath,
        collapsedFolderPathsByWorkspace: retargetWorkspaceList(
          current.collapsedFolderPathsByWorkspace,
          retargetPath,
        ),
        collapsedOutlinePathsByWorkspace: retargetWorkspaceList(
          current.collapsedOutlinePathsByWorkspace,
          retargetPath,
        ),
        collapsedOutlineHeadingKeysByWorkspace: retargetWorkspaceList(
          current.collapsedOutlineHeadingKeysByWorkspace,
          retargetHeadingKey,
        ),
      };
    });
    setClosedDocumentTabs((current) => {
      if (!current.some((record) => retargetPath(record.path))) return current;
      return current.map((record) => ({ ...record, path: retargetPath(record.path) ?? record.path }));
    });
    setCollapsedWorkspaceFolderPaths((current) => {
      if (![...current].some((path) => retargetPath(path))) return current;
      const next = new Set<string>();
      for (const path of current) {
        next.add(retargetPath(path) ?? path);
      }
      return next;
    });
  };

  /**
   * 名前の変わるタブの書きかけの記録を、ファイルがまだ元の場所にあるうちに閉じる（Rust は閉じるときに
   * 元のファイルを確かめる）。保存し終えていれば消え、済んでいない分があれば残る。
   */
  const closeTabJournals = (tabs: DocumentTab[]) =>
    Promise.all(tabs.map((tab) => closeDocumentJournal(tab.id)));

  /** 削除したパスを、retargetPathOwners と同じ置き場所から取り除く。プロットの本文のリンクは、利用者の文章なので残す。 */
  const removePathOwners = (rootPath: string, removedPath: string) => {
    const deletedAnchorRoot = toProjectRelativePath(rootPath, removedPath)
      .replace(/[\\/]+/g, "/")
      .toLocaleLowerCase();
    persistPluginAnchors(pluginAnchorsRef.current.filter((anchor) => {
      const documentPath = anchor.documentPath.replace(/[\\/]+/g, "/").toLocaleLowerCase();
      return documentPath !== deletedAnchorRoot && !documentPath.startsWith(`${deletedAnchorRoot}/`);
    }));

    const removedReferencePath = toProjectRelativePath(rootPath, removedPath);
    if (removedReferencePath) {
      setReferenceLayout((current) => ({
        ...current,
        cards: current.cards.filter((card) => !referenceCardPointsInside(card, removedReferencePath)),
        recent: current.recent.filter((file) => !referenceFilePointsInside(file, removedReferencePath)),
      }));
      setReferenceCandidates((current) =>
        current.filter((file) => !referenceFilePointsInside(file, removedReferencePath)),
      );
      setProjectProofreadIgnored((current) => {
        const next: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(current)) {
          if (retargetReferenceSourcePath(key, removedReferencePath, removedReferencePath) === null) {
            next[key] = value;
          }
        }
        return next;
      });
    }

    setAppState((current) => {
      const nextCursorPositions = { ...current.cursorPositions };
      const nextFileProgress = { ...current.fileProgress };
      for (const path of Object.keys(nextCursorPositions)) {
        if (isPathSameOrInside(path, removedPath)) {
          delete nextCursorPositions[path];
        }
      }
      for (const path of Object.keys(nextFileProgress)) {
        if (isPathSameOrInside(path, removedPath)) {
          delete nextFileProgress[path];
        }
      }
      const removeFromWorkspaceList = (
        byWorkspace: Record<string, string[]>,
        pathOf: (item: string) => string | null,
      ): Record<string, string[]> => {
        const list = byWorkspace[rootPath];
        if (!list) return byWorkspace;
        return {
          ...byWorkspace,
          [rootPath]: list.filter((item) => {
            const path = pathOf(item);
            return !path || !isPathSameOrInside(path, removedPath);
          }),
        };
      };
      return {
        ...current,
        cursorPositions: nextCursorPositions,
        fileProgress: nextFileProgress,
        lastFilePath:
          current.lastFilePath && isPathSameOrInside(current.lastFilePath, removedPath)
            ? null
            : current.lastFilePath,
        collapsedFolderPathsByWorkspace: removeFromWorkspaceList(
          current.collapsedFolderPathsByWorkspace,
          (path) => path,
        ),
        collapsedOutlinePathsByWorkspace: removeFromWorkspaceList(
          current.collapsedOutlinePathsByWorkspace,
          (path) => path,
        ),
        collapsedOutlineHeadingKeysByWorkspace: removeFromWorkspaceList(
          current.collapsedOutlineHeadingKeysByWorkspace,
          (key) => splitOutlineHeadingKey(key)?.path ?? null,
        ),
      };
    });
    setCollapsedWorkspaceFolderPaths((current) => {
      if (![...current].some((path) => isPathSameOrInside(path, removedPath))) return current;
      return new Set([...current].filter((path) => !isPathSameOrInside(path, removedPath)));
    });
    setClosedDocumentTabs((current) => {
      if (!current.some((record) => isPathSameOrInside(record.path, removedPath))) return current;
      return current.filter((record) => !isPathSameOrInside(record.path, removedPath));
    });
  };

  const handleCreateProjectFile = async (folderPath = activeBreadcrumbPath) => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    const targetFolderPath = folderPath ?? projectFolder.path;

    try {
      const templates = await loadTextTemplates();
      const draft = await requestCreateFile(templates);
      if (!draft) return;
      const document = draft.templateId
        ? await invoke<TextDocument>("create_text_file_from_template", {
            folderPath: targetFolderPath,
            name: draft.fileName,
            rootPath: projectFolder.path,
            templateId: draft.templateId,
          })
        : await invoke<TextDocument>("create_text_file", {
            folderPath: targetFolderPath,
            name: draft.fileName,
          });
      await refreshProjectFolder(targetFolderPath);
      loadDocumentIntoEditor(document);
      showToast(`「${document.name}」を作成しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleCreateProjectFolder = async (folderPath = activeBreadcrumbPath) => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    const targetFolderPath = folderPath ?? projectFolder.path;
    const name = await requestInput({
      title: "新規フォルダを作成",
      label: "フォルダ名",
      initialValue: "新規フォルダ",
      confirmLabel: "作成",
      placeholder: "例: 第一章",
    });
    if (!name) return;

    setSaveStatus("loading");
    try {
      await invoke<ProjectFolder>("create_project_folder", {
        folderPath: targetFolderPath,
        name,
      });
      await refreshProjectFolder(targetFolderPath);
      setSaveStatus(currentFilePath ? "saved" : "dirty");
      showToast(`「${name.trim()}」を作成しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleRenameProjectEntry = async (entry: ProjectFolder | ProjectEntry) => {
    if (!projectFolder) return;
    const isFolderEntry = !("kind" in entry) || entry.kind === "folder";
    const enteredName = await requestInput({
      title: "名前を変更",
      label: isFolderEntry ? "フォルダ名" : "テキストファイル名",
      initialValue: entry.name,
      confirmLabel: "変更",
    });
    if (!enteredName) return;
    // ファイルは、拡張子を書かなければ元の拡張子のまま（今と同じ名前になれば何もしない）。
    const name = isFolderEntry ? enteredName : withSourceTextExtension(enteredName, entry.name);
    if (name.trim() === entry.name) return;

    projectEntryPathChangeInProgressRef.current = true;
    setSaveStatus("loading");
    try {
      const affectedTabs = openTabs.filter((tab) => {
        if (!tab.path) return false;
        return isFolderEntry
          ? isSamePath(tab.path, entry.path) || isPathInsideFolder(tab.path, entry.path)
          : isSamePath(tab.path, entry.path);
      });
      const activeWasDirty = activeTab ? isDirtyDocumentTab(activeTab) : false;
      const activeWillBeRetargeted = currentFilePath
        ? Boolean(retargetFilesystemPath(currentFilePath, entry.path, entry.path))
        : false;
      await Promise.all(
        affectedTabs
          .filter(isDirtyDocumentTab)
          .map((tab) =>
            enqueueDocumentSave({
              tabId: tab.id,
              path: tab.path!,
              content: tab.markdown,
            }),
          ),
      );

      await closeTabJournals(affectedTabs);

      const document = await invoke<TextDocument>("rename_project_entry", {
        path: entry.path,
        name,
      });
      retargetPathOwners(projectFolder.path, [{ oldPath: entry.path, newPath: document.path }]);
      const parentFolderPath =
        findContainingFolderPath(projectFolder, entry.path) ?? projectFolder.path;
      await refreshProjectFolder(parentFolderPath);

      const activeNewPath = currentFilePath
        ? retargetFilesystemPath(currentFilePath, entry.path, document.path)
        : null;
      if (activeNewPath) setActiveTabId(`file:${activeNewPath}`);
      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const nextPath = retargetFilesystemPath(tab.path, entry.path, document.path);
          if (!nextPath) return tab;
          const isRenamedFile = !isFolderEntry && isSamePath(nextPath, document.path);
          return {
            ...tab,
            id: `file:${nextPath}`,
            kind: "file",
            path: nextPath,
            name: isRenamedFile
              ? document.name
              : nextPath.split(/[\\/]/).pop() ?? tab.name,
            fileId: isRenamedFile ? document.fileId ?? tab.fileId : tab.fileId,
            contentHash: isRenamedFile
              ? document.contentHash ?? tab.contentHash
              : tab.contentHash,
            markdown: isRenamedFile ? document.content : tab.markdown,
            savedMarkdown: isRenamedFile ? document.content : tab.savedMarkdown,
            saveStatus: "saved",
            documentKey: nextPath,
          };
        }),
      );

      if (activeNewPath) {
        setAppState((current) => ({
          ...current,
          markdown: !isFolderEntry && isSamePath(activeNewPath, document.path)
            ? document.content
            : current.markdown,
          lastFilePath: activeNewPath,
        }));
        if (!isFolderEntry && isSamePath(activeNewPath, document.path)) {
          lastSavedMarkdownRef.current = document.content;
        }
      }

      setFocusedFolderPath((current) =>
        current ? retargetFilesystemPath(current, entry.path, document.path) ?? current : current,
      );
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setSaveStatus(
        currentFilePath
          ? activeWillBeRetargeted || !activeWasDirty
            ? "saved"
            : "dirty"
          : "dirty",
      );
      showToast(`「${entry.name}」をリネームしました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    } finally {
      projectEntryPathChangeInProgressRef.current = false;
    }
  };

  const handleDeleteProjectEntry = async (entry: ProjectEntry) => {
    if (!projectFolder) return;
    if (!isTauriRuntime()) {
      showToast("ファイル削除はTauri版で利用できます");
      return;
    }
    let plan: DeleteProjectEntryPlan;
    try {
      plan = await invoke<DeleteProjectEntryPlan>("plan_delete_project_entry", {
        rootPath: projectFolder.path,
        path: entry.path,
      });
    } catch (error) {
      setLastError(String(error));
      showToast("削除対象を確認できませんでした");
      return;
    }

    const affectedDirtyTabs = openTabs.filter(
      (tab) =>
        tab.path &&
        isPathSameOrInside(tab.path, entry.path) &&
        tab.saveStatus !== "saved",
    );
    const countSummary =
      plan.rootKind === "folder"
        ? `配下のテキストファイル ${plan.textFileCount} 件、その他ファイル ${plan.nonTextFileCount} 件、フォルダ ${Math.max(0, plan.folderCount - 1)} 件をThenのTrashへ移動します。`
        : "ファイルをThenのTrashへ移動します。";
    const dirtySummary =
      affectedDirtyTabs.length > 0
        ? ` 未保存のタブ ${affectedDirtyTabs.length} 件は閉じられ、未保存内容は破棄されます。`
        : "";
    const warningSummary =
      plan.warnings.length > 0 ? ` 注意: ${plan.warnings.slice(0, 2).join(" / ")}` : "";
    const shouldDelete = await requestConfirm({
      title: "項目を削除",
      message: `「${entry.name}」を削除しますか？`,
      detail: `${countSummary} チェックポイントには影響しません。${dirtySummary}${warningSummary}`,
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldDelete) return;

    setSaveStatus("loading");
    try {
      const result = await invoke<DeleteProjectEntryResult>("delete_project_entry_to_trash", {
        rootPath: projectFolder.path,
        path: entry.path,
      });
      removePathOwners(projectFolder.path, entry.path);
      projectAstBuildIdRef.current += 1;
      setProjectAst((current) =>
        current ? removeProjectAstPaths(current, result.deletedPaths) : current,
      );
      const parentFolderPath =
        findContainingFolderPath(projectFolder, entry.path) ?? projectFolder.path;
      const refreshed = await refreshProjectFolder(parentFolderPath);
      if (refreshed) {
        setProjectAst((current) => createProjectAstSkeleton(refreshed, current));
      }

      const activeWasDeleted = currentFilePath
        ? isPathSameOrInside(currentFilePath, entry.path)
        : false;
      const nextFocusedFolder =
        focusedFolderPath && isPathSameOrInside(focusedFolderPath, entry.path)
          ? getParentPath(entry.path) ?? projectFolder.path
          : focusedFolderPath;
      setFocusedFolderPath(nextFocusedFolder);
      setActiveBreadcrumbPath((path) =>
        path && isPathSameOrInside(path, entry.path)
          ? getParentPath(entry.path) ?? projectFolder.path
          : path,
      );
      setBreadcrumbBrowsePath((path) =>
        path && isPathSameOrInside(path, entry.path)
          ? getParentPath(entry.path) ?? projectFolder.path
          : path,
      );

      setOpenTabs((current) =>
        current.filter((tab) => !tab.path || !isPathSameOrInside(tab.path, entry.path)),
      );
      for (const tab of openTabs) {
        if (tab.path && isPathSameOrInside(tab.path, entry.path)) forgetDocumentJournal(tab.id);
      }
      if (activeWasDeleted) {
        const nextFile = refreshed ? findFirstTextFile(refreshed.children) : null;
        if (nextFile) {
          const document = await invoke<TextDocument>("read_text_file", {
            path: nextFile.path,
          });
          loadDocumentIntoEditor(document, { replaceActive: true });
        } else {
          didMountEditorRef.current = false;
          setFocusedFolderPath(projectFolder.path);
          replaceActiveTab(
            createScratchDocumentTab("", {
              documentKey: `workspace-empty-${Date.now()}`,
              saveStatus: "saved",
            }),
          );
          setAppState((current) => ({
            ...current,
            markdown: "",
            lastFilePath: null,
          }));
          setLastError("");
        }
      } else {
        setSaveStatus(currentFilePath ? "saved" : "dirty");
      }
      showToast(
        result.fallbackUsed === "appTrash"
          ? `「${entry.name}」をThenのTrashへ移動しました`
          : `「${entry.name}」をゴミ箱へ移動しました`,
      );
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
      showToast("削除できませんでした");
    }
  };

  const handleMoveProjectEntryToFolder = async (
    sourcePath: string,
    targetFolderPath: string,
    targetPath?: string,
    position?: "before" | "after",
  ) => {
    if (!projectFolder) return;
    const sourceEntry = findProjectEntry(projectFolder.children, sourcePath);
    if (!sourceEntry) return;

    const sourceParentPath =
      findContainingFolderPath(projectFolder, sourcePath) ?? projectFolder.path;
    if (isSamePath(sourceParentPath, targetFolderPath)) return;
    if (
      sourceEntry.kind === "folder" &&
      (isSamePath(sourcePath, targetFolderPath) ||
        isPathInsideFolder(targetFolderPath, sourcePath))
    ) {
      showToast("フォルダを自分自身の中へ移動できません");
      return;
    }

    projectEntryPathChangeInProgressRef.current = true;
    setSaveStatus("loading");
    try {
      const affectedTabs = openTabs.filter((tab) => {
        if (!tab.path) return false;
        return sourceEntry.kind === "folder"
          ? isSamePath(tab.path, sourcePath) || isPathInsideFolder(tab.path, sourcePath)
          : isSamePath(tab.path, sourcePath);
      });
      await Promise.all(
        affectedTabs
          .filter(isDirtyDocumentTab)
          .map((tab) =>
            enqueueDocumentSave({
              tabId: tab.id,
              path: tab.path!,
              content: tab.markdown,
            }),
          ),
      );

      await closeTabJournals(affectedTabs);

      const result = await invoke<MoveProjectEntryResult>("move_project_entry", {
        rootPath: projectFolder.path,
        sourcePath,
        targetFolderPath,
        targetPath: targetPath ?? null,
        position: position ?? null,
      });
      retargetPathOwners(projectFolder.path, [{ oldPath: result.oldPath, newPath: result.newPath }]);

      const activeNewPath = currentFilePath
        ? retargetFilesystemPath(currentFilePath, result.oldPath, result.newPath)
        : null;
      const nextActiveTabId = activeNewPath ? `file:${activeNewPath}` : activeTabIdRef.current;
      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const nextPath = retargetFilesystemPath(tab.path, result.oldPath, result.newPath);
          if (!nextPath) return tab;
          const movedDocument =
            result.movedDocument && isSamePath(result.movedDocument.path, nextPath)
              ? result.movedDocument
              : null;
          return {
            ...tab,
            id: `file:${nextPath}`,
            kind: "file",
            path: nextPath,
            name: movedDocument?.name ?? nextPath.split(/[\\/]/).pop() ?? tab.name,
            fileId: movedDocument?.fileId ?? tab.fileId,
            contentHash: movedDocument?.contentHash ?? tab.contentHash,
            markdown: movedDocument?.content ?? tab.markdown,
            savedMarkdown: movedDocument?.content ?? tab.savedMarkdown,
            saveStatus: "saved",
            documentKey: nextPath,
          };
        }),
      );
      if (activeNewPath) {
        setActiveTabId(nextActiveTabId);
        setAppState((current) => ({
          ...current,
          markdown: result.movedDocument?.content ?? current.markdown,
          lastFilePath: activeNewPath,
        }));
        lastSavedMarkdownRef.current =
          result.movedDocument?.content ?? activeTab?.savedMarkdown ?? lastSavedMarkdownRef.current;
      }

      setFocusedFolderPath(
        sourceEntry.kind === "folder" ? result.newPath : result.newParentPath,
      );
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setProjectFolder(result.projectFolder);
      setLastError("");
      setSaveStatus(activeNewPath || currentFilePath ? "saved" : "dirty");
      showToast(`「${sourceEntry.name}」を移動しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    } finally {
      projectEntryPathChangeInProgressRef.current = false;
    }
  };

  const handleMoveProjectEntriesToFolder = async (
    sourcePaths: string[],
    targetFolderPath: string,
    targetPath?: string,
    position?: "before" | "after",
  ) => {
    if (!projectFolder) return;
    const uniqueSourcePaths = [...new Set(sourcePaths)];
    if (uniqueSourcePaths.length === 0) return;
    if (uniqueSourcePaths.length === 1) {
      await handleMoveProjectEntryToFolder(
        uniqueSourcePaths[0],
        targetFolderPath,
        targetPath,
        position,
      );
      return;
    }

    const sourceEntries = uniqueSourcePaths.map((path) =>
      findProjectEntry(projectFolder.children, path),
    );
    if (sourceEntries.some((entry) => !entry || entry.kind !== "file")) {
      showToast("複数移動ではファイルだけを選択してください");
      return;
    }
    const movingPaths = uniqueSourcePaths.filter((path) => {
      const parentPath =
        findContainingFolderPath(projectFolder, path) ?? projectFolder.path;
      return !isSamePath(parentPath, targetFolderPath);
    });
    if (movingPaths.length === 0) return;

    projectEntryPathChangeInProgressRef.current = true;
    setSaveStatus("loading");
    try {
      const movingPathSet = new Set(movingPaths);
      await Promise.all(
        openTabs
          .filter(
            (tab): tab is DocumentTab & { path: string } =>
              Boolean(tab.path && movingPathSet.has(tab.path)),
          )
          .filter(isDirtyDocumentTab)
          .map((tab) =>
            enqueueDocumentSave({
              tabId: tab.id,
              path: tab.path,
              content: tab.markdown,
            }),
          ),
      );

      await closeTabJournals(openTabs.filter((tab) => Boolean(tab.path && movingPathSet.has(tab.path))));

      const result = await invoke<MoveProjectEntriesResult>("move_project_entries", {
        rootPath: projectFolder.path,
        sourcePaths: movingPaths,
        targetFolderPath,
      });
      const retargetMovedPath = (path: string): string | null => {
        let nextPath = path;
        let changed = false;
        for (const moved of result.moves) {
          const candidate = retargetFilesystemPath(
            nextPath,
            moved.oldPath,
            moved.newPath,
          );
          if (!candidate) continue;
          nextPath = candidate;
          changed = true;
        }
        return changed ? nextPath : null;
      };

      retargetPathOwners(projectFolder.path, result.moves);

      const movedDocumentByPath = new Map(
        result.moves.flatMap((moved) =>
          moved.movedDocument
            ? [[moved.movedDocument.path, moved.movedDocument] as const]
            : [],
        ),
      );
      const activeNewPath = currentFilePath
        ? retargetMovedPath(currentFilePath)
        : null;
      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const nextPath = retargetMovedPath(tab.path);
          if (!nextPath) return tab;
          const movedDocument = movedDocumentByPath.get(nextPath);
          return {
            ...tab,
            id: `file:${nextPath}`,
            kind: "file",
            path: nextPath,
            name:
              movedDocument?.name ??
              nextPath.split(/[\\/]/).pop() ??
              tab.name,
            fileId: movedDocument?.fileId ?? tab.fileId,
            contentHash: movedDocument?.contentHash ?? tab.contentHash,
            markdown: movedDocument?.content ?? tab.markdown,
            savedMarkdown: movedDocument?.content ?? tab.savedMarkdown,
            saveStatus: "saved",
            documentKey: nextPath,
          };
        }),
      );
      if (activeNewPath) {
        const activeMovedDocument = movedDocumentByPath.get(activeNewPath);
        setActiveTabId(`file:${activeNewPath}`);
        lastSavedMarkdownRef.current =
          activeMovedDocument?.content ??
          activeTab?.savedMarkdown ??
          lastSavedMarkdownRef.current;
        setAppState((current) => ({
          ...current,
          markdown: activeMovedDocument?.content ?? current.markdown,
        }));
      }
      setFocusedFolderPath(targetFolderPath);
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setProjectFolder(result.projectFolder);
      setLastError("");
      setSaveStatus(activeNewPath || currentFilePath ? "saved" : "dirty");
      showToast(`${result.moves.length}件のファイルを移動しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
      showToast("選択したファイルを移動できませんでした");
    } finally {
      projectEntryPathChangeInProgressRef.current = false;
    }
  };

  const saveProjectEntryOrder = async (folderPath: string, orderedPaths: string[]) => {
    if (!projectFolder) return;

    try {
      const folder = await invoke<ProjectFolder>("reorder_project_entries", {
        rootPath: projectFolder.path,
        folderPath,
        orderedPaths,
      });
      setProjectFolder((current) =>
        current ? replaceFolderChildren(current, folder.path, folder.children) : folder,
      );
      showToast("並び順を保存しました");
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleMoveProjectEntry = async (
    folderPath: string,
    entryPath: string,
    direction: -1 | 1,
  ) => {
    if (!projectFolder) return;

    const children = getFolderChildren(projectFolder, folderPath);
    const nextOrder = movePathInOrder(
      children.map((entry) => entry.path),
      entryPath,
      direction,
    );
    if (!nextOrder) return;

    await saveProjectEntryOrder(folderPath, nextOrder);
  };

  const handleBreadcrumbEntryDragStart = (
    event: DragEvent<HTMLDivElement>,
    folderPath: string,
    entryPath: string,
  ) => {
    breadcrumbDragEntryRef.current = { folderPath, entryPath };
    setDraggingBreadcrumbEntryPath(entryPath);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(BREADCRUMB_ENTRY_DRAG_MIME, entryPath);
  };

  const handleBreadcrumbEntryDragOver = (
    event: DragEvent<HTMLDivElement>,
    folderPath: string,
    entryPath: string,
  ) => {
    const draggingEntry = breadcrumbDragEntryRef.current;
    if (!draggingEntry || draggingEntry.folderPath !== folderPath) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setBreadcrumbDropTarget({ folderPath, entryPath, position });
  };

  const handleBreadcrumbEntryDrop = async (
    event: DragEvent<HTMLDivElement>,
    folderPath: string,
    entryPath: string,
  ) => {
    const draggingEntry = breadcrumbDragEntryRef.current;
    if (!projectFolder || !draggingEntry || draggingEntry.folderPath !== folderPath) return;

    event.preventDefault();
    const children = getFolderChildren(projectFolder, folderPath);
    const nextOrder = movePathToDropPosition(
      children.map((entry) => entry.path),
      draggingEntry.entryPath,
      entryPath,
      breadcrumbDropTarget?.position ?? "before",
    );
    setBreadcrumbDropTarget(null);
    setDraggingBreadcrumbEntryPath(null);
    breadcrumbDragEntryRef.current = null;
    if (nextOrder) await saveProjectEntryOrder(folderPath, nextOrder);
  };

  const handleBreadcrumbEntryDragEnd = () => {
    setBreadcrumbDropTarget(null);
    setDraggingBreadcrumbEntryPath(null);
    breadcrumbDragEntryRef.current = null;
  };

  const handleSidebarEntryReorder = async (
    folderPath: string,
    draggedPaths: string[],
    targetPath: string,
    position: "before" | "after",
  ) => {
    if (!projectFolder) return;

    const children = getFolderChildren(projectFolder, folderPath);
    const nextOrder = movePathsToDropPosition(
      children.map((entry) => entry.path),
      draggedPaths,
      targetPath,
      position,
    );
    if (nextOrder) await saveProjectEntryOrder(folderPath, nextOrder);
  };

  return {
    handleCreateProjectFile,
    handleCreateProjectFolder,
    handleRenameProjectEntry,
    handleDeleteProjectEntry,
    handleMoveProjectEntriesToFolder,
    handleMoveProjectEntry,
    handleBreadcrumbEntryDragStart,
    handleBreadcrumbEntryDragOver,
    handleBreadcrumbEntryDrop,
    handleBreadcrumbEntryDragEnd,
    handleSidebarEntryReorder,
  };
}
