import { createDocumentAst } from "../editor/ast/documentAst";
import { createExportDocument } from "./documentExport";
import type {
  ExportBlock,
  ExportInline,
  ExportJob,
  ExportLayoutProfile,
  ExportPageModel,
  LinkedExportDocument,
  LoadedExportSource,
} from "./types";
import { resolvePageDimensions } from "./types";

function inlineLength(inline: ExportInline): number {
  return inline.text.length;
}

function blockLength(block: ExportBlock): number {
  return block.inlines.reduce((total, inline) => total + inlineLength(inline), 0);
}

function splitInline(inline: ExportInline, length: number): [ExportInline | null, ExportInline | null] {
  if (length <= 0) return [null, inline];
  if (length >= inline.text.length) return [inline, null];
  const headText = inline.text.slice(0, length);
  const tailText = inline.text.slice(length);
  if (inline.kind === "ruby") {
    // Group ruby cannot be divided without changing its reading relationship.
    return [null, inline];
  }
  return [
    { ...inline, text: headText },
    { ...inline, text: tailText },
  ];
}

function takeInlines(inlines: ExportInline[], length: number): [ExportInline[], ExportInline[]] {
  const head: ExportInline[] = [];
  const tail: ExportInline[] = [];
  let remaining = length;
  for (const inline of inlines) {
    if (tail.length > 0) {
      tail.push(inline);
      continue;
    }
    if (remaining >= inlineLength(inline)) {
      head.push(inline);
      remaining -= inlineLength(inline);
      continue;
    }
    const [inlineHead, inlineTail] = splitInline(inline, remaining);
    if (inlineHead) head.push(inlineHead);
    if (inlineTail) tail.push(inlineTail);
    remaining = 0;
  }
  return [head, tail];
}

// Markdown-like paragraph interpretation for export: a run of consecutive
// non-blank, non-heading lines becomes ONE paragraph whose original line breaks
// are kept as soft breaks; blank lines act as paragraph separators (and are
// dropped, since the paragraph gap already separates them). Headings and lines
// with a different alignment stay as their own block.
function mergeSoftBreaks(blocks: ExportBlock[]): ExportBlock[] {
  const out: ExportBlock[] = [];
  let pending: ExportBlock | null = null;
  const flush = () => {
    if (pending) out.push(pending);
    pending = null;
  };
  for (const block of blocks) {
    if (block.kind === "blank") {
      flush();
      continue;
    }
    if (block.kind === "heading") {
      flush();
      out.push(block);
      continue;
    }
    if (pending && pending.align === block.align) {
      pending.inlines.push({ kind: "break", text: "" }, ...block.inlines);
    } else {
      flush();
      pending = {
        kind: "paragraph",
        level: block.level,
        align: block.align,
        inlines: [...block.inlines],
      };
    }
  }
  flush();
  return out;
}

function firstHeading(blocks: ExportBlock[], fallback: string): string {
  const heading = blocks.find((block) => block.kind === "heading");
  if (!heading) return fallback;
  const text = heading.inlines.map((inline) => inline.text).join("").trim();
  return text || fallback;
}

export function createLinkedExportDocument(
  job: ExportJob,
  loadedSources: LoadedExportSource[],
): LinkedExportDocument {
  const loadedById = new Map(loadedSources.map((source) => [source.id, source]));
  const sections = job.sources
    .filter((source) => source.enabled)
    .sort((left, right) => left.order - right.order)
    .map((source) => {
      const loaded = loadedById.get(source.id);
      if (!loaded) throw new Error(`本文ファイルを読み込めませんでした: ${source.displayName}`);
      const ast = createDocumentAst({
        path: source.path || null,
        name: source.displayName,
        text: loaded.content,
      });
      const converted = createExportDocument(ast, job.layout.body.fontFamily);
      const blocks = mergeSoftBreaks(converted.blocks);
      return {
        source,
        blocks,
        chapterTitle: source.title || firstHeading(blocks, converted.title),
      };
    });

  if (sections.length === 0) throw new Error("出力対象の本文ファイルを1つ以上選択してください");

  return {
    schemaVersion: 2,
    title: job.title.trim() || "本文連結",
    layout: job.layout,
    sections,
  };
}

function pageCapacity(layout: ExportLayoutProfile): { page: number; line: number } {
  const [widthMm, heightMm] = resolvePageDimensions(layout);
  const contentWidth = Math.max(20, widthMm - layout.page.marginInnerMm - layout.page.marginOuterMm);
  const contentHeight = Math.max(20, heightMm - layout.page.marginTopMm - layout.page.marginBottomMm);
  const fontMm = layout.body.fontSizeUnit === "Q"
    ? layout.body.fontSize * 0.25
    : layout.body.fontSize * 0.352_778;
  const lineMeasure = layout.body.writingMode === "horizontal-tb" ? contentWidth : contentHeight;
  const blockMeasure = layout.body.writingMode === "horizontal-tb" ? contentHeight : contentWidth;
  const charactersPerLine = Math.max(8, Math.floor(lineMeasure / Math.max(1.5, fontMm)));
  const lines = Math.max(
    4,
    Math.floor(blockMeasure / Math.max(2, fontMm * layout.body.lineHeight)),
  );
  return {
    line: charactersPerLine,
    page: Math.max(80, Math.floor(charactersPerLine * lines * layout.body.columns * 0.9)),
  };
}

type WorkingPage = ExportPageModel & { used: number };

function blankPage(pageNumber: number): WorkingPage {
  return {
    pageNumber,
    sourceId: null,
    sourceName: "",
    chapterTitle: "",
    isBlank: true,
    isSourceFirstPage: false,
    blocks: [],
    used: 0,
  };
}

export function paginateLinkedDocument(document: LinkedExportDocument): ExportPageModel[] {
  const capacity = pageCapacity(document.layout);
  const pages: WorkingPage[] = [];

  const addSourcePage = (
    sourceId: string,
    sourceName: string,
    chapterTitle: string,
    isSourceFirstPage: boolean,
  ) => {
    const page: WorkingPage = {
      pageNumber: document.layout.footer.startPageNumber + pages.length,
      sourceId,
      sourceName,
      chapterTitle,
      isBlank: false,
      isSourceFirstPage,
      blocks: [],
      used: 0,
    };
    pages.push(page);
    return page;
  };

  document.sections.forEach((section, sectionIndex) => {
    const isFirstSection = sectionIndex === 0;
    if (!isFirstSection && section.source.startMode !== "continue") {
      const requestedParity = section.source.startMode === "odd-page"
        ? 1
        : section.source.startMode === "even-page"
          ? 0
          : null;
      const nextNumber = document.layout.footer.startPageNumber + pages.length;
      if (requestedParity !== null && nextNumber % 2 !== requestedParity) {
        pages.push(blankPage(nextNumber));
      }
      addSourcePage(
        section.source.id,
        section.source.displayName,
        section.chapterTitle,
        true,
      );
    } else if (pages.length === 0) {
      addSourcePage(
        section.source.id,
        section.source.displayName,
        section.chapterTitle,
        true,
      );
    } else if (section.source.startMode === "continue") {
      const current = pages[pages.length - 1];
      if (current.isBlank || current.used >= capacity.page) {
        addSourcePage(
          section.source.id,
          section.source.displayName,
          section.chapterTitle,
          true,
        );
      }
    }

    let sourceFirstPage = true;
    for (const originalBlock of section.blocks) {
      let block: ExportBlock | null = originalBlock;
      // Forward-progress guard: a single block can never legitimately need more
      // passes than "spans every page of the document plus a small slack". If we
      // ever exceed that, an un-splittable inline is wider than a page and the
      // loop would otherwise spin forever, so we force-place to break out.
      let blockPasses = 0;
      const maxBlockPasses = Math.max(64, Math.ceil(blockLength(originalBlock) / capacity.line) + 8);
      while (block) {
        let page = pages[pages.length - 1];
        if (!page || page.isBlank) {
          page = addSourcePage(
            section.source.id,
            section.source.displayName,
            section.chapterTitle,
            sourceFirstPage,
          );
        }
        if (page.sourceId !== section.source.id && page.used === 0) {
          page.sourceId = section.source.id;
          page.sourceName = section.source.displayName;
          page.chapterTitle = section.chapterTitle;
          page.isSourceFirstPage = sourceFirstPage;
        }

        const rawLength = block.kind === "blank" ? capacity.line : blockLength(block);
        const headingExtra = block.kind === "heading" ? capacity.line : 0;
        const required = Math.max(1, rawLength + headingExtra);
        const remaining = capacity.page - page.used;

        if (block.kind === "heading" && page.blocks.length > 0 && remaining < required + capacity.line) {
          page = addSourcePage(
            section.source.id,
            section.source.displayName,
            section.chapterTitle,
            sourceFirstPage,
          );
        }

        const available = Math.max(0, capacity.page - page.used - headingExtra);
        if (required <= capacity.page - page.used || rawLength === 0) {
          page.blocks.push(block);
          page.used += required;
          block = null;
          sourceFirstPage = false;
          continue;
        }

        // The block does not fit on the current page. Adding a fresh page only
        // makes sense if this page already holds something; on an empty page a
        // new page would be just as empty, so an un-splittable oversized inline
        // would loop forever. In that case place the whole block (accepting
        // overflow) to guarantee the loop terminates.
        const pageIsEmpty = page.blocks.length === 0;
        const forcePlace = pageIsEmpty || ++blockPasses >= maxBlockPasses;

        if (available < Math.min(capacity.line, rawLength)) {
          if (forcePlace) {
            page.blocks.push(block);
            page.used = capacity.page;
            block = null;
            sourceFirstPage = false;
            continue;
          }
          addSourcePage(
            section.source.id,
            section.source.displayName,
            section.chapterTitle,
            sourceFirstPage,
          );
          continue;
        }

        const [head, tail] = takeInlines(block.inlines, available);
        if (head.length === 0) {
          if (forcePlace) {
            page.blocks.push(block);
            page.used = capacity.page;
            block = null;
            sourceFirstPage = false;
            continue;
          }
          addSourcePage(
            section.source.id,
            section.source.displayName,
            section.chapterTitle,
            sourceFirstPage,
          );
          continue;
        }
        page.blocks.push({ ...block, inlines: head });
        page.used = capacity.page;
        block = tail.length > 0 ? { ...block, kind: "paragraph", inlines: tail } : null;
        sourceFirstPage = false;
        if (block) {
          addSourcePage(
            section.source.id,
            section.source.displayName,
            section.chapterTitle,
            false,
          );
        }
      }
    }
  });

  return pages.map(({ used: _used, ...page }) => page);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function exportInlineHtml(inline: ExportInline): string {
  const text = escapeHtml(inline.text);
  switch (inline.kind) {
    case "text": return text;
    case "bold": return `<strong>${text}</strong>`;
    case "ruby": return `<ruby>${text}<rp>（</rp><rt>${escapeHtml(inline.reading)}</rt><rp>）</rp></ruby>`;
    case "emphasis": return `<span class="then-emphasis then-emphasis-${inline.style}">${text}</span>`;
    case "tcy": return `<span class="then-tcy">${text}</span>`;
    case "break": return "<br>";
  }
}

export function exportBlockHtml(block: ExportBlock): string {
  if (block.kind === "blank") return '<p class="then-blank" aria-hidden="true">&#x3000;</p>';
  const tag = block.kind === "heading" ? `h${Math.max(1, Math.min(6, block.level))}` : "p";
  return `<${tag} class="then-block then-${block.kind} then-align-${block.align}">${block.inlines.map(exportInlineHtml).join("")}</${tag}>`;
}

function headerText(document: LinkedExportDocument, page: ExportPageModel): string {
  const header = document.layout.header;
  if (!header.enabled || header.content === "none") return "";
  if (header.hideOnFirstPage && page.pageNumber === document.layout.footer.startPageNumber) return "";
  if (header.hideOnTitlePage && page.isSourceFirstPage) return "";
  if (header.differentOddEven && page.pageNumber % 2 === 0) return document.title;
  switch (header.content) {
    case "title": return document.title;
    case "chapter": return page.chapterTitle;
    case "file": return page.sourceName;
    case "custom": return header.customText ?? "";
  }
}

function footerText(document: LinkedExportDocument, page: ExportPageModel): string {
  const footer = document.layout.footer;
  if (!footer.enabled || footer.content === "none") return "";
  if (footer.hideOnFirstPage && page.pageNumber === footer.startPageNumber) return "";
  if (footer.hideOnTitlePage && page.isSourceFirstPage) return "";
  switch (footer.content) {
    case "page-number": return footer.pageNumber ? String(page.pageNumber) : "";
    case "title": return document.title;
    case "custom": return footer.customText ?? "";
  }
}

function pageNumberClass(document: LinkedExportDocument, pageNumber: number): string {
  const position = document.layout.footer.pageNumberPosition;
  if (position === "outer") return pageNumber % 2 === 0 ? "then-footer-left" : "then-footer-right";
  if (position === "inner") return pageNumber % 2 === 0 ? "then-footer-right" : "then-footer-left";
  return position === "top-center" ? "then-footer-top" : "then-footer-bottom";
}

export function buildLinkedPrintMarkup(
  document: LinkedExportDocument,
  pages = paginateLinkedDocument(document),
): string {
  return pages.map((page) => {
    const isEven = page.pageNumber % 2 === 0;
    const innerSide = isEven ? "left" : "right";
    const header = page.isBlank ? "" : headerText(document, page);
    const footer = page.isBlank ? "" : footerText(document, page);
    return `<section class="then-export-page then-page-${isEven ? "even" : "odd"}" data-page-number="${page.pageNumber}" data-inner-side="${innerSide}">
      ${header ? `<header class="then-page-header">${escapeHtml(header)}</header>` : ""}
      <article class="then-page-content">${page.isBlank ? "" : page.blocks.map(exportBlockHtml).join("\n")}</article>
      ${footer ? `<footer class="then-page-footer ${pageNumberClass(document, page.pageNumber)}">${escapeHtml(footer)}</footer>` : ""}
    </section>`;
  }).join("\n");
}

export function buildLinkedPrintCss(document: LinkedExportDocument, baseUrl = window.location.href): string {
  const [widthMm, heightMm] = resolvePageDimensions(document.layout);
  const body = document.layout.body;
  const fontFile = body.fontFamily === "Noto Sans CJK JP"
    ? "NotoSansCJKjp-Regular.otf"
    : "NotoSerifCJKjp-Regular.otf";
  const fontUrl = new URL(`/fonts/${fontFile}`, baseUrl).href;
  const fontSize = body.fontSizeUnit === "Q" ? `${body.fontSize * 0.25}mm` : `${body.fontSize}pt`;
  const evenLeft = document.layout.page.marginInnerMm;
  const evenRight = document.layout.page.marginOuterMm;
  const oddLeft = document.layout.page.marginOuterMm;
  const oddRight = document.layout.page.marginInnerMm;
  const isHorizontal = body.writingMode === "horizontal-tb";
  const contentWritingMode = body.writingMode;
  const emphasisPosition = isHorizontal ? "over" : "over right";
  const tcyStyle = isHorizontal ? "none" : "all";
  const headingFirstMargin = isHorizontal ? "margin-top:1.4em;" : "margin-left:1.4em;";
  return `
@font-face { font-family:"${body.fontFamily}"; src:url("${fontUrl}") format("opentype"); font-display:block; }
@page { size:${widthMm}mm ${heightMm}mm; margin:0; }
.then-export-document { margin:0; padding:0; background:#fff; color:#111; }
.then-export-page { position:relative; width:${widthMm}mm; height:${heightMm}mm; overflow:hidden; box-sizing:border-box; background:#fff; break-after:page; page-break-after:always; }
.then-export-page:last-child { break-after:auto; page-break-after:auto; }
.then-page-even .then-page-content { inset:${document.layout.page.marginTopMm}mm ${evenRight}mm ${document.layout.page.marginBottomMm}mm ${evenLeft}mm; }
.then-page-odd .then-page-content { inset:${document.layout.page.marginTopMm}mm ${oddRight}mm ${document.layout.page.marginBottomMm}mm ${oddLeft}mm; }
.then-page-content { position:absolute; writing-mode:${contentWritingMode}; text-orientation:mixed; font-family:"${body.fontFamily}",serif; font-size:${fontSize}; line-height:${body.lineHeight}; line-break:strict; word-break:normal; overflow:hidden; column-count:${body.columns}; column-gap:${body.columnGapMm}mm; column-fill:auto; }
.then-block { margin:0 0 .9em; padding:0; text-align:start; }
.then-heading { font-weight:700; break-after:avoid; }
.then-heading:first-child { font-size:1.35em; ${headingFirstMargin} }
.then-align-center { text-align:center; }
.then-align-end { text-align:end; }
.then-page-header { position:absolute; z-index:2; top:5mm; left:10mm; right:10mm; text-align:center; color:#666; font:2.6mm/1.3 "${body.fontFamily}",serif; }
.then-page-footer { position:absolute; z-index:2; color:#666; font:2.6mm/1.3 "${body.fontFamily}",serif; }
.then-footer-bottom { left:10mm; right:10mm; bottom:4mm; text-align:center; }
.then-footer-top { left:10mm; right:10mm; top:4mm; text-align:center; }
.then-footer-left { left:5mm; bottom:4mm; }
.then-footer-right { right:5mm; bottom:4mm; }
ruby { ruby-align:center; ruby-position:over; }
rt { font-size:.5em; }
.then-emphasis { text-emphasis-position:${emphasisPosition}; }
.then-emphasis-auto,.then-emphasis-goma { text-emphasis-style:sesame; }
.then-emphasis-dot { text-emphasis-style:dot; }
.then-tcy { text-combine-upright:${tcyStyle}; }
strong { font-weight:700; }
`;
}

export function buildLinkedPrintHtml(
  document: LinkedExportDocument,
  baseUrl = window.location.href,
): string {
  const pages = paginateLinkedDocument(document);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>${buildLinkedPrintCss(document, baseUrl)}</style></head><body class="then-export-document">${buildLinkedPrintMarkup(document, pages)}</body></html>`;
}
