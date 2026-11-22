import type { CanvasPostWriteRequest, CanvasPostWriteResult } from "./canvasTypes";

// 投稿のカードで直した本文を、投稿へ書き戻す順番待ち（BINDER 7章の1、docs/BINDER_POST_CARD_PLAN.md）。
// ファイルの書き戻し（canvasFileWriteQueue.ts）と同じ作りで、書く先は投稿1件。窓ごとに1つだけ作る（canvasBoardStore.ts）。

export const canvasPostWriteKey = (request: Pick<CanvasPostWriteRequest, "rootPath" | "id">) =>
  JSON.stringify([request.rootPath.replace(/\\/g, "/").toLocaleLowerCase(), request.id]);

export type CanvasPostWriteOutcome = {
  request: CanvasPostWriteRequest;
  result: CanvasPostWriteResult;
};

type Listener = (outcome: CanvasPostWriteOutcome) => void;

export class CanvasPostWriteQueue {
  private pending = new Map<string, CanvasPostWriteRequest>();
  private saving: Promise<void> | null = null;
  private listeners = new Set<Listener>();
  /** 聞く Canvas がいないあいだに返った外の変更。次に聞き始めた Canvas に渡す（黙って捨てない）。 */
  private unclaimed: CanvasPostWriteOutcome[] = [];

  constructor(private write: (request: CanvasPostWriteRequest) => Promise<CanvasPostWriteResult>) {}

  /** 同じ投稿で、まだ書いていないものがあれば、新しい本文で置き換える。 */
  enqueue(request: CanvasPostWriteRequest) {
    this.pending.set(canvasPostWriteKey(request), { ...request });
  }

  has(key: string) {
    return this.pending.has(key);
  }

  get size() {
    return this.pending.size;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    const unclaimed = this.unclaimed;
    this.unclaimed = [];
    unclaimed.forEach((outcome) => listener(outcome));
    return () => {
      this.listeners.delete(listener);
    };
  }

  flush(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = (async () => {
      await Promise.resolve();
      while (this.pending.size) {
        const [key, request] = this.pending.entries().next().value!;
        const result = await this.write(request);
        if (this.pending.get(key) === request) this.pending.delete(key);
        // 書いているあいだに入った新しい本文は、書けたあとの行のハッシュを基準にする。
        const waiting = this.pending.get(key);
        if (result.status === "saved" && waiting) this.pending.set(key, { ...waiting, baseHash: result.post.hash });
        this.report({ request, result });
      }
    })().finally(() => { this.saving = null; });
    // 書けなかったもの（命令の失敗）は順番待ちに残す。外の変更（conflict）は書かずに知らせ、順番待ちから外す。
    return this.saving;
  }

  private report(outcome: CanvasPostWriteOutcome) {
    if (this.listeners.size === 0) {
      if (outcome.result.status === "conflict") this.unclaimed.push(outcome);
      return;
    }
    this.listeners.forEach((listener) => listener(outcome));
  }
}
