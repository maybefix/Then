import {
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type Dispatch,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import type { PlotCard, ReferenceFileInfo } from "../../types";
import { getScaledFixedMenuPosition } from "../../utils/contextMenuPosition";
import {
  appendPlotChapter,
  appendPlotSection,
  createPlotChapter,
  createPlotSection,
  insertPlotCard,
  plotChapterGroupEnd,
  renumberPlotCards,
} from "./plotCardUtils";

// Portal target for plot dialogs. PlotPane lives inside the right sidebar, which
// is scaled by the UI zoom (--ui-font-scale); rendering a modal there would
// double-zoom it and clip it to the sidebar. Mount at the .appShell root instead
// so it inherits the theme + scale variables but escapes the chrome zoom.
const modalRoot = (): HTMLElement =>
  (document.querySelector(".appShell") as HTMLElement | null) ?? document.body;

type PlotIconName = "list" | "bookmark" | "expandAll" | "collapseAll";

/** 論理順（配列順）での差し込み位置。画面上は before = 右側、after = 左側。 */
type PlotDropTarget = { anchorId: string; position: "before" | "after" };

export type PlotNotify = (message: string, action?: { label: string; onClick: () => void }) => void;

/** 管理画面のヘッダーから「すべて展開/折りたたむ」を頼むためのリクエスト。 */
type PlotBulkRequest = { nonce: number; expand: boolean };

type PlotMenuItem = { label: string; onSelect: () => void; danger?: boolean };

type PlotReferenceSuggestionState = {
  cardId: string;
  query: string;
  from: number;
  to: number;
  x: number;
  y: number;
  selectedIndex: number;
};

const PLOT_CONTEXT_MENU_WIDTH = 220;
const PLOT_CONTEXT_MENU_ITEM_HEIGHT = 30;
const PLOT_CONTEXT_MENU_DIVIDER_HEIGHT = 9;
const PLOT_DRAG_THRESHOLD = 4;
const PLOT_DRAG_EDGE = 36;
const PLOT_DRAG_EDGE_SPEED = 14;
const PLOT_REFERENCE_SUGGEST_MENU_WIDTH = 136;
const PLOT_REFERENCE_SUGGEST_MENU_HEIGHT = 340;
const PLOT_REFERENCE_LABEL_MAX_LENGTH = 18;
const PLOT_REFERENCE_LINK_PATTERN = /@\[\[([^\]]+)\]\]/g;

const referenceKey = (sourcePath: string) => sourcePath.replace(/\\/g, "/").toLocaleLowerCase();

const plotReferenceLabelFromPath = (sourcePath: string) =>
  sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;

const truncatePlotReferenceLabel = (label: string, maxLength = PLOT_REFERENCE_LABEL_MAX_LENGTH) => {
  const chars = Array.from(label);
  if (chars.length <= maxLength) return label;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const displayPlotReferenceLinks = (
  text: string,
  referenceByPath: Map<string, ReferenceFileInfo>,
) =>
  text.replace(PLOT_REFERENCE_LINK_PATTERN, (_match, sourcePath: string) => {
    const file = referenceByPath.get(referenceKey(sourcePath));
    return `@${file?.name ?? plotReferenceLabelFromPath(sourcePath)}`;
  });

const plotReferencePathHint = (sourcePath: string) => {
  const parts = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return sourcePath;
  return parts[parts.length - 2] ?? sourcePath;
};

const renderHighlightedReferenceText = (text: string, query: string): ReactNode => {
  const needle = query.trim();
  if (!needle) return text;

  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
};

const hydratePlotReferenceLinks = (text: string, referenceCandidates: ReferenceFileInfo[]) => {
  let hydrated = text;
  const byLongestName = [...referenceCandidates].sort(
    (left, right) => countTextUnits(right.name) - countTextUnits(left.name),
  );

  for (const file of byLongestName) {
    if (!file.name.trim()) continue;
    hydrated = hydrated.replace(
      new RegExp(`@${escapeRegExp(file.name)}`, "g"),
      `@[[${file.sourcePath.replace(/\\/g, "/")}]]`,
    );
  }
  return hydrated;
};

const getPlotReferenceMention = (text: string, cursor: number) => {
  const beforeCursor = text.slice(0, cursor);
  const match = beforeCursor.match(/(^|[\s　])@([^\s　@\[\]]*)$/);
  if (!match) return null;

  const prefixLength = match[1].length;
  return {
    query: match[2],
    from: cursor - match[0].length + prefixLength,
    to: cursor,
  };
};

const countTextUnits = (text: string) => Array.from(text).length;

/** プレビュー上のクリック位置を、編集用の下書き文字列でのオフセットに直す。
 *  参照リンクはプレビューでは短縮表示なので、下書きでの表記（data-plot-draft-text）で数える。 */
const previewCaretOffsetFromPoint = (preview: HTMLElement, x: number, y: number): number | null => {
  let node: Node | null = null;
  let offset = 0;
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(x, y);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  } else if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  if (!node || !preview.contains(node)) return null;

  const draftLength = (child: ChildNode) =>
    (child instanceof HTMLElement ? child.dataset.plotDraftText ?? "" : child.textContent ?? "")
      .length;
  const children = Array.from(preview.childNodes);
  // プレビュー要素自体に当たったときの offset は子ノードの番号。
  if (node === preview) {
    return children.slice(0, offset).reduce((total, child) => total + draftLength(child), 0);
  }

  let total = 0;
  for (const child of children) {
    if (child === node) return total + offset;
    if (child.contains(node)) return total + draftLength(child);
    total += draftLength(child);
  }
  return null;
};

const getPlotContextMenuStyle = (
  x: number,
  y: number,
  itemCount: number,
  dividerCount: number,
): CSSProperties => {
  return getScaledFixedMenuPosition(x, y, {
    width: PLOT_CONTEXT_MENU_WIDTH,
    height:
      itemCount * PLOT_CONTEXT_MENU_ITEM_HEIGHT +
      dividerCount * PLOT_CONTEXT_MENU_DIVIDER_HEIGHT +
      12,
  });
};

const isPlotCardExpandedIn = (card: PlotCard, managerMode: boolean) =>
  managerMode ? !card.managerCollapsed : card.expanded;

const withPlotCardExpanded = (card: PlotCard, expanded: boolean, managerMode: boolean): PlotCard =>
  managerMode ? { ...card, managerCollapsed: !expanded } : { ...card, expanded };

/** ドラッグしたカード（章なら配下セクションごと）を差し込み位置へ移す。論理順で計算する。 */
const movePlotCards = (
  cards: PlotCard[],
  draggedId: string,
  drop: PlotDropTarget,
  managerMode: boolean,
) => {
  const draggedIndex = cards.findIndex((card) => card.id === draggedId);
  if (draggedIndex < 0) return cards;
  const dragged = cards[draggedIndex];
  const blockEnd =
    dragged.kind === "chapter" ? plotChapterGroupEnd(cards, draggedIndex) : draggedIndex + 1;
  const block = cards.slice(draggedIndex, blockEnd);
  if (block.some((card) => card.id === drop.anchorId)) return cards;

  const rest = [...cards.slice(0, draggedIndex), ...cards.slice(blockEnd)];
  const anchorIndex = rest.findIndex((card) => card.id === drop.anchorId);
  if (anchorIndex < 0) return cards;
  const anchor = rest[anchorIndex];

  let insertAt = drop.position === "before" ? anchorIndex : anchorIndex + 1;
  // 折りたたんだ章の「後ろ」は、帯が代表している配下セクション群の後ろ。
  if (
    drop.position === "after" &&
    anchor.kind === "chapter" &&
    !isPlotCardExpandedIn(anchor, managerMode)
  ) {
    insertAt = plotChapterGroupEnd(rest, anchorIndex);
  }

  const next = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  return next.every((card, index) => card.id === cards[index].id) ? cards : renumberPlotCards(next);
};

const plotCardPlainText = (card: PlotCard, referenceByPath: Map<string, ReferenceFileInfo>) =>
  [card.title.trim(), displayPlotReferenceLinks(card.body, referenceByPath).trim()]
    .filter(Boolean)
    .join("\n");

/** 章ごとに [章カード, ...配下のセクション] をまとめたグループ列を返す。
 *  先頭の章ラベルが付く前のセクション群は chapter=null の「冒頭」グループになる。 */
type PlotChapterGroup = { chapter: PlotCard | null; sections: PlotCard[] };

const groupByChapter = (cards: PlotCard[]): PlotChapterGroup[] => {
  const groups: PlotChapterGroup[] = [];
  let current: PlotChapterGroup = { chapter: null, sections: [] };
  let hasCurrent = false;

  for (const card of cards) {
    if (card.kind === "chapter") {
      if (hasCurrent || current.sections.length > 0) groups.push(current);
      current = { chapter: card, sections: [] };
      hasCurrent = true;
    } else {
      current.sections.push(card);
    }
  }
  if (hasCurrent || current.sections.length > 0) groups.push(current);

  return groups;
};

function PlotIcon({ name }: { name: PlotIconName }) {
  const common = {
    "aria-hidden": true,
    focusable: false,
    viewBox: "0 0 24 24",
  };

  switch (name) {
    case "expandAll":
      return (
        <svg {...common}>
          <path d="M9 6l-6 6 6 6" />
          <path d="M15 6l6 6-6 6" />
        </svg>
      );
    case "collapseAll":
      return (
        <svg {...common}>
          <path d="M3 6l6 6-6 6" />
          <path d="M21 6l-6 6 6 6" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case "bookmark":
      return (
        <svg {...common}>
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
        </svg>
      );
  }
}

type PlotBoardProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
  referenceCandidates?: ReferenceFileInfo[];
  onOpenReference?: (sourcePath: string, fileInfo: ReferenceFileInfo) => void;
  onMissingReference?: () => void;
  /** 管理画面モード: 折りたたみ状態を保存データではなくローカルに持ち、初期は全展開。 */
  managerMode?: boolean;
  className?: string;
  /** ライブラリ内のとき、カードをライブラリ・作品へ送るメニュー項目。 */
  transfer?: PlotCardTransfer;
  /** 削除の取り消しやコピー完了を伝えるトースト。 */
  onNotify?: PlotNotify;
  bulkRequest?: PlotBulkRequest | null;
  /** 管理画面の背後にあるボードなど、フォーカスを奪ってはいけないとき true。 */
  inactive?: boolean;
};

export type PlotCardTransfer = { label: string; onTransfer: (cardId: string) => void };

function PlotBoard({
  cards,
  onCardsChange,
  referenceCandidates = [],
  onOpenReference,
  onMissingReference,
  managerMode = false,
  className,
  transfer,
  onNotify,
  bulkRequest,
  inactive = false,
}: PlotBoardProps) {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PlotDropTarget | null>(null);
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const [editingBodyCardId, setEditingBodyCardId] = useState<string | null>(null);
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [referenceSuggestion, setReferenceSuggestion] =
    useState<PlotReferenceSuggestionState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ cardId: string; x: number; y: number } | null>(
    null,
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  /** 番号バッジ／章マークを押した直後。しきい値を超えて動いたらドラッグに昇格する。 */
  const pendingDragRef = useRef<{ cardId: string; x: number; y: number } | null>(null);
  const suppressToggleClickRef = useRef(false);
  const dropTargetRef = useRef<PlotDropTarget | null>(null);
  const prevCardIdsRef = useRef<Set<string> | null>(null);
  const revealCardIdRef = useRef<string | null>(null);
  const keepInPlaceRef = useRef<{ cardId: string; right: number } | null>(null);

  // セクションは本文表示、章は配下セクションの表示可否を表す共通の「展開」状態。
  // 管理画面は card.managerCollapsed（右サイドバーの expanded とは独立・保存対象）を見る。
  const isCardExpanded = useCallback(
    (card: PlotCard) => (managerMode ? !card.managerCollapsed : card.expanded),
    [managerMode],
  );

  const referenceByPath = useMemo(
    () => new Map(referenceCandidates.map((file) => [referenceKey(file.sourcePath), file])),
    [referenceCandidates],
  );

  const getBodyDraft = useCallback(
    (card: PlotCard) =>
      bodyDrafts[card.id] ?? displayPlotReferenceLinks(card.body, referenceByPath),
    [bodyDrafts, referenceByPath],
  );

  const bodyRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setBodyRef = useCallback(
    (cardId: string) => (element: HTMLElement | null) => {
      if (element) bodyRefs.current.set(cardId, element);
      else bodyRefs.current.delete(cardId);
    },
    [],
  );
  /** プレビューをクリックして編集に入るとき、キャレットを置く下書き上の位置。 */
  const pendingCaretRef = useRef<number | null>(null);

  const filteredReferenceSuggestions = useMemo(() => {
    if (!referenceSuggestion) return [];
    const query = referenceSuggestion.query.trim().toLocaleLowerCase();
    return referenceCandidates
      .filter((file) => {
        if (!query) return true;
        return `${file.name}\n${file.sourcePath}`.toLocaleLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [referenceCandidates, referenceSuggestion]);

  // 章ごとのセクション数と、折りたたまれた章の配下セクション（描画しない）を求める。
  const sectionCountByChapter = new Map<string, number>();
  const hiddenSectionIds = new Set<string>();
  {
    let currentChapter: PlotCard | null = null;
    for (const card of cards) {
      if (card.kind === "chapter") {
        currentChapter = card;
        sectionCountByChapter.set(card.id, 0);
      } else if (currentChapter) {
        sectionCountByChapter.set(
          currentChapter.id,
          (sectionCountByChapter.get(currentChapter.id) ?? 0) + 1,
        );
        if (!isCardExpanded(currentChapter)) hiddenSectionIds.add(card.id);
      }
    }
  }

  /** ポインタ位置から差し込み位置を求める。章のドラッグは章の区切りにだけ落とせる。 */
  const resolveDropTarget = useCallback(
    (draggedId: string, clientX: number, clientY: number): PlotDropTarget | null => {
      const pane = paneRef.current;
      const element = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-plot-card-id]");
      if (!pane || !element || !pane.contains(element)) return null;
      const anchorId = element.dataset.plotCardId;
      if (!anchorId) return null;

      const rect = element.getBoundingClientRect();
      // 縦書きの並びは右から左。カードの右半分なら論理的に「前」。
      const position = clientX > rect.left + rect.width / 2 ? "before" : "after";

      const dragged = cards.find((card) => card.id === draggedId);
      if (!dragged) return null;
      if (dragged.kind === "section") {
        return anchorId === draggedId ? null : { anchorId, position };
      }

      // 章: ポインタ下のカードが属する章グループの前後に丸める。
      const anchorIndex = cards.findIndex((card) => card.id === anchorId);
      let groupStart = anchorIndex;
      while (groupStart >= 0 && cards[groupStart].kind !== "chapter") groupStart -= 1;
      if (groupStart >= 0 && cards[groupStart].id === draggedId) return null;
      const groupEnd = groupStart >= 0 ? plotChapterGroupEnd(cards, groupStart) : plotChapterGroupEnd(cards, -1);
      // 冒頭グループ（章なし）の前に章を置くと冒頭が章に吸収されるので、常にその後ろへ。
      if (groupStart < 0 || position === "after") {
        const lastVisible =
          groupStart >= 0 && !isCardExpanded(cards[groupStart])
            ? cards[groupStart]
            : cards[groupEnd - 1];
        if (!lastVisible || lastVisible.id === draggedId) return null;
        return { anchorId: lastVisible.id, position: "after" };
      }
      return { anchorId: cards[groupStart].id, position: "before" };
    },
    [cards, isCardExpanded],
  );

  const commitDrop = useCallback(
    (draggedId: string, drop: PlotDropTarget) => {
      onCardsChange((current) => movePlotCards(current, draggedId, drop, managerMode));
    },
    [managerMode, onCardsChange],
  );

  // 追加・挿入・複製で 1 枚だけ増えたら、そのカードを見える位置に出してタイトルへフォーカスする。
  useLayoutEffect(() => {
    const previous = prevCardIdsRef.current;
    prevCardIdsRef.current = new Set(cards.map((card) => card.id));
    if (!previous) return;
    const added = cards.filter((card) => !previous.has(card.id));
    const removedAny = [...previous].some((id) => !prevCardIdsRef.current?.has(id));
    if (added.length === 1 && !removedAny) revealCardIdRef.current = added[0].id;
  }, [cards]);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    const keep = keepInPlaceRef.current;
    if (keep) {
      keepInPlaceRef.current = null;
      const right = anchorScreenRight(keep.cardId);
      if (right !== null) pane.scrollLeft += right - keep.right;
    }

    const revealId = revealCardIdRef.current;
    if (revealId) {
      revealCardIdRef.current = null;
      const element = pane.querySelector<HTMLElement>(
        `[data-plot-card-id="${CSS.escape(revealId)}"]`,
      );
      if (element) {
        const paneRect = pane.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const margin = 16;
        if (rect.left < paneRect.left + margin) {
          pane.scrollLeft -= paneRect.left + margin - rect.left;
        } else if (rect.right > paneRect.right - margin) {
          pane.scrollLeft += rect.right - (paneRect.right - margin);
        }
        if (!inactive) {
          element
            .querySelector<HTMLTextAreaElement>(".plotCardTitle, .plotChapterTitle")
            ?.focus({ preventScroll: true });
        }
      }
    }
    // 縦書きのスクロール起点は右端なので、左へ伸びる分には何もしなくても視点は動かない。
  }, [cards, inactive]);

  useLayoutEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const handleKeyDown = (event: WindowEventMap["keydown"]) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!referenceSuggestion) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".plotReferenceSuggestMenu")) return;
      setReferenceSuggestion(null);
    };
    const handleKeyDown = (event: WindowEventMap["keydown"]) => {
      if (event.key === "Escape") setReferenceSuggestion(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [referenceSuggestion]);

  useLayoutEffect(() => {
    if (!editingBodyCardId) return;
    const element = bodyRefs.current.get(editingBodyCardId);
    if (!(element instanceof HTMLTextAreaElement)) return;
    if (document.activeElement === element) return;
    element.focus({ preventScroll: true });
    const cursor = Math.min(pendingCaretRef.current ?? element.value.length, element.value.length);
    pendingCaretRef.current = null;
    element.setSelectionRange(cursor, cursor);
  }, [editingBodyCardId]);

  // ドラッグ中は差し込み位置の線だけを動かし、離したときに一度だけ並べ替える。
  // ペインの端に近づいたら自動で横スクロールする。
  useLayoutEffect(() => {
    if (!draggingCardId) return;
    const pane = paneRef.current;
    let pointer: { x: number; y: number } | null = null;
    let frameId = 0;

    const updateDrop = () => {
      if (!pointer) return;
      const next = resolveDropTarget(draggingCardId, pointer.x, pointer.y);
      const current = dropTargetRef.current;
      if (next?.anchorId === current?.anchorId && next?.position === current?.position) return;
      dropTargetRef.current = next;
      setDropTarget(next);
    };

    const autoScroll = () => {
      frameId = requestAnimationFrame(autoScroll);
      if (!pane || !pointer) return;
      const rect = pane.getBoundingClientRect();
      let delta = 0;
      if (pointer.x < rect.left + PLOT_DRAG_EDGE) delta = -PLOT_DRAG_EDGE_SPEED;
      else if (pointer.x > rect.right - PLOT_DRAG_EDGE) delta = PLOT_DRAG_EDGE_SPEED;
      if (!delta) return;
      const before = pane.scrollLeft;
      pane.scrollLeft = before + delta;
      if (pane.scrollLeft !== before) updateDrop();
    };
    frameId = requestAnimationFrame(autoScroll);

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      pointer = { x: event.clientX, y: event.clientY };
      updateDrop();
    };

    const finish = (commit: boolean) => {
      const drop = dropTargetRef.current;
      dropTargetRef.current = null;
      setDropTarget(null);
      setDraggingCardId(null);
      // ボタン外で離すと click が来ないので、抑止フラグはこのイベント処理の後で戻す。
      window.setTimeout(() => {
        suppressToggleClickRef.current = false;
      }, 0);
      if (commit && drop) commitDrop(draggingCardId, drop);
    };
    const handlePointerUp = () => finish(true);
    const handlePointerCancel = () => finish(false);
    const handleKeyDown = (event: WindowEventMap["keydown"]) => {
      if (event.key === "Escape") finish(false);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [commitDrop, draggingCardId, resolveDropTarget]);

  const handleCardPointerDown = (cardId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // テキスト選択とフォーカス移動を起こさない（click は引き続き届く）。
    event.preventDefault();
    pendingDragRef.current = { cardId, x: event.clientX, y: event.clientY };

    const handleMove = (moveEvent: PointerEvent) => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      if (
        Math.hypot(moveEvent.clientX - pending.x, moveEvent.clientY - pending.y) <
        PLOT_DRAG_THRESHOLD
      ) {
        return;
      }
      pendingDragRef.current = null;
      suppressToggleClickRef.current = true;
      setReferenceSuggestion(null);
      setDraggingCardId(pending.cardId);
      cleanup();
    };
    const handleUp = () => {
      pendingDragRef.current = null;
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  /** ドラッグの直後に飛んでくる click では開閉しない。 */
  const handleToggleClick = (cardId: string) => {
    if (suppressToggleClickRef.current) {
      suppressToggleClickRef.current = false;
      return;
    }
    toggleCard(cardId);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const pane = event.currentTarget;
    if (pane.scrollWidth <= pane.clientWidth) return;

    const dominantDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    if (dominantDelta === 0) return;

    event.preventDefault();
    // 縦書きのペインは右端が 0 で左へ負。下へ回すと読み進める（左へ送る）。範囲外はブラウザが丸める。
    pane.scrollLeft -= dominantDelta;
  };

  /** カードの柱（番号バッジ／章マーク）の画面位置。再レイアウト後に同じ位置へ戻すための基準。 */
  const anchorScreenRight = (cardId: string): number | null => {
    const pane = paneRef.current;
    const anchorEl = pane?.querySelector<HTMLElement>(
      `[data-plot-card-id="${CSS.escape(cardId)}"] :is(.plotCardNum, .plotChapterMark)`,
    );
    if (!pane || !anchorEl) return null;
    return anchorEl.getBoundingClientRect().right - pane.getBoundingClientRect().left;
  };

  /** 開閉で幅が変わっても、指定カードの柱の見た目位置を据え置く。
   *  ここで位置を控え、描画後のレイアウトエフェクトで一度だけ合わせ直す。 */
  const keepCardInPlace = (cardId: string) => {
    const right = anchorScreenRight(cardId);
    keepInPlaceRef.current = right === null ? null : { cardId, right };
  };

  /** 画面内でいちばん右（読み順で最初）に見えているカード。一括開閉の基準にする。 */
  const firstVisibleCardId = (): string | null => {
    const pane = paneRef.current;
    if (!pane) return null;
    const paneRect = pane.getBoundingClientRect();
    const elements = Array.from(pane.querySelectorAll<HTMLElement>("[data-plot-card-id]"));
    const visible = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > paneRect.left && rect.left < paneRect.right;
    });
    return visible?.dataset.plotCardId ?? null;
  };

  const toggleCard = (cardId: string) => {
    keepCardInPlace(cardId);
    onCardsChange((current) =>
      current.map((card) =>
        card.id === cardId
          ? withPlotCardExpanded(card, !isPlotCardExpandedIn(card, managerMode), managerMode)
          : card,
      ),
    );
  };

  /** すべて（chapterId 指定時はその章の配下だけ）を展開／折りたたむ。
   *  展開は章も開く。折りたたみはセクションだけ畳み、章の帯は目次として残す。 */
  const setAllExpanded = (expand: boolean, chapterId?: string) => {
    const anchorId = chapterId ?? firstVisibleCardId();
    if (anchorId) keepCardInPlace(anchorId);
    onCardsChange((current) => {
      let inScope = chapterId === undefined;
      return current.map((card) => {
        if (chapterId !== undefined && card.kind === "chapter") {
          inScope = card.id === chapterId;
          return inScope && expand ? withPlotCardExpanded(card, true, managerMode) : card;
        }
        if (!inScope) return card;
        if (card.kind === "chapter") return expand ? withPlotCardExpanded(card, true, managerMode) : card;
        return withPlotCardExpanded(card, expand, managerMode);
      });
    });
  };

  const lastBulkNonceRef = useRef(bulkRequest?.nonce);
  useLayoutEffect(() => {
    if (!bulkRequest || bulkRequest.nonce === lastBulkNonceRef.current) return;
    lastBulkNonceRef.current = bulkRequest.nonce;
    setAllExpanded(bulkRequest.expand);
    // setAllExpanded は描画ごとに作り直されるが、リクエスト 1 件につき 1 回だけ動かす。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkRequest]);

  const updateCard = (cardId: string, patch: Partial<Pick<PlotCard, "title" | "body">>) => {
    onCardsChange((current) =>
      current.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
  };

  /** 確認なしで消し、トーストの「元に戻す」で同じ位置へ戻す。 */
  const deleteCard = (cardId: string) => {
    const index = cards.findIndex((card) => card.id === cardId);
    const card = cards[index];
    if (!card) return;
    onCardsChange((current) => renumberPlotCards(current.filter((item) => item.id !== cardId)));

    const isChapter = card.kind === "chapter";
    const label = card.title.trim() || (isChapter ? "無題の章" : card.num);
    onNotify?.(isChapter ? `章「${label}」を削除しました` : `「${label}」を削除しました`, {
      label: "元に戻す",
      onClick: () =>
        onCardsChange((current) =>
          current.some((item) => item.id === card.id)
            ? current
            : insertPlotCard(current, Math.min(index, current.length), card),
        ),
    });
  };

  /** カードの直後（章なら章グループの直後）に新しいカードを差し込む。 */
  const insertAfter = (cardId: string, kind: "section" | "chapter") => {
    onCardsChange((current) => {
      const index = current.findIndex((card) => card.id === cardId);
      if (index < 0) return current;
      const target = current[index];
      const insertAt =
        target.kind === "chapter" && kind === "chapter"
          ? plotChapterGroupEnd(current, index)
          : index + 1;
      const card = kind === "chapter" ? createPlotChapter() : createPlotSection();
      // 章の先頭に入れたセクションが見えるよう、畳まれた章は開く。
      const next =
        target.kind === "chapter" && kind === "section"
          ? current.map((item) =>
              item.id === target.id ? withPlotCardExpanded(item, true, managerMode) : item,
            )
          : current;
      return insertPlotCard(next, insertAt, card);
    });
  };

  const duplicateCard = (cardId: string) => {
    onCardsChange((current) => {
      const index = current.findIndex((card) => card.id === cardId);
      const source = current[index];
      if (!source || source.kind !== "section") return current;
      return insertPlotCard(
        current,
        index + 1,
        createPlotSection({ title: source.title, body: source.body }),
      );
    });
  };

  const copyCardText = (card: PlotCard) => {
    const text = plotCardPlainText(card, referenceByPath);
    navigator.clipboard
      .writeText(text)
      .then(() => onNotify?.("コピーしました"))
      .catch(() => onNotify?.("コピーできませんでした"));
  };

  const handleCardContextMenu = (cardId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ cardId, x: event.clientX, y: event.clientY });
  };

  /** セクションを指定章（chapterId===null は冒頭グループ）の末尾へ移動する。 */
  const moveSectionToChapter = (sectionId: string, chapterId: string | null) => {
    onCardsChange((current) => {
      const section = current.find((card) => card.id === sectionId);
      if (!section || section.kind !== "section") return current;

      const without = current.filter((card) => card.id !== sectionId);

      let insertAt: number;
      if (chapterId === null) {
        const firstChapter = without.findIndex((card) => card.kind === "chapter");
        insertAt = firstChapter === -1 ? without.length : firstChapter;
      } else {
        const chapterIndex = without.findIndex((card) => card.id === chapterId);
        if (chapterIndex === -1) return current;
        let end = chapterIndex + 1;
        while (end < without.length && without[end].kind !== "chapter") end += 1;
        insertAt = end;
      }

      const next = [...without];
      next.splice(insertAt, 0, section);
      return renumberPlotCards(next);
    });
  };

  const handleBodyChange = (cardId: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    const draft = event.currentTarget.value;
    const body = hydratePlotReferenceLinks(draft, referenceCandidates);
    setBodyDrafts((current) => ({ ...current, [cardId]: draft }));
    updateCard(cardId, { body });
    updateReferenceSuggestion(cardId, event.currentTarget);
  };

  const updateReferenceSuggestion = (cardId: string, element: HTMLTextAreaElement) => {
    const text = element.value;
    const mention = getPlotReferenceMention(text, element.selectionStart);
    if (!mention || referenceCandidates.length === 0) {
      setReferenceSuggestion(null);
      return;
    }

    const cardRect =
      element.closest<HTMLElement>("[data-plot-card-id]")?.getBoundingClientRect() ??
      element.getBoundingClientRect();
    const x = Math.max(8, cardRect.left - PLOT_REFERENCE_SUGGEST_MENU_WIDTH - 10);
    const y = Math.max(
      8,
      Math.min(window.innerHeight - PLOT_REFERENCE_SUGGEST_MENU_HEIGHT - 8, cardRect.top + 8),
    );
    setReferenceSuggestion({
      cardId,
      ...mention,
      x,
      y,
      selectedIndex: 0,
    });
  };

  const insertReferenceLink = (file: ReferenceFileInfo) => {
    const suggestion = referenceSuggestion;
    if (!suggestion) return;
    const replacement = `@${file.name}`;
    const nextCursor = suggestion.from + replacement.length;
    const currentCard = cards.find((card) => card.id === suggestion.cardId);
    if (!currentCard) return;
    const currentDraft = getBodyDraft(currentCard);
    const nextDraft =
      currentDraft.slice(0, suggestion.from) + replacement + currentDraft.slice(suggestion.to);
    const nextBody = hydratePlotReferenceLinks(nextDraft, referenceCandidates);

    setBodyDrafts((current) => ({ ...current, [suggestion.cardId]: nextDraft }));

    onCardsChange((current) =>
      current.map((card) =>
        card.id === suggestion.cardId
          ? { ...card, body: nextBody }
          : card,
      ),
    );

    setReferenceSuggestion(null);
    window.requestAnimationFrame(() => {
      const element = bodyRefs.current.get(suggestion.cardId);
      if (element instanceof HTMLTextAreaElement) {
        element.focus();
        element.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const deletePreviousReferenceToken = (
    cardId: string,
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing) return false;

    const element = event.currentTarget;
    const cursor = element.selectionStart;
    if (cursor !== element.selectionEnd || cursor === 0) return false;

    const card = cards.find((item) => item.id === cardId);
    if (!card) return false;

    const tokens = Array.from(card.body.matchAll(PLOT_REFERENCE_LINK_PATTERN))
      .map((match) => {
        const sourcePath = match[1];
        const file = referenceByPath.get(referenceKey(sourcePath));
        return `@${file?.name ?? plotReferenceLabelFromPath(sourcePath)}`;
      })
      .filter((token, index, all) => token.length > 1 && all.indexOf(token) === index)
      .sort((left, right) => countTextUnits(right) - countTextUnits(left));

    const beforeCursor = element.value.slice(0, cursor);
    const token = tokens.find((candidate) => beforeCursor.endsWith(candidate));
    if (!token) return false;

    const from = cursor - token.length;
    const nextDraft = element.value.slice(0, from) + element.value.slice(cursor);
    const nextBody = hydratePlotReferenceLinks(nextDraft, referenceCandidates);

    event.preventDefault();
    setBodyDrafts((current) => ({ ...current, [cardId]: nextDraft }));
    updateCard(cardId, { body: nextBody });
    setReferenceSuggestion(null);

    window.requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(from, from);
    });

    return true;
  };

  const handleBodyKeyDown = (cardId: string, event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Backspace" && deletePreviousReferenceToken(cardId, event)) return;

    if (!referenceSuggestion || referenceSuggestion.cardId !== cardId) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setReferenceSuggestion((current) => {
        if (!current) return current;
        const count = filteredReferenceSuggestions.length;
        if (count === 0) return current;
        return {
          ...current,
          selectedIndex: (current.selectedIndex + direction + count) % count,
        };
      });
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      if (event.nativeEvent.isComposing) return;
      const file = filteredReferenceSuggestions[referenceSuggestion.selectedIndex];
      if (!file) return;
      event.preventDefault();
      insertReferenceLink(file);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setReferenceSuggestion(null);
    }
  };

  const handleBodyFocus = (cardId: string, event: ReactFocusEvent<HTMLTextAreaElement>) => {
    const card = cards.find((item) => item.id === cardId);
    if (card) {
      const draft = getBodyDraft(card);
      setBodyDrafts((current) => ({ ...current, [cardId]: draft }));
    }
    setEditingBodyCardId(cardId);
    updateReferenceSuggestion(cardId, event.currentTarget);
  };

  const handleBodyBlur = () => {
    setReferenceSuggestion(null);
    if (!managerMode) {
      setBodyDrafts((current) => {
        if (!editingBodyCardId) return current;
        const next = { ...current };
        delete next[editingBodyCardId];
        return next;
      });
      setEditingBodyCardId(null);
    }
  };

  const handleReferenceClick = (sourcePath: string) => {
    const file = referenceByPath.get(referenceKey(sourcePath));
    if (!file) {
      onMissingReference?.();
      return;
    }
    onOpenReference?.(file.sourcePath, file);
  };

  const handleTitleChange = (cardId: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    updateCard(cardId, { title: event.currentTarget.value.replace(/\r?\n/g, " ") });
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.blur();
  };

  const renderPlotBodyPreview = (card: PlotCard) => (
    <div
      ref={setBodyRef(card.id)}
      className={`plotCardBody plotCardBodyPreview ${
        card.body.trim() ? "" : "emptyPlotBodyPreview"
      }`}
      role="textbox"
      tabIndex={0}
      aria-label={`${card.num} 本文`}
      onClick={(event) => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        pendingCaretRef.current = card.body.trim()
          ? previewCaretOffsetFromPoint(event.currentTarget, event.clientX, event.clientY)
          : null;
        setEditingBodyCardId(card.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") setEditingBodyCardId(card.id);
      }}
    >
      {card.body.trim() ? (
        <PlotBodyLinks
          body={card.body}
          referenceByPath={referenceByPath}
          onReferenceClick={handleReferenceClick}
        />
      ) : (
        "本文…"
      )}
    </div>
  );

  return (
    <>
      <div
        ref={paneRef}
        className={`plotPane ${className ?? ""}`.trim()}
        aria-label="プロット"
        onWheel={handleWheel}
      >
        <div className="plotTrack">
          {cards.map((card) => {
            const dropClass =
              dropTarget?.anchorId === card.id
                ? dropTarget.position === "before"
                  ? "plotDropBefore"
                  : "plotDropAfter"
                : "";

            if (card.kind === "chapter") {
              const chapterOpen = isCardExpanded(card);
              const count = sectionCountByChapter.get(card.id) ?? 0;

              return (
                <section
                  className={`plotChapterBand ${chapterOpen ? "" : "collapsedPlotChapterBand"} ${
                    draggingCardId === card.id ? "draggingPlotCard" : ""
                  } ${dropClass}`}
                  key={card.id}
                  data-plot-card-id={card.id}
                  onContextMenu={(event) => handleCardContextMenu(card.id, event)}
                >
                  <button
                    className="plotChapterMark"
                    type="button"
                    aria-label={chapterOpen ? "章を折りたたむ" : "章を展開する"}
                    aria-expanded={chapterOpen}
                    title="クリックで展開/折りたたみ・ドラッグで並び替え"
                    onPointerDown={(event) => handleCardPointerDown(card.id, event)}
                    onClick={() => handleToggleClick(card.id)}
                  >
                    <PlotIcon name="bookmark" />
                  </button>
                  <textarea
                    className="plotChapterTitle"
                    value={card.title}
                    placeholder="章のタイトル…"
                    spellCheck={false}
                    wrap="off"
                    aria-label="章のタイトル"
                    onChange={(event) => handleTitleChange(card.id, event)}
                    onKeyDown={handleTitleKeyDown}
                  />
                  {count > 0 && (
                    <span className="plotChapterCount" title={`セクション ${count} 件`}>
                      {count}
                    </span>
                  )}
                </section>
              );
            }

            if (hiddenSectionIds.has(card.id)) return null;

            const expanded = isCardExpanded(card);
            const hasBody = card.body.trim().length > 0;

            return (
              <article
                className={`plotCard ${expanded ? "expandedPlotCard" : ""} ${
                  draggingCardId === card.id ? "draggingPlotCard" : ""
                } ${dropClass}`}
                key={card.id}
                data-plot-card-id={card.id}
                onContextMenu={(event) => handleCardContextMenu(card.id, event)}
              >
                <button
                  className="plotCardNum"
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${card.num} を${expanded ? "折りたたむ" : "展開する"}${
                    !expanded && hasBody ? "（本文あり）" : ""
                  }`}
                  title="クリックで展開/折りたたみ・ドラッグで並び替え"
                  onPointerDown={(event) => handleCardPointerDown(card.id, event)}
                  onClick={() => handleToggleClick(card.id)}
                >
                  {card.num}
                </button>
                <div className="plotCardContent">
                  <textarea
                    className="plotCardTitle"
                    value={card.title}
                    placeholder="タイトル…"
                    readOnly={!expanded}
                    spellCheck={false}
                    tabIndex={expanded ? 0 : -1}
                    wrap="off"
                    aria-label={`${card.num} タイトル`}
                    onChange={(event) => handleTitleChange(card.id, event)}
                    onKeyDown={handleTitleKeyDown}
                  />
                  {expanded && !managerMode && editingBodyCardId !== card.id
                    ? renderPlotBodyPreview(card)
                    : expanded && (
                    // textarea は内容に合わせて幅を伸ばせないので、同じ文字列を流した見えない
                    // ミラーと同じグリッドセルに重ね、幅はレイアウトに決めさせる。
                    <div className="plotCardBodyField">
                      <div className="plotCardBody plotCardBodyMirror" aria-hidden="true">
                        {/* 末尾の改行だけはミラー側で空の列が立たないので、1 文字足して列を作る。 */}
                        {getBodyDraft(card).replace(/\n$/, "\n ")}
                      </div>
                      <textarea
                        ref={setBodyRef(card.id)}
                        className="plotCardBody"
                        value={getBodyDraft(card)}
                        placeholder="本文…"
                        rows={1}
                        aria-multiline="true"
                        aria-label={`${card.num} 本文`}
                        spellCheck={false}
                        wrap="soft"
                        onFocus={(event) => handleBodyFocus(card.id, event)}
                        onBlur={handleBodyBlur}
                        onChange={(event) => handleBodyChange(card.id, event)}
                        onKeyDown={(event) => handleBodyKeyDown(card.id, event)}
                        onSelect={(event) => updateReferenceSuggestion(card.id, event.currentTarget)}
                        onCompositionEnd={(event) =>
                          updateReferenceSuggestion(card.id, event.currentTarget)
                        }
                      />
                    </div>
                  )}
                </div>
                {!expanded && hasBody && (
                  <span className="plotCardBodyMark" title="本文あり" aria-hidden="true" />
                )}
              </article>
            );
          })}
        </div>
      </div>
      {movingCardId && (
        <PlotMoveModal
          cards={cards}
          sectionId={movingCardId}
          onClose={() => setMovingCardId(null)}
          onMove={(chapterId) => {
            moveSectionToChapter(movingCardId, chapterId);
            setMovingCardId(null);
          }}
        />
      )}
      {contextMenu &&
        createPortal(
          (() => {
            const card = cards.find((item) => item.id === contextMenu.cardId);
            if (!card) return null;
            const isChapter = card.kind === "chapter";
            const transferItem: PlotMenuItem[] = transfer
              ? [{ label: transfer.label, onSelect: () => transfer.onTransfer(card.id) }]
              : [];

            const anyExpanded = hasExpandedPlotSection(cards, managerMode);
            const allItem: PlotMenuItem = anyExpanded
              ? { label: "すべて折りたたむ", onSelect: () => setAllExpanded(false) }
              : { label: "すべて展開", onSelect: () => setAllExpanded(true) };

            const groups: PlotMenuItem[][] = isChapter
              ? [
                  [
                    { label: "章の先頭にセクションを挿入", onSelect: () => insertAfter(card.id, "section") },
                    { label: "この章の後ろに章を挿入", onSelect: () => insertAfter(card.id, "chapter") },
                  ],
                  [
                    { label: "この章をすべて展開", onSelect: () => setAllExpanded(true, card.id) },
                    { label: "この章をすべて折りたたむ", onSelect: () => setAllExpanded(false, card.id) },
                    allItem,
                  ],
                  [
                    ...transferItem,
                    { label: "章を削除", onSelect: () => deleteCard(card.id), danger: true },
                  ],
                ]
              : [
                  [
                    { label: "この後ろにセクションを挿入", onSelect: () => insertAfter(card.id, "section") },
                    { label: "ここで章を区切る", onSelect: () => insertAfter(card.id, "chapter") },
                  ],
                  [
                    { label: "複製", onSelect: () => duplicateCard(card.id) },
                    { label: "本文をコピー", onSelect: () => copyCardText(card) },
                    { label: "章へ移動…", onSelect: () => setMovingCardId(card.id) },
                    ...transferItem,
                  ],
                  [allItem],
                  [{ label: "削除", onSelect: () => deleteCard(card.id), danger: true }],
                ];
            const itemCount = groups.reduce((total, group) => total + group.length, 0);

            return (
              <div
                ref={contextMenuRef}
                className="editorContextMenu plotContextMenu"
                role="menu"
                style={getPlotContextMenuStyle(
                  contextMenu.x,
                  contextMenu.y,
                  itemCount,
                  groups.length - 1,
                )}
              >
                {groups.map((group, groupIndex) => (
                  <div className="contextMenuSection" key={groupIndex}>
                    {groupIndex > 0 && <div className="contextMenuDivider" role="separator" />}
                    {group.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        className={item.danger ? "plotContextDanger" : undefined}
                        onClick={() => {
                          setContextMenu(null);
                          item.onSelect();
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            );
          })(),
          modalRoot(),
        )}
      {referenceSuggestion &&
        filteredReferenceSuggestions.length > 0 &&
        createPortal(
          <div
            className="plotReferenceSuggestMenu"
            role="listbox"
            style={{
              left: referenceSuggestion.x,
              top: referenceSuggestion.y,
            }}
            onMouseDown={(event) => event.preventDefault()}
            onWheel={(event) => {
              const dominantDelta =
                Math.abs(event.deltaX) > Math.abs(event.deltaY)
                  ? event.deltaX
                  : event.deltaY;
              if (dominantDelta === 0) return;
              event.preventDefault();
              event.currentTarget.scrollLeft -= dominantDelta;
            }}
          >
            {filteredReferenceSuggestions.map((file, index) => (
              <button
                key={file.sourcePath}
                className={
                  index === referenceSuggestion.selectedIndex
                    ? "activePlotReferenceSuggestion"
                    : ""
                }
                type="button"
                role="option"
                aria-selected={index === referenceSuggestion.selectedIndex}
                title={file.sourcePath}
                onMouseEnter={() =>
                  setReferenceSuggestion((current) =>
                    current ? { ...current, selectedIndex: index } : current,
                  )
                }
                onClick={() => insertReferenceLink(file)}
              >
                <strong>
                  {renderHighlightedReferenceText(file.name, referenceSuggestion.query)}
                </strong>
                <small>{plotReferencePathHint(file.sourcePath)}</small>
              </button>
            ))}
            <div className="plotReferenceSuggestHint">Enter 挿入 / Esc 閉じる</div>
          </div>,
          modalRoot(),
        )}
    </>
  );
}

function PlotBodyLinks({
  body,
  referenceByPath,
  onReferenceClick,
}: {
  body: string;
  referenceByPath: Map<string, ReferenceFileInfo>;
  onReferenceClick: (sourcePath: string) => void;
}) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(PLOT_REFERENCE_LINK_PATTERN)) {
    const sourcePath = match[1];
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(body.slice(lastIndex, index));

    const file = referenceByPath.get(referenceKey(sourcePath));
    const label = truncatePlotReferenceLabel(file?.name ?? "空リンク");
    nodes.push(
      <button
        className={`plotReferenceLink ${file ? "" : "missingPlotReferenceLink"}`}
        key={`${sourcePath}-${index}`}
        type="button"
        data-plot-draft-text={`@${file?.name ?? plotReferenceLabelFromPath(sourcePath)}`}
        title={file ? file.sourcePath : sourcePath}
        onClick={(event) => {
          event.stopPropagation();
          onReferenceClick(sourcePath);
        }}
      >
        @{label}
      </button>,
    );
    lastIndex = index + match[0].length;
  }

  if (lastIndex < body.length) nodes.push(body.slice(lastIndex));
  return <>{nodes}</>;
}

type PlotMoveModalProps = {
  cards: PlotCard[];
  sectionId: string;
  onClose: () => void;
  onMove: (chapterId: string | null) => void;
};

function PlotMoveModal({ cards, sectionId, onClose, onMove }: PlotMoveModalProps) {
  const groups = groupByChapter(cards);
  const currentChapterId =
    groups.find((group) => group.sections.some((section) => section.id === sectionId))?.chapter?.id ??
    null;
  const hasLeadingGroup = groups.some((group) => group.chapter === null);

  const options: { id: string | null; label: string }[] = [];
  if (hasLeadingGroup) {
    options.push({ id: null, label: "冒頭（章なし）" });
  }
  for (const group of groups) {
    if (!group.chapter) continue;
    options.push({ id: group.chapter.id, label: group.chapter.title.trim() || "（無題の章）" });
  }

  return createPortal(
    <div className="modalBackdrop" role="presentation" onClick={onClose}>
      <section
        className="modal compactModal plotMoveModal"
        aria-label="章へ移動"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modalHeader">
          <h2>章へ移動</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modalForm">
          {options.length === 0 ? (
            <p className="plotMoveEmpty">章がありません。先に「章を追加」してください。</p>
          ) : (
            <ul className="plotMoveList">
              {options.map((option) => (
                <li key={option.id ?? "__lead__"}>
                  <button
                    className="plotMoveOption"
                    type="button"
                    disabled={option.id === currentChapterId}
                    onClick={() => onMove(option.id)}
                  >
                    <span>{option.label}</span>
                    {option.id === currentChapterId && <small>現在の章</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="modalActions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>,
    modalRoot(),
  );
}

type PlotPaneProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
  referenceCandidates?: ReferenceFileInfo[];
  onOpenReference?: (sourcePath: string, fileInfo: ReferenceFileInfo) => void;
  onMissingReference?: () => void;
  isManagerOpen?: boolean;
  onManagerOpenChange?: (open: boolean) => void;
  transfer?: PlotCardTransfer;
  onNotify?: PlotNotify;
};

/** 開いているセクションが 1 枚でもあれば true。一括ボタンを「折りたたむ」側にする。 */
const hasExpandedPlotSection = (cards: PlotCard[], managerMode = false) =>
  cards.some((card) => card.kind === "section" && isPlotCardExpandedIn(card, managerMode));

type PlotPaneHeaderActionsProps = {
  onAddSection: () => void;
  onAddChapter: () => void;
  onOpenManager?: () => void;
  /** anyExpanded=true なら「すべて折りたたむ」、false なら「すべて展開」。 */
  anyExpanded?: boolean;
  onToggleAll?: () => void;
};

export function PlotPaneHeaderActions({
  onAddSection,
  onAddChapter,
  onOpenManager,
  anyExpanded = false,
  onToggleAll,
}: PlotPaneHeaderActionsProps) {
  const toggleAllLabel = anyExpanded ? "すべて折りたたむ" : "すべて展開";
  return (
    <div className="plotPaneHeaderActions" aria-label="プロット操作">
      <button
        className="sidebarIconButton plotHeaderActionButton"
        type="button"
        aria-label="セクションを追加"
        title="セクションを追加"
        onClick={onAddSection}
      >
        <span aria-hidden="true">＋</span>
      </button>
      <button
        className="sidebarIconButton plotHeaderActionButton"
        type="button"
        aria-label="章を追加"
        title="章を追加"
        onClick={onAddChapter}
      >
        <PlotIcon name="bookmark" />
      </button>
      {onToggleAll && (
        <button
          className="sidebarIconButton plotHeaderActionButton"
          type="button"
          aria-label={toggleAllLabel}
          title={toggleAllLabel}
          onClick={onToggleAll}
        >
          <PlotIcon name={anyExpanded ? "collapseAll" : "expandAll"} />
        </button>
      )}
      {onOpenManager && (
        <button
          className="sidebarIconButton plotHeaderActionButton"
          type="button"
          aria-label="プロットを管理"
          title="プロットを管理"
          onClick={onOpenManager}
        >
          <PlotIcon name="list" />
        </button>
      )}
    </div>
  );
}

export function PlotPane({
  cards,
  onCardsChange,
  referenceCandidates,
  onOpenReference,
  onMissingReference,
  isManagerOpen,
  onManagerOpenChange,
  transfer,
  onNotify,
}: PlotPaneProps) {
  const [localManagerOpen, setLocalManagerOpen] = useState(false);
  const managerOpen = isManagerOpen ?? localManagerOpen;
  const setManagerOpen = onManagerOpenChange ?? setLocalManagerOpen;

  return (
    <>
      <PlotBoard
        cards={cards}
        onCardsChange={onCardsChange}
        referenceCandidates={referenceCandidates}
        onOpenReference={onOpenReference}
        onMissingReference={onMissingReference}
        transfer={transfer}
        onNotify={onNotify}
        inactive={managerOpen}
      />
      {managerOpen && (
        <PlotManagerModal
          cards={cards}
          onCardsChange={onCardsChange}
          referenceCandidates={referenceCandidates}
          onOpenReference={onOpenReference}
          onMissingReference={onMissingReference}
          onNotify={onNotify}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </>
  );
}

type PlotManagerModalProps = {
  cards: PlotCard[];
  onCardsChange: Dispatch<SetStateAction<PlotCard[]>>;
  referenceCandidates?: ReferenceFileInfo[];
  onOpenReference?: (sourcePath: string, fileInfo: ReferenceFileInfo) => void;
  onMissingReference?: () => void;
  onNotify?: PlotNotify;
  onClose: () => void;
};

function PlotManagerModal({
  cards,
  onCardsChange,
  referenceCandidates,
  onOpenReference,
  onMissingReference,
  onNotify,
  onClose,
}: PlotManagerModalProps) {
  const [bulkRequest, setBulkRequest] = useState<PlotBulkRequest | null>(null);
  const anyExpanded = hasExpandedPlotSection(cards, true);
  const addSection = () => onCardsChange((current) => appendPlotSection(current));
  const addChapter = () => onCardsChange((current) => appendPlotChapter(current));

  return createPortal(
    <div className="modalBackdrop" role="presentation">
      <section
        className="modal plotManagerModal"
        aria-label="プロットを管理"
        role="dialog"
        aria-modal="true"
      >
        <header className="modalHeader">
          <h2>プロットを管理</h2>
          <PlotPaneHeaderActions
            onAddSection={addSection}
            onAddChapter={addChapter}
            anyExpanded={anyExpanded}
            onToggleAll={() => setBulkRequest({ nonce: Date.now(), expand: !anyExpanded })}
          />
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <PlotBoard
          cards={cards}
          onCardsChange={onCardsChange}
          referenceCandidates={referenceCandidates}
          onOpenReference={onOpenReference}
          onMissingReference={onMissingReference}
          managerMode
          className="plotManagerBoard"
          onNotify={onNotify}
          bulkRequest={bulkRequest}
        />
        <footer className="modalActions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>,
    modalRoot(),
  );
}
