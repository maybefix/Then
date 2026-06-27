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

export function parseLineNode(text: string, index: number, from = 0): LineNode {
  let kind: LineKind = "paragraph";
  let level = 0;
  let marker = "";
  let jitsuki = false;
  let align = detectLayoutAlign(text);
  let inlineMarkups: InlineMarkup[] = [];
  let cleanText = text;

  if (text.length === 0) {
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
      cleanText = cleanLineTextForAst(text);
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
    length: text.length,
    inlineMarkups,
  };
}

export function parseDocumentBlocks(text: string): LineNode[] {
  const lines = normalizeText(text).split("\n");
  let offset = 0;

  return lines.map((line, index) => {
    const block = parseLineNode(line, index, offset);
    offset += line.length + 1;
    return block;
  });
}

function normalizeHeadingTitle(text: string): string {
  return text.replace(/\s+#*\s*$/, "").trim();
}

export function buildOutlineFromBlocks(blocks: LineNode[], sourceId = "document"): DocumentOutlineItem[] {
  const roots: DocumentOutlineItem[] = [];
  const stack: DocumentOutlineItem[] = [];

  for (const block of blocks) {
    if (block.kind !== "heading") continue;

    const title = normalizeHeadingTitle(block.text);
    if (!title) continue;

    const item: DocumentOutlineItem = {
      id: `${sourceId}:${block.lineIndex + 1}:${block.level}:${hash16(title)}`,
      blockId: block.id,
      title,
      level: block.level,
      line: block.lineIndex + 1,
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
  }

  return roots;
}

export function createDocumentAst(input: DocumentAstInput): DocumentAst {
  const normalized = normalizeText(input.text);
  const blocks = parseDocumentBlocks(normalized);
  const outline = buildOutlineFromBlocks(blocks, input.path ?? input.name ?? "document");
  const semanticHash = hash16(blocks.map((block) => block.semanticHash).join("|"));

  return {
    kind: "document",
    id: hash16(`document|${input.path ?? ""}|${normalized.length}|${semanticHash}`),
    path: input.path ?? null,
    name: input.name ?? input.path?.split(/[\\/]/).pop() ?? "untitled.txt",
    textHash: hash16(normalized),
    semanticHash,
    textLength: Array.from(normalized).length,
    visibleTextLength: Array.from(normalized.replace(/[\s　]/g, "")).length,
    lineCount: blocks.length,
    blocks,
    outline,
    indexedAt: input.indexedAt ?? Date.now(),
  };
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
