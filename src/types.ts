import type { ExportFontFamily } from "./export/types";

export type Snippet = {
  id: string;
  title: string;
  text: string;
  category: string;
  tags: string[];
};

export type PlotCard = {
  id: string;
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
};

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
