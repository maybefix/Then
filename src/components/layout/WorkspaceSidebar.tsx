import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  DocumentOutlineItem,
  ProjectAst,
  ProjectSearchResult,
} from "../../editor/ast/types";
import type {
  BreadcrumbDropTarget,
  OutlineItem,
  ProjectEntry,
  ProjectFolder,
} from "../../types";

type WorkspaceSidebarProps = {
  projectFolder: ProjectFolder | null;
  currentFilePath: string | null;
  currentFileName: string;
  focusedFolderPath: string | null;
  activeDocumentOutline: OutlineItem[];
  activeOutlineIds: ReadonlySet<string>;
  projectAst: ProjectAst | null;
  projectSearchQuery: string;
  projectSearchResults: ProjectSearchResult[];
  isProjectSearchMode: boolean;
  onProjectSearchModeChange: (value: boolean) => void;
  onProjectSearchQueryChange: (value: string) => void;
  onOpenProjectSearchResult: (result: ProjectSearchResult) => void;
  onJumpOutline: (item: OutlineItem) => void;
  onJumpProjectOutline: (path: string, item: DocumentOutlineItem) => void;
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
  focusedFolderPath,
  activeDocumentOutline,
  activeOutlineIds,
  projectAst,
  projectSearchQuery,
  projectSearchResults,
  isProjectSearchMode,
  onProjectSearchModeChange,
  onProjectSearchQueryChange,
  onOpenProjectSearchResult,
  onJumpOutline,
  onJumpProjectOutline,
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
  const pointerDragRef = useRef<PointerDragState | null>(null);
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
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleTreePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = pointerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );
    if (!dragState.isDragging && distance < 4) return;

    dragState.isDragging = true;
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
  ) => {
    if (suppressNextClickRef.current) {
      event.preventDefault();
      return;
    }
    isFolder ? onSelectFolder(entry.path) : onSelectFile(entry.path);
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
      return (
        <div className="outlineTreeNode" key={`${filePath ?? "scratch"}:${item.id}`}>
          <button
            className={`outlineTreeItem ${isActive ? "activeOutlineTreeItem" : ""}`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            type="button"
            title={item.title}
            onClick={() =>
              filePath ? onJumpProjectOutline(filePath, item) : onJumpOutline(item)
            }
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
    const isActive = entry.path === currentFilePath;
    const isFocused = entry.path === focusedFolderPath;
    const isDraggable = Boolean(parentFolderPath && isProjectEntry(entry));
    const dropClass =
      dropTarget?.entryPath === entry.path ? `treeDrop-${dropTarget.position}` : "";
    const rowClass = [
      "treeItem",
      dropClass,
      draggingEntryPath === entry.path ? "draggingTreeEntry" : "",
      isActive ? "activeTreeItem" : "",
      isFocused && !isActive ? "focusedTreeItem" : "",
      isFolder ? "folderTreeItem" : "fileTreeItem",
    ]
      .filter(Boolean)
      .join(" ");
    const astFile = !isFolder ? projectAstFiles.get(entry.path) : null;
    const outline = astFile?.documentAst?.outline ?? [];

    return (
      <div className="treeNode" key={entry.path}>
        <div
          className={rowClass}
          data-tree-entry-path={isDraggable ? entry.path : undefined}
          data-tree-folder-path={parentFolderPath ?? undefined}
          onContextMenu={(event) => openContextMenu(event, entry, isRoot)}
          onPointerDown={(event) => handleTreePointerDown(event, parentFolderPath, entry.path)}
          onPointerMove={handleTreePointerMove}
          onPointerUp={handleTreePointerUp}
          onPointerCancel={resetPointerDrag}
        >
          <button
            className="treeItemPrimary"
            type="button"
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            title={entry.path}
            onClick={(event) => handleTreeItemClick(event, entry, isFolder)}
          >
            <span className="treeChevron">
              {(isFolder || outline.length > 0) && (
                <SidebarIcon
                  name={hasChildren || outline.length > 0 ? "chevronDown" : "chevronRight"}
                  className="treeChevronIcon"
                />
              )}
            </span>
            <SidebarIcon
              name={isFolder ? (isRoot ? "book" : "folder") : "file"}
              className="treeSvgIcon"
            />
            <span className="treeItemName">{entry.name}</span>
            {isActive && <span className="treeActiveDot" aria-hidden="true" />}
          </button>
        </div>
        {isFolder && hasChildren && (
          <div className="treeChildren">
            {entry.children.map((child) => renderEntry(child, depth + 1, entry.path))}
          </div>
        )}
        {!isFolder && outline.length > 0 && (
          <div className="outlineTreeChildren">
            {renderOutlineItems(entry.path, outline, depth + 1)}
          </div>
        )}
        {!isFolder && astFile?.status === "pending" && (
          <div className="treeHint" style={{ paddingLeft: `${40 + depth * 14}px` }}>
            AST構築中
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

  const emptyProjectSearchMessage = !projectFolder
    ? "フォルダ未選択"
    : !projectSearchQuery.trim()
      ? "語句を入力"
      : projectAst?.status === "indexing" && !projectSearchResults.length
        ? "AST構築中"
        : "一致する本文がありません";

  const renderProjectSearchMode = () => (
    <section className="sidebarSection projectSearchModeSection" aria-label="プロジェクト検索">
      <div className="sidebarSectionHeader">
        <span>プロジェクト検索</span>
        <span>{getProjectAstStatusLabel(projectAst)}</span>
      </div>
      <label className="sidebarSearch">
        <SidebarIcon name="search" className="searchSvgIcon" />
        <input
          value={projectSearchQuery}
          onChange={(event) => onProjectSearchQueryChange(event.target.value)}
          placeholder="プロジェクトを検索"
          type="search"
        />
      </label>
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
                <span>{result.line}行</span>
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
        {isProjectSearchMode ? renderProjectSearchMode() : renderOutlineMode()}
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
