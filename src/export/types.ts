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

export type ExportCoverKind = "text" | "image";

export type ExportTocDepth = "file" | 1 | 2;

/** 前付け（表紙・目次）の体裁。プリセットに含めて作品間で使い回す。 */
export type ExportFrontMatterLayout = {
  cover: {
    enabled: boolean;
    kind: ExportCoverKind;
    align: "center" | "upper";
    /** タイトル文字サイズの本文比 */
    titleScale: number;
    /** 画像表紙の上にタイトル・副題・著者名を重ねる */
    overlayText: boolean;
    /** 重ねる文字の色（light = 白、dark = 黒） */
    textColor: "light" | "dark";
  };
  toc: {
    enabled: boolean;
    depth: ExportTocDepth;
    title: string;
  };
};

export type ExportCoverImage = {
  /** Vivliostyle が読み込む URL。 */
  url: string;
  mime: "image/png" | "image/jpeg";
  dataBase64: string;
  widthPx: number;
  heightPx: number;
};

/** 前付けの中身。作品ごとの値で、.then/project.json に保存する。 */
export type ExportFrontMatterContent = {
  subtitle?: string;
  author?: string;
  coverImage?: ExportCoverImage | null;
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
  frontMatter: ExportFrontMatterLayout;
};

export type ExportJob = {
  format: ExportFormat;
  title: string;
  sources: ExportSourceFile[];
  layout: ExportLayoutProfile;
  frontMatter?: ExportFrontMatterContent;
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
  | { kind: "code"; text: string }
  // Soft line break inside a paragraph (one editor line break). `text` is always
  // empty; it exists so every inline uniformly carries a `text` field.
  | { kind: "break"; text: string };

export type ExportBlock = {
  // "code" is one whole code block; its lines are joined with "break" inlines.
  kind: "blank" | "paragraph" | "heading" | "list" | "code";
  level: number;
  align: "start" | "center" | "end";
  inlines: ExportInline[];
  /** 目次から参照される見出しの id。 */
  anchorId?: string;
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
  /** 目次から参照されるセクションの id。 */
  anchorId?: string;
};

export type ExportTocEntry = {
  /** 参照先のセクションまたは見出しの anchorId。 */
  id: string;
  label: string;
  /** 0 = ファイル、1〜2 = その下の見出し（1字下げ単位）。 */
  indent: number;
};

export type ResolvedCoverText = {
  title: string;
  subtitle: string;
  author: string;
  align: ExportFrontMatterLayout["cover"]["align"];
  titleScale: number;
};

export type ResolvedExportCover =
  | ({ kind: "text" } & ResolvedCoverText)
  | {
    kind: "image";
    image: ExportCoverImage;
    /** 画像の上に重ねる文字。重ねないときは null。 */
    overlay: (ResolvedCoverText & { color: ExportFrontMatterLayout["cover"]["textColor"] }) | null;
  };

/** 解決済みの前付け。出力系はこれを描画するだけにする。 */
export type ResolvedFrontMatter = {
  cover: ResolvedExportCover | null;
  toc: { title: string; entries: ExportTocEntry[] } | null;
};

export type LinkedExportDocument = {
  schemaVersion: 2;
  title: string;
  layout: ExportLayoutProfile;
  sections: LinkedExportSection[];
  /** 表紙・目次のどちらかがあるときだけ入る。 */
  frontMatter?: ResolvedFrontMatter;
  author?: string;
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

export const DEFAULT_FRONT_MATTER_LAYOUT: ExportFrontMatterLayout = {
  cover: { enabled: false, kind: "text", align: "center", titleScale: 2, overlayText: false, textColor: "light" },
  toc: { enabled: false, depth: "file", title: "目次" },
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
  frontMatter: DEFAULT_FRONT_MATTER_LAYOUT,
};

/** 保存済みプリセットや前回レイアウトに前付けが無ければ、無効の既定値で補う。 */
export function withFrontMatterDefaults(layout: ExportLayoutProfile): ExportLayoutProfile {
  const stored = (layout as Partial<ExportLayoutProfile>).frontMatter;
  return {
    ...layout,
    frontMatter: {
      cover: { ...DEFAULT_FRONT_MATTER_LAYOUT.cover, ...stored?.cover },
      toc: { ...DEFAULT_FRONT_MATTER_LAYOUT.toc, ...stored?.toc },
    },
  };
}

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
