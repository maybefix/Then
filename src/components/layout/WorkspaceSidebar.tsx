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
  BreadcrumbDropTarget,
  FileProgressStatus,
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
  fileProgress: Record<string, FileProgressStatus>;
  onSetFileProgress: (path: string, status: FileProgressStatus) => void;
  projectSearchQuery: string;
  projectSearchResults: ProjectSearchResult[];
  searchScope: WorkspaceSearchScope;
  projectReplaceValue: string;
  isProjectReplacing: boolean;
  isProjectSearchMode: boolean;
  onProjectSearchModeChange: (value: boolean) => void;
  onProjectSearchQueryChange: (value: string) => void;
  onSearchScopeChange: (value: WorkspaceSearchScope) => void;
  onProjectReplaceValueChange: (value: string) => void;
  onOpenProjectSearchResult: (result: ProjectSearchResult) => void;
  onReplaceInCurrentFile: () => void;
  onReplaceInProject: () => void;
  onJumpOutline: (item: OutlineItem) => void;
  onJumpProjectOutline: (path: string, item: DocumentOutlineItem) => void;
  onMoveHeading: (
    sourcePath: string,
    sourceLine: number,
    sourceBlockId: string,
    targetPath: string,
    targetLine: number | null,
    targetBlockId: string | null,
    position: "before" | "after" | "append",
  ) => void;
  onOpenProjectFolder: () => void;
  onNewDocument: () => void;
  onCreateFile: (folderPath?: string) => void;
  onCreateFolder: (folderPath?: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onOpenFileInNewTab: (path: string) => void;
  onRenameEntry: (entry: ProjectFolder | ProjectEntry) => void;
  onDeleteEntry: (entry: ProjectEntry) => void;
  onReorderEntry: (
    folderPath: string,
    draggedPath: string,
    targetPath: string,
    position: "before" | "after",
  ) => void;
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
  folderPath: string;
  entryPath: string;
  startX: number;
  startY: number;
  isDragging: boolean;
};

type HeadingDragState = {
  sourcePath: string;
  sourceLine: number;
  sourceBlockId: string;
};

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
  | "edit"
  | "external"
  | "file"
  | "folder"
  | "folderPlus"
  | "plus"
  | "search"
  | "trash";

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
    case "edit":
      return (
        <svg {...common}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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
    case "trash":
      return (
        <svg {...common}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6 18 20H6L5 6" />
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
  fileProgress,
  onSetFileProgress,
  projectSearchQuery,
  projectSearchResults,
  searchScope,
  projectReplaceValue,
  isProjectReplacing,
  isProjectSearchMode,
  onProjectSearchModeChange,
  onProjectSearchQueryChange,
  onSearchScopeChange,
  onProjectReplaceValueChange,
  onOpenProjectSearchResult,
  onReplaceInCurrentFile,
  onReplaceInProject,
  onJumpOutline,
  onJumpProjectOutline,
  onMoveHeading,
  onOpenProjectFolder,
  onNewDocument,
  onCreateFile,
  onCreateFolder,
  onSelectFile,
  onSelectFolder,
  onOpenFileInNewTab,
  onRenameEntry,
  onDeleteEntry,
  onReorderEntry,
  onCollapse,
}: WorkspaceSidebarProps) {
  const [contextMenu, setContextMenu] = useState<TreeContextMenu>(null);
  const [draggingEntryPath, setDraggingEntryPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<BreadcrumbDropTarget>(null);
  const [draggingHeading, setDraggingHeading] = useState<{
    path: string;
    line: number;
  } | null>(null);
  const [headingDropTarget, setHeadingDropTarget] = useState<HeadingDropTarget>(null);
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedOutlinePaths, setCollapsedOutlinePaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isReplaceExpanded, setIsReplaceExpanded] = useState(false);
  const [navigatorLocation, setNavigatorLocation] = useState<
    { kind: "folder" | "file"; path: string } | null
  >(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const headingDragRef = useRef<HeadingDragState | null>(null);
  const lastHeadingDragOverRef = useRef("");
  const dropTargetRef = useRef<BreadcrumbDropTarget>(null);
  const suppressNextClickRef = useRef(false);
  const projectAstFiles = new Map(
    projectAst?.files.map((file) => [file.path, file] as const) ?? [],
  );

  useEffect(() => {
    if (!contextMenu) return undefined;

    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // プロジェクトフォルダが切り替わったらナビゲータをルートに戻す。
  useEffect(() => {
    setNavigatorLocation(null);
  }, [projectFolder?.path]);

  const resetPointerDrag = () => {
    pointerDragRef.current = null;
    setDraggingEntryPath(null);
    dropTargetRef.current = null;
    setDropTarget(null);
  };

  const updateDropTarget = (nextDropTarget: BreadcrumbDropTarget) => {
    dropTargetRef.current = nextDropTarget;
    setDropTarget(nextDropTarget);
  };

  const updateDropTargetFromPoint = (
    clientX: number,
    clientY: number,
    dragState: PointerDragState,
  ) => {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>("[data-tree-entry-path][data-tree-folder-path]");
    if (!row) {
      updateDropTarget(null);
      return;
    }

    const targetFolderPath = row.dataset.treeFolderPath;
    const targetEntryPath = row.dataset.treeEntryPath;
    if (
      !targetFolderPath ||
      !targetEntryPath ||
      targetFolderPath !== dragState.folderPath ||
      targetEntryPath === dragState.entryPath
    ) {
      updateDropTarget(null);
      return;
    }

    const rect = row.getBoundingClientRect();
    updateDropTarget({
      folderPath: targetFolderPath,
      entryPath: targetEntryPath,
      position: clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };

  const handleTreePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    folderPath: string | null,
    entryPath: string,
  ) => {
    if (!folderPath || event.button !== 0) return;

    pointerDragRef.current = {
      pointerId: event.pointerId,
      folderPath,
      entryPath,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };
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
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDraggingEntryPath(dragState.entryPath);
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
      if (activeDropTarget) {
        onReorderEntry(
          activeDropTarget.folderPath,
          dragState.entryPath,
          activeDropTarget.entryPath,
          activeDropTarget.position,
        );
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
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
      setCollapsedFolderPaths((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      });
      return;
    }
    if (
      hasOutline &&
      (event.target as HTMLElement).closest("[data-tree-outline-disclosure]")
    ) {
      setCollapsedOutlinePaths((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      });
      return;
    }
    onSelectFile(entry.path);
  };

  const resetHeadingDrag = () => {
    headingDragRef.current = null;
    lastHeadingDragOverRef.current = "";
    setDraggingHeading(null);
    setHeadingDropTarget(null);
  };

  const handleHeadingDragStart = (
    event: ReactDragEvent<HTMLButtonElement>,
    sourcePath: string,
    sourceLine: number,
    sourceBlockId: string,
  ) => {
    headingDragRef.current = { sourcePath, sourceLine, sourceBlockId };
    setDraggingHeading({ path: sourcePath, line: sourceLine });
    setHeadingDropTarget(null);
    suppressNextClickRef.current = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      HEADING_DRAG_MIME,
      JSON.stringify({ sourcePath, sourceLine, sourceBlockId }),
    );
    logHeadingDnd("dragstart", {
      sourcePath,
      sourceLine,
      sourceBlockId,
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
        sourceBlockId: headingDragRef.current.sourceBlockId,
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
      sourceBlockId: source.sourceBlockId,
      targetPath,
      targetLine,
      targetBlockId,
      position,
    });
    onMoveHeading(
      source.sourcePath,
      source.sourceLine,
      source.sourceBlockId,
      targetPath,
      targetLine,
      targetBlockId,
      position,
    );
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
        sourceBlockId: headingDragRef.current.sourceBlockId,
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
      sourceBlockId: source.sourceBlockId,
      targetPath,
      targetLine: null,
      targetBlockId: null,
      position: "append",
    });
    onMoveHeading(
      source.sourcePath,
      source.sourceLine,
      source.sourceBlockId,
      targetPath,
      null,
      null,
      "append",
    );
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
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry,
      isRoot,
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
        {kind === "file" && (
          <button
            type="button"
            role="menuitem"
            onClick={() => closeContextMenuAndRun(() => onOpenFileInNewTab(entry.path))}
          >
            新しいタブで開く
          </button>
        )}
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

  const renderOutlineItems = (
    filePath: string | null,
    items: DocumentOutlineItem[] | OutlineItem[],
    depth: number,
  ): JSX.Element[] => {
    return items.map((item) => {
      const isActive = filePath === currentFilePath && activeOutlineIds.has(item.id);
      const isDragging =
        filePath !== null &&
        draggingHeading?.path === filePath &&
        draggingHeading.line === item.line;
      const targetPosition =
        filePath !== null &&
        headingDropTarget?.kind === "heading" &&
        headingDropTarget.path === filePath &&
        headingDropTarget.line === item.line
          ? headingDropTarget.position
          : null;
      return (
        <div className="outlineTreeNode" key={`${filePath ?? "scratch"}:${item.id}`}>
          <button
            className={[
              "outlineTreeItem",
              isActive ? "activeOutlineTreeItem" : "",
              isDragging ? "draggingHeadingItem" : "",
              targetPosition ? `headingDrop-${targetPosition}` : "",
            ].filter(Boolean).join(" ")}
            data-outline-file-path={filePath ?? undefined}
            data-outline-heading-line={filePath ? item.line : undefined}
            data-outline-block-id={filePath ? item.blockId : undefined}
            draggable={Boolean(filePath)}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            type="button"
            title={item.title}
            onClick={(event) => {
              if (suppressNextClickRef.current) {
                event.preventDefault();
                return;
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
              filePath
                ? (event) =>
                    handleHeadingDragStart(event, filePath, item.line, item.blockId)
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
          >
            <span className="outlineLevelMark">H{item.level}</span>
            <span>{item.title}</span>
          </button>
          {item.children.length > 0 && (
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
    const isDraggable = Boolean(parentFolderPath && isProjectEntry(entry));
    const dropClass =
      dropTarget?.entryPath === entry.path ? `treeDrop-${dropTarget.position}` : "";
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
      draggingEntryPath === entry.path ? "draggingTreeEntry" : "",
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
      !isFolder && astFile?.status === "indexed" ? formatCharCount(astFile.textLength) : null;

    return (
      <div className="treeNode" key={entry.path}>
        <div
          className={rowClass}
          data-tree-entry-path={isDraggable ? entry.path : undefined}
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
              ? (event) => handleTreePointerDown(event, parentFolderPath, entry.path)
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
          <div className="navigatorHeadingList">
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
          ファイル内を検索
        </button>
        <button
          className={searchScope === "project" ? "activeProjectSearchMode" : ""}
          type="button"
          aria-pressed={searchScope === "project"}
          onClick={() => onSearchScopeChange("project")}
        >
          プロジェクト内を検索
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
                ファイル内を置換
              </button>
              <button
                type="button"
                disabled={isProjectReplacing || !projectFolder || !projectSearchQuery.trim()}
                onClick={onReplaceInProject}
              >
                プロジェクト内を置換
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

  return (
    <aside className="workspaceSidebar" aria-label="アウトライン">
      <div className="sidebarHeader">
        <span className="sidebarHeaderLabel">Outline</span>
        <div className="sidebarHeaderActions">
          <button
            className="sidebarIconButton"
            type="button"
            aria-label="新規ファイル"
            title="新規ファイル"
            onClick={onNewDocument}
          >
            <SidebarIcon name="plus" className="sidebarButtonSvg" />
          </button>
          <button
            className="sidebarIconButton"
            type="button"
            aria-label="新規フォルダ"
            title="新規フォルダ"
            onClick={() =>
              projectFolder
                ? onCreateFolder(focusedFolderPath ?? projectFolder.path)
                : onOpenProjectFolder()
            }
          >
            <SidebarIcon name="folderPlus" className="sidebarButtonSvg" />
          </button>
          <button
            className="sidebarIconButton"
            type="button"
            aria-label="フォルダを開く"
            title="フォルダを開く"
            onClick={onOpenProjectFolder}
          >
            <SidebarIcon name="folder" className="sidebarButtonSvg" />
          </button>
          <button
            className={`sidebarIconButton ${
              isProjectSearchMode ? "activeSidebarIconButton" : ""
            }`}
            type="button"
            aria-label="プロジェクト検索"
            title="プロジェクト検索"
            aria-pressed={isProjectSearchMode}
            onClick={() => onProjectSearchModeChange(!isProjectSearchMode)}
          >
            <SidebarIcon name="search" className="sidebarButtonSvg" />
          </button>
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

      <div className="sidebarScroll">
        {isProjectSearchMode
          ? renderProjectSearchMode()
          : sidebarMode === "navigator"
            ? renderNavigatorMode()
            : renderOutlineMode()}
      </div>

      <div className="sidebarFooter">
        <div className="sidebarFooterActions">
          <button className="sidebarAddButton" type="button" onClick={onNewDocument}>
            <SidebarIcon name="plus" className="sidebarButtonSvg" />
            <span>シートを追加</span>
          </button>
          <button
            className="sidebarAddButton"
            type="button"
            onClick={() =>
              projectFolder
                ? onCreateFolder(focusedFolderPath ?? projectFolder.path)
                : onOpenProjectFolder()
            }
          >
            <SidebarIcon name="folderPlus" className="sidebarButtonSvg" />
            <span>フォルダを追加</span>
          </button>
        </div>
      </div>
      {renderContextMenu()}
    </aside>
  );
}
