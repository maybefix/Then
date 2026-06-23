export type LayoutAlign = "start" | "center" | "end";

export type LineKind = "blank" | "paragraph" | "heading" | "list";

export type TextRange = {
  offset: number;
  length: number;
};

export type InlineMarker = {
  role: string;
  text: string;
  range: TextRange;
};

export type RubyItem = {
  text: string;
  reading: string;
  range: TextRange;
};

export type InlineMarkup = {
  id: string;
  type: "ruby" | "emphasis" | "tcy" | "layoutAlign" | "aozoraAnnotation" | "bold";
  syntax?: "layoutsystem_v1" | "legacy";
  fullText: string;
  contentText: string;
  fullRange: TextRange;
  contentRange: TextRange;
  metadata?: string;
  rubyText?: string;
  rubyMode?: "mono" | "group";
  rubyItems?: RubyItem[] | null;
  emStyle?: "auto" | "goma" | "dot";
  align?: LayoutAlign;
  markers: InlineMarker[];
};

export type LineNode = {
  id: string;
  semanticHash: string;
  kind: LineKind;
  level: number;
  marker: string;
  jitsuki: boolean;
  align: LayoutAlign | null;
  source: string;
  text: string;
  lineIndex: number;
  from: number;
  to: number;
  length: number;
  inlineMarkups: InlineMarkup[];
};

export type DocumentOutlineItem = {
  id: string;
  blockId: string;
  title: string;
  level: number;
  line: number;
  children: DocumentOutlineItem[];
};

export type DocumentAst = {
  kind: "document";
  id: string;
  path: string | null;
  name: string;
  textHash: string;
  semanticHash: string;
  textLength: number;
  lineCount: number;
  blocks: LineNode[];
  outline: DocumentOutlineItem[];
  indexedAt: number;
};

export type ProjectAstFileStatus = "pending" | "indexed" | "error";

export type ProjectAstFile = {
  path: string;
  name: string;
  status: ProjectAstFileStatus;
  documentAst: DocumentAst | null;
  textHash: string | null;
  semanticHash: string | null;
  lineCount: number;
  textLength: number;
  outlineCount: number;
  indexedAt: number | null;
  error: string | null;
};

export type ProjectAstStatus = "idle" | "indexing" | "ready" | "partial" | "empty";

export type ProjectAst = {
  kind: "project";
  rootPath: string;
  name: string;
  status: ProjectAstStatus;
  files: ProjectAstFile[];
  indexedCount: number;
  pendingCount: number;
  errorCount: number;
  totalTextLength: number;
  totalLineCount: number;
  totalOutlineCount: number;
  updatedAt: number;
};

export type ProjectSearchMode = "structured" | "fullText";

export type ProjectSearchResultKind = "heading" | "body" | "fullText";

export type ProjectSearchResult = {
  id: string;
  kind: ProjectSearchResultKind;
  path: string;
  name: string;
  line: number;
  column: number;
  title: string | null;
  excerpt: string;
  headingChain: DocumentOutlineItem[];
  matchStart: number;
  matchLength: number;
  score: number;
};
