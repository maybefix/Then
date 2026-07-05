import {
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
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
  renumberPlotCards,
} from "./plotCardUtils";

// Portal target for plot dialogs. PlotPane lives inside the right sidebar, which
// is scaled by the UI zoom (--ui-font-scale); rendering a modal there would
// double-zoom it and clip it to the sidebar. Mount at the .appShell root instead
// so it inherits the theme + scale variables but escapes the chrome zoom.
const modalRoot = (): HTMLElement =>
  (document.querySelector(".appShell") as HTMLElement | null) ?? document.body;

type PlotIconName = "grip" | "list" | "bookmark";

type PlotCardStyle = CSSProperties & {
  "--plot-body-width"?: string;
};

type PlotReferenceSuggestionState = {
  cardId: string;
  query: string;
  from: number;
  to: number;
  x: number;
  y: number;
  selectedIndex: number;
};

const PLOT_CONTEXT_MENU_WIDTH = 180;
const PLOT_CONTEXT_MENU_HEIGHT = 92;
const PLOT_REFERENCE_SUGGEST_MENU_WIDTH = 136;
const PLOT_REFERENCE_SUGGEST_MENU_HEIGHT = 340;
const DEFAULT_ROWS_PER_COLUMN = 24;
const PLOT_BODY_COLUMN_WIDTH_EM = 2.05;
const PLOT_REFERENCE_LABEL_MAX_LENGTH = 18;
const SCROLL_PIN_TOLERANCE = 16;
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

const estimatePlotColumns = (
  text: string,
  rowsPerColumn = DEFAULT_ROWS_PER_COLUMN,
) => {
  const rows = Math.max(1, rowsPerColumn);
  const lines = text.split("\n");

  return Math.max(
    1,
    lines.reduce((total, line) => total + Math.max(1, Math.ceil(countTextUnits(line) / rows)), 0),
  );
};

const measureBodyWidth = (element: HTMLElement) => {
  const previousWidth = element.style.width;
  const previousMinWidth = element.style.minWidth;
  const previousFlexBasis = element.style.flexBasis;

  element.style.width = `${PLOT_BODY_COLUMN_WIDTH_EM}em`;
  element.style.minWidth = `${PLOT_BODY_COLUMN_WIDTH_EM}em`;
  element.style.flexBasis = "auto";
  const width = Math.ceil(element.scrollWidth);

  element.style.width = previousWidth;
  element.style.minWidth = previousMinWidth;
  element.style.flexBasis = previousFlexBasis;

  return Math.max(1, width);
};

const getPlotContextMenuStyle = (x: number, y: number): CSSProperties => {
  return getScaledFixedMenuPosition(x, y, {
    width: PLOT_CONTEXT_MENU_WIDTH,
    height: PLOT_CONTEXT_MENU_HEIGHT,
  });
};

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
    case "grip":
      return (
        <svg {...common}>
          <circle cx="9" cy="6" r="1.2" />
          <circle cx="15" cy="6" r="1.2" />
          <circle cx="9" cy="12" r="1.2" />
          <circle cx="15" cy="12" r="1.2" />
          <circle cx="9" cy="18" r="1.2" />
          <circle cx="15" cy="18" r="1.2" />
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

function usePlotBodyWidths(
  cards: PlotCard[],
  isExpanded: (card: PlotCard) => boolean,
  bodyTextForLayout: (card: PlotCard) => string,
) {
  const [bodyWidths, setBodyWidths] = useState<Record<string, number>>({});
  const bodyRefs = useRef<Map<string, HTMLElement>>(new Map());
  const composingCardIds = useRef<Set<string>>(new Set());

  const setBodyRef = useCallback(
    (cardId: string) => (element: HTMLElement | null) => {
      if (element) {
        bodyRefs.current.set(cardId, element);
        return;
      }

      bodyRefs.current.delete(cardId);
    },
    [],
  );

  const setCardWidth = useCallback((cardId: string, width: number) => {
    setBodyWidths((current) =>
      current[cardId] === width ? current : { ...current, [cardId]: width },
    );
  }, []);

  const syncBodyWidth = useCallback(
    (cardId: string, element?: HTMLElement | null) => {
      if (composingCardIds.current.has(cardId)) return;
      if (!element) return;

      setCardWidth(cardId, measureBodyWidth(element));
    },
    [setCardWidth],
  );

  useLayoutEffect(() => {
    cards.forEach((card) => {
      if (card.kind === "chapter") return;
      if (!isExpanded(card)) return;
      if (composingCardIds.current.has(card.id)) return;

      const element = bodyRefs.current.get(card.id);
      syncBodyWidth(card.id, element);
    });
  }, [cards, isExpanded, bodyTextForLayout, syncBodyWidth]);

  return { bodyWidths, setBodyRef, syncBodyWidth, composingCardIds, bodyRefs };
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
};

function PlotBoard({
  cards,
  onCardsChange,
  referenceCandidates = [],
  onOpenReference,
  onMissingReference,
  managerMode = false,
  className,
}: PlotBoardProps) {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [editingBodyCardId, setEditingBodyCardId] = useState<string | null>(null);
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [referenceSuggestion, setReferenceSuggestion] =
    useState<PlotReferenceSuggestionState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ cardId: string; x: number; y: number } | null>(
    null,
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToRightRef = useRef(true);
  const draggingCardIdRef = useRef<string | null>(null);
  // 初回表示で先頭（右端）に合わせたかどうかの判定に使う直前の scrollWidth。
  const prevScrollWidthRef = useRef(0);
  const prevClientWidthRef = useRef(0);

  // セクションは本文表示、章は配下セクションの表示可否を表す共通の「展開」状態。
  // 管理画面は card.managerCollapsed（右サイドバーの expanded とは独立・保存対象）を見る。
  const isCardExpanded = useCallback(
    (card: PlotCard) => (managerMode ? !card.managerCollapsed : card.expanded),
    [managerMode],
  );

  const isEditingBody = useCallback(
    (card: PlotCard) => managerMode || editingBodyCardId === card.id,
    [editingBodyCardId, managerMode],
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

  const getBodyTextForLayout = useCallback(
    (card: PlotCard) =>
      isEditingBody(card) ? getBodyDraft(card) : displayPlotReferenceLinks(card.body, referenceByPath),
    [getBodyDraft, isEditingBody, referenceByPath],
  );

  const { bodyWidths, setBodyRef, syncBodyWidth, composingCardIds, bodyRefs } = usePlotBodyWidths(
    cards,
    isCardExpanded,
    getBodyTextForLayout,
  );

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

  const visualCards = [...cards].reverse();

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

  const moveCard = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;

      onCardsChange((current) => {
        const visualOrder = [...current].reverse();
        const draggedIndex = visualOrder.findIndex((card) => card.id === draggedId);
        const targetVisualIndex = visualOrder.findIndex((card) => card.id === targetId);
        const draggedCard = visualOrder.find((card) => card.id === draggedId);
        if (!draggedCard || draggedIndex < 0 || targetVisualIndex < 0) return current;

        const withoutDragged = visualOrder.filter((card) => card.id !== draggedId);
        const targetIndex = withoutDragged.findIndex((card) => card.id === targetId);
        if (targetIndex < 0) return current;

        const nextVisualOrder = [...withoutDragged];
        const insertIndex = draggedIndex < targetVisualIndex ? targetIndex + 1 : targetIndex;
        nextVisualOrder.splice(insertIndex, 0, draggedCard);

        return renumberPlotCards([...nextVisualOrder].reverse());
      });
    },
    [onCardsChange],
  );

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    const maxScrollLeft = Math.max(0, pane.scrollWidth - pane.clientWidth);
    const prevMaxScrollLeft = Math.max(
      0,
      prevScrollWidthRef.current - prevClientWidthRef.current,
    );
    const wasPinnedBeforeLayout =
      prevScrollWidthRef.current === 0 ||
      isPinnedToRightRef.current ||
      Math.abs(pane.scrollLeft - prevMaxScrollLeft) < SCROLL_PIN_TOLERANCE;

    if (wasPinnedBeforeLayout) {
      let frames = 4;
      let frameId = 0;
      const pinToRight = () => {
        const nextMaxScrollLeft = Math.max(0, pane.scrollWidth - pane.clientWidth);
        pane.scrollLeft = nextMaxScrollLeft;
        isPinnedToRightRef.current = true;
        prevScrollWidthRef.current = pane.scrollWidth;
        prevClientWidthRef.current = pane.clientWidth;

        if (--frames > 0) {
          frameId = requestAnimationFrame(pinToRight);
        }
      };

      pinToRight();
      return () => {
        if (frameId) cancelAnimationFrame(frameId);
      };
    }
    prevScrollWidthRef.current = pane.scrollWidth;
    prevClientWidthRef.current = pane.clientWidth;
  }, [bodyWidths, cards, managerMode]);

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
    element.focus();
    const cursor = element.value.length;
    element.setSelectionRange(cursor, cursor);
  }, [editingBodyCardId]);

  useLayoutEffect(() => {
    if (!draggingCardId) return;

    const handlePointerMove = (event: PointerEvent) => {
      const draggedId = draggingCardIdRef.current;
      if (!draggedId) return;

      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-plot-card-id]");
      const targetId = target?.dataset.plotCardId;

      if (targetId && targetId !== draggedId) {
        event.preventDefault();
        moveCard(draggedId, targetId);
      }
    };

    const handlePointerUp = () => {
      draggingCardIdRef.current = null;
      setDraggingCardId(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingCardId, moveCard]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const pane = event.currentTarget;
    const maxScrollLeft = pane.scrollWidth - pane.clientWidth;

    if (maxScrollLeft <= 0) return;

    const dominantDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    if (dominantDelta === 0) return;

    event.preventDefault();
    pane.scrollLeft = Math.min(maxScrollLeft, Math.max(0, pane.scrollLeft - dominantDelta));
    isPinnedToRightRef.current = Math.abs(pane.scrollLeft - maxScrollLeft) < 2;
  };

  const handleScroll = () => {
    const pane = paneRef.current;
    if (!pane) return;

    const maxScrollLeft = pane.scrollWidth - pane.clientWidth;
    isPinnedToRightRef.current =
      maxScrollLeft <= 0 || Math.abs(pane.scrollLeft - maxScrollLeft) < SCROLL_PIN_TOLERANCE;
  };

  /** トグル対象カードの柱（番号バッジ）の画面位置。再レイアウト後に同じ位置へ戻すための基準。 */
  const numScreenRight = (cardId: string): number | null => {
    const pane = paneRef.current;
    const numEl = pane?.querySelector<HTMLElement>(
      `[data-plot-card-id="${CSS.escape(cardId)}"] .plotCardNum`,
    );
    if (!pane || !numEl) return null;
    return numEl.getBoundingClientRect().right - pane.getBoundingClientRect().left;
  };

  const toggleCard = (cardId: string) => {
    // トグル前に柱の画面位置を記録。開閉で本文幅が変わっても柱の見た目位置を据え置く。
    // 再レイアウトが複数フレームに分かれても追従できるよう、数フレーム合わせ直す。
    const pane = paneRef.current;
    const beforeRight = numScreenRight(cardId);
    if (pane && beforeRight !== null) {
      let frames = 4;
      const repin = () => {
        const currentRight = numScreenRight(cardId);
        if (currentRight !== null) {
          const maxScrollLeft = Math.max(0, pane.scrollWidth - pane.clientWidth);
          pane.scrollLeft = Math.max(
            0,
            Math.min(maxScrollLeft, pane.scrollLeft + (currentRight - beforeRight)),
          );
        }
        if (--frames > 0) requestAnimationFrame(repin);
      };
      requestAnimationFrame(repin);
    }

    if (managerMode) {
      onCardsChange((current) =>
        current.map((card) =>
          card.id === cardId ? { ...card, managerCollapsed: !card.managerCollapsed } : card,
        ),
      );
      return;
    }

    onCardsChange((current) =>
      current.map((card) =>
        card.id === cardId ? { ...card, expanded: !card.expanded } : card,
      ),
    );
  };

  const updateCard = (cardId: string, patch: Partial<Pick<PlotCard, "title" | "body">>) => {
    onCardsChange((current) =>
      current.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
  };

  const deleteCard = (cardId: string) => {
    setDeletingCardId(cardId);
  };

  const confirmDelete = () => {
    if (!deletingCardId) return;
    const id = deletingCardId;
    onCardsChange((current) => renumberPlotCards(current.filter((item) => item.id !== id)));
    setDeletingCardId(null);
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

  const handleCardDragStart = (cardId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDraggingCardId(cardId);
    draggingCardIdRef.current = cardId;
  };

  const handleBodyChange = (cardId: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    const draft = event.currentTarget.value;
    const body = hydratePlotReferenceLinks(draft, referenceCandidates);
    setBodyDrafts((current) => ({ ...current, [cardId]: draft }));
    updateCard(cardId, { body });

    if (!composingCardIds.current.has(cardId)) {
      syncBodyWidth(cardId, event.currentTarget);
    }

    updateReferenceSuggestion(cardId, event.currentTarget);
  };

  const handleBodyCompositionStart = (cardId: string) => {
    composingCardIds.current.add(cardId);
  };

  const handleBodyCompositionEnd = (
    cardId: string,
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composingCardIds.current.delete(cardId);
    const draft = event.currentTarget.value;
    const body = hydratePlotReferenceLinks(draft, referenceCandidates);
    setBodyDrafts((current) => ({ ...current, [cardId]: draft }));
    updateCard(cardId, { body });
    syncBodyWidth(cardId, event.currentTarget);
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
        syncBodyWidth(suggestion.cardId, element);
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
      syncBodyWidth(cardId, element);
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

  const getPlotCardStyle = (card: PlotCard, expanded: boolean): PlotCardStyle => ({
    "--plot-body-width": expanded
      ? bodyWidths[card.id] !== undefined
        ? `${bodyWidths[card.id]}px`
        : `${estimatePlotColumns(getBodyTextForLayout(card)) * PLOT_BODY_COLUMN_WIDTH_EM}em`
      : `${PLOT_BODY_COLUMN_WIDTH_EM}em`,
  });

  const renderPlotBodyPreview = (card: PlotCard) => (
    <div
      ref={setBodyRef(card.id)}
      className={`plotCardBody plotCardBodyPreview ${
        card.body.trim() ? "" : "emptyPlotBodyPreview"
      }`}
      role="textbox"
      tabIndex={0}
      aria-label={`${card.num} 本文`}
      onClick={() => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
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
        aria-label="Plot"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        <div className="plotTrack">
          {visualCards.map((card) => {
            if (card.kind === "chapter") {
              const chapterOpen = isCardExpanded(card);
              const count = sectionCountByChapter.get(card.id) ?? 0;

              return (
                <section
                  className={`plotChapterBand ${chapterOpen ? "" : "collapsedPlotChapterBand"} ${
                    draggingCardId === card.id ? "draggingPlotCard" : ""
                  }`}
                  key={card.id}
                  data-plot-card-id={card.id}
                  onContextMenu={(event) => handleCardContextMenu(card.id, event)}
                >
                  <div className="plotCardToolbar">
                    <button
                      className="plotToolButton plotDragHandle"
                      type="button"
                      aria-label="章をドラッグして並び替え"
                      title="ドラッグして並び替え"
                      onPointerDown={(event) => handleCardDragStart(card.id, event)}
                    >
                      <PlotIcon name="grip" />
                    </button>
                  </div>
                  <span className="plotChapterMark" aria-hidden="true">
                    <PlotIcon name="bookmark" />
                  </span>
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
                  {!chapterOpen && count > 0 && (
                    <span className="plotChapterCount" aria-hidden="true">
                      {count}
                    </span>
                  )}
                  <button
                    className="plotCardToggle"
                    type="button"
                    aria-label={chapterOpen ? "章を折りたたむ" : "章を展開する"}
                    title={chapterOpen ? "章を折りたたむ" : "章を展開する"}
                    onClick={() => toggleCard(card.id)}
                  >
                    {chapterOpen ? "›" : "‹"}
                  </button>
                </section>
              );
            }

            if (hiddenSectionIds.has(card.id)) return null;

            const expanded = isCardExpanded(card);

            return (
              <article
                className={`plotCard ${expanded ? "expandedPlotCard" : ""} ${
                  draggingCardId === card.id ? "draggingPlotCard" : ""
                }`}
                key={card.id}
                data-plot-card-id={card.id}
                style={getPlotCardStyle(card, expanded)}
                onContextMenu={(event) => handleCardContextMenu(card.id, event)}
              >
                <div className="plotCardToolbar">
                  <button
                    className="plotToolButton plotDragHandle"
                    type="button"
                    aria-label={`${card.num} をドラッグして並び替え`}
                    title="ドラッグして並び替え"
                    onPointerDown={(event) => handleCardDragStart(card.id, event)}
                  >
                    <PlotIcon name="grip" />
                  </button>
                </div>
                <button
                  className="plotCardNum"
                  type="button"
                  onClick={() => toggleCard(card.id)}
                  title="クリックで展開/折りたたみ"
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
                    <textarea
                      ref={setBodyRef(card.id)}
                      className="plotCardBody"
                      value={getBodyDraft(card)}
                      placeholder="本文…"
                      aria-multiline="true"
                      aria-label={`${card.num} 本文`}
                      spellCheck={false}
                      wrap="soft"
                      onFocus={(event) => handleBodyFocus(card.id, event)}
                      onBlur={handleBodyBlur}
                      onChange={(event) => handleBodyChange(card.id, event)}
                      onKeyDown={(event) => handleBodyKeyDown(card.id, event)}
                      onSelect={(event) => updateReferenceSuggestion(card.id, event.currentTarget)}
                      onCompositionStart={() => handleBodyCompositionStart(card.id)}
                      onCompositionEnd={(event) => handleBodyCompositionEnd(card.id, event)}
                    />
                  )}
                </div>
                <button
                  className="plotCardToggle"
                  type="button"
                  aria-label={expanded ? "折りたたむ" : "展開する"}
                  title={expanded ? "折りたたむ" : "展開する"}
                  onClick={() => toggleCard(card.id)}
                >
                  {expanded ? "›" : "‹"}
                </button>
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
      {deletingCardId && (
        <PlotDeleteDialog
          card={cards.find((card) => card.id === deletingCardId) ?? null}
          onCancel={() => setDeletingCardId(null)}
          onConfirm={confirmDelete}
        />
      )}
      {contextMenu &&
        createPortal(
          (() => {
          const card = cards.find((item) => item.id === contextMenu.cardId);
          if (!card) return null;
          const isChapter = card.kind === "chapter";

          return (
            <div
              ref={contextMenuRef}
              className="editorContextMenu plotContextMenu"
              role="menu"
              style={getPlotContextMenuStyle(contextMenu.x, contextMenu.y)}
            >
              <div className="contextMenuSection">
                {!isChapter && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMovingCardId(card.id);
                      setContextMenu(null);
                    }}
                  >
                    章へ移動…
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="plotContextDanger"
                  onClick={() => {
                    setContextMenu(null);
                    deleteCard(card.id);
                  }}
                >
                  {isChapter ? "章を削除" : "削除"}
                </button>
              </div>
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

type PlotDeleteDialogProps = {
  card: PlotCard | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function PlotDeleteDialog({ card, onCancel, onConfirm }: PlotDeleteDialogProps) {
  if (!card) return null;

  const isChapter = card.kind === "chapter";
  const label = card.title.trim() || (isChapter ? "（無題の章）" : card.num);

  return createPortal(
    <div className="modalBackdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal compactModal"
        aria-label={isChapter ? "章を削除" : "プロットを削除"}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modalHeader">
          <h2>{isChapter ? "章を削除" : "プロットを削除"}</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onCancel}>
            ×
          </button>
        </header>
        <div className="modalForm">
          <div className="dialogMessage">
            <p>
              {isChapter ? `章「${label}」を削除しますか？` : `プロット「${label}」を削除しますか？`}
            </p>
            <span>
              {isChapter
                ? "配下のプロットは前の章に統合されます。この操作は取り消せません。"
                : "この操作は取り消せません。"}
            </span>
          </div>
          <footer className="modalActions">
            <button type="button" onClick={onCancel}>
              キャンセル
            </button>
            <button className="dangerAction" type="button" onClick={onConfirm}>
              削除
            </button>
          </footer>
        </div>
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
};

type PlotPaneHeaderActionsProps = {
  onAddSection: () => void;
  onAddChapter: () => void;
  onOpenManager?: () => void;
};

export function PlotPaneHeaderActions({
  onAddSection,
  onAddChapter,
  onOpenManager,
}: PlotPaneHeaderActionsProps) {
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
      />
      {managerOpen && (
        <PlotManagerModal
          cards={cards}
          onCardsChange={onCardsChange}
          referenceCandidates={referenceCandidates}
          onOpenReference={onOpenReference}
          onMissingReference={onMissingReference}
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
  onClose: () => void;
};

function PlotManagerModal({
  cards,
  onCardsChange,
  referenceCandidates,
  onOpenReference,
  onMissingReference,
  onClose,
}: PlotManagerModalProps) {
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
          <PlotPaneHeaderActions onAddSection={addSection} onAddChapter={addChapter} />
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
