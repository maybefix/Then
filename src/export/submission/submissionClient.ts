import type { LoadedExportSource } from "../types";
import type { SubmissionExportOptions, SubmissionExportResult } from "./types";
import { createSubmissionProcessor, type SubmissionRequest, type SubmissionResponse } from "./submissionProcessor";

/** One session per open panel. Only changed source arrays cross the worker boundary. */
export class SubmissionClient {
  private worker: Worker | null = null;
  private sources: LoadedExportSource[] | undefined;
  private sequence = 0;
  private disposed = false;
  private process = createSubmissionProcessor();
  private pending = new Map<number, { resolve: (value: SubmissionExportResult) => void; reject: (error: Error) => void }>();

  convert(sources: LoadedExportSource[], title: string, options: SubmissionExportOptions): Promise<SubmissionExportResult> {
    if (this.disposed) return Promise.reject(new Error("投稿用エクスポートは閉じられました"));
    if (typeof Worker === "undefined") {
      return Promise.resolve().then(() => {
        if (this.disposed) throw new Error("投稿用エクスポートは閉じられました");
        const request = this.request(sources, title, options);
        return this.process(request);
      });
    }
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL("./submissionWorker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent<SubmissionResponse>) => {
          const response = event.data;
          const pending = this.pending.get(response.id);
          if (!pending) return;
          this.pending.delete(response.id);
          if ("error" in response) pending.reject(new Error(response.error));
          else pending.resolve(response.result);
        };
        this.worker.onerror = () => this.fail(new Error("投稿用変換処理に失敗しました。再試行してください"));
        this.worker.onmessageerror = () => this.fail(new Error("投稿用変換結果を受信できませんでした"));
      }
      const request = this.request(sources, title, options);
      return new Promise((resolve, reject) => {
        this.pending.set(request.id, { resolve, reject });
        try { this.worker!.postMessage(request); }
        catch (error) { this.fail(new Error(String(error))); }
      });
    } catch (error) {
      this.fail(new Error(String(error)));
      return Promise.reject(error);
    }
  }

  private request(sources: LoadedExportSource[], title: string, options: SubmissionExportOptions): SubmissionRequest {
    const request = { id: ++this.sequence, sources: this.sources === sources ? undefined : sources, title, options };
    this.sources = sources;
    return request;
  }

  private fail(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.sources = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose() {
    this.disposed = true;
    this.fail(new Error("投稿用エクスポートは閉じられました"));
  }
}
