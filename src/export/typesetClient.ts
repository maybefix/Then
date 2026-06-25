// Main-thread client for the export typesetting worker.
//
// The heavy export pipeline (manuscript concatenation, pagination, print-markup
// serialization and DOCX packing) runs in `typesetWorker.ts` so the export
// window's UI thread is never blocked. If the runtime cannot create a worker
// (or one fails), every call transparently falls back to running the same pure
// functions on the main thread, so the feature keeps working — just without the
// off-thread benefit.
import type {
  ExportJob,
  ExportPageModel,
  LinkedExportDocument,
  LoadedExportSource,
} from "./types";

export type PreviewAssets = {
  document: LinkedExportDocument;
  pages: ExportPageModel[];
};

export type PrintAssets = {
  css: string;
  markup: string;
  pageCount: number;
};

export type DocxAssets = {
  bytes: Uint8Array;
  pageCount: number;
};

type WorkerSuccess = { id: number; ok: true; result: unknown };
type WorkerFailure = { id: number; ok: false; error: string };
type WorkerResponse = WorkerSuccess | WorkerFailure;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

let worker: Worker | null | undefined;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

function spawnWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    const instance = new Worker(new URL("./typesetWorker.ts", import.meta.url), {
      type: "module",
    });
    instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error));
    };
    instance.onerror = (event) => {
      // A worker-level failure invalidates the worker; reject in-flight work and
      // force every later request onto the synchronous fallback path.
      const error = new Error(event.message || "組版ワーカーが停止しました");
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      worker = null;
    };
    return instance;
  } catch {
    return null;
  }
}

function getWorker(): Worker | null {
  if (worker === undefined) worker = spawnWorker();
  return worker;
}

function callWorker<T>(message: Record<string, unknown>): Promise<T> | null {
  const instance = getWorker();
  if (!instance) return null;
  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    try {
      instance.postMessage({ id, ...message });
    } catch (error) {
      pending.delete(id);
      // Some payloads can be un-cloneable in rare runtimes; drop the worker and
      // let the caller fall back synchronously.
      worker = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function prepareExportPreview(
  job: ExportJob,
  sources: LoadedExportSource[],
): Promise<PreviewAssets> {
  const viaWorker = callWorker<PreviewAssets>({ task: "preview", job, sources });
  if (viaWorker) {
    try {
      return await viaWorker;
    } catch {
      // fall through to synchronous fallback below
    }
  }
  const { createLinkedExportDocument, paginateLinkedDocument } = await import("./linkedDocument");
  const document = createLinkedExportDocument(job, sources);
  return { document, pages: paginateLinkedDocument(document) };
}

export async function prepareExportPdf(
  job: ExportJob,
  sources: LoadedExportSource[],
): Promise<PrintAssets> {
  const baseUrl = window.location.href;
  const viaWorker = callWorker<PrintAssets>({ task: "pdf", job, sources, baseUrl });
  if (viaWorker) {
    try {
      return await viaWorker;
    } catch {
      // fall through to synchronous fallback below
    }
  }
  const { createLinkedExportDocument, paginateLinkedDocument, buildLinkedPrintCss, buildLinkedPrintMarkup } =
    await import("./linkedDocument");
  const document = createLinkedExportDocument(job, sources);
  const pages = paginateLinkedDocument(document);
  return {
    css: buildLinkedPrintCss(document, baseUrl),
    markup: buildLinkedPrintMarkup(document, pages),
    pageCount: pages.length,
  };
}

export async function prepareExportDocx(
  job: ExportJob,
  sources: LoadedExportSource[],
): Promise<DocxAssets> {
  const viaWorker = callWorker<DocxAssets>({ task: "docx", job, sources });
  if (viaWorker) {
    try {
      return await viaWorker;
    } catch {
      // fall through to synchronous fallback below
    }
  }
  const { createLinkedExportDocument, paginateLinkedDocument } = await import("./linkedDocument");
  const { generateVerticalDocx } = await import("./wordprocessingMl");
  const document = createLinkedExportDocument(job, sources);
  const pages = paginateLinkedDocument(document);
  return { bytes: await generateVerticalDocx(document), pageCount: pages.length };
}
