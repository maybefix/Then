import type { ExportFontFamily } from "./export/types";

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
export type IdeaFragment = {
  id: string;
  body: string;
  /** 本文へ挿入済み（消化済み）かどうか。 */
  used: boolean;
  createdAt: number;
  updatedAt: number;
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

export type ReferenceCardState = {
  id: string;
  sourcePath: string;
  kind: ReferenceKind;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  collapsed: boolean;
  pinned: boolean;
  scrollTop?: number;
  zoom?: number;
  page?: number;
  editing?: boolean;
};

export type ReferenceLayout = {
  version: 1;
  name: string;
  cards: ReferenceCardState[];
  recent: ReferenceFileInfo[];
};

export type ReferenceFileInfo = {
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
  "notion",
  "standard",
  "claude",
  "apple-light",
  "apple-dark",
  "smarthr-light",
  "life-light",
  "yamaha-light",
  "yamaha-dark",
  "sony-dark",
  "ana-light",
  "ana-dark",
  "nissan-light",
  "nissan-dark",
  "nec-light",
  "nec-dark",
  "fujitsu-light",
  "fujitsu-dark",
  "paper-light",
  "paper-dark",
  "one-hundred-light",
  "precious-light",
  "evergreen-light",
  "express-light",
  "express-dark",
  "education-light",
  "education-dark",
  "water-light",
  "water-dark",
  "hands-light",
  "hands-dark",
  "dandelion-dark",
  "commerce-light",
  "commerce-dark",
  "promise-light",
  "promise-dark",
  "flat-light",
  "flat-dark",
  "air-light",
  "air-dark",
  "passion-light",
  "passion-dark",
  "tech-light",
  "tech-dark",
  "energy-light",
  "energy-dark",
] as const;

export type AppTheme = (typeof appThemeValues)[number];

/** 左サイドバーのファイル表示方式。 */
export type SidebarMode = "tree" | "navigator";

/** 本文エディタの書字方向。 */
export type WritingMode = "vertical-rl" | "horizontal-tb";

/** ファイルごとの進捗ラベル。デフォルトは "todo"（未着手）。 */
export type FileProgressStatus = "todo" | "writing" | "revising" | "done";

export const fileProgressStatuses: readonly FileProgressStatus[] = [
  "todo",
  "writing",
  "revising",
  "done",
] as const;

export const fileProgressLabels: Record<FileProgressStatus, string> = {
  todo: "未着手",
  writing: "執筆中",
  revising: "推敲中",
  done: "完了",
};

export const DEFAULT_FILE_PROGRESS: FileProgressStatus = "todo";

export type EditorSettings = {
  theme: AppTheme;
  editorFontFamily: string;
  uiFontFamily: string;
  /** UI（メニュー・サイドバーなど本文以外）の表示倍率。1 が等倍。 */
  uiFontScale: number;
  exportFontFamily: ExportFontFamily;
  fontSize: number;
  lineHeight: number;
  writingMode: WritingMode;
  typewriterScroll: boolean;
  typewriterOffset: number;
  showLineBreakMarks: boolean;
  snippetStorageMode: "workspace" | "profile";
  sidebarMode: SidebarMode;
  /** プロジェクト切替メニューでフォルダパスを表示するか。 */
  showWorkspacePaths: boolean;
  /** 左右サイドバーを通常時に透かし、ホバー時だけ通常表示にする実験モード。 */
  zoneMode: boolean;
  /** Zoneモードでサイドバーに適用する通常時の不透明度。 */
  zoneModeOpacity: number;
  /** ナビゲータ方式のプレビュー表示行数。0 は「なし」（プレビュー非表示）。 */
  navigatorPreviewLines: number;
  /** 文字数カウントに空白文字（スペース・タブ・改行など）を含めるか。 */
  countWhitespace: boolean;
  /** チェックポイントセクションを折りたたんで表示するか。 */
  checkpointSectionCollapsed: boolean;
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

/** ナビゲータのプレビュー行数として選べる値（0 = なし）。 */
export const NAVIGATOR_PREVIEW_LINE_CHOICES: readonly number[] = [0, 1, 2, 3] as const;
export const DEFAULT_NAVIGATOR_PREVIEW_LINES = 2;

/** UI 表示倍率の選択肢。 */
export const UI_FONT_SCALE_CHOICES: readonly number[] = [0.85, 1, 1.05, 1.1, 1.15, 1.3] as const;
export const UI_FONT_SCALE_MIN = 0.7;
export const UI_FONT_SCALE_MAX = 1.6;

export type SaveStatus = "loading" | "saved" | "dirty" | "saving" | "error";

export type DocumentTab = {
  id: string;
  kind: "file" | "scratch";
  path: string | null;
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
  lastWorkspacePath: string | null;
  lastFilePath: string | null;
  recentWorkspaces: WorkspaceRecord[];
  /** ファイルパスごとの進捗ラベル。未登録は "todo"（未着手）として扱う。 */
  fileProgress: Record<string, FileProgressStatus>;
  /** ファイルパスごとに記憶した最後のカーソル位置。 */
  cursorPositions: Record<string, CursorPosition>;
  /** 手動保存点。正本である原稿ASTから復元できる本文だけを保持する。 */
  snapshots: ManuscriptSnapshot[];
};

export type TextDocument = {
  path: string;
  name: string;
  content: string;
};

export type MarkdownDocument = TextDocument;

export type ProjectFolder = {
  path: string;
  name: string;
  children: ProjectEntry[];
};

export type ProjectEntry = {
  path: string;
  name: string;
  kind: "folder" | "file";
  children: ProjectEntry[];
};

export type WorkspaceRecord = {
  path: string;
  name: string;
  lastOpenedAt: number;
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
