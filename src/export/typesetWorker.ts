// Dedicated worker that runs the export typesetting pipeline off the UI thread.
// Everything imported here is pure CPU work (no DOM), so it is safe to run in a
// worker. The export window's UI thread only sends a request and renders the
// result, which keeps the window responsive while a large manuscript is laid
// out, serialized to a print document, or packed into a DOCX.
import {
  buildLinkedPrintCss,
  buildLinkedPrintMarkup,
  createLinkedExportDocument,
  paginateLinkedDocument,
} from "./linkedDocument";
import type { ExportJob, LoadedExportSource } from "./types";
import { generateVerticalDocx } from "./wordprocessingMl";

type TypesetRequest =
  | { id: number; task: "preview"; job: ExportJob; sources: LoadedExportSource[] }
  | { id: number; task: "pdf"; job: ExportJob; sources: LoadedExportSource[]; baseUrl: string }
  | { id: number; task: "docx"; job: ExportJob; sources: LoadedExportSource[] };

type WorkerContext = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<TypesetRequest>) => void) | null;
};

const ctx = self as unknown as WorkerContext;

ctx.onmessage = async (event) => {
  const request = event.data;
  try {
    if (request.task === "preview") {
      const document = createLinkedExportDocument(request.job, request.sources);
      const pages = paginateLinkedDocument(document);
      ctx.postMessage({ id: request.id, ok: true, result: { document, pages } });
      return;
    }
    if (request.task === "pdf") {
      const document = createLinkedExportDocument(request.job, request.sources);
      const pages = paginateLinkedDocument(document);
      const css = buildLinkedPrintCss(document, request.baseUrl);
      const markup = buildLinkedPrintMarkup(document, pages);
      ctx.postMessage({ id: request.id, ok: true, result: { css, markup, pageCount: pages.length } });
      return;
    }
    // docx
    const document = createLinkedExportDocument(request.job, request.sources);
    const pages = paginateLinkedDocument(document);
    const bytes = await generateVerticalDocx(document);
    ctx.postMessage(
      { id: request.id, ok: true, result: { bytes, pageCount: pages.length } },
      [bytes.buffer],
    );
  } catch (error) {
    ctx.postMessage({ id: request.id, ok: false, error: String(error) });
  }
};
