import { invoke } from "@tauri-apps/api/core";
import {
  createCanvasDocument,
  normalizeCanvasDocument,
  serializeCanvasDocument,
  type CanvasBoardSummary,
  type CanvasFileWriteRequest,
  type CanvasFileWriteResult,
  type CanvasScope,
  type JsonCanvasDocument,
} from "./canvasTypes";
import { draftBoardKey, type DraftHistory } from "./intermediateDraft";
import { prepareDraftBoardTrash } from "./intermediateDraftStore";
import { CanvasBoardSaveQueue } from "./canvasBoardSaveQueue";
import { CanvasFileWriteQueue } from "./canvasFileWriteQueue";

// Canvas のボードを読み書きする層。Tauri の中では Rust の命令を呼び、ブラウザで動かすときは localStorage に書く。
// 遅延保存の時計や、どのボードへ書くかの判断は CanvasWindowApp.tsx が持つ。

const LOCAL_STORAGE_PREFIX = "then.canvas-board";

export type TrashedCanvasBoardSummary = {
  trashId: string;
  boardId: string;
  name: string;
  scope: CanvasScope;
  deletedAt: number;
  nodeCount: number;
  edgeCount: number;
};

type LocalTrashedCanvasBoard = {
  boardId: string;
  board: JsonCanvasDocument;
  deletedAt: number;
  draft?: DraftHistory;
};

export const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

function localStorageKey(scope: CanvasScope, rootPath: string | null) {
  return `${LOCAL_STORAGE_PREFIX}.${scope}.${rootPath ?? "unbound"}`;
}

function localStorageOrderKey(scope: CanvasScope, rootPath: string | null) {
  return `${localStorageKey(scope, rootPath)}.order`;
}

function localStorageTrashKey(scope: CanvasScope, rootPath: string | null) {
  return `${localStorageKey(scope, rootPath)}.trash`;
}

function readLocalBoards(scope: CanvasScope, rootPath: string | null): Record<string, JsonCanvasDocument> {
  const raw = window.localStorage.getItem(localStorageKey(scope, rootPath));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([id, value]) => [
        id,
        normalizeCanvasDocument(value, "Idea Board", scope),
      ]),
    );
  } catch {
    return {};
  }
}

function writeLocalBoards(
  scope: CanvasScope,
  rootPath: string | null,
  boards: Record<string, JsonCanvasDocument>,
) {
  const stored = Object.fromEntries(
    Object.entries(boards).map(([id, board]) => [id, serializeCanvasDocument(board)]),
  );
  window.localStorage.setItem(localStorageKey(scope, rootPath), JSON.stringify(stored));
}

function readLocalBoardOrder(scope: CanvasScope, rootPath: string | null): string[] {
  const raw = window.localStorage.getItem(localStorageOrderKey(scope, rootPath));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeLocalBoardOrder(scope: CanvasScope, rootPath: string | null, boardIds: string[]) {
  window.localStorage.setItem(localStorageOrderKey(scope, rootPath), JSON.stringify(boardIds));
}

function readLocalBoardTrash(
  scope: CanvasScope,
  rootPath: string | null,
): Record<string, LocalTrashedCanvasBoard> {
  const raw = window.localStorage.getItem(localStorageTrashKey(scope, rootPath));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, LocalTrashedCanvasBoard>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalBoardTrash(
  scope: CanvasScope,
  rootPath: string | null,
  trash: Record<string, LocalTrashedCanvasBoard>,
) {
  window.localStorage.setItem(localStorageTrashKey(scope, rootPath), JSON.stringify(trash));
}

function summarizeLocalBoard(
  id: string,
  board: JsonCanvasDocument,
  scope: CanvasScope,
): CanvasBoardSummary {
  return {
    id,
    name: board.then?.name ?? id,
    path: id,
    scope,
    updatedAt: board.then?.updatedAt ?? Date.now(),
    nodeCount: board.nodes.length,
    edgeCount: board.edges.length,
  };
}

export async function listBoards(scope: CanvasScope, rootPath: string | null) {
  if (isTauriRuntime()) {
    return invoke<CanvasBoardSummary[]>("list_canvas_boards", { scope, rootPath });
  }
  const boards = readLocalBoards(scope, rootPath);
  const summaries = Object.entries(boards).map(([id, board]) =>
    summarizeLocalBoard(id, board, scope),
  );
  const order = readLocalBoardOrder(scope, rootPath);
  const positions = new Map(order.map((id, index) => [id, index]));
  return summaries.sort((left, right) => {
    const leftPosition = positions.get(left.id);
    const rightPosition = positions.get(right.id);
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return right.updatedAt - left.updatedAt;
  });
}

export async function createBoard(scope: CanvasScope, rootPath: string | null, name: string) {
  if (isTauriRuntime()) {
    return invoke<CanvasBoardSummary>("create_canvas_board", { scope, rootPath, name });
  }
  const boards = readLocalBoards(scope, rootPath);
  const id = `idea-board-${Date.now().toString(36)}`;
  const board = createCanvasDocument(name, scope);
  boards[id] = board;
  writeLocalBoards(scope, rootPath, boards);
  return summarizeLocalBoard(id, board, scope);
}

export async function loadBoard(scope: CanvasScope, rootPath: string | null, boardId: string) {
  if (isTauriRuntime()) {
    return invoke<unknown>("load_canvas_board", { scope, rootPath, boardId });
  }
  return readLocalBoards(scope, rootPath)[boardId] ?? createCanvasDocument("Idea Board", scope);
}

export async function saveBoard(
  scope: CanvasScope,
  rootPath: string | null,
  boardId: string,
  board: JsonCanvasDocument,
) {
  // Then が読めないカード（Obsidian の link など）を、読んだときのまま書き戻す。
  const stored = serializeCanvasDocument(board);
  if (isTauriRuntime()) {
    await invoke("save_canvas_board", { scope, rootPath, boardId, board: stored });
    return;
  }
  const boards = readLocalBoards(scope, rootPath);
  boards[boardId] = board;
  writeLocalBoards(scope, rootPath, boards);
}

// Mode changes can remount Canvas while a native save is still in flight.
// The next instance must wait for the same queue before loading its board.
export const canvasBoardSaveQueue = new CanvasBoardSaveQueue(saveBoard);

export type CanvasFileWriteTransport = (request: CanvasFileWriteRequest) => Promise<CanvasFileWriteResult>;

let canvasFileWriteTransport: CanvasFileWriteTransport | null = null;

/**
 * ファイルへ書くのはメイン画面だけ（BINDER 4-2）。埋め込みの Canvas はメイン画面の書き込み口を、別ウィンドウは
 * 知らせで頼む道を、開いたときにここへ置く。
 */
export function setCanvasFileWriteTransport(transport: CanvasFileWriteTransport) {
  canvasFileWriteTransport = transport;
}

// カードからノート・原稿へ書き戻す順番待ち。ボードの順番待ちと同じく窓ごとに1つ。
export const canvasFileWriteQueue = new CanvasFileWriteQueue((request) => {
  if (!canvasFileWriteTransport) return Promise.reject(new Error("ファイルへ書き戻す相手がいません"));
  return canvasFileWriteTransport(request);
});

export async function reorderBoards(
  scope: CanvasScope,
  rootPath: string | null,
  boardIds: string[],
) {
  if (isTauriRuntime()) {
    await invoke("reorder_canvas_boards", { scope, rootPath, boardIds });
    return;
  }
  writeLocalBoardOrder(scope, rootPath, boardIds);
}

export async function trashBoard(scope: CanvasScope, rootPath: string | null, boardId: string) {
  await prepareDraftBoardTrash({ scope, rootPath, boardId });
  if (isTauriRuntime()) {
    await invoke("trash_canvas_board", { scope, rootPath, boardId });
    return;
  }
  const boards = readLocalBoards(scope, rootPath);
  const board = boards[boardId];
  if (!board) throw new Error("canvas board does not exist");
  const deletedAt = Date.now();
  const trashId = `${deletedAt}--${boardId}`;
  const trash = readLocalBoardTrash(scope, rootPath);
  const draftKey = `then.draft.${draftBoardKey({ scope, rootPath, boardId })}`;
  const draft = JSON.parse(localStorage.getItem(draftKey) ?? "null") as DraftHistory | null;
  trash[trashId] = { boardId, board, deletedAt, draft: draft ?? undefined };
  writeLocalBoardTrash(scope, rootPath, trash);
  delete boards[boardId];
  writeLocalBoards(scope, rootPath, boards);
  localStorage.removeItem(draftKey);
  writeLocalBoardOrder(
    scope,
    rootPath,
    readLocalBoardOrder(scope, rootPath).filter((id) => id !== boardId),
  );
}


export async function listTrashedBoards(
  scope: CanvasScope,
  rootPath: string | null,
): Promise<TrashedCanvasBoardSummary[]> {
  if (isTauriRuntime()) {
    return invoke<TrashedCanvasBoardSummary[]>("list_trashed_canvas_boards", {
      scope,
      rootPath,
    });
  }
  return Object.entries(readLocalBoardTrash(scope, rootPath))
    .map(([trashId, item]) => ({
      trashId,
      boardId: item.boardId,
      name: boardName(item.board),
      scope,
      deletedAt: item.deletedAt,
      nodeCount: item.board.nodes.length,
      edgeCount: item.board.edges.length,
    }))
    .sort((left, right) => right.deletedAt - left.deletedAt);
}

export async function restoreTrashedBoard(
  scope: CanvasScope,
  rootPath: string | null,
  trashId: string,
): Promise<CanvasBoardSummary> {
  if (isTauriRuntime()) {
    return invoke<CanvasBoardSummary>("restore_canvas_board", { scope, rootPath, trashId });
  }
  const trash = readLocalBoardTrash(scope, rootPath);
  const item = trash[trashId];
  if (!item) throw new Error("trashed canvas board does not exist");
  const currentOrder = (await listBoards(scope, rootPath)).map((board) => board.id);
  const boards = readLocalBoards(scope, rootPath);
  let boardId = item.boardId;
  let suffix = 2;
  while (boards[boardId]) {
    boardId = `${item.boardId}-${suffix}`;
    suffix += 1;
  }
  boards[boardId] = item.board;
  if (item.draft) {
    localStorage.setItem(`then.draft.${draftBoardKey({ scope, rootPath, boardId })}`,
      JSON.stringify({ ...item.draft, boardId }));
  }
  delete trash[trashId];
  writeLocalBoards(scope, rootPath, boards);
  writeLocalBoardTrash(scope, rootPath, trash);
  writeLocalBoardOrder(scope, rootPath, [
    ...currentOrder.filter((id) => id !== boardId),
    boardId,
  ]);
  return summarizeLocalBoard(boardId, item.board, scope);
}

export function boardName(board: JsonCanvasDocument | null) {
  return board?.then?.name?.trim() || "Idea Board";
}
