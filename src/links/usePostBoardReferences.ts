// 投稿の側の「置かれているボード」（docs/BINDER_POST_CARD_FOLLOWUPS_PLAN.md の 2）。投稿はライブラリで共有なので、
// ライブラリ直下と全作品のボードの投稿のカードを読む（Rust の list_post_board_references）。3-4 の
// useBoardReferences と同じく、アイデアのペインを出しているあいだだけ読む: 出したとき、ファイル一覧が変わったとき、
// アプリに戻ったとき、この窓でボードを書けたとき（埋め込みの Canvas で置いた分）、別ウィンドウの Canvas がボードを
// 書けたと知らせてきたとき（アイデアのペインから別ウィンドウへドラッグしても、メイン画面には戻らないため）。
// 打鍵では読まない。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { onCanvasBoardSaved } from "../canvasBoardStore";
import { CANVAS_BOARD_SAVED_EVENT } from "../canvasTypes";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

/** `list_post_board_references` の1件。 */
type PostBoards = {
  folderPath: string;
  folderName: string;
  isLibraryRoot: boolean;
  id: string;
  name: string;
  cards: Array<{ nodeId: string; postId: string }>;
};

/** ある投稿のカードがあるボード1枚。nodeId はそのボードでの最初のカード（開いたときに選ぶ）。 */
export type PostBoardPlace = {
  folderPath: string;
  folderName: string;
  isLibraryRoot: boolean;
  boardId: string;
  boardName: string;
  nodeId: string;
};

/** 投稿の ID → その投稿のカードがあるボード（ライブラリ直下 → 作品の順、ボードの一覧の並び）。 */
export type PostBoardPlaces = ReadonlyMap<string, PostBoardPlace[]>;

const NONE: PostBoardPlaces = new Map();

export function placesByPost(boards: readonly PostBoards[]): PostBoardPlaces {
  const places = new Map<string, PostBoardPlace[]>();
  for (const board of boards) {
    const seen = new Set<string>();
    for (const card of board.cards) {
      if (seen.has(card.postId)) continue;
      seen.add(card.postId);
      const list = places.get(card.postId) ?? [];
      list.push({
        folderPath: board.folderPath, folderName: board.folderName, isLibraryRoot: board.isLibraryRoot,
        boardId: board.id, boardName: board.name, nodeId: card.nodeId,
      });
      places.set(card.postId, list);
    }
  }
  return places;
}

export function usePostBoardReferences(scopePath: string | null, active: boolean, treeKey: unknown): PostBoardPlaces {
  const [state, setState] = useState<{ scope: string; json: string; places: PostBoardPlaces } | null>(null);

  useEffect(() => {
    if (!active || !scopePath || !isTauriRuntime()) return;
    let cancelled = false;
    const read = () => {
      void invoke<PostBoards[]>("list_post_board_references", { scopePath })
        .then((boards) => {
          if (cancelled || !Array.isArray(boards)) return;
          const json = JSON.stringify(boards);
          setState((current) =>
            current && current.scope === scopePath && current.json === json
              ? current
              : { scope: scopePath, json, places: placesByPost(boards) });
        })
        .catch(() => undefined);
    };
    read();
    const onFocus = () => {
      if (document.visibilityState !== "hidden") read();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const stopSaved = onCanvasBoardSaved(read);
    let stopWindowSaved: (() => void) | null = null;
    void listen(CANVAS_BOARD_SAVED_EVENT, read)
      .then((dispose) => { if (cancelled) dispose(); else stopWindowSaved = dispose; })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopWindowSaved?.();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      stopSaved();
    };
  }, [active, scopePath, treeKey]);

  return state && state.scope === scopePath ? state.places : NONE;
}
