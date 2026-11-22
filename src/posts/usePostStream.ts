import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPostConflict,
  localIsoNow,
  type DeletedPost,
  type MadeNote,
  type Post,
  type PostWork,
  type PostsSnapshot,
  type UnlinkedNote,
} from "./postModel";
import type { CanvasPostWriteResult } from "../canvasTypes";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

/** 読めていないあいだの投稿。描くたびに新しい配列にしない（「つながり」がこれで組み立て直すかを決める。BINDER 3-4）。 */
const NO_POSTS: Post[] = [];

type ToastAction = { label: string; onClick: () => void };

export type PostStream = {
  /** フォルダを開いているか。開いていなければ投稿を書く場所がない。 */
  scoped: boolean;
  /** 投稿を読み終えて、読み書きできるか。 */
  available: boolean;
  posts: Post[];
  work: PostWork | undefined;
  add: (body: string, replyTo?: string) => Promise<boolean>;
  /**
   * Canvas の「投稿にする」（docs/BINDER_POST_CARD_FOLLOWUPS_PLAN.md）。投稿を1件書いて、書いた投稿を返す。
   * 通知は出さない。書けなければ投げる。
   */
  create: (body: string) => Promise<Post>;
  /** 「投稿にする」の元に戻す。作ったときのまま（行のハッシュが同じ）なら消す。通知は出さない。 */
  discard: (id: string, hash: string) => Promise<"deleted" | "kept" | "missing">;
  /** 直せなかった（外で直されていた）ときは偽。 */
  editBody: (post: Post, body: string) => Promise<boolean>;
  /**
   * Canvas の投稿のカードで直した本文を書く（docs/BINDER_POST_CARD_PLAN.md）。外で直されていれば書かずに読み直し、
   * 今の投稿を返す（通知は出さない。カードが選ぶ画面を出す）。命令の失敗は投げる。
   */
  writeBody: (id: string, baseHash: string, body: string) => Promise<CanvasPostWriteResult>;
  setFiled: (post: Post, filed: boolean) => Promise<void>;
  remove: (post: Post) => Promise<void>;
  /** 投稿（とその下の返信）をノートにする（2-3）。書けなかったときは null。 */
  makeNote: (posts: Post[], name: string, text: string) => Promise<MadeNote | null>;
  /** 「ノートにする」の元に戻す。投稿のリンクを外し、ノートが作ったときのままかを返す。 */
  unlinkNote: (ids: string[], notePath: string, noteHash: string) => Promise<UnlinkedNote | null>;
  /** Then の中の改名・移動に合わせて、ノートへのリンクを付け替える。 */
  retargetNotes: (changes: { oldPath: string; newPath: string }[]) => Promise<void>;
  /** ファイルが変わっていれば読み直す（右のペインを開いたとき・アプリに戻ったとき・ファイル一覧が変わったとき）。ノートの札があれば必ず読み直す。 */
  refresh: () => Promise<void>;
};

type Options = {
  showToast: (message: string, action?: ToastAction | null) => void;
};

/**
 * 開いているフォルダ（作品・ライブラリ直下）の投稿の流れ。ファイルの場所は Rust が決める
 * （ライブラリの中ならライブラリの `.then/posts.jsonl`）。
 */
export function usePostStream(scopePath: string | null, { showToast }: Options): PostStream {
  const [snapshot, setSnapshot] = useState<PostsSnapshot | null>(null);
  const scopeRef = useRef(scopePath);
  scopeRef.current = scopePath;
  const signatureRef = useRef<string | null>(null);
  /** いま持っている投稿（作った投稿を、書く前の一覧との差で見つける）。 */
  const postsRef = useRef<Post[]>(NO_POSTS);
  /** ノートの札があるか。あれば、投稿のファイルが同じでも読み直す（ノートの側が消えた・移ったかを見るため。2-3）。 */
  const hasNotesRef = useRef(false);
  /** 最初の読み込みが失敗したか。失敗したときだけ、読み直しの要求で読み込みをやり直す。 */
  const loadFailedRef = useRef(false);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const accept = useCallback((scope: string, next: PostsSnapshot) => {
    if (scopeRef.current !== scope) return;
    signatureRef.current = next.signature;
    hasNotesRef.current = next.posts.some((post) => post.note);
    postsRef.current = next.posts;
    setSnapshot(next);
  }, []);

  const report = useCallback((error: unknown) => {
    toastRef.current(
      isPostConflict(error)
        ? "投稿がほかで変更されていたため、読み込み直しました"
        : `投稿を保存できませんでした: ${String(error)}`,
    );
  }, []);

  const load = useCallback(async (scope: string) => {
    try {
      const next = await invoke<PostsSnapshot>("posts_load", { scopePath: scope });
      accept(scope, next);
      if (next.imported > 0 && scopeRef.current === scope) {
        toastRef.current(`この作品の投稿 ${next.imported} 件を、ライブラリの投稿に移しました`);
      }
    } catch (error) {
      if (scopeRef.current === scope) {
        signatureRef.current = null;
        loadFailedRef.current = true;
        setSnapshot(null);
      }
      console.warn("[posts] load failed", error);
    }
  }, [accept]);

  useEffect(() => {
    signatureRef.current = null;
    loadFailedRef.current = false;
    setSnapshot(null);
    if (!scopePath || !isTauriRuntime()) return;
    void load(scopePath);
  }, [load, scopePath]);

  const refresh = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope || !isTauriRuntime()) return;
    // 最初の読み込みがまだなら、それに任せる（右のペインは開いた直後にも読み直しを頼むため、二重に読まない）。
    if (signatureRef.current === null && !loadFailedRef.current) return;
    try {
      const signature = await invoke<string>("posts_signature", { scopePath: scope });
      if (signature === signatureRef.current && !hasNotesRef.current) return;
    } catch {
      // 読み直してみる。
    }
    await load(scope);
  }, [load]);

  // アプリに戻ったときに、外で書き換えられていれば読み直す。
  useEffect(() => {
    if (!scopePath) return;
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh, scopePath]);

  const run = useCallback(async <T,>(command: string, args: Record<string, unknown>): Promise<T | null> => {
    const scope = scopeRef.current;
    if (!scope || !isTauriRuntime()) return null;
    try {
      return await invoke<T>(command, { scopePath: scope, ...args });
    } catch (error) {
      report(error);
      if (isPostConflict(error)) await load(scope);
      return null;
    }
  }, [load, report]);

  const add = useCallback(async (body: string, replyTo?: string) => {
    const scope = scopeRef.current;
    const text = body.trim();
    if (!scope || !text) return false;
    const next = await run<PostsSnapshot>("posts_add", { at: localIsoNow(), body: text, replyTo: replyTo ?? null });
    if (next) accept(scope, next);
    return Boolean(next);
  }, [accept, run]);

  const create = useCallback(async (body: string): Promise<Post> => {
    const scope = scopeRef.current;
    const text = body.trim();
    if (!scope || !isTauriRuntime()) throw new Error("投稿を書く場所がありません");
    if (!text) throw new Error("投稿が空です");
    const known = new Set(postsRef.current.map((post) => post.id));
    const next = await invoke<PostsSnapshot>("posts_add", { scopePath: scope, at: localIsoNow(), body: text, replyTo: null });
    accept(scope, next);
    // 投稿の ID は Rust が作る。書く前の一覧になかった、同じ本文の投稿が、いま書いたもの。
    const made = [...next.posts].reverse().find((post) => !known.has(post.id) && post.body === text);
    if (!made) throw new Error("書いた投稿が見つかりません");
    return made;
  }, [accept]);

  const discard = useCallback(async (id: string, hash: string): Promise<"deleted" | "kept" | "missing"> => {
    const scope = scopeRef.current;
    if (!scope || !isTauriRuntime()) return "kept";
    try {
      const deleted = await invoke<DeletedPost>("posts_delete", { scopePath: scope, id, expectedHash: hash });
      accept(scope, deleted.snapshot);
      return "deleted";
    } catch (error) {
      if (!isPostConflict(error)) throw error;
      // 外で直されたか、もうない。読み直して、どちらかを見分ける。
      const current = await invoke<PostsSnapshot>("posts_load", { scopePath: scope }).catch(() => null);
      if (current) accept(scope, current);
      return current && !current.posts.some((post) => post.id === id) ? "missing" : "kept";
    }
  }, [accept]);

  const editBody = useCallback(async (post: Post, body: string) => {
    const scope = scopeRef.current;
    const text = body.trim();
    if (!scope || !text || text === post.body) return true;
    const next = await run<PostsSnapshot>("posts_update", {
      id: post.id, expectedHash: post.hash, body: text, editedAt: localIsoNow(), filed: null,
    });
    if (next) accept(scope, next);
    return Boolean(next);
  }, [accept, run]);

  const writeBody = useCallback(async (id: string, baseHash: string, body: string): Promise<CanvasPostWriteResult> => {
    const scope = scopeRef.current;
    const text = body.trim();
    if (!scope || !isTauriRuntime()) throw new Error("投稿を書く場所がありません");
    if (!text) return { status: "unchanged" };
    try {
      const next = await invoke<PostsSnapshot>("posts_update", {
        scopePath: scope, id, expectedHash: baseHash, body: text, editedAt: localIsoNow(), filed: null,
      });
      accept(scope, next);
      const post = next.posts.find((entry) => entry.id === id);
      return post ? { status: "saved", post } : { status: "conflict" };
    } catch (error) {
      if (!isPostConflict(error)) throw error;
      const current = await invoke<PostsSnapshot>("posts_load", { scopePath: scope }).catch(() => null);
      if (current) accept(scope, current);
      return { status: "conflict", post: current?.posts.find((entry) => entry.id === id) };
    }
  }, [accept]);

  const setFiled = useCallback(async (post: Post, filed: boolean) => {
    const scope = scopeRef.current;
    if (!scope) return;
    const next = await run<PostsSnapshot>("posts_update", {
      id: post.id, expectedHash: null, body: null, editedAt: null, filed,
    });
    if (!next) return;
    accept(scope, next);
    if (filed) {
      toastRef.current("受信箱から外しました", {
        label: "元に戻す",
        onClick: () => {
          const current = next.posts.find((entry) => entry.id === post.id);
          if (current) void setFiled(current, false);
        },
      });
    }
  }, [accept, run]);

  const remove = useCallback(async (post: Post) => {
    const scope = scopeRef.current;
    if (!scope) return;
    const deleted = await run<DeletedPost>("posts_delete", { id: post.id, expectedHash: post.hash });
    if (!deleted) return;
    accept(scope, deleted.snapshot);
    toastRef.current("投稿を削除しました", {
      label: "元に戻す",
      onClick: () => {
        void invoke<PostsSnapshot>("posts_restore", { scopePath: scope, line: deleted.line, index: deleted.index })
          .then((restored) => accept(scope, restored))
          .catch(report);
      },
    });
  }, [accept, report, run]);

  const makeNote = useCallback(async (posts: Post[], name: string, text: string) => {
    const scope = scopeRef.current;
    if (!scope || posts.length === 0) return null;
    const made = await run<MadeNote>("posts_make_note", {
      posts: posts.map((post) => ({ id: post.id, hash: post.hash })), noteName: name, noteText: text,
    });
    if (made) accept(scope, made.snapshot);
    return made;
  }, [accept, run]);

  const unlinkNote = useCallback(async (ids: string[], notePath: string, noteHash: string) => {
    const scope = scopeRef.current;
    if (!scope) return null;
    const unlinked = await run<UnlinkedNote>("posts_unlink_note", { ids, notePath, noteHash });
    if (unlinked) accept(scope, unlinked.snapshot);
    return unlinked;
  }, [accept, run]);

  const retargetNotes = useCallback(async (changes: { oldPath: string; newPath: string }[]) => {
    const scope = scopeRef.current;
    if (!scope || changes.length === 0) return;
    const next = await run<PostsSnapshot | null>("posts_retarget_notes", { changes });
    if (next) accept(scope, next);
  }, [accept, run]);

  return {
    scoped: Boolean(scopePath),
    available: Boolean(scopePath) && snapshot !== null,
    posts: snapshot?.posts ?? NO_POSTS,
    work: snapshot?.work,
    add,
    create,
    discard,
    editBody,
    writeBody,
    setFiled,
    remove,
    makeNote,
    unlinkNote,
    retargetNotes,
    refresh,
  };
}
