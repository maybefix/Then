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

// Line comments (docs/COMMENT_OUT_SPEC.md). A comment is always a whole line:
//   - `//` at the start of the line (after half/full-width indentation)
//   - `<!-- ... -->` spanning one line, or a run of lines opened by a line that
//     starts with `<!--` and closed by a line that ends with `-->`.
// Lines inside code fences are never comments. An unclosed `<!--` is plain text
// so a forgotten close cannot swallow the rest of the manuscript.

export type CommentSyntax = "slash" | "html";

const LEADING_SPACE = /^[ \t　]*/;
const FENCE_PATTERN = /^\s{0,3}(?:```|~~~)/;
const TRAILING_SPACE = /[ \t　]*$/;

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
 * Classifies every line. Linear in the line count; callers re-run it on each
 * document change because a multi-line HTML comment makes the result depend on
 * lines other than the one that changed.
 */
export function detectCommentLines(lines: readonly string[]): Array<CommentSyntax | null> {
  const out: Array<CommentSyntax | null> = new Array(lines.length).fill(null);
  let insideFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCE_PATTERN.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    if (isSlashCommentLine(line)) {
      out[index] = "slash";
      continue;
    }
    if (!opensHtmlComment(line)) continue;

    let close = -1;
    for (let probe = index; probe < lines.length; probe += 1) {
      if (probe > index && FENCE_PATTERN.test(lines[probe])) break;
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

/** `source.slice(from, to)` with a leading `\//` escape reduced to a literal `//`. */
export function sliceWithoutSlashEscape(source: string, from: number, to = source.length): string {
  const escape = escapedSlashOffset(source);
  if (escape < from || escape >= to) return source.slice(from, to);
  return source.slice(from, escape) + source.slice(escape + 1, to);
}

type RawMarkup =
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
  comment: CommentSyntax | null = null,
): LineNode {
  let kind: LineKind = "paragraph";
  let level = 0;
  let marker = "";
  let jitsuki = false;
  let align = detectLayoutAlign(text);
  let inlineMarkups: InlineMarkup[] = [];
  let cleanText = text;

  if (comment) {
    // Comments are not manuscript: no markup, no characters, no alignment.
    kind = "comment";
    align = null;
    cleanText = "";
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

  const characterMetrics = comment
    ? { textLength: 0, visibleTextLength: 0 }
    : measureLineCharacters(text);
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
    length: text.length,
    inlineMarkups,
  };
}

export function parseDocumentBlocks(text: string): LineNode[] {
  const lines = normalizeText(text).split("\n");
  const comments = detectCommentLines(lines);
  let offset = 0;

  return lines.map((line, index) => {
    const block = parseLineNode(line, index, offset, comments[index]);
    offset += line.length + 1;
    return block;
  });
}

/** Line breaks counted as characters: the manuscript as if comment lines were absent. */
function countedLineBreaks(blocks: readonly LineNode[]): number {
  let lines = 0;
  for (const block of blocks) {
    if (block.kind !== "comment") lines += 1;
  }
  return Math.max(0, lines - 1);
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
      currentSection.sectionTextLength +=
        block.textLength +
        (blockIndex < blocks.length - 1 && block.kind !== "comment" ? 1 : 0);
      currentSection.sectionVisibleTextLength += block.visibleTextLength;
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
  let textLength = countedLineBreaks(blocks);
  let visibleTextLength = 0;
  for (const block of blocks) {
    semanticParts.push(block.semanticHash);
    textLength += block.textLength;
    visibleTextLength += block.visibleTextLength;
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

  // Multi-line HTML comments make a line's kind depend on its neighbours, so
  // comment state is re-derived for every line and reused blocks are re-parsed
  // when it flips.
  const comments = detectCommentLines(lines);
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
    const comment = comments[index];
    const candidate = oldIndex >= 0 ? oldBlocks[oldIndex] : null;
    const oldBlock =
      candidate && (candidate.kind === "comment") === Boolean(comment) ? candidate : null;
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
      blocks.push(parseLineNode(source, index, offset, comment));
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
