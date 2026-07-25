import {
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  DocumentOutlineItem,
  ProjectAst,
  ProjectAstFile,
  ProjectSearchResult,
} from "../../editor/ast/types";
import type {
  FileProgressStatus,
  ManuscriptSnapshot,
  OutlineItem,
  ProjectEntry,
  ProjectFolder,
  SidebarMode,
} from "../../types";
import { fileProgressLabels, fileProgressStatuses } from "../../types";
import { logHeadingDnd } from "../../utils/headingDndDiagnostics";
import {
  buildFilePreview,
  buildHeadingPreview,
} from "../../utils/previewText";

type WorkspaceSidebarProps = {
  projectFolder: ProjectFolder | null;
  currentFilePath: string | null;
  currentFileName: string;
  currentFileCharCount: number;
  focusedFolderPath: string | null;
  activeDocumentOutline: OutlineItem[];
  activeOutlineIds: ReadonlySet<string>;
  projectAst: ProjectAst | null;
  sidebarMode: SidebarMode;
  navigatorPreviewLines: number;
  /** 文字数カウントに空白文字を含めるか。false なら空白を除いた文字数を表示する。 */
  countWhitespace: boolean;
  fileProgress: Record<string, FileProgressStatus>;
  onSetFileProgress: (path: string, status: FileProgressStatus) => void;
  collapsedFolderPaths: ReadonlySet<string>;
  onFolderCollapsedChange: (path: string, collapsed: boolean) => void;
  collapsedOutlinePaths: ReadonlySet<string>;
  onOutlineCollapsedChange: (path: string, collapsed: boolean) => void;
  collapsedOutlineHeadingKeys: ReadonlySet<string>;
  onOutlineHeadingCollapsedChange: (key: string, collapsed: boolean) => void;
  projectSearchQuery: string;
  projectSearchResults: ProjectSearchResult[];
  searchScope: WorkspaceSearchScope;
  projectReplaceValue: string;
  isProjectReplacing: boolean;
  isProjectSearchMode: boolean;
  onProjectSearchQueryChange: (value: string) => void;
  onSearchScopeChange: (value: WorkspaceSearchScope) => void;
  onProjectReplaceValueChange: (value: string) => void;
  onOpenProjectSearchResult: (result: ProjectSearchResult) => void;
  onReplaceInCurrentFile: () => void;
  onReplaceInProject: () => void;
  onJumpOutline: (item: OutlineItem) => void;
  onJumpProjectOutline: (path: string, item: DocumentOutlineItem) => void;
  onMoveHeadings: (
    sources: SidebarHeadingSelection[],
    targetPath: string,
    targetLine: number | null,
    targetBlockId: string | null,
    position: "before" | "after" | "append",
  ) => void;
  onExtractHeading: (source: SidebarHeadingSelection) => void;
  onOpenProjectFolder: () => void;
  onCreateFile: (folderPath?: string) => void;
  onCreateFolder: (folderPath?: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onRenameEntry: (entry: ProjectFolder | ProjectEntry) => void;
  onDeleteEntry: (entry: ProjectEntry) => void;
  onMoveEntry: (sourcePaths: string[], targetFolderPath: string) => void;
  onReorderEntry: (
    folderPath: string,
    draggedPaths: string[],
    targetPath: string,
    position: "before" | "after",
  ) => void;
  snapshots: ManuscriptSnapshot[];
  isSnapshotSectionCollapsed: boolean;
  onSnapshotSectionCollapsedChange: (collapsed: boolean) => void;
  onCreateSnapshot: () => void;
  onRenameSnapshot: (snapshot: ManuscriptSnapshot) => void;
  onEditSnapshotMemo: (snapshot: ManuscriptSnapshot) => void;
  onRestoreSnapshot: (snapshot: ManuscriptSnapshot) => void;
  onDeleteSnapshot: (snapshot: ManuscriptSnapshot) => void;
  onCollapse: () => void;
};

type TreeContextMenu = {
  x: number;
  y: number;
  entry: ProjectFolder | ProjectEntry;
  isRoot: boolean;
} | null;

type PointerDragState = {
  pointerId: number;
  entryPath: string;
  entryPaths: string[];
  sourceParentPaths: string[];
  reorderFolderPath: string | null;
  replaceSelectionOnDrag: boolean;
  captureTarget: HTMLElement;
  startX: number;
  startY: number;
  isDragging: boolean;
};

type TreeDropTarget =
  | {
      kind: "reorder";
      folderPath: string;
      entryPath: string;
      position: "before" | "after";
    }
  | {
      kind: "moveInto";
      folderPath: string;
      entryPath: string;
    }
  | null;

type HeadingDragState = {
  sources: SidebarHeadingSelection[];
};

export type SidebarHeadingSelection = {
  path: string;
  line: number;
  blockId: string;
  title: string;
};

type HeadingContextMenu = {
  x: number;
  y: number;
} | null;

type HeadingDropTarget =
  | {
      kind: "heading";
      path: string;
      line: number;
      blockId: string;
      position: "before" | "after";
    }
  | {
      kind: "file";
      path: string;
      position: "append";
    }
  | null;

type WorkspaceSearchScope = "file" | "project";

const HEADING_DRAG_MIME = "application/x-then-heading";

function isProjectEntry(entry: ProjectFolder | ProjectEntry): entry is ProjectEntry {
  return "kind" in entry;
}

function getEntryKind(entry: ProjectFolder | ProjectEntry): ProjectEntry["kind"] | "folder" {
  return isProjectEntry(entry) ? entry.kind : "folder";
}

function getProjectAstStatusLabel(projectAst: ProjectAst | null): string {
  if (!projectAst) return "未構築";
  if (projectAst.status === "empty") return "0";
  if (projectAst.status === "indexing" || projectAst.status === "partial") {
    return `${projectAst.indexedCount}/${projectAst.files.length}`;
  }
  return String(projectAst.indexedCount);
}

function formatCharCount(value: number): string {
  return `${new Intl.NumberFormat("ja-JP").format(value)}字`;
}

function formatSnapshotDate(value: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(value)
    .replace(/\//g, "-")
    .replace(/\s+/g, " ");
}

function normalizeSidebarPath(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function isSidebarPathInside(path: string, folderPath: string): boolean {
  const normalizedPath = normalizeSidebarPath(path);
  const normalizedFolder = normalizeSidebarPath(folderPath);
  return (
    normalizedPath !== normalizedFolder &&
    normalizedPath.startsWith(`${normalizedFolder}\\`)
  );
}

function getFileProgress(
  progress: Record<string, FileProgressStatus>,
  path: string,
): FileProgressStatus {
  return progress[path] ?? "todo";
}

/** AST のブロック列から編集ソースを行配列として復元する。 */
function getFileSourceLines(astFile: ProjectAstFile | null | undefined): string[] {
  const blocks = astFile?.documentAst?.blocks;
  if (!blocks || blocks.length === 0) return [];
  return blocks.map((block) => block.source);
}

/** ファイルパスからツリー上のフォルダノードを探す（root も含む）。 */
function findFolderNode(
  root: ProjectFolder,
  path: string,
): ProjectFolder | ProjectEntry | null {
  if (root.path === path) return root;
  const stack: ProjectEntry[] = [...root.children];
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.kind === "folder") {
      if (entry.path === path) return entry;
      stack.push(...entry.children);
    }
  }
  return null;
}

/** 指定パスの親フォルダのパスを返す（root もしくは未発見なら null）。 */
function findParentPath(root: ProjectFolder, targetPath: string): string | null {
  if (root.path === targetPath) return null;
  const visit = (
    folderPath: string,
    children: ProjectEntry[],
  ): string | null => {
    for (const child of children) {
      if (child.path === targetPath) return folderPath;
      if (child.kind === "folder") {
        const found = visit(child.path, child.children);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(root.path, root.children);
}

function collectFilePathsInDisplayOrder(root: ProjectFolder): string[] {
  const paths: string[] = [];
  const visit = (entries: ProjectEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === "file") {
        paths.push(entry.path);
      } else {
        visit(entry.children);
      }
    }
  };
  visit(root.children);
  return paths;
}

const PROGRESS_DOT_CLASS: Record<FileProgressStatus, string> = {
  todo: "progressDot-todo",
  writing: "progressDot-writing",
  revising: "progressDot-revising",
  done: "progressDot-done",
};

type FileProgressControlProps = {
  status: FileProgressStatus;
  onChange: (status: FileProgressStatus) => void;
  compact?: boolean;
};

function FileProgressControl({ status, onChange, compact }: FileProgressControlProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    const close = () => setIsOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [isOpen]);

  return (
    <span className="fileProgressControl">
      <button
        type="button"
        className={[
          "fileProgressBadge",
          `fileProgressBadge-${status}`,
          compact ? "fileProgressBadgeCompact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={`進捗: ${fileProgressLabels[status]}`}
        aria-label={`進捗: ${fileProgressLabels[status]}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
      >
        <span className={`progressDot ${PROGRESS_DOT_CLASS[status]}`} aria-hidden="true" />
        {!compact && <span className="fileProgressLabel">{fileProgressLabels[status]}</span>}
      </button>
      {isOpen && (
        <div
          className="fileProgressMenu"
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {fileProgressStatuses.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === status}
              className={option === status ? "activeProgressOption" : ""}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange(option);
                setIsOpen(false);
              }}
            >
              <span className={`progressDot ${PROGRESS_DOT_CLASS[option]}`} aria-hidden="true" />
              <span>{fileProgressLabels[option]}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

type SidebarIconName =
  | "book"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "external"
  | "file"
  | "folder"
  | "folderPlus"
  | "plus"
  | "search";

function SidebarIcon({ name, className = "" }: { name: SidebarIconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "book":
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...common}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    case "chevronLeft":
      return (
        <svg {...common}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      );
    case "chevronRight":
      return (
        <svg {...common}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M7 17 17 7" />
          <path d="M9 7h8v8" />
          <path d="M5 5v14h14" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
        </svg>
      );
    case "folderPlus":
      return (
        <svg {...common}>
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
          <line x1="12" y1="10" x2="12" y2="16" />
          <line x1="9" y1="13" x2="15" y2="13" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="7.25" />
          <path d="m16 16 5 5" />
        </svg>
      );
    default:
      return null;
  }
}

export function WorkspaceSidebar({
  projectFolder,
  currentFilePath,
  currentFileName,
  currentFileCharCount,
  focusedFolderPath,
  activeDocumentOutline,
  activeOutlineIds,
  projectAst,
  sidebarMode,
  navigatorPreviewLines,
  countWhitespace,
  fileProgress,
  onSetFileProgress,
  collapsedFolderPaths,
  onFolderCollapsedChange,
  collapsedOutlinePaths,
  onOutlineCollapsedChange,
  collapsedOutlineHeadingKeys,
  onOutlineHeadingCollapsedChange,
  projectSearchQuery,
  projectSearchResults,
  searchScope,
  projectReplaceValue,
  isProjectReplacing,
  isProjectSearchMode,
  onProjectSearchQueryChange,
  onSearchScopeChange,
  onProjectReplaceValueChange,
  onOpenProjectSearchResult,
  onReplaceInCurrentFile,
  onReplaceInProject,
  onJumpOutline,
  onJumpProjectOutline,
  onMoveHeadings,
  onExtractHeading,
  onOpenProjectFolder,
  onCreateFile,
  onCreateFolder,
  onSelectFile,
  onSelectFolder,
  onRenameEntry,
  onDeleteEntry,
  onMoveEntry,
  onReorderEntry,
  snapshots,
  isSnapshotSectionCollapsed,
  onSnapshotSectionCollapsedChange,
  onCreateSnapshot,
  onRenameSnapshot,
  onEditSnapshotMemo,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onCollapse,
}: WorkspaceSidebarProps) {
  const [contextMenu, setContextMenu] = useState<TreeContextMenu>(null);
  const [headingContextMenu, setHeadingContextMenu] = useState<HeadingContextMenu>(null);
  const [draggingEntryPaths, setDraggingEntryPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedFilePaths, setSelectedFilePaths] = useState<ReadonlySet<string>>(
    () => new Set(currentFilePath ? [currentFilePath] : []),
  );
  const [dropTarget, setDropTarget] = useState<TreeDropTarget>(null);
  const [draggingHeadingKeys, setDraggingHeadingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedHeadings, setSelectedHeadings] = useState<
    ReadonlyMap<string, SidebarHeadingSelection>
  >(() => new Map());
  const [headingDropTarget, setHeadingDropTarget] = useState<HeadingDropTarget>(null);
  const [collapsedScratchOutlineHeadingKeys, setCollapsedScratchOutlineHeadingKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [isReplaceExpanded, setIsReplaceExpanded] = useState(false);
  const [isShelterListExpanded, setIsShelterListExpanded] = useState(false);
  const [snapshotMenu, setSnapshotMenu] = useState<{
    id: string;
    placement: "above" | "below";
    x: number;
    y: number;
  } | null>(null);
  const [navigatorLocation, setNavigatorLocation] = useState<
    { kind: "folder" | "file"; path: string } | null
  >(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const headingDragRef = useRef<HeadingDragState | null>(null);
  const lastHeadingDragOverRef = useRef("");
  const dropTargetRef = useRef<TreeDropTarget>(null);
  const suppressNextClickRef = useRef(false);
  const selectedFilePathsRef = useRef(selectedFilePaths);
  const replaceSelectedFilePaths = (paths: Iterable<string>) => {
    const next = new Set(paths);
    selectedFilePathsRef.current = next;
    setSelectedFilePaths(next);
  };
  const projectAstFiles = new Map(
    projectAst?.files.map((file) => [file.path, file] as const) ?? [],
  );

  useEffect(() => {
    if (!contextMenu && !headingContextMenu) return undefined;

    const close = () => {
      setContextMenu(null);
      setHeadingContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, headingContextMenu]);

  useEffect(() => {
    if (!snapshotMenu) return undefined;

    const close = () => setSnapshotMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [snapshotMenu]);

  // プロジェクトフォルダが切り替わったらナビゲータをルートに戻す。
  useEffect(() => {
    setNavigatorLocation(null);
    replaceSelectedFilePaths(currentFilePath ? [currentFilePath] : []);
    setSelectedHeadings(new Map());
    setHeadingContextMenu(null);
  }, [projectFolder?.path]);

  // 復元や検索結果からファイルが開かれた場合も、表示上のアクティブ行と
  // ドラッグに使う選択集合を一致させる。
  useEffect(() => {
    if (currentFilePath && selectedFilePathsRef.current.has(currentFilePath)) return;
    replaceSelectedFilePaths(currentFilePath ? [currentFilePath] : []);
  }, [currentFilePath]);

  const resetPointerDrag = () => {
    const dragState = pointerDragRef.current;
    if (
      dragState &&
      dragState.captureTarget.hasPointerCapture(dragState.pointerId)
    ) {
      dragState.captureTarget.releasePointerCapture(dragState.pointerId);
    }
    pointerDragRef.current = null;
    setDraggingEntryPaths(new Set());
    dropTargetRef.current = null;
    setDropTarget(null);
  };

  const updateDropTarget = (nextDropTarget: TreeDropTarget) => {
    dropTargetRef.current = nextDropTarget;
    setDropTarget(nextDropTarget);
  };

  const updateDropTargetFromPoint = (
    clientX: number,
    clientY: number,
    dragState: PointerDragState,
  ) => {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>("[data-tree-entry-path]");
    if (!row) {
      updateDropTarget(null);
      return;
    }

    const targetParentFolderPath = row.dataset.treeFolderPath;
    const targetEntryPath = row.dataset.treeEntryPath;
    const targetEntryKind = row.dataset.treeEntryKind;
    if (
      !targetEntryPath ||
      dragState.entryPaths.includes(targetEntryPath) ||
      (targetEntryKind === "folder" &&
        dragState.entryPaths.some((sourcePath) =>
          isSidebarPathInside(targetEntryPath, sourcePath),
        ))
    ) {
      updateDropTarget(null);
      return;
    }

    const rect = row.getBoundingClientRect();
    const offset = clientY - rect.top;
    const isMiddleFolderDrop =
      targetEntryKind === "folder" &&
      !dragState.sourceParentPaths.every(
        (parentPath) => parentPath === targetEntryPath,
      ) &&
      offset > rect.height * 0.28 &&
      offset < rect.height * 0.72;
    if (isMiddleFolderDrop) {
      updateDropTarget({
        kind: "moveInto",
        folderPath: targetEntryPath,
        entryPath: targetEntryPath,
      });
      return;
    }

    if (
      !targetParentFolderPath ||
      targetParentFolderPath !== dragState.reorderFolderPath
    ) {
      updateDropTarget(null);
      return;
    }

    updateDropTarget({
      kind: "reorder",
      folderPath: targetParentFolderPath,
      entryPath: targetEntryPath,
      position: clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };

  const handleTreePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    folderPath: string | null,
    entryPath: string,
    isFolder: boolean,
  ) => {
    if (!folderPath || event.button !== 0) return;

    const selectionAtPointerDown = selectedFilePathsRef.current;
    const isAdditiveSelection = !isFolder && (event.ctrlKey || event.metaKey);
    const dragSelection = new Set(selectionAtPointerDown);
    if (isAdditiveSelection) dragSelection.add(entryPath);
    const shouldDragSelection =
      !isFolder && (selectionAtPointerDown.has(entryPath) || isAdditiveSelection);
    const entryPaths =
      shouldDragSelection && projectFolder
        ? collectFilePathsInDisplayOrder(projectFolder).filter((path) =>
            dragSelection.has(path),
          )
        : [entryPath];
    const sourceParentPaths = projectFolder
      ? entryPaths
          .map((path) => findParentPath(projectFolder, path))
          .filter((path): path is string => Boolean(path))
      : [folderPath];
    const uniqueParentPaths = new Set(sourceParentPaths);
    const eventTarget =
      event.target instanceof Element ? event.target : event.currentTarget;
    const captureTarget =
      eventTarget.closest<HTMLElement>("button") ?? event.currentTarget;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      entryPath,
      entryPaths,
      sourceParentPaths,
      reorderFolderPath:
        uniqueParentPaths.size === 1 ? sourceParentPaths[0] ?? folderPath : null,
      replaceSelectionOnDrag:
        !isFolder && !selectionAtPointerDown.has(entryPath),
      captureTarget,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };
    // Capture immediately so an ordinary drag keeps delivering pointer events
    // after the cursor leaves the narrow source row. Waiting for the first
    // pointermove made fast drags depend on incidental modifier/browser behavior.
    captureTarget.setPointerCapture(event.pointerId);
  };

  const handleTreePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = pointerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );
    if (!dragState.isDragging && distance < 4) return;

    if (!dragState.isDragging) {
      dragState.isDragging = true;
      if (dragState.replaceSelectionOnDrag) {
        replaceSelectedFilePaths(dragState.entryPaths);
      }
    }
    setDraggingEntryPaths(new Set(dragState.entryPaths));
    updateDropTargetFromPoint(event.clientX, event.clientY, dragState);
    event.preventDefault();
  };

  const handleTreePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = pointerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (dragState.isDragging) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
      const activeDropTarget = dropTargetRef.current;
      if (activeDropTarget?.kind === "reorder") {
        onReorderEntry(
          activeDropTarget.folderPath,
          dragState.entryPaths,
          activeDropTarget.entryPath,
          activeDropTarget.position,
        );
      } else if (activeDropTarget?.kind === "moveInto") {
        onMoveEntry(dragState.entryPaths, activeDropTarget.folderPath);
      }
      if (activeDropTarget) replaceSelectedFilePaths([]);
    }

    if (dragState.captureTarget.hasPointerCapture(event.pointerId)) {
      dragState.captureTarget.releasePointerCapture(event.pointerId);
    }
    resetPointerDrag();
  };

  const handleTreeItemClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    entry: ProjectFolder | ProjectEntry,
    isFolder: boolean,
    hasOutline: boolean,
  ) => {
    if (suppressNextClickRef.current) {
      event.preventDefault();
      return;
    }
    if (isFolder) {
      replaceSelectedFilePaths([]);
      onFolderCollapsedChange(entry.path, !collapsedFolderPaths.has(entry.path));
      return;
    }
    if (
      hasOutline &&
      (event.target as HTMLElement).closest("[data-tree-outline-disclosure]")
    ) {
      onOutlineCollapsedChange(entry.path, !collapsedOutlinePaths.has(entry.path));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedFilePathsRef.current);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      replaceSelectedFilePaths(next);
      return;
    }
    replaceSelectedFilePaths([entry.path]);
    onSelectFile(entry.path);
  };

  const outlineHeadingKey = (filePath: string | null, item: DocumentOutlineItem | OutlineItem) =>
    `${filePath ?? "scratch"}:${item.id}`;

  const headingSelectionKey = (heading: SidebarHeadingSelection) =>
    `${heading.path}:${heading.blockId}`;

  const toggleOutlineHeadingCollapse = (filePath: string | null, key: string) => {
    if (filePath) {
      onOutlineHeadingCollapsedChange(key, !collapsedOutlineHeadingKeys.has(key));
      return;
    }
    setCollapsedScratchOutlineHeadingKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const resetHeadingDrag = () => {
    headingDragRef.current = null;
    lastHeadingDragOverRef.current = "";
    setDraggingHeadingKeys(new Set());
    setHeadingDropTarget(null);
  };

  const handleHeadingDragStart = (
    event: ReactDragEvent<HTMLButtonElement>,
    source: SidebarHeadingSelection,
  ) => {
    const sourceKey = headingSelectionKey(source);
    const selectedSources = selectedHeadings.has(sourceKey)
      ? [...selectedHeadings.values()]
      : [source];
    const fileOrder = new Map(
      projectAst?.files.map((file, index) => [file.path, index] as const) ?? [],
    );
    const sources = selectedSources.sort(
      (left, right) =>
        (fileOrder.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
          (fileOrder.get(right.path) ?? Number.MAX_SAFE_INTEGER) ||
        left.path.localeCompare(right.path) ||
        left.line - right.line,
    );
    if (!selectedHeadings.has(sourceKey)) {
      setSelectedHeadings(new Map([[sourceKey, source]]));
    }
    headingDragRef.current = { sources };
    setDraggingHeadingKeys(new Set(sources.map(headingSelectionKey)));
    setHeadingDropTarget(null);
    suppressNextClickRef.current = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      HEADING_DRAG_MIME,
      JSON.stringify({ sources }),
    );
    logHeadingDnd("dragstart", {
      sources,
      dataTransferTypes: Array.from(event.dataTransfer.types),
    });
  };

  const handleHeadingDragOver = (
    event: ReactDragEvent<HTMLButtonElement>,
    path: string,
    line: number,
    blockId: string,
  ) => {
    if (!headingDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setHeadingDropTarget({
      kind: "heading",
      path,
      line,
      blockId,
      position,
    });
    const targetKey = `${path}:${blockId}:${position}`;
    if (lastHeadingDragOverRef.current !== targetKey) {
      lastHeadingDragOverRef.current = targetKey;
      logHeadingDnd("dragover", {
        sourceBlockIds: headingDragRef.current.sources.map((source) => source.blockId),
        targetPath: path,
        targetLine: line,
        targetBlockId: blockId,
        position,
      });
    }
  };

  const handleHeadingDrop = (
    event: ReactDragEvent<HTMLButtonElement>,
    targetPath: string,
    targetLine: number,
    targetBlockId: string,
  ) => {
    const source = headingDragRef.current;
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    logHeadingDnd("drop", {
      sourceBlockIds: source.sources.map((item) => item.blockId),
      targetPath,
      targetLine,
      targetBlockId,
      position,
    });
    onMoveHeadings(
      source.sources,
      targetPath,
      targetLine,
      targetBlockId,
      position,
    );
    setSelectedHeadings(new Map());
    resetHeadingDrag();
  };

  const handleHeadingFileDragOver = (
    event: ReactDragEvent<HTMLElement>,
    path: string,
  ) => {
    if (!headingDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setHeadingDropTarget({ kind: "file", path, position: "append" });
    const targetKey = `${path}:append`;
    if (lastHeadingDragOverRef.current !== targetKey) {
      lastHeadingDragOverRef.current = targetKey;
      logHeadingDnd("dragover", {
        sourceBlockIds: headingDragRef.current.sources.map((source) => source.blockId),
        targetPath: path,
        targetLine: null,
        targetBlockId: null,
        position: "append",
      });
    }
  };

  const handleHeadingFileDrop = (
    event: ReactDragEvent<HTMLElement>,
    targetPath: string,
  ) => {
    const source = headingDragRef.current;
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    logHeadingDnd("drop", {
      sourceBlockIds: source.sources.map((item) => item.blockId),
      targetPath,
      targetLine: null,
      targetBlockId: null,
      position: "append",
    });
    onMoveHeadings(
      source.sources,
      targetPath,
      null,
      null,
      "append",
    );
    setSelectedHeadings(new Map());
    resetHeadingDrag();
  };

  const handleHeadingDragEnd = () => {
    resetHeadingDrag();
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const openContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    entry: ProjectFolder | ProjectEntry,
    isRoot: boolean,
  ) => {
    event.preventDefault();
    setHeadingContextMenu(null);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry,
      isRoot,
    });
  };

  const openHeadingContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    heading: SidebarHeadingSelection,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const key = headingSelectionKey(heading);
    if (!selectedHeadings.has(key) && selectedHeadings.size <= 1) {
      setSelectedHeadings(new Map([[key, heading]]));
    }
    setContextMenu(null);
    setHeadingContextMenu({
      x: event.clientX,
      y: event.clientY,
    });
  };

  const closeContextMenuAndRun = (action: () => void) => {
    setContextMenu(null);
    action();
  };

  const renderContextMenu = (): JSX.Element | null => {
    if (!contextMenu) return null;

    const { entry, isRoot, x, y } = contextMenu;
    const kind = getEntryKind(entry);

    return (
      <div
        className="treeContextMenu"
        style={{ left: x, top: y }}
        role="menu"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            closeContextMenuAndRun(() =>
              kind === "folder" ? onSelectFolder(entry.path) : onSelectFile(entry.path),
            )
          }
        >
          開く
        </button>
        {kind === "folder" && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => closeContextMenuAndRun(() => onCreateFile(entry.path))}
            >
              ファイルを追加
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => closeContextMenuAndRun(() => onCreateFolder(entry.path))}
            >
              フォルダを追加
            </button>
          </>
        )}
        {!isRoot && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => closeContextMenuAndRun(() => onRenameEntry(entry))}
            >
              リネーム
            </button>
            {isProjectEntry(entry) && (
              <button
                type="button"
                role="menuitem"
                onClick={() => closeContextMenuAndRun(() => onDeleteEntry(entry))}
              >
                削除
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  const renderHeadingContextMenu = (): JSX.Element | null => {
    if (!headingContextMenu) return null;
    const selected = [...selectedHeadings.values()];
    const canExtract = selected.length === 1;

    return (
      <div
        className="treeContextMenu headingContextMenu"
        style={{ left: headingContextMenu.x, top: headingContextMenu.y }}
        role="menu"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          disabled={!canExtract}
          title={
            canExtract
              ? "見出しを同じフォルダの別ファイルへ切り出します"
              : "複数の見出しを選択しているため切り出せません"
          }
          onClick={() => {
            const source = selected[0];
            if (!source || !canExtract) return;
            setHeadingContextMenu(null);
            onExtractHeading(source);
          }}
        >
          別ファイルへ切り出す…
        </button>
        {!canExtract && (
          <span className="contextMenuHint">複数選択時は切り出せません</span>
        )}
      </div>
    );
  };

  const renderOutlineItems = (
    filePath: string | null,
    items: DocumentOutlineItem[] | OutlineItem[],
    depth: number,
  ): JSX.Element[] => {
    return items.map((item) => {
      const itemKey = outlineHeadingKey(filePath, item);
      const hasChildren = item.children.length > 0;
      const isCollapsed =
        hasChildren &&
        (filePath
          ? collapsedOutlineHeadingKeys.has(itemKey)
          : collapsedScratchOutlineHeadingKeys.has(itemKey));
      const isActive = filePath === currentFilePath && activeOutlineIds.has(item.id);
      const headingSelection = filePath
        ? {
            path: filePath,
            line: item.line,
            blockId: item.blockId,
            title: item.title,
          }
        : null;
      const selectionKey = headingSelection ? headingSelectionKey(headingSelection) : null;
      const isSelected = Boolean(selectionKey && selectedHeadings.has(selectionKey));
      const isDragging = Boolean(selectionKey && draggingHeadingKeys.has(selectionKey));
      const targetPosition =
        filePath !== null &&
        headingDropTarget?.kind === "heading" &&
        headingDropTarget.path === filePath &&
        headingDropTarget.line === item.line
          ? headingDropTarget.position
          : null;
      return (
        <div className="outlineTreeNode" key={itemKey}>
          <button
            className={[
              "outlineTreeItem",
              hasChildren ? "collapsibleOutlineTreeItem" : "",
              isCollapsed ? "collapsedOutlineTreeItem" : "",
              isActive ? "activeOutlineTreeItem" : "",
              isSelected ? "selectedOutlineTreeItem" : "",
              isDragging ? "draggingHeadingItem" : "",
              targetPosition ? `headingDrop-${targetPosition}` : "",
            ].filter(Boolean).join(" ")}
            data-outline-file-path={filePath ?? undefined}
            data-outline-heading-line={filePath ? item.line : undefined}
            data-outline-block-id={filePath ? item.blockId : undefined}
            draggable={Boolean(filePath)}
            aria-pressed={filePath ? isSelected : undefined}
            style={
              {
                "--outline-item-indent": `${12 + depth * 14}px`,
                paddingLeft: `${12 + depth * 14}px`,
              } as CSSProperties
            }
            type="button"
            title={item.title}
            onClick={(event) => {
              if (suppressNextClickRef.current) {
                event.preventDefault();
                return;
              }
              if (
                hasChildren &&
                (event.target as HTMLElement).closest("[data-outline-heading-disclosure]")
              ) {
                toggleOutlineHeadingCollapse(filePath, itemKey);
                return;
              }
              if (headingSelection && (event.ctrlKey || event.metaKey)) {
                setSelectedHeadings((current) => {
                  const next = new Map(current);
                  const key = headingSelectionKey(headingSelection);
                  if (next.has(key)) {
                    next.delete(key);
                  } else {
                    next.set(key, headingSelection);
                  }
                  return next;
                });
                return;
              }
              if (headingSelection) {
                setSelectedHeadings(
                  new Map([[headingSelectionKey(headingSelection), headingSelection]]),
                );
              }
              filePath ? onJumpProjectOutline(filePath, item) : onJumpOutline(item);
            }}
            onPointerDown={() => {
              if (!filePath) return;
              logHeadingDnd("pointerdown", {
                sourcePath: filePath,
                sourceLine: item.line,
                sourceBlockId: item.blockId,
              });
              logHeadingDnd("block-id-acquired", {
                sourceBlockId: item.blockId,
                outlineId: item.id,
              });
            }}
            onDragStart={
              headingSelection
                ? (event) => handleHeadingDragStart(event, headingSelection)
                : undefined
            }
            onDragOver={
              filePath
                ? (event) =>
                    handleHeadingDragOver(event, filePath, item.line, item.blockId)
                : undefined
            }
            onDrop={
              filePath
                ? (event) =>
                    handleHeadingDrop(event, filePath, item.line, item.blockId)
                : undefined
            }
            onDragEnd={filePath ? handleHeadingDragEnd : undefined}
            onContextMenu={
              headingSelection
                ? (event) => openHeadingContextMenu(event, headingSelection)
                : undefined
            }
          >
            <span
              className="outlineHeadingDisclosure"
              data-outline-heading-disclosure={hasChildren ? "true" : undefined}
              aria-hidden="true"
            >
              {hasChildren && (
                <SidebarIcon
                  name={isCollapsed ? "chevronRight" : "chevronDown"}
                  className="treeChevronIcon"
                />
              )}
            </span>
            <span className="outlineLevelMark">H{item.level}</span>
            <span>{item.title}</span>
          </button>
          {hasChildren && !isCollapsed && (
            <div className="outlineTreeChildren">
              {renderOutlineItems(filePath, item.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  const renderEntry = (
    entry: ProjectFolder | ProjectEntry,
    depth: number,
    parentFolderPath: string | null,
  ): JSX.Element => {
    const kind = getEntryKind(entry);
    const isRoot = !isProjectEntry(entry);
    const isFolder = kind === "folder";
    const hasChildren = isFolder && entry.children.length > 0;
    const isFolderExpanded = isFolder && !collapsedFolderPaths.has(entry.path);
    const isActive = entry.path === currentFilePath;
    const isFocused = entry.path === focusedFolderPath;
    const isSelectedFile = !isFolder && selectedFilePaths.has(entry.path);
    const isDraggable = Boolean(parentFolderPath && isProjectEntry(entry));
    const dropClass =
      dropTarget?.entryPath === entry.path
        ? dropTarget.kind === "moveInto"
          ? "treeDrop-into"
          : `treeDrop-${dropTarget.position}`
        : "";
    const headingFileDropClass =
      !isFolder &&
      headingDropTarget?.kind === "file" &&
      headingDropTarget.path === entry.path
        ? "headingFileDropTarget"
        : "";
    const rowClass = [
      "treeItem",
      isDraggable ? "draggableTreeItem" : "",
      dropClass,
      headingFileDropClass,
      draggingEntryPaths.has(entry.path) ? "draggingTreeEntry" : "",
      isSelectedFile ? "selectedTreeEntry" : "",
      isActive ? "activeTreeItem" : "",
      isFocused && !isActive ? "focusedTreeItem" : "",
      isFolder ? "folderTreeItem" : "fileTreeItem",
    ]
      .filter(Boolean)
      .join(" ");
    const astFile = !isFolder ? projectAstFiles.get(entry.path) : null;
    const outline = astFile?.documentAst?.outline ?? [];
    const hasOutline = outline.length > 0;
    const isOutlineExpanded = hasOutline && !collapsedOutlinePaths.has(entry.path);
    const charCountLabel =
      !isFolder && astFile?.status === "indexed"
        ? formatCharCount(countWhitespace ? astFile.textLength : astFile.visibleTextLength)
        : null;

    return (
      <div className="treeNode" key={entry.path}>
        <div
          className={rowClass}
          data-tree-entry-path={entry.path}
          data-tree-entry-kind={kind}
          data-tree-folder-path={parentFolderPath ?? undefined}
          data-outline-file-row={!isFolder ? "true" : undefined}
          data-outline-file-path={!isFolder ? entry.path : undefined}
          onDragOver={
            !isFolder
              ? (event) => handleHeadingFileDragOver(event, entry.path)
              : undefined
          }
          onDrop={
            !isFolder
              ? (event) => handleHeadingFileDrop(event, entry.path)
              : undefined
          }
          onPointerDown={
            isDraggable
              ? (event) =>
                  handleTreePointerDown(
                    event,
                    parentFolderPath,
                    entry.path,
                    isFolder,
                  )
              : undefined
          }
          onPointerMove={isDraggable ? handleTreePointerMove : undefined}
          onPointerUp={isDraggable ? handleTreePointerUp : undefined}
          onPointerCancel={isDraggable ? resetPointerDrag : undefined}
          onContextMenu={(event) => openContextMenu(event, entry, isRoot)}
        >
          <button
            className="treeItemPrimary"
            type="button"
            aria-pressed={!isFolder ? isSelectedFile : undefined}
            aria-expanded={
              isFolder && hasChildren
                ? isFolderExpanded
                : hasOutline
                  ? isOutlineExpanded
                  : undefined
            }
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            title={entry.path}
            onClick={(event) => handleTreeItemClick(event, entry, isFolder, hasOutline)}
          >
            <span
              className="treeChevron"
              data-tree-outline-disclosure={!isFolder && hasOutline ? "true" : undefined}
              title={!isFolder && hasOutline ? "見出しを展開・折りたたみ" : undefined}
            >
              {(hasChildren || hasOutline) && (
                <SidebarIcon
                  name={
                    isFolder
                      ? isFolderExpanded && hasChildren
                        ? "chevronDown"
                        : "chevronRight"
                      : isOutlineExpanded
                        ? "chevronDown"
                        : "chevronRight"
                  }
                  className="treeChevronIcon"
                />
              )}
            </span>
            <span
              className="treeDragHandle"
              title={isDraggable ? "ドラッグして並び替え" : undefined}
            >
              <SidebarIcon
                name={isFolder ? (isRoot ? "book" : "folder") : "file"}
                className="treeSvgIcon"
              />
            </span>
            <span className="treeItemName">{entry.name}</span>
            {charCountLabel && <span className="treeItemCharCount">{charCountLabel}</span>}
            {isActive && <span className="treeActiveDot" aria-hidden="true" />}
          </button>
          {!isFolder && (
            <FileProgressControl
              status={getFileProgress(fileProgress, entry.path)}
              onChange={(status) => onSetFileProgress(entry.path, status)}
              compact
            />
          )}
        </div>
        {isFolder && hasChildren && isFolderExpanded && (
          <div className="treeChildren">
            {entry.children.map((child) => renderEntry(child, depth + 1, entry.path))}
          </div>
        )}
        {!isFolder && hasOutline && isOutlineExpanded && (
          <div className="outlineTreeChildren">
            {renderOutlineItems(entry.path, outline, depth + 2)}
          </div>
        )}
        {!isFolder && astFile?.status === "pending" && (
          <div className="treeHint" style={{ paddingLeft: `${40 + depth * 14}px` }}>
            見出しを解析中
          </div>
        )}
        {!isFolder && astFile?.status === "error" && (
          <div className="treeHint treeHintError" style={{ paddingLeft: `${40 + depth * 14}px` }}>
            読み込み失敗
          </div>
        )}
      </div>
    );
  };

  const renderOutlineMode = () => (
    <section className="sidebarSection outlineExplorerSection" aria-label="アウトライン">
      <div className="tree outlineTree">
        {projectFolder ? (
          renderEntry(projectFolder, 0, null)
        ) : (
          <>
            <div className="sidebarEmptyState">
              <span>フォルダ未選択</span>
              <button type="button" onClick={onOpenProjectFolder}>
                フォルダを開く
              </button>
            </div>
            <div className="treeItem activeTreeItem scratchTreeItem">
              <button className="treeItemPrimary" type="button" title={currentFileName}>
                <span className="treeChevron" aria-hidden="true" />
                <SidebarIcon name="file" className="treeSvgIcon" />
                <span className="treeItemName">{currentFileName}</span>
                <span className="treeItemCharCount">{formatCharCount(currentFileCharCount)}</span>
                <span className="treeActiveDot" aria-hidden="true" />
              </button>
            </div>
            {activeDocumentOutline.length > 0 ? (
              <div className="outlineTreeChildren">
                {renderOutlineItems(null, activeDocumentOutline, 1)}
              </div>
            ) : (
              <div className="outlineEmptyState">見出しがありません</div>
            )}
          </>
        )}
      </div>
    </section>
  );

  const renderNavigatorMode = () => {
    if (!projectFolder) {
      return (
        <section className="sidebarSection navigatorSection" aria-label="ナビゲータ">
          <div className="sidebarEmptyState">
            <span>フォルダ未選択</span>
            <button type="button" onClick={onOpenProjectFolder}>
              フォルダを開く
            </button>
          </div>
        </section>
      );
    }

    const location =
      navigatorLocation ?? { kind: "folder" as const, path: projectFolder.path };

    // プレビュー行数（0 = なし）。行数に応じて取得文字数を増やし、
    // 視覚的なクランプは CSS の line-clamp で行う。
    const previewLines = navigatorPreviewLines;
    const showPreview = previewLines > 0;
    const previewMaxChars = Math.max(previewLines, 1) * 40;
    const previewStyle = {
      "--preview-lines": previewLines,
    } as CSSProperties;

    if (location.kind === "file") {
      const astFile = projectAstFiles.get(location.path) ?? null;
      const sourceLines = getFileSourceLines(astFile);
      const fileName = astFile?.name ?? location.path.split(/[\\/]/).pop() ?? location.path;
      const outline = astFile?.documentAst?.outline ?? [];
      const filePreview = showPreview
        ? buildFilePreview(sourceLines.join("\n"), previewMaxChars)
        : "";
      const parentPath = findParentPath(projectFolder, location.path);
      const status = getFileProgress(fileProgress, location.path);

      const flatHeadings: { item: DocumentOutlineItem; depth: number }[] = [];
      const flatten = (items: DocumentOutlineItem[], depth: number) => {
        for (const item of items) {
          flatHeadings.push({ item, depth });
          flatten(item.children, depth + 1);
        }
      };
      flatten(outline, 0);

      return (
        <section className="sidebarSection navigatorSection" aria-label="ナビゲータ">
          <div className="navigatorHeader">
            <button
              className="navigatorBackButton"
              type="button"
              title="フォルダへ戻る"
              onClick={() =>
                setNavigatorLocation({
                  kind: "folder",
                  path: parentPath ?? projectFolder.path,
                })
              }
            >
              <SidebarIcon name="chevronLeft" className="navigatorBackIcon" />
              <span>戻る</span>
            </button>
            <FileProgressControl
              status={status}
              onChange={(next) => onSetFileProgress(location.path, next)}
            />
          </div>
          <div className="navigatorFileDetailHeader">
            <button
              className={`navigatorCurrentFile ${
                location.path === currentFilePath ? "navigatorCurrentFileActive" : ""
              }`}
              type="button"
              title={location.path}
              onClick={() => onSelectFile(location.path)}
            >
              <SidebarIcon name="file" className="treeSvgIcon" />
              <span className="navigatorFileName">{fileName}</span>
            </button>
            {filePreview && (
              <p className="navigatorFilePreview" style={previewStyle}>
                {filePreview}
              </p>
            )}
          </div>
          <div className="navigatorHeadingList" aria-label={`${fileName}の見出し`}>
            {flatHeadings.length > 0 ? (
              flatHeadings.map(({ item, depth }) => {
                const isActive =
                  location.path === currentFilePath && activeOutlineIds.has(item.id);
                const preview = showPreview
                  ? buildHeadingPreview(sourceLines, item.line, previewMaxChars)
                  : "";
                return (
                  <button
                    key={item.id}
                    className={`navigatorHeadingItem ${
                      isActive ? "navigatorHeadingItemActive" : ""
                    }`}
                    type="button"
                    title={item.title}
                    style={{ paddingLeft: `${12 + depth * 12}px` }}
                    onClick={() => onJumpProjectOutline(location.path, item)}
                  >
                    <span className="navigatorHeadingTitleRow">
                      <span className="outlineLevelMark">H{item.level}</span>
                      <span className="navigatorHeadingTitle">{item.title}</span>
                    </span>
                    {preview && (
                      <span className="navigatorHeadingPreview" style={previewStyle}>
                        {preview}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="outlineEmptyState">見出しがありません</div>
            )}
          </div>
        </section>
      );
    }

    // フォルダ表示。
    const folderNode = findFolderNode(projectFolder, location.path);
    const children: ProjectEntry[] =
      folderNode && "children" in folderNode ? folderNode.children : [];
    const folders = children.filter((child) => child.kind === "folder");
    const files = children.filter((child) => child.kind === "file");
    const isRootFolder = location.path === projectFolder.path;
    const parentPath = isRootFolder ? null : findParentPath(projectFolder, location.path);
    const folderName = isRootFolder
      ? projectFolder.name
      : folderNode?.name ?? location.path.split(/[\\/]/).pop() ?? location.path;

    return (
      <section className="sidebarSection navigatorSection" aria-label="ナビゲータ">
        <div className="navigatorHeader">
          {!isRootFolder && (
            <button
              className="navigatorBackButton"
              type="button"
              title="親フォルダへ戻る"
              onClick={() =>
                setNavigatorLocation({
                  kind: "folder",
                  path: parentPath ?? projectFolder.path,
                })
              }
            >
              <SidebarIcon name="chevronLeft" className="navigatorBackIcon" />
              <span>戻る</span>
            </button>
          )}
          <span className="navigatorFolderTitle" title={location.path}>
            <SidebarIcon name={isRootFolder ? "book" : "folder"} className="treeSvgIcon" />
            <span>{folderName}</span>
          </span>
        </div>
        <div className="navigatorList">
          {folders.length === 0 && files.length === 0 && (
            <div className="outlineEmptyState">空のフォルダ</div>
          )}
          {folders.map((folder) => (
            <button
              key={folder.path}
              className="navigatorItem navigatorFolderItem"
              type="button"
              title={folder.path}
              onClick={() => setNavigatorLocation({ kind: "folder", path: folder.path })}
            >
              <SidebarIcon name="folder" className="treeSvgIcon" />
              <span className="navigatorItemName">{folder.name}</span>
              <SidebarIcon name="chevronRight" className="navigatorItemChevron" />
            </button>
          ))}
          {files.map((file) => {
            const astFile = projectAstFiles.get(file.path) ?? null;
            const preview = showPreview
              ? buildFilePreview(getFileSourceLines(astFile).join("\n"), previewMaxChars)
              : "";
            const status = getFileProgress(fileProgress, file.path);
            return (
              <div
                key={file.path}
                className={`navigatorItem navigatorFileItem ${
                  file.path === currentFilePath ? "navigatorFileItemActive" : ""
                }`}
              >
                <button
                  className="navigatorFileButton"
                  type="button"
                  title={file.path}
                  onClick={() => {
                    onSelectFile(file.path);
                    setNavigatorLocation({ kind: "file", path: file.path });
                  }}
                >
                  <span className="navigatorFileRow">
                    <SidebarIcon name="file" className="treeSvgIcon" />
                    <span className="navigatorItemName">{file.name}</span>
                  </span>
                  {preview && (
                    <span className="navigatorItemPreview" style={previewStyle}>
                      {preview}
                    </span>
                  )}
                </button>
                <FileProgressControl
                  status={status}
                  onChange={(next) => onSetFileProgress(file.path, next)}
                  compact
                />
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const emptyProjectSearchMessage = !projectFolder
    ? searchScope === "project"
      ? "フォルダ未選択"
      : "検索語句を入力"
    : !projectSearchQuery.trim()
      ? "検索語句を入力"
      : searchScope === "project" &&
          projectAst?.status === "indexing" &&
          !projectSearchResults.length
        ? "検索用の索引を作成中"
        : searchScope === "file"
          ? "ファイル内に一致がありません"
          : "プロジェクト内に一致がありません";

  const manualSnapshots = snapshots.filter((snapshot) => snapshot.reason === "manual");
  const shelterSnapshots = snapshots.filter(
    (snapshot) => snapshot.reason === "auto-before-restore",
  ).slice(0, 3);

  const renderSnapshotItem = (snapshot: ManuscriptSnapshot) => {
    const textLength = countWhitespace
      ? snapshot.totalTextLength
      : snapshot.totalVisibleTextLength;
    const isSnapshotMenuOpen = snapshotMenu?.id === snapshot.id;
    const closeSnapshotMenuAndRun = (action: () => void) => {
      setSnapshotMenu(null);
      action();
    };

    return (
      <article className="snapshotItem" key={snapshot.id}>
        <div
          className="snapshotItemBody"
          title={snapshot.memo ? `${snapshot.label}\n${snapshot.memo}` : snapshot.label}
        >
          <div className="snapshotItemTitleRow">
            <strong className="snapshotItemTitle">
              {snapshot.label}
            </strong>
            {snapshot.reason === "auto-before-restore" && (
              <span className="snapshotBadge">退避</span>
            )}
          </div>
        </div>
        <div className="snapshotItemMenuControl">
          <button
            className="snapshotMoreButton"
            type="button"
            title="チェックポイントメニュー"
            aria-label={`${snapshot.label}のメニュー`}
            aria-expanded={isSnapshotMenuOpen}
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation();
              const buttonRect = event.currentTarget.getBoundingClientRect();
              const shouldOpenAbove = window.innerHeight - buttonRect.bottom < 260;
              setSnapshotMenu((current) =>
                current?.id === snapshot.id
                  ? null
                  : {
                      id: snapshot.id,
                      placement: shouldOpenAbove ? "above" : "below",
                      x: buttonRect.right,
                      y: shouldOpenAbove ? buttonRect.top - 4 : buttonRect.bottom + 4,
                    },
              );
            }}
          >
            ･･･
          </button>
          {isSnapshotMenuOpen && (
            <div
              className="snapshotMenu"
              data-placement={snapshotMenu.placement}
              style={{ left: snapshotMenu.x, top: snapshotMenu.y }}
              role="menu"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="snapshotMenuInfo" role="group" aria-label="チェックポイント情報">
                <div>
                  <span>作成日時</span>
                  <strong>{formatSnapshotDate(snapshot.createdAt)}</strong>
                </div>
                <div>
                  <span>規模</span>
                  <strong>
                    {snapshot.fileCount} 原稿 / {formatCharCount(textLength)}
                  </strong>
                </div>
                <div>
                  <span>メモ</span>
                  <strong>{snapshot.memo || "なし"}</strong>
                </div>
              </div>
              <div className="snapshotMenuDivider" role="presentation" />
              {snapshot.reason === "manual" && <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => closeSnapshotMenuAndRun(() => onRenameSnapshot(snapshot))}
                >
                  タイトルを編集
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => closeSnapshotMenuAndRun(() => onEditSnapshotMemo(snapshot))}
                >
                  メモを編集
                </button>
              </>}
              <button
                type="button"
                role="menuitem"
                onClick={() => closeSnapshotMenuAndRun(() => onRestoreSnapshot(snapshot))}
              >
                復元
              </button>
              {snapshot.reason === "manual" && <button
                className="snapshotMenuDanger"
                type="button"
                role="menuitem"
                onClick={() => closeSnapshotMenuAndRun(() => onDeleteSnapshot(snapshot))}
              >
                削除
              </button>}
            </div>
          )}
        </div>
      </article>
    );
  };

  const renderProjectSearchMode = () => (
    <section className="sidebarSection projectSearchModeSection" aria-label="検索と置換">
      <div className="sidebarSectionHeader">
        <span>検索と置換</span>
        <span>{getProjectAstStatusLabel(projectAst)}</span>
      </div>
      <label className="sidebarSearch">
        <span className="searchFieldLabel">検索語句</span>
        <SidebarIcon name="search" className="searchSvgIcon" />
        <input
          value={projectSearchQuery}
          onChange={(event) => onProjectSearchQueryChange(event.target.value)}
          placeholder="検索する文字列"
          type="search"
        />
      </label>
      <div className="projectSearchModes" role="group" aria-label="検索範囲">
        <button
          className={searchScope === "file" ? "activeProjectSearchMode" : ""}
          type="button"
          aria-pressed={searchScope === "file"}
          onClick={() => onSearchScopeChange("file")}
        >
          このファイルを検索
        </button>
        <button
          className={searchScope === "project" ? "activeProjectSearchMode" : ""}
          type="button"
          aria-pressed={searchScope === "project"}
          onClick={() => onSearchScopeChange("project")}
        >
          プロジェクトで検索
        </button>
      </div>
      <div className="projectReplaceDisclosure">
        <button
          className="projectReplaceToggle"
          type="button"
          aria-expanded={isReplaceExpanded}
          onClick={() => setIsReplaceExpanded((current) => !current)}
        >
          <span>{isReplaceExpanded ? "置換を隠す" : "置換を表示"}</span>
          <SidebarIcon
            name={isReplaceExpanded ? "chevronDown" : "chevronRight"}
            className="projectReplaceToggleIcon"
          />
        </button>
        {isReplaceExpanded && (
          <div className="projectReplacePanel">
            <label>
              <span>置換後</span>
              <input
                value={projectReplaceValue}
                onChange={(event) => onProjectReplaceValueChange(event.target.value)}
                placeholder="置換する文字列"
              />
            </label>
            <div className="projectReplaceActions">
              <button
                type="button"
                disabled={isProjectReplacing || !projectSearchQuery.trim()}
                onClick={onReplaceInCurrentFile}
              >
                ファイル内で置換
              </button>
              <button
                type="button"
                disabled={isProjectReplacing || !projectFolder || !projectSearchQuery.trim()}
                onClick={onReplaceInProject}
              >
                プロジェクト全置換
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="projectSearchList">
        {projectSearchResults.length ? (
          projectSearchResults.map((result) => (
            <button
              className="projectSearchResultItem"
              key={result.id}
              type="button"
              title={result.path}
              onClick={() => onOpenProjectSearchResult(result)}
            >
              <span className="projectSearchResultMeta">
                <span>{result.name}</span>
                <span>{result.line}行:{result.column}</span>
              </span>
              <span className="projectSearchResultTitle">
                {result.title ?? result.name}
              </span>
              <span className="projectSearchResultExcerpt">{result.excerpt}</span>
            </button>
          ))
        ) : (
          <div className="outlineEmptyState">{emptyProjectSearchMessage}</div>
        )}
      </div>
    </section>
  );

  const renderSnapshotSection = () => (
    <section className="sidebarSection snapshotSection" aria-label="スナップショット">
      <div className="snapshotSectionHeader">
        <button
          className="snapshotSectionToggle"
          type="button"
          aria-expanded={!isSnapshotSectionCollapsed}
          onClick={() => onSnapshotSectionCollapsedChange(!isSnapshotSectionCollapsed)}
        >
          <SidebarIcon
            name={isSnapshotSectionCollapsed ? "chevronRight" : "chevronDown"}
            className="treeChevronIcon"
          />
          <span>チェックポイント</span>
        </button>
        <button
          className="snapshotCreateButton"
          type="button"
          aria-label="保存点を作成"
          title="保存点を作成"
          disabled={!projectFolder}
          onClick={onCreateSnapshot}
        >
          <SidebarIcon name="plus" className="sidebarButtonSvg" />
        </button>
      </div>
      {!isSnapshotSectionCollapsed && (
        <div className="snapshotList">
          {projectFolder ? (
            manualSnapshots.length > 0 || shelterSnapshots.length > 0 ? (
              <>
                {manualSnapshots.length > 0 ? (
                  manualSnapshots.map(renderSnapshotItem)
                ) : (
                  <div className="snapshotEmptyState">手動チェックポイントはまだありません</div>
                )}
                {shelterSnapshots.length > 0 && (
                  <div className="shelterSnapshotGroup">
                    <button
                      className="shelterSnapshotToggle"
                      type="button"
                      aria-expanded={isShelterListExpanded}
                      onClick={() => setIsShelterListExpanded((current) => !current)}
                    >
                      <SidebarIcon
                        name={isShelterListExpanded ? "chevronDown" : "chevronRight"}
                        className="treeChevronIcon"
                      />
                      <span>復元前の退避</span>
                      <span>{shelterSnapshots.length}件</span>
                    </button>
                    {isShelterListExpanded && (
                      <div className="shelterSnapshotList">
                        {shelterSnapshots.map(renderSnapshotItem)}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="snapshotEmptyState">チェックポイントはまだありません</div>
            )
          ) : (
            <div className="snapshotEmptyState">フォルダを開くと保存点を作成できます</div>
          )}
        </div>
      )}
    </section>
  );

  return (
    <aside className="workspaceSidebar" aria-label="アウトライン">
      <div className="sidebarHeader">
        <span className="sidebarHeaderLabel">
          {isProjectSearchMode ? "Search" : "Outline"}
        </span>
        <div className="sidebarHeaderActions">
          <button
            className="sidebarIconButton"
            type="button"
            aria-label="左サイドバーを畳む"
            title="左サイドバーを畳む"
            onClick={onCollapse}
          >
            <SidebarIcon name="chevronLeft" className="sidebarButtonSvg" />
          </button>
        </div>
      </div>

      <div
        className={`sidebarScroll ${
          isProjectSearchMode ? "projectSearchSidebarScroll" : ""
        }`}
      >
        {isProjectSearchMode ? (
          renderProjectSearchMode()
        ) : (
          sidebarMode === "navigator" ? renderNavigatorMode() : renderOutlineMode()
        )}
      </div>

      {renderContextMenu()}
      {renderHeadingContextMenu()}
    </aside>
  );
}
