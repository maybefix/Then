export type TableCell = { from: number; to: number };
export type TableRow = {
  cells: TableCell[];
  columns: number;
  alignments: string[];
  kind: "header" | "rule" | "body";
};

export function tableAtOffset(text: string, offset: number) {
  const sources = text.split("\n");
  const line = text.slice(0, offset).split("\n").length - 1;
  const rows = markdownTableRows(sources.map((source) => ({ source })));
  const row = rows.get(line);
  if (!row) return null;
  let header = line;
  while (header > 0 && rows.get(header)?.kind !== "header") header--;
  let end = header + 2;
  while (rows.get(end)?.kind === "body") end++;
  const startAt = (index: number) => sources.slice(0, index).reduce((sum, value) => sum + value.length + 1, 0);
  const local = offset - startAt(line);
  let column = row.cells.findIndex((cell) => local <= cell.to);
  if (column < 0) column = row.cells.length - 1;
  return { sources, rows, row, line, header, end, column, startAt };
}

export function tableAlignmentEdit(text: string, offset: number, alignment: "start" | "center" | "end") {
  const table = tableAtOffset(text, offset);
  if (!table) return null;
  const ruleIndex = table.header + 1;
  const rule = table.rows.get(ruleIndex)!;
  if (table.column >= rule.cells.length) return null;
  const markers = Array.from({ length: rule.cells.length }, (_, column) => {
    const align = column === table.column ? alignment : rule.alignments[column];
    return align === "center" ? ":---:" : align === "end" ? "---:" : ":---";
  });
  const insert = `| ${markers.join(" | ")} |`;
  const from = table.startAt(ruleIndex);
  const to = from + table.sources[ruleIndex].length;
  return { from, to, insert, cursorPos: offset >= to ? offset + insert.length - (to - from) : offset > from ? from : offset };
}

export function createMarkdownTable(columns: number, rows: number): string {
  const header = Array.from({ length: columns }, (_, i) => `見出し${i + 1}`);
  const line = (cells: string[]) => `|${cells.join("|")}|`;
  return [line(header), line(header.map(() => "---")),
    ...Array.from({ length: rows }, () => line(header.map(() => "")))].join("\n");
}

/** Source offsets stay intact, including escaped pipes and empty cells. */
export function splitTableRow(source: string): TableCell[] | null {
  const pipes: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "|") continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && source[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 0) pipes.push(i);
  }
  if (!pipes.length) return null;
  let from = 0;
  let to = source.length;
  if (!source.slice(0, pipes[0]).trim()) from = pipes.shift()! + 1;
  if (pipes.length && !source.slice(pipes[pipes.length - 1] + 1).trim()) to = pipes.pop()!;
  return [...pipes, to].map((end) => {
    const cell = { from, to: end };
    from = end + 1;
    return cell;
  });
}

const cache = new WeakMap<readonly { source: string }[], Map<number, TableRow>>();

export function markdownTableRows(lines: readonly { source: string }[]): Map<number, TableRow> {
  const cached = cache.get(lines);
  if (cached) return cached;
  const rows = new Map<number, TableRow>();
  let fence: { marker: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const source = lines[i].source;
    const fenceMatch = source.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (marker === fence.marker && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
      continue;
    }
    if (fence || /^ {4}|^\t/.test(source) || i + 1 >= lines.length) continue;
    const header = splitTableRow(source);
    const ruleSource = lines[i + 1].source;
    const rule = splitTableRow(ruleSource);
    if (!header || !rule || header.length !== rule.length ||
      !rule.every((cell) => /^:?-{3,}:?$/.test(ruleSource.slice(cell.from, cell.to).trim()))) continue;
    const alignments = rule.map((cell) => {
      const value = ruleSource.slice(cell.from, cell.to).trim();
      return value.endsWith(":") ? (value.startsWith(":") ? "center" : "end") : "start";
    });
    const columns = header.length;
    const tableStart = i;
    let tableColumns = columns;
    rows.set(i, { cells: header, columns, alignments, kind: "header" });
    rows.set(++i, { cells: rule, columns, alignments, kind: "rule" });
    while (i + 1 < lines.length) {
      const next = lines[i + 1].source;
      if (/^\s*(`{3,}|~{3,})|^ {4}|^\t/.test(next)) break;
      const cells = splitTableRow(next);
      if (!cells) break;
      tableColumns = Math.max(tableColumns, cells.length);
      rows.set(++i, { cells, columns: Math.max(columns, cells.length), alignments, kind: "body" });
    }
    for (let line = tableStart; line <= i; line++) rows.get(line)!.columns = tableColumns;
  }
  cache.set(lines, rows);
  return rows;
}
