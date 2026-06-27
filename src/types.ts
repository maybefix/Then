import type { ExportFontFamily } from "./export/types";

export type Snippet = {
  id: string;
  title: string;
  text: string;
  category: string;
  tags: string[];
};

export type PlotCardKind = "section" | "chapter";

export type PlotCard = {
  id: string;
  /** "section" は通常のプロット、"chapter" は章ラベル（本文なし）。 */
  kind: PlotCardKind;
  num: string;
  title: string;
  body: string;
  expanded: boolean;
};

export const appThemeValues = [
  "dark",
  "notion",
  "standard",
  "claude",
  "apple-light",
  "apple-dark",
  "smarthr-light",
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
  exportFontFamily: ExportFontFamily;
  fontSize: number;
  lineHeight: number;
  typewriterScroll: boolean;
  typewriterOffset: number;
  showLineBreakMarks: boolean;
  snippetStorageMode: "workspace" | "profile";
  sidebarMode: SidebarMode;
  /** ナビゲータ方式のプレビュー表示行数。0 は「なし」（プレビュー非表示）。 */
  navigatorPreviewLines: number;
  /** 文字数カウントに空白文字（スペース・タブ・改行など）を含めるか。 */
  countWhitespace: boolean;
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
  snippets: Snippet[];
  profileSnippets: Snippet[];
  settings: EditorSettings;
  lastWorkspacePath: string | null;
  lastFilePath: string | null;
  recentWorkspaces: WorkspaceRecord[];
  /** ファイルパスごとの進捗ラベル。未登録は "todo"（未着手）として扱う。 */
  fileProgress: Record<string, FileProgressStatus>;
  /** ファイルパスごとに記憶した最後のカーソル位置。 */
  cursorPositions: Record<string, CursorPosition>;
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
