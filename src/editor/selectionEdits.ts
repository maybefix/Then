import { classifyLines, parseInlines } from "./ast/documentAst";

export type LayoutDirection = "start" | "center" | "end";

export type EditorSelectionSnapshot = {
  from: number;
  to: number;
  text: string;
};

export function normalizeSelectionRange(
  selection: { from: number; to: number },
  text: string,
): EditorSelectionSnapshot {
  const from = Math.max(0, Math.min(text.length, Math.min(selection.from, selection.to)));
  const to = Math.max(from, Math.min(text.length, Math.max(selection.from, selection.to)));

  return {
    from,
    to,
    text: text.slice(from, to),
  };
}

export function sanitizeNotationArgument(value: string): string {
  return value.replace(/[\r\n\])]/g, " ").replace(/\s+/g, " ").trim();
}

export function canWrapInlineSelection(selection: EditorSelectionSnapshot): boolean {
  return selection.from < selection.to && !selection.text.includes("\n");
}

function stripDirectionMarkers(line: string): string {
  // 読み込み（documentAst の cleanLineTextForAst）と同じく、旧来の地付きも外す。
  return line
    .replace(/\[\(al:(?:start|center|end)\)\]/g, "")
    .replace(/^［＃地付き］/, "")
    .replace(/^>>\s*/, "");
}

function applyDirectionToLine(line: string, direction: LayoutDirection): string {
  const cleaned = stripDirectionMarkers(line);
  return `${cleaned}[(al:${direction})]`;
}

export function applyDirectionToSelection(
  text: string,
  selection: EditorSelectionSnapshot,
  direction: LayoutDirection,
): { from: number; to: number; insert: string; cursorPos: number } {
  const rangeStart = selection.from;
  const rangeEnd = selection.to > selection.from ? selection.to : selection.from;
  const start = text.lastIndexOf("\n", Math.max(0, rangeStart - 1)) + 1;
  const normalizedEnd = rangeEnd > rangeStart && text[rangeEnd - 1] === "\n"
    ? rangeEnd - 1
    : rangeEnd;
  const nextBreak = text.indexOf("\n", normalizedEnd);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const insert = text
    .slice(start, end)
    .split("\n")
    .map((line) => applyDirectionToLine(line, direction))
    .join("\n");

  return {
    from: start,
    to: end,
    insert,
    cursorPos: start + insert.length,
  };
}

function rangesTouch(
  selectionFrom: number,
  selectionTo: number,
  markupFrom: number,
  markupTo: number,
): boolean {
  if (selectionFrom === selectionTo) {
    return markupFrom <= selectionFrom && selectionFrom <= markupTo;
  }

  return markupFrom < selectionTo && markupTo > selectionFrom;
}

function pushClearReplacement(
  replacements: Array<{ from: number; to: number; insert: string }>,
  from: number,
  to: number,
  insert: string,
): void {
  if (to <= from) return;
  if (replacements.some((item) => from < item.to && to > item.from)) return;
  replacements.push({ from, to, insert });
}

function clearNotationInLine(
  line: string,
  selectionFrom: number,
  selectionTo: number,
): { text: string; changed: boolean } {
  const replacements: Array<{ from: number; to: number; insert: string }> = [];
  let match: RegExpExecArray | null;

  const layout = /\[([^\[\]\n]*?)\s*\((rb|em|tcy)(?:,([^)]*))?\)\]/g;
  while ((match = layout.exec(line))) {
    const full = match[0];
    const from = match.index;
    const to = from + full.length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1].replace(/\s+$/, ""));
    }
  }

  const pipeRuby = /｜([^《》｜]+)《([^《》]+)》/g;
  while ((match = pipeRuby.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const kanjiRuby = /([一-龠々〆ヶ]+)《([^《》]+)》/g;
  while ((match = kanjiRuby.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const emphasis = /《《([^《》]+)》》/g;
  while ((match = emphasis.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const bold = /\*\*([^*]+)\*\*/g;
  while ((match = bold.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const align = /\[\(al:(?:start|center|end)\)\]/g;
  while ((match = align.exec(line))) {
    pushClearReplacement(replacements, match.index, match.index + match[0].length, "");
  }

  // 旧来の地付き（行頭の ［＃地付き］ と >>）も、[(al:…)] と同じく行の指示として外す。
  const legacyJitsuki = /^(?:［＃地付き］|>>\s*)/.exec(line);
  if (legacyJitsuki) {
    pushClearReplacement(replacements, 0, legacyJitsuki[0].length, "");
  }

  // Notation-like text inside inline code is literal and stays as typed.
  const codeSpans = parseInlines(line).filter((markup) => markup.type === "code");
  const outsideCode = replacements.filter(
    (replacement) =>
      !codeSpans.some(
        (span) =>
          replacement.from < span.fullRange.offset + span.fullRange.length &&
          span.fullRange.offset < replacement.to,
      ),
  );
  if (outsideCode.length === 0) {
    return { text: line, changed: false };
  }

  outsideCode.sort((left, right) => right.from - left.from);
  let next = line;
  for (const replacement of outsideCode) {
    next = `${next.slice(0, replacement.from)}${replacement.insert}${next.slice(replacement.to)}`;
  }

  return { text: next, changed: true };
}

export function clearNotationFromSelection(
  text: string,
  selection: EditorSelectionSnapshot,
): { from: number; to: number; insert: string; cursorPos: number; changed: boolean } {
  const rangeStart = selection.from;
  const rangeEnd = selection.to > selection.from ? selection.to : selection.from;
  const start = text.lastIndexOf("\n", Math.max(0, rangeStart - 1)) + 1;
  const normalizedEnd = rangeEnd > rangeStart && text[rangeEnd - 1] === "\n"
    ? rangeEnd - 1
    : rangeEnd;
  const nextBreak = text.indexOf("\n", normalizedEnd);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(start, end).split("\n");
  // Roles depend on the whole document (a fence may open far above the selection).
  const firstLine = text.slice(0, start).split("\n").length - 1;
  const roles = classifyLines(text.split("\n"));
  let offset = start;
  let changed = false;

  const insert = lines
    .map((line, index) => {
      const lineStart = offset;
      const lineEnd = lineStart + line.length;
      offset = lineEnd + 1;
      // Code and comment lines are literal; nothing in them is notation.
      if (roles[firstLine + index]) return line;
      const localFrom = Math.max(0, Math.min(line.length, selection.from - lineStart));
      const localTo = selection.from === selection.to
        ? localFrom
        : Math.max(0, Math.min(line.length, selection.to - lineStart));
      const result = clearNotationInLine(line, localFrom, localTo);
      changed = changed || result.changed;
      return result.text;
    })
    .join("\n");

  return {
    from: start,
    to: end,
    insert,
    cursorPos: Math.min(start + insert.length, selection.from),
    changed,
  };
}

export type SelectionEdit = {
  from: number;
  to: number;
  insert: string;
  cursorPos: number;
};

/** Ctrl+B 用。選択範囲を `**…**` で囲む／外すトグル。複数行は対象外。 */
export function toggleBoldSelection(
  text: string,
  selection: EditorSelectionSnapshot,
): SelectionEdit | null {
  const { from, to } = selection;
  if (from === to) {
    return { from, to, insert: "****", cursorPos: from + 2 };
  }

  const inner = text.slice(from, to);
  if (inner.includes("\n")) return null;

  if (text.slice(from - 2, from) === "**" && text.slice(to, to + 2) === "**") {
    return { from: from - 2, to: to + 2, insert: inner, cursorPos: from - 2 + inner.length };
  }

  if (inner.length >= 4 && inner.startsWith("**") && inner.endsWith("**")) {
    const stripped = inner.slice(2, -2);
    return { from, to, insert: stripped, cursorPos: from + stripped.length };
  }

  const insert = `**${inner}**`;
  return { from, to, insert, cursorPos: from + insert.length };
}

/** Ctrl+I 用。選択範囲に圏点 `[…(em,goma)]` を付ける／外すトグル。複数行は対象外。 */
export function toggleEmphasisSelection(
  text: string,
  selection: EditorSelectionSnapshot,
): SelectionEdit | null {
  const { from, to } = selection;
  if (from >= to) return null;

  const inner = text.slice(from, to);
  if (inner.includes("\n")) return null;

  const enclosed = text.slice(to).match(/^\(em[^)]*\)\]/);
  if (text[from - 1] === "[" && enclosed) {
    return {
      from: from - 1,
      to: to + enclosed[0].length,
      insert: inner,
      cursorPos: from - 1 + inner.length,
    };
  }

  const selfMatch = inner.match(/^\[(.+)\(em[^)]*\)\]$/);
  if (selfMatch) {
    return { from, to, insert: selfMatch[1], cursorPos: from + selfMatch[1].length };
  }

  // 青空文庫形式の圏点 《《…》》 も、中身か全体を選んでいれば外す。
  if (
    !/[《》]/.test(inner) &&
    text.slice(from - 2, from) === "《《" &&
    text.slice(to, to + 2) === "》》"
  ) {
    return { from: from - 2, to: to + 2, insert: inner, cursorPos: from - 2 + inner.length };
  }

  const aozoraMatch = inner.match(/^《《([^《》]+)》》$/);
  if (aozoraMatch) {
    return { from, to, insert: aozoraMatch[1], cursorPos: from + aozoraMatch[1].length };
  }

  const insert = `[${inner}(em,goma)]`;
  return { from, to, insert, cursorPos: from + insert.length };
}

/**
 * 右クリックの「縦中横」用。圏点（toggleEmphasisSelection）と同じく、縦中横の中身か全体を
 * 選んでいれば外し、そうでなければ付ける。複数行は対象外。
 */
export function toggleTcySelection(
  text: string,
  selection: EditorSelectionSnapshot,
): SelectionEdit | null {
  const { from, to } = selection;
  if (from >= to) return null;

  const inner = text.slice(from, to);
  if (inner.includes("\n")) return null;

  const enclosed = text.slice(to).match(/^\(tcy[^)]*\)\]/);
  if (text[from - 1] === "[" && enclosed && !/[[\]]/.test(inner)) {
    return {
      from: from - 1,
      to: to + enclosed[0].length,
      insert: inner,
      cursorPos: from - 1 + inner.length,
    };
  }

  // 中身に [ ] を含むものは当てはめない（[a(tcy)][b(tcy)] を1つと見ないため）。
  const selfMatch = inner.match(/^\[([^[\]]+)\(tcy[^)]*\)\]$/);
  if (selfMatch) {
    return { from, to, insert: selfMatch[1], cursorPos: from + selfMatch[1].length };
  }

  const insert = `[${inner}(tcy)]`;
  return { from, to, insert, cursorPos: from + insert.length };
}

// 青空文庫形式で、《 の前に続けて書くとルビの付く文字（documentAst の読み込みと同じ）。
const RUBY_BASE_CHARS = /^[一-龠々〆ヶ]+$/;

export type RubyAtSelection = {
  /** ルビの記法全体の範囲。 */
  from: number;
  to: number;
  /** then: [本文(rb,読み)]、bar: ｜本文《読み》、kanji: 漢字《読み》 */
  form: "then" | "bar" | "kanji";
  base: string;
  reading: string;
};

/**
 * すでに付いたルビ（[本文(rb,…)]、｜本文《…》、漢字《…》）の中身か全体を選んでいれば、
 * そのルビを返す。ルビのダイアログの読みの欄と、読みの置き換え（applyRubyToSelection）で使う。
 */
export function findRubyAtSelection(
  text: string,
  selection: EditorSelectionSnapshot,
): RubyAtSelection | null {
  const { from, to } = selection;
  const inner = text.slice(from, to);
  const before = text[from - 1] ?? "";

  const enclosed = text.slice(to).match(/^\(rb,([^)]*)\)\]/);
  if (before === "[" && enclosed && !/[[\]]/.test(inner)) {
    return { from: from - 1, to: to + enclosed[0].length, form: "then", base: inner, reading: enclosed[1] };
  }
  const selfThen = inner.match(/^\[([^[\]]+)\(rb,([^)]*)\)\]$/);
  if (selfThen) return { from, to, form: "then", base: selfThen[1], reading: selfThen[2] };

  // 《《…》》 は圏点なので、《 のすぐ後ろが 《 でないものだけをルビと見る。
  const rubyMark = text.slice(to).match(/^《([^《》]+)》/);
  if (rubyMark && !/[《》｜]/.test(inner)) {
    if (before === "｜") {
      return { from: from - 1, to: to + rubyMark[0].length, form: "bar", base: inner, reading: rubyMark[1] };
    }
    // ルビの付く語の一部だけ（前に漢字が続く）を選んでいるときは、当たらない。
    if (RUBY_BASE_CHARS.test(inner) && !RUBY_BASE_CHARS.test(before)) {
      return { from, to: to + rubyMark[0].length, form: "kanji", base: inner, reading: rubyMark[1] };
    }
  }
  const selfBar = inner.match(/^｜([^《》｜]+)《([^《》]+)》$/);
  if (selfBar) return { from, to, form: "bar", base: selfBar[1], reading: selfBar[2] };
  const selfKanji = inner.match(/^([一-龠々〆ヶ]+)《([^《》]+)》$/);
  if (selfKanji && !RUBY_BASE_CHARS.test(before)) {
    return { from, to, form: "kanji", base: selfKanji[1], reading: selfKanji[2] };
  }

  return null;
}

/**
 * ルビのダイアログの「反映」用。すでに付いたルビ（findRubyAtSelection）に当たれば、
 * 書き方はそのままで読みだけを置き換える。そうでなければ付ける。
 * reading は sanitizeNotationArgument で整えたもの。
 */
export function applyRubyToSelection(
  text: string,
  selection: EditorSelectionSnapshot,
  reading: string,
): SelectionEdit {
  const found = findRubyAtSelection(text, selection);
  const from = found?.from ?? selection.from;
  const to = found?.to ?? selection.to;
  const base = found?.base ?? text.slice(selection.from, selection.to);
  let insert = `[${base}(rb,${reading})]`;
  if (found && found.form !== "then") {
    // 読みの中の 《 》 は、ルビの終わりをずらすので空白にする。
    const aozoraReading = reading.replace(/[《》]/g, " ").replace(/\s+/g, " ").trim();
    insert = `${found.form === "bar" ? "｜" : ""}${base}《${aozoraReading}》`;
  }
  return { from, to, insert, cursorPos: from + insert.length };
}

/**
 * Ctrl+数字 用。選択範囲を含む各行の見出しレベルを設定する。
 * `level` が 0 の場合は見出しマーカーを除去する。
 */
export function applyHeadingToSelection(
  text: string,
  selection: EditorSelectionSnapshot,
  level: number,
): SelectionEdit {
  const rangeStart = selection.from;
  const rangeEnd = selection.to > selection.from ? selection.to : selection.from;
  const start = text.lastIndexOf("\n", Math.max(0, rangeStart - 1)) + 1;
  const normalizedEnd =
    rangeEnd > rangeStart && text[rangeEnd - 1] === "\n" ? rangeEnd - 1 : rangeEnd;
  const nextBreak = text.indexOf("\n", normalizedEnd);
  const end = nextBreak === -1 ? text.length : nextBreak;

  const insert = text
    .slice(start, end)
    .split("\n")
    .map((line) => {
      const body = line.replace(/^#{1,6}[ \t]*/, "");
      if (level <= 0) return body;
      return `${"#".repeat(Math.min(6, level))} ${body}`;
    })
    .join("\n");

  return { from: start, to: end, insert, cursorPos: start + insert.length };
}
