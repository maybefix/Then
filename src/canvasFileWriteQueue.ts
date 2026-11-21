import type { CanvasFileWriteRequest, CanvasFileWriteResult } from "./canvasTypes";

// カードで直したノートの本文・原稿の概要を、参照先のファイルへ書き戻す順番待ち（BINDER 4-2）。
// ボードの順番待ち（canvasBoardSaveQueue.ts）と同じく、書く先と中身を組にして1つずつ書く。
// 窓ごとに1つだけ作り（canvasBoardStore.ts）、Canvas が閉じて開き直しても前の書き戻しを待てるようにする。

export const canvasFileWriteKey = (request: Pick<CanvasFileWriteRequest, "rootPath" | "path" | "kind">) =>
  JSON.stringify([request.rootPath.replace(/\\/g, "/").toLocaleLowerCase(), request.path.toLocaleLowerCase(), request.kind]);

const fileKey = (request: CanvasFileWriteRequest) => canvasFileWriteKey({ ...request, kind: "body" });
const sameFile = (left: CanvasFileWriteRequest, right: CanvasFileWriteRequest) => fileKey(left) === fileKey(right);

export type CanvasFileWriteOutcome = {
  request: CanvasFileWriteRequest;
  result: CanvasFileWriteResult;
};

type Listener = (outcome: CanvasFileWriteOutcome) => void;

export class CanvasFileWriteQueue {
  private pending = new Map<string, CanvasFileWriteRequest>();
  private saving: Promise<void> | null = null;
  private listeners = new Set<Listener>();
  /** 聞く Canvas がいないあいだに返った外の変更。次に聞き始めた Canvas に渡す（黙って捨てない）。 */
  private unclaimed: CanvasFileWriteOutcome[] = [];

  constructor(private write: (request: CanvasFileWriteRequest) => Promise<CanvasFileWriteResult>) {}

  /**
   * 書けたファイルの、書く前のハッシュ → 書いたあとの中身。Canvas が書けた結果を受け取る前に次の編集を入れても、
   * 古い基準のまま書いて外の変更と取り違えないようにする。
   */
  private written = new Map<string, Map<string | null, CanvasFileWriteRequest["base"]>>();

  /** 同じファイル・同じ種類で、まだ書いていないものがあれば、新しい中身で置き換える。 */
  enqueue(request: CanvasFileWriteRequest) {
    const next = structuredClone(request);
    const chain = this.written.get(fileKey(next));
    for (let step = 0; chain && step < 32; step++) {
      const newer = chain.get(next.base.contentHash);
      if (!newer) break;
      next.base = newer;
    }
    this.pending.set(canvasFileWriteKey(next), next);
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
        // 書いているあいだに入った新しい中身は消さない。
        if (this.pending.get(key) === request) this.pending.delete(key);
        if (result.status === "saved") {
          // 書けたファイルの新しい中身とハッシュを、同じファイルのまだ書いていない分の基準にする。
          const base = { content: result.content, contentHash: result.contentHash };
          const chain = this.written.get(fileKey(request)) ?? new Map();
          chain.set(request.base.contentHash, base);
          this.written.set(fileKey(request), chain);
          for (const [otherKey, other] of this.pending) {
            if (sameFile(other, request)) this.pending.set(otherKey, { ...other, base });
          }
        }
        this.report({ request, result });
      }
    })().finally(() => { this.saving = null; });
    // 書けなかったもの（命令の失敗）は順番待ちに残す。外の変更（conflict）は書かずに知らせ、順番待ちから外す。
    return this.saving;
  }

  private report(outcome: CanvasFileWriteOutcome) {
    if (this.listeners.size === 0) {
      if (outcome.result.status === "conflict") this.unclaimed.push(outcome);
      return;
    }
    this.listeners.forEach((listener) => listener(outcome));
  }
}
