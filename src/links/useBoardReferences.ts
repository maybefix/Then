// BINDER 3-4: the reference cards of the open work's boards, for
// 「置かれているボード」. Read only while the 「つながり」 pane is shown: when it
// opens, when the file tree changes (a rename moves the cards, 2-6) and when
// the app comes back (the boards are edited in their own window). Typing does
// nothing.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { BoardReferences } from "./connections";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

const NONE: BoardReferences[] = [];

export function useBoardReferences(rootPath: string | null, active: boolean, treeKey: unknown): BoardReferences[] {
  const [state, setState] = useState<{ root: string; boards: BoardReferences[] } | null>(null);

  useEffect(() => {
    if (!active || !rootPath || !isTauriRuntime()) return;
    let cancelled = false;
    const read = () => {
      void invoke<BoardReferences[]>("list_board_references", { rootPath })
        .then((boards) => {
          if (cancelled) return;
          setState((current) =>
            current && current.root === rootPath && JSON.stringify(current.boards) === JSON.stringify(boards)
              ? current
              : { root: rootPath, boards });
        })
        .catch(() => undefined);
    };
    read();
    const onFocus = () => {
      if (document.visibilityState !== "hidden") read();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active, rootPath, treeKey]);

  return state && state.root === rootPath ? state.boards : NONE;
}
