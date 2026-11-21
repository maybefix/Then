/**
 * 「この順で原稿を作る」（BINDER 4-4、docs/BINDER_CANVAS_TO_MANUSCRIPT_PLAN.md）の、ボードの側の処理。
 * 選んだカードの取り出しと並べ方（中間稿の captureDraft を流用）、カードの名前、カードとファイルのカードの
 * 置き換えと、その取り消し。YAML は読まない（原稿の中身は canvasManuscriptContent.ts）。
 */
import type {
  CanvasFileNode,
  CanvasGroupNode,
  CanvasNode,
  CanvasTextNode,
  JsonCanvasDocument,
} from "./canvasTypes";
import { captureDraft, type DraftCapture } from "./intermediateDraft";
import { noteNameFromBody } from "./posts/postModel";

const isText = (node: CanvasNode): node is CanvasTextNode => node.type === "text";
const isGroup = (node: CanvasNode): node is CanvasGroupNode => node.type === "group";

function insideGroup(node: CanvasNode, group: CanvasGroupNode) {
  const x = node.x + node.width / 2;
  const y = node.y + node.height / 2;
  return x >= group.x && x <= group.x + group.width && y >= group.y && y <= group.y + group.height;
}

/** 選んだテキストカードと、選んだグループの中のテキストカード（重ねない）。ファイル・資料のカードは入れない。 */
export function manuscriptSourceCards(board: JsonCanvasDocument, selectedIds: Iterable<string>): CanvasTextNode[] {
  const selected = new Set(selectedIds);
  const nodes = board.nodes.filter((node) => selected.has(node.id));
  const groups = nodes.filter(isGroup);
  const picked = new Map<string, CanvasTextNode>();
  for (const node of board.nodes) {
    if (!isText(node)) continue;
    if (selected.has(node.id) || groups.some((group) => insideGroup(node, group))) picked.set(node.id, node);
  }
  return [...picked.values()];
}

/** カードから作る原稿の名前。タイトルがあればそれ、なければ書き出しの1行（20文字）。どちらもなければ ""。 */
export function cardManuscriptName(card: Pick<CanvasTextNode, "title" | "text">): string {
  const title = (card.title ?? "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return title || noteNameFromBody(card.text);
}

/** 選んだカードの初期の並び（矢印 → 上・左）。名前を付けられない空のカードは、最初から除外にする。 */
export function captureManuscriptCards(board: JsonCanvasDocument, cards: CanvasTextNode[]): DraftCapture {
  const capture = captureDraft({ ...board, nodes: cards });
  return { ...capture, excluded: cards.filter((card) => !cardManuscriptName(card)).map((card) => card.id) };
}

/** 一覧の順で、除外していないカード。 */
export function orderedManuscriptCards(capture: DraftCapture, cards: CanvasTextNode[]): CanvasTextNode[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const excluded = new Set(capture.excluded ?? []);
  return capture.order.filter((id) => !excluded.has(id)).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** 「カードごと」で置き換えた1回分。元に戻すときに使う。 */
export type CardConversion = {
  id: string;
  boardId: string;
  /** 置き換えたカードの元の姿と、置き換え先の原稿（作品からの相対パス）。 */
  cards: { original: CanvasTextNode; file: string }[];
  /** 置き換えたカードの下にあったスレッドの子（その場に残してスレッドから外した）。 */
  detached: { id: string; threadParentId: string; threadOrder?: number }[];
};

/**
 * カードを、作った原稿を指すファイルのカードに置き換える。ID・位置・大きさ・色はそのまま（線も残る）。
 * 置き換えたカードを親にしていたスレッドの子は、その場に残してスレッドから外す（4-4 の確認1の 4、癖1）。
 */
export function convertCardsToFiles(
  board: JsonCanvasDocument,
  made: { id: string; file: string }[],
): { board: JsonCanvasDocument; cards: CardConversion["cards"]; detached: CardConversion["detached"] } {
  const files = new Map(made.map((item) => [item.id, item.file]));
  const cards: CardConversion["cards"] = [];
  const detached: CardConversion["detached"] = [];
  const nodes = board.nodes.map((node): CanvasNode => {
    if (!isText(node)) return node;
    const file = files.get(node.id);
    if (file !== undefined) {
      cards.push({ original: node, file });
      const next: CanvasFileNode = {
        id: node.id, type: "file", x: node.x, y: node.y, width: node.width, height: node.height, file,
      };
      if (node.color) next.color = node.color;
      return next;
    }
    if (node.threadParentId && files.has(node.threadParentId)) {
      detached.push({ id: node.id, threadParentId: node.threadParentId, threadOrder: node.threadOrder });
      const { threadParentId: _parent, threadOrder: _order, ...rest } = node;
      return rest;
    }
    return node;
  });
  return { board: cards.length ? { ...board, nodes } : board, cards, detached };
}

/**
 * 置き換えを外す。ファイルのカードのうち、ID と指す原稿が置き換えたときのままのものだけを元のテキストカードに戻す
 * （位置・大きさ・色は今のカードのもの）。外したスレッドの子は、まだスレッドの外にいて、親がテキストに戻ったら付け直す。
 * 変わるところがなければ、同じボードを返す。
 */
export function revertCardConversion(board: JsonCanvasDocument, conversion: CardConversion): JsonCanvasDocument {
  const originals = new Map(conversion.cards.map((card) => [card.original.id, card]));
  const restored = new Set<string>();
  let changed = false;
  const nodes = board.nodes.map((node): CanvasNode => {
    const card = originals.get(node.id);
    if (!card || node.type !== "file" || node.file !== card.file) return node;
    changed = true;
    restored.add(node.id);
    const next: CanvasTextNode = { ...card.original, x: node.x, y: node.y, width: node.width, height: node.height };
    if (node.color) next.color = node.color;
    else delete next.color;
    return next;
  });
  const children = new Map(conversion.detached.map((child) => [child.id, child]));
  const relinked = nodes.map((node): CanvasNode => {
    const child = children.get(node.id);
    if (!child || !isText(node) || node.threadParentId || !restored.has(child.threadParentId)) return node;
    changed = true;
    const next: CanvasTextNode = { ...node, threadParentId: child.threadParentId };
    if (child.threadOrder !== undefined) next.threadOrder = child.threadOrder;
    return next;
  });
  return changed ? { ...board, nodes: relinked } : board;
}

/** 履歴の1段を戻したとき、その段が置き換えをまたいだか（今はファイルのカード、戻した先は元のテキストカード）。 */
export function crossesConversion(
  current: JsonCanvasDocument,
  previous: JsonCanvasDocument,
  conversion: CardConversion,
): boolean {
  return conversion.cards.some(({ original, file }) => {
    const now = current.nodes.find((node) => node.id === original.id);
    const before = previous.nodes.find((node) => node.id === original.id);
    return now?.type === "file" && now.file === file && before?.type === "text";
  });
}
