import { useEffect, useMemo, useRef } from "react";

export type TextEditorHandle = {
  focus: () => void;
  getValue: () => string;
  getSelection: () => { from: number; to: number; head: number };
  replaceRange: (from: number, to: number, insert: string, cursorPos?: number) => void;
  jumpToLine: (line: number) => void;
  positionFromPoint: (x: number, y: number) => number | null;
  scrollCaretIntoView: (offsetPercent: number) => void;
  isComposing: () => boolean;
};

type VerticalTextEditorProps = {
  text: string;
  onReady: (editor: TextEditorHandle | null) => void;
  onTextChange: (text: string) => void;
  onSelectionChange: () => void;
};

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const HEADING_CLASSES = ["heading", "h1", "h2", "h3", "h4", "h5", "h6"];

function setLineText(line: HTMLElement, text: string): void {
  line.textContent = "";
  if (text.length === 0) {
    line.appendChild(document.createElement("br"));
    return;
  }
  line.appendChild(document.createTextNode(text));
}

function lineText(line: Element): string {
  return (line.textContent || "").replace(/\u200B/g, "");
}

function removeLineClasses(line: HTMLElement): void {
  line.classList.remove("blank", "list-line", ...HEADING_CLASSES);
  line.removeAttribute("data-level");
}

function updateLineClass(line: Element | null): void {
  if (!(line instanceof HTMLElement) || !line.classList.contains("line")) return;
  const raw = lineText(line);
  removeLineClasses(line);

  if (raw.length === 0) {
    line.classList.add("blank");
    return;
  }

  const heading = raw.match(/^(#{1,6})(\s+|$)/);
  if (heading) {
    const level = heading[1].length;
    line.classList.add("heading", `h${level}`);
    return;
  }

  const unordered = raw.match(/^(\s*)([-*+])(\s+|$)/);
  const ordered = raw.match(/^(\s*)(\d+[.)])(\s+|$)/);
  const list = unordered || ordered;
  if (list) {
    const indent = list[1] || "";
    const level = Math.min(4, Math.floor(indent.replace(/\t/g, "    ").length / 2));
    line.classList.add("list-line");
    line.dataset.level = String(level);
  }
}

function makeLine(text = ""): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "line";
  setLineText(line, text);
  updateLineClass(line);
  return line;
}

function getLines(editor: HTMLElement): HTMLElement[] {
  return Array.from(editor.querySelectorAll<HTMLElement>(":scope > .line"));
}

function readText(editor: HTMLElement): string {
  const lines = getLines(editor);
  if (lines.length === 0) return editor.innerText.replace(/\n$/, "");
  return lines.map(lineText).join("\n");
}

function countBodyChars(text: string): number {
  return Array.from(text).length;
}

function updateStatus(editor: HTMLElement, countEl: HTMLElement | null): void {
  const text = readText(editor);
  if (countEl) countEl.textContent = String(countBodyChars(text));
  editor.dataset.empty = text.length === 0 ? "true" : "false";
}

function updateAllLineClasses(editor: HTMLElement, countEl: HTMLElement | null): void {
  for (const line of getLines(editor)) updateLineClass(line);
  updateStatus(editor, countEl);
}

function ensureInitialLine(editor: HTMLElement, countEl: HTMLElement | null): void {
  if (editor.childNodes.length === 0) editor.appendChild(makeLine(""));
  updateStatus(editor, countEl);
}

function setEditorText(editor: HTMLElement, text: string, countEl: HTMLElement | null): void {
  editor.textContent = "";
  const frag = document.createDocumentFragment();
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  for (const part of parts) frag.appendChild(makeLine(part));
  editor.appendChild(frag);
  updateStatus(editor, countEl);
}

function closestLine(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE && node instanceof HTMLElement && node.classList.contains("line")) return node;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest<HTMLElement>(".line") ?? null;
}

function currentLine(editor: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return getLines(editor)[0] ?? null;
  return closestLine(sel.focusNode) ?? getLines(editor)[0] ?? null;
}

function offsetInLine(line: HTMLElement, node: Node | null, nodeOffset: number): number {
  let pos = 0;
  let found = false;

  const textLen = (n: Node | undefined) => (n?.textContent || "").replace(/\u200B/g, "").length;

  const walk = (n: Node) => {
    if (found) return;
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) {
        pos += Math.min(nodeOffset, n.nodeValue?.length ?? 0);
      } else {
        for (let i = 0; i < nodeOffset; i++) pos += textLen(n.childNodes[i]);
      }
      found = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      pos += (n.nodeValue || "").replace(/\u200B/g, "").length;
      return;
    }
    for (const child of Array.from(n.childNodes)) walk(child);
  };

  walk(line);
  return pos;
}

function caretOffsetInLine(line: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return lineText(line).length;
  return offsetInLine(line, sel.focusNode, sel.focusOffset);
}

function setCaretInLine(line: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  const text = lineText(line);
  const clamped = Math.max(0, Math.min(offset, text.length));

  if (text.length === 0) {
    range.selectNodeContents(line);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let rest = clamped;
  let textNode = walker.nextNode();
  while (textNode) {
    const len = textNode.nodeValue?.length ?? 0;
    if (rest <= len) {
      range.setStart(textNode, rest);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    rest -= len;
    textNode = walker.nextNode();
  }

  range.selectNodeContents(line);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function globalCaretOffset(editor: HTMLElement): number {
  const line = currentLine(editor);
  const lines = getLines(editor);
  let pos = 0;
  for (const item of lines) {
    if (item === line) return pos + caretOffsetInLine(item);
    pos += lineText(item).length + 1;
  }
  return readText(editor).length;
}

function globalOffsetForNode(editor: HTMLElement, node: Node | null, nodeOffset: number): number {
  const line = closestLine(node);
  if (!line) return readText(editor).length;

  let pos = 0;
  for (const item of getLines(editor)) {
    if (item === line) return pos + offsetInLine(line, node, nodeOffset);
    pos += lineText(item).length + 1;
  }
  return readText(editor).length;
}

function setCaretByGlobalOffset(editor: HTMLElement, offset: number): void {
  const lines = getLines(editor);
  let rest = Math.max(0, offset);
  for (const line of lines) {
    const len = lineText(line).length;
    if (rest <= len) {
      setCaretInLine(line, rest);
      return;
    }
    rest -= len;
    if (rest === 0) {
      setCaretInLine(line, len);
      return;
    }
    rest -= 1;
  }
  const last = lines[lines.length - 1];
  if (last) setCaretInLine(last, lineText(last).length);
}

function getSelectionOffsets(editor: HTMLElement): { from: number; to: number; head: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { from: 0, to: 0, head: 0 };

  const anchor = globalOffsetForNode(editor, selection.anchorNode, selection.anchorOffset);
  const focus = globalOffsetForNode(editor, selection.focusNode, selection.focusOffset);
  return {
    from: Math.min(anchor, focus),
    to: Math.max(anchor, focus),
    head: focus,
  };
}

function splitCurrentLine(editor: HTMLElement, countEl: HTMLElement | null, centerCaret: () => void, emitChange: () => void): void {
  const line = currentLine(editor);
  if (!line) return;
  const text = lineText(line);
  const offset = caretOffsetInLine(line);
  const before = text.slice(0, offset);
  const after = text.slice(offset);

  setLineText(line, before);
  updateLineClass(line);

  const next = makeLine(after);
  line.after(next);
  setCaretInLine(next, 0);
  updateStatus(editor, countEl);
  emitChange();
  centerCaret();
}

function insertTextAtCaret(editor: HTMLElement, countEl: HTMLElement | null, text: string, centerCaret: () => void, emitChange: () => void): void {
  const line = currentLine(editor);
  if (!line) return;

  const beforeLines = text.replace(/\r\n?/g, "\n").split("\n");
  const original = lineText(line);
  const offset = caretOffsetInLine(line);
  const before = original.slice(0, offset);
  const after = original.slice(offset);

  if (beforeLines.length === 1) {
    const nextText = before + beforeLines[0] + after;
    setLineText(line, nextText);
    updateLineClass(line);
    setCaretInLine(line, before.length + beforeLines[0].length);
    updateStatus(editor, countEl);
    emitChange();
    centerCaret();
    return;
  }

  setLineText(line, before + beforeLines[0]);
  updateLineClass(line);
  let cursorLine = line;
  for (let i = 1; i < beforeLines.length; i += 1) {
    const isLast = i === beforeLines.length - 1;
    const newLine = makeLine(beforeLines[i] + (isLast ? after : ""));
    cursorLine.after(newLine);
    cursorLine = newLine;
  }
  setCaretInLine(cursorLine, beforeLines[beforeLines.length - 1].length);
  updateStatus(editor, countEl);
  emitChange();
  centerCaret();
}

function normalizeAfterNativeInput(editor: HTMLElement, countEl: HTMLElement | null, composing: boolean): void {
  if (composing) return;

  const directTextNodes = Array.from(editor.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && (node.nodeValue?.length ?? 0) > 0);
  if (directTextNodes.length === 0) return;

  const caret = globalCaretOffset(editor);
  const text = editor.innerText.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  setEditorText(editor, text, countEl);
  setCaretByGlobalOffset(editor, caret);
}

function caretRect(editor: HTMLElement, allowDomFallback = true): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  let rect = range.getBoundingClientRect();
  const isZero = !rect || (rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0);
  if (!isZero) return rect;

  const node = range.startContainer;
  if (node && node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[range.startOffset] || node.childNodes[range.startOffset - 1];
    const targetNode = child && child.nodeType === Node.ELEMENT_NODE ? child : node === editor ? editor : node;
    if (targetNode instanceof Element) {
      rect = targetNode.getBoundingClientRect();
      if (rect.width || rect.height) return rect;
    }
  }

  if (!allowDomFallback) return null;

  const span = document.createElement("span");
  span.textContent = "\u200B";
  range.insertNode(span);
  rect = span.getBoundingClientRect();
  const parent = span.parentNode;
  span.remove();
  if (parent) parent.normalize();
  return rect;
}

function positionFromPoint(editor: HTMLElement, x: number, y: number): number | null {
  const caretDocument = document as CaretDocument;
  const caretPosition = caretDocument.caretPositionFromPoint?.(x, y);
  if (caretPosition && editor.contains(caretPosition.offsetNode)) {
    return globalOffsetForNode(editor, caretPosition.offsetNode, caretPosition.offset);
  }

  const caretRange = caretDocument.caretRangeFromPoint?.(x, y);
  if (caretRange && editor.contains(caretRange.startContainer)) {
    return globalOffsetForNode(editor, caretRange.startContainer, caretRange.startOffset);
  }

  return null;
}

function replaceTextRange(editor: HTMLElement, countEl: HTMLElement | null, from: number, to: number, insert: string, cursorPos: number, centerCaret: () => void, emitChange: () => void): void {
  const current = readText(editor);
  const next = `${current.slice(0, from)}${insert}${current.slice(to)}`;
  setEditorText(editor, next, countEl);
  setCaretByGlobalOffset(editor, cursorPos);
  emitChange();
  centerCaret();
}

export function VerticalTextEditor({
  text,
  onReady,
  onTextChange,
  onSelectionChange,
}: VerticalTextEditorProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef(text);
  const onTextChangeRef = useRef(onTextChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const composingRef = useRef(false);
  const targetRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = readText(editor);
    textRef.current = next;
    onTextChangeRef.current(next);
    onSelectionChangeRef.current();
  };

  const step = () => {
    rafRef.current = null;
    const scroller = scrollerRef.current;
    if (!scroller || targetRef.current === null) return;
    const cur = scroller.scrollLeft;
    const diff = targetRef.current - cur;
    if (Math.abs(diff) < 0.5) {
      scroller.scrollLeft = targetRef.current;
      targetRef.current = null;
      return;
    }
    scroller.scrollLeft = cur + diff * 0.22;
    rafRef.current = requestAnimationFrame(step);
  };

  const centerCaret = (instant = false) => {
    const scroller = scrollerRef.current;
    const editor = editorRef.current;
    if (!scroller || !editor || document.activeElement !== editor) return;
    const rect = caretRect(editor, !composingRef.current);
    if (!rect) return;
    const s = scroller.getBoundingClientRect();
    const delta = rect.left + rect.width / 2 - (s.left + s.width / 2);
    if (Math.abs(delta) < 0.5 && targetRef.current === null) return;
    const t = scroller.scrollLeft + delta;
    if (instant) {
      targetRef.current = null;
      scroller.scrollLeft = t;
      return;
    }
    targetRef.current = t;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    textRef.current = text;
    const editor = editorRef.current;
    if (!editor || readText(editor) === text) return;
    setEditorText(editor, text, null);
  }, [text]);

  const handle = useMemo<TextEditorHandle>(
    () => ({
      focus: () => editorRef.current?.focus(),
      getValue: () => {
        const editor = editorRef.current;
        return editor ? readText(editor) : textRef.current;
      },
      getSelection: () => {
        const editor = editorRef.current;
        return editor ? getSelectionOffsets(editor) : { from: 0, to: 0, head: 0 };
      },
      replaceRange: (from, to, insert, cursorPos) => {
        const editor = editorRef.current;
        if (!editor) return;

        const nextCursor = cursorPos ?? from + insert.length;
        editor.focus();
        replaceTextRange(editor, null, from, to, insert, nextCursor, centerCaret, emitChange);
      },
      jumpToLine: (line) => {
        const editor = editorRef.current;
        if (!editor) return;

        const lines = getLines(editor);
        const targetLine = lines[Math.max(0, Math.min(line - 1, lines.length - 1))];
        if (!targetLine) return;
        editor.focus();
        setCaretInLine(targetLine, 0);
        onSelectionChangeRef.current();
        centerCaret(true);
      },
      positionFromPoint: (x, y) => {
        const editor = editorRef.current;
        return editor ? positionFromPoint(editor, x, y) : null;
      },
      scrollCaretIntoView: () => centerCaret(),
      isComposing: () => composingRef.current,
    }),
    [],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    const editor = editorRef.current;
    if (!scroller || !editor) return;

    setEditorText(editor, textRef.current, null);

    const handleBeforeInput = (event: InputEvent) => {
      if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
        event.preventDefault();
        splitCurrentLine(editor, null, centerCaret, emitChange);
      }
    };

    const handleInput = () => {
      if (!composingRef.current) {
        normalizeAfterNativeInput(editor, null, composingRef.current);
        const line = currentLine(editor);
        if (line) updateLineClass(line);
        updateAllLineClasses(editor, null);
        emitChange();
        centerCaret();
      } else {
        updateStatus(editor, null);
        centerCaret();
      }
    };

    const handleCompositionStart = () => {
      composingRef.current = true;
      targetRef.current = null;
    };

    const handleCompositionUpdate = () => {
      updateStatus(editor, null);
      centerCaret();
    };

    const handleCompositionEnd = () => {
      composingRef.current = false;
      requestAnimationFrame(() => {
        normalizeAfterNativeInput(editor, null, composingRef.current);
        updateAllLineClasses(editor, null);
        emitChange();
        centerCaret();
      });
    };

    const handleSelectionChange = () => {
      if (document.activeElement === editor) {
        onSelectionChangeRef.current();
        centerCaret();
      }
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      targetRef.current = null;
      const d = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      scroller.scrollLeft -= d;
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.target === scroller) {
        event.preventDefault();
        editor.focus();
        const lines = getLines(editor);
        const last = lines[lines.length - 1];
        if (last) setCaretInLine(last, lineText(last).length);
        centerCaret(true);
      }
    };

    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const clipboardData = event.clipboardData ?? (window as unknown as { clipboardData?: DataTransfer }).clipboardData;
      const pastedText = clipboardData?.getData("text/plain") ?? "";
      insertTextAtCaret(editor, null, pastedText, centerCaret, emitChange);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const blob = new Blob([readText(editor)], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "原稿.md";
        a.click();
        URL.revokeObjectURL(a.href);
      }
    };

    const handleResize = () => centerCaret(true);

    editor.addEventListener("beforeinput", handleBeforeInput);
    editor.addEventListener("input", handleInput);
    editor.addEventListener("compositionstart", handleCompositionStart);
    editor.addEventListener("compositionupdate", handleCompositionUpdate);
    editor.addEventListener("compositionend", handleCompositionEnd);
    document.addEventListener("selectionchange", handleSelectionChange);
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    scroller.addEventListener("mousedown", handleMouseDown);
    editor.addEventListener("paste", handlePaste);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    ensureInitialLine(editor, null);
    editor.focus();
    const first = getLines(editor)[0];
    if (first) setCaretInLine(first, 0);
    centerCaret(true);
    document.fonts?.ready.then(() => centerCaret(true));

    onReady(handle);

    return () => {
      editor.removeEventListener("beforeinput", handleBeforeInput);
      editor.removeEventListener("input", handleInput);
      editor.removeEventListener("compositionstart", handleCompositionStart);
      editor.removeEventListener("compositionupdate", handleCompositionUpdate);
      editor.removeEventListener("compositionend", handleCompositionEnd);
      document.removeEventListener("selectionchange", handleSelectionChange);
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("mousedown", handleMouseDown);
      editor.removeEventListener("paste", handlePaste);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      onReady(null);
    };
  }, [handle, onReady]);

  return (
    <div className="verticalTypewriterShell">
      <div ref={scrollerRef} className="verticalTypewriterScroller">
        <div
          ref={editorRef}
          className="verticalTypewriterEditor"
          contentEditable
          spellCheck={false}
          data-placeholder={"# 見出し\n- リスト項目\nここに入力……"}
          data-empty="true"
          suppressContentEditableWarning
        />
      </div>
      <div className="verticalTypewriterGuide" />
    </div>
  );
}
