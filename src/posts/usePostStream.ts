import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPostConflict,
  localIsoNow,
  type DeletedPost,
  type Post,
  type PostWork,
  type PostsSnapshot,
} from "./postModel";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

type ToastAction = { label: string; onClick: () => void };

export type PostStream = {
  /** フォルダを開いているか。開いていなければ投稿を書く場所がない。 */
  scoped: boolean;
  /** 投稿を読み終えて、読み書きできるか。 */
  available: boolean;
  posts: Post[];
  work: PostWork | undefined;
  add: (body: string, replyTo?: string) => Promise<boolean>;
  /** 直せなかった（外で直されていた）ときは偽。 */
  editBody: (post: Post, body: string) => Promise<boolean>;
  setFiled: (post: Post, filed: boolean) => Promise<void>;
  remove: (post: Post) => Promise<void>;
  /** ファイルが変わっていれば読み直す（右のペインを開いたとき・アプリに戻ったとき）。 */
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
  /** 最初の読み込みが失敗したか。失敗したときだけ、読み直しの要求で読み込みをやり直す。 */
  const loadFailedRef = useRef(false);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const accept = useCallback((scope: string, next: PostsSnapshot) => {
    if (scopeRef.current !== scope) return;
    signatureRef.current = next.signature;
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
      if (signature === signatureRef.current) return;
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

  return {
    scoped: Boolean(scopePath),
    available: Boolean(scopePath) && snapshot !== null,
    posts: snapshot?.posts ?? [],
    work: snapshot?.work,
    add,
    editBody,
    setFiled,
    remove,
    refresh,
  };
}
