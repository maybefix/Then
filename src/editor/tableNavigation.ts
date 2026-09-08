import { tableAtOffset } from "./markdownTables";

/** Visible cell positions only: hidden pipes, padding and rules are never targets. */
export function tableCaretTarget(text: string, offset: number, key: string, vertical: boolean, shift = false) {
  const table = tableAtOffset(text, offset);
  if (!table) return null;
  const cells: { from: number; to: number; line: number; column: number }[] = [];
  for (let line = table.header; line < table.end; line++) {
    const row = table.rows.get(line)!;
    if (row.kind === "rule") continue;
    for (let column = 0; column < row.columns; column++) {
      const raw = row.cells[column];
      let from = raw?.from ?? table.sources[line].length;
      let to = raw?.to ?? from;
      while (from < to && /[ \t]/.test(table.sources[line][from])) from++;
      while (to > from && /[ \t]/.test(table.sources[line][to - 1])) to--;
      cells.push({ from: table.startAt(line) + from, to: table.startAt(line) + to, line, column });
    }
  }
  let index = cells.findIndex(c => c.line === table.line && c.column === table.column);
  if (index < 0) index = cells.findIndex(c => c.line > table.line);
  if (index < 0) index = cells.length - 1;
  const current = cells[index];
  if (!current) return null;
  const result = (cell: typeof current, pos = cell.from) => ({ ...cell, pos });
  const forward = vertical ? "ArrowDown" : "ArrowRight";
  const backward = vertical ? "ArrowUp" : "ArrowLeft";
  const nextRow = vertical ? "ArrowLeft" : "ArrowDown";
  const previousRow = vertical ? "ArrowRight" : "ArrowUp";
  if (key === "Home") return result(current);
  if (key === "End") return result(current, current.to);
  if (key === "Backspace" && offset <= current.from || key === "Delete" && offset >= current.to) return result(current, Math.max(current.from, Math.min(current.to, offset)));
  let delta = 0;
  if (key === "Tab") delta = shift ? -1 : 1;
  else if (key === forward && offset >= current.to) delta = 1;
  else if (key === backward && offset <= current.from) delta = -1;
  else if (key === nextRow || key === previousRow || key === "Enter") {
    const direction = key === previousRow ? -1 : 1;
    const target = direction > 0
      ? cells.find(c => c.line > current.line && c.column === current.column)
      : cells.slice(0, index).reverse().find(c => c.line < current.line && c.column === current.column);
    if (target) return result(target, Math.min(target.to, target.from + Math.max(0, offset - current.from)));
    delta = direction > 0 ? cells.length - index : -index - 1;
  } else if (offset < current.from || offset > current.to) {
    if (key.startsWith("Arrow")) return result(current, Math.max(current.from, Math.min(current.to, offset)));
  }
  if (!delta) return null;
  const target = cells[index + delta];
  if (target) return result(target, delta < 0 ? target.to : target.from);
  if (delta < 0 && table.header === 0) return { from: 0, to: 0, line: 0, column: -1, pos: 0, insertBefore: true };
  if (delta < 0 && table.header > 0) return { from: 0, to: 0, line: table.header - 1, column: -1, pos: table.startAt(table.header) - 1 };
  if (delta > 0 && table.end < table.sources.length) return { from: 0, to: 0, line: table.end, column: -1, pos: table.startAt(table.end) };
  return result(current, delta < 0 ? current.from : current.to);
}
