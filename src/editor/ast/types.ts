export type LayoutAlign = "start" | "center" | "end";

export type LineKind = "blank" | "paragraph" | "heading" | "list" | "comment" | "code";

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
  type: "ruby" | "emphasis" | "tcy" | "layoutAlign" | "aozoraAnnotation" | "bold" | "code";
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
  /** Unicode code-point count including whitespace. */
  textLength: number;
  /** Unicode code-point count excluding half/full-width whitespace. */
  visibleTextLength: number;
  /** Part of textLength that is code (a whole code-block line, or inline code spans). */
  codeTextLength: number;
  /** Part of visibleTextLength that is code. */
  codeVisibleTextLength: number;
  /** For kind "code": whether this line is an opening or closing fence. */
  codeFence?: boolean;
  /** For an opening fence: the info string (language name etc.). */
  codeInfo?: string;
  length: number;
  inlineMarkups: InlineMarkup[];
};

export type DocumentOutlineItem = {
  id: string;
  blockId: string;
  title: string;
  level: number;
  line: number;
  /** Character count from this heading through the line before the next heading. */
  sectionTextLength: number;
  /** The same heading range count excluding half/full-width whitespace. */
  sectionVisibleTextLength: number;
  /** Part of sectionTextLength that is code (subtracted when code is not counted). */
  sectionCodeTextLength: number;
  /** Part of sectionVisibleTextLength that is code. */
  sectionCodeVisibleTextLength: number;
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
  /** 空白文字（半角・全角スペース、タブ、改行など）を除いた文字数。 */
  visibleTextLength: number;
  /** textLength のうちコード（コードブロックと行内コード）の文字数。 */
  codeTextLength: number;
  /** visibleTextLength のうちコードの文字数。 */
  codeVisibleTextLength: number;
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
  /** 空白文字を除いた文字数。 */
  visibleTextLength: number;
  /** textLength のうちコードの文字数。 */
  codeTextLength: number;
  /** visibleTextLength のうちコードの文字数。 */
  codeVisibleTextLength: number;
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
  absoluteFrom?: number;
  absoluteTo?: number;
  excerptBefore?: string;
  excerptMatch?: string;
  excerptAfter?: string;
  fileMatchCount?: number;
  score: number;
};

export type ProjectSearchOutcome = {
  results: ProjectSearchResult[];
  total: number;
  matchedFileCount: number;
  truncated: boolean;
  error: string | null;
};
