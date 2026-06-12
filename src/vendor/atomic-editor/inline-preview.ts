import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, StateEffect, StateField, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { safeUrl } from "../silkdown/url.js";

export interface InlinePreviewConfig {
  onLinkClick?: (url: string) => void;
}

function defaultOnLinkClick(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

const FREEZE_TAIL_MS = 100;
const setFrozen = StateEffect.define<boolean>();
const previewFrozenField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFrozen)) return effect.value;
    }
    return value;
  },
});

function linkIconHitTarget(event: MouseEvent, root?: HTMLElement): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const link = target.closest(".cm-atomic-link");
  if (!link || !(link instanceof HTMLElement) || (root && !root.contains(link))) return null;

  const rects = Array.from(link.getClientRects());
  if (rects.length === 0) return null;
  const last = rects[rects.length - 1];
  const em = Number.parseFloat(window.getComputedStyle(link).fontSize);
  const zone = em * 1.25;
  const onIcon =
    event.clientX >= last.right - zone &&
    event.clientX <= last.right &&
    event.clientY >= last.top &&
    event.clientY <= last.bottom;
  return onIcon ? link : null;
}

const freezeMousePlugin = ViewPlugin.fromClass(
  class {
    private down = false;
    private releaseTimer: number | null = null;

    private readonly onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Node) || !this.view.contentDOM.contains(target)) return;
      if (linkIconHitTarget(event, this.view.contentDOM)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      this.down = true;
      if (this.releaseTimer !== null) {
        window.clearTimeout(this.releaseTimer);
        this.releaseTimer = null;
      }
      if (!this.view.state.field(previewFrozenField)) {
        this.view.dispatch({ effects: setFrozen.of(true) });
      }
    };

    private readonly onUp = () => {
      if (!this.down) return;
      this.down = false;
      if (this.releaseTimer !== null) window.clearTimeout(this.releaseTimer);
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = null;
        if (!this.view.state.field(previewFrozenField)) return;
        try {
          this.view.dispatch({ effects: setFrozen.of(false) });
        } catch {
          // View was destroyed while the timer was pending.
        }
      }, FREEZE_TAIL_MS);
    };

    constructor(private readonly view: EditorView) {
      view.dom.addEventListener("pointerdown", this.onDown, true);
      window.addEventListener("pointerup", this.onUp);
      window.addEventListener("pointercancel", this.onUp);
    }

    destroy() {
      this.view.dom.removeEventListener("pointerdown", this.onDown, true);
      window.removeEventListener("pointerup", this.onUp);
      window.removeEventListener("pointercancel", this.onUp);
      if (this.releaseTimer !== null) window.clearTimeout(this.releaseTimer);
    }
  },
);

const LINE_CLASS_BY_BLOCK: Record<string, string> = {
  ATXHeading1: "cm-atomic-h1",
  ATXHeading2: "cm-atomic-h2",
  ATXHeading3: "cm-atomic-h3",
  ATXHeading4: "cm-atomic-h4",
  ATXHeading5: "cm-atomic-h5",
  ATXHeading6: "cm-atomic-h6",
  SetextHeading1: "cm-atomic-h1",
  SetextHeading2: "cm-atomic-h2",
  Blockquote: "cm-atomic-blockquote",
  FencedCode: "cm-atomic-fenced-code",
};

const HIDEABLE_SYNTAX = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "LinkMark",
  "URL",
  "LinkTitle",
  "StrikethroughMark",
  "QuoteMark",
]);

const LINK_CHILD_SYNTAX = new Set(["LinkMark", "URL", "LinkTitle"]);

const INLINE_MARK_CLASS: Record<string, string> = {
  StrongEmphasis: "cm-atomic-strong",
  Emphasis: "cm-atomic-em",
  InlineCode: "cm-atomic-inline-code",
  Strikethrough: "cm-atomic-strike",
  Link: "cm-atomic-link",
};

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-atomic-list-marker cm-atomic-bullet";
    span.textContent = "•";
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const BULLET_WIDGET = new BulletWidget();

class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-atomic-list-marker cm-atomic-task-checkbox";
    input.setAttribute("contenteditable", "false");
    input.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    input.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(input);
      if (pos < 0) return;
      const current = view.state.doc.sliceString(pos, pos + 3);
      const next = /\[x\]/i.test(current) ? "[ ]" : "[x]";
      if (current === next) return;
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: next } });
    });
    return input;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super();
  }

  eq(other: ImagePreviewWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.className = "cm-atomic-image";
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    img.decoding = "async";
    img.setAttribute("contenteditable", "false");
    return img;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function pushReplace(
  ranges: Range<Decoration>[],
  doc: Text,
  from: number,
  to: number,
  spec: Parameters<typeof Decoration.replace>[0] = {},
): void {
  if (from >= to) return;
  const startLine = doc.lineAt(from);
  if (to <= startLine.to) {
    ranges.push(Decoration.replace(spec).range(from, to));
    return;
  }

  let cursor = from;
  let first = true;
  while (cursor < to) {
    const line = doc.lineAt(cursor);
    const segEnd = Math.min(to, line.to);
    if (segEnd > cursor) {
      ranges.push(Decoration.replace(first ? spec : {}).range(cursor, segEnd));
      first = false;
    }
    cursor = line.to + 1;
  }
}

function imageParts(node: SyntaxNode, doc: Text): { alt: string; url: string } | null {
  let open: SyntaxNode | null = null;
  let close: SyntaxNode | null = null;
  let urlNode: SyntaxNode | null = null;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "URL") {
      urlNode = child;
    } else if (child.name === "LinkMark") {
      if (!open) open = child;
      else if (!close) close = child;
    }
  }

  if (!open || !close || !urlNode) return null;
  return {
    alt: doc.sliceString(open.to, close.from),
    url: doc.sliceString(urlNode.from, urlNode.to),
  };
}

function buildInlineDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  const listLineLayouts = new Map<
    number,
    { paddingEm: number; markerLine: boolean; alcoveEm: number }
  >();

  if (view.hasFocus) {
    for (const range of state.selection.ranges) {
      const firstLine = doc.lineAt(range.from).number;
      const lastLine = doc.lineAt(range.to).number;
      for (let line = firstLine; line <= lastLine; line++) activeLines.add(line);
    }
  }

  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
  const activeLinkStarts = new Set<number>();

  tree.iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        let anyActive = false;
        for (let line = firstLine; line <= lastLine; line++) {
          if (activeLines.has(line)) {
            anyActive = true;
            break;
          }
        }
        if (anyActive) {
          for (let line = firstLine; line <= lastLine; line++) activeLines.add(line);
        }
      }

      if (node.name === "Link" && view.hasFocus) {
        for (const range of state.selection.ranges) {
          if (range.from <= node.to && range.to >= node.from) {
            activeLinkStarts.add(node.from);
            break;
          }
        }
      }

      if (node.name === "Image" && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;
        const parts = imageParts(node.node, doc);
        const src = parts && !activeLines.has(lineNum) ? safeUrl(parts.url) : null;
        if (parts && src) {
          pushReplace(ranges, doc, node.from, node.to, {
            widget: new ImagePreviewWidget(src, parts.alt),
          });
        }
        return false;
      }

      const lineClass = LINE_CLASS_BY_BLOCK[node.name];
      if (lineClass) {
        const firstLine = doc.lineAt(node.from);
        const lastLine = doc.lineAt(node.to);
        for (let n = firstLine.number; n <= lastLine.number; n++) {
          const line = doc.line(n);
          ranges.push(Decoration.line({ class: lineClass }).range(line.from));
        }
      }

      const markClass = INLINE_MARK_CLASS[node.name];
      if (markClass && node.from < node.to) {
        ranges.push(Decoration.mark({ class: markClass }).range(node.from, node.to));
      }

      if (HIDEABLE_SYNTAX.has(node.name) && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;
        let shouldHide: boolean;
        if (LINK_CHILD_SYNTAX.has(node.name)) {
          let parent: SyntaxNode | null = node.node.parent;
          while (parent && parent.name !== "Link" && parent.name !== "Image") parent = parent.parent;
          shouldHide = parent?.name === "Link" ? !activeLinkStarts.has(parent.from) : !activeLines.has(lineNum);
        } else {
          shouldHide = !activeLines.has(lineNum);
        }

        if (shouldHide) {
          let hideTo = node.to;
          if (node.name === "HeaderMark" || node.name === "QuoteMark") {
            while (hideTo < doc.length && doc.sliceString(hideTo, hideTo + 1) === " ") hideTo++;
          }
          pushReplace(ranges, doc, node.from, hideTo);
        }
      }

      if (node.name === "Escape" && node.to - node.from >= 2) {
        const lineNum = doc.lineAt(node.from).number;
        if (!activeLines.has(lineNum)) pushReplace(ranges, doc, node.from, node.from + 1);
      }

      if (node.name === "ListMark" && node.from < node.to) {
        const line = doc.lineAt(node.from);
        const taskLead = line.text.match(/^(\s*[-*+]\s+)\[[ xX]\]/);
        const taskFrom = taskLead ? line.from + taskLead[1].length : undefined;
        const layout = listLayoutFromMarker(node.from, line);
        listLineLayouts.set(line.from, { ...layout, markerLine: true });

        const hasTrailingSpace = doc.sliceString(node.to, node.to + 1) === " ";
        const markEnd = hasTrailingSpace ? node.to + 1 : node.to;
        const markText = doc.sliceString(node.from, node.to);

        if (taskFrom !== undefined) {
          pushReplace(ranges, doc, line.from, taskFrom);
        } else if (markText === "-" || markText === "*" || markText === "+") {
          pushReplace(ranges, doc, line.from, markEnd, { widget: BULLET_WIDGET });
        } else {
          pushReplace(ranges, doc, line.from, node.from);
          ranges.push(Decoration.mark({ class: "cm-atomic-list-marker" }).range(node.from, node.to));
          if (hasTrailingSpace) pushReplace(ranges, doc, node.to, markEnd);
        }
      }

      if (node.name === "ListItem" && node.from < node.to) {
        const firstLine = doc.lineAt(node.from);
        const markerMatch = firstLine.text.match(/^(\s*)(?:[-*+]|\d+[.)])(?:\s+|$)/);
        if (!markerMatch) return;

        const layout = listLayoutFromMarker(firstLine.from + markerMatch[1].length, firstLine);
        const lastLine = doc.lineAt(node.to);
        for (let lineNumber = firstLine.number + 1; lineNumber <= lastLine.number; lineNumber++) {
          const line = doc.line(lineNumber);
          if (/^\s*(?:[-*+]|\d+[.)])(?:\s+|$)/.test(line.text)) continue;
          const existing = listLineLayouts.get(line.from);
          if (!existing || layout.paddingEm > existing.paddingEm) {
            listLineLayouts.set(line.from, { ...layout, markerLine: false });
          }
        }
      }

      if (node.name === "TaskMarker" && node.from < node.to) {
        const checked = /\[x\]/i.test(doc.sliceString(node.from, node.to));
        const hasTrailingSpace = doc.sliceString(node.to, node.to + 1) === " ";
        pushReplace(ranges, doc, node.from, hasTrailingSpace ? node.to + 1 : node.to, {
          widget: new TaskCheckboxWidget(checked),
        });
        if (checked) {
          const line = doc.lineAt(node.from);
          ranges.push(Decoration.line({ class: "cm-atomic-task-done" }).range(line.from));
        }
      }
    },
  });

  if (view.hasFocus) {
    const head = state.selection.main.head;
    const line = doc.lineAt(head);
    if (activeLines.has(line.number)) {
      supplementMidTypingEmphasis(line.text, line.from, head - line.from, ranges);
    }
  }

  for (const [lineFrom, layout] of listLineLayouts) {
    ranges.push(
      Decoration.line({
        attributes: {
          style: layout.markerLine
            ? `padding-left: ${layout.paddingEm}em; text-indent: -${layout.alcoveEm}em`
            : `padding-left: ${layout.paddingEm}em; text-indent: 0`,
        },
      }).range(lineFrom),
    );
  }

  return Decoration.set(ranges, true);
}

function listLayoutFromMarker(markerFrom: number, line: { from: number }): {
  paddingEm: number;
  alcoveEm: number;
} {
  const rawIndent = markerFrom - line.from;
  const depth = Math.max(0, Math.floor(rawIndent / 2));
  const baseEm = 0.8;
  const alcoveEm = 1.2;
  const levelEm = 0.6;
  return {
    paddingEm: baseEm + alcoveEm + depth * levelEm,
    alcoveEm,
  };
}

const MID_TYPING_DELIMITERS = [
  { delim: "**", contentCls: "cm-atomic-strong", delimCls: "cm-atomic-strong-mark" },
  { delim: "__", contentCls: "cm-atomic-strong", delimCls: "cm-atomic-strong-mark" },
  { delim: "~~", contentCls: "cm-atomic-strike", delimCls: "cm-atomic-strike-mark" },
  { delim: "*", contentCls: "cm-atomic-em", delimCls: "cm-atomic-em-mark" },
  { delim: "_", contentCls: "cm-atomic-em", delimCls: "cm-atomic-em-mark" },
] as const;

function supplementMidTypingEmphasis(
  text: string,
  lineFrom: number,
  localCursor: number,
  out: Range<Decoration>[],
): void {
  const consumed = new Uint8Array(text.length);
  for (const { delim, contentCls, delimCls } of MID_TYPING_DELIMITERS) {
    const dLen = delim.length;
    const isUnderscore = delim === "_" || delim === "__";
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const open = indexOfUnconsumed(text, delim, searchFrom, consumed);
      if (open < 0) break;
      if (isUnderscore && open > 0 && /\w/.test(text[open - 1])) {
        searchFrom = open + dLen;
        continue;
      }
      const close = indexOfUnconsumed(text, delim, open + dLen, consumed);
      if (close < 0) break;
      for (let i = open; i < close + dLen; i++) consumed[i] = 1;
      const contentFrom = open + dLen;
      const contentTo = close;
      if (contentFrom < contentTo && localCursor > open && localCursor < close + dLen) {
        out.push(Decoration.mark({ class: contentCls }).range(lineFrom + contentFrom, lineFrom + contentTo));
        out.push(Decoration.mark({ class: delimCls }).range(lineFrom + open, lineFrom + contentFrom));
        out.push(Decoration.mark({ class: delimCls }).range(lineFrom + contentTo, lineFrom + close + dLen));
      }
      searchFrom = close + dLen;
    }
  }
}

function indexOfUnconsumed(text: string, needle: string, from: number, consumed: Uint8Array): number {
  let cursor = from;
  while (cursor <= text.length - needle.length) {
    const found = text.indexOf(needle, cursor);
    if (found < 0) return -1;
    let used = false;
    for (let i = found; i < found + needle.length; i++) {
      if (consumed[i]) {
        used = true;
        break;
      }
    }
    if (!used) return found;
    cursor = found + 1;
  }
  return -1;
}

const inlinePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }

    update(update: ViewUpdate) {
      const prevFrozen = update.startState.field(previewFrozenField);
      const nextFrozen = update.state.field(previewFrozenField);
      const justUnfroze = prevFrozen && !nextFrozen;
      if (nextFrozen && !justUnfroze && !update.docChanged) return;
      if (justUnfroze || update.docChanged || update.selectionSet || update.focusChanged) {
        this.decorations = buildInlineDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function insertTightListItem(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const from = sel.from;
  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const prefix = lineText.match(/^(\s*)([-*+])(\s+)/);
  if (!prefix) return false;

  const [, indent, marker] = prefix;
  const rest = lineText.slice(prefix[0].length);
  const taskMatch = rest.match(/^(\[[ xX]\])(\s*)/);
  const taskPrefixLen = taskMatch ? taskMatch[0].length : 0;
  const contentAfterPrefix = rest.slice(taskPrefixLen);

  if (!contentAfterPrefix.trim()) {
    const depth = Math.floor(indent.length / 2);
    if (depth >= 1) {
      const outerIndent = indent.slice(0, indent.length - 2);
      const continuation = taskMatch ? `${marker} [ ] ` : `${marker} `;
      const replacement = `${outerIndent}${continuation}`;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: replacement },
        selection: EditorSelection.cursor(line.from + replacement.length),
      });
    } else {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: EditorSelection.cursor(line.from),
      });
    }
    return true;
  }

  const continuation = taskMatch ? `${marker} [ ] ` : `${marker} `;
  const insert = `\n${indent}${continuation}`;
  view.dispatch({
    changes: { from, to: from, insert },
    selection: EditorSelection.cursor(from + insert.length),
  });
  return true;
}

function makeLinkClickHandler(onLinkClick: (url: string) => void): Extension {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      if (event.button !== 0) return false;
      const link = linkIconHitTarget(event, view.contentDOM);
      if (!link) return false;
      const pos = view.posAtDOM(link);
      if (pos < 0) return false;
      const tree = syntaxTree(view.state);
      let node: SyntaxNode | null = tree.resolveInner(pos, 1);
      while (node && node.name !== "Link") node = node.parent;
      const urlNode = node?.getChild("URL");
      if (!urlNode) return false;
      const url = view.state.doc.sliceString(urlNode.from, urlNode.to);
      if (!url) return false;
      event.preventDefault();
      event.stopPropagation();
      onLinkClick(url);
      return true;
    },
  });
}

export function inlinePreview(config: InlinePreviewConfig = {}): Extension {
  const { onLinkClick = defaultOnLinkClick } = config;
  return [
    previewFrozenField,
    inlinePreviewPlugin,
    freezeMousePlugin,
    makeLinkClickHandler(onLinkClick),
    Prec.highest(keymap.of([{ key: "Enter", run: insertTightListItem }])),
  ];
}
