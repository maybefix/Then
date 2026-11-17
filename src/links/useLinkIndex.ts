// BINDER 3-1: keeps the link index of the open work current (docs/BINDER_LINK_INDEX_PLAN.md).
//
// - Opening a work (and every change of its file tree) reads the kept index and
//   reads again only the files whose modification time or size changed.
// - Typing does nothing. A finished save reads the links of that one file from
//   the saved text; when they are the same, nothing re-renders.
// - Coming back to the app looks at the files' times and sizes again.
//
// The index itself lives in a ref; `version` changes only when what it holds
// may have changed, so readers re-render only then.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TextDocument } from "../types";
import { LinkIndex, type LinkStamp, relativeTo } from "./linkIndex";

const CACHE_WRITE_DELAY_MS = 1500;

export type LinkIndexHandle = {
  version: number;
  /** The index of `rootPath`, once it has been read at least once. */
  current: (rootPath: string) => Promise<LinkIndex | null>;
  /** The index as it stands, without waiting; null until it has been read (3-2). */
  peek: (rootPath: string) => LinkIndex | null;
  /** A save of `path` finished with `content`. */
  noteSaved: (path: string, content: string) => void;
  /** Reads the files again by their stamps (after this window wrote some). */
  refresh: () => Promise<void>;
};

export function useLinkIndex({
  enabled,
  rootPath,
  treeKey,
  openText,
}: {
  enabled: boolean;
  rootPath: string | null;
  /** Changes whenever the file tree does (the ProjectFolder object). */
  treeKey: unknown;
  /** Text of a document open in a tab (its unsaved text), or null. */
  openText: (path: string) => string | null;
}): LinkIndexHandle {
  const indexRef = useRef<LinkIndex | null>(null);
  const loadingRef = useRef<Promise<void> | null>(null);
  const writeTimerRef = useRef<number | null>(null);
  const [version, setVersion] = useState(0);
  const openTextRef = useRef(openText);
  openTextRef.current = openText;

  const flushCache = useCallback(() => {
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    const index = indexRef.current;
    if (!index) return;
    void invoke("write_link_index_cache", { rootPath: index.rootPath, content: index.toCache() }).catch(() => undefined);
  }, []);

  const scheduleCacheWrite = useCallback(() => {
    if (writeTimerRef.current !== null) window.clearTimeout(writeTimerRef.current);
    writeTimerRef.current = window.setTimeout(flushCache, CACHE_WRITE_DELAY_MS);
  }, [flushCache]);

  const refreshIndex = useCallback(
    (root: string): Promise<void> => {
      const run = async () => {
        let index = indexRef.current;
        let changed = false;
        if (!index || index.rootPath !== root) {
          if (index) flushCache();
          index = new LinkIndex(root);
          index.loadCache(await invoke<string | null>("read_link_index_cache", { rootPath: root }).catch(() => null));
          indexRef.current = index;
          changed = true;
        }
        const stamps = await invoke<LinkStamp[]>("list_link_stamps", { rootPath: root });
        if (indexRef.current !== index) return;
        const result = await index.refresh(
          stamps,
          async (path) => {
            try {
              return (await invoke<TextDocument>("read_text_file", { path })).content;
            } catch {
              return null;
            }
          },
          (path) => openTextRef.current(path),
        );
        if (indexRef.current !== index) return;
        if (result.read > 0 || result.changed) scheduleCacheWrite();
        if (result.changed || changed) setVersion((current) => current + 1);
      };
      // One refresh at a time; a later one starts when the earlier one ends.
      const previous = loadingRef.current ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(run);
      loadingRef.current = next;
      void next.finally(() => {
        if (loadingRef.current === next) loadingRef.current = null;
      }).catch(() => undefined);
      return next;
    },
    [flushCache, scheduleCacheWrite],
  );

  useEffect(() => {
    if (!enabled || !rootPath) {
      if (indexRef.current) flushCache();
      indexRef.current = null;
      return;
    }
    void refreshIndex(rootPath).catch(() => undefined);
  }, [enabled, flushCache, refreshIndex, rootPath, treeKey]);

  useEffect(() => {
    if (!enabled || !rootPath) return;
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      void refreshIndex(rootPath).catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, refreshIndex, rootPath]);

  useEffect(() => () => flushCache(), [flushCache]);

  const noteSaved = useCallback(
    (path: string, content: string) => {
      const index = indexRef.current;
      if (!index || !relativeTo(index.rootPath, path)) return;
      if (!index.setFileText(path, content)) return;
      scheduleCacheWrite();
      setVersion((current) => current + 1);
    },
    [scheduleCacheWrite],
  );

  const current = useCallback(
    async (root: string) => {
      await (loadingRef.current ?? Promise.resolve()).catch(() => undefined);
      const index = indexRef.current;
      if (index && index.rootPath === root) return index;
      await refreshIndex(root).catch(() => undefined);
      return indexRef.current?.rootPath === root ? indexRef.current : null;
    },
    [refreshIndex],
  );

  const peek = useCallback((root: string) => {
    const index = indexRef.current;
    return index && index.rootPath === root ? index : null;
  }, []);

  const refresh = useCallback(async () => {
    const index = indexRef.current;
    if (index) await refreshIndex(index.rootPath).catch(() => undefined);
  }, [refreshIndex]);

  return { version, current, peek, noteSaved, refresh };
}
