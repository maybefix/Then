export const exportFontFamilies = ["Noto Serif CJK JP", "Noto Sans CJK JP"] as const;

export type ExportFontFamily = (typeof exportFontFamilies)[number];

export type ExportFormat = "pdf" | "docx";

export type ExportViewState =
  | "idle"
  | "no-preview"
  | "preview-loading"
  | "preview-ready"
  | "preview-error"
  | "pdf-generating"
  | "pdf-complete";

export type ExportErrorKind =
  | "source-read"
  | "source-parse"
  | "style-generate"
  | "typeset"
  | "font-missing"
  | "pdf-generate"
  | "docx-generate";

export type ExportStartMode = "continue" | "new-page" | "odd-page" | "even-page";

export type ExportPageSize = "B6" | "A5" | "A6" | "B5" | "A4" | "custom";

export type ExportWritingMode = "vertical-rl" | "horizontal-tb";

export type ExportSourceFile = {
  id: string;
  path: string;
  extension: string;
  displayName: string;
  title?: string;
  chars?: number;
  enabled: boolean;
  order: number;
  startMode: ExportStartMode;
  markupMode: "then-markup";
};

export type LoadedExportSource = ExportSourceFile & {
  content: string;
};

export type ExportLayoutProfile = {
  name?: string;
  page: {
    size: ExportPageSize;
    widthMm?: number;
    heightMm?: number;
    marginTopMm: number;
    marginBottomMm: number;
    marginInnerMm: number;
    marginOuterMm: number;
    facingPages: boolean;
  };
  body: {
    writingMode: ExportWritingMode;
    columns: 1 | 2;
    columnGapMm: number;
    fontFamily: ExportFontFamily;
    fontSize: number;
    fontSizeUnit: "Q" | "pt";
    lineHeight: number;
  };
  header: {
    enabled: boolean;
    content: "none" | "title" | "chapter" | "file" | "custom";
    customText?: string;
    hideOnTitlePage: boolean;
    hideOnFirstPage: boolean;
    differentOddEven: boolean;
  };
  footer: {
    enabled: boolean;
    content: "none" | "page-number" | "title" | "custom";
    customText?: string;
    pageNumber: boolean;
    pageNumberPosition: "bottom-center" | "top-center" | "outer" | "inner";
    startPageNumber: number;
    hideOnTitlePage: boolean;
    hideOnFirstPage: boolean;
    differentOddEven: boolean;
  };
};

export type ExportJob = {
  format: ExportFormat;
  title: string;
  sources: ExportSourceFile[];
  layout: ExportLayoutProfile;
};

/** Compatibility shape retained for the single-document AST conversion boundary. */
export type ExportPage = {
  name: ExportPageSize;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
};

export type ExportInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "ruby"; text: string; reading: string; mode: "group" | "mono" }
  | { kind: "emphasis"; text: string; style: "auto" | "goma" | "dot" }
  | { kind: "tcy"; text: string }
  // Soft line break inside a paragraph (one editor line break). `text` is always
  // empty; it exists so every inline uniformly carries a `text` field.
  | { kind: "break"; text: string };

export type ExportBlock = {
  kind: "blank" | "paragraph" | "heading" | "list";
  level: number;
  align: "start" | "center" | "end";
  inlines: ExportInline[];
};

export type ExportDocument = {
  schemaVersion: 1;
  sourceAstId: string;
  sourceTextHash: string;
  title: string;
  fontFamily: ExportFontFamily;
  page: ExportPage;
  blocks: ExportBlock[];
};

export type LinkedExportSection = {
  source: ExportSourceFile;
  blocks: ExportBlock[];
  chapterTitle: string;
};

export type LinkedExportDocument = {
  schemaVersion: 2;
  title: string;
  layout: ExportLayoutProfile;
  sections: LinkedExportSection[];
};

export type ExportPageModel = {
  pageNumber: number;
  sourceId: string | null;
  sourceName: string;
  chapterTitle: string;
  isBlank: boolean;
  isSourceFirstPage: boolean;
  blocks: ExportBlock[];
};

export type ExportResult = {
  path: string;
  name: string;
};

export const EXPORT_PAGE_DIMENSIONS: Record<Exclude<ExportPageSize, "custom">, [number, number]> = {
  B6: [128, 182],
  A5: [148, 210],
  A6: [105, 148],
  B5: [182, 257],
  A4: [210, 297],
};

export const DEFAULT_EXPORT_LAYOUT: ExportLayoutProfile = {
  name: "標準・縦書き文庫",
  page: {
    size: "B6",
    marginTopMm: 18,
    marginBottomMm: 16,
    marginInnerMm: 20,
    marginOuterMm: 14,
    facingPages: true,
  },
  body: {
    writingMode: "vertical-rl",
    columns: 1,
    columnGapMm: 8,
    fontFamily: "Noto Serif CJK JP",
    fontSize: 13,
    fontSizeUnit: "Q",
    lineHeight: 1.75,
  },
  header: {
    enabled: true,
    content: "title",
    hideOnTitlePage: false,
    hideOnFirstPage: false,
    differentOddEven: false,
  },
  footer: {
    enabled: true,
    content: "page-number",
    pageNumber: true,
    pageNumberPosition: "bottom-center",
    startPageNumber: 1,
    hideOnTitlePage: false,
    hideOnFirstPage: false,
    differentOddEven: false,
  },
};

export function resolvePageDimensions(layout: ExportLayoutProfile): [number, number] {
  if (layout.page.size === "custom") {
    return [layout.page.widthMm ?? 128, layout.page.heightMm ?? 182];
  }
  return EXPORT_PAGE_DIMENSIONS[layout.page.size];
}

export const DEFAULT_EXPORT_PAGE: ExportPage = {
  name: "B6",
  widthMm: 128,
  heightMm: 182,
  marginTopMm: 18,
  marginRightMm: 20,
  marginBottomMm: 16,
  marginLeftMm: 14,
};
