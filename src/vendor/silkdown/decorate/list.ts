import { Decoration, WidgetType } from "@codemirror/view";
import type { EditorSelection, Range, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { children } from "../util/tree.js";
import { TaskCheckboxWidget } from "../widgets/task.js";
import { pushAtomicRange } from "./shared.js";

type MarkerRange = {
  from: number;
  to: number;
  rawMarker: string;
  indentColumns: number;
};

type TaskRange = {
  from: number;
  to: number;
  checked: boolean;
};

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly marker: string,
    private readonly indentColumns: number,
  ) {
    super();
  }

  eq(other: ListMarkerWidget): boolean {
    return other.marker === this.marker && other.indentColumns === this.indentColumns;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "sd-list-marker";
    span.style.setProperty("--sd-list-indent", `${this.indentColumns}`);
    span.textContent = this.marker;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function getListMarkerRange(lineFrom: number, lineText: string): MarkerRange | null {
  const match = /^(\s*)((?:[-+*]|\d+[.)])(?:\s+|$))/.exec(lineText);
  if (!match) return null;
  const indent = match[1] ?? "";
  const raw = match[2] ?? "";
  const rawMarkerMatch = /[-+*]|\d+[.)]/.exec(raw);
  if (!rawMarkerMatch) return null;

  return {
    from: lineFrom,
    to: lineFrom + indent.length + raw.length,
    rawMarker: rawMarkerMatch[0],
    indentColumns: indent.length,
  };
}

function getTaskRange(lineFrom: number, lineText: string, markerTo: number): TaskRange | null {
  const offset = markerTo - lineFrom;
  const match = /^\[( |x|X)\](?:\s+|$)/.exec(lineText.slice(offset));
  if (!match) return null;

  return {
    from: markerTo,
    to: markerTo + 3,
    checked: match[1].toLowerCase() === "x",
  };
}

function selectionIntersectsRange(sel: EditorSelection, from: number, to: number): boolean {
  for (const range of sel.ranges) {
    if (range.empty) {
      if (range.head >= from && range.head < to) return true;
    } else if (range.from < to && range.to > from) {
      return true;
    }
  }
  return false;
}

function selectionTouchesLine(doc: Text, sel: EditorSelection, lineFrom: number): boolean {
  const line = doc.lineAt(lineFrom);
  for (const range of sel.ranges) {
    const fromLine = doc.lineAt(range.from).number;
    const toLine = doc.lineAt(range.empty ? range.to : Math.max(range.from, range.to - 1)).number;
    if (fromLine <= line.number && line.number <= toLine) return true;
  }
  return false;
}

export function decorateListItem(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
  composing: boolean,
): void {
  const startLine = doc.lineAt(node.from);
  const lineText = startLine.text;
  const markerRange = getListMarkerRange(startLine.from, lineText);
  const indentColumns = markerRange?.indentColumns ?? 0;
  const markerWidth = markerRange ? Math.max(2, markerRange.rawMarker.length + 1) : 2;
  const hangingIndent = indentColumns * 0.85 + markerWidth * 0.72 + 0.35;
  const composingOnLine = composing && selectionTouchesLine(doc, sel, startLine.from);
  ranges.push(
    Decoration.line({
      class: "sd-list-item",
      attributes: {
        style: `--sd-list-hang: ${hangingIndent.toFixed(2)}em;`,
      },
    }).range(startLine.from),
  );

  if (
    markerRange &&
    !selectionIntersectsRange(sel, markerRange.from, markerRange.to) &&
    !composingOnLine
  ) {
    const renderedMarker = /^\d+[.)]$/.test(markerRange.rawMarker) ? markerRange.rawMarker : "•";
    pushAtomicRange(
      ranges,
      atomicRanges,
      Decoration.replace({
        widget: new ListMarkerWidget(renderedMarker, indentColumns),
        inclusive: false,
      }),
      markerRange.from,
      markerRange.to,
    );
  }

  const childNodes = Array.from(children(node));
  const taskFromSyntax = (() => {
    for (const child of childNodes) {
      if (child.name !== "Task") continue;
      for (const inner of children(child)) {
        if (inner.name !== "TaskMarker") continue;
        const text = doc.sliceString(inner.from, inner.to);
        return { from: inner.from, to: inner.to, checked: text.toLowerCase().includes("x") };
      }
    }
    return null;
  })();
  const taskRange = markerRange
    ? getTaskRange(startLine.from, lineText, markerRange.to) ?? taskFromSyntax
    : taskFromSyntax;

  if (
    taskRange &&
    !selectionIntersectsRange(sel, taskRange.from, taskRange.to) &&
    !composingOnLine
  ) {
    pushAtomicRange(
      ranges,
      atomicRanges,
      Decoration.replace({
        widget: new TaskCheckboxWidget(taskRange.checked, taskRange.from, taskRange.to),
        inclusive: false,
      }),
      taskRange.from,
      taskRange.to,
    );
  }

}
