import type { CanvasScope, JsonCanvasDocument } from "./canvasTypes";

export type CanvasBoardTarget = { scope: CanvasScope; rootPath: string | null; boardId: string };
export const canvasBoardTargetKey = (target: CanvasBoardTarget) =>
  JSON.stringify([target.scope, target.scope === "global" ? null : target.rootPath, target.boardId]);

/** Keep each snapshot with its destination, even after Canvas switches or unmounts. */
export class CanvasBoardSaveQueue {
  private pending = new Map<string, CanvasBoardTarget & { board: JsonCanvasDocument }>();
  private saving: Promise<void> | null = null;

  constructor(private write: (scope: CanvasScope, rootPath: string | null, boardId: string,
    board: JsonCanvasDocument) => Promise<void>) {}

  enqueue(target: CanvasBoardTarget, board: JsonCanvasDocument) {
    this.pending.set(canvasBoardTargetKey(target), { ...target, board: structuredClone(board) });
  }

  flush(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = (async () => {
      // Assign `saving` before a synchronous writer can finish or throw.
      await Promise.resolve();
      while (this.pending.size) {
        const [key, request] = this.pending.entries().next().value!;
        await this.write(request.scope, request.rootPath, request.boardId, request.board);
        // An older completion must not discard a newer edit queued during the write.
        if (this.pending.get(key) === request) this.pending.delete(key);
      }
    })().finally(() => { this.saving = null; });
    // A failed request stays pending so switching cannot silently discard it.
    return this.saving;
  }
}
