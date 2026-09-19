import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { createLatestFrameScheduler } from "./utils/latestFrameScheduler";
import {
  CANVAS_LIVE_DATA_EVENT,
  createCanvasDocument,
  createCanvasEdge,
  createCanvasGroupNode,
  createCanvasReferenceNode,
  createCanvasTextNode,
  IDEA_FRAGMENT_DRAG_MIME,
  nextCanvasId,
  normalizeCanvasDocument,
  REFERENCE_FILE_DRAG_MIME,
  type CanvasBoardSummary,
  type CanvasCopyToIdeaItem,
  type CanvasEdgeConnector,
  type CanvasCopyToIdeaRequest,
  type CanvasCopyToPlotRequest,
  type CanvasEdge,
  type CanvasFocusIdeaRequest,
  type CanvasGroupNode,
  type CanvasIdeaThreadOption,
  type CanvasLiveDataEvent,
  type CanvasNode,
  type CanvasReferenceNode,
  type CanvasScope,
  type CanvasTextNode,
  type CanvasWindowPayload,
  type JsonCanvasDocument,
} from "./canvasTypes";
import type { CanvasNodeFontSource, ReferenceFileInfo, WritingMode } from "./types";
import { ReferenceReadOnlyPreview } from "./components/references/ReferenceLayer";
import IntermediateDraftPane from "./components/canvas/IntermediateDraftPane";
import { draftBoardKey, type DraftCanvasContext, type DraftHistory } from "./intermediateDraft";
import { prepareDraftBoardTrash } from "./intermediateDraftStore";
import { CanvasBoardSaveQueue, canvasBoardTargetKey, type CanvasBoardTarget } from "./canvasBoardSaveQueue";
import {
  attachNodeToThread,
  collectThreadDescendantIds,
  detachNodeFromThread,
  findThreadDropTarget,
  hiddenThreadNodeIds,
  shouldDetachFromThread,
  THREAD_DETACH_MARGIN,
  THREAD_DROP_MARGIN,
} from "./canvasThreads";
import {
  resizeCanvasRect,
  type CanvasResizeCorner,
} from "./canvasResize";

const CANVAS_WIDTH = 6400;
const CANVAS_HEIGHT = 4200;
const NEW_THREAD_TARGET = "__new__";
const LOCAL_STORAGE_PREFIX = "then.canvas-board";
const HISTORY_LIMIT = 60;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const MAX_WHEEL_DELTA = 240;
const CANVAS_RESIZE_CORNERS: CanvasResizeCorner[] = ["nw", "ne", "sw", "se"];

type TrashedCanvasBoardSummary = {
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

type CanvasTool = "select" | "text" | "group" | "edge";
type CanvasEdgeSide = NonNullable<CanvasEdge["fromSide"]>;

type Point = {
  x: number;
  y: number;
};

const EDGE_CONNECTORS: Array<{ value: CanvasEdgeConnector; label: string; title: string }> = [
  { value: "line", label: "線", title: "順序なしの線" },
  { value: "arrow", label: "矢印", title: "元のカードから先のカードへの矢印" },
  { value: "bidirectional", label: "双方向", title: "双方向の矢印" },
  { value: "dashed", label: "破線", title: "補助的なつながり" },
];

const CARD_COLORS = [
  { value: "", label: "標準" },
  { value: "1", label: "赤" },
  { value: "2", label: "橙" },
  { value: "3", label: "黄" },
  { value: "4", label: "緑" },
  { value: "5", label: "青" },
  { value: "6", label: "紫" },
] as const;

const SIDE_NORMALS: Record<CanvasEdgeSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const EDGE_ENDPOINT_GAP = 6;
const EDGE_ARROW_LENGTH = 14;
const EDGE_ARROW_HALF_WIDTH = 5.5;

type DragState =
  | {
      kind: "pan";
      start: Point;
      pan: Point;
      background?: boolean;
      moved?: boolean;
    }
  | {
      kind: "node";
      start: Point;
      nodeIds: string[];
      primaryNodeId: string;
      canThread: boolean;
      originals: Map<string, Point>;
      pushed?: boolean;
      moved?: boolean;
    }
  | {
      kind: "resize";
      start: Point;
      nodeId: string;
      corner: CanvasResizeCorner;
      x: number;
      y: number;
      width: number;
      height: number;
      pushed?: boolean;
    }
  | {
      kind: "marquee";
      start: Point;
      additive: boolean;
      base: string[];
    };

type MarqueeRect = { x: number; y: number; width: number; height: number };

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

const fallbackPayload: CanvasWindowPayload = {
  requestId: "browser-preview",
  rootPath: null,
  workspaceName: "Global",
  scope: "global",
  theme: "dark",
  editorFontFamily: "Noto Serif JP, serif",
  uiFontFamily: "Segoe UI, Noto Sans JP, sans-serif",
  uiFontScale: 1,
  canvasDefaultWritingMode: "horizontal-tb",
  canvasDefaultFontSource: "ui",
  ideaThreads: [{ id: "idea-inbox", kind: "inbox", title: "インボックス" }],
};

function localStorageKey(scope: CanvasScope, rootPath: string | null) {
  return `${LOCAL_STORAGE_PREFIX}.${scope}.${rootPath ?? "global"}`;
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
  window.localStorage.setItem(localStorageKey(scope, rootPath), JSON.stringify(boards));
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

async function listBoards(scope: CanvasScope, rootPath: string | null) {
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

async function createBoard(scope: CanvasScope, rootPath: string | null, name: string) {
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

async function loadBoard(scope: CanvasScope, rootPath: string | null, boardId: string) {
  if (isTauriRuntime()) {
    return invoke<unknown>("load_canvas_board", { scope, rootPath, boardId });
  }
  return readLocalBoards(scope, rootPath)[boardId] ?? createCanvasDocument("Idea Board", scope);
}

async function saveBoard(
  scope: CanvasScope,
  rootPath: string | null,
  boardId: string,
  board: JsonCanvasDocument,
) {
  if (isTauriRuntime()) {
    await invoke("save_canvas_board", { scope, rootPath, boardId, board });
    return;
  }
  const boards = readLocalBoards(scope, rootPath);
  boards[boardId] = board;
  writeLocalBoards(scope, rootPath, boards);
}

// Mode changes can remount Canvas while a native save is still in flight.
// The next instance must wait for the same queue before loading its board.
const canvasBoardSaveQueue = new CanvasBoardSaveQueue(saveBoard);

async function reorderBoards(
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

async function trashBoard(scope: CanvasScope, rootPath: string | null, boardId: string) {
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


async function listTrashedBoards(
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

async function restoreTrashedBoard(
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

function isTextNode(node: CanvasNode): node is CanvasTextNode {
  return node.type === "text";
}

function isGroupNode(node: CanvasNode): node is CanvasGroupNode {
  return node.type === "group";
}

function isReferenceNode(node: CanvasNode): node is CanvasReferenceNode {
  return node.type === "reference";
}

function nodeCenter(node: CanvasNode): Point {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function edgeConnector(edge: CanvasEdge): CanvasEdgeConnector {
  return edge.connector ?? "arrow";
}

function automaticEdgeSides(
  from: CanvasNode,
  to: CanvasNode,
): { fromSide: CanvasEdgeSide; toSide: CanvasEdgeSide } {
  const fromCenter = nodeCenter(from);
  const toCenter = nodeCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { fromSide: "right", toSide: "left" }
      : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0
    ? { fromSide: "bottom", toSide: "top" }
    : { fromSide: "top", toSide: "bottom" };
}

function edgeAnchorPoint(node: CanvasNode, side: CanvasEdgeSide): Point {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
  }
}

function edgeControlPoint(point: Point, side: CanvasEdgeSide, offset: number): Point {
  const normal = SIDE_NORMALS[side];
  return {
    x: point.x + normal.x * offset,
    y: point.y + normal.y * offset,
  };
}

function edgePath(from: CanvasNode, to: CanvasNode, edge?: CanvasEdge) {
  const automatic = automaticEdgeSides(from, to);
  const sides = {
    fromSide: edge?.fromSide ?? automatic.fromSide,
    toSide: edge?.toSide ?? automatic.toSide,
  };
  const startAnchor = edgeAnchorPoint(from, sides.fromSide);
  const endAnchor = edgeAnchorPoint(to, sides.toSide);
  const start = edgeControlPoint(startAnchor, sides.fromSide, EDGE_ENDPOINT_GAP);
  const end = edgeControlPoint(endAnchor, sides.toSide, EDGE_ENDPOINT_GAP);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const offset = Math.max(56, Math.min(180, distance * 0.42));
  const fromControl = edgeControlPoint(start, sides.fromSide, offset);
  const toControl = edgeControlPoint(end, sides.toSide, offset);
  return {
    start,
    end,
    fromControl,
    toControl,
    mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    d: `M ${start.x} ${start.y} C ${fromControl.x} ${fromControl.y}, ${toControl.x} ${toControl.y}, ${end.x} ${end.y}`,
  };
}

function threadPath(parent: CanvasTextNode, child: CanvasTextNode) {
  const railX = parent.x + 14;
  const startY = parent.y + parent.height;
  const endX = child.x + 4;
  const endY = child.y;
  const turnY = Math.max(startY + 8, endY - 10);
  return `M ${railX} ${startY} L ${railX} ${turnY} Q ${railX} ${endY}, ${endX} ${endY}`;
}

function arrowHeadPath(tip: Point, direction: Point) {
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0) return "";
  const ux = direction.x / length;
  const uy = direction.y / length;
  const px = -uy;
  const py = ux;
  const base = {
    x: tip.x - ux * EDGE_ARROW_LENGTH,
    y: tip.y - uy * EDGE_ARROW_LENGTH,
  };
  const left = {
    x: base.x + px * EDGE_ARROW_HALF_WIDTH,
    y: base.y + py * EDGE_ARROW_HALF_WIDTH,
  };
  const right = {
    x: base.x - px * EDGE_ARROW_HALF_WIDTH,
    y: base.y - py * EDGE_ARROW_HALF_WIDTH,
  };
  return `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y}`;
}

function textForNode(node: CanvasTextNode) {
  return node.text;
}

function isNodeInsideGroup(node: CanvasNode, group: CanvasGroupNode) {
  const center = nodeCenter(node);
  return (
    center.x >= group.x &&
    center.x <= group.x + group.width &&
    center.y >= group.y &&
    center.y <= group.y + group.height
  );
}

function isGroupMovableChild(node: CanvasNode) {
  return !isGroupNode(node);
}

function sortCanvasItems(items: CanvasTextNode[]) {
  return [...items].sort((left, right) => {
    const y = left.y - right.y;
    if (Math.abs(y) > 12) return y;
    return left.x - right.x;
  });
}

function referenceKindLabel(kind: CanvasReferenceNode["kind"]) {
  switch (kind) {
    case "text":
      return "TXT";
    case "markdown":
      return "MD";
    case "image":
      return "IMAGE";
    case "pdf":
      return "PDF";
    default:
      return "FILE";
  }
}

function formatCanvasReferenceSize(size: number | undefined) {
  if (!Number.isFinite(size) || !size || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function boardName(board: JsonCanvasDocument | null) {
  return board?.then?.name?.trim() || "Idea Board";
}

async function emitMainWindow<T>(event: string, payload: T) {
  try {
    await emitTo<T>("main", event, payload);
  } catch {
    await emit<T>(event, payload);
  }
}

function formatSaveTime(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatDeletedTime(timestamp: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function toolLabel(tool: CanvasTool) {
  switch (tool) {
    case "text":
      return "カード";
    case "group":
      return "グループ";
    case "edge":
      return "接続線";
    default:
      return "選択";
  }
}

const TOOL_SHORTCUTS: Record<string, CanvasTool> = {
  v: "select",
  c: "text",
  g: "group",
  e: "edge",
};

const TOOL_SHORTCUT_ALIASES: Record<string, CanvasTool> = {
  t: "text",
};

function toolShortcutLabel(tool: CanvasTool) {
  const entry = Object.entries(TOOL_SHORTCUTS).find(([, value]) => value === tool);
  return entry ? entry[0].toUpperCase() : "";
}

function CanvasGlyph({
  name,
}: {
  name:
    | CanvasTool
    | "trash"
    | "plus"
    | "target"
    | "copy"
    | "reset"
    | "send"
    | "help"
    | "edit"
    | "style"
    | "reference"
    | "fit"
    | "undo"
    | "redo"
    | "plot"
    | "panel"
    | "grip"
    | "chevronUp"
    | "chevronDown";
}) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true, focusable: false };
  switch (name) {
    case "text":
      return (
        <svg {...common}>
          <path d="M5 5h14" />
          <path d="M12 5v14" />
          <path d="M8 19h8" />
        </svg>
      );
    case "group":
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
      );
    case "edge":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <path d="M8.5 12h7" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m6 7 1 13h10l1-13" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "grip":
      return (
        <svg {...common}>
          <circle cx="9" cy="7" r="1" />
          <circle cx="15" cy="7" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="9" cy="17" r="1" />
          <circle cx="15" cy="17" r="1" />
        </svg>
      );
    case "chevronUp":
      return (
        <svg {...common}>
          <path d="m7 14 5-5 5 5" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...common}>
          <path d="m7 10 5 5 5-5" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 3v3" />
          <path d="M21 12h-3" />
          <path d="M12 21v-3" />
          <path d="M3 12h3" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "reset":
      return (
        <svg {...common}>
          <path d="M4 4v6h6" />
          <path d="M20 20v-6h-6" />
          <path d="M20 10a8 8 0 0 0-13.5-4.5L4 8" />
          <path d="M4 14a8 8 0 0 0 13.5 4.5L20 16" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M5 12h13" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.7 2.7 0 0 1 5.1 1.2c0 1.8-2.6 2.2-2.6 4" />
          <path d="M12 18h.01" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
          <path d="M13.5 7.5l3 3" />
        </svg>
      );
    case "style":
      return (
        <svg {...common}>
          <path d="M5 19 10 5h4l5 14" />
          <path d="M7 14h10" />
          <path d="M20 5v14" />
        </svg>
      );
    case "reference":
      return (
        <svg {...common}>
          <path d="M7 3.5h8l3 3V20H7V3.5Z" />
          <path d="M15 3.5V7h3" />
          <path d="M9.5 11h5" />
          <path d="M9.5 14h5" />
          <path d="M9.5 17h3.5" />
        </svg>
      );
    case "fit":
      return (
        <svg {...common}>
          <path d="M4 9V4h5" />
          <path d="M20 9V4h-5" />
          <path d="M4 15v5h5" />
          <path d="M20 15v5h-5" />
        </svg>
      );
    case "undo":
      return (
        <svg {...common}>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
        </svg>
      );
    case "redo":
      return (
        <svg {...common}>
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H10a6 6 0 0 0 0 12h3" />
        </svg>
      );
    case "plot":
      return (
        <svg {...common}>
          <path d="M8 5h13" />
          <path d="M8 12h13" />
          <path d="M8 19h13" />
          <path d="M3 5h.01" />
          <path d="M3 12h.01" />
          <path d="M3 19h.01" />
        </svg>
      );
    case "panel":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <path d="M14.5 5v14" />
          <path d="M17 9h1" />
          <path d="M17 12h1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="m5 3 7 17 2-7 7-2z" />
        </svg>
      );
  }
}

function fragmentPreview(body: string) {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 64 ? `${line.slice(0, 64)}…` : line;
}

/**
 * 別ウィンドウ表示のキャンバスで、メイン画面の右サイドバー相当（Idea・資料）を
 * 引き継ぐサイドパネル。項目はドラッグまたはクリックでキャンバスへ追加する。
 */
function CanvasSidePanel({
  threads,
  referenceFiles,
  onInsertFragment,
  onInsertReference,
  onClose,
}: {
  threads: CanvasIdeaThreadOption[];
  referenceFiles: ReferenceFileInfo[];
  onInsertFragment: (body: string) => void;
  onInsertReference: (file: ReferenceFileInfo) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"idea" | "reference">("idea");
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();

  const visibleThreads = threads
    .map((thread) => ({
      ...thread,
      fragments: (thread.fragments ?? []).filter((fragment) =>
        normalized ? fragment.body.toLocaleLowerCase().includes(normalized) : true,
      ),
    }))
    .filter((thread) => !normalized || thread.fragments.length > 0);
  const visibleFiles = referenceFiles.filter((file) =>
    normalized
      ? `${file.name} ${file.sourcePath}`.toLocaleLowerCase().includes(normalized)
      : true,
  );

  return (
    <aside className="canvasSidePanel" aria-label="Idea と資料">
      <header className="canvasSidePanelHeader">
        <div className="canvasSidePanelTabs" role="tablist" aria-label="サイドパネル">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "idea"}
            className={tab === "idea" ? "isActive" : ""}
            onClick={() => setTab("idea")}
          >
            Idea
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "reference"}
            className={tab === "reference" ? "isActive" : ""}
            onClick={() => setTab("reference")}
          >
            資料
          </button>
        </div>
        <button
          className="canvasIconButton"
          type="button"
          aria-label="サイドパネルを畳む"
          title="サイドパネルを畳む"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <input
        className="canvasSidePanelSearch"
        value={query}
        type="search"
        placeholder={tab === "idea" ? "断片を検索" : "資料を検索"}
        aria-label={tab === "idea" ? "断片を検索" : "資料を検索"}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="canvasSidePanelBody">
        {tab === "idea" ? (
          visibleThreads.length === 0 ? (
            <p className="canvasSidePanelEmpty">Idea 断片がありません</p>
          ) : (
            visibleThreads.map((thread) => (
              <section className="canvasSidePanelGroup" key={thread.id}>
                <h3>{thread.title}</h3>
                {thread.fragments.length === 0 ? (
                  <p className="canvasSidePanelEmpty">断片がありません</p>
                ) : (
                  thread.fragments.map((fragment) => (
                    <button
                      className={`canvasSidePanelItem ${fragment.used ? "isUsed" : ""}`}
                      key={fragment.id}
                      type="button"
                      draggable
                      title="ドラッグまたはクリックでキャンバスへ追加"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData(IDEA_FRAGMENT_DRAG_MIME, fragment.id);
                        event.dataTransfer.setData("text/plain", fragment.body);
                      }}
                      onClick={() => onInsertFragment(fragment.body)}
                    >
                      {fragmentPreview(fragment.body)}
                    </button>
                  ))
                )}
              </section>
            ))
          )
        ) : visibleFiles.length === 0 ? (
          <p className="canvasSidePanelEmpty">資料がありません</p>
        ) : (
          visibleFiles.map((file) => (
            <button
              className="canvasSidePanelItem canvasSidePanelFile"
              key={file.sourcePath}
              type="button"
              draggable
              title={`${file.sourcePath}\nドラッグまたはクリックでキャンバスへ追加`}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(REFERENCE_FILE_DRAG_MIME, JSON.stringify(file));
                event.dataTransfer.setData("text/plain", file.name);
              }}
              onClick={() => onInsertReference(file)}
            >
              <span>{referenceKindLabel(file.kind)}</span>
              <strong>{file.name}</strong>
            </button>
          ))
        )}
      </div>
      <p className="canvasSidePanelHint">ドラッグでキャンバスの好きな場所に置けます</p>
    </aside>
  );
}

type CanvasWindowAppProps = {
  /**
   * メイン画面のキャンバスモードとして描画する場合 true。
   * ペイロードは Tauri 経由ではなく props から受け取り、外枠（テーマ・フォント変数）
   * は親の appShell を継承する。
   */
  embedded?: boolean;
  /** embedded 時のペイロード。requestId が変わるとボードを読み直す。 */
  embeddedPayload?: CanvasWindowPayload | null;
  /** embedded 時に Idea 送信先セレクトへ反映する最新のスレッド一覧。 */
  liveIdeaThreads?: CanvasIdeaThreadOption[];
  /** embedded 時に資料メニューへ反映する最新の資料一覧。 */
  liveReferenceFiles?: ReferenceFileInfo[];
  onDraftCanvasChange?: (context: DraftCanvasContext | null) => void;
  draftSelectRequest?: { id: string; nonce: number } | null;
  onDraftSelectionConsumed?: (nonce: number) => void;
  onOpenDraft?: () => void;
};

export default function CanvasWindowApp({
  embedded = false,
  embeddedPayload = null,
  liveIdeaThreads,
  liveReferenceFiles,
  onDraftCanvasChange,
  draftSelectRequest,
  onDraftSelectionConsumed,
  onOpenDraft,
}: CanvasWindowAppProps = {}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const boardSaveQueue = canvasBoardSaveQueue;
  const loadedBoardTargetRef = useRef<CanvasBoardTarget | null>(null);
  const boardLoadGenerationRef = useRef(0);
  const boardOrderSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const suppressNextSaveRef = useRef(false);
  const boardRef = useRef<JsonCanvasDocument | null>(null);
  const draftCanvasReadyRef = useRef(false);
  const historyRef = useRef<{ undo: JsonCanvasDocument[]; redo: JsonCanvasDocument[] }>({
    undo: [],
    redo: [],
  });
  // 連続入力（カード本文・ラベル等）を1回分の履歴に合体するためのセッションキー。
  const editSessionRef = useRef<string | null>(null);
  const marqueePointRef = useRef<Point | null>(null);
  const spaceDownRef = useRef(false);
  const threadDropTargetRef = useRef<string | null>(null);

  const [payload, setPayload] = useState<CanvasWindowPayload | null>(null);
  const [scope, setScope] = useState<CanvasScope>("global");
  const [boards, setBoards] = useState<CanvasBoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [board, setBoard] = useState<JsonCanvasDocument | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [edgeFromId, setEdgeFromId] = useState<string | null>(null);
  const [edgeCursor, setEdgeCursor] = useState<Point | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [pendingFocusNodeId, setPendingFocusNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [threadDropTargetId, setThreadDropTargetId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [targetThreadId, setTargetThreadId] = useState("idea-inbox");
  const [pan, setPan] = useState<Point>({ x: 180, y: 120 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const [status, setStatus] = useState("読み込み中");
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const [isReferenceMenuOpen, setIsReferenceMenuOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [draggedBoardId, setDraggedBoardId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CanvasBoardSummary | null>(null);
  const [isTrashModalOpen, setIsTrashModalOpen] = useState(false);
  const [trashedBoards, setTrashedBoards] = useState<TrashedCanvasBoardSummary[]>([]);
  const [isTrashLoading, setIsTrashLoading] = useState(false);
  // 別ウィンドウ表示のときだけ使う Idea・資料サイドパネル。
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const [isDraftPanelOpen, setIsDraftPanelOpen] = useState(false);
  /**
   * メイン画面から届く Idea・資料の最新一覧（別ウィンドウ用）。payload と違い
   * ボードの再読込を伴わないため、断片の追加・編集が開いたままのウィンドウにも
   * 反映される。null の間は payload の内容を使う。
   */
  const [livePanelData, setLivePanelData] = useState<CanvasLiveDataEvent | null>(null);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const rootPath = payload?.rootPath ?? null;
  useEffect(() => {
    onDraftCanvasChange?.(board && activeBoardId && draftCanvasReadyRef.current && status !== "読み込み中"
      ? { boardId: activeBoardId, scope, rootPath, board, selectedIds: [...selectedIds] } : null);
  }, [board, activeBoardId, scope, rootPath, selectedIds, status, onDraftCanvasChange]);
  const selectDraftNode = useCallback((id: string) => {
    const node = boardRef.current?.nodes.find((item) => item.id === id);
    if (!node) return;
    setSelectedIds(new Set([id]));
    setSelectedEdgeId(null);
    const viewport = viewportRef.current;
    if (viewport) setPan({ x: viewport.clientWidth / 2 - (node.x + node.width / 2) * zoom,
      y: viewport.clientHeight / 2 - (node.y + node.height / 2) * zoom });
  }, [zoom]);
  useEffect(() => {
    if (!draftSelectRequest) return;
    selectDraftNode(draftSelectRequest.id);
    onDraftSelectionConsumed?.(draftSelectRequest.nonce);
  }, [draftSelectRequest, selectDraftNode, onDraftSelectionConsumed]);
  const selectedNodes = useMemo(
    () => board?.nodes.filter((node) => selectedIds.has(node.id)) ?? [],
    [board, selectedIds],
  );
  const selectedEdge = useMemo(
    () => board?.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [board, selectedEdgeId],
  );
  const hiddenThreadIds = useMemo(
    () => hiddenThreadNodeIds(board?.nodes ?? []),
    [board],
  );
  const threadChildCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const textById = new Map(
      (board?.nodes ?? [])
        .filter((node): node is CanvasTextNode => isTextNode(node))
        .map((node) => [node.id, node] as const),
    );
    textById.forEach((node) => {
      const visited = new Set<string>([node.id]);
      let parentId = node.threadParentId;
      while (parentId && !visited.has(parentId)) {
        const parent = textById.get(parentId);
        if (!parent) break;
        counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
        visited.add(parent.id);
        parentId = parent.threadParentId;
      }
    });
    return counts;
  }, [board]);
  // 優先順: embedded の props > 別ウィンドウのライブイベント > 開いた時点の payload。
  // 資料一覧のライブ反映は、開いた時点でプロジェクト情報がある（=プレビュー可能な）
  // ウィンドウに限る。global で開いた場合は従来どおり空のまま。
  const referenceFiles =
    liveReferenceFiles ??
    (payload?.rootPath ? livePanelData?.referenceFiles : undefined) ??
    payload?.referenceFiles ??
    [];
  const ideaThreadOptions =
    liveIdeaThreads ?? livePanelData?.ideaThreads ?? payload?.ideaThreads ?? [];
  const filteredReferenceFiles = useMemo(() => {
    const normalized = referenceQuery.trim().toLocaleLowerCase();
    if (!normalized) return referenceFiles;
    return referenceFiles.filter((file) =>
      `${file.name} ${file.sourcePath}`.toLocaleLowerCase().includes(normalized),
    );
  }, [referenceFiles, referenceQuery]);
  const textNodesForIdea = useMemo(() => {
    if (!board) return [];
    const selectedGroup = selectedNodes.length === 1 ? selectedNodes[0] : null;
    if (selectedGroup && isGroupNode(selectedGroup)) {
      return sortCanvasItems(
        board.nodes.filter(
          (node): node is CanvasTextNode =>
            isTextNode(node) && isNodeInsideGroup(node, selectedGroup),
        ),
      );
    }
    return sortCanvasItems(selectedNodes.filter(isTextNode));
  }, [board, selectedNodes]);
  const selectedTextNodesForStyle = useMemo(() => {
    if (!board) return [];
    const next = new Map<string, CanvasTextNode>();
    selectedNodes.filter(isTextNode).forEach((node) => next.set(node.id, node));
    selectedNodes.filter(isGroupNode).forEach((group) => {
      board.nodes
        .filter((node): node is CanvasTextNode => isTextNode(node) && isNodeInsideGroup(node, group))
        .forEach((node) => next.set(node.id, node));
    });
    return [...next.values()];
  }, [board, selectedNodes]);
  const selectedGroupChildIds = useMemo(() => {
    if (!board) return new Set<string>();
    const selectedGroups = selectedNodes.filter(isGroupNode);
    if (selectedGroups.length === 0) return new Set<string>();
    const childIds = new Set<string>();
    board.nodes.forEach((node) => {
      if (!isGroupMovableChild(node) || selectedIds.has(node.id)) return;
      if (selectedGroups.some((group) => isNodeInsideGroup(node, group))) {
        childIds.add(node.id);
      }
    });
    return childIds;
  }, [board, selectedIds, selectedNodes]);
  const selectedWritingMode = selectedTextNodesForStyle.length
    ? selectedTextNodesForStyle.every(
        (node) =>
          (node.writingMode ?? payload?.canvasDefaultWritingMode ?? "horizontal-tb") ===
          (selectedTextNodesForStyle[0].writingMode ??
            payload?.canvasDefaultWritingMode ??
            "horizontal-tb"),
      )
      ? selectedTextNodesForStyle[0].writingMode ??
        payload?.canvasDefaultWritingMode ??
        "horizontal-tb"
      : null
    : null;
  const selectedFontSource = selectedTextNodesForStyle.length
    ? selectedTextNodesForStyle.every(
        (node) =>
          (node.fontSource ?? payload?.canvasDefaultFontSource ?? "ui") ===
          (selectedTextNodesForStyle[0].fontSource ?? payload?.canvasDefaultFontSource ?? "ui"),
      )
      ? selectedTextNodesForStyle[0].fontSource ?? payload?.canvasDefaultFontSource ?? "ui"
      : null
    : null;
  const selectedCardColor = selectedTextNodesForStyle.length
    ? selectedTextNodesForStyle.every(
        (node) => (node.color ?? "") === (selectedTextNodesForStyle[0].color ?? ""),
      )
      ? selectedTextNodesForStyle[0].color ?? ""
      : null
    : null;
  const singleSelectedTextNode =
    selectedNodes.length === 1 && isTextNode(selectedNodes[0]) ? selectedNodes[0] : null;

  const themeStyle = useMemo(
    () =>
      ({
        "--editor-font-family": payload?.editorFontFamily,
        "--ui-font-family": payload?.uiFontFamily,
        "--ui-font-scale": payload?.uiFontScale,
      }) as CSSProperties,
    [payload?.editorFontFamily, payload?.uiFontFamily, payload?.uiFontScale],
  );
  const defaultCanvasWritingMode = payload?.canvasDefaultWritingMode ?? "horizontal-tb";
  const defaultCanvasFontSource = payload?.canvasDefaultFontSource ?? "ui";

  const patchBoard = useCallback((updater: (current: JsonCanvasDocument) => JsonCanvasDocument) => {
    if (!draftCanvasReadyRef.current) return;
    setBoard((current) => {
      if (!current) return current;
      const next = updater(current);
      const updated: JsonCanvasDocument = {
        ...next,
        then: {
          version: 1,
          name: boardName(next),
          scope: next.then?.scope,
          createdAt: next.then?.createdAt,
          updatedAt: Date.now(),
        },
      };
      boardRef.current = updated;
      return updated;
    });
  }, []);

  const setThreadDropTarget = useCallback((nodeId: string | null) => {
    threadDropTargetRef.current = nodeId;
    setThreadDropTargetId(nodeId);
  }, []);

  /** 変更前のボードを履歴に積む。sessionKey が前回と同じ間は積み直さない（連続入力の合体用）。 */
  const pushHistory = useCallback((sessionKey?: string) => {
    const current = boardRef.current;
    if (!current) return;
    if (sessionKey && editSessionRef.current === sessionKey) return;
    editSessionRef.current = sessionKey ?? null;
    const stack = historyRef.current;
    stack.undo.push(current);
    if (stack.undo.length > HISTORY_LIMIT) stack.undo.shift();
    stack.redo = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = { undo: [], redo: [] };
    editSessionRef.current = null;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const undoBoard = useCallback(() => {
    if (!draftCanvasReadyRef.current) return;
    const stack = historyRef.current;
    const previous = stack.undo.pop();
    const current = boardRef.current;
    if (!previous || !current) {
      setCanUndo(stack.undo.length > 0);
      return;
    }
    stack.redo.push(current);
    editSessionRef.current = null;
    boardRef.current = previous;
    setBoard(previous);
    setCanUndo(stack.undo.length > 0);
    setCanRedo(true);
  }, []);

  const redoBoard = useCallback(() => {
    if (!draftCanvasReadyRef.current) return;
    const stack = historyRef.current;
    const next = stack.redo.pop();
    const current = boardRef.current;
    if (!next || !current) {
      setCanRedo(stack.redo.length > 0);
      return;
    }
    stack.undo.push(current);
    editSessionRef.current = null;
    boardRef.current = next;
    setBoard(next);
    setCanRedo(stack.redo.length > 0);
    setCanUndo(true);
  }, []);

  const renameBoard = (name: string) => {
    const nextName = name.trim() || "Idea Board";
    pushHistory();
    patchBoard((current) => ({
      ...current,
      then: {
        version: 1,
        name: nextName,
        scope: current.then?.scope ?? scope,
        createdAt: current.then?.createdAt,
        updatedAt: Date.now(),
      },
    }));
    if (activeBoardId) {
      setBoards((current) =>
        current.map((item) =>
          item.id === activeBoardId ? { ...item, name: nextName, updatedAt: Date.now() } : item,
        ),
      );
    }
  };

  const openRenameModal = () => {
    setRenameDraft(boardName(board));
    setIsRenameModalOpen(true);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    renameBoard(renameDraft);
    setIsRenameModalOpen(false);
  };

  const defaultBoardName = () =>
    scope === "project" && payload ? `${payload.workspaceName} ボード` : "共通ボード";

  const openCreateModal = () => {
    setIsBoardMenuOpen(false);
    setCreateDraft(defaultBoardName());
    setIsCreateModalOpen(true);
  };

  const openTrashModal = async () => {
    if (!payload) return;
    setIsBoardMenuOpen(false);
    setIsTrashModalOpen(true);
    setIsTrashLoading(true);
    try {
      setTrashedBoards(await listTrashedBoards(scope, payload.rootPath));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setIsTrashLoading(false);
    }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payload) return;
    setIsCreateModalOpen(false);
    try {
      const created = await createBoard(scope, payload.rootPath, createDraft.trim() || defaultBoardName());
      await loadBoardList(scope, created.id);
    } catch (error) {
      setStatus(String(error));
    }
  };

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = viewportRef.current?.getBoundingClientRect();
      return {
        x: ((clientX - (rect?.left ?? 0)) - pan.x) / zoom,
        y: ((clientY - (rect?.top ?? 0)) - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom],
  );

  const viewportCenterWorld = (): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return screenToWorld(
      (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
      (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
    );
  };

  const materializeReferenceForBoard = async (file: ReferenceFileInfo): Promise<ReferenceFileInfo | null> => {
    const normalized: ReferenceFileInfo = {
      ...file,
      scope: file.scope === "global" ? "global" : "project",
    };
    if (scope !== "global" || normalized.scope !== "project") return normalized;
    if (!rootPath) {
      setStatus("共通ボードには共通資料のみ追加できます");
      return null;
    }
    if (!isTauriRuntime()) {
      setStatus("共通ボードへ追加するには共通資料へコピーしてください");
      return null;
    }
    try {
      const copied = await invoke<ReferenceFileInfo>("copy_reference_to_scope", {
        rootPath,
        sourcePath: normalized.sourcePath,
        sourceScope: normalized.scope,
        targetScope: "global",
      });
      setStatus("共通資料へコピーして追加しました");
      return copied;
    } catch (error) {
      setStatus(String(error));
      return null;
    }
  };

  const insertReferenceNodeAt = async (file: ReferenceFileInfo, point: Point) => {
    if (!board) return;
    const materialized = await materializeReferenceForBoard(file);
    if (!materialized) return;
    const width = 380;
    const height = 260;
    const node = createCanvasReferenceNode(materialized, {
      x: Math.max(0, point.x - width / 2),
      y: Math.max(0, point.y - height / 2),
      width,
      height,
    });
    pushHistory();
    patchBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedIds(new Set([node.id]));
    setSelectedEdgeId(null);
  };

  const insertIdeaTextNodeAt = (body: string, point: Point) => {
    if (!board) return;
    const width = 260;
    const height = 150;
    const node = createCanvasTextNode(body, {
      x: Math.max(0, point.x - width / 2),
      y: Math.max(0, point.y - height / 2),
      writingMode: defaultCanvasWritingMode,
      fontSource: defaultCanvasFontSource,
    });
    pushHistory();
    patchBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedIds(new Set([node.id]));
    setSelectedEdgeId(null);
  };

  const addReferenceNode = (file: (typeof referenceFiles)[number]) => {
    void insertReferenceNodeAt(file, viewportCenterWorld());
    setTool("select");
    setIsReferenceMenuOpen(false);
    setReferenceQuery("");
  };

  // 右サイドバー（embedded）／サイドパネル（別ウィンドウ）から Idea 断片・資料を
  // ドラッグしてキャンバスへ落とす。断片本文は text/plain で受け取る。
  const canAcceptCanvasDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const types = event.dataTransfer.types;
    return types.includes(IDEA_FRAGMENT_DRAG_MIME) || types.includes(REFERENCE_FILE_DRAG_MIME);
  };

  const handleViewportDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!canAcceptCanvasDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleViewportDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!canAcceptCanvasDrop(event) || !board) return;
    event.preventDefault();
    event.stopPropagation();
    const point = screenToWorld(event.clientX, event.clientY);
    if (event.dataTransfer.types.includes(REFERENCE_FILE_DRAG_MIME)) {
      try {
        const file = JSON.parse(
          event.dataTransfer.getData(REFERENCE_FILE_DRAG_MIME),
        ) as ReferenceFileInfo;
        if (file && typeof file.sourcePath === "string" && file.sourcePath) {
          void insertReferenceNodeAt(file, point);
        }
      } catch {
        // 壊れたドラッグデータは無視する
      }
      return;
    }
    const body = event.dataTransfer.getData("text/plain");
    if (!body.trim()) return;
    insertIdeaTextNodeAt(body, point);
  };

  const loadBoardList = useCallback(
    async (nextScope: CanvasScope, preferredBoardId?: string, selectNodeId?: string) => {
      if (!payload) return;
      const generation = ++boardLoadGenerationRef.current;
      draftCanvasReadyRef.current = false;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setStatus("読み込み中");
      setEdgeFromId(null);
      setEdgeCursor(null);
      setSelectedEdgeId(null);
      setEditingNodeId(null);
      setThreadDropTarget(null);
      try {
        await boardSaveQueue.flush();
        if (generation !== boardLoadGenerationRef.current) return;
        const summaries = await listBoards(nextScope, payload.rootPath);
        if (generation !== boardLoadGenerationRef.current) return;
        if (summaries.length === 0) {
          setBoards(summaries);
          setScope(nextScope);
          loadedBoardTargetRef.current = null;
          boardRef.current = null;
          setActiveBoardId(null);
          suppressNextSaveRef.current = true;
          setBoard(null);
          setSelectedIds(new Set());
          clearHistory();
          setStatus("ボードがありません");
          return;
        }
        const nextBoard =
          summaries.find((item) => item.id === preferredBoardId) ?? summaries[0];
        const rawBoard = await loadBoard(nextScope, payload.rootPath, nextBoard.id);
        if (generation !== boardLoadGenerationRef.current) return;
        const document = normalizeCanvasDocument(rawBoard, nextBoard.name, nextScope);
        loadedBoardTargetRef.current = { scope: nextScope, rootPath: payload.rootPath, boardId: nextBoard.id };
        boardRef.current = document;
        setBoards(summaries);
        setScope(nextScope);
        setActiveBoardId(nextBoard.id);
        suppressNextSaveRef.current = true;
        draftCanvasReadyRef.current = true;
        setBoard(document);
        setSelectedIds(selectNodeId ? new Set([selectNodeId]) : new Set());
        clearHistory();
        setStatus("保存済み");
      } catch (error) {
        if (generation === boardLoadGenerationRef.current) setStatus(String(error));
      }
    },
    [payload, clearHistory, boardSaveQueue, setThreadDropTarget],
  );

  useEffect(() => {
    if (embedded) {
      setPayload(embeddedPayload ?? fallbackPayload);
      return;
    }
    if (!isTauriRuntime()) {
      setPayload(fallbackPayload);
      return;
    }

    let unlistenPayload: (() => void) | null = null;
    invoke<CanvasWindowPayload | null>("get_canvas_window_payload")
      .then((nextPayload) => setPayload(nextPayload ?? fallbackPayload))
      .catch((error) => setStatus(String(error)));
    void listen<CanvasWindowPayload>("then-canvas-payload", (event) => {
      setPayload(event.payload);
    }).then((unlisten) => {
      unlistenPayload = unlisten;
    });

    return () => {
      unlistenPayload?.();
    };
  }, [embedded, embeddedPayload]);

  useEffect(() => {
    if (!payload) return;
    setTargetThreadId(
      payload.ideaThreads.find((thread) => thread.kind === "inbox")?.id ??
        payload.ideaThreads[0]?.id ??
        "idea-inbox",
    );
    // メイン画面の右サイドバー表示状態を別ウィンドウのサイドパネルへ引き継ぐ。
    if (!embedded) setIsSidePanelOpen(payload.rightSidebarVisible ?? true);
    // 開き直しの payload は最新のスナップショットなので、古いライブ差分は破棄する。
    setLivePanelData(null);
    void loadBoardList(payload.scope, payload.boardId, payload.selectNodeId);
  }, [payload, loadBoardList, embedded]);

  // メイン画面からの Idea・資料のライブ更新（別ウィンドウのみ）。ボードには触れない。
  useEffect(() => {
    if (embedded || !isTauriRuntime()) return;
    let dispose: (() => void) | undefined;
    void listen<CanvasLiveDataEvent>(CANVAS_LIVE_DATA_EVENT, (event) => {
      setLivePanelData(event.payload);
    }).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [embedded]);

  // ライブ更新で送信先スレッドが消えた場合はインボックス（先頭）へ戻す。
  useEffect(() => {
    if (targetThreadId === NEW_THREAD_TARGET || ideaThreadOptions.length === 0) return;
    if (ideaThreadOptions.some((thread) => thread.id === targetThreadId)) return;
    setTargetThreadId(
      ideaThreadOptions.find((thread) => thread.kind === "inbox")?.id ??
        ideaThreadOptions[0].id,
    );
  }, [ideaThreadOptions, targetThreadId]);

  useEffect(() => {
    if (!board || !activeBoardId || !payload) return;
    const target = loadedBoardTargetRef.current;
    if (!draftCanvasReadyRef.current || !target || canvasBoardTargetKey(target) !==
      canvasBoardTargetKey({ scope, rootPath: payload.rootPath, boardId: activeBoardId })) return;
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setStatus("保存中");
    boardSaveQueue.enqueue(target, board);
    const generation = boardLoadGenerationRef.current;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void boardSaveQueue.flush()
        .then(async () => {
          if (generation !== boardLoadGenerationRef.current) return;
          const summaries = await listBoards(target.scope, target.rootPath);
          if (generation !== boardLoadGenerationRef.current) return;
          setBoards(summaries);
          setStatus(`保存済み ${formatSaveTime(Date.now())}`);
        })
        .catch((error) => {
          if (generation === boardLoadGenerationRef.current) setStatus(String(error));
        });
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeBoardId, board, payload, scope, boardSaveQueue]);

  // モード切替などでアンマウントされる際、デバウンス待ちの保存を取りこぼさない。
  useEffect(() => {
    return () => {
      ++boardLoadGenerationRef.current;
      draftCanvasReadyRef.current = false;
      void boardSaveQueue.flush().catch(() => {});
    };
  }, [boardSaveQueue]);

  useEffect(() => {
    const applyPointerMove = (point: { clientX: number; clientY: number }) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      if (drag.kind === "pan") {
        if (Math.hypot(point.clientX - drag.start.x, point.clientY - drag.start.y) >= 3) {
          drag.moved = true;
        }
        const nextPan = {
          x: drag.pan.x + point.clientX - drag.start.x,
          y: drag.pan.y + point.clientY - drag.start.y,
        };
        panRef.current = nextPan;
        setPan(nextPan);
        return;
      }
      if (drag.kind === "marquee") {
        const worldPoint = screenToWorld(point.clientX, point.clientY);
        marqueePointRef.current = worldPoint;
        setMarqueeRect({
          x: Math.min(drag.start.x, worldPoint.x),
          y: Math.min(drag.start.y, worldPoint.y),
          width: Math.abs(worldPoint.x - drag.start.x),
          height: Math.abs(worldPoint.y - drag.start.y),
        });
        return;
      }
      if (!drag.pushed) {
        pushHistory();
        drag.pushed = true;
      }
      if (drag.kind === "node") {
        const dx = (point.clientX - drag.start.x) / zoom;
        const dy = (point.clientY - drag.start.y) / zoom;
        if (Math.hypot(point.clientX - drag.start.x, point.clientY - drag.start.y) >= 3) {
          drag.moved = true;
        }
        const currentNodes = boardRef.current?.nodes ?? [];
        const primary = currentNodes.find((node) => node.id === drag.primaryNodeId);
        const original = drag.originals.get(drag.primaryNodeId);
        if (drag.canThread && primary && original && isTextNode(primary)) {
          const dropPoint = screenToWorld(point.clientX, point.clientY);
          setThreadDropTarget(
            findThreadDropTarget(
              currentNodes,
              { ...primary, x: original.x + dx, y: original.y + dy },
              new Set(drag.nodeIds),
              dropPoint,
              THREAD_DROP_MARGIN / zoom,
            ),
          );
        } else {
          setThreadDropTarget(null);
        }
        patchBoard((current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const original = drag.originals.get(node.id);
            return original ? { ...node, x: original.x + dx, y: original.y + dy } : node;
          }),
        }));
        return;
      }
      const dx = (point.clientX - drag.start.x) / zoom;
      const dy = (point.clientY - drag.start.y) / zoom;
      patchBoard((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== drag.nodeId) return node;
          const resized = resizeCanvasRect(
            { x: drag.x, y: drag.y, width: drag.width, height: drag.height },
            drag.corner,
            dx,
            dy,
            node.type === "group" ? 260 : 150,
            node.type === "group" ? 160 : 90,
          );
          return { ...node, ...resized };
        }),
      }));
    };
    const pointerMoveScheduler = createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (id) => window.cancelAnimationFrame(id),
      applyPointerMove,
    );
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      event.preventDefault();
      pointerMoveScheduler.schedule({ clientX: event.clientX, clientY: event.clientY });
    };
    const clearDrag = (event: PointerEvent) => {
      pointerMoveScheduler.flush();
      const drag = dragStateRef.current;
      dragStateRef.current = null;
      const dropTargetId = threadDropTargetRef.current;
      setThreadDropTarget(null);
      if (!drag) return;

      if (drag.kind === "pan") {
        if (drag.background && !drag.moved) {
          setEditingNodeId(null);
          setSelectedIds(new Set());
          setSelectedEdgeId(null);
        }
        return;
      }

      if (drag.kind === "node") {
        if (event.type !== "pointerup" || !drag.moved || !drag.canThread) return;
        const current = boardRef.current;
        const primary = current?.nodes.find((node) => node.id === drag.primaryNodeId);
        if (!current || !primary || !isTextNode(primary)) return;
        if (dropTargetId) {
          patchBoard((document) => attachNodeToThread(document, primary.id, dropTargetId));
          const parent = current.nodes.find((node) => node.id === dropTargetId);
          const label = parent && isTextNode(parent)
            ? parent.title?.trim().slice(0, 24) ||
              parent.text.trim().split(/\r?\n/, 1)[0].slice(0, 24) ||
              "カード"
            : "カード";
          setStatus(`「${label}」のスレッドに追加しました`);
        } else if (primary.threadParentId) {
          const releasePoint = screenToWorld(event.clientX, event.clientY);
          if (
            shouldDetachFromThread(
              current.nodes,
              primary.id,
              releasePoint,
              THREAD_DETACH_MARGIN / zoom,
            )
          ) {
            patchBoard((document) => detachNodeFromThread(document, primary.id));
            setStatus("カードをスレッドから外しました");
          } else {
            patchBoard((document) =>
              attachNodeToThread(document, primary.id, primary.threadParentId!),
            );
            setStatus("カードをスレッド内に戻しました");
          }
        }
        return;
      }

      if (drag.kind !== "marquee") return;

      setMarqueeRect(null);
      const point = marqueePointRef.current ?? drag.start;
      marqueePointRef.current = null;
      const rect = {
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y),
      };
      setSelectedEdgeId(null);
      // ほぼ動いていなければ「背景クリック」＝選択解除として扱う。
      if (rect.width < 4 && rect.height < 4) {
        setSelectedIds(drag.additive ? new Set(drag.base) : new Set());
        return;
      }
      const hits = (boardRef.current?.nodes ?? [])
        .filter(
          (node) =>
            !hiddenThreadIds.has(node.id) &&
            node.x < rect.x + rect.width &&
            node.x + node.width > rect.x &&
            node.y < rect.y + rect.height &&
            node.y + node.height > rect.y,
        )
        .map((node) => node.id);
      setSelectedIds(drag.additive ? new Set([...drag.base, ...hits]) : new Set(hits));
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", clearDrag);
    window.addEventListener("pointercancel", clearDrag);
    return () => {
      pointerMoveScheduler.cancel();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", clearDrag);
      window.removeEventListener("pointercancel", clearDrag);
    };
  }, [hiddenThreadIds, patchBoard, pushHistory, screenToWorld, setThreadDropTarget, zoom]);

  const switchScope = (nextScope: CanvasScope) => {
    if (nextScope === "project" && !payload?.rootPath) {
      setStatus("作品ボードはプロジェクトを開いているときに使えます");
      return;
    }
    void loadBoardList(nextScope);
  };

  const switchBoard = (boardId: string) => {
    setIsBoardMenuOpen(false);
    void loadBoardList(scope, boardId);
  };

  const persistBoardOrder = async (nextBoards: CanvasBoardSummary[]) => {
    if (!payload) return;
    setBoards(nextBoards);
    setStatus("並び順を保存中");
    const saveRequest = boardOrderSaveQueueRef.current
      .catch(() => {})
      .then(() =>
        reorderBoards(
          scope,
          payload.rootPath,
          nextBoards.map((item) => item.id),
        ),
      );
    boardOrderSaveQueueRef.current = saveRequest;
    try {
      await saveRequest;
      setStatus("並び順を保存しました");
    } catch (error) {
      setStatus(String(error));
      const summaries = await listBoards(scope, payload.rootPath).catch(() => null);
      if (summaries) setBoards(summaries);
    }
  };

  const moveBoard = (boardId: string, offset: -1 | 1) => {
    const index = boards.findIndex((item) => item.id === boardId);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= boards.length) return;
    const next = [...boards];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    void persistBoardOrder(next);
  };

  const dropBoard = (
    event: ReactDragEvent<HTMLDivElement>,
    targetBoardId: string,
  ) => {
    event.preventDefault();
    const sourceBoardId = draggedBoardId ?? event.dataTransfer.getData("text/plain");
    setDraggedBoardId(null);
    if (!sourceBoardId || sourceBoardId === targetBoardId) return;
    const source = boards.find((item) => item.id === sourceBoardId);
    if (!source) return;
    const withoutSource = boards.filter((item) => item.id !== sourceBoardId);
    const targetIndex = withoutSource.findIndex((item) => item.id === targetBoardId);
    if (targetIndex < 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientY >= rect.top + rect.height / 2;
    withoutSource.splice(targetIndex + (insertAfter ? 1 : 0), 0, source);
    void persistBoardOrder(withoutSource);
  };

  const confirmDeleteBoard = async () => {
    if (!deleteTarget || !payload) return;
    const target = deleteTarget;
    const deletedIndex = boards.findIndex((item) => item.id === target.id);
    setDeleteTarget(null);
    setIsBoardMenuOpen(false);
    setStatus("ボードをゴミ箱へ移動中");

    if (target.id === activeBoardId) {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      draftCanvasReadyRef.current = false;
      ++boardLoadGenerationRef.current;
    }

    try {
      await boardOrderSaveQueueRef.current.catch(() => {});
      await boardSaveQueue.flush();
      setStatus("ボードをゴミ箱へ移動中");
      await trashBoard(scope, payload.rootPath, target.id);
      const summaries = await listBoards(scope, payload.rootPath);
      setBoards(summaries);
      if (target.id === activeBoardId) {
        const nextBoard = summaries[Math.min(Math.max(deletedIndex, 0), summaries.length - 1)];
        if (nextBoard) {
          await loadBoardList(scope, nextBoard.id);
        } else {
          setActiveBoardId(null);
          loadedBoardTargetRef.current = null;
          boardRef.current = null;
          suppressNextSaveRef.current = true;
          setBoard(null);
          setSelectedIds(new Set());
          setSelectedEdgeId(null);
          clearHistory();
          setStatus("ボードをゴミ箱へ移動しました");
        }
      } else {
        setStatus("ボードをゴミ箱へ移動しました");
      }
    } catch (error) {
      setStatus(String(error));
    }
  };

  const restoreBoard = async (trashId: string) => {
    if (!payload) return;
    setIsTrashLoading(true);
    setStatus("ボードを復元中");
    try {
      const restored = await restoreTrashedBoard(scope, payload.rootPath, trashId);
      setTrashedBoards(await listTrashedBoards(scope, payload.rootPath));
      await loadBoardList(scope, activeBoardId ?? restored.id);
      setStatus("ボードを復元しました");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setIsTrashLoading(false);
    }
  };

  const selectNode = (nodeId: string, event: ReactPointerEvent) => {
    setSelectedEdgeId(null);
    setSelectedIds((current) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        const next = new Set(current);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      }
      return new Set([nodeId]);
    });
  };

  const startNodeDrag = (node: CanvasNode, event: ReactPointerEvent) => {
    if (tool !== "select") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("textarea,input,button,.canvasReferencePreview")) {
      selectNode(node.id, event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setEditingNodeId(null);
    selectNode(node.id, event);
    const baseNodeIds = selectedIds.has(node.id) ? [...selectedIds] : [node.id];
    const nodeIds = new Set(baseNodeIds);
    baseNodeIds.forEach((nodeId) => {
      const selected = board?.nodes.find((item) => item.id === nodeId);
      if (!selected || !isTextNode(selected)) return;
      collectThreadDescendantIds(board?.nodes ?? [], nodeId).forEach((id) => nodeIds.add(id));
    });
    const dragGroups = (board?.nodes ?? []).filter(
      (item): item is CanvasGroupNode => nodeIds.has(item.id) && isGroupNode(item),
    );
    if (dragGroups.length > 0) {
      (board?.nodes ?? []).forEach((item) => {
        if (!isGroupMovableChild(item)) return;
        if (dragGroups.some((group) => isNodeInsideGroup(item, group))) {
          nodeIds.add(item.id);
        }
      });
    }
    dragStateRef.current = {
      kind: "node",
      start: { x: event.clientX, y: event.clientY },
      nodeIds: [...nodeIds],
      primaryNodeId: node.id,
      canThread: isTextNode(node) && baseNodeIds.length === 1,
      originals: new Map(
        (board?.nodes ?? [])
          .filter((item) => nodeIds.has(item.id))
          .map((item) => [item.id, { x: item.x, y: item.y }]),
      ),
    };
  };

  const beginTextEditing = (nodeId: string) => {
    const node = boardRef.current?.nodes.find((item) => item.id === nodeId);
    if (!node || !isTextNode(node)) return;
    setTool("select");
    setSelectedEdgeId(null);
    setSelectedIds(new Set([nodeId]));
    setEditingNodeId(nodeId);
    setPendingFocusNodeId(nodeId);
  };

  const handleTextNodeDoubleClick = (
    node: CanvasTextNode,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    beginTextEditing(node.id);
  };

  const handleNodePointerDown = (node: CanvasNode, event: ReactPointerEvent) => {
    if (tool === "edge") {
      event.preventDefault();
      event.stopPropagation();
      if (!edgeFromId) {
        setEdgeFromId(node.id);
        setSelectedIds(new Set([node.id]));
        setStatus("接続先のカードをクリック");
        return;
      }
      if (edgeFromId !== node.id) {
        pushHistory();
        patchBoard((current) => ({
          ...current,
          edges: [...current.edges, createCanvasEdge(edgeFromId, node.id)],
        }));
        setStatus("接続線を作成しました");
      }
      setEdgeFromId(null);
      setEdgeCursor(null);
      setSelectedIds(new Set([node.id]));
      setTool("select");
      return;
    }
    startNodeDrag(node, event);
  };

  /** 選択中のカードから接続線を引き始める（フローティングバー用）。 */
  const startEdgeFrom = (nodeId: string) => {
    setTool("edge");
    setEdgeFromId(nodeId);
    setSelectedIds(new Set([nodeId]));
    setSelectedEdgeId(null);
    setStatus("接続先のカードをクリック");
  };

  const handleNodeFocus = (nodeId: string) => {
    setSelectedEdgeId(null);
    setSelectedIds(new Set([nodeId]));
    // フォーカスの当て直しで入力セッションを区切る（次の編集は新しい履歴になる）。
    editSessionRef.current = null;
  };

  const updateNode = (nodeId: string, patch: Partial<CanvasTextNode> | Partial<CanvasGroupNode>) => {
    if ("text" in patch) pushHistory(`text:${nodeId}`);
    else if ("title" in patch) pushHistory(`title:${nodeId}`);
    else if ("label" in patch) pushHistory(`label:${nodeId}`);
    else pushHistory();
    patchBoard((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? ({ ...node, ...patch } as CanvasNode) : node)),
    }));
  };

  const updateSelectedTextNodes = (
    patch: { writingMode?: WritingMode; fontSource?: CanvasNodeFontSource; color?: string },
  ) => {
    if (selectedTextNodesForStyle.length === 0) return;
    const targetIds = new Set(selectedTextNodesForStyle.map((node) => node.id));
    pushHistory();
    patchBoard((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        targetIds.has(node.id) && isTextNode(node)
          ? ({ ...node, ...patch } as CanvasNode)
          : node,
      ),
    }));
  };

  const updateSelectedEdge = (patch: { connector?: CanvasEdgeConnector; label?: string }) => {
    if (!selectedEdgeId) return;
    if ("label" in patch) pushHistory(`edgeLabel:${selectedEdgeId}`);
    else pushHistory();
    patchBoard((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === selectedEdgeId ? { ...edge, ...patch } : edge,
      ),
    }));
  };

  const textNodeStyle = (node: CanvasTextNode): CSSProperties =>
    ({
      left: node.x,
      top: node.y,
      width: node.width,
      height: node.height,
      "--canvas-node-writing-mode": node.writingMode ?? defaultCanvasWritingMode,
      "--canvas-node-font-family":
        (node.fontSource ?? defaultCanvasFontSource) === "editor"
          ? payload?.editorFontFamily
          : payload?.uiFontFamily,
    }) as CSSProperties;

  const isVerticalTextNode = (node: CanvasTextNode) =>
    (node.writingMode ?? defaultCanvasWritingMode) === "vertical-rl";

  const handleTextNodeWheel = (node: CanvasTextNode, event: WheelEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (!isVerticalTextNode(node)) return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const delta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (delta === 0) return;

    const previousScrollLeft = textarea.scrollLeft;
    textarea.scrollLeft += delta;
    if (textarea.scrollLeft === previousScrollLeft) {
      textarea.scrollLeft -= delta;
    }
  };

  const startResize = (
    node: CanvasNode,
    corner: CanvasResizeCorner,
    event: ReactPointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedIds(new Set([node.id]));
    dragStateRef.current = {
      kind: "resize",
      start: { x: event.clientX, y: event.clientY },
      nodeId: node.id,
      corner,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  };

  /** 指定位置にカードを作り、選択して本文入力へフォーカスする。 */
  const createTextCardAt = (point: Point) => {
    const node = createCanvasTextNode("", {
      x: Math.max(0, point.x - 130),
      y: Math.max(0, point.y - 75),
      writingMode: defaultCanvasWritingMode,
      fontSource: defaultCanvasFontSource,
    });
    pushHistory();
    patchBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedEdgeId(null);
    setSelectedIds(new Set([node.id]));
    setEditingNodeId(node.id);
    setPendingFocusNodeId(node.id);
  };

  const handleViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (!board) return;

    const point = screenToWorld(event.clientX, event.clientY);
    // 中ボタン / Space 押下中はツールに関わらずパン。
    if (event.button === 1 || spaceDownRef.current) {
      event.preventDefault();
      dragStateRef.current = {
        kind: "pan",
        start: { x: event.clientX, y: event.clientY },
        pan: panRef.current,
      };
      return;
    }
    if (event.button !== 0) return;

    if (tool === "text") {
      createTextCardAt(point);
      setTool("select");
      return;
    }
    if (tool === "group") {
      const node = createCanvasGroupNode("グループ", {
        x: Math.max(0, point.x - 260),
        y: Math.max(0, point.y - 140),
      });
      pushHistory();
      patchBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
      setSelectedEdgeId(null);
      setSelectedIds(new Set([node.id]));
      setTool("select");
      return;
    }
    if (tool === "edge") {
      setEdgeFromId(null);
      setEdgeCursor(null);
      return;
    }
    // Weje型の直接操作: 通常の背景ドラッグはパン、修飾キー付きだけ矩形選択。
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      dragStateRef.current = {
        kind: "pan",
        start: { x: event.clientX, y: event.clientY },
        pan: panRef.current,
        background: true,
      };
      return;
    }
    marqueePointRef.current = point;
    dragStateRef.current = {
      kind: "marquee",
      start: point,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      base: [...selectedIds],
    };
  };

  const handleViewportDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (!board || tool !== "select") return;
    createTextCardAt(screenToWorld(event.clientX, event.clientY));
  };

  const handleViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "edge" || !edgeFromId) return;
    setEdgeCursor(screenToWorld(event.clientX, event.clientY));
  };

  /** ズーム値を変更しつつ、center（viewport 座標）直下のワールド位置を固定する。 */
  const zoomTo = (nextZoom: number, center?: Point) => {
    const clamped = clampZoom(nextZoom);
    const currentZoom = zoomRef.current;
    if (Math.abs(clamped - currentZoom) < 0.0001) return;
    const viewport = viewportRef.current;
    const anchor = center ?? {
      x: (viewport?.clientWidth ?? window.innerWidth) / 2,
      y: (viewport?.clientHeight ?? window.innerHeight) / 2,
    };
    const currentPan = panRef.current;
    const nextPan = {
      x: anchor.x - ((anchor.x - currentPan.x) / currentZoom) * clamped,
      y: anchor.y - ((anchor.y - currentPan.y) / currentZoom) * clamped,
    };
    zoomRef.current = clamped;
    panRef.current = nextPan;
    setPan(nextPan);
    setZoom(clamped);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    const modeScale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? viewportRef.current?.clientHeight ?? window.innerHeight
        : 1;
    const rawDelta = (event.deltaY || event.deltaX) * modeScale;
    if (rawDelta === 0) return;
    const delta = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, rawDelta));
    const nextZoom = zoomRef.current * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
    zoomTo(nextZoom, {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    });
  };

  const deleteSelection = () => {
    if (!board) return;
    if (selectedEdgeId) {
      pushHistory();
      patchBoard((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== selectedEdgeId),
      }));
      setSelectedEdgeId(null);
      return;
    }
    if (selectedIds.size === 0) return;
    const removedIds = new Set(selectedIds);
    pushHistory();
    patchBoard((current) => ({
      ...current,
      nodes: current.nodes
        .filter((node) => !removedIds.has(node.id))
        .map((node) =>
          isTextNode(node) && node.threadParentId && removedIds.has(node.threadParentId)
            ? { ...node, threadParentId: undefined, threadOrder: undefined }
            : node,
        ),
      edges: current.edges.filter(
        (edge) => !removedIds.has(edge.fromNode) && !removedIds.has(edge.toNode),
      ),
    }));
    if (editingNodeId && removedIds.has(editingNodeId)) setEditingNodeId(null);
    setSelectedIds(new Set());
  };

  const toggleThreadCollapsed = (node: CanvasTextNode) => {
    pushHistory();
    patchBoard((current) => ({
      ...current,
      nodes: current.nodes.map((item) =>
        item.id === node.id && isTextNode(item)
          ? { ...item, threadCollapsed: !item.threadCollapsed }
          : item,
      ),
    }));
    setEditingNodeId(null);
    setSelectedIds(new Set([node.id]));
    setSelectedEdgeId(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const isEditableTarget = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );

      if (event.key === " " && !isEditableTarget) {
        spaceDownRef.current = true;
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && (event.key === "z" || event.key === "Z")) {
        // テキスト編集中はブラウザ標準のテキスト Undo に任せる。
        if (isEditableTarget) return;
        event.preventDefault();
        if (event.shiftKey) redoBoard();
        else undoBoard();
        return;
      }
      if (mod && !event.altKey && (event.key === "y" || event.key === "Y")) {
        if (isEditableTarget) return;
        event.preventDefault();
        redoBoard();
        return;
      }

      if (event.key === "Escape") {
        if (editingNodeId) {
          event.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
          setEditingNodeId(null);
          return;
        }
        setEdgeFromId(null);
        setEdgeCursor(null);
        setIsStyleOpen(false);
        setSelectedEdgeId(null);
        setSelectedIds(new Set());
        return;
      }

      if (!mod && !event.altKey && !isEditableTarget) {
        if (event.key === "Enter" && selectedIds.size === 1) {
          const nodeId = [...selectedIds][0];
          const selected = boardRef.current?.nodes.find((node) => node.id === nodeId);
          if (selected && isTextNode(selected)) {
            event.preventDefault();
            beginTextEditing(selected.id);
            return;
          }
        }
        const key = event.key.toLowerCase();
        const shortcutTool = TOOL_SHORTCUTS[key] ?? TOOL_SHORTCUT_ALIASES[key];
        if (shortcutTool) {
          setTool(shortcutTool);
          setEdgeFromId(null);
          setEdgeCursor(null);
          return;
        }
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedIds.size === 0 && !selectedEdgeId) return;
      // カード本文などの編集中は、Delete / Backspace とも文字削除を優先する。
      if (isEditableTarget) return;

      event.preventDefault();
      deleteSelection();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") spaceDownRef.current = false;
    };
    const handleWindowBlur = () => {
      spaceDownRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  });

  useEffect(() => {
    if (!pendingFocusNodeId) return;
    const element = viewportRef.current?.querySelector<HTMLTextAreaElement>(
      `[data-node-id="${CSS.escape(pendingFocusNodeId)}"] textarea`,
    );
    element?.focus({ preventScroll: true });
    setPendingFocusNodeId(null);
  }, [pendingFocusNodeId, board]);

  const duplicateSelection = () => {
    if (!board || selectedIds.size === 0) return;
    pushHistory();
    const selectedNodeList = board.nodes.filter((node) => selectedIds.has(node.id));
    const idMap = new Map(
      selectedNodeList.map((node) => [
        node.id,
        nextCanvasId(
          node.type === "group" ? "group" : node.type === "reference" ? "reference" : "node",
        ),
      ]),
    );
    const duplicatedNodes: CanvasNode[] = selectedNodeList.map((node) => {
      const duplicate = {
        ...node,
        id: idMap.get(node.id)!,
        x: node.x + 36,
        y: node.y + 36,
      } as CanvasNode;
      if (!isTextNode(duplicate) || !duplicate.threadParentId) return duplicate;
      const duplicatedParentId = idMap.get(duplicate.threadParentId);
      return {
        ...duplicate,
        threadParentId: duplicatedParentId,
        threadOrder: duplicatedParentId ? duplicate.threadOrder : undefined,
      };
    });
    const duplicatedEdges = board.edges
      .filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode))
      .map((edge) => ({
        ...edge,
        id: nextCanvasId("edge"),
        fromNode: idMap.get(edge.fromNode) ?? edge.fromNode,
        toNode: idMap.get(edge.toNode) ?? edge.toNode,
      }));

    patchBoard((current) => ({
      ...current,
      nodes: [...current.nodes, ...duplicatedNodes],
      edges: [...current.edges, ...duplicatedEdges],
    }));
    setSelectedIds(new Set(duplicatedNodes.map((node) => node.id)));
    setSelectedEdgeId(null);
  };

  const resetViewport = () => {
    const nextPan = { x: 180, y: 120 };
    panRef.current = nextPan;
    zoomRef.current = 1;
    setPan(nextPan);
    setZoom(1);
  };

  /** 全カードが収まるようにパンとズームを合わせる。空のときは初期位置へ。 */
  const fitView = () => {
    const viewport = viewportRef.current;
    const nodes = board?.nodes ?? [];
    if (!viewport || nodes.length === 0) {
      resetViewport();
      return;
    }
    const margin = 70;
    const minX = Math.min(...nodes.map((node) => node.x)) - margin;
    const minY = Math.min(...nodes.map((node) => node.y)) - margin;
    const maxX = Math.max(...nodes.map((node) => node.x + node.width)) + margin;
    const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + margin;
    const nextZoom = clampZoom(
      Math.min(viewport.clientWidth / (maxX - minX), viewport.clientHeight / (maxY - minY), 1),
    );
    const nextPan = {
      x: viewport.clientWidth / 2 - ((minX + maxX) / 2) * nextZoom,
      y: viewport.clientHeight / 2 - ((minY + maxY) / 2) * nextZoom,
    };
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  };

  const sendSelectedToIdea = async () => {
    if (!board || !activeBoardId || textNodesForIdea.length === 0) return;
    const items: CanvasCopyToIdeaItem[] = textNodesForIdea
      .map((node) => ({ nodeId: node.id, text: textForNode(node) }))
      .filter((item) => item.text.trim().length > 0);
    if (items.length === 0) return;
    const group = selectedNodes.length === 1 && isGroupNode(selectedNodes[0]) ? selectedNodes[0] : null;
    const request: CanvasCopyToIdeaRequest = {
      boardId: activeBoardId,
      boardScope: scope,
      boardName: boardName(board),
      targetThreadId,
      threadTitle: group?.label?.trim() || boardName(board),
      items,
    };
    try {
      if (isTauriRuntime()) {
        await emitMainWindow("then-canvas-copy-to-idea", request);
      }
      setStatus(
        targetThreadId === NEW_THREAD_TARGET
          ? `${items.length}件を新規スレッドへ送信しました`
          : `${items.length}件を Idea へ送信しました`,
      );
    } catch (error) {
      setStatus(`Idea へ送信できませんでした: ${String(error)}`);
    }
  };

  /** 選択中のテキストカード（グループ選択時は内包カード）をプロット欄へ送る。 */
  const sendSelectedToPlot = async () => {
    if (!board || !activeBoardId || textNodesForIdea.length === 0) return;
    const items: CanvasCopyToIdeaItem[] = textNodesForIdea
      .map((node) => ({ nodeId: node.id, text: textForNode(node) }))
      .filter((item) => item.text.trim().length > 0);
    if (items.length === 0) return;
    const request: CanvasCopyToPlotRequest = {
      boardId: activeBoardId,
      boardScope: scope,
      boardName: boardName(board),
      items,
    };
    try {
      if (isTauriRuntime()) {
        await emitMainWindow("then-canvas-copy-to-plot", request);
      }
      setStatus(`${items.length}件をプロットへ送信しました`);
    } catch (error) {
      setStatus(`プロットへ送信できませんでした: ${String(error)}`);
    }
  };

  const focusIdeaOrigin = async (node: CanvasNode) => {
    const origin = "thenOrigin" in node ? node.thenOrigin : undefined;
    if (!origin || !isTauriRuntime()) return;
    const request: CanvasFocusIdeaRequest = {
      threadId: origin.sourceThreadId,
      fragmentId: origin.sourceId,
    };
    await emitMainWindow("then-canvas-focus-idea", request);
    setStatus("元 Idea を表示しました");
  };

  const renderEdge = (edge: CanvasEdge) => {
    if (!board) return null;
    const from = board.nodes.find((node) => node.id === edge.fromNode);
    const to = board.nodes.find((node) => node.id === edge.toNode);
    if (!from || !to || hiddenThreadIds.has(from.id) || hiddenThreadIds.has(to.id)) return null;
    const connector = edgeConnector(edge);
    const { d, start, end, fromControl, toControl, mid } = edgePath(from, to, edge);
    const active = selectedEdgeId === edge.id;
    const endArrow =
      connector === "arrow" || connector === "bidirectional"
        ? arrowHeadPath(end, { x: end.x - toControl.x, y: end.y - toControl.y })
        : "";
    const startArrow =
      connector === "bidirectional"
        ? arrowHeadPath(start, { x: start.x - fromControl.x, y: start.y - fromControl.y })
        : "";
    const handleEdgePointerDown = (event: ReactPointerEvent<SVGPathElement>) => {
      event.stopPropagation();
      setSelectedIds(new Set());
      setSelectedEdgeId(edge.id);
    };
    return (
      <g
        key={edge.id}
        className={`canvasEdge ${active ? "isSelected" : ""} ${
          connector === "dashed" ? "isDashed" : ""
        }`}
      >
        <path
          className="canvasEdgeLine"
          d={d}
          onPointerDown={handleEdgePointerDown}
        />
        {startArrow && (
          <path className="canvasEdgeArrow" d={startArrow} onPointerDown={handleEdgePointerDown} />
        )}
        {endArrow && (
          <path className="canvasEdgeArrow" d={endArrow} onPointerDown={handleEdgePointerDown} />
        )}
        {edge.label && (
          <text x={mid.x} y={mid.y - 8} textAnchor="middle">
            {edge.label}
          </text>
        )}
      </g>
    );
  };

  const groups = board?.nodes.filter(isGroupNode) ?? [];
  const referenceNodes = board?.nodes.filter(isReferenceNode) ?? [];
  const allTextNodes = board?.nodes.filter(isTextNode) ?? [];
  const textNodes = allTextNodes.filter((node) => !hiddenThreadIds.has(node.id));

  const edgeSourceNode = edgeFromId
    ? board?.nodes.find((node) => node.id === edgeFromId) ?? null
    : null;

  // フローティングバーの位置（viewport 座標）。選択の外接矩形の上辺中央に出す。
  const selectionAnchor = (() => {
    if (selectedNodes.length > 0) {
      const minX = Math.min(...selectedNodes.map((node) => node.x));
      const minY = Math.min(...selectedNodes.map((node) => node.y));
      const maxX = Math.max(...selectedNodes.map((node) => node.x + node.width));
      return { x: ((minX + maxX) / 2) * zoom + pan.x, y: minY * zoom + pan.y };
    }
    if (selectedEdge && board) {
      const from = board.nodes.find((node) => node.id === selectedEdge.fromNode);
      const to = board.nodes.find((node) => node.id === selectedEdge.toNode);
      if (from && to) {
        const { mid } = edgePath(from, to, selectedEdge);
        return { x: mid.x * zoom + pan.x, y: mid.y * zoom + pan.y };
      }
    }
    return null;
  })();

  const viewportWidth = viewportRef.current?.clientWidth ?? window.innerWidth;
  const floatingBarStyle: CSSProperties | null = selectionAnchor
    ? {
        left: Math.min(Math.max(selectionAnchor.x, 170), Math.max(170, viewportWidth - 170)),
        top: Math.max(10, selectionAnchor.y - 52),
      }
    : null;

  return (
    <main
      className={embedded ? "canvasWindowRoot canvasEmbeddedRoot" : "appShell canvasWindowRoot"}
      data-theme={embedded ? undefined : payload?.theme ?? "dark"}
      style={embedded ? undefined : themeStyle}
    >
      <header className="canvasTopbar">
        <div className="canvasToolbarCluster canvasScopeSwitch" aria-label="ボードの範囲">
          {(["global", "project"] as CanvasScope[]).map((item) => (
            <button
              key={item}
              type="button"
              className={scope === item ? "isActive" : ""}
              disabled={item === "project" && !payload?.rootPath}
              title={item === "project" ? "この作品のボード" : "すべての作品で使えるボード"}
              onClick={() => switchScope(item)}
            >
              {item === "project" ? "作品" : "共通"}
            </button>
          ))}
        </div>
        <div className="canvasToolbarCluster canvasBoardCluster">
          <div className="canvasBoardMenuHost">
            <button
              className="canvasBoardTitleButton"
              type="button"
              aria-label="ボードを切り替え"
              aria-expanded={isBoardMenuOpen}
              disabled={boards.length === 0}
              onClick={() => setIsBoardMenuOpen((value) => !value)}
              title={boardName(board)}
            >
              <span>{board ? boardName(board) : "ボードがありません"}</span>
            </button>
            {isBoardMenuOpen && (
              <div className="canvasBoardMenu" role="menu" aria-label="ボード一覧">
                {boards.map((item, index) => (
                  <div
                    key={item.id}
                    className={`canvasBoardMenuItem ${
                      item.id === activeBoardId ? "isActive" : ""
                    } ${item.id === draggedBoardId ? "isDragging" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => dropBoard(event, item.id)}
                  >
                    <span
                      className="canvasBoardDragHandle"
                      title="ドラッグして並び替え"
                      draggable
                      onDragStart={(event) => {
                        setDraggedBoardId(item.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => setDraggedBoardId(null)}
                    >
                      <CanvasGlyph name="grip" />
                    </span>
                    <button
                      className="canvasBoardSelectButton"
                      type="button"
                      role="menuitem"
                      title={item.name}
                      onClick={() => switchBoard(item.id)}
                    >
                      <span>{item.name}</span>
                    </button>
                    <span className="canvasBoardMenuActions">
                      <button
                        type="button"
                        aria-label={`「${item.name}」を上へ移動`}
                        title="上へ移動"
                        disabled={index === 0}
                        onClick={() => moveBoard(item.id, -1)}
                      >
                        <CanvasGlyph name="chevronUp" />
                      </button>
                      <button
                        type="button"
                        aria-label={`「${item.name}」を下へ移動`}
                        title="下へ移動"
                        disabled={index === boards.length - 1}
                        onClick={() => moveBoard(item.id, 1)}
                      >
                        <CanvasGlyph name="chevronDown" />
                      </button>
                      <button
                        className="dangerCanvasButton"
                        type="button"
                        aria-label={`「${item.name}」をゴミ箱へ移動`}
                        title="ゴミ箱へ移動"
                        onClick={() => setDeleteTarget(item)}
                      >
                        <CanvasGlyph name="trash" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="canvasIconButton"
            type="button"
            title="ボード名を変更"
            disabled={!board}
            onClick={openRenameModal}
          >
            <CanvasGlyph name="edit" />
          </button>
          <button
            className="canvasIconButton"
            type="button"
            title="ボードを作成"
            onClick={openCreateModal}
          >
            <CanvasGlyph name="plus" />
          </button>
          <button
            className="canvasIconButton"
            type="button"
            title="ゴミ箱"
            aria-label="キャンバスボードのゴミ箱を開く"
            onClick={() => void openTrashModal()}
          >
            <CanvasGlyph name="trash" />
          </button>
        </div>
        <div className="canvasTopbarRight">
          <div className="canvasReferenceHost">
            <button
              className={`canvasIconButton ${isReferenceMenuOpen ? "isActive" : ""}`}
              type="button"
              title="資料を追加"
              aria-label="資料を追加"
              aria-expanded={isReferenceMenuOpen}
              disabled={referenceFiles.length === 0}
              onClick={() => setIsReferenceMenuOpen((value) => !value)}
            >
              <CanvasGlyph name="reference" />
            </button>
            {isReferenceMenuOpen && (
              <div className="canvasReferencePopover" role="dialog" aria-label="資料を追加">
                <h2>資料を追加</h2>
                <input
                  value={referenceQuery}
                  placeholder="資料を検索"
                  aria-label="資料を検索"
                  onChange={(event) => setReferenceQuery(event.target.value)}
                />
                <div className="canvasReferenceList">
                  {filteredReferenceFiles.length === 0 ? (
                    <p>該当する資料はありません</p>
                  ) : (
                    filteredReferenceFiles.slice(0, 40).map((file) => (
                      <button
                        key={file.sourcePath}
                        type="button"
                        title={file.sourcePath}
                        onClick={() => addReferenceNode(file)}
                      >
                        <span>{referenceKindLabel(file.kind)}</span>
                        <strong>{file.name}</strong>
                        <small>{file.sourcePath}</small>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            className="canvasIconButton"
            type="button"
            title="全体を表示"
            aria-label="全体を表示"
            onClick={fitView}
          >
            <CanvasGlyph name="fit" />
          </button>
          <button type="button" className="canvasIconButton" title="中間稿" aria-label="中間稿を開く"
            onClick={() => {
              if (embedded) onOpenDraft?.();
              else { setIsDraftPanelOpen((value) => !value); setIsSidePanelOpen(false); }
            }}>稿</button>
          {!embedded && (
            <button
              className={`canvasIconButton ${isSidePanelOpen ? "isActive" : ""}`}
              type="button"
              title="Idea・資料パネル"
              aria-label="Idea・資料パネル"
              aria-expanded={isSidePanelOpen}
              onClick={() => { setIsSidePanelOpen((value) => !value); setIsDraftPanelOpen(false); }}
            >
              <CanvasGlyph name="panel" />
            </button>
          )}
          <div className="canvasHelpHost">
            <button
              className={`canvasIconButton ${isHelpOpen ? "isActive" : ""}`}
              type="button"
              title="操作ヘルプ"
              aria-label="操作ヘルプ"
              aria-expanded={isHelpOpen}
              onClick={() => setIsHelpOpen((value) => !value)}
            >
              <CanvasGlyph name="help" />
            </button>
            {isHelpOpen && (
              <div className="canvasHelpPopover" role="dialog" aria-label="ボード操作ヘルプ">
                <h2>ボードの操作</h2>
                <ul>
                  <li>カード作成: 余白をダブルクリック、またはカードツール (C／T)</li>
                  <li>カード編集: ダブルクリック、または選択して Enter</li>
                  <li>カード移動: カード面をそのままドラッグ</li>
                  <li>スレッド化: カードを別のカード本体へ入れてドロップ</li>
                  <li>サイズ変更: カードの四隅をドラッグ</li>
                  <li>グループ: グループツール (G) で余白をクリック</li>
                  <li>接続線: 接続線ツール (E) で元のカード、先のカードの順にクリック</li>
                  <li>範囲選択: Shift / Ctrl を押しながら余白をドラッグ</li>
                  <li>追加選択: Shift / Ctrl を押しながらクリック</li>
                  <li>パン: 余白をドラッグ、Space + ドラッグ、中ボタン</li>
                  <li>ズーム: ホイール（カーソル位置を中心に滑らかに拡縮）</li>
                  <li>取り消し: Ctrl+Z ／ やり直し: Ctrl+Y</li>
                  <li>選択中の操作: カード上部のツールバーから複製・接続・送信・削除</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </header>

      <section
        className={`canvasWorkspace ${
          !embedded && isDraftPanelOpen ? "hasCanvasDraftPanel" : !embedded && isSidePanelOpen ? "hasCanvasSidePanel" : ""
        }`}
      >
        <div
          ref={viewportRef}
          className={`canvasViewport canvasViewport-${tool}`}
          onPointerDown={handleViewportPointerDown}
          onDoubleClick={handleViewportDoubleClick}
          onPointerMove={handleViewportPointerMove}
          onDragOver={handleViewportDragOver}
          onDrop={handleViewportDrop}
          onWheel={handleWheel}
          onScroll={(event) => {
            // 移動は pan（transform）で表現する。フォーカス移動などによる
            // ブラウザの自動スクロールは座標系を壊すため常に 0 に戻す。
            event.currentTarget.scrollLeft = 0;
            event.currentTarget.scrollTop = 0;
          }}
        >
            <div
              className="canvasWorld"
              onPointerDown={handleViewportPointerDown}
              onDoubleClick={handleViewportDoubleClick}
              style={{
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
            {groups.map((node) => (
              <article
                key={node.id}
                className={`canvasNode canvasGroupNode ${
                  selectedIds.has(node.id) ? "isSelected" : ""
                } ${edgeFromId === node.id ? "isEdgeSource" : ""}`}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                data-node-id={node.id}
                onPointerDown={(event) => handleNodePointerDown(node, event)}
              >
                <input
                  value={node.label}
                  aria-label="グループ名"
                  placeholder="グループ名…"
                  onFocus={() => handleNodeFocus(node.id)}
                  onChange={(event) => updateNode(node.id, { label: event.target.value })}
                />
                {node.thenOrigin && (
                  <button
                    className="canvasOriginButton"
                    type="button"
                    onClick={() => void focusIdeaOrigin(node)}
                  >
                    元Idea
                  </button>
                )}
                {CANVAS_RESIZE_CORNERS.map((corner) => (
                  <span
                    key={corner}
                    className={`canvasResizeHandle canvasResizeHandle-${corner}`}
                    aria-hidden="true"
                    onPointerDown={(event) => startResize(node, corner, event)}
                  />
                ))}
              </article>
            ))}
            <svg className="canvasEdgeLayer" width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
              {textNodes.map((node) => {
                if (!node.threadParentId) return null;
                const parent = allTextNodes.find((item) => item.id === node.threadParentId);
                if (!parent || hiddenThreadIds.has(parent.id)) return null;
                return <path key={`thread-${node.id}`} className="canvasThreadEdge" d={threadPath(parent, node)} />;
              })}
              {board?.edges.map(renderEdge)}
              {edgeSourceNode && edgeCursor && (
                <path
                  className="canvasEdgePreview"
                  d={`M ${nodeCenter(edgeSourceNode).x} ${nodeCenter(edgeSourceNode).y} L ${edgeCursor.x} ${edgeCursor.y}`}
                />
              )}
            </svg>
            {referenceNodes.map((node) => (
              <article
                key={node.id}
                className={`canvasNode canvasReferenceNode ${
                  selectedIds.has(node.id) ? "isSelected" : ""
                } ${selectedGroupChildIds.has(node.id) ? "isInSelectedGroup" : ""} ${
                  edgeFromId === node.id ? "isEdgeSource" : ""
                }`}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                data-node-id={node.id}
                onPointerDown={(event) => handleNodePointerDown(node, event)}
              >
                <header>
                  <span>{referenceKindLabel(node.kind)}</span>
                  {node.imported && <i>import</i>}
                </header>
                <strong className="canvasReferenceTitle" title={node.name}>
                  {node.name}
                </strong>
                <div
                  className="canvasReferencePreview"
                  onWheel={(event) => event.stopPropagation()}
                >
                  {rootPath || node.scope === "global" ? (
                    <ReferenceReadOnlyPreview
                      rootPath={rootPath}
                      sourcePath={node.sourcePath}
                      scope={node.scope}
                      kind={node.kind}
                      title={node.name}
                    />
                  ) : (
                    <div className="referenceReadOnlyPreview referencePlaceholder">
                      プロジェクト資料は作品ボードで表示できます
                    </div>
                  )}
                </div>
                <footer>
                  <span title={node.sourcePath}>{node.sourcePath}</span>
                  <span>{formatCanvasReferenceSize(node.size)}</span>
                </footer>
                {CANVAS_RESIZE_CORNERS.map((corner) => (
                  <span
                    key={corner}
                    className={`canvasResizeHandle canvasResizeHandle-${corner}`}
                    aria-hidden="true"
                    onPointerDown={(event) => startResize(node, corner, event)}
                  />
                ))}
              </article>
            ))}
            {textNodes.map((node) => (
              <article
                key={node.id}
                className={`canvasNode canvasTextNode ${
                  selectedIds.has(node.id) ? "isSelected" : ""
                } ${selectedGroupChildIds.has(node.id) ? "isInSelectedGroup" : ""} ${
                  edgeFromId === node.id ? "isEdgeSource" : ""
                } ${node.threadParentId ? "isThreadChild" : ""} ${
                  threadChildCounts.has(node.id) ? "hasThreadChildren" : ""
                } ${
                  threadDropTargetId === node.id ? "isThreadDropTarget" : ""
                } ${editingNodeId === node.id ? "isEditing" : ""} ${
                  isVerticalTextNode(node) ? "isVerticalWriting" : ""
                }`}
                style={textNodeStyle(node)}
                data-node-id={node.id}
                data-color={node.color || undefined}
                onPointerDown={(event) => handleNodePointerDown(node, event)}
                onDoubleClick={(event) => handleTextNodeDoubleClick(node, event)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setEditingNodeId((current) => current === node.id ? null : current);
                  }
                }}
              >
                {node.thenOrigin && (
                  <button
                    className="canvasOriginButton"
                    type="button"
                    onClick={() => void focusIdeaOrigin(node)}
                  >
                    元Idea
                  </button>
                )}
                {threadChildCounts.has(node.id) && (
                  <button
                    className="canvasThreadToggle"
                    type="button"
                    title={node.threadCollapsed ? "スレッドを開く" : "スレッドを閉じる"}
                    aria-label={node.threadCollapsed ? "スレッドを開く" : "スレッドを閉じる"}
                    aria-expanded={!node.threadCollapsed}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleThreadCollapsed(node);
                    }}
                  >
                    {node.threadCollapsed ? "▸" : "▾"}
                    <span>{threadChildCounts.get(node.id)}</span>
                  </button>
                )}
                {editingNodeId === node.id ? (
                  <>
                    <input
                      className="canvasCardTitleInput"
                      value={node.title ?? ""}
                      placeholder="タイトル…"
                      aria-label="カードのタイトル"
                      onFocus={() => handleNodeFocus(node.id)}
                      onChange={(event) => updateNode(node.id, { title: event.target.value })}
                    />
                    <textarea
                      value={node.text}
                      spellCheck={false}
                      placeholder="アイデアを書く…"
                      aria-label="カードの本文"
                      onFocus={() => handleNodeFocus(node.id)}
                      onChange={(event) => updateNode(node.id, { text: event.target.value })}
                      onWheel={(event) => handleTextNodeWheel(node, event)}
                    />
                  </>
                ) : (
                  <>
                    {node.title?.trim() && <strong className="canvasCardTitle">{node.title}</strong>}
                    <div className={`canvasCardText ${node.text ? "" : "isPlaceholder"}`}>
                      {node.text || "アイデアを書く…"}
                    </div>
                  </>
                )}
                {CANVAS_RESIZE_CORNERS.map((corner) => (
                  <span
                    key={corner}
                    className={`canvasResizeHandle canvasResizeHandle-${corner}`}
                    aria-hidden="true"
                    onPointerDown={(event) => startResize(node, corner, event)}
                  />
                ))}
              </article>
            ))}
            {marqueeRect && (
              <div
                className="canvasMarquee"
                style={{
                  left: marqueeRect.x,
                  top: marqueeRect.y,
                  width: marqueeRect.width,
                  height: marqueeRect.height,
                }}
              />
            )}
            {board && board.nodes.length === 0 && (
              <div className="canvasEmptyHint" style={{ left: 420, top: 300 }}>
                余白をダブルクリックしてカードを作成できます
              </div>
            )}
          </div>
          <div
            className="canvasCreationPalette canvasToolGroup"
            aria-label="作成ツール"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {(["select", "text", "group", "edge"] as CanvasTool[]).map((item) => (
              <button
                key={item}
                className={tool === item ? "isActive" : ""}
                type="button"
                title={`${toolLabel(item)} (${toolShortcutLabel(item)})`}
                onClick={() => {
                  setTool(item);
                  setEdgeFromId(null);
                  setEdgeCursor(null);
                }}
              >
                <CanvasGlyph name={item} />
                <span>{toolLabel(item)}</span>
              </button>
            ))}
          </div>
          {floatingBarStyle && !marqueeRect && (
            <div
              className="canvasFloatingBar"
              style={floatingBarStyle}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {selectedEdge ? (
                <>
                  {EDGE_CONNECTORS.map((connector) => (
                    <button
                      key={connector.value}
                      type="button"
                      className={`canvasConnectorChoice ${
                        edgeConnector(selectedEdge) === connector.value ? "isActive" : ""
                      }`}
                      title={connector.title}
                      onClick={() => updateSelectedEdge({ connector: connector.value })}
                    >
                      {connector.label}
                    </button>
                  ))}
                  <input
                    className="canvasEdgeLabelInput"
                    value={selectedEdge.label ?? ""}
                    placeholder="ラベル"
                    aria-label="接続線のラベル"
                    onChange={(event) => updateSelectedEdge({ label: event.target.value })}
                  />
                  <span className="canvasFloatingBarDivider" aria-hidden="true" />
                  <button
                    className="dangerCanvasButton"
                    type="button"
                    title="接続線を削除"
                    aria-label="接続線を削除"
                    onClick={deleteSelection}
                  >
                    <CanvasGlyph name="trash" />
                  </button>
                </>
              ) : (
                <>
                  <div className="canvasStyleHost">
                    <button
                      className={isStyleOpen ? "isActive" : ""}
                      type="button"
                      title="表示設定"
                      aria-label="表示設定"
                      aria-expanded={isStyleOpen}
                      disabled={selectedTextNodesForStyle.length === 0}
                      onClick={() => setIsStyleOpen((value) => !value)}
                    >
                      <CanvasGlyph name="style" />
                    </button>
                    {isStyleOpen && selectedTextNodesForStyle.length > 0 && (
                      <div className="canvasStylePopover" role="dialog" aria-label="表示設定">
                        <h2>表示設定</h2>
                        <p>{selectedTextNodesForStyle.length}枚のカードに適用</p>
                        {singleSelectedTextNode && (
                          <section>
                            <span>タイトル</span>
                            <input
                              className="canvasStyleTitleInput"
                              value={singleSelectedTextNode.title ?? ""}
                              placeholder="タイトルを追加"
                              aria-label="選択カードのタイトル"
                              onChange={(event) =>
                                updateNode(singleSelectedTextNode.id, { title: event.target.value })
                              }
                            />
                          </section>
                        )}
                        <section>
                          <span>カード色</span>
                          <div className="canvasColorChoices">
                            {CARD_COLORS.map((color) => (
                              <button
                                key={color.value || "default"}
                                type="button"
                                className={`canvasColorChoice ${
                                  selectedCardColor === color.value ? "isActive" : ""
                                }`}
                                title={color.label}
                                aria-label={`カード色: ${color.label}`}
                                onClick={() =>
                                  updateSelectedTextNodes({ color: color.value || undefined })
                                }
                              >
                                <i data-color={color.value || undefined} />
                              </button>
                            ))}
                          </div>
                        </section>
                        <section>
                          <span>書字方向</span>
                          <div>
                            <button
                              type="button"
                              className={selectedWritingMode === "horizontal-tb" ? "isActive" : ""}
                              onClick={() =>
                                updateSelectedTextNodes({ writingMode: "horizontal-tb" })
                              }
                            >
                              横書き
                            </button>
                            <button
                              type="button"
                              className={selectedWritingMode === "vertical-rl" ? "isActive" : ""}
                              onClick={() =>
                                updateSelectedTextNodes({ writingMode: "vertical-rl" })
                              }
                            >
                              縦書き
                            </button>
                          </div>
                        </section>
                        <section>
                          <span>フォント</span>
                          <div>
                            <button
                              type="button"
                              className={selectedFontSource === "ui" ? "isActive" : ""}
                              onClick={() => updateSelectedTextNodes({ fontSource: "ui" })}
                            >
                              UI
                            </button>
                            <button
                              type="button"
                              className={selectedFontSource === "editor" ? "isActive" : ""}
                              onClick={() => updateSelectedTextNodes({ fontSource: "editor" })}
                            >
                              本文
                            </button>
                          </div>
                        </section>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    title="選択を複製"
                    aria-label="選択を複製"
                    onClick={duplicateSelection}
                  >
                    <CanvasGlyph name="copy" />
                  </button>
                  {selectedNodes.length === 1 && (
                    <button
                      type="button"
                      title="このカードから接続線を引く"
                      aria-label="このカードから接続線を引く"
                      onClick={() => startEdgeFrom(selectedNodes[0].id)}
                    >
                      <CanvasGlyph name="edge" />
                    </button>
                  )}
                  <span className="canvasFloatingBarDivider" aria-hidden="true" />
                  <select
                    value={targetThreadId}
                    disabled={textNodesForIdea.length === 0}
                    onChange={(event) => setTargetThreadId(event.target.value)}
                    aria-label="Idea の送信先スレッド"
                  >
                    {ideaThreadOptions.map((thread) => (
                      <option key={thread.id} value={thread.id}>
                        {thread.kind === "inbox" ? "▾ " : ""}
                        {thread.title}
                      </option>
                    ))}
                    <option value={NEW_THREAD_TARGET}>新規スレッド</option>
                  </select>
                  <button
                    type="button"
                    title="Idea へ送る"
                    aria-label="Idea へ送る"
                    disabled={textNodesForIdea.length === 0}
                    onClick={() => void sendSelectedToIdea()}
                  >
                    <CanvasGlyph name="send" />
                  </button>
                  <button
                    type="button"
                    title="プロットへ送る"
                    aria-label="プロットへ送る"
                    disabled={textNodesForIdea.length === 0}
                    onClick={() => void sendSelectedToPlot()}
                  >
                    <CanvasGlyph name="plot" />
                  </button>
                  <span className="canvasFloatingBarDivider" aria-hidden="true" />
                  <button
                    className="dangerCanvasButton"
                    type="button"
                    title="削除"
                    aria-label="削除"
                    onClick={deleteSelection}
                  >
                    <CanvasGlyph name="trash" />
                  </button>
                </>
              )}
            </div>
          )}
          <div className="canvasCorner canvasCornerLeft">
            <span className="canvasSaveStatus">
              <i aria-hidden="true" />
              {status}
            </span>
          </div>
          <div className="canvasCorner canvasCornerRight">
            <button
              type="button"
              title="元に戻す (Ctrl+Z)"
              aria-label="元に戻す"
              disabled={!canUndo}
              onClick={undoBoard}
            >
              <CanvasGlyph name="undo" />
            </button>
            <button
              type="button"
              title="やり直す (Ctrl+Y)"
              aria-label="やり直す"
              disabled={!canRedo}
              onClick={redoBoard}
            >
              <CanvasGlyph name="redo" />
            </button>
            <span className="canvasFloatingBarDivider" aria-hidden="true" />
            <button type="button" aria-label="縮小" onClick={() => zoomTo(zoomRef.current - 0.1)}>
              -
            </button>
            <button
              className="canvasZoomValue"
              type="button"
              title="100%に戻す"
              onClick={() => zoomTo(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" aria-label="拡大" onClick={() => zoomTo(zoomRef.current + 0.1)}>
              +
            </button>
          </div>
        </div>
        {!embedded && isDraftPanelOpen && (
          <aside className="canvasDraftSidebar">
            <IntermediateDraftPane rootPath={rootPath}
              liveCanvas={board && activeBoardId && draftCanvasReadyRef.current && status !== "読み込み中" ? { boardId: activeBoardId, scope, rootPath, board, selectedIds: [...selectedIds] } : null}
              onSelectNode={selectDraftNode}
              onOpenCanvas={(nextScope, boardId) => { void loadBoardList(nextScope, boardId); }} />
          </aside>
        )}
        {!embedded && isSidePanelOpen && (
          <CanvasSidePanel
            threads={ideaThreadOptions}
            referenceFiles={referenceFiles}
            onInsertFragment={(body) => insertIdeaTextNodeAt(body, viewportCenterWorld())}
            onInsertReference={(file) => void insertReferenceNodeAt(file, viewportCenterWorld())}
            onClose={() => setIsSidePanelOpen(false)}
          />
        )}
      </section>
      {isRenameModalOpen && (
        <div className="canvasModalBackdrop" role="presentation">
          <form className="canvasRenameModal" onSubmit={submitRename}>
            <header>
              <h2>ボード名を変更</h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setIsRenameModalOpen(false)}
              >
                ×
              </button>
            </header>
            <label>
              <span>名前</span>
              <input
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
              />
            </label>
            <footer>
              <button type="button" onClick={() => setIsRenameModalOpen(false)}>
                キャンセル
              </button>
              <button type="submit">変更</button>
            </footer>
          </form>
        </div>
      )}
      {isCreateModalOpen && (
        <div className="canvasModalBackdrop" role="presentation">
          <form className="canvasRenameModal" onSubmit={(event) => void submitCreate(event)}>
            <header>
              <h2>ボードを作成</h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setIsCreateModalOpen(false)}
              >
                ×
              </button>
            </header>
            <label>
              <span>名前</span>
              <input
                autoFocus
                value={createDraft}
                onChange={(event) => setCreateDraft(event.target.value)}
              />
            </label>
            <footer>
              <button type="button" onClick={() => setIsCreateModalOpen(false)}>
                キャンセル
              </button>
              <button type="submit">作成</button>
            </footer>
          </form>
        </div>
      )}
      {deleteTarget && (
        <div className="canvasModalBackdrop" role="presentation">
          <section
            className="canvasRenameModal canvasDeleteModal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="canvas-delete-title"
            aria-describedby="canvas-delete-description"
          >
            <header>
              <h2 id="canvas-delete-title">ボードをゴミ箱へ移動</h2>
              <button type="button" aria-label="閉じる" onClick={() => setDeleteTarget(null)}>
                ×
              </button>
            </header>
            <p id="canvas-delete-description">
              「{deleteTarget.name}」をゴミ箱へ移動します。あとでゴミ箱から復元できます。
            </p>
            <footer>
              <button type="button" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </button>
              <button
                className="dangerCanvasButton"
                type="button"
                onClick={() => void confirmDeleteBoard()}
              >
                ゴミ箱へ移動
              </button>
            </footer>
          </section>
        </div>
      )}
      {isTrashModalOpen && (
        <div className="canvasModalBackdrop" role="presentation">
          <section
            className="canvasRenameModal canvasTrashModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-trash-title"
          >
            <header>
              <div>
                <h2 id="canvas-trash-title">ゴミ箱</h2>
                <span>{scope === "project" ? "作品ボード" : "共通ボード"}</span>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setIsTrashModalOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="canvasTrashList">
              {isTrashLoading && trashedBoards.length === 0 ? (
                <p>読み込み中…</p>
              ) : trashedBoards.length === 0 ? (
                <p>ゴミ箱は空です。</p>
              ) : (
                trashedBoards.map((item) => (
                  <article key={item.trashId}>
                    <div>
                      <strong title={item.name}>{item.name}</strong>
                      <span>
                        {formatDeletedTime(item.deletedAt)} ・ カード {item.nodeCount}件
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isTrashLoading}
                      onClick={() => void restoreBoard(item.trashId)}
                    >
                      復元
                    </button>
                  </article>
                ))
              )}
            </div>
            <footer>
              <button type="button" onClick={() => setIsTrashModalOpen(false)}>
                閉じる
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
