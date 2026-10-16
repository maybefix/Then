// Reading and editing front matter as typed properties (the properties form).
// Every edit rewrites only the lines of the property it touches; other lines,
// comments and formatting stay byte for byte. Values the form cannot represent
// are shown read-only and left alone (FM-24).
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit, type Node } from "yaml";
import { analyzeFrontMatter, type FrontMatterIssue } from "../utils/frontmatterYaml";

export type PropertyType = "text" | "number" | "checkbox" | "date" | "datetime" | "list";

export type PropertyValue = string | boolean | string[] | null;

/** Why a property is shown read-only. */
export type ReadOnlyReason =
  | "structure" // nested map, multi-line text, alias, anchor, tag, non-decimal number…
  | "comment" // a comment inside the value would be lost
  | "type-mismatch"; // the saved type does not fit the value (FM-20)

export type PropertyRow = {
  key: string;
  type: PropertyType;
  /** Typed value; null when the property is empty. Only meaningful when editable. */
  value: PropertyValue;
  readOnly: ReadOnlyReason | null;
  /** The property's own lines, as written. */
  raw: string;
  /** 0-based first line inside the metadata. */
  startLine: number;
  /** Number of lines the property occupies. */
  lineCount: number;
};

export type PropertySheet = {
  rows: PropertyRow[];
  /** Non-empty when the YAML is invalid; the form must not write in that case. */
  errors: FrontMatterIssue[];
};

/** Saved type per property name, shared across the library (FM-21). */
export type PropertyTypeSettings = Readonly<Record<string, PropertyType>>;

const TOP_LEVEL_KEY = /^(?:"[^"]*"|'[^']*'|[^\s#\-?:'"][^:]*?|-[^\s:][^:]*?)\s*:(?:\s|$)/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

type Segment = { start: number; end: number }; // [start, end) line indexes

function splitLines(metadata: string): { lines: string[]; newline: string } {
  return {
    lines: metadata.split(/\r?\n/),
    newline: metadata.includes("\r\n") ? "\r\n" : "\n",
  };
}

/**
 * Lines belonging to each top-level key: the key line plus following indented
 * lines (blank lines inside count when more indented lines follow).
 */
function segmentEntries(lines: string[]): Segment[] {
  const segments: Segment[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!TOP_LEVEL_KEY.test(lines[index])) {
      index += 1;
      continue;
    }
    let end = index + 1;
    let lookahead = end;
    while (lookahead < lines.length) {
      const line = lines[lookahead];
      if (/^\s+\S/.test(line)) end = lookahead + 1;
      else if (line.trim() !== "") break;
      lookahead += 1;
    }
    segments.push({ start: index, end });
    index = end;
  }
  return segments;
}

function hasComment(node: unknown, documentComment: string | null | undefined): boolean {
  if (documentComment) return true;
  let found = false;
  visit(node as Node, (_key, child) => {
    const commented = child as { comment?: string | null; commentBefore?: string | null };
    if (commented.comment || commented.commentBefore) {
      found = true;
      return visit.BREAK;
    }
    return undefined;
  });
  return found;
}

type Reading = { type: PropertyType; value: PropertyValue } | { type: null };

/** The type a value clearly has on its own (FM-20 step ②), or null for "only as text". */
function readValue(node: unknown): Reading {
  if (node === null || node === undefined) return { type: "text", value: null };
  if (isAlias(node)) return { type: null };
  const tagged = node as { anchor?: string; tag?: string };
  if (tagged.anchor || tagged.tag) return { type: null };

  if (isScalar(node)) {
    const source = (node as { source?: string }).source ?? String(node.value ?? "");
    if (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") return { type: null };
    if (node.value === null) return { type: "text", value: null };
    if (node.type !== "PLAIN") {
      return typeof node.value === "string" && !node.value.includes("\n")
        ? { type: "text", value: node.value }
        : { type: null };
    }
    if (typeof node.value === "boolean") {
      return source === "true" || source === "false"
        ? { type: "checkbox", value: node.value }
        : { type: null };
    }
    if (typeof node.value === "number") {
      return DECIMAL.test(source) ? { type: "number", value: source } : { type: null };
    }
    const text = String(node.value);
    if (DATE.test(text)) return { type: "date", value: text };
    if (DATETIME.test(text)) return { type: "datetime", value: text.replace(" ", "T") };
    return { type: "text", value: text };
  }

  if (isSeq(node)) {
    const items: string[] = [];
    for (const item of node.items) {
      if (!isScalar(item) || item.type === "BLOCK_LITERAL" || item.type === "BLOCK_FOLDED") return { type: null };
      if ((item as { anchor?: string; tag?: string }).anchor || (item as { tag?: string }).tag) return { type: null };
      items.push(item.value === null ? "" : String(item.value));
    }
    return { type: "list", value: items };
  }

  return { type: null }; // nested map
}

/** Can an existing value be shown under the saved type without converting it? */
function fits(type: PropertyType, reading: Reading): boolean {
  if (reading.type === null) return false;
  if (reading.value === null) return true; // empty fits every type
  if (reading.type === type) return true;
  // Plain text that happens to be a date is still text when the user chose text.
  return type === "text" && (reading.type === "date" || reading.type === "datetime" || reading.type === "number");
}

export function readProperties(metadata: string, typeSettings: PropertyTypeSettings = {}): PropertySheet {
  const analysis = analyzeFrontMatter(metadata);
  if (analysis.errors.length > 0) return { rows: [], errors: analysis.errors };

  const { lines, newline } = splitLines(metadata);
  const rows: PropertyRow[] = [];
  for (const segment of segmentEntries(lines)) {
    const raw = lines.slice(segment.start, segment.end).join(newline);
    const document = parseDocument(raw);
    const pair = isMap(document.contents) ? document.contents.items[0] : undefined;
    if (!pair) continue;
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const reading = readValue(pair.value);
    const saved = typeSettings[key];

    let type: PropertyType;
    let readOnly: ReadOnlyReason | null = null;
    if (reading.type === null) {
      type = saved ?? "text";
      readOnly = "structure";
    } else if (saved) {
      type = saved;
      if (!fits(saved, reading)) readOnly = "type-mismatch";
    } else {
      type = reading.type;
    }
    if (!readOnly && hasComment(pair.value ?? null, document.comment)) readOnly = "comment";

    const value = reading.type === null || readOnly === "type-mismatch"
      ? null
      : saved === "text" && reading.value !== null && !Array.isArray(reading.value)
        ? String(reading.value)
        : reading.value;

    rows.push({
      key,
      type,
      value,
      readOnly,
      raw,
      startLine: segment.start,
      lineCount: segment.end - segment.start,
    });
  }
  return { rows, errors: [] };
}

// ---------------------------------------------------------------- writing

const NEEDS_QUOTES =
  /^(?:$|true$|false$|null$|~$|yes$|no$|on$|off$|-?\d|\.\d|[\s\-?:,[\]{}#&*!|>'"%@`])|:\s|\s#|\s$|:$/i;

function quoteIfNeeded(text: string): string {
  return NEEDS_QUOTES.test(text) ? JSON.stringify(text) : text;
}

function formatKey(key: string): string {
  return /^[^\s#\-?:'"[\]{},&*!|>%@`][^:#]*$/.test(key) && key.trim() === key ? key : JSON.stringify(key);
}

/** The lines for one property, as the form writes it. */
export function formatProperty(key: string, type: PropertyType, value: PropertyValue, newline = "\n"): string {
  const name = formatKey(key);
  if (value === null || value === "") return `${name}:`;
  switch (type) {
    case "checkbox":
      return `${name}: ${value === true ? "true" : "false"}`;
    case "number":
    case "date":
    case "datetime":
      return `${name}: ${String(value)}`;
    case "list": {
      const items = Array.isArray(value) ? value : [String(value)];
      if (items.length === 0) return `${name}: []`;
      return [`${name}:`, ...items.map((item) => `  - ${quoteIfNeeded(item)}`)].join(newline);
    }
    default:
      return `${name}: ${quoteIfNeeded(String(value))}`;
  }
}

function findRow(sheet: PropertySheet, key: string): PropertyRow {
  if (sheet.errors.length > 0) throw new Error("YAMLにエラーがあるため、フォームからは書き込めません");
  const row = sheet.rows.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`プロパティ「${key}」がありません`);
  return row;
}

function spliceLines(metadata: string, row: PropertyRow, replacement: string | null): string {
  const { lines, newline } = splitLines(metadata);
  const inserted = replacement === null ? [] : replacement.split(/\r?\n/);
  lines.splice(row.startLine, row.lineCount, ...inserted);
  return lines.join(newline);
}

/** Set a property's value (and type). Only that property's lines change. */
export function setPropertyValue(
  metadata: string,
  key: string,
  type: PropertyType,
  value: PropertyValue,
  typeSettings: PropertyTypeSettings = {},
): string {
  const row = findRow(readProperties(metadata, typeSettings), key);
  if (row.readOnly) throw new Error(`プロパティ「${key}」はフォームでは変更できません`);
  return spliceLines(metadata, row, formatProperty(row.key, type, value, splitLines(metadata).newline));
}

/** Rename a property, keeping its value text as written. */
export function renameProperty(metadata: string, key: string, nextKey: string): string {
  const sheet = readProperties(metadata);
  const row = findRow(sheet, key);
  if (nextKey === key) return metadata;
  if (!nextKey.trim()) throw new Error("名前を入力してください");
  if (sheet.rows.some((candidate) => candidate.key === nextKey)) {
    throw new Error(`「${nextKey}」はすでにあります`);
  }
  const { lines, newline } = splitLines(row.raw);
  const keyEnd = lines[0].match(TOP_LEVEL_KEY)?.[0].replace(/:\s?$/, "").length ?? 0;
  lines[0] = `${formatKey(nextKey)}${lines[0].slice(keyEnd)}`;
  return spliceLines(metadata, row, lines.join(newline));
}

export function removeProperty(metadata: string, key: string): string {
  return spliceLines(metadata, findRow(readProperties(metadata), key), null);
}

/** Append a property at the end. Existing lines are untouched. */
export function addProperty(metadata: string, key: string, type: PropertyType, value: PropertyValue): string {
  const sheet = readProperties(metadata);
  if (sheet.errors.length > 0) throw new Error("YAMLにエラーがあるため、フォームからは書き込めません");
  if (!key.trim()) throw new Error("名前を入力してください");
  if (sheet.rows.some((row) => row.key === key)) throw new Error(`「${key}」はすでにあります`);
  const { newline } = splitLines(metadata);
  const lines = formatProperty(key, type, value, newline);
  if (!metadata.trim()) return lines;
  return /\r?\n$/.test(metadata) ? `${metadata}${lines}` : `${metadata}${newline}${lines}`;
}
