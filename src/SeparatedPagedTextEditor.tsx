import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { TextEditorSelection } from "./editor/selectionMetrics";
import type { TextEditorViewportState, WritingMode } from "./types";
import type { TextEditorHandle, VerticalTextEditorProps } from "./VerticalTextEditor";

type PageMetrics = { current: number; total: number };

type PageLayout = {
  width: number;
  height: number;
  gap: number;
  outerMargin: number;
  paddingX: number;
  paddingY: number;
  contentWidth: number;
  contentHeight: number;
  columnGap: number;
  columnStep: number;
};

type TextSelectionState = {
  anchor: number;
  head: number;
};

type LineRecord = {
  index: number;
  start: number;
  text: string;
};

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const DEFAULT_PAGE_LAYOUT: PageLayout = {
  width: 1,
  height: 1,
  gap: 28,
  outerMargin: 0,
  paddingX: 28,
  paddingY: 28,
  contentWidth: 1,
  contentHeight: 1,
  columnGap: 84,
  columnStep: 85,
};

const DEFAULT_PAGE_METRICS: PageMetrics = { current: 1, total: 1 };

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function clampOffset(value: number, text: string): number {
  return Math.max(0, Math.min(text.length, Number.isFinite(value) ? value : 0));
}

function createLineRecords(text: string): LineRecord[] {
  const lines = text.split("\n");
  let start = 0;
  return lines.map((line, index) => {
    const record = { index, start, text: line };
    start += line.length + (index < lines.length - 1 ? 1 : 0);
    return record;
  });
}

function lineNumberAtOffset(text: string, offset: number): number {
  return text.slice(0, clampOffset(offset, text)).split("\n").length;
}

function selectionForText(text: string, anchor: number, head: number): TextEditorSelection {
  const safeAnchor = clampOffset(anchor, text);
  const safeHead = clampOffset(head, text);
  return {
    from: Math.min(safeAnchor, safeHead),
    to: Math.max(safeAnchor, safeHead),
    head: safeHead,
    line: lineNumberAtOffset(text, safeHead),
  };
}

function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function textNodeIn(element: Element): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

function pointForOffset(root: HTMLElement, records: LineRecord[], rawOffset: number): {
  node: Node;
  offset: number;
} | null {
  if (!records.length) return null;
  const textLength = records[records.length - 1].start + records[records.length - 1].text.length;
  const offset = Math.max(0, Math.min(textLength, rawOffset));
  let record = records[records.length - 1];
  for (const candidate of records) {
    if (offset <= candidate.start + candidate.text.length) {
      record = candidate;
      break;
    }
  }

  const paragraph = root.querySelector<HTMLElement>(`[data-separated-line="${record.index}"]`);
  if (!paragraph) return null;
  const node = textNodeIn(paragraph);
  if (!node) return { node: paragraph, offset: 0 };
  return { node, offset: Math.max(0, Math.min(node.data.length, offset - record.start)) };
}

function rangeForOffsets(
  root: HTMLElement,
  records: LineRecord[],
  from: number,
  to: number,
): Range | null {
  const start = pointForOffset(root, records, Math.min(from, to));
  const end = pointForOffset(root, records, Math.max(from, to));
  if (!start || !end) return null;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    range.detach();
    return null;
  }
}

function offsetFromDomPoint(root: HTMLElement, node: Node, nodeOffset: number): number | null {
  const paragraph = elementForNode(node)?.closest<HTMLElement>("[data-separated-line]");
  if (!paragraph || !root.contains(paragraph)) return null;
  const start = Number(paragraph.dataset.textStart ?? "");
  if (!Number.isFinite(start)) return null;
  if (node instanceof Text) return start + Math.max(0, Math.min(node.data.length, nodeOffset));
  const textNode = textNodeIn(paragraph);
  return start + (nodeOffset > 0 && textNode ? textNode.data.length : 0);
}

function rectForOffset(
  root: HTMLElement,
  records: LineRecord[],
  text: string,
  offset: number,
): DOMRect | null {
  const collapsed = rangeForOffsets(root, records, offset, offset);
  if (!collapsed) return null;
  const collapsedRect = Array.from(collapsed.getClientRects()).find(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  collapsed.detach();
  if (collapsedRect) return DOMRect.fromRect(collapsedRect);

  const safe = clampOffset(offset, text);
  const from = safe < text.length ? safe : Math.max(0, safe - 1);
  const to = safe < text.length ? safe + 1 : safe;
  const character = rangeForOffsets(root, records, from, to);
  if (!character) return null;
  const rect = Array.from(character.getClientRects()).find(
    (candidate) => candidate.width > 0 || candidate.height > 0,
  );
  character.detach();
  return rect ? DOMRect.fromRect(rect) : null;
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom;
}

function sameLayout(a: PageLayout, b: PageLayout): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.outerMargin === b.outerMargin &&
    a.paddingX === b.paddingX &&
    a.paddingY === b.paddingY &&
    a.columnGap === b.columnGap &&
    a.columnStep === b.columnStep
  );
}

/**
 * Experimental paged editor.
 *
 * The visible page tree is deliberately not editable. A transparent textarea,
 * positioned at the rendered caret, owns native text input and IME. This keeps
 * CSS fragmentation out of the native editable DOM while leaving the existing
 * continuous/typewriter editor untouched.
 */
export function SeparatedPagedTextEditor(props: VerticalTextEditorProps) {
  const {
    text,
    editorRevision,
    writingMode,
    pageFlowDirection,
    initialSelectionOffset,
    initialViewportState,
    onViewportSizeChange,
    onReady,
    onTextChange,
    onSelectionChange,
    onPageMetricsChange,
  } = props;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<HTMLDivElement | null>(null);
  const selectionLayerRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef(normalizeText(text));
  const selectionRef = useRef<TextSelectionState>({
    anchor: clampOffset(initialSelectionOffset ?? 0, textRef.current),
    head: clampOffset(initialSelectionOffset ?? 0, textRef.current),
  });
  const localRevisionRef = useRef(0);
  const composingRef = useRef(false);
  const draggingAnchorRef = useRef<number | null>(null);
  const layoutRef = useRef<PageLayout>(DEFAULT_PAGE_LAYOUT);
  const metricsRef = useRef<PageMetrics>(DEFAULT_PAGE_METRICS);
  const currentPageRef = useRef(1);
  const revealSelectionRef = useRef(!initialViewportState);
  const initialViewportOffsetRef = useRef(initialViewportState?.anchorOffset ?? null);
  const initialViewportPendingRef = useRef(initialViewportState !== null && initialViewportState !== undefined);
  const geometryFrameRef = useRef<number | null>(null);
  const [renderText, setRenderText] = useState(textRef.current);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [layout, setLayout] = useState<PageLayout>(DEFAULT_PAGE_LAYOUT);
  const [metrics, setMetrics] = useState<PageMetrics>(DEFAULT_PAGE_METRICS);
  const records = useMemo(() => createLineRecords(renderText), [renderText]);

  const publishMetrics = useCallback(
    (next: PageMetrics) => {
      const previous = metricsRef.current;
      if (previous.current === next.current && previous.total === next.total) return;
      metricsRef.current = next;
      setMetrics(next);
      onPageMetricsChange?.(next);
    },
    [onPageMetricsChange],
  );

  const scrollToPage = useCallback(
    (rawPage: number, behavior: ScrollBehavior = "auto") => {
      const scroller = scrollerRef.current;
      const safe = Math.max(1, Math.min(metricsRef.current.total, Math.round(rawPage)));
      currentPageRef.current = safe;
      publishMetrics({ current: safe, total: metricsRef.current.total });
      if (!scroller) return;
      const pageSpan =
        pageFlowDirection === "vertical"
          ? layoutRef.current.height + layoutRef.current.gap
          : layoutRef.current.width + layoutRef.current.gap;
      if (pageFlowDirection === "vertical") {
        scroller.scrollTo({ top: (safe - 1) * pageSpan, behavior });
      } else {
        scroller.scrollTo({ left: -(safe - 1) * pageSpan, behavior });
      }
    },
    [pageFlowDirection, publishMetrics],
  );

  const syncSelectionFromTextarea = useCallback(
    (reveal: boolean) => {
      const input = inputRef.current;
      if (!input) return;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? start;
      const backward = input.selectionDirection === "backward";
      selectionRef.current = backward ? { anchor: end, head: start } : { anchor: start, head: end };
      revealSelectionRef.current ||= reveal;
      setSelectionVersion((version) => version + 1);
      onSelectionChange();
    },
    [onSelectionChange],
  );

  const applySelection = useCallback(
    (anchor: number, head: number, reveal = true) => {
      const current = textRef.current;
      const safeAnchor = clampOffset(anchor, current);
      const safeHead = clampOffset(head, current);
      selectionRef.current = { anchor: safeAnchor, head: safeHead };
      const input = inputRef.current;
      if (input) {
        const from = Math.min(safeAnchor, safeHead);
        const to = Math.max(safeAnchor, safeHead);
        input.setSelectionRange(from, to, safeHead < safeAnchor ? "backward" : "forward");
      }
      revealSelectionRef.current ||= reveal;
      setSelectionVersion((version) => version + 1);
      onSelectionChange();
    },
    [onSelectionChange],
  );

  const replaceText = useCallback(
    (nextValue: string, anchor: number, head: number, notify = true) => {
      const next = normalizeText(nextValue);
      textRef.current = next;
      setRenderText(next);
      const input = inputRef.current;
      if (input && input.value !== next) input.value = next;
      applySelection(anchor, head, true);
      if (notify) {
        const revision = ++localRevisionRef.current;
        onTextChange(next, revision);
      }
    },
    [applySelection, onTextChange],
  );

  const offsetAtPoint = useCallback((x: number, y: number): number | null => {
    const root = rendererRef.current;
    if (!root) return null;
    const caretDocument = document as CaretDocument;
    const position = caretDocument.caretPositionFromPoint?.(x, y);
    if (position) return offsetFromDomPoint(root, position.offsetNode, position.offset);
    const range = caretDocument.caretRangeFromPoint?.(x, y);
    if (!range) return null;
    return offsetFromDomPoint(root, range.startContainer, range.startOffset);
  }, []);

  const updateGeometry = useCallback(() => {
    const renderer = rendererRef.current;
    const host = hostRef.current;
    const selectionLayer = selectionLayerRef.current;
    const caret = caretRef.current;
    const input = inputRef.current;
    if (!renderer || !host || !selectionLayer || !caret || !input) return;

    const currentLayout = layoutRef.current;
    const hostRect = host.getBoundingClientRect();
    const contentRect = DOMRect.fromRect({
      x: hostRect.left + currentLayout.paddingX,
      y: hostRect.top + currentLayout.paddingY,
      width: currentLayout.contentWidth,
      height: currentLayout.contentHeight,
    });
    const selection = selectionForText(
      textRef.current,
      selectionRef.current.anchor,
      selectionRef.current.head,
    );
    const headRect = rectForOffset(renderer, records, textRef.current, selection.head);

    selectionLayer.textContent = "";
    if (selection.from !== selection.to) {
      const range = rangeForOffsets(renderer, records, selection.from, selection.to);
      if (range) {
        for (const rawRect of Array.from(range.getClientRects())) {
          const rect = DOMRect.fromRect(rawRect);
          if (!intersects(rect, contentRect)) continue;
          const mark = document.createElement("span");
          mark.className = "separatedPagedSelectionRect";
          mark.style.left = `${rect.left - hostRect.left}px`;
          mark.style.top = `${rect.top - hostRect.top}px`;
          mark.style.width = `${Math.max(1, rect.width)}px`;
          mark.style.height = `${Math.max(1, rect.height)}px`;
          selectionLayer.appendChild(mark);
        }
        range.detach();
      }
    }

    if (!headRect) {
      caret.style.display = "none";
      input.style.left = `${currentLayout.paddingX}px`;
      input.style.top = `${currentLayout.paddingY}px`;
      return;
    }

    const caretLeft = Math.max(
      currentLayout.paddingX,
      Math.min(currentLayout.paddingX + currentLayout.contentWidth - 2, headRect.left - hostRect.left),
    );
    const caretTop = Math.max(
      currentLayout.paddingY,
      Math.min(currentLayout.paddingY + currentLayout.contentHeight - 2, headRect.top - hostRect.top),
    );
    caret.style.display = selection.from === selection.to ? "block" : "none";
    caret.style.left = `${caretLeft}px`;
    caret.style.top = `${caretTop}px`;
    if (writingMode === "vertical-rl") {
      caret.style.width = `${Math.max(8, Math.min(headRect.width, 32))}px`;
      caret.style.height = "1px";
    } else {
      caret.style.width = "1px";
      caret.style.height = `${Math.max(12, Math.min(headRect.height, 40))}px`;
    }
    input.style.left = `${caretLeft}px`;
    input.style.top = `${caretTop}px`;
  }, [records, writingMode]);

  const pageContainingOffset = useCallback(
    (offset: number): number | null => {
      const renderer = rendererRef.current;
      const host = hostRef.current;
      if (!renderer || !host) return null;
      const rect = rectForOffset(renderer, records, textRef.current, offset);
      if (!rect) return null;
      const currentLayout = layoutRef.current;
      const hostRect = host.getBoundingClientRect();
      const vertical = writingMode === "vertical-rl";
      const contentStart = vertical
        ? hostRect.top + currentLayout.paddingY
        : hostRect.left + currentLayout.paddingX;
      const center = vertical ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;
      const relativePage = Math.floor((center - contentStart) / currentLayout.columnStep);
      return Math.max(1, Math.min(metricsRef.current.total, currentPageRef.current + relativePage));
    },
    [records, writingMode],
  );

  const measurePages = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const currentLayout = layoutRef.current;
    const range = document.createRange();
    range.selectNodeContents(renderer);
    const bounds = range.getBoundingClientRect();
    range.detach();
    const extent = writingMode === "vertical-rl" ? bounds.height : bounds.width;
    const total = Math.max(
      1,
      Math.ceil((Math.max(1, extent) + currentLayout.columnGap - 1) / currentLayout.columnStep),
    );
    const current = Math.max(1, Math.min(total, currentPageRef.current));
    if (current !== currentPageRef.current) currentPageRef.current = current;
    publishMetrics({ current, total });

    if (initialViewportPendingRef.current) {
      initialViewportPendingRef.current = false;
      const target = pageContainingOffset(initialViewportOffsetRef.current ?? 0);
      if (target !== null && target !== current) {
        scrollToPage(target);
        return;
      }
    } else if (revealSelectionRef.current) {
      revealSelectionRef.current = false;
      const target = pageContainingOffset(selectionRef.current.head);
      if (target !== null && target !== current) {
        scrollToPage(target);
        return;
      }
    }
    updateGeometry();
  }, [pageContainingOffset, publishMetrics, scrollToPage, updateGeometry, writingMode]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const updateLayout = () => {
      const viewportWidth = Math.max(1, scroller.clientWidth);
      const viewportHeight = Math.max(1, scroller.clientHeight);
      const outerMargin = viewportWidth >= 480 && viewportHeight >= 360 ? 20 : 0;
      const width = Math.max(1, viewportWidth - outerMargin * 2);
      const height = Math.max(1, viewportHeight - outerMargin * 2);
      const paddingX = Math.max(28, Math.min(72, Math.round(width * 0.08)));
      const paddingY = Math.max(28, Math.min(64, Math.round(height * 0.08)));
      const contentWidth = Math.max(1, width - paddingX * 2);
      const contentHeight = Math.max(1, height - paddingY * 2);
      const gap = 28;
      const columnGap =
        writingMode === "vertical-rl" ? gap + paddingY * 2 : gap + paddingX * 2;
      const next: PageLayout = {
        width,
        height,
        gap,
        outerMargin,
        paddingX,
        paddingY,
        contentWidth,
        contentHeight,
        columnGap,
        columnStep:
          (writingMode === "vertical-rl" ? contentHeight : contentWidth) + columnGap,
      };
      if (!sameLayout(layoutRef.current, next)) {
        layoutRef.current = next;
        setLayout(next);
      }
      onViewportSizeChange?.({
        width: viewportWidth,
        height: viewportHeight,
        verticalPadding: paddingY * 2,
      });
    };
    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [onViewportSizeChange, writingMode]);

  useEffect(() => {
    if (geometryFrameRef.current !== null) cancelAnimationFrame(geometryFrameRef.current);
    geometryFrameRef.current = requestAnimationFrame(() => {
      geometryFrameRef.current = requestAnimationFrame(() => {
        geometryFrameRef.current = null;
        measurePages();
      });
    });
    return () => {
      if (geometryFrameRef.current !== null) {
        cancelAnimationFrame(geometryFrameRef.current);
        geometryFrameRef.current = null;
      }
    };
  }, [layout, measurePages, renderText, selectionVersion, metrics.current]);

  useEffect(() => {
    const next = normalizeText(text);
    if (next === textRef.current) return;
    if (editorRevision !== null && editorRevision <= localRevisionRef.current) return;
    textRef.current = next;
    setRenderText(next);
    const input = inputRef.current;
    if (input && !composingRef.current) input.value = next;
    applySelection(0, 0, true);
  }, [applySelection, editorRevision, text]);

  const handle = useMemo<TextEditorHandle>(
    () => ({
      focus: () => inputRef.current?.focus({ preventScroll: true }),
      getValue: () => textRef.current,
      getSelection: () =>
        selectionForText(
          textRef.current,
          selectionRef.current.anchor,
          selectionRef.current.head,
        ),
      selectRange: (from, to) => {
        applySelection(from, to, true);
        inputRef.current?.focus({ preventScroll: true });
      },
      replaceRange: (from, to, insert, cursorPos) => {
        const current = textRef.current;
        const safeFrom = clampOffset(Math.min(from, to), current);
        const safeTo = clampOffset(Math.max(from, to), current);
        const normalizedInsert = normalizeText(insert);
        const next = `${current.slice(0, safeFrom)}${normalizedInsert}${current.slice(safeTo)}`;
        const cursor = clampOffset(cursorPos ?? safeFrom + normalizedInsert.length, next);
        replaceText(next, cursor, cursor, true);
      },
      jumpToLine: (line) => {
        const recordsNow = createLineRecords(textRef.current);
        const index = Math.max(0, Math.min(recordsNow.length - 1, Math.round(line) - 1));
        applySelection(recordsNow[index]?.start ?? 0, recordsNow[index]?.start ?? 0, true);
        inputRef.current?.focus({ preventScroll: true });
      },
      positionFromPoint: offsetAtPoint,
      getViewportState: (): TextEditorViewportState => ({
        textLength: textRef.current.length,
        writingMode,
        anchorOffset: selectionRef.current.head,
        anchorRatio: 0.5,
      }),
      coordsAtPos: (offset) => {
        const renderer = rendererRef.current;
        if (!renderer) return null;
        const rect = rectForOffset(
          renderer,
          createLineRecords(textRef.current),
          textRef.current,
          offset,
        );
        return rect
          ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
          : null;
      },
      // Paged mode never participates in typewriter scrolling. App-level callers
      // may still invoke the shared handle when that setting is enabled.
      scrollCaretIntoView: () => undefined,
      isComposing: () => composingRef.current,
    }),
    [applySelection, offsetAtPoint, replaceText, writingMode],
  );

  useEffect(() => {
    onReady(handle);
    const input = inputRef.current;
    if (input) {
      input.value = textRef.current;
      const selection = selectionRef.current;
      input.setSelectionRange(
        Math.min(selection.anchor, selection.head),
        Math.max(selection.anchor, selection.head),
        selection.head < selection.anchor ? "backward" : "forward",
      );
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }
    return () => {
      onReady(null);
      onPageMetricsChange?.(null);
      onViewportSizeChange?.(null);
    };
  }, [handle, onPageMetricsChange, onReady, onViewportSizeChange]);

  const handleInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    const next = normalizeText(input.value);
    textRef.current = next;
    setRenderText(next);
    syncSelectionFromTextarea(true);
    const revision = ++localRevisionRef.current;
    onTextChange(next, revision);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText("\t", start, end, "end");
    const next = normalizeText(input.value);
    textRef.current = next;
    setRenderText(next);
    syncSelectionFromTextarea(true);
    const revision = ++localRevisionRef.current;
    onTextChange(next, revision);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const offset = offsetAtPoint(event.clientX, event.clientY);
    if (offset === null) return;
    draggingAnchorRef.current = offset;
    event.currentTarget.setPointerCapture(event.pointerId);
    applySelection(offset, offset, false);
    inputRef.current?.focus({ preventScroll: true });
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingAnchorRef.current === null || (event.buttons & 1) === 0) return;
    const offset = offsetAtPoint(event.clientX, event.clientY);
    if (offset === null) return;
    applySelection(draggingAnchorRef.current, offset, false);
    event.preventDefault();
  };

  const finishPointerSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingAnchorRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const pageSpan =
    pageFlowDirection === "vertical" ? layout.height + layout.gap : layout.width + layout.gap;
  const fragmentOffset = (metrics.current - 1) * layout.columnStep;
  const hostOffset = (metrics.current - 1) * pageSpan;
  const verticalWriting = writingMode === "vertical-rl";
  const surfaceStyle = {
    "--paged-page-width": `${layout.width}px`,
    "--paged-page-height": `${layout.height}px`,
    "--paged-page-gap": `${layout.gap}px`,
    "--paged-outer-margin": `${layout.outerMargin}px`,
    width:
      pageFlowDirection === "horizontal-rtl"
        ? `${metrics.total * layout.width + Math.max(0, metrics.total - 1) * layout.gap + layout.outerMargin * 2}px`
        : `${layout.width + layout.outerMargin * 2}px`,
    height:
      pageFlowDirection === "vertical"
        ? `${metrics.total * layout.height + Math.max(0, metrics.total - 1) * layout.gap + layout.outerMargin * 2}px`
        : `${layout.height + layout.outerMargin * 2}px`,
  } as CSSProperties;
  const hostStyle: CSSProperties = {
    top: layout.outerMargin,
    right: layout.outerMargin,
    width: layout.width,
    height: layout.height,
    transform: `translate(${pageFlowDirection === "horizontal-rtl" ? -hostOffset : 0}px, ${
      pageFlowDirection === "vertical" ? hostOffset : 0
    }px)`,
  };
  const rendererStyle: CSSProperties = {
    top: layout.paddingY,
    right: layout.paddingX,
    width: layout.contentWidth,
    minWidth: layout.contentWidth,
    maxWidth: layout.contentWidth,
    height: layout.contentHeight,
    minHeight: layout.contentHeight,
    maxHeight: layout.contentHeight,
    columnWidth: verticalWriting ? layout.contentHeight : layout.contentWidth,
    columnGap: layout.columnGap,
    transform: `translate(${verticalWriting ? 0 : -fragmentOffset}px, ${
      verticalWriting ? -fragmentOffset : 0
    }px)`,
  };

  return (
    <div
      ref={shellRef}
      className="verticalTypewriterShell separatedPagedShell"
      data-editor-display="paged"
      data-page-flow={pageFlowDirection}
      data-separated-input="true"
    >
      <div
        ref={scrollerRef}
        className="verticalTypewriterScroller"
        onScroll={(event) => {
          const scroller = event.currentTarget;
          const raw =
            pageFlowDirection === "vertical"
              ? scroller.scrollTop / Math.max(1, layout.height + layout.gap)
              : Math.abs(scroller.scrollLeft) / Math.max(1, layout.width + layout.gap);
          const current = Math.max(1, Math.min(metricsRef.current.total, Math.round(raw) + 1));
          if (current === currentPageRef.current) return;
          currentPageRef.current = current;
          publishMetrics({ current, total: metricsRef.current.total });
        }}
        onWheel={(event) => {
          event.preventDefault();
          const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
          if (Math.abs(delta) < 2) return;
          scrollToPage(currentPageRef.current + (delta > 0 ? 1 : -1));
        }}
      >
        <div className="verticalTypewriterPageSurface" style={surfaceStyle}>
          {Array.from({ length: metrics.total }, (_, index) => (
            <div
              className="pagedEditorSheet"
              key={index}
              style={
                pageFlowDirection === "horizontal-rtl"
                  ? {
                      right: layout.outerMargin + index * (layout.width + layout.gap),
                      top: layout.outerMargin,
                    }
                  : {
                      left: layout.outerMargin,
                      top: layout.outerMargin + index * (layout.height + layout.gap),
                    }
              }
              aria-hidden="true"
            >
              <span>{index + 1}</span>
            </div>
          ))}
          <div
            ref={hostRef}
            className="separatedPagedPageHost"
            style={hostStyle}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerSelection}
            onPointerCancel={finishPointerSelection}
          >
            <div
              ref={rendererRef}
              className="separatedPagedRenderer"
              style={rendererStyle}
              data-empty={renderText.length === 0 ? "true" : undefined}
              data-placeholder="ここから書き始める"
              aria-hidden="true"
            >
              {records.map((record) => (
                <p
                  className={record.text.length === 0 ? "blank" : undefined}
                  data-separated-line={record.index}
                  data-text-start={record.start}
                  key={`${record.index}:${record.start}`}
                >
                  {record.text || <br />}
                </p>
              ))}
            </div>
            <div ref={selectionLayerRef} className="separatedPagedSelectionLayer" aria-hidden="true" />
            <div ref={caretRef} className="separatedPagedCaret" aria-hidden="true" />
            <textarea
              ref={inputRef}
              className="separatedPagedInputBridge"
              aria-label="本文"
              defaultValue={textRef.current}
              spellCheck={false}
              onInput={handleInput}
              onSelect={() => syncSelectionFromTextarea(true)}
              onKeyDown={handleKeyDown}
              onKeyUp={() => syncSelectionFromTextarea(true)}
              onCompositionStart={() => {
                composingRef.current = true;
                shellRef.current?.setAttribute("data-composing", "true");
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                shellRef.current?.removeAttribute("data-composing");
                const next = normalizeText(event.currentTarget.value);
                textRef.current = next;
                setRenderText(next);
                syncSelectionFromTextarea(true);
              }}
            />
          </div>
        </div>
      </div>
      <button
        className="pagedEditorNav pagedEditorPrevious"
        type="button"
        aria-label="前のページ"
        title="前のページ"
        disabled={metrics.current <= 1}
        onClick={() => scrollToPage(metrics.current - 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={pageFlowDirection === "vertical" ? "m7 14 5-5 5 5" : "m9 7 5 5-5 5"} />
        </svg>
      </button>
      <button
        className="pagedEditorNav pagedEditorNext"
        type="button"
        aria-label="次のページ"
        title="次のページ"
        disabled={metrics.current >= metrics.total}
        onClick={() => scrollToPage(metrics.current + 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={pageFlowDirection === "vertical" ? "m7 10 5 5 5-5" : "m15 7-5 5 5 5"} />
        </svg>
      </button>
    </div>
  );
}
