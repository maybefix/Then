import { Editor, Extension, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { baseKeymap } from "@tiptap/pm/commands";
import { keymap } from "@tiptap/pm/keymap";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@tiptap/pm/view";
import { useEffect, useMemo, useRef } from "react";

export type TextEditorHandle = {
  focus: () => void;
  getValue: () => string;
  getSelection: () => { from: number; to: number; head: number };
  replaceRange: (from: number, to: number, insert: string, cursorPos?: number) => void;
  jumpToLine: (line: number) => void;
  positionFromPoint: (x: number, y: number) => number | null;
  scrollCaretIntoView: (offsetPercent: number) => void;
  isComposing: () => boolean;
};

type VerticalTextEditorProps = {
  text: string;
  editorRevision: number | null;
  typewriterOffset: number;
  showLineBreakMarks: boolean;
  onReady: (editor: TextEditorHandle | null) => void;
  onTextChange: (text: string, editorRevision: number) => void;
  onSelectionChange: () => void;
};

type LayoutAlign = "start" | "center" | "end";
type LineKind = "blank" | "paragraph" | "heading" | "list";

type TextRange = {
  offset: number;
  length: number;
};

type InlineMarker = {
  role: string;
  text: string;
  range: TextRange;
};

type RubyItem = {
  text: string;
  reading: string;
  range: TextRange;
};

type InlineMarkup = {
  id: string;
  type:
    | "ruby"
    | "emphasis"
    | "tcy"
    | "layoutAlign"
    | "aozoraAnnotation"
    | "bold";
  syntax?: "layoutsystem_v1" | "legacy";
  fullText: string;
  contentText: string;
  fullRange: TextRange;
  contentRange: TextRange;
  metadata?: string;
  rubyText?: string;
  rubyMode?: "mono" | "group";
  rubyItems?: RubyItem[] | null;
  emStyle?: "auto" | "goma" | "dot";
  align?: LayoutAlign;
  markers: InlineMarker[];
};

type LineNode = {
  id: string;
  semanticHash: string;
  kind: LineKind;
  level: number;
  marker: string;
  jitsuki: boolean;
  align: LayoutAlign | null;
  source: string;
  text: string;
  lineIndex: number;
  length: number;
  inlineMarkups: InlineMarkup[];
};

type AstPluginState = {
  lines: LineNode[];
  decoSet: DecorationSet;
  activeIndex: number;
  visibleCenter: number;
};

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

type AstMeta = {
  visibleCenter?: number;
  rebuild?: boolean;
};

type EditorViewWithInput = EditorView & {
  input?: {
    composing?: boolean;
  };
};

const ACTIVE_BUILD_RADIUS = 72;
const VISIBLE_BUILD_RADIUS = 72;
const VISIBLE_UPDATE_STEP = 12;
const SCROLL_EPS = 0.75;
const PLACEHOLDER = "# 見出し\n- リスト項目\nここに入力……";

const astKey = new PluginKey<AstPluginState>("then-layout-ast");

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function textToDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: normalizeText(text)
      .split("\n")
      .map((line) =>
        line.length > 0
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      ),
  };
}

function topTexts(doc: PMNode): string[] {
  const lines: string[] = [];
  doc.forEach((node) => lines.push(node.textContent));
  return lines.length > 0 ? lines : [""];
}

function docToText(doc: PMNode): string {
  return topTexts(doc).join("\n");
}

function updateEmptyAttribute(editor: Editor): void {
  editor.view.dom.dataset.empty = docToText(editor.state.doc).length === 0 ? "true" : "false";
  editor.view.dom.dataset.placeholder = PLACEHOLDER;
}

function hash16(s: string): string {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xc2b2ae35 >>> 0;

  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 ^ c) * 0x85ebca77) >>> 0;
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

  for (let i = 0; i < bases.length; i += 1) {
    const ch = bases[i];
    items.push({
      text: ch,
      reading: readings[i],
      range: { offset, length: ch.length },
    });
    offset += ch.length;
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

function parseInlines(text: string, base = 0): InlineMarkup[] {
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

function parseLineNode(text: string, index: number): LineNode {
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
    length: text.length,
    inlineMarkups,
  };
}

function parseDoc(text: string): LineNode[] {
  return normalizeText(text)
    .split("\n")
    .map((line, index) => parseLineNode(line, index));
}

function cloneLineNode(line: LineNode, lineIndex: number): LineNode {
  return {
    ...line,
    lineIndex,
  };
}

function diffLines(
  oldLines: LineNode[],
  newTexts: string[],
): { from: number; toOld: number; toNew: number } {
  const oldCount = oldLines.length;
  const newCount = newTexts.length;
  let head = 0;
  const maxHead = Math.min(oldCount, newCount);

  while (head < maxHead && oldLines[head].source === newTexts[head]) head += 1;

  let tail = 0;
  const maxTail = Math.min(oldCount - head, newCount - head);
  while (
    tail < maxTail &&
    oldLines[oldCount - 1 - tail].source === newTexts[newCount - 1 - tail]
  ) {
    tail += 1;
  }

  return {
    from: head,
    toOld: oldCount - tail,
    toNew: newCount - tail,
  };
}

function incrementalLines(
  oldLines: LineNode[],
  newTexts: string[],
  diff: { from: number; toOld: number; toNew: number },
): LineNode[] {
  const next: LineNode[] = [];

  for (let i = 0; i < diff.from; i += 1) {
    next.push(cloneLineNode(oldLines[i], i));
  }

  for (let i = diff.from; i < diff.toNew; i += 1) {
    next.push(parseLineNode(newTexts[i], i));
  }

  for (let oldIndex = diff.toOld; oldIndex < oldLines.length; oldIndex += 1) {
    next.push(cloneLineNode(oldLines[oldIndex], next.length));
  }

  return next;
}

function pmStartAtIndex(doc: PMNode, index: number): number | null {
  if (index < 0 || index >= doc.childCount) return null;

  let pos = 0;
  for (let i = 0; i < index; i += 1) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

function activeLineIndex(state: EditorState): number {
  const count = state.doc.childCount;
  if (count <= 0) return -1;

  return Math.max(0, Math.min(count - 1, state.selection.$head.index(0)));
}

function decorationRange(
  activeIndex: number,
  lineCount: number,
  visibleCenter: number,
): Array<{ from: number; to: number }> {
  if (lineCount <= 0) return [];

  const ranges = [
    {
      from: Math.max(0, activeIndex - ACTIVE_BUILD_RADIUS),
      to: Math.min(lineCount, activeIndex + ACTIVE_BUILD_RADIUS + 1),
    },
  ];

  if (visibleCenter >= 0) {
    ranges.push({
      from: Math.max(0, visibleCenter - VISIBLE_BUILD_RADIUS),
      to: Math.min(lineCount, visibleCenter + VISIBLE_BUILD_RADIUS + 1),
    });
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: Array<{ from: number; to: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

const KINSOKU_LINE_HEAD_FORBIDDEN = new Set(
  Array.from(
    "、。，．・：；？！!?‼⁇⁈⁉" +
      "）〕］｝〉》」』】〗〙〛’”" +
      "ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々ゝゞヽヾ〻〃ー",
  ),
);
const KINSOKU_LINE_END_FORBIDDEN = new Set(Array.from("（〔［｛〈《「『【〖〘〚‘“"));
const KINSOKU_PUNCTUATION = new Set(
  Array.from(
    "、。，．・：；？！!?‼⁇⁈⁉" +
      "（〔［｛〈《「『【〖〘〚‘“" +
      "）〕］｝〉》」』】〗〙〛’”",
  ),
);
const KINSOKU_DIGIT = /^[0-9０-９]$/;

type CharacterRange = {
  ch: string;
  from: number;
  to: number;
};

type BreakableTokenKind =
  | "url"
  | "email"
  | "path"
  | "uuid"
  | "hash"
  | "number"
  | "identifier"
  | "longAscii"
  | "longDash"
  | "longLeader";

type BreakableToken = {
  from: number;
  to: number;
  text: string;
  kind: BreakableTokenKind;
  breakpoints: number[];
};

const MAX_TOKEN_BREAKPOINTS = 16;

function characterRanges(text: string): CharacterRange[] {
  const ranges: CharacterRange[] = [];
  let offset = 0;

  for (const ch of Array.from(text)) {
    ranges.push({ ch, from: offset, to: offset + ch.length });
    offset += ch.length;
  }

  return ranges;
}

function inlineMarkupRanges(line: LineNode): Array<{ from: number; to: number }> {
  return line.inlineMarkups.map((markup) => ({
    from: markup.fullRange.offset,
    to: markup.fullRange.offset + markup.fullRange.length,
  }));
}

function overlapsProtectedRange(
  from: number,
  to: number,
  protectedRanges: Array<{ from: number; to: number }>,
): boolean {
  return protectedRanges.some((range) => from < range.to && to > range.from);
}

function tokenBreakpoints(text: string, kind: BreakableTokenKind): number[] {
  const prioritized: Array<{ pos: number; priority: number }> = [];
  const schemeEnd = kind === "url" ? text.indexOf("://") + 3 : -1;
  const add = (pos: number, priority: number) => {
    if (pos <= 0 || pos >= text.length) return;
    prioritized.push({ pos, priority });
  };

  if (kind === "number" || kind === "hash") {
    for (let pos = 4; pos < text.length; pos += 4) add(pos, 1);
  } else if (kind === "uuid") {
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "-") add(i + 1, 0);
    }
  } else if (kind === "longDash" || kind === "longLeader") {
    for (let pos = 2; pos < text.length; pos += 2) add(pos, 0);
  } else {
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "/" || ch === "\\") {
        if (schemeEnd > 0 && i < schemeEnd) continue;
        add(i + 1, 0);
      } else if (ch === "?" || ch === "&" || ch === "#") {
        add(i, 0);
      } else if (ch === "@") {
        add(i, 0);
        add(i + 1, 0);
      } else if (ch === "." || ch === "-" || ch === "_") {
        add(i + 1, 1);
      } else if (ch === "=") {
        add(i, 1);
        add(i + 1, 1);
      }
    }
    for (let pos = 8; pos < text.length; pos += 8) add(pos, 2);
  }

  const selected = new Map<number, number>();
  for (const item of prioritized) {
    const current = selected.get(item.pos);
    if (current === undefined || item.priority < current) selected.set(item.pos, item.priority);
  }

  return Array.from(selected, ([pos, priority]) => ({ pos, priority }))
    .sort((left, right) => left.priority - right.priority || left.pos - right.pos)
    .slice(0, MAX_TOKEN_BREAKPOINTS)
    .map((item) => item.pos)
    .sort((left, right) => left - right);
}

function classifyAsciiToken(text: string): BreakableTokenKind {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return "url";
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return "email";
  if (/^(?:[a-z]:[\\/]|\.{0,2}[\\/])/i.test(text)) return "path";
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)) return "uuid";
  if (/^[0-9a-f]{24,}$/i.test(text)) return "hash";
  if (/^\d{5,}$/.test(text)) return "number";
  if (/^[a-z_$][a-z0-9_$.-]*$/i.test(text)) return "identifier";
  return "longAscii";
}

function findBreakableTokens(
  text: string,
  protectedRanges: Array<{ from: number; to: number }>,
): BreakableToken[] {
  const tokens: BreakableToken[] = [];
  const add = (from: number, value: string, kind: BreakableTokenKind) => {
    const to = from + value.length;
    if (
      to <= from ||
      overlapsProtectedRange(from, to, protectedRanges) ||
      tokens.some((token) => from < token.to && to > token.from)
    ) {
      return;
    }
    tokens.push({ from, to, text: value, kind, breakpoints: tokenBreakpoints(value, kind) });
  };

  const patterns: Array<{ regex: RegExp; kind?: BreakableTokenKind }> = [
    { regex: /\b[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi, kind: "url" },
    { regex: /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, kind: "email" },
    { regex: /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, kind: "uuid" },
    { regex: /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])[A-Za-z0-9._~!$&'()+,;=@%\\/-]{8,}/g, kind: "path" },
    { regex: /[!-~]{24,}/g },
    { regex: /[0-9０-９]{5,}/g, kind: "number" },
    { regex: /[…‥]{3,}/g, kind: "longLeader" },
    { regex: /―{3,}/g, kind: "longDash" },
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text))) {
      add(match.index, match[0], pattern.kind ?? classifyAsciiToken(match[0]));
    }
  }

  return tokens.sort((left, right) => left.from - right.from || left.to - right.to);
}

function pushTokenBreakWidget(
  out: Decoration[],
  position: number,
  kind: BreakableTokenKind | "tcyRejected",
): void {
  out.push(
    Decoration.widget(
      position,
      () => {
        const wbr = document.createElement("wbr");
        wbr.dataset.ksBreak = "preferred";
        wbr.dataset.ksTokenKind = kind;
        wbr.setAttribute("aria-hidden", "true");
        return wbr;
      },
      {
        side: -1,
        key: `ks-wbr-${kind}-${position}`,
        ignoreSelection: true,
      },
    ),
  );
}

function pushBreakableTokenDecos(
  out: Decoration[],
  contentStart: number,
  tokens: BreakableToken[],
): void {
  for (const token of tokens) {
    out.push(
      Decoration.inline(contentStart + token.from, contentStart + token.to, {
        class: "ks-breakable-token",
        "data-ks-token-kind": token.kind,
      }),
    );
    for (const offset of token.breakpoints) {
      pushTokenBreakWidget(out, contentStart + token.from + offset, token.kind);
    }
  }
}

function pushParagraphIndentAnchor(
  out: Decoration[],
  line: LineNode,
  contentStart: number,
  chars: CharacterRange[],
  markupRanges: Array<{ from: number; to: number }>,
): void {
  if (line.kind !== "paragraph") return;

  let indentLength = 0;
  while (indentLength < chars.length && chars[indentLength].ch === "　") indentLength += 1;
  if (indentLength < 1 || indentLength > 2 || indentLength >= chars.length) return;

  const to = chars[indentLength].to;
  if (overlapsProtectedRange(0, to, markupRanges)) return;

  out.push(
    Decoration.inline(contentStart, contentStart + to, {
      class: "ks-indent-anchor",
    }),
  );
}

function pushKinsokuRange(
  out: Decoration[],
  contentStart: number,
  from: number,
  to: number,
  className: string,
  protectedRanges: Array<{ from: number; to: number }>,
): void {
  if (to <= from || overlapsProtectedRange(from, to, protectedRanges)) return;
  out.push(Decoration.inline(contentStart + from, contentStart + to, { class: className }));
}

function pushKinsokuDecos(out: Decoration[], line: LineNode, contentStart: number): void {
  if (!line.source) return;

  const markupRanges = inlineMarkupRanges(line);
  const breakableTokens = findBreakableTokens(line.source, markupRanges);
  const protectedRanges = [
    ...markupRanges,
    ...breakableTokens.map((token) => ({ from: token.from, to: token.to })),
  ];
  const chars = characterRanges(line.source);
  if (chars.length === 0) return;

  pushBreakableTokenDecos(out, contentStart, breakableTokens);
  pushParagraphIndentAnchor(out, line, contentStart, chars, markupRanges);

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i].ch;

    if (ch === "…" || ch === "‥" || ch === "―") {
      let end = i + 1;
      while (end < chars.length && chars[end].ch === ch) end += 1;
      if (end - i === 2) {
        pushKinsokuRange(
          out,
          contentStart,
          chars[i].from,
          chars[end - 1].to,
          "ks-keep-short",
          protectedRanges,
        );
      }
      i = end - 1;
      continue;
    }

    if ((ch === "〳" || ch === "〴") && i + 1 < chars.length && chars[i + 1].ch === "〵") {
      pushKinsokuRange(
        out,
        contentStart,
        chars[i].from,
        chars[i + 1].to,
        "ks-keep-short",
        protectedRanges,
      );
      i += 1;
      continue;
    }

    if (KINSOKU_DIGIT.test(ch)) {
      let end = i + 1;
      while (end < chars.length && KINSOKU_DIGIT.test(chars[end].ch)) end += 1;
      if (end - i >= 2 && end - i <= 4) {
        pushKinsokuRange(
          out,
          contentStart,
          chars[i].from,
          chars[end - 1].to,
          "ks-keep-short",
          protectedRanges,
        );
      }
      i = end - 1;
    }
  }

  for (let i = 1; i < chars.length; i += 1) {
    if (!KINSOKU_LINE_HEAD_FORBIDDEN.has(chars[i].ch)) continue;

    let end = i + 1;
    while (end < chars.length && KINSOKU_LINE_HEAD_FORBIDDEN.has(chars[end].ch)) end += 1;
    const protectedEnd = Math.min(end, i + 2);
    pushKinsokuRange(
      out,
      contentStart,
      chars[i - 1].from,
      chars[protectedEnd - 1].to,
      "ks-line-head-ban",
      protectedRanges,
    );
    i = end - 1;
  }

  for (let i = 0; i < chars.length - 1; i += 1) {
    if (!KINSOKU_LINE_END_FORBIDDEN.has(chars[i].ch)) continue;

    pushKinsokuRange(
      out,
      contentStart,
      chars[i].from,
      chars[i + 1].to,
      "ks-line-end-ban",
      protectedRanges,
    );
  }

  for (let i = 0; i < chars.length; i += 1) {
    const prev = i > 0 ? chars[i - 1].ch : "";
    const next = i + 1 < chars.length ? chars[i + 1].ch : "";
    const boundary = i === 0 || i === chars.length - 1;
    if (
      KINSOKU_PUNCTUATION.has(chars[i].ch) &&
      (KINSOKU_PUNCTUATION.has(prev) || KINSOKU_PUNCTUATION.has(next) || boundary)
    ) {
      pushKinsokuRange(
        out,
        contentStart,
        chars[i].from,
        chars[i].to,
        "ks-punct-trim",
        protectedRanges,
      );
    }
  }
}

function shouldJustifyLine(line: LineNode): boolean {
  if (line.kind !== "paragraph" || line.jitsuki || line.align) return false;
  return Array.from(line.text || line.source).length >= 8;
}

function addInlineDecoration(
  out: Decoration[],
  contentStart: number,
  from: number,
  to: number,
  className: string,
): void {
  if (to > from) out.push(Decoration.inline(contentStart + from, contentStart + to, { class: className }));
}

function findMarker(markup: InlineMarkup, role: string): InlineMarker | undefined {
  return markup.markers.find((marker) => marker.role === role);
}

function pushPunctTcyBoundary(
  out: Decoration[],
  position: number,
  markup: InlineMarkup,
): void {
  out.push(
    Decoration.widget(
      position,
      () => {
        const boundary = document.createElement("span");
        boundary.className = "tcy-boundary nyoze-special-inline-boundary";
        boundary.dataset.tcyBoundary = "after";
        boundary.dataset.tcyNode = "layoutTcy";
        boundary.dataset.tcyKind = "punct";
        boundary.dataset.nyozeSpecialInlineBoundary = "after";
        boundary.dataset.nyozeSpecialInlineNode = "layoutTcy";
        boundary.dataset.nyozeSpecialInlineBoundaryPos = String(position);
        boundary.contentEditable = "true";
        boundary.spellcheck = false;
        boundary.textContent = "\u2060";
        return boundary;
      },
      {
        side: -1,
        key: `punct-tcy-boundary-${markup.id}-${position}`,
      },
    ),
  );
}

function pushInlineDecos(markup: InlineMarkup, contentStart: number, out: Decoration[]): void {
  const fullStart = markup.fullRange.offset;
  const fullEnd = fullStart + markup.fullRange.length;

  if (markup.type === "ruby") {
    const contentOffset = markup.contentRange.offset;
    const contentEnd = contentOffset + markup.contentRange.length;
    const reading = markup.rubyText || findMarker(markup, "annotation")?.text || "";

    addInlineDecoration(out, contentStart, fullStart, contentOffset, "mk-hidden");
    if (markup.rubyMode === "mono" && Array.isArray(markup.rubyItems)) {
      for (const item of markup.rubyItems) {
        out.push(
          Decoration.inline(
            contentStart + item.range.offset,
            contentStart + item.range.offset + item.range.length,
            { class: "ruby-base", "data-rt": item.reading },
          ),
        );
      }
    } else {
      out.push(
        Decoration.inline(contentStart + contentOffset, contentStart + contentEnd, {
          class: "ruby-base",
          "data-rt": reading,
        }),
      );
    }
    addInlineDecoration(out, contentStart, contentEnd, fullEnd, "mk-hidden");
    return;
  }

  if (markup.type === "layoutAlign") {
    addInlineDecoration(out, contentStart, fullStart, fullEnd, "mk-hidden");
    return;
  }

  if (markup.type === "tcy") {
    const contentOffset = markup.contentRange.offset;
    const contentEnd = contentOffset + markup.contentRange.length;
    const tcyText = markup.contentText.replace(/[\uFE0E\uFE0F]/g, "");
    const tcyLength = Array.from(tcyText).length;
    const acceptsTcy = tcyLength <= 4;
    const attrs: Record<string, string> = {
      class: acceptsTcy ? "tcy ks-tcy" : "tcy-rejected ks-breakable-token",
      "data-tcy-len": String(Math.min(4, tcyLength)),
    };

    const isPunct = /^[!?！？‼⁇⁈⁉]+$/.test(tcyText);

    if (/^[0-9０-９]+$/.test(tcyText)) {
      attrs["data-tcy-kind"] = "num";
    } else if (isPunct) {
      attrs["data-tcy-kind"] = "punct";
      if (acceptsTcy) {
        attrs["data-tcy-atom"] = "1";
        attrs.contenteditable = "false";
        attrs.draggable = "false";
      }
    }

    addInlineDecoration(out, contentStart, fullStart, contentOffset, "mk-hidden");
    out.push(
      Decoration.inline(contentStart + contentOffset, contentStart + contentEnd, attrs),
    );
    if (!acceptsTcy) {
      const ranges = characterRanges(markup.contentText);
      for (let index = 4; index < ranges.length; index += 4) {
        pushTokenBreakWidget(
          out,
          contentStart + contentOffset + ranges[index].from,
          "tcyRejected",
        );
      }
    } else if (isPunct) {
      pushPunctTcyBoundary(out, contentStart + contentEnd, markup);
    }
    addInlineDecoration(out, contentStart, contentEnd, fullEnd, "mk-hidden");
    return;
  }

  if (markup.type === "aozoraAnnotation") {
    const annotation = findMarker(markup, "annotation");
    if (!annotation) return;

    const annotationStart = annotation.range.offset;
    const annotationEnd = annotationStart + annotation.range.length;
    addInlineDecoration(out, contentStart, fullStart, annotationStart, "mk-hidden");
    addInlineDecoration(
      out,
      contentStart,
      annotationStart,
      annotationEnd,
      markup.contentText === "地付き" ? "mk-hidden" : "mk-cmd",
    );
    addInlineDecoration(out, contentStart, annotationEnd, fullEnd, "mk-hidden");
    return;
  }

  const contentOffset = markup.contentRange.offset;
  const contentEnd = contentOffset + markup.contentRange.length;
  addInlineDecoration(out, contentStart, fullStart, contentOffset, "mk-hidden");
  addInlineDecoration(
    out,
    contentStart,
    contentOffset,
    contentEnd,
    markup.type === "emphasis" ? `em-${markup.emStyle || "auto"}` : "bold",
  );
  addInlineDecoration(out, contentStart, contentEnd, fullEnd, "mk-hidden");
}

function pushLineDecos(
  out: Decoration[],
  lines: LineNode[],
  index: number,
  nodeStart: number,
  node: PMNode,
  active: boolean,
): void {
  const line = lines[index];
  if (!line) return;

  const classes = ["pm-line"];
  if (line.kind === "blank") classes.push("blank");
  if (line.kind === "heading") classes.push("heading", `h${line.level}`);
  if (line.kind === "list") classes.push("list-line");
  if (shouldJustifyLine(line)) classes.push("ks-justify");
  if (line.align) classes.push(`align-${line.align}`);
  if (line.jitsuki) classes.push("jitsuki");
  if (active) classes.push("active-line");

  const attrs: Record<string, string> = { class: classes.join(" ") };
  if (line.kind === "list") attrs["data-level"] = String(line.level);

  out.push(Decoration.node(nodeStart, nodeStart + node.nodeSize, attrs));

  const contentStart = nodeStart + 1;
  pushKinsokuDecos(out, line, contentStart);

  if (active) return;

  if (line.marker) {
    out.push(
      Decoration.inline(contentStart, contentStart + line.marker.length, {
        class: "mk-hidden",
      }),
    );
  }

  for (const markup of line.inlineMarkups) {
    pushInlineDecos(markup, contentStart, out);
  }
}

function buildWindowDecos(
  doc: PMNode,
  lines: LineNode[],
  activeIndex: number,
  visibleCenter: number,
): DecorationSet {
  const out: Decoration[] = [];
  const count = Math.min(doc.childCount, lines.length);

  for (const range of decorationRange(activeIndex, count, visibleCenter)) {
    let nodeStart = pmStartAtIndex(doc, range.from);
    if (nodeStart === null) continue;

    for (let i = range.from; i < Math.min(count, range.to); i += 1) {
      const node = doc.child(i);
      pushLineDecos(out, lines, i, nodeStart, node, i === activeIndex);
      nodeStart += node.nodeSize;
    }
  }

  return DecorationSet.create(doc, out);
}

function makeAstState(state: EditorState): AstPluginState {
  const lines = parseDoc(docToText(state.doc));
  const activeIndex = activeLineIndex(state);
  return {
    lines,
    activeIndex,
    visibleCenter: activeIndex,
    decoSet: buildWindowDecos(state.doc, lines, activeIndex, activeIndex),
  };
}

function applyAst(
  tr: Transaction,
  value: AstPluginState,
  _oldState: EditorState,
  newState: EditorState,
): AstPluginState {
  const meta = tr.getMeta(astKey) as AstMeta | undefined;
  let visibleCenter = value.visibleCenter;

  if (typeof meta?.visibleCenter === "number") {
    visibleCenter = Math.max(0, Math.min(newState.doc.childCount - 1, meta.visibleCenter));
  }

  if (!tr.docChanged) {
    const activeIndex = activeLineIndex(newState);
    if (
      meta?.rebuild !== true &&
      activeIndex === value.activeIndex &&
      visibleCenter === value.visibleCenter
    ) {
      return value;
    }

    return {
      ...value,
      activeIndex,
      visibleCenter,
      decoSet: buildWindowDecos(newState.doc, value.lines, activeIndex, visibleCenter),
    };
  }

  const newTexts = topTexts(newState.doc);
  const diff = diffLines(value.lines, newTexts);
  const lines = incrementalLines(value.lines, newTexts, diff);
  const activeIndex = activeLineIndex(newState);

  if (tr.getMeta("composition") !== undefined) {
    return {
      lines,
      activeIndex,
      visibleCenter,
      decoSet: value.decoSet.map(tr.mapping, newState.doc),
    };
  }

  return {
    lines,
    activeIndex,
    visibleCenter,
    decoSet: buildWindowDecos(newState.doc, lines, activeIndex, visibleCenter),
  };
}

const LayoutAstExtension = Extension.create({
  name: "thenLayoutAst",

  addProseMirrorPlugins() {
    return [
      new Plugin<AstPluginState>({
        key: astKey,
        state: {
          init: (_config, state) => makeAstState(state),
          apply: applyAst,
        },
        props: {
          decorations(state) {
            return astKey.getState(state)?.decoSet ?? DecorationSet.empty;
          },
        },
      }),
      keymap(baseKeymap),
    ];
  },
});

function textOffsetFromPmPos(doc: PMNode, pos: number): number {
  const max = doc.content.size;
  const clamped = Math.max(0, Math.min(max, pos));
  let textOffset = 0;
  let nodeStart = 0;

  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i);
    const contentStart = nodeStart + 1;
    const contentEnd = contentStart + node.content.size;
    const nodeEnd = nodeStart + node.nodeSize;
    const lineLength = node.textContent.length;

    if (clamped <= contentStart) return textOffset;
    if (clamped <= contentEnd) return textOffset + clamped - contentStart;
    if (clamped <= nodeEnd) {
      return textOffset + lineLength + (i < doc.childCount - 1 && clamped > contentEnd ? 1 : 0);
    }

    textOffset += lineLength + (i < doc.childCount - 1 ? 1 : 0);
    nodeStart = nodeEnd;
  }

  return textOffset;
}

function pmPosFromTextOffset(doc: PMNode, offset: number): number {
  const textLength = docToText(doc).length;
  let remaining = Math.max(0, Math.min(textLength, offset));
  let nodeStart = 0;

  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i);
    const lineLength = node.textContent.length;
    const contentStart = nodeStart + 1;

    if (remaining <= lineLength) return contentStart + remaining;

    remaining -= lineLength;
    if (i < doc.childCount - 1) {
      if (remaining === 0) return contentStart + lineLength;
      remaining -= 1;
    }

    nodeStart += node.nodeSize;
  }

  const lastIndex = doc.childCount - 1;
  if (lastIndex < 0) return 0;

  const lastStart = pmStartAtIndex(doc, lastIndex) ?? 0;
  return lastStart + 1 + doc.child(lastIndex).content.size;
}

function getTextSelection(editor: Editor): { from: number; to: number; head: number } {
  const selection = editor.state.selection;
  return {
    from: textOffsetFromPmPos(editor.state.doc, selection.from),
    to: textOffsetFromPmPos(editor.state.doc, selection.to),
    head: textOffsetFromPmPos(editor.state.doc, selection.head),
  };
}

function setSelectionByTextOffset(editor: Editor, offset: number): void {
  const pos = pmPosFromTextOffset(editor.state.doc, offset);
  editor.commands.setTextSelection(pos);
}

function isEditorComposing(editor: Editor | null, composingRef?: { current: boolean }): boolean {
  if (!editor) return false;

  const view = editor.view as EditorViewWithInput;
  return Boolean(composingRef?.current || view.composing || view.input?.composing);
}

function snapScrollValue(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

function nonEmptyRect(rect: DOMRect | null): DOMRect | null {
  if (!rect) return null;
  if (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0) return null;
  return rect;
}

function rectHasArea(rect: DOMRect): boolean {
  return rect.width > 0.1 || rect.height > 0.1;
}

function lineHeightPx(element: Element): number {
  const style = getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.8 : 24;
}

function activeBlockElement(view: EditorView): Element | null {
  const index = view.state.selection.$head.index(0);
  const element = view.dom.children[index];
  return element instanceof Element ? element : null;
}

function activeBlockColumnRect(view: EditorView): DOMRect | null {
  const element = activeBlockElement(view);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (!rectHasArea(rect)) return null;

  const lineHeight = lineHeightPx(element);
  const width = Math.max(1, Math.min(rect.width || lineHeight || 1, lineHeight || rect.width || 1));

  return new DOMRect(
    rect.left + rect.width / 2 - width / 2,
    rect.top,
    width,
    Math.max(1, rect.height || lineHeight),
  );
}

function coordsAtSelectionStable(view: EditorView): DOMRect | null {
  const selection = view.state.selection;
  const parentSize = selection.$head.parent ? selection.$head.parent.content.size : 0;
  const parentOffset = selection.$head.parentOffset || 0;
  const delta = parentSize === 0 || parentOffset === 0 ? 1 : 0;

  try {
    return nonEmptyRect(view.coordsAtPos(Math.max(1, selection.head - delta)) as DOMRect);
  } catch {
    return null;
  }
}

function domRangeRect(
  view: EditorView,
  from: number,
  to: number,
  preferEnd: boolean,
): DOMRect | null {
  try {
    const max = view.state.doc.content.size;
    const start = Math.max(1, Math.min(max, from));
    const end = Math.max(start, Math.min(max, to));
    const a = view.domAtPos(start, 1);
    const b = view.domAtPos(end, -1);
    const doc = view.dom.ownerDocument || document;
    const range = doc.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const rects = Array.from(range.getClientRects()).filter(rectHasArea);
    if (!rects.length) return null;

    return preferEnd ? rects[rects.length - 1] : rects[0];
  } catch {
    return null;
  }
}

function selectionColumnAnchor(view: EditorView): { rect: DOMRect | null; source: string } {
  const selection = view.state.selection;
  const head = selection.head;
  const parentSize = selection.$head.parent ? selection.$head.parent.content.size : 0;
  const parentOffset = selection.$head.parentOffset || 0;

  if (parentSize === 0) {
    return { rect: activeBlockColumnRect(view), source: "block-empty" };
  }

  if (parentOffset === 0) {
    const rect = domRangeRect(view, head, Math.min(head + 1, view.state.doc.content.size), false);
    return { rect: rect || coordsAtSelectionStable(view), source: rect ? "range-next" : "coords" };
  }

  const rect = domRangeRect(view, Math.max(1, head - 1), head, true);
  return { rect: rect || coordsAtSelectionStable(view), source: rect ? "range-prev" : "coords" };
}

function inlineTextNodeIsPainted(node: Node, root: Element): boolean {
  let element = node.parentElement;

  while (element && element !== root) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    element = element.parentElement;
  }

  return true;
}

function domTextCharRect(textNode: Node, offset: number): DOMRect | null {
  try {
    const value = textNode.nodeValue;
    if (!value || offset < 0 || offset >= value.length) return null;

    const doc = textNode.ownerDocument || document;
    const range = doc.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);
    const rects = Array.from(range.getClientRects()).filter(rectHasArea);
    return rects.length ? rects[rects.length - 1] : null;
  } catch {
    return null;
  }
}

function lastPaintedTextRectInBlock(element: Element): DOMRect | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.length === 0) return NodeFilter.FILTER_REJECT;
      return inlineTextNodeIsPainted(node, element)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Node[] = [];

  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const textNode = nodes[nodeIndex];
    const value = textNode.nodeValue || "";
    for (let offset = value.length - 1; offset >= 0; offset -= 1) {
      const rect = domTextCharRect(textNode, offset);
      if (rect && rectHasArea(rect)) return rect;
    }
  }

  return null;
}

function blockFallbackEndRect(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect();
  if (!rectHasArea(rect)) return null;

  const lineHeight = lineHeightPx(element) || 16;
  const width = Math.max(1, Math.min(rect.width || lineHeight, lineHeight));

  return new DOMRect(
    rect.right - width,
    rect.top,
    width,
    Math.max(1, Math.min(rect.height || lineHeight, lineHeight)),
  );
}

function paragraphEndRect(editor: Editor, index: number): DOMRect | null {
  if (index < 0 || index >= editor.state.doc.childCount) return null;

  const element = editor.view.dom.children[index];
  if (!(element instanceof Element)) return null;

  const paintedRect = lastPaintedTextRectInBlock(element);
  if (paintedRect && rectHasArea(paintedRect)) return paintedRect;

  const nodeStart = pmStartAtIndex(editor.state.doc, index);
  if (nodeStart === null) return blockFallbackEndRect(element);

  const node = editor.state.doc.child(index);
  const length = node.content.size;
  const maxScan = Math.min(length, 64);

  for (let step = 0; step < maxScan; step += 1) {
    const from = nodeStart + length - step;
    const rect = domRangeRect(editor.view, from, from + 1, true);
    if (rect && rectHasArea(rect)) return rect;
  }

  return blockFallbackEndRect(element);
}

function centerCaretForEditor(
  editor: Editor,
  scroller: HTMLElement,
  offsetPercent: number,
  instant: boolean,
): void {
  if (isEditorComposing(editor)) return;

  const anchor = selectionColumnAnchor(editor.view);
  const rect = anchor.rect;
  if (!rect) return;

  const scrollerRect = scroller.getBoundingClientRect();
  const targetRatio = Number.isFinite(offsetPercent) ? offsetPercent / 100 : 0.5;
  const viewportTarget = scrollerRect.left + scrollerRect.width * targetRatio;
  const caretCenter = (rect.left + rect.right) / 2;
  const delta = caretCenter - viewportTarget;
  const current = scroller.scrollLeft;
  const target = snapScrollValue(current + delta);

  if (Math.abs(target - current) < SCROLL_EPS) return;

  if (instant) {
    scroller.scrollLeft = target;
    return;
  }

  scroller.scrollTo({ left: target, behavior: "smooth" });
}

function domLineIndexFromElement(root: HTMLElement, element: Element | null): number {
  let current: Element | null = element;

  while (current && current !== root && current.parentElement !== root) {
    current = current.parentElement;
  }

  if (!current || current === root || current.parentElement !== root) return -1;
  return Array.prototype.indexOf.call(root.children, current);
}

function estimateVisibleCenterIndex(editor: Editor, scroller: HTMLElement): number {
  const rect = scroller.getBoundingClientRect();
  const points = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + rect.width * 0.35, rect.top + rect.height / 2],
    [rect.left + rect.width * 0.65, rect.top + rect.height / 2],
  ];

  for (const [x, y] of points) {
    const index = domLineIndexFromElement(editor.view.dom, document.elementFromPoint(x, y));
    if (index >= 0) return index;
  }

  return astKey.getState(editor.state)?.activeIndex ?? -1;
}

function centerDelayFrames(eventType: string): number {
  return eventType === "compositionend" || eventType.startsWith("composition") ? 2 : 1;
}

export function VerticalTextEditor({
  text,
  editorRevision,
  typewriterOffset,
  showLineBreakMarks,
  onReady,
  onTextChange,
  onSelectionChange,
}: VerticalTextEditorProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const lineBreakLayerRef = useRef<HTMLDivElement | null>(null);
  const tiptapRef = useRef<Editor | null>(null);
  const textRef = useRef(text);
  const onTextChangeRef = useRef(onTextChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const localRevisionRef = useRef(0);
  const composingRef = useRef(false);
  const typewriterOffsetRef = useRef(typewriterOffset);
  const showLineBreakMarksRef = useRef(showLineBreakMarks);
  const renderLineBreakMarksRef = useRef<(() => void) | null>(null);
  const requestLineBreakMarksRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    typewriterOffsetRef.current = Number.isFinite(typewriterOffset) ? typewriterOffset : 50;
  }, [typewriterOffset]);

  useEffect(() => {
    showLineBreakMarksRef.current = showLineBreakMarks;
    if (showLineBreakMarks) {
      requestLineBreakMarksRef.current?.();
    } else {
      renderLineBreakMarksRef.current?.();
    }
  }, [showLineBreakMarks]);

  const handle = useMemo<TextEditorHandle>(
    () => ({
      focus: () => {
        tiptapRef.current?.commands.focus();
      },
      getValue: () => {
        const editor = tiptapRef.current;
        return editor ? docToText(editor.state.doc) : textRef.current;
      },
      getSelection: () => {
        const editor = tiptapRef.current;
        return editor ? getTextSelection(editor) : { from: 0, to: 0, head: 0 };
      },
      replaceRange: (from, to, insert, cursorPos) => {
        const editor = tiptapRef.current;
        const scroller = scrollerRef.current;
        if (!editor) return;

        const current = docToText(editor.state.doc);
        const insertFrom = Math.max(0, Math.min(current.length, from));
        const insertTo = Math.max(insertFrom, Math.min(current.length, to));
        const next = `${current.slice(0, insertFrom)}${normalizeText(insert)}${current.slice(insertTo)}`;
        const nextCursor = cursorPos ?? insertFrom + normalizeText(insert).length;

        editor.commands.setContent(textToDoc(next), false);
        setSelectionByTextOffset(editor, nextCursor);
        updateEmptyAttribute(editor);
        textRef.current = next;
        const nextRevision = ++localRevisionRef.current;
        onTextChangeRef.current(next, nextRevision);
        onSelectionChangeRef.current();
        if (scroller) centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, true);
        requestLineBreakMarksRef.current?.();
      },
      jumpToLine: (line) => {
        const editor = tiptapRef.current;
        const scroller = scrollerRef.current;
        if (!editor) return;

        const index = Math.max(0, Math.min(editor.state.doc.childCount - 1, line - 1));
        const pos = (pmStartAtIndex(editor.state.doc, index) ?? 0) + 1;
        editor.commands.focus();
        editor.commands.setTextSelection(pos);
        onSelectionChangeRef.current();
        if (scroller) centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, true);
        requestLineBreakMarksRef.current?.();
      },
      positionFromPoint: (x, y) => {
        const editor = tiptapRef.current;
        if (!editor) return null;

        const result = editor.view.posAtCoords({ left: x, top: y });
        return result ? textOffsetFromPmPos(editor.state.doc, result.pos) : null;
      },
      scrollCaretIntoView: (offsetPercent) => {
        const editor = tiptapRef.current;
        const scroller = scrollerRef.current;
        if (!editor || !scroller || isEditorComposing(editor, composingRef)) return;

        typewriterOffsetRef.current = Number.isFinite(offsetPercent) ? offsetPercent : 50;
        centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, false);
        requestLineBreakMarksRef.current?.();
      },
      isComposing: () => isEditorComposing(tiptapRef.current, composingRef),
    }),
    [],
  );

  useEffect(() => {
    const editor = tiptapRef.current;
    if (!editor) return;

    const editorText = docToText(editor.state.doc);
    if (editorText === text) {
      textRef.current = text;
      return;
    }

    if (editorRevision !== null && editorRevision <= localRevisionRef.current) {
      return;
    }

    editor.commands.setContent(textToDoc(text), false);
    setSelectionByTextOffset(editor, 0);
    textRef.current = text;
    updateEmptyAttribute(editor);
    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (scroller) centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, true);
      requestLineBreakMarksRef.current?.();
    });
  }, [editorRevision, text]);

  useEffect(() => {
    const host = editorHostRef.current;
    const scroller = scrollerRef.current;
    if (!host || !scroller) return undefined;

    let centerQueued = false;
    let centerInstant = false;
    let centerEventType = "initial";
    let centerWaitFrames = 1;
    let visibleQueued = false;
    let lastVisibleCenter = -1;
    let centerFrame: number | null = null;
    let visibleFrame: number | null = null;
    let lineBreakFrame: number | null = null;
    let compositionFrame: number | null = null;
    let lineBreakQueued = false;

    const requestCenterCaret = (instant: boolean, eventType: string) => {
      const editor = tiptapRef.current;
      if (!editor || isEditorComposing(editor, composingRef)) return;

      centerInstant = centerInstant || instant;
      centerEventType = eventType;
      centerWaitFrames = Math.max(centerWaitFrames, centerDelayFrames(eventType));
      if (centerQueued) return;

      centerQueued = true;
      const wait = () => {
        centerFrame = requestAnimationFrame(() => {
          centerWaitFrames -= 1;
          if (centerWaitFrames > 0) {
            wait();
            return;
          }

          centerQueued = false;
          centerWaitFrames = 1;
          const shouldInstant = centerInstant;
          centerInstant = false;
          centerEventType = "unknown";
          const currentEditor = tiptapRef.current;
          const currentScroller = scrollerRef.current;
          if (currentEditor && currentScroller) {
            centerCaretForEditor(
              currentEditor,
              currentScroller,
              typewriterOffsetRef.current,
              shouldInstant,
            );
          }
        });
      };

      wait();
    };

    const requestVisibleWindow = () => {
      const editor = tiptapRef.current;
      const currentScroller = scrollerRef.current;
      if (!editor || !currentScroller || visibleQueued) return;

      visibleQueued = true;
      visibleFrame = requestAnimationFrame(() => {
        visibleQueued = false;
        const index = estimateVisibleCenterIndex(editor, currentScroller);
        if (index < 0 || Math.abs(index - lastVisibleCenter) < VISIBLE_UPDATE_STEP) return;

        lastVisibleCenter = index;
        editor.view.dispatch(
          editor.state.tr
            .setMeta(astKey, { visibleCenter: index } satisfies AstMeta)
            .setMeta("addToHistory", false),
        );
        requestLineBreakMarks();
      });
    };

    const renderLineBreakMarks = () => {
      lineBreakQueued = false;
      lineBreakFrame = null;
      const layer = lineBreakLayerRef.current;
      const currentEditor = tiptapRef.current;
      if (!layer) return;

      layer.textContent = "";

      const scrollerRect = scroller.getBoundingClientRect();
      layer.style.left = `${snapScrollValue(scrollerRect.left)}px`;
      layer.style.top = `${snapScrollValue(scrollerRect.top)}px`;
      layer.style.width = `${snapScrollValue(scrollerRect.width)}px`;
      layer.style.height = `${snapScrollValue(scrollerRect.height)}px`;

      if (
        !showLineBreakMarksRef.current ||
        !currentEditor ||
        isEditorComposing(currentEditor, composingRef)
      ) {
        return;
      }

      const state = astKey.getState(currentEditor.state);
      if (!state) return;

      const estimatedCenter = estimateVisibleCenterIndex(currentEditor, scroller);
      const visibleCenter = estimatedCenter >= 0 ? estimatedCenter : state.visibleCenter;
      const activeIndex = activeLineIndex(currentEditor.state);
      const fragment = document.createDocumentFragment();

      for (const range of decorationRange(state.activeIndex, state.lines.length, visibleCenter)) {
        const to = Math.min(range.to, state.lines.length, currentEditor.state.doc.childCount);

        for (let index = range.from; index < to; index += 1) {
          const line = state.lines[index];
          if (!line) continue;

          const rect = paragraphEndRect(currentEditor, index);
          if (!rect) continue;

          const mark = document.createElement("span");
          const blank = line.source.length === 0;
          mark.className = `visibleLineBreakMark${blank ? " blank" : ""}${
            index === activeIndex ? " active" : ""
          }`;
          mark.textContent = "↵";
          mark.style.left = `${snapScrollValue((rect.left + rect.right) / 2 - scrollerRect.left)}px`;
          mark.style.top = `${snapScrollValue(
            (blank ? (rect.top + rect.bottom) / 2 : rect.bottom + 8) - scrollerRect.top,
          )}px`;
          fragment.appendChild(mark);
        }
      }

      layer.appendChild(fragment);
    };

    const requestLineBreakMarks = () => {
      if (!showLineBreakMarksRef.current || lineBreakQueued) return;

      lineBreakQueued = true;
      lineBreakFrame = requestAnimationFrame(renderLineBreakMarks);
    };

    renderLineBreakMarksRef.current = renderLineBreakMarks;
    requestLineBreakMarksRef.current = requestLineBreakMarks;

    const editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, History, LayoutAstExtension],
      content: textToDoc(textRef.current),
      autofocus: false,
      editorProps: {
        attributes: {
          class: "pm-root",
          spellcheck: "false",
          "data-placeholder": PLACEHOLDER,
        },
        // Each paragraph is one editor line, so copy/paste must use a single
        // newline per line. The ProseMirror default puts a blank line ("\n\n")
        // between blocks, which is why copying spaced the lines out.
        clipboardTextSerializer: (slice) =>
          slice.content.textBetween(0, slice.content.size, "\n"),
        clipboardTextParser: (text, _context, _plain, view) => {
          const { schema } = view.state;
          const nodes = normalizeText(text)
            .split("\n")
            .map((line) =>
              line.length > 0
                ? schema.nodes.paragraph.create(null, schema.text(line))
                : schema.nodes.paragraph.create(),
            );
          return new Slice(Fragment.fromArray(nodes), 1, 1);
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        const next = docToText(currentEditor.state.doc);
        updateEmptyAttribute(currentEditor);
        textRef.current = next;
        const nextRevision = ++localRevisionRef.current;
        onTextChangeRef.current(next, nextRevision);
        onSelectionChangeRef.current();
        if (!isEditorComposing(currentEditor, composingRef)) {
          requestCenterCaret(true, "update");
        }
        requestVisibleWindow();
        requestLineBreakMarks();
      },
      onSelectionUpdate: () => {
        onSelectionChangeRef.current();
        requestCenterCaret(false, "selection");
        requestVisibleWindow();
        requestLineBreakMarks();
      },
    });

    tiptapRef.current = editor;
    updateEmptyAttribute(editor);

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      scroller.scrollLeft -= delta;
      requestVisibleWindow();
      requestLineBreakMarks();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.target !== scroller) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const scrollbarHeight = scroller.offsetHeight - scroller.clientHeight;
      if (scrollbarHeight > 0 && event.clientY >= scrollerRect.bottom - scrollbarHeight) return;

      event.preventDefault();
      editor.commands.focus();
      const lastIndex = Math.max(0, editor.state.doc.childCount - 1);
      const lastNode = editor.state.doc.child(lastIndex);
      editor.commands.setTextSelection((pmStartAtIndex(editor.state.doc, lastIndex) ?? 0) + 1 + lastNode.content.size);
      requestCenterCaret(true, "scroller-mousedown");
      requestLineBreakMarks();
    };

    const handleCompositionStart = () => {
      composingRef.current = true;
      renderLineBreakMarks();
    };

    const handleCompositionUpdate = () => {
      requestVisibleWindow();
    };

    const handleCompositionEnd = () => {
      composingRef.current = false;
      if (compositionFrame !== null) cancelAnimationFrame(compositionFrame);
      compositionFrame = requestAnimationFrame(() => {
        compositionFrame = null;
        if (tiptapRef.current !== editor) return;
        editor.view.dispatch(
          editor.state.tr
            .setMeta(astKey, { rebuild: true } satisfies AstMeta)
            .setMeta("addToHistory", false),
        );
      });
      requestCenterCaret(true, "compositionend");
      requestVisibleWindow();
      requestLineBreakMarks();
    };

    const handleResize = () => {
      requestCenterCaret(true, "resize");
      requestVisibleWindow();
      requestLineBreakMarks();
    };

    const handleScroll = () => {
      requestVisibleWindow();
      requestLineBreakMarks();
    };

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    scroller.addEventListener("mousedown", handleMouseDown);
    editor.view.dom.addEventListener("compositionstart", handleCompositionStart);
    editor.view.dom.addEventListener("compositionupdate", handleCompositionUpdate);
    editor.view.dom.addEventListener("compositionend", handleCompositionEnd);
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    editor.commands.focus("start");
    requestCenterCaret(true, "initial");
    requestVisibleWindow();
    requestLineBreakMarks();
    document.fonts?.ready.then(() => {
      requestCenterCaret(true, "font-ready");
      requestVisibleWindow();
      requestLineBreakMarks();
    });

    onReady(handle);

    return () => {
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("mousedown", handleMouseDown);
      editor.view.dom.removeEventListener("compositionstart", handleCompositionStart);
      editor.view.dom.removeEventListener("compositionupdate", handleCompositionUpdate);
      editor.view.dom.removeEventListener("compositionend", handleCompositionEnd);
      scroller.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      if (centerFrame !== null) cancelAnimationFrame(centerFrame);
      if (visibleFrame !== null) cancelAnimationFrame(visibleFrame);
      if (lineBreakFrame !== null) cancelAnimationFrame(lineBreakFrame);
      if (compositionFrame !== null) cancelAnimationFrame(compositionFrame);
      renderLineBreakMarksRef.current = null;
      requestLineBreakMarksRef.current = null;
      if (lineBreakLayerRef.current) lineBreakLayerRef.current.textContent = "";
      editor.destroy();
      if (tiptapRef.current === editor) tiptapRef.current = null;
      onReady(null);
    };
  }, [handle, onReady]);

  return (
    <div className="verticalTypewriterShell">
      <div ref={scrollerRef} className="verticalTypewriterScroller">
        <div ref={editorHostRef} className="verticalTypewriterEditor" />
        <div ref={lineBreakLayerRef} className="visibleLineBreakLayer" aria-hidden="true" />
      </div>
      <div className="verticalTypewriterGuide" />
    </div>
  );
}
