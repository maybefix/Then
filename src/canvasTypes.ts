import type {
  CanvasNodeFontSource,
  CanvasScope,
  IdeaOriginRef,
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
  text: string;
  writingMode?: WritingMode;
  fontSource?: CanvasNodeFontSource;
  color?: string;
  thenOrigin?: CanvasNodeOriginRef;
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

export type CanvasIdeaFragmentOption = {
  id: string;
  body: string;
  used: boolean;
};

export type CanvasIdeaThreadOption = {
  id: string;
  kind: "inbox" | "thread";
  title: string;
  /** 別ウィンドウのサイドパネルでドラッグ投入するための断片一覧（任意）。 */
  fragments?: CanvasIdeaFragmentOption[];
};

/**
 * サイドバー→キャンバスの HTML5 DnD で使う MIME。
 * Idea 断片は App.tsx 側のドラッグ開始が設定する既存の MIME を共有する。
 */
export const IDEA_FRAGMENT_DRAG_MIME = "application/x-brew-snippet-id";
export const REFERENCE_FILE_DRAG_MIME = "application/x-then-reference-file";

/**
 * メイン画面 → 別ウィンドウキャンバスへ Idea・資料の最新一覧だけを届けるイベント。
 * then-canvas-payload と違いボードの再読込（選択・undo履歴のリセット）を起こさない。
 */
export const CANVAS_LIVE_DATA_EVENT = "then-canvas-live-data";

export type CanvasLiveDataEvent = {
  ideaThreads: CanvasIdeaThreadOption[];
  referenceFiles: ReferenceFileInfo[];
};

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
  ideaThreads: CanvasIdeaThreadOption[];
  referenceFiles?: ReferenceFileInfo[];
  /** メイン画面の右サイドバー表示状態。別ウィンドウのサイドパネルへ引き継ぐ。 */
  rightSidebarVisible?: boolean;
};

export type CanvasCopyToIdeaItem = {
  nodeId: string;
  text: string;
};

export type CanvasCopyToIdeaRequest = {
  boardId: string;
  boardScope: CanvasScope;
  boardName: string;
  targetThreadId: string;
  threadTitle?: string;
  items: CanvasCopyToIdeaItem[];
};

export type CanvasCopyToPlotRequest = {
  boardId: string;
  boardScope: CanvasScope;
  boardName: string;
  items: CanvasCopyToIdeaItem[];
};

export type CanvasFocusIdeaRequest = {
  threadId: string;
  fragmentId?: string;
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
    text,
    writingMode: options.writingMode,
    fontSource: options.fontSource,
    color: options.color,
    thenOrigin: options.thenOrigin,
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
    const writingMode =
      (node as Partial<CanvasTextNode>).writingMode === "vertical-rl" ||
      (node as Partial<CanvasTextNode>).writingMode === "horizontal-tb"
        ? (node as Partial<CanvasTextNode>).writingMode
        : undefined;
    const fontSource =
      (node as Partial<CanvasTextNode>).fontSource === "editor" ||
      (node as Partial<CanvasTextNode>).fontSource === "ui"
        ? (node as Partial<CanvasTextNode>).fontSource
        : undefined;
    return {
      id,
      type: "text",
      x,
      y,
      width,
      height,
      text:
        typeof (node as Partial<CanvasTextNode>).text === "string"
          ? (node as Partial<CanvasTextNode>).text ?? ""
          : "",
      writingMode,
      fontSource,
      color,
      thenOrigin,
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
  fallbackScope: CanvasScope = "project",
): JsonCanvasDocument {
  const source = value && typeof value === "object" ? (value as Partial<JsonCanvasDocument>) : {};
  const nodes = Array.isArray(source.nodes)
    ? source.nodes.map(normalizeNode).filter((node): node is CanvasNode => Boolean(node))
    : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(source.edges)
    ? source.edges
        .map((edge) => normalizeEdge(edge, nodeIds))
        .filter((edge): edge is CanvasEdge => Boolean(edge))
    : [];

  const then = source.then && typeof source.then === "object" ? source.then : undefined;
  const now = Date.now();
  return {
    nodes,
    edges,
    then: {
      version: 1,
      name:
        typeof then?.name === "string" && then.name.trim()
          ? then.name
          : fallbackName,
      scope: then?.scope === "global" || then?.scope === "project" ? then.scope : fallbackScope,
      createdAt: isFiniteNumber(then?.createdAt) ? then.createdAt : now,
      updatedAt: isFiniteNumber(then?.updatedAt) ? then.updatedAt : now,
    },
  };
}

export function createIdeaOriginRef(
  boardScope: CanvasScope,
  boardId: string,
  nodeId: string,
  copiedAt = Date.now(),
): IdeaOriginRef {
  return {
    source: "canvas",
    sourceId: nodeId,
    sourceBoardId: boardId,
    sourceBoardScope: boardScope,
    copiedAt,
  };
}
