import { invoke } from "@tauri-apps/api/core";
import type { TextSplice } from "./editor/lineTextUpdate";
import {
  discardRecovery,
  forgetDocumentJournal,
  journalPositionOf,
  placeBodyChange,
  recordDocumentChange,
  recordRestoredText,
  recoveryDestination,
  saveThroughJournal,
  scanRecovery,
  type RecoveryItem,
} from "./editor/saveJournal";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChangeEvent,
  DragEvent,
  Fragment,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { manageAsyncRegistration } from "./utils/asyncRegistration";
import {
  quoteCssFontFamily,
  unquoteSingleCssFontFamily,
  withIdeographicSpaceFont,
} from "./utils/fontStack";
import { useVerticalMetricFontFamily } from "./utils/verticalMetricFonts";
import {
  isRestorableRightSidebarTab,
  normalizeRightSidebarTab,
} from "./utils/rightSidebarState";
import {
  getBreadcrumbLayout,
  isBreadcrumbTrailItemVisible,
  isOutlineBreadcrumbItemVisible,
  type BreadcrumbLayout,
} from "./utils/breadcrumbLayout";
import { VerticalTextEditor, type TextEditorHandle } from "./VerticalTextEditor";
import { createManuscriptProgressStore } from "./editor/manuscriptProgressStore";
import { AppDialogModal } from "./components/dialogs/AppDialogModal";
import { CommandPalette, type PaletteCommand } from "./components/dialogs/CommandPalette";
import { PluginManagerModal } from "./components/dialogs/PluginManagerModal";
import { SettingsModal } from "./components/dialogs/SettingsModal";
import { ThemePickerModal } from "./components/dialogs/ThemePickerModal";
import { ManuscriptTidyModal } from "./components/dialogs/ManuscriptTidyModal";
import { RightPaneSwitcher, type RightPaneSwitcherItem } from "./components/layout/RightPaneSwitcher";
import { AiPane } from "./components/ai/AiPane";
import { DEFAULT_AI_SETTINGS, normalizeAiSettings } from "./ai/settings";
import type { ManuscriptTidyLineRange, ManuscriptTidyResult } from "./editor/manuscriptTidy";
import { normalizeAppTheme } from "./themes";
import { PropertiesPanel } from "./components/properties/PropertiesPanel";
import type { PropertyType, PropertyTypeSettings } from "./properties/propertyModel";
import { loadPropertyTypes, savePropertyType } from "./properties/propertyTypeStore";
import { ARTICLE_PROPERTY_SET, type PropertySet } from "./properties/propertySets";
import {
  matchesPropertyConditions,
  parsePropertyQuery,
  propertyConditionQuery,
  propertyFileResults,
  type PropertyQuery,
} from "./properties/propertySearch";
import { usePropertyValueIndex } from "./properties/usePropertyValueIndex";
import {
  CheckpointStudio,
  type CheckpointCurrentProjectFile,
  type CheckpointCurrentProjectStatus,
  type SnapshotRelocation,
  type SnapshotConflictPolicy,
} from "./components/checkpoints/CheckpointStudio";
import {
  WorkspaceSidebar,
  type SidebarHeadingSelection,
} from "./components/layout/WorkspaceSidebar";
import { DocumentTabs } from "./components/layout/DocumentTabs";
import { ScopeStartPage } from "./components/layout/ScopeStartPage";
import { LibraryHome, type LibraryHomeItem } from "./components/layout/LibraryHome";
import {
  computeWorkStats,
  folderSignature,
  indexFolder,
  loadScopeIndex,
  normalizeLibraryWorkStats,
  searchLibraryScopes,
  type LibraryProjectOverview,
} from "./library/libraryData";
import {
  LibrarySetup,
  type LibrarySetupCandidate,
  type LibrarySetupResult,
} from "./components/startup/LibrarySetup";
import { WindowControls } from "./components/layout/WindowControls";
import { StartupPortal } from "./components/startup/StartupPortal";
import {
  createDocumentAst,
  findActiveOutlineChain,
  findCommentLineRanges,
  flattenOutline,
  hash16,
  updateDocumentAst,
} from "./editor/ast/documentAst";
import {
  applyDirectionToSelection,
  applyHeadingToSelection,
  canWrapInlineSelection,
  clearNotationFromSelection,
  normalizeSelectionRange,
  sanitizeNotationArgument,
  toggleBoldSelection,
  toggleEmphasisSelection,
  type EditorSelectionSnapshot,
  type LayoutDirection,
} from "./editor/selectionEdits";
import {
  extractHeadingSection,
  moveHeadingSections,
  type HeadingDropPosition,
} from "./editor/ast/headingMove";
import { reconcileSavedDocumentTabs } from "./editor/documentTabState";
import { createMarkdownTable, tableAtOffset, tableAlignmentEdit } from "./editor/markdownTables";
import { toggleLineComments } from "./editor/lineComments";
import { mapTextOffsetThroughChange } from "./editor/textOffsetMapping";
import { recordImportedProject } from "./utils/library";
import {
  plotCardReferencePaths,
  rewritePlotCard,
  rewriteThreadItems,
  threadItemReferencePaths,
  type ReferenceRewrite,
} from "./utils/libraryTransfer";
import { displayedCharacterCount } from "./editor/ast/characterCount";
import {
  createWorkspaceDocumentTabs,
  normalizeWorkspaceDocumentTabs,
  reconcileWorkspaceDocumentTabs,
  workspaceDocumentTabsKey,
} from "./editor/workspaceDocumentTabs";
import {
  collectProjectTextFiles,
  createProjectAstSkeleton,
  markProjectAstFileError,
  removeProjectAstPaths,
  searchDocumentAstFullText,
  searchProjectAstFullTextWithOptions,
  upsertProjectAstDocument,
  upsertProjectAstDocumentAst,
  upsertProjectAstDocumentAsts,
} from "./editor/ast/projectAst";
import {
  replaceTextSearchMatches,
  type TextSearchOptions,
} from "./search/textSearch";
import {
  PlotPane,
  PlotPaneHeaderActions,
} from "./components/plot/PlotPane";
import {
  CANVAS_LIVE_DATA_EVENT,
  createCanvasDocument,
  createCanvasEdge,
  createCanvasGroupNode,
  createCanvasTextNode,
  normalizeCanvasDocument,
  type CanvasBoardSummary,
  type CanvasCopyToIdeaRequest,
  type CanvasCopyToPlotRequest,
  type CanvasFocusIdeaRequest,
  type CanvasLiveDataEvent,
  type CanvasNode,
  type CanvasScope,
  type CanvasWindowPayload,
  type JsonCanvasDocument,
} from "./canvasTypes";
import {
  appendPlotChapter,
  appendPlotSection,
  renumberPlotCards,
  replacePlotReferencePath,
} from "./components/plot/plotCardUtils";
import { ReferenceLayer } from "./components/references/ReferenceLayer";
import { BinderPane } from "./components/binder/BinderPane";
import { OpenCardsPane } from "./components/binder/OpenCardsPane";
import {
  alignIdeaLayoutToMode,
  countIdeaReferenceLinks,
  ideaThreadItemKey,
  makeReferenceLink,
  normalizedReferenceKey,
  reconcileIdeaThreadLayouts,
} from "./ideaReferenceModel";
import {
  defaultIdeaThreads,
  normalizeIdeaThreads,
} from "./ideaThreadModel";
import { createIdeaThreadActions } from "./ideaThreadActions";
import ProofreadPane from "./components/proofread/ProofreadPane";
import { PROOFREAD_RULES } from "./proofread/rules";
import { DEFAULT_PROOFREAD_OPTIONS } from "./proofread/types";
import {
  collectProtectedSurfaces,
  normalizeProofreadTerms,
  type ProofreadTerm,
} from "./proofread/terms";
import { QuickIdeaModal } from "./components/snippets/QuickIdeaModal";
import { StatusBar } from "./components/status/StatusBar";
import type {
  DocumentAst,
  DocumentOutlineItem,
  ProjectAst,
  ProjectSearchOutcome,
  ProjectSearchResult,
} from "./editor/ast/types";
import type {
  AppDialog,
  AppState,
  BinderCardState,
  BreadcrumbDropTarget,
  CursorPosition,
  DeleteProjectEntryPlan,
  DeleteProjectEntryResult,
  DocumentTab,
  EditorSettings,
  FileProgressStatus,
  FlatOutlineItem,
  FontOption,
  IdeaOriginRef,
  IdeaReferenceLink,
  IdeaThread,
  IdeaThreadLayout,
  ManuscriptSnapshot,
  ManuscriptSnapshotFile,
  OutlineItem,
  PlotCard,
  ProjectEntry,
  FolderInspection,
  LibraryProjectSummary,
  WorkMeta,
  WorkStatus,
  ProjectFolder,
  ProjectImportReport,
  ProofreadSettings,
  ReferenceCardState,
  ReferenceFileInfo,
  ReferenceKind,
  ReferenceLayout,
  ReferenceScope,
  IdeaBinderCardState,
  OtherIdeaLayout,
  SaveStatus,
  TextDocument,
  TextTemplateSummary,
  WorkspaceAlert,
  WorkspaceDocumentTabs,
  WorkspaceRecord,
} from "./types";
import { isIdeaBinderCard, isReferenceBinderCard, workStatusLabels } from "./types";
import { normalizeManuscriptSettings } from "./editor/manuscriptLayout";
import { trackZoneRightHover } from "./utils/zoneRightHover";
import {
  fileProgressStatuses,
  DEFAULT_MANUSCRIPT_SETTINGS,
  DEFAULT_EDITOR_MEASURE_PERCENT,
  EDITOR_MEASURE_PERCENT_MAX,
  EDITOR_MEASURE_PERCENT_MIN,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_MAX,
} from "./types";
import {
  parseFrontMatter,
  replaceFrontMatter,
  updateMarkdownBody,
  updateMarkdownBodyDetailed,
} from "./utils/frontmatter";
import {
  findContainingFolderPath,
  findFirstTextFile,
  findPathToEntry,
  findProjectEntry,
  getBreadcrumbFolderNavigation,
  getFolderChildren,
  getParentPath,
  getVisibleWorkspaceFolderTreeRows,
  getWorkspaceName,
  isPathSameOrInside,
  retargetFilesystemPath,
  movePathInOrder,
  movePathToDropPosition,
  movePathsToDropPosition,
  recordOpenedWorkspace,
  scopeDisplayName,
  replaceFolderChildren,
} from "./utils/projectTree";
import { logHeadingDnd } from "./utils/headingDndDiagnostics";
import { getScaledFixedMenuPosition } from "./utils/contextMenuPosition";
import {
  exportFontFamilies,
  type LoadedExportSource,
} from "./export/types";
import { createLoadedExportSource } from "./export/exportSource";
import CanvasWindowApp from "./CanvasWindowApp";
import IntermediateDraftPane from "./components/canvas/IntermediateDraftPane";
import type { DraftCanvasContext } from "./intermediateDraft";
import { LinkedExportScreen } from "./components/export/LinkedExportScreen";
import {
  ThenPluginRuntimeHost,
  type ThenPluginRuntimeHostHandle,
} from "./plugins/PluginRuntimeHost";
import { PluginIcon } from "./components/plugins/PluginIcon";
import {
  computeTextChange,
  createThenPluginAnchor,
  mapAnchorsThroughTextChange,
  resolveThenPluginAnchor,
} from "./plugins/anchors";
import {
  isValidThenPluginKeybinding,
  matchesThenPluginKeybinding,
} from "./plugins/keybindings";
import type {
  LoadedThenPlugin,
  ThenPluginAnchor,
  ThenPluginAnchorStore,
  ThenPluginCommand,
  ThenPluginHostRequest,
  ThenPluginIcon,
  ThenPluginManifest,
  ThenPluginModal,
  ThenPluginScreen,
  ThenPluginStatusItem,
  ThenPluginView,
} from "./plugins/types";
import {
  exportDocxWithDialog,
  exportPdfWithVivliostyle,
} from "./export/exportHostActions";

const BREADCRUMB_ENTRY_DRAG_MIME = "application/x-brew-project-entry-path";
const STORAGE_KEY = "then.app-state.v1";
const LEGACY_STORAGE_KEY = "brew.app-state.v1";
const scratchFileName = "無題.txt";
const newTabName = "新しいタブ";
const scratchWorkspaceName = "一時ファイル";
const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;
const EDITOR_CONTEXT_MENU_WIDTH = 236;
type AppMode = "write" | "canvas" | "export" | "checkpoint" | "plugin";
type ToastAction = {
  label: string;
  onClick: () => void;
};
const EDITOR_CONTEXT_MENU_HEIGHT = 322;
const defaultReferenceLayout: ReferenceLayout = {
  version: 3,
  name: "default",
  cards: [],
  recent: [],
  ideaThreads: [],
};
const PINNED_REFERENCE_Z_BASE = 10000;
const NORMAL_REFERENCE_Z_LIMIT = PINNED_REFERENCE_Z_BASE - 1;
const MAX_RECENT_REFERENCES = 30;
const PROJECT_AST_INDEX_BATCH_SIZE = 12;

type WorkspaceSearchScope = "file" | "project" | "library";

type BreadcrumbOverflowItem =
  | { kind: "folder" | "file"; name: string; path: string }
  | { kind: "outline"; item: DocumentOutlineItem }
  | { kind: "scratch"; name: string };

type EditorContextMenuState = EditorSelectionSnapshot & {
  x: number;
  y: number;
};

type EditorFindMatch = {
  id: string;
  from: number;
  to: number;
  line: number;
  column: number;
  excerpt: string;
};

type EditorFindState = {
  open: boolean;
  query: string;
  replaceValue: string;
  showReplace: boolean;
  activeIndex: number;
};

type QueuedDocumentSave = {
  tabId: string;
  path: string;
  content: string;
  /** The recorded change `content` is the result of (see saveJournal). */
  journalPosition?: number | null;
  waiters: Array<{
    resolve: (document: TextDocument) => void;
    reject: (error: unknown) => void;
  }>;
};

type DocumentSaveRequest = Omit<QueuedDocumentSave, "waiters">;

type DocumentSaveQueue = {
  running: boolean;
  pending: QueuedDocumentSave | null;
};

type HeadingMoveDocuments = {
  documents: TextDocument[];
};

type HeadingExtractDocuments = {
  sourceDocument: TextDocument;
  extractedDocument: TextDocument;
};

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

type ProjectFileProgressState = {
  fileProgress: Record<string, FileProgressStatus>;
  revision: number;
  migratedCount: number;
  contentHash: string;
  rebased: boolean;
};

type CheckpointLoadResult = {
  snapshots: ManuscriptSnapshot[];
  warnings: string[];
  migratedCount: number;
  migrationComplete: boolean;
};

type PortableStoreVersion = {
  revision: number;
  contentHash: string;
};

function portableProjectKey(rootPath: string): string {
  return workspaceDocumentTabsKey(rootPath);
}

function detectPortableProjectConflict(
  knownProgress: PortableStoreVersion | undefined,
  nextProgress: ProjectFileProgressState,
  knownSnapshots: ManuscriptSnapshot[],
  nextSnapshots: ManuscriptSnapshot[],
): string | null {
  if (knownProgress) {
    if (nextProgress.revision < knownProgress.revision) {
      return "同期されたproject.jsonが、すでに確認した版より古くなっています。同期完了を待って再読込してください。";
    }
    if (
      nextProgress.revision === knownProgress.revision &&
      knownProgress.contentHash &&
      nextProgress.contentHash &&
      knownProgress.contentHash !== nextProgress.contentHash
    ) {
      return "project.jsonに同じrevisionの異なる内容が見つかりました。競合コピーを確認してください。";
    }
  }

  return detectPortableCheckpointConflict(knownSnapshots, nextSnapshots);
}

function detectPortableCheckpointConflict(
  knownSnapshots: ManuscriptSnapshot[],
  nextSnapshots: ManuscriptSnapshot[],
  allowAllRemoved = false,
): string | null {
  if (!allowAllRemoved && knownSnapshots.length > 0 && nextSnapshots.length === 0) {
    return "チェックポイントが一度にすべて見えなくなりました。クラウド同期またはファイル取得の完了を待って再読込してください。";
  }
  const nextById = new Map(nextSnapshots.map((snapshot) => [snapshot.id, snapshot] as const));
  for (const known of knownSnapshots) {
    const next = nextById.get(known.id);
    if (!next) continue;
    if (next.revision < known.revision) {
      return `チェックポイント「${known.label}」が既知の版より古くなっています。同期完了を待って再読込してください。`;
    }
    if (
      next.revision === known.revision &&
      known.storageHash &&
      next.storageHash &&
      known.storageHash !== next.storageHash
    ) {
      return `チェックポイント「${known.label}」に同じrevisionの異なる内容が見つかりました。競合コピーを確認してください。`;
    }
  }
  return null;
}

function portableStorageErrorMessage(error: unknown): string {
  const message = String(error);
  if (/rollback conflict|branch conflict|content conflict|revision conflict/i.test(message)) {
    return "プロジェクトの管理データに食い違いがあるため保存を止めました。現在の作業を保全し、フォルダの状態を確認してください。";
  }
  if (/access is denied|permission denied|read-only|readonly|os error 5|アクセスが拒否|書き込み禁止|読み取り専用/i.test(message)) {
    return "プロジェクト状態が読み取り専用です。クラウドストレージやフォルダの権限を確認してください。";
  }
  if (/offline|placeholder|not available|cloud file|network|os error 362|os error 1168|オフライン|クラウド.?ファイル|利用できません/i.test(message)) {
    return "プロジェクトの管理データを読み込めません。ファイルの取得が完了しているか確認してから再試行してください。";
  }
  if (/failed to (read|inspect)|読み込めませんでした/i.test(message)) {
    return "必要なファイルを読み込めません。空の状態として扱わず、元のデータを上書きしません。ファイルが利用可能になったら再試行してください。";
  }
  if (/failed to (parse|decode)|unsupported .*schema version|project-relative path/i.test(message)) {
    return "プロジェクトの管理データを確認できません。空の状態で上書きせず、保存を止めました。元のファイルとバックアップを確認してください。";
  }
  return "プロジェクトの管理データを読み書きできませんでした。フォルダの状態を確認してください。";
}

function checkpointWarningMessage(warning: string): string {
  if (/access is denied|permission denied|read-only|readonly|os error 5|アクセスが拒否|書き込み禁止|読み取り専用|offline|placeholder|not available|cloud file|network|os error 362|os error 1168|オフライン|クラウド.?ファイル|利用できません/i.test(warning)) {
    return portableStorageErrorMessage(warning);
  }
  return `チェックポイントの警告: ${warning}`;
}

type NotationModalState =
  | {
      type: "ruby";
      selection: EditorSelectionSnapshot;
      reading: string;
      error: string;
    }
  | {
      type: "direction";
      selection: EditorSelectionSnapshot;
    };

const customNotationSpecs = [
  {
    id: "ruby",
    label: "ルビ",
    syntax: "[本文(rb,ルビ)]",
    description: "選択範囲に読みを付けます",
  },
  {
    id: "tcy",
    label: "縦中横",
    syntax: "[本文(tcy)]",
    description: "選択範囲を縦書き中の横組みにします",
  },
  {
    id: "emphasis",
    label: "圏点",
    syntax: "[本文(em,goma)]",
    description: "選択範囲に圏点を付けます",
  },
  {
    id: "direction",
    label: "文章方向",
    syntax: "[(al:start|center|end)]",
    description: "右クリック位置または選択範囲を含む行の文末に配置指示を付けます",
  },
] as const;

const directionOptions: Array<{
  value: LayoutDirection;
  label: string;
  description: string;
}> = [
  { value: "start", label: "行頭", description: "対象行の文末に行頭揃え指示を付けます" },
  { value: "center", label: "中央", description: "対象行の文末に中央揃え指示を付けます" },
  { value: "end", label: "行末", description: "対象行の文末に行末揃え指示を付けます" },
];

type AppIconName =
  | "book"
  | "canvas"
  | "checkpointAdd"
  | "chevronDown"
  | "export"
  | "file"
  | "files"
  | "folder"
  | "folderPlus"
  | "fullscreen"
  | "fullscreenExit"
  | "history"
  | "horizontal"
  | "menu"
  | "openExternal"
  | "panelLeft"
  | "panelRight"
  | "plus"
  | "reference"
  | "search"
  | "settings"
  | "theme"
  | "vertical"
  | "write";

function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
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
    case "canvas":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="7" height="6" rx="1.5" />
          <rect x="13" y="13" width="7" height="6" rx="1.5" />
          <path d="M11 8h3.5A2.5 2.5 0 0 1 17 10.5V13" />
          <path d="M13 16H9.5A2.5 2.5 0 0 1 7 13.5V11" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "export":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h6" />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h5" />
          <path d="M9 22h9a3 3 0 0 0 3-3V9" />
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
          <path d="M12 10v6M9 13h6" />
        </svg>
      );
    case "fullscreen":
      return (
        <svg {...common}>
          <path d="M8 3H3v5" />
          <path d="M16 3h5v5" />
          <path d="M21 16v5h-5" />
          <path d="M8 21H3v-5" />
        </svg>
      );
    case "fullscreenExit":
      return (
        <svg {...common}>
          <path d="M3 9h6V3" />
          <path d="M21 9h-6V3" />
          <path d="M15 21v-6h6" />
          <path d="M9 21v-6H3" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
          <path d="M3.5 4.5v4h4" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      );
    case "checkpointAdd":
      return (
        <svg {...common}>
          <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
          <path d="M12 7.5v5M9.5 10h5" />
        </svg>
      );
    case "horizontal":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h10" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
    case "openExternal":
      return (
        <svg {...common}>
          <path d="M14 4h6v6" />
          <path d="M20 4 11 13" />
          <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
      );
    case "panelLeft":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      );
    case "panelRight":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M15 3v18" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "reference":
      return (
        <svg {...common}>
          <path d="M7 3.5h7l3 3V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
          <path d="M14 3.5V7h3.5" />
          <path d="M9 11h6" />
          <path d="M9 14h6" />
          <path d="M9 17h4" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="7.25" />
          <path d="m16 16 5 5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.06V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1.03 1.54 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.94 10H21a2 2 0 1 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15z" />
        </svg>
      );
    case "theme":
      return (
        <svg {...common}>
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="7.5" cy="10.5" r="2.5" />
          <circle cx="16.5" cy="14.5" r="2.5" />
          <path d="M12 22a9 9 0 1 1 8.8-10.9 2.4 2.4 0 0 1-2.35 2.9H17a2 2 0 0 0 0 4h.35A2.4 2.4 0 0 1 19.7 21 9.1 9.1 0 0 1 12 22z" />
        </svg>
      );
    case "vertical":
      return (
        <svg {...common}>
          <path d="M7 4v16" />
          <path d="M12 4v16" />
          <path d="M17 4v10" />
        </svg>
      );
    case "write":
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M15 3v5h4" />
          <path d="M8 12h8M8 16h6" />
        </svg>
      );
    default:
      return null;
  }
}

function debugLog(message: string, data?: unknown): void {
  if (!import.meta.env.DEV) return;
  const timestamp = new Date().toISOString();
  if (data === undefined) {
    console.log(`[folder-debug] ${timestamp} ${message}`);
    return;
  }

  console.log(`[folder-debug] ${timestamp} ${message}`, data);
}

// 右サイドバーの切り替え先。ヘッダー左端のプルダウンに「アイコン＋機能名」で並べる。
const EMPTY_WORKSPACE_SEARCH: ProjectSearchOutcome = {
  results: [],
  total: 0,
  matchedFileCount: 0,
  truncated: false,
  error: null,
};

const rightSidebarBuiltinTabs: Array<{ id: string; label: string; icon: ReactNode }> = [
  {
    id: "idea",
    label: "バインダー",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M8.4 14.6c-1.7-1.2-2.6-3-2.6-5.1A6.2 6.2 0 0 1 12 3.3a6.2 6.2 0 0 1 6.2 6.2c0 2.1-.9 3.9-2.6 5.1-.8.6-1.2 1.3-1.3 2.2H9.7c-.1-.9-.5-1.6-1.3-2.2Z" />
      </svg>
    ),
  },
  {
    id: "plot",
    label: "プロット",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M4 5.5c2.3-.9 4.8-.6 8 1.1v12c-3.2-1.7-5.7-2-8-1.1v-12Z" />
        <path d="M20 5.5c-2.3-.9-4.8-.6-8 1.1v12c3.2-1.7 5.7-2 8-1.1v-12Z" />
        <path d="M12 6.6v12" />
        <path d="M6.5 8.8c1.1-.1 2.2.1 3.4.7" />
        <path d="M17.5 8.8c-1.1-.1-2.2.1-3.4.7" />
      </svg>
    ),
  },
  {
    id: "proof",
    label: "校正",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z" />
        <polyline points="14 3 14 7 18 7" />
        <polyline points="9 13.5 11 15.5 15 11" />
      </svg>
    ),
  },
  {
    id: "draft",
    label: "中間稿",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M8 3h9l3 3v13H8Z" />
        <path d="M4 7v15h12M11 8h6M11 12h6M11 16h4" />
      </svg>
    ),
  },
  {
    id: "ai",
    label: "AI",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />
        <path d="M12 8.2v4.6M9.7 10.5h4.6" />
      </svg>
    ),
  },
  {
    id: "properties",
    label: "プロパティ",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M4 6h3M4 12h3M4 18h3" />
        <path d="M10 6h10M10 12h10M10 18h6" />
      </svg>
    ),
  },
];

const documentData = {
  title: "剣士の目覚め",
};

const initialMarkdown = `# ${documentData.title}

夜明け前の静寂の中、エリアスは汗ばんだ額を拭いながら起き上がった。また同じ夢だった。蒼穹の封印の扉、その向こうから響く無数の叫び声。

十七年間、一度も会ったことのない父の声も、その中に混じっているような気がした。

窓の外では、ハルト村の朝が静かに始まろうとしていた。鶏の鳴き声、パン屋の煙突から立ち上る煙。いつもと変わらぬ光景のはずなのに、今日は何かが違った。

壁に掛けてあった祖父の形見の剣が、微かに光を放っていた。

> 「また始まったか」
`;

const defaultPlotCards: PlotCard[] = [
  {
    id: "plot-1",
    kind: "section",
    num: "001",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
    managerCollapsed: false,
  },
  {
    id: "plot-2",
    kind: "section",
    num: "002",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
    managerCollapsed: false,
  },
  {
    id: "plot-3",
    kind: "section",
    num: "003",
    title: "縦書きプロットテストです",
    body: "これは縦書きプロットテストです。ちゃんと書けていることを確かめるためにあります。",
    expanded: false,
    managerCollapsed: false,
  },
];

const hiraginoCssFontFamilyAliases = new Map<string, string[]>([
  ["ヒラギノ角ゴ Pro W3", ["Hiragino Kaku Gothic Pro", "ヒラギノ角ゴ Pro"]],
  ["ヒラギノ角ゴ Pro W6", ["Hiragino Kaku Gothic Pro", "ヒラギノ角ゴ Pro"]],
  ["ヒラギノ角ゴ Std W8", ["Hiragino Kaku Gothic Std", "ヒラギノ角ゴ Std"]],
  ["ヒラギノ明朝 Pro W3", ["Hiragino Mincho Pro", "ヒラギノ明朝 Pro"]],
  ["ヒラギノ明朝 Pro W6", ["Hiragino Mincho Pro", "ヒラギノ明朝 Pro"]],
]);

function resolveCssFontFamilyAlias(family: string): string | null {
  const label = unquoteSingleCssFontFamily(family) ?? family.trim();
  const aliases = hiraginoCssFontFamilyAliases.get(label);
  return aliases ? aliases.map(quoteCssFontFamily).join(", ") : null;
}

function toCssFontFamilyValue(family: string): string {
  return resolveCssFontFamilyAlias(family) ?? quoteCssFontFamily(family.trim());
}

/**
 * 文字表示幅（百分率）の保存値を正規化する。範囲外は旧形式
 * （px 絶対値や null=最大）の名残とみなし、既定値へ戻す。
 */
function normalizeEditorMeasure(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= EDITOR_MEASURE_PERCENT_MIN &&
    value <= EDITOR_MEASURE_PERCENT_MAX
  ) {
    return Math.round(value);
  }
  return DEFAULT_EDITOR_MEASURE_PERCENT;
}

function normalizeStoredFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;

  const fontFamily = value.trim();
  if (!fontFamily) return fallback;
  const alias = resolveCssFontFamilyAlias(fontFamily);
  if (alias) return alias;
  if (fontFamily.startsWith('"') || fontFamily.startsWith("'") || fontFamily.includes(",")) {
    return fontFamily;
  }

  return toCssFontFamilyValue(fontFamily);
}

function createFontOptions(fontFamilies: string[]): FontOption[] {
  const uniqueFamilies = new Map<string, FontOption>();

  for (const fontFamily of fontFamilies) {
    const label = fontFamily.trim();
    if (!label || uniqueFamilies.has(label)) continue;
    uniqueFamilies.set(label, {
      label,
      cssFamily: toCssFontFamilyValue(label),
    });
  }

  return Array.from(uniqueFamilies.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

const defaultSettings: EditorSettings = {
  theme: "dark",
  editorFontFamily: toCssFontFamilyValue("Noto Serif JP"),
  uiFontFamily: toCssFontFamilyValue("Segoe UI"),
  uiFontScale: 1,
  exportFontFamily: "Noto Serif CJK JP",
  fontSize: 15,
  lineHeight: 1.82,
  editorMeasureHorizontal: DEFAULT_EDITOR_MEASURE_PERCENT,
  editorMeasureVertical: DEFAULT_EDITOR_MEASURE_PERCENT,
  writingMode: "vertical-rl",
  editorDisplayMode: "continuous",
  pageFlowDirection: "horizontal-rtl",
  manuscript: DEFAULT_MANUSCRIPT_SETTINGS,
  canvasDefaultWritingMode: "horizontal-tb",
  canvasDefaultFontSource: "ui",
  plotFontSource: "editor",
  startPageFontSource: "ui",
  headingFontSource: "body",
  headingFontFamily: toCssFontFamilyValue("Noto Sans JP"),
  typewriterScroll: true,
  showTypewriterGuide: true,
  typewriterOffset: 46,
  showLineBreakMarks: false,
  showLineNumbers: false,
  highlightCurrentLine: false,
  colorizeJapaneseQuotes: false,
  showComments: true,
  snippetStorageMode: "workspace",
  showWorkspacePaths: true,
  showStatusFilePath: false,
  showDocumentTabs: true,
  documentTabsDisplayMode: "always",
  skipStartupPortal: false,
  focusModeUsesNativeFullscreen: false,
  sidebarHoverMode: "none",
  zoneModeOpacity: 0.42,
  countWhitespace: true,
  countCode: true,
  showOutlineGuides: true,
  checkpointSectionCollapsed: false,
  showCheckpointSection: true,
  showCheckpointStatus: true,
  canvasOpensInWindow: false,
  exportOpensInWindow: false,
  proofread: { ...DEFAULT_PROOFREAD_OPTIONS, disabledRules: [] },
  ai: DEFAULT_AI_SETTINGS,
};

const fallbackFontFamilies = [
  "Noto Serif JP",
  "Yu Mincho",
  "Yu Gothic",
  "BIZ UDMincho",
  "BIZ UDPMincho",
  "BIZ UDGothic",
  "BIZ UDPGothic",
  "Consolas",
  "Segoe UI",
];

const fallbackFontOptions = createFontOptions(fallbackFontFamilies);

function createScratchDocumentTab(
  markdown = "",
  options: Partial<
    Pick<DocumentTab, "id" | "documentKey" | "name" | "saveStatus" | "savedMarkdown">
  > = {},
): DocumentTab {
  const id = options.id ?? `scratch-${Date.now()}`;
  return {
    id,
    kind: "scratch",
    path: null,
    fileId: null,
    contentHash: null,
    name: options.name ?? scratchFileName,
    markdown,
    savedMarkdown: options.savedMarkdown ?? "",
    editorRevision: null,
    saveStatus: options.saveStatus ?? "dirty",
    documentKey: options.documentKey ?? id,
    activeOutlineLine: null,
    viewportState: null,
  };
}

/** 文書を一つも開いていない状態を表すタブ。タブ帯には出ない。 */
function createEmptyDocumentTab(): DocumentTab {
  const id = `empty-${Date.now()}`;
  return {
    ...createScratchDocumentTab("", { id, documentKey: id, saveStatus: "saved" }),
    kind: "empty",
    name: "",
  };
}

const withoutEmptyTabs = (tabs: DocumentTab[]) => tabs.filter((tab) => tab.kind !== "empty");

/** 新しいタブは、アクティブなタブのすぐ右に置く。基準が見つからなければ末尾。 */
function insertTabAfter(tabs: DocumentTab[], nextTab: DocumentTab, anchorTabId: string | null) {
  const visible = withoutEmptyTabs(tabs);
  const anchorIndex = anchorTabId ? visible.findIndex((tab) => tab.id === anchorTabId) : -1;
  if (anchorIndex < 0) return [...visible, nextTab];
  return [...visible.slice(0, anchorIndex + 1), nextTab, ...visible.slice(anchorIndex + 1)];
}

/** 閉じたタブを開き直すときのための記録。保存先のあるファイルタブだけを残す。 */
type ClosedDocumentTab = {
  workspacePath: string | null;
  path: string;
  index: number;
  viewportState: DocumentTab["viewportState"];
};

const CLOSED_DOCUMENT_TAB_LIMIT = 10;

function isClosedTabInWorkspace(record: ClosedDocumentTab, workspacePath: string | null) {
  if (!record.workspacePath || !workspacePath) return record.workspacePath === workspacePath;
  return isSamePath(record.workspacePath, workspacePath);
}

function normalizePathForCompare(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function pluginDocumentPath(rootPath: string, absolutePath: string): string | null {
  const root = normalizePathForCompare(rootPath);
  const target = normalizePathForCompare(absolutePath);
  if (target === root || !target.startsWith(`${root}\\`)) return null;
  return absolutePath
    .replace(/[\\/]+/g, "/")
    .slice(rootPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "").length + 1);
}

function pluginPermissionForMethod(method: string): ThenPluginManifest["permissions"][number] | null {
  if (method === "editor.getSelection") return "document:selection";
  if (method === "editor.moveCursor") return "document:navigate";
  if (method.startsWith("anchors.")) return "document:anchors";
  if (method.startsWith("views.")) return "views";
  if (method.startsWith("statusbar.")) return "statusbar";
  if (method.startsWith("storage.")) return "storage";
  if (method.startsWith("commands.")) return "commands";
  return null;
}

function objectArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pluginViewIcon(value: unknown): ThenPluginIcon | undefined {
  if (value === undefined) return undefined;
  const icon = objectArgs(value);
  const paths = icon.paths;
  const isValid = Array.isArray(paths)
    && paths.length >= 1
    && paths.length <= 8
    && paths.every((path) =>
      typeof path === "string"
      && path.trim().length >= 1
      && path.length <= 1024
      && /^[A-Za-z0-9\s.,+-]+$/.test(path),
    );
  if (!isValid) {
    throw new Error("view iconは1〜8本のSVG path dataで指定してください");
  }
  return { paths: paths as string[] };
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

function isPathInsideFolder(path: string, folderPath: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedFolder = normalizePathForCompare(folderPath);
  return (
    normalizedPath !== normalizedFolder &&
    normalizedPath.startsWith(`${normalizedFolder}\\`)
  );
}

function toProjectRelativePath(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/[\\/]+/g, "/");
  if (normalizedPath.toLocaleLowerCase().startsWith(`${normalizedRoot.toLocaleLowerCase()}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

function createFileDocumentTab(document: TextDocument): DocumentTab {
  return {
    id: `file:${document.path}`,
    kind: "file",
    path: document.path,
    fileId: document.fileId ?? null,
    contentHash: document.contentHash ?? null,
    name: document.name,
    markdown: document.content,
    savedMarkdown: document.content,
    editorRevision: null,
    saveStatus: "saved",
    documentKey: document.path,
    activeOutlineLine: null,
    viewportState: null,
  };
}

type LoadedWorkspaceDocumentTabs = {
  tabs: DocumentTab[];
  activeIndex: number;
  moved: Array<{ name: string; oldPath: string; newPath: string }>;
  missingNames: string[];
};

async function loadWorkspaceDocumentTabs(
  folder: ProjectFolder,
  session: WorkspaceDocumentTabs,
): Promise<LoadedWorkspaceDocumentTabs> {
  const reconciliation = reconcileWorkspaceDocumentTabs(session, folder);
  const loaded: Array<{ tab: DocumentTab; sourceIndex: number }> = [];
  const missingNames = reconciliation.missing.map((tab) => tab.name);
  const movedPaths = new Set(
    reconciliation.moved.map((move) => normalizePathForCompare(move.newPath)),
  );

  for (const match of reconciliation.restored) {
    try {
      const document = await invoke<TextDocument>("read_text_file", {
        path: match.entry.path,
      });
      loaded.push({
        sourceIndex: match.sourceIndex,
        tab: {
          ...createFileDocumentTab(document),
          activeOutlineLine: match.savedTab.activeOutlineLine,
          viewportState: match.savedTab.viewportState,
        },
      });
    } catch {
      missingNames.push(match.savedTab.name);
      movedPaths.delete(normalizePathForCompare(match.entry.path));
    }
  }

  let activeIndex = loaded.findIndex((item) => item.sourceIndex === session.activeIndex);
  if (activeIndex < 0) activeIndex = loaded.findIndex((item) => item.sourceIndex > session.activeIndex);
  if (activeIndex < 0 && loaded.length) activeIndex = loaded.length - 1;

  return {
    tabs: loaded.map((item) => item.tab),
    activeIndex: Math.max(0, activeIndex),
    moved: reconciliation.moved.filter((move) =>
      movedPaths.has(normalizePathForCompare(move.newPath)),
    ),
    missingNames,
  };
}

function isDirtyDocumentTab(tab: DocumentTab): boolean {
  return (
    tab.saveStatus === "dirty" ||
    tab.saveStatus === "error" ||
    tab.markdown !== tab.savedMarkdown
  );
}

function createDefaultState(): AppState {
  const threads = defaultIdeaThreads();
  return {
    markdown: initialMarkdown,
    snippets: threads,
    profileSnippets: threads,
    settings: defaultSettings,
    rightSidebarTab: "plot",
    lastWorkspacePath: null,
    lastFilePath: null,
    recentWorkspaces: [],
    collapsedFolderPathsByWorkspace: {},
    collapsedOutlinePathsByWorkspace: {},
    collapsedOutlineHeadingKeysByWorkspace: {},
    fileProgress: {},
    fileProgressMigrationVersions: {},
    checkpointMigrationVersions: {},
    cursorPositions: {},
    proofreadTerms: [],
    documentTabsByWorkspace: {},
    snapshots: [],
    libraryWorkStats: {},
  };
}

/** 空白文字（半角・全角スペース、タブ、改行など）を除いた文字（コードポイント）。 */
const WHITESPACE_PATTERN = /[\s　]/g;

/**
 * 文字数カウント。`includeWhitespace` が false の場合は空白文字を除外する。
 * サロゲートペアを 1 文字として数えるため Array.from を用いる。
 */
function countDisplayCharacters(text: string, includeWhitespace: boolean): number {
  const target = includeWhitespace ? text : text.replace(WHITESPACE_PATTERN, "");
  return Array.from(target).length;
}

function suggestedHeadingFileName(title: string, sourcePath: string): string {
  const extensionMatch = sourcePath.match(/(\.(?:md|txt))$/i);
  const extension = extensionMatch?.[1] ?? ".txt";
  const sanitized =
    title
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/g, "")
      .trim() || "切り出した見出し";
  return `${sanitized}${extension}`;
}

function documentAstToText(documentAst: DocumentAst): string {
  return documentAst.blocks.map((block) => block.source).join("\n");
}

function restoredCopyPath(path: string, index: number): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  const hasExtension = dot > separator;
  const suffix = index === 1 ? "（復元）" : `（復元 ${index}）`;
  return hasExtension
    ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}`
    : `${path}${suffix}`;
}

function selectedSnapshotFolderTree(
  root: ProjectFolder,
  selectedFolderPaths: ReadonlySet<string>,
): ProjectFolder {
  const keepEntry = (entry: ProjectEntry): ProjectEntry | null => {
    if (entry.kind !== "folder") return null;
    const children = entry.children.flatMap((child) => {
      const kept = keepEntry(child);
      return kept ? [kept] : [];
    });
    return selectedFolderPaths.has(normalizePathForCompare(entry.path)) || children.length
      ? { ...entry, children }
      : null;
  };
  return { ...root, children: root.children.flatMap((entry) => {
    const kept = keepEntry(entry);
    return kept ? [kept] : [];
  }) };
}

async function restoreSnapshotTreeOrder(
  rootPath: string,
  tree: ProjectFolder,
  selectedFolderPaths?: ReadonlySet<string>,
): Promise<void> {
  const visit = async (folder: ProjectFolder | ProjectEntry): Promise<void> => {
    if (!selectedFolderPaths || selectedFolderPaths.has(normalizePathForCompare(folder.path))) {
      await invoke<ProjectFolder>("reorder_project_entries", {
        rootPath,
        folderPath: folder.path,
        orderedPaths: folder.children.map((entry) => entry.path),
      });
    }
    for (const child of folder.children) {
      if (child.kind === "folder") await visit(child);
    }
  };
  await visit(tree);
}

function snapshotId(prefix = "snapshot"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_AUTO_SHELTER_SNAPSHOTS = 3;

function trimAutoShelterSnapshots(
  snapshots: ManuscriptSnapshot[],
  maxCount = MAX_AUTO_SHELTER_SNAPSHOTS,
): ManuscriptSnapshot[] {
  const shelterCountsByWorkspace = new Map<string, number>();
  return snapshots
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((snapshot) => {
      if (snapshot.reason !== "auto-before-restore") return true;
      const key = normalizePathForCompare(snapshot.workspacePath);
      const count = shelterCountsByWorkspace.get(key) ?? 0;
      if (count >= maxCount) return false;
      shelterCountsByWorkspace.set(key, count + 1);
      return true;
    });
}

function normalizeSnapshots(value: unknown): ManuscriptSnapshot[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((snapshot): snapshot is Partial<ManuscriptSnapshot> =>
      Boolean(snapshot) && typeof snapshot === "object",
    )
    .map((snapshot) => {
      const files = Array.isArray(snapshot.files)
        ? snapshot.files
            .filter((file) =>
              Boolean(file) &&
              typeof file === "object" &&
              typeof file.path === "string" &&
              typeof file.name === "string" &&
              typeof file.text === "string",
            )
            .map((file) => {
              const entry = file as Partial<ManuscriptSnapshotFile> & {
                path: string;
                name: string;
                text: string;
              };
              return {
                path: entry.path,
                name: entry.name,
                text: entry.text,
                textHash:
                  typeof entry.textHash === "string" ? entry.textHash : hash16(entry.text),
                semanticHash:
                  typeof entry.semanticHash === "string"
                    ? entry.semanticHash
                    : hash16(entry.text),
                lineCount:
                  typeof entry.lineCount === "number" && Number.isFinite(entry.lineCount)
                    ? entry.lineCount
                    : entry.text.split("\n").length,
                textLength:
                  typeof entry.textLength === "number" && Number.isFinite(entry.textLength)
                    ? entry.textLength
                    : Array.from(entry.text).length,
                visibleTextLength:
                  typeof entry.visibleTextLength === "number" &&
                  Number.isFinite(entry.visibleTextLength)
                    ? entry.visibleTextLength
                    : Array.from(entry.text.replace(WHITESPACE_PATTERN, "")).length,
                outlineCount:
                  typeof entry.outlineCount === "number" && Number.isFinite(entry.outlineCount)
                    ? entry.outlineCount
                    : 0,
              };
            })
        : [];

      const workspacePath =
        typeof snapshot.workspacePath === "string" ? snapshot.workspacePath : "";
      const workspaceName =
        typeof snapshot.workspaceName === "string" ? snapshot.workspaceName : "プロジェクト";

      return {
        id: typeof snapshot.id === "string" ? snapshot.id : snapshotId(),
        revision:
          typeof snapshot.revision === "number" &&
          Number.isInteger(snapshot.revision) &&
          snapshot.revision > 0
            ? snapshot.revision
            : 1,
        storageHash: typeof snapshot.storageHash === "string" ? snapshot.storageHash : "",
        workspacePath,
        workspaceName,
        createdAt:
          typeof snapshot.createdAt === "number" && Number.isFinite(snapshot.createdAt)
            ? snapshot.createdAt
            : Date.now(),
        reason:
          snapshot.reason === "auto-before-restore" ? "auto-before-restore" : "manual",
        label:
          typeof snapshot.label === "string" && snapshot.label.trim()
            ? snapshot.label
            : "チェックポイント",
        memo: typeof snapshot.memo === "string" ? snapshot.memo : "",
        parentIds: Array.isArray(snapshot.parentIds)
          ? snapshot.parentIds.filter((id): id is string => typeof id === "string")
          : [],
        projectTree:
          snapshot.projectTree &&
          typeof snapshot.projectTree === "object" &&
          typeof snapshot.projectTree.path === "string" &&
          typeof snapshot.projectTree.name === "string" &&
          Array.isArray(snapshot.projectTree.children)
            ? snapshot.projectTree
            : { path: workspacePath, name: workspaceName, children: [] },
        files,
        fileCount:
          typeof snapshot.fileCount === "number" && Number.isFinite(snapshot.fileCount)
            ? snapshot.fileCount
            : files.length,
        totalTextLength:
          typeof snapshot.totalTextLength === "number" && Number.isFinite(snapshot.totalTextLength)
            ? snapshot.totalTextLength
            : files.reduce((sum, file) => sum + file.textLength, 0),
        totalVisibleTextLength:
          typeof snapshot.totalVisibleTextLength === "number" &&
          Number.isFinite(snapshot.totalVisibleTextLength)
            ? snapshot.totalVisibleTextLength
            : files.reduce((sum, file) => sum + file.visibleTextLength, 0),
      } satisfies ManuscriptSnapshot;
    })
    .filter((snapshot) => snapshot.workspacePath && snapshot.files.length > 0);

  return trimAutoShelterSnapshots(normalized);
}


function normalizePlotCards(value: unknown): PlotCard[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((card): card is Partial<PlotCard> & { id: string } =>
      Boolean(card) && typeof card === "object" && typeof card.id === "string",
    )
    .map((card, index) => {
      const kind = card.kind === "chapter" ? "chapter" : "section";
      return {
        id: card.id,
        kind,
        num:
          kind === "chapter"
            ? ""
            : typeof card.num === "string" && card.num.trim()
              ? card.num
              : String(index + 1).padStart(3, "0"),
        title: typeof card.title === "string" ? card.title : "",
        body: typeof card.body === "string" ? card.body : "",
        expanded: Boolean(card.expanded),
        managerCollapsed: Boolean(card.managerCollapsed),
      };
    });
}

function referenceKindFromPath(path: string): ReferenceKind {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  if (extension === "txt") return "text";
  if (extension === "md") return "markdown";
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") {
    return "image";
  }
  if (extension === "pdf") return "pdf";
  return "unknown";
}

function referenceNameFromPath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;
}

function normalizeReferenceScope(scope: unknown): ReferenceScope {
  return scope === "global" ? "global" : "project";
}

function referenceKey(sourcePath: string, scope: ReferenceScope = "project"): string {
  return `${scope}:${sourcePath.replace(/[\\]+/g, "/").toLocaleLowerCase()}`;
}

function referenceFileKey(file: Pick<ReferenceFileInfo, "sourcePath" | "scope">): string {
  return referenceKey(file.sourcePath, file.scope);
}

function referenceCardKey(card: Pick<ReferenceCardState, "sourcePath" | "scope">): string {
  return referenceKey(card.sourcePath, card.scope);
}

function isReferenceFileInfo(value: unknown): value is ReferenceFileInfo {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Record<keyof ReferenceFileInfo, unknown>>;
  return (
    typeof record.sourcePath === "string" &&
    typeof record.name === "string" &&
    (record.kind === "text" ||
      record.kind === "markdown" ||
      record.kind === "image" ||
      record.kind === "pdf" ||
      record.kind === "unknown") &&
    typeof record.size === "number"
  );
}

function makeReferenceFileInfo(
  sourcePath: string,
  kind: ReferenceKind = referenceKindFromPath(sourcePath),
  scope: ReferenceScope = "project",
): ReferenceFileInfo {
  return {
    scope,
    sourcePath,
    name: referenceNameFromPath(sourcePath),
    kind,
    size: 0,
    imported: sourcePath.replace(/[\\]+/g, "/").startsWith(".then/references/imports/"),
  };
}

function mergeReferenceFiles(...groups: ReferenceFileInfo[][]): ReferenceFileInfo[] {
  const merged = new Map<string, ReferenceFileInfo>();
    for (const group of groups) {
    for (const file of group) {
      const key = referenceFileKey(file);
      if (!merged.has(key)) merged.set(key, file);
    }
  }
  return [...merged.values()];
}

function upsertRecentReference(
  layout: ReferenceLayout,
  file: ReferenceFileInfo,
): ReferenceLayout {
  const key = referenceFileKey(file);
  return {
    ...layout,
    recent: [
      file,
      ...layout.recent.filter((item) => referenceFileKey(item) !== key),
    ].slice(0, MAX_RECENT_REFERENCES),
  };
}

function upsertRecentReferences(
  layout: ReferenceLayout,
  files: ReferenceFileInfo[],
): ReferenceLayout {
  return files.reduce((current, file) => upsertRecentReference(current, file), layout);
}

function retargetReferenceSourcePath(
  sourcePath: string,
  oldSourcePath: string,
  newSourcePath: string,
): string | null {
  const normalizedSourcePath = sourcePath.replace(/\\/g, "/");
  const normalizedOldPath = oldSourcePath.replace(/\\/g, "/");
  const normalizedNewPath = newSourcePath.replace(/\\/g, "/");
  if (!normalizedOldPath || !normalizedNewPath) return null;
  if (normalizedSourcePath === normalizedOldPath) return normalizedNewPath;
  if (normalizedSourcePath.startsWith(`${normalizedOldPath}/`)) {
    return `${normalizedNewPath}${normalizedSourcePath.slice(normalizedOldPath.length)}`;
  }
  return null;
}

function retargetReferenceFileInfo(
  file: ReferenceFileInfo,
  oldSourcePath: string,
  newSourcePath: string,
): ReferenceFileInfo {
  if (file.scope !== "project") return file;
  const sourcePath = retargetReferenceSourcePath(file.sourcePath, oldSourcePath, newSourcePath);
  if (!sourcePath) return file;
  return {
    ...file,
    sourcePath,
    name: referenceNameFromPath(sourcePath),
    kind: referenceKindFromPath(sourcePath),
  };
}

function retargetReferenceCard(
  card: BinderCardState,
  oldSourcePath: string,
  newSourcePath: string,
): BinderCardState {
  if (!isReferenceBinderCard(card)) return card;
  if (card.scope !== "project") return card;
  const sourcePath = retargetReferenceSourcePath(card.sourcePath, oldSourcePath, newSourcePath);
  if (!sourcePath) return card;
  return {
    ...card,
    sourcePath,
    kind: referenceKindFromPath(sourcePath),
  };
}

function referenceInitialSize(kind: ReferenceKind): Pick<ReferenceCardState, "width" | "height"> {
  if (kind === "image") return { width: 360, height: 260 };
  if (kind === "pdf") return { width: 320, height: 280 };
  return { width: 320, height: 420 };
}

function isReferenceCardRecord(
  value: unknown,
): value is Partial<ReferenceCardState> & { id: string; sourcePath: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.sourcePath === "string";
}

function isIdeaCardRecord(
  value: unknown,
): value is Partial<BinderCardState> & { id: string; sourceType: "idea"; threadId: string; fragmentId: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.sourceType === "idea" &&
    typeof record.id === "string" &&
    typeof record.threadId === "string" &&
    typeof record.fragmentId === "string"
  );
}

function clampReferenceCardToStage<T extends BinderCardState>(
  card: T,
  stageWidth: number,
  stageHeight: number,
): T {
  const width = Math.max(220, Math.min(card.width, Math.max(240, stageWidth - 24)));
  const height = Math.max(140, Math.min(card.height, Math.max(180, stageHeight - 24)));
  return {
    ...card,
    width,
    height,
    x: Math.max(0, Math.min(card.x, Math.max(0, stageWidth - width - 12))),
    y: Math.max(0, Math.min(card.y, Math.max(0, stageHeight - height - 12))),
  };
}

function normalizeReferenceLayout(
  value: unknown,
  stageSize: { width: number; height: number } = { width: 1200, height: 800 },
): ReferenceLayout {
  const raw = value as Partial<ReferenceLayout> | null;
  const cards: unknown[] = Array.isArray(raw?.cards) ? raw.cards : [];
  const recent: unknown[] = Array.isArray(raw?.recent) ? raw.recent : [];
  const toIdeaThreadLayouts = (value: unknown): IdeaThreadLayout[] =>
    Array.isArray(value)
      ? value.filter(
          (layout): layout is IdeaThreadLayout =>
            Boolean(layout) &&
            typeof layout === "object" &&
            typeof (layout as IdeaThreadLayout).threadId === "string" &&
            Array.isArray((layout as IdeaThreadLayout).items),
        )
      : [];
  const toIdeaCard = (card: unknown, index: number): IdeaBinderCardState => {
    if (!isIdeaCardRecord(card)) throw new Error("unreachable Idea card");
    return {
      id: card.id,
      sourceType: "idea",
      threadId: card.threadId,
      fragmentId: card.fragmentId,
      x: typeof card.x === "number" ? card.x : 72 + index * 32,
      y: typeof card.y === "number" ? card.y : 96 + index * 32,
      width: typeof card.width === "number" ? card.width : 320,
      height: typeof card.height === "number" ? card.height : 300,
      zIndex: typeof card.zIndex === "number" ? card.zIndex : index + 1,
      collapsed: Boolean(card.collapsed),
      pinned: Boolean(card.pinned),
    };
  };
  const ideaThreads = toIdeaThreadLayouts(raw?.ideaThreads);
  const isStorageMode = (mode: unknown): mode is EditorSettings["snippetStorageMode"] =>
    mode === "workspace" || mode === "profile";
  const ideaThreadsMode = isStorageMode(raw?.ideaThreadsMode) ? raw.ideaThreadsMode : undefined;
  const rawOther = raw?.otherIdea as Partial<OtherIdeaLayout> | undefined;
  const otherIdea: OtherIdeaLayout | undefined =
    ideaThreadsMode && rawOther && isStorageMode(rawOther.mode) && rawOther.mode !== ideaThreadsMode
      ? {
          mode: rawOther.mode,
          ideaThreads: toIdeaThreadLayouts(rawOther.ideaThreads),
          cards: (Array.isArray(rawOther.cards) ? (rawOther.cards as unknown[]) : [])
            .filter(isIdeaCardRecord)
            .map(toIdeaCard),
        }
      : undefined;
  const normalizedCards = cards
    .filter(
      (card) =>
        isIdeaCardRecord(card)
        || (isReferenceCardRecord(card) && card.scope !== "global"),
    )
    .map((card, index): BinderCardState => {
      if (isIdeaCardRecord(card)) {
        return clampReferenceCardToStage(
          toIdeaCard(card, index),
          stageSize.width,
          stageSize.height,
        );
      }
      if (!isReferenceCardRecord(card)) throw new Error("unreachable binder card");
      const kind =
        card.kind === "text" ||
        card.kind === "markdown" ||
        card.kind === "image" ||
        card.kind === "pdf" ||
        card.kind === "unknown"
          ? card.kind
          : referenceKindFromPath(card.sourcePath);
      const size = referenceInitialSize(kind);
      return clampReferenceCardToStage(
        {
          id: card.id,
          sourceType: "reference",
          scope: normalizeReferenceScope(card.scope),
          sourcePath: card.sourcePath,
          kind,
          x: typeof card.x === "number" ? card.x : 72 + index * 32,
          y: typeof card.y === "number" ? card.y : 96 + index * 32,
          width: typeof card.width === "number" ? card.width : size.width,
          height: typeof card.height === "number" ? card.height : size.height,
          zIndex: typeof card.zIndex === "number" ? card.zIndex : index + 1,
          collapsed: Boolean(card.collapsed),
          pinned: Boolean(card.pinned),
          scrollTop: typeof card.scrollTop === "number" ? card.scrollTop : undefined,
          zoom: typeof card.zoom === "number" ? card.zoom : undefined,
          page: typeof card.page === "number" ? card.page : undefined,
          editing: false,
        },
        stageSize.width,
        stageSize.height,
      );
    });
  const normalizedRecent = recent
    .filter((file): file is ReferenceFileInfo => isReferenceFileInfo(file) && file.scope !== "global")
    .map((file) => ({
      ...file,
      scope: normalizeReferenceScope(file.scope),
      imported: Boolean(file.imported),
    }));
  return {
    version: 3,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : "default",
    recent: mergeReferenceFiles(
      normalizedRecent,
      normalizedCards
        .filter(isReferenceBinderCard)
        .map((card) => makeReferenceFileInfo(card.sourcePath, card.kind, card.scope)),
    )
      .slice(0, MAX_RECENT_REFERENCES),
    cards: normalizedCards,
    ideaThreads,
    ...(ideaThreadsMode ? { ideaThreadsMode } : {}),
    ...(otherIdea ? { otherIdea } : {}),
  };
}

function nextReferenceZIndex(cards: BinderCardState[], pinned: boolean): number {
  const maxZ = cards
    .filter((card) => (pinned ? card.pinned : !card.pinned))
    .reduce((max, card) => Math.max(max, card.zIndex), pinned ? PINNED_REFERENCE_Z_BASE : 0);
  return pinned
    ? Math.max(PINNED_REFERENCE_Z_BASE, maxZ + 1)
    : Math.min(NORMAL_REFERENCE_Z_LIMIT, maxZ + 1);
}

function replaceLiteralMatches(
  text: string,
  rawQuery: string,
  replacement: string,
  includeComments: boolean,
): { text: string; count: number } {
  const query = rawQuery.trim();
  if (!query) return { text, count: 0 };

  if (!includeComments) {
    const comments = findCommentLineRanges(text);
    if (comments.length > 0) {
      // コメント行の間の区間ごとに置換し、コメント行はそのまま残す。
      const chunks: string[] = [];
      let count = 0;
      let cursor = 0;
      for (const range of [...comments, { from: text.length, to: text.length }]) {
        const segment = replaceLiteralMatches(text.slice(cursor, range.from), rawQuery, replacement, true);
        chunks.push(segment.text, text.slice(range.from, range.to));
        count += segment.count;
        cursor = range.to;
      }
      return { text: count > 0 ? chunks.join("") : text, count };
    }
  }

  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const chunks: string[] = [];
  let from = 0;
  let count = 0;

  while (from <= text.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    chunks.push(text.slice(from, index), replacement);
    from = index + query.length;
    count += 1;
  }

  if (count === 0) return { text, count: 0 };
  chunks.push(text.slice(from));
  return { text: chunks.join(""), count };
}

function replaceMarkdownBodyMatches(
  markdown: string,
  query: string,
  replacement: string,
  options: TextSearchOptions,
): { markdown: string; count: number; error: string | null } {
  const frontMatter = parseFrontMatter(markdown);
  const result = replaceTextSearchMatches(
    frontMatter.body,
    query,
    replacement,
    options,
    options.includeComments ? [] : findCommentLineRanges(frontMatter.body),
  );
  if (result.count === 0) return { markdown, count: 0, error: result.error };
  return {
    markdown: updateMarkdownBody(markdown, result.text),
    count: result.count,
    error: null,
  };
}

function collectEditorFindMatches(
  documentAst: DocumentAst,
  rawQuery: string,
  includeComments: boolean,
  maxResults = 500,
): EditorFindMatch[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  const matches: EditorFindMatch[] = [];

  for (const block of documentAst.blocks) {
    if (!includeComments && block.kind === "comment") continue;
    const source = block.source;
    const normalizedSource = source.toLocaleLowerCase();
    let from = 0;
    let matchIndex = 0;

    while (from <= normalizedSource.length) {
      const index = normalizedSource.indexOf(normalizedQuery, from);
      if (index < 0) break;

      const absoluteFrom = block.from + index;
      matches.push({
        id: `editor-find:${block.lineIndex}:${index}:${matchIndex}:${normalizedQuery}`,
        from: absoluteFrom,
        to: absoluteFrom + query.length,
        line: block.lineIndex + 1,
        column: index + 1,
        excerpt: source,
      });

      if (matches.length >= maxResults) return matches;
      from = index + Math.max(1, normalizedQuery.length);
      matchIndex += 1;
    }
  }

  return matches;
}

function normalizeCollapsedPathListsByWorkspace(
  value: unknown,
): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: Record<string, string[]> = {};
  for (const [workspacePath, folderPaths] of Object.entries(value)) {
    if (!workspacePath || !Array.isArray(folderPaths)) continue;
    normalized[workspacePath] = Array.from(
      new Set(folderPaths.filter((path): path is string => typeof path === "string" && path.length > 0)),
    );
  }
  return normalized;
}

const knownProofreadRuleIds = new Set(PROOFREAD_RULES.map((rule) => rule.id));
const knownProofreadCheckIds = new Set(
  PROOFREAD_RULES.flatMap((rule) => rule.checks?.map((check) => check.id) ?? []),
);

/**
 * 校正設定の復元。しきい値は入力欄と同じ範囲へ丸め、無くなったルールIDは捨てる。
 * ルールを削除・改名しても、保存済みの設定が指摘を丸ごと止めてしまわないようにする。
 */
function normalizeProofreadSettings(value: unknown): ProofreadSettings {
  const fallback: ProofreadSettings = { ...DEFAULT_PROOFREAD_OPTIONS, disabledRules: [] };
  if (!value || typeof value !== "object") return fallback;

  const stored = value as Partial<ProofreadSettings>;
  const clamp = (input: unknown, min: number, max: number, fallbackValue: number) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.min(max, Math.max(min, Math.round(input)))
      : fallbackValue;

  return {
    maxSentenceLength: clamp(stored.maxSentenceLength, 20, 200, fallback.maxSentenceLength),
    maxCommasPerSentence: clamp(stored.maxCommasPerSentence, 1, 12, fallback.maxCommasPerSentence),
    skipDialogue:
      typeof stored.skipDialogue === "boolean" ? stored.skipDialogue : fallback.skipDialogue,
    disabledChecks: Array.isArray(stored.disabledChecks)
      ? Array.from(
          new Set(
            stored.disabledChecks.filter(
              (checkId): checkId is string =>
                typeof checkId === "string" && knownProofreadCheckIds.has(checkId),
            ),
          ),
        )
      : [],
    disabledRules: Array.isArray(stored.disabledRules)
      ? Array.from(
          new Set(
            stored.disabledRules.filter(
              (ruleId): ruleId is string =>
                typeof ruleId === "string" && knownProofreadRuleIds.has(ruleId),
            ),
          ),
        )
      : [],
  };
}

function normalizeState(value: Partial<AppState> | null | undefined): AppState {
  const rawSettings = (value?.settings ?? {}) as Partial<EditorSettings> & {
    /** v0.6.1以前の保存形式。trueは左右ともホバー表示。 */
    zoneMode?: unknown;
  };
  const { zoneMode: legacyZoneMode, ...settings } = rawSettings;
  const recentWorkspaces = Array.isArray(value?.recentWorkspaces)
    ? value.recentWorkspaces.filter(
        (record): record is WorkspaceRecord =>
          Boolean(record) &&
          typeof record.path === "string" &&
          typeof record.name === "string" &&
          typeof record.lastOpenedAt === "number",
      )
    : [];

  const profileSnippets = normalizeIdeaThreads(
    Array.isArray(value?.profileSnippets)
      ? value.profileSnippets
      : Array.isArray(value?.snippets)
        ? value.snippets
        : defaultIdeaThreads(),
  );

  return {
    markdown: typeof value?.markdown === "string" ? value.markdown : initialMarkdown,
    snippets: Array.isArray(value?.snippets)
      ? normalizeIdeaThreads(value.snippets)
      : profileSnippets,
    profileSnippets,
    settings: {
      ...defaultSettings,
      ...settings,
      editorFontFamily: normalizeStoredFontFamily(
        settings.editorFontFamily,
        defaultSettings.editorFontFamily,
      ),
      uiFontFamily: normalizeStoredFontFamily(
        settings.uiFontFamily,
        defaultSettings.uiFontFamily,
      ),
      uiFontScale:
        typeof settings.uiFontScale === "number" && Number.isFinite(settings.uiFontScale)
          ? Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, settings.uiFontScale))
          : defaultSettings.uiFontScale,
      exportFontFamily: exportFontFamilies.some(
        (fontFamily) => fontFamily === settings.exportFontFamily,
      )
        ? settings.exportFontFamily as EditorSettings["exportFontFamily"]
        : defaultSettings.exportFontFamily,
      fontSize:
        typeof settings.fontSize === "number" && Number.isFinite(settings.fontSize)
          ? Math.min(24, Math.max(12, settings.fontSize))
          : defaultSettings.fontSize,
      lineHeight:
        typeof settings.lineHeight === "number" && Number.isFinite(settings.lineHeight)
          ? Math.min(2.4, Math.max(1.4, settings.lineHeight))
          : defaultSettings.lineHeight,
      snippetStorageMode:
        settings.snippetStorageMode === "profile" ? "profile" : "workspace",
      showWorkspacePaths:
        typeof settings.showWorkspacePaths === "boolean"
          ? settings.showWorkspacePaths
          : defaultSettings.showWorkspacePaths,
      showStatusFilePath:
        typeof settings.showStatusFilePath === "boolean"
          ? settings.showStatusFilePath
          : defaultSettings.showStatusFilePath,
      showDocumentTabs:
        typeof settings.showDocumentTabs === "boolean"
          ? settings.showDocumentTabs
          : defaultSettings.showDocumentTabs,
      documentTabsDisplayMode:
        settings.documentTabsDisplayMode === "hover" ||
        settings.documentTabsDisplayMode === "always"
          ? settings.documentTabsDisplayMode
          : defaultSettings.documentTabsDisplayMode,
      skipStartupPortal:
        typeof settings.skipStartupPortal === "boolean"
          ? settings.skipStartupPortal
          : defaultSettings.skipStartupPortal,
      focusModeUsesNativeFullscreen:
        typeof settings.focusModeUsesNativeFullscreen === "boolean"
          ? settings.focusModeUsesNativeFullscreen
          : defaultSettings.focusModeUsesNativeFullscreen,
      sidebarHoverMode:
        settings.sidebarHoverMode === "both"
        || settings.sidebarHoverMode === "left"
        || settings.sidebarHoverMode === "right"
        || settings.sidebarHoverMode === "none"
          ? settings.sidebarHoverMode
          : legacyZoneMode === true
            ? "both"
            : defaultSettings.sidebarHoverMode,
      zoneModeOpacity:
        typeof settings.zoneModeOpacity === "number" && Number.isFinite(settings.zoneModeOpacity)
          ? Math.min(0.85, Math.max(0, settings.zoneModeOpacity))
          : defaultSettings.zoneModeOpacity,
      theme: normalizeAppTheme(settings.theme),
      countWhitespace:
        typeof settings.countWhitespace === "boolean"
          ? settings.countWhitespace
          : defaultSettings.countWhitespace,
      countCode:
        typeof settings.countCode === "boolean"
          ? settings.countCode
          : defaultSettings.countCode,
      showOutlineGuides:
        typeof settings.showOutlineGuides === "boolean"
          ? settings.showOutlineGuides
          : defaultSettings.showOutlineGuides,
      checkpointSectionCollapsed:
        typeof settings.checkpointSectionCollapsed === "boolean"
          ? settings.checkpointSectionCollapsed
          : defaultSettings.checkpointSectionCollapsed,
      showCheckpointSection:
        typeof settings.showCheckpointSection === "boolean"
          ? settings.showCheckpointSection
          : defaultSettings.showCheckpointSection,
      showCheckpointStatus:
        typeof settings.showCheckpointStatus === "boolean"
          ? settings.showCheckpointStatus
          : defaultSettings.showCheckpointStatus,
      typewriterScroll:
        typeof settings.typewriterScroll === "boolean"
          ? settings.typewriterScroll
          : defaultSettings.typewriterScroll,
      showTypewriterGuide:
        typeof settings.showTypewriterGuide === "boolean"
          ? settings.showTypewriterGuide
          : defaultSettings.showTypewriterGuide,
      showLineNumbers:
        typeof settings.showLineNumbers === "boolean"
          ? settings.showLineNumbers
          : defaultSettings.showLineNumbers,
      highlightCurrentLine:
        typeof settings.highlightCurrentLine === "boolean"
          ? settings.highlightCurrentLine
          : defaultSettings.highlightCurrentLine,
      colorizeJapaneseQuotes:
        typeof settings.colorizeJapaneseQuotes === "boolean"
          ? settings.colorizeJapaneseQuotes
          : defaultSettings.colorizeJapaneseQuotes,
      showComments:
        typeof settings.showComments === "boolean"
          ? settings.showComments
          : defaultSettings.showComments,
      typewriterOffset:
        typeof settings.typewriterOffset === "number" && Number.isFinite(settings.typewriterOffset)
          ? Math.min(65, Math.max(30, settings.typewriterOffset))
          : defaultSettings.typewriterOffset,
      writingMode:
        settings.writingMode === "horizontal-tb" || settings.writingMode === "vertical-rl"
          ? settings.writingMode
          : defaultSettings.writingMode,
      editorDisplayMode:
        settings.editorDisplayMode === "paged" ? "paged" : "continuous",
      pageFlowDirection:
        settings.pageFlowDirection === "vertical" ? "vertical" : "horizontal-rtl",
      manuscript: normalizeManuscriptSettings(settings.manuscript, settings.fontSize),
      canvasDefaultWritingMode:
        settings.canvasDefaultWritingMode === "horizontal-tb" ||
        settings.canvasDefaultWritingMode === "vertical-rl"
          ? settings.canvasDefaultWritingMode
          : defaultSettings.canvasDefaultWritingMode,
      canvasDefaultFontSource:
        settings.canvasDefaultFontSource === "editor" || settings.canvasDefaultFontSource === "ui"
          ? settings.canvasDefaultFontSource
          : defaultSettings.canvasDefaultFontSource,
      plotFontSource:
        settings.plotFontSource === "editor" || settings.plotFontSource === "ui"
          ? settings.plotFontSource
          : defaultSettings.plotFontSource,
      startPageFontSource:
        settings.startPageFontSource === "editor" || settings.startPageFontSource === "ui"
          ? settings.startPageFontSource
          : defaultSettings.startPageFontSource,
      editorMeasureHorizontal: normalizeEditorMeasure(settings.editorMeasureHorizontal),
      editorMeasureVertical: normalizeEditorMeasure(settings.editorMeasureVertical),
      headingFontSource:
        settings.headingFontSource === "custom" || settings.headingFontSource === "body"
          ? settings.headingFontSource
          : defaultSettings.headingFontSource,
      headingFontFamily: normalizeStoredFontFamily(
        settings.headingFontFamily,
        defaultSettings.headingFontFamily,
      ),
      canvasOpensInWindow:
        typeof settings.canvasOpensInWindow === "boolean"
          ? settings.canvasOpensInWindow
          : defaultSettings.canvasOpensInWindow,
      exportOpensInWindow:
        typeof settings.exportOpensInWindow === "boolean"
          ? settings.exportOpensInWindow
          : defaultSettings.exportOpensInWindow,
      proofread: normalizeProofreadSettings(settings.proofread),
      ai: normalizeAiSettings(settings.ai),
    },
    rightSidebarTab: normalizeRightSidebarTab(value?.rightSidebarTab),
    lastWorkspacePath:
      typeof value?.lastWorkspacePath === "string" ? value.lastWorkspacePath : null,
    lastFilePath: typeof value?.lastFilePath === "string" ? value.lastFilePath : null,
    recentWorkspaces,
    collapsedFolderPathsByWorkspace: normalizeCollapsedPathListsByWorkspace(
      value?.collapsedFolderPathsByWorkspace,
    ),
    collapsedOutlinePathsByWorkspace: normalizeCollapsedPathListsByWorkspace(
      value?.collapsedOutlinePathsByWorkspace,
    ),
    collapsedOutlineHeadingKeysByWorkspace: normalizeCollapsedPathListsByWorkspace(
      value?.collapsedOutlineHeadingKeysByWorkspace,
    ),
    fileProgress: normalizeFileProgress(value?.fileProgress),
    fileProgressMigrationVersions: normalizeFileProgressMigrationVersions(
      value?.fileProgressMigrationVersions,
    ),
    checkpointMigrationVersions: normalizeFileProgressMigrationVersions(
      value?.checkpointMigrationVersions,
    ),
    cursorPositions: normalizeCursorPositions(value?.cursorPositions),
    proofreadTerms: normalizeProofreadTerms(value?.proofreadTerms, "global"),
    documentTabsByWorkspace: normalizeWorkspaceDocumentTabs(
      value?.documentTabsByWorkspace,
    ),
    snapshots: normalizeSnapshots(value?.snapshots),
    libraryWorkStats: normalizeLibraryWorkStats(value?.libraryWorkStats),
  };
}

function normalizeFileProgressMigrationVersions(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [workspace, version] of Object.entries(value as Record<string, unknown>)) {
    if (workspace && typeof version === "number" && Number.isInteger(version) && version > 0) {
      result[workspace] = version;
    }
  }
  return result;
}

function normalizeCursorPositions(
  value: unknown,
): Record<string, CursorPosition> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, CursorPosition> = {};
  for (const [path, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path !== "string" || !entry || typeof entry !== "object") continue;
    const { offset, length } = entry as Partial<CursorPosition>;
    if (
      typeof offset === "number" &&
      Number.isFinite(offset) &&
      offset >= 0 &&
      typeof length === "number" &&
      Number.isFinite(length) &&
      length >= 0
    ) {
      result[path] = { offset: Math.floor(offset), length: Math.floor(length) };
    }
  }
  return result;
}

function normalizeFileProgress(
  value: unknown,
): Record<string, FileProgressStatus> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, FileProgressStatus> = {};
  for (const [path, status] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof path === "string" &&
      fileProgressStatuses.includes(status as FileProgressStatus)
    ) {
      result[path] = status as FileProgressStatus;
    }
  }
  return result;
}

async function loadStoredState(): Promise<AppState> {
  if (isTauriRuntime()) {
    const state = await invoke<AppState | null>("load_app_state");
    return normalizeState(state);
  }

  const raw =
    window.localStorage.getItem(STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_STORAGE_KEY);
  return normalizeState(raw ? JSON.parse(raw) : null);
}

async function saveStoredState(state: AppState): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("save_app_state", { state });
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadSystemFonts(): Promise<FontOption[]> {
  if (isTauriRuntime()) {
    const fonts = await invoke<string[]>("get_system_fonts");
    const options = createFontOptions(fonts);
    return options.length > 0 ? options : fallbackFontOptions;
  }

  return fallbackFontOptions;
}

async function loadWorkspaceSnippets(folderPath: string): Promise<IdeaThread[]> {
  if (!isTauriRuntime()) return defaultIdeaThreads();
  const loaded = await invoke<IdeaThread[]>("load_project_snippets", { rootPath: folderPath });
  return loaded.length ? normalizeIdeaThreads(loaded) : defaultIdeaThreads();
}

async function saveWorkspaceSnippets(folderPath: string, snippets: IdeaThread[]): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_project_snippets", { rootPath: folderPath, snippets });
}

async function loadWorkspacePlotCards(folderPath: string): Promise<PlotCard[]> {
  if (!isTauriRuntime()) return defaultPlotCards;
  const plotCards = await invoke<PlotCard[]>("load_project_plot_cards", { rootPath: folderPath });
  return normalizePlotCards(plotCards);
}

async function saveWorkspacePlotCards(folderPath: string, plotCards: PlotCard[]): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_project_plot_cards", { rootPath: folderPath, plotCards });
}

async function loadWorkspaceProofreadTerms(folderPath: string): Promise<ProofreadTerm[]> {
  if (!isTauriRuntime()) return [];
  const terms = await invoke<unknown>("load_project_proofread_terms", { rootPath: folderPath });
  return normalizeProofreadTerms(terms, "project");
}

async function saveWorkspaceProofreadTerms(
  folderPath: string,
  proofreadTerms: ProofreadTerm[],
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_project_proofread_terms", { rootPath: folderPath, proofreadTerms });
}

/** 無視した指摘。ワークスペース内の相対パスごとに保つ。 */
type ProofreadIgnoredByPath = Record<string, string[]>;

function normalizeProofreadIgnored(value: unknown): ProofreadIgnoredByPath {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: ProofreadIgnoredByPath = {};
  for (const [path, keys] of Object.entries(value as Record<string, unknown>)) {
    if (!path || !Array.isArray(keys)) continue;
    const kept = Array.from(
      new Set(keys.filter((key): key is string => typeof key === "string" && key.length > 0)),
    );
    if (kept.length) normalized[path] = kept;
  }
  return normalized;
}

async function loadWorkspaceProofreadIgnored(
  folderPath: string,
): Promise<ProofreadIgnoredByPath> {
  if (!isTauriRuntime()) return {};
  const stored = await invoke<unknown>("load_project_proofread_ignored", {
    rootPath: folderPath,
  });
  return normalizeProofreadIgnored(stored);
}

async function saveWorkspaceProofreadIgnored(
  folderPath: string,
  proofreadIgnored: ProofreadIgnoredByPath,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_project_proofread_ignored", { rootPath: folderPath, proofreadIgnored });
}

const FILE_PROGRESS_MIGRATION_VERSION = 1;

async function loadWorkspaceFileProgress(
  folderPath: string,
  state: AppState,
): Promise<ProjectFileProgressState> {
  if (!isTauriRuntime()) {
    return {
      fileProgress: state.fileProgress,
      revision: 0,
      migratedCount: 0,
      contentHash: "",
      rebased: false,
    };
  }
  const workspaceKey = workspaceDocumentTabsKey(folderPath);
  const shouldMigrate =
    (state.fileProgressMigrationVersions[workspaceKey] ?? 0) <
    FILE_PROGRESS_MIGRATION_VERSION;
  const loaded = await invoke<ProjectFileProgressState>("load_project_file_progress", {
    rootPath: folderPath,
    legacyFileProgress: shouldMigrate ? state.fileProgress : null,
  });
  return {
    ...loaded,
    fileProgress: normalizeFileProgress(loaded.fileProgress),
  };
}

function replaceWorkspaceFileProgress(
  current: Record<string, FileProgressStatus>,
  folderPath: string,
  shared: Record<string, FileProgressStatus>,
): Record<string, FileProgressStatus> {
  const next: Record<string, FileProgressStatus> = {};
  for (const [path, status] of Object.entries(current)) {
    if (!isPathSameOrInside(path, folderPath)) next[path] = status;
  }
  return { ...next, ...shared };
}

function hasWorkspaceFileProgressChanged(
  current: Record<string, FileProgressStatus>,
  folderPath: string,
  shared: Record<string, FileProgressStatus>,
): boolean {
  const known = new Map(
    Object.entries(current)
      .filter(([path, status]) => isPathSameOrInside(path, folderPath) && status !== "todo")
      .map(([path, status]) => [normalizePathForCompare(path), status] as const),
  );
  const next = new Map(
    Object.entries(shared)
      .filter(([, status]) => status !== "todo")
      .map(([path, status]) => [normalizePathForCompare(path), status] as const),
  );
  if (known.size !== next.size) return true;
  return Array.from(known).some(([path, status]) => next.get(path) !== status);
}

function markFileProgressMigration(
  current: AppState["fileProgressMigrationVersions"],
  folderPath: string,
): AppState["fileProgressMigrationVersions"] {
  return {
    ...current,
    [workspaceDocumentTabsKey(folderPath)]: FILE_PROGRESS_MIGRATION_VERSION,
  };
}

const CHECKPOINT_MIGRATION_VERSION = 1;

async function loadWorkspaceCheckpoints(
  folderPath: string,
  state: AppState,
): Promise<CheckpointLoadResult> {
  if (!isTauriRuntime()) {
    return {
      snapshots: state.snapshots.filter((snapshot) =>
        isSamePath(snapshot.workspacePath, folderPath),
      ),
      warnings: [],
      migratedCount: 0,
      migrationComplete: true,
    };
  }
  const workspaceKey = workspaceDocumentTabsKey(folderPath);
  const shouldMigrate =
    (state.checkpointMigrationVersions[workspaceKey] ?? 0) <
    CHECKPOINT_MIGRATION_VERSION;
  const loaded = await invoke<CheckpointLoadResult>("load_project_checkpoints", {
    rootPath: folderPath,
    legacySnapshots: shouldMigrate ? state.snapshots : null,
  });
  return {
    ...loaded,
    snapshots: normalizeSnapshots(loaded.snapshots),
    warnings: Array.isArray(loaded.warnings)
      ? loaded.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

function replaceWorkspaceSnapshots(
  current: ManuscriptSnapshot[],
  folderPath: string,
  shared: ManuscriptSnapshot[],
): ManuscriptSnapshot[] {
  return [
    ...shared,
    ...current.filter((snapshot) => !isSamePath(snapshot.workspacePath, folderPath)),
  ];
}

function markCheckpointMigration(
  current: AppState["checkpointMigrationVersions"],
  folderPath: string,
  complete = true,
): AppState["checkpointMigrationVersions"] {
  if (!complete) return current;
  return {
    ...current,
    [workspaceDocumentTabsKey(folderPath)]: CHECKPOINT_MIGRATION_VERSION,
  };
}

async function loadReferenceLayout(folderPath: string): Promise<ReferenceLayout> {
  if (!isTauriRuntime()) return defaultReferenceLayout;
  const layout = await invoke<ReferenceLayout>("load_reference_layout", { rootPath: folderPath });
  return normalizeReferenceLayout(layout);
}

async function saveReferenceLayout(folderPath: string, layout: ReferenceLayout): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_reference_layout", { rootPath: folderPath, layout });
}

async function listReferenceCandidates(folderPath: string): Promise<ReferenceFileInfo[]> {
  if (!isTauriRuntime()) return [];
  return await invoke<ReferenceFileInfo[]>("list_reference_candidates", {
    rootPath: folderPath,
    scope: "project",
  });
}

async function listCanvasBoards(
  scope: CanvasScope,
  rootPath: string | null,
): Promise<CanvasBoardSummary[]> {
  if (!isTauriRuntime()) return [];
  return await invoke<CanvasBoardSummary[]>("list_canvas_boards", { scope, rootPath });
}

async function createCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  name: string,
): Promise<CanvasBoardSummary> {
  if (!isTauriRuntime()) {
    return {
      id: "browser-preview",
      name,
      path: "",
      scope,
      updatedAt: Date.now(),
      nodeCount: 0,
      edgeCount: 0,
    };
  }
  return await invoke<CanvasBoardSummary>("create_canvas_board", { scope, rootPath, name });
}

async function loadCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  boardId: string,
): Promise<JsonCanvasDocument> {
  if (!isTauriRuntime()) return createCanvasDocument("Idea Board", scope);
  const board = await invoke<unknown>("load_canvas_board", { scope, rootPath, boardId });
  return normalizeCanvasDocument(board, "Idea Board", scope);
}

async function saveCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  boardId: string,
  board: JsonCanvasDocument,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_canvas_board", { scope, rootPath, boardId, board });
}

async function ensureCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  name: string,
): Promise<CanvasBoardSummary> {
  const boards = await listCanvasBoards(scope, rootPath);
  if (boards.length > 0) return boards[0];
  return await createCanvasBoard(scope, rootPath, name);
}

function nextCanvasPlacement(board: JsonCanvasDocument) {
  const textNodes = board.nodes.filter((node) => node.type === "text");
  if (textNodes.length === 0) return { x: 120, y: 120 };
  const last = textNodes.reduce((rightmost, node) =>
    node.x + node.width > rightmost.x + rightmost.width ? node : rightmost,
  );
  return {
    x: last.x + 32,
    y: last.y + 32,
  };
}

export default function App() {
  const saveTimerRef = useRef<number | null>(null);
  const referenceSaveTimerRef = useRef<number | null>(null);
  const referenceLayoutLoadedRootRef = useRef<string | null>(null);
  // 並び順を読み込んだ時点の「Ideaの管理単位」に合わせるため、最新の値を持っておく。
  const snippetStorageModeRef = useRef<EditorSettings["snippetStorageMode"]>("workspace");
  const workspaceFolderTreeRootRef = useRef<string | null>(null);
  const activeTabIdRef = useRef("initial-document-tab");
  const documentSaveQueuesRef = useRef<Map<string, DocumentSaveQueue>>(new Map());
  const headingMoveInProgressRef = useRef(false);
  const projectEntryPathChangeInProgressRef = useRef(false);
  const fileProgressSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fileProgressStoreVersionsRef = useRef<Map<string, PortableStoreVersion>>(new Map());
  const portableProjectConflictsRef = useRef<Map<string, string>>(new Map());
  const portableProjectRefreshesRef = useRef<Map<string, Promise<void>>>(new Map());
  const deletedCheckpointIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const portableProjectMutationGenerationRef = useRef<Map<string, number>>(new Map());
  const workspaceSwitchInProgressRef = useRef(false);
  const workspaceSwitchGenerationRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const typewriterScrollFrameRef = useRef<number | null>(null);
  const nativeFullscreenRequestedRef = useRef(false);
  const nativeFullscreenRequestIdRef = useRef(0);
  const restoreMaximizedAfterFullscreenRef = useRef(false);
  const editorInstanceRef = useRef<TextEditorHandle | null>(null);
  const pluginRuntimeHostRef = useRef<ThenPluginRuntimeHostHandle | null>(null);
  const pluginWorkspacePathRef = useRef<string | null>(null);
  const pluginAnchorSaveTimerRef = useRef<number | null>(null);
  const pluginAnchorSaveRootRef = useRef<string | null>(null);
  const pluginAnchorsRef = useRef<ThenPluginAnchor[]>([]);
  const pluginAnchorMutationVersionRef = useRef(0);
  const pluginCommandsRef = useRef<ThenPluginCommand[]>([]);
  const pluginStorageQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const pluginActiveDocumentRef = useRef<{ path: string | null; text: string }>({
    path: null,
    text: "",
  });
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const editorContextMenuRef = useRef<HTMLDivElement | null>(null);
  const editorFindInputRef = useRef<HTMLInputElement | null>(null);
  // コマンドパレットへフォーカスを移す前の選択。パレットの入力欄を操作しても
  // 記法コマンドの対象が変わらないよう、開いた時点の範囲を保持する。
  const commandPaletteSelectionRef = useRef<EditorSelectionSnapshot | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const modeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const breadcrumbMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const didMountEditorRef = useRef(false);
  const handleProjectFileSelectRef = useRef<(path: string) => Promise<void>>(
    async () => undefined,
  );
  const lastSavedMarkdownRef = useRef(initialMarkdown);
  const breadcrumbDragEntryRef = useRef<{ folderPath: string; entryPath: string } | null>(null);
  const projectAstBuildIdRef = useRef(0);
  const activeDocumentSnapshotRef = useRef<{
    path: string | null;
    name: string;
    text: string;
  } | null>(null);
  const activeDocumentAstCacheRef = useRef<DocumentAst | null>(null);

  const [appState, setAppState] = useState<AppState>(() => createDefaultState());
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const [isHydrated, setIsHydrated] = useState(false);
  const [startupView, setStartupView] = useState<"loading" | "portal" | "editor">(
    "loading",
  );
  const [lastError, setLastError] = useState("");
  const [openTabs, setOpenTabs] = useState<DocumentTab[]>(() => [
    createScratchDocumentTab(initialMarkdown, {
      id: "initial-document-tab",
      documentKey: "initial-document",
      savedMarkdown: initialMarkdown,
      saveStatus: "loading",
    }),
  ]);
  const [activeTabId, setActiveTabId] = useState("initial-document-tab");
  activeTabIdRef.current = activeTabId;
  // 確認ダイアログを待つ間にタブの状態が進むため、閉じる処理は最新の一覧を参照する。
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const [closedDocumentTabs, setClosedDocumentTabs] = useState<ClosedDocumentTab[]>([]);
  const isClosingDocumentTabsRef = useRef(false);
  const [projectFolder, setProjectFolder] = useState<ProjectFolder | null>(null);
  const [loadedPlugins, setLoadedPlugins] = useState<LoadedThenPlugin[]>([]);
  const [pluginCommands, setPluginCommands] = useState<ThenPluginCommand[]>([]);
  const [pluginViews, setPluginViews] = useState<ThenPluginView[]>([]);
  const [pluginScreens, setPluginScreens] = useState<ThenPluginScreen[]>([]);
  const [pluginModals, setPluginModals] = useState<ThenPluginModal[]>([]);
  const [pluginStatusItems, setPluginStatusItems] = useState<ThenPluginStatusItem[]>([]);
  const [activePluginScreenKey, setActivePluginScreenKey] = useState<string | null>(null);
  const [activePluginModalKey, setActivePluginModalKey] = useState<string | null>(null);
  const [sidebarPluginRuntimeAnchor, setSidebarPluginRuntimeAnchor] = useState<HTMLDivElement | null>(null);
  const [screenPluginRuntimeAnchor, setScreenPluginRuntimeAnchor] = useState<HTMLDivElement | null>(null);
  const [pluginAnchors, setPluginAnchors] = useState<ThenPluginAnchor[]>([]);
  const [projectAst, setProjectAst] = useState<ProjectAst | null>(null);
  const [checkpointCurrentProjectFiles, setCheckpointCurrentProjectFiles] = useState<ReadonlyMap<string, CheckpointCurrentProjectFile>>(() => new Map());
  const [checkpointCurrentProjectStatus, setCheckpointCurrentProjectStatus] = useState<CheckpointCurrentProjectStatus>("idle");
  const [checkpointUnavailableProjectPaths, setCheckpointUnavailableProjectPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [snippetWorkspacePath, setSnippetWorkspacePath] = useState<string | null>(null);
  const [plotWorkspacePath, setPlotWorkspacePath] = useState<string | null>(null);
  const [projectProofreadTerms, setProjectProofreadTerms] = useState<ProofreadTerm[]>([]);
  const [projectProofreadIgnored, setProjectProofreadIgnored] = useState<ProofreadIgnoredByPath>(
    {},
  );
  const [proofreadTermsWorkspacePath, setProofreadTermsWorkspacePath] = useState<string | null>(
    null,
  );
  const [plotCards, setPlotCards] = useState<PlotCard[]>(() => defaultPlotCards);
  const [focusedFolderPath, setFocusedFolderPath] = useState<string | null>(null);
  const [workspaceAlert, setWorkspaceAlert] = useState<WorkspaceAlert>(null);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<WorkspaceSearchScope>("file");
  const [projectSearchUseRegex, setProjectSearchUseRegex] = useState(false);
  /** 検索・置換でコメント行も対象にするか（サイドバー検索とファイル内検索で共通）。 */
  const [searchIncludeComments, setSearchIncludeComments] = useState(false);
  const [projectSearchMatchCase, setProjectSearchMatchCase] = useState(false);
  const [projectReplaceValue, setProjectReplaceValue] = useState("");
  const [isProjectReplacing, setIsProjectReplacing] = useState(false);
  const [leftSidebarView, setLeftSidebarView] =
    useState<"files" | "search" | "reference">("files");
  const isProjectSearchMode = leftSidebarView === "search";
  const [editorFind, setEditorFind] = useState<EditorFindState>({
    open: false,
    query: "",
    replaceValue: "",
    showReplace: false,
    activeIndex: 0,
  });
  const [toast, setToast] = useState("");
  const [toastAction, setToastAction] = useState<ToastAction | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingBreadcrumbEntryPath, setDraggingBreadcrumbEntryPath] =
    useState<string | null>(null);
  const [breadcrumbDropTarget, setBreadcrumbDropTarget] =
    useState<BreadcrumbDropTarget>(null);
  const [selectionCharCount, setSelectionCharCount] = useState<number | null>(null);
  const [editorSelectionHead, setEditorSelectionHead] = useState(0);
  const [editorSelectionLine, setEditorSelectionLine] = useState(1);
  const [editorPageMetrics, setEditorPageMetrics] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [editorManuscriptProgress] = useState(createManuscriptProgressStore);
  const [editorContextMenu, setEditorContextMenu] =
    useState<EditorContextMenuState | null>(null);
  const [notationModal, setNotationModal] = useState<NotationModalState | null>(null);
  const [manuscriptTidyRequest, setManuscriptTidyRequest] = useState<{
    text: string;
    selectionLines: ManuscriptTidyLineRange | null;
  } | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isPluginManagerOpen, setIsPluginManagerOpen] = useState(false);
  /** エディタのスクロール領域の実測内寸。文字表示幅設定の上限算出に使う。 */
  const [editorViewportSize, setEditorViewportSize] = useState<{
    width: number;
    height: number;
    verticalPadding: number;
  } | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isQuickIdeaModalOpen, setIsQuickIdeaModalOpen] = useState(false);
  const [isThemePickerModalOpen, setIsThemePickerModalOpen] = useState(false);
  const [shouldReturnToSettingsAfterThemePicker, setShouldReturnToSettingsAfterThemePicker] =
    useState(false);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [activeBreadcrumbPath, setActiveBreadcrumbPath] = useState<string | null>(null);
  const [breadcrumbBrowsePath, setBreadcrumbBrowsePath] = useState<string | null>(null);
  const [breadcrumbLayout, setBreadcrumbLayout] =
    useState<BreadcrumbLayout>("full");
  const [isBreadcrumbOverflowOpen, setIsBreadcrumbOverflowOpen] = useState(false);
  const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = useState(false);
  const [workspaceSwitcherQuery, setWorkspaceSwitcherQuery] = useState("");
  /** ライブラリの準備画面。null なら閉じている。 */
  const [librarySetupRequest, setLibrarySetupRequest] = useState<{
    id: number;
    candidates: LibrarySetupCandidate[];
  } | null>(null);
  const [isLibrarySetupDismissed, setIsLibrarySetupDismissed] = useState(false);
  const [collapsedWorkspaceFolderPaths, setCollapsedWorkspaceFolderPaths] =
    useState<ReadonlySet<string>>(() => new Set());
  const [isOutlineMenuOpen, setIsOutlineMenuOpen] = useState(false);
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null);
  const [systemFonts, setSystemFonts] = useState<FontOption[]>(fallbackFontOptions);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
  const [isRightSidebarWide, setIsRightSidebarWide] = useState(false);
  const [isEditorFocusMode, setIsEditorFocusMode] = useState(false);
  /**
   * メイン画面のモード。write=本文（左右サイドバー）、canvas=キャンバス（右のみ）、
   * export=エクスポート、checkpoint=チェックポイント（いずれもサイドバーなし）。canvas/export は設定により別ウィンドウ
   * 起動へ切り替わる。
   */
  const [appMode, setAppMode] = useState<AppMode>("write");
  const appShellRef = useRef<HTMLElement | null>(null);
  // サイドバー・ステータスバー・通知から、特定の保存点を選んだ状態でチェックポイント画面を開く。
  const [checkpointFocusRequest, setCheckpointFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const openCheckpointStudio = useCallback((snapshotId?: string) => {
    setCheckpointFocusRequest(snapshotId ? { id: snapshotId, nonce: Date.now() } : null);
    setAppMode("checkpoint");
  }, []);
  useEffect(() => {
    if (appMode !== "write") setIsEditorFocusMode(false);
  }, [appMode]);
  const [canvasEmbedPayload, setCanvasEmbedPayload] = useState<CanvasWindowPayload | null>(null);
  const [exportEmbedPayload, setExportEmbedPayload] = useState<{
    requestId: string;
    title: string;
    projectPath: string | null;
    sources: LoadedExportSource[];
    sourceError?: string;
  } | null>(null);
  const [rightSidebarTab, setRightSidebarTabState] = useState<string>("plot");
  const [aiInsertRequest, setAiInsertRequest] = useState<{ text: string; nonce: number } | null>(null);
  const consumeAiInsertRequest = useCallback(
    (nonce: number) => setAiInsertRequest((current) => (current?.nonce === nonce ? null : current)),
    [],
  );

  const setRightSidebarTab = useCallback((tab: string) => {
    setRightSidebarTabState(tab);
    if (!isRestorableRightSidebarTab(tab)) return;
    setAppState((current) =>
      current.rightSidebarTab === tab ? current : { ...current, rightSidebarTab: tab },
    );
  }, []);
  const [draftCanvasContext, setDraftCanvasContext] = useState<DraftCanvasContext | null>(null);
  const [draftSelectRequest, setDraftSelectRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [hasOpenedDraft, setHasOpenedDraft] = useState(false);
  useEffect(() => { if (rightSidebarTab === "draft") setHasOpenedDraft(true); }, [rightSidebarTab]);
  const activePluginView = pluginViews.find(
    (view) => rightSidebarTab === `plugin:${view.pluginId}:${view.id}`,
  ) ?? null;
  const rightPaneSwitcherItems: RightPaneSwitcherItem[] = [
    ...rightSidebarBuiltinTabs,
    ...pluginViews.map((view) => {
      const icon = view.icon ?? loadedPlugins.find(
        (plugin) => plugin.manifest.id === view.pluginId,
      )?.manifest.icon;
      return {
        id: `plugin:${view.pluginId}:${view.id}`,
        label: view.title,
        icon: icon ? (
          <PluginIcon icon={icon} />
        ) : (
          <span className="pluginPaneInitial">{view.title.slice(0, 1).toUpperCase()}</span>
        ),
      };
    }),
  ];
  const pluginSelectionCommands = pluginCommands.filter(
    (command) => command.menus?.includes("editor.selection"),
  );
  const activePluginScreen = pluginScreens.find(
    (screen) => activePluginScreenKey === `${screen.pluginId}:${screen.id}`,
  ) ?? null;
  const activePluginModal = pluginModals.find(
    (modal) => activePluginModalKey === `${modal.pluginId}:${modal.id}`,
  ) ?? null;
  const dockedPluginRuntimeView = appMode === "plugin" && activePluginScreen
    ? { pluginId: activePluginScreen.pluginId, viewId: activePluginScreen.id }
    : activePluginView
      ? { pluginId: activePluginView.pluginId, viewId: activePluginView.id }
      : null;
  const isDockedPluginRuntimeVisible = appMode === "plugin"
    ? Boolean(activePluginScreen)
    : Boolean(activePluginView) && !isRightSidebarCollapsed && !isEditorFocusMode;
  const pluginRuntimeAnchor = appMode === "plugin"
    ? screenPluginRuntimeAnchor
    : sidebarPluginRuntimeAnchor;
  const pluginRuntimeActiveView = activePluginModal
    ? { pluginId: activePluginModal.pluginId, viewId: activePluginModal.id }
    : dockedPluginRuntimeView;
  useEffect(() => {
    if (appMode === "plugin" && !activePluginScreen) {
      setAppMode("write");
    }
  }, [activePluginScreen, appMode]);
  useEffect(() => {
    if (rightSidebarTab.startsWith("plugin:") && !activePluginView) {
      setRightSidebarTab("plot");
    }
  }, [activePluginView, rightSidebarTab]);
  useEffect(() => {
    if (activePluginModalKey && !activePluginModal) setActivePluginModalKey(null);
  }, [activePluginModal, activePluginModalKey]);
  useEffect(() => {
    if (!activePluginModal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setActivePluginModalKey(null);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [activePluginModal]);
  const [isPlotManagerOpen, setIsPlotManagerOpen] = useState(false);
  const [ideaFocusRequest, setIdeaFocusRequest] = useState<{
    threadId: string;
    fragmentId?: string;
    nonce: number;
  } | null>(null);
  const [referenceLayout, setReferenceLayout] =
    useState<ReferenceLayout>(() => defaultReferenceLayout);
  const [referenceCandidates, setReferenceCandidates] = useState<ReferenceFileInfo[]>([]);

  pluginCommandsRef.current = pluginCommands;
  pluginAnchorsRef.current = pluginAnchors;

  const reloadInstalledPlugins = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLoadedPlugins([]);
      return true;
    }
    try {
      const result = await invoke<{ plugins: LoadedThenPlugin[]; errors: string[] }>(
        "list_installed_plugins",
      );
      setLoadedPlugins(result.plugins);
      setPluginCommands([]);
      setPluginViews([]);
      setPluginScreens([]);
      setPluginModals([]);
      setActivePluginModalKey(null);
      setPluginStatusItems([]);
      if (result.errors.length > 0) {
        setLastError(`読み込めないプラグインがあります: ${result.errors.join(" / ")}`);
      }
      return result.errors.length === 0;
    } catch (error) {
      setLastError(`プラグインの読み込みに失敗しました: ${String(error)}`);
      return false;
    }
  }, []);

  useEffect(() => {
    void reloadInstalledPlugins();
  }, [reloadInstalledPlugins]);

  useEffect(() => {
    const workspacePath = projectFolder?.path ?? null;
    if (pluginWorkspacePathRef.current === workspacePath) return;
    pluginWorkspacePathRef.current = workspacePath;
    pluginRuntimeHostRef.current?.emit("workspace.change", {
      name: projectFolder?.name ?? null,
      hasProject: Boolean(projectFolder),
    });
  }, [projectFolder?.name, projectFolder?.path]);

  useEffect(() => {
    if (pluginAnchorSaveTimerRef.current !== null) {
      window.clearTimeout(pluginAnchorSaveTimerRef.current);
      pluginAnchorSaveTimerRef.current = null;
      pluginAnchorSaveRootRef.current = null;
    }
    const rootPath = projectFolder?.path;
    if (!rootPath || !isTauriRuntime()) {
      setPluginAnchors([]);
      return;
    }
    const loadVersion = ++pluginAnchorMutationVersionRef.current;
    setPluginAnchors([]);
    pluginAnchorsRef.current = [];
    let cancelled = false;
    invoke<ThenPluginAnchorStore | null>("load_plugin_anchors", { rootPath })
      .then((store) => {
        if (cancelled || pluginAnchorMutationVersionRef.current !== loadVersion) return;
        setPluginAnchors(store?.version === 1 && Array.isArray(store.anchors) ? store.anchors : []);
      })
      .catch((error) => {
        if (!cancelled) setLastError(`アンカーの読み込みに失敗しました: ${String(error)}`);
      });
    return () => {
      cancelled = true;
      if (
        pluginAnchorSaveTimerRef.current !== null &&
        pluginAnchorSaveRootRef.current === rootPath
      ) {
        window.clearTimeout(pluginAnchorSaveTimerRef.current);
        pluginAnchorSaveTimerRef.current = null;
        pluginAnchorSaveRootRef.current = null;
        const store: ThenPluginAnchorStore = { version: 1, anchors: pluginAnchorsRef.current };
        void invoke("save_plugin_anchors", { rootPath, store });
      }
    };
  }, [projectFolder?.path]);

  const persistPluginAnchors = useCallback((anchors: ThenPluginAnchor[]) => {
    pluginAnchorMutationVersionRef.current += 1;
    setPluginAnchors(anchors);
    pluginAnchorsRef.current = anchors;
    const rootPath = projectFolder?.path;
    if (!rootPath || !isTauriRuntime()) return;
    if (pluginAnchorSaveTimerRef.current !== null) {
      window.clearTimeout(pluginAnchorSaveTimerRef.current);
    }
    pluginAnchorSaveTimerRef.current = window.setTimeout(() => {
      pluginAnchorSaveTimerRef.current = null;
      pluginAnchorSaveRootRef.current = null;
      const store: ThenPluginAnchorStore = { version: 1, anchors: pluginAnchorsRef.current };
      invoke("save_plugin_anchors", { rootPath, store }).catch((error) => {
        setLastError(`アンカーの保存に失敗しました: ${String(error)}`);
      });
    }, 180);
    pluginAnchorSaveRootRef.current = rootPath;
  }, [projectFolder?.path]);

  const retargetPluginAnchors = useCallback((oldAbsolutePath: string, newAbsolutePath: string) => {
    if (!projectFolder) return;
    const oldPath = toProjectRelativePath(projectFolder.path, oldAbsolutePath).replace(/[\\/]+/g, "/");
    const newPath = toProjectRelativePath(projectFolder.path, newAbsolutePath).replace(/[\\/]+/g, "/");
    const comparableOld = oldPath.toLocaleLowerCase();
    let changed = false;
    const next = pluginAnchorsRef.current.map((anchor) => {
      const comparableAnchor = anchor.documentPath.replace(/[\\/]+/g, "/").toLocaleLowerCase();
      if (comparableAnchor !== comparableOld && !comparableAnchor.startsWith(`${comparableOld}/`)) {
        return anchor;
      }
      changed = true;
      return {
        ...anchor,
        documentPath: `${newPath}${anchor.documentPath.replace(/[\\/]+/g, "/").slice(oldPath.length)}`,
        updatedAt: Date.now(),
      };
    });
    if (changed) persistPluginAnchors(next);
  }, [persistPluginAnchors, projectFolder]);

  const addPlotSection = useCallback(() => {
    setPlotCards((current) => appendPlotSection(current));
  }, []);

  const addPlotChapter = useCallback(() => {
    setPlotCards((current) => appendPlotChapter(current));
  }, []);

  const patchReferenceLayout = useCallback(
    (updater: (layout: ReferenceLayout) => ReferenceLayout) => {
      setReferenceLayout((current) => updater(current));
    },
    [],
  );

  const focusReferenceCard = useCallback((cardId: string) => {
    setReferenceLayout((current) => {
      return {
        ...current,
        cards: current.cards.map((card) => {
          if (card.id !== cardId) return card;
          return {
            ...card,
            collapsed: false,
            zIndex: nextReferenceZIndex(current.cards, card.pinned),
          };
        }),
      };
    });
  }, []);

  const closeReferenceCard = useCallback((cardId: string) => {
    setReferenceLayout((current) => ({
      ...current,
      cards: current.cards.filter((card) => card.id !== cardId),
    }));
  }, []);

  const pinReferenceCard = useCallback((cardId: string, pinned: boolean) => {
    setReferenceLayout((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId
          ? { ...card, pinned, zIndex: nextReferenceZIndex(current.cards, pinned) }
          : card,
      ),
    }));
  }, []);

  const collapseReferenceCard = useCallback((cardId: string, collapsed: boolean) => {
    setReferenceLayout((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId ? { ...card, collapsed } : card,
      ),
    }));
  }, []);

  const openReferenceCard = useCallback(
    (
      sourcePath: string,
      fileInfo?: ReferenceFileInfo,
      options: { switchToReferenceTab?: boolean } = {},
    ) => {
      const { switchToReferenceTab = true } = options;
      if (!projectFolder) {
        showToast("先にフォルダを開いてください");
        return;
      }

      setReferenceLayout((current) => {
        const file = fileInfo ?? makeReferenceFileInfo(sourcePath);
        const nextLayout = upsertRecentReference(current, file);
        const fileKey = referenceFileKey(file);
        const existing = current.cards.find(
          (card) => isReferenceBinderCard(card) && referenceCardKey(card) === fileKey,
        );
        if (existing) {
          return {
            ...nextLayout,
            cards: nextLayout.cards.map((card) =>
              card.id === existing.id
                ? {
                    ...card,
                    zIndex: nextReferenceZIndex(nextLayout.cards, card.pinned),
                    collapsed: false,
                  }
                : card,
            ),
          };
        }

        const index = nextLayout.cards.length;
        const kind = file.kind;
        const size = referenceInitialSize(kind);
        const stageRect = workspaceRef.current?.getBoundingClientRect();
        const editorRect = editorShellRef.current?.getBoundingClientRect();
        const originX = editorRect && stageRect ? editorRect.left - stageRect.left : 0;
        const originY = editorRect && stageRect ? editorRect.top - stageRect.top : 0;
        const card = clampReferenceCardToStage(
          {
            id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            sourceType: "reference",
            scope: file.scope,
            sourcePath,
            kind,
            x: originX + 72 + index * 32,
            y: originY + 96 + index * 32,
            width: size.width,
            height: size.height,
            zIndex: nextReferenceZIndex(nextLayout.cards, false),
            collapsed: false,
            pinned: false,
            page: kind === "pdf" ? 1 : undefined,
            zoom: kind === "image" || kind === "pdf" ? 1 : undefined,
          },
          stageRect?.width ?? 1200,
          stageRect?.height ?? 800,
        );
        return { ...nextLayout, cards: [...nextLayout.cards, card] };
      });
      if (switchToReferenceTab) {
        setLeftSidebarView("reference");
        setIsLeftSidebarCollapsed(false);
      }
    },
    [projectFolder],
  );

  const addReferencesToIdeaThread = useCallback(
    (threadId: string, files: ReferenceFileInfo[]) => {
      setReferenceLayout((current) => {
        const ideaThreads = reconcileIdeaThreadLayouts(current.ideaThreads, appState.snippets);
        const target = ideaThreads.find((layout) => layout.threadId === threadId);
        if (!target) return current;
        const existing = new Set(
          target.items
            .filter((item): item is IdeaReferenceLink => item.sourceType === "reference")
            .map((item) => normalizedReferenceKey(item.sourcePath)),
        );
        const additions = files.flatMap((file) => {
          const key = normalizedReferenceKey(file.sourcePath);
          if (!key || existing.has(key)) return [];
          existing.add(key);
          return [makeReferenceLink(file.sourcePath)];
        });
        if (!additions.length) return current;
        return {
          ...upsertRecentReferences(current, files),
          version: 3,
          ideaThreads: ideaThreads.map((layout) =>
            layout.threadId === threadId
              ? { ...layout, items: [...additions, ...layout.items] }
              : layout,
          ),
        };
      });
    },
    [appState.snippets],
  );

  const handleAddReference = useCallback(async (
    scope: ReferenceScope = "project",
    targetThreadId?: string,
  ) => {
    if (scope === "project" && !projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    if (!isTauriRuntime()) {
      showToast("資料の追加はTauri版で利用できます");
      return;
    }

    try {
      const result = await invoke<{
        files: ReferenceFileInfo[];
        failures: Array<{ path: string; message: string }>;
      }>("pick_reference_files", {
        rootPath: projectFolder?.path ?? null,
        scope,
      });
      if (!result.files.length && !result.failures.length) return;
      setReferenceCandidates((current) =>
        mergeReferenceFiles(result.files, current).sort((left, right) =>
          left.sourcePath.localeCompare(right.sourcePath),
        ),
      );
      if (targetThreadId) {
        addReferencesToIdeaThread(targetThreadId, result.files);
      } else if (result.files[0]) {
        openReferenceCard(result.files[0].sourcePath, result.files[0]);
      }
      if (result.failures.length) {
        setLastError(result.failures.map((failure) => `${failure.path}: ${failure.message}`).join("\n"));
        showToast(`${result.files.length}件追加、${result.failures.length}件失敗しました`);
      } else if (result.files.length) {
        showToast(`${result.files.length}件の資料を追加しました`);
      }
    } catch (error) {
      setLastError(String(error));
      showToast("資料を追加できませんでした");
    }
  }, [addReferencesToIdeaThread, openReferenceCard, projectFolder]);

  const handleCreateReference = useCallback(async (
    scope: ReferenceScope = "project",
    targetThreadId?: string,
  ) => {
    if (scope === "project" && !projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    if (!isTauriRuntime()) {
      showToast("資料の作成はTauri版で利用できます");
      return;
    }

    const name = await new Promise<string | null>((resolve) => {
      setAppDialog({
        type: "input",
        title: "資料を新規作成",
        label: "ファイル名（.txt / .md）",
        value: "新しい資料.md",
        confirmLabel: "作成",
        placeholder: "例: 世界観メモ.md",
        error: "",
        resolve,
      });
    });
    if (!name) return;

    try {
      const file = await invoke<ReferenceFileInfo>("create_reference_text_file", {
        rootPath: projectFolder?.path ?? null,
        scope,
        name,
      });
      setReferenceCandidates((current) =>
        mergeReferenceFiles([file], current).sort((left, right) =>
          left.sourcePath.localeCompare(right.sourcePath),
        ),
      );
      if (targetThreadId) {
        addReferencesToIdeaThread(targetThreadId, [file]);
        showToast(`「${file.name}」を作成しました`);
      } else {
        openReferenceCard(file.sourcePath, file);
      }
    } catch (error) {
      setLastError(String(error));
      showToast("資料を作成できませんでした");
    }
  }, [addReferencesToIdeaThread, openReferenceCard, projectFolder]);

  const handleDeleteImportedReference = useCallback(
    async (sourcePath: string, scope: ReferenceScope = "project") => {
      if (scope === "project" && !projectFolder) return;
      const fileName = sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;
      const referenceCount = countIdeaReferenceLinks(referenceLayout.ideaThreads, sourcePath);
      const confirmed = await new Promise<boolean>((resolve) => {
        setAppDialog({
          type: "confirm",
          title: "資料ファイルを削除",
          message: referenceCount > 0
            ? `この資料は${referenceCount}個のIdeaスレッドから参照されています。`
            : `「${fileName}」をこのプロジェクトから削除しますか？`,
          detail: referenceCount > 0
            ? "資料ファイルと、すべてのスレッドからの参照を削除します。"
            : "取り込んだ資料ファイルを削除します。この操作は元に戻せません。",
          confirmLabel: "削除する",
          danger: true,
          resolve,
        });
      });
      if (!confirmed) return;

      try {
        await invoke("delete_imported_reference", {
          rootPath: projectFolder?.path ?? null,
          sourcePath,
          scope,
        });
        const deletedKey = referenceKey(sourcePath, scope);
        setReferenceLayout((current) => ({
          ...current,
          cards: current.cards.filter(
            (card) => !isReferenceBinderCard(card) || referenceCardKey(card) !== deletedKey,
          ),
          recent: current.recent.filter(
            (file) => referenceFileKey(file) !== deletedKey,
          ),
          ideaThreads: current.ideaThreads.map((layout) => ({
            ...layout,
            items: layout.items.filter(
              (item) =>
                item.sourceType !== "reference"
                || normalizedReferenceKey(item.sourcePath) !== normalizedReferenceKey(sourcePath),
            ),
          })),
        }));
        setReferenceCandidates((current) =>
          current.filter((file) => referenceFileKey(file) !== deletedKey),
        );
        showToast(`「${fileName}」を削除しました`);
      } catch (error) {
        setLastError(String(error));
        showToast("資料を削除できませんでした");
      }
    },
    [projectFolder, referenceLayout.ideaThreads],
  );

  const moveIdeaReference = useCallback((
    fromThreadId: string,
    linkId: string,
    toThreadId: string,
    keepOriginal: boolean,
  ) => {
    if (fromThreadId === toThreadId) return;
    setReferenceLayout((current) => {
      const layouts = reconcileIdeaThreadLayouts(current.ideaThreads, appState.snippets);
      const source = layouts.find((layout) => layout.threadId === fromThreadId);
      const target = layouts.find((layout) => layout.threadId === toThreadId);
      const link = source?.items.find(
        (item): item is IdeaReferenceLink => item.sourceType === "reference" && item.id === linkId,
      );
      if (!source || !target || !link) return current;
      const alreadyThere = target.items.some(
        (item) =>
          item.sourceType === "reference"
          && normalizedReferenceKey(item.sourcePath) === normalizedReferenceKey(link.sourcePath),
      );
      return {
        ...current,
        version: 3,
        ideaThreads: layouts.map((layout) => {
          if (layout.threadId === fromThreadId && !keepOriginal) {
            return { ...layout, items: layout.items.filter((item) => ideaThreadItemKey(item) !== `reference:${linkId}`) };
          }
          if (layout.threadId === toThreadId && !alreadyThere) {
            return { ...layout, items: [makeReferenceLink(link.sourcePath), ...layout.items] };
          }
          return layout;
        }),
      };
    });
  }, [appState.snippets]);

  const removeIdeaReference = useCallback(async (threadId: string, linkId: string) => {
    const source = referenceLayout.ideaThreads.find((layout) => layout.threadId === threadId);
    const link = source?.items.find(
      (item): item is IdeaReferenceLink => item.sourceType === "reference" && item.id === linkId,
    );
    if (!link) return;
    const count = countIdeaReferenceLinks(referenceLayout.ideaThreads, link.sourcePath);
    if (count <= 1) {
      const fileExists = referenceCandidates.some(
        (file) => normalizedReferenceKey(file.sourcePath) === normalizedReferenceKey(link.sourcePath),
      );
      const confirmed = await new Promise<boolean>((resolve) => {
        setAppDialog({
          type: "confirm",
          title: fileExists ? "資料を削除" : "見つからない資料の参照を削除",
          message: fileExists
            ? "この資料はほかのスレッドから参照されていません。"
            : "資料ファイルが見つかりません。この参照を削除しますか？",
          detail: fileExists
            ? "このプロジェクトからの削除になりますが、よろしいですか？"
            : undefined,
          confirmLabel: fileExists ? "削除する" : "参照を削除",
          danger: true,
          resolve,
        });
      });
      if (!confirmed || !projectFolder) return;
      try {
        if (fileExists) {
          await invoke("delete_imported_reference", {
            rootPath: projectFolder.path,
            sourcePath: link.sourcePath,
            scope: "project",
          });
        }
        const key = normalizedReferenceKey(link.sourcePath);
        setReferenceLayout((current) => ({
          ...current,
          cards: current.cards.filter(
            (card) => !isReferenceBinderCard(card) || normalizedReferenceKey(card.sourcePath) !== key,
          ),
          recent: current.recent.filter((file) => normalizedReferenceKey(file.sourcePath) !== key),
          ideaThreads: current.ideaThreads.map((layout) => ({
            ...layout,
            items: layout.items.filter(
              (item) => item.sourceType !== "reference" || normalizedReferenceKey(item.sourcePath) !== key,
            ),
          })),
        }));
        setReferenceCandidates((current) =>
          current.filter((file) => normalizedReferenceKey(file.sourcePath) !== key),
        );
        showToast(fileExists ? "資料を削除しました" : "見つからない資料の参照を削除しました");
      } catch (error) {
        setLastError(String(error));
        showToast("資料を削除できませんでした");
      }
      return;
    }
    setReferenceLayout((current) => ({
      ...current,
      ideaThreads: current.ideaThreads.map((layout) =>
        layout.threadId === threadId
          ? { ...layout, items: layout.items.filter((item) => ideaThreadItemKey(item) !== `reference:${linkId}`) }
          : layout,
      ),
    }));
    showToast("このスレッドから資料を外しました");
  }, [projectFolder, referenceCandidates, referenceLayout.ideaThreads]);

  const reorderIdeaThreadItem = useCallback((
    threadId: string,
    itemKey: string,
    targetKey: string,
    position: "before" | "after",
  ) => {
    if (itemKey === targetKey) return;
    setReferenceLayout((current) => ({
      ...current,
      ideaThreads: current.ideaThreads.map((layout) => {
        if (layout.threadId !== threadId) return layout;
        const moving = layout.items.find((item) => ideaThreadItemKey(item) === itemKey);
        if (!moving) return layout;
        const items = layout.items.filter((item) => ideaThreadItemKey(item) !== itemKey);
        const targetIndex = items.findIndex((item) => ideaThreadItemKey(item) === targetKey);
        if (targetIndex < 0) return layout;
        items.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, moving);
        return { ...layout, items };
      }),
    }));
  }, []);

  const returnFocusToEditor = useCallback(() => {
    editorInstanceRef.current?.focus();
  }, []);

  const handleReferenceTextSaved = useCallback(
    (sourcePath: string, scope: ReferenceScope, text: string) => {
      if (!projectFolder || scope !== "project") return;
      const file = collectProjectTextFiles(projectFolder).find(
        (item) =>
          toProjectRelativePath(projectFolder.path, item.path).toLocaleLowerCase() ===
          sourcePath.toLocaleLowerCase(),
      );
      if (!file) return;

      setProjectAst((current) =>
        current && current.rootPath === projectFolder.path
          ? upsertProjectAstDocument(current, {
              path: file.path,
              name: file.name,
              text: parseFrontMatter(text).body,
            })
          : current,
      );

      setOpenTabs((current) =>
        current.map((tab) => {
          if (tab.path !== file.path) return tab;
          if (tab.id === activeTabIdRef.current) {
            lastSavedMarkdownRef.current = text;
            setAppState((state) => ({ ...state, markdown: text }));
          }
          return {
            ...tab,
            markdown: text,
            savedMarkdown: text,
            saveStatus: "saved",
            editorRevision: null,
          };
        }),
      );
    },
    [projectFolder],
  );

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.id === activeTabId) ?? openTabs[0] ?? null,
    [activeTabId, openTabs],
  );
  const workspaceTabSessionSignature = useMemo(
    () => JSON.stringify({
      activeTabId,
      tabs: openTabs
        .filter((tab) => tab.kind === "file" && tab.path)
        .map((tab) => ({
          id: tab.id,
          path: tab.path,
          fileId: tab.fileId,
          contentHash: tab.contentHash,
          activeOutlineLine: tab.activeOutlineLine,
          viewportState: tab.viewportState,
        })),
    }),
    [activeTabId, openTabs],
  );
  useEffect(() => {
    if (!isHydrated || !projectFolder || workspaceSwitchInProgressRef.current) return;
    const key = workspaceDocumentTabsKey(projectFolder.path);
    const session = createWorkspaceDocumentTabs(openTabs, activeTabId);
    setAppState((current) => ({
      ...current,
      documentTabsByWorkspace: {
        ...current.documentTabsByWorkspace,
        [key]: session,
      },
    }));
  }, [isHydrated, projectFolder?.path, workspaceTabSessionSignature]);
  const rememberCurrentWorkspaceTabs = useCallback(() => {
    if (!projectFolder) return;
    const key = workspaceDocumentTabsKey(projectFolder.path);
    const activeViewportState = editorInstanceRef.current?.getViewportState() ?? null;
    const session = createWorkspaceDocumentTabs(
      openTabs,
      activeTabId,
      activeViewportState,
    );
    setAppState((current) => ({
      ...current,
      documentTabsByWorkspace: {
        ...current.documentTabsByWorkspace,
        [key]: session,
      },
    }));
  }, [activeTabId, openTabs, projectFolder]);
  /** 最近開いたライブラリ（新しい順）。 */
  const knownLibraries = useMemo(
    () =>
      [...appState.recentWorkspaces]
        .filter((record) => record.library?.role === "root")
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt),
    [appState.recentWorkspaces],
  );
  const hasKnownLibrary = appState.recentWorkspaces.some((record) => record.library);
  /** ライブラリに取り込まれていない旧版のワークスペース。 */
  const legacyWorkspaceCandidates = useMemo<LibrarySetupCandidate[]>(
    () =>
      appState.recentWorkspaces
        .filter((record) => !record.library)
        .map((record) => ({ path: record.path, name: record.name })),
    [appState.recentWorkspaces],
  );
  // 候補は開いた時点で確定する。取り込みが進んで履歴が変わっても画面を作り直さない。
  const openLibrarySetup = useCallback(
    (candidates: LibrarySetupCandidate[] = []) => {
      const merged: LibrarySetupCandidate[] = [];
      for (const candidate of [...candidates, ...legacyWorkspaceCandidates]) {
        if (!merged.some((item) => isSamePath(item.path, candidate.path))) merged.push(candidate);
      }
      setLibrarySetupRequest({ id: Date.now(), candidates: merged });
    },
    [legacyWorkspaceCandidates],
  );
  // ライブラリ直下はプロジェクトより一段上の階層なので「最近開いたプロジェクト」には混ぜない。
  const visibleRecentWorkspaces = useMemo(() => {
    const normalizedQuery = workspaceSwitcherQuery.trim().toLocaleLowerCase();
    return appState.recentWorkspaces.filter(
      (workspace) =>
        workspace.library?.role !== "root" &&
        (!normalizedQuery ||
          `${workspace.name}\n${workspace.path}`.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [appState.recentWorkspaces, workspaceSwitcherQuery]);
  const visibleKnownLibraries = useMemo(() => {
    const normalizedQuery = workspaceSwitcherQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return knownLibraries;
    return knownLibraries.filter((library) =>
      `${library.name}\n${library.path}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [knownLibraries, workspaceSwitcherQuery]);
  const patchActiveTab = useCallback(
    (updater: (tab: DocumentTab) => DocumentTab) => {
      setOpenTabs((current) =>
        current.map((tab) => (tab.id === activeTabId ? updater(tab) : tab)),
      );
    },
    [activeTabId],
  );
  const replaceActiveTab = useCallback(
    (nextTab: DocumentTab) => {
      setOpenTabs((current) => {
        if (current.some((tab) => tab.id === activeTabId)) {
          return current.map((tab) => (tab.id === activeTabId ? nextTab : tab));
        }
        return [...current, nextTab];
      });
      setActiveTabId(nextTab.id);
      lastSavedMarkdownRef.current = nextTab.savedMarkdown;
      setAppState((current) => ({
        ...current,
        markdown: nextTab.markdown,
        lastFilePath: nextTab.path ?? current.lastFilePath,
      }));
    },
    [activeTabId],
  );
  const syncDocumentTabToEditor = useCallback((tab: DocumentTab) => {
    const previousTabId = activeTabIdRef.current;
    const previousDocument = activeDocumentSnapshotRef.current;
    const previousSelection = editorInstanceRef.current?.getSelection() ?? null;
    if (tab.id !== previousTabId) {
      const viewportState = editorInstanceRef.current?.getViewportState() ?? null;
      setOpenTabs((current) =>
        current.map((item) =>
          item.id === previousTabId ? { ...item, viewportState } : item,
        ),
      );
    }
    didMountEditorRef.current = false;
    lastSavedMarkdownRef.current = tab.savedMarkdown;
    setActiveTabId(tab.id);
    setAppState((current) => ({
      ...current,
      markdown: tab.markdown,
      lastFilePath: tab.path ?? current.lastFilePath,
      cursorPositions:
        previousDocument?.path && previousSelection
          ? {
              ...current.cursorPositions,
              [previousDocument.path]: {
                offset: previousSelection.head,
                length: previousDocument.text.length,
              },
            }
          : current.cursorPositions,
    }));
    setFocusedFolderPath(null);
    setLastError("");
  }, []);
  const activateDocumentTab = useCallback(
    (tabId: string): boolean => {
      const tab = openTabs.find((item) => item.id === tabId);
      if (!tab) return false;
      syncDocumentTabToEditor(tab);
      return true;
    },
    [openTabs, syncDocumentTabToEditor],
  );
  const openDocumentInTab = useCallback(
    (
      document: TextDocument,
      placement: { index?: number; viewportState?: DocumentTab["viewportState"] } = {},
    ) => {
      const existingTab = openTabs.find((tab) => tab.path === document.path);
      if (existingTab) {
        syncDocumentTabToEditor(existingTab);
        return existingTab;
      }

      const nextTab: DocumentTab = {
        ...createFileDocumentTab(document),
        viewportState: placement.viewportState ?? null,
      };
      const anchorTabId = activeTabIdRef.current;
      setOpenTabs((current) => {
        if (placement.index === undefined) return insertTabAfter(current, nextTab, anchorTabId);
        const visible = withoutEmptyTabs(current);
        const index = Math.min(Math.max(placement.index, 0), visible.length);
        return [...visible.slice(0, index), nextTab, ...visible.slice(index)];
      });
      syncDocumentTabToEditor(nextTab);
      return nextTab;
    },
    [openTabs, syncDocumentTabToEditor],
  );
  const replaceActiveTabWithDocument = useCallback(
    (document: TextDocument) => {
      const nextTab = createFileDocumentTab(document);
      // 置き換えたタブは元の位置に残す。同じファイルを開いている別のタブは畳む。
      setOpenTabs((current) => {
        const replaced = current.some((tab) => tab.id === activeTabId)
          ? current.map((tab) => (tab.id === activeTabId ? nextTab : tab))
          : [...current, nextTab];
        return withoutEmptyTabs(replaced).filter(
          (tab) => tab.id === nextTab.id || tab.path !== document.path,
        );
      });
      syncDocumentTabToEditor(nextTab);
      return nextTab;
    },
    [activeTabId, syncDocumentTabToEditor],
  );
  const addScratchTab = useCallback(
    (documentKey = `new-${Date.now()}`, name = scratchFileName) => {
      const nextTab = createScratchDocumentTab("", {
        documentKey,
        name,
        saveStatus: name === newTabName ? "saved" : "dirty",
      });
      const anchorTabId = activeTabIdRef.current;
      setOpenTabs((current) => insertTabAfter(current, nextTab, anchorTabId));
      syncDocumentTabToEditor(nextTab);
      return nextTab;
    },
    [syncDocumentTabToEditor],
  );
  const setSaveStatus = useCallback(
    (nextStatus: SaveStatus) => {
      patchActiveTab((tab) => ({ ...tab, saveStatus: nextStatus }));
    },
    [patchActiveTab],
  );
  // The active document's full text as of the last write, ahead of the re-render.
  // Body and property edits build on it, so two edits in one frame don't undo each other.
  const activeMarkdownRef = useRef("");
  const setActiveMarkdown = useCallback(
    (nextMarkdown: string, editorRevision: number | null | "keep" = null, change: TextSplice | null = null) => {
      const previousMarkdown = activeMarkdownRef.current;
      activeMarkdownRef.current = nextMarkdown;
      const activeFile = openTabsRef.current.find((tab) => tab.id === activeTabId);
      if (activeFile?.path && previousMarkdown !== nextMarkdown) {
        // Every change of a saved document reaches its recovery journal.
        recordDocumentChange(activeFile.id, activeFile.path, previousMarkdown, nextMarkdown, change);
      }
      patchActiveTab((tab) => ({
        ...tab,
        markdown: nextMarkdown,
        // "keep": the body did not change, so the editor has nothing to sync.
        editorRevision: editorRevision === "keep" ? tab.editorRevision : editorRevision,
      }));
      setAppState((current) =>
        current.markdown === nextMarkdown ? current : { ...current, markdown: nextMarkdown },
      );
    },
    [activeTabId, patchActiveTab],
  );
  const markActiveTabSaved = useCallback(
    (savedMarkdown: string, name?: string) => {
      lastSavedMarkdownRef.current = savedMarkdown;
      patchActiveTab((tab) => {
        const savedLatestRevision = tab.markdown === savedMarkdown;
        return {
          ...tab,
          savedMarkdown,
          name: name ?? tab.name,
          saveStatus: savedLatestRevision ? "saved" : "dirty",
        };
      });
    },
    [patchActiveTab],
  );

  const enqueueDocumentSave = useCallback((request: DocumentSaveRequest): Promise<TextDocument> => {
    return new Promise<TextDocument>((resolve, reject) => {
      const queues = documentSaveQueuesRef.current;
      let queue = queues.get(request.tabId);
      const queuedRequest: QueuedDocumentSave = {
        ...request,
        waiters: [{ resolve, reject }],
      };

      if (!queue) {
        queue = { running: false, pending: null };
        queues.set(request.tabId, queue);
      }

      if (queue.running) {
        if (queue.pending) queuedRequest.waiters.push(...queue.pending.waiters);
        queue.pending = queuedRequest;
        return;
      }

      const runQueue = async (firstRequest: QueuedDocumentSave) => {
        if (!queue) return;
        queue.running = true;
        let currentRequest: QueuedDocumentSave | null = firstRequest;

        while (currentRequest) {
          const savingRequest: QueuedDocumentSave = currentRequest;
          setOpenTabs((current) =>
            current.map((tab) =>
              tab.id === savingRequest.tabId ? { ...tab, saveStatus: "saving" } : tab,
            ),
          );

          try {
            const document = await saveThroughJournal(
              savingRequest.tabId,
              savingRequest.path,
              savingRequest.content,
              savingRequest.journalPosition,
            );

            if (activeTabIdRef.current === savingRequest.tabId) {
              lastSavedMarkdownRef.current = document.content;
            }

            setOpenTabs((current) =>
              current.map((tab) => {
                if (tab.id !== savingRequest.tabId) return tab;
                const savedLatestRevision = tab.markdown === document.content;
                return {
                  ...tab,
                  savedMarkdown: document.content,
                  name: document.name,
                  fileId: document.fileId ?? tab.fileId,
                  contentHash: document.contentHash ?? tab.contentHash,
                  saveStatus: savedLatestRevision ? "saved" : "dirty",
                };
              }),
            );
            setLastError("");
            savingRequest.waiters.forEach((waiter) => waiter.resolve(document));
          } catch (error) {
            setLastError(String(error));
            setOpenTabs((current) =>
              current.map((tab) =>
                tab.id === savingRequest.tabId ? { ...tab, saveStatus: "error" } : tab,
              ),
            );
            savingRequest.waiters.forEach((waiter) => waiter.reject(error));
          }

          currentRequest = queue.pending;
          queue.pending = null;
        }

        queue.running = false;
        queues.delete(request.tabId);
      };

      void runQueue(queuedRequest);
    });
  }, []);

  const { snippets, settings } = appState;
  snippetStorageModeRef.current = settings.snippetStorageMode;
  const zoneRightEnabled = settings.sidebarHoverMode === "both" || settings.sidebarHoverMode === "right";
  // Zoneモードの右ペインの表示判定は .appShell の属性で行う（zoneRightHover.ts）。
  useEffect(() => {
    const shell = appShellRef.current;
    if (!shell || !zoneRightEnabled) return undefined;
    return trackZoneRightHover(shell);
  }, [zoneRightEnabled]);
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const shouldUseNativeFullscreen =
      isEditorFocusMode && settings.focusModeUsesNativeFullscreen;
    if (nativeFullscreenRequestedRef.current === shouldUseNativeFullscreen) return;

    nativeFullscreenRequestedRef.current = shouldUseNativeFullscreen;
    const requestId = nativeFullscreenRequestIdRef.current + 1;
    nativeFullscreenRequestIdRef.current = requestId;

    const appWindow = getCurrentWindow();
    // tao clamps a maximized borderless window's client area to the monitor
    // work area even while fullscreen, leaving the taskbar strip unpainted.
    // Leave the maximized state first and restore it after fullscreen ends.
    const applyFullscreen = async () => {
      if (shouldUseNativeFullscreen) {
        if (await appWindow.isMaximized()) {
          restoreMaximizedAfterFullscreenRef.current = true;
          await appWindow.unmaximize();
        }
        await appWindow.setFullscreen(true);
        return;
      }
      await appWindow.setFullscreen(false);
      if (restoreMaximizedAfterFullscreenRef.current) {
        restoreMaximizedAfterFullscreenRef.current = false;
        await appWindow.maximize();
      }
    };

    void applyFullscreen()
      .catch((error) => {
        if (nativeFullscreenRequestIdRef.current !== requestId) return;
        const message = shouldUseNativeFullscreen
          ? "完全フルスクリーンへの切り替えに失敗しました"
          : "通常ウィンドウへの復帰に失敗しました";
        setLastError(`${message}: ${String(error)}`);
        setToast(message);
        setToastAction(null);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => {
          setToast("");
          setToastAction(null);
        }, 2400);
      });
  }, [isEditorFocusMode, settings.focusModeUsesNativeFullscreen]);
  const collapsedTreeFolderPaths = useMemo(
    () =>
      new Set(
        projectFolder
          ? (appState.collapsedFolderPathsByWorkspace[projectFolder.path] ?? [])
          : [],
      ),
    [appState.collapsedFolderPathsByWorkspace, projectFolder],
  );
  const collapsedTreeOutlinePaths = useMemo(
    () =>
      new Set(
        projectFolder
          ? (appState.collapsedOutlinePathsByWorkspace[projectFolder.path] ?? [])
          : [],
      ),
    [appState.collapsedOutlinePathsByWorkspace, projectFolder],
  );
  const collapsedTreeOutlineHeadingKeys = useMemo(
    () =>
      new Set(
        projectFolder
          ? (appState.collapsedOutlineHeadingKeysByWorkspace[projectFolder.path] ?? [])
          : [],
      ),
    [appState.collapsedOutlineHeadingKeysByWorkspace, projectFolder],
  );
  const markdown = activeTab?.markdown ?? appState.markdown;
  activeMarkdownRef.current = markdown;
  const saveStatus = activeTab?.saveStatus ?? "loading";
  const currentFilePath = activeTab?.path ?? null;
  const currentFileName = activeTab?.name ?? scratchFileName;
  const documentKey = activeTab?.documentKey ?? "initial-document";
  const isNewTabStartPage =
    activeTab?.kind === "scratch" && activeTab.name === newTabName && markdown.trim() === "";
  const activeWorkspaceRootPath = useMemo(() => {
    if (!currentFilePath) return null;
    if (projectFolder && findContainingFolderPath(projectFolder, currentFilePath)) {
      return projectFolder.path;
    }
    // 作品はライブラリの中で開くため、作業フォルダの外のファイルから作業フォルダを推測しない。
    return null;
  }, [currentFilePath, projectFolder]);
  const currentWorkspaceSnapshots = useMemo(() => {
    if (!projectFolder) return [];
    return appState.snapshots
      .filter((snapshot) => isSamePath(snapshot.workspacePath, projectFolder.path))
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [appState.snapshots, projectFolder]);
  // ステータスバーの「保存点 2時間前 · +1,240字」。合計の引き算だけで、差分計算はしない。
  const latestManualSnapshot = useMemo(
    () => currentWorkspaceSnapshots.find((snapshot) => snapshot.reason === "manual") ?? null,
    [currentWorkspaceSnapshots],
  );
  const statusProjectVisibleTextLength = useMemo(() => {
    if (!settings.showCheckpointStatus || !projectAst || !projectFolder || projectAst.rootPath !== projectFolder.path) return null;
    if (projectAst.files.some((file) => file.status !== "indexed")) return null;
    return projectAst.files.reduce((sum, file) => sum + file.visibleTextLength, 0);
  }, [projectAst, projectFolder, settings.showCheckpointStatus]);
  // チェックポイント画面の「現在のプロジェクト」。字数は保存点と同じ表示文字数で数える。
  // 画面を開いているときだけ数え、入力中の経路には載せない。
  const checkpointProjectStats = useMemo(() => {
    if (appMode !== "checkpoint" || !projectAst || !projectFolder || projectAst.rootPath !== projectFolder.path) return null;
    return {
      fileCount: projectAst.files.length,
      visibleTextLength: projectAst.files.reduce((sum, file) => sum + file.visibleTextLength, 0),
    };
  }, [appMode, projectAst, projectFolder]);
  const frontMatter = useMemo(() => parseFrontMatter(markdown), [markdown]);
  // The editor works in LF. A CRLF file keeps CRLF in `markdown` (FM-29), so the
  // body is handed over in LF to match what the editor reports back.
  const editorText = useMemo(
    () => (frontMatter.body.includes("\r") ? frontMatter.body.replace(/\r\n?/g, "\n") : frontMatter.body),
    [frontMatter.body],
  );
  activeDocumentSnapshotRef.current = {
    path: currentFilePath,
    name: currentFileName,
    text: editorText,
  };
  useLayoutEffect(() => {
    const previous = pluginActiveDocumentRef.current;
    if (previous.path && currentFilePath && isSamePath(previous.path, currentFilePath)) {
      const relativePath = projectFolder
        ? pluginDocumentPath(projectFolder.path, currentFilePath)
        : null;
      if (relativePath && previous.text !== editorText) {
        const mapped = mapAnchorsThroughTextChange(
          pluginAnchorsRef.current,
          relativePath,
          previous.text,
          editorText,
        );
        if (mapped.changed) persistPluginAnchors(mapped.anchors);
        pluginRuntimeHostRef.current?.emit(
          "document.change",
          {
            documentPath: relativePath,
            version: Date.now(),
            changes: mapped.change,
            text: editorText,
          },
          "document:read",
        );
      }
    }
    pluginActiveDocumentRef.current = { path: currentFilePath, text: editorText };
  }, [currentFilePath, editorText, persistPluginAnchors, projectFolder]);

  // チェックポイントは「編集中の一枚」ではなくプロジェクト全体を比較する。
  // 画面へ入るたび、ディスク上の全本文を再取得し、未保存タブだけをその内容で上書きする。
  // 読み込み不能なパスを欠落扱いにしないことで、破損・権限エラーを誤った復元判断へつなげない。
  useEffect(() => {
    if (appMode !== "checkpoint" || !projectFolder) {
      setCheckpointCurrentProjectFiles(new Map());
      setCheckpointUnavailableProjectPaths(new Set());
      setCheckpointCurrentProjectStatus("idle");
      return;
    }

    let cancelled = false;
    const files = collectProjectTextFiles(projectFolder);
    const openTabsByPath = new Map(
      openTabs
        .filter((tab): tab is DocumentTab & { path: string } => Boolean(tab.path))
        .map((tab) => [normalizePathForCompare(tab.path), tab] as const),
    );
    const activeDocument = activeDocumentSnapshotRef.current;

    setCheckpointCurrentProjectFiles(new Map());
    setCheckpointUnavailableProjectPaths(new Set());
    setCheckpointCurrentProjectStatus("loading");

    const loadCurrentProjectFiles = async () => {
      const loaded = new Map<string, CheckpointCurrentProjectFile>();
      const unavailable = new Set<string>();

      await Promise.all(files.map(async (file) => {
        const key = normalizePathForCompare(file.path);
        const openTab = openTabsByPath.get(key);

        if (activeDocument?.path && normalizePathForCompare(activeDocument.path) === key) {
          loaded.set(key, { path: file.path, name: activeDocument.name || file.name, text: activeDocument.text });
          return;
        }
        if (openTab) {
          loaded.set(key, { path: file.path, name: openTab.name || file.name, text: parseFrontMatter(openTab.markdown).body });
          return;
        }
        if (!isTauriRuntime()) {
          unavailable.add(key);
          return;
        }

        try {
          const document = await invoke<TextDocument>("read_text_file", { path: file.path });
          loaded.set(key, { path: file.path, name: document.name || file.name, text: parseFrontMatter(document.content).body });
        } catch {
          unavailable.add(key);
        }
      }));

      if (cancelled) return;
      setCheckpointCurrentProjectFiles(loaded);
      setCheckpointUnavailableProjectPaths(unavailable);
      setCheckpointCurrentProjectStatus(unavailable.size ? "error" : "ready");
    };

    void loadCurrentProjectFiles();
    return () => { cancelled = true; };
  }, [appMode, editorText, openTabs, projectFolder]);
  // 前回終了時のカーソル位置。保存時点の本文長が現在と一致する場合のみ復元し、
  // 外部編集などで食い違う場合は先頭へフォールバックする。
  const initialSelectionOffset = useMemo(() => {
    if (!currentFilePath) return 0;
    const saved = appState.cursorPositions[currentFilePath];
    if (!saved || saved.length !== editorText.length) return 0;
    return Math.min(saved.offset, editorText.length);
  }, [appState.cursorPositions, currentFilePath, editorText]);
  const activeDocumentAst = useMemo(() => {
    const next = updateDocumentAst(activeDocumentAstCacheRef.current, {
      path: currentFilePath,
      name: currentFileName,
      text: editorText,
    });
    activeDocumentAstCacheRef.current = next;
    return next;
  }, [currentFileName, currentFilePath, editorText]);
  const charCount = displayedCharacterCount(activeDocumentAst, {
    includeWhitespace: settings.countWhitespace,
    includeCode: settings.countCode,
  });
  const outlineItems = activeDocumentAst.outline;
  const outlineFlatItems = useMemo<FlatOutlineItem[]>(
    () => flattenOutline(outlineItems),
    [outlineItems],
  );
  const activeEditorLine = editorSelectionLine;
  const activeOutlineChain = useMemo(
    () => findActiveOutlineChain(outlineItems, activeEditorLine),
    [activeEditorLine, outlineItems],
  );
  const activeOutlineIds = useMemo(
    () => new Set(activeOutlineChain.map((item) => item.id)),
    [activeOutlineChain],
  );
  const filteredOutlineItems = useMemo(() => {
    const normalized = outlineQuery.trim().toLowerCase();
    if (!normalized) return outlineFlatItems;
    return outlineFlatItems.filter((item) => item.title.toLowerCase().includes(normalized));
  }, [outlineFlatItems, outlineQuery]);
  const projectSearchOptions = useMemo<TextSearchOptions>(
    () => ({
      useRegex: projectSearchUseRegex,
      matchCase: projectSearchMatchCase,
      includeComments: searchIncludeComments,
    }),
    [projectSearchMatchCase, projectSearchUseRegex, searchIncludeComments],
  );
  // FM-28: [name:value] conditions narrow the search by property values. A regex
  // search keeps its brackets as pattern syntax.
  const propertyQuery = useMemo<PropertyQuery>(
    () =>
      projectSearchUseRegex
        ? { text: projectSearchQuery, conditions: [] }
        : parsePropertyQuery(projectSearchQuery),
    [projectSearchQuery, projectSearchUseRegex],
  );
  const hasPropertyConditions = propertyQuery.conditions.length > 0;
  const currentFileSearchOutcome = useMemo(
    () =>
      hasPropertyConditions
        ? EMPTY_WORKSPACE_SEARCH
        : searchDocumentAstFullText(
            activeDocumentAst,
            currentFilePath ?? "",
            currentFileName,
            projectSearchQuery,
            projectSearchOptions,
          ),
    [
      activeDocumentAst,
      currentFileName,
      currentFilePath,
      hasPropertyConditions,
      projectSearchOptions,
      projectSearchQuery,
    ],
  );
  const editorFindMatches = useMemo(
    () => collectEditorFindMatches(activeDocumentAst, editorFind.query, searchIncludeComments),
    [activeDocumentAst, editorFind.query, searchIncludeComments],
  );
  const activeEditorFindIndex =
    editorFindMatches.length === 0
      ? -1
      : Math.min(editorFind.activeIndex, editorFindMatches.length - 1);
  useEffect(() => {
    if (!editorFind.open) return;
    if (editorFind.activeIndex < editorFindMatches.length) return;
    setEditorFind((current) => ({
      ...current,
      activeIndex: Math.max(0, editorFindMatches.length - 1),
    }));
  }, [editorFind.activeIndex, editorFind.open, editorFindMatches.length]);
  const projectSearchOutcome = useMemo(
    () =>
      hasPropertyConditions
        ? EMPTY_WORKSPACE_SEARCH
        : searchProjectAstFullTextWithOptions(
            projectAst,
            projectSearchQuery,
            projectSearchOptions,
          ),
    [hasPropertyConditions, projectAst, projectSearchOptions, projectSearchQuery],
  );
  // ライブラリ全体の検索。開いている範囲は編集中の内容を、ほかの範囲はディスクから読んだ索引を使う。
  const pendingSearchJumpRef = useRef<ProjectSearchResult | null>(null);
  const searchResultOpenRef = useRef<(result: ProjectSearchResult) => Promise<void>>(async () => {});
  useEffect(() => {
    const pending = pendingSearchJumpRef.current;
    if (!pending || !projectFolder || !findProjectEntry(projectFolder.children, pending.path)) return;
    pendingSearchJumpRef.current = null;
    void searchResultOpenRef.current(pending);
  }, [projectFolder]);

  const [libraryCorpus, setLibraryCorpus] = useState<{
    libraryPath: string;
    excludedPath: string;
    scopes: { path: string; label: string; ast: ProjectAst }[];
    isLoading: boolean;
  } | null>(null);
  const libraryForSearch = projectFolder?.library ?? null;
  const currentScopeLabel = !projectFolder
    ? ""
    : libraryForSearch?.role === "root"
      ? "ライブラリ直下"
      : projectFolder.name;
  useEffect(() => {
    if (searchScope !== "library" || !libraryForSearch || !projectFolder || !isTauriRuntime()) return;
    if (
      libraryCorpus
      && libraryCorpus.libraryPath === libraryForSearch.path
      && libraryCorpus.excludedPath === projectFolder.path
    ) {
      return;
    }
    const scopePaths = [
      { path: libraryForSearch.path, label: "ライブラリ直下" },
      ...libraryForSearch.projects.map((project) => ({ path: project.path, label: project.name })),
    ].filter((scope) => !isSamePath(scope.path, projectFolder.path));
    const base = {
      libraryPath: libraryForSearch.path,
      excludedPath: projectFolder.path,
    };
    setLibraryCorpus({ ...base, scopes: [], isLoading: true });
    let cancelled = false;
    void (async () => {
      const scopes: { path: string; label: string; ast: ProjectAst }[] = [];
      for (const scope of scopePaths) {
        try {
          const index = await loadScopeIndex(scope.path);
          if (cancelled) return;
          scopes.push({ ...scope, ast: index.ast });
          setLibraryCorpus({ ...base, scopes: [...scopes], isLoading: true });
        } catch (error) {
          setLastError(String(error));
        }
      }
      if (!cancelled) setLibraryCorpus({ ...base, scopes, isLoading: false });
    })();
    return () => {
      cancelled = true;
    };
    // libraryCorpus is read only to skip a rebuild for the same library and open scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryForSearch, projectFolder, searchScope]);
  const librarySearchOutcome = useMemo(
    () =>
      searchScope !== "library" || hasPropertyConditions
        ? null
        : searchLibraryScopes(
            [
              { label: currentScopeLabel, ast: projectAst },
              ...(libraryCorpus?.scopes ?? []),
            ],
            projectSearchQuery,
            projectSearchOptions,
          ),
    [
      currentScopeLabel,
      hasPropertyConditions,
      libraryCorpus,
      projectAst,
      projectSearchOptions,
      projectSearchQuery,
      searchScope,
    ],
  );
  // The files a property search looks at, by scope.
  const propertySearchFiles = useMemo(() => {
    if (!hasPropertyConditions) return [];
    if (searchScope === "file") {
      return currentFilePath ? [{ path: currentFilePath, name: currentFileName }] : [];
    }
    const scopes = searchScope === "library"
      ? [{ label: currentScopeLabel, ast: projectAst }, ...(libraryCorpus?.scopes ?? [])]
      : [{ label: "", ast: projectAst }];
    return scopes.flatMap((scope) =>
      (scope.ast?.files ?? []).map((file) => ({
        path: file.path,
        name: scope.label && searchScope === "library" ? `${scope.label} › ${file.name}` : file.name,
      })),
    );
  }, [currentFileName, currentFilePath, currentScopeLabel, hasPropertyConditions, libraryCorpus, projectAst, searchScope]);
  const propertySearchPaths = useMemo(() => propertySearchFiles.map((file) => file.path), [propertySearchFiles]);
  const openDocumentTexts = useMemo(() => {
    const texts = new Map<string, string>();
    if (!hasPropertyConditions) return texts;
    for (const tab of openTabs) if (tab.path) texts.set(tab.path, tab.markdown);
    if (currentFilePath) texts.set(currentFilePath, markdown);
    return texts;
  }, [currentFilePath, hasPropertyConditions, markdown, openTabs]);
  const readFileTextForProperties = useCallback(
    async (path: string) => (await invoke<TextDocument>("read_text_file", { path })).content,
    [],
  );
  const propertyValueIndex = usePropertyValueIndex({
    enabled: hasPropertyConditions,
    paths: propertySearchPaths,
    openTexts: openDocumentTexts,
    readText: readFileTextForProperties,
  });
  const propertySearchOutcome = useMemo((): ProjectSearchOutcome | null => {
    if (!hasPropertyConditions) return null;
    const { conditions, text } = propertyQuery;
    const { valuesFor } = propertyValueIndex;
    const matches = (path: string) => matchesPropertyConditions(valuesFor(path) ?? null, conditions);
    const narrow = (ast: ProjectAst | null) =>
      ast ? { ...ast, files: ast.files.filter((file) => matches(file.path)) } : ast;
    if (!text) return propertyFileResults(propertySearchFiles, valuesFor, conditions);
    if (searchScope === "file") {
      return currentFilePath && matches(currentFilePath)
        ? searchDocumentAstFullText(activeDocumentAst, currentFilePath, currentFileName, text, projectSearchOptions)
        : EMPTY_WORKSPACE_SEARCH;
    }
    if (searchScope === "library") {
      return searchLibraryScopes(
        [{ label: currentScopeLabel, ast: projectAst }, ...(libraryCorpus?.scopes ?? [])].map((scope) => ({
          label: scope.label,
          ast: narrow(scope.ast),
        })),
        text,
        projectSearchOptions,
      );
    }
    return searchProjectAstFullTextWithOptions(narrow(projectAst), text, projectSearchOptions);
  }, [
    activeDocumentAst,
    currentFileName,
    currentFilePath,
    currentScopeLabel,
    hasPropertyConditions,
    libraryCorpus,
    projectAst,
    projectSearchOptions,
    propertyQuery,
    propertySearchFiles,
    propertyValueIndex,
    searchScope,
  ]);
  const workspaceSearchOutcome =
    propertySearchOutcome
      ?? (searchScope === "file"
        ? currentFileSearchOutcome
        : searchScope === "library" && librarySearchOutcome
          ? librarySearchOutcome
          : projectSearchOutcome);
  const breadcrumbTrail = useMemo(
    () => findPathToEntry(projectFolder, currentFilePath),
    [currentFilePath, projectFolder],
  );
  const hasActiveOutlineBreadcrumb =
    Boolean(currentFilePath) && activeOutlineChain.length > 0;
  const breadcrumbOverflowItems = useMemo<BreadcrumbOverflowItem[]>(() => {
    if (breadcrumbLayout === "full") return [];

    const items: BreadcrumbOverflowItem[] = [];
    breadcrumbTrail.forEach((crumb, index) => {
      const isVisible = isBreadcrumbTrailItemVisible(
        breadcrumbLayout,
        index,
        breadcrumbTrail.length,
        hasActiveOutlineBreadcrumb,
      );
      if (isVisible) return;

      const isFolder =
        "children" in crumb && (!("kind" in crumb) || crumb.kind === "folder");
      items.push({
        kind: isFolder ? "folder" : "file",
        name: crumb.name,
        path: crumb.path,
      });
    });

    if (!projectFolder && breadcrumbLayout === "minimal") {
      items.push({ kind: "scratch", name: scratchWorkspaceName });
    }

    activeOutlineChain.forEach((item, index) => {
      if (index === activeOutlineChain.length - 1) return;
      items.push({ kind: "outline", item });
    });
    return items;
  }, [
    activeOutlineChain,
    breadcrumbLayout,
    breadcrumbTrail,
    hasActiveOutlineBreadcrumb,
    projectFolder,
  ]);

  useLayoutEffect(() => {
    const breadcrumbs = breadcrumbMenuRef.current;
    if (!breadcrumbs) return;

    const updateLayout = (width: number) => {
      const nextLayout = getBreadcrumbLayout(width);
      setBreadcrumbLayout((current) =>
        current === nextLayout ? current : nextLayout,
      );
    };

    updateLayout(breadcrumbs.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateLayout(entry.contentRect.width);
    });
    observer.observe(breadcrumbs);
    const handleWindowResize = () => {
      updateLayout(breadcrumbs.getBoundingClientRect().width);
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [startupView]);

  useEffect(() => {
    if (breadcrumbOverflowItems.length === 0) {
      setIsBreadcrumbOverflowOpen(false);
    }
  }, [breadcrumbOverflowItems.length]);
  const sortedReferenceCandidates = useMemo(() => {
    const candidates = [...referenceCandidates];
    const recentIndex = new Map(
      referenceLayout.recent.map((file, index) => [referenceFileKey(file), index]),
    );
    if (!projectFolder) return candidates;
    const manuscriptPaths = new Set(
      collectProjectTextFiles(projectFolder).map((file) =>
        toProjectRelativePath(projectFolder.path, file.path).toLocaleLowerCase(),
      ),
    );
    return candidates
      .filter((file) => file.scope !== "project" || !manuscriptPaths.has(file.sourcePath.toLocaleLowerCase()))
      .sort((left, right) => {
        const leftIsManuscript =
          left.scope === "project" && manuscriptPaths.has(left.sourcePath.toLocaleLowerCase());
        const rightIsManuscript =
          right.scope === "project" && manuscriptPaths.has(right.sourcePath.toLocaleLowerCase());
        if (leftIsManuscript !== rightIsManuscript) return leftIsManuscript ? 1 : -1;
        const leftRecentIndex = recentIndex.get(referenceFileKey(left));
        const rightRecentIndex = recentIndex.get(referenceFileKey(right));
        if (leftRecentIndex !== undefined && rightRecentIndex !== undefined) {
          return leftRecentIndex - rightRecentIndex;
        }
        if (leftRecentIndex !== undefined) return -1;
        if (rightRecentIndex !== undefined) return 1;
        if (left.scope !== right.scope) return left.scope === "global" ? -1 : 1;
        return left.sourcePath.localeCompare(right.sourcePath);
      });
  }, [projectFolder, referenceCandidates, referenceLayout.recent]);

  const openPlotReference = useCallback(
    (sourcePath: string, fileInfo: ReferenceFileInfo) => {
      const file =
        sortedReferenceCandidates.find(
          (item) =>
            item.scope === fileInfo.scope &&
            item.sourcePath.toLocaleLowerCase() === sourcePath.toLocaleLowerCase(),
        ) ?? fileInfo;
      openReferenceCard(file.sourcePath, file, { switchToReferenceTab: false });
    },
    [openReferenceCard, sortedReferenceCandidates],
  );

  useEffect(() => {
    if (!projectFolder) {
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setProjectSearchQuery("");
      setSearchScope("file");
      referenceLayoutLoadedRootRef.current = null;
      setReferenceLayout(defaultReferenceLayout);
      setReferenceCandidates([]);
      return;
    }

    setProjectAst((current) => createProjectAstSkeleton(projectFolder, current));
  }, [projectFolder]);

  useEffect(() => {
    if (!isHydrated || !projectFolder) return;

    let isCancelled = false;
    const rootPath = projectFolder.path;
    referenceLayoutLoadedRootRef.current = null;

    const loadReferences = async () => {
      try {
        const rect = editorShellRef.current?.getBoundingClientRect();
        const [layout, candidates] = await Promise.all([
          loadReferenceLayout(rootPath),
          listReferenceCandidates(rootPath),
        ]);
        if (isCancelled) return;
        const normalizedLayout = alignIdeaLayoutToMode(
          normalizeReferenceLayout(layout, {
            width: rect?.width ?? 1200,
            height: rect?.height ?? 800,
          }),
          snippetStorageModeRef.current,
        );
        setReferenceLayout(normalizedLayout);
        setReferenceCandidates(candidates);
        referenceLayoutLoadedRootRef.current = rootPath;
      } catch (error) {
        if (isCancelled) return;
        setReferenceLayout(defaultReferenceLayout);
        setReferenceCandidates([]);
        // A failed load must not authorize the autosave effect to replace the on-disk layout.
        referenceLayoutLoadedRootRef.current = null;
        setLastError(String(error));
      }
    };

    void loadReferences();

    return () => {
      isCancelled = true;
    };
  }, [isHydrated, projectFolder]);

  useEffect(() => {
    const rootPath = projectFolder?.path ?? null;
    if (!isHydrated || !rootPath || referenceLayoutLoadedRootRef.current !== rootPath) return;

    if (referenceSaveTimerRef.current) {
      window.clearTimeout(referenceSaveTimerRef.current);
    }

    referenceSaveTimerRef.current = window.setTimeout(() => {
      saveReferenceLayout(rootPath, referenceLayout)
        .catch((error) => {
          setLastError(String(error));
        })
        .finally(() => {
          referenceSaveTimerRef.current = null;
        });
    }, 700);

    return () => {
      if (referenceSaveTimerRef.current) {
        window.clearTimeout(referenceSaveTimerRef.current);
        referenceSaveTimerRef.current = null;
      }
    };
  }, [isHydrated, projectFolder?.path, referenceLayout]);

  useEffect(() => {
    const rootPath = projectFolder?.path ?? null;
    if (!rootPath || referenceLayoutLoadedRootRef.current !== rootPath) return;
    setReferenceLayout((current) => {
      const ideaThreads = reconcileIdeaThreadLayouts(
        current.ideaThreads,
        snippets,
        referenceCandidates.filter((file) => file.scope === "project" && file.imported),
      );
      if (JSON.stringify(ideaThreads) === JSON.stringify(current.ideaThreads)) return current;
      return { ...current, version: 3, ideaThreads };
    });
  }, [projectFolder?.path, referenceCandidates, snippets]);

  useEffect(() => {
    const liveIdeas = new Set(
      snippets.flatMap((thread) =>
        thread.fragments.map((fragment) => `${thread.id}:${fragment.id}`),
      ),
    );
    setReferenceLayout((current) => {
      const cards = current.cards.filter(
        (card) =>
          !isIdeaBinderCard(card) || liveIdeas.has(`${card.threadId}:${card.fragmentId}`),
      );
      return cards.length === current.cards.length ? current : { ...current, cards };
    });
  }, [snippets]);

  useEffect(() => {
    const rootPath = projectFolder?.path ?? null;
    if (workspaceFolderTreeRootRef.current === rootPath) return;
    workspaceFolderTreeRootRef.current = rootPath;

    if (!projectFolder) {
      setCollapsedWorkspaceFolderPaths(new Set());
      return;
    }

    const collapsed = new Set<string>();
    const collectNestedFolders = (entries: ProjectEntry[]) => {
      for (const entry of entries) {
        if (entry.kind !== "folder") continue;
        collapsed.add(entry.path);
        collectNestedFolders(entry.children);
      }
    };
    collectNestedFolders(projectFolder.children);
    setCollapsedWorkspaceFolderPaths(collapsed);
  }, [projectFolder]);

  // Synchronize this component's derived state before its children commit.
  // An effect committed stale project counts first, then updated them in a
  // second commit. That extra layout also invalidated Chromium's text-input
  // cache for the long focused manuscript. AST identity makes this converge
  // after one retry; indexing and other-file updates still use setProjectAst.
  if (
    projectFolder && currentFilePath && projectAst?.rootPath === projectFolder.path &&
    findProjectEntry(projectFolder.children, currentFilePath) &&
    projectAst.files.find((file) => file.path === currentFilePath)?.documentAst !== activeDocumentAst
  ) {
    setProjectAst(upsertProjectAstDocumentAst(projectAst, activeDocumentAst));
  }

  useEffect(() => {
    if (!isHydrated || !isTauriRuntime() || !projectFolder) return;

    const files = collectProjectTextFiles(projectFolder);
    if (!files.length) return;

    let isCancelled = false;
    const buildId = projectAstBuildIdRef.current + 1;
    projectAstBuildIdRef.current = buildId;
    setProjectAst((current) => createProjectAstSkeleton(projectFolder, current));

    const indexFiles = async () => {
      const completedAsts: DocumentAst[] = [];
      const flushCompletedAsts = () => {
        if (completedAsts.length === 0) return;
        const completedBatch = completedAsts.splice(0, completedAsts.length);
        setProjectAst((current) =>
          current && current.rootPath === projectFolder.path
            ? upsertProjectAstDocumentAsts(current, completedBatch)
            : current,
        );
      };

      for (const file of files) {
        if (isCancelled || projectAstBuildIdRef.current !== buildId) return;

        const activeSnapshot = activeDocumentSnapshotRef.current;
        if (activeSnapshot?.path === file.path) {
          completedAsts.push(
            createDocumentAst({
              path: file.path,
              name: activeSnapshot.name || file.name,
              text: activeSnapshot.text,
            }),
          );
          if (completedAsts.length >= PROJECT_AST_INDEX_BATCH_SIZE) flushCompletedAsts();
          continue;
        }

        try {
          const document = await invoke<TextDocument>("read_text_file", { path: file.path });
          if (isCancelled || projectAstBuildIdRef.current !== buildId) return;

          const latestActiveSnapshot = activeDocumentSnapshotRef.current;
          const text =
            latestActiveSnapshot?.path === document.path
              ? latestActiveSnapshot.text
              : parseFrontMatter(document.content).body;
          const name =
            latestActiveSnapshot?.path === document.path
              ? latestActiveSnapshot.name
              : document.name;

          completedAsts.push(
            createDocumentAst({
              path: document.path,
              name,
              text,
            }),
          );
          if (completedAsts.length >= PROJECT_AST_INDEX_BATCH_SIZE) flushCompletedAsts();
        } catch (error) {
          if (isCancelled || projectAstBuildIdRef.current !== buildId) return;
          flushCompletedAsts();
          setProjectAst((current) =>
            current && current.rootPath === projectFolder.path
              ? markProjectAstFileError(current, file.path, error)
              : current,
          );
        }
      }
      flushCompletedAsts();
    };

    void indexFiles();

    return () => {
      isCancelled = true;
    };
  }, [isHydrated, projectFolder]);

  const openScratchFromStoredState = (
    state: AppState,
    alert: WorkspaceAlert = null,
  ) => {
    didMountEditorRef.current = false;
    setProjectFolder(null);
    setSnippetWorkspacePath(null);
    setPlotWorkspacePath(null);
    setPlotCards(defaultPlotCards);
    setProofreadTermsWorkspacePath(null);
    setProjectProofreadTerms([]);
    setProjectProofreadIgnored({});
    referenceLayoutLoadedRootRef.current = null;
    setReferenceLayout(defaultReferenceLayout);
    setReferenceCandidates([]);
    setFocusedFolderPath(null);
    replaceActiveTab(
      createScratchDocumentTab("", {
        documentKey: `scratch-${Date.now()}`,
        saveStatus: "saved",
      }),
    );
    setWorkspaceAlert(alert);
    setAppState({ ...state, markdown: "" });
    setLastError("");
  };

  const restoreWorkspaceFromState = async (
    state: AppState,
  ): Promise<boolean | "outsideLibrary"> => {
    if (!isTauriRuntime() || !state.lastWorkspacePath) return false;

    try {
      const folder = await invoke<ProjectFolder>("list_project_text_files", {
        folderPath: state.lastWorkspacePath,
      });
      // 旧版のワークスペースはそのまま開かず、取り込みへ誘導する。
      if (!folder.library) return "outsideLibrary";
      setProjectFolder(folder);
      setSearchScope("file");
      setProjectSearchQuery("");
      setWorkspaceAlert(null);
      const restoredSnippets =
        state.settings.snippetStorageMode === "workspace"
          ? await loadWorkspaceSnippets(folder.path)
          : state.snippets;
      const restoredPlotCards = await loadWorkspacePlotCards(folder.path);
      const restoredProofreadTerms = await loadWorkspaceProofreadTerms(folder.path);
      const restoredProofreadIgnored = await loadWorkspaceProofreadIgnored(folder.path);
      const restoredFileProgress = await loadWorkspaceFileProgress(folder.path, state);
      const restoredCheckpoints = await loadWorkspaceCheckpoints(folder.path, state);
      fileProgressStoreVersionsRef.current.set(portableProjectKey(folder.path), {
        revision: restoredFileProgress.revision,
        contentHash: restoredFileProgress.contentHash,
      });
      setSnippetWorkspacePath(
        state.settings.snippetStorageMode === "workspace" ? folder.path : null,
      );
      setPlotWorkspacePath(folder.path);
      setPlotCards(restoredPlotCards);
      setProofreadTermsWorkspacePath(folder.path);
      setProjectProofreadTerms(restoredProofreadTerms);
      setProjectProofreadIgnored(restoredProofreadIgnored);

      const restoredState: AppState = {
        ...state,
        snippets: restoredSnippets,
        recentWorkspaces: recordOpenedWorkspace(state.recentWorkspaces, folder),
      };
      const workspaceKey = workspaceDocumentTabsKey(folder.path);
      const savedTabs = state.documentTabsByWorkspace[workspaceKey];
      const restoredTabs = savedTabs?.tabs.length
        ? await loadWorkspaceDocumentTabs(folder, savedTabs)
        : null;
      // 保存タブがなければ空の状態にする（最初のファイルは自動で開かない）。
      const filePath = !restoredTabs?.tabs.length
        && state.lastFilePath
        && findProjectEntry(folder.children, state.lastFilePath)
        ? state.lastFilePath
        : null;
      const fallbackDocument = filePath
        ? await invoke<TextDocument>("read_text_file", { path: filePath })
        : null;
      const nextTabs = restoredTabs?.tabs.length
        ? restoredTabs.tabs
        : [
            fallbackDocument
              ? createFileDocumentTab(fallbackDocument)
              : createEmptyDocumentTab(),
          ];
      const nextTab = nextTabs[restoredTabs?.activeIndex ?? 0] ?? nextTabs[0];

      didMountEditorRef.current = false;
      setFocusedFolderPath(nextTab.path ? null : folder.path);
      setOpenTabs(nextTabs);
      syncDocumentTabToEditor(nextTab);

      let cursorPositions = { ...restoredState.cursorPositions };
      for (const move of restoredTabs?.moved ?? []) {
        const oldCursorKey = Object.keys(cursorPositions).find((path) =>
          isSamePath(path, move.oldPath),
        );
        if (oldCursorKey) {
          cursorPositions[move.newPath] = cursorPositions[oldCursorKey];
          delete cursorPositions[oldCursorKey];
        }
      }
      setAppState({
        ...restoredState,
        markdown: nextTab.markdown,
        lastWorkspacePath: folder.path,
        lastFilePath: nextTab.path,
        cursorPositions,
        fileProgress: replaceWorkspaceFileProgress(
          restoredState.fileProgress,
          folder.path,
          restoredFileProgress.fileProgress,
        ),
        fileProgressMigrationVersions: markFileProgressMigration(
          restoredState.fileProgressMigrationVersions,
          folder.path,
        ),
        snapshots: replaceWorkspaceSnapshots(
          restoredState.snapshots,
          folder.path,
          restoredCheckpoints.snapshots,
        ),
        checkpointMigrationVersions: markCheckpointMigration(
          restoredState.checkpointMigrationVersions,
          folder.path,
          restoredCheckpoints.migrationComplete,
        ),
        documentTabsByWorkspace: {
          ...restoredState.documentTabsByWorkspace,
          [workspaceKey]: createWorkspaceDocumentTabs(nextTabs, nextTab.id),
        },
      });
      if (restoredCheckpoints.warnings.length) {
        showToast(checkpointWarningMessage(restoredCheckpoints.warnings[0]));
      }
      setLastError("");
      setSaveStatus("saved");
      const restoreSummary = [
        restoredTabs?.moved.length
          ? `移動したタブ ${restoredTabs.moved.length}件を追跡しました`
          : "",
        restoredTabs?.missingNames.length
          ? `見つからないタブ ${restoredTabs.missingNames.length}件を除外しました`
          : "",
      ].filter(Boolean).join(" / ");
      if (restoreSummary) showToast(restoreSummary);
      return true;
    } catch (error) {
      const message = portableStorageErrorMessage(error);
      openScratchFromStoredState(state, {
        path: state.lastWorkspacePath,
        message: `前回の作業フォルダを開けませんでした。${message}`,
      });
      setLastError(`${message} ${String(error)}`);
      return false;
    }
  };

  useEffect(() => {
    let isCancelled = false;

    loadStoredState()
      .then(async (state) => {
        if (isCancelled) return;
        setRightSidebarTabState(state.rightSidebarTab);

        if (
          isTauriRuntime() &&
          state.settings.skipStartupPortal &&
          state.lastWorkspacePath
        ) {
          const restored = await restoreWorkspaceFromState(state);
          if (!isCancelled) setStartupView(restored === true ? "editor" : "portal");
          if (restored === "outsideLibrary") {
            openScratchFromStoredState(state);
            setWorkspaceAlert({
              path: state.lastWorkspacePath,
              message: "前回の作品はライブラリに取り込まれていません。一覧から選ぶと取り込めます。",
            });
          }
          return;
        }

        openScratchFromStoredState(state);
        setStartupView("portal");
      })
      .catch(() => {
        if (isCancelled) return;
        setSaveStatus("error");
        setStartupView("portal");
      })
      .finally(() => {
        if (!isCancelled) setIsHydrated(true);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    loadSystemFonts()
      .then((fonts) => {
        if (!isCancelled) setSystemFonts(fonts);
      })
      .catch(() => {
        if (!isCancelled) setSystemFonts(fallbackFontOptions);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveStoredState(appState)
        .catch(() => {
          setLastError("アプリ状態の保存に失敗しました");
        });
      saveTimerRef.current = null;
    }, 700);
  }, [appState, isHydrated]);

  // カーソル位置の記憶。移動が落ち着いた後に現在ファイルの位置を保存する。
  useEffect(() => {
    if (!isHydrated || !currentFilePath) return;
    const path = currentFilePath;
    const offset = editorSelectionHead;
    const length = editorText.length;

    const timer = window.setTimeout(() => {
      setAppState((current) => {
        const previous = current.cursorPositions[path];
        if (previous && previous.offset === offset && previous.length === length) {
          return current;
        }
        return {
          ...current,
          cursorPositions: { ...current.cursorPositions, [path]: { offset, length } },
        };
      });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [currentFilePath, editorSelectionHead, editorText, isHydrated]);

  useEffect(() => {
    if (!isHydrated || !projectFolder || settings.snippetStorageMode !== "workspace") return;
    if (snippetWorkspacePath !== projectFolder.path) return;

    const timer = window.setTimeout(() => {
      saveWorkspaceSnippets(projectFolder.path, snippets).catch(() => {
        setLastError("ワークスペースのスニペット保存に失敗しました");
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [isHydrated, projectFolder, settings.snippetStorageMode, snippetWorkspacePath, snippets]);

  useEffect(() => {
    if (!isHydrated || !projectFolder) return;
    if (plotWorkspacePath !== projectFolder.path) return;

    const timer = window.setTimeout(() => {
      saveWorkspacePlotCards(projectFolder.path, plotCards).catch(() => {
        setLastError("ワークスペースのプロット保存に失敗しました");
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [isHydrated, plotCards, plotWorkspacePath, projectFolder]);

  useEffect(() => {
    if (!isHydrated || !projectFolder) return;
    if (proofreadTermsWorkspacePath !== projectFolder.path) return;

    const timer = window.setTimeout(() => {
      saveWorkspaceProofreadTerms(projectFolder.path, projectProofreadTerms).catch(() => {
        setLastError("ワークスペースの校正辞書の保存に失敗しました");
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [isHydrated, projectFolder, projectProofreadTerms, proofreadTermsWorkspacePath]);

  useEffect(() => {
    if (!isHydrated || !projectFolder) return;
    if (proofreadTermsWorkspacePath !== projectFolder.path) return;

    const timer = window.setTimeout(() => {
      saveWorkspaceProofreadIgnored(projectFolder.path, projectProofreadIgnored).catch(() => {
        setLastError("無視した指摘の保存に失敗しました");
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [isHydrated, projectFolder, projectProofreadIgnored, proofreadTermsWorkspacePath]);

  useEffect(() => {
    if (!isHydrated || !isTauriRuntime()) return;
    if (settings.snippetStorageMode !== "workspace") return;
    if (workspaceSwitchInProgressRef.current) return;
    if (!currentFilePath || !activeWorkspaceRootPath) return;
    if (snippetWorkspacePath === activeWorkspaceRootPath && projectFolder?.path === activeWorkspaceRootPath) {
      return;
    }

    let isCancelled = false;
    const workspaceSwitchGeneration = workspaceSwitchGenerationRef.current;

    Promise.all([
      projectFolder?.path === activeWorkspaceRootPath
        ? Promise.resolve(projectFolder)
        : invoke<ProjectFolder>("list_project_text_files", {
            folderPath: activeWorkspaceRootPath,
          }),
      loadWorkspaceSnippets(activeWorkspaceRootPath),
      loadWorkspacePlotCards(activeWorkspaceRootPath),
      loadWorkspaceProofreadTerms(activeWorkspaceRootPath),
      loadWorkspaceProofreadIgnored(activeWorkspaceRootPath),
      loadWorkspaceFileProgress(activeWorkspaceRootPath, appStateRef.current),
      loadWorkspaceCheckpoints(activeWorkspaceRootPath, appStateRef.current),
    ])
      .then(([
        folder,
        workspaceSnippets,
        workspacePlotCards,
        workspaceProofreadTerms,
        workspaceProofreadIgnored,
        workspaceFileProgress,
        workspaceCheckpoints,
      ]) => {
        if (isCancelled) return;
        if (workspaceSwitchGeneration !== workspaceSwitchGenerationRef.current) return;
        fileProgressStoreVersionsRef.current.set(portableProjectKey(folder.path), {
          revision: workspaceFileProgress.revision,
          contentHash: workspaceFileProgress.contentHash,
        });
        setProjectFolder(folder);
        setFocusedFolderPath(null);
        setWorkspaceAlert(null);
        setSnippetWorkspacePath(folder.path);
        setPlotWorkspacePath(folder.path);
        setPlotCards(workspacePlotCards);
        setProofreadTermsWorkspacePath(folder.path);
        setProjectProofreadTerms(workspaceProofreadTerms);
        setProjectProofreadIgnored(workspaceProofreadIgnored);
        setAppState((current) => ({
          ...current,
          snippets: workspaceSnippets,
          lastWorkspacePath: folder.path,
          lastFilePath: currentFilePath,
          fileProgress: replaceWorkspaceFileProgress(
            current.fileProgress,
            folder.path,
            workspaceFileProgress.fileProgress,
          ),
          fileProgressMigrationVersions: markFileProgressMigration(
            current.fileProgressMigrationVersions,
            folder.path,
          ),
          snapshots: replaceWorkspaceSnapshots(
            current.snapshots,
            folder.path,
            workspaceCheckpoints.snapshots,
          ),
          checkpointMigrationVersions: markCheckpointMigration(
            current.checkpointMigrationVersions,
            folder.path,
            workspaceCheckpoints.migrationComplete,
          ),
        }));
        if (workspaceCheckpoints.warnings.length) {
          showToast(checkpointWarningMessage(workspaceCheckpoints.warnings[0]));
        }
      })
      .catch((error) => {
        if (isCancelled) return;
        if (workspaceSwitchGeneration !== workspaceSwitchGenerationRef.current) return;
        setLastError(String(error));
        setSaveStatus("error");
      });

    return () => {
      isCancelled = true;
    };
  }, [
    activeWorkspaceRootPath,
    currentFilePath,
    isHydrated,
    projectFolder,
    settings.snippetStorageMode,
    snippetWorkspacePath,
  ]);

  useEffect(() => {
    if (!isHydrated || !didMountEditorRef.current || !currentFilePath) return;
    if (projectEntryPathChangeInProgressRef.current) return;
    if (markdown === lastSavedMarkdownRef.current) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("dirty");
    const timer = window.setTimeout(() => {
      if (projectEntryPathChangeInProgressRef.current) return;
      void enqueueDocumentSave({
        tabId: activeTabId,
        path: currentFilePath,
        content: markdown,
        journalPosition: journalPositionOf(activeTabId, markdown),
      }).catch(() => undefined);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [activeTabId, currentFilePath, enqueueDocumentSave, isHydrated, markdown, setSaveStatus]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (typewriterScrollFrameRef.current) {
        window.cancelAnimationFrame(typewriterScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isModeMenuOpen) return;
    // 開いたら現在のモードにフォーカスし、矢印キーでそのまま選べるようにする。
    const menu = modeMenuRef.current;
    const target =
      menu?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]') ??
      menu?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    target?.focus();
  }, [isModeMenuOpen]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (!fileMenuRef.current?.contains(target)) {
        setIsFileMenuOpen(false);
      }
      if (!modeMenuRef.current?.contains(target)) {
        setIsModeMenuOpen(false);
      }
      if (!breadcrumbMenuRef.current?.contains(target)) {
        setActiveBreadcrumbPath(null);
        setBreadcrumbBrowsePath(null);
        setIsBreadcrumbOverflowOpen(false);
        setIsWorkspaceSwitcherOpen(false);
      }
      if (!editorContextMenuRef.current?.contains(target)) {
        setEditorContextMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsEditorFocusMode(false);
      setIsFileMenuOpen(false);
      setIsModeMenuOpen(false);
      setActiveBreadcrumbPath(null);
      setBreadcrumbBrowsePath(null);
      setIsBreadcrumbOverflowOpen(false);
      setIsWorkspaceSwitcherOpen(false);
      setEditorContextMenu(null);
      setNotationModal(null);
      setIsQuickIdeaModalOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const updateSelectionCharCount = useCallback(
    (
      editor: TextEditorHandle | null,
      knownSelection?: { from: number; to: number; head: number },
    ) => {
      if (!editor) {
        setSelectionCharCount(null);
        return;
      }
      const selection = knownSelection ?? editor.getSelection();
      if (selection.from === selection.to) {
        setSelectionCharCount(null);
        return;
      }
      const selectedText = editor.getValue().slice(selection.from, selection.to);
      setSelectionCharCount(
        countDisplayCharacters(selectedText, settings.countWhitespace),
      );
    },
    [settings.countWhitespace],
  );

  const handleEditorReady = useCallback(
    (editor: TextEditorHandle | null) => {
      editorInstanceRef.current = editor;
      if (editor) {
        // マウント時の選択復元は onReady より先に完了するため、ここで親側にも
        // 実位置を同期する。同期しないと以前の値（初期値0を含む）がカーソル保存へ
        // 流れ、次回のタブ復帰時に先頭として復元されることがある。
        const selection = editor.getSelection();
        setEditorSelectionHead(selection.head);
        setEditorSelectionLine(selection.line);
        updateSelectionCharCount(editor, selection);
        return;
      }
      updateSelectionCharCount(null);
    },
    [updateSelectionCharCount],
  );

  const handleEditorViewportSizeChange = useCallback(
    (size: { width: number; height: number; verticalPadding: number } | null) => {
      setEditorViewportSize(size);
    },
    [],
  );

  const isVerticalWriting = settings.writingMode === "vertical-rl";
  const editorFontFamily = useVerticalMetricFontFamily(settings.editorFontFamily, isVerticalWriting);
  const editorHeadingFontFamily = useVerticalMetricFontFamily(
    settings.headingFontSource === "custom" ? settings.headingFontFamily : settings.editorFontFamily,
    isVerticalWriting,
  );

  /**
   * 文字表示幅 100% に相当する実測px。横書きは左右ガター 64px（App.css の
   * `calc(100% - 64px)` と対応）、縦書きは .pm-root の上下パディング実測値を
   * 引いた編集領域。設定 UI で百分率の実寸を表示するために使う。
   */
  const editorMeasureLimit = useMemo(() => {
    if (!editorViewportSize) return null;
    const available =
      settings.writingMode === "horizontal-tb"
        ? editorViewportSize.width - 64
        : editorViewportSize.height - editorViewportSize.verticalPadding;
    return Math.max(0, Math.floor(available));
  }, [editorViewportSize, settings.writingMode]);

  const handleBreadcrumbKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const menu = breadcrumbMenuRef.current?.querySelector(".menuPopover");
    if (!menu) return;

    if (event.key === "Escape") {
      setActiveBreadcrumbPath(null);
      setBreadcrumbBrowsePath(null);
      setIsBreadcrumbOverflowOpen(false);
      setIsWorkspaceSwitcherOpen(false);
      setIsOutlineMenuOpen(false);
      event.preventDefault();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const focusableItems = Array.from(
      menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button[role="menuitem"]:not(:disabled), input:not(:disabled)',
      ),
    ).filter((item) => item.offsetParent !== null);

    if (!focusableItems.length) return;

    const currentIndex = focusableItems.findIndex((item) => item === document.activeElement);
    let nextIndex = currentIndex;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = focusableItems.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % focusableItems.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        currentIndex < 0
          ? focusableItems.length - 1
          : (currentIndex - 1 + focusableItems.length) % focusableItems.length;
    }

    focusableItems[nextIndex]?.focus();
    event.preventDefault();
  }, []);

  const applyTypewriterScroll = useCallback(() => {
    if (!settings.typewriterScroll) return;

    const editor = editorInstanceRef.current;
    if (!editor || editor.isComposing()) return;
    const selection = editor.getSelection();
    if (selection.from !== selection.to) return;
    editor.scrollCaretIntoView(settings.typewriterOffset);
  }, [settings.typewriterOffset, settings.typewriterScroll]);

  const scheduleTypewriterScroll = useCallback(() => {
    if (!settings.typewriterScroll) return;
    if (typewriterScrollFrameRef.current) {
      window.cancelAnimationFrame(typewriterScrollFrameRef.current);
    }
    typewriterScrollFrameRef.current = window.requestAnimationFrame(() => {
      typewriterScrollFrameRef.current = null;
      applyTypewriterScroll();
    });
  }, [applyTypewriterScroll, settings.typewriterScroll]);

  useEffect(() => {
    if (!settings.typewriterScroll) {
      if (typewriterScrollFrameRef.current) {
        window.cancelAnimationFrame(typewriterScrollFrameRef.current);
        typewriterScrollFrameRef.current = null;
      }
      return;
    }
    scheduleTypewriterScroll();
  }, [scheduleTypewriterScroll, settings.typewriterScroll]);

  const handleTextChange = useCallback((nextText: string, editorRevision: number, change?: TextSplice | null) => {
    didMountEditorRef.current = true;
    const previousPluginDocument = pluginActiveDocumentRef.current;
    const relativePath =
      projectFolder && previousPluginDocument.path
        ? pluginDocumentPath(projectFolder.path, previousPluginDocument.path)
        : null;
    // Both scan the whole manuscript, so only run them for an anchor or plugin that needs them.
    if (
      relativePath &&
      pluginAnchorsRef.current.some((anchor) => anchor.documentPath === relativePath)
    ) {
      const mapped = mapAnchorsThroughTextChange(
        pluginAnchorsRef.current,
        relativePath,
        previousPluginDocument.text,
        nextText,
      );
      if (mapped.changed) persistPluginAnchors(mapped.anchors);
    }
    pluginActiveDocumentRef.current = { path: previousPluginDocument.path, text: nextText };
    pluginRuntimeHostRef.current?.emit(
      "document.change",
      () => ({
        documentPath: relativePath,
        version: editorRevision,
        changes: computeTextChange(previousPluginDocument.text, nextText),
        text: nextText,
      }),
      "document:read",
    );
    const currentMarkdown = activeMarkdownRef.current;
    const layout = updateMarkdownBodyDetailed(currentMarkdown, nextText);
    const nextFullText = layout.markdown;
    if (currentMarkdown !== nextFullText) {
      // The editor's own splice, placed in the full text, spares the journal a
      // comparison of the two texts.
      setActiveMarkdown(nextFullText, editorRevision, placeBodyChange(currentMarkdown, layout, nextText, change));
    }
    if (!currentFilePath) {
      setSaveStatus("dirty");
    }
  }, [
    currentFilePath,
    persistPluginAnchors,
    projectFolder,
    setActiveMarkdown,
    setSaveStatus,
  ]);

  useEffect(() => {
    updateSelectionCharCount(editorInstanceRef.current);
  }, [updateSelectionCharCount]);

  useEffect(() => {
    setSelectionCharCount(null);
  }, [documentKey]);

  const updateFrontMatter = useCallback((metadata: string) => {
    const currentMarkdown = activeMarkdownRef.current;
    const nextMarkdown = replaceFrontMatter(currentMarkdown, metadata);
    if (currentMarkdown !== nextMarkdown) {
      // A property edit is an edit of this document: it must reach the autosave
      // even when the body has not been touched since the document was opened.
      didMountEditorRef.current = true;
      setActiveMarkdown(nextMarkdown, "keep");
    }
    if (!currentFilePath) {
      setSaveStatus("dirty");
    }
  }, [currentFilePath, setActiveMarkdown, setSaveStatus]);

  // Type chosen per property name (FM-20 ①), shared by every work in the open
  // library and saved in its .then/library.json (FM-21). Outside a library the
  // types are kept for this session only.
  const [propertyTypeSettings, setPropertyTypeSettings] = useState<PropertyTypeSettings>({});
  const propertyTypeScope = projectFolder?.path ?? null;
  const propertyTypeScopeRef = useRef(propertyTypeScope);
  propertyTypeScopeRef.current = propertyTypeScope;
  useEffect(() => {
    setPropertyTypeSettings({});
    if (!propertyTypeScope || !isTauriRuntime()) return;
    let cancelled = false;
    loadPropertyTypes(propertyTypeScope).then(
      (saved) => {
        if (!cancelled) setPropertyTypeSettings(saved);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [propertyTypeScope]);
  const rememberPropertyType = useCallback((key: string, type: PropertyType) => {
    setPropertyTypeSettings((current) => (current[key] === type ? current : { ...current, [key]: type }));
    const scope = propertyTypeScopeRef.current;
    if (!scope || !isTauriRuntime()) return;
    savePropertyType(scope, key, type).then(
      (saved) => {
        // A library switched meanwhile has its own types.
        if (propertyTypeScopeRef.current === scope) setPropertyTypeSettings((current) => ({ ...current, ...saved }));
      },
      // Not in a library: the type stays for this session.
      () => {},
    );
  }, []);
  // Escape in the properties: back to the body at the caret it had (FM-16).
  const returnFocusFromProperties = useCallback(() => {
    editorInstanceRef.current?.focus();
  }, []);
  // A list item in the properties pane searches the work for that value (FM-28).
  const searchByProperty = useCallback((key: string, value: string) => {
    setProjectSearchQuery(propertyConditionQuery(key, value));
    setProjectSearchUseRegex(false);
    setSearchScope((current) => (current === "file" && projectFolder ? "project" : current));
    setLeftSidebarView("search");
    setIsLeftSidebarCollapsed(false);
  }, [projectFolder]);
  // Sets the properties pane can add (FM-27): the built-in article set (FM-25),
  // then every template, of this work or of the profile, that has properties.
  const loadPropertySets = useCallback(async (): Promise<PropertySet[]> => {
    const sets: PropertySet[] = [ARTICLE_PROPERTY_SET];
    if (!isTauriRuntime()) return sets;
    const rootPath = propertyTypeScopeRef.current;
    const templates = await invoke<TextTemplateSummary[]>("list_text_templates", { rootPath }).catch(
      () => [] as TextTemplateSummary[],
    );
    for (const template of templates) {
      try {
        const content = await invoke<string>("read_text_template", { rootPath, templateId: template.id });
        const parts = parseFrontMatter(content);
        if (parts.hasFrontMatter && parts.metadata.trim()) {
          sets.push({ id: template.id, name: template.name, metadata: parts.metadata });
        }
      } catch {
        // A template that cannot be read is left out of the menu.
      }
    }
    return sets;
  }, []);

  const handleClearFrontMatter = useCallback(async () => {
    if (!frontMatter.hasFrontMatter) return;
    const shouldClear = await requestConfirm({
      title: "プロパティを削除",
      message: "プロパティをすべて削除しますか？",
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldClear) return;
    updateFrontMatter("");
  }, [frontMatter.hasFrontMatter, updateFrontMatter]);

  const handleSelectionChange = useCallback(() => {
    const editor = editorInstanceRef.current;
    if (editor) {
      const selection = editor.getSelection();
      setEditorSelectionHead(selection.head);
      setEditorSelectionLine(selection.line);
      updateSelectionCharCount(editor, selection);
      pluginRuntimeHostRef.current?.emit(
        "selection.change",
        {
          documentPath:
            projectFolder && currentFilePath
              ? pluginDocumentPath(projectFolder.path, currentFilePath)
              : null,
          from: selection.from,
          to: selection.to,
          head: selection.head,
          line: selection.line,
          text: editor.getValue().slice(selection.from, selection.to),
        },
        "document:selection",
      );
      return;
    }
    updateSelectionCharCount(null);
    // 選択変化に伴うタイプライター再センタリングはエディタ内部に一本化した。
    // App 側の scheduleTypewriterScroll は設定・オフセット変更時の再適用専用に残す。
  }, [currentFilePath, projectFolder, updateSelectionCharCount]);

  const showToast = (message: string, action: ToastAction | null = null) => {
    setToast(message);
    setToastAction(action);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      setToastAction(null);
      toastTimerRef.current = null;
    }, action ? 5000 : 2200);
  };

  const refreshPortableProjectState = useCallback(
    async (rootPath: string, source: "focus" | "checkpoint") => {
      if (!isTauriRuntime()) return;
      const key = portableProjectKey(rootPath);
      const existing = portableProjectRefreshesRef.current.get(key);
      if (existing) return existing;

      const notify = (message: string, duration = 3200) => {
        setToast(message);
        setToastAction(null);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => {
          setToast("");
          setToastAction(null);
          toastTimerRef.current = null;
        }, duration);
      };

      const operation = (async () => {
        await fileProgressSaveQueueRef.current.catch(() => undefined);
        const mutationGeneration = portableProjectMutationGenerationRef.current.get(key) ?? 0;
        const state = appStateRef.current;
        const [progress, checkpoints] = await Promise.all([
          loadWorkspaceFileProgress(rootPath, state),
          loadWorkspaceCheckpoints(rootPath, state),
        ]);
        if (
          (portableProjectMutationGenerationRef.current.get(key) ?? 0) !== mutationGeneration
        ) {
          return;
        }
        const knownProgress = fileProgressStoreVersionsRef.current.get(key);
        const knownSnapshots = state.snapshots.filter((snapshot) =>
          isSamePath(snapshot.workspacePath, rootPath),
        );
        const deletedIds = deletedCheckpointIdsRef.current.get(key);
        const resurrected = deletedIds
          ? checkpoints.snapshots.find((snapshot) => deletedIds.has(snapshot.id))
          : null;
        const conflict = resurrected
          ? `削除済みのチェックポイント「${resurrected.label}」が再出現しました。同期の巻き戻りを確認してください。`
          : detectPortableProjectConflict(
              knownProgress,
              progress,
              knownSnapshots,
              checkpoints.snapshots,
            );
        if (conflict) {
          portableProjectConflictsRef.current.set(key, conflict);
          setLastError(conflict);
          notify(conflict, 6000);
          return;
        }

        const changed = hasWorkspaceFileProgressChanged(
          state.fileProgress,
          rootPath,
          progress.fileProgress,
        ) || knownSnapshots.length !== checkpoints.snapshots.length ||
          knownSnapshots.some((known) => {
            const next = checkpoints.snapshots.find((snapshot) => snapshot.id === known.id);
            return !next ||
              next.revision !== known.revision ||
              next.storageHash !== known.storageHash;
          });

        fileProgressStoreVersionsRef.current.set(key, {
          revision: progress.revision,
          contentHash: progress.contentHash,
        });
        portableProjectConflictsRef.current.delete(key);
        setAppState((current) => ({
          ...current,
          fileProgress: replaceWorkspaceFileProgress(
            current.fileProgress,
            rootPath,
            progress.fileProgress,
          ),
          fileProgressMigrationVersions: markFileProgressMigration(
            current.fileProgressMigrationVersions,
            rootPath,
          ),
          snapshots: replaceWorkspaceSnapshots(
            current.snapshots,
            rootPath,
            checkpoints.snapshots,
          ),
          checkpointMigrationVersions: markCheckpointMigration(
            current.checkpointMigrationVersions,
            rootPath,
            checkpoints.migrationComplete,
          ),
        }));

        if (checkpoints.warnings.length) {
          notify(checkpointWarningMessage(checkpoints.warnings[0]), 5000);
        } else if (changed) {
          notify(
            source === "checkpoint"
              ? "同期されたチェックポイントを再読込しました"
              : "同期されたプロジェクト状態を再読込しました",
          );
        }
      })().catch((error) => {
        const message = portableStorageErrorMessage(error);
        portableProjectConflictsRef.current.set(key, message);
        setLastError(`${message} ${String(error)}`);
        notify(message, 5000);
      });

      portableProjectRefreshesRef.current.set(key, operation);
      try {
        await operation;
      } finally {
        if (portableProjectRefreshesRef.current.get(key) === operation) {
          portableProjectRefreshesRef.current.delete(key);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const rootPath = projectFolder?.path;
    if (!isHydrated || !rootPath || !isTauriRuntime()) return;
    const refreshOnFocus = () => {
      if (document.visibilityState === "hidden") return;
      void refreshPortableProjectState(rootPath, "focus");
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [isHydrated, projectFolder?.path, refreshPortableProjectState]);

  useEffect(() => {
    const rootPath = projectFolder?.path;
    if (appMode !== "checkpoint" || !rootPath) return;
    void refreshPortableProjectState(rootPath, "checkpoint");
  }, [appMode, projectFolder?.path, refreshPortableProjectState]);

  const canWritePortableProjectState = (rootPath: string): boolean => {
    const conflict = portableProjectConflictsRef.current.get(portableProjectKey(rootPath));
    if (!conflict) return true;
    setLastError(conflict);
    showToast("同期・取得状態を確認して再読込するまで、プロジェクト状態の保存を停止します");
    return false;
  };

  const waitForPortableProjectWrite = async (rootPath: string): Promise<boolean> => {
    await portableProjectRefreshesRef.current
      .get(portableProjectKey(rootPath))
      ?.catch(() => undefined);
    return canWritePortableProjectState(rootPath);
  };

  const beginPortableProjectMutation = (rootPath: string) => {
    const key = portableProjectKey(rootPath);
    portableProjectMutationGenerationRef.current.set(
      key,
      (portableProjectMutationGenerationRef.current.get(key) ?? 0) + 1,
    );
  };

  const reportPortableStorageError = (rootPath: string, error: unknown) => {
    const message = portableStorageErrorMessage(error);
    portableProjectConflictsRef.current.set(portableProjectKey(rootPath), message);
    setLastError(`${message} ${String(error)}`);
    showToast(message);
  };

  const openIdeaCanvasBoard = async (
    scope: CanvasScope = "project",
    boardId?: string,
    selectNodeId?: string,
  ) => {
    if (scope !== "project") {
      showToast("共通Canvasは廃止されました");
      return;
    }
    if (!projectFolder) {
      showToast("Project Canvas はプロジェクトを開いている時に利用できます");
      return;
    }

    const payload: CanvasWindowPayload = {
      requestId: String(Date.now()),
      rootPath: projectFolder.path,
      workspaceName: projectFolder.name,
      scope: "project",
      boardId,
      selectNodeId,
      theme: settings.theme,
      editorFontFamily: settings.editorFontFamily,
      uiFontFamily: settings.uiFontFamily,
      uiFontScale: settings.uiFontScale,
      canvasDefaultWritingMode: settings.canvasDefaultWritingMode,
      canvasDefaultFontSource: settings.canvasDefaultFontSource,
      ideaThreads: snippets.map((thread) => ({
        id: thread.id,
        kind: thread.kind,
        title: thread.title,
        fragments: thread.fragments.map((fragment) => ({
          id: fragment.id,
          body: fragment.body,
          used: fragment.used,
        })),
      })),
      referenceFiles: projectFolder ? sortedReferenceCandidates : [],
      rightSidebarVisible: !isRightSidebarCollapsed,
    };

    if (!settings.canvasOpensInWindow) {
      // メイン画面のキャンバスモードとして開く。
      setCanvasEmbedPayload(payload);
      setAppMode("canvas");
      return;
    }

    if (!isTauriRuntime()) {
      window.open("?view=canvas", "_blank", "noopener,noreferrer");
      return;
    }

    try {
      await invoke("open_canvas_window", { payload });
    } catch (error) {
      setLastError(String(error));
      showToast("Idea Board を開けませんでした");
    }
  };

  const closeEditorContextMenu = () => {
    setEditorContextMenu(null);
  };

  const writeClipboardText = async (text: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard write is not available");
    }
    await navigator.clipboard.writeText(text);
  };

  const readClipboardText = async () => {
    if (!navigator.clipboard?.readText) {
      throw new Error("Clipboard read is not available");
    }
    return navigator.clipboard.readText();
  };

  const handleEditorContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest(".verticalTypewriterShell")) return;

    const editor = editorInstanceRef.current;
    if (!editor) return;

    event.preventDefault();
    setIsFileMenuOpen(false);
    setActiveBreadcrumbPath(null);
    setBreadcrumbBrowsePath(null);
    setIsWorkspaceSwitcherOpen(false);
    setIsOutlineMenuOpen(false);

    const currentText = editor.getValue();
    let snapshot = normalizeSelectionRange(editor.getSelection(), currentText);
    if (snapshot.from === snapshot.to) {
      const pointOffset = editor.positionFromPoint(event.clientX, event.clientY);
      if (pointOffset !== null) {
        snapshot = normalizeSelectionRange({ from: pointOffset, to: pointOffset }, currentText);
      }
    }

    setEditorContextMenu({
      ...snapshot,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const copyEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    if (!selection || selection.from === selection.to) {
      showToast("コピーする範囲を選択してください");
      return;
    }

    try {
      await writeClipboardText(selection.text);
      showToast("コピーしました");
    } catch {
      showToast("クリップボードへコピーできませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const cutEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection || selection.from === selection.to) {
      showToast("切り取る範囲を選択してください");
      return;
    }

    try {
      await writeClipboardText(selection.text);
      editor.replaceRange(selection.from, selection.to, "", selection.from);
      editor.focus();
      showToast("切り取りました");
    } catch {
      showToast("クリップボードへ切り取れませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const pasteIntoEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection) return;

    try {
      const pastedText = await readClipboardText();
      if (!pastedText) return;
      editor.replaceRange(
        selection.from,
        selection.to,
        pastedText,
        selection.from + pastedText.length,
      );
      editor.focus();
      showToast("貼り付けました");
    } catch {
      showToast("クリップボードから貼り付けできませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const applyInlineNotation = (
    selection: EditorSelectionSnapshot,
    notation: "ruby" | "tcy" | "emphasis",
    argument = "",
  ) => {
    const editor = editorInstanceRef.current;
    if (!editor) return false;

    const currentSelection = normalizeSelectionRange(selection, editor.getValue());
    if (!canWrapInlineSelection(currentSelection)) {
      showToast("単一行の範囲を選択してください");
      return false;
    }

    const arg = sanitizeNotationArgument(argument);
    if (notation === "ruby" && !arg) {
      setNotationModal((current) =>
        current?.type === "ruby" ? { ...current, error: "ルビを入力してください" } : current,
      );
      return false;
    }

    const method =
      notation === "ruby" ? `rb,${arg}` : notation === "emphasis" ? "em,goma" : "tcy";
    const insert = `[${currentSelection.text}(${method})]`;

    editor.replaceRange(
      currentSelection.from,
      currentSelection.to,
      insert,
      currentSelection.from + insert.length,
    );
    editor.focus();
    showToast(`${customNotationSpecs.find((item) => item.id === notation)?.label}を反映しました`);
    return true;
  };

  const applyDirectionNotation = (
    selection: EditorSelectionSnapshot,
    direction: LayoutDirection,
  ) => {
    const editor = editorInstanceRef.current;
    if (!editor) return false;

    const currentText = editor.getValue();
    const currentSelection = normalizeSelectionRange(selection, currentText);
    const replacement = applyDirectionToSelection(currentText, currentSelection, direction);

    editor.replaceRange(
      replacement.from,
      replacement.to,
      replacement.insert,
      replacement.cursorPos,
    );
    editor.focus();
    showToast("文章方向を反映しました");
    return true;
  };

  const clearSelectionNotation = (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection) return false;

    const currentText = editor.getValue();
    const currentSelection = normalizeSelectionRange(selection, currentText);
    const replacement = clearNotationFromSelection(currentText, currentSelection);

    if (!replacement.changed) {
      showToast("クリアできる記法がありません");
      closeEditorContextMenu();
      return false;
    }

    editor.replaceRange(
      replacement.from,
      replacement.to,
      replacement.insert,
      replacement.cursorPos,
    );
    editor.focus();
    showToast("記法をクリアしました");
    closeEditorContextMenu();
    return true;
  };

  // --- キーボードショートカット / コマンドパレット用の編集アクション ---
  // いずれも現在のエディタ選択をその場で読み取って適用する。

  const getCurrentEditorSelection = (): EditorSelectionSnapshot | null => {
    const editor = editorInstanceRef.current;
    if (!editor) return null;
    return normalizeSelectionRange(editor.getSelection(), editor.getValue());
  };

  const closeCommandPalette = (_reason: "dismiss" | "command") => {
    setIsCommandPaletteOpen(false);
    commandPaletteSelectionRef.current = null;
  };

  const restoreFocusAfterCommandPalette = (target: HTMLElement) => {
    const editor = editorInstanceRef.current;
    if (editor && target.closest(".pm-root")) {
      editor.restoreFocus();
    } else {
      target.focus({ preventScroll: true });
    }
  };

  const applyBoldShortcut = (selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = toggleBoldSelection(text, selection);
    if (!edit) {
      showToast("太字にする単一行の範囲を選択してください");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
  };

  const applyEmphasisShortcut = (selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = toggleEmphasisSelection(text, selection);
    if (!edit) {
      showToast("圏点を付ける単一行の範囲を選択してください");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
  };

  const applyHeadingShortcut = (level: number, selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = applyHeadingToSelection(text, selection, level);
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
    showToast(level <= 0 ? "見出しを解除しました" : `見出し${level}を設定しました`);
  };

  const applyLineCommentToggle = (selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = toggleLineComments(text, selection.from, selection.to);
    if (!edit) return;
    if ("blocked" in edit) {
      showToast("コード内ではコメントにできません（ブロック全体を選ぶとまとめてコメントにできます）");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.selectionTo);
    if (edit.selectionFrom !== edit.selectionTo) editor.selectRange(edit.selectionFrom, edit.selectionTo);
    editor.focus();
  };

  const toggleShowComments = () => {
    const next = !settings.showComments;
    updateSettings("showComments", next);
    showToast(next ? "コメントを表示しました" : "コメントを非表示にしました");
  };

  const focusEditorFindInput = () => {
    window.requestAnimationFrame(() => {
      editorFindInputRef.current?.focus();
      editorFindInputRef.current?.select();
    });
  };

  const selectEditorFindMatch = (match: EditorFindMatch | null | undefined) => {
    const editor = editorInstanceRef.current;
    if (!editor || !match) return;
    editor.selectRange(match.from, match.to);
  };

  const openEditorFind = () => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    let nextQuery = editorFind.query;
    const selection = normalizeSelectionRange(editor.getSelection(), editor.getValue());
    if (selection.from !== selection.to && !selection.text.includes("\n")) {
      nextQuery = selection.text;
    }
    setEditorFind((current) => ({
      ...current,
      open: true,
      query: nextQuery,
      activeIndex: 0,
    }));
    focusEditorFindInput();
  };

  const closeEditorFind = () => {
    setEditorFind((current) => ({ ...current, open: false }));
    editorInstanceRef.current?.focus();
  };

  const moveEditorFindMatch = (delta: number) => {
    if (editorFindMatches.length === 0) return;
    const currentIndex = activeEditorFindIndex < 0 ? 0 : activeEditorFindIndex;
    const nextIndex =
      (currentIndex + delta + editorFindMatches.length) % editorFindMatches.length;
    setEditorFind((current) => ({ ...current, activeIndex: nextIndex }));
    selectEditorFindMatch(editorFindMatches[nextIndex]);
  };

  const replaceActiveEditorFindMatch = () => {
    const editor = editorInstanceRef.current;
    if (!editor || activeEditorFindIndex < 0) return;
    const match = editorFindMatches[activeEditorFindIndex];
    editor.replaceRange(
      match.from,
      match.to,
      editorFind.replaceValue,
      match.from + editorFind.replaceValue.length,
    );
    setEditorFind((current) => ({
      ...current,
      activeIndex: Math.min(current.activeIndex, Math.max(0, editorFindMatches.length - 2)),
    }));
  };

  const replaceAllEditorFindMatches = () => {
    const editor = editorInstanceRef.current;
    if (!editor || !editorFind.query.trim()) return;
    const currentText = editor.getValue();
    const result = replaceLiteralMatches(
      currentText,
      editorFind.query,
      editorFind.replaceValue,
      searchIncludeComments,
    );
    if (result.count === 0) {
      showToast("置換できる一致がありません");
      return;
    }
    const caret = mapTextOffsetThroughChange(currentText, result.text, editor.getSelection().head);
    editor.replaceRange(0, currentText.length, result.text, caret);
    setEditorFind((current) => ({ ...current, activeIndex: 0 }));
    showToast(`${result.count}件を置換しました`);
  };

  const handleEditorFindQueryChange = (value: string) => {
    setEditorFind((current) => ({ ...current, query: value, activeIndex: 0 }));
  };

  const handleEditorFindKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditorFind();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      moveEditorFindMatch(event.shiftKey ? -1 : 1);
    }
  };

  // 最新のクロージャを常に参照するため、ハンドラ本体は ref 経由で呼び出す。
  const editorShortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  editorShortcutHandlerRef.current = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;

    // Ctrl+Alt+I：Idea ペインを開かずにメモを追加する。
    if (mod && event.altKey && !event.shiftKey && (key === "i" || key === "I")) {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      setIsQuickIdeaModalOpen(true);
      return;
    }

    if (mod && event.altKey && !event.shiftKey && (key === "b" || key === "B")) {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      void openIdeaCanvasBoard("project");
      return;
    }

    // タブ操作：Ctrl+W / Ctrl+(Shift+)Tab / Ctrl+PageUp・PageDown / Ctrl+Shift+T。
    const isDocumentTabShortcut = mod && !event.altKey && (
      (!event.shiftKey && (key === "w" || key === "W")) ||
      key === "Tab" ||
      (!event.shiftKey && (key === "PageUp" || key === "PageDown")) ||
      (event.shiftKey && (key === "t" || key === "T"))
    );
    if (isDocumentTabShortcut) {
      if (appMode !== "write" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat && (key === "w" || key === "W")) return;
      // 設定画面や確認ダイアログの裏でタブが動かないようにする。
      if (document.querySelector(".modalBackdrop")) return;
      setIsCommandPaletteOpen(false);
      if (key === "w" || key === "W") {
        void closeDocumentTab();
      } else if (key === "t" || key === "T") {
        void reopenClosedDocumentTab();
      } else if (key === "Tab") {
        activateRelativeDocumentTab(event.shiftKey ? -1 : 1);
      } else {
        activateRelativeDocumentTab(key === "PageUp" ? -1 : 1);
      }
      return;
    }

    const reservedThenShortcut = mod && (
      (!event.altKey && !event.shiftKey && ["n", "f", "p", "b", "i", "0", "1", "2", "3", "4", "5", "6"].includes(key.toLowerCase())) ||
      (!event.altKey && event.code === "Slash") ||
      (!event.altKey && event.shiftKey && key.toLowerCase() === "s") ||
      (event.altKey && !event.shiftKey && ["i", "b"].includes(key.toLowerCase()))
    );
    if (!reservedThenShortcut) {
      const pluginCommand = pluginCommandsRef.current.find(
        (command) => command.keybinding && matchesThenPluginKeybinding(event, command.keybinding),
      );
      if (pluginCommand) {
        event.preventDefault();
        setIsCommandPaletteOpen(false);
        pluginRuntimeHostRef.current?.executeCommand(pluginCommand.pluginId, pluginCommand.id);
        return;
      }
    }

    if (!mod || event.altKey) return;

    // Ctrl+Shift+/：コメントの表示・非表示（エディタ外でも有効）。
    if (event.code === "Slash" && event.shiftKey) {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      toggleShowComments();
      return;
    }

    // Ctrl+Shift+S：今の状態を保存点にする（どの画面からでも、確認なしの一押し）。
    if (event.shiftKey && (key === "s" || key === "S")) {
      event.preventDefault();
      if (event.repeat || event.isComposing || document.querySelector(".modalBackdrop")) return;
      setIsCommandPaletteOpen(false);
      void handleQuickCreateManuscriptSnapshot();
      return;
    }

    if (key === "n" || key === "N") {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      void handleNewDocument();
      return;
    }

    if (key === "f" || key === "F") {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      openEditorFind();
      return;
    }

    // Ctrl+P：コマンドパレット。印刷ダイアログの既定動作を抑止する。
    if (key === "p" || key === "P") {
      event.preventDefault();
      if (isCommandPaletteOpen) {
        closeCommandPalette("dismiss");
      } else {
        commandPaletteSelectionRef.current = getCurrentEditorSelection();
        setIsCommandPaletteOpen(true);
      }
      return;
    }

    // 以降はエディタにフォーカスがある場合のみ。
    const editorFocused = Boolean(
      (document.activeElement as Element | null)?.closest?.(".pm-root"),
    );
    if (!editorFocused) return;

    if (key === "b" || key === "B") {
      event.preventDefault();
      applyBoldShortcut();
    } else if (key === "i" || key === "I") {
      event.preventDefault();
      applyEmphasisShortcut();
    } else if (/^[0-6]$/.test(key)) {
      event.preventDefault();
      applyHeadingShortcut(Number(key));
    } else if (event.code === "Slash") {
      event.preventDefault();
      applyLineCommentToggle();
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => editorShortcutHandlerRef.current(event);
    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, []);

  const openRubyNotationModal = (selection: EditorSelectionSnapshot | null) => {
    if (!selection || !canWrapInlineSelection(selection)) {
      showToast("ルビを付ける単一行の範囲を選択してください");
      closeEditorContextMenu();
      return;
    }
    setNotationModal({ type: "ruby", selection, reading: "", error: "" });
    closeEditorContextMenu();
  };

  const openDirectionNotationModal = (selection: EditorSelectionSnapshot | null) => {
    if (!selection) return;
    setNotationModal({ type: "direction", selection });
    closeEditorContextMenu();
  };

  const openManuscriptTidy = (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    closeEditorContextMenu();
    if (!editor) return;
    const text = editor.getValue();
    let selectionLines: ManuscriptTidyLineRange | null = null;
    if (selection && selection.from !== selection.to) {
      const lineAt = (offset: number) => text.slice(0, offset).split("\n").length - 1;
      const from = lineAt(selection.from);
      // 次の行の頭で終わる選択は、その行を含めない。
      const endsAtLineStart = text[selection.to - 1] === "\n";
      selectionLines = { from, to: Math.max(from, lineAt(selection.to) - (endsAtLineStart ? 1 : 0)) };
    }
    setManuscriptTidyRequest({ text, selectionLines });
  };

  const applyManuscriptTidy = (result: ManuscriptTidyResult) => {
    const editor = editorInstanceRef.current;
    const request = manuscriptTidyRequest;
    setManuscriptTidyRequest(null);
    if (!editor || !request) return;
    const currentText = editor.getValue();
    if (currentText !== request.text) {
      showToast("本文が変わったため、整えませんでした");
      return;
    }
    const caret = mapTextOffsetThroughChange(currentText, result.text, editor.getSelection().head);
    editor.replaceRange(0, currentText.length, result.text, caret);
    const parts = [
      result.indented > 0 ? `字下げ${result.indented}行` : "",
      result.spaced > 0 ? `空き${result.spaced}か所` : "",
    ].filter(Boolean);
    showToast(`原稿を整えました（${parts.join("・")}）`);
  };

  const submitRubyNotation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (notationModal?.type !== "ruby") return;
    if (applyInlineNotation(notationModal.selection, "ruby", notationModal.reading)) {
      setNotationModal(null);
    }
  };

  const chooseDirectionNotation = (direction: LayoutDirection) => {
    if (notationModal?.type !== "direction") return;
    if (applyDirectionNotation(notationModal.selection, direction)) {
      setNotationModal(null);
    }
  };

  const buildPaletteCommands = (): PaletteCommand[] => {
    const selection = commandPaletteSelectionRef.current ?? getCurrentEditorSelection();
    const editor = editorInstanceRef.current;
    const table = editor && selection ? tableAtOffset(editor.getValue(), selection.from) : null;
    const tableDisabled = table ? undefined : "表のセルにカーソルを置いてください";
    const canWrap = selection ? canWrapInlineSelection(selection) : false;
    const wrapDisabled = canWrap ? undefined : "単一行の範囲を選択してください";

    const headingCommands: PaletteCommand[] = [1, 2, 3, 4, 5, 6].map((level) => ({
      id: `heading-${level}`,
      label: `見出し${level}`,
      hint: `Ctrl+${level}`,
      run: () => applyHeadingShortcut(level, selection ?? undefined),
    }));
    const workspaceCommands: PaletteCommand[] = [
      {
        id: "workspace-open",
        label: "別のプロジェクトを開く...",
        hint: "Workspace",
        run: () => void openWorkspace(),
      },
      ...appState.recentWorkspaces.map((workspace) => ({
        id: `workspace-open-${workspace.path}`,
        label: `プロジェクトを開く: ${workspace.name}`,
        hint: settings.showWorkspacePaths ? workspace.path : "Workspace",
        run: () => void openWorkspace(workspace.path),
      })),
    ];

    return [
      {
        id: "table-insert",
        label: "表を挿入…",
        hint: "行数・列数を指定",
        disabledReason: editor ? undefined : "本文を開いてください",
        run: () => void (async () => {
          if (!editor || !selection) return;
          const originalText = editor.getValue();
          const values = await requestMultiInput({
            title: "表を挿入",
            fields: [
              { id: "columns", label: "列数", initialValue: "3", options: Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}列` })) },
              { id: "rows", label: "データ行数（見出しを除く）", initialValue: "3", options: Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}行` })) },
            ],
            confirmLabel: "挿入",
          });
          if (!values) return;
          if (editorInstanceRef.current !== editor || editor.getValue() !== originalText) {
            showToast("本文が変わったため、挿入位置を選び直してください");
            return;
          }
          const before = originalText.slice(0, selection.from);
          const after = originalText.slice(selection.to);
          const prefix = before ? (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") : "";
          const suffix = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
          const insert = prefix + createMarkdownTable(Number(values.columns), Number(values.rows)) + suffix;
          const cursor = selection.from + prefix.length + 1;
          editor.replaceRange(selection.from, selection.to, insert, cursor);
          editor.selectRange(cursor, cursor + "見出し1".length);
          editor.focus();
          showToast("表を挿入しました。セルを編集できます");
        })(),
      },
      ...([ ["start", "開始揃え（横書き：左／縦書き：上）"], ["center", "中央揃え"], ["end", "終了揃え（横書き：右／縦書き：下）"] ] as const).map(([alignment, label]) => ({
        id: `table-align-${alignment}`,
        label: `表：この列を${label}`,
        hint: table ? `${table.column + 1}列目` : "列の配置",
        disabledReason: tableDisabled,
        run: () => {
          if (!editor || !selection) return;
          const edit = tableAlignmentEdit(editor.getValue(), selection.from, alignment);
          if (!edit) return;
          editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
          editor.focus();
          showToast(`列を${label}にしました`);
        },
      })),
      {
        id: "line-comment-toggle",
        label: "行をコメントにする／戻す",
        hint: "Ctrl+/",
        disabledReason: editor ? undefined : "本文を開いてください",
        run: () => applyLineCommentToggle(selection ?? undefined),
      },
      {
        id: "comments-visibility",
        label: settings.showComments ? "コメントを非表示にする" : "コメントを表示する",
        hint: "Ctrl+Shift+/",
        run: toggleShowComments,
      },
      {
        id: "bold",
        label: "太字",
        hint: "Ctrl+B",
        run: () => applyBoldShortcut(selection ?? undefined),
      },
      {
        id: "emphasis",
        label: "圏点（傍点）",
        hint: "Ctrl+I",
        disabledReason: wrapDisabled,
        run: () => applyEmphasisShortcut(selection ?? undefined),
      },
      {
        id: "checkpoint-create",
        label: "今の状態を保存点にする",
        hint: "Ctrl+Shift+S",
        disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
        run: () => void handleQuickCreateManuscriptSnapshot(),
      },
      {
        id: "checkpoint-open",
        label: "チェックポイントを開く",
        hint: "Checkpoint",
        disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
        run: () => openCheckpointStudio(),
      },
      {
        id: "idea-quick-capture",
        label: "Idea にメモを追加…",
        hint: "Ctrl+Alt+I",
        run: () => setIsQuickIdeaModalOpen(true),
      },
      {
        id: "idea-board-open",
        label: "Idea Board を開く",
        hint: "Ctrl+Alt+B",
        disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
        run: () => void openIdeaCanvasBoard("project"),
      },
      {
        id: "idea-board-project",
        label: "Project Canvas を開く",
        hint: "Canvas",
        disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
        run: () => void openIdeaCanvasBoard("project"),
      },
      {
        id: "ruby",
        label: "ルビ…",
        hint: customNotationSpecs[0].syntax,
        disabledReason: wrapDisabled,
        run: () => openRubyNotationModal(selection),
      },
      {
        id: "tcy",
        label: "縦中横",
        hint: customNotationSpecs[1].syntax,
        disabledReason: wrapDisabled,
        run: () => {
          if (selection) applyInlineNotation(selection, "tcy");
        },
      },
      ...headingCommands,
      {
        id: "heading-clear",
        label: "見出しを解除",
        hint: "Ctrl+0",
        run: () => applyHeadingShortcut(0, selection ?? undefined),
      },
      {
        id: "direction",
        label: "文章方向…",
        hint: customNotationSpecs[3].syntax,
        run: () => openDirectionNotationModal(selection),
      },
      {
        id: "clear-notation",
        label: "記法をクリア",
        run: () => clearSelectionNotation(selection),
      },
      {
        id: "manuscript-tidy",
        label: "原稿を整える…",
        hint: "字下げ・！？の後の空き",
        disabledReason: editor ? undefined : "エディタを開いてください",
        run: () => openManuscriptTidy(selection),
      },
      ...workspaceCommands,
      {
        id: "plugin-manage",
        label: "プラグインを管理…",
        hint: `${loadedPlugins.length} installed`,
        run: () => setIsPluginManagerOpen(true),
      },
      ...pluginCommands.map((command) => ({
        id: `plugin:${command.pluginId}:${command.id}`,
        label: command.title,
        hint: command.keybinding ?? command.pluginId,
        run: () => pluginRuntimeHostRef.current?.executeCommand(command.pluginId, command.id),
      })),
    ];
  };

  const requestInput = ({
    title,
    label,
    initialValue,
    confirmLabel,
    placeholder,
    optional = false,
  }: {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    placeholder?: string;
    optional?: boolean;
  }) =>
    new Promise<string | null>((resolve) => {
      setAppDialog({
        type: "input",
        title,
        label,
        value: initialValue,
        confirmLabel,
        placeholder,
        optional,
        error: "",
        resolve,
      });
    });

  const requestMultiInput = ({
    title,
    fields,
    confirmLabel,
  }: {
    title: string;
    fields: {
      id: string;
      label: string;
      initialValue: string;
      placeholder?: string;
      optional?: boolean;
      multiline?: boolean;
      options?: { value: string; label: string }[];
    }[];
    confirmLabel: string;
  }) =>
    new Promise<Record<string, string> | null>((resolve) => {
      setAppDialog({
        type: "multiInput",
        title,
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label,
          value: field.initialValue,
          placeholder: field.placeholder,
          optional: field.optional,
          multiline: field.multiline,
          options: field.options,
        })),
        confirmLabel,
        error: "",
        resolve,
      });
    });

  const requestCreateFile = (templates: TextTemplateSummary[]) =>
    new Promise<{ fileName: string; templateId: string | null } | null>((resolve) => {
      setAppDialog({
        type: "createFile",
        title: "新規ファイルを作成",
        fileName: "新規ノート",
        extension: "txt",
        templateId: "",
        templates,
        confirmLabel: "作成",
        error: "",
        resolve,
      });
    });

  const requestConfirm = ({
    title,
    message,
    detail,
    confirmLabel,
    danger = false,
  }: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) =>
    new Promise<boolean>((resolve) => {
      setAppDialog({
        type: "confirm",
        title,
        message,
        detail,
        confirmLabel,
        danger,
        resolve,
      });
    });

  const requestChoice = ({
    title,
    message,
    detail,
    primaryLabel,
    secondaryLabel,
  }: {
    title: string;
    message: string;
    detail?: string;
    primaryLabel: string;
    secondaryLabel: string;
  }) =>
    new Promise<"primary" | "secondary" | null>((resolve) => {
      setAppDialog({
        type: "choice",
        title,
        message,
        detail,
        primaryLabel,
        secondaryLabel,
        resolve,
      });
    });

  const closeAppDialog = () => {
    setAppDialog((current) => {
      if (!current) return null;
      if (current.type === "input") {
        current.resolve(null);
      } else if (current.type === "multiInput") {
        current.resolve(null);
      } else if (current.type === "createFile") {
        current.resolve(null);
      } else if (current.type === "confirm") {
        current.resolve(false);
      } else {
        current.resolve(null);
      }
      return null;
    });
  };

  const submitAppDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppDialog((current) => {
      if (!current) return null;
      if (current.type === "confirm") {
        current.resolve(true);
        return null;
      }
      if (current.type === "choice") {
        current.resolve("primary");
        return null;
      }
      if (current.type === "options") return current;
      if (current.type === "multiInput") {
        const values: Record<string, string> = {};
        for (const field of current.fields) {
          const value = field.value.trim();
          if (!value && !field.optional) {
            return { ...current, error: `${field.label}を入力してください` };
          }
          values[field.id] = value;
        }
        current.resolve(values);
        return null;
      }
      if (current.type === "createFile") {
        const baseName = current.fileName.trim().replace(/\.(?:txt|md)$/i, "").trim();
        if (!baseName) {
          return { ...current, error: "テキストファイル名を入力してください" };
        }
        current.resolve({
          fileName: `${baseName}.${current.extension}`,
          templateId: current.templateId || null,
        });
        return null;
      }

      const value = current.value.trim();
      if (!value && !current.optional) {
        return { ...current, error: "名前を入力してください" };
      }
      current.resolve(value);
      return null;
    });
  };

  const updateAppDialogValue = (value: string) => {
    setAppDialog((current) =>
      current?.type === "input" ? { ...current, value, error: "" } : current,
    );
  };

  const updateAppDialogFieldValue = (fieldId: string, value: string) => {
    setAppDialog((current) => {
      if (current?.type === "createFile") {
        if (fieldId === "fileName") return { ...current, fileName: value, error: "" };
        if (fieldId === "extension") {
          return value === "txt" || value === "md"
            ? { ...current, extension: value, error: "" }
            : current;
        }
        if (fieldId === "templateId") return { ...current, templateId: value, error: "" };
        return current;
      }
      return current?.type === "multiInput"
        ? {
            ...current,
            fields: current.fields.map((field) =>
              field.id === fieldId ? { ...field, value } : field,
            ),
            error: "",
          }
        : current;
    });
  };

  const requestOption = ({
    title,
    message,
    detail,
    options,
  }: {
    title: string;
    message: string;
    detail?: string;
    options: { id: string; label: string; description?: string }[];
  }) =>
    new Promise<string | null>((resolve) => {
      setAppDialog({ type: "options", title, message, detail, options, resolve });
    });

  const chooseAppDialogOption = (id: string) => {
    setAppDialog((current) => {
      if (current?.type !== "options") return current;
      current.resolve(id);
      return null;
    });
  };

  const chooseAppDialog = (value: "primary" | "secondary") => {
    setAppDialog((current) => {
      if (current?.type !== "choice") return current;
      current.resolve(value);
      return null;
    });
  };

  const confirmDiscardDirtyWorkspace = async () => {
    const dirtyTabs = openTabs.filter(isDirtyDocumentTab);
    if (dirtyTabs.length === 0) return true;
    return requestConfirm({
      title: "未保存の変更があります",
      message:
        dirtyTabs.length === 1
          ? "現在の変更を破棄してプロジェクトを切り替えますか？"
          : `${dirtyTabs.length}個のタブに未保存の変更があります。破棄してプロジェクトを切り替えますか？`,
      detail: dirtyTabs.map((tab) => tab.name).join(" / "),
      confirmLabel: "破棄して切り替え",
      danger: true,
    });
  };

  const confirmCloseDocumentTabs = async (tabs: DocumentTab[]) => {
    const dirtyTabs = tabs.filter(isDirtyDocumentTab);
    if (dirtyTabs.length === 0) return true;
    return requestConfirm({
      title: "未保存の変更があります",
      message:
        tabs.length === 1
          ? "このタブを閉じると未保存の変更は破棄されます。"
          : `${dirtyTabs.length}個のタブに未保存の変更があります。閉じると変更は破棄されます。`,
      detail: dirtyTabs.map((tab) => tab.name).join(" / "),
      confirmLabel: "破棄して閉じる",
      danger: true,
    });
  };

  const activateRelativeDocumentTab = (direction: -1 | 1) => {
    const visibleTabs = withoutEmptyTabs(openTabs);
    if (visibleTabs.length <= 1) return;
    const currentIndex = visibleTabs.findIndex((tab) => tab.id === activeTabId);
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (startIndex + direction + visibleTabs.length) % visibleTabs.length;
    activateDocumentTab(visibleTabs[nextIndex].id);
  };

  const moveDocumentTab = (tabId: string, beforeTabId: string | null) => {
    if (tabId === beforeTabId) return;
    setOpenTabs((current) => {
      const movingTab = current.find((tab) => tab.id === tabId);
      if (!movingTab) return current;
      const rest = current.filter((tab) => tab.id !== tabId);
      const insertIndex = beforeTabId ? rest.findIndex((tab) => tab.id === beforeTabId) : -1;
      if (insertIndex < 0) return [...rest, movingTab];
      return [...rest.slice(0, insertIndex), movingTab, ...rest.slice(insertIndex)];
    });
  };

  const closeDocumentTabs = async (tabIds: string[]) => {
    if (isClosingDocumentTabsRef.current) return;
    const targetIds = new Set(tabIds);
    const targets = openTabsRef.current.filter((tab) => targetIds.has(tab.id) && tab.kind !== "empty");
    if (targets.length === 0) return;

    isClosingDocumentTabsRef.current = true;
    try {
      if (!(await confirmCloseDocumentTabs(targets))) return;
    } finally {
      isClosingDocumentTabsRef.current = false;
    }

    const currentTabs = withoutEmptyTabs(openTabsRef.current);
    const currentActiveId = activeTabIdRef.current;
    const activeIndex = currentTabs.findIndex((tab) => tab.id === currentActiveId);
    const remainingTabs = currentTabs.filter((tab) => !targetIds.has(tab.id));
    const isClosingActiveTab = targetIds.has(currentActiveId);
    // アクティブなタブを閉じたら、右隣（なければ左隣）の残っているタブへ移る。
    const fallbackTab =
      currentTabs.slice(activeIndex + 1).find((tab) => !targetIds.has(tab.id)) ??
      currentTabs.slice(0, Math.max(activeIndex, 0)).reverse().find((tab) => !targetIds.has(tab.id)) ??
      createEmptyDocumentTab();

    const workspacePath = projectFolder?.path ?? null;
    const activeViewportState = editorInstanceRef.current?.getViewportState() ?? null;
    const closedRecords = currentTabs.flatMap((tab, index): ClosedDocumentTab[] =>
      targetIds.has(tab.id) && tab.kind === "file" && tab.path
        ? [{
            workspacePath,
            path: tab.path,
            index,
            viewportState: tab.id === currentActiveId ? activeViewportState : tab.viewportState,
          }]
        : [],
    );
    if (closedRecords.length) {
      // 右のタブから順に積み、開き直すときは左から元の位置へ戻るようにする。
      const stackedRecords = [...closedRecords].reverse();
      setClosedDocumentTabs((current) =>
        [...current, ...stackedRecords].slice(-CLOSED_DOCUMENT_TAB_LIMIT),
      );
    }

    setOpenTabs(remainingTabs.length ? remainingTabs : [fallbackTab]);
    for (const tab of targets) forgetDocumentJournal(tab.id);
    if (isClosingActiveTab) syncDocumentTabToEditor(fallbackTab);
    showToast(
      targets.length === 1
        ? `「${targets[0].name}」を閉じました`
        : `${targets.length}個のタブを閉じました`,
    );
  };

  const closeDocumentTab = (tabId = activeTabId) => closeDocumentTabs([tabId]);

  const reopenClosedDocumentTab = async () => {
    const workspacePath = projectFolder?.path ?? null;
    const record = [...closedDocumentTabs]
      .reverse()
      .find((item) => isClosedTabInWorkspace(item, workspacePath));
    if (!record) {
      showToast("開き直せるタブはありません");
      return;
    }
    setClosedDocumentTabs((current) => current.filter((item) => item !== record));

    const existingTab = openTabs.find((tab) => tab.path && isSamePath(tab.path, record.path));
    if (existingTab) {
      activateDocumentTab(existingTab.id);
      return;
    }
    try {
      const document = await invoke<TextDocument>("read_text_file", { path: record.path });
      loadDocumentIntoEditor(document, { index: record.index, viewportState: record.viewportState });
      showToast(`「${document.name}」を開き直しました`);
    } catch (error) {
      setLastError(String(error));
      showToast("閉じたタブのファイルを開けませんでした");
    }
  };

  const copyDocumentTabPath = async (tab: DocumentTab) => {
    if (!tab.path) return;
    try {
      await writeClipboardText(tab.path);
      showToast("パスをコピーしました");
    } catch (error) {
      setLastError(String(error));
    }
  };

  const revealDocumentTab = (tab: DocumentTab) => {
    if (!tab.path) return;
    if (!isTauriRuntime()) {
      showToast("フォルダーで表示する機能はTauri版で利用できます");
      return;
    }
    void invoke("open_export_location", { path: tab.path }).catch((error) =>
      setLastError(String(error)),
    );
  };

  const loadDocumentIntoEditor = useCallback((
    document: TextDocument,
    options: {
      replaceActive?: boolean;
      index?: number;
      viewportState?: DocumentTab["viewportState"];
    } = {},
  ) => {
    didMountEditorRef.current = false;
    if (options.replaceActive) {
      replaceActiveTabWithDocument(document);
    } else {
      openDocumentInTab(document, { index: options.index, viewportState: options.viewportState });
    }
    setFocusedFolderPath(null);
    setAppState((current) => ({
      ...current,
      markdown: document.content,
      lastWorkspacePath: projectFolder?.path ?? current.lastWorkspacePath,
      lastFilePath: document.path,
    }));
    setLastError("");
  }, [openDocumentInTab, projectFolder, replaceActiveTabWithDocument]);

  const applyCheckpointStoreResult = (
    rootPath: string,
    result: CheckpointLoadResult,
    allowAllRemoved = false,
  ): boolean => {
    const known = appStateRef.current.snapshots.filter((snapshot) =>
      isSamePath(snapshot.workspacePath, rootPath),
    );
    const conflict = detectPortableCheckpointConflict(known, result.snapshots, allowAllRemoved);
    if (conflict) {
      portableProjectConflictsRef.current.set(portableProjectKey(rootPath), conflict);
      setLastError(conflict);
      showToast(conflict);
      return false;
    }
    setAppState((current) => ({
      ...current,
      snapshots: replaceWorkspaceSnapshots(current.snapshots, rootPath, result.snapshots),
      checkpointMigrationVersions: markCheckpointMigration(
        current.checkpointMigrationVersions,
        rootPath,
      ),
    }));
    return true;
  };

  const buildManuscriptSnapshot = useCallback(
    (
      label: string,
      memo: string,
      reason: ManuscriptSnapshot["reason"],
      parentIds: string[] = [],
      /** Text to take instead of the tab or file at this path (a recovered text). */
      override?: { path: string; markdown: string },
    ): ManuscriptSnapshot => {
      if (!projectFolder) {
        throw new Error("先にフォルダを開いてください");
      }

      const openTabsByPath = new Map(
        openTabs
          .filter((tab): tab is DocumentTab & { path: string } => Boolean(tab.path))
          .map((tab) => [tab.path, { name: tab.name, markdown: tab.markdown }] as const),
      );
      if (override) {
        const file = collectProjectTextFiles(projectFolder).find((item) => isSamePath(item.path, override.path));
        if (!file) throw new Error(`作品フォルダにない原稿です: ${override.path}`);
        openTabsByPath.set(file.path, { name: file.name, markdown: override.markdown });
      }
      const astFilesByPath = new Map(
        projectAst?.rootPath === projectFolder.path
          ? projectAst.files.map((file) => [file.path, file] as const)
          : [],
      );
      const missing: string[] = [];
      const files = collectProjectTextFiles(projectFolder).flatMap((file) => {
        const openTab = openTabsByPath.get(file.path);
        const documentAst = openTab
          ? createDocumentAst({
              path: file.path,
              name: openTab.name || file.name,
              text: parseFrontMatter(openTab.markdown).body,
            })
          : astFilesByPath.get(file.path)?.documentAst ?? null;

        if (!documentAst) {
          missing.push(file.name);
          return [];
        }

        return [
          {
            path: file.path,
            name: file.name,
            text: documentAstToText(documentAst),
            textHash: documentAst.textHash,
            semanticHash: documentAst.semanticHash,
            lineCount: documentAst.lineCount,
            textLength: documentAst.textLength,
            visibleTextLength: documentAst.visibleTextLength,
            outlineCount:
              (override && isSamePath(file.path, override.path)
                ? undefined
                : astFilesByPath.get(file.path)?.outlineCount) ?? documentAst.outline.length,
          } satisfies ManuscriptSnapshotFile,
        ];
      });

      if (missing.length > 0) {
        throw new Error(
          `チェックポイントを作るには原稿の解析完了が必要です: ${missing.slice(0, 3).join(", ")}${
            missing.length > 3 ? "..." : ""
          }`,
        );
      }
      if (files.length === 0) {
        throw new Error("保存できる原稿がありません");
      }

      return {
        id: snapshotId(reason === "manual" ? "snapshot" : "shelter"),
        revision: 1,
        storageHash: "",
        workspacePath: projectFolder.path,
        workspaceName: projectFolder.name,
        createdAt: Date.now(),
        reason,
        label,
        memo,
        parentIds,
        projectTree: projectFolder,
        files,
        fileCount: files.length,
        totalTextLength: files.reduce((sum, file) => sum + file.textLength, 0),
        totalVisibleTextLength: files.reduce(
          (sum, file) => sum + file.visibleTextLength,
          0,
        ),
      };
    },
    [openTabs, projectAst, projectFolder],
  );

  /** `draft` を渡すと入力ダイアログを出さずに作る（チェックポイント画面の作成欄）。作れたら ID を返す。 */
  const handleCreateManuscriptSnapshot = useCallback(async (draft?: { label: string; memo?: string }): Promise<string | null> => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return null;
    }
    if (!canWritePortableProjectState(projectFolder.path)) return null;

    const now = new Date();
    const snapshotDraft = draft ?? await requestMultiInput({
      title: "チェックポイントを作成",
      fields: [
        {
          id: "label",
          label: "タイトル",
          initialValue: `${now.toLocaleDateString("ja-JP")} ${now.toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
          placeholder: "例: 終盤改稿前",
        },
        {
          id: "memo",
          label: "メモ",
          initialValue: "",
          placeholder: "例: 終盤の分岐前。会話のテンポを試す",
          optional: true,
          multiline: true,
        },
      ],
      confirmLabel: "作成",
    });
    if (!snapshotDraft) return null;
    if (!(await waitForPortableProjectWrite(projectFolder.path))) return null;

    try {
      const snapshot = buildManuscriptSnapshot(
        snapshotDraft.label,
        snapshotDraft.memo ?? "",
        "manual",
        currentWorkspaceSnapshots[0] ? [currentWorkspaceSnapshots[0].id] : [],
      );
      if (isTauriRuntime()) {
        beginPortableProjectMutation(projectFolder.path);
        const stored = await invoke<CheckpointLoadResult>("create_project_checkpoint", {
          rootPath: projectFolder.path,
          snapshot,
        });
        if (!applyCheckpointStoreResult(projectFolder.path, stored)) return null;
        if (stored.warnings.length) {
          showToast(checkpointWarningMessage(stored.warnings[0]));
          return null;
        }
      } else {
        setAppState((current) => ({
          ...current,
          snapshots: [snapshot, ...current.snapshots],
        }));
      }
      showToast("チェックポイントを作成しました");
      return snapshot.id;
    } catch (error) {
      if (error instanceof Error) {
        setLastError(error.message);
        showToast(error.message);
      } else if (isTauriRuntime()) reportPortableStorageError(projectFolder.path, error);
      else {
        setLastError(String(error));
        showToast(error instanceof Error ? error.message : "チェックポイントを作成できませんでした");
      }
      return null;
    }
  }, [buildManuscriptSnapshot, currentWorkspaceSnapshots, projectFolder]);

  /**
   * ショートカット・コマンドパレット・上部ツールバー・サイドバーの「＋」に共通の一押し作成。
   * 名前は日時にしておき、あとから画面やメニューで付け直せる。
   */
  const quickSnapshotPendingRef = useRef(false);
  const handleQuickCreateManuscriptSnapshot = useCallback(async () => {
    if (quickSnapshotPendingRef.current) return;
    quickSnapshotPendingRef.current = true;
    try {
      const now = new Date();
      const label = `${now.toLocaleDateString("ja-JP")} ${now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
      const id = await handleCreateManuscriptSnapshot({ label });
      if (id) showToast(`保存点「${label}」を作りました`, { label: "見る", onClick: () => openCheckpointStudio(id) });
    } finally {
      quickSnapshotPendingRef.current = false;
    }
  }, [handleCreateManuscriptSnapshot, openCheckpointStudio]);

  const handleDeleteManuscriptSnapshot = useCallback(
    async (snapshot: ManuscriptSnapshot) => {
      if (snapshot.reason !== "manual") {
        showToast("復元前の退避は自動管理のため削除できません");
        return;
      }
      if (projectFolder && !canWritePortableProjectState(projectFolder.path)) return;
      const shouldDelete = await requestConfirm({
        title: "チェックポイントを削除",
        message: `「${snapshot.label}」を削除しますか？`,
        detail: "削除したチェックポイントには戻れません。",
        confirmLabel: "削除",
        danger: true,
      });
      if (!shouldDelete) return;
      if (projectFolder && !(await waitForPortableProjectWrite(projectFolder.path))) return;

      try {
        if (projectFolder && isTauriRuntime()) {
          beginPortableProjectMutation(projectFolder.path);
          const stored = await invoke<CheckpointLoadResult>("delete_project_checkpoint", {
            rootPath: projectFolder.path,
            checkpointId: snapshot.id,
            expectedRevision: snapshot.revision,
            expectedHash: snapshot.storageHash || null,
          });
          const key = portableProjectKey(projectFolder.path);
          const deletedIds = deletedCheckpointIdsRef.current.get(key) ?? new Set<string>();
          deletedIds.add(snapshot.id);
          deletedCheckpointIdsRef.current.set(key, deletedIds);
          if (!applyCheckpointStoreResult(projectFolder.path, stored, true)) return;
        } else {
          setAppState((current) => ({
            ...current,
            snapshots: current.snapshots.filter((item) => item.id !== snapshot.id),
          }));
        }
        showToast("チェックポイントを削除しました");
      } catch (error) {
        if (projectFolder) reportPortableStorageError(projectFolder.path, error);
        else {
          setLastError(String(error));
          showToast("チェックポイントを削除できませんでした");
        }
      }
    },
    [projectFolder],
  );

  const handleEditManuscriptSnapshotDetails = useCallback(async (snapshot: ManuscriptSnapshot) => {
    if (projectFolder && !canWritePortableProjectState(projectFolder.path)) return;
    const result = await requestMultiInput({
      title: "名前とメモを編集",
      fields: [
        { id: "label", label: "名前", initialValue: snapshot.label, placeholder: "例：第2稿に入る前" },
        {
          id: "memo",
          label: "メモ",
          initialValue: snapshot.memo,
          placeholder: "例: 終盤の分岐前。会話のテンポを試す",
          optional: true,
          multiline: true,
        },
      ],
      confirmLabel: "変更",
    });
    if (!result) return;
    const label = result.label.trim() || snapshot.label;
    const memo = result.memo ?? "";
    if (label === snapshot.label && memo === snapshot.memo) return;
    if (projectFolder && !(await waitForPortableProjectWrite(projectFolder.path))) return;

    try {
      if (projectFolder && isTauriRuntime()) {
        beginPortableProjectMutation(projectFolder.path);
        const stored = await invoke<CheckpointLoadResult>("update_project_checkpoint_metadata", {
          rootPath: projectFolder.path,
          checkpointId: snapshot.id,
          expectedRevision: snapshot.revision,
          expectedHash: snapshot.storageHash || null,
          label,
          memo,
        });
        if (!applyCheckpointStoreResult(projectFolder.path, stored)) return;
      } else {
        setAppState((current) => ({
          ...current,
          snapshots: current.snapshots.map((item) =>
            item.id === snapshot.id ? { ...item, label, memo } : item,
          ),
        }));
      }
      showToast("チェックポイントの名前とメモを変更しました");
    } catch (error) {
      if (projectFolder) reportPortableStorageError(projectFolder.path, error);
      else {
        setLastError(String(error));
        showToast("チェックポイントの名前とメモを変更できませんでした");
      }
    }
  }, [projectFolder]);

  const setWorkspaceFromDocumentPath = useCallback(
    async (document: TextDocument, options: { loadWorkspaceSnippets?: boolean } = {}) => {
      if (!isTauriRuntime()) return null;
      const folderPath =
        projectFolder && findContainingFolderPath(projectFolder, document.path)
          ? projectFolder.path
          : getParentPath(document.path);
      if (!folderPath) return null;

      let folder = await invoke<ProjectFolder>("list_project_text_files", {
        folderPath,
      });
      if (!folder.library) {
        // 作品はライブラリの中で開く。ライブラリの外のファイルは作業フォルダを切り替えずに開く。
        const inspection = await invoke<FolderInspection>("inspect_workspace_folder", {
          folderPath: folder.path,
        });
        const enclosingPath = inspection.projectPath ?? inspection.libraryPath;
        if (!enclosingPath) return null;
        folder = await invoke<ProjectFolder>("list_project_text_files", {
          folderPath: enclosingPath,
        });
      }
      const switched = !projectFolder || !isSamePath(projectFolder.path, folder.path);
      let restoredTabs: LoadedWorkspaceDocumentTabs | null = null;
      let nextTabs: DocumentTab[] | null = null;
      let nextTab: DocumentTab | null = null;
      if (switched) {
        rememberCurrentWorkspaceTabs();
        const workspaceKey = workspaceDocumentTabsKey(folder.path);
        const savedTabs = appStateRef.current.documentTabsByWorkspace[workspaceKey];
        restoredTabs = savedTabs?.tabs.length
          ? await loadWorkspaceDocumentTabs(folder, savedTabs)
          : null;
        nextTabs = restoredTabs?.tabs ?? [];
        const existingIndex = nextTabs.findIndex((tab) =>
          tab.path ? isSamePath(tab.path, document.path) : false,
        );
        const restoredRequestedTab = existingIndex >= 0 ? nextTabs[existingIndex] : null;
        nextTab = {
          ...createFileDocumentTab(document),
          activeOutlineLine: restoredRequestedTab?.activeOutlineLine ?? null,
          viewportState: restoredRequestedTab?.viewportState ?? null,
        };
        if (existingIndex >= 0) nextTabs[existingIndex] = nextTab;
        else nextTabs.push(nextTab);
        setOpenTabs(nextTabs);
        syncDocumentTabToEditor(nextTab);
      }
      setProjectFolder(folder);
      setFocusedFolderPath(null);
      setWorkspaceAlert(null);
      const nextSnippets =
        options.loadWorkspaceSnippets && settings.snippetStorageMode === "workspace"
          ? await loadWorkspaceSnippets(folder.path)
          : null;
      const nextPlotCards = await loadWorkspacePlotCards(folder.path);
      const nextProofreadTerms = await loadWorkspaceProofreadTerms(folder.path);
      const nextProofreadIgnored = await loadWorkspaceProofreadIgnored(folder.path);
      const nextFileProgress = await loadWorkspaceFileProgress(folder.path, appStateRef.current);
      const nextCheckpoints = await loadWorkspaceCheckpoints(folder.path, appStateRef.current);
      fileProgressStoreVersionsRef.current.set(portableProjectKey(folder.path), {
        revision: nextFileProgress.revision,
        contentHash: nextFileProgress.contentHash,
      });
      if (nextSnippets) {
        setSnippetWorkspacePath(folder.path);
      }
      setPlotWorkspacePath(folder.path);
      setPlotCards(nextPlotCards);
      setProofreadTermsWorkspacePath(folder.path);
      setProjectProofreadTerms(nextProofreadTerms);
      setProjectProofreadIgnored(nextProofreadIgnored);
      setAppState((current) => {
        const cursorPositions = { ...current.cursorPositions };
        for (const move of restoredTabs?.moved ?? []) {
          const oldCursorKey = Object.keys(cursorPositions).find((path) =>
            isSamePath(path, move.oldPath),
          );
          if (oldCursorKey) {
            cursorPositions[move.newPath] = cursorPositions[oldCursorKey];
            delete cursorPositions[oldCursorKey];
          }
        }
        return {
          ...current,
          snippets: nextSnippets ?? current.snippets,
          markdown: nextTab?.markdown ?? current.markdown,
          lastWorkspacePath: folder.path,
          lastFilePath: document.path,
          cursorPositions,
          fileProgress: replaceWorkspaceFileProgress(
            current.fileProgress,
            folder.path,
            nextFileProgress.fileProgress,
          ),
          fileProgressMigrationVersions: markFileProgressMigration(
            current.fileProgressMigrationVersions,
            folder.path,
          ),
          snapshots: replaceWorkspaceSnapshots(
            current.snapshots,
            folder.path,
            nextCheckpoints.snapshots,
          ),
          checkpointMigrationVersions: markCheckpointMigration(
            current.checkpointMigrationVersions,
            folder.path,
            nextCheckpoints.migrationComplete,
          ),
          documentTabsByWorkspace:
            nextTabs && nextTab
              ? {
                  ...current.documentTabsByWorkspace,
                  [workspaceDocumentTabsKey(folder.path)]: createWorkspaceDocumentTabs(
                    nextTabs,
                    nextTab.id,
                  ),
                }
              : current.documentTabsByWorkspace,
        };
      });
      if (nextCheckpoints.warnings.length) {
        showToast(checkpointWarningMessage(nextCheckpoints.warnings[0]));
      }
      return { folder, switched };
    },
    [
      appState.documentTabsByWorkspace,
      projectFolder,
      rememberCurrentWorkspaceTabs,
      settings.snippetStorageMode,
      syncDocumentTabToEditor,
    ],
  );

  const refreshProjectFolder = useCallback(async (_folderPath: string) => {
    if (!isTauriRuntime() || !projectFolder) return null;
    const folder = await invoke<ProjectFolder>("list_project_text_files", {
      folderPath: projectFolder.path,
    });
    setProjectFolder(folder);
    return folder;
  }, [projectFolder]);

  /** `confirmed` は呼び出し側が確認と完了通知を受け持つとき（チェックポイント画面）。成功したら true。 */
  const handleRestoreManuscriptSnapshot = useCallback(
    async (snapshot: ManuscriptSnapshot, options: { confirmed?: boolean } = {}): Promise<boolean> => {
      if (!projectFolder || !isSamePath(snapshot.workspacePath, projectFolder.path)) {
        showToast("このチェックポイントのプロジェクトを開いてください");
        return false;
      }
      if (!isTauriRuntime()) {
        showToast("チェックポイントへの復元はTauri版で利用できます");
        return false;
      }
      if (!canWritePortableProjectState(projectFolder.path)) return false;

      const shouldRestore = options.confirmed || await requestConfirm({
        title: "チェックポイントに戻す",
        message: `「${snapshot.label}」に戻しますか？`,
        detail: "現在の状態は「復元前の退避」として自動保存されます。",
        confirmLabel: "戻す",
      });
      if (!shouldRestore) return false;
      if (!(await waitForPortableProjectWrite(projectFolder.path))) return false;

      try {
        const shelter = buildManuscriptSnapshot(
          "復元前の退避",
          "",
          "auto-before-restore",
          currentWorkspaceSnapshots[0] ? [currentWorkspaceSnapshots[0].id] : [],
        );
        beginPortableProjectMutation(projectFolder.path);
        const storedShelter = await invoke<CheckpointLoadResult>("create_project_checkpoint", {
          rootPath: projectFolder.path,
          snapshot: shelter,
        });
        if (!applyCheckpointStoreResult(projectFolder.path, storedShelter)) return false;
        const restoredDocuments: TextDocument[] = [];
        const snapshotPathKeys = new Set(
          snapshot.files.map((file) => normalizePathForCompare(file.path)),
        );
        const currentManuscriptFiles = collectProjectTextFiles(projectFolder);
        const filesToDelete = currentManuscriptFiles.filter(
          (file) => !snapshotPathKeys.has(normalizePathForCompare(file.path)),
        );

        await invoke("ensure_project_folder_tree", {
          rootPath: projectFolder.path,
          tree: snapshot.projectTree,
        });

        for (const file of snapshot.files) {
          let content = file.text;
          try {
            const currentDocument = await invoke<TextDocument>("read_text_file", {
              path: file.path,
            });
            content = updateMarkdownBody(currentDocument.content, file.text);
          } catch {
            content = file.text;
          }

          const document = await invoke<TextDocument>("save_text_file", {
            path: file.path,
            content,
          });
          restoredDocuments.push(document);
        }

        for (const file of filesToDelete) {
          try {
            await invoke("delete_project_entry_to_trash", {
              rootPath: projectFolder.path,
              path: file.path,
            });
          } catch (error) {
            if (!String(error).includes("entry does not exist")) {
              throw error;
            }
          }
        }

        await restoreSnapshotTreeOrder(projectFolder.path, snapshot.projectTree);

        const restoredByPath = new Map(
          restoredDocuments.map((document) => [document.path, document] as const),
        );
        const deletedPathKeys = new Set(
          filesToDelete.map((file) => normalizePathForCompare(file.path)),
        );
        setOpenTabs((current) =>
          current.flatMap((tab) => {
            if (!tab.path) return tab;
            if (deletedPathKeys.has(normalizePathForCompare(tab.path))) return [];
            const document = restoredByPath.get(tab.path);
            if (!document) return tab;
            return [{
              ...tab,
              name: document.name,
              markdown: document.content,
              savedMarkdown: document.content,
              saveStatus: "saved",
              editorRevision: null,
            }];
          }),
        );

        const activeRestored =
          (currentFilePath ? restoredByPath.get(currentFilePath) : null) ??
          restoredDocuments[0] ??
          null;
        if (activeRestored) {
          loadDocumentIntoEditor(activeRestored, { replaceActive: true });
        }

        setAppState((current) => ({
          ...current,
          lastWorkspacePath: projectFolder.path,
          lastFilePath: activeRestored?.path ?? current.lastFilePath,
          markdown: activeRestored?.content ?? current.markdown,
        }));
        projectAstBuildIdRef.current += 1;
        const refreshedFolder = await refreshProjectFolder(projectFolder.path);
        setProjectAst((current) => {
          const base = refreshedFolder ? createProjectAstSkeleton(refreshedFolder, current) : current;
          if (!base) return base;
          return restoredDocuments.reduce(
            (next, document) =>
              upsertProjectAstDocument(next, {
                path: document.path,
                name: document.name,
                text: parseFrontMatter(document.content).body,
              }),
            base,
          );
        });
        if (!options.confirmed) {
          showToast(
            filesToDelete.length > 0
              ? `チェックポイントに戻しました（追加ファイル${filesToDelete.length}件を削除）`
              : "チェックポイントに戻しました",
          );
        }
        return true;
      } catch (error) {
        setLastError(String(error));
        showToast(error instanceof Error ? error.message : "チェックポイントに戻せませんでした");
        return false;
      }
    },
    [
      buildManuscriptSnapshot,
      currentFilePath,
      currentWorkspaceSnapshots,
      loadDocumentIntoEditor,
      projectFolder,
      refreshProjectFolder,
    ],
  );

  const handleRestoreManuscriptSnapshotFiles = useCallback(
    async (
      snapshot: ManuscriptSnapshot,
      selectedPaths: string[],
      selectedFolderPaths: string[],
      conflictPolicy: SnapshotConflictPolicy,
      restoreOrder: boolean,
      relocations: SnapshotRelocation[],
      options: { confirmed?: boolean } = {},
    ): Promise<boolean> => {
      if (!projectFolder || !isSamePath(snapshot.workspacePath, projectFolder.path)) {
        showToast("このチェックポイントのプロジェクトを開いてください");
        return false;
      }
      if (!isTauriRuntime()) {
        showToast("チェックポイントへの復元はTauri版で利用できます");
        return false;
      }
      if (!canWritePortableProjectState(projectFolder.path)) return false;
      const selectedPathKeys = new Set(selectedPaths.map(normalizePathForCompare));
      const files = snapshot.files.filter((file) => selectedPathKeys.has(normalizePathForCompare(file.path)));
      const relocationBySnapshotPath = new Map(relocations.map((item) => [normalizePathForCompare(item.snapshotPath), item.currentPath] as const));
      const selectedRelocationCount = files.filter((file) => relocationBySnapshotPath.has(normalizePathForCompare(file.path))).length;
      const selectedFolderPathKeys = new Set(selectedFolderPaths.map(normalizePathForCompare));
      if (!files.length && !selectedFolderPathKeys.size) {
        showToast("復元するファイルまたはフォルダを選択してください");
        return false;
      }

      const shouldRestore = options.confirmed || await requestConfirm({
        title: "選択したファイルを復元",
        message: `${files.length + selectedFolderPathKeys.size} 件を「${snapshot.label}」の状態へ戻しますか？`,
        detail: `${selectedRelocationCount ? `名前変更・移動を認識した ${selectedRelocationCount} 件は保存点のパスへ戻します。` : ""}${conflictPolicy === "overwrite"
          ? "競合したファイルは保存点の本文で上書きします。現在の状態は復元前の退避として保存されます。"
          : conflictPolicy === "copy"
            ? "競合した現在のファイルを残し、保存点の内容を別パスへ復元します。現在の状態は復元前の退避として保存されます。"
            : "現在の本文と競合したファイルはスキップします。現在の状態は復元前の退避として保存されます。"}`,
        confirmLabel: "復元",
      });
      if (!shouldRestore) return false;
      if (!(await waitForPortableProjectWrite(projectFolder.path))) return false;

      try {
        const shelter = buildManuscriptSnapshot(
          "復元前の退避",
          "",
          "auto-before-restore",
          currentWorkspaceSnapshots[0] ? [currentWorkspaceSnapshots[0].id] : [],
        );
        // 先に退避を履歴へ確定する。以降のファイル操作が途中で失敗しても戻り先を失わない。
        beginPortableProjectMutation(projectFolder.path);
        const storedShelter = await invoke<CheckpointLoadResult>("create_project_checkpoint", {
          rootPath: projectFolder.path,
          snapshot: shelter,
        });
        if (!applyCheckpointStoreResult(projectFolder.path, storedShelter)) return false;
        const selectedTree = selectedFolderPathKeys.size
          ? selectedSnapshotFolderTree(snapshot.projectTree, selectedFolderPathKeys)
          : null;
        if (selectedTree) {
          await invoke("ensure_project_folder_tree", {
            rootPath: projectFolder.path,
            tree: selectedTree,
          });
        }
        const restoredDocuments: TextDocument[] = [];
        const revertedRelocations = new Map<string, string>();
        let skipped = 0;

        for (const file of files) {
          const relocatedCurrentPath = relocationBySnapshotPath.get(normalizePathForCompare(file.path)) ?? null;
          const currentSourcePath = relocatedCurrentPath ?? file.path;
          const openTab = openTabs.find((tab) => tab.path && isSamePath(tab.path, currentSourcePath));
          let currentDocument: TextDocument | null = null;
          let currentContent = openTab?.markdown ?? null;
          try {
            if (currentContent === null) {
              currentDocument = await invoke<TextDocument>("read_text_file", { path: currentSourcePath });
              currentContent = currentDocument.content;
            }
          } catch {
            // A missing file is a normal individual-restore case.
          }
          const currentBody = currentContent !== null ? parseFrontMatter(currentContent).body : null;
          const conflicts = currentBody !== null && currentBody !== file.text;
          if (conflicts && conflictPolicy === "skip") {
            skipped += 1;
            continue;
          }

          let targetPath = file.path;
          if (conflicts && conflictPolicy === "copy" && !relocatedCurrentPath) {
            for (let index = 1; index < 100; index += 1) {
              const candidate = restoredCopyPath(file.path, index);
              try {
                await invoke<TextDocument>("read_text_file", { path: candidate });
              } catch (error) {
                if (/does not exist|not found|cannot find|os error 2/i.test(String(error))) {
                  targetPath = candidate;
                  break;
                }
                throw error;
              }
            }
            if (targetPath === file.path) throw new Error("復元ファイルの保存先を決められませんでした");
          }

          const preserveRelocatedCurrent = Boolean(relocatedCurrentPath && conflicts && conflictPolicy === "copy");
          if (relocatedCurrentPath && !preserveRelocatedCurrent) {
            try {
              await invoke("delete_project_entry_to_trash", {
                rootPath: projectFolder.path,
                path: relocatedCurrentPath,
              });
            } catch (error) {
              if (!String(error).includes("entry does not exist")) throw error;
            }
            revertedRelocations.set(relocatedCurrentPath, file.path);
          }

          const content = currentContent !== null
            ? updateMarkdownBody(currentContent, file.text)
            : file.text;
          restoredDocuments.push(await invoke<TextDocument>("save_text_file", { path: targetPath, content }));
        }

        if (!restoredDocuments.length && !selectedTree) {
          showToast("競合したファイルをスキップしたため、復元するファイルはありませんでした");
          return false;
        }
        if (restoreOrder && selectedTree) {
          await restoreSnapshotTreeOrder(projectFolder.path, snapshot.projectTree, selectedFolderPathKeys);
        }
        const restoredByPath = new Map(restoredDocuments.map((document) => [normalizePathForCompare(document.path), document] as const));
        const relocatedTargets = new Map([...revertedRelocations].map(([currentPath, snapshotPath]) => [normalizePathForCompare(currentPath), normalizePathForCompare(snapshotPath)] as const));
        setOpenTabs((current) => current.flatMap((tab) => {
          if (!tab.path) return [tab];
          const tabPathKey = normalizePathForCompare(tab.path);
          const targetPathKey = relocatedTargets.get(tabPathKey) ?? tabPathKey;
          const document = restoredByPath.get(targetPathKey);
          return document ? [{ ...tab, path: document.path, name: document.name, markdown: document.content, savedMarkdown: document.content, saveStatus: "saved", editorRevision: null }] : [tab];
        }));
        const activePathKey = currentFilePath ? normalizePathForCompare(currentFilePath) : null;
        const activeTargetPathKey = activePathKey ? relocatedTargets.get(activePathKey) ?? activePathKey : null;
        const activeRestored = activeTargetPathKey ? restoredByPath.get(activeTargetPathKey) ?? null : null;
        if (activeRestored) loadDocumentIntoEditor(activeRestored, { replaceActive: true });
        setAppState((current) => ({
          ...current,
          lastWorkspacePath: projectFolder.path,
          lastFilePath: activeRestored?.path ?? current.lastFilePath,
          markdown: activeRestored?.content ?? current.markdown,
        }));
        projectAstBuildIdRef.current += 1;
        const refreshedFolder = await refreshProjectFolder(projectFolder.path);
        setProjectAst((current) => {
          const base = refreshedFolder ? createProjectAstSkeleton(refreshedFolder, current) : current;
          if (!base) return base;
          return restoredDocuments.reduce((next, document) => upsertProjectAstDocument(next, {
            path: document.path,
            name: document.name,
            text: parseFrontMatter(document.content).body,
          }), base);
        });
        const restoredCount = restoredDocuments.length + selectedFolderPathKeys.size;
        if (skipped) showToast(`${restoredCount} 件を復元しました（競合 ${skipped} 件をスキップ）`);
        else if (!options.confirmed) showToast(`${restoredCount} 件を復元しました`);
        return true;
      } catch (error) {
        setLastError(String(error));
        showToast(error instanceof Error ? error.message : "選択したファイルを復元できませんでした");
        return false;
      }
    },
    [buildManuscriptSnapshot, currentFilePath, currentWorkspaceSnapshots, loadDocumentIntoEditor, openTabs, projectFolder, refreshProjectFolder],
  );

  /**
   * 並び順だけを保存点に戻す（チェックポイント画面で確認済み）。本文には触れず、
   * フォルダも作り直さない。今もあるフォルダの中の順序だけを合わせる。
   */
  const handleRestoreManuscriptSnapshotOrder = useCallback(
    async (snapshot: ManuscriptSnapshot): Promise<boolean> => {
      if (!projectFolder || !isSamePath(snapshot.workspacePath, projectFolder.path)) {
        showToast("このチェックポイントのプロジェクトを開いてください");
        return false;
      }
      if (!isTauriRuntime()) {
        showToast("チェックポイントへの復元はTauri版で利用できます");
        return false;
      }
      if (!canWritePortableProjectState(projectFolder.path)) return false;
      if (!(await waitForPortableProjectWrite(projectFolder.path))) return false;

      try {
        const shelter = buildManuscriptSnapshot(
          "復元前の退避",
          "",
          "auto-before-restore",
          currentWorkspaceSnapshots[0] ? [currentWorkspaceSnapshots[0].id] : [],
        );
        beginPortableProjectMutation(projectFolder.path);
        const storedShelter = await invoke<CheckpointLoadResult>("create_project_checkpoint", {
          rootPath: projectFolder.path,
          snapshot: shelter,
        });
        if (!applyCheckpointStoreResult(projectFolder.path, storedShelter)) return false;
        const existingFolderPaths = new Set([normalizePathForCompare(projectFolder.path)]);
        const visit = (entries: ProjectEntry[]) => {
          for (const entry of entries) {
            if (entry.kind !== "folder") continue;
            existingFolderPaths.add(normalizePathForCompare(entry.path));
            visit(entry.children);
          }
        };
        visit(projectFolder.children);
        await restoreSnapshotTreeOrder(projectFolder.path, snapshot.projectTree, existingFolderPaths);
        await refreshProjectFolder(projectFolder.path);
        return true;
      } catch (error) {
        setLastError(String(error));
        showToast(error instanceof Error ? error.message : "並び順を戻せませんでした");
        return false;
      }
    },
    [buildManuscriptSnapshot, currentWorkspaceSnapshots, projectFolder, refreshProjectFolder],
  );

  const handleProjectFolderSelect = useCallback(
    async (path: string) => {
      if (!projectFolder || !isTauriRuntime()) return;

      try {
        const folder = await refreshProjectFolder(path);
        setFocusedFolderPath(path);
        const selectedFolder =
          folder?.path === path
            ? folder
            : folder
              ? findProjectEntry(folder.children, path)
              : null;
        showToast(`「${selectedFolder?.name ?? getWorkspaceName(path)}」を開きました`);
      } catch (error) {
        setLastError(String(error));
        setSaveStatus("error");
      }
    },
    [projectFolder, refreshProjectFolder],
  );

  const handleBreadcrumbFolderSelect = useCallback(
    async (path: string) => {
      if (!projectFolder || !isTauriRuntime()) return;

      try {
        const folder = await refreshProjectFolder(path);
        const selectedFolder =
          folder?.path === path
            ? folder
            : folder
              ? findProjectEntry(folder.children, path)
              : null;
        setFocusedFolderPath(path);
        setBreadcrumbBrowsePath(path);
        showToast(`「${selectedFolder?.name ?? getWorkspaceName(path)}」へ移動しました`);
      } catch (error) {
        setLastError(String(error));
        setSaveStatus("error");
      }
    },
    [projectFolder, refreshProjectFolder],
  );

  const toggleWorkspaceFolderCollapse = useCallback((path: string) => {
    setCollapsedWorkspaceFolderPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleWorkspaceFolderTreeSelect = useCallback((path: string) => {
    setFocusedFolderPath(path);
    setCollapsedWorkspaceFolderPaths((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const handleNewTab = () => {
    addScratchTab(`new-tab-${Date.now()}`, newTabName);
    setFocusedFolderPath(null);
    setLastError("");
  };

  const handleNewDocument = async () => {
    if (projectFolder) {
      void handleCreateProjectFile(focusedFolderPath ?? projectFolder.path);
      return;
    }
    addScratchTab();
    setLastError("");
  };

  const handleOpenTextFile = async () => {
    if (!isTauriRuntime()) {
      showToast("ファイルを開く機能はTauri版で利用できます");
      return;
    }

    try {
      const document = await invoke<TextDocument | null>("open_text_file_dialog");
      if (!document) {
        return;
      }
      const workspace = await setWorkspaceFromDocumentPath(document, {
        loadWorkspaceSnippets: true,
      });
      if (!workspace?.switched) loadDocumentIntoEditor(document);
      showToast(`「${document.name}」を開きました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const saveCurrentDocument = async () => {
    if (!isTauriRuntime()) {
      await saveStoredState(appState);
      markActiveTabSaved(markdown);
      return;
    }

    const previousSaveStatus = saveStatus;
    setSaveStatus("saving");
    try {
      const document = currentFilePath
        ? await enqueueDocumentSave({
            tabId: activeTabId,
            path: currentFilePath,
            content: markdown,
          })
        : await invoke<TextDocument | null>("save_text_file_dialog", {
            content: markdown,
          });

      if (!document) {
        setSaveStatus(previousSaveStatus);
        return;
      }

      const wasScratch = !currentFilePath;
      const workspace = wasScratch
        ? await setWorkspaceFromDocumentPath(document, { loadWorkspaceSnippets: true })
        : null;
      if (!workspace?.switched) loadDocumentIntoEditor(document, { replaceActive: true });
      const refreshPath = currentFilePath
        ? findContainingFolderPath(projectFolder, currentFilePath)
        : projectFolder?.path;
      if (refreshPath) await refreshProjectFolder(refreshPath);
      showToast(`「${document.name}」を保存しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleSaveAs = async () => {
    if (!isTauriRuntime()) {
      showToast("名前を付けて保存はTauri版で利用できます");
      return;
    }
    if (activeTab?.kind === "empty") {
      showToast("保存する文書が開かれていません");
      return;
    }

    const previousSaveStatus = saveStatus;
    setSaveStatus("saving");
    try {
      const document = await invoke<TextDocument | null>("save_text_file_dialog", {
        content: markdown,
      });
      if (!document) {
        setSaveStatus(previousSaveStatus);
        return;
      }
      const workspace = await setWorkspaceFromDocumentPath(document, {
        loadWorkspaceSnippets: true,
      });
      if (!workspace?.switched) loadDocumentIntoEditor(document, { replaceActive: true });
      if (!workspace && projectFolder) {
        await refreshProjectFolder(projectFolder.path);
      }
      showToast(`「${document.name}」を保存しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleOpenLinkedExport = async () => {
    if (settings.exportOpensInWindow && !isTauriRuntime()) {
      showToast("エクスポート画面の別ウィンドウ表示はTauri版で利用できます");
      return;
    }

    setLastError("");
    try {
      const projectFiles = projectFolder ? collectProjectTextFiles(projectFolder) : [];
      const candidates = projectFiles.length > 0
        ? projectFiles
        : [{ path: currentFilePath ?? "", name: currentFileName }];
      const sources: LoadedExportSource[] = [];
      const readErrors: string[] = [];
      // Flags files whose properties are broken YAML; without the parser the list
      // still opens, just without that warning.
      const countFrontMatterErrors = await import("./utils/frontmatterYaml").then(
        ({ analyzeFrontMatter }) => (metadata: string) => analyzeFrontMatter(metadata).errors.length,
        () => undefined,
      );

      for (const [index, file] of candidates.entries()) {
        try {
          const openTab = openTabs.find((tab) => tab.path === file.path);
          const rawContent = file.path
            ? openTab?.markdown ?? (await invoke<TextDocument>("read_text_file", { path: file.path })).content
            : markdown;
          sources.push(createLoadedExportSource(file, rawContent, index, countFrontMatterErrors));
        } catch (error) {
          readErrors.push(`${file.name}: ${String(error)}`);
        }
      }

      if (sources.length === 0) throw new Error(readErrors.join("\n") || "出力できる本文ファイルがありません");
      const workspaceTitle = projectFolder?.name
        ?? currentFileName.replace(/\.(?:txt|md)$/i, "")
        ?? "本文連結";
      const payload = {
        requestId: String(Date.now()),
        title: workspaceTitle,
        // 表紙の文字列・画像を作品の .then/project.json から読み書きするため。
        projectPath: projectFolder?.path ?? null,
        sources,
        sourceError: readErrors.length > 0 ? readErrors.join("\n") : undefined,
      };
      if (!settings.exportOpensInWindow) {
        // メイン画面のエクスポートモードとして開く。
        setExportEmbedPayload(payload);
        setAppMode("export");
        return;
      }
      await invoke("open_export_window", { payload });
    } catch (error) {
      setLastError(String(error));
    }
  };

  /** 画面上部のモード切替。canvas/export は設定により別ウィンドウ起動になる。 */
  const switchAppMode = (mode: "write" | "canvas" | "export" | "checkpoint") => {
    if (mode === "write") {
      setAppMode("write");
      return;
    }
    if (mode === "checkpoint") {
      openCheckpointStudio();
      return;
    }
    if (mode === "canvas") {
      if (!settings.canvasOpensInWindow && canvasEmbedPayload) {
        // 前回のボード表示を保ったまま戻る。
        setAppMode("canvas");
        return;
      }
      void openIdeaCanvasBoard("project");
      return;
    }
    void handleOpenLinkedExport();
  };

  const modeMenuEntries: {
    key: string;
    label: string;
    title: string;
    icon: ReactNode;
    isActive: boolean;
    opensInWindow: boolean;
    select: () => void;
  }[] = [
    {
      key: "write",
      label: "本文",
      title: "本文モード",
      icon: <AppIcon name="write" className="modeSwitcherIcon" />,
      isActive: appMode === "write",
      opensInWindow: false,
      select: () => switchAppMode("write"),
    },
    {
      key: "canvas",
      label: "キャンバス",
      title: settings.canvasOpensInWindow ? "キャンバスを別ウィンドウで開く" : "キャンバスモード",
      icon: <AppIcon name="canvas" className="modeSwitcherIcon" />,
      isActive: appMode === "canvas",
      opensInWindow: settings.canvasOpensInWindow,
      select: () => switchAppMode("canvas"),
    },
    {
      key: "export",
      label: "エクスポート",
      title: settings.exportOpensInWindow ? "エクスポートを別ウィンドウで開く" : "エクスポートモード",
      icon: <AppIcon name="export" className="modeSwitcherIcon" />,
      isActive: appMode === "export",
      opensInWindow: settings.exportOpensInWindow,
      select: () => switchAppMode("export"),
    },
    {
      key: "checkpoint",
      label: "チェックポイント",
      title: "チェックポイント",
      icon: <AppIcon name="history" className="modeSwitcherIcon" />,
      isActive: appMode === "checkpoint",
      opensInWindow: false,
      select: () => switchAppMode("checkpoint"),
    },
    ...pluginScreens.flatMap((screen) => {
      const plugin = loadedPlugins.find((item) => item.manifest.id === screen.pluginId);
      const icon = screen.icon ?? plugin?.manifest.icon;
      if (!plugin || !icon) return [];
      const screenKey = `${screen.pluginId}:${screen.id}`;
      return [
        {
          key: screenKey,
          label: screen.title,
          title: `${screen.title}（${plugin.manifest.name}）`,
          icon: <PluginIcon icon={icon} className="modeSwitcherIcon pluginModeSwitcherIcon" />,
          isActive: appMode === "plugin" && activePluginScreenKey === screenKey,
          opensInWindow: false,
          select: () => {
            setActivePluginScreenKey(screenKey);
            setAppMode("plugin");
          },
        },
      ];
    }),
  ];
  const activeModeMenuEntry = modeMenuEntries.find((entry) => entry.isActive);

  const handleModeMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "Escape") {
      // 他の Escape 処理（フォーカスモード解除など）まで届かせない。
      event.preventDefault();
      event.stopPropagation();
      setIsModeMenuOpen(false);
      modeMenuButtonRef.current?.focus();
      return;
    } else if (event.key === "Tab") {
      setIsModeMenuOpen(false);
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex].focus();
  };

  const toggleEditorFocusMode = () => {
    setIsEditorFocusMode((current) => !current);
    setIsFileMenuOpen(false);
    setActiveBreadcrumbPath(null);
    setBreadcrumbBrowsePath(null);
    setIsWorkspaceSwitcherOpen(false);
    setEditorContextMenu(null);
    window.requestAnimationFrame(() => editorInstanceRef.current?.focus());
  };

  /** Shows the AI pane with `text` added to its composer. Nothing is sent (AI-26, AI-27). */
  const handTextToAi = (text: string) => {
    if (!text.trim()) return;
    setIsEditorFocusMode(false);
    setRightSidebarTab("ai");
    setIsRightSidebarCollapsed(false);
    setAiInsertRequest({ text, nonce: Date.now() });
  };

  const leaveEditorFocusMode = () => {
    setIsEditorFocusMode(false);
    window.requestAnimationFrame(() => editorInstanceRef.current?.focus());
  };

  const openWorkspaceFolder = async (
    folder: ProjectFolder,
    options: { focusFolderPath?: string | null } = {},
  ): Promise<{ movedCount: number; missingNames: string[] }> => {
    const switchGeneration = workspaceSwitchGenerationRef.current + 1;
    workspaceSwitchGenerationRef.current = switchGeneration;
    workspaceSwitchInProgressRef.current = true;
    rememberCurrentWorkspaceTabs();

    const focusedPath = options.focusFolderPath ?? folder.path;

    try {
      const restoredSnippets =
        settings.snippetStorageMode === "workspace"
          ? await loadWorkspaceSnippets(folder.path)
          : snippets;
      const restoredPlotCards = await loadWorkspacePlotCards(folder.path);
      const restoredProofreadTerms = await loadWorkspaceProofreadTerms(folder.path);
      const restoredProofreadIgnored = await loadWorkspaceProofreadIgnored(folder.path);
      const restoredFileProgress = await loadWorkspaceFileProgress(
        folder.path,
        appStateRef.current,
      );
      const restoredCheckpoints = await loadWorkspaceCheckpoints(
        folder.path,
        appStateRef.current,
      );
      fileProgressStoreVersionsRef.current.set(portableProjectKey(folder.path), {
        revision: restoredFileProgress.revision,
        contentHash: restoredFileProgress.contentHash,
      });
      const workspaceKey = workspaceDocumentTabsKey(folder.path);
      const savedTabs = appStateRef.current.documentTabsByWorkspace[workspaceKey];
      const restoredTabs = savedTabs?.tabs.length
        ? await loadWorkspaceDocumentTabs(folder, savedTabs)
        : null;

      setProjectFolder(folder);
      setWorkspaceAlert(null);
      setFocusedFolderPath(focusedPath);
      setWorkspaceSwitcherQuery("");
      setSnippetWorkspacePath(settings.snippetStorageMode === "workspace" ? folder.path : null);
      setPlotWorkspacePath(folder.path);
      setPlotCards(restoredPlotCards);
      setProofreadTermsWorkspacePath(folder.path);
      setProjectProofreadTerms(restoredProofreadTerms);
      setProjectProofreadIgnored(restoredProofreadIgnored);

      // 保存タブがなければ空の状態にする（最初のファイルは自動で開かない）。
      const nextTabs = restoredTabs?.tabs.length
        ? restoredTabs.tabs
        : [createEmptyDocumentTab()];
      const nextTab = nextTabs[restoredTabs?.activeIndex ?? 0] ?? nextTabs[0];
      setOpenTabs(nextTabs);
      syncDocumentTabToEditor(nextTab);
      setFocusedFolderPath(focusedPath);
      setAppState((current) => {
        const cursorPositions = { ...current.cursorPositions };
        for (const move of restoredTabs?.moved ?? []) {
          const oldCursorKey = Object.keys(cursorPositions).find((path) =>
            isSamePath(path, move.oldPath),
          );
          if (oldCursorKey) {
            cursorPositions[move.newPath] = cursorPositions[oldCursorKey];
            delete cursorPositions[oldCursorKey];
          }
        }
        return {
          ...current,
          snippets: restoredSnippets,
          markdown: nextTab.markdown,
          lastWorkspacePath: folder.path,
          lastFilePath: nextTab.path,
          cursorPositions,
          fileProgress: replaceWorkspaceFileProgress(
            current.fileProgress,
            folder.path,
            restoredFileProgress.fileProgress,
          ),
          fileProgressMigrationVersions: markFileProgressMigration(
            current.fileProgressMigrationVersions,
            folder.path,
          ),
          snapshots: replaceWorkspaceSnapshots(
            current.snapshots,
            folder.path,
            restoredCheckpoints.snapshots,
          ),
          checkpointMigrationVersions: markCheckpointMigration(
            current.checkpointMigrationVersions,
            folder.path,
            restoredCheckpoints.migrationComplete,
          ),
          documentTabsByWorkspace: {
            ...current.documentTabsByWorkspace,
            [workspaceKey]: createWorkspaceDocumentTabs(nextTabs, nextTab.id),
          },
          recentWorkspaces: recordOpenedWorkspace(current.recentWorkspaces, folder),
        };
      });
      if (restoredCheckpoints.warnings.length) {
        showToast(checkpointWarningMessage(restoredCheckpoints.warnings[0]));
      }
      return {
        movedCount: restoredTabs?.moved.length ?? 0,
        missingNames: restoredTabs?.missingNames ?? [],
      };
    } finally {
      if (workspaceSwitchGenerationRef.current === switchGeneration) {
        workspaceSwitchInProgressRef.current = false;
      }
    }
  };

  /** 作品はライブラリの中で開く。ライブラリの外のフォルダは取り込みかライブラリ化へ誘導する。 */
  const resolveWorkspaceFolder = async (
    folder: ProjectFolder,
  ): Promise<{ folder: ProjectFolder; focusFolderPath: string | null } | null> => {
    if (folder.library) return { folder, focusFolderPath: null };

    const inspection = await invoke<FolderInspection>("inspect_workspace_folder", {
      folderPath: folder.path,
    });
    const enclosingPath = inspection.projectPath ?? inspection.libraryPath;
    if (enclosingPath) {
      const enclosing = await invoke<ProjectFolder>("list_project_text_files", {
        folderPath: enclosingPath,
      });
      return { folder: enclosing, focusFolderPath: folder.path };
    }

    // ライブラリをまだ持っていなければ、まずライブラリを作ってもらう。
    const knownLibrary = knownLibraries[0];
    if (!knownLibrary) {
      openLibrarySetup([{ path: folder.path, name: folder.name }]);
      return null;
    }

    const choice = await requestOption({
      title: "ライブラリへの取り込みが必要です",
      message: `「${folder.name}」はライブラリに入っていません。作品はライブラリの中で開きます。`,
      detail: "取り込みでは元のフォルダには書き込まず、ライブラリ内へコピーしてから検証します。",
      options: [
        {
          id: "import-known",
          label: `「${knownLibrary.name}」に取り込む`,
          description: knownLibrary.path,
        },
        {
          id: "import-other",
          label: "別のライブラリに取り込む…",
          description: "ライブラリのフォルダを選びます。",
        },
        {
          id: "setup",
          label: "新しいライブラリを作って取り込む…",
          description: "ライブラリの準備画面を開きます。",
        },
      ],
    });
    if (!choice) return null;
    if (choice === "setup") {
      openLibrarySetup([{ path: folder.path, name: folder.name }]);
      return null;
    }

    let libraryPath = knownLibrary.path;
    if (choice === "import-other") {
      const picked = await invoke<string | null>("pick_folder_dialog", {
        title: "取り込み先のライブラリのフォルダを選ぶ",
      });
      if (!picked) return null;
      const target = await invoke<FolderInspection>("inspect_workspace_folder", {
        folderPath: picked,
      });
      if (target.kind !== "library") {
        showToast("選んだフォルダはライブラリではありません");
        return null;
      }
      libraryPath = picked;
    }

    const imported = await importProjectIntoLibrary(folder.path, libraryPath);
    if (!imported) return null;
    const project = await invoke<ProjectFolder>("list_project_text_files", {
      folderPath: imported.projectPath,
    });
    return { folder: project, focusFolderPath: null };
  };

  const importProjectIntoLibrary = async (
    sourcePath: string,
    libraryPath: string,
  ): Promise<ProjectImportReport | null> => {
    showToast("作品を取り込んでいます…");
    let report: ProjectImportReport;
    try {
      report = await invoke<ProjectImportReport>("import_project_into_library", {
        sourcePath,
        libraryPath,
      });
    } catch (error) {
      setLastError(String(error));
      await requestConfirm({
        title: "取り込めませんでした",
        message: String(error),
        detail: "元のフォルダは変更していません。作成途中のコピーは片付けました。",
        confirmLabel: "閉じる",
      });
      return null;
    }

    const library = await invoke<ProjectFolder>("list_project_text_files", {
      folderPath: libraryPath,
    }).catch(() => null);
    const libraryName = library ? scopeDisplayName(library) : getWorkspaceName(libraryPath);
    setAppState((current) =>
      recordImportedProject(current, sourcePath, report.projectPath, report.name, libraryName),
    );
    const choice = await requestChoice({
      title: "取り込みました",
      message: `「${report.name}」をライブラリに取り込みました（${report.fileCount}ファイル・チェックポイント${report.checkpointCount}件）。`,
      detail: [
        `元のフォルダはそのまま残っています: ${sourcePath}`,
        ...report.warnings,
      ].join("\n"),
      primaryLabel: "作品を開く",
      secondaryLabel: "元のフォルダを表示",
    });
    if (choice === "secondary") {
      void invoke("open_export_location", { path: sourcePath }).catch((error) =>
        setLastError(String(error)),
      );
    }
    return report;
  };

  /** 途中で終了した取り込みのコピーが残っていれば、削除するか確認する。 */
  const offerToDiscardStaleImports = async (libraryPath: string) => {
    try {
      const stale = await invoke<string[]>("list_stale_library_imports", { libraryPath });
      if (!stale.length) return;
      const discard = await requestConfirm({
        title: "途中で終わった取り込みがあります",
        message: `完了しなかった取り込みのコピーが${stale.length}件残っています。削除しますか？`,
        detail: "取り込み元のフォルダには影響しません。",
        confirmLabel: "削除",
        danger: true,
      });
      if (discard) await invoke("discard_stale_library_imports", { libraryPath });
    } catch (error) {
      setLastError(String(error));
    }
  };

  async function openWorkspace(path?: string): Promise<boolean> {
    if (!isTauriRuntime()) {
      showToast("フォルダを開く機能はTauri版で利用できます");
      return false;
    }
    if (!(await confirmDiscardDirtyWorkspace())) return false;

    const previousSaveStatus = saveStatus;
    setSaveStatus("loading");
    try {
      debugLog(path ? "before invoke list_project_text_files" : "before invoke open_project_folder_dialog");
      const folder = path
        ? await invoke<ProjectFolder>("list_project_text_files", { folderPath: path })
        : await invoke<ProjectFolder | null>("open_project_folder_dialog");
      debugLog("after invoke open_project_folder_dialog", {
        selected: Boolean(folder),
        path: folder?.path ?? null,
        children: folder?.children.length ?? 0,
      });
      if (!folder) {
        setSaveStatus(previousSaveStatus);
        return false;
      }

      const resolved = await resolveWorkspaceFolder(folder);
      if (!resolved) {
        setSaveStatus(previousSaveStatus);
        return false;
      }
      const { folder: folderToOpen, focusFolderPath } = resolved;

      debugLog("before setProjectFolder", {
        path: folderToOpen.path,
        children: folderToOpen.children.length,
      });
      const tabRestore = await openWorkspaceFolder(folderToOpen, { focusFolderPath });
      setIsWorkspaceSwitcherOpen(false);
      const baseMessage = focusFolderPath
        ? `「${scopeDisplayName(folderToOpen)}」内の「${folder.name}」へ移動しました`
        : `「${scopeDisplayName(folderToOpen)}」を開きました`;
      const restoreSummary = [
        projectFolder && !isSamePath(projectFolder.path, folderToOpen.path)
          ? `「${projectFolder.name}」のタブを記憶`
          : "",
        tabRestore.movedCount ? `移動したタブ ${tabRestore.movedCount}件を追跡` : "",
        tabRestore.missingNames.length
          ? `見つからないタブ ${tabRestore.missingNames.length}件を除外`
          : "",
      ].filter(Boolean).join(" / ");
      showToast(restoreSummary ? `${baseMessage}（${restoreSummary}）` : baseMessage);
      if (folderToOpen.library) void offerToDiscardStaleImports(folderToOpen.library.path);
      return true;
    } catch (error) {
      const message = portableStorageErrorMessage(error);
      setLastError(`${message} ${String(error)}`);
      showToast(`フォルダを開けませんでした。${message}`);
      setSaveStatus(previousSaveStatus);
      return false;
    }
  }

  const libraryContext = projectFolder?.library ?? null;

  // サイドバーの「← ライブラリ」とパンくずのライブラリ名は、どちらもこの関数を呼ぶ。
  const enterLibraryRoot = () => {
    if (!libraryContext || libraryContext.role === "root") return;
    void openWorkspace(libraryContext.path);
  };

  // サイドバーの作品の行とパンくずの作品名は、どちらもこの関数を呼ぶ。
  const enterProject = (path: string) => {
    if (projectFolder && isSamePath(projectFolder.path, path)) return;
    void openWorkspace(path);
  };

  const handleCreateLibraryProject = async () => {
    if (!libraryContext) return;
    const name = await requestInput({
      title: "新しい作品",
      label: "作品名",
      initialValue: "",
      confirmLabel: "作成",
      placeholder: "作品のフォルダ名",
    });
    if (!name) return;
    try {
      const path = await invoke<string>("create_library_project", {
        libraryPath: libraryContext.path,
        name,
      });
      enterProject(path);
    } catch (error) {
      setLastError(String(error));
      showToast(`作品を作成できませんでした: ${String(error)}`);
    }
  };

  // ---- ライブラリホーム（作品の一覧・字数と進捗の集計） ----
  const [libraryHome, setLibraryHome] = useState<{
    libraryPath: string;
    items: LibraryHomeItem[];
    isLoading: boolean;
  } | null>(null);
  const libraryHomeRunRef = useRef(0);

  const refreshLibraryHome = async (libraryPath: string, force = false) => {
    const runId = ++libraryHomeRunRef.current;
    const isCurrent = () => libraryHomeRunRef.current === runId;
    let overview: LibraryProjectOverview[];
    try {
      overview = await invoke<LibraryProjectOverview[]>("library_overview", { libraryPath });
    } catch (error) {
      setLastError(String(error));
      return;
    }
    if (!isCurrent()) return;
    const cache = appStateRef.current.libraryWorkStats;
    let items: LibraryHomeItem[] = overview.map((project) => ({
      path: project.path,
      name: project.name,
      work: project.work,
      stats: cache[workspaceDocumentTabsKey(project.path)] ?? null,
    }));
    setLibraryHome({ libraryPath, items, isLoading: true });

    const countOptions = { includeWhitespace: settings.countWhitespace, includeCode: settings.countCode };
    for (const project of overview) {
      try {
        const folder = await invoke<ProjectFolder>("list_project_text_files", { folderPath: project.path });
        const key = workspaceDocumentTabsKey(project.path);
        const cached = appStateRef.current.libraryWorkStats[key];
        const stats = !force && cached?.signature === folderSignature(folder)
          ? cached
          : computeWorkStats(await indexFolder(folder), project.fileProgress, countOptions);
        if (!isCurrent()) return;
        items = items.map((item) => (item.path === project.path ? { ...item, stats } : item));
        setLibraryHome({ libraryPath, items, isLoading: true });
        if (stats !== cached) {
          setAppState((current) => ({
            ...current,
            libraryWorkStats: { ...current.libraryWorkStats, [key]: stats },
          }));
        }
      } catch (error) {
        setLastError(String(error));
      }
    }
    if (isCurrent()) setLibraryHome({ libraryPath, items, isLoading: false });
  };

  // ライブラリ直下で文書を開いていない状態に入るたびに、一覧を読み直す（集計はキャッシュを使う）。
  const libraryHomeTrigger =
    libraryContext?.role === "root" && activeTab?.kind === "empty" ? `${libraryContext.path}|${activeTab.id}` : null;
  useEffect(() => {
    if (!libraryHomeTrigger || !libraryContext || !isTauriRuntime()) return;
    void refreshLibraryHome(libraryContext.path);
    // refreshLibraryHome reads state through refs; the trigger key covers when to run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryHomeTrigger]);

  const editWorkInfo = async (projectPath: string, name: string, current: WorkMeta | null) => {
    const values = await requestMultiInput({
      title: `「${name}」の作品情報`,
      fields: [
        {
          id: "status",
          label: "状態",
          initialValue: current?.status ?? "planning",
          options: (Object.keys(workStatusLabels) as WorkStatus[]).map((status) => ({
            value: status,
            label: workStatusLabels[status],
          })),
        },
        {
          id: "summary",
          label: "あらすじ",
          initialValue: current?.summary ?? "",
          multiline: true,
          optional: true,
        },
      ],
      confirmLabel: "保存",
    });
    if (!values) return;
    try {
      const saved = await invoke<WorkMeta>("save_project_work", {
        projectPath,
        status: values.status,
        summary: values.summary,
      });
      setLibraryHome((home) =>
        home && {
          ...home,
          items: home.items.map((item) => (item.path === projectPath ? { ...item, work: saved } : item)),
        },
      );
      showToast("作品情報を保存しました");
    } catch (error) {
      setLastError(String(error));
      showToast(`作品情報を保存できませんでした: ${String(error)}`);
    }
  };

  const editCurrentWorkInfo = async () => {
    if (!projectFolder || libraryContext?.role !== "project") return;
    try {
      const overview = await invoke<LibraryProjectOverview[]>("library_overview", {
        libraryPath: libraryContext.path,
      });
      const current = overview.find((item) => isSamePath(item.path, projectFolder.path));
      await editWorkInfo(projectFolder.path, projectFolder.name, current?.work ?? null);
    } catch (error) {
      setLastError(String(error));
    }
  };

  const reorderLibraryProjects = async (orderedPaths: string[]) => {
    if (!libraryContext || libraryContext.role !== "root") return;
    const byPath = new Map(libraryContext.projects.map((project) => [project.path, project]));
    const reordered = orderedPaths.flatMap((path) => byPath.get(path) ?? []);
    const applyProjects = (projects: LibraryProjectSummary[]) =>
      setProjectFolder((current) =>
        current?.library ? { ...current, library: { ...current.library, projects } } : current,
      );
    // 先に画面へ反映し、保存に失敗したら保存済みの順へ戻す。
    applyProjects(reordered);
    try {
      const saved = await invoke<LibraryProjectSummary[]>("reorder_library_projects", {
        libraryPath: libraryContext.path,
        orderedNames: reordered.map((project) => project.name),
      });
      applyProjects(saved);
    } catch (error) {
      applyProjects(libraryContext.projects);
      setLastError(String(error));
      showToast("作品の並び順を保存できませんでした");
    }
  };

  const handleImportProjectIntoLibrary = async () => {
    if (!libraryContext) return;
    const sourcePath = await invoke<string | null>("pick_folder_dialog");
    if (!sourcePath) return;
    const report = await importProjectIntoLibrary(sourcePath, libraryContext.path);
    if (report) enterProject(report.projectPath);
  };

  // ---- ライブラリと作品の間での項目の移動・コピー ----
  // ライブラリ直下からは作品へ、作品からはライブラリ直下へ送る。

  /** 移動・コピーのメニュー項目名。ライブラリの外では出さない。 */
  const transferMenuLabel = !libraryContext
    ? null
    : libraryContext.role === "root"
      ? "作品へ移動・コピー…"
      : "ライブラリへ移動・コピー…";

  const transferDestinations = (): { path: string; label: string }[] => {
    if (!libraryContext || !projectFolder) return [];
    return libraryContext.role === "root"
      ? libraryContext.projects.map((project) => ({ path: project.path, label: `作品「${project.name}」` }))
      : [{ path: libraryContext.path, label: `ライブラリ「${libraryContext.name}」の直下` }];
  };

  /** 送り先・移動かコピーか・資料の扱いを尋ねる。 */
  const requestTransferOptions = async ({
    itemLabel,
    referenceCount,
    canMove = true,
  }: {
    itemLabel: string;
    referenceCount: number;
    canMove?: boolean;
  }): Promise<{ target: string; targetLabel: string; move: boolean; copyReferences: boolean } | null> => {
    const destinations = transferDestinations();
    if (!destinations.length) {
      showToast(
        libraryContext?.role === "root"
          ? "送り先の作品がありません"
          : "ライブラリ内の作品を開いているときに使えます",
      );
      return null;
    }
    const values = await requestMultiInput({
      title: `${itemLabel}を移動・コピー`,
      fields: [
        {
          id: "target",
          label: "送り先",
          initialValue: destinations[0].path,
          options: destinations.map((item) => ({ value: item.path, label: item.label })),
        },
        {
          id: "mode",
          label: "方法",
          initialValue: "copy",
          options: [
            { value: "copy", label: "コピー（元に残す）" },
            ...(canMove ? [{ value: "move", label: "移動（元から取り除く）" }] : []),
          ],
        },
        ...(referenceCount > 0
          ? [{
              id: "references",
              label: `参照している資料（${referenceCount}件）`,
              initialValue: "copy",
              options: [
                { value: "copy", label: "送り先へ資料もコピーする" },
                { value: "drop", label: "資料への参照を外す" },
              ],
            }]
          : []),
      ],
      confirmLabel: "実行",
    });
    if (!values) return null;
    const target = destinations.find((item) => item.path === values.target) ?? destinations[0];
    return {
      target: target.path,
      targetLabel: target.label,
      move: values.mode === "move",
      copyReferences: values.references !== "drop",
    };
  };

  const isExistingReference = (path: string) =>
    referenceCandidates.some(
      (file) => normalizedReferenceKey(file.sourcePath) === normalizedReferenceKey(path),
    );

  /** 送る項目が参照している資料を、送り先へコピーするか参照を外すかに振り分ける。 */
  const prepareReferenceRewrite = async (
    targetPath: string,
    referencedPaths: string[],
    copyReferences: boolean,
  ): Promise<ReferenceRewrite> => {
    const existing = referencedPaths.filter(isExistingReference);
    if (!existing.length || !projectFolder) return { copied: new Map(), dropped: new Set() };
    if (!copyReferences) {
      return { copied: new Map(), dropped: new Set(existing.map(normalizedReferenceKey)) };
    }
    const transferred = await invoke<{ from: string; file: ReferenceFileInfo }[]>(
      "transfer_reference_files",
      {
        sourceRoot: projectFolder.path,
        targetRoot: targetPath,
        sourcePaths: existing,
        removeImportedSources: false,
      },
    );
    return {
      copied: new Map(transferred.map((item) => [normalizedReferenceKey(item.from), item.file])),
      dropped: new Set(),
    };
  };

  const reportTransferError = (error: unknown) => {
    setLastError(String(error));
    showToast(`移動・コピーできませんでした: ${String(error)}`);
  };

  const transferPlotCard = async (cardId: string) => {
    const card = plotCards.find((item) => item.id === cardId);
    if (!card) return;
    const referencedPaths = plotCardReferencePaths([card]);
    const options = await requestTransferOptions({
      itemLabel: card.kind === "chapter" ? "章ラベル" : "プロット",
      referenceCount: referencedPaths.filter(isExistingReference).length,
    });
    if (!options) return;
    try {
      const rewrite = await prepareReferenceRewrite(options.target, referencedPaths, options.copyReferences);
      const targetCards = await loadWorkspacePlotCards(options.target);
      await saveWorkspacePlotCards(options.target, [
        ...targetCards,
        { ...rewritePlotCard(card, rewrite), id: crypto.randomUUID() },
      ]);
      if (options.move) setPlotCards((current) => current.filter((item) => item.id !== cardId));
      showToast(`${options.targetLabel}へ${options.move ? "移動" : "コピー"}しました`);
    } catch (error) {
      reportTransferError(error);
    }
  };

  const ensureIdeaTransferAvailable = () => {
    if (settings.snippetStorageMode === "workspace") return true;
    showToast("Idea をプロファイルに保存している間は、作品ごとの移動・コピーはできません");
    return false;
  };

  const transferIdeaThread = async (threadId: string) => {
    if (!ensureIdeaTransferAvailable()) return;
    const thread = snippets.find((item) => item.id === threadId);
    if (!thread || thread.kind === "inbox") return;
    const layout = referenceLayout.ideaThreads.find((item) => item.threadId === threadId);
    const referencedPaths = threadItemReferencePaths(layout?.items ?? []);
    const options = await requestTransferOptions({
      itemLabel: "スレッド",
      referenceCount: referencedPaths.filter(isExistingReference).length,
    });
    if (!options) return;
    try {
      const rewrite = await prepareReferenceRewrite(options.target, referencedPaths, options.copyReferences);
      const fragmentIds = new Map(thread.fragments.map((fragment) => [fragment.id, crypto.randomUUID()]));
      const copiedThread: IdeaThread = {
        ...thread,
        id: crypto.randomUUID(),
        updatedAt: Date.now(),
        fragments: thread.fragments.map((fragment) => ({
          ...fragment,
          id: fragmentIds.get(fragment.id) ?? crypto.randomUUID(),
        })),
      };
      const [targetThreads, targetLayout] = await Promise.all([
        loadWorkspaceSnippets(options.target),
        loadReferenceLayout(options.target),
      ]);
      await saveWorkspaceSnippets(options.target, [...targetThreads, copiedThread]);
      if (layout) {
        const items = rewriteThreadItems(layout.items, rewrite).map((item) =>
          item.sourceType === "idea"
            ? { ...item, fragmentId: fragmentIds.get(item.fragmentId) ?? item.fragmentId }
            : { ...item, id: crypto.randomUUID() },
        );
        // 移す先は作品ごとの Idea なので、相手の並び順も作品ごとの側に合わせてから足す。
        const workspaceLayout = alignIdeaLayoutToMode(targetLayout, "workspace");
        await saveReferenceLayout(options.target, {
          ...workspaceLayout,
          ideaThreads: [...workspaceLayout.ideaThreads, { threadId: copiedThread.id, items }],
        });
      }
      if (options.move) updateIdeaThreads((threads) => threads.filter((item) => item.id !== threadId));
      showToast(`スレッドを${options.targetLabel}へ${options.move ? "移動" : "コピー"}しました`);
    } catch (error) {
      reportTransferError(error);
    }
  };

  const transferIdeaFragment = async (threadId: string, fragmentId: string) => {
    if (!ensureIdeaTransferAvailable()) return;
    const fragment = snippets
      .find((item) => item.id === threadId)
      ?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    const options = await requestTransferOptions({ itemLabel: "断片", referenceCount: 0 });
    if (!options) return;
    try {
      const targetThreads = await loadWorkspaceSnippets(options.target);
      const copiedFragment = { ...fragment, id: crypto.randomUUID(), updatedAt: Date.now() };
      // 送り先では未整理メモ（インボックス）に入れる。読み込みで必ずインボックスが補われる。
      const nextThreads = targetThreads.map((item) =>
        item.kind === "inbox"
          ? { ...item, updatedAt: Date.now(), fragments: [...item.fragments, copiedFragment] }
          : item,
      );
      await saveWorkspaceSnippets(options.target, nextThreads);
      if (options.move) {
        patchThread(threadId, (thread) => ({
          ...thread,
          fragments: thread.fragments.filter((item) => item.id !== fragmentId),
        }));
      }
      showToast(`断片を${options.targetLabel}のインボックスへ${options.move ? "移動" : "コピー"}しました`);
    } catch (error) {
      reportTransferError(error);
    }
  };

  const transferReferenceFile = async (file: ReferenceFileInfo) => {
    if (!projectFolder) return;
    const options = await requestTransferOptions({
      itemLabel: "資料",
      referenceCount: 0,
      // ツリー内の文書として置かれた資料は元の場所から動かさない。
      canMove: file.imported,
    });
    if (!options) return;
    try {
      await invoke("transfer_reference_files", {
        sourceRoot: projectFolder.path,
        targetRoot: options.target,
        sourcePaths: [file.sourcePath],
        removeImportedSources: options.move,
      });
      if (options.move) {
        const key = normalizedReferenceKey(file.sourcePath);
        setReferenceCandidates((current) =>
          current.filter((item) => normalizedReferenceKey(item.sourcePath) !== key),
        );
        setReferenceLayout((current) => ({
          ...current,
          cards: current.cards.filter(
            (card) => !isReferenceBinderCard(card) || normalizedReferenceKey(card.sourcePath) !== key,
          ),
          recent: current.recent.filter((item) => normalizedReferenceKey(item.sourcePath) !== key),
          ideaThreads: current.ideaThreads.map((layout) => ({
            ...layout,
            items: layout.items.filter(
              (item) => item.sourceType !== "reference" || normalizedReferenceKey(item.sourcePath) !== key,
            ),
          })),
        }));
      }
      showToast(`「${file.name}」を${options.targetLabel}へ${options.move ? "移動" : "コピー"}しました`);
    } catch (error) {
      reportTransferError(error);
    }
  };

  const handleOpenProjectFolder = async () => {
    await openWorkspace();
  };

  const handleRetryWorkspaceRestore = async () => {
    if (!workspaceAlert || !isTauriRuntime()) return;

    setSaveStatus("loading");
    try {
      const folder = await invoke<ProjectFolder>("list_project_text_files", {
        folderPath: workspaceAlert.path,
      });
      const tabRestore = await openWorkspaceFolder(folder);
      setWorkspaceAlert(null);
      setSaveStatus("saved");
      const detail = [
        tabRestore.movedCount ? `移動したタブ ${tabRestore.movedCount}件を追跡` : "",
        tabRestore.missingNames.length
          ? `見つからないタブ ${tabRestore.missingNames.length}件を除外`
          : "",
      ].filter(Boolean).join(" / ");
      showToast(detail ? `プロジェクトを復元しました（${detail}）` : "プロジェクトを復元しました");
    } catch (error) {
      setLastError(String(error));
      setWorkspaceAlert((current) => current);
      setSaveStatus("dirty");
    }
  };

  const handleForgetWorkspace = () => {
    if (!workspaceAlert) return;
    const failedPath = workspaceAlert.path;
    setAppState((current) => ({
      ...current,
      lastWorkspacePath:
        current.lastWorkspacePath === failedPath ? null : current.lastWorkspacePath,
      recentWorkspaces: current.recentWorkspaces.filter(
        (workspace) => workspace.path !== failedPath,
      ),
    }));
    setWorkspaceAlert(null);
    setLastError("");
  };

  const handleProjectFileSelect = async (path: string) => {
    if (!path || path === currentFilePath) return;
    const existingTab = openTabs.find((tab) => tab.path === path);
    if (existingTab) {
      activateDocumentTab(existingTab.id);
      showToast(`「${existingTab.name}」を開きました`);
      return;
    }

    try {
      const document = await invoke<TextDocument>("read_text_file", { path });
      loadDocumentIntoEditor(document);
      showToast(`「${document.name}」を開きました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  handleProjectFileSelectRef.current = handleProjectFileSelect;

  const findPluginDocument = (documentPath: string) => {
    if (!projectFolder) return null;
    return collectProjectTextFiles(projectFolder).find(
      (file) => pluginDocumentPath(projectFolder.path, file.path) === documentPath,
    ) ?? null;
  };

  const readPluginDocumentText = async (documentPath: string): Promise<string> => {
    const file = findPluginDocument(documentPath);
    if (!file) throw new Error(`文書が見つかりません: ${documentPath}`);
    if (currentFilePath && isSamePath(file.path, currentFilePath)) {
      return editorInstanceRef.current?.getValue() ?? editorText;
    }
    const document = await invoke<TextDocument>("read_text_file", { path: file.path });
    return parseFrontMatter(document.content).body;
  };

  const revealPluginRange = async (documentPath: string, from: number, to = from) => {
    const file = findPluginDocument(documentPath);
    if (!file) throw new Error(`文書が見つかりません: ${documentPath}`);
    setAppMode("write");
    if (!currentFilePath || !isSamePath(file.path, currentFilePath)) {
      await handleProjectFileSelect(file.path);
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        editorInstanceRef.current?.selectRange(from, to);
        editorInstanceRef.current?.focus();
      });
    });
  };

  const resolvePluginAnchor = async (pluginId: string, anchorId: string) => {
    const anchor = pluginAnchorsRef.current.find(
      (item) => item.id === anchorId && item.pluginId === pluginId,
    );
    if (!anchor) throw new Error(`アンカーが見つかりません: ${anchorId}`);
    const text = await readPluginDocumentText(anchor.documentPath);
    const resolved = resolveThenPluginAnchor(anchor, text);
    if (!resolved) return null;
    if (
      resolved.from !== anchor.from ||
      resolved.to !== anchor.to ||
      resolved.contextBefore !== anchor.contextBefore ||
      resolved.contextAfter !== anchor.contextAfter
    ) {
      persistPluginAnchors(
        pluginAnchorsRef.current.map((item) => item.id === anchor.id ? resolved : item),
      );
    }
    return resolved;
  };

  const updatePluginStorage = async (
    pluginId: string,
    updater: (data: Record<string, unknown>) => void,
  ) => {
    const rootPath = projectFolder?.path;
    if (!rootPath) throw new Error("プロジェクトを開いてください");
    const previous = pluginStorageQueuesRef.current.get(pluginId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      const data = await invoke<Record<string, unknown>>("load_plugin_project_data", {
        rootPath,
        pluginId,
      });
      updater(data);
      await invoke("save_plugin_project_data", { rootPath, pluginId, data });
    });
    pluginStorageQueuesRef.current.set(pluginId, pending);
    try {
      await pending;
    } finally {
      if (pluginStorageQueuesRef.current.get(pluginId) === pending) {
        pluginStorageQueuesRef.current.delete(pluginId);
      }
    }
  };

  const handlePluginRequest = async ({
    pluginId,
    method,
    args,
  }: ThenPluginHostRequest): Promise<unknown> => {
    const plugin = loadedPlugins.find((item) => item.manifest.id === pluginId);
    if (!plugin) throw new Error("プラグインが読み込まれていません");
    const requiredPermission = pluginPermissionForMethod(method);
    if (!requiredPermission || !plugin.manifest.permissions.includes(requiredPermission)) {
      throw new Error(`権限がありません: ${requiredPermission ?? method}`);
    }
    const input = objectArgs(args);

    if (method === "editor.getSelection") {
      const editor = editorInstanceRef.current;
      if (!editor) return null;
      const selection = editor.getSelection();
      return {
        documentPath:
          projectFolder && currentFilePath
            ? pluginDocumentPath(projectFolder.path, currentFilePath)
            : null,
        ...selection,
        text: editor.getValue().slice(selection.from, selection.to),
      };
    }

    if (method === "editor.moveCursor") {
      if (typeof input.anchorId === "string") {
        const resolved = await resolvePluginAnchor(pluginId, input.anchorId);
        if (!resolved) throw new Error("アンカーを現在の文書へ再接続できませんでした");
        await revealPluginRange(resolved.documentPath, resolved.from, resolved.to);
        return true;
      }
      const documentPath =
        typeof input.documentPath === "string"
          ? input.documentPath
          : projectFolder && currentFilePath
            ? pluginDocumentPath(projectFolder.path, currentFilePath)
            : null;
      if (!documentPath) throw new Error("移動先の文書が指定されていません");
      const from = typeof input.from === "number"
        ? input.from
        : typeof input.offset === "number"
          ? input.offset
          : 0;
      const to = typeof input.to === "number" ? input.to : from;
      await revealPluginRange(documentPath, from, to);
      return true;
    }

    if (method === "anchors.create") {
      if (!projectFolder || !currentFilePath) throw new Error("プロジェクト内の文書を開いてください");
      const documentPath = pluginDocumentPath(projectFolder.path, currentFilePath);
      if (!documentPath) throw new Error("プロジェクト外の文書にはアンカーを作成できません");
      const editor = editorInstanceRef.current;
      if (!editor) throw new Error("エディタが準備できていません");
      const selection = editor.getSelection();
      const from = typeof input.from === "number" ? input.from : selection.from;
      const to = typeof input.to === "number" ? input.to : selection.to;
      const anchor = createThenPluginAnchor({
        id: crypto.randomUUID(),
        pluginId,
        documentPath,
        from,
        to,
        text: editor.getValue(),
      });
      persistPluginAnchors([...pluginAnchorsRef.current, anchor]);
      return anchor;
    }

    if (method === "anchors.resolve" || method === "anchors.reveal") {
      if (typeof input.anchorId !== "string") throw new Error("anchorId が必要です");
      const resolved = await resolvePluginAnchor(pluginId, input.anchorId);
      if (method === "anchors.reveal" && resolved) {
        await revealPluginRange(resolved.documentPath, resolved.from, resolved.to);
      }
      return resolved;
    }

    if (method === "anchors.delete") {
      if (typeof input.anchorId !== "string") throw new Error("anchorId が必要です");
      const next = pluginAnchorsRef.current.filter(
        (item) => !(item.id === input.anchorId && item.pluginId === pluginId),
      );
      persistPluginAnchors(next);
      return next.length !== pluginAnchorsRef.current.length;
    }

    if (method === "storage.get") {
      const rootPath = projectFolder?.path;
      if (!rootPath) throw new Error("プロジェクトを開いてください");
      const key = typeof input.key === "string" ? input.key : "";
      if (!key) throw new Error("storage key が必要です");
      await (pluginStorageQueuesRef.current.get(pluginId) ?? Promise.resolve()).catch(() => undefined);
      const data = await invoke<Record<string, unknown>>("load_plugin_project_data", { rootPath, pluginId });
      return data[key] ?? null;
    }

    if (method === "storage.set" || method === "storage.delete") {
      const key = typeof input.key === "string" ? input.key : "";
      if (!key || key.length > 200) throw new Error("storage key が不正です");
      await updatePluginStorage(pluginId, (data) => {
        if (method === "storage.delete") delete data[key];
        else data[key] = input.value;
      });
      return true;
    }

    if (method === "commands.register") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const keybinding = typeof input.keybinding === "string" ? input.keybinding.trim() : undefined;
      const menus = Array.isArray(input.menus)
        ? input.menus.filter((menu): menu is "editor.selection" => menu === "editor.selection")
        : [];
      if (Array.isArray(input.menus) && menus.length !== input.menus.length) {
        throw new Error("未対応のコマンドメニューが指定されました");
      }
      if (!id || !title) throw new Error("command id と title が必要です");
      if (keybinding && !isValidThenPluginKeybinding(keybinding)) {
        throw new Error("ショートカットは Mod/Ctrl/Cmd を含む形式で指定してください");
      }
      setPluginCommands((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title, keybinding, menus },
      ]);
      return true;
    }

    if (method === "commands.unregister") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginCommands((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    if (method === "views.register") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const icon = pluginViewIcon(input.icon);
      if (!id || !title) throw new Error("view id と title が必要です");
      setPluginViews((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title, icon },
      ]);
      return true;
    }

    if (method === "views.unregister") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginViews((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    if (method === "views.registerScreen") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const icon = pluginViewIcon(input.icon);
      if (!id || !title) throw new Error("screen id と title が必要です");
      if (!plugin.manifest.icon?.paths.length) {
        throw new Error("画面を登録するプラグインにはmanifest.jsonのiconが必要です");
      }
      setPluginScreens((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title, icon },
      ]);
      return true;
    }

    if (method === "views.unregisterScreen") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginScreens((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    if (method === "views.registerModal") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!id || !title) throw new Error("modal id と title が必要です");
      setPluginModals((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title },
      ]);
      return true;
    }

    if (method === "views.unregisterModal") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginModals((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      if (activePluginModalKey === `${pluginId}:${id}`) setActivePluginModalKey(null);
      return true;
    }

    if (method === "views.openModal") {
      const id = typeof input.id === "string" ? input.id : "";
      const modal = pluginModals.find(
        (item) => item.pluginId === pluginId && item.id === id,
      );
      if (!modal) throw new Error(`登録されていないmodalです: ${id}`);
      setActivePluginModalKey(`${pluginId}:${id}`);
      return true;
    }

    if (method === "views.closeModal") {
      const id = typeof input.id === "string" ? input.id : "";
      if (!activePluginModal || activePluginModal.pluginId !== pluginId) return false;
      if (id && activePluginModal.id !== id) return false;
      setActivePluginModalKey(null);
      return true;
    }

    if (method === "views.open") {
      const id = typeof input.id === "string" ? input.id : "";
      const screen = pluginScreens.find(
        (item) => item.pluginId === pluginId && item.id === id,
      );
      if (screen) {
        setActivePluginScreenKey(`${pluginId}:${id}`);
        setAppMode("plugin");
        return true;
      }
      const view = pluginViews.find(
        (item) => item.pluginId === pluginId && item.id === id,
      );
      if (view) {
        setAppMode("write");
        setIsRightSidebarCollapsed(false);
        setRightSidebarTab(`plugin:${pluginId}:${id}`);
        return true;
      }
      throw new Error(`登録されていないviewです: ${id}`);
    }

    if (method === "statusbar.set") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const text = typeof input.text === "string" ? input.text.trim() : "";
      const tooltip = typeof input.tooltip === "string" ? input.tooltip.trim() : undefined;
      const commandId = typeof input.commandId === "string" ? input.commandId.trim() : undefined;
      if (!id || !text || text.length > 160) {
        throw new Error("status itemのidと160文字以内のtextが必要です");
      }
      setPluginStatusItems((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, text, tooltip, commandId },
      ]);
      return true;
    }

    if (method === "statusbar.remove") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginStatusItems((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    throw new Error(`未対応のThen APIです: ${method}`);
  };

  const handleInstallPlugin = async () => {
    if (!isTauriRuntime()) {
      showToast("デスクトップ版で利用してください");
      return;
    }
    try {
      const candidate = await invoke<{
        sourcePath: string;
        manifest: ThenPluginManifest;
      } | null>("inspect_plugin_dialog");
      if (!candidate) return;
      const approved = await requestConfirm({
        title: "プラグインを導入",
        message: `「${candidate.manifest.name}」v${candidate.manifest.version} をThen全体へ導入しますか？`,
        detail: candidate.manifest.permissions.length
          ? `要求する権限: ${candidate.manifest.permissions.join(" / ")}`
          : "このプラグインはThen API権限を要求しません。",
        confirmLabel: "導入",
      });
      if (!approved) return;
      const installed = await invoke<LoadedThenPlugin>("install_plugin", {
        sourcePath: candidate.sourcePath,
        expectedManifest: candidate.manifest,
      });
      await reloadInstalledPlugins();
      showToast(`プラグイン「${installed.manifest.name}」を導入しました`);
    } catch (error) {
      setLastError(String(error));
      showToast("プラグインを導入できませんでした");
    }
  };

  const handleUninstallPlugin = async (plugin: LoadedThenPlugin) => {
    const confirmed = await requestConfirm({
      title: "プラグインを削除",
      message: `「${plugin.manifest.name}」v${plugin.manifest.version} をThenから削除しますか？`,
      detail:
        "プラグイン本体だけを削除します。各プロジェクトに保存されたデータと永続アンカーは、再導入時に復元できるよう残します。",
      confirmLabel: "削除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await invoke("uninstall_plugin", { pluginId: plugin.manifest.id });
      await reloadInstalledPlugins();
      showToast(`プラグイン「${plugin.manifest.name}」を削除しました`);
    } catch (error) {
      setLastError(String(error));
      showToast("プラグインを削除できませんでした");
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    return manageAsyncRegistration(
      listen<string>("then-open-export-source", (event) => {
        void handleProjectFileSelectRef.current(event.payload);
      }),
      (error) => setLastError(String(error)),
    );
  }, []);

  // プロジェクトを切り替えたら埋め込みモードの内容は古くなるため本文モードへ戻す。
  const projectPathForModeReset = projectFolder?.path ?? null;
  useEffect(() => {
    setCanvasEmbedPayload(null);
    setDraftCanvasContext(null);
    setDraftSelectRequest(null);
    setExportEmbedPayload(null);
    setAppMode("write");
  }, [projectPathForModeReset]);

  // 別ウィンドウのキャンバスへ Idea・資料の最新一覧を届ける。断片編集は
  // キーストロークごとに snippets が変わるためデバウンスする。ウィンドウが
  // 存在しない場合は誰も受け取らないだけで害はない（ボードの再読込もしない）。
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const timer = window.setTimeout(() => {
      const payload: CanvasLiveDataEvent = {
        ideaThreads: snippets.map((thread) => ({
          id: thread.id,
          kind: thread.kind,
          title: thread.title,
          fragments: thread.fragments.map((fragment) => ({
            id: fragment.id,
            body: fragment.body,
            used: fragment.used,
          })),
        })),
        referenceFiles: projectFolder ? sortedReferenceCandidates : [],
      };
      emitTo("idea-canvas", CANVAS_LIVE_DATA_EVENT, payload).catch(() => {
        // 対象ウィンドウが無い・閉じた直後などは黙って捨てる
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [snippets, sortedReferenceCandidates, projectFolder]);

  const jumpToEditorLine = (line: number) => {
    const targetLine = Math.max(1, line);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        editorInstanceRef.current?.jumpToLine(targetLine);
        editorInstanceRef.current?.focus();
      });
    });
  };

  /**
   * 無視した指摘を覚えておくときの見出し。ワークスペース内の相対パスにして、
   * フォルダごと移動しても対応が切れないようにする。無題の原稿は保存先が
   * ないので、タブの識別子で代用する。
   */
  const proofreadIgnoreKey = useMemo(() => {
    if (!currentFilePath) return `scratch:${documentKey}`;
    const root = projectFolder?.path;
    if (!root) return currentFilePath;
    const normalizedRoot = root.replace(/\\/g, "/");
    const normalizedPath = currentFilePath.replace(/\\/g, "/");
    return normalizedPath.startsWith(`${normalizedRoot}/`)
      ? normalizedPath.slice(normalizedRoot.length + 1)
      : normalizedPath;
  }, [currentFilePath, documentKey, projectFolder]);

  /** 校正辞書をタブ区切りのテキストとして保存する。 */
  const exportProofreadDictionary = async (content: string) => {
    if (!isTauriRuntime()) return null;
    try {
      return await invoke<string | null>("export_proofread_dictionary_dialog", { content });
    } catch (error) {
      setLastError(String(error));
      showToast("校正辞書の書き出しに失敗しました");
      return null;
    }
  };

  /** 校正辞書のテキストを読み込む。解析はペイン側で一括入力と同じ形式で行う。 */
  const importProofreadDictionary = async () => {
    if (!isTauriRuntime()) return null;
    try {
      return await invoke<string | null>("import_proofread_dictionary_dialog");
    } catch (error) {
      setLastError(String(error));
      showToast("校正辞書の読み込みに失敗しました");
      return null;
    }
  };

  /** 校正の指摘位置を本文で選択して見せる。 */
  const revealEditorRange = (from: number, to: number) => {
    window.requestAnimationFrame(() => {
      editorInstanceRef.current?.selectRange(from, to);
    });
  };

  /** 校正の置換候補を本文へ適用する。キャレットは置換後の末尾に置く。 */
  const replaceEditorRange = (from: number, to: number, insert: string) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    editor.replaceRange(from, to, insert, from + insert.length);
    showToast(insert ? `「${insert}」に置き換えました` : "該当箇所を削除しました");
  };

  const handleProjectSearchResultOpen = async (result: ProjectSearchResult) => {
    // ライブラリ全体の検索で別の範囲の結果を選んだら、その範囲へ切り替えてから開く。
    if (result.path && projectFolder && !findProjectEntry(projectFolder.children, result.path)) {
      const library = projectFolder.library;
      const scopePath = library
        ? [...library.projects.map((project) => project.path), library.path].find((path) =>
            isPathSameOrInside(result.path, path),
          )
        : null;
      if (!scopePath) return;
      pendingSearchJumpRef.current = result;
      if (!(await openWorkspace(scopePath))) pendingSearchJumpRef.current = null;
      return;
    }
    if (result.path && result.path !== currentFilePath) {
      await handleProjectFileSelect(result.path);
    }
    if (result.absoluteFrom !== undefined && result.absoluteTo !== undefined) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          editorInstanceRef.current?.selectRange(result.absoluteFrom!, result.absoluteTo!);
          editorInstanceRef.current?.focus();
        });
      });
    } else {
      jumpToEditorLine(result.line);
    }
  };

  searchResultOpenRef.current = handleProjectSearchResultOpen;

  const handleReplaceInCurrentFile = () => {
    if (projectSearchQuery.length === 0) {
      showToast("検索語句を入力してください");
      return;
    }

    const result = replaceMarkdownBodyMatches(
      markdown,
      projectSearchQuery,
      projectReplaceValue,
      projectSearchOptions,
    );
    if (result.error) {
      showToast("正規表現に誤りがあります");
      return;
    }
    if (result.count === 0) {
      showToast("置換できる一致がありません");
      return;
    }

    setActiveMarkdown(result.markdown);
    setSaveStatus("dirty");
    showToast(`${result.count}件をファイル内で置換しました`);
  };

  const handleReplaceInProject = async () => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    if (!isTauriRuntime()) {
      showToast("プロジェクト置換はTauri版で利用できます");
      return;
    }
    if (projectSearchQuery.length === 0) {
      showToast("検索語句を入力してください");
      return;
    }
    if (hasPropertyConditions) {
      showToast("プロパティの条件を含む検索では置換できません");
      return;
    }
    if (projectSearchOutcome.error) {
      showToast("正規表現に誤りがあります");
      return;
    }

    const shouldReplace = await requestConfirm({
      title: "プロジェクト全体を置換",
      message: `${projectSearchOutcome.matchedFileCount}ファイルの${projectSearchOutcome.total}件を置換します。`,
      detail: `検索: ${projectSearchQuery} / 置換: ${projectReplaceValue || "空文字"}\n開いているフォルダ内の本文を保存しながら置換します。`,
      confirmLabel: "置換",
      danger: true,
    });
    if (!shouldReplace) return;

    setIsProjectReplacing(true);
    setLastError("");
    try {
      const files = collectProjectTextFiles(projectFolder);
      const savedDocuments: TextDocument[] = [];
      let totalCount = 0;

      for (const file of files) {
        const openTab = openTabs.find((tab) => tab.path === file.path);
        const sourceMarkdown =
          openTab?.path === currentFilePath
            ? markdown
            : openTab?.markdown ??
              (await invoke<TextDocument>("read_text_file", { path: file.path })).content;
        const result = replaceMarkdownBodyMatches(
          sourceMarkdown,
          projectSearchQuery,
          projectReplaceValue,
          projectSearchOptions,
        );
        if (result.error) throw new Error(result.error);
        if (result.count === 0) continue;

        const document = await invoke<TextDocument>("save_text_file", {
          path: file.path,
          content: result.markdown,
        });
        savedDocuments.push(document);
        totalCount += result.count;
        setProjectAst((current) =>
          current && current.rootPath === projectFolder.path
            ? upsertProjectAstDocument(current, {
                path: document.path,
                name: document.name,
                text: parseFrontMatter(document.content).body,
              })
            : current,
        );
      }

      if (!savedDocuments.length) {
        showToast("置換できる一致がありません");
        return;
      }

      const savedByPath = new Map(savedDocuments.map((document) => [document.path, document]));
      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const document = savedByPath.get(tab.path);
          if (!document) return tab;
          return {
            ...tab,
            markdown: document.content,
            savedMarkdown: document.content,
            editorRevision: null,
            name: document.name,
            saveStatus: "saved",
          };
        }),
      );

      const activeSavedDocument = currentFilePath ? savedByPath.get(currentFilePath) : null;
      if (activeSavedDocument) {
        lastSavedMarkdownRef.current = activeSavedDocument.content;
        setAppState((current) => ({
          ...current,
          markdown: activeSavedDocument.content,
          lastFilePath: activeSavedDocument.path,
        }));
        setSaveStatus("saved");
      }

      showToast(`${totalCount}件をプロジェクト全体で置換しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    } finally {
      setIsProjectReplacing(false);
    }
  };

  const handleProjectOutlineJump = async (path: string, item: DocumentOutlineItem) => {
    if (path !== currentFilePath) {
      await handleProjectFileSelect(path);
    }
    jumpToEditorLine(item.line);
    setFocusedFolderPath(null);
  };

  const closeFileMenuAndRun = (action: () => void | Promise<void>) => {
    setIsFileMenuOpen(false);
    void action();
  };

  const closeBreadcrumbMenuAndRun = (action: () => void | Promise<void>) => {
    setActiveBreadcrumbPath(null);
    setBreadcrumbBrowsePath(null);
    setIsBreadcrumbOverflowOpen(false);
    setIsWorkspaceSwitcherOpen(false);
    void action();
  };

  const loadTextTemplates = async (): Promise<TextTemplateSummary[]> => {
    if (!isTauriRuntime()) return [];
    return invoke<TextTemplateSummary[]>("list_text_templates", {
      rootPath: projectFolder?.path ?? null,
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

  const handleRegisterCurrentFileAsTemplate = async () => {
    if (!isTauriRuntime()) {
      showToast("テンプレート登録はTauri版で利用できます");
      return;
    }
    const sourceExtension = currentFileName.toLowerCase().endsWith(".md") ? "md" : "txt";
    const initialName = currentFileName.replace(/\.(?:txt|md)$/i, "") || "新規テンプレート";
    const scopeOptions = projectFolder
      ? [
          { value: "workspace", label: "このワークスペース" },
          { value: "profile", label: "すべてのワークスペースで共通" },
        ]
      : [{ value: "profile", label: "すべてのワークスペースで共通" }];
    const draft = await requestMultiInput({
      title: "このファイルをテンプレートとして登録",
      fields: [
        {
          id: "name",
          label: "テンプレート名",
          initialValue: initialName,
          placeholder: "例: 章のひな型",
        },
        {
          id: "scope",
          label: "保存先",
          initialValue: projectFolder ? "workspace" : "profile",
          options: scopeOptions,
        },
      ],
      confirmLabel: "登録",
    });
    if (!draft) return;

    try {
      const templates = await loadTextTemplates();
      const normalizedName = draft.name.replace(/\.(?:txt|md)$/i, "");
      const existing = templates.find(
        (template) =>
          template.scope === draft.scope &&
          template.extension === sourceExtension &&
          template.name.localeCompare(normalizedName, undefined, { sensitivity: "accent" }) === 0,
      );
      let overwrite = false;
      if (existing) {
        overwrite = await requestConfirm({
          title: "テンプレートを上書き",
          message: `「${existing.name}」はすでに登録されています。`,
          detail: "登録済みの内容を、現在のファイル内容で置き換えます。",
          confirmLabel: "上書き",
        });
        if (!overwrite) return;
      }
      const registered = await invoke<TextTemplateSummary>("register_text_template", {
        rootPath: projectFolder?.path ?? null,
        scope: draft.scope,
        name: normalizedName,
        extension: sourceExtension,
        content: markdown,
        overwrite,
      });
      showToast(`テンプレート「${registered.name}」を登録しました`);
    } catch (error) {
      setLastError(String(error));
      showToast("テンプレートを登録できませんでした");
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
    const name = await requestInput({
      title: "名前を変更",
      label: isFolderEntry ? "フォルダ名" : "テキストファイル名",
      initialValue: entry.name,
      confirmLabel: "変更",
    });
    if (!name || name.trim() === entry.name) return;

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

      const document = await invoke<TextDocument>("rename_project_entry", {
        path: entry.path,
        name,
      });
      const oldReferencePath = toProjectRelativePath(projectFolder.path, entry.path);
      const newReferencePath = toProjectRelativePath(projectFolder.path, document.path);
      retargetPluginAnchors(entry.path, document.path);
      if (oldReferencePath && newReferencePath) {
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
      }
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
      } else {
        setAppState((current) => ({
          ...current,
          lastFilePath: current.lastFilePath
            ? retargetFilesystemPath(current.lastFilePath, entry.path, document.path) ??
              current.lastFilePath
            : current.lastFilePath,
        }));
      }

      setAppState((current) => {
        const retargetRecord = <T,>(record: Record<string, T>): Record<string, T> => {
          const next: Record<string, T> = {};
          for (const [path, value] of Object.entries(record)) {
            next[retargetFilesystemPath(path, entry.path, document.path) ?? path] = value;
          }
          return next;
        };
        return {
          ...current,
          fileProgress: retargetRecord(current.fileProgress),
          cursorPositions: retargetRecord(current.cursorPositions),
        };
      });

      setFocusedFolderPath((current) =>
        current ? retargetFilesystemPath(current, entry.path, document.path) ?? current : current,
      );
      if (isFolderEntry) {
        setCollapsedWorkspaceFolderPaths((current) => {
          const next = new Set<string>();
          for (const path of current) {
            next.add(retargetFilesystemPath(path, entry.path, document.path) ?? path);
          }
          return next;
        });
      }
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
      const deletedAnchorRoot = toProjectRelativePath(projectFolder.path, entry.path)
        .replace(/[\\/]+/g, "/")
        .toLocaleLowerCase();
      persistPluginAnchors(pluginAnchorsRef.current.filter((anchor) => {
        const documentPath = anchor.documentPath.replace(/[\\/]+/g, "/").toLocaleLowerCase();
        return documentPath !== deletedAnchorRoot && !documentPath.startsWith(`${deletedAnchorRoot}/`);
      }));
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
      setAppState((current) => {
        const nextCursorPositions = { ...current.cursorPositions };
        const nextFileProgress = { ...current.fileProgress };
        for (const path of Object.keys(nextCursorPositions)) {
          if (isPathSameOrInside(path, entry.path)) {
            delete nextCursorPositions[path];
          }
        }
        for (const path of Object.keys(nextFileProgress)) {
          if (isPathSameOrInside(path, entry.path)) {
            delete nextFileProgress[path];
          }
        }
        return {
          ...current,
          cursorPositions: nextCursorPositions,
          fileProgress: nextFileProgress,
          lastFilePath:
            current.lastFilePath && isPathSameOrInside(current.lastFilePath, entry.path)
              ? null
              : current.lastFilePath,
        };
      });

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

      const result = await invoke<MoveProjectEntryResult>("move_project_entry", {
        rootPath: projectFolder.path,
        sourcePath,
        targetFolderPath,
        targetPath: targetPath ?? null,
        position: position ?? null,
      });
      const oldReferencePath = toProjectRelativePath(projectFolder.path, result.oldPath);
      const newReferencePath = toProjectRelativePath(projectFolder.path, result.newPath);
      retargetPluginAnchors(result.oldPath, result.newPath);
      if (oldReferencePath && newReferencePath) {
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
      }

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

      setAppState((current) => {
        const retargetRecord = <T,>(record: Record<string, T>): Record<string, T> => {
          const next: Record<string, T> = {};
          for (const [path, value] of Object.entries(record)) {
            next[retargetFilesystemPath(path, result.oldPath, result.newPath) ?? path] = value;
          }
          return next;
        };
        return {
          ...current,
          fileProgress: retargetRecord(current.fileProgress),
          cursorPositions: retargetRecord(current.cursorPositions),
          lastFilePath: current.lastFilePath
            ? retargetFilesystemPath(current.lastFilePath, result.oldPath, result.newPath) ??
              current.lastFilePath
            : current.lastFilePath,
        };
      });
      setFocusedFolderPath(
        sourceEntry.kind === "folder" ? result.newPath : result.newParentPath,
      );
      if (sourceEntry.kind === "folder") {
        setCollapsedWorkspaceFolderPaths((current) => {
          const next = new Set<string>();
          for (const path of current) {
            next.add(retargetFilesystemPath(path, result.oldPath, result.newPath) ?? path);
          }
          return next;
        });
      }
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

      for (const moved of result.moves) {
        retargetPluginAnchors(moved.oldPath, moved.newPath);
        const oldReferencePath = toProjectRelativePath(
          projectFolder.path,
          moved.oldPath,
        );
        const newReferencePath = toProjectRelativePath(
          projectFolder.path,
          moved.newPath,
        );
        if (!oldReferencePath || !newReferencePath) continue;
        setPlotCards((current) =>
          current.map((card) => ({
            ...card,
            body: replacePlotReferencePath(
              card.body,
              oldReferencePath,
              newReferencePath,
            ),
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
      }

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
      }

      setAppState((current) => {
        const retargetRecord = <T,>(record: Record<string, T>): Record<string, T> => {
          const next: Record<string, T> = {};
          for (const [path, value] of Object.entries(record)) {
            next[retargetMovedPath(path) ?? path] = value;
          }
          return next;
        };
        const activeMovedDocument = activeNewPath
          ? movedDocumentByPath.get(activeNewPath)
          : null;
        return {
          ...current,
          ...(activeNewPath
            ? {
                markdown: activeMovedDocument?.content ?? current.markdown,
                lastFilePath: activeNewPath,
              }
            : {}),
          fileProgress: retargetRecord(current.fileProgress),
          cursorPositions: retargetRecord(current.cursorPositions),
          lastFilePath: current.lastFilePath
            ? retargetMovedPath(current.lastFilePath) ?? current.lastFilePath
            : current.lastFilePath,
        };
      });
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

  const handleHeadingMove = async (
    sources: SidebarHeadingSelection[],
    targetPath: string,
    targetLine: number | null,
    targetBlockId: string | null,
    position: HeadingDropPosition,
  ) => {
    logHeadingDnd("reorder-handler-reached", {
      sources,
      targetPath,
      targetLine,
      targetBlockId,
      position,
    });
    if (!sources.length) return;
    if (headingMoveInProgressRef.current) {
      showToast("見出しを移動中です");
      return;
    }
    const affectedPaths = new Set([...sources.map((source) => source.path), targetPath]);
    const affectedTabs = openTabs.filter(
      (tab) => tab.path && affectedPaths.has(tab.path),
    );
    if (affectedTabs.some((tab) => tab.saveStatus === "saving")) {
      showToast("保存完了後に見出しを移動してください");
      return;
    }
    headingMoveInProgressRef.current = true;

    const readMarkdown = async (path: string) => {
      const openTab = openTabs.find((tab) => tab.path === path);
      if (openTab) return openTab.markdown;
      return (await invoke<TextDocument>("read_text_file", { path })).content;
    };

    try {
      const originalDocuments = await Promise.all(
        [...affectedPaths].map(async (path) => ({
          path,
          markdown: await readMarkdown(path),
        })),
      );
      const originalByPath = new Map(
        originalDocuments.map((document) => [document.path, document.markdown] as const),
      );
      const move = moveHeadingSections({
        documents: originalDocuments,
        sources: sources.map((source) => ({
          path: source.path,
          line: source.line,
        })),
        targetPath,
        targetLine,
        position,
      });
      logHeadingDnd("reorder-transform-complete", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        changed: move.changed,
        movedTitles: move.movedTitles,
      });
      if (!move.changed) {
        showToast("見出しの移動先が同じため変更はありません");
        return;
      }

      const changedDocuments = move.documents.filter(
        (document) => document.markdown !== originalByPath.get(document.path),
      );
      logHeadingDnd("reorder-save-start", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        paths: changedDocuments.map((document) => document.path),
      });
      const saved = await invoke<HeadingMoveDocuments>("save_heading_move", {
        documents: changedDocuments.map((document) => ({
          path: document.path,
          content: document.markdown,
        })),
      });
      const savedDocuments = saved.documents;
      logHeadingDnd("reorder-save-complete", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        savedPaths: savedDocuments.map((document) => document.path),
      });
      const savedByPath = new Map(
        savedDocuments.map((document) => [document.path, document] as const),
      );

      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const document = savedByPath.get(tab.path);
          if (!document) return tab;
          return {
            ...tab,
            markdown: document.content,
            savedMarkdown: document.content,
            editorRevision: null,
            name: document.name,
            saveStatus: "saved",
          };
        }),
      );
      setProjectAst((current) => {
        if (!current || current.rootPath !== projectFolder?.path) return current;
        return savedDocuments.reduce(
          (next, document) =>
            upsertProjectAstDocument(next, {
              path: document.path,
              name: document.name,
              text: parseFrontMatter(document.content).body,
            }),
          current,
        );
      });

      const activeDocument = currentFilePath ? savedByPath.get(currentFilePath) : null;
      if (activeDocument) {
        lastSavedMarkdownRef.current = activeDocument.content;
        setAppState((current) => ({
          ...current,
          markdown: activeDocument.content,
          lastFilePath: activeDocument.path,
        }));
      }
      logHeadingDnd("state-update-scheduled", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        updatedTabPaths: savedDocuments.map((document) => document.path),
      });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const outlineRows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-outline-block-id]"),
          );
          const movedRows = outlineRows
            .filter((row) =>
              sources.some(
                (source) => row.dataset.outlineBlockId === source.blockId,
              ),
            )
            .map((row) => ({
              path: row.dataset.outlineFilePath ?? null,
              line: Number(row.dataset.outlineHeadingLine ?? 0),
            }));
          logHeadingDnd("state-dom-updated", {
            sourceBlockIds: sources.map((source) => source.blockId),
            targetBlockId,
            outlineRowCount: outlineRows.length,
            movedRows,
          });
        });
      });
      setLastError("");
      const sourcePaths = new Set(sources.map((source) => source.path));
      showToast(
        move.movedTitles.length === 1
          ? sourcePaths.size === 1 && sourcePaths.has(targetPath)
            ? `見出し「${move.movedTitles[0]}」を移動しました`
            : `見出し「${move.movedTitles[0]}」を別ファイルへ移動しました`
          : `${move.movedTitles.length}件の見出しを移動しました`,
      );
    } catch (error) {
      setLastError(String(error));
      showToast(error instanceof Error ? error.message : "見出しを移動できませんでした");
    } finally {
      headingMoveInProgressRef.current = false;
    }
  };

  const handleHeadingExtract = async (source: SidebarHeadingSelection) => {
    if (headingMoveInProgressRef.current) {
      showToast("見出しを移動中です");
      return;
    }
    const openSourceTab = openTabs.find((tab) => tab.path === source.path);
    if (openSourceTab?.saveStatus === "saving") {
      showToast("保存完了後に見出しを切り出してください");
      return;
    }

    const childChoice = await requestChoice({
      title: "見出しを別ファイルへ切り出す",
      message: `「${source.title}」の子階層も一緒に切り出しますか？`,
      detail: "「この見出しのみ」では、下位レベルの見出しを元ファイルに残します。",
      primaryLabel: "子階層も含める",
      secondaryLabel: "この見出しのみ",
    });
    if (!childChoice) return;

    const fileName = await requestInput({
      title: "切り出すファイル名",
      label: "テキストファイル名",
      initialValue: suggestedHeadingFileName(source.title, source.path),
      confirmLabel: "切り出す",
      placeholder: "例: 第一章.md",
    });
    if (!fileName) return;

    const sourceViewportBeforeExtract =
      openSourceTab?.id === activeTabIdRef.current
        ? editorInstanceRef.current?.getViewportState() ?? openSourceTab.viewportState
        : openSourceTab?.viewportState ?? null;
    headingMoveInProgressRef.current = true;
    try {
      const sourceMarkdown =
        openSourceTab?.markdown ??
        (await invoke<TextDocument>("read_text_file", { path: source.path })).content;
      const extraction = extractHeadingSection({
        sourceMarkdown,
        sourceLine: source.line,
        includeChildren: childChoice === "primary",
      });
      if (!extraction.changed || !extraction.extractedMarkdown) {
        showToast("切り出せる内容がありません");
        return;
      }

      const saved = await invoke<HeadingExtractDocuments>("extract_heading_to_file", {
        sourcePath: source.path,
        fileName,
        sourceContent: extraction.sourceMarkdown,
        extractedContent: extraction.extractedMarkdown,
      });
      const reconciledSource = reconcileSavedDocumentTabs(
        openTabs,
        activeTabIdRef.current,
        saved.sourceDocument,
      );
      const savedSourceBody = parseFrontMatter(saved.sourceDocument.content).body;
      const sourceCursorOffset = Math.min(
        extraction.sourceCursorOffset,
        savedSourceBody.length,
      );
      const sourceViewportState = {
        textLength: savedSourceBody.length,
        writingMode: settings.writingMode,
        anchorOffset: sourceCursorOffset,
        anchorRatio:
          sourceViewportBeforeExtract?.anchorRatio ??
          Math.max(0, Math.min(1, settings.typewriterOffset / 100)),
      };
      if (reconciledSource.activeSavedMarkdown !== null) {
        lastSavedMarkdownRef.current = reconciledSource.activeSavedMarkdown;
      }
      setAppState((current) => ({
        ...current,
        ...(reconciledSource.activeSavedMarkdown !== null
          ? {
              markdown: saved.sourceDocument.content,
              lastFilePath: saved.sourceDocument.path,
            }
          : {}),
        cursorPositions: {
          ...current.cursorPositions,
          [saved.sourceDocument.path]: {
            offset: sourceCursorOffset,
            length: savedSourceBody.length,
          },
        },
      }));
      // Switch tabs before yielding so the source update cannot briefly trigger
      // autosave as an unsaved editor change. Reconcile it afterwards to retain
      // a viewport anchored at the extraction point.
      loadDocumentIntoEditor(saved.extractedDocument);
      setOpenTabs((current) =>
        reconcileSavedDocumentTabs(
          current,
          activeTabIdRef.current,
          saved.sourceDocument,
          { viewportState: sourceViewportState },
        ).tabs,
      );
      setProjectAst((current) => {
        if (!current || current.rootPath !== projectFolder?.path) return current;
        return [saved.sourceDocument, saved.extractedDocument].reduce(
          (next, document) =>
            upsertProjectAstDocument(next, {
              path: document.path,
              name: document.name,
              text: parseFrontMatter(document.content).body,
            }),
          current,
        );
      });
      await refreshProjectFolder(getParentPath(source.path) ?? projectFolder?.path ?? "");
      setLastError("");
      showToast(`見出し「${extraction.extractedTitle}」を切り出しました`);
    } catch (error) {
      setLastError(String(error));
      showToast(error instanceof Error ? error.message : "見出しを切り出せませんでした");
    } finally {
      headingMoveInProgressRef.current = false;
    }
  };

  const jumpToOutlineItem = (item: OutlineItem) => {
    const view = getEditorView();
    if (!view) return;

    view.jumpToLine(item.line);
    setIsOutlineMenuOpen(false);
  };

  const getEditorView = () => {
    return editorInstanceRef.current;
  };

  const insertParagraph = (text: string, pos?: number) => {
    const view = getEditorView();
    if (!view) return false;

    const selection = view.getSelection();
    const insertFrom = typeof pos === "number" ? pos : selection.from;
    const insertTo = typeof pos === "number" ? pos : selection.to;
    const doc = view.getValue();
    const before = insertFrom > 0 ? doc.slice(insertFrom - 1, insertFrom) : "\n";
    const after = insertTo < doc.length ? doc.slice(insertTo, insertTo + 1) : "\n";
    const prefix = before === "\n" ? "" : "\n";
    const suffix = after === "\n" ? "" : "\n";
    const insertedText = `${prefix}${text}${suffix}`;
    const cursorPos = insertFrom + prefix.length + text.length;

    view.replaceRange(insertFrom, insertTo, insertedText, cursorPos);
    view.focus();
    return true;
  };

  const markFragmentUsed = (threadId: string, fragmentId: string, used: boolean) => {
    patchThread(threadId, (thread) => ({
      ...thread,
      fragments: thread.fragments.map((fragment) =>
        fragment.id === fragmentId
          ? { ...fragment, used, updatedAt: Date.now() }
          : fragment,
      ),
    }));
  };

  const toggleFragmentUsed = (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    markFragmentUsed(threadId, fragmentId, !fragment.used);
  };

  const openIdeaBinderCard = (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!thread || !fragment) return;

    setReferenceLayout((current) => {
      const existing = current.cards.find(
        (card) =>
          isIdeaBinderCard(card) &&
          card.threadId === threadId &&
          card.fragmentId === fragmentId,
      );
      if (existing) {
        return {
          ...current,
          cards: current.cards.map((card) =>
            card.id === existing.id
              ? {
                  ...card,
                  collapsed: false,
                  zIndex: nextReferenceZIndex(current.cards, card.pinned),
                }
              : card,
          ),
        };
      }

      const stageRect = workspaceRef.current?.getBoundingClientRect();
      const editorRect = editorShellRef.current?.getBoundingClientRect();
      const index = current.cards.length;
      const originX = editorRect && stageRect ? editorRect.left - stageRect.left : 0;
      const originY = editorRect && stageRect ? editorRect.top - stageRect.top : 0;
      const card = clampReferenceCardToStage(
        {
          id: `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          sourceType: "idea" as const,
          threadId,
          fragmentId,
          x: originX + 88 + index * 28,
          y: originY + 88 + index * 28,
          width: 320,
          height: 300,
          zIndex: nextReferenceZIndex(current.cards, false),
          collapsed: false,
          pinned: false,
        },
        stageRect?.width ?? 1200,
        stageRect?.height ?? 800,
      );
      return { ...current, version: 3, cards: [...current.cards, card] };
    });
  };

  const reorderFragment = (
    threadId: string,
    fragmentId: string,
    targetFragmentId: string,
    position: "before" | "after",
  ) => {
    if (fragmentId === targetFragmentId) return;
    const thread = snippets.find((item) => item.id === threadId);
    const originalIndex = thread?.fragments.findIndex((item) => item.id === fragmentId) ?? -1;
    const moving = originalIndex >= 0 ? thread?.fragments[originalIndex] : null;
    if (!thread || !moving) return;

    const withoutMoving = thread.fragments.filter((fragment) => fragment.id !== fragmentId);
    const targetIndex = withoutMoving.findIndex((fragment) => fragment.id === targetFragmentId);
    if (targetIndex < 0) return;

    const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    const fragments = [...withoutMoving];
    fragments.splice(insertIndex, 0, moving);
    const orderChanged = fragments.some(
      (fragment, index) => fragment.id !== thread.fragments[index]?.id,
    );
    if (!orderChanged) return;

    patchThread(threadId, (current) => ({ ...current, fragments }));
    showToast("並び順を変更しました", {
      label: "元に戻す",
      onClick: () => {
        patchThread(threadId, (current) => {
          const currentIndex = current.fragments.findIndex((item) => item.id === fragmentId);
          if (currentIndex < 0) return current;
          const next = [...current.fragments];
          const [currentFragment] = next.splice(currentIndex, 1);
          next.splice(Math.min(originalIndex, next.length), 0, currentFragment);
          return { ...current, fragments: next };
        });
        showToast("並び替えを元に戻しました");
      },
    });
  };

  const requestNewIdeaThreadName = async (): Promise<string | null> => {
    const value = await new Promise<string | null>((resolve) => {
      setAppDialog({
        type: "input",
        title: "新規スレッドに追加",
        label: "スレッド名",
        value: "",
        placeholder: "新しいスレッド名",
        confirmLabel: "作成",
        error: "",
        resolve,
      });
    });
    const title = value?.trim() ?? "";
    return title || null;
  };

  const {
    updateIdeaThreads,
    patchThread,
    handleFragmentDragStart,
    handleFragmentDragEnd,
    blockIdeaDropOnEditor,
    captureFragment,
    addFragment,
    updateFragmentBody,
    deleteFragment,
    moveFragment,
    createIdeaThread,
    moveFragmentToNewThread,
    moveReferenceToNewThread,
    renameIdeaThread,
    toggleThreadStar,
    deleteIdeaThread,
    receiveCanvasCopyToIdea,
    receiveCanvasFocusIdea,
  } = createIdeaThreadActions({
    snippets,
    referenceLayout,
    setAppState,
    setReferenceLayout,
    setDraggingId,
    setIdeaFocusRequest,
    setRightSidebarTab,
    setIsRightSidebarCollapsed,
    showToast,
    requestConfirm,
    requestNewIdeaThreadName,
  });

  const insertFragmentToEditor = (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    if (insertParagraph(fragment.body)) {
      markFragmentUsed(threadId, fragmentId, true);
      showToast("本文へ挿入しました");
    }
  };

  const insertThreadToEditor = (threadId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    if (!thread) return;
    const pending = thread.fragments.filter((fragment) => !fragment.used);
    if (pending.length === 0) {
      showToast("未使用の断片がありません");
      return;
    }
    if (insertParagraph(pending.map((fragment) => fragment.body).join("\n"))) {
      const pendingIds = new Set(pending.map((fragment) => fragment.id));
      const now = Date.now();
      patchThread(threadId, (current) => ({
        ...current,
        fragments: current.fragments.map((fragment) =>
          pendingIds.has(fragment.id)
            ? { ...fragment, used: true, updatedAt: now }
            : fragment,
        ),
      }));
      showToast(`${pending.length} 件を本文へ挿入しました`);
    }
  };

  const openCanvasOrigin = (origin: IdeaOriginRef) => {
    void openIdeaCanvasBoard(origin.sourceBoardScope, origin.sourceBoardId, origin.sourceId);
  };

  const sendIdeaFragmentToCanvas = async (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!thread || !fragment) return;
    if (!isTauriRuntime()) {
      showToast("Canvas 送信はTauri版で利用できます");
      return;
    }

    if (!projectFolder) {
      showToast("先にプロジェクトを開いてください");
      return;
    }
    const scope: CanvasScope = "project";
    const rootPath = projectFolder.path;
    try {
      const summary = await ensureCanvasBoard(
        scope,
        rootPath,
        `${projectFolder.name} Board`,
      );
      const board = await loadCanvasBoard(scope, rootPath, summary.id);
      const position = nextCanvasPlacement(board);
      const node = createCanvasTextNode(fragment.body, {
        ...position,
        writingMode: settings.canvasDefaultWritingMode,
        fontSource: settings.canvasDefaultFontSource,
        thenOrigin: {
          source: "idea",
          sourceId: fragment.id,
          sourceThreadId: thread.id,
          sourceWorkspacePath: projectFolder?.path ?? "",
          copiedAt: Date.now(),
        },
      });
      await saveCanvasBoard(scope, rootPath, summary.id, {
        ...board,
        nodes: [...board.nodes, node],
      });
      showToast("Canvas へ送信しました");
      await openIdeaCanvasBoard(scope, summary.id, node.id);
    } catch (error) {
      setLastError(String(error));
      showToast("Canvas へ送信できませんでした");
    }
  };

  const sendIdeaThreadToCanvas = async (threadId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    if (!thread) return;
    if (!isTauriRuntime()) {
      showToast("Canvas 送信はTauri版で利用できます");
      return;
    }

    if (!projectFolder) {
      showToast("先にプロジェクトを開いてください");
      return;
    }
    const scope: CanvasScope = "project";
    const rootPath = projectFolder.path;
    try {
      const summary = await ensureCanvasBoard(
        scope,
        rootPath,
        `${projectFolder.name} Board`,
      );
      const board = await loadCanvasBoard(scope, rootPath, summary.id);
      const position = nextCanvasPlacement(board);
      const copiedAt = Date.now();
      const group = createCanvasGroupNode(thread.title, {
        x: position.x,
        y: position.y,
        width: Math.max(520, thread.fragments.length * 180),
        height: 310,
        thenOrigin: {
          source: "idea",
          sourceId: thread.id,
          sourceThreadId: thread.id,
          sourceWorkspacePath: projectFolder?.path ?? "",
          copiedAt,
        },
      });
      const nodes: CanvasNode[] = thread.fragments.map((fragment, index) =>
        createCanvasTextNode(fragment.body, {
          x: group.x + 28 + index * 210,
          y: group.y + 72,
          width: 180,
          height: 170,
          writingMode: settings.canvasDefaultWritingMode,
          fontSource: settings.canvasDefaultFontSource,
          thenOrigin: {
            source: "idea",
            sourceId: fragment.id,
            sourceThreadId: thread.id,
            sourceWorkspacePath: projectFolder?.path ?? "",
            copiedAt,
          },
        }),
      );
      const edges = nodes.slice(1).map((node, index) => createCanvasEdge(nodes[index].id, node.id));
      await saveCanvasBoard(scope, rootPath, summary.id, {
        ...board,
        nodes: [...board.nodes, group, ...nodes],
        edges: [...board.edges, ...edges],
      });
      showToast("Thread を Canvas へ送信しました");
      await openIdeaCanvasBoard(scope, summary.id, group.id);
    } catch (error) {
      setLastError(String(error));
      showToast("Thread を Canvas へ送信できませんでした");
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlistenCopy: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    void listen<CanvasCopyToIdeaRequest>("then-canvas-copy-to-idea", (event) => {
      receiveCanvasCopyToIdea(event.payload);
    }).then((unlisten) => {
      unlistenCopy = unlisten;
    });

    void listen<CanvasFocusIdeaRequest>("then-canvas-focus-idea", (event) => {
      receiveCanvasFocusIdea(event.payload);
    }).then((unlisten) => {
      unlistenFocus = unlisten;
    });

    let unlistenCopyToPlot: (() => void) | null = null;
    void listen<CanvasCopyToPlotRequest>("then-canvas-copy-to-plot", (event) => {
      const items = event.payload.items.filter((item) => item.text.trim().length > 0);
      if (items.length === 0) return;

      const stamp = Date.now().toString(36);
      setPlotCards((current) =>
        renumberPlotCards([
          ...current,
          ...items.map((item, index) => {
            // 複数行のカードは1行目をタイトル、残りを本文に。1行だけなら本文のみ。
            const lines = item.text.trim().split("\n");
            const [firstLine, ...rest] = lines;
            const title = lines.length > 1 ? firstLine.trim() : "";
            const body = lines.length > 1 ? rest.join("\n").trim() : firstLine.trim();
            return {
              id: `plot-${stamp}-${index}`,
              kind: "section" as const,
              num: "",
              title,
              body,
              expanded: false,
              managerCollapsed: false,
            };
          }),
        ]),
      );
      setRightSidebarTab("plot");
      setIsRightSidebarCollapsed(false);
      showToast(`${items.length} 件をプロットへ追加しました`);
    }).then((unlisten) => {
      unlistenCopyToPlot = unlisten;
    });

    return () => {
      unlistenCopy?.();
      unlistenFocus?.();
      unlistenCopyToPlot?.();
    };
  }, []);

  const updateSettings = <Key extends keyof EditorSettings>(
    key: Key,
    value: EditorSettings[Key],
  ) => {
    setAppState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [key]: value,
      },
    }));
  };

  const handleContinueFromPortal = async () => {
    if (!appState.lastWorkspacePath) return;
    setStartupView("loading");
    const restored = await restoreWorkspaceFromState(appState);
    if (restored === "outsideLibrary") {
      setStartupView("portal");
      await handleOpenWorkspaceFromPortal(appState.lastWorkspacePath);
      return;
    }
    setStartupView(restored ? "editor" : "portal");
  };

  const loadDefaultLibraryParent = useCallback(
    () => invoke<string>("default_library_parent"),
    [],
  );
  const pickFolderWithTitle = useCallback(
    (title: string, defaultPath?: string) =>
      invoke<string | null>("pick_folder_dialog", { title, defaultPath: defaultPath ?? null }),
    [],
  );
  const closeLibrarySetup = () => {
    setLibrarySetupRequest(null);
    setIsLibrarySetupDismissed(true);
  };
  const handleLibrarySetupImported = (
    sourcePath: string,
    report: ProjectImportReport,
    libraryName: string,
  ) => {
    setAppState((current) =>
      recordImportedProject(current, sourcePath, report.projectPath, report.name, libraryName),
    );
  };
  const openLibraryFromSetup = async (libraryPath: string) => {
    closeLibrarySetup();
    const opened = await openWorkspace(libraryPath);
    if (opened) setStartupView("editor");
  };
  const handleOpenExistingLibraryFromSetup = async (): Promise<string | null> => {
    const picked = await pickFolderWithTitle("ライブラリのフォルダを選ぶ");
    if (!picked) return null;
    const inspection = await invoke<FolderInspection>("inspect_workspace_folder", {
      folderPath: picked,
    });
    if (inspection.kind !== "library") {
      return `「${inspection.name}」はライブラリではありません。ライブラリのフォルダを選んでください。`;
    }
    await openLibraryFromSetup(picked);
    return null;
  };

  // 廃止した共通キャンバス・共通資料を起動時に消しきれなかったら、使用中のファイルを閉じてもらう。
  const didCheckDeprecatedContentPurgeRef = useRef(false);
  useEffect(() => {
    if (startupView === "loading" || didCheckDeprecatedContentPurgeRef.current) return;
    if (!isTauriRuntime()) return;
    didCheckDeprecatedContentPurgeRef.current = true;
    type PurgeFailure = { paths: string[]; error: string };
    const describe = (failure: PurgeFailure) => {
      const shown = failure.paths.slice(0, 5);
      const rest = failure.paths.length - shown.length;
      return [
        ...shown,
        ...(rest > 0 ? [`ほか ${rest} 件`] : []),
        ...(shown.length ? [] : [failure.error]),
        "",
        "「あとで」を選んだ場合は、次回の起動時にもう一度削除します。",
      ].join("\n");
    };
    void (async () => {
      let failure = await invoke<PurgeFailure | null>("deprecated_content_purge_failure");
      while (failure) {
        const choice = await requestChoice({
          title: "古い共通データを削除できませんでした",
          message:
            "廃止した共通キャンバス・共通資料の一部が使用中のため削除できませんでした。次のファイルを開いているアプリを閉じてから「再試行」を押してください。",
          detail: describe(failure),
          primaryLabel: "再試行",
          secondaryLabel: "あとで",
        });
        if (choice !== "primary") return;
        failure = await invoke<PurgeFailure | null>("retry_deprecated_content_purge");
        if (!failure) showToast("古い共通データを削除しました");
      }
    })();
  }, [startupView]);

  // 前回が閉じずに終わったときに残った、保存されていない編集。原稿は自動では書き換えず、
  // 確かめてもらってから戻す。外部で変わった原稿には触らず、チェックポイントに入れる。
  const [recoveryItems, setRecoveryItems] = useState<RecoveryItem[]>([]);
  const didScanRecoveryRef = useRef(false);
  const recoveryPromptOpenRef = useRef(false);
  useEffect(() => {
    if (startupView === "loading" || didScanRecoveryRef.current || !isTauriRuntime()) return;
    didScanRecoveryRef.current = true;
    scanRecovery().then(setRecoveryItems, (error) => setLastError(String(error)));
  }, [startupView]);

  const restoreRecoveredText = async (item: RecoveryItem): Promise<boolean> => {
    const destination = recoveryDestination(item);
    const existing = item.path
      ? openTabsRef.current.find((tab) => tab.path && isSamePath(tab.path, item.path!))
      : undefined;
    if (destination === "checkpoint") {
      if (!projectFolder || !canWritePortableProjectState(projectFolder.path)) return false;
      if (!(await waitForPortableProjectWrite(projectFolder.path))) return false;
      const now = new Date();
      const snapshot = buildManuscriptSnapshot(
        `${getWorkspaceName(item.path!)} ${now.toLocaleDateString("ja-JP")} ${now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`,
        "",
        "manual",
        currentWorkspaceSnapshots[0] ? [currentWorkspaceSnapshots[0].id] : [],
        { path: item.path!, markdown: item.content },
      );
      beginPortableProjectMutation(projectFolder.path);
      const stored = await invoke<CheckpointLoadResult>("create_project_checkpoint", {
        rootPath: projectFolder.path,
        snapshot,
      });
      if (!applyCheckpointStoreResult(projectFolder.path, stored)) return false;
      if (stored.warnings.length) {
        showToast(checkpointWarningMessage(stored.warnings[0]));
        return false;
      }
      showToast("チェックポイントに保存しました", { label: "見る", onClick: () => openCheckpointStudio(snapshot.id) });
      return true;
    }
    if (destination === "scratch" || (existing && isDirtyDocumentTab(existing))) {
      // 開いている原稿の編集を上書きしないよう、別のタブに出す。
      const tab = createScratchDocumentTab(item.content, {
        name: item.path ? getWorkspaceName(item.path) : scratchFileName,
      });
      setOpenTabs((current) => insertTabAfter(current, tab, activeTabIdRef.current));
      syncDocumentTabToEditor(tab);
      setStartupView("editor");
      return true;
    }
    const document = await invoke<TextDocument>("read_text_file", { path: item.path });
    const tab: DocumentTab = {
      ...(existing ?? createFileDocumentTab(document)),
      fileId: document.fileId ?? null,
      contentHash: document.contentHash ?? null,
      markdown: item.content,
      savedMarkdown: document.content,
      editorRevision: null,
      saveStatus: "dirty",
    };
    // この実行の記録に入ってから、前回の記録を消す。
    await recordRestoredText(tab.id, document.path, document.content, item.content);
    setOpenTabs((current) =>
      existing
        ? current.map((candidate) => (candidate.id === tab.id ? tab : candidate))
        : insertTabAfter(current, tab, activeTabIdRef.current),
    );
    syncDocumentTabToEditor(tab);
    setStartupView("editor");
    return true;
  };

  useEffect(() => {
    if (appDialog || recoveryPromptOpenRef.current || startupView === "loading") return;
    // チェックポイントに入れるものは、その原稿の作品を開いたときに尋ねる。
    const item = recoveryItems.find(
      (candidate) =>
        recoveryDestination(candidate) !== "checkpoint" ||
        (projectFolder && candidate.path && isPathInsideFolder(candidate.path, projectFolder.path)),
    );
    if (!item) return;
    recoveryPromptOpenRef.current = true;
    const primaryLabel = {
      tab: "未保存の変更として開く",
      checkpoint: "チェックポイントに保存",
      scratch: "新しいタブで開く",
    }[recoveryDestination(item)];
    void (async () => {
      try {
        const choice = await requestChoice({
          title: "保存されていない編集が残っています",
          message: item.path ? `「${getWorkspaceName(item.path)}」` : "",
          detail: item.path ?? undefined,
          primaryLabel,
          secondaryLabel: "破棄",
        });
        if (choice === null) return;
        if (choice === "primary" && !(await restoreRecoveredText(item))) return;
        await discardRecovery(item.id);
      } catch (error) {
        setLastError(String(error));
        showToast(error instanceof Error ? error.message : String(error));
      } finally {
        // 閉じただけ・失敗したものは記録が残り、次の起動でまた尋ねる。
        setRecoveryItems((current) => current.filter((candidate) => candidate.id !== item.id));
        recoveryPromptOpenRef.current = false;
      }
    })();
  }, [appDialog, projectFolder, recoveryItems, startupView]);

  // ライブラリをまだ持っていなければ、起動画面の前にライブラリの準備画面を出す。
  useEffect(() => {
    if (startupView !== "portal" || hasKnownLibrary || isLibrarySetupDismissed) return;
    if (librarySetupRequest || !isTauriRuntime()) return;
    openLibrarySetup();
  }, [hasKnownLibrary, isLibrarySetupDismissed, librarySetupRequest, openLibrarySetup, startupView]);

  const handleOpenWorkspaceFromPortal = async (path?: string) => {
    setWorkspaceAlert(null);
    const opened = await openWorkspace(path);
    if (opened) setStartupView("editor");
  };

  const handleNewDocumentFromPortal = () => {
    setStartupView("editor");
    void handleNewDocument();
  };

  const handleClearWorkspaceHistory = () => {
    setAppState((current) => ({
      ...current,
      lastWorkspacePath: null,
      lastFilePath: null,
      recentWorkspaces: [],
    }));
    setWorkspaceAlert(null);
  };

  const handleFolderCollapsedChange = (path: string, collapsed: boolean) => {
    if (!projectFolder) return;
    const workspacePath = projectFolder.path;
    setAppState((current) => {
      const currentPaths = new Set(
        current.collapsedFolderPathsByWorkspace[workspacePath] ?? [],
      );
      if (collapsed) {
        currentPaths.add(path);
      } else {
        currentPaths.delete(path);
      }
      return {
        ...current,
        collapsedFolderPathsByWorkspace: {
          ...current.collapsedFolderPathsByWorkspace,
          [workspacePath]: Array.from(currentPaths),
        },
      };
    });
  };

  const handleOutlineCollapsedChange = (path: string, collapsed: boolean) => {
    if (!projectFolder) return;
    const workspacePath = projectFolder.path;
    setAppState((current) => {
      const currentPaths = new Set(
        current.collapsedOutlinePathsByWorkspace[workspacePath] ?? [],
      );
      if (collapsed) {
        currentPaths.add(path);
      } else {
        currentPaths.delete(path);
      }
      return {
        ...current,
        collapsedOutlinePathsByWorkspace: {
          ...current.collapsedOutlinePathsByWorkspace,
          [workspacePath]: Array.from(currentPaths),
        },
      };
    });
  };

  const handleOutlineHeadingCollapsedChange = (key: string, collapsed: boolean) => {
    if (!projectFolder) return;
    const workspacePath = projectFolder.path;
    setAppState((current) => {
      const currentKeys = new Set(
        current.collapsedOutlineHeadingKeysByWorkspace[workspacePath] ?? [],
      );
      if (collapsed) {
        currentKeys.add(key);
      } else {
        currentKeys.delete(key);
      }
      return {
        ...current,
        collapsedOutlineHeadingKeysByWorkspace: {
          ...current.collapsedOutlineHeadingKeysByWorkspace,
          [workspacePath]: Array.from(currentKeys),
        },
      };
    });
  };

  const handleSetFileProgress = (path: string, status: FileProgressStatus) => {
    if (!projectFolder) return;
    if (!isTauriRuntime()) {
      setAppState((current) => {
        const next = { ...current.fileProgress };
        if (status === "todo") delete next[path];
        else next[path] = status;
        return { ...current, fileProgress: next };
      });
      return;
    }
    const rootPath = projectFolder.path;
    if (!canWritePortableProjectState(rootPath)) return;
    const key = portableProjectKey(rootPath);
    const pendingRefresh = portableProjectRefreshesRef.current.get(key);
    const operation = fileProgressSaveQueueRef.current
      .catch(() => undefined)
      .then(() => pendingRefresh?.catch(() => undefined))
      .then(async () => {
        const expected = fileProgressStoreVersionsRef.current.get(key);
        const saved = await invoke<ProjectFileProgressState>("set_project_file_progress", {
          rootPath,
          path,
          status,
          expectedRevision: expected?.revision ?? null,
          expectedContentHash: expected?.contentHash || null,
        });
        fileProgressStoreVersionsRef.current.set(key, {
          revision: saved.revision,
          contentHash: saved.contentHash,
        });
        setAppState((current) => ({
          ...current,
          fileProgress: replaceWorkspaceFileProgress(
            current.fileProgress,
            rootPath,
            normalizeFileProgress(saved.fileProgress),
          ),
          fileProgressMigrationVersions: markFileProgressMigration(
            current.fileProgressMigrationVersions,
            rootPath,
          ),
        }));
        if (saved.rebased) {
          showToast("同期された最新状態へ進捗変更を再適用しました");
        }
      });
    fileProgressSaveQueueRef.current = operation;
    void operation.catch((error) => {
      const message = portableStorageErrorMessage(error);
      portableProjectConflictsRef.current.set(portableProjectKey(rootPath), message);
      setLastError(`${message} ${String(error)}`);
      showToast(message);
    });
  };

  const handleSnippetStorageModeChange = async (
    mode: EditorSettings["snippetStorageMode"],
  ) => {
    if (mode === settings.snippetStorageMode) return;
    const confirmed = await requestConfirm({
      title: "Ideaの管理単位を切り替え",
      message:
        mode === "profile"
          ? "右サイドバーの Idea を、全作品で共有する Idea に切り替えますか？"
          : "右サイドバーの Idea を、作品ごとの Idea に切り替えますか？",
      confirmLabel: mode === "profile" ? "共有の Idea に切り替える" : "作品ごとの Idea に切り替える",
    });
    if (!confirmed) return;

    // 作品の Idea は0.7秒遅れて保存する。切り替えるとその保存が取り消されるので、先に書き終える。
    if (
      projectFolder
      && settings.snippetStorageMode === "workspace"
      && snippetWorkspacePath === projectFolder.path
    ) {
      try {
        await saveWorkspaceSnippets(projectFolder.path, snippets);
      } catch (error) {
        setLastError(String(error));
        showToast("Idea を保存できなかったため、管理単位を切り替えませんでした");
        return;
      }
    }

    updateSettings("snippetStorageMode", mode);
    if (!projectFolder) return;
    // 並び順と Idea カードを切り替え先の側に合わせる。Idea の組を入れ替えるのと同じ描画で
    // 合わせないと、整合処理が今の並び順を新しい組に合わせて崩してしまう。
    const alignReferenceLayout = () => {
      if (referenceLayoutLoadedRootRef.current !== projectFolder.path) return;
      setReferenceLayout((current) => alignIdeaLayoutToMode(current, mode));
    };

    if (mode === "workspace") {
      try {
        const workspaceSnippets = await loadWorkspaceSnippets(projectFolder.path);
        setSnippetWorkspacePath(projectFolder.path);
        alignReferenceLayout();
        setAppState((current) => ({ ...current, snippets: workspaceSnippets }));
      } catch (error) {
        setLastError(String(error));
      }
      return;
    }

    const profileState = normalizeState(
      isTauriRuntime()
        ? await invoke<AppState | null>("load_app_state")
        : JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
    setSnippetWorkspacePath(null);
    alignReferenceLayout();
    setAppState((current) => ({ ...current, snippets: profileState.profileSnippets }));
  };

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
          setIsOutlineMenuOpen(false);
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

  return (
      <main
        ref={appShellRef}
        className="appShell"
        data-shell-app-mode={appMode}
        data-theme={settings.theme}
        data-writing-mode={settings.writingMode}
        data-zone-mode={settings.sidebarHoverMode !== "none" ? "true" : undefined}
        data-zone-left={
          settings.sidebarHoverMode === "both" || settings.sidebarHoverMode === "left"
            ? "true"
            : undefined
        }
        data-zone-right={
          settings.sidebarHoverMode === "both" || settings.sidebarHoverMode === "right"
            ? "true"
            : undefined
        }
        data-startup-view={startupView}
        data-native-window={isTauriRuntime() ? "true" : undefined}
        style={
          {
            "--editor-font-family": withIdeographicSpaceFont(editorFontFamily),
            "--ui-font-family": settings.uiFontFamily,
            "--plot-font-family":
              settings.plotFontSource === "ui"
                ? settings.uiFontFamily
                : withIdeographicSpaceFont(settings.editorFontFamily),
            "--start-page-font-family":
              settings.startPageFontSource === "editor"
                ? withIdeographicSpaceFont(settings.editorFontFamily)
                : settings.uiFontFamily,
            "--ui-font-scale": settings.uiFontScale,
            "--editor-font-size": `${settings.fontSize}px`,
            "--editor-line-height": settings.lineHeight,
            // 編集領域に対する比率（0〜1）。CSS 側で実寸に乗算する。
            "--editor-measure-h-ratio": settings.editorMeasureHorizontal / 100,
            "--editor-measure-v-ratio": settings.editorMeasureVertical / 100,
            "--editor-heading-font-family": withIdeographicSpaceFont(editorHeadingFontFamily),
            "--typewriter-guide-position": `${settings.typewriterOffset}%`,
            "--zone-sidebar-opacity": settings.zoneModeOpacity,
          } as React.CSSProperties
        }
      >
        <WindowControls />
        {librarySetupRequest && (
          <LibrarySetup
            key={librarySetupRequest.id}
            candidates={librarySetupRequest.candidates}
            loadDefaultParent={loadDefaultLibraryParent}
            pickFolder={pickFolderWithTitle}
            inspectFolder={(folderPath) =>
              invoke<FolderInspection>("inspect_workspace_folder", { folderPath })
            }
            createLibrary={(parentPath, name) =>
              invoke<string>("create_library_folder", { parentPath, name })
            }
            importProject={(sourcePath, libraryPath) =>
              invoke<ProjectImportReport>("import_project_into_library", { sourcePath, libraryPath })
            }
            onImported={handleLibrarySetupImported}
            onOpenLibrary={(result: LibrarySetupResult) => void openLibraryFromSetup(result.libraryPath)}
            onOpenExistingLibrary={handleOpenExistingLibraryFromSetup}
            onLater={closeLibrarySetup}
          />
        )}
        {startupView === "loading" ? (
          <div className="startupPortalLoading" role="status" data-tauri-drag-region="deep">
            Then を読み込んでいます…
          </div>
        ) : startupView === "portal" ? (
          <>
          {/* 起動画面から開いたフォルダでも、取り込みなどの確認ダイアログを出す。 */}
          {appDialog && (
            <div className="portalDialogLayer">
              <AppDialogModal
                dialog={appDialog}
                onClose={closeAppDialog}
                onSubmit={submitAppDialog}
                onValueChange={updateAppDialogValue}
                onFieldValueChange={updateAppDialogFieldValue}
                onChoice={chooseAppDialog}
                onOption={chooseAppDialogOption}
              />
            </div>
          )}
          <StartupPortal
            recentWorkspaces={appState.recentWorkspaces}
            lastWorkspacePath={appState.lastWorkspacePath}
            skipStartupPortal={settings.skipStartupPortal}
            workspaceAlert={workspaceAlert}
            onContinue={() => void handleContinueFromPortal()}
            onNewDocument={handleNewDocumentFromPortal}
            onOpenFolder={() => void handleOpenWorkspaceFromPortal()}
            onOpenWorkspace={(path) => void handleOpenWorkspaceFromPortal(path)}
            onClearHistory={handleClearWorkspaceHistory}
            onSkipStartupPortalChange={(value) => updateSettings("skipStartupPortal", value)}
            onOpenSettings={() => {
              setStartupView("editor");
              setIsSettingsModalOpen(true);
            }}
          />
          </>
        ) : (
          <section
            className="appFrame"
            aria-label="Then"
            data-app-mode={appMode}
            data-editor-focus={isEditorFocusMode ? "true" : undefined}
            data-document-tabs={
              settings.showDocumentTabs && appMode === "write" && !isEditorFocusMode
                ? settings.documentTabsDisplayMode
                : undefined
            }
          >
          <header className="topbar" data-tauri-drag-region="deep">
            <div
              className="fileMenu"
              ref={fileMenuRef}
              aria-hidden={isEditorFocusMode}
              {...(isEditorFocusMode ? { inert: "" } : {})}
            >
              <button
                className="menuButton"
                type="button"
                aria-label="ファイルメニュー"
                aria-expanded={isFileMenuOpen}
                onClick={() => setIsFileMenuOpen((isOpen) => !isOpen)}
              >
                <AppIcon name="menu" className="topbarSvgIcon" />
              </button>
              {isFileMenuOpen && (
                <div className="menuPopover fileMenuPopover" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleNewDocument)}
                  >
                    新規ファイル
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleOpenTextFile)}
                  >
                    ファイルを開く
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(saveCurrentDocument)}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleSaveAs)}
                  >
                    別名で保存
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleRegisterCurrentFileAsTemplate)}
                  >
                    このファイルをテンプレートとして登録…
                  </button>
                  <div className="menuDivider" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={appMode !== "write"}
                    onClick={() => closeFileMenuAndRun(() => openManuscriptTidy(getCurrentEditorSelection()))}
                  >
                    原稿を整える…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleOpenLinkedExport)}
                  >
                    エクスポート…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleOpenProjectFolder)}
                  >
                    フォルダを開く
                  </button>
                </div>
              )}
            </div>
            {isLeftSidebarCollapsed && appMode === "write" && (
              <button
                className="iconButton"
                type="button"
                aria-label="左サイドバーを表示"
                aria-hidden={isEditorFocusMode}
                tabIndex={isEditorFocusMode ? -1 : 0}
                title="左サイドバーを表示"
                onClick={() => setIsLeftSidebarCollapsed(false)}
              >
                <AppIcon name="panelLeft" className="topbarSvgIcon" />
              </button>
            )}
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
                          {index === 0 && isWorkspaceSwitcherOpen && (
                            <div className="menuPopover workspaceSwitcherPopover" role="menu">
                              <div className="workspaceSwitcherHeader">
                                <span className="workspaceSwitcherTitle">{scopeDisplayName(projectFolder)}</span>
                                {settings.showWorkspacePaths && (
                                  <span className="workspaceSwitcherPath">{projectFolder.path}</span>
                                )}
                              </div>
                              <label className="workspaceSwitcherSearch">
                                <span aria-hidden="true">⌕</span>
                                <input
                                  value={workspaceSwitcherQuery}
                                  onChange={(event) =>
                                    setWorkspaceSwitcherQuery(event.target.value)
                                  }
                                  placeholder="プロジェクトを検索"
                                  type="search"
                                />
                              </label>
                              <span className="workspaceSwitcherSectionLabel">
                                現在のプロジェクト
                              </span>
                              <div className="workspaceFolderTree">
                                {renderWorkspaceFolderTree(projectFolder)}
                              </div>
                              <div className="menuDivider" role="separator" />
                              <span className="workspaceSwitcherSectionLabel">
                                最近開いたプロジェクト
                              </span>
                              <div className="workspaceSwitcherList">
                                {visibleRecentWorkspaces.length ? (
                                  visibleRecentWorkspaces.map((workspace) => {
                                    const isActive = workspace.path === projectFolder.path;
                                    return (
                                      <button
                                        key={workspace.path}
                                        className={
                                          isActive
                                            ? "workspaceRecordButton activeMenuItem"
                                            : "workspaceRecordButton"
                                        }
                                        type="button"
                                        role="menuitem"
                                        onClick={() =>
                                          closeBreadcrumbMenuAndRun(() =>
                                            isActive ? undefined : void openWorkspace(workspace.path),
                                          )
                                        }
                                      >
                                        <AppIcon name="folder" className="menuSvgIcon" />
                                        <span className="workspaceRecordText">
                                          <span className="workspaceRecordName">
                                            {workspace.name}
                                          </span>
                                          {settings.showWorkspacePaths && (
                                            <span className="workspaceRecordPath">
                                              {workspace.path}
                                            </span>
                                          )}
                                        </span>
                                        {isActive && (
                                          <span className="workspaceRecordBadge">現在</span>
                                        )}
                                      </button>
                                    );
                                  })
                                ) : (
                                  <span className="emptyMenuMessage">
                                    一致するプロジェクトがありません
                                  </span>
                                )}
                              </div>
                              <div className="menuDivider" role="separator" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  closeBreadcrumbMenuAndRun(() => void openWorkspace())
                                }
                              >
                                <AppIcon name="folder" className="menuSvgIcon" />
                                <span>別のフォルダを開く...</span>
                              </button>
                            </div>
                          )}
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
                  {isWorkspaceSwitcherOpen && (
                    <div className="menuPopover workspaceSwitcherPopover" role="menu">
                      <div className="workspaceSwitcherHeader">
                        <span className="workspaceSwitcherTitle">{scratchWorkspaceName}</span>
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
                      <span className="workspaceSwitcherSectionLabel">
                        最近開いたプロジェクト
                      </span>
                      <div className="workspaceSwitcherList">
                        {visibleRecentWorkspaces.length ? (
                          visibleRecentWorkspaces.map((workspace) => (
                            <button
                              key={workspace.path}
                              className="workspaceRecordButton"
                              type="button"
                              role="menuitem"
                              onClick={() =>
                                closeBreadcrumbMenuAndRun(() => void openWorkspace(workspace.path))
                              }
                            >
                              <AppIcon name="folder" className="menuSvgIcon" />
                              <span className="workspaceRecordText">
                                <span className="workspaceRecordName">{workspace.name}</span>
                                {settings.showWorkspacePaths && (
                                  <span className="workspaceRecordPath">{workspace.path}</span>
                                )}
                              </span>
                            </button>
                          ))
                        ) : (
                          <span className="emptyMenuMessage">
                            一致するプロジェクトがありません
                          </span>
                        )}
                      </div>
                      {visibleKnownLibraries.length > 0 && (
                        <>
                          <div className="menuDivider" role="separator" />
                          <span className="workspaceSwitcherSectionLabel">ライブラリ</span>
                          <div className="workspaceSwitcherList">
                            {visibleKnownLibraries.map((library) => (
                              <button
                                key={library.path}
                                className="workspaceRecordButton"
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  closeBreadcrumbMenuAndRun(() => void openWorkspace(library.path))
                                }
                              >
                                <AppIcon name="book" className="menuSvgIcon" />
                                <span className="workspaceRecordText">
                                  <span className="workspaceRecordName">{library.name}</span>
                                  {settings.showWorkspacePaths && (
                                    <span className="workspaceRecordPath">{library.path}</span>
                                  )}
                                </span>
                              </button>
                            ))}
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
                  )}
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
                          aria-expanded={isOutlineMenuOpen}
                          onClick={() => setIsOutlineMenuOpen((isOpen) => !isOpen)}
                        >
                          <span>{item.title}</span>
                        </button>
                        {isOutlineMenuOpen && index === activeOutlineChain.length - 1 && (
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
            <div
              className="topbarActions"
              aria-hidden={isEditorFocusMode}
              {...(isEditorFocusMode ? { inert: "" } : {})}
            >
              {appMode === "write" && (
                <button
                  className={`iconButton editorFocusModeButton ${
                    isEditorFocusMode ? "activeIconButton" : ""
                  }`}
                  type="button"
                  aria-label={
                    settings.focusModeUsesNativeFullscreen
                      ? "エディタを完全フルスクリーン表示"
                      : "エディタをフルスクリーン表示"
                  }
                  aria-pressed={isEditorFocusMode}
                  title={
                    settings.focusModeUsesNativeFullscreen
                      ? "エディタを完全フルスクリーン表示"
                      : "エディタをフルスクリーン表示"
                  }
                  onClick={toggleEditorFocusMode}
                >
                  <AppIcon name="fullscreen" className="topbarSvgIcon" />
                </button>
              )}
              {isRightSidebarCollapsed && (appMode === "write" || appMode === "canvas") && (
                <button
                  className="iconButton"
                  type="button"
                  aria-label="右サイドバーを表示"
                  title="右サイドバーを表示"
                  onClick={() => setIsRightSidebarCollapsed(false)}
                >
                  <AppIcon name="panelRight" className="topbarSvgIcon" />
                </button>
              )}
              {projectFolder && appMode !== "checkpoint" && (
                <button
                  className="iconButton"
                  type="button"
                  aria-label="今の状態を保存点にする（Ctrl+Shift+S）"
                  title="今の状態を保存点にする（Ctrl+Shift+S）"
                  onClick={() => void handleQuickCreateManuscriptSnapshot()}
                >
                  <AppIcon name="checkpointAdd" className="topbarSvgIcon" />
                </button>
              )}
              <button
                className={`iconButton ${settings.writingMode === "horizontal-tb" ? "activeIconButton" : ""}`}
                type="button"
                aria-label={settings.writingMode === "horizontal-tb" ? "縦書きに切り替え" : "横書きに切り替え"}
                title={settings.writingMode === "horizontal-tb" ? "縦書きに切り替え" : "横書きに切り替え"}
                onClick={() =>
                  updateSettings(
                    "writingMode",
                    settings.writingMode === "horizontal-tb" ? "vertical-rl" : "horizontal-tb",
                  )
                }
              >
                <AppIcon
                  name={settings.writingMode === "horizontal-tb" ? "horizontal" : "vertical"}
                  className="topbarSvgIcon"
                />
              </button>
              <button
                className="iconButton"
                type="button"
                aria-label="テーマを選択"
                title="テーマを選択"
                onClick={() => {
                  setShouldReturnToSettingsAfterThemePicker(false);
                  setIsThemePickerModalOpen(true);
                }}
              >
                <AppIcon name="theme" className="topbarSvgIcon" />
              </button>
              <button
                className="iconButton"
                type="button"
                aria-label="設定"
                title="設定"
                onClick={() => setIsSettingsModalOpen(true)}
              >
                <AppIcon name="settings" className="topbarSvgIcon" />
              </button>
              <div className="modeMenu" ref={modeMenuRef}>
                <button
                  ref={modeMenuButtonRef}
                  className="modeMenuButton"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isModeMenuOpen}
                  aria-label={`画面モード：${activeModeMenuEntry?.label ?? ""}`}
                  title="画面モードを切り替え"
                  onClick={() => setIsModeMenuOpen((isOpen) => !isOpen)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setIsModeMenuOpen(true);
                    }
                  }}
                >
                  {activeModeMenuEntry?.icon}
                  <span className="modeMenuButtonLabel">{activeModeMenuEntry?.label}</span>
                  <AppIcon name="chevronDown" className="modeMenuChevron" />
                </button>
                {isModeMenuOpen && (
                  <div
                    className="menuPopover modeMenuPopover"
                    role="menu"
                    aria-label="画面モード"
                    onKeyDown={handleModeMenuKeyDown}
                  >
                    {modeMenuEntries.map((entry) => (
                      <button
                        key={entry.key}
                        className={entry.isActive ? "activeMenuItem" : ""}
                        type="button"
                        role="menuitemradio"
                        aria-checked={entry.isActive}
                        title={entry.title}
                        onClick={() => {
                          setIsModeMenuOpen(false);
                          modeMenuButtonRef.current?.focus();
                          entry.select();
                        }}
                      >
                        {entry.icon}
                        <span className="modeMenuItemLabel">{entry.label}</span>
                        {entry.opensInWindow && (
                          <AppIcon
                            name="openExternal"
                            className="modeMenuExternalIcon"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          {settings.showDocumentTabs && appMode === "write" && !isEditorFocusMode && (
            <DocumentTabs
              openTabs={openTabs}
              displayMode={settings.documentTabsDisplayMode}
              activeTabId={activeTabId}
              fileProgress={appState.fileProgress}
              onActivateTab={activateDocumentTab}
              onCloseTabs={(tabIds) => void closeDocumentTabs(tabIds)}
              onMoveTab={moveDocumentTab}
              onNewTab={handleNewTab}
              canReopenClosedTab={closedDocumentTabs.some((record) =>
                isClosedTabInWorkspace(record, projectFolder?.path ?? null),
              )}
              onReopenClosedTab={() => void reopenClosedDocumentTab()}
              onCopyTabPath={(tab) => void copyDocumentTabPath(tab)}
              onRevealTab={revealDocumentTab}
            />
          )}

          <div
            className={`workspace ${appMode === "export" || appMode === "checkpoint" ? "modeHiddenPane" : ""}`}
            ref={workspaceRef}
            data-app-mode={appMode}
          >
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
            <div className={`editorColumn ${
              appMode !== "write" && appMode !== "plugin" ? "modeHiddenPane" : ""
            }`}
              aria-hidden={appMode === "plugin"}
              {...(appMode === "plugin" ? { inert: "" } : {})}
            >
              <div className="editorFrame">
                <button
                  className={`editorFocusExitButton ${isEditorFocusMode ? "isVisible" : ""}`}
                  type="button"
                  aria-label="通常表示に戻す"
                  title="通常表示に戻す (Esc)"
                  aria-hidden={!isEditorFocusMode}
                  tabIndex={isEditorFocusMode ? 0 : -1}
                  onClick={leaveEditorFocusMode}
                >
                  <AppIcon name="fullscreenExit" />
                </button>
                <div
                  ref={editorShellRef}
                  className="editor"
                  onContextMenu={handleEditorContextMenu}
                  onDragOverCapture={blockIdeaDropOnEditor}
                  onDropCapture={blockIdeaDropOnEditor}
                >
                  <div className="editorContent">
                    {workspaceAlert && (
                      <section className="workspaceAlert" role="alert">
                        <div>
                          <strong>{workspaceAlert.message}</strong>
                          <span>{workspaceAlert.path}</span>
                        </div>
                        <div className="workspaceAlertActions">
                          <button type="button" onClick={handleRetryWorkspaceRestore}>
                            再試行
                          </button>
                          <button type="button" onClick={handleOpenProjectFolder}>
                            別のフォルダを選択
                          </button>
                          <button type="button" onClick={handleForgetWorkspace}>
                            履歴から削除
                          </button>
                          <button type="button" onClick={() => setWorkspaceAlert(null)}>
                            閉じる
                          </button>
                        </div>
                      </section>
                    )}
                    {activeTab?.kind === "empty" && libraryContext?.role === "root" ? (
                      <LibraryHome
                        libraryName={libraryContext.name}
                        items={
                          libraryHome?.libraryPath === libraryContext.path
                            ? libraryHome.items
                            : libraryContext.projects.map((project) => ({
                                path: project.path,
                                name: project.name,
                                work: null,
                                stats: null,
                              }))
                        }
                        isLoading={libraryHome?.libraryPath !== libraryContext.path || libraryHome.isLoading}
                        onOpenProject={enterProject}
                        onEditWork={(item) => void editWorkInfo(item.path, item.name, item.work)}
                        onCreateProject={() => void handleCreateLibraryProject()}
                        onRefresh={() => void refreshLibraryHome(libraryContext.path, true)}
                      />
                    ) : activeTab?.kind === "empty" && projectFolder ? (
                      <ScopeStartPage
                        onEditWork={
                          libraryContext?.role === "project" ? () => void editCurrentWorkInfo() : undefined
                        }
                        folder={projectFolder}
                        onOpenFile={(path) => void handleProjectFileSelect(path)}
                        onCreateFile={() => void handleCreateProjectFile(projectFolder.path)}
                        onOpenPlot={() => {
                          setRightSidebarTab("plot");
                          setIsRightSidebarCollapsed(false);
                        }}
                        onOpenCanvas={() => void openIdeaCanvasBoard("project")}
                      />
                    ) : isNewTabStartPage || activeTab?.kind === "empty" ? (
                      <section className="newTabStart" aria-label="新しいタブ">
                        <div>
                          <p className="newTabEyebrow">New tab</p>
                          <h1>フォルダを開いて書き始める</h1>
                          <p>
                            作業するフォルダを選ぶと、テキストファイルとスニペットをこのタブで扱えます。
                          </p>
                        </div>
                        <div className="newTabActions">
                          <button type="button" onClick={handleOpenProjectFolder}>
                            フォルダを開く
                          </button>
                          <button type="button" onClick={handleOpenTextFile}>
                            テキストファイルを開く
                          </button>
                        </div>
                      </section>
                    ) : (
                      <>
                        {isHydrated && (
                          <VerticalTextEditor
                            key={documentKey}
                            text={editorText}
                            editorRevision={activeTab?.editorRevision ?? null}
                            writingMode={settings.writingMode}
                            editorDisplayMode={settings.editorDisplayMode}
                            pageFlowDirection={settings.pageFlowDirection}
                            typewriterScroll={settings.typewriterScroll}
                            showTypewriterGuide={settings.showTypewriterGuide}
                            typewriterOffset={settings.typewriterOffset}
                            showLineBreakMarks={settings.showLineBreakMarks}
                            showLineNumbers={settings.showLineNumbers}
                            highlightCurrentLine={settings.highlightCurrentLine}
                            documentPath={currentFilePath}
                            colorizeJapaneseQuotes={settings.colorizeJapaneseQuotes}
                            showComments={settings.showComments}
                            textLayoutSignature={[
                              settings.editorFontFamily,
                              settings.headingFontSource,
                              settings.headingFontFamily,
                              settings.fontSize,
                              settings.lineHeight,
                              settings.editorMeasureHorizontal,
                              settings.editorMeasureVertical,
                              settings.manuscript.layoutMode,
                              settings.manuscript.charactersPerLine,
                              settings.manuscript.linesPerPage,
                              settings.manuscript.fontSize,
                            ].join("|")}
                            manuscript={settings.manuscript}
                            onManuscriptProgressChange={editorManuscriptProgress.setSnapshot}
                            initialSelectionOffset={initialSelectionOffset}
                            initialViewportState={activeTab?.viewportState ?? null}
                            onViewportSizeChange={handleEditorViewportSizeChange}
                            onReady={handleEditorReady}
                            onTextChange={handleTextChange}
                            onSelectionChange={handleSelectionChange}
                            onPageMetricsChange={setEditorPageMetrics}
                          />
                        )}
                        {editorFind.open && (
                          <section
                            className="editorFindPopover"
                            aria-label="ファイル内検索と置換"
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <div className="editorFindRow">
                              <input
                                ref={editorFindInputRef}
                                value={editorFind.query}
                                type="search"
                                aria-label="検索語句"
                                placeholder="検索"
                                onChange={(event) => handleEditorFindQueryChange(event.target.value)}
                                onKeyDown={handleEditorFindKeyDown}
                              />
                              <span className="editorFindCount">
                                {editorFind.query.trim()
                                  ? editorFindMatches.length
                                    ? `${activeEditorFindIndex + 1}/${editorFindMatches.length}`
                                    : "0/0"
                                  : ""}
                              </span>
                              <button
                                type="button"
                                title="前の一致"
                                aria-label="前の一致"
                                disabled={editorFindMatches.length === 0}
                                onClick={() => moveEditorFindMatch(-1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                title="次の一致"
                                aria-label="次の一致"
                                disabled={editorFindMatches.length === 0}
                                onClick={() => moveEditorFindMatch(1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                title="コメント行も検索・置換の対象にする"
                                aria-label="コメントを含む"
                                aria-pressed={searchIncludeComments}
                                onClick={() => setSearchIncludeComments((current) => !current)}
                              >
                                //
                              </button>
                              <button
                                type="button"
                                title={editorFind.showReplace ? "置換を隠す" : "置換を表示"}
                                aria-label={editorFind.showReplace ? "置換を隠す" : "置換を表示"}
                                aria-pressed={editorFind.showReplace}
                                onClick={() =>
                                  setEditorFind((current) => ({
                                    ...current,
                                    showReplace: !current.showReplace,
                                  }))
                                }
                              >
                                ≡
                              </button>
                              <button
                                type="button"
                                title="閉じる"
                                aria-label="閉じる"
                                onClick={closeEditorFind}
                              >
                                ×
                              </button>
                            </div>
                            {editorFind.showReplace && (
                              <div className="editorFindRow editorReplaceRow">
                                <input
                                  value={editorFind.replaceValue}
                                  aria-label="置換後"
                                  placeholder="置換"
                                  onChange={(event) =>
                                    setEditorFind((current) => ({
                                      ...current,
                                      replaceValue: event.target.value,
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      closeEditorFind();
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={activeEditorFindIndex < 0}
                                  onClick={replaceActiveEditorFindMatch}
                                >
                                  置換
                                </button>
                                <button
                                  type="button"
                                  disabled={editorFindMatches.length === 0}
                                  onClick={replaceAllEditorFindMatches}
                                >
                                  すべて
                                </button>
                              </div>
                            )}
                          </section>
                        )}
                      </>
                    )}
                  </div>
                  {editorContextMenu && (
                    <div
                      ref={editorContextMenuRef}
                      className="editorContextMenu"
                      role="menu"
                      style={getScaledFixedMenuPosition(editorContextMenu.x, editorContextMenu.y, {
                        width: EDITOR_CONTEXT_MENU_WIDTH,
                        height: EDITOR_CONTEXT_MENU_HEIGHT + (
                          pluginSelectionCommands.length > 0
                            ? 31 + pluginSelectionCommands.length * 30
                            : 0
                        ),
                      })}
                    >
                      <div className="contextMenuSection">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={editorContextMenu.from === editorContextMenu.to}
                          onClick={() => void copyEditorSelection(editorContextMenu)}
                        >
                          コピー
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={editorContextMenu.from === editorContextMenu.to}
                          onClick={() => void cutEditorSelection(editorContextMenu)}
                        >
                          切り取り
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void pasteIntoEditorSelection(editorContextMenu)}
                        >
                          貼り付け
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={editorContextMenu.from === editorContextMenu.to}
                          onClick={() => {
                            handTextToAi(editorContextMenu.text);
                            closeEditorContextMenu();
                          }}
                        >
                          AIに渡す
                        </button>
                      </div>
                      <div className="contextMenuDivider" role="separator" />
                      {pluginSelectionCommands.length > 0 && editorContextMenu.from !== editorContextMenu.to && (
                        <>
                          <div className="contextMenuSection">
                            <span className="contextMenuLabel">プラグイン</span>
                            {pluginSelectionCommands.map((command) => (
                              <button
                                type="button"
                                role="menuitem"
                                key={`${command.pluginId}:${command.id}`}
                                onClick={() => {
                                  pluginRuntimeHostRef.current?.executeCommand(
                                    command.pluginId,
                                    command.id,
                                  );
                                  closeEditorContextMenu();
                                }}
                              >
                                {command.title}
                              </button>
                            ))}
                          </div>
                          <div className="contextMenuDivider" role="separator" />
                        </>
                      )}
                      <div className="contextMenuSection">
                        <span className="contextMenuLabel">独自記法</span>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canWrapInlineSelection(editorContextMenu)}
                          title={customNotationSpecs[0].syntax}
                          onClick={() => openRubyNotationModal(editorContextMenu)}
                        >
                          ルビ...
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canWrapInlineSelection(editorContextMenu)}
                          title={customNotationSpecs[1].syntax}
                          onClick={() => {
                            if (applyInlineNotation(editorContextMenu, "tcy")) {
                              closeEditorContextMenu();
                            }
                          }}
                        >
                          縦中横
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canWrapInlineSelection(editorContextMenu)}
                          title={customNotationSpecs[2].syntax}
                          onClick={() => {
                            if (applyInlineNotation(editorContextMenu, "emphasis")) {
                              closeEditorContextMenu();
                            }
                          }}
                        >
                          圏点
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          title="選択範囲または行の独自記法を外します"
                          onClick={() => clearSelectionNotation(editorContextMenu)}
                        >
                          記法をクリア
                        </button>
                      </div>
                      <div className="contextMenuDivider" role="separator" />
                      <div className="contextMenuSection">
                        <span className="contextMenuLabel">行指示</span>
                        <button
                          type="button"
                          role="menuitem"
                          title={customNotationSpecs[3].syntax}
                          onClick={() => openDirectionNotationModal(editorContextMenu)}
                        >
                          文章方向...
                        </button>
                      </div>
                      <div className="contextMenuDivider" role="separator" />
                      <div className="contextMenuSection">
                        <span className="contextMenuLabel">整形</span>
                        <button
                          type="button"
                          role="menuitem"
                          title="段落頭の字下げと「！」「？」のあとの空きを入れます"
                          onClick={() => openManuscriptTidy(editorContextMenu)}
                        >
                          原稿を整える...
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <StatusBar
                saveStatus={saveStatus}
                currentFilePath={currentFilePath}
                showFilePath={settings.showStatusFilePath}
                lastError={lastError}
                charCount={charCount}
                selectionCharCount={selectionCharCount}
                pageMetrics={editorPageMetrics}
                manuscriptProgress={settings.manuscript.layoutMode === "manuscript" ? editorManuscriptProgress : null}
                checkpoint={settings.showCheckpointStatus && projectFolder ? {
                  latest: latestManualSnapshot && {
                    label: latestManualSnapshot.label,
                    createdAt: latestManualSnapshot.createdAt,
                    visibleTextLength: latestManualSnapshot.totalVisibleTextLength,
                  },
                  currentVisibleTextLength: statusProjectVisibleTextLength,
                  onOpen: () => openCheckpointStudio(latestManualSnapshot?.id),
                  onCreate: () => void handleQuickCreateManuscriptSnapshot(),
                } : null}
                pluginItems={pluginStatusItems}
                onPluginItemClick={(pluginId, commandId) =>
                  pluginRuntimeHostRef.current?.executeCommand(pluginId, commandId)
                }
              />
            </div>

            {appMode === "canvas" && canvasEmbedPayload && (
              <div className="canvasEmbeddedHost">
                <CanvasWindowApp
                  embedded
                  embeddedPayload={canvasEmbedPayload}
                  onDraftCanvasChange={setDraftCanvasContext}
                  draftSelectRequest={draftSelectRequest}
                  onDraftSelectionConsumed={(nonce) => setDraftSelectRequest((current) => current?.nonce === nonce ? null : current)}
                  onOpenDraft={() => { setRightSidebarTab("draft"); setIsRightSidebarCollapsed(false); }}
                  liveIdeaThreads={snippets.map((thread) => ({
                    id: thread.id,
                    kind: thread.kind,
                    title: thread.title,
                  }))}
                  liveReferenceFiles={
                    projectFolder ? sortedReferenceCandidates : []
                  }
                />
              </div>
            )}

            {appMode === "plugin" && activePluginScreen && (
              <main className="pluginScreenPane" aria-label={activePluginScreen.title}>
                <div
                  ref={setScreenPluginRuntimeAnchor}
                  className="pluginRuntimeAnchor visiblePluginRuntimeAnchor"
                  aria-hidden="true"
                />
              </main>
            )}

            {appMode !== "plugin" && !isRightSidebarCollapsed && !isEditorFocusMode && (
              <div className="zoneRightSidebarHoverTarget" aria-hidden="true" />
            )}
            <aside
              className={`rightSidebar ${isRightSidebarWide ? "wideRightSidebar" : ""}${
                isRightSidebarCollapsed ? " collapsedRightSidebar" : ""
              }`}
              aria-label="補助ペイン"
              aria-hidden={appMode === "plugin" || isRightSidebarCollapsed || isEditorFocusMode}
              {...(
                appMode === "plugin" || isRightSidebarCollapsed || isEditorFocusMode
                  ? { inert: "" }
                  : {}
              )}
            >
                <div className="rightSidebarHeader">
                  <RightPaneSwitcher
                    items={rightPaneSwitcherItems}
                    activeId={rightSidebarTab}
                    onSelect={setRightSidebarTab}
                  />
                  {rightSidebarTab === "plot" && (
                    <PlotPaneHeaderActions
                      onAddSection={addPlotSection}
                      onAddChapter={addPlotChapter}
                      onOpenManager={() => setIsPlotManagerOpen(true)}
                    />
                  )}
                  {rightSidebarTab === "idea" && (
                    <div className="plotPaneHeaderActions" aria-label="バインダー操作">
                      <button
                        className="sidebarIconButton plotHeaderActionButton"
                        type="button"
                        aria-label="Idea Board を開く"
                        title="Idea Board を開く"
                        onClick={() => void openIdeaCanvasBoard("project")}
                      >
                        <AppIcon name="canvas" />
                      </button>
                    </div>
                  )}
                  <div className="rightSidebarChromeActions">
                    <button
                      className="sidebarIconButton"
                      type="button"
                      aria-label={isRightSidebarWide ? "ペイン幅を戻す" : "ペイン幅を拡張"}
                      title={isRightSidebarWide ? "ペイン幅を戻す" : "ペイン幅を拡張"}
                      onClick={() => setIsRightSidebarWide((isWide) => !isWide)}
                    >
                      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                        <polyline points={isRightSidebarWide ? "9 18 15 12 9 6" : "15 18 9 12 15 6"} />
                      </svg>
                    </button>
                    <button
                      className="sidebarIconButton"
                      type="button"
                      aria-label="右サイドバーを畳む"
                      title="右サイドバーを畳む"
                      onClick={() => setIsRightSidebarCollapsed(true)}
                    >
                      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div
                  className={`rightSidebarBody ${
                    rightSidebarTab === "plot" ? "plotRightSidebarBody" : ""
                  }`}
                >
                  <div
                    ref={setSidebarPluginRuntimeAnchor}
                    className={`pluginRuntimeAnchor${isDockedPluginRuntimeVisible ? " visiblePluginRuntimeAnchor" : ""}`}
                    aria-hidden="true"
                  />
                  {hasOpenedDraft && <div className="draftPaneHost" hidden={rightSidebarTab !== "draft"}>
                    <IntermediateDraftPane key={projectFolder?.path ?? "no-project"} rootPath={projectFolder?.path ?? null}
                      liveCanvas={appMode === "canvas" ? draftCanvasContext : null}
                      onOpenCanvas={(scope, boardId) => void openIdeaCanvasBoard(scope, boardId)}
                      onSelectNode={(id) => setDraftSelectRequest({ id, nonce: Date.now() })} />
                  </div>}
                  {rightSidebarTab === "draft" ? null : activePluginView ? (
                    <div className="pluginViewBody" aria-label={activePluginView.title} />
                  ) : rightSidebarTab === "properties" ? (
                    <PropertiesPanel
                      documentKey={documentKey}
                      metadata={frontMatter.metadata}
                      hasFrontMatter={frontMatter.hasFrontMatter}
                      onChangeMetadata={updateFrontMatter}
                      onClear={handleClearFrontMatter}
                      typeSettings={propertyTypeSettings}
                      onRememberType={rememberPropertyType}
                      onExit={returnFocusFromProperties}
                      loadPropertySets={loadPropertySets}
                      onSearchProperty={searchByProperty}
                    />
                  ) : rightSidebarTab === "proof" ? (
                    <ProofreadPane
                      text={editorText}
                      documentKey={documentKey}
                      active={!isRightSidebarCollapsed && !isEditorFocusMode && appMode !== "plugin"}
                      options={settings.proofread}
                      onOptionsChange={(next) =>
                        updateSettings("proofread", {
                          ...next,
                          disabledRules: settings.proofread.disabledRules,
                        })
                      }
                      disabledRuleIds={settings.proofread.disabledRules}
                      onDisabledRuleIdsChange={(ruleIds) =>
                        updateSettings("proofread", {
                          ...settings.proofread,
                          disabledRules: ruleIds,
                        })
                      }
                      onJump={revealEditorRange}
                      onReplace={replaceEditorRange}
                      projectTerms={projectProofreadTerms}
                      globalTerms={appState.proofreadTerms}
                      hasProject={Boolean(projectFolder)}
                      onProjectTermsChange={setProjectProofreadTerms}
                      onGlobalTermsChange={(terms) =>
                        setAppState((current) => ({ ...current, proofreadTerms: terms }))
                      }
                      onExportTermFile={exportProofreadDictionary}
                      onImportTermFile={importProofreadDictionary}
                      canUseTermFiles={isTauriRuntime()}
                      ignoredKeys={projectProofreadIgnored[proofreadIgnoreKey] ?? []}
                      onIgnoredKeysChange={(keys) =>
                        setProjectProofreadIgnored((current) => {
                          const next = { ...current };
                          if (keys.length) next[proofreadIgnoreKey] = keys;
                          else delete next[proofreadIgnoreKey];
                          return next;
                        })
                      }
                      disabledCheckIds={settings.proofread.disabledChecks}
                      onDisabledCheckIdsChange={(checkIds) =>
                        updateSettings("proofread", {
                          ...settings.proofread,
                          disabledChecks: checkIds,
                        })
                      }
                    />
                  ) : rightSidebarTab === "ai" ? (
                    <AiPane
                      rootPath={projectFolder?.path ?? null}
                      settings={settings.ai}
                      threads={snippets}
                      onReferenceSaved={(threadId, file) => {
                        setReferenceCandidates((current) =>
                          mergeReferenceFiles([file], current).sort((left, right) =>
                            left.sourcePath.localeCompare(right.sourcePath),
                          ),
                        );
                        addReferencesToIdeaThread(threadId, [file]);
                        showToast(`「${file.name}」を資料に保存しました`);
                      }}
                      onOpenReference={(file) => openReferenceCard(file.sourcePath, file, { switchToReferenceTab: false })}
                      insertRequest={aiInsertRequest}
                      onInsertConsumed={consumeAiInsertRequest}
                    />
                  ) : rightSidebarTab === "plot" ? (
                    <PlotPane
                      cards={plotCards}
                      onCardsChange={setPlotCards}
                      referenceCandidates={sortedReferenceCandidates}
                      onOpenReference={openPlotReference}
                      onMissingReference={() => showToast("存在しないファイルです")}
                      onNotify={showToast}
                      isManagerOpen={isPlotManagerOpen}
                      onManagerOpenChange={setIsPlotManagerOpen}
                      transfer={
                        transferMenuLabel
                          ? { label: transferMenuLabel, onTransfer: (cardId) => void transferPlotCard(cardId) }
                          : undefined
                      }
                    />
                  ) : (
                    <BinderPane
                      rootPath={projectFolder?.path ?? null}
                      threads={snippets}
                      threadLayouts={referenceLayout.ideaThreads}
                      candidates={sortedReferenceCandidates}
                      draggingId={draggingId}
                      focusRequest={ideaFocusRequest}
                      onFocusRequestConsumed={(nonce) =>
                        setIdeaFocusRequest((current) =>
                          current?.nonce === nonce ? null : current,
                        )
                      }
                      onCapture={captureFragment}
                      onOpenIdea={openIdeaBinderCard}
                      onCreateThread={createIdeaThread}
                      onRenameThread={renameIdeaThread}
                      onToggleStar={toggleThreadStar}
                      onDeleteThread={deleteIdeaThread}
                      onAddFragment={addFragment}
                      onUpdateFragment={updateFragmentBody}
                      onDeleteFragment={deleteFragment}
                      onMoveFragment={moveFragment}
                      onMoveFragmentToNewThread={(threadId, fragmentId) =>
                        void moveFragmentToNewThread(threadId, fragmentId)
                      }
                      onAskAi={handTextToAi}
                      onFragmentDragStart={handleFragmentDragStart}
                      onFragmentDragEnd={handleFragmentDragEnd}
                      onAddReference={(threadId) => void handleAddReference("project", threadId)}
                      onCreateReference={(threadId) => void handleCreateReference("project", threadId)}
                      onOpenReference={(targetFile) => {
                        const file =
                          sortedReferenceCandidates.find(
                            (item) => referenceFileKey(item) === referenceFileKey(targetFile),
                          ) ?? targetFile;
                        openReferenceCard(file.sourcePath, file, { switchToReferenceTab: false });
                      }}
                      onMoveReference={moveIdeaReference}
                      onMoveReferenceToNewThread={(threadId, linkId, copy) =>
                        void moveReferenceToNewThread(threadId, linkId, copy)
                      }
                      onRemoveReference={(threadId, linkId) => void removeIdeaReference(threadId, linkId)}
                      onDeleteReferenceFile={(file) =>
                        void handleDeleteImportedReference(file.sourcePath, file.scope)
                      }
                      onReorderItem={reorderIdeaThreadItem}
                      transfer={
                        transferMenuLabel
                          ? {
                              label: transferMenuLabel,
                              onThread: (threadId) => void transferIdeaThread(threadId),
                              onFragment: (threadId, fragmentId) => void transferIdeaFragment(threadId, fragmentId),
                              onReferenceFile: (file) => void transferReferenceFile(file),
                            }
                          : undefined
                      }
                    />
                  )}
                </div>
            </aside>
          </div>

          <ThenPluginRuntimeHost
            ref={pluginRuntimeHostRef}
            plugins={loadedPlugins}
            activeView={pluginRuntimeActiveView}
            workspace={{
              name: projectFolder?.name ?? null,
              hasProject: Boolean(projectFolder),
            }}
            visible={Boolean(activePluginModal) || isDockedPluginRuntimeVisible}
            modal={Boolean(activePluginModal)}
            anchorElement={pluginRuntimeAnchor}
            themeKey={`${settings.theme}:${settings.uiFontFamily}`}
            onRequest={handlePluginRequest}
            onError={(pluginName, message) => {
              setLastError(`${pluginName}: ${message}`);
              showToast(`プラグイン「${pluginName}」でエラーが発生しました`);
            }}
          />

          <ReferenceLayer
            rootPath={projectFolder?.path ?? null}
            layout={referenceLayout}
            onLayoutChange={patchReferenceLayout}
            onReturnFocusToEditor={returnFocusToEditor}
            onTextSaved={handleReferenceTextSaved}
            ideaThreads={snippets}
            onUpdateIdeaFragment={updateFragmentBody}
          />

          {appMode === "export" && exportEmbedPayload && (
            <div className="exportEmbeddedHost">
              <LinkedExportScreen
                key={exportEmbedPayload.requestId}
                embedded
                title={exportEmbedPayload.title}
                projectPath={exportEmbedPayload.projectPath}
                initialSources={exportEmbedPayload.sources}
                sourceError={exportEmbedPayload.sourceError}
                onClose={() => {
                  setAppMode("write");
                  setExportEmbedPayload(null);
                }}
                onOpenSource={(path) => {
                  setAppMode("write");
                  setExportEmbedPayload(null);
                  if (path) void handleProjectFileSelect(path);
                }}
                onExportPdf={exportPdfWithVivliostyle}
                onExportDocx={exportDocxWithDialog}
                onOpenResult={(path) => void invoke("open_export_location", { path })}
              />
            </div>
          )}

          {appMode === "checkpoint" && (
            <CheckpointStudio
              projectFolder={projectFolder}
              snapshots={currentWorkspaceSnapshots}
              currentProjectFiles={checkpointCurrentProjectFiles}
              currentProjectStatus={checkpointCurrentProjectStatus}
              unavailableCurrentProjectPaths={checkpointUnavailableProjectPaths}
              currentProjectStats={checkpointProjectStats}
              focusRequest={checkpointFocusRequest}
              onClose={() => setAppMode("write")}
              onCreate={(label) => handleCreateManuscriptSnapshot({ label })}
              onEditDetails={(snapshot) => void handleEditManuscriptSnapshotDetails(snapshot)}
              onDelete={(snapshot) => void handleDeleteManuscriptSnapshot(snapshot)}
              onRestore={(snapshot) => handleRestoreManuscriptSnapshot(snapshot, { confirmed: true })}
              onRestoreFile={(snapshot, path, relocation) =>
                handleRestoreManuscriptSnapshotFiles(
                  snapshot,
                  [path],
                  [],
                  "overwrite",
                  false,
                  relocation ? [relocation] : [],
                  { confirmed: true },
                )
              }
              onRestoreOrder={handleRestoreManuscriptSnapshotOrder}
            />
          )}

          <div
            className={`toast ${toast ? "showToast" : ""} ${toastAction ? "hasAction" : ""}`}
            role="status"
          >
            <span>{toast}</span>
            {toastAction && (
              <button
                type="button"
                onClick={() => {
                  const action = toastAction;
                  if (toastTimerRef.current) {
                    window.clearTimeout(toastTimerRef.current);
                    toastTimerRef.current = null;
                  }
                  setToast("");
                  setToastAction(null);
                  action.onClick();
                }}
              >
                {toastAction.label}
              </button>
            )}
          </div>

          {notationModal && (
            <div className="modalBackdrop" role="presentation">
              <section
                className="modal compactModal notationModal"
                aria-label={
                  notationModal.type === "ruby" ? "ルビを追加" : "行指示を選択"
                }
                role="dialog"
                aria-modal="true"
              >
                <header className="modalHeader">
                  <h2>{notationModal.type === "ruby" ? "ルビ" : "行指示"}</h2>
                  <button
                    className="modalClose"
                    type="button"
                    aria-label="閉じる"
                    onClick={() => setNotationModal(null)}
                  >
                    ×
                  </button>
                </header>
                {notationModal.type === "ruby" ? (
                  <form className="modalForm" onSubmit={submitRubyNotation}>
                    <label>
                      <span>対象</span>
                      <input value={notationModal.selection.text} readOnly />
                    </label>
                    <label>
                      <span>ルビ</span>
                      <input
                        autoFocus
                        value={notationModal.reading}
                        placeholder="読みを入力"
                        onChange={(event) =>
                          setNotationModal((current) =>
                            current?.type === "ruby"
                              ? { ...current, reading: event.target.value, error: "" }
                              : current,
                          )
                        }
                      />
                    </label>
                    <p className="notationSyntax">{customNotationSpecs[0].syntax}</p>
                    {notationModal.error && (
                      <p className="dialogError" role="alert">
                        {notationModal.error}
                      </p>
                    )}
                    <footer className="modalActions">
                      <button type="button" onClick={() => setNotationModal(null)}>
                        キャンセル
                      </button>
                      <button type="submit">反映</button>
                    </footer>
                  </form>
                ) : (
                  <div className="modalForm">
                    <div className="notationChoiceList">
                      {directionOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="notationChoiceButton"
                          onClick={() => chooseDirectionNotation(option.value)}
                        >
                          <span>{option.label}</span>
                          <small>{option.description}</small>
                        </button>
                      ))}
                    </div>
                    <p className="notationSyntax">{customNotationSpecs[3].syntax}</p>
                    <footer className="modalActions">
                      <button type="button" onClick={() => setNotationModal(null)}>
                        キャンセル
                      </button>
                    </footer>
                  </div>
                )}
              </section>
            </div>
          )}

          {manuscriptTidyRequest && (
            <ManuscriptTidyModal
              text={manuscriptTidyRequest.text}
              selectionLines={manuscriptTidyRequest.selectionLines}
              onApply={applyManuscriptTidy}
              onClose={() => setManuscriptTidyRequest(null)}
              onRestoreFocus={restoreFocusAfterCommandPalette}
            />
          )}

          {isPluginManagerOpen && (
            <PluginManagerModal
              plugins={loadedPlugins}
              onClose={() => setIsPluginManagerOpen(false)}
              onInstall={handleInstallPlugin}
              onReload={async () => {
                if (!(await reloadInstalledPlugins())) {
                  showToast("プラグインの再読み込みでエラーが発生しました");
                }
              }}
              onUninstall={handleUninstallPlugin}
            />
          )}

          {isCommandPaletteOpen && (
            <CommandPalette
              commands={buildPaletteCommands()}
              onClose={closeCommandPalette}
              restoreFocus={restoreFocusAfterCommandPalette}
            />
          )}
          {isQuickIdeaModalOpen && (
            <QuickIdeaModal
              threads={snippets}
              onCapture={captureFragment}
              onAskAi={handTextToAi}
              onClose={() => setIsQuickIdeaModalOpen(false)}
            />
          )}
          {isSettingsModalOpen && (
            <SettingsModal
              settings={settings}
              systemFonts={systemFonts}
              editorMeasureLimit={editorMeasureLimit}
              onClose={() => setIsSettingsModalOpen(false)}
              onOpenThemePicker={() => {
                setIsSettingsModalOpen(false);
                setShouldReturnToSettingsAfterThemePicker(true);
                setIsThemePickerModalOpen(true);
              }}
              onUpdateSettings={updateSettings}
              onSnippetStorageModeChange={(mode) =>
                void handleSnippetStorageModeChange(mode)
              }
            />
          )}
          {isThemePickerModalOpen && (
            <ThemePickerModal
              selectedTheme={settings.theme}
              onClose={() => {
                setIsThemePickerModalOpen(false);
                if (shouldReturnToSettingsAfterThemePicker) {
                  setShouldReturnToSettingsAfterThemePicker(false);
                  setIsSettingsModalOpen(true);
                }
              }}
              onSelect={(theme) => updateSettings("theme", theme)}
            />
          )}
          {/* 確認と入力のダイアログは、設定などのモーダルから開くこともあるので、いちばん上に置く。 */}
          {appDialog && (
            <AppDialogModal
              dialog={appDialog}
              onClose={closeAppDialog}
              onSubmit={submitAppDialog}
              onValueChange={updateAppDialogValue}
              onFieldValueChange={updateAppDialogFieldValue}
              onChoice={chooseAppDialog}
              onOption={chooseAppDialogOption}
            />
          )}
          </section>
        )}
      </main>
  );
}
