import type { Dispatch, SetStateAction } from "react";
import type { HeadingDropPosition } from "../../editor/ast/headingMove";
import type {
  DocumentOutlineItem,
  ProjectAst,
  ProjectSearchOutcome,
  ProjectSearchResult,
} from "../../editor/ast/types";
import type { createProjectEntryActions } from "../../projectEntryActions";
import type {
  AppState,
  EditorSettings,
  FileProgressStatus,
  IdeaThread,
  LibraryContext,
  ManuscriptSnapshot,
  OutlineItem,
  ProjectFolder,
  ReferenceFileInfo,
  ReferenceLayout,
} from "../../types";
import { OpenCardsPane } from "../binder/OpenCardsPane";
import { AppIcon } from "./AppIcon";
import { WorkspaceSidebar, type SidebarHeadingSelection } from "./WorkspaceSidebar";

type AppMode = "write" | "canvas" | "export" | "checkpoint" | "plugin";

type WorkspaceSearchScope = "file" | "project" | "library";

type LeftSidebarView = "files" | "search" | "reference";

type ProjectEntryActions = ReturnType<typeof createProjectEntryActions>;

export type LeftSidebarProps = {
  appMode: AppMode;
  isLeftSidebarCollapsed: boolean;
  isEditorFocusMode: boolean;
  leftSidebarView: LeftSidebarView;
  setIsLeftSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  setLeftSidebarView: Dispatch<SetStateAction<LeftSidebarView>>;
  handleNewDocument: () => Promise<void>;
  projectFolder: ProjectFolder | null;
  handleCreateProjectFolder: ProjectEntryActions["handleCreateProjectFolder"];
  focusedFolderPath: string | null;
  handleOpenProjectFolder: () => Promise<void>;
  referenceLayout: ReferenceLayout;
  snippets: IdeaThread[];
  sortedReferenceCandidates: ReferenceFileInfo[];
  focusReferenceCard: (cardId: string) => void;
  closeReferenceCard: (cardId: string) => void;
  pinReferenceCard: (cardId: string, pinned: boolean) => void;
  collapseReferenceCard: (cardId: string, collapsed: boolean) => void;
  currentFilePath: string | null;
  currentFileName: string;
  charCount: number;
  outlineItems: DocumentOutlineItem[];
  activeOutlineIds: ReadonlySet<string>;
  activeOutlineChain: DocumentOutlineItem[];
  projectAst: ProjectAst | null;
  settings: EditorSettings;
  appState: AppState;
  handleSetFileProgress: (path: string, status: FileProgressStatus) => void;
  collapsedTreeFolderPaths: ReadonlySet<string>;
  handleFolderCollapsedChange: (path: string, collapsed: boolean) => void;
  collapsedTreeOutlinePaths: ReadonlySet<string>;
  handleOutlineCollapsedChange: (path: string, collapsed: boolean) => void;
  collapsedTreeOutlineHeadingKeys: ReadonlySet<string>;
  handleOutlineHeadingCollapsedChange: (key: string, collapsed: boolean) => void;
  projectSearchQuery: string;
  workspaceSearchOutcome: ProjectSearchOutcome;
  projectSearchUseRegex: boolean;
  projectSearchMatchCase: boolean;
  searchIncludeComments: boolean;
  searchScope: WorkspaceSearchScope;
  projectReplaceValue: string;
  isProjectReplacing: boolean;
  jumpToOutlineItem: (item: OutlineItem) => void;
  handleProjectOutlineJump: (path: string, item: DocumentOutlineItem) => Promise<void>;
  handleHeadingMove: (
    sources: SidebarHeadingSelection[],
    targetPath: string,
    targetLine: number | null,
    targetBlockId: string | null,
    position: HeadingDropPosition,
  ) => Promise<void>;
  handleHeadingExtract: (source: SidebarHeadingSelection) => Promise<void>;
  setProjectSearchQuery: Dispatch<SetStateAction<string>>;
  setProjectSearchUseRegex: Dispatch<SetStateAction<boolean>>;
  setProjectSearchMatchCase: Dispatch<SetStateAction<boolean>>;
  setSearchIncludeComments: Dispatch<SetStateAction<boolean>>;
  setSearchScope: Dispatch<SetStateAction<WorkspaceSearchScope>>;
  setProjectReplaceValue: Dispatch<SetStateAction<string>>;
  handleProjectSearchResultOpen: (result: ProjectSearchResult) => Promise<void>;
  handleReplaceInCurrentFile: () => void;
  handleReplaceInProject: () => Promise<void>;
  handleCreateProjectFile: ProjectEntryActions["handleCreateProjectFile"];
  handleProjectFileSelect: (path: string) => Promise<void>;
  handleProjectFolderSelect: (path: string) => Promise<void>;
  handleRenameProjectEntry: ProjectEntryActions["handleRenameProjectEntry"];
  handleDeleteProjectEntry: ProjectEntryActions["handleDeleteProjectEntry"];
  handleMoveProjectEntriesToFolder: ProjectEntryActions["handleMoveProjectEntriesToFolder"];
  handleSidebarEntryReorder: ProjectEntryActions["handleSidebarEntryReorder"];
  currentWorkspaceSnapshots: ManuscriptSnapshot[];
  updateSettings: <Key extends keyof EditorSettings>(key: Key, value: EditorSettings[Key]) => void;
  handleQuickCreateManuscriptSnapshot: () => Promise<unknown>;
  openCheckpointStudio: (snapshotId?: string) => void;
  handleEditManuscriptSnapshotDetails: (snapshot: ManuscriptSnapshot) => Promise<unknown>;
  handleRestoreManuscriptSnapshot: (snapshot: ManuscriptSnapshot) => Promise<unknown>;
  handleDeleteManuscriptSnapshot: (snapshot: ManuscriptSnapshot) => Promise<unknown>;
  libraryContext: LibraryContext | null;
  enterLibraryRoot: () => void;
  enterProject: (path: string) => void;
  handleCreateLibraryProject: () => Promise<void>;
  handleImportProjectIntoLibrary: () => Promise<void>;
  reorderLibraryProjects: (orderedPaths: string[]) => Promise<void>;
  libraryCorpus: { isLoading: boolean } | null;
};

export function LeftSidebar(props: LeftSidebarProps) {
  const {
    appMode, isLeftSidebarCollapsed, isEditorFocusMode, leftSidebarView, setIsLeftSidebarCollapsed,
    setLeftSidebarView, handleNewDocument, projectFolder, handleCreateProjectFolder, focusedFolderPath,
    handleOpenProjectFolder, referenceLayout, snippets, sortedReferenceCandidates, focusReferenceCard,
    closeReferenceCard, pinReferenceCard, collapseReferenceCard, currentFilePath, currentFileName, charCount,
    outlineItems, activeOutlineIds, activeOutlineChain, projectAst, settings, appState, handleSetFileProgress,
    collapsedTreeFolderPaths, handleFolderCollapsedChange, collapsedTreeOutlinePaths,
    handleOutlineCollapsedChange, collapsedTreeOutlineHeadingKeys, handleOutlineHeadingCollapsedChange,
    projectSearchQuery, workspaceSearchOutcome, projectSearchUseRegex, projectSearchMatchCase,
    searchIncludeComments, searchScope, projectReplaceValue, isProjectReplacing, jumpToOutlineItem,
    handleProjectOutlineJump, handleHeadingMove, handleHeadingExtract, setProjectSearchQuery,
    setProjectSearchUseRegex, setProjectSearchMatchCase, setSearchIncludeComments, setSearchScope,
    setProjectReplaceValue, handleProjectSearchResultOpen, handleReplaceInCurrentFile, handleReplaceInProject,
    handleCreateProjectFile, handleProjectFileSelect, handleProjectFolderSelect, handleRenameProjectEntry,
    handleDeleteProjectEntry, handleMoveProjectEntriesToFolder, handleSidebarEntryReorder,
    currentWorkspaceSnapshots, updateSettings, handleQuickCreateManuscriptSnapshot, openCheckpointStudio,
    handleEditManuscriptSnapshotDetails, handleRestoreManuscriptSnapshot, handleDeleteManuscriptSnapshot,
    libraryContext, enterLibraryRoot, enterProject, handleCreateLibraryProject,
    handleImportProjectIntoLibrary, reorderLibraryProjects, libraryCorpus
  } = props;
  const isProjectSearchMode = leftSidebarView === "search";

  return (
    <div
      className={`leftWorkspaceCluster ${
        appMode !== "write" && appMode !== "plugin" ? "modeHiddenPane" : ""
      }`}
      data-sidebar-collapsed={isLeftSidebarCollapsed}
      aria-hidden={isEditorFocusMode || appMode === "plugin"}
      {...(isEditorFocusMode || appMode === "plugin" ? { inert: "" } : {})}
    >
        <nav className="workspaceActivityBar" aria-label="左サイドバー操作">
          <button
            className={`workspaceActivityButton ${
              leftSidebarView === "files" && !isLeftSidebarCollapsed
                ? "activeWorkspaceActivityButton"
                : ""
            }`}
            type="button"
            aria-label="ファイルツリー"
            title="ファイルツリー"
            aria-pressed={leftSidebarView === "files" && !isLeftSidebarCollapsed}
            onClick={() => {
              setIsLeftSidebarCollapsed(false);
              setLeftSidebarView("files");
            }}
          >
            <AppIcon name="files" className="workspaceActivityIcon" />
          </button>
          <button
            className={`workspaceActivityButton ${
              leftSidebarView === "search" && !isLeftSidebarCollapsed
                ? "activeWorkspaceActivityButton"
                : ""
            }`}
            type="button"
            aria-label="プロジェクト検索"
            title="プロジェクト検索"
            aria-pressed={leftSidebarView === "search" && !isLeftSidebarCollapsed}
            onClick={() => {
              setIsLeftSidebarCollapsed(false);
              setLeftSidebarView("search");
            }}
          >
            <AppIcon name="search" className="workspaceActivityIcon" />
          </button>
          <button
            className={`workspaceActivityButton ${
              leftSidebarView === "reference" && !isLeftSidebarCollapsed
                ? "activeWorkspaceActivityButton"
                : ""
            }`}
            type="button"
            aria-label="開いているカード"
            title="開いているカード"
            aria-pressed={leftSidebarView === "reference" && !isLeftSidebarCollapsed}
            onClick={() => {
              setIsLeftSidebarCollapsed(false);
              setLeftSidebarView("reference");
            }}
          >
            <AppIcon name="reference" className="workspaceActivityIcon" />
          </button>
          <button
            className="workspaceActivityButton"
            type="button"
            aria-label="新規ファイル"
            title="新規ファイル"
            onClick={handleNewDocument}
          >
            <AppIcon name="plus" className="workspaceActivityIcon" />
          </button>
          <button
            className="workspaceActivityButton"
            type="button"
            aria-label="新規フォルダ"
            title="新規フォルダ"
            onClick={() =>
              projectFolder
                ? void handleCreateProjectFolder(focusedFolderPath ?? projectFolder.path)
                : handleOpenProjectFolder()
            }
          >
            <AppIcon name="folderPlus" className="workspaceActivityIcon" />
          </button>
        </nav>
        {leftSidebarView === "reference" ? (
          <aside
            className="workspaceSidebar referenceWorkspaceSidebar"
            aria-label="開いているカード"
          >
            <div className="sidebarHeader">
              <span className="sidebarHeaderLabel">開いているカード</span>
              <div className="sidebarHeaderActions">
                <button
                  className="sidebarIconButton"
                  type="button"
                  aria-label="左サイドバーを畳む"
                  title="左サイドバーを畳む"
                  onClick={() => setIsLeftSidebarCollapsed(true)}
                >
                  <AppIcon name="panelLeft" className="sidebarButtonSvg" />
                </button>
              </div>
            </div>
            <div className="leftReferenceSidebarBody">
              <OpenCardsPane
                cards={referenceLayout.cards}
                threads={snippets}
                candidates={sortedReferenceCandidates}
                onFocusCard={focusReferenceCard}
                onCloseCard={closeReferenceCard}
                onPinCard={pinReferenceCard}
                onCollapseCard={collapseReferenceCard}
              />
            </div>
          </aside>
        ) : (
        <WorkspaceSidebar
        projectFolder={projectFolder}
        currentFilePath={currentFilePath}
        currentFileName={currentFileName}
        currentFileCharCount={charCount}
        focusedFolderPath={focusedFolderPath}
        activeDocumentOutline={outlineItems}
        activeOutlineIds={activeOutlineIds}
        activeOutlineBlockId={
          activeOutlineChain[activeOutlineChain.length - 1]?.blockId ?? null
        }
        projectAst={projectAst}
        countWhitespace={settings.countWhitespace}
        countCode={settings.countCode}
        showOutlineGuides={settings.showOutlineGuides}
        fileProgress={appState.fileProgress}
        onSetFileProgress={handleSetFileProgress}
        collapsedFolderPaths={collapsedTreeFolderPaths}
        onFolderCollapsedChange={handleFolderCollapsedChange}
        collapsedOutlinePaths={collapsedTreeOutlinePaths}
        onOutlineCollapsedChange={handleOutlineCollapsedChange}
        collapsedOutlineHeadingKeys={collapsedTreeOutlineHeadingKeys}
        onOutlineHeadingCollapsedChange={handleOutlineHeadingCollapsedChange}
        projectSearchQuery={projectSearchQuery}
        projectSearchResults={workspaceSearchOutcome.results}
        projectSearchTotal={workspaceSearchOutcome.total}
        projectSearchMatchedFileCount={workspaceSearchOutcome.matchedFileCount}
        projectSearchTruncated={workspaceSearchOutcome.truncated}
        projectSearchError={workspaceSearchOutcome.error}
        projectSearchUseRegex={projectSearchUseRegex}
        projectSearchMatchCase={projectSearchMatchCase}
        projectSearchIncludeComments={searchIncludeComments}
        searchScope={searchScope}
        projectReplaceValue={projectReplaceValue}
        isProjectReplacing={isProjectReplacing}
        isProjectSearchMode={isProjectSearchMode}
        onJumpOutline={jumpToOutlineItem}
        onJumpProjectOutline={(path, item) => void handleProjectOutlineJump(path, item)}
        onMoveHeadings={(
          sources,
          targetPath,
          targetLine,
          targetBlockId,
          position,
        ) =>
          void handleHeadingMove(
            sources,
            targetPath,
            targetLine,
            targetBlockId,
            position,
          )
        }
        onExtractHeading={(source) => void handleHeadingExtract(source)}
        onProjectSearchQueryChange={setProjectSearchQuery}
        onProjectSearchUseRegexChange={setProjectSearchUseRegex}
        onProjectSearchMatchCaseChange={setProjectSearchMatchCase}
        onProjectSearchIncludeCommentsChange={setSearchIncludeComments}
        onSearchScopeChange={setSearchScope}
        onProjectReplaceValueChange={setProjectReplaceValue}
        onOpenProjectSearchResult={(result) => void handleProjectSearchResultOpen(result)}
        onReplaceInCurrentFile={handleReplaceInCurrentFile}
        onReplaceInProject={() => void handleReplaceInProject()}
        onOpenProjectFolder={handleOpenProjectFolder}
        onCreateFile={(folderPath) => void handleCreateProjectFile(folderPath)}
        onCreateFolder={(folderPath) => void handleCreateProjectFolder(folderPath)}
        onSelectFile={(path) => void handleProjectFileSelect(path)}
        onSelectFolder={(path) => void handleProjectFolderSelect(path)}
        onRenameEntry={(entry) => void handleRenameProjectEntry(entry)}
        onDeleteEntry={(entry) => void handleDeleteProjectEntry(entry)}
        onMoveEntry={(sourcePaths, targetFolderPath, targetPath, position) =>
          void handleMoveProjectEntriesToFolder(
            sourcePaths,
            targetFolderPath,
            targetPath,
            position,
          )
        }
        onReorderEntry={(folderPath, draggedPaths, targetPath, position) =>
          void handleSidebarEntryReorder(folderPath, draggedPaths, targetPath, position)
        }
        snapshots={currentWorkspaceSnapshots}
        isSnapshotSectionCollapsed={settings.checkpointSectionCollapsed}
        onSnapshotSectionCollapsedChange={(collapsed) =>
          updateSettings("checkpointSectionCollapsed", collapsed)
        }
        showSnapshotSection={settings.showCheckpointSection}
        onCreateSnapshot={() => void handleQuickCreateManuscriptSnapshot()}
        onOpenSnapshot={(snapshot) => openCheckpointStudio(snapshot?.id)}
        onEditSnapshotDetails={(snapshot) => void handleEditManuscriptSnapshotDetails(snapshot)}
        onRestoreSnapshot={(snapshot) => void handleRestoreManuscriptSnapshot(snapshot)}
        onDeleteSnapshot={(snapshot) => void handleDeleteManuscriptSnapshot(snapshot)}
            onCollapse={() => setIsLeftSidebarCollapsed(true)}
            library={libraryContext}
            onEnterLibraryRoot={enterLibraryRoot}
            onEnterProject={enterProject}
            onCreateLibraryProject={() => void handleCreateLibraryProject()}
            onImportProject={() => void handleImportProjectIntoLibrary()}
            onReorderLibraryProjects={(paths) => void reorderLibraryProjects(paths)}
            isLibrarySearchLoading={Boolean(libraryCorpus?.isLoading)}
        />
        )}
    </div>
  );
}
