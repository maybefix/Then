import type {
  DocumentAst,
  DocumentOutlineItem,
  InlineMarker,
  InlineMarkup,
  LayoutAlign,
  LineKind,
  LineNode,
  RubyItem,
} from "./types";

// Multi-line structure (docs/COMMENT_OUT_SPEC.md, docs/CODE_BLOCK_SPEC.md).
// This is the single place that decides which lines are comments and which are
// code; the AST, editor, proofreading and table detection all use it.
//
// Comments are whole lines:
//   - `//` at the start of the line (after half/full-width indentation)
//   - `<!-- ... -->` spanning one line, or a run of lines opened by a line that
//     starts with `<!--` and closed by a line that ends with `-->`.
// Code blocks are fenced with 3+ backticks or tildes (CommonMark rules for the
// closing fence). A construct that is never closed stays plain text, so a
// forgotten close cannot swallow the rest of the manuscript. Whichever
// construct opens first owns the lines up to its close.

export type CommentSyntax = "slash" | "html";
export type LineRole = CommentSyntax | "codeFence" | "code";

const LEADING_SPACE = /^[ \t　]*/;
const TRAILING_SPACE = /[ \t　]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

type FenceOpening = { marker: string; length: number; info: string };

/** The opening fence on this line, or null. Backtick fences cannot carry backticks in the info string. */
export function parseFenceOpening(line: string): FenceOpening | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const marker = match[1][0];
  if (marker === "`" && match[2].includes("`")) return null;
  return { marker, length: match[1].length, info: match[2].trim() };
}

function closesFence(line: string, opening: FenceOpening): boolean {
  const match = FENCE_CLOSE.exec(line);
  return Boolean(match && match[1][0] === opening.marker && match[1].length >= opening.length);
}

function leadingSpaceLength(line: string): number {
  return LEADING_SPACE.exec(line)?.[0].length ?? 0;
}

function trimmedEnd(line: string): string {
  return line.replace(TRAILING_SPACE, "");
}

export function isSlashCommentLine(line: string): boolean {
  return line.startsWith("//", leadingSpaceLength(line));
}

/** `\//` at the start of a line writes a literal `//`; returns the backslash offset. */
export function escapedSlashOffset(line: string): number {
  const start = leadingSpaceLength(line);
  return line.startsWith("\\//", start) ? start : -1;
}

function opensHtmlComment(line: string): boolean {
  return line.startsWith("<!--", leadingSpaceLength(line));
}

function closesHtmlComment(line: string, isOpeningLine: boolean): boolean {
  const body = trimmedEnd(line);
  if (!body.endsWith("-->")) return false;
  // `<!-->` must not both open and close the comment on the same characters.
  if (isOpeningLine) return body.length - leadingSpaceLength(line) >= "<!---->".length;
  return true;
}

/**
 * Classifies every line as comment, code or neither. Callers re-run it on each
 * document change because multi-line constructs make a line's role depend on
 * other lines. Unclosed openers make it quadratic in the worst case; each
 * unclosed opener rescans the rest of the document once.
 */
export function classifyLines(lines: readonly string[]): Array<LineRole | null> {
  const out: Array<LineRole | null> = new Array(lines.length).fill(null);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isSlashCommentLine(line)) {
      out[index] = "slash";
      continue;
    }

    const fence = parseFenceOpening(line);
    if (fence) {
      let close = -1;
      for (let probe = index + 1; probe < lines.length; probe += 1) {
        if (closesFence(lines[probe], fence)) {
          close = probe;
          break;
        }
      }
      if (close < 0) continue;
      out[index] = "codeFence";
      for (let probe = index + 1; probe < close; probe += 1) out[probe] = "code";
      out[close] = "codeFence";
      index = close;
      continue;
    }

    if (!opensHtmlComment(line)) continue;
    let close = -1;
    for (let probe = index; probe < lines.length; probe += 1) {
      if (closesHtmlComment(lines[probe], probe === index)) {
        close = probe;
        break;
      }
    }
    if (close < 0) continue;
    for (let probe = index; probe <= close; probe += 1) out[probe] = "html";
    index = close;
  }
  return out;
}

export function isCommentRole(role: LineRole | null | undefined): role is CommentSyntax {
  return role === "slash" || role === "html";
}

export function isCodeRole(role: LineRole | null | undefined): role is "codeFence" | "code" {
  return role === "codeFence" || role === "code";
}

export function detectCommentLines(lines: readonly string[]): Array<CommentSyntax | null> {
  return classifyLines(lines).map((role) => (isCommentRole(role) ? role : null));
}

/** Offsets of each comment line (without its line break), in ascending order. */
export function findCommentLineRanges(text: string): Array<{ from: number; to: number }> {
  const lines = text.split("\n");
  const comments = detectCommentLines(lines);
  const ranges: Array<{ from: number; to: number }> = [];
  let offset = 0;
  lines.forEach((line, index) => {
    if (comments[index]) ranges.push({ from: offset, to: offset + line.length });
    offset += line.length + 1;
  });
  return ranges;
}

/** `source.slice(from, to)` with a leading `\//` escape reduced to a literal `//`. */
export function sliceWithoutSlashEscape(source: string, from: number, to = source.length): string {
  const escape = escapedSlashOffset(source);
  if (escape < from || escape >= to) return source.slice(from, to);
  return source.slice(from, escape) + source.slice(escape + 1, to);
}

type RawMarkup =
  | {
      type: "code";
      start: number;
      len: number;
      /** Number of backticks on each side. */
      ticks: number;
    }
  | {
      type: "layout";
      start: number;
      len: number;
      full: string;
      content: string;
      method: "rb" | "em" | "tcy";
      argText: string;
      methodOffset: number;
    }
  | {
      type: "alignCommand";
      start: number;
      len: number;
      value: LayoutAlign;
    }
  | {
      type: "legacyRuby";
      start: number;
      len: number;
      pipe: boolean;
      base: string;
      reading: string;
    }
  | {
      type: "aozora";
      start: number;
      len: number;
      cmd: string;
    }
  | {
      type: "legacyEmphasis";
      start: number;
      len: number;
      inner: string;
    }
  | {
      type: "bold";
      start: number;
      len: number;
      inner: string;
    };

type DocumentAstInput = {
  path?: string | null;
  name?: string;
  text: string;
  indexedAt?: number;
};

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function hash16(value: string): string {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xc2b2ae35 >>> 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index);
    h1 = ((h1 ^ char) * 0x01000193) >>> 0;
    h2 = ((h2 ^ char) * 0x85ebca77) >>> 0;
  }

  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function splitMonoRubyBase(
  baseText: string,
  readingText: string,
  contentOffset: number,
): RubyItem[] | null {
  const bases = Array.from(baseText);
  const readings = readingText.trim().split(/\s+/).filter(Boolean);
  if (readings.length !== bases.length || bases.length <= 1) return null;

  const items: RubyItem[] = [];
  let offset = contentOffset;

  for (let index = 0; index < bases.length; index += 1) {
    const text = bases[index];
    items.push({
      text,
      reading: readings[index],
      range: { offset, length: text.length },
    });
    offset += text.length;
  }

  return items;
}

function parseLayoutInvocation(
  full: string,
  start: number,
  content: string,
  method: "rb" | "em" | "tcy",
  argText: string,
  methodOffset: number,
): InlineMarkup | null {
  const contentStart = start + 1;
  const trimmedContent = content.replace(/\s+$/, "");
  const trailing = content.length - trimmedContent.length;
  const contentLen = trimmedContent.length;
  const arg = argText.trim();
  const close = full.lastIndexOf(")");
  const markers: InlineMarker[] = [
    { role: "opening", text: "[", range: { offset: start, length: 1 } },
    { role: "method", text: method, range: { offset: methodOffset, length: method.length } },
    {
      role: "closing",
      text: "]",
      range: { offset: start + full.length - 1, length: 1 },
    },
  ];

  if (trailing > 0) {
    markers.push({
      role: "separator",
      text: content.slice(contentLen),
      range: { offset: contentStart + contentLen, length: trailing },
    });
  }

  if (close >= 0 && close + 1 < full.length - 1) {
    markers.push({
      role: "tail",
      text: full.slice(close + 1, full.length - 1),
      range: { offset: start + close + 1, length: full.length - 1 - (close + 1) },
    });
  }

  if (method === "rb") {
    if (!arg) return null;
    markers.push({
      role: "annotation",
      text: arg,
      range: { offset: methodOffset + method.length + 1, length: arg.length },
    });
    const mono = splitMonoRubyBase(trimmedContent, arg, contentStart);

    return {
      id: hash16(`layout-rb|${full}|${start}`),
      type: "ruby",
      syntax: "layoutsystem_v1",
      fullText: full,
      contentText: trimmedContent,
      fullRange: { offset: start, length: full.length },
      contentRange: { offset: contentStart, length: contentLen },
      metadata: `layoutsystem_v1.rb("${arg}")`,
      rubyText: arg,
      rubyMode: mono ? "mono" : "group",
      rubyItems: mono,
      markers,
    };
  }

  if (method === "em") {
    const style = arg === "goma" || arg === "dot" ? arg : "auto";
    return {
      id: hash16(`layout-em|${full}|${start}`),
      type: "emphasis",
      syntax: "layoutsystem_v1",
      fullText: full,
      contentText: trimmedContent,
      fullRange: { offset: start, length: full.length },
      contentRange: { offset: contentStart, length: contentLen },
      metadata: `layoutsystem_v1.em("${style}")`,
      emStyle: style,
      markers,
    };
  }

  return {
    id: hash16(`layout-tcy|${full}|${start}`),
    type: "tcy",
    syntax: "layoutsystem_v1",
    fullText: full,
    contentText: trimmedContent,
    fullRange: { offset: start, length: full.length },
    contentRange: { offset: contentStart, length: contentLen },
    metadata: "layoutsystem_v1.tcy",
    markers,
  };
}

/**
 * Inline code spans: a run of N backticks closed by the next run of exactly N
 * backticks on the same line, with at least one character between them.
 */
function findInlineCodeSpans(text: string): Array<RawMarkup & { type: "code" }> {
  const spans: Array<RawMarkup & { type: "code" }> = [];
  const runs: Array<{ start: number; ticks: number }> = [];
  const pattern = /`+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) runs.push({ start: match.index, ticks: match[0].length });
  for (let open = 0; open < runs.length; open += 1) {
    const opening = runs[open];
    const close = runs.findIndex(
      (run, index) => index > open && run.ticks === opening.ticks,
    );
    if (close < 0) continue;
    const closing = runs[close];
    if (closing.start === opening.start + opening.ticks) continue;
    spans.push({
      type: "code",
      start: opening.start,
      len: closing.start + closing.ticks - opening.start,
      ticks: opening.ticks,
    });
    open = close;
  }
  return spans;
}

export function parseInlines(text: string, base = 0): InlineMarkup[] {
  const raw: RawMarkup[] = [];
  let match: RegExpExecArray | null;

  const layout = /\[([^\[\]\n]*?)\s*\((rb|em|tcy)(?:,([^)]*))?\)\]/g;
  while ((match = layout.exec(text))) {
    const method = match[2] as "rb" | "em" | "tcy";
    const full = match[0];
    raw.push({
      type: "layout",
      start: match.index,
      len: full.length,
      full,
      content: match[1],
      method,
      argText: match[3] || "",
      methodOffset: base + match.index + full.indexOf(`(${method}`) + 1,
    });
  }

  const align = /\[\(al:(start|center|end)\)\]/g;
  while ((match = align.exec(text))) {
    raw.push({
      type: "alignCommand",
      start: match.index,
      len: match[0].length,
      value: match[1] as LayoutAlign,
    });
  }

  const ruby = /｜([^《》｜]+)《([^《》]+)》|([一-龠々〆ヶ]+)《([^《》]+)》/g;
  while ((match = ruby.exec(text))) {
    if (match[1] !== undefined) {
      raw.push({
        type: "legacyRuby",
        start: match.index,
        len: match[0].length,
        pipe: true,
        base: match[1],
        reading: match[2],
      });
    } else {
      raw.push({
        type: "legacyRuby",
        start: match.index,
        len: match[0].length,
        pipe: false,
        base: match[3],
        reading: match[4],
      });
    }
  }

  const aozora = /［＃([^］]+)］/g;
  while ((match = aozora.exec(text))) {
    raw.push({
      type: "aozora",
      start: match.index,
      len: match[0].length,
      cmd: match[1],
    });
  }

  const emphasis = /《《([^《》]+)》》/g;
  while ((match = emphasis.exec(text))) {
    raw.push({
      type: "legacyEmphasis",
      start: match.index,
      len: match[0].length,
      inner: match[1],
    });
  }

  const bold = /\*\*([^*]+)\*\*/g;
  while ((match = bold.exec(text))) {
    raw.push({
      type: "bold",
      start: match.index,
      len: match[0].length,
      inner: match[1],
    });
  }

  // Inline code is literal: notation inside it (or overlapping it) is not markup.
  const codeSpans = findInlineCodeSpans(text);
  if (codeSpans.length > 0) {
    const overlapsCode = (item: RawMarkup) =>
      codeSpans.some((span) => item.start < span.start + span.len && span.start < item.start + item.len);
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      if (overlapsCode(raw[index])) raw.splice(index, 1);
    }
    raw.push(...codeSpans);
  }

  raw.sort((left, right) => left.start - right.start || right.len - left.len);

  const picked: RawMarkup[] = [];
  let currentEnd = -1;
  for (const item of raw) {
    if (item.start > currentEnd) {
      picked.push(item);
      currentEnd = item.start + item.len - 1;
    }
  }

  const out: InlineMarkup[] = [];

  for (const item of picked) {
    const start = base + item.start;
    const full = text.slice(item.start, item.start + item.len);

    if (item.type === "layout") {
      const markup = parseLayoutInvocation(
        item.full,
        start,
        item.content,
        item.method,
        item.argText,
        item.methodOffset,
      );
      if (markup) out.push(markup);
      continue;
    }

    if (item.type === "code") {
      const contentStart = start + item.ticks;
      const contentLength = item.len - item.ticks * 2;
      const ticks = "`".repeat(item.ticks);
      out.push({
        id: hash16(`code|${full}|${start}`),
        type: "code",
        fullText: full,
        contentText: full.slice(item.ticks, item.len - item.ticks),
        fullRange: { offset: start, length: item.len },
        contentRange: { offset: contentStart, length: contentLength },
        metadata: "inlineCode",
        markers: [
          { role: "opening", text: ticks, range: { offset: start, length: item.ticks } },
          {
            role: "content",
            text: full.slice(item.ticks, item.len - item.ticks),
            range: { offset: contentStart, length: contentLength },
          },
          {
            role: "closing",
            text: ticks,
            range: { offset: contentStart + contentLength, length: item.ticks },
          },
        ],
      });
      continue;
    }

    if (item.type === "alignCommand") {
      const contentStart = start + 2;
      const contentLength = 2 + item.value.length;
      out.push({
        id: hash16(`layout-al|${full}|${start}`),
        type: "layoutAlign",
        syntax: "layoutsystem_v1",
        fullText: full,
        contentText: `al:${item.value}`,
        fullRange: { offset: start, length: item.len },
        contentRange: { offset: contentStart, length: contentLength },
        metadata: `layoutsystem_v1.al("${item.value}")`,
        align: item.value,
        markers: [
          { role: "opening", text: "[(", range: { offset: start, length: 2 } },
          {
            role: "annotation",
            text: `al:${item.value}`,
            range: { offset: contentStart, length: contentLength },
          },
          {
            role: "closing",
            text: ")]",
            range: { offset: start + item.len - 2, length: 2 },
          },
        ],
      });
      continue;
    }

    if (item.type === "legacyRuby") {
      let offset = start;
      const markers: InlineMarker[] = [];
      if (item.pipe) {
        markers.push({ role: "prefix", text: "｜", range: { offset, length: 1 } });
        offset += 1;
      }
      const baseStart = offset;
      offset += item.base.length;
      markers.push({ role: "opening", text: "《", range: { offset, length: 1 } });
      offset += 1;
      markers.push({
        role: "annotation",
        text: item.reading,
        range: { offset, length: item.reading.length },
      });
      offset += item.reading.length;
      markers.push({ role: "closing", text: "》", range: { offset, length: 1 } });
      out.push({
        id: hash16(`ruby|${full}|${start}`),
        type: "ruby",
        syntax: "legacy",
        fullText: full,
        contentText: item.base,
        fullRange: { offset: start, length: item.len },
        contentRange: { offset: baseStart, length: item.base.length },
        metadata: `rubyText("${item.reading}")`,
        rubyText: item.reading,
        rubyMode: "group",
        markers,
      });
      continue;
    }

    if (item.type === "aozora") {
      const contentStart = start + 2;
      out.push({
        id: hash16(`aozora|${full}|${start}`),
        type: "aozoraAnnotation",
        fullText: full,
        contentText: item.cmd,
        fullRange: { offset: start, length: item.len },
        contentRange: { offset: contentStart, length: item.cmd.length },
        metadata: `aozoraCommand("${item.cmd}")`,
        markers: [
          { role: "opening", text: "［＃", range: { offset: start, length: 2 } },
          {
            role: "annotation",
            text: item.cmd,
            range: { offset: contentStart, length: item.cmd.length },
          },
          {
            role: "closing",
            text: "］",
            range: { offset: contentStart + item.cmd.length, length: 1 },
          },
        ],
      });
      continue;
    }

    const contentStart = start + 2;
    const contentLength = item.inner.length;
    const isEmphasis = item.type === "legacyEmphasis";
    out.push({
      id: hash16(`${isEmphasis ? "em" : "bold"}|${full}|${start}`),
      type: isEmphasis ? "emphasis" : "bold",
      syntax: isEmphasis ? "legacy" : undefined,
      fullText: full,
      contentText: item.inner,
      fullRange: { offset: start, length: item.len },
      contentRange: { offset: contentStart, length: contentLength },
      metadata: isEmphasis ? "emphasisDots" : "strong",
      emStyle: isEmphasis ? "auto" : undefined,
      markers: [
        {
          role: "opening",
          text: isEmphasis ? "《《" : "**",
          range: { offset: start, length: 2 },
        },
        {
          role: "content",
          text: item.inner,
          range: { offset: contentStart, length: contentLength },
        },
        {
          role: "closing",
          text: isEmphasis ? "》》" : "**",
          range: { offset: contentStart + contentLength, length: 2 },
        },
      ],
    });
  }

  out.sort((left, right) => left.fullRange.offset - right.fullRange.offset);
  return out;
}

function detectLayoutAlign(text: string): LayoutAlign | null {
  const match = text.match(/\[\(al:(start|center|end)\)\]/);
  return match ? (match[1] as LayoutAlign) : null;
}

function cleanLineTextForAst(text: string): string {
  return text
    .replace(/\[\(al:(?:start|center|end)\)\]/g, "")
    .replace(/^［＃地付き］/, "")
    .replace(/^>>\s*/, "");
}

function measureLineCharacters(text: string): {
  textLength: number;
  visibleTextLength: number;
} {
  return {
    textLength: Array.from(text).length,
    visibleTextLength: Array.from(text.replace(/[\s　]/g, "")).length,
  };
}

export function parseLineNode(
  text: string,
  index: number,
  from = 0,
  role: LineRole | null = null,
): LineNode {
  let kind: LineKind = "paragraph";
  let level = 0;
  let marker = "";
  let jitsuki = false;
  let align = detectLayoutAlign(text);
  let inlineMarkups: InlineMarkup[] = [];
  let cleanText = text;
  let codeFence: boolean | undefined;
  let codeInfo: string | undefined;

  if (isCommentRole(role)) {
    // Comments are not manuscript: no markup, no characters, no alignment.
    kind = "comment";
    align = null;
    cleanText = "";
  } else if (isCodeRole(role)) {
    // Code is literal: no headings, lists, alignment or inline notation.
    kind = "code";
    align = null;
    codeFence = role === "codeFence";
    if (codeFence) {
      const info = parseFenceOpening(text)?.info;
      if (info) codeInfo = info;
    }
  } else if (text.length === 0) {
    kind = "blank";
    cleanText = "";
  } else {
    const heading = text.match(/^(#{1,6})(\s+|$)/);
    const jitsukiMatch = text.match(/^(>>)(\s*)/);
    const unordered = text.match(/^(\s*)([-*+])(\s+)/);
    const ordered = text.match(/^(\s*)(\d+[.)])(\s+)/);
    const list = unordered || ordered;

    if (heading) {
      kind = "heading";
      level = heading[1].length;
      marker = heading[0];
      const body = text.slice(heading[0].length);
      cleanText = cleanLineTextForAst(body);
      inlineMarkups = parseInlines(body, heading[0].length);
    } else if (jitsukiMatch) {
      marker = jitsukiMatch[0];
      jitsuki = true;
      align = "end";
      cleanText = cleanLineTextForAst(text.slice(jitsukiMatch[0].length));
      inlineMarkups = parseInlines(text.slice(jitsukiMatch[0].length), jitsukiMatch[0].length);
    } else if (list) {
      const indent = (list[1] || "").replace(/\t/g, "  ");
      kind = "list";
      level = Math.min(6, Math.floor(indent.length / 2));
      cleanText = cleanLineTextForAst(text);
      inlineMarkups = parseInlines(text, 0);
    } else {
      const escape = escapedSlashOffset(text);
      cleanText = cleanLineTextForAst(
        escape >= 0 ? text.slice(0, escape) + text.slice(escape + 1) : text,
      );
      inlineMarkups = parseInlines(text, 0);
    }

    if (
      inlineMarkups.length > 0 &&
      inlineMarkups[0].type === "aozoraAnnotation" &&
      inlineMarkups[0].contentText === "地付き" &&
      inlineMarkups[0].fullRange.offset === 0
    ) {
      jitsuki = true;
      align = "end";
    }

    if (align === "end") jitsuki = true;
  }

  const characterMetrics = isCommentRole(role)
    ? { textLength: 0, visibleTextLength: 0 }
    : measureLineCharacters(text);
  let codeMetrics = { textLength: 0, visibleTextLength: 0 };
  if (kind === "code") {
    codeMetrics = characterMetrics;
  } else {
    for (const markup of inlineMarkups) {
      if (markup.type !== "code") continue;
      const span = measureLineCharacters(markup.fullText);
      codeMetrics = {
        textLength: codeMetrics.textLength + span.textLength,
        visibleTextLength: codeMetrics.visibleTextLength + span.visibleTextLength,
      };
    }
  }
  return {
    id: hash16(`L|${kind}|${level}|${align || ""}|${text}`),
    semanticHash: hash16(`S|${kind}|${level}|${align || ""}|${cleanText}`),
    kind,
    level,
    marker,
    jitsuki,
    align,
    source: text,
    text: cleanText,
    lineIndex: index,
    from,
    to: from + text.length,
    textLength: characterMetrics.textLength,
    visibleTextLength: characterMetrics.visibleTextLength,
    codeTextLength: codeMetrics.textLength,
    codeVisibleTextLength: codeMetrics.visibleTextLength,
    ...(codeFence === undefined ? {} : { codeFence }),
    ...(codeInfo === undefined ? {} : { codeInfo }),
    length: text.length,
    inlineMarkups,
  };
}

export function parseDocumentBlocks(text: string): LineNode[] {
  const lines = normalizeText(text).split("\n");
  const roles = classifyLines(lines);
  let offset = 0;

  return lines.map((line, index) => {
    const block = parseLineNode(line, index, offset, roles[index]);
    offset += line.length + 1;
    return block;
  });
}

/**
 * Line breaks counted as characters: the manuscript as if comment lines were
 * absent (and, for `withoutCode`, code-block lines as well).
 */
function countedLineBreaks(blocks: readonly LineNode[], withoutCode = false): number {
  let lines = 0;
  for (const block of blocks) {
    if (block.kind === "comment" || (withoutCode && block.kind === "code")) continue;
    lines += 1;
  }
  return Math.max(0, lines - 1);
}

/** The role a parsed block was built with, for deciding whether it can be reused. */
function blockRole(block: LineNode): "comment" | "codeFence" | "code" | null {
  if (block.kind === "comment") return "comment";
  if (block.kind === "code") return block.codeFence ? "codeFence" : "code";
  return null;
}

function roleSignature(role: LineRole | null): "comment" | "codeFence" | "code" | null {
  return isCommentRole(role) ? "comment" : role;
}

/** Whether `block` was parsed with the given role (and can be kept as is). */
export function blockHasRole(block: LineNode, role: LineRole | null | undefined): boolean {
  return blockRole(block) === roleSignature(role ?? null);
}

function normalizeHeadingTitle(text: string): string {
  return text.replace(/\s+#*\s*$/, "").trim();
}

export function buildOutlineFromBlocks(blocks: LineNode[], sourceId = "document"): DocumentOutlineItem[] {
  const roots: DocumentOutlineItem[] = [];
  const stack: DocumentOutlineItem[] = [];
  let currentSection: DocumentOutlineItem | null = null;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (block.kind === "heading") {
      const title = normalizeHeadingTitle(block.text);
      if (title) {
        const item: DocumentOutlineItem = {
          id: `${sourceId}:${block.lineIndex + 1}:${block.level}:${hash16(title)}`,
          blockId: block.id,
          title,
          level: block.level,
          line: block.lineIndex + 1,
          sectionTextLength: 0,
          sectionVisibleTextLength: 0,
          sectionCodeTextLength: 0,
          sectionCodeVisibleTextLength: 0,
          children: [],
        };

        while (stack.length && stack[stack.length - 1].level >= item.level) {
          stack.pop();
        }

        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push(item);
        } else {
          roots.push(item);
        }
        stack.push(item);
        currentSection = item;
      }
    }

    if (currentSection) {
      const lineBreak = blockIndex < blocks.length - 1 && block.kind !== "comment" ? 1 : 0;
      currentSection.sectionTextLength += block.textLength + lineBreak;
      currentSection.sectionVisibleTextLength += block.visibleTextLength;
      currentSection.sectionCodeTextLength +=
        block.codeTextLength + (block.kind === "code" ? lineBreak : 0);
      currentSection.sectionCodeVisibleTextLength += block.codeVisibleTextLength;
    }
  }

  return roots;
}

export function createDocumentAst(input: DocumentAstInput): DocumentAst {
  const normalized = normalizeText(input.text);
  const blocks = parseDocumentBlocks(normalized);
  return assembleDocumentAst(input, normalized, blocks);
}

function assembleDocumentAst(
  input: DocumentAstInput,
  normalized: string,
  blocks: LineNode[],
): DocumentAst {
  const outline = buildOutlineFromBlocks(blocks, input.path ?? input.name ?? "document");
  const semanticParts: string[] = [];
  const lineBreaks = countedLineBreaks(blocks);
  let textLength = lineBreaks;
  let visibleTextLength = 0;
  let codeTextLength = lineBreaks - countedLineBreaks(blocks, true);
  let codeVisibleTextLength = 0;
  for (const block of blocks) {
    semanticParts.push(block.semanticHash);
    textLength += block.textLength;
    visibleTextLength += block.visibleTextLength;
    codeTextLength += block.codeTextLength;
    codeVisibleTextLength += block.codeVisibleTextLength;
  }
  const semanticHash = hash16(semanticParts.join("|"));

  return {
    kind: "document",
    id: hash16(`document|${input.path ?? ""}|${normalized.length}|${semanticHash}`),
    path: input.path ?? null,
    name: input.name ?? input.path?.split(/[\\/]/).pop() ?? "untitled.txt",
    textHash: hash16(normalized),
    semanticHash,
    textLength,
    visibleTextLength,
    codeTextLength,
    codeVisibleTextLength,
    lineCount: blocks.length,
    blocks,
    outline,
    indexedAt: input.indexedAt ?? Date.now(),
  };
}

/**
 * Rebuilds document-level hashes and outline while parsing only changed lines.
 * Unchanged blocks retain identity when their line index and source offsets do
 * not move, which also lets downstream metric caches reuse their work.
 */
export function updateDocumentAst(
  previous: DocumentAst | null,
  input: DocumentAstInput,
): DocumentAst {
  if (!previous) return createDocumentAst(input);

  const normalized = normalizeText(input.text);
  const lines = normalized.split("\n");
  const oldBlocks = previous.blocks;
  const oldCount = oldBlocks.length;
  const newCount = lines.length;
  let prefixCount = 0;
  const maxPrefix = Math.min(oldCount, newCount);
  while (
    prefixCount < maxPrefix &&
    oldBlocks[prefixCount].source === lines[prefixCount]
  ) {
    prefixCount += 1;
  }

  let suffixCount = 0;
  const maxSuffix = Math.min(oldCount - prefixCount, newCount - prefixCount);
  while (
    suffixCount < maxSuffix &&
    oldBlocks[oldCount - 1 - suffixCount].source === lines[newCount - 1 - suffixCount]
  ) {
    suffixCount += 1;
  }

  // Multi-line comments and code blocks make a line's kind depend on its
  // neighbours, so roles are re-derived for every line and reused blocks are
  // re-parsed when their role changes.
  const roles = classifyLines(lines);
  const blocks: LineNode[] = [];
  let offset = 0;
  const changedEnd = newCount - suffixCount;
  for (let index = 0; index < newCount; index += 1) {
    const source = lines[index];
    const oldIndex =
      index < prefixCount
        ? index
        : index >= changedEnd
          ? oldCount - (newCount - index)
          : -1;
    const role = roles[index];
    const candidate = oldIndex >= 0 ? oldBlocks[oldIndex] : null;
    const oldBlock =
      candidate && blockRole(candidate) === roleSignature(role) ? candidate : null;
    const to = offset + source.length;
    if (
      oldBlock &&
      oldBlock.lineIndex === index &&
      oldBlock.from === offset &&
      oldBlock.to === to
    ) {
      blocks.push(oldBlock);
    } else if (oldBlock) {
      blocks.push({
        ...oldBlock,
        lineIndex: index,
        from: offset,
        to,
      });
    } else {
      blocks.push(parseLineNode(source, index, offset, role));
    }
    offset = to + 1;
  }

  return assembleDocumentAst(input, normalized, blocks);
}

export function flattenOutline(
  items: DocumentOutlineItem[],
  parents: DocumentOutlineItem[] = [],
): Array<DocumentOutlineItem & { parents: DocumentOutlineItem[] }> {
  return items.flatMap((item) => [
    { ...item, parents },
    ...flattenOutline(item.children, [...parents, item]),
  ]);
}

export function findActiveOutlineChain(
  items: DocumentOutlineItem[],
  lineNumber: number,
): DocumentOutlineItem[] {
  let activeChain: DocumentOutlineItem[] = [];

  const visit = (outlineItems: DocumentOutlineItem[], parents: DocumentOutlineItem[]) => {
    for (const item of outlineItems) {
      if (item.line > lineNumber) break;
      const chain = [...parents, item];
      activeChain = chain;
      visit(item.children, chain);
    }
  };

  visit(items, []);
  return activeChain;
}

export function getLineNumberAtOffset(text: string, offset: number): number {
  const normalized = normalizeText(text);
  const clamped = Math.max(0, Math.min(offset, normalized.length));
  let line = 1;
  for (let index = 0; index < clamped; index += 1) {
    if (normalized[index] === "\n") line += 1;
  }
  return line;
}
