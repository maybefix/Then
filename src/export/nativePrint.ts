import {
  buildLinkedPrintCss,
  buildLinkedPrintMarkup,
  paginateLinkedDocument,
} from "./linkedDocument";
import type { LinkedExportDocument } from "./types";

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Injects already-serialized print CSS and markup into the WebView and waits
 * for fonts + the next paint so the pages are ready for PrintToPdf. The heavy
 * pagination/serialization is expected to have happened off the UI thread (see
 * `typesetClient`); this function only performs the unavoidable DOM work.
 */
export async function applyPrintAssets(
  css: string,
  markup: string,
  viewportElement: HTMLElement,
): Promise<void> {
  const style = window.document.createElement("style");
  style.dataset.thenExportStyles = "true";
  style.textContent = css;
  const container = window.document.createElement("main");
  container.className = "then-export-document";
  container.innerHTML = markup;
  viewportElement.replaceChildren(style, container);

  await window.document.fonts.ready;
  await nextPaint();
}

/**
 * Creates deterministic physical pages in the existing WebView. The native
 * WebView2 PrintToPdf command only serializes these pages; no third-party
 * typesetter is loaded into the renderer bundle.
 */
export async function renderPrintDocument(
  document: LinkedExportDocument,
  viewportElement: HTMLElement,
): Promise<number> {
  const pages = paginateLinkedDocument(document);
  if (pages.length === 0) return 0;

  await applyPrintAssets(
    buildLinkedPrintCss(document),
    buildLinkedPrintMarkup(document, pages),
    viewportElement,
  );
  return pages.length;
}
