import JSZip from "jszip";
import type {
  ExportBlock,
  ExportDocument,
  ExportFontFamily,
  ExportInline,
  ExportLayoutProfile,
  ExportSourceFile,
  LinkedExportDocument,
  LinkedExportSection,
} from "./types";
import { DEFAULT_EXPORT_LAYOUT, resolvePageDimensions } from "./types";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

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

function normalRun(font: ExportFontFamily, text: string, extra = ""): string {
  if (!text) return "";
  return `<w:r>${runProperties(font, extra)}${textElement(text)}</w:r>`;
}

function rubyRun(
  font: ExportFontFamily,
  inline: Extract<ExportInline, { kind: "ruby" }>,
): string {
  return `<w:ruby><w:rubyPr><w:rubyAlign w:val="center"/><w:hps w:val="10"/><w:hpsRaise w:val="0"/><w:hpsBaseText w:val="20"/><w:lid w:val="ja-JP"/></w:rubyPr><w:rt>${normalRun(font, inline.reading, '<w:sz w:val="10"/><w:szCs w:val="10"/>')}</w:rt><w:rubyBase>${normalRun(font, inline.text)}</w:rubyBase></w:ruby>`;
}

function inlineXml(font: ExportFontFamily, inline: ExportInline): string {
  switch (inline.kind) {
    case "text": return normalRun(font, inline.text);
    case "bold": return normalRun(font, inline.text, "<w:b/><w:bCs/>");
    case "ruby": return rubyRun(font, inline);
    case "emphasis":
      return normalRun(font, inline.text, `<w:em w:val="${inline.style === "dot" ? "dot" : "comma"}"/>`);
    case "tcy":
      return normalRun(font, inline.text, '<w:eastAsianLayout w:vert="1" w:vertCompress="1"/>');
  }
}

function paragraphXml(font: ExportFontFamily, block: ExportBlock): string {
  if (block.kind === "blank") return "<w:p/>";
  const style = block.kind === "heading"
    ? `<w:pStyle w:val="Heading${Math.max(1, Math.min(6, block.level))}"/>`
    : "";
  const align = `<w:jc w:val="${block.align}"/>`;
  const keep = block.kind === "heading" ? "<w:keepNext/><w:keepLines/>" : "";
  return `<w:p><w:pPr>${style}${align}${keep}<w:widowControl/></w:pPr>${block.inlines.map((inline) => inlineXml(font, inline)).join("")}</w:p>`;
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

function sectionStart(nextSection: LinkedExportSection | undefined): string {
  if (!nextSection) return "nextPage";
  switch (nextSection.source.startMode) {
    case "continue": return "continuous";
    case "new-page": return "nextPage";
    case "odd-page": return "oddPage";
    case "even-page": return "evenPage";
  }
}

type PartReference = {
  id: string;
  type: "header" | "footer";
  variant: "default" | "even";
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
  const variants: Array<"default" | "even"> = document.layout.header.differentOddEven
    || ["outer", "inner"].includes(document.layout.footer.pageNumberPosition)
    ? ["default", "even"]
    : ["default"];

  for (const variant of variants) {
    const even = variant === "even";
    const headerText = headerValue(document, section, even);
    const topPageNumber = document.layout.footer.enabled
      && document.layout.footer.pageNumber
      && document.layout.footer.pageNumberPosition === "top-center";
    if (headerText || topPageNumber) {
      const target = `header${sectionIndex + 1}${even ? "Even" : ""}.xml`;
      const paragraphs = [
        topPageNumber ? paragraphWithValue(font, "", "center", true) : "",
        headerText ? paragraphWithValue(font, headerText, "center") : "",
      ].filter(Boolean).join("");
      references.push({ id: `rId${relationshipIndex++}`, type: "header", variant, target });
      files.push({
        path: `word/${target}`,
        xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${WORD_NS}">${paragraphs}</w:hdr>`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
      });
    }

    const footer = footerValue(document);
    const showInFooter = document.layout.footer.pageNumberPosition !== "top-center"
      && (footer.text || footer.isPageField);
    if (showInFooter) {
      const target = `footer${sectionIndex + 1}${even ? "Even" : ""}.xml`;
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

function sectionProperties(
  document: LinkedExportDocument,
  sectionIndex: number,
  sectionParts: SectionParts,
): string {
  const layout = document.layout;
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  const references = sectionParts.references
    .map((reference) => `<w:${reference.type}Reference w:type="${reference.variant}" r:id="${reference.id}"/>`)
    .join("");
  const type = sectionStart(document.sections[sectionIndex + 1]);
  const firstPageDifferent = layout.header.hideOnFirstPage
    || layout.header.hideOnTitlePage
    || layout.footer.hideOnFirstPage
    || layout.footer.hideOnTitlePage;
  const startNumber = sectionIndex === 0
    ? `<w:pgNumType w:start="${Math.max(1, Math.round(layout.footer.startPageNumber))}"/>`
    : "";
  return `<w:sectPr>${references}<w:type w:val="${type}"/><w:pgSz w:w="${mmToTwips(widthMm)}" w:h="${mmToTwips(heightMm)}"/><w:pgMar w:top="${mmToTwips(layout.page.marginTopMm)}" w:right="${mmToTwips(layout.page.marginInnerMm)}" w:bottom="${mmToTwips(layout.page.marginBottomMm)}" w:left="${mmToTwips(layout.page.marginOuterMm)}" w:header="567" w:footer="567" w:gutter="0"/><w:textDirection w:val="tbRl"/><w:cols w:num="${layout.body.columns}" w:space="${mmToTwips(layout.body.columnGapMm)}"/>${startNumber}${firstPageDifferent ? "<w:titlePg/>" : ""}</w:sectPr>`;
}

function documentXml(document: LinkedExportDocument, parts: SectionParts[]): string {
  const font = document.layout.body.fontFamily;
  const sections = document.sections.map((section, index) => {
    const paragraphs = section.blocks.map((block) => paragraphXml(font, block)).join("\n");
    if (index === document.sections.length - 1) return paragraphs;
    return `${paragraphs}<w:p><w:pPr>${sectionProperties(document, index, parts[index])}</w:pPr></w:p>`;
  }).join("\n");
  const finalIndex = document.sections.length - 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}"><w:body>${sections}${sectionProperties(document, finalIndex, parts[finalIndex])}</w:body></w:document>`;
}

function stylesXml(document: LinkedExportDocument): string {
  const font = wordFontName(document.layout.body.fontFamily);
  const pointSize = document.layout.body.fontSizeUnit === "Q"
    ? document.layout.body.fontSize * 0.711_319
    : document.layout.body.fontSize;
  const halfPoints = Math.max(12, Math.round(pointSize * 2));
  const lineTwips = Math.round(pointSize * document.layout.body.lineHeight * 20);
  const headings = [1.6, 1.4, 1.25, 1.15, 1.08, 1]
    .map((scale, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:b/><w:sz w:val="${Math.round(halfPoints * scale)}"/><w:szCs w:val="${Math.round(halfPoints * scale)}"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:style>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="${lineTwips}" w:lineRule="atLeast"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headings}</w:styles>`;
}

function settingsXml(document: LinkedExportDocument): string {
  const evenOdd = document.layout.header.differentOddEven
    || ["outer", "inner"].includes(document.layout.footer.pageNumberPosition);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${WORD_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:mirrorMargins/>${evenOdd ? "<w:evenAndOddHeaders/>" : ""}<w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
}

function packageRelationships(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function documentRelationships(parts: SectionParts[]): string {
  const fixed = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>',
  ];
  const dynamic = parts.flatMap((part) => part.references).map((reference) =>
    `<Relationship Id="${reference.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${reference.type}" Target="${reference.target}"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...fixed, ...dynamic].join("")}</Relationships>`;
}

function contentTypes(parts: SectionParts[]): string {
  const dynamic = parts.flatMap((part) => part.files)
    .map((file) => `<Override PartName="/${file.path}" ContentType="${file.contentType}"/>`)
    .join("");
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

  zip.file("[Content_Types].xml", contentTypes(sectionParts));
  zip.file("_rels/.rels", packageRelationships());
  zip.file("word/document.xml", documentXml(document, sectionParts));
  zip.file("word/styles.xml", stylesXml(document));
  zip.file("word/settings.xml", settingsXml(document));
  zip.file("word/_rels/document.xml.rels", documentRelationships(sectionParts));
  for (const file of sectionParts.flatMap((part) => part.files)) zip.file(file.path, file.xml);
  zip.file("word/fontTable.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="${WORD_NS}"><w:font w:name="${wordFont}"><w:family w:val="${font.includes("Serif") ? "roman" : "swiss"}"/><w:charset w:val="80"/></w:font></w:fonts>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(document.title)}</dc:title><dc:creator>Then</dc:creator><cp:lastModifiedBy>Then</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Then</Application><AppVersion>0.3.0</AppVersion></Properties>');

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
