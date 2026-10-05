// Builds a *flowing* HTML document (not pre-paginated) for the Vivliostyle
// Viewer to typeset with CSS Paged Media. The Viewer is loaded as a separate
// program (see the Rust export_pdf_vivliostyle command); this module only
// produces the source document. Pagination, running headers and page numbers
// are expressed as @page rules so Vivliostyle — not our own code — lays out the
// pages, after which WebView2 PrintToPdf serializes them.
import { exportBlockHtml, exportImageCss } from "./linkedDocument";
import type {
  ExportLayoutProfile,
  LinkedExportDocument,
  LinkedExportSection,
  ResolvedCoverText,
  ResolvedFrontMatter,
} from "./types";
import { resolvePageDimensions } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fontFile(family: ExportLayoutProfile["body"]["fontFamily"]): string {
  return family === "Noto Sans CJK JP"
    ? "NotoSansCJKjp-Regular.otf"
    : "NotoSerifCJKjp-Regular.otf";
}

function bodyFontSize(body: ExportLayoutProfile["body"]): string {
  return body.fontSizeUnit === "Q" ? `${body.fontSize * 0.25}mm` : `${body.fontSize}pt`;
}

function breakBefore(mode: LinkedExportSection["source"]["startMode"]): string {
  switch (mode) {
    case "new-page": return "page";
    case "odd-page": return "recto";
    case "even-page": return "verso";
    default: return "auto";
  }
}

// Header text that is a fixed string (title/custom). Running values (chapter,
// file) are emitted as named strings and referenced with string().
function headerContent(layout: ExportLayoutProfile, title: string): string | null {
  const h = layout.header;
  if (!h.enabled || h.content === "none") return null;
  switch (h.content) {
    case "title": return cssString(title);
    case "custom": return cssString(h.customText ?? "");
    case "chapter": return "string(chaptertitle)";
    case "file": return "string(sourcename)";
  }
}

function footerContent(layout: ExportLayoutProfile, title: string): string | null {
  const f = layout.footer;
  if (!f.enabled || f.content === "none") return null;
  switch (f.content) {
    case "page-number": return f.pageNumber ? "counter(page)" : null;
    case "title": return cssString(title);
    case "custom": return cssString(f.customText ?? "");
  }
}

// Maps the footer page-number position to a pair of @page margin boxes. "outer"
// and "inner" depend on the spread side, so they are emitted per :recto/:verso.
// Margin boxes stay horizontal regardless of the body writing mode.
const MARGIN_BOX_STYLE = "font-size: 8pt; color: #555; writing-mode: horizontal-tb; text-orientation: mixed;";

function footerBoxes(layout: ExportLayoutProfile, content: string): string {
  const pos = layout.footer.pageNumberPosition;
  const box = (name: string) => `@${name} { content: ${content}; ${MARGIN_BOX_STYLE} }`;
  switch (pos) {
    case "top-center": return `@page { @top-center { content: ${content}; ${MARGIN_BOX_STYLE} } }`;
    case "bottom-center": return `@page { ${box("bottom-center")} }`;
    case "outer":
      return `@page :recto { ${box("bottom-left")} }\n@page :verso { ${box("bottom-right")} }`;
    case "inner":
      return `@page :recto { ${box("bottom-right")} }\n@page :verso { ${box("bottom-left")} }`;
  }
}

// Front matter (cover, table of contents) lives on named pages that carry no
// running header/nombre and do not advance the page counter; only the first
// front page adds startPageNumber-1, so the body opens at startPageNumber.
// The body is NOT counter-reset: Vivliostyle resolves target-counter() against
// an element-level `page` counter once one exists, which breaks the TOC numbers.
const COVER_PAGE = "thencover";
const FRONT_PAGE = "thenfront";
const MAIN_PAGE = "thenmain";
const MARGIN_BOX_NAMES = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

function emptyMarginBoxes(): string {
  return MARGIN_BOX_NAMES.map((name) => `@${name} { content: none; }`).join(" ");
}

function frontMatterCss(document: LinkedExportDocument, frontMatter: ResolvedFrontMatter): string {
  const layout = document.layout;
  const page = layout.page;
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  const isHorizontal = layout.body.writingMode === "horizontal-tb";
  const start = Math.max(1, Math.round(layout.footer.startPageNumber || 1));
  const none = emptyMarginBoxes();
  const areaWidth = Math.max(10, widthMm - page.marginInnerMm - page.marginOuterMm);
  const areaHeight = Math.max(10, heightMm - page.marginTopMm - page.marginBottomMm);
  const cover = frontMatter.cover;
  const coverText = cover?.kind === "image" ? cover.overlay : cover;
  const textCss = coverText
    ? `.then-cover-box { box-sizing: border-box; width: ${areaWidth}mm; height: ${areaHeight - 1}mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.then-cover-upper .then-cover-box { ${isHorizontal
      ? `justify-content: flex-start; padding-top: ${(areaHeight * 0.18).toFixed(2)}mm;`
      : `text-align: start; padding-top: ${(areaHeight * 0.12).toFixed(2)}mm;`} }
p.then-cover-title { font-size: ${coverText.titleScale}em; font-weight: 700; line-height: 1.4; margin-block: 0 0.6em; text-align: inherit; }
p.then-cover-subtitle { font-size: 1.25em; margin-block: 0 1.6em; text-align: inherit; }
p.then-cover-author { font-size: 1.15em; margin-block: 0; text-align: inherit; }`
    : "";
  // The image cover page has no margins; the picture is the page-size box's
  // background (object-fit: cover equivalent) and any overlaid text sits in
  // that box inside padding equal to the usual (recto) page margins.
  const imageCss = cover?.kind === "image"
    ? `.then-fm-cover-image { page: ${COVER_PAGE}; }
.then-cover-image { box-sizing: border-box; width: ${widthMm}mm; height: ${heightMm}mm; padding: ${page.marginTopMm}mm ${page.marginOuterMm}mm ${page.marginBottomMm}mm ${page.marginInnerMm}mm; background-position: center; background-size: cover; background-repeat: no-repeat; }
.then-cover-light { color: #fff; text-shadow: 0 0 0.3em rgba(0, 0, 0, 0.6); }
.then-cover-dark { color: #111; text-shadow: 0 0 0.3em rgba(255, 255, 255, 0.7); }`
    : "";
  const coverCss = `${textCss}
${imageCss}`;
  const tocBreak = cover ? (page.facingPages ? "recto" : "page") : "auto";
  const tocCss = frontMatter.toc
    ? `.then-toc { break-before: ${tocBreak}; }
p.then-toc-title { font-size: 1.3em; font-weight: 700; margin-block: 0 1.2em; }
.then-toc-list { list-style: none; margin: 0; padding: 0; }
.then-toc-entry { margin: 0; padding: 0; }
.then-toc-indent-1 { padding-inline-start: 1em; }
.then-toc-indent-2 { padding-inline-start: 2em; }
.then-toc-link { display: flex; color: inherit; text-decoration: none; }
.then-toc-label { flex: 0 1 auto; }
.then-toc-leader { flex: 1 1 auto; min-inline-size: 2em; margin-inline: 0.3em; margin-block-end: ${isHorizontal ? "0.45em" : "0.8em"}; border-block-end: 1px dotted currentColor; }
.then-toc-link::after { content: target-counter(attr(href url), page); flex: none;${isHorizontal ? "" : " text-combine-upright: all;"} }`
    : "";
  return `@page ${COVER_PAGE} { margin: 0; counter-increment: page 0; ${none} }
@page ${FRONT_PAGE} { counter-increment: page 0; ${none} }
@page ${COVER_PAGE}:first, ${FRONT_PAGE}:first { counter-increment: page ${start - 1}; }
@page ${MAIN_PAGE}:nth(1 of ${MAIN_PAGE}):blank { counter-increment: page 0; ${none} }
.then-fm { page: ${FRONT_PAGE}; }
${coverCss}
${tocCss}`;
}

function coverTextHtml(text: ResolvedCoverText): string {
  const lines = [
    `<p class="then-cover-title">${escapeHtml(text.title)}</p>`,
    text.subtitle ? `<p class="then-cover-subtitle">${escapeHtml(text.subtitle)}</p>` : "",
    text.author ? `<p class="then-cover-author">${escapeHtml(text.author)}</p>` : "",
  ].join("");
  return `<div class="then-cover-box">${lines}</div>`;
}

function frontMatterHtml(frontMatter: ResolvedFrontMatter): string {
  const parts: string[] = [];
  const cover = frontMatter.cover;
  if (cover?.kind === "image") {
    const src = (cover.image.url || `data:${cover.image.mime};base64,${cover.image.dataBase64}`).replace(/"/g, "%22");
    const overlay = cover.overlay;
    const color = overlay ? ` then-cover-${overlay.color}` : "";
    const align = overlay ? ` then-cover-${overlay.align}` : "";
    parts.push(`<section class="then-fm-cover-image${align}"><div class="then-cover-image${color}" style="${escapeHtml(`background-image: url("${src}");`)}">${overlay ? coverTextHtml(overlay) : ""}</div></section>`);
  } else if (cover?.kind === "text") {
    parts.push(`<section class="then-fm then-fm-cover then-cover-${cover.align}">${coverTextHtml(cover)}</section>`);
  }
  if (frontMatter.toc) {
    const entries = frontMatter.toc.entries.map((entry) =>
      `<li class="then-toc-entry then-toc-indent-${entry.indent}"><a class="then-toc-link" href="#${escapeHtml(entry.id)}"><span class="then-toc-label">${escapeHtml(entry.label)}</span><span class="then-toc-leader"></span></a></li>`,
    ).join("");
    parts.push(`<nav class="then-fm then-toc"><p class="then-toc-title">${escapeHtml(frontMatter.toc.title)}</p><ol class="then-toc-list">${entries}</ol></nav>`);
  }
  return parts.join("\n");
}

export function buildLinkedVivliostyleHtml(
  document: LinkedExportDocument,
  baseUrl = window.location.href,
): string {
  const layout = document.layout;
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  const body = layout.body;
  const page = layout.page;
  const fontUrl = new URL(`/fonts/${fontFile(body.fontFamily)}`, baseUrl).href;
  const isHorizontal = body.writingMode === "horizontal-tb";
  const emphasisPosition = isHorizontal ? "over" : "over right";
  const tcyStyle = isHorizontal ? "none" : "all";

  const header = headerContent(layout, document.title);
  const footer = footerContent(layout, document.title);
  const headerBox = header
    ? `@page { @top-center { content: ${header}; ${MARGIN_BOX_STYLE} } }`
    : "";
  const footerBox = footer ? footerBoxes(layout, footer) : "";
  // Page-number offset: counter(page) starts at 1, shift to the requested start.
  const startOffset = Math.max(0, (layout.footer.startPageNumber || 1) - 1);
  const frontMatter = document.frontMatter;
  const sideBreak = page.facingPages ? "recto" : "page";

  const sectionsHtml = document.sections
    .map((section, index) => {
      // With front matter the body always opens on a fresh (recto) page.
      const brk = index === 0
        ? frontMatter ? sideBreak : "auto"
        : breakBefore(section.source.startMode);
      const sourceName = section.source.displayName.replace(/\.(?:txt|md)$/i, "");
      // A zero-height marker carries the running file-name string for this section.
      const marker = `<span class="then-viv-srcmark" style="string-set: sourcename ${cssString(sourceName)};"></span>`;
      const blocks = section.blocks.map(exportBlockHtml).join("\n");
      const id = section.anchorId ? ` id="${escapeHtml(section.anchorId)}"` : "";
      return `<section${id} class="then-viv-section" style="break-before: ${brk};">${marker}${blocks}</section>`;
    })
    .join("\n");
  const columnsCss = body.columns > 1
    ? `column-count: ${body.columns}; column-gap: ${body.columnGapMm}mm; column-fill: auto;`
    : "";
  const documentHtml = frontMatter
    ? `${frontMatterHtml(frontMatter)}<div class="then-main">${sectionsHtml}</div>`
    : sectionsHtml;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<base href="${escapeHtml(baseUrl)}">
<title>${escapeHtml(document.title)}</title>
<style>
@font-face {
  font-family: "${body.fontFamily}";
  src: url("${fontUrl}") format("opentype");
  font-style: normal; font-weight: 400; font-display: block;
}
@page {
  size: ${widthMm}mm ${heightMm}mm;
  margin-top: ${page.marginTopMm}mm;
  margin-bottom: ${page.marginBottomMm}mm;
}
@page :recto { margin-left: ${page.marginInnerMm}mm; margin-right: ${page.marginOuterMm}mm; }
@page :verso { margin-left: ${page.marginOuterMm}mm; margin-right: ${page.marginInnerMm}mm; }
${headerBox}
${footerBox}
${frontMatter ? frontMatterCss(document, frontMatter) : ""}
:root {
  font-family: "${body.fontFamily}", serif;
  font-size: ${bodyFontSize(body)};
  line-height: ${body.lineHeight};
  writing-mode: ${body.writingMode};
  text-orientation: mixed;
  orphans: 2; widows: 2;
}
html, body { margin: 0; padding: 0; }
body {
  color: #000; background: #fff;
  line-break: strict; word-break: normal; overflow-wrap: break-word;
  ${frontMatter ? "" : `${columnsCss}
  counter-reset: page ${startOffset};`}
}
${frontMatter ? `.then-main { page: ${MAIN_PAGE}; ${columnsCss} }` : ""}
.then-viv-section { break-after: auto; }
.then-viv-srcmark { display: inline; font-size: 0; line-height: 0; }
p, h1, h2, h3, h4, h5, h6 { margin-block: 0 0.9em; margin-inline: 0; padding: 0; text-align: start; }
p.then-blank { margin-block-end: 0.9em; }
h1, h2, h3, h4, h5, h6 { break-after: avoid-page; font-weight: 700; string-set: chaptertitle content(text); }
h1 { font-size: 1.4em; }
h2 { font-size: 1.25em; }
h3 { font-size: 1.15em; }
.then-align-center { text-align: center; }
.then-align-end { text-align: end; }
ruby { ruby-align: center; ruby-position: over; }
rt { font-size: 0.5em; }
.then-emphasis { text-emphasis-position: ${emphasisPosition}; }
.then-emphasis-auto, .then-emphasis-goma { text-emphasis-style: sesame; }
.then-emphasis-dot { text-emphasis-style: dot; }
.then-tcy { text-combine-upright: ${tcyStyle}; }
@font-face {
  font-family: "Then Code";
  src: url("${new URL("/fonts/NotoSansCJKjp-Regular.otf", baseUrl).href}") format("opentype");
  font-style: normal; font-weight: 400; font-display: block;
}
.then-code, .then-code-inline { font-family: "Then Code", monospace; font-size: 0.92em; }
.then-code { white-space: pre-wrap; text-align: start; }
strong { font-weight: 700; }
${exportImageCss(layout)}
</style>
</head>
<body><main class="then-viv-document">${documentHtml}</main></body>
</html>`;
}
