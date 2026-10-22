import type { AiSettings } from "./ai/settings";
import type { ExportFontFamily } from "./export/types";
import type { ProofreadOptions } from "./proofread/types";
import type { ProofreadTerm } from "./proofread/terms";
import type { RestorableRightSidebarTab } from "./utils/rightSidebarState";

export type {
  ProofreadTerm,
  ProofreadTermKind,
  ProofreadTermPolicy,
  ProofreadTermScope,
} from "./proofread/terms";

/**
 * 旧 Idea（フラットな付箋）モデル。スレッド型へ移行済みだが、
 * ワークスペース/プロファイルに保存された旧データの移行（マイグレーション）
 * のために型を残している。
 */
export type Snippet = {
  id: string;
  title: string;
  text: string;
  category: string;
  tags: string[];
};

/** スレッド内の1断片（メモの最小単位）。 */
export type CanvasScope = "project" | "global";
export type ReferenceScope = CanvasScope;

export type IdeaOriginRef = {
  source: "canvas";
  sourceId: string;
  sourceBoardId: string;
  sourceBoardScope: CanvasScope;
  copiedAt: number;
};

export type IdeaFragment = {
  id: string;
  body: string;
  /** 本文へ挿入済み（消化済み）かどうか。 */
  used: boolean;
  createdAt: number;
  updatedAt: number;
  originRef?: IdeaOriginRef;
};

export type IdeaThreadKind = "inbox" | "thread";

/**
 * Idea のスレッド。`inbox` は未整理メモの常設受け皿で、削除・改名不可。
 * `thread` は場面・伏線・方針などのトピック単位の束。
 */
export type IdeaThread = {
  id: string;
  kind: IdeaThreadKind;
  title: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  fragments: IdeaFragment[];
};

/** 作品内の資料ファイルを Idea スレッドから参照するリンク。 */
export type IdeaReferenceLink = {
  id: string;
  sourceType: "reference";
  /** 作品ルートからの正規化相対パス。 */
  sourcePath: string;
  createdAt: number;
};

/** Idea 本体は既存の保存先に置いたまま、作品側では ID だけを順序へ記録する。 */
export type IdeaFragmentLink = {
  sourceType: "idea";
  fragmentId: string;
};

export type IdeaThreadItemLink = IdeaFragmentLink | IdeaReferenceLink;

/**
 * Idea と資料の混在順序。資料参照を profileSnippets へ保存しないため、
 * ReferenceLayout（作品内の .then/references/layout.json）に保持する。
 */
export type IdeaThreadLayout = {
  threadId: string;
  items: IdeaThreadItemLink[];
};

export type PlotCardKind = "section" | "chapter";

export type PlotCard = {
  id: string;
  /** "section" は通常のプロット、"chapter" は章ラベル（本文なし）。 */
  kind: PlotCardKind;
  num: string;
  title: string;
  body: string;
  /** 右サイドバーでの展開状態。 */
  expanded: boolean;
  /**
   * プロット管理画面での折りたたみ状態。右サイドバーの `expanded` とは独立し、
   * 前回起動時の状態を引き継ぐために保存する。true = 折りたたみ。
   */
  managerCollapsed: boolean;
};

export type ReferenceKind = "text" | "markdown" | "image" | "pdf" | "unknown";

export type BinderCardFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  collapsed: boolean;
  pinned: boolean;
};

export type ReferenceCardState = BinderCardFrame & {
  /** Old saved layouts do not have this field and are normalized as references. */
  sourceType?: "reference";
  scope: ReferenceScope;
  sourcePath: string;
  kind: ReferenceKind;
  scrollTop?: number;
  zoom?: number;
  page?: number;
  editing?: boolean;
};

export type IdeaBinderCardState = BinderCardFrame & {
  sourceType: "idea";
  threadId: string;
  fragmentId: string;
};

export type BinderCardState = ReferenceCardState | IdeaBinderCardState;

export function isIdeaBinderCard(card: BinderCardState): card is IdeaBinderCardState {
  return card.sourceType === "idea";
}

export function isReferenceBinderCard(card: BinderCardState): card is ReferenceCardState {
  return card.sourceType !== "idea";
}

export type ReferenceLayout = {
  version: 1 | 2 | 3;
  name: string;
  cards: BinderCardState[];
  recent: ReferenceFileInfo[];
  /** version 3 で追加。旧データは読み込み時に fragments から補完する。 */
  ideaThreads: IdeaThreadLayout[];
};

export type ReferenceFileInfo = {
  scope: ReferenceScope;
  sourcePath: string;
  name: string;
  kind: ReferenceKind;
  size: number;
  imported: boolean;
};

export type ReferenceBinary = {
  mime: string;
  dataBase64: string;
};

export const appThemeValues = [
  "dark",
  "default",
  "standard",
  "nagoya-light",
  "coral-light",
  "minimal-light",
  "minimal-dark",
  "worker-light",
  "workbench-light",
  "index-light",
  "resonance-light",
  "resonance-dark",
  "cinematic-dark",
  "night-library-dark",
  "blue-sky-light",
  "blue-sky-dark",
  "drive-light",
  "drive-dark",
  "orchestrating-light",
  "orchestrating-dark",
  "shaping-light",
  "shaping-dark",
  "paper-light",
  "paper-dark",
  "newsroom-light",
  "newsroom-dark",
  "sen-light",
  "sen-dark",
  "precious-light",
  "express-light",
  "express-dark",
  "education-light",
  "education-dark",
  "water-light",
  "water-dark",
  "hands-light",
  "hands-dark",
  "dandelion-dark",
  "promise-light",
  "promise-dark",
  "flat-light",
  "flat-dark",
  "signal-red-light",
  "mono-press-light",
  "air-light",
  "air-dark",
  "passion-light",
  "passion-dark",
  "tech-light",
  "tech-dark",
  "slate-light",
  "linen-light",
  "graphite-dark",
  "umber-dark",
  "bronze-light",
  "bronze-dark",
  "moss-light",
  "moss-dark",
  "violet-light",
  "violet-dark",
  "rose-light",
  "rose-dark",
] as const;

export type AppTheme = (typeof appThemeValues)[number];

/** 本文エディタの書字方向。 */
export type WritingMode = "vertical-rl" | "horizontal-tb";

/** 本文を従来の連続領域で表示するか、ページ枠付きで表示するか。 */
export type EditorDisplayMode = "continuous" | "paged";

/** 原稿用紙の字詰め・行数で組むか。表示方式（EditorDisplayMode）とは独立。 */
export type ManuscriptLayoutMode = "normal" | "manuscript";

/** 原稿用紙モードの組版指定。本文ファイルには書き込まず、エディタ設定として保存する。 */
export type ManuscriptSettings = {
  layoutMode: ManuscriptLayoutMode;
  /** 1行の字数（字詰め）。 */
  charactersPerLine: number;
  /** 1ページ（1枚）の行数。 */
  linesPerPage: number;
  showGrid: boolean;
  showPageBoundaries: boolean;
  /**
   * 原稿用紙で使う文字サイズ（px）。升目は通常の本文より大きく見たいことが
   * 多いので、通常の文字サイズとは別に持ち、原稿用紙のあいだだけ使う。
   */
  fontSize: number;
};

export const MANUSCRIPT_CHARACTERS_MIN = 5;
export const MANUSCRIPT_CHARACTERS_MAX = 80;
export const MANUSCRIPT_LINES_MIN = 5;
export const MANUSCRIPT_LINES_MAX = 80;
export const MANUSCRIPT_FONT_SIZE_MIN = 12;
export const MANUSCRIPT_FONT_SIZE_MAX = 40;
/** 原稿用紙の文字サイズを決めていないときに、通常の文字サイズへ足す量。 */
export const MANUSCRIPT_FONT_SIZE_OFFSET = 6;

export const DEFAULT_MANUSCRIPT_SETTINGS: ManuscriptSettings = {
  layoutMode: "normal",
  charactersPerLine: 20,
  linesPerPage: 20,
  showGrid: true,
  showPageBoundaries: true,
  fontSize: 21,
};

/** 実際の組版結果から数えた原稿用紙の進み具合。 */
export type ManuscriptProgress = {
  /** 書き終えたページ（枚）数。 */
  fullPages: number;
  /** 書きかけのページ番号（1始まり）。ちょうど埋まったときは次のページ。 */
  currentPage: number;
  /** 書きかけのページで使った行数。 */
  usedLinesOnCurrentPage: number;
  linesPerPage: number;
};

/** ページ表示時の送り方向。横送りは日本語の本に合わせて右から左へ進む。 */
export type PageFlowDirection = "horizontal-rtl" | "vertical";

/** Canvas の text node に適用するフォント種別。 */
export type CanvasNodeFontSource = "ui" | "editor";

/** プロット表示に適用するフォント種別。 */
export type PlotFontSource = "ui" | "editor";

/** 作品一覧・空タブなどのスタート画面に適用するフォント種別。 */
export type StartPageFontSource = "ui" | "editor";

/** 見出し・太字に適用するフォント種別。本文フォントを流用するか個別指定するか。 */
export type HeadingFontSource = "body" | "custom";

/**
 * ファイルごとの進捗ラベル。デフォルトは "todo"（未着手）。
 * "archived" はツリーの既定表示から外し、ライブラリの進捗バーにも数えない。
 */
export type FileProgressStatus = "todo" | "writing" | "revising" | "done" | "archived";

export const fileProgressStatuses: readonly FileProgressStatus[] = [
  "todo",
  "writing",
  "revising",
  "done",
  "archived",
] as const;

export const fileProgressLabels: Record<FileProgressStatus, string> = {
  todo: "未着手",
  writing: "執筆中",
  revising: "推敲中",
  done: "完了",
  archived: "アーカイブ",
};

/** 左サイドバーのツリーの絞り込み。"all" はアーカイブ以外のすべて。 */
export type FileProgressFilter = "all" | FileProgressStatus;

export const DEFAULT_FILE_PROGRESS: FileProgressStatus = "todo";

export type SidebarHoverMode = "none" | "both" | "left" | "right";

export type DocumentTabsDisplayMode = "always" | "hover";

/** 校正ペインの設定。しきい値と、外しているルール。 */
export type ProofreadSettings = ProofreadOptions & {
  /** 使わないルールのID。既定は空（全ルール有効）。 */
  disabledRules: string[];
};

export type EditorSettings = {
  theme: AppTheme;
  editorFontFamily: string;
  uiFontFamily: string;
  /** UI（メニュー・サイドバーなど本文以外）の表示倍率。1 が等倍。 */
  uiFontScale: number;
  exportFontFamily: ExportFontFamily;
  fontSize: number;
  lineHeight: number;
  /**
   * 横書き時の1行の横幅。編集領域に対する百分率（30〜100）。比率なので
   * ウィンドウを縮めても余白の割合が保たれ、はみ出す値は定義上選べない。
   */
  editorMeasureHorizontal: number;
  /** 縦書き時の1列の縦幅。編集領域に対する百分率（30〜100）。 */
  editorMeasureVertical: number;
  writingMode: WritingMode;
  editorDisplayMode: EditorDisplayMode;
  pageFlowDirection: PageFlowDirection;
  /** 原稿用紙の字詰め・行数。continuous / paged のどちらとも組み合わせられる。 */
  manuscript: ManuscriptSettings;
  typewriterScroll: boolean;
  showTypewriterGuide: boolean;
  typewriterOffset: number;
  showLineBreakMarks: boolean;
  /** 縦書きでは各列の上、横書きでは各行の左に行番号を表示するか。 */
  showLineNumbers: boolean;
  /** キャレットがある現在行を控えめな背景色で強調するか。 */
  highlightCurrentLine: boolean;
  /** 日本語の鉤括弧「」で囲まれた本文を色分けするか。 */
  colorizeJapaneseQuotes: boolean;
  /** コメント行（行頭 // と <!-- -->）を本文中に表示するか。false で畳む。 */
  showComments: boolean;
  snippetStorageMode: "workspace" | "profile";
  /** プロジェクト切替メニューでフォルダパスを表示するか。 */
  showWorkspacePaths: boolean;
  /** ステータスバーに現在のファイルパスを表示するか。 */
  showStatusFilePath: boolean;
  /** パンくずの下に開いている文書のタブバーを表示するか。 */
  showDocumentTabs: boolean;
  /** タブバーを常時表示するか、上端ホバー時だけ重ねて表示するか。 */
  documentTabsDisplayMode: DocumentTabsDisplayMode;
  /** 起動ポータルを省略し、前回のワークスペースを直接開くか。 */
  skipStartupPortal: boolean;
  /** 集中表示と同時にTauriウィンドウを完全フルスクリーンへ切り替えるか。 */
  focusModeUsesNativeFullscreen: boolean;
  /** 画面端のホバー時だけ重ねて表示するサイドバー。 */
  sidebarHoverMode: SidebarHoverMode;
  /** Zoneモードでサイドバーに適用する通常時の不透明度。 */
  zoneModeOpacity: number;
  /** 文字数カウントに空白文字（スペース・タブ・改行など）を含めるか。 */
  countWhitespace: boolean;
  /** 文字数カウントにコード（コードブロック・行内コード）を含めるか。 */
  countCode: boolean;
  /** ファイルツリーの見出し階層に縦のガイド線を表示するか。 */
  showOutlineGuides: boolean;
  /** チェックポイントセクションを折りたたんで表示するか。 */
  checkpointSectionCollapsed: boolean;
  /** 左サイドバーにチェックポイント欄を出すか。 */
  showCheckpointSection: boolean;
  /** ステータスバーに最後の保存点からの経過と増減字数を出すか。 */
  showCheckpointStatus: boolean;
  /** Canvas text node の既定書字方向。 */
  canvasDefaultWritingMode: WritingMode;
  /** Canvas text node の既定フォント種別。 */
  canvasDefaultFontSource: CanvasNodeFontSource;
  /** プロット表示に使うフォント種別。 */
  plotFontSource: PlotFontSource;
  /** 作品一覧・空タブなどのスタート画面に使うフォント種別。 */
  startPageFontSource: StartPageFontSource;
  /** 見出し・太字に別フォントを使うか。 */
  headingFontSource: HeadingFontSource;
  /** headingFontSource === "custom" のときに見出し・太字へ適用するフォント。 */
  headingFontFamily: string;
  /** キャンバスをメイン画面のモードではなく別ウィンドウで開くか。 */
  canvasOpensInWindow: boolean;
  /** エクスポートをメイン画面のモードではなく別ウィンドウで開くか。 */
  exportOpensInWindow: boolean;
  /** 校正ペインのしきい値と、外しているルール。 */
  proofread: ProofreadSettings;
  /** AI会話の既定の接続先・モデル・種類。APIキーは含めない。 */
  ai: AiSettings;
};

/**
 * ファイルごとに保存するカーソル位置。`length` は保存時点の本文長で、
 * 次回起動時に本文長が一致すれば `offset` を復元し、外部編集などで
 * 食い違う場合は先頭へフォールバックする。
 */
export type CursorPosition = {
  offset: number;
  length: number;
};

/** 本文の文字表示幅（編集領域に対する百分率）の範囲と既定値。 */
export const EDITOR_MEASURE_PERCENT_MIN = 30;
export const EDITOR_MEASURE_PERCENT_MAX = 100;
export const DEFAULT_EDITOR_MEASURE_PERCENT = 75;

/** UI 表示倍率の選択肢。 */
export const UI_FONT_SCALE_CHOICES: readonly number[] = [0.85, 1, 1.05, 1.1, 1.15, 1.3] as const;
export const UI_FONT_SCALE_MIN = 0.7;
export const UI_FONT_SCALE_MAX = 1.6;

export type SaveStatus = "loading" | "saved" | "dirty" | "saving" | "error";

/**
 * タブを離れる直前に画面内で見えていた本文位置。
 * スクロール量そのものは装飾の遅延生成で変わり得るため、本文オフセットと
 * ビューポート内の相対位置を組み合わせて保持する。
 */
export type TextEditorViewportState = {
  textLength: number;
  writingMode: WritingMode;
  anchorOffset: number;
  anchorRatio: number;
};

export type DocumentTab = {
  id: string;
  /** empty: 文書を一つも開いていない状態。タブ帯には出さず、編集面にスタートページを出す。 */
  kind: "file" | "scratch" | "empty";
  path: string | null;
  /** OSが提供するファイル識別子。同一ボリューム内の移動・改名を追跡する。 */
  fileId: string | null;
  /** パスとファイルIDで追跡できない場合に使う内容ハッシュ。 */
  contentHash: string | null;
  name: string;
  /**
   * TODO(Then): migrate these fields to text/savedText after the editor and
   * file I/O stop depending on Markdown-specific names.
   */
  markdown: string;
  savedMarkdown: string;
  /** Last editor-originated revision, or null for external document updates. */
  editorRevision: number | null;
  saveStatus: SaveStatus;
  documentKey: string;
  activeOutlineLine: number | null;
  /** 同じタブへ戻ったときに復元する、セッション中だけの表示位置。 */
  viewportState: TextEditorViewportState | null;
};

export type PersistedDocumentTab = {
  path: string;
  name: string;
  fileId: string | null;
  contentHash: string | null;
  activeOutlineLine: number | null;
  viewportState: TextEditorViewportState | null;
};

export type WorkspaceDocumentTabs = {
  tabs: PersistedDocumentTab[];
  activeIndex: number;
  updatedAt: number;
};

export type AppState = {
  /**
   * TODO(Then): rename to text after all persistence readers can handle both
   * the old brew state and the new Then state.
   */
  markdown: string;
  /**
   * Idea スレッド一覧。フィールド名は永続化キー(`snippets`)互換のため維持しているが、
   * 中身は新しい {@link IdeaThread} モデル。
   */
  snippets: IdeaThread[];
  profileSnippets: IdeaThread[];
  settings: EditorSettings;
  /** 最後に表示していた、次回起動時にも復元可能な右サイドバーのタブ。 */
  rightSidebarTab: RestorableRightSidebarTab;
  lastWorkspacePath: string | null;
  lastFilePath: string | null;
  recentWorkspaces: WorkspaceRecord[];
  /** ワークスペースごとに記憶した、ファイルツリーで折りたたまれているフォルダ。 */
  collapsedFolderPathsByWorkspace: Record<string, string[]>;
  /** ワークスペースごとに記憶した、見出しツリーを閉じているファイル。 */
  collapsedOutlinePathsByWorkspace: Record<string, string[]>;
  /** ワークスペースごとに記憶した、折りたたまれている見出し階層。 */
  collapsedOutlineHeadingKeysByWorkspace: Record<string, string[]>;
  /** ファイルパスごとの進捗ラベル。未登録は "todo"（未着手）として扱う。 */
  fileProgress: Record<string, FileProgressStatus>;
  /** プロジェクトごとの進捗ラベル移行バージョン。旧ローカル値の再取込を防ぐ。 */
  fileProgressMigrationVersions: Record<string, number>;
  /** プロジェクトごとのチェックポイント移行バージョン。 */
  checkpointMigrationVersions: Record<string, number>;
  /** ファイルパスごとに記憶した最後のカーソル位置。 */
  cursorPositions: Record<string, CursorPosition>;
  /** プロジェクトごとに記憶した、開いている文書タブと選択状態。 */
  documentTabsByWorkspace: Record<string, WorkspaceDocumentTabs>;
  /** 手動保存点。正本である原稿ASTから復元できる本文だけを保持する。 */
  snapshots: ManuscriptSnapshot[];
  /** 全ワークスペース共通の校正辞書。プロジェクト固有の語は project.json 側。 */
  proofreadTerms: ProofreadTerm[];
  /** ライブラリホームに出す作品ごとの字数・進捗の集計（端末ローカルのキャッシュ）。 */
  libraryWorkStats: Record<string, WorkStats>;
};

export type WorkStats = {
  /** 集計したときのファイル構成。変わっていれば集計し直す。 */
  signature: string;
  charCount: number;
  fileCount: number;
  progress: Record<FileProgressStatus, number>;
  lastModified: number | null;
};

export type TextDocument = {
  path: string;
  name: string;
  content: string;
  fileId?: string | null;
  contentHash?: string | null;
};

export type MarkdownDocument = TextDocument;

export type ProjectFolder = {
  path: string;
  name: string;
  children: ProjectEntry[];
  /** 一覧したフォルダがライブラリ直下か、ライブラリ内の作品のときだけ入る。 */
  library?: LibraryContext;
};

export type LibraryProjectSummary = {
  path: string;
  name: string;
};

export type LibraryContext = {
  path: string;
  name: string;
  /** root: ライブラリ直下を開いている / project: ライブラリ内の作品を開いている */
  role: "root" | "project";
  projects: LibraryProjectSummary[];
  /** ライブラリ直下以外の場所に置かれ、作品として扱われていないフォルダ。 */
  misplacedProjects: string[];
};

/** 作品の状態。ライブラリホームでの表示と絞り込みに使う。 */
export type WorkStatus = "planning" | "writing" | "revising" | "done" | "paused";

export const workStatusLabels: Record<WorkStatus, string> = {
  planning: "構想中",
  writing: "執筆中",
  revising: "推敲中",
  done: "完了",
  paused: "休止",
};

/** 作品の .then/project.json に保存する作品情報。 */
export type WorkMeta = {
  status: WorkStatus;
  summary: string;
  updatedAt: number;
};

export type FolderInspection = {
  kind: "library" | "libraryProject" | "project" | "folder";
  path: string;
  name: string;
  /** このフォルダを含むライブラリ（自身を含む）。 */
  libraryPath: string | null;
  /** このフォルダを含むライブラリ内の作品（自身を含む）。 */
  projectPath: string | null;
};

export type ProjectImportReport = {
  projectPath: string;
  name: string;
  fileCount: number;
  checkpointCount: number;
  warnings: string[];
};

export type ProjectEntry = {
  path: string;
  name: string;
  kind: "folder" | "file";
  children: ProjectEntry[];
  fileId?: string | null;
  contentHash?: string | null;
  /** 最終更新時刻（ミリ秒）。ファイル一覧から得たものだけに入る。 */
  modifiedAt?: number;
};

export type DeleteProjectEntryPlan = {
  rootPath: string;
  rootName: string;
  rootKind: "folder" | "file";
  fileCount: number;
  folderCount: number;
  textFileCount: number;
  nonTextFileCount: number;
  emptyFolderCount: number;
  totalBytes: number;
  paths: string[];
  filePaths: string[];
  folderPaths: string[];
  textFilePaths: string[];
  nonTextFilePaths: string[];
  warnings: string[];
};

export type DeleteProjectEntryResult = {
  deletedRootPath: string;
  deletedRootName: string;
  deletedPaths: string[];
  deletedFilePaths: string[];
  deletedFolderPaths: string[];
  deletedTextFilePaths: string[];
  deletedNonTextFilePaths: string[];
  movedToTrash: boolean;
  trashPath: string | null;
  fallbackUsed: "none" | "appTrash" | "permanentDelete";
  completedAt: number;
};

export type WorkspaceRecord = {
  path: string;
  name: string;
  lastOpenedAt: number;
  /** 開いたときにライブラリ直下かライブラリ内の作品だった場合。旧版の記録にはない。 */
  library?: { name: string; role: LibraryContext["role"] };
};

export type ManuscriptSnapshotReason = "manual" | "auto-before-restore";

export type ManuscriptSnapshotFile = {
  path: string;
  name: string;
  text: string;
  textHash: string;
  semanticHash: string;
  lineCount: number;
  textLength: number;
  visibleTextLength: number;
  outlineCount: number;
};

export type ManuscriptSnapshot = {
  id: string;
  revision: number;
  /** 共有JSON全体のhash。同期による同一revision分岐の検出に使う。 */
  storageHash: string;
  workspacePath: string;
  workspaceName: string;
  createdAt: number;
  reason: ManuscriptSnapshotReason;
  label: string;
  memo: string;
  parentIds: string[];
  projectTree: ProjectFolder;
  files: ManuscriptSnapshotFile[];
  fileCount: number;
  totalTextLength: number;
  totalVisibleTextLength: number;
};

export type WorkspaceAlert = {
  path: string;
  message: string;
} | null;

export type OutlineItem = {
  id: string;
  blockId: string;
  title: string;
  level: number;
  line: number;
  children: OutlineItem[];
};

export type FlatOutlineItem = OutlineItem & {
  parents: OutlineItem[];
};

export type BreadcrumbDropTarget = {
  folderPath: string;
  entryPath: string;
  position: "before" | "after";
} | null;

export type TextTemplateSummary = {
  id: string;
  name: string;
  scope: "workspace" | "profile";
  extension: "txt" | "md";
};

export type AppDialog =
  | {
      type: "input";
      title: string;
      label: string;
      value: string;
      confirmLabel: string;
      placeholder?: string;
      optional?: boolean;
      error: string;
      resolve: (value: string | null) => void;
    }
  | {
      type: "multiInput";
      title: string;
      fields: {
        id: string;
        label: string;
        value: string;
        placeholder?: string;
        optional?: boolean;
        multiline?: boolean;
        options?: { value: string; label: string }[];
      }[];
      confirmLabel: string;
      error: string;
      resolve: (value: Record<string, string> | null) => void;
    }
  | {
      type: "createFile";
      title: string;
      fileName: string;
      extension: "txt" | "md";
      templateId: string;
      templates: TextTemplateSummary[];
      confirmLabel: string;
      error: string;
      resolve: (value: { fileName: string; templateId: string | null } | null) => void;
    }
  | {
      type: "confirm";
      title: string;
      message: string;
      detail?: string;
      confirmLabel: string;
      danger?: boolean;
      resolve: (value: boolean) => void;
    }
  | {
      type: "choice";
      title: string;
      message: string;
      detail?: string;
      primaryLabel: string;
      secondaryLabel: string;
      resolve: (value: "primary" | "secondary" | null) => void;
    }
  | {
      type: "options";
      title: string;
      message: string;
      detail?: string;
      options: { id: string; label: string; description?: string }[];
      resolve: (value: string | null) => void;
    };

export type FontOption = {
  label: string;
  cssFamily: string;
};

export type SnippetDraft = {
  id: string | null;
  title: string;
  text: string;
  category: string;
  tags: string;
};
