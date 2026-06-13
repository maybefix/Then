import type {
  FlatOutlineItem,
  OutlineItem,
  ProjectEntry,
  ProjectFolder,
} from "../../types";

type WorkspaceSidebarProps = {
  projectFolder: ProjectFolder | null;
  currentFilePath: string | null;
  currentFileName: string;
  focusedFolderPath: string | null;
  outlineItems: FlatOutlineItem[];
  outlineCount: number;
  outlineQuery: string;
  activeOutlineIds: ReadonlySet<string>;
  onOutlineQueryChange: (value: string) => void;
  onJumpOutline: (item: OutlineItem) => void;
  onOpenProjectFolder: () => void;
  onNewDocument: () => void;
  onCreateFile: (folderPath?: string) => void;
  onCreateFolder: (folderPath?: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onOpenFileInNewTab: (path: string) => void;
  onRenameEntry: (entry: ProjectFolder | ProjectEntry) => void;
  onDeleteEntry: (entry: ProjectEntry) => void;
  onCollapse: () => void;
};

function isProjectEntry(entry: ProjectFolder | ProjectEntry): entry is ProjectEntry {
  return "kind" in entry;
}

function getEntryKind(entry: ProjectFolder | ProjectEntry): ProjectEntry["kind"] | "folder" {
  return isProjectEntry(entry) ? entry.kind : "folder";
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
  outlineItems,
  outlineCount,
  outlineQuery,
  activeOutlineIds,
  onOutlineQueryChange,
  onJumpOutline,
  onOpenProjectFolder,
  onNewDocument,
  onCreateFile,
  onCreateFolder,
  onSelectFile,
  onSelectFolder,
  onOpenFileInNewTab,
  onRenameEntry,
  onDeleteEntry,
  onCollapse,
}: WorkspaceSidebarProps) {
  const renderEntry = (
    entry: ProjectFolder | ProjectEntry,
    depth: number,
  ): JSX.Element => {
    const kind = getEntryKind(entry);
    const isRoot = !isProjectEntry(entry);
    const isFolder = kind === "folder";
    const hasChildren = isFolder && entry.children.length > 0;
    const isActive = entry.path === currentFilePath;
    const isFocused = entry.path === focusedFolderPath;
    const rowClass = [
      "treeItem",
      isActive ? "activeTreeItem" : "",
      isFocused && !isActive ? "focusedTreeItem" : "",
      isFolder ? "folderTreeItem" : "fileTreeItem",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="treeNode" key={entry.path}>
        <div className={rowClass}>
          <button
            className="treeItemPrimary"
            type="button"
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            title={entry.path}
            onClick={() =>
              isFolder ? onSelectFolder(entry.path) : onSelectFile(entry.path)
            }
          >
            <span className="treeChevron">
              {isFolder && (
                <SidebarIcon
                  name={hasChildren ? "chevronDown" : "chevronRight"}
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
          <div className="treeItemTools" aria-label={`${entry.name} の操作`}>
            {isFolder ? (
              <>
                <button
                  type="button"
                  aria-label={`${entry.name} にファイルを追加`}
                  title="ファイルを追加"
                  onClick={() => onCreateFile(entry.path)}
                >
                  <SidebarIcon name="plus" className="toolSvgIcon" />
                </button>
                <button
                  type="button"
                  aria-label={`${entry.name} にフォルダを追加`}
                  title="フォルダを追加"
                  onClick={() => onCreateFolder(entry.path)}
                >
                  <SidebarIcon name="folderPlus" className="toolSvgIcon" />
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={`${entry.name} を新しいタブで開く`}
                title="新しいタブで開く"
                onClick={() => onOpenFileInNewTab(entry.path)}
              >
                <SidebarIcon name="external" className="toolSvgIcon" />
              </button>
            )}
            {!isRoot && (
              <>
                <button
                  type="button"
                  aria-label={`${entry.name} をリネーム`}
                  title="リネーム"
                  onClick={() => onRenameEntry(entry)}
                >
                  <SidebarIcon name="edit" className="toolSvgIcon" />
                </button>
                {isProjectEntry(entry) && (
                  <button
                    type="button"
                    aria-label={`${entry.name} を削除`}
                    title="削除"
                    onClick={() => onDeleteEntry(entry)}
                  >
                    <SidebarIcon name="trash" className="toolSvgIcon" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {hasChildren && (
          <div className="treeChildren">
            {entry.children.map((child) => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const emptyOutlineMessage = outlineQuery.trim()
    ? "一致する見出しがありません"
    : "見出しがありません";

  return (
    <aside className="workspaceSidebar" aria-label="ファイル構造とアウトライン">
      <div className="sidebarHeader">
        <span className="sidebarHeaderLabel">構成</span>
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
        <section className="sidebarSection" aria-label="ファイル">
          <div className="sidebarSectionHeader">
            <span>ファイル</span>
            {projectFolder && <span>{projectFolder.children.length}</span>}
          </div>
          <div className="tree">
            {projectFolder ? (
              renderEntry(projectFolder, 0)
            ) : (
              <div className="sidebarEmptyState">
                <span>フォルダ未選択</span>
                <button type="button" onClick={onOpenProjectFolder}>
                  フォルダを開く
                </button>
              </div>
            )}
            {!projectFolder && (
              <div className="treeItem activeTreeItem scratchTreeItem">
                <button className="treeItemPrimary" type="button" title={currentFileName}>
                  <span className="treeChevron" aria-hidden="true" />
                  <SidebarIcon name="file" className="treeSvgIcon" />
                  <span className="treeItemName">{currentFileName}</span>
                  <span className="treeActiveDot" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="sidebarSection outlineSidebarSection" aria-label="アウトライン">
          <div className="sidebarSectionHeader">
            <span>アウトライン</span>
            <span>{outlineCount}</span>
          </div>
          <label className="sidebarSearch">
            <SidebarIcon name="search" className="searchSvgIcon" />
            <input
              value={outlineQuery}
              onChange={(event) => onOutlineQueryChange(event.target.value)}
              placeholder="見出しを検索"
              type="search"
            />
          </label>
          <div className="outlineSidebarList">
            {outlineItems.length ? (
              outlineItems.map((item) => (
                <button
                  className={`outlineSidebarItem ${
                    activeOutlineIds.has(item.id) ? "activeOutlineSidebarItem" : ""
                  }`}
                  key={item.id}
                  style={{ paddingLeft: `${10 + (item.level - 1) * 14}px` }}
                  type="button"
                  onClick={() => onJumpOutline(item)}
                  title={item.title}
                >
                  <span className="outlineLevelMark">H{item.level}</span>
                  <span>{item.title}</span>
                </button>
              ))
            ) : (
              <div className="outlineEmptyState">{emptyOutlineMessage}</div>
            )}
          </div>
        </section>
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
    </aside>
  );
}
