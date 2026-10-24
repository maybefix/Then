import { Fragment, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type SetStateAction } from "react";
import type { DocumentOutlineItem } from "../../editor/ast/types";
import type { createProjectEntryActions } from "../../projectEntryActions";
import type {
  BreadcrumbDropTarget,
  EditorSettings,
  FlatOutlineItem,
  LibraryContext,
  OutlineItem,
  ProjectEntry,
  ProjectFolder,
  WorkspaceRecord,
} from "../../types";
import {
  isBreadcrumbTrailItemVisible,
  isOutlineBreadcrumbItemVisible,
  type BreadcrumbLayout,
} from "../../utils/breadcrumbLayout";
import {
  getBreadcrumbFolderNavigation,
  getVisibleWorkspaceFolderTreeRows,
  isSamePath,
  scopeDisplayName,
} from "../../utils/projectTree";
import { AppIcon, type AppIconName } from "./AppIcon";

type BreadcrumbOverflowItem =
  | { kind: "folder" | "file"; name: string; path: string }
  | { kind: "outline"; item: DocumentOutlineItem }
  | { kind: "scratch"; name: string };

type ProjectEntryActions = ReturnType<typeof createProjectEntryActions>;

export type TopbarBreadcrumbsProps = {
  breadcrumbLayout: BreadcrumbLayout;
  breadcrumbMenuRef: RefObject<HTMLDivElement>;
  handleBreadcrumbKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  breadcrumbOverflowItems: BreadcrumbOverflowItem[];
  libraryContext: LibraryContext | null;
  enterLibraryRoot: () => void;
  projectFolder: ProjectFolder | null;
  breadcrumbTrail: Array<ProjectFolder | ProjectEntry>;
  activeBreadcrumbPath: string | null;
  breadcrumbBrowsePath: string | null;
  hasActiveOutlineBreadcrumb: boolean;
  isWorkspaceSwitcherOpen: boolean;
  setActiveBreadcrumbPath: Dispatch<SetStateAction<string | null>>;
  setBreadcrumbBrowsePath: Dispatch<SetStateAction<string | null>>;
  setIsWorkspaceSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  settings: EditorSettings;
  workspaceSwitcherQuery: string;
  setWorkspaceSwitcherQuery: Dispatch<SetStateAction<string>>;
  visibleRecentWorkspaces: WorkspaceRecord[];
  closeBreadcrumbMenuAndRun: (action: () => void | Promise<void>) => void;
  openWorkspace: (path?: string) => Promise<boolean>;
  breadcrumbDropTarget: BreadcrumbDropTarget;
  draggingBreadcrumbEntryPath: string | null;
  handleBreadcrumbEntryDragStart: ProjectEntryActions["handleBreadcrumbEntryDragStart"];
  handleBreadcrumbEntryDragOver: ProjectEntryActions["handleBreadcrumbEntryDragOver"];
  handleBreadcrumbEntryDrop: ProjectEntryActions["handleBreadcrumbEntryDrop"];
  handleBreadcrumbEntryDragEnd: ProjectEntryActions["handleBreadcrumbEntryDragEnd"];
  currentFilePath: string | null;
  handleProjectFileSelect: (path: string) => Promise<void>;
  handleBreadcrumbFolderSelect: (path: string) => Promise<void>;
  handleMoveProjectEntry: ProjectEntryActions["handleMoveProjectEntry"];
  handleRenameProjectEntry: ProjectEntryActions["handleRenameProjectEntry"];
  handleDeleteProjectEntry: ProjectEntryActions["handleDeleteProjectEntry"];
  handleCreateProjectFile: ProjectEntryActions["handleCreateProjectFile"];
  handleCreateProjectFolder: ProjectEntryActions["handleCreateProjectFolder"];
  visibleKnownLibraries: WorkspaceRecord[];
  currentFileName: string;
  outlineItems: DocumentOutlineItem[];
  activeOutlineChain: DocumentOutlineItem[];
  openOutlineMenuId: string | null;
  setOpenOutlineMenuId: Dispatch<SetStateAction<string | null>>;
  outlineQuery: string;
  setOutlineQuery: Dispatch<SetStateAction<string>>;
  filteredOutlineItems: FlatOutlineItem[];
  jumpToOutlineItem: (item: OutlineItem) => void;
  collapsedWorkspaceFolderPaths: ReadonlySet<string>;
  focusedFolderPath: string | null;
  toggleWorkspaceFolderCollapse: (path: string) => void;
  handleWorkspaceFolderTreeSelect: (path: string) => void;
  isBreadcrumbOverflowOpen: boolean;
  setIsBreadcrumbOverflowOpen: Dispatch<SetStateAction<boolean>>;
  scratchWorkspaceName: string;
};

export function TopbarBreadcrumbs(props: TopbarBreadcrumbsProps) {
  const {
    breadcrumbLayout, breadcrumbMenuRef, handleBreadcrumbKeyDown, breadcrumbOverflowItems,
    libraryContext, enterLibraryRoot, projectFolder, breadcrumbTrail, activeBreadcrumbPath,
    breadcrumbBrowsePath, hasActiveOutlineBreadcrumb, isWorkspaceSwitcherOpen,
    setActiveBreadcrumbPath, setBreadcrumbBrowsePath, setIsWorkspaceSwitcherOpen, settings,
    workspaceSwitcherQuery, setWorkspaceSwitcherQuery, visibleRecentWorkspaces,
    closeBreadcrumbMenuAndRun, openWorkspace, breadcrumbDropTarget, draggingBreadcrumbEntryPath,
    handleBreadcrumbEntryDragStart, handleBreadcrumbEntryDragOver, handleBreadcrumbEntryDrop,
    handleBreadcrumbEntryDragEnd, currentFilePath, handleProjectFileSelect,
    handleBreadcrumbFolderSelect, handleMoveProjectEntry, handleRenameProjectEntry,
    handleDeleteProjectEntry, handleCreateProjectFile, handleCreateProjectFolder,
    visibleKnownLibraries, currentFileName, outlineItems, activeOutlineChain,
    openOutlineMenuId, setOpenOutlineMenuId, outlineQuery, setOutlineQuery,
    filteredOutlineItems, jumpToOutlineItem, collapsedWorkspaceFolderPaths, focusedFolderPath,
    toggleWorkspaceFolderCollapse, handleWorkspaceFolderTreeSelect, isBreadcrumbOverflowOpen,
    setIsBreadcrumbOverflowOpen, scratchWorkspaceName,
  } = props;

  const renderWorkspaceFolderTree = (folder: ProjectFolder) =>
    getVisibleWorkspaceFolderTreeRows(
      folder,
      collapsedWorkspaceFolderPaths,
    ).map(({ entry, depth }) => {
      const isRoot = !("kind" in entry);
      const isFile = "kind" in entry && entry.kind === "file";
      const isCollapsed = collapsedWorkspaceFolderPaths.has(entry.path);
      const isActive = isFile
        ? Boolean(currentFilePath && isSamePath(currentFilePath, entry.path))
        : focusedFolderPath
          ? isSamePath(focusedFolderPath, entry.path)
          : isRoot;

      return (
        <div className="workspaceFolderTreeNode" key={entry.path}>
          <div className="workspaceFolderTreeRow" style={{ paddingLeft: `${depth * 14}px` }}>
            {isFile ? (
              <span className="workspaceFolderTreeIndent" aria-hidden="true" />
            ) : (
              <button
                className="workspaceFolderDisclosure"
                type="button"
                aria-label={isCollapsed ? `${entry.name} を展開` : `${entry.name} を折りたたむ`}
                disabled={entry.children.length === 0}
                onClick={() => toggleWorkspaceFolderCollapse(entry.path)}
              >
                {entry.children.length > 0 ? (isCollapsed ? "›" : "⌄") : ""}
              </button>
            )}
            <button
              className={`workspaceFolderTreeButton ${
                isActive ? "activeWorkspaceFolderTreeButton" : ""
              }`}
              type="button"
              role="menuitem"
              title={entry.path}
              onClick={() =>
                isFile
                  ? closeBreadcrumbMenuAndRun(() =>
                      handleProjectFileSelect(entry.path),
                    )
                  : handleWorkspaceFolderTreeSelect(entry.path)
              }
            >
              <AppIcon
                name={isRoot ? "book" : isFile ? "file" : "folder"}
                className="workspaceFolderTreeIcon"
              />
              <span>{entry.name}</span>
            </button>
          </div>
        </div>
      );
    });

  const renderBreadcrumbOverflow = (key: string) => (
    <div className="breadcrumbMenu breadcrumbOverflowMenu" key={key}>
      <button
        className="breadcrumbOverflowButton"
        type="button"
        aria-label="省略されたパンくずを表示"
        aria-expanded={isBreadcrumbOverflowOpen}
        title="省略されたパンくずを表示"
        onClick={() => {
          setActiveBreadcrumbPath(null);
          setBreadcrumbBrowsePath(null);
          setIsWorkspaceSwitcherOpen(false);
          setOpenOutlineMenuId(null);
          setIsBreadcrumbOverflowOpen((isOpen) => !isOpen);
        }}
      >
        <span aria-hidden="true">…</span>
      </button>
      {isBreadcrumbOverflowOpen && (
        <div className="menuPopover breadcrumbOverflowPopover" role="menu">
          {breadcrumbOverflowItems.map((item) => {
            const itemKey =
              item.kind === "outline"
                ? `outline:${item.item.id}`
                : item.kind === "scratch"
                  ? "scratch"
                  : `${item.kind}:${item.path}`;
            const itemName = item.kind === "outline" ? item.item.title : item.name;
            return (
              <button
                key={itemKey}
                type="button"
                role="menuitem"
                title={itemName}
                onClick={() => {
                  setIsBreadcrumbOverflowOpen(false);
                  if (item.kind === "outline") {
                    jumpToOutlineItem(item.item);
                  } else if (item.kind === "folder") {
                    void handleBreadcrumbFolderSelect(item.path);
                  } else if (item.kind === "file") {
                    void handleProjectFileSelect(item.path);
                  } else {
                    void openWorkspace();
                  }
                }}
              >
                <span className="breadcrumbOverflowItemIcon" aria-hidden="true">
                  {item.kind === "outline"
                    ? "#"
                    : item.kind === "folder"
                      ? "▸"
                      : item.kind === "file"
                        ? "▤"
                        : "⌂"}
                </span>
                <span>{itemName}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // 作品の切り替えメニューの行（最近の作品とライブラリ）。開いているフォルダと同じパスの行は「現在」。
  const renderWorkspaceRecord = (
    record: WorkspaceRecord,
    icon: AppIconName,
    scope: ProjectFolder | null,
  ) => {
    const isActive = record.path === scope?.path;
    return (
      <button
        key={record.path}
        className={isActive ? "workspaceRecordButton activeMenuItem" : "workspaceRecordButton"}
        type="button"
        role="menuitem"
        onClick={() =>
          closeBreadcrumbMenuAndRun(() =>
            isActive ? undefined : void openWorkspace(record.path),
          )
        }
      >
        <AppIcon name={icon} className="menuSvgIcon" />
        <span className="workspaceRecordText">
          <span className="workspaceRecordName">{record.name}</span>
          {settings.showWorkspacePaths && (
            <span className="workspaceRecordPath">{record.path}</span>
          )}
        </span>
        {isActive && <span className="workspaceRecordBadge">現在</span>}
      </button>
    );
  };

  // 作品の切り替えメニュー。作品を開いていないとき（一時ファイル）は scope が null。
  const renderWorkspaceSwitcher = (scope: ProjectFolder | null) => (
    <div className="menuPopover workspaceSwitcherPopover" role="menu">
      <div className="workspaceSwitcherHeader">
        <span className="workspaceSwitcherTitle">
          {scope ? scopeDisplayName(scope) : scratchWorkspaceName}
        </span>
        {scope && settings.showWorkspacePaths && (
          <span className="workspaceSwitcherPath">{scope.path}</span>
        )}
      </div>
      <label className="workspaceSwitcherSearch">
        <span aria-hidden="true">⌕</span>
        <input
          value={workspaceSwitcherQuery}
          onChange={(event) => setWorkspaceSwitcherQuery(event.target.value)}
          placeholder="プロジェクトを検索"
          type="search"
        />
      </label>
      {scope && (
        <>
          <span className="workspaceSwitcherSectionLabel">現在のプロジェクト</span>
          <div className="workspaceFolderTree">{renderWorkspaceFolderTree(scope)}</div>
          <div className="menuDivider" role="separator" />
        </>
      )}
      <span className="workspaceSwitcherSectionLabel">最近開いたプロジェクト</span>
      <div className="workspaceSwitcherList">
        {visibleRecentWorkspaces.length ? (
          visibleRecentWorkspaces.map((workspace) => renderWorkspaceRecord(workspace, "folder", scope))
        ) : (
          <span className="emptyMenuMessage">一致するプロジェクトがありません</span>
        )}
      </div>
      {visibleKnownLibraries.length > 0 && (
        <>
          <div className="menuDivider" role="separator" />
          <span className="workspaceSwitcherSectionLabel">ライブラリ</span>
          <div className="workspaceSwitcherList">
            {visibleKnownLibraries.map((library) => renderWorkspaceRecord(library, "book", scope))}
          </div>
        </>
      )}
      <div className="menuDivider" role="separator" />
      <button
        type="button"
        role="menuitem"
        onClick={() => closeBreadcrumbMenuAndRun(() => void openWorkspace())}
      >
        <AppIcon name="folder" className="menuSvgIcon" />
        <span>別のフォルダを開く...</span>
      </button>
    </div>
  );

  return (
    <nav
      className="breadcrumbs"
      aria-label="パンくず"
      data-layout={breadcrumbLayout}
      ref={breadcrumbMenuRef}
      onKeyDown={handleBreadcrumbKeyDown}
    >
      {breadcrumbLayout === "minimal" &&
        breadcrumbOverflowItems.length > 0 &&
        renderBreadcrumbOverflow("breadcrumb-overflow-minimal")}
      {libraryContext?.role === "project" && (
        <div className="breadcrumbSegment breadcrumbLibrarySegment">
          <button
            className="breadcrumbFolderButton breadcrumbLibraryButton"
            type="button"
            title={`ライブラリ「${libraryContext.name}」へ戻る`}
            onClick={enterLibraryRoot}
          >
            <span>{libraryContext.name}</span>
          </button>
          <span className="crumbSeparator">›</span>
        </div>
      )}
      {projectFolder ? (
        breadcrumbTrail.map((crumb, index) => {
          const isFolder =
            "children" in crumb &&
            (!("kind" in crumb) || crumb.kind === "folder");
          const isLast = index === breadcrumbTrail.length - 1;
          const breadcrumbNavigation = isFolder
            ? getBreadcrumbFolderNavigation(
                projectFolder,
                crumb.path,
                activeBreadcrumbPath === crumb.path
                  ? breadcrumbBrowsePath
                  : crumb.path,
              )
            : null;
          const breadcrumbMenuFolderPath =
            breadcrumbNavigation?.path ?? crumb.path;
          const children = breadcrumbNavigation?.children ?? [];
          const isVisible = isBreadcrumbTrailItemVisible(
            breadcrumbLayout,
            index,
            breadcrumbTrail.length,
            hasActiveOutlineBreadcrumb,
          );

          return (
            <Fragment key={crumb.path}>
            <div
              className={`breadcrumbSegment breadcrumbTrailSegment ${
                isVisible ? "" : "breadcrumbCollapsedSegment"
              }`}
            >
              {index > 0 && <span className="crumbSeparator">›</span>}
              {isFolder ? (
                <div className="breadcrumbMenu">
                  <button
                    className={`breadcrumbFolderButton ${
                      index === 0 ? "workspaceSwitcherButton" : ""
                    }`}
                    type="button"
                    aria-label={
                      index === 0 ? "プロジェクトを切り替え" : `${crumb.name} の項目`
                    }
                    aria-expanded={
                      index === 0
                        ? isWorkspaceSwitcherOpen
                        : activeBreadcrumbPath === crumb.path
                    }
                    onClick={() => {
                      if (index === 0) {
                        setActiveBreadcrumbPath(null);
                        setBreadcrumbBrowsePath(null);
                        setIsWorkspaceSwitcherOpen((isOpen) => !isOpen);
                        return;
                      }
                      setIsWorkspaceSwitcherOpen(false);
                      if (activeBreadcrumbPath === crumb.path) {
                        setActiveBreadcrumbPath(null);
                        setBreadcrumbBrowsePath(null);
                      } else {
                        setActiveBreadcrumbPath(crumb.path);
                        setBreadcrumbBrowsePath(crumb.path);
                      }
                    }}
                    onContextMenu={(event) => {
                      if (index === 0) return;
                      event.preventDefault();
                      setActiveBreadcrumbPath(crumb.path);
                      setBreadcrumbBrowsePath(crumb.path);
                    }}
                  >
                    {index === 0 && (
                      <AppIcon
                        name="book"
                        className="workspaceSwitcherBookIcon"
                      />
                    )}
                    <span>{index === 0 ? scopeDisplayName(projectFolder) : crumb.name}</span>
                  </button>
                  {index === 0 && isWorkspaceSwitcherOpen && renderWorkspaceSwitcher(projectFolder)}
                  {index !== 0 && activeBreadcrumbPath === crumb.path && (
                    <div className="menuPopover breadcrumbPopover" role="menu">
                      {breadcrumbNavigation?.parentPath && (
                        <div className="breadcrumbBrowseHeader">
                          <button
                            className="breadcrumbBrowseBack"
                            type="button"
                            role="menuitem"
                            aria-label={`${breadcrumbNavigation.parentName ?? crumb.name} に戻る`}
                            onClick={() =>
                              setBreadcrumbBrowsePath(
                                breadcrumbNavigation.parentPath,
                              )
                            }
                          >
                            <span aria-hidden="true">‹</span>
                          </button>
                          <span
                            className="breadcrumbBrowseFolderName"
                            title={breadcrumbNavigation.name}
                          >
                            {breadcrumbNavigation.name}
                          </span>
                        </div>
                      )}
                      {children.length ? (
                        children.map((entry, entryIndex) => {
                          const dropClass =
                            breadcrumbDropTarget?.entryPath === entry.path
                              ? `breadcrumbDrop-${breadcrumbDropTarget.position}`
                              : "";
                          return (
                          <div
                            className={`menuRow ${dropClass} ${
                              draggingBreadcrumbEntryPath === entry.path
                                ? "draggingBreadcrumbEntry"
                                : ""
                            }`}
                            draggable
                            key={entry.path}
                            onDragStart={(event) =>
                              handleBreadcrumbEntryDragStart(
                                event,
                                breadcrumbMenuFolderPath,
                                entry.path,
                              )
                            }
                            onDragOver={(event) =>
                              handleBreadcrumbEntryDragOver(
                                event,
                                breadcrumbMenuFolderPath,
                                entry.path,
                              )
                            }
                            onDrop={(event) =>
                              handleBreadcrumbEntryDrop(
                                event,
                                breadcrumbMenuFolderPath,
                                entry.path,
                              )
                            }
                            onDragEnd={handleBreadcrumbEntryDragEnd}
                          >
                            <button
                              className={
                                entry.path === currentFilePath
                                  ? "activeMenuItem breadcrumbPrimaryMenuItem"
                                  : "breadcrumbPrimaryMenuItem"
                              }
                              type="button"
                              role="menuitem"
                              onClick={() =>
                                entry.kind === "file"
                                  ? closeBreadcrumbMenuAndRun(() =>
                                      handleProjectFileSelect(entry.path),
                                    )
                                  : void handleBreadcrumbFolderSelect(entry.path)
                              }
                            >
                              <AppIcon
                                name={entry.kind === "folder" ? "folder" : "file"}
                                className="menuSvgIcon"
                              />
                              <span>{entry.name}</span>
                            </button>
                            <div className="breadcrumbRowTools" aria-label={`${entry.name} の操作`}>
                            <button
                              className="menuActionButton"
                              type="button"
                              aria-label={`${entry.name} を上へ移動`}
                              disabled={entryIndex === 0}
                              onClick={() =>
                                handleMoveProjectEntry(
                                  breadcrumbMenuFolderPath,
                                  entry.path,
                                  -1,
                                )
                              }
                            >
                              ↑
                            </button>
                            <button
                              className="menuActionButton"
                              type="button"
                              aria-label={`${entry.name} を下へ移動`}
                              disabled={entryIndex === children.length - 1}
                              onClick={() =>
                                handleMoveProjectEntry(
                                  breadcrumbMenuFolderPath,
                                  entry.path,
                                  1,
                                )
                              }
                            >
                              ↓
                            </button>
                            <button
                              className="menuActionButton"
                              type="button"
                              aria-label={`${entry.name} をリネーム`}
                              onClick={() =>
                                closeBreadcrumbMenuAndRun(() =>
                                  handleRenameProjectEntry(entry),
                                )
                              }
                            >
                              ✎
                            </button>
                            <button
                              className="menuActionButton"
                              type="button"
                              aria-label={`${entry.name} を削除`}
                              onClick={() =>
                                closeBreadcrumbMenuAndRun(() =>
                                  handleDeleteProjectEntry(entry),
                                )
                              }
                            >
                              ×
                            </button>
                            </div>
                          </div>
                          );
                        })
                      ) : (
                        <span className="emptyMenuMessage">
                          テキストファイルまたはフォルダがありません
                        </span>
                      )}
                      <div className="menuDivider" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() =>
                          closeBreadcrumbMenuAndRun(() =>
                            handleCreateProjectFile(breadcrumbMenuFolderPath),
                          )
                        }
                      >
                        新規ファイルを作成
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() =>
                          closeBreadcrumbMenuAndRun(() =>
                            handleCreateProjectFolder(breadcrumbMenuFolderPath),
                          )
                        }
                      >
                        新規フォルダを作成
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <span className="breadcrumbItem">
                  <span className={isLast ? "activeCrumb" : ""}>{crumb.name}</span>
                </span>
              )}
            </div>
            {breadcrumbLayout === "compact" &&
              index === 0 &&
              breadcrumbOverflowItems.length > 0 &&
              renderBreadcrumbOverflow("breadcrumb-overflow-compact")}
            </Fragment>
          );
        })
      ) : (
        <div
          className={`breadcrumbMenu ${
            breadcrumbLayout === "minimal"
              ? "breadcrumbCollapsedSegment"
              : ""
          }`}
        >
          <button
            className="breadcrumbFolderButton workspaceSwitcherButton"
            type="button"
            aria-label="プロジェクトを切り替え"
            aria-expanded={isWorkspaceSwitcherOpen}
            onClick={() => {
              setActiveBreadcrumbPath(null);
              setBreadcrumbBrowsePath(null);
              setIsWorkspaceSwitcherOpen((isOpen) => !isOpen);
            }}
          >
            <AppIcon name="book" className="workspaceSwitcherBookIcon" />
            <span>{scratchWorkspaceName}</span>
          </button>
          {isWorkspaceSwitcherOpen && renderWorkspaceSwitcher(null)}
        </div>
      )}
      {!projectFolder && (
        <>
          <span className="crumbSeparator">›</span>
          <span className="breadcrumbItem">
            <span className="activeCrumb">{currentFileName}</span>
          </span>
        </>
      )}
      {currentFilePath && outlineItems.length > 0 && (
        <>
          <span className="outlineSeparator">/</span>
          {activeOutlineChain.map((item, index) => (
            <div
              className={`breadcrumbSegment outlineBreadcrumbSegment ${
                !isOutlineBreadcrumbItemVisible(
                  breadcrumbLayout,
                  index,
                  activeOutlineChain.length,
                )
                  ? "breadcrumbCollapsedSegment"
                  : ""
              }`}
              key={item.id}
            >
              {index > 0 && breadcrumbLayout === "full" && (
                <span className="crumbSeparator">›</span>
              )}
              <div className="breadcrumbMenu">
                <button
                  className="breadcrumbFolderButton outlineCrumbButton"
                  type="button"
                  aria-label={`${item.title} のアウトライン`}
                  aria-expanded={openOutlineMenuId === item.id}
                  onClick={() =>
                    setOpenOutlineMenuId((openId) => (openId === item.id ? null : item.id))
                  }
                >
                  <span>{item.title}</span>
                </button>
                {openOutlineMenuId === item.id && (
                  <div className="menuPopover outlinePopover" role="menu">
                    <label className="outlineSearch">
                      <span aria-hidden="true">⌕</span>
                      <input
                        value={outlineQuery}
                        onChange={(event) => setOutlineQuery(event.target.value)}
                        placeholder="見出しを検索"
                        type="search"
                      />
                    </label>
                    <div className="outlineList">
                      {filteredOutlineItems.map((outlineItem) => (
                        <button
                          className="outlineMenuItem"
                          key={outlineItem.id}
                          style={{ paddingLeft: `${10 + (outlineItem.level - 1) * 18}px` }}
                          type="button"
                          role="menuitem"
                          onClick={() => jumpToOutlineItem(outlineItem)}
                        >
                          <span>{outlineItem.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </nav>
  );
}
