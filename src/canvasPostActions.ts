/**
 * Canvas の「投稿にする」（BINDER 2-4、docs/BINDER_POST_CARD_FOLLOWUPS_PLAN.md）の、メイン画面の側の流れ。
 * キャンバスの頼みを受けてカード1枚ずつを投稿にし、書けた投稿の ID を返す（キャンバスがそのカードを投稿のカードに
 * 置き換える）。「元に戻す」は2つの口（キャンバスの Ctrl+Z と、メイン画面の通知）から来るが、1回分につき一度だけ働く。
 * 作ったときのままの投稿（行のハッシュが同じ）だけを消し、直してあれば残す（4-4 の原稿と同じ）。
 * 通知のボタンはあとで押されるので、値は呼ばれたときの deps（App が描画のたびに入れ替える）から読む。
 */
import type { MutableRefObject } from "react";
import type { CanvasCopyToPostRequest, CanvasCopyToPostResult } from "./canvasTypes";
import type { Post } from "./posts/postModel";
import { isSamePath } from "./utils/projectTree";

type ToastAction = { label: string; onClick: () => void };

export type CanvasPostDeps = {
  /** 投稿を書く場所（開いているフォルダ）。ないときは投稿にできない。 */
  scopePath: string | null;
  /** 投稿を1件書き、書いた投稿を返す。書けなければ投げる。 */
  createPost: (body: string) => Promise<Post>;
  /** 投稿がまだ作ったときのまま（行のハッシュが同じ）なら消す。直してあれば消さずに "kept"、もうなければ "missing"。 */
  discardPost: (id: string, hash: string) => Promise<"deleted" | "kept" | "missing">;
  showToast: (message: string, action?: ToastAction | null) => void;
  /** 通知の「元に戻す」で、キャンバスに置き換えを外してもらう。外せたら true。 */
  revertOnCanvas: (conversionId: string) => Promise<boolean>;
};

type MadePost = { id: string; hash: string };
type Conversion = { posts: MadePost[]; undone: boolean };

export const copyToPostMessage = (made: number, failed: number) =>
  failed > 0 ? `${made}件を投稿にしました（${failed}件は投稿にできませんでした）` : `${made}件を投稿にしました`;

export const copyToPostUndoMessage = (deleted: number, kept: number) =>
  kept > 0
    ? `カードを元に戻しました（投稿 ${kept} 件は直してあるので残しました）`
    : `カードを元に戻し、投稿 ${deleted} 件を消しました`;

export function createCanvasPostActions(depsRef: MutableRefObject<CanvasPostDeps>) {
  const conversions = new Map<string, Conversion>();

  const discardUnchanged = async (posts: MadePost[]) => {
    let deleted = 0;
    let kept = 0;
    for (const post of posts) {
      const result = await depsRef.current.discardPost(post.id, post.hash).catch(() => "kept" as const);
      if (result === "deleted") deleted += 1;
      else if (result === "kept") kept += 1;
    }
    return { deleted, kept };
  };

  /** 通知の「元に戻す」。キャンバスで置き換えを外せたときだけ、投稿を消す。 */
  const undoFromToast = async (conversionId: string) => {
    const conversion = conversions.get(conversionId);
    if (!conversion || conversion.undone) return;
    if (!(await depsRef.current.revertOnCanvas(conversionId))) {
      depsRef.current.showToast("Canvas でそのボードを開いていないため、元に戻せませんでした");
      return;
    }
    if (conversion.undone) return;
    conversion.undone = true;
    const { deleted, kept } = await discardUnchanged(conversion.posts);
    depsRef.current.showToast(copyToPostUndoMessage(deleted, kept));
  };

  const createCards = async (request: Extract<CanvasCopyToPostRequest, { kind: "cards" }>): Promise<CanvasCopyToPostResult> => {
    const made: { id: string; post: string }[] = [];
    const posts: MadePost[] = [];
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const card of request.cards) {
      try {
        const post = await depsRef.current.createPost(card.text);
        made.push({ id: card.id, post: post.id });
        posts.push({ id: post.id, hash: post.hash });
      } catch (error) {
        lastError = error;
        failed.push(card.id);
      }
    }
    if (made.length === 0 && lastError !== null) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    if (made.length) {
      conversions.set(request.conversionId, { posts, undone: false });
      depsRef.current.showToast(copyToPostMessage(made.length, failed.length), {
        label: "元に戻す",
        onClick: () => void undoFromToast(request.conversionId),
      });
    }
    return { kind: "cards", made, failed };
  };

  /** キャンバスの Ctrl+Z。通知からすでに戻していれば何もしない。 */
  const undoCards = async (conversionId: string): Promise<CanvasCopyToPostResult> => {
    const conversion = conversions.get(conversionId);
    if (!conversion || conversion.undone) return { kind: "undo", done: false, deleted: 0, kept: 0 };
    conversion.undone = true;
    const { deleted, kept } = await discardUnchanged(conversion.posts);
    depsRef.current.showToast(copyToPostUndoMessage(deleted, kept));
    return { kind: "undo", done: true, deleted, kept };
  };

  const handle = (request: CanvasCopyToPostRequest): Promise<CanvasCopyToPostResult> => {
    const { scopePath } = depsRef.current;
    if (!scopePath || !isSamePath(scopePath, request.rootPath)) {
      return Promise.reject(new Error("このフォルダを開いていないため、投稿にできません"));
    }
    if (request.kind === "cards") return createCards(request);
    return undoCards(request.conversionId);
  };

  return { handle };
}
