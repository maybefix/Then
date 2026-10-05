import JSZip from "jszip";
import type {
  ExportBlock,
  ExportCoverImage,
  ExportDocument,
  ExportFontFamily,
  ExportInline,
  ExportLayoutProfile,
  ExportSourceFile,
  ExportTocEntry,
  LinkedExportDocument,
  LinkedExportSection,
  ResolvedCoverText,
  ResolvedExportCover,
  ResolvedFrontMatter,
} from "./types";
import { DEFAULT_EXPORT_LAYOUT, resolvePageDimensions } from "./types";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";

function wordFontName(font: ExportFontFamily): "Yu Mincho" | "Yu Gothic" {
  return font === "Noto Sans CJK JP" ? "Yu Gothic" : "Yu Mincho";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textElement(text: string): string {
  const preserve = /^\s|\s$|\s{2}/.test(text) ? ' xml:space="preserve"' : "";
  return `<w:t${preserve}>${escapeXml(text)}</w:t>`;
}

function runProperties(font: ExportFontFamily, extra = ""): string {
  const name = wordFontName(font);
  return `<w:rPr><w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:eastAsia="${name}" w:cs="${name}"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/>${extra}</w:rPr>`;
}

/** Gothic, fixed-pitch face for code in DOCX (bundled on Windows). */
const CODE_FONT = "MS Gothic";

function normalRun(font: ExportFontFamily, text: string, extra = ""): string {
  if (!text) return "";
  return `<w:r>${runProperties(font, extra)}${textElement(text)}</w:r>`;
}

function bodyPointSize(document: LinkedExportDocument): number {
  const body = document.layout.body;
  return body.fontSizeUnit === "Q" ? body.fontSize * 0.711_319 : body.fontSize;
}

function bodyHalfPoints(document: LinkedExportDocument): number {
  return Math.max(12, Math.round(bodyPointSize(document) * 2));
}

function rubyRun(
  font: ExportFontFamily,
  baseHalfPoints: number,
  inline: Extract<ExportInline, { kind: "ruby" }>,
): string {
  // Ruby (furigana) is ~half the base size and must be RAISED above the base —
  // hpsRaise:0 makes Word overlap the ruby on the body text. hpsBaseText must be
  // the real body size, not a fixed 10pt, or the ruby misaligns at other sizes.
  const rubySize = Math.max(10, Math.round(baseHalfPoints / 2));
  const rt = normalRun(
    font,
    inline.reading,
    `<w:sz w:val="${rubySize}"/><w:szCs w:val="${rubySize}"/>`,
  );
  return `<w:ruby><w:rubyPr><w:rubyAlign w:val="center"/><w:hps w:val="${rubySize}"/><w:hpsRaise w:val="${baseHalfPoints}"/><w:hpsBaseText w:val="${baseHalfPoints}"/><w:lid w:val="ja-JP"/></w:rubyPr><w:rt>${rt}</w:rt><w:rubyBase>${normalRun(font, inline.text)}</w:rubyBase></w:ruby>`;
}

function inlineXml(
  font: ExportFontFamily,
  baseHalfPoints: number,
  inline: ExportInline,
  writingMode: ExportLayoutProfile["body"]["writingMode"],
): string {
  switch (inline.kind) {
    case "text": return normalRun(font, inline.text);
    case "bold": return normalRun(font, inline.text, "<w:b/><w:bCs/>");
    case "ruby": return rubyRun(font, baseHalfPoints, inline);
    case "emphasis":
      return normalRun(font, inline.text, `<w:em w:val="${inline.style === "dot" ? "dot" : "comma"}"/>`);
    case "tcy":
      return writingMode === "vertical-rl"
        ? normalRun(font, inline.text, '<w:eastAsianLayout w:vert="1" w:vertCompress="1"/>')
        : normalRun(font, inline.text);
    case "code":
      return codeRun(inline.text);
    case "break":
      return "<w:r><w:br/></w:r>";
  }
}

/** Code keeps every space and uses a gothic face to stand apart from the body. */
function codeRun(text: string): string {
  return `<w:r><w:rPr><w:rFonts w:ascii="${CODE_FONT}" w:hAnsi="${CODE_FONT}" w:eastAsia="${CODE_FONT}" w:cs="${CODE_FONT}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraphXml(
  font: ExportFontFamily,
  baseHalfPoints: number,
  block: ExportBlock,
  writingMode: ExportLayoutProfile["body"]["writingMode"],
  // Runs placed before the paragraph's own text (TOC entry fields).
  leadingRuns = "",
): string {
  if (block.kind === "blank") return leadingRuns ? `<w:p>${leadingRuns}</w:p>` : "<w:p/>";
  if (block.kind === "code") {
    const runs = block.inlines
      .map((inline) => (inline.kind === "break" ? "<w:r><w:br/></w:r>" : codeRun(inline.text)))
      .join("");
    return `<w:p><w:pPr><w:jc w:val="start"/><w:widowControl/></w:pPr>${leadingRuns}${runs}</w:p>`;
  }
  const style = block.kind === "heading"
    ? `<w:pStyle w:val="Heading${Math.max(1, Math.min(6, block.level))}"/>`
    : "";
  const align = `<w:jc w:val="${block.align}"/>`;
  const keep = block.kind === "heading" ? "<w:keepNext/><w:keepLines/>" : "";
  return `<w:p><w:pPr>${style}${align}${keep}<w:widowControl/></w:pPr>${leadingRuns}${block.inlines.map((inline) => inlineXml(font, baseHalfPoints, inline, writingMode)).join("")}</w:p>`;
}

function mmToTwips(mm: number): number {
  return Math.round((mm / 25.4) * 1440);
}

function legacySource(document: ExportDocument): ExportSourceFile {
  return {
    id: document.sourceAstId,
    path: "",
    extension: "txt",
    displayName: `${document.title}.txt`,
    title: document.title,
    enabled: true,
    order: 0,
    startMode: "continue",
    markupMode: "then-markup",
  };
}

function normalizeDocument(document: ExportDocument | LinkedExportDocument): LinkedExportDocument {
  if (document.schemaVersion === 2) return document;
  const page = document.page;
  const layout: ExportLayoutProfile = {
    ...DEFAULT_EXPORT_LAYOUT,
    page: {
      ...DEFAULT_EXPORT_LAYOUT.page,
      size: page.name,
      widthMm: page.widthMm,
      heightMm: page.heightMm,
      marginTopMm: page.marginTopMm,
      marginBottomMm: page.marginBottomMm,
      marginInnerMm: page.marginRightMm,
      marginOuterMm: page.marginLeftMm,
    },
    body: { ...DEFAULT_EXPORT_LAYOUT.body, fontFamily: document.fontFamily },
  };
  return {
    schemaVersion: 2,
    title: document.title,
    layout,
    sections: [{ source: legacySource(document), chapterTitle: document.title, blocks: document.blocks }],
  };
}

// w:type describes how the section that owns the sectPr starts.
function sectionStart(document: LinkedExportDocument, sectionIndex: number): string {
  // After front matter the body opens on a new page; the front matter itself
  // ends on an even page when spreads are on (see frontMatterXml).
  if (sectionIndex === 0) return "nextPage";
  switch (document.sections[sectionIndex].source.startMode) {
    case "continue": return "continuous";
    case "new-page": return "nextPage";
    case "odd-page": return "oddPage";
    case "even-page": return "evenPage";
  }
}

type PartReference = {
  id: string;
  type: "header" | "footer";
  variant: "default" | "even" | "first";
  target: string;
};

type SectionParts = {
  references: PartReference[];
  files: Array<{ path: string; xml: string; contentType: string }>;
};

function pageField(font: ExportFontFamily): string {
  return `<w:fldSimple w:instr=" PAGE "><w:r>${runProperties(font)}<w:t>1</w:t></w:r></w:fldSimple>`;
}

function paragraphWithValue(
  font: ExportFontFamily,
  value: string,
  align: "left" | "center" | "right",
  isPageField = false,
): string {
  const content = isPageField ? pageField(font) : normalRun(font, value);
  return `<w:p><w:pPr><w:jc w:val="${align}"/></w:pPr>${content}</w:p>`;
}

function headerValue(document: LinkedExportDocument, section: LinkedExportSection, even: boolean): string {
  const header = document.layout.header;
  if (!header.enabled || header.content === "none") return "";
  if (header.differentOddEven && even) return document.title;
  switch (header.content) {
    case "title": return document.title;
    case "chapter": return section.chapterTitle;
    case "file": return section.source.displayName;
    case "custom": return header.customText ?? "";
  }
}

function footerValue(document: LinkedExportDocument): { text: string; isPageField: boolean } {
  const footer = document.layout.footer;
  if (!footer.enabled || footer.content === "none") return { text: "", isPageField: false };
  switch (footer.content) {
    case "page-number": return { text: "", isPageField: footer.pageNumber };
    case "title": return { text: document.title, isPageField: false };
    case "custom": return { text: footer.customText ?? "", isPageField: false };
  }
}

function headerHiddenOnSectionFirstPage(document: LinkedExportDocument, sectionIndex: number): boolean {
  const header = document.layout.header;
  if (!header.enabled || header.content === "none") return false;
  return header.hideOnTitlePage || (sectionIndex === 0 && header.hideOnFirstPage);
}

function footerHiddenOnSectionFirstPage(document: LinkedExportDocument, sectionIndex: number): boolean {
  const footer = document.layout.footer;
  if (!footer.enabled || footer.content === "none") return false;
  return footer.hideOnTitlePage || (sectionIndex === 0 && footer.hideOnFirstPage);
}

function horizontalAlignment(
  position: ExportLayoutProfile["footer"]["pageNumberPosition"],
  even: boolean,
): "left" | "center" | "right" {
  if (position === "outer") return even ? "left" : "right";
  if (position === "inner") return even ? "right" : "left";
  return "center";
}

function buildSectionParts(
  document: LinkedExportDocument,
  section: LinkedExportSection,
  sectionIndex: number,
  firstRelationshipId: number,
): SectionParts {
  const font = document.layout.body.fontFamily;
  const references: PartReference[] = [];
  const files: SectionParts["files"] = [];
  let relationshipIndex = firstRelationshipId;
  const hasEvenVariant = document.layout.header.differentOddEven
    || ["outer", "inner"].includes(document.layout.footer.pageNumberPosition)
    || false;
  const normalHeaderText = headerValue(document, section, false);
  const normalFooter = footerValue(document);
  const topPageNumber = document.layout.footer.enabled
    && document.layout.footer.pageNumber
    && document.layout.footer.pageNumberPosition === "top-center";
  const showFooterInFooter = document.layout.footer.pageNumberPosition !== "top-center"
    && (normalFooter.text || normalFooter.isPageField);
  const hasFirstHeaderDifference = (normalHeaderText || topPageNumber)
    && (headerHiddenOnSectionFirstPage(document, sectionIndex)
      || footerHiddenOnSectionFirstPage(document, sectionIndex));
  const hasFirstFooterDifference = showFooterInFooter
    && footerHiddenOnSectionFirstPage(document, sectionIndex);
  const useFirstVariant = hasFirstHeaderDifference || hasFirstFooterDifference;
  const variants: Array<"default" | "even" | "first"> = [
    "default",
    ...(hasEvenVariant ? ["even" as const] : []),
    ...(useFirstVariant ? ["first" as const] : []),
  ];

  for (const variant of variants) {
    const even = variant === "even";
    const first = variant === "first";
    const headerText = first && headerHiddenOnSectionFirstPage(document, sectionIndex)
      ? ""
      : headerValue(document, section, even);
    const pageNumberInHeader = topPageNumber
      && !(first && footerHiddenOnSectionFirstPage(document, sectionIndex));
    if (headerText || pageNumberInHeader) {
      const target = `header${sectionIndex + 1}${even ? "Even" : first ? "First" : ""}.xml`;
      const paragraphs = [
        pageNumberInHeader ? paragraphWithValue(font, "", "center", true) : "",
        headerText ? paragraphWithValue(font, headerText, "center") : "",
      ].filter(Boolean).join("");
      references.push({ id: `rId${relationshipIndex++}`, type: "header", variant, target });
      files.push({
        path: `word/${target}`,
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${WORD_NS}">${paragraphs}</w:hdr>`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
      });
    }

    const footer = first && footerHiddenOnSectionFirstPage(document, sectionIndex)
      ? { text: "", isPageField: false }
      : normalFooter;
    const showInFooter = document.layout.footer.pageNumberPosition !== "top-center"
      && (footer.text || footer.isPageField);
    if (showInFooter) {
      const target = `footer${sectionIndex + 1}${even ? "Even" : first ? "First" : ""}.xml`;
      const align = horizontalAlignment(document.layout.footer.pageNumberPosition, even);
      references.push({ id: `rId${relationshipIndex++}`, type: "footer", variant, target });
      files.push({
        path: `word/${target}`,
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${WORD_NS}">${paragraphWithValue(font, footer.text, align, footer.isPageField)}</w:ftr>`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
      });
    }
  }
  return { references, files };
}

function pageMargins(layout: ExportLayoutProfile): string {
  return `<w:pgMar w:top="${mmToTwips(layout.page.marginTopMm)}" w:right="${mmToTwips(layout.page.marginInnerMm)}" w:bottom="${mmToTwips(layout.page.marginBottomMm)}" w:left="${mmToTwips(layout.page.marginOuterMm)}" w:header="567" w:footer="567" w:gutter="0"/>`;
}

function pageSize(layout: ExportLayoutProfile): string {
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  return `<w:pgSz w:w="${mmToTwips(widthMm)}" w:h="${mmToTwips(heightMm)}"/>`;
}

function textDirection(layout: ExportLayoutProfile): string {
  return layout.body.writingMode === "vertical-rl" ? '<w:textDirection w:val="tbRl"/>' : "";
}

function sectionProperties(
  document: LinkedExportDocument,
  sectionIndex: number,
  sectionParts: SectionParts,
): string {
  const layout = document.layout;
  const references = sectionParts.references
    .map((reference) => `<w:${reference.type}Reference w:type="${reference.variant}" r:id="${reference.id}"/>`)
    .join("");
  const type = sectionStart(document, sectionIndex);
  const firstPageDifferent = sectionParts.references.some((reference) => reference.variant === "first")
    || headerHiddenOnSectionFirstPage(document, sectionIndex)
    || footerHiddenOnSectionFirstPage(document, sectionIndex);
  const startNumber = sectionIndex === 0
    ? `<w:pgNumType w:start="${Math.max(1, Math.round(layout.footer.startPageNumber))}"/>`
    : "";
  return `<w:sectPr>${references}<w:type w:val="${type}"/>${pageSize(layout)}${pageMargins(layout)}${startNumber}<w:cols w:num="${layout.body.columns}" w:space="${mmToTwips(layout.body.columnGapMm)}"/>${firstPageDifferent ? "<w:titlePg/>" : ""}${textDirection(layout)}</w:sectPr>`;
}

// Front-matter sections have no header/footer references and no page-number
// restart, so their pages are unnumbered and numbered physically from 1.
function frontSectionProperties(
  layout: ExportLayoutProfile,
  options: { vAlign?: "center" | "top"; bleed?: boolean } = {},
): string {
  if (options.bleed) {
    return `<w:sectPr><w:type w:val="nextPage"/>${pageSize(layout)}<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="0"/></w:sectPr>`;
  }
  const vAlign = options.vAlign ? `<w:vAlign w:val="${options.vAlign}"/>` : "";
  return `<w:sectPr><w:type w:val="nextPage"/>${pageSize(layout)}${pageMargins(layout)}<w:cols w:space="0"/>${vAlign}${textDirection(layout)}</w:sectPr>`;
}

function frontRun(font: ExportFontFamily, text: string, halfPoints: number, bold = false, color = ""): string {
  const name = wordFontName(font);
  const weight = bold ? "<w:b/><w:bCs/>" : "";
  const fill = color ? `<w:color w:val="${color}"/>` : "";
  return `<w:r><w:rPr><w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:eastAsia="${name}" w:cs="${name}"/>${weight}${fill}<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr>${textElement(text)}</w:r>`;
}

function fieldInstruction(instruction: string): string {
  return `<w:r><w:instrText xml:space="preserve">${escapeXml(instruction)}</w:instrText></w:r>`;
}

const FIELD_BEGIN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const FIELD_SEPARATE = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const FIELD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function fieldText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * A TC field registers a TOC entry at its position without printing anything.
 * Word inserts TC fields as hidden text; without that, Word shows the field
 * code `{ TC "…" \l 1 }` in the body.
 */
function tocEntryField(entry: ExportTocEntry): string {
  const hidden = "<w:rPr><w:vanish/></w:rPr>";
  const instruction = escapeXml(` TC "${fieldText(entry.label)}" \\l ${entry.indent + 1} `);
  return `<w:r>${hidden}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${hidden}<w:instrText xml:space="preserve">${instruction}</w:instrText></w:r><w:r>${hidden}<w:fldChar w:fldCharType="end"/></w:r>`;
}

function inlineMeasureMm(layout: ExportLayoutProfile): number {
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  return layout.body.writingMode === "vertical-rl"
    ? heightMm - layout.page.marginTopMm - layout.page.marginBottomMm
    : widthMm - layout.page.marginInnerMm - layout.page.marginOuterMm;
}

function coverTextXml(
  document: LinkedExportDocument,
  cover: ResolvedCoverText,
  // Overlay on an image cover: text colour and the picture run, which is
  // anchored to the page so it does not take part in the text flow.
  options: { color?: string; leadingRuns?: string } = {},
): string {
  const layout = document.layout;
  const font = layout.body.fontFamily;
  const half = bodyHalfPoints(document);
  const vertical = layout.body.writingMode === "vertical-rl";
  const upper = cover.align === "upper";
  const [, heightMm] = resolvePageDimensions(layout);
  const areaHeightMm = heightMm - layout.page.marginTopMm - layout.page.marginBottomMm;
  // Upper placement: vertical text starts lower than the top edge (inline
  // indent); horizontal text is pushed down from the top (space before).
  const jc = upper && vertical ? "start" : "center";
  const indent = upper && vertical ? `<w:ind w:left="${mmToTwips(areaHeightMm * 0.12)}"/>` : "";
  const lines = [
    { text: cover.title, size: Math.round(half * cover.titleScale), bold: true, after: Math.round(half * cover.titleScale * 6) },
    { text: cover.subtitle, size: Math.round(half * 1.25), bold: false, after: Math.round(half * 1.25 * 16) },
    { text: cover.author, size: Math.round(half * 1.15), bold: false, after: 0 },
  ].filter((line) => line.text);
  const sectPr = frontSectionProperties(layout, { vAlign: upper && !vertical ? "top" : "center" });
  return lines.map((line, index) => {
    const before = index === 0 && upper && !vertical ? mmToTwips(areaHeightMm * 0.18) : 0;
    const last = index === lines.length - 1;
    const leading = index === 0 ? options.leadingRuns ?? "" : "";
    return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${line.after}"/>${indent}<w:jc w:val="${jc}"/>${last ? sectPr : ""}</w:pPr>${leading}${frontRun(font, line.text, line.size, line.bold, options.color)}</w:p>`;
  }).join("");
}

const COVER_IMAGE_RELATIONSHIP_ID = "rIdThenCover";

function coverImageFileName(image: ExportCoverImage): string {
  return image.mime === "image/png" ? "cover.png" : "cover.jpeg";
}

// The cover picture is anchored to the page corner at full page size, cropped
// like object-fit: cover so it bleeds without distortion.
function coverDrawingRun(layout: ExportLayoutProfile, image: ExportCoverImage): string {
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  const cx = Math.round(widthMm * 36_000);
  const cy = Math.round(heightMm * 36_000);
  const imageAspect = image.widthPx / Math.max(1, image.heightPx);
  const pageAspect = widthMm / heightMm;
  const crop = (visible: number) => Math.max(0, Math.round(((1 - visible) / 2) * 100_000));
  const srcRect = imageAspect > pageAspect
    ? `<a:srcRect l="${crop(pageAspect / imageAspect)}" r="${crop(pageAspect / imageAspect)}"/>`
    : `<a:srcRect t="${crop(imageAspect / pageAspect)}" b="${crop(imageAspect / pageAspect)}"/>`;
  const name = coverImageFileName(image);
  const drawing = `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Cover"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${COVER_IMAGE_RELATIONSHIP_ID}"/>${srcRect}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  return `<w:r>${drawing}</w:r>`;
}

function coverImageXml(document: LinkedExportDocument, cover: Extract<ResolvedExportCover, { kind: "image" }>): string {
  const layout = document.layout;
  const drawing = coverDrawingRun(layout, cover.image);
  // Overlaid text keeps the normal page margins; the picture still bleeds
  // because it is positioned relative to the page, behind the text.
  if (cover.overlay) {
    const color = cover.overlay.color === "light" ? "FFFFFF" : "111111";
    return coverTextXml(document, cover.overlay, { color, leadingRuns: drawing });
  }
  return `<w:p><w:pPr>${frontSectionProperties(layout, { bleed: true })}</w:pPr>${drawing}</w:p>`;
}

// `IF MOD(PAGE,2) = 1` inserts a page break only when the TOC ends on an odd
// page, so the body (a nextPage section) always opens on an odd page. Word
// decides odd/even section breaks by the page NUMBER, and the body restarts
// numbering, so a plain oddPage break cannot express "next physical recto".
function evenPagePadding(): string {
  return `${FIELD_BEGIN}${fieldInstruction(" IF ")}${FIELD_BEGIN}${fieldInstruction(" =MOD(")}${FIELD_BEGIN}${fieldInstruction(" PAGE ")}${FIELD_SEPARATE}<w:r><w:t>1</w:t></w:r>${FIELD_END}${fieldInstruction(",2) ")}${FIELD_SEPARATE}<w:r><w:t>1</w:t></w:r>${FIELD_END}${fieldInstruction(' = 1 "')}<w:r><w:br w:type="page"/></w:r>${fieldInstruction('" "" ')}${FIELD_SEPARATE}${FIELD_END}`;
}

function tocXml(document: LinkedExportDocument, toc: NonNullable<ResolvedFrontMatter["toc"]>): string {
  const layout = document.layout;
  const font = layout.body.fontFamily;
  const half = bodyHalfPoints(document);
  const title = `<w:p><w:pPr><w:pStyle w:val="ThenTocTitle"/></w:pPr>${frontRun(font, toc.title, Math.round(half * 1.3), true)}</w:p>`;
  // The cached result lists the entries without page numbers; Word fills in
  // the numbers when it updates the field on open (settings: updateFields).
  const entries = toc.entries.map((entry, index) => {
    const begin = index === 0
      ? `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>${fieldInstruction(' TOC \\f \\l "1-3" \\h \\z ')}${FIELD_SEPARATE}`
      : "";
    const end = index === toc.entries.length - 1 ? FIELD_END : "";
    return `<w:p><w:pPr><w:pStyle w:val="TOC${entry.indent + 1}"/></w:pPr>${begin}${frontRun(font, entry.label, half)}${end}</w:p>`;
  }).join("");
  const padding = layout.page.facingPages ? evenPagePadding() : "";
  return `${title}${entries}<w:p><w:pPr>${frontSectionProperties(layout)}</w:pPr>${padding}</w:p>`;
}

/** A section holding one empty page (the back of the cover in spreads). */
function blankPageXml(layout: ExportLayoutProfile): string {
  return `<w:p><w:pPr>${frontSectionProperties(layout)}</w:pPr></w:p>`;
}

function frontMatterXml(document: LinkedExportDocument): string {
  const frontMatter = document.frontMatter;
  if (!frontMatter) return "";
  const layout = document.layout;
  const parts: string[] = [];
  if (frontMatter.cover) {
    parts.push(frontMatter.cover.kind === "image"
      ? coverImageXml(document, frontMatter.cover)
      : coverTextXml(document, frontMatter.cover));
    // The cover is always exactly one page, so its back is a plain blank page.
    if (layout.page.facingPages) parts.push(blankPageXml(layout));
  }
  if (frontMatter.toc) parts.push(tocXml(document, frontMatter.toc));
  return parts.join("\n");
}

function documentXml(document: LinkedExportDocument, parts: SectionParts[]): string {
  const font = document.layout.body.fontFamily;
  const half = bodyHalfPoints(document);
  const tocEntries = new Map((document.frontMatter?.toc?.entries ?? []).map((entry) => [entry.id, entry]));
  const entryField = (id: string | undefined) => {
    const entry = id ? tocEntries.get(id) : undefined;
    return entry ? tocEntryField(entry) : "";
  };
  const sections = document.sections.map((section, index) => {
    const sectionField = entryField(section.anchorId);
    const blocks = section.blocks.length > 0 || !sectionField
      ? section.blocks
      : [{ kind: "blank" as const, level: 0, align: "start" as const, inlines: [] }];
    const paragraphs = blocks
      .map((block, blockIndex) => paragraphXml(
        font,
        half,
        block,
        document.layout.body.writingMode,
        `${blockIndex === 0 ? sectionField : ""}${entryField(block.anchorId)}`,
      ))
      .join("\n");
    if (index === document.sections.length - 1) return paragraphs;
    return `${paragraphs}<w:p><w:pPr>${sectionProperties(document, index, parts[index])}</w:pPr></w:p>`;
  }).join("\n");
  const finalIndex = document.sections.length - 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}" xmlns:wp="${WP_NS}" xmlns:a="${DRAWING_NS}" xmlns:pic="${PIC_NS}"><w:body>${frontMatterXml(document)}${sections}${sectionProperties(document, finalIndex, parts[finalIndex])}</w:body></w:document>`;
}

function stylesXml(document: LinkedExportDocument): string {
  const font = wordFontName(document.layout.body.fontFamily);
  const pointSize = bodyPointSize(document);
  const halfPoints = bodyHalfPoints(document);
  const lineTwips = Math.round(pointSize * document.layout.body.lineHeight * 20);
  const headings = [1.6, 1.4, 1.25, 1.15, 1.08, 1]
    .map((scale, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:b/><w:sz w:val="${Math.round(halfPoints * scale)}"/><w:szCs w:val="${Math.round(halfPoints * scale)}"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:style>`)
    .join("");
  const toc = document.frontMatter?.toc ? tocStylesXml(document, font, halfPoints) : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="${lineTwips}" w:lineRule="atLeast"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headings}${toc}</w:styles>`;
}

// Word rebuilds the TOC with the built-in "toc N" styles: a dotted leader to a
// right tab at the end of the line, and one character of indent per level.
function tocStylesXml(document: LinkedExportDocument, font: string, halfPoints: number): string {
  const tabPos = mmToTwips(inlineMeasureMm(document.layout));
  const charTwips = halfPoints * 10;
  const levels = [1, 2, 3]
    .map((level) => `<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${tabPos}"/></w:tabs><w:spacing w:after="0"/><w:ind w:left="${charTwips * (level - 1)}"/></w:pPr></w:style>`)
    .join("");
  const titleSize = Math.round(halfPoints * 1.3);
  return `${levels}<w:style w:type="paragraph" w:styleId="ThenTocTitle"><w:name w:val="Then TOC Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="${titleSize * 10}"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:b/><w:bCs/><w:sz w:val="${titleSize}"/><w:szCs w:val="${titleSize}"/></w:rPr></w:style>`;
}

function settingsXml(document: LinkedExportDocument): string {
  const evenOdd = document.layout.header.differentOddEven
    || ["outer", "inner"].includes(document.layout.footer.pageNumberPosition);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${WORD_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:mirrorMargins/>${evenOdd ? "<w:evenAndOddHeaders/>" : ""}<w:characterSpacingControl w:val="doNotCompress"/>${document.frontMatter?.toc ? '<w:updateFields w:val="true"/>' : ""}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
}

function packageRelationships(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function coverImage(document: LinkedExportDocument): ExportCoverImage | null {
  const cover = document.frontMatter?.cover;
  return cover?.kind === "image" ? cover.image : null;
}

function documentRelationships(document: LinkedExportDocument, parts: SectionParts[]): string {
  const fixed = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>',
  ];
  const dynamic = parts.flatMap((part) => part.references).map((reference) =>
    `<Relationship Id="${reference.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${reference.type}" Target="${reference.target}"/>`);
  const image = coverImage(document);
  if (image) {
    dynamic.push(`<Relationship Id="${COVER_IMAGE_RELATIONSHIP_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${coverImageFileName(image)}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...fixed, ...dynamic].join("")}</Relationships>`;
}

function contentTypes(document: LinkedExportDocument, parts: SectionParts[]): string {
  const image = coverImage(document);
  const dynamic = parts.flatMap((part) => part.files)
    .map((file) => `<Override PartName="/${file.path}" ContentType="${file.contentType}"/>`)
    .join("")
    + (image ? `<Override PartName="/word/media/${coverImageFileName(image)}" ContentType="${image.mime}"/>` : "");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${dynamic}</Types>`;
}

export async function generateVerticalDocx(
  input: ExportDocument | LinkedExportDocument,
): Promise<Uint8Array> {
  const document = normalizeDocument(input);
  const font = document.layout.body.fontFamily;
  const wordFont = wordFontName(font);
  const now = new Date().toISOString();
  const zip = new JSZip();
  let nextRelationshipId = 4;
  const sectionParts = document.sections.map((section, index) => {
    const parts = buildSectionParts(document, section, index, nextRelationshipId);
    nextRelationshipId += parts.references.length;
    return parts;
  });

  zip.file("[Content_Types].xml", contentTypes(document, sectionParts));
  zip.file("_rels/.rels", packageRelationships());
  zip.file("word/document.xml", documentXml(document, sectionParts));
  zip.file("word/styles.xml", stylesXml(document));
  zip.file("word/settings.xml", settingsXml(document));
  zip.file("word/_rels/document.xml.rels", documentRelationships(document, sectionParts));
  const image = coverImage(document);
  if (image) zip.file(`word/media/${coverImageFileName(image)}`, image.dataBase64, { base64: true });
  for (const file of sectionParts.flatMap((part) => part.files)) zip.file(file.path, file.xml);
  zip.file("word/fontTable.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="${WORD_NS}"><w:font w:name="${wordFont}"><w:family w:val="${font.includes("Serif") ? "roman" : "swiss"}"/><w:charset w:val="80"/></w:font></w:fonts>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(document.title)}</dc:title><dc:creator>${escapeXml(document.author || "Then")}</dc:creator><cp:lastModifiedBy>Then</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Then</Application><AppVersion>0.3.0</AppVersion></Properties>');

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
