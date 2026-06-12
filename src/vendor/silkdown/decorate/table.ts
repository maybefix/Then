import type { EditorSelection, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { selectionTouchesLineRange } from "../util/selection.js";
import { children } from "../util/tree.js";
import { MUTED_MARK, pushAtomicRange } from "./shared.js";

const TABLE_LINE = Decoration.line({ class: "sd-table-line" });
const TABLE_HEADER_LINE = Decoration.line({ class: "sd-table-line sd-table-header-line" });
const TABLE_RULE_LINE = Decoration.line({ class: "sd-table-line sd-table-rule-line" });
const TABLE_ROW_LINE = Decoration.line({ class: "sd-table-line sd-table-row-line" });

type ParsedTable = {
  alignments: Array<"left" | "center" | "right" | null>;
  rows: string[][];
};

class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const parsed = parseMarkdownTable(this.source);
    const table = document.createElement("table");
    table.className = "sd-table";
    table.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });

    if (!parsed.rows.length) return table;

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const [index, cell] of parsed.rows[0].entries()) {
      const th = document.createElement("th");
      th.textContent = cell;
      applyAlignment(th, parsed.alignments[index]);
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);

    const bodyRows = parsed.rows.slice(1);
    if (bodyRows.length) {
      const tbody = document.createElement("tbody");
      for (const row of bodyRows) {
        const tr = document.createElement("tr");
        for (const [index, cell] of row.entries()) {
          const td = document.createElement("td");
          td.textContent = cell;
          applyAlignment(td, parsed.alignments[index]);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
    }

    return table;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export function decorateTable(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): boolean {
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  if (!revealed) {
    pushAtomicRange(
      ranges,
      atomicRanges,
      Decoration.replace({
        widget: new TableWidget(doc.sliceString(node.from, node.to), node.from),
        block: true,
      }),
      node.from,
      node.to,
    );
    return true;
  }

  ranges.push(TABLE_LINE.range(doc.lineAt(node.from).from));
  for (const child of children(node)) {
    const line = doc.lineAt(child.from);
    if (child.name === "TableHeader") {
      ranges.push(TABLE_HEADER_LINE.range(line.from));
      muteTableDelimiters(ranges, child);
      continue;
    }
    if (child.name === "TableDelimiter") {
      ranges.push(TABLE_RULE_LINE.range(line.from));
      ranges.push(MUTED_MARK.range(child.from, child.to));
      continue;
    }
    if (child.name === "TableRow") {
      ranges.push(TABLE_ROW_LINE.range(line.from));
      muteTableDelimiters(ranges, child);
    }
  }
  return false;
}

function muteTableDelimiters(ranges: Range<Decoration>[], node: SyntaxNode): void {
  for (const child of children(node)) {
    if (child.name === "TableDelimiter") {
      ranges.push(MUTED_MARK.range(child.from, child.to));
    }
  }
}

function parseMarkdownTable(source: string): ParsedTable {
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  const header = splitTableRow(lines[0] ?? "");
  const alignments = splitTableRow(lines[1] ?? "").map(parseAlignment);
  const body = lines.slice(2).map(splitTableRow);
  const width = Math.max(header.length, alignments.length, ...body.map((row) => row.length), 0);
  return {
    alignments: Array.from({ length: width }, (_, index) => alignments[index] ?? null),
    rows: [normalizeRow(header, width), ...body.map((row) => normalizeRow(row, width))],
  };
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeRow(row: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => row[index] ?? "");
}

function parseAlignment(cell: string): ParsedTable["alignments"][number] {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function applyAlignment(cell: HTMLTableCellElement, alignment: ParsedTable["alignments"][number]): void {
  if (alignment) {
    cell.style.textAlign = alignment;
  }
}
