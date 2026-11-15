import type {
  CanvasNodeFontSource,
  CanvasScope,
  ReferenceFileInfo,
  ReferenceKind,
  WritingMode,
} from "./types";

export type { CanvasScope } from "./types";

export type CanvasNodeOriginRef = {
  source: "idea";
  sourceId: string;
  sourceThreadId: string;
  sourceWorkspacePath: string;
  copiedAt: number;
};

export type CanvasTextNode = {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  text: string;
  writingMode?: WritingMode;
  fontSource?: CanvasNodeFontSource;
  color?: string;
  thenOrigin?: CanvasNodeOriginRef;
  /** Then固有: 近接ドロップで作るカードスレッドの親。 */
  threadParentId?: string;
  /** Then固有: 同じ親を持つカード内での順序。 */
  threadOrder?: number;
  /** Then固有: このカード以下のスレッドを折りたたむ。 */
  threadCollapsed?: boolean;
};

export type CanvasGroupNode = {
  id: string;
  type: "group";
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color?: string;
  thenOrigin?: CanvasNodeOriginRef;
};

export type CanvasReferenceNode = {
  id: string;
  type: "reference";
  x: number;
  y: number;
  width: number;
  height: number;
  scope: CanvasScope;
  sourcePath: string;
  name: string;
  kind: ReferenceKind;
  size?: number;
  imported?: boolean;
  color?: string;
};

export type CanvasNode = CanvasTextNode | CanvasGroupNode | CanvasReferenceNode;

export type CanvasEdgeConnector = "line" | "arrow" | "bidirectional" | "dashed";

export type CanvasEdge = {
  id: string;
  fromNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toNode: string;
  toSide?: "top" | "right" | "bottom" | "left";
  connector?: CanvasEdgeConnector;
  label?: string;
  color?: string;
};

export type ThenCanvasMeta = {
  version: 1;
  name: string;
  scope?: CanvasScope;
  createdAt?: number;
  updatedAt: number;
};

export type JsonCanvasDocument = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  then?: ThenCanvasMeta;
};

export type CanvasBoardSummary = {
  id: string;
  name: string;
  path: string;
  scope: CanvasScope;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
};

/** サイドバー→キャンバスの HTML5 DnD で使う MIME。 */
export const REFERENCE_FILE_DRAG_MIME = "application/x-then-reference-file";

/**
 * メイン画面 → 別ウィンドウキャンバスへ資料の最新一覧だけを届けるイベント。
 * then-canvas-payload と違いボードの再読込（選択・undo履歴のリセット）を起こさない。
 */
export const CANVAS_LIVE_DATA_EVENT = "then-canvas-live-data";

export type CanvasLiveDataEvent = {
  referenceFiles: ReferenceFileInfo[];
};

/** キャンバス → メイン画面へ、選んだカードを投稿にしてもらうイベント（BINDER 2-4、確認1の 8）。 */
export const CANVAS_COPY_TO_POST_EVENT = "then-canvas-copy-to-post";

export type CanvasCopyToPostRequest = {
  /** カード1枚ずつの本文。1件ずつ投稿にする。 */
  bodies: string[];
};

/**
 * メイン画面 → 開いているキャンバス（別ウィンドウ・埋め込み）へ、作品の中のファイル・フォルダの改名・移動を知らせる
 * イベント（BINDER 2-6）。ボードのファイルは Rust が書き換えるが、開いているキャンバスは持っているボードを丸ごと
 * 保存し直すので、持っている資料カードも付け替える。パスは作品からの相対パス（`/` 区切り）。
 */
export const CANVAS_PATH_CHANGES_EVENT = "then-canvas-path-changes";

export type CanvasPathChange = { oldPath: string; newPath: string };

export type CanvasPathChangesEvent = {
  rootPath: string;
  changes: CanvasPathChange[];
};

function canvasReferenceKind(path: string): ReferenceKind {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  if (extension === "txt") return "text";
  if (extension === "md") return "markdown";
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") return "image";
  if (extension === "pdf") return "pdf";
  return "unknown";
}

/**
 * ボードの作品の資料カードを、改名・移動に合わせて付け替える（パス・名前・種類。フォルダなら中のものすべて）。
 * 同じ付け替えを2回しても結果は同じ。変わるカードがなければ null。
 */
export function retargetCanvasReferenceNodes(
  board: JsonCanvasDocument,
  changes: CanvasPathChange[],
): JsonCanvasDocument | null {
  let changed = false;
  const nodes = board.nodes.map((node) => {
    if (node.type !== "reference" || node.scope !== "project") return node;
    let sourcePath = node.sourcePath.replace(/\\/g, "/");
    for (const change of changes) {
      if (!change.oldPath || !change.newPath) continue;
      if (sourcePath === change.oldPath) sourcePath = change.newPath;
      else if (sourcePath.startsWith(`${change.oldPath}/`)) {
        sourcePath = `${change.newPath}${sourcePath.slice(change.oldPath.length)}`;
      }
    }
    if (sourcePath === node.sourcePath) return node;
    changed = true;
    return {
      ...node,
      sourcePath,
      name: sourcePath.split("/").filter(Boolean).pop() ?? sourcePath,
      kind: canvasReferenceKind(sourcePath),
    };
  });
  return changed ? { ...board, nodes } : null;
}

export type CanvasWindowPayload = {
  requestId: string;
  rootPath: string | null;
  workspaceName: string;
  scope: CanvasScope;
  boardId?: string;
  selectNodeId?: string;
  theme: string;
  editorFontFamily: string;
  uiFontFamily: string;
  uiFontScale: number;
  canvasDefaultWritingMode: WritingMode;
  canvasDefaultFontSource: CanvasNodeFontSource;
  referenceFiles?: ReferenceFileInfo[];
  /** メイン画面の右サイドバー表示状態。別ウィンドウのサイドパネルへ引き継ぐ。 */
  rightSidebarVisible?: boolean;
};


let canvasIdCounter = 0;

export function nextCanvasId(prefix: string): string {
  canvasIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${canvasIdCounter}`;
}

export function createCanvasDocument(
  name = "Idea Board",
  scope: CanvasScope = "project",
): JsonCanvasDocument {
  const now = Date.now();
  return {
    nodes: [],
    edges: [],
    then: {
      version: 1,
      name,
      scope,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function createCanvasTextNode(
  text: string,
  options: Partial<Omit<CanvasTextNode, "id" | "type" | "text">> = {},
): CanvasTextNode {
  return {
    id: nextCanvasId("node"),
    type: "text",
    x: options.x ?? 120,
    y: options.y ?? 120,
    width: options.width ?? 260,
    height: options.height ?? 150,
    title: options.title,
    text,
    writingMode: options.writingMode,
    fontSource: options.fontSource,
    color: options.color,
    thenOrigin: options.thenOrigin,
    threadParentId: options.threadParentId,
    threadOrder: options.threadOrder,
    threadCollapsed: options.threadCollapsed,
  };
}

export function createCanvasGroupNode(
  label: string,
  options: Partial<Omit<CanvasGroupNode, "id" | "type" | "label">> = {},
): CanvasGroupNode {
  return {
    id: nextCanvasId("group"),
    type: "group",
    x: options.x ?? 80,
    y: options.y ?? 80,
    width: options.width ?? 640,
    height: options.height ?? 360,
    label,
    color: options.color ?? "2",
    thenOrigin: options.thenOrigin,
  };
}

export function createCanvasReferenceNode(
  file: ReferenceFileInfo,
  options: Partial<Omit<CanvasReferenceNode, "id" | "type" | "scope" | "sourcePath" | "name" | "kind">> = {},
): CanvasReferenceNode {
    return {
      id: nextCanvasId("reference"),
      type: "reference",
      x: options.x ?? 140,
      y: options.y ?? 140,
      width: options.width ?? 380,
      height: options.height ?? 260,
      scope: file.scope,
      sourcePath: file.sourcePath,
      name: file.name,
      kind: file.kind,
    size: file.size,
    imported: file.imported,
    color: options.color,
  };
}

export function createCanvasEdge(
  fromNode: string,
  toNode: string,
  label = "",
  connector: CanvasEdgeConnector = "arrow",
): CanvasEdge {
  return {
    id: nextCanvasId("edge"),
    fromNode,
    toNode,
    connector,
    label: label || undefined,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeOriginRef(value: unknown): CanvasNodeOriginRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const origin = value as Partial<CanvasNodeOriginRef>;
  if (origin.source !== "idea") return undefined;
  if (
    typeof origin.sourceId !== "string" ||
    typeof origin.sourceThreadId !== "string" ||
    typeof origin.sourceWorkspacePath !== "string"
  ) {
    return undefined;
  }
  return {
    source: "idea",
    sourceId: origin.sourceId,
    sourceThreadId: origin.sourceThreadId,
    sourceWorkspacePath: origin.sourceWorkspacePath,
    copiedAt: isFiniteNumber(origin.copiedAt) ? origin.copiedAt : Date.now(),
  };
}

function normalizeNode(value: unknown): CanvasNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Partial<CanvasNode>;
  const id = typeof node.id === "string" && node.id ? node.id : nextCanvasId("node");
  const x = isFiniteNumber(node.x) ? node.x : 100;
  const y = isFiniteNumber(node.y) ? node.y : 100;
  const width = isFiniteNumber(node.width) ? Math.max(120, node.width) : 260;
  const height = isFiniteNumber(node.height) ? Math.max(90, node.height) : 150;
  const color = typeof node.color === "string" ? node.color : undefined;
  const thenOrigin = normalizeOriginRef((node as { thenOrigin?: unknown }).thenOrigin);

  if (node.type === "group") {
    return {
      id,
      type: "group",
      x,
      y,
      width,
      height,
      label:
        typeof (node as Partial<CanvasGroupNode>).label === "string"
          ? (node as Partial<CanvasGroupNode>).label ?? ""
          : "",
      color,
      thenOrigin,
    };
  }

  if (node.type === "reference") {
    const reference = node as Partial<CanvasReferenceNode>;
    const kind =
      reference.kind === "text" ||
      reference.kind === "markdown" ||
      reference.kind === "image" ||
      reference.kind === "pdf" ||
      reference.kind === "unknown"
        ? reference.kind
        : "unknown";
    return {
        id,
        type: "reference",
        x,
        y,
        width: Math.max(260, width),
        height: Math.max(180, height),
        scope: reference.scope === "global" ? "global" : "project",
        sourcePath: typeof reference.sourcePath === "string" ? reference.sourcePath : "",
      name:
        typeof reference.name === "string" && reference.name.trim()
          ? reference.name
          : typeof reference.sourcePath === "string"
            ? reference.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? "資料"
            : "資料",
      kind,
      size: isFiniteNumber(reference.size) ? reference.size : undefined,
      imported: typeof reference.imported === "boolean" ? reference.imported : undefined,
      color,
    };
  }

  if (node.type === "text") {
    const textNode = node as Partial<CanvasTextNode>;
    const writingMode =
      textNode.writingMode === "vertical-rl" ||
      textNode.writingMode === "horizontal-tb"
        ? textNode.writingMode
        : undefined;
    const fontSource =
      textNode.fontSource === "editor" ||
      textNode.fontSource === "ui"
        ? textNode.fontSource
        : undefined;
    return {
      id,
      type: "text",
      x,
      y,
      width,
      height,
      title: typeof textNode.title === "string" ? textNode.title : undefined,
      text:
        typeof textNode.text === "string"
          ? textNode.text ?? ""
          : "",
      writingMode,
      fontSource,
      color,
      thenOrigin,
      threadParentId:
        typeof textNode.threadParentId === "string" ? textNode.threadParentId : undefined,
      threadOrder: isFiniteNumber(textNode.threadOrder) ? textNode.threadOrder : undefined,
      threadCollapsed:
        typeof textNode.threadCollapsed === "boolean" ? textNode.threadCollapsed : undefined,
    };
  }

  return null;
}

function normalizeEdge(value: unknown, nodeIds: Set<string>): CanvasEdge | null {
  if (!value || typeof value !== "object") return null;
  const edge = value as Partial<CanvasEdge>;
  if (typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") return null;
  if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) return null;
  const connector =
    edge.connector === "line" ||
    edge.connector === "arrow" ||
    edge.connector === "bidirectional" ||
    edge.connector === "dashed"
      ? edge.connector
      : undefined;
  return {
    id: typeof edge.id === "string" && edge.id ? edge.id : nextCanvasId("edge"),
    fromNode: edge.fromNode,
    fromSide: edge.fromSide,
    toNode: edge.toNode,
    toSide: edge.toSide,
    connector,
    label: typeof edge.label === "string" ? edge.label : undefined,
    color: typeof edge.color === "string" ? edge.color : undefined,
  };
}

export function normalizeCanvasDocument(
  value: unknown,
  fallbackName = "Idea Board",
  _fallbackScope: CanvasScope = "project",
): JsonCanvasDocument {
  const source = value && typeof value === "object" ? (value as Partial<JsonCanvasDocument>) : {};
  const nodes = Array.isArray(source.nodes)
    ? source.nodes
        .map(normalizeNode)
        .filter((node): node is CanvasNode => Boolean(node))
        .filter((node) => node.type !== "reference" || node.scope !== "global")
    : [];
  const textNodes = new Map(
    nodes
      .filter((node): node is CanvasTextNode => node.type === "text")
      .map((node) => [node.id, node] as const),
  );
  const sanitizedNodes = nodes.map((node) => {
    if (node.type !== "text" || !node.threadParentId) return node;
    const visited = new Set<string>([node.id]);
    let parentId: string | undefined = node.threadParentId;
    while (parentId) {
      const parent = textNodes.get(parentId);
      if (!parent || visited.has(parent.id)) {
        return { ...node, threadParentId: undefined, threadOrder: undefined };
      }
      visited.add(parent.id);
      parentId = parent.threadParentId;
    }
    return node;
  });
  const nodeIds = new Set(sanitizedNodes.map((node) => node.id));
  const edges = Array.isArray(source.edges)
    ? source.edges
        .map((edge) => normalizeEdge(edge, nodeIds))
        .filter((edge): edge is CanvasEdge => Boolean(edge))
    : [];

  const then = source.then && typeof source.then === "object" ? source.then : undefined;
  const now = Date.now();
  return {
    nodes: sanitizedNodes,
    edges,
    then: {
      version: 1,
      name:
        typeof then?.name === "string" && then.name.trim()
          ? then.name
          : fallbackName,
      scope: "project",
      createdAt: isFiniteNumber(then?.createdAt) ? then.createdAt : now,
      updatedAt: isFiniteNumber(then?.updatedAt) ? then.updatedAt : now,
    },
  };
}
