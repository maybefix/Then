import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import {
  createCanvasDocument,
  createCanvasEdge,
  createCanvasGroupNode,
  createCanvasReferenceNode,
  createCanvasTextNode,
  nextCanvasId,
  normalizeCanvasDocument,
  type CanvasBoardSummary,
  type CanvasCopyToIdeaItem,
  type CanvasEdgeConnector,
  type CanvasCopyToIdeaRequest,
  type CanvasEdge,
  type CanvasFocusIdeaRequest,
  type CanvasGroupNode,
  type CanvasNode,
  type CanvasReferenceNode,
  type CanvasScope,
  type CanvasTextNode,
  type CanvasWindowPayload,
  type JsonCanvasDocument,
} from "./canvasTypes";
import type { CanvasNodeFontSource, WritingMode } from "./types";
import { ReferenceReadOnlyPreview } from "./components/references/ReferenceLayer";

const CANVAS_WIDTH = 6400;
const CANVAS_HEIGHT = 4200;
const NEW_THREAD_TARGET = "__new__";
const LOCAL_STORAGE_PREFIX = "then.canvas-board";

type CanvasTool = "select" | "text" | "group" | "edge";
type CanvasEdgeSide = NonNullable<CanvasEdge["fromSide"]>;

type Point = {
  x: number;
  y: number;
};

const EDGE_CONNECTORS: Array<{ value: CanvasEdgeConnector; label: string; title: string }> = [
  { value: "line", label: "線", title: "順序なしの線" },
  { value: "arrow", label: "矢印", title: "元 node から先 node への矢印" },
  { value: "bidirectional", label: "双方向", title: "双方向の矢印" },
  { value: "dashed", label: "破線", title: "補助的な接続" },
];

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
    }
  | {
      kind: "node";
      start: Point;
      nodeIds: string[];
      originals: Map<string, Point>;
    }
  | {
      kind: "resize";
      start: Point;
      nodeId: string;
      width: number;
      height: number;
    };

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
  return Object.entries(boards)
    .map(([id, board]) => summarizeLocalBoard(id, board, scope))
    .sort((left, right) => right.updatedAt - left.updatedAt);
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

function edgePath(from: CanvasNode, to: CanvasNode) {
  const sides = automaticEdgeSides(from, to);
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

function toolLabel(tool: CanvasTool) {
  switch (tool) {
    case "text":
      return "テキスト";
    case "group":
      return "グループ";
    case "edge":
      return "接続";
    default:
      return "選択";
  }
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
    | "reference";
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
    default:
      return (
        <svg {...common}>
          <path d="m5 3 7 17 2-7 7-2z" />
        </svg>
      );
  }
}

export default function CanvasWindowApp() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const suppressNextSaveRef = useRef(false);

  const [payload, setPayload] = useState<CanvasWindowPayload | null>(null);
  const [scope, setScope] = useState<CanvasScope>("global");
  const [boards, setBoards] = useState<CanvasBoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [board, setBoard] = useState<JsonCanvasDocument | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [edgeFromId, setEdgeFromId] = useState<string | null>(null);
  const [targetThreadId, setTargetThreadId] = useState("idea-inbox");
  const [pan, setPan] = useState<Point>({ x: 180, y: 120 });
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("読み込み中");
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const [isReferenceMenuOpen, setIsReferenceMenuOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  const rootPath = payload?.rootPath ?? null;
  const selectedNodes = useMemo(
    () => board?.nodes.filter((node) => selectedIds.has(node.id)) ?? [],
    [board, selectedIds],
  );
  const selectedEdge = useMemo(
    () => board?.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [board, selectedEdgeId],
  );
  const referenceFiles = payload?.referenceFiles ?? [];
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
    setBoard((current) => {
      if (!current) return current;
      const next = updater(current);
      return {
        ...next,
        then: {
          version: 1,
          name: boardName(next),
          scope: next.then?.scope,
          createdAt: next.then?.createdAt,
          updatedAt: Date.now(),
        },
      };
    });
  }, []);

  const renameBoard = (name: string) => {
    const nextName = name.trim() || "Idea Board";
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

  const addReferenceNode = (file: (typeof referenceFiles)[number]) => {
    if (!board) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    const width = 380;
    const height = 260;
    const point = screenToWorld(
      (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
      (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
    );
    const node = createCanvasReferenceNode(file, {
      x: Math.max(0, point.x - width / 2),
      y: Math.max(0, point.y - height / 2),
      width,
      height,
    });
    patchBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedIds(new Set([node.id]));
    setSelectedEdgeId(null);
    setTool("select");
    setIsReferenceMenuOpen(false);
    setReferenceQuery("");
  };

  const loadBoardList = useCallback(
    async (nextScope: CanvasScope, preferredBoardId?: string, selectNodeId?: string) => {
      if (!payload) return;
      setStatus("読み込み中");
      setEdgeFromId(null);
      setSelectedEdgeId(null);
      try {
        let summaries = await listBoards(nextScope, payload.rootPath);
        if (summaries.length === 0) {
          const created = await createBoard(
            nextScope,
            payload.rootPath,
            nextScope === "project" ? `${payload.workspaceName} Board` : "Global Idea Board",
          );
          summaries = [created];
        }
        setBoards(summaries);
        const nextBoard =
          summaries.find((item) => item.id === preferredBoardId) ?? summaries[0];
        setActiveBoardId(nextBoard.id);
        const rawBoard = await loadBoard(nextScope, payload.rootPath, nextBoard.id);
        suppressNextSaveRef.current = true;
        setBoard(normalizeCanvasDocument(rawBoard, nextBoard.name, nextScope));
        setSelectedIds(selectNodeId ? new Set([selectNodeId]) : new Set());
        setStatus("保存済み");
      } catch (error) {
        setStatus(String(error));
      }
    },
    [payload],
  );

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!payload) return;
    setScope(payload.scope);
    setTargetThreadId(
      payload.ideaThreads.find((thread) => thread.kind === "inbox")?.id ??
        payload.ideaThreads[0]?.id ??
        "idea-inbox",
    );
    void loadBoardList(payload.scope, payload.boardId, payload.selectNodeId);
  }, [payload, loadBoardList]);

  useEffect(() => {
    if (!board || !activeBoardId || !payload) return;
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setStatus("保存中");
    saveTimerRef.current = window.setTimeout(() => {
      saveBoard(scope, payload.rootPath, activeBoardId, board)
        .then(async () => {
          const summaries = await listBoards(scope, payload.rootPath);
          setBoards(summaries);
          setStatus(`保存済み ${formatSaveTime(Date.now())}`);
        })
        .catch((error) => setStatus(String(error)))
        .finally(() => {
          saveTimerRef.current = null;
        });
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeBoardId, board, payload, scope]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      event.preventDefault();
      if (drag.kind === "pan") {
        setPan({
          x: drag.pan.x + event.clientX - drag.start.x,
          y: drag.pan.y + event.clientY - drag.start.y,
        });
        return;
      }
      if (drag.kind === "node") {
        const dx = (event.clientX - drag.start.x) / zoom;
        const dy = (event.clientY - drag.start.y) / zoom;
        patchBoard((current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const original = drag.originals.get(node.id);
            return original ? { ...node, x: original.x + dx, y: original.y + dy } : node;
          }),
        }));
        return;
      }
      const dx = (event.clientX - drag.start.x) / zoom;
      const dy = (event.clientY - drag.start.y) / zoom;
      patchBoard((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === drag.nodeId
            ? {
                ...node,
                width: Math.max(node.type === "group" ? 260 : 150, drag.width + dx),
                height: Math.max(node.type === "group" ? 160 : 90, drag.height + dy),
              }
            : node,
        ),
      }));
    };
    const clearDrag = () => {
      dragStateRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", clearDrag);
    window.addEventListener("pointercancel", clearDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", clearDrag);
      window.removeEventListener("pointercancel", clearDrag);
    };
  }, [patchBoard, zoom]);

  const switchScope = (nextScope: CanvasScope) => {
    if (nextScope === "project" && !payload?.rootPath) {
      setStatus("Project Canvas はプロジェクトを開いている時に利用できます");
      return;
    }
    setScope(nextScope);
    void loadBoardList(nextScope);
  };

  const switchBoard = (boardId: string) => {
    setIsBoardMenuOpen(false);
    void loadBoardList(scope, boardId);
  };

  const createNewBoard = async () => {
    if (!payload) return;
    setIsBoardMenuOpen(false);
    const name = window.prompt("Canvas 名", scope === "project" ? `${payload.workspaceName} Board` : "Global Idea Board");
    if (name === null) return;
    try {
      const created = await createBoard(scope, payload.rootPath, name || "Idea Board");
      await loadBoardList(scope, created.id);
    } catch (error) {
      setStatus(String(error));
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
    selectNode(node.id, event);
    const baseNodeIds = selectedIds.has(node.id) ? [...selectedIds] : [node.id];
    const nodeIds = new Set(baseNodeIds);
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
      originals: new Map(
        (board?.nodes ?? [])
          .filter((item) => nodeIds.has(item.id))
          .map((item) => [item.id, { x: item.x, y: item.y }]),
      ),
    };
  };

  const handleNodePointerDown = (node: CanvasNode, event: ReactPointerEvent) => {
    if (tool === "edge") {
      event.preventDefault();
      event.stopPropagation();
      if (!edgeFromId) {
        setEdgeFromId(node.id);
        setSelectedIds(new Set([node.id]));
        setStatus("接続先 node を選択");
        return;
      }
      if (edgeFromId !== node.id) {
        patchBoard((current) => ({
          ...current,
          edges: [...current.edges, createCanvasEdge(edgeFromId, node.id)],
        }));
        setStatus("edge を作成しました");
      }
      setEdgeFromId(null);
      setSelectedIds(new Set([node.id]));
      setTool("select");
      return;
    }
    startNodeDrag(node, event);
  };

  const handleNodeFocus = (nodeId: string) => {
    setSelectedEdgeId(null);
    setSelectedIds(new Set([nodeId]));
  };

  const updateNode = (nodeId: string, patch: Partial<CanvasTextNode> | Partial<CanvasGroupNode>) => {
    patchBoard((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? ({ ...node, ...patch } as CanvasNode) : node)),
    }));
  };

  const updateSelectedTextNodes = (
    patch: { writingMode?: WritingMode; fontSource?: CanvasNodeFontSource },
  ) => {
    if (selectedTextNodesForStyle.length === 0) return;
    const targetIds = new Set(selectedTextNodesForStyle.map((node) => node.id));
    patchBoard((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        targetIds.has(node.id) && isTextNode(node)
          ? ({ ...node, ...patch } as CanvasNode)
          : node,
      ),
    }));
  };

  const updateSelectedEdge = (patch: { connector?: CanvasEdgeConnector }) => {
    if (!selectedEdgeId) return;
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

  const startResize = (node: CanvasNode, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedIds(new Set([node.id]));
    dragStateRef.current = {
      kind: "resize",
      start: { x: event.clientX, y: event.clientY },
      nodeId: node.id,
      width: node.width,
      height: node.height,
    };
  };

  const handleViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setSelectedEdgeId(null);
    setSelectedIds(new Set());
    if (!board) return;

    const point = screenToWorld(event.clientX, event.clientY);
    if (tool === "text") {
      const node = createCanvasTextNode("", {
        x: Math.max(0, point.x - 130),
        y: Math.max(0, point.y - 75),
        writingMode: defaultCanvasWritingMode,
        fontSource: defaultCanvasFontSource,
      });
      patchBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
      setSelectedIds(new Set([node.id]));
      setTool("select");
      return;
    }
    if (tool === "group") {
      const node = createCanvasGroupNode("グループ", {
        x: Math.max(0, point.x - 260),
        y: Math.max(0, point.y - 140),
      });
      patchBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
      setSelectedIds(new Set([node.id]));
      setTool("select");
      return;
    }
    if (tool === "edge") {
      setEdgeFromId(null);
      return;
    }
    dragStateRef.current = {
      kind: "pan",
      start: { x: event.clientX, y: event.clientY },
      pan,
    };
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      setPan((current) => ({
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
      return;
    }
    event.preventDefault();
    const nextZoom = Math.min(1.8, Math.max(0.35, zoom + (event.deltaY > 0 ? -0.08 : 0.08)));
    setZoom(nextZoom);
  };

  const deleteSelection = () => {
    if (!board) return;
    if (selectedEdgeId) {
      patchBoard((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== selectedEdgeId),
      }));
      setSelectedEdgeId(null);
      return;
    }
    if (selectedIds.size === 0) return;
    patchBoard((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !selectedIds.has(node.id)),
      edges: current.edges.filter(
        (edge) => !selectedIds.has(edge.fromNode) && !selectedIds.has(edge.toNode),
      ),
    }));
    setSelectedIds(new Set());
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedIds.size === 0 && !selectedEdgeId) return;

      const target = event.target as HTMLElement | null;
      const isEditableTarget = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      if (isEditableTarget && event.key === "Backspace") return;

      event.preventDefault();
      deleteSelection();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const duplicateSelection = () => {
    if (!board || selectedIds.size === 0) return;
    const selectedNodeList = board.nodes.filter((node) => selectedIds.has(node.id));
    const idMap = new Map<string, string>();
    const duplicatedNodes: CanvasNode[] = selectedNodeList.map((node) => {
      const id = nextCanvasId(
        node.type === "group" ? "group" : node.type === "reference" ? "reference" : "node",
      );
      idMap.set(node.id, id);
      return {
        ...node,
        id,
        x: node.x + 36,
        y: node.y + 36,
      } as CanvasNode;
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
    setPan({ x: 180, y: 120 });
    setZoom(1);
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
          ? `${items.length}件を新規 Idea thread へ送信しました`
          : `${items.length}件を Idea へ送信しました`,
      );
    } catch (error) {
      setStatus(`Idea へ送信できませんでした: ${String(error)}`);
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

  const focusSelectedNode = () => {
    const node = selectedNodes[0];
    if (!node) return;
    setPan({
      x: window.innerWidth / 2 - (node.x + node.width / 2) * zoom,
      y: window.innerHeight / 2 - (node.y + node.height / 2) * zoom,
    });
  };

  const renderEdge = (edge: CanvasEdge) => {
    if (!board) return null;
    const from = board.nodes.find((node) => node.id === edge.fromNode);
    const to = board.nodes.find((node) => node.id === edge.toNode);
    if (!from || !to) return null;
    const connector = edgeConnector(edge);
    const { d, start, end, fromControl, toControl, mid } = edgePath(from, to);
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
  const textNodes = board?.nodes.filter(isTextNode) ?? [];

  return (
    <main
      className="appShell canvasWindowRoot"
      data-theme={payload?.theme ?? "dark"}
      style={themeStyle}
    >
      <header className="canvasTopbar">
        <div className="canvasToolbarCluster canvasScopeSwitch" aria-label="Canvas scope">
          {(["global", "project"] as CanvasScope[]).map((item) => (
            <button
              key={item}
              type="button"
              className={scope === item ? "isActive" : ""}
              disabled={item === "project" && !payload?.rootPath}
              onClick={() => switchScope(item)}
            >
              {item === "project" ? "Project" : "Global"}
            </button>
          ))}
        </div>
        <div className="canvasToolbarCluster canvasBoardCluster">
          <div className="canvasBoardMenuHost">
            <button
              className="canvasBoardTitleButton"
              type="button"
              aria-label="Canvas を切り替え"
              aria-expanded={isBoardMenuOpen}
              disabled={boards.length === 0}
              onClick={() => setIsBoardMenuOpen((value) => !value)}
              title={boardName(board)}
            >
              <span>{boardName(board)}</span>
            </button>
            {isBoardMenuOpen && (
              <div className="canvasBoardMenu" role="menu" aria-label="Canvas 一覧">
                {boards.map((item) => (
                  <button
                    key={item.id}
                    className={item.id === activeBoardId ? "isActive" : ""}
                    type="button"
                    role="menuitem"
                    title={item.name}
                    onClick={() => switchBoard(item.id)}
                  >
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="canvasIconButton"
            type="button"
            title="ボード名を変更"
            onClick={openRenameModal}
          >
            <CanvasGlyph name="edit" />
          </button>
          <button
            className="canvasIconButton"
            type="button"
            title="Canvas を作成"
            onClick={() => void createNewBoard()}
          >
            <CanvasGlyph name="plus" />
          </button>
        </div>
        <div className="canvasToolbarCluster canvasToolGroup" aria-label="Canvas tools">
          {(["select", "text", "group", "edge"] as CanvasTool[]).map((item) => (
            <button
              key={item}
              className={tool === item ? "isActive" : ""}
              type="button"
              title={toolLabel(item)}
              onClick={() => {
                setTool(item);
                setEdgeFromId(null);
              }}
            >
              <CanvasGlyph name={item} />
              <span>{toolLabel(item)}</span>
            </button>
          ))}
        </div>
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
        <div className="canvasStyleHost">
          <button
            className={`canvasIconButton ${isStyleOpen ? "isActive" : ""}`}
            type="button"
            title="選択項目の表示設定"
            aria-label="選択項目の表示設定"
            aria-expanded={isStyleOpen}
            disabled={selectedTextNodesForStyle.length === 0 && !selectedEdge}
            onClick={() => setIsStyleOpen((value) => !value)}
          >
            <CanvasGlyph name="style" />
          </button>
          {isStyleOpen && (selectedTextNodesForStyle.length > 0 || selectedEdge) && (
            <div className="canvasStylePopover" role="dialog" aria-label="選択項目の表示設定">
              {selectedEdge ? (
                <>
                  <h2>接続設定</h2>
                  <section>
                    <span>線種</span>
                    <div>
                      {EDGE_CONNECTORS.map((connector) => (
                        <button
                          key={connector.value}
                          type="button"
                          title={connector.title}
                          className={
                            edgeConnector(selectedEdge) === connector.value ? "isActive" : ""
                          }
                          onClick={() => updateSelectedEdge({ connector: connector.value })}
                        >
                          {connector.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <h2>表示設定</h2>
                  <p>{selectedTextNodesForStyle.length} node に適用</p>
                  <section>
                    <span>書字方向</span>
                    <div>
                      <button
                        type="button"
                        className={selectedWritingMode === "horizontal-tb" ? "isActive" : ""}
                        onClick={() => updateSelectedTextNodes({ writingMode: "horizontal-tb" })}
                      >
                        横書き
                      </button>
                      <button
                        type="button"
                        className={selectedWritingMode === "vertical-rl" ? "isActive" : ""}
                        onClick={() => updateSelectedTextNodes({ writingMode: "vertical-rl" })}
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
                </>
              )}
            </div>
          )}
        </div>
        <div className="canvasToolbarCluster canvasZoomControls">
          <button
            type="button"
            aria-label="縮小"
            onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}
          >
            -
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="拡大"
            onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))}
          >
            +
          </button>
        </div>
        <button
          className="canvasIconButton"
          type="button"
          title="表示をリセット"
          onClick={resetViewport}
        >
          <CanvasGlyph name="reset" />
        </button>
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
            <div className="canvasHelpPopover" role="dialog" aria-label="Canvas 操作ヘルプ">
              <h2>Canvas 操作</h2>
              <ul>
                <li>テキスト・グループ: ツールを選び、余白をクリック</li>
                <li>接続: 接続ツールで元 node、先 node の順にクリック</li>
                <li>接続線: edge を選び、表示設定から線種を変更</li>
                <li>移動: 選択ツールで node をドラッグ</li>
                <li>複数選択: Shift / Ctrl / Cmd を押しながらクリック</li>
                <li>パン・ズーム: 余白ドラッグ、ホイール、Ctrl + ホイール</li>
                <li>Idea へ: テキスト node または group を選び、送信先を指定</li>
              </ul>
            </div>
          )}
        </div>
        <button
          className="canvasIconButton"
          type="button"
          title="選択へ移動"
          disabled={selectedNodes.length === 0}
          onClick={focusSelectedNode}
        >
          <CanvasGlyph name="target" />
        </button>
        <button
          className="canvasIconButton"
          type="button"
          title="選択を複製"
          disabled={selectedIds.size === 0}
          onClick={duplicateSelection}
        >
          <CanvasGlyph name="copy" />
        </button>
        <button
          className="canvasIconButton dangerCanvasButton"
          type="button"
          title="削除"
          disabled={selectedIds.size === 0 && !selectedEdgeId}
          onClick={deleteSelection}
        >
          <CanvasGlyph name="trash" />
        </button>
        <div className="canvasToolbarCluster canvasSendControls">
          <select
            value={targetThreadId}
            onChange={(event) => setTargetThreadId(event.target.value)}
            aria-label="Idea 送信先"
          >
            {payload?.ideaThreads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.kind === "inbox" ? "▾ " : ""}
                {thread.title}
              </option>
            ))}
            <option value={NEW_THREAD_TARGET}>新規 thread</option>
          </select>
          <button
            className="canvasPrimaryAction"
            type="button"
            title="Ideaへ送信"
            aria-label="Ideaへ送信"
            disabled={textNodesForIdea.length === 0}
            onClick={() => void sendSelectedToIdea()}
          >
            <CanvasGlyph name="send" />
          </button>
        </div>
        <span className="canvasSaveStatus">
          <i aria-hidden="true" />
          {status}
        </span>
      </header>

      <section className="canvasWorkspace">
        <div
          ref={viewportRef}
          className="canvasViewport"
          onPointerDown={handleViewportPointerDown}
          onWheel={handleWheel}
        >
            <div
              className="canvasWorld"
              onPointerDown={handleViewportPointerDown}
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
                onPointerDown={(event) => handleNodePointerDown(node, event)}
              >
                <input
                  value={node.label}
                  aria-label="Group label"
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
                <span
                  className="canvasResizeHandle"
                  onPointerDown={(event) => startResize(node, event)}
                />
              </article>
            ))}
            <svg className="canvasEdgeLayer" width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
              {board?.edges.map(renderEdge)}
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
                  {rootPath ? (
                    <ReferenceReadOnlyPreview
                      rootPath={rootPath}
                      sourcePath={node.sourcePath}
                      kind={node.kind}
                      title={node.name}
                    />
                  ) : (
                    <div className="referenceReadOnlyPreview referencePlaceholder">
                      Project Canvas で資料を表示できます
                    </div>
                  )}
                </div>
                <footer>
                  <span title={node.sourcePath}>{node.sourcePath}</span>
                  <span>{formatCanvasReferenceSize(node.size)}</span>
                </footer>
                <span
                  className="canvasResizeHandle"
                  onPointerDown={(event) => startResize(node, event)}
                />
              </article>
            ))}
            {textNodes.map((node) => (
              <article
                key={node.id}
                className={`canvasNode canvasTextNode ${
                  selectedIds.has(node.id) ? "isSelected" : ""
                } ${selectedGroupChildIds.has(node.id) ? "isInSelectedGroup" : ""} ${
                  edgeFromId === node.id ? "isEdgeSource" : ""
                } ${
                  isVerticalTextNode(node) ? "isVerticalWriting" : ""
                }`}
                style={textNodeStyle(node)}
                onPointerDown={(event) => handleNodePointerDown(node, event)}
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
                <textarea
                  value={node.text}
                  spellCheck={false}
                  onFocus={() => handleNodeFocus(node.id)}
                  onChange={(event) => updateNode(node.id, { text: event.target.value })}
                  onWheel={(event) => handleTextNodeWheel(node, event)}
                />
                <span
                  className="canvasResizeHandle"
                  onPointerDown={(event) => startResize(node, event)}
                />
              </article>
            ))}
            {board && board.nodes.length === 0 && (
              <div className="canvasEmptyHint" style={{ left: 420, top: 300 }}>
                Text または Group を選んで、余白をクリックしてください
              </div>
            )}
          </div>
        </div>
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
    </main>
  );
}
