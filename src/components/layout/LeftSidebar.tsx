import type { CanvasFileDropDetail } from "../../canvasFileDrop";
import type { HeadingDropPosition } from "../../editor/ast/headingMove";
import type {
  DocumentOutlineItem,
  ProjectAst,
} from "../../editor/ast/types";
import type { createProjectEntryActions } from "../../projectEntryActions";
import type {
  AppState,
  EditorSettings,
  FileProgressStatus,
  LibraryContext,
  ManuscriptSnapshot,
  OutlineItem,
  ProjectFolder,
  ReferenceFileInfo,
} from "../../types";
import { WorkspaceSidebar, type SidebarHeadingSelection } from "./WorkspaceSidebar";

type ProjectEntryActions = ReturnType<typeof createProjectEntryActions>;

export type LeftSidebarProps = {
  outlineScope: "all" | "current";
  panelVisible: boolean;
  onAddToCanvas?: (items: CanvasFileDropDetail) => void;
  projectFolder: ProjectFolder | null;
  handleCreateProjectFolder: ProjectEntryActions["handleCreateProjectFolder"];
  focusedFolderPath: string | null;
  handleOpenProjectFolder: () => Promise<void>;
  sortedReferenceCandidates: ReferenceFileInfo[];
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
  handleCreateProjectFile: ProjectEntryActions["handleCreateProjectFile"];
  handleProjectFileSelect: (path: string) => Promise<void>;
  openFileBeside?: (path: string) => Promise<void>;
  handleProjectFolderSelect: (path: string) => Promise<void>;
  handleRenameProjectEntry: ProjectEntryActions["handleRenameProjectEntry"];
  handleDeleteProjectEntry: ProjectEntryActions["handleDeleteProjectEntry"];
  handleMoveProjectEntriesToFolder: ProjectEntryActions["handleMoveProjectEntriesToFolder"];
  handleSidebarEntryReorder: ProjectEntryActions["handleSidebarEntryReorder"];
  /** BINDER 1-5: a folder row clicked while the corkboard is shown. */
  handleCorkboardFolderClick?: (path: string) => boolean;
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
  openIdeaPane: () => void;
  /** 受信箱の投稿の数（BINDER 2-1）。 */
  postInboxCount: number;
  handleCreateMaterialsFolder: ProjectEntryActions["handleCreateMaterialsFolder"];
  handleSetMaterialsFolder: ProjectEntryActions["handleSetMaterialsFolder"];
  /** 資料のファイルを取り込む・資料カードで開く・消す（BINDER 2-5）。 */
  handleAddReference: () => Promise<void>;
  openReferenceCard: (sourcePath: string, fileInfo?: ReferenceFileInfo) => void;
  handleDeleteImportedReference: (sourcePath: string) => Promise<void>;
  /** 素材の段の画像・PDF の改名・移動（BINDER 2-6）。 */
  handleRenameMaterialReference: ProjectEntryActions["handleRenameMaterialReference"];
  handleMoveMaterialReference: ProjectEntryActions["handleMoveMaterialReference"];
  /** 素材のノート・画像・PDF をほかの作品・直下へ送る（U5）。 */
  handleTransferEntries: ProjectEntryActions["handleTransferEntries"];
  /** スターを付けたノートと、付け外し（U10）。 */
  starredNotePaths: ReadonlySet<string>;
  handleSetNoteStar: (path: string, starred: boolean) => Promise<void>;
  /** ライブラリ直下の資料のフォルダ（Q5）。直下でなければ null。 */
  libraryReferencesFolderPath: string | null;
};

/** 作品のフォルダと、そこからの相対パス（`/` 区切り）をつなぐ。区切りは作品のフォルダに合わせる。 */
const joinRootPath = (root: string, relative: string) => {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.split("/").join(separator)}`;
};

export function LeftSidebar(props: LeftSidebarProps) {
  const {
    outlineScope, panelVisible, onAddToCanvas, openFileBeside, projectFolder, handleCreateProjectFolder,
    focusedFolderPath, handleOpenProjectFolder, sortedReferenceCandidates, currentFilePath, currentFileName, charCount,
    outlineItems, activeOutlineIds, activeOutlineChain, projectAst, settings, appState, handleSetFileProgress,
    collapsedTreeFolderPaths, handleFolderCollapsedChange, collapsedTreeOutlinePaths,
    handleOutlineCollapsedChange, collapsedTreeOutlineHeadingKeys, handleOutlineHeadingCollapsedChange,
    jumpToOutlineItem, handleProjectOutlineJump, handleHeadingMove, handleHeadingExtract,
    handleCreateProjectFile, handleProjectFileSelect, handleProjectFolderSelect, handleRenameProjectEntry,
    handleDeleteProjectEntry, handleMoveProjectEntriesToFolder, handleSidebarEntryReorder, handleCorkboardFolderClick,
    currentWorkspaceSnapshots, updateSettings, handleQuickCreateManuscriptSnapshot, openCheckpointStudio,
    handleEditManuscriptSnapshotDetails, handleRestoreManuscriptSnapshot, handleDeleteManuscriptSnapshot,
    libraryContext, enterLibraryRoot, enterProject, handleCreateLibraryProject,
    handleImportProjectIntoLibrary, reorderLibraryProjects, openIdeaPane, postInboxCount,
    handleCreateMaterialsFolder, handleSetMaterialsFolder, handleAddReference, openReferenceCard,
    handleDeleteImportedReference, handleRenameMaterialReference, handleMoveMaterialReference,
    handleTransferEntries, starredNotePaths, handleSetNoteStar, libraryReferencesFolderPath,
  } = props;
  // 素材の段に並べる画像・PDF（ファイルの一覧には入らない。BINDER 2-5、確認1の 7）。
  const materialReferences = projectFolder
    ? sortedReferenceCandidates
        .filter((file) => file.kind === "image" || file.kind === "pdf")
        .map((file) => ({
          path: joinRootPath(projectFolder.path, file.sourcePath),
          sourcePath: file.sourcePath,
          name: file.name,
          kind: file.kind,
        }))
    : [];
  return (
    <WorkspaceSidebar
      onAddToCanvas={onAddToCanvas}
      outlineScope={outlineScope}
      panelHidden={!panelVisible}
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
      onOpenProjectFolder={handleOpenProjectFolder}
      onCreateFile={(folderPath) => void handleCreateProjectFile(folderPath)}
      onCreateFolder={(folderPath) => void handleCreateProjectFolder(folderPath)}
      onSelectFile={(path) => void handleProjectFileSelect(path)}
      onOpenFileBeside={openFileBeside}
      onSelectFolder={(path) => void handleProjectFolderSelect(path)}
      onFolderClick={handleCorkboardFolderClick}
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
          library={libraryContext}
          onEnterLibraryRoot={enterLibraryRoot}
          onEnterProject={enterProject}
          onCreateLibraryProject={() => void handleCreateLibraryProject()}
          onImportProject={() => void handleImportProjectIntoLibrary()}
          onReorderLibraryProjects={(paths) => void reorderLibraryProjects(paths)}
          postInboxCount={postInboxCount}
          onOpenIdeas={openIdeaPane}
          onCreateMaterialsFolder={() => void handleCreateMaterialsFolder()}
          onSetMaterialsFolder={(folderPath) => void handleSetMaterialsFolder(folderPath)}
          materialReferences={materialReferences}
          onOpenReference={(reference) => {
            const file = sortedReferenceCandidates.find((item) => item.sourcePath === reference.sourcePath);
            openReferenceCard(reference.sourcePath, file);
          }}
          onDeleteReference={(reference) => void handleDeleteImportedReference(reference.sourcePath)}
          onRenameReference={(reference) => void handleRenameMaterialReference(reference)}
          onMoveReference={(reference, targetFolderPath) => void handleMoveMaterialReference(reference, targetFolderPath)}
          onImportReferences={() => void handleAddReference()}
          onTransferEntries={libraryContext ? (paths) => void handleTransferEntries(paths) : undefined}
          starredNotePaths={starredNotePaths}
          onSetNoteStar={(path, starred) => void handleSetNoteStar(path, starred)}
          libraryReferencesFolderPath={libraryReferencesFolderPath}
      />
  );
}
