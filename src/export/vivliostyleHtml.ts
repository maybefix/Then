// Builds a *flowing* HTML document (not pre-paginated) for the Vivliostyle
// Viewer to typeset with CSS Paged Media. The Viewer is loaded as a separate
// program (see the Rust export_pdf_vivliostyle command); this module only
// produces the source document. Pagination, running headers and page numbers
// are expressed as @page rules so Vivliostyle — not our own code — lays out the
// pages, after which WebView2 PrintToPdf serializes them.
import { exportBlockHtml } from "./linkedDocument";
import type {
  ExportLayoutProfile,
  LinkedExportDocument,
  LinkedExportSection,
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
// Margin boxes must be horizontal even though the page body is vertical-rl,
// otherwise the running header/page number is laid out top-to-bottom.
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

export function buildLinkedVivliostyleHtml(
  document: LinkedExportDocument,
  baseUrl = window.location.href,
): string {
  const layout = document.layout;
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  const body = layout.body;
  const page = layout.page;
  const fontUrl = new URL(`/fonts/${fontFile(body.fontFamily)}`, baseUrl).href;

  const header = headerContent(layout, document.title);
  const footer = footerContent(layout, document.title);
  const headerBox = header
    ? `@page { @top-center { content: ${header}; ${MARGIN_BOX_STYLE} } }`
    : "";
  const footerBox = footer ? footerBoxes(layout, footer) : "";
  // Page-number offset: counter(page) starts at 1, shift to the requested start.
  const startOffset = Math.max(0, (layout.footer.startPageNumber || 1) - 1);

  const sectionsHtml = document.sections
    .map((section, index) => {
      const brk = index === 0 ? "auto" : breakBefore(section.source.startMode);
      const sourceName = section.source.displayName.replace(/\.(?:txt|md)$/i, "");
      // A zero-height marker carries the running file-name string for this section.
      const marker = `<span class="then-viv-srcmark" style="string-set: sourcename ${cssString(sourceName)};"></span>`;
      const blocks = section.blocks.map(exportBlockHtml).join("\n");
      return `<section class="then-viv-section" style="break-before: ${brk};">${marker}${blocks}</section>`;
    })
    .join("\n");

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
:root {
  font-family: "${body.fontFamily}", serif;
  font-size: ${bodyFontSize(body)};
  line-height: ${body.lineHeight};
  writing-mode: vertical-rl;
  text-orientation: mixed;
  orphans: 2; widows: 2;
}
html, body { margin: 0; padding: 0; }
body {
  color: #000; background: #fff;
  line-break: strict; word-break: normal; overflow-wrap: break-word;
  ${body.columns > 1 ? `column-count: ${body.columns}; column-gap: ${body.columnGapMm}mm; column-fill: auto;` : ""}
  counter-reset: page ${startOffset};
}
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
.then-emphasis { text-emphasis-position: over right; }
.then-emphasis-auto, .then-emphasis-goma { text-emphasis-style: sesame; }
.then-emphasis-dot { text-emphasis-style: dot; }
.then-tcy { text-combine-upright: all; }
strong { font-weight: 700; }
</style>
</head>
<body><main class="then-viv-document">${sectionsHtml}</main></body>
</html>`;
}
