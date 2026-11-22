import type {
  CanvasNodeFontSource,
  CanvasScope,
  ReferenceFileInfo,
  ReferenceKind,
  WritingMode,
} from "./types";
import type { Post, PostWork } from "./posts/postModel";

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

/**
 * ノート・原稿を指すカード（JSON Canvas の file ノード、BINDER 4-2）。ファイルの場所だけを持ち、中身はボードに書かない。
 * ノートか原稿かも書かず、開くたびに作品のファイル一覧から決める。
 */
export type CanvasFileNode = {
  id: string;
  type: "file";
  x: number;
  y: number;
  width: number;
  height: number;
  /** 作品からの相対パス（`/` 区切り）。 */
  file: string;
  /** JSON Canvas の見出しへの飛び先。Then は使わないが、読んだものはそのまま書き戻す。 */
  subpath?: string;
  color?: string;
};

/**
 * 投稿を指すカード（Then 固有。BINDER 7章の1、docs/BINDER_POST_CARD_PLAN.md）。投稿の ID だけを持ち、本文・日時・作品は
 * ボードに書かない。開くたびにメイン画面の投稿の一覧から引く。投稿はライブラリで共有なので、ライブラリ直下のボードにも置ける。
 */
export type CanvasPostNode = {
  id: string;
  type: "post";
  x: number;
  y: number;
  width: number;
  height: number;
  /** 投稿の ID（`posts.jsonl` の `id`）。 */
  post: string;
  color?: string;
};

export type CanvasNode = CanvasTextNode | CanvasGroupNode | CanvasReferenceNode | CanvasFileNode | CanvasPostNode;

/**
 * Then が読めない種類のカード（Obsidian の link など）と、それにつながる線。画面には出さず、保存のときに
 * そのまま書き戻す（BINDER 4-2 の確認1の 4）。
 */
export type CanvasForeignItems = {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
};

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
  /** ファイルには書かない。保存の前に serializeCanvasDocument で nodes・edges へ戻す。 */
  foreign?: CanvasForeignItems;
};

/** 保存する形。Then が読めないカードと線を、読んだときのまま後ろに戻す。 */
export function serializeCanvasDocument(board: JsonCanvasDocument): {
  nodes: unknown[];
  edges: unknown[];
  then?: ThenCanvasMeta;
} {
  const { foreign, ...rest } = board;
  if (!foreign || (foreign.nodes.length === 0 && foreign.edges.length === 0)) return rest;
  const ids = new Set<unknown>([...rest.nodes.map((node) => node.id), ...foreign.nodes.map((node) => node.id)]);
  return {
    ...rest,
    nodes: [...rest.nodes, ...foreign.nodes],
    // 線の片方のカードを Then で消したら、その線も残さない。
    edges: [...rest.edges, ...foreign.edges.filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode))],
  };
}

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

/** 別ウィンドウのサイドパネル→キャンバスで、ノート・原稿（作品からの相対パス）を運ぶ MIME。 */
export const CANVAS_FILE_DRAG_MIME = "application/x-then-canvas-file";

/** 別ウィンドウのサイドパネル→キャンバスで、投稿の ID を運ぶ MIME。 */
export const CANVAS_POST_DRAG_MIME = "application/x-then-canvas-post";

/**
 * メイン画面 → 別ウィンドウキャンバスへ資料の最新一覧だけを届けるイベント。
 * then-canvas-payload と違いボードの再読込（選択・undo履歴のリセット）を起こさない。
 */
export const CANVAS_LIVE_DATA_EVENT = "then-canvas-live-data";

export type CanvasLiveDataEvent = {
  referenceFiles: ReferenceFileInfo[];
  /** 作品のノートと原稿（ファイルのカードの中身と、置く一覧に使う）。 */
  projectFiles?: CanvasProjectFile[];
  /** タブで開いているファイル（作品からの相対パス）。ノートのカードはそのあいだ表示だけ。 */
  openTabPaths?: string[];
  /** 「この順で原稿を作る」の作る先に選べるフォルダ（BINDER 4-4）。 */
  manuscriptFolders?: CanvasManuscriptFolders;
  /** 投稿の一覧と、いま開いている作品（投稿のカードと、置く一覧に使う）。 */
  posts?: CanvasPosts;
};

/** メイン画面が持つ投稿の一覧（ライブラリで共有）。work はいま開いている作品で、ライブラリ直下ではない。 */
export type CanvasPosts = { posts: Post[]; work?: PostWork };

/** 作品のノート・原稿の1つ。path は作品からの相対パス（`/` 区切り）。 */
export type CanvasProjectFile = { path: string; role: "note" | "manuscript" };

/**
 * メイン画面 → すべてのキャンバスへ、作品のファイルが保存されたことを知らせる（タブの保存、カードからの書き戻し）。
 * ファイルのカードは表示を新しくする。path は作品からの相対パス。
 */
export const CANVAS_FILE_SAVED_EVENT = "then-canvas-file-saved";

export type CanvasFileSavedEvent = {
  rootPath: string;
  path: string;
  content: string;
  contentHash: string | null;
};

/** キャンバスがカードで直した中身を、メイン画面に書いてもらう頼み（ファイルへ書くのはメイン画面だけ）。 */
export type CanvasFileWriteRequest = {
  rootPath: string;
  /** 作品からの相対パス。 */
  path: string;
  /** body: ノートの本文（フロントマターは base のまま残す）。synopsis: 原稿の概要。 */
  kind: "body" | "synopsis";
  text: string;
  /** キャンバスが読んだときのファイル。書く前に、ファイルがまだこの中身かをハッシュで確かめる。 */
  base: { content: string; contentHash: string | null };
};

export type CanvasFileWriteResult =
  | { status: "saved"; content: string; contentHash: string | null }
  /** 原稿がタブで開いていたので、そのタブのフロントマターへ入れた（ファイルへはタブの保存が書く）。 */
  | { status: "tab" }
  | { status: "unchanged" }
  /** ノートがタブで開いていたので書かなかった。 */
  | { status: "open-in-tab" }
  /** 読んだあとで外で変わっていた。書いていない。content はファイルの今の中身。 */
  | { status: "conflict"; content: string; contentHash: string | null };

/** キャンバスが投稿のカードで直した本文を、メイン画面に書いてもらう頼み（投稿へ書くのもメイン画面だけ）。 */
export type CanvasPostWriteRequest = {
  rootPath: string;
  id: string;
  text: string;
  /** キャンバスが読んだときの投稿の行のハッシュ。外で直されていれば書かない。 */
  baseHash: string;
};

export type CanvasPostWriteResult =
  | { status: "saved"; post: Post }
  | { status: "unchanged" }
  /** 読んだあとで外で直されていた。書いていない。post は今の投稿（消えていればない）。 */
  | { status: "conflict"; post?: Post };

export const CANVAS_POST_WRITE_EVENT = "then-canvas-post-write";
export type CanvasPostWriteEvent = { requestId: string; request: CanvasPostWriteRequest };
export const CANVAS_POST_WRITE_RESULT_EVENT = "then-canvas-post-write-result";
export type CanvasPostWriteResultEvent = { requestId: string; result?: CanvasPostWriteResult; error?: string };

/** 別ウィンドウのキャンバス → メイン画面へ、投稿のカードの「開く」（右のペインのその投稿へ）とノートの札。 */
export const CANVAS_OPEN_POST_EVENT = "then-canvas-open-post";
export type CanvasOpenPostEvent = { id: string; target: "post" | "note" };

/** 別ウィンドウのキャンバス → メイン画面。 */
export const CANVAS_FILE_WRITE_EVENT = "then-canvas-file-write";
export type CanvasFileWriteEvent = { requestId: string; request: CanvasFileWriteRequest };
/** メイン画面 → 別ウィンドウのキャンバス。error は書けなかった理由。 */
export const CANVAS_FILE_WRITE_RESULT_EVENT = "then-canvas-file-write-result";
export type CanvasFileWriteResultEvent = { requestId: string; result?: CanvasFileWriteResult; error?: string };

/**
 * 「この順で原稿を作る」（BINDER 4-4）。キャンバス → メイン画面の頼み。原稿を作り、書き、ゴミ箱へ移すのはメイン画面だけ。
 * パスは作品からの相対パス（`/` 区切り。作品の直下は ""）。
 */
export type CanvasManuscriptRequest =
  /** カード1枚を原稿1本に。conversionId は、あとで元に戻すときの目印。 */
  | { kind: "cards"; rootPath: string; folder: string; conversionId: string; cards: { id: string; name: string; text: string }[] }
  /** 一覧の順につないだ原稿を1本。 */
  | { kind: "joined"; rootPath: string; folder: string; name: string; boardName: string; cards: { id: string; title?: string; text: string }[] }
  /** Canvas で置き換えを戻した。作ったままの原稿をゴミ箱へ移してもらう。 */
  | { kind: "undo"; rootPath: string; conversionId: string };

export type CanvasManuscriptResult =
  /** made: 作れた原稿（カードの ID と原稿のパス）。failed: 作れなかったカードの ID。 */
  | { kind: "cards"; made: { id: string; path: string }[]; failed: string[] }
  | { kind: "joined"; path: string }
  /** done: 今回ゴミ箱へ移す処理をした（false なら、通知からすでに戻していた）。kept: 書き足してあったので残した数。 */
  | { kind: "undo"; done: boolean; trashed: number; kept: number };

/** 作る先に選べる原稿のフォルダと、その初期値（コルクボードと同じ決め方）。 */
export type CanvasManuscriptFolders = { folders: { path: string; label: string }[]; current: string };

/** 別ウィンドウのキャンバス → メイン画面。 */
export const CANVAS_MANUSCRIPT_EVENT = "then-canvas-manuscript";
export type CanvasManuscriptEvent = { requestId: string; request: CanvasManuscriptRequest };
/** メイン画面 → 別ウィンドウのキャンバス。error はできなかった理由。 */
export const CANVAS_MANUSCRIPT_RESULT_EVENT = "then-canvas-manuscript-result";
export type CanvasManuscriptResultEvent = { requestId: string; result?: CanvasManuscriptResult; error?: string };
/** メイン画面 → 別ウィンドウのキャンバス: 通知の「元に戻す」で、置き換えを外してもらう。 */
export const CANVAS_MANUSCRIPT_REVERT_EVENT = "then-canvas-manuscript-revert";
export type CanvasManuscriptRevertEvent = { requestId: string; conversionId: string };
export const CANVAS_MANUSCRIPT_REVERT_RESULT_EVENT = "then-canvas-manuscript-revert-result";
export type CanvasManuscriptRevertResultEvent = { requestId: string; reverted: boolean };

/**
 * 別ウィンドウのキャンバス → メイン画面: ボードを書けた。メイン画面は投稿の側の「置かれているボード」を読み直す
 * （docs/BINDER_POST_CARD_FOLLOWUPS_PLAN.md の 2-2。アイデアのペインから別ウィンドウへ投稿をドラッグすると、
 * メイン画面は窓の切り替えを経ないので、アプリに戻ったときの読み直しでは間に合わない）。
 */
export const CANVAS_BOARD_SAVED_EVENT = "then-canvas-board-saved";

/** 閉じる前に、別ウィンドウのキャンバスへ待っている保存を書き切ってもらう（BINDER 4-2 の確認1の 1）。 */
export const CANVAS_FLUSH_EVENT = "then-canvas-flush";
export const CANVAS_FLUSH_DONE_EVENT = "then-canvas-flush-done";
export type CanvasFlushEvent = { requestId: string };

/**
 * 「投稿にする」（BINDER 2-4、docs/BINDER_POST_CARD_FOLLOWUPS_PLAN.md）。キャンバス → メイン画面の頼み。投稿を書き、
 * 消すのはメイン画面だけ。書けたカードは、キャンバスがその投稿のカードに置き換える。
 */
export type CanvasCopyToPostRequest =
  /** カード1枚を投稿1件に。conversionId は、あとで元に戻すときの目印。text はタイトルを1行目に入れた本文。 */
  | { kind: "cards"; rootPath: string; conversionId: string; cards: { id: string; text: string }[] }
  /** Canvas で置き換えを戻した。作ったままの投稿を消してもらう。 */
  | { kind: "undo"; rootPath: string; conversionId: string };

export type CanvasCopyToPostResult =
  /** made: 書けた投稿（カードの ID と投稿の ID）。failed: 書けなかったカードの ID。 */
  | { kind: "cards"; made: { id: string; post: string }[]; failed: string[] }
  /** done: 今回消す処理をした（false なら、通知からすでに戻していた）。kept: 直してあったので残した数。 */
  | { kind: "undo"; done: boolean; deleted: number; kept: number };

/** 別ウィンドウのキャンバス → メイン画面。 */
export const CANVAS_COPY_TO_POST_EVENT = "then-canvas-copy-to-post";
export type CanvasCopyToPostEvent = { requestId: string; request: CanvasCopyToPostRequest };
/** メイン画面 → 別ウィンドウのキャンバス。error はできなかった理由。 */
export const CANVAS_COPY_TO_POST_RESULT_EVENT = "then-canvas-copy-to-post-result";
export type CanvasCopyToPostResultEvent = { requestId: string; result?: CanvasCopyToPostResult; error?: string };

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

/**
 * 作品を開くときの移行（BINDER 4-5）が、ボードのファイルを書き換えた知らせ。そのボードを開いている Canvas
 * （別ウィンドウ・埋め込み）は読み直す。ボードは ID（`.canvas` を除いたファイル名）。
 */
export const CANVAS_BOARDS_REWRITTEN_EVENT = "then-canvas-boards-rewritten";

export type CanvasBoardsRewrittenEvent = {
  rootPath: string;
  boardIds: string[];
};

function canvasReferenceKind(path: string): ReferenceKind {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  if (extension === "txt") return "text";
  if (extension === "md") return "markdown";
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") return "image";
  if (extension === "pdf") return "pdf";
  return "unknown";
}

function retargetCanvasPath(path: string, changes: CanvasPathChange[]) {
  const original = path.replace(/\\/g, "/");
  let next = original;
  for (const change of changes) {
    if (!change.oldPath || !change.newPath) continue;
    if (next === change.oldPath) next = change.newPath;
    else if (next.startsWith(`${change.oldPath}/`)) next = `${change.newPath}${next.slice(change.oldPath.length)}`;
  }
  return next === original ? path : next;
}

/**
 * ボードの作品の資料カードとファイルのカードを、改名・移動に合わせて付け替える（資料カードはパス・名前・種類、
 * ファイルのカードはパスだけ。フォルダなら中のものすべて）。
 * 同じ付け替えを2回しても結果は同じ。変わるカードがなければ null。
 */
export function retargetCanvasReferenceNodes(
  board: JsonCanvasDocument,
  changes: CanvasPathChange[],
): JsonCanvasDocument | null {
  let changed = false;
  const nodes = board.nodes.map((node) => {
    if (node.type === "file") {
      const file = retargetCanvasPath(node.file, changes);
      if (file === node.file) return node;
      changed = true;
      return { ...node, file };
    }
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
  projectFiles?: CanvasProjectFile[];
  manuscriptFolders?: CanvasManuscriptFolders;
  openTabPaths?: string[];
  posts?: CanvasPosts;
  /** メイン画面の右サイドバー表示状態。別ウィンドウのサイドパネルへ引き継ぐ。 */
  rightSidebarVisible?: boolean;
  /** ライブラリ直下のボードか（ゴミ箱の画面の見出しに使う。K5）。 */
  isLibraryRoot?: boolean;
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

export function createCanvasFileNode(
  file: string,
  options: Partial<Omit<CanvasFileNode, "id" | "type" | "file">> = {},
): CanvasFileNode {
  return {
    id: nextCanvasId("file"),
    type: "file",
    x: options.x ?? 140,
    y: options.y ?? 140,
    width: options.width ?? 300,
    height: options.height ?? 240,
    file,
    color: options.color,
  };
}

export function createCanvasPostNode(
  post: string,
  options: Partial<Omit<CanvasPostNode, "id" | "type" | "post">> = {},
): CanvasPostNode {
  return {
    id: nextCanvasId("post"),
    type: "post",
    x: options.x ?? 140,
    y: options.y ?? 140,
    width: options.width ?? 280,
    height: options.height ?? 180,
    post,
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

  if (node.type === "file") {
    const fileNode = node as Partial<CanvasFileNode>;
    if (typeof fileNode.file !== "string" || !fileNode.file.trim()) return null;
    return {
      id,
      type: "file",
      x,
      y,
      width,
      height,
      file: fileNode.file.replace(/\\/g, "/"),
      subpath: typeof fileNode.subpath === "string" ? fileNode.subpath : undefined,
      color,
    };
  }

  if (node.type === "post") {
    // post の欄が読めないカードは isForeignNode が知らない種類として取っておくので、ここには来ない。
    return { id, type: "post", x, y, width, height, post: (node as CanvasPostNode).post, color };
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

const KNOWN_NODE_TYPES = new Set(["text", "group", "reference", "file", "post"]);

/**
 * id と種類があり、その種類を Then が知らないカード。投稿のカードで、指す投稿の ID が読めないものも
 * ここに入れ、画面には出さずにそのまま書き戻す（落とさない）。
 */
function isForeignNode(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const node = value as { id?: unknown; type?: unknown; post?: unknown };
  if (typeof node.id !== "string" || node.id === "" || typeof node.type !== "string") return false;
  if (node.type === "post") return typeof node.post !== "string" || !node.post.trim();
  return !KNOWN_NODE_TYPES.has(node.type);
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
  // Then が読めない種類のカードは、捨てずに取っておく（保存で書き戻す）。
  const foreignNodes = Array.isArray(source.nodes) ? source.nodes.filter(isForeignNode) : [];
  const nodes = Array.isArray(source.nodes)
    ? source.nodes
        .filter((node) => !isForeignNode(node))
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
  const nodeIds = new Set<unknown>(sanitizedNodes.map((node) => node.id));
  const foreignIds = new Set<unknown>(foreignNodes.map((node) => node.id));
  // 読めないカードにつながる線も、両端があれば取っておく。
  const isForeignEdge = (edge: unknown): edge is Record<string, unknown> => {
    if (!edge || typeof edge !== "object") return false;
    const { fromNode, toNode } = edge as { fromNode?: unknown; toNode?: unknown };
    return (foreignIds.has(fromNode) || foreignIds.has(toNode)) &&
      (foreignIds.has(fromNode) || nodeIds.has(fromNode)) &&
      (foreignIds.has(toNode) || nodeIds.has(toNode));
  };
  const foreignEdges = Array.isArray(source.edges) ? source.edges.filter(isForeignEdge) : [];
  const edges = Array.isArray(source.edges)
    ? source.edges
        .filter((edge) => !isForeignEdge(edge))
        .map((edge) => normalizeEdge(edge, nodeIds as Set<string>))
        .filter((edge): edge is CanvasEdge => Boolean(edge))
    : [];

  const then = source.then && typeof source.then === "object" ? source.then : undefined;
  const now = Date.now();
  return {
    nodes: sanitizedNodes,
    edges,
    ...(foreignNodes.length > 0 ? { foreign: { nodes: foreignNodes, edges: foreignEdges } } : {}),
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
