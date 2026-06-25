import type { ExportBlock, ExportDocument, ExportInline } from "./types";

const fontAssets = {
  "Noto Serif CJK JP": "/fonts/NotoSerifCJKjp-Regular.otf",
  "Noto Sans CJK JP": "/fonts/NotoSansCJKjp-Regular.otf",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(inline: ExportInline): string {
  const text = escapeHtml(inline.text);
  switch (inline.kind) {
    case "text":
      return text;
    case "bold":
      return `<strong>${text}</strong>`;
    case "ruby":
      return `<ruby>${text}<rp>（</rp><rt>${escapeHtml(inline.reading)}</rt><rp>）</rp></ruby>`;
    case "emphasis":
      return `<span class="emphasis emphasis-${inline.style}">${text}</span>`;
    case "tcy":
      return `<span class="tcy">${text}</span>`;
  }
}

function blockHtml(block: ExportBlock): string {
  if (block.kind === "blank") return '<p class="blank" aria-hidden="true">&#x3000;</p>';
  const tag = block.kind === "heading" ? `h${Math.max(1, Math.min(6, block.level))}` : "p";
  const classes = [block.kind, `align-${block.align}`].join(" ");
  return `<${tag} class="${classes}">${block.inlines.map(inlineHtml).join("")}</${tag}>`;
}

export function buildPrintHtml(document: ExportDocument, baseUrl = window.location.href): string {
  const page = document.page;
  const contentWidthMm = page.widthMm - page.marginLeftMm - page.marginRightMm;
  const contentHeightMm = page.heightMm - page.marginTopMm - page.marginBottomMm;
  const fontUrl = new URL(fontAssets[document.fontFamily], baseUrl).href;
  const title = escapeHtml(document.title);
  const body = document.blocks.map(blockHtml).join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<base href="${escapeHtml(baseUrl)}">
<title>${title}</title>
<style>
@font-face {
  font-family: "${document.fontFamily}";
  src: url("${fontUrl}") format("opentype");
  font-style: normal;
  font-weight: 400;
  font-display: block;
}
@page {
  size: ${contentWidthMm}mm ${contentHeightMm}mm;
  margin: 0;
}
:root {
  font-family: "${document.fontFamily}", serif;
  font-size: 10pt;
  line-height: 1.8;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  orphans: 2;
  widows: 2;
}
html, body { margin: 0; padding: 0; }
body {
  color: #000;
  background: #fff;
  line-break: strict;
  word-break: normal;
  overflow-wrap: break-word;
  font-kerning: normal;
  font-feature-settings: "palt" 0;
}
.then-print-document {
  display: block;
  writing-mode: inherit;
}
p, h1, h2, h3, h4, h5, h6 {
  margin-block: 0 0.9em;
  margin-inline: 0;
  padding: 0;
  text-align: start;
}
p.blank { margin-block-end: 0.9em; }
h1, h2, h3, h4, h5, h6 {
  break-after: avoid-page;
  font-weight: 700;
}
h1 { font-size: 16pt; }
h2 { font-size: 14pt; }
h3 { font-size: 12.5pt; }
h4 { font-size: 11.5pt; }
h5 { font-size: 10.5pt; }
h6 { font-size: 10pt; }
.align-start { text-align: start; }
.align-center { text-align: center; }
.align-end { text-align: end; }
ruby { ruby-align: center; ruby-position: over; }
rt { font-size: 0.5em; }
.emphasis { text-emphasis-position: over right; }
.emphasis-auto, .emphasis-goma { text-emphasis-style: sesame; }
.emphasis-dot { text-emphasis-style: dot; }
.tcy { text-combine-upright: all; }
strong { font-weight: 700; }
</style>
</head>
<body><article class="then-print-document">${body}</article></body>
</html>`;
}

export function buildPrintDocument(document: ExportDocument): Document {
  return new DOMParser().parseFromString(buildPrintHtml(document), "text/html");
}
