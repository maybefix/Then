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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  areDocumentIndexesEquivalent,
  createDocumentIndexFromLines,
  updateDocumentIndex,
  type DocumentIndex,
  type DocumentLineDiff,
} from "./editor/documentIndex";
import {
  lineNumberFromTopLevelIndex,
  type TextEditorSelection,
} from "./editor/selectionMetrics";
import { updateTextFromLineDiff } from "./editor/lineTextUpdate";
import { findJapaneseQuoteRanges } from "./editor/japaneseQuoteRanges";
import {
  createVisualLineBands,
  findClosestVisualLineBand,
  resolveVisualLineLayerUpdate,
  type VisualBlockRect,
} from "./editor/visualLineLayout";
import { lineDiffFromSelectionTransaction } from "./editor/transactionLineDiff";
import type {
  EditorDisplayMode,
  PageFlowDirection,
  TextEditorViewportState,
  WritingMode,
} from "./types";

export type TextEditorHandle = {
  focus: () => void;
  getValue: () => string;
  getSelection: () => TextEditorSelection;
  selectRange: (from: number, to: number) => void;
  replaceRange: (from: number, to: number, insert: string, cursorPos?: number) => void;
  jumpToLine: (line: number) => void;
  positionFromPoint: (x: number, y: number) => number | null;
  getViewportState: () => TextEditorViewportState | null;
  /** 本文オフセットの画面座標（ビューポート基準）。ドロップ位置表示などに使う。 */
  coordsAtPos: (
    offset: number,
  ) => { left: number; right: number; top: number; bottom: number } | null;
  scrollCaretIntoView: (offsetPercent: number) => void;
  isComposing: () => boolean;
};

type VerticalTextEditorProps = {
  text: string;
  editorRevision: number | null;
  writingMode: WritingMode;
  editorDisplayMode: EditorDisplayMode;
  pageFlowDirection: PageFlowDirection;
  typewriterScroll: boolean;
  showTypewriterGuide: boolean;
  typewriterOffset: number;
  showLineBreakMarks: boolean;
  showLineNumbers: boolean;
  highlightCurrentLine: boolean;
  colorizeJapaneseQuotes: boolean;
  /**
   * 文字寸法に影響する設定（フォント・文字サイズ・行間・文字表示幅）の合成値。
   * ページ表示中の .pm-root はCSSで寸法固定されておりResizeObserverが発火しない
   * ため、この値の変化でページ再分割の同期と表示位置の復元を行う。
   */
  textLayoutSignature: string;
  /** マウント時に復元するカーソル位置（本文先頭からの文字オフセット）。 */
  initialSelectionOffset?: number;
  /** 同じタブを再表示するときに復元する論理的な表示位置。 */
  initialViewportState?: TextEditorViewportState | null;
  /**
   * エディタのスクロール領域の内寸（クライアントサイズ, px）と、本文ルート
   * (.pm-root) の上下パディング実測値を通知する。文字表示幅設定の上限算出に
   * 使う。アンマウント時は null を通知する。
   */
  onViewportSizeChange?: (
    size: { width: number; height: number; verticalPadding: number } | null,
  ) => void;
  onReady: (editor: TextEditorHandle | null) => void;
  onTextChange: (text: string, editorRevision: number) => void;
  onSelectionChange: () => void;
  onPageMetricsChange?: (metrics: { current: number; total: number } | null) => void;
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
  documentIndex: DocumentIndex | null;
  text: string;
  decoSet: DecorationSet;
  activeIndex: number;
  visibleCenter: number;
  fullDecorations: boolean;
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
  fullDecorations?: boolean;
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
const INITIAL_CENTER_SETTLE_MS = 500;
const INITIAL_CENTER_STABLE_FRAMES = 2;
// 縦書きの行番号を本文上端から離し、数字と先頭文字を視覚的に分離する。
const VERTICAL_LINE_NUMBER_TOP_OFFSET_PX = 18;
const PLACEHOLDER = "# 見出し\n- リスト項目\nここに入力……";

type PageMetrics = { current: number; total: number };

type PageLayout = {
  width: number;
  height: number;
  gap: number;
  outerMargin: number;
  paddingX: number;
  paddingY: number;
  contentWidth: number;
  contentHeight: number;
  columnGap: number;
  columnStep: number;
};

const DEFAULT_PAGE_METRICS: PageMetrics = { current: 1, total: 1 };
const DEFAULT_PAGE_LAYOUT: PageLayout = {
  width: 1,
  height: 1,
  gap: 28,
  outerMargin: 0,
  paddingX: 1,
  paddingY: 1,
  contentWidth: 1,
  contentHeight: 1,
  columnGap: 30,
  columnStep: 31,
};

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

function updateEmptyAttribute(editor: Editor, knownText?: string): void {
  const text = knownText ?? docToText(editor.state.doc);
  editor.view.dom.dataset.empty = text.length === 0 ? "true" : "false";
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

function cloneLineNode(line: LineNode, lineIndex: number): LineNode {
  return {
    ...line,
    lineIndex,
  };
}

function diffTopLevelNodes(oldDoc: PMNode, newDoc: PMNode): DocumentLineDiff {
  const oldCount = oldDoc.childCount;
  const newCount = newDoc.childCount;
  let head = 0;
  const maxHead = Math.min(oldCount, newCount);

  while (head < maxHead) {
    const oldNode = oldDoc.child(head);
    const newNode = newDoc.child(head);
    if (oldNode !== newNode && !oldNode.eq(newNode)) break;
    head += 1;
  }

  let tail = 0;
  const maxTail = Math.min(oldCount - head, newCount - head);
  while (tail < maxTail) {
    const oldNode = oldDoc.child(oldCount - 1 - tail);
    const newNode = newDoc.child(newCount - 1 - tail);
    if (oldNode !== newNode && !oldNode.eq(newNode)) break;
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
  newDoc: PMNode,
  diff: DocumentLineDiff,
): LineNode[] {
  const next: LineNode[] = [];

  for (let i = 0; i < diff.from; i += 1) {
    next.push(oldLines[i]);
  }

  for (let i = diff.from; i < diff.toNew; i += 1) {
    next.push(parseLineNode(newDoc.child(i).textContent, i));
  }

  for (let oldIndex = diff.toOld; oldIndex < oldLines.length; oldIndex += 1) {
    const oldLine = oldLines[oldIndex];
    next.push(oldLine.lineIndex === next.length ? oldLine : cloneLineNode(oldLine, next.length));
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

function pushJapaneseQuoteDecos(
  out: Decoration[],
  line: LineNode,
  contentStart: number,
): void {
  for (const range of findJapaneseQuoteRanges(line.source)) {
    out.push(
      Decoration.inline(contentStart + range.from, contentStart + range.to, {
        class: "japanese-quote",
      }),
    );
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
  pushJapaneseQuoteDecos(out, line, contentStart);

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
  fullDecorations: boolean,
): DecorationSet {
  const out: Decoration[] = [];
  const count = Math.min(doc.childCount, lines.length);
  const ranges = fullDecorations
    ? [{ from: 0, to: count }]
    : decorationRange(activeIndex, count, visibleCenter);

  for (const range of ranges) {
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
  const texts = topTexts(state.doc);
  const lines = texts.map((line, index) => parseLineNode(line, index));
  const activeIndex = activeLineIndex(state);
  return {
    lines,
    documentIndex: import.meta.env.DEV ? createDocumentIndexFromLines(texts) : null,
    text: texts.join("\n"),
    activeIndex,
    visibleCenter: activeIndex,
    fullDecorations: false,
    decoSet: buildWindowDecos(state.doc, lines, activeIndex, activeIndex, false),
  };
}

function updateDocumentIndexWithShadow(
  previous: DocumentIndex | null,
  newLines: readonly LineNode[],
  diff: DocumentLineDiff,
): DocumentIndex | null {
  if (!import.meta.env.DEV || !previous) return null;

  const newTexts = newLines.map((line) => line.source);
  const incremental = updateDocumentIndex(previous, newTexts, diff);
  const rebuilt = createDocumentIndexFromLines(newTexts);
  if (areDocumentIndexesEquivalent(incremental, rebuilt)) return incremental;

  console.error("[document-index-shadow] incremental metrics diverged; using full rebuild", {
    diff,
    incremental,
    rebuilt,
  });
  return rebuilt;
}

function updateEditorTextWithShadow(
  previousText: string,
  oldLines: readonly LineNode[],
  newLines: readonly LineNode[],
  diff: DocumentLineDiff,
): string {
  const text = updateTextFromLineDiff(previousText, oldLines, newLines, diff);
  if (!import.meta.env.DEV) return text;

  const rebuilt = newLines.map((line) => line.source).join("\n");
  if (text === rebuilt) return text;

  console.error("[editor-text-shadow] incremental text diverged; using full materialization", {
    diff,
    text,
    rebuilt,
  });
  return rebuilt;
}

function applyAst(
  tr: Transaction,
  value: AstPluginState,
  _oldState: EditorState,
  newState: EditorState,
): AstPluginState {
  const meta = tr.getMeta(astKey) as AstMeta | undefined;
  let visibleCenter = value.visibleCenter;
  const fullDecorations =
    typeof meta?.fullDecorations === "boolean"
      ? meta.fullDecorations
      : value.fullDecorations;

  if (typeof meta?.visibleCenter === "number") {
    visibleCenter = Math.max(0, Math.min(newState.doc.childCount - 1, meta.visibleCenter));
  }

  if (!tr.docChanged) {
    const activeIndex = activeLineIndex(newState);
    if (
      meta?.rebuild !== true &&
      activeIndex === value.activeIndex &&
      visibleCenter === value.visibleCenter &&
      fullDecorations === value.fullDecorations
    ) {
      return value;
    }

    return {
      ...value,
      activeIndex,
      visibleCenter,
      fullDecorations,
      decoSet: buildWindowDecos(
        newState.doc,
        value.lines,
        activeIndex,
        visibleCenter,
        fullDecorations,
      ),
    };
  }

  const diff = lineDiffFromSelectionTransaction(tr, _oldState, newState)
    ?? diffTopLevelNodes(_oldState.doc, newState.doc);
  const lines = incrementalLines(value.lines, newState.doc, diff);
  const documentIndex = updateDocumentIndexWithShadow(value.documentIndex, lines, diff);
  const text = updateEditorTextWithShadow(value.text, value.lines, lines, diff);
  const activeIndex = activeLineIndex(newState);

  if (tr.getMeta("composition") !== undefined) {
    return {
      lines,
      documentIndex,
      text,
      activeIndex,
      visibleCenter,
      fullDecorations,
      decoSet: value.decoSet.map(tr.mapping, newState.doc),
    };
  }

  return {
    lines,
    documentIndex,
    text,
    activeIndex,
    visibleCenter,
    fullDecorations,
    decoSet: buildWindowDecos(
      newState.doc,
      lines,
      activeIndex,
      visibleCenter,
      fullDecorations,
    ),
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

function getTextSelection(editor: Editor): TextEditorSelection {
  const selection = editor.state.selection;
  return {
    from: textOffsetFromPmPos(editor.state.doc, selection.from),
    to: textOffsetFromPmPos(editor.state.doc, selection.to),
    head: textOffsetFromPmPos(editor.state.doc, selection.head),
    line: lineNumberFromTopLevelIndex(selection.$head.index(0)),
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

function isHorizontalWriting(writingMode: WritingMode): boolean {
  return writingMode === "horizontal-tb";
}

function scrollAxis(writingMode: WritingMode): {
  get: (element: HTMLElement) => number;
  set: (element: HTMLElement, value: number) => void;
  viewportStart: (rect: DOMRect) => number;
  viewportSize: (rect: DOMRect) => number;
  rectCenter: (rect: Pick<DOMRect, "top" | "bottom" | "left" | "right">) => number;
} {
  if (isHorizontalWriting(writingMode)) {
    return {
      get: (element) => element.scrollTop,
      set: (element, value) => {
        element.scrollTop = value;
      },
      viewportStart: (rect) => rect.top,
      viewportSize: (rect) => rect.height,
      rectCenter: (rect) => (rect.top + rect.bottom) / 2,
    };
  }

  return {
    get: (element) => element.scrollLeft,
    set: (element, value) => {
      element.scrollLeft = value;
    },
    viewportStart: (rect) => rect.left,
    viewportSize: (rect) => rect.width,
    rectCenter: (rect) => (rect.left + rect.right) / 2,
  };
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

function activeBlockColumnRect(view: EditorView, writingMode: WritingMode): DOMRect | null {
  const element = activeBlockElement(view);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (!rectHasArea(rect)) return null;

  const lineHeight = lineHeightPx(element);
  if (isHorizontalWriting(writingMode)) {
    const height = Math.max(1, Math.min(rect.height || lineHeight || 1, lineHeight || rect.height || 1));
    return new DOMRect(
      rect.left,
      rect.top + rect.height / 2 - height / 2,
      Math.max(1, rect.width || lineHeight),
      height,
    );
  }

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

function coordsAtSelectionHead(view: EditorView): DOMRect | null {
  try {
    return nonEmptyRect(view.coordsAtPos(selectionSafeHead(view)) as DOMRect);
  } catch {
    return null;
  }
}

function selectionSafeHead(view: EditorView): number {
  const max = view.state.doc.content.size;
  return Math.max(1, Math.min(max, view.state.selection.head));
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

function selectionColumnAnchor(
  view: EditorView,
  writingMode: WritingMode,
): { rect: DOMRect | null; source: string } {
  const selection = view.state.selection;
  const head = selection.head;
  const parentSize = selection.$head.parent ? selection.$head.parent.content.size : 0;
  const parentOffset = selection.$head.parentOffset || 0;

  if (parentSize === 0) {
    return { rect: activeBlockColumnRect(view, writingMode), source: "block-empty" };
  }

  if (isHorizontalWriting(writingMode)) {
    const rect = coordsAtSelectionHead(view);
    if (rect) return { rect, source: "coords-head" };
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

function blockFallbackEndRect(element: Element, writingMode: WritingMode): DOMRect | null {
  const rect = element.getBoundingClientRect();
  if (!rectHasArea(rect)) return null;

  const lineHeight = lineHeightPx(element) || 16;
  if (isHorizontalWriting(writingMode)) {
    const height = Math.max(1, Math.min(rect.height || lineHeight, lineHeight));
    return new DOMRect(
      rect.right,
      rect.top + rect.height / 2 - height / 2,
      1,
      height,
    );
  }

  const width = Math.max(1, Math.min(rect.width || lineHeight, lineHeight));

  return new DOMRect(
    rect.right - width,
    rect.top,
    width,
    Math.max(1, Math.min(rect.height || lineHeight, lineHeight)),
  );
}

function paragraphEndRect(
  editor: Editor,
  index: number,
  writingMode: WritingMode,
): DOMRect | null {
  if (index < 0 || index >= editor.state.doc.childCount) return null;

  const element = editor.view.dom.children[index];
  if (!(element instanceof Element)) return null;

  const paintedRect = lastPaintedTextRectInBlock(element);
  if (paintedRect && rectHasArea(paintedRect)) return paintedRect;

  const nodeStart = pmStartAtIndex(editor.state.doc, index);
  if (nodeStart === null) return blockFallbackEndRect(element, writingMode);

  const node = editor.state.doc.child(index);
  const length = node.content.size;
  const maxScan = Math.min(length, 64);

  for (let step = 0; step < maxScan; step += 1) {
    const from = nodeStart + length - step;
    const rect = domRangeRect(editor.view, from, from + 1, true);
    if (rect && rectHasArea(rect)) return rect;
  }

  return blockFallbackEndRect(element, writingMode);
}

function measureCenterDelta(
  editor: Editor,
  scroller: HTMLElement,
  offsetPercent: number,
  writingMode: WritingMode,
): number | null {
  const anchor = selectionColumnAnchor(editor.view, writingMode);
  const rect = anchor.rect;
  if (!rect) return null;

  const axis = scrollAxis(writingMode);
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRatio = Number.isFinite(offsetPercent) ? offsetPercent / 100 : 0.5;
  const viewportTarget = axis.viewportStart(scrollerRect) + axis.viewportSize(scrollerRect) * targetRatio;
  const caretCenter = axis.rectCenter(rect);
  return caretCenter - viewportTarget;
}

function centerCaretForEditor(
  editor: Editor,
  scroller: HTMLElement,
  offsetPercent: number,
  writingMode: WritingMode,
): void {
  if (isEditorComposing(editor)) return;

  const delta = measureCenterDelta(editor, scroller, offsetPercent, writingMode);
  if (delta === null) return;

  const axis = scrollAxis(writingMode);
  const current = axis.get(scroller);
  const target = snapScrollValue(current + delta);

  if (Math.abs(target - current) < SCROLL_EPS) return;
  axis.set(scroller, target);
}

function measureViewportAnchorDelta(
  editor: Editor,
  scroller: HTMLElement,
  viewportState: TextEditorViewportState,
): number | null {
  const pos = pmPosFromTextOffset(editor.state.doc, viewportState.anchorOffset);

  try {
    const coords = editor.view.coordsAtPos(pos);
    const axis = scrollAxis(viewportState.writingMode);
    const scrollerRect = scroller.getBoundingClientRect();
    const viewportTarget =
      axis.viewportStart(scrollerRect) +
      axis.viewportSize(scrollerRect) * viewportState.anchorRatio;
    return axis.rectCenter(coords) - viewportTarget;
  } catch {
    return null;
  }
}

function restoreViewportAnchorForEditor(
  editor: Editor,
  scroller: HTMLElement,
  viewportState: TextEditorViewportState,
): void {
  const delta = measureViewportAnchorDelta(editor, scroller, viewportState);
  if (delta === null) return;

  const axis = scrollAxis(viewportState.writingMode);
  const current = axis.get(scroller);
  const target = snapScrollValue(current + delta);
  if (Math.abs(target - current) < SCROLL_EPS) return;
  axis.set(scroller, target);
}

function domLineIndexFromElement(root: HTMLElement, element: Element | null): number {
  let current: Element | null = element;

  while (current && current !== root && current.parentElement !== root) {
    current = current.parentElement;
  }

  if (!current || current === root || current.parentElement !== root) return -1;
  return Array.prototype.indexOf.call(root.children, current);
}

function estimateVisibleCenterIndex(
  editor: Editor,
  scroller: HTMLElement,
  writingMode: WritingMode,
): number {
  const rect = scroller.getBoundingClientRect();
  const points = isHorizontalWriting(writingMode)
    ? [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + rect.width / 2, rect.top + rect.height * 0.35],
        [rect.left + rect.width / 2, rect.top + rect.height * 0.65],
      ]
    : [
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
  writingMode,
  editorDisplayMode,
  pageFlowDirection,
  typewriterScroll,
  showTypewriterGuide,
  typewriterOffset,
  showLineBreakMarks,
  showLineNumbers,
  highlightCurrentLine,
  colorizeJapaneseQuotes,
  textLayoutSignature,
  initialSelectionOffset,
  initialViewportState,
  onViewportSizeChange,
  onReady,
  onTextChange,
  onSelectionChange,
  onPageMetricsChange,
}: VerticalTextEditorProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const lineBreakLayerRef = useRef<HTMLDivElement | null>(null);
  const visualLineLayerRef = useRef<HTMLDivElement | null>(null);
  const tiptapRef = useRef<Editor | null>(null);
  const textRef = useRef(text);
  // マウント時に一度だけ参照する復元位置。以後プロップが変化しても再適用しない。
  const initialSelectionRef = useRef(
    Number.isFinite(initialSelectionOffset) ? Math.max(0, initialSelectionOffset as number) : 0,
  );
  // マウント時だけ参照し、表示中のタブ状態更新では再適用しない。
  const initialViewportRef = useRef(initialViewportState ?? null);
  const onTextChangeRef = useRef(onTextChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onPageMetricsChangeRef = useRef(onPageMetricsChange);
  const localRevisionRef = useRef(0);
  const composingRef = useRef(false);
  // マウスでのドラッグ範囲選択中は true。ジェスチャ中は再センタリングを抑制し、
  // pointerup 時にキャレットが collapsed なら一度だけ寄せ、範囲が残るなら据え置く。
  const pointerDraggingRef = useRef(false);
  const writingModeRef = useRef<WritingMode>(writingMode);
  const editorDisplayModeRef = useRef<EditorDisplayMode>(editorDisplayMode);
  const pageFlowDirectionRef = useRef<PageFlowDirection>(pageFlowDirection);
  const typewriterScrollRef = useRef(typewriterScroll && editorDisplayMode === "continuous");
  const typewriterOffsetRef = useRef(typewriterOffset);
  const showLineBreakMarksRef = useRef(showLineBreakMarks);
  const showLineNumbersRef = useRef(showLineNumbers);
  const highlightCurrentLineRef = useRef(highlightCurrentLine);
  const renderLineBreakMarksRef = useRef<(() => void) | null>(null);
  const requestLineBreakMarksRef = useRef<(() => void) | null>(null);
  const renderVisualLinesRef = useRef<(() => void) | null>(null);
  const requestVisualLinesRef = useRef<(() => void) | null>(null);
  const startCenterAnimationRef = useRef<(() => void) | null>(null);
  const stopCenterAnimationRef = useRef<(() => void) | null>(null);
  const cancelInitialAdjustmentRef = useRef<(() => void) | null>(null);
  const syncPageMetricsRef = useRef<(() => void) | null>(null);
  const revealSelectionPageRef = useRef<((editor: Editor) => void) | null>(null);
  const pagedScrollSettleFrameRef = useRef<number | null>(null);
  const pagedScrollSettleGenerationRef = useRef(0);
  // ページ寸法・文字寸法の変更をまたいで表示位置を保つための内容アンカー。
  // スクロール停止のたびに「現在ページ先頭の文書位置」を記録し、レイアウト
  // 変更後はこの位置が属するページへスクロールを復元する。
  const pagedAnchorPosRef = useRef<number | null>(null);
  const pagedAnchorRestoreFrameRef = useRef<number | null>(null);
  const pagedAnchorRestoreGenerationRef = useRef(0);
  const requestPagedAnchorRestoreRef = useRef<(() => void) | null>(null);
  const pageMetricsRef = useRef<PageMetrics>(DEFAULT_PAGE_METRICS);
  const pageLayoutRef = useRef<PageLayout>(DEFAULT_PAGE_LAYOUT);
  const [pageMetrics, setPageMetrics] = useState<PageMetrics>(DEFAULT_PAGE_METRICS);
  const [pageLayout, setPageLayout] = useState<PageLayout>(DEFAULT_PAGE_LAYOUT);
  editorDisplayModeRef.current = editorDisplayMode;
  pageFlowDirectionRef.current = pageFlowDirection;
  typewriterScrollRef.current = typewriterScroll && editorDisplayMode === "continuous";

  const publishPageMetrics = (next: PageMetrics) => {
    const previous = pageMetricsRef.current;
    if (previous.current === next.current && previous.total === next.total) return;
    pageMetricsRef.current = next;
    setPageMetrics(next);
    onPageMetricsChangeRef.current?.(next);
  };

  const syncPageMetrics = () => {
    if (editorDisplayModeRef.current !== "paged") {
      onPageMetricsChangeRef.current?.(null);
      return;
    }
    const scroller = scrollerRef.current;
    const surface = pageSurfaceRef.current;
    const host = editorHostRef.current;
    const root = editorHostRef.current?.querySelector<HTMLElement>(".pm-root");
    if (!scroller || !surface || !host || !root) {
      publishPageMetrics(DEFAULT_PAGE_METRICS);
      return;
    }

    // ページ枠をスクロール領域いっぱいに置くと、clientHeight の丸め（実寸714.9→
    // 715px）で下辺の枠線がクリップされて消える。外側に余白を取り、枠が四辺とも
    // 内側へ収まるようにする。狭い窓では余白を諦めて本文の面積を優先する。
    const viewportWidth = Math.max(1, scroller.clientWidth);
    const viewportHeight = Math.max(1, scroller.clientHeight);
    const outerMargin = viewportWidth >= 480 && viewportHeight >= 360 ? 20 : 0;
    const width = Math.max(1, viewportWidth - outerMargin * 2);
    const height = Math.max(1, viewportHeight - outerMargin * 2);
    const verticalWriting = writingModeRef.current === "vertical-rl";
    const gap = 28;
    const paddingX = Math.max(28, Math.min(72, Math.round(width * 0.08)));
    const paddingY = Math.max(28, Math.min(64, Math.round(height * 0.08)));
    const contentWidth = Math.max(1, width - paddingX * 2);
    const contentHeight = Math.max(1, height - paddingY * 2);
    const columnGap = verticalWriting ? gap + paddingY * 2 : gap + paddingX * 2;
    const columnStep = verticalWriting
      ? contentHeight + columnGap
      : contentWidth + columnGap;
    const nextLayout: PageLayout = {
      width,
      height,
      gap,
      outerMargin,
      paddingX,
      paddingY,
      contentWidth,
      contentHeight,
      columnGap,
      columnStep,
    };
    surface.style.setProperty("--paged-page-width", `${width}px`);
    surface.style.setProperty("--paged-page-height", `${height}px`);
    surface.style.setProperty("--paged-page-gap", `${gap}px`);
    surface.style.setProperty("--paged-outer-margin", `${outerMargin}px`);
    surface.style.setProperty("--paged-padding-x", `${paddingX}px`);
    surface.style.setProperty("--paged-padding-y", `${paddingY}px`);
    surface.style.setProperty("--paged-content-width", `${contentWidth}px`);
    surface.style.setProperty("--paged-content-height", `${contentHeight}px`);
    surface.style.setProperty("--paged-column-gap", `${columnGap}px`);
    // column-width はインライン方向の寸法。縦書きでは縦の長さ（＝本文の高さ）に
    // なるので、横幅を渡すと段の内寸が本文より広く見積もられる。実測では
    // column-width:1159px に対して本文の折り返しは599px（max-inline-size:100%）
    // という食い違いになり、IME変換中の前編集だけが段の内寸いっぱい（＝ページ
    // 枠の外）まで伸びていた。
    surface.style.setProperty(
      "--paged-column-size",
      `${verticalWriting ? contentHeight : contentWidth}px`,
    );

    const previousLayout = pageLayoutRef.current;
    if (
      previousLayout.width !== width ||
      previousLayout.height !== height ||
      previousLayout.outerMargin !== outerMargin ||
      previousLayout.paddingX !== paddingX ||
      previousLayout.paddingY !== paddingY ||
      previousLayout.columnGap !== columnGap ||
      previousLayout.columnStep !== columnStep
    ) {
      pageLayoutRef.current = nextLayout;
      setPageLayout(nextLayout);
      // ページスパンが変わるとスクロール量（px）から導く現在ページが実質
      // ランダムなページへ落ち、ホスト位置とビューポートも食い違う。初回
      // 計測（既定値からの遷移）を除き、記録済みアンカーのページへ復元する。
      if (previousLayout !== DEFAULT_PAGE_LAYOUT) {
        requestPagedAnchorRestoreRef.current?.();
      }
    }

    // 固定寸法のmulticol要素は、収まらない本文を同寸の匿名column boxへ
    // 逐次断片化する。横書きはX軸、縦書きはY軸に生成された断片から数える。
    let fragmentedExtent = verticalWriting ? root.scrollHeight : root.scrollWidth;
    if (verticalWriting) {
      // vertical-rl のfragmentainerは選択状態や内容によってborder boxの基準位置が
      // 移動し得るため、scrollHeightではなくRangeのunion寸法で全ページを数える。
      const contentRange = document.createRange();
      contentRange.selectNodeContents(root);
      fragmentedExtent = Math.max(contentHeight, contentRange.getBoundingClientRect().height);
      contentRange.detach();
    }
    const total = Math.max(1, Math.ceil((fragmentedExtent + columnGap - 1) / columnStep));
    const pageSpan =
      pageFlowDirectionRef.current === "vertical" ? height + gap : width + gap;
    const rawPage =
      pageFlowDirectionRef.current === "vertical"
        ? scroller.scrollTop / pageSpan
        : Math.abs(scroller.scrollLeft) / pageSpan;
    const current = Math.max(1, Math.min(total, Math.round(rawPage) + 1));
    const fragmentOffset = (current - 1) * columnStep;
    const hostOffset = (current - 1) * pageSpan;
    host.style.setProperty(
      "--paged-host-x",
      `${pageFlowDirectionRef.current === "horizontal-rtl" ? -hostOffset : 0}px`,
    );
    host.style.setProperty(
      "--paged-host-y",
      `${pageFlowDirectionRef.current === "vertical" ? hostOffset : 0}px`,
    );
    // ページ枠が内部スクロールしていたら戻す。CSSは overflow: clip にしてある
    // ので通常は0のままだが、clipを解さない環境ではキャレット表示でここが
    // 動き、その量だけ本文がページ枠からずれる。
    if (host.scrollTop !== 0) host.scrollTop = 0;
    if (host.scrollLeft !== 0) host.scrollLeft = 0;
    let verticalBaseOffset = 0;
    if (verticalWriting && root.firstElementChild instanceof HTMLElement) {
      // 断片の基準位置は transform を含まないレイアウト座標で読む。
      // getBoundingClientRect と getComputedStyle().transform の組で基準を
      // 逆算すると、直前に書き込んだ transform が矩形へまだ反映されていない
      // フレームで「補正が自分自身を打ち消す」ループに入る。以後どれだけ
      // 同期しても本文だけがページ枠から数十px下へずれたまま固定され、
      // settleが諦めるまで直らない（最終ページで顕著だった症状）。
      // .pm-root は position:absolute なので、先頭ブロックの offsetTop は
      // 最初の段（column）の .pm-root 内オフセットそのものになる。
      const firstColumnOffset = root.firstElementChild.offsetTop;
      // 段送り1つ分以上ずれた値は計測が壊れている証拠なので補正しない。
      verticalBaseOffset =
        Number.isFinite(firstColumnOffset) && Math.abs(firstColumnOffset) < columnStep
          ? -firstColumnOffset
          : 0;
    }
    root.style.setProperty("--paged-fragment-x", `${verticalWriting ? 0 : -fragmentOffset}px`);
    root.style.setProperty(
      "--paged-fragment-y",
      `${verticalWriting ? verticalBaseOffset - fragmentOffset : 0}px`,
    );
    publishPageMetrics({ current, total });
  };
  syncPageMetricsRef.current = syncPageMetrics;

  // 断片化軸上の座標が属するページ番号（1始まり）を、現在表示中のページを
  // 基準に算出する。レイアウト適用後に呼ぶこと。
  const pageContainingPoint = (center: number): number | null => {
    const host = editorHostRef.current;
    if (!host) return null;
    const layout = pageLayoutRef.current;
    const verticalWriting = writingModeRef.current === "vertical-rl";
    const hostRect = host.getBoundingClientRect();
    const contentStart = verticalWriting
      ? hostRect.top + layout.paddingY
      : hostRect.left + layout.paddingX;
    const relativePage = Math.floor((center - contentStart) / layout.columnStep);
    return pageMetricsRef.current.current + relativePage;
  };

  const pageContainingPosition = (editor: Editor, pos: number): number | null => {
    const clamped = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    let caret: { left: number; right: number; top: number; bottom: number };
    try {
      caret = editor.view.coordsAtPos(clamped);
    } catch {
      return null;
    }
    return pageContainingPoint(
      writingModeRef.current === "vertical-rl"
        ? (caret.top + caret.bottom) / 2
        : (caret.left + caret.right) / 2,
    );
  };

  // 現在ページの本文開始点にある文書位置を復元アンカーとして記録する。
  // 縦書きはページ右上（第1列の先頭）、横書きはページ左上が開始点になる。
  const capturePagedAnchor = () => {
    if (editorDisplayModeRef.current !== "paged") return;
    // 復元スクロールの途中経過を新しいアンカーとして記録しない。
    if (pagedAnchorRestoreFrameRef.current !== null) return;
    const editor = tiptapRef.current;
    const host = editorHostRef.current;
    if (!editor || !host) return;
    const layout = pageLayoutRef.current;
    const hostRect = host.getBoundingClientRect();
    const point =
      writingModeRef.current === "vertical-rl"
        ? { left: hostRect.right - layout.paddingX - 2, top: hostRect.top + layout.paddingY + 2 }
        : { left: hostRect.left + layout.paddingX + 2, top: hostRect.top + layout.paddingY + 2 };
    const found = editor.view.posAtCoords(point);
    pagedAnchorPosRef.current = found ? found.pos : editor.state.selection.head;
  };

  const requestPagedScrollSettle = () => {
    if (editorDisplayModeRef.current !== "paged") return;
    pagedScrollSettleGenerationRef.current += 1;
    const generation = pagedScrollSettleGenerationRef.current;
    if (pagedScrollSettleFrameRef.current !== null) {
      cancelAnimationFrame(pagedScrollSettleFrameRef.current);
    }

    let previousSignature: string | null = null;
    let stableFrames = 0;
    let remainingFrames = 90;
    const step = () => {
      pagedScrollSettleFrameRef.current = null;
      if (
        generation !== pagedScrollSettleGenerationRef.current ||
        editorDisplayModeRef.current !== "paged"
      ) {
        return;
      }

      // Smooth scrollの途中で計算された断片基準を、停止時の実座標でもう一度
      // 正規化する。最終ページの短い断片だけ下へ残る現象をここで解消する。
      syncPageMetricsRef.current?.();
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const offset =
        pageFlowDirectionRef.current === "vertical"
          ? scroller.scrollTop
          : Math.abs(scroller.scrollLeft);
      const root = editorHostRef.current?.querySelector<HTMLElement>(".pm-root");
      const metrics = pageMetricsRef.current;
      const signature = `${Math.round(offset * 2) / 2}:${metrics.current}:${metrics.total}:` +
        `${root?.style.getPropertyValue("--paged-fragment-x") ?? ""}:` +
        `${root?.style.getPropertyValue("--paged-fragment-y") ?? ""}`;
      stableFrames = signature === previousSignature ? stableFrames + 1 : 0;
      previousSignature = signature;
      remainingFrames -= 1;

      if (stableFrames >= 2 || remainingFrames <= 0) {
        syncPageMetricsRef.current?.();
        requestVisualLinesRef.current?.();
        requestLineBreakMarksRef.current?.();
        // 静止した表示を次のレイアウト変更に備えたアンカーとして記録する。
        capturePagedAnchor();
        return;
      }
      pagedScrollSettleFrameRef.current = requestAnimationFrame(step);
    };

    pagedScrollSettleFrameRef.current = requestAnimationFrame(step);
  };

  const scrollToPage = (targetPage: number, behavior: ScrollBehavior) => {
    const scroller = scrollerRef.current;
    if (!scroller || editorDisplayModeRef.current !== "paged") return;
    const target = Math.max(1, Math.min(pageMetricsRef.current.total, targetPage));
    const layout = pageLayoutRef.current;
    if (pageFlowDirectionRef.current === "horizontal-rtl") {
      scroller.scrollTo({
        left: -(target - 1) * (layout.width + layout.gap),
        behavior,
      });
    } else {
      scroller.scrollTo({
        top: (target - 1) * (layout.height + layout.gap),
        behavior,
      });
    }
    requestPagedScrollSettle();
  };

  const revealSelectionPageNow = (editor: Editor) => {
    if (editorDisplayModeRef.current !== "paged") return;
    if (tiptapRef.current !== editor) return;
    if (!scrollerRef.current) return;
    const target = pageContainingPosition(editor, editor.state.selection.head);
    if (target === null || target === pageMetricsRef.current.current) return;
    scrollToPage(target, "auto");
  };

  // レイアウト（ページ寸法・文字寸法・ページ送り方向）変更後に、アンカー
  // 位置の属するページへスクロールを復元する。React側のページ面サイズ更新が
  // 遅れて総ページ数が変わるため、目標ページと表示が一致するまで数フレーム
  // 追跡する。アンカー未記録時はキャレット位置へフォールバックする。
  const requestPagedAnchorRestore = () => {
    if (editorDisplayModeRef.current !== "paged") return;
    pagedAnchorRestoreGenerationRef.current += 1;
    const generation = pagedAnchorRestoreGenerationRef.current;
    if (pagedAnchorRestoreFrameRef.current !== null) {
      cancelAnimationFrame(pagedAnchorRestoreFrameRef.current);
    }

    let remainingFrames = 12;
    const step = () => {
      pagedAnchorRestoreFrameRef.current = null;
      if (
        generation !== pagedAnchorRestoreGenerationRef.current ||
        editorDisplayModeRef.current !== "paged"
      ) {
        return;
      }
      const editor = tiptapRef.current;
      const scroller = scrollerRef.current;
      if (!editor || !scroller) return;

      syncPageMetricsRef.current?.();
      const anchor = pagedAnchorPosRef.current ?? editor.state.selection.head;
      const target = pageContainingPosition(editor, anchor);
      if (target === null) return;
      const layout = pageLayoutRef.current;
      const clampedTarget = Math.max(1, Math.min(pageMetricsRef.current.total, target));
      const expectedOffset =
        (clampedTarget - 1) *
        (pageFlowDirectionRef.current === "vertical"
          ? layout.height + layout.gap
          : layout.width + layout.gap);
      const currentOffset =
        pageFlowDirectionRef.current === "vertical"
          ? scroller.scrollTop
          : Math.abs(scroller.scrollLeft);

      if (
        clampedTarget === pageMetricsRef.current.current &&
        Math.abs(currentOffset - expectedOffset) <= 1
      ) {
        // 目標ページの境界に載った。行表示を確定させて終了する。
        requestPagedScrollSettle();
        return;
      }
      scrollToPage(clampedTarget, "auto");
      remainingFrames -= 1;
      if (remainingFrames <= 0) return;
      pagedAnchorRestoreFrameRef.current = requestAnimationFrame(step);
    };

    pagedAnchorRestoreFrameRef.current = requestAnimationFrame(step);
  };
  requestPagedAnchorRestoreRef.current = requestPagedAnchorRestore;

  const revealSelectionPage = (editor: Editor) => {
    if (editorDisplayModeRef.current !== "paged") return;
    syncPageMetricsRef.current?.();
    requestAnimationFrame(() => revealSelectionPageNow(editor));
  };
  revealSelectionPageRef.current = revealSelectionPage;

  const movePage = (delta: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller || editorDisplayModeRef.current !== "paged") return;
    cancelInitialAdjustmentRef.current?.();
    stopCenterAnimationRef.current?.();
    // 本文は現在ページのfragmentだけを単一のclip hostへ載せている。
    // smooth scroll中にページ境界をまたぐとhostが途中フレームで次ページへ
    // 切り替わり、短い最終ページでは本文が一瞬だけ上下へ跳ねて見える。
    // ページ単位の操作は境界へ直接移動し、中間の不整合フレームを作らない。
    scrollToPage(pageMetricsRef.current.current + delta, "auto");
  };

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    onPageMetricsChangeRef.current = onPageMetricsChange;
    onPageMetricsChange?.(editorDisplayMode === "paged" ? pageMetricsRef.current : null);
  }, [editorDisplayMode, onPageMetricsChange]);

  useEffect(() => {
    requestAnimationFrame(() => syncPageMetricsRef.current?.());
  }, [text]);

  // 編集表示・ページ送り方向・本文方向・文字寸法設定の変更では、断片構成や
  // ページスパンの軸が変わるため、同期に加えて表示位置の復元まで行う。
  // 初回マウント時は初期ビューポート復元と競合させない（同期のみ）。
  const pagedLayoutEffectMountedRef = useRef(false);
  useEffect(() => {
    if (!pagedLayoutEffectMountedRef.current) {
      pagedLayoutEffectMountedRef.current = true;
      requestAnimationFrame(() => syncPageMetricsRef.current?.());
      return;
    }
    if (editorDisplayMode !== "paged") {
      // ページ表示を離れたらアンカーは無効。次回ページ表示への切替では
      // キャレット位置へのフォールバックで表示ページを決める。
      pagedAnchorPosRef.current = null;
      requestAnimationFrame(() => syncPageMetricsRef.current?.());
      return;
    }
    requestAnimationFrame(() => requestPagedAnchorRestoreRef.current?.());
  }, [editorDisplayMode, pageFlowDirection, writingMode, textLayoutSignature]);

  // スクロール領域の内寸（スクロールバー除く）と .pm-root の上下パディング
  // 実測値を親へ通知する。文字表示幅設定のスライダー上限が常に実際の描画
  // 上限と一致するようにする（CSS 側のパディング変更に自動追従させるため、
  // 定数を持たず computed style から読む）。
  useEffect(() => {
    const scroller = scrollerRef.current;
    const host = editorHostRef.current;
    if (!scroller || !host || !onViewportSizeChange) return;

    const report = () => {
      const pmRoot = host.querySelector<HTMLElement>(".pm-root");
      const pmRootStyle = pmRoot ? getComputedStyle(pmRoot) : null;
      const verticalPadding = pmRootStyle
        ? (Number.parseFloat(pmRootStyle.paddingTop) || 0) +
          (Number.parseFloat(pmRootStyle.paddingBottom) || 0)
        : 0;
      onViewportSizeChange({
        width: scroller.clientWidth,
        height: scroller.clientHeight,
        verticalPadding,
      });
      syncPageMetricsRef.current?.();
    };
    report();
    const resizeObserver = new ResizeObserver(report);
    resizeObserver.observe(scroller);
    // .pm-root は Tiptap がこのエフェクトより後に生成するため、出現・差し替えを
    // 直接監視して再実測する（フレーム競合に依存しない）。
    const mutationObserver = new MutationObserver(report);
    mutationObserver.observe(host, { childList: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      onViewportSizeChange(null);
    };
  }, [onViewportSizeChange, writingMode]);

  useEffect(() => {
    typewriterOffsetRef.current = Number.isFinite(typewriterOffset) ? typewriterOffset : 50;
  }, [typewriterOffset]);

  useEffect(() => {
    const editor = tiptapRef.current;
    const scroller = scrollerRef.current;
    if (editorDisplayMode !== "continuous" || !typewriterScroll || !editor || !scroller) {
      stopCenterAnimationRef.current?.();
      return;
    }
    requestAnimationFrame(() => {
      if (!typewriterScrollRef.current || isEditorComposing(editor, composingRef)) return;
      centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, writingModeRef.current);
      requestLineBreakMarksRef.current?.();
    });
  }, [editorDisplayMode, typewriterScroll]);

  useEffect(() => {
    writingModeRef.current = writingMode;
    const editor = tiptapRef.current;
    const scroller = scrollerRef.current;
    if (editor && scroller && typewriterScrollRef.current && !isEditorComposing(editor, composingRef)) {
      requestAnimationFrame(() => {
        if (!typewriterScrollRef.current) return;
        stopCenterAnimationRef.current?.();
        centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, writingModeRef.current);
        requestLineBreakMarksRef.current?.();
        requestVisualLinesRef.current?.();
      });
    } else {
      requestLineBreakMarksRef.current?.();
      requestVisualLinesRef.current?.();
    }
  }, [writingMode]);

  useEffect(() => {
    showLineBreakMarksRef.current = showLineBreakMarks;
    if (showLineBreakMarks) {
      requestLineBreakMarksRef.current?.();
    } else {
      renderLineBreakMarksRef.current?.();
    }
  }, [showLineBreakMarks]);

  useEffect(() => {
    showLineNumbersRef.current = showLineNumbers;
    const editor = tiptapRef.current;
    if (editor) {
      const state = astKey.getState(editor.state);
      if (state?.fullDecorations !== showLineNumbers) {
        editor.view.dispatch(
          editor.state.tr
            .setMeta(astKey, {
              rebuild: true,
              fullDecorations: showLineNumbers,
            } satisfies AstMeta)
            .setMeta("addToHistory", false),
        );
      }
    }
    if (showLineNumbers) {
      requestVisualLinesRef.current?.();
    } else {
      renderVisualLinesRef.current?.();
    }
  }, [showLineNumbers]);

  useEffect(() => {
    highlightCurrentLineRef.current = highlightCurrentLine;
    if (highlightCurrentLine) {
      requestVisualLinesRef.current?.();
    } else {
      renderVisualLinesRef.current?.();
    }
  }, [highlightCurrentLine]);

  const handle = useMemo<TextEditorHandle>(
    () => ({
      focus: () => {
        const editor = tiptapRef.current;
        if (!editor) return;
        if (editorDisplayModeRef.current === "paged") {
          editor.view.dom.focus({ preventScroll: true });
          revealSelectionPageRef.current?.(editor);
        } else {
          editor.commands.focus();
        }
      },
      getValue: () => {
        const editor = tiptapRef.current;
        return editor ? docToText(editor.state.doc) : textRef.current;
      },
      getSelection: () => {
        const editor = tiptapRef.current;
        return editor ? getTextSelection(editor) : { from: 0, to: 0, head: 0, line: 1 };
      },
      selectRange: (from, to) => {
        cancelInitialAdjustmentRef.current?.();
        const editor = tiptapRef.current;
        const scroller = scrollerRef.current;
        if (!editor) return;

        const current = docToText(editor.state.doc);
        const start = Math.max(0, Math.min(current.length, from));
        const end = Math.max(start, Math.min(current.length, to));
        editor.commands.focus();
        editor.commands.setTextSelection({
          from: pmPosFromTextOffset(editor.state.doc, start),
          to: pmPosFromTextOffset(editor.state.doc, end),
        });
        onSelectionChangeRef.current();
        if (scroller && typewriterScrollRef.current) {
          stopCenterAnimationRef.current?.();
          centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, writingModeRef.current);
        }
        requestLineBreakMarksRef.current?.();
      },
      replaceRange: (from, to, insert, cursorPos) => {
        cancelInitialAdjustmentRef.current?.();
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
        if (scroller && typewriterScrollRef.current) {
          stopCenterAnimationRef.current?.();
          centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, writingModeRef.current);
        }
        requestLineBreakMarksRef.current?.();
      },
      jumpToLine: (line) => {
        cancelInitialAdjustmentRef.current?.();
        const editor = tiptapRef.current;
        const scroller = scrollerRef.current;
        if (!editor) return;

        const index = Math.max(0, Math.min(editor.state.doc.childCount - 1, line - 1));
        const pos = (pmStartAtIndex(editor.state.doc, index) ?? 0) + 1;
        if (editorDisplayModeRef.current === "paged") {
          editor.view.dom.focus({ preventScroll: true });
        } else {
          editor.commands.focus();
        }
        editor.commands.setTextSelection(pos);
        onSelectionChangeRef.current();
        if (editorDisplayModeRef.current === "paged") {
          revealSelectionPageRef.current?.(editor);
        } else if (scroller && typewriterScrollRef.current) {
          stopCenterAnimationRef.current?.();
          centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, writingModeRef.current);
        }
        requestLineBreakMarksRef.current?.();
      },
      positionFromPoint: (x, y) => {
        const editor = tiptapRef.current;
        if (!editor) return null;

        const result = editor.view.posAtCoords({ left: x, top: y });
        return result ? textOffsetFromPmPos(editor.state.doc, result.pos) : null;
      },
      getViewportState: () => {
        const editor = tiptapRef.current;
        const scroller = scrollerRef.current;
        if (!editor || !scroller) return null;

        const scrollerRect = scroller.getBoundingClientRect();
        const mode = writingModeRef.current;
        const primaryRatios = [0.5, 0.35, 0.65];

        for (const ratio of primaryRatios) {
          const point = isHorizontalWriting(mode)
            ? {
                left: scrollerRect.left + scrollerRect.width / 2,
                top: scrollerRect.top + scrollerRect.height * ratio,
              }
            : {
                left: scrollerRect.left + scrollerRect.width * ratio,
                top: scrollerRect.top + scrollerRect.height / 2,
              };
          const result = editor.view.posAtCoords(point);
          if (!result) continue;

          try {
            const coords = editor.view.coordsAtPos(result.pos);
            const viewportStart = isHorizontalWriting(mode)
              ? scrollerRect.top
              : scrollerRect.left;
            const viewportSize = isHorizontalWriting(mode)
              ? scrollerRect.height
              : scrollerRect.width;
            const anchorCenter = isHorizontalWriting(mode)
              ? (coords.top + coords.bottom) / 2
              : (coords.left + coords.right) / 2;
            const anchorRatio = (anchorCenter - viewportStart) / viewportSize;
            if (!Number.isFinite(anchorRatio) || anchorRatio < 0 || anchorRatio > 1) {
              continue;
            }

            const currentText = docToText(editor.state.doc);
            return {
              textLength: currentText.length,
              writingMode: mode,
              anchorOffset: textOffsetFromPmPos(editor.state.doc, result.pos),
              anchorRatio,
            };
          } catch {
            // DOM が差し替わる瞬間は座標取得に失敗し得る。次の候補点を試す。
          }
        }

        return null;
      },
      coordsAtPos: (offset) => {
        const editor = tiptapRef.current;
        if (!editor) return null;
        const pos = pmPosFromTextOffset(editor.state.doc, offset);
        try {
          return editor.view.coordsAtPos(pos);
        } catch {
          return null;
        }
      },
      scrollCaretIntoView: (offsetPercent) => {
        cancelInitialAdjustmentRef.current?.();
        const editor = tiptapRef.current;
        const scroller = scrollerRef.current;
        if (!typewriterScrollRef.current || !editor || !scroller || isEditorComposing(editor, composingRef)) return;

        typewriterOffsetRef.current = Number.isFinite(offsetPercent) ? offsetPercent : 50;
        startCenterAnimationRef.current?.();
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
      if (scroller && typewriterScrollRef.current) {
        stopCenterAnimationRef.current?.();
        centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, writingModeRef.current);
      }
      requestLineBreakMarksRef.current?.();
    });
  }, [editorRevision, text]);

  useEffect(() => {
    const host = editorHostRef.current;
    const scroller = scrollerRef.current;
    if (!host || !scroller) return undefined;

    let centerQueued = false;
    let centerInstant = false;
    let centerWaitFrames = 1;
    let visibleQueued = false;
    let lastVisibleCenter = -1;
    let centerFrame: number | null = null;
    let visibleFrame: number | null = null;
    let scrollFrame: number | null = null;
    let lineBreakFrame: number | null = null;
    let visualLineFrame: number | null = null;
    let compositionFrame: number | null = null;
    let compositionSettleFrame: number | null = null;
    let compositionRevealFrame: number | null = null;
    let pagedReflowFrame: number | null = null;
    let pagedReflowGeneration = 0;
    let centerAnimFrame: number | null = null;
    let initialAdjustmentFrame: number | null = null;
    let initialAdjustmentExpiryTimer: number | null = null;
    let initialAdjustmentAllowed = true;
    let lineBreakQueued = false;
    let visualLineQueued = false;
    let lastPagedWheelAt = 0;
    let lastHorizontalPagedWheelAt = 0;
    const candidateViewport = initialViewportRef.current;
    const initialViewportToRestore =
      candidateViewport &&
      candidateViewport.textLength === textRef.current.length &&
      candidateViewport.writingMode === writingModeRef.current &&
      Number.isFinite(candidateViewport.anchorOffset) &&
      candidateViewport.anchorOffset >= 0 &&
      candidateViewport.anchorOffset <= candidateViewport.textLength &&
      Number.isFinite(candidateViewport.anchorRatio) &&
      candidateViewport.anchorRatio >= 0 &&
      candidateViewport.anchorRatio <= 1
        ? candidateViewport
        : null;
    let initialAdjustmentDeadline = Number.POSITIVE_INFINITY;

    const stopCenterAnimation = () => {
      if (centerAnimFrame !== null) cancelAnimationFrame(centerAnimFrame);
      centerAnimFrame = null;
    };

    const startCenterAnimation = () => {
      stopCenterAnimation();
      let lastTime = performance.now();
      let settledFrames = 0;
      const deadline = lastTime + 600;

      const step = (now: number) => {
        centerAnimFrame = null;
        const editor = tiptapRef.current;
        const currentScroller = scrollerRef.current;
        if (!typewriterScrollRef.current || !editor || !currentScroller) return;
        if (isEditorComposing(editor, composingRef)) return;

        const delta = measureCenterDelta(
          editor,
          currentScroller,
          typewriterOffsetRef.current,
          writingModeRef.current,
        );
        if (delta === null) return;

        const axis = scrollAxis(writingModeRef.current);
        const current = axis.get(currentScroller);
        const dpr = window.devicePixelRatio || 1;
        const minStep = 1 / dpr;
        const exactTarget = snapScrollValue(current + delta);

        if (Math.abs(exactTarget - current) < minStep / 2) {
          settledFrames += 1;
          if (settledFrames >= 2 || now > deadline) return;
          centerAnimFrame = requestAnimationFrame(step);
          return;
        }
        settledFrames = 0;

        const dt = Math.min(64, now - lastTime);
        lastTime = now;

        if (Math.abs(delta) <= 2 * minStep || now > deadline) {
          axis.set(currentScroller, exactTarget);
        } else {
          const k = 1 - Math.exp(-dt / 90);
          const move = Math.sign(delta) * Math.max(Math.abs(delta) * k, minStep);
          axis.set(currentScroller, snapScrollValue(current + move));
        }

        centerAnimFrame = requestAnimationFrame(step);
      };

      centerAnimFrame = requestAnimationFrame(step);
    };

    startCenterAnimationRef.current = startCenterAnimation;
    stopCenterAnimationRef.current = stopCenterAnimation;

    const syncVisibleWindow = (editor: Editor, currentScroller: HTMLElement): boolean => {
      const index = estimateVisibleCenterIndex(editor, currentScroller, writingModeRef.current);
      if (index < 0 || Math.abs(index - lastVisibleCenter) < VISIBLE_UPDATE_STEP) return false;

      lastVisibleCenter = index;
      editor.view.dispatch(
        editor.state.tr
          .setMeta(astKey, { visibleCenter: index } satisfies AstMeta)
          .setMeta("addToHistory", false),
      );
      requestLineBreakMarks();
      return true;
    };

    const primeVisibleWindowAtOffset = (editor: Editor, offset: number): boolean => {
      const pos = pmPosFromTextOffset(editor.state.doc, offset);
      const index = Math.max(
        0,
        Math.min(editor.state.doc.childCount - 1, editor.state.doc.resolve(pos).index(0)),
      );
      lastVisibleCenter = index;
      const state = astKey.getState(editor.state);
      if (state?.visibleCenter === index) return false;

      editor.view.dispatch(
        editor.state.tr
          .setMeta(astKey, { visibleCenter: index } satisfies AstMeta)
          .setMeta("addToHistory", false),
      );
      requestLineBreakMarks();
      return true;
    };

    const cancelInitialAdjustment = () => {
      initialAdjustmentAllowed = false;
      if (initialAdjustmentFrame !== null) cancelAnimationFrame(initialAdjustmentFrame);
      initialAdjustmentFrame = null;
      if (initialAdjustmentExpiryTimer !== null) window.clearTimeout(initialAdjustmentExpiryTimer);
      initialAdjustmentExpiryTimer = null;
      if (centerFrame !== null) cancelAnimationFrame(centerFrame);
      centerFrame = null;
      centerQueued = false;
      centerInstant = false;
      centerWaitFrames = 1;
    };
    cancelInitialAdjustmentRef.current = cancelInitialAdjustment;

    // 初回選択を復元した直後は、可視範囲の装飾更新によって本文のスクロール幅が
    // 数フレーム変化することがある。幅と装飾範囲が安定し、キャレットが基準線へ
    // 収束するまで初回に限って追従する。固定待ち時間にはせず、ユーザー操作が
    // 始まった時点で中止するため、手動スクロールを後から巻き戻さない。
    const startInitialCaretSettle = () => {
      if (
        !initialAdjustmentAllowed ||
        initialViewportToRestore ||
        !typewriterScrollRef.current ||
        performance.now() >= initialAdjustmentDeadline
      ) {
        return;
      }
      if (initialAdjustmentFrame !== null) cancelAnimationFrame(initialAdjustmentFrame);

      let previousExtent: string | null = null;
      let stableFrames = 0;

      const step = () => {
        initialAdjustmentFrame = null;
        const currentEditor = tiptapRef.current;
        const currentScroller = scrollerRef.current;
        if (
          !initialAdjustmentAllowed ||
          !typewriterScrollRef.current ||
          !currentEditor ||
          !currentScroller ||
          isEditorComposing(currentEditor, composingRef)
        ) {
          return;
        }

        const visibleWindowChanged = syncVisibleWindow(currentEditor, currentScroller);
        const axis = scrollAxis(writingModeRef.current);
        const beforeScroll = axis.get(currentScroller);
        centerCaretForEditor(
          currentEditor,
          currentScroller,
          typewriterOffsetRef.current,
          writingModeRef.current,
        );
        const afterScroll = axis.get(currentScroller);
        const remainingDelta = measureCenterDelta(
          currentEditor,
          currentScroller,
          typewriterOffsetRef.current,
          writingModeRef.current,
        );
        const extent = `${currentScroller.scrollWidth}:${currentScroller.scrollHeight}`;
        const extentStable = extent === previousExtent;
        const aligned = remainingDelta !== null && Math.abs(remainingDelta) < SCROLL_EPS;
        const cannotMoveFurther =
          remainingDelta !== null &&
          Math.abs(afterScroll - beforeScroll) < SCROLL_EPS;

        if (
          !visibleWindowChanged &&
          extentStable &&
          (aligned || cannotMoveFurther)
        ) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        previousExtent = extent;

        if (
          stableFrames >= INITIAL_CENTER_STABLE_FRAMES ||
          performance.now() >= initialAdjustmentDeadline
        ) {
          return;
        }
        initialAdjustmentFrame = requestAnimationFrame(step);
      };

      initialAdjustmentFrame = requestAnimationFrame(step);
    };

    // タブ再訪時はキャレットではなく、離れる直前に画面内で見えていた本文位置を
    // 復元する。生のスクロール量を使わないため、装飾範囲の再構築で本文サイズが
    // 変わっても同じ本文位置へ戻せる。
    const startInitialViewportRestore = () => {
      if (
        !initialAdjustmentAllowed ||
        !initialViewportToRestore ||
        performance.now() >= initialAdjustmentDeadline
      ) {
        return;
      }
      if (initialAdjustmentFrame !== null) cancelAnimationFrame(initialAdjustmentFrame);

      const currentEditor = tiptapRef.current;
      if (currentEditor) {
        primeVisibleWindowAtOffset(currentEditor, initialViewportToRestore.anchorOffset);
      }

      let previousExtent: string | null = null;
      let stableFrames = 0;

      const step = () => {
        initialAdjustmentFrame = null;
        const editor = tiptapRef.current;
        const currentScroller = scrollerRef.current;
        if (
          !initialAdjustmentAllowed ||
          !editor ||
          !currentScroller ||
          isEditorComposing(editor, composingRef)
        ) {
          return;
        }

        const axis = scrollAxis(initialViewportToRestore.writingMode);
        const beforeScroll = axis.get(currentScroller);
        restoreViewportAnchorForEditor(editor, currentScroller, initialViewportToRestore);
        const visibleWindowChanged = syncVisibleWindow(editor, currentScroller);
        if (visibleWindowChanged) {
          restoreViewportAnchorForEditor(editor, currentScroller, initialViewportToRestore);
        }
        const afterScroll = axis.get(currentScroller);
        const remainingDelta = measureViewportAnchorDelta(
          editor,
          currentScroller,
          initialViewportToRestore,
        );
        const extent = `${currentScroller.scrollWidth}:${currentScroller.scrollHeight}`;
        const extentStable = extent === previousExtent;
        const aligned = remainingDelta !== null && Math.abs(remainingDelta) < SCROLL_EPS;
        const cannotMoveFurther =
          remainingDelta !== null && Math.abs(afterScroll - beforeScroll) < SCROLL_EPS;

        if (!visibleWindowChanged && extentStable && (aligned || cannotMoveFurther)) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        previousExtent = extent;

        if (
          stableFrames >= INITIAL_CENTER_STABLE_FRAMES ||
          performance.now() >= initialAdjustmentDeadline
        ) {
          return;
        }
        initialAdjustmentFrame = requestAnimationFrame(step);
      };

      initialAdjustmentFrame = requestAnimationFrame(step);
    };

    const requestCenterCaret = (instant: boolean, eventType: string) => {
      const editor = tiptapRef.current;
      if (initialAdjustmentAllowed && initialViewportToRestore) return;
      if (!typewriterScrollRef.current || !editor || isEditorComposing(editor, composingRef)) return;

      centerInstant = centerInstant || instant;
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

          if (!typewriterScrollRef.current) {
            centerInstant = false;
            centerQueued = false;
            centerWaitFrames = 1;
            return;
          }

          const shouldInstant = centerInstant;
          centerInstant = false;
          const currentEditor = tiptapRef.current;
          const currentScroller = scrollerRef.current;
          if (currentEditor && currentScroller) {
            syncVisibleWindow(currentEditor, currentScroller);
            centerQueued = false;
            centerWaitFrames = 1;
            if (shouldInstant) {
              stopCenterAnimation();
              centerCaretForEditor(
                currentEditor,
                currentScroller,
                typewriterOffsetRef.current,
                writingModeRef.current,
              );
            } else {
              startCenterAnimation();
            }
          } else {
            centerQueued = false;
            centerWaitFrames = 1;
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
        visibleFrame = null;
        visibleQueued = false;
        syncVisibleWindow(editor, currentScroller);
      });
    };

    const renderVisualLines = () => {
      visualLineQueued = false;
      visualLineFrame = null;
      const layer = visualLineLayerRef.current;
      const currentEditor = tiptapRef.current;
      if (!layer) return;

      const layerUpdate = resolveVisualLineLayerUpdate(
        showLineNumbersRef.current,
        highlightCurrentLineRef.current,
        Boolean(currentEditor),
        Boolean(currentEditor && isEditorComposing(currentEditor, composingRef)),
      );
      // IME変換中は一時DOMを再計測せず、確定済みの行番号とハイライトを残す。
      if (layerUpdate === "preserve") return;

      layer.textContent = "";
      if (layerUpdate === "clear" || !currentEditor) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const layerParentRect = layer.parentElement?.getBoundingClientRect();
      layer.style.left = `${snapScrollValue(
        scrollerRect.left - (layerParentRect?.left ?? 0),
      )}px`;
      layer.style.top = `${snapScrollValue(
        scrollerRect.top - (layerParentRect?.top ?? 0),
      )}px`;
      layer.style.width = `${snapScrollValue(scrollerRect.width)}px`;
      layer.style.height = `${snapScrollValue(scrollerRect.height)}px`;

      const blockElements = Array.from(currentEditor.view.dom.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      const blockRects: VisualBlockRect[] = blockElements.map((element) => {
        const rect = element.getBoundingClientRect();
        const contentRange = document.createRange();
        contentRange.selectNodeContents(element);
        const fragments = Array.from(contentRange.getClientRects(), (fragment) => ({
          left: fragment.left,
          right: fragment.right,
          top: fragment.top,
          bottom: fragment.bottom,
        }));
        contentRange.detach();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          fragments,
        };
      });
      const mode = writingModeRef.current;
      const pagedLayout = editorDisplayModeRef.current === "paged";
      const rootRect = currentEditor.view.dom.getBoundingClientRect();
      const bands = createVisualLineBands(
        blockRects,
        mode,
        pagedLayout
          ? {
              fragmented: true,
              fragmentOrigin: isHorizontalWriting(mode)
                ? rootRect.left
                : (blockRects[0]?.top ?? rootRect.top),
              fragmentStep: pageLayoutRef.current.columnStep,
              fragmentDirection: 1,
            }
          : undefined,
      );
      const activeBlockIndex = activeLineIndex(currentEditor.state);
      let caretX = 0;
      let caretY = 0;
      let affinityPoint: { x: number; y: number } | null = null;
      try {
        const { selection } = currentEditor.state;
        const caretRect = currentEditor.view.coordsAtPos(selection.head);
        caretX = (caretRect.left + caretRect.right) / 2;
        caretY = (caretRect.top + caretRect.bottom) / 2;

        // 文末などではゼロ幅キャレットが隣接する2行の共有境界に置かれる。
        // 選択位置に隣接する実文字の両端を測り、その文字の内側を所属判定に使う。
        const { $head } = selection;
        if ($head.parent.isTextblock && $head.parent.content.size > 0) {
          const parentStart = $head.start();
          const parentEnd = $head.end();
          const parentOffset = $head.parentOffset;
          const parentText = $head.parent.textContent;
          const atTextblockEnd = selection.head >= parentEnd;
          const charactersBeforeCaret = Array.from(parentText.slice(0, parentOffset));
          const adjacentCharacter = atTextblockEnd
            ? charactersBeforeCaret[charactersBeforeCaret.length - 1]
            : Array.from(parentText.slice(parentOffset))[0];
          const characterLength = adjacentCharacter?.length ?? 1;
          const characterFrom = atTextblockEnd
            ? Math.max(parentStart, selection.head - characterLength)
            : selection.head;
          const characterTo = atTextblockEnd
            ? selection.head
            : Math.min(parentEnd, selection.head + characterLength);

          if (characterTo > characterFrom) {
            const fromRect = currentEditor.view.coordsAtPos(characterFrom, 1);
            const toRect = currentEditor.view.coordsAtPos(characterTo, -1);
            affinityPoint = {
              x:
                (fromRect.left + fromRect.right + toRect.left + toRect.right) /
                4,
              y:
                (fromRect.top + fromRect.bottom + toRect.top + toRect.bottom) /
                4,
            };
          }
        }
      } catch {
        const activeRect = blockRects[activeBlockIndex];
        caretX = activeRect ? (activeRect.left + activeRect.right) / 2 : 0;
        caretY = activeRect ? (activeRect.top + activeRect.bottom) / 2 : 0;
      }
      const activeBand = findClosestVisualLineBand(
        bands,
        activeBlockIndex,
        caretX,
        caretY,
        affinityPoint,
      );
      const fragment = document.createDocumentFragment();

      if (highlightCurrentLineRef.current && activeBand) {
        const highlight = document.createElement("div");
        highlight.className = "activeVisualLineHighlight";
        highlight.dataset.visualLineNumber = String(activeBand.number);
        highlight.style.left = `${snapScrollValue(activeBand.left - scrollerRect.left)}px`;
        highlight.style.top = `${snapScrollValue(activeBand.top - scrollerRect.top)}px`;
        highlight.style.width = `${snapScrollValue(activeBand.right - activeBand.left)}px`;
        highlight.style.height = `${snapScrollValue(activeBand.bottom - activeBand.top)}px`;
        fragment.appendChild(highlight);
      }

      if (showLineNumbersRef.current) {
        for (const band of bands) {
          if (
            band.right < scrollerRect.left ||
            band.left > scrollerRect.right ||
            band.bottom < scrollerRect.top ||
            band.top > scrollerRect.bottom
          ) {
            continue;
          }

          const blockRect = blockRects[band.blockIndex];
          if (!blockRect) continue;
          const number = document.createElement("span");
          number.className = `visibleLineNumber${
            activeBand?.number === band.number ? " active" : ""
          }`;
          number.dataset.visualLineNumber = String(band.number);
          number.textContent = String(band.number);
          if (isHorizontalWriting(mode)) {
            number.style.left = `${snapScrollValue(
              (pagedLayout ? band.left : blockRect.left) - scrollerRect.left - 10,
            )}px`;
            number.style.top = `${snapScrollValue(band.centerY - scrollerRect.top)}px`;
          } else {
            number.style.left = `${snapScrollValue(band.centerX - scrollerRect.left)}px`;
            number.style.top = `${snapScrollValue(
              (pagedLayout ? band.top : blockRect.top) -
                scrollerRect.top -
                VERTICAL_LINE_NUMBER_TOP_OFFSET_PX,
            )}px`;
          }
          fragment.appendChild(number);
        }
      }

      layer.appendChild(fragment);
    };

    const requestVisualLines = () => {
      if (visualLineQueued) return;
      visualLineQueued = true;
      visualLineFrame = requestAnimationFrame(renderVisualLines);
    };

    const renderLineBreakMarks = () => {
      lineBreakQueued = false;
      lineBreakFrame = null;
      const layer = lineBreakLayerRef.current;
      const currentEditor = tiptapRef.current;
      if (!layer) return;

      layer.textContent = "";

      const scrollerRect = scroller.getBoundingClientRect();
      const layerParentRect = layer.parentElement?.getBoundingClientRect();
      layer.style.left = `${snapScrollValue(
        scrollerRect.left - (layerParentRect?.left ?? 0),
      )}px`;
      layer.style.top = `${snapScrollValue(
        scrollerRect.top - (layerParentRect?.top ?? 0),
      )}px`;
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

      const mode = writingModeRef.current;
      const estimatedCenter = estimateVisibleCenterIndex(currentEditor, scroller, mode);
      const visibleCenter = estimatedCenter >= 0 ? estimatedCenter : state.visibleCenter;
      const activeIndex = activeLineIndex(currentEditor.state);
      const fragment = document.createDocumentFragment();

      for (const range of decorationRange(state.activeIndex, state.lines.length, visibleCenter)) {
        const to = Math.min(range.to, state.lines.length, currentEditor.state.doc.childCount);

        for (let index = range.from; index < to; index += 1) {
          const line = state.lines[index];
          if (!line) continue;

          const rect = paragraphEndRect(currentEditor, index, mode);
          if (!rect) continue;

          // ページ表示では他ページ断片の記号が表示域外に大量生成されるため、
          // スクロール領域（マーク描画余白24px込み）内のものだけを描画する。
          if (
            editorDisplayModeRef.current === "paged" &&
            (rect.right < scrollerRect.left - 24 ||
              rect.left > scrollerRect.right + 24 ||
              rect.bottom < scrollerRect.top - 24 ||
              rect.top > scrollerRect.bottom + 24)
          ) {
            continue;
          }

          const mark = document.createElement("span");
          const blank = line.source.length === 0;
          mark.className = `visibleLineBreakMark${blank ? " blank" : ""}${
            index === activeIndex ? " active" : ""
          }`;
          mark.textContent = "↵";
          if (isHorizontalWriting(mode)) {
            mark.style.left = `${snapScrollValue(
              (blank ? (rect.left + rect.right) / 2 : rect.right + 8) - scrollerRect.left,
            )}px`;
            mark.style.top = `${snapScrollValue((rect.top + rect.bottom) / 2 - scrollerRect.top)}px`;
          } else {
            mark.style.left = `${snapScrollValue((rect.left + rect.right) / 2 - scrollerRect.left)}px`;
            mark.style.top = `${snapScrollValue(
              (blank ? (rect.top + rect.bottom) / 2 : rect.bottom + 8) - scrollerRect.top,
            )}px`;
          }
          fragment.appendChild(mark);
        }
      }

      layer.appendChild(fragment);
    };

    const requestLineBreakMarks = () => {
      requestVisualLines();
      if (!showLineBreakMarksRef.current || lineBreakQueued) return;

      lineBreakQueued = true;
      lineBreakFrame = requestAnimationFrame(renderLineBreakMarks);
    };

    renderLineBreakMarksRef.current = renderLineBreakMarks;
    requestLineBreakMarksRef.current = requestLineBreakMarks;
    renderVisualLinesRef.current = renderVisualLines;
    requestVisualLinesRef.current = requestVisualLines;

    // 改行・削除・IME確定では、ProseMirrorの更新通知より後にCSS multicolの
    // 再分割とReactのページ面サイズ更新が続く。古い総ページ数で一度だけ
    // キャレットを表示すると末尾で前ページへ丸められるため、寸法が連続して
    // 安定するまで「ページ数→所属ページ→行表示」の順に同期し直す。
    const requestPagedSelectionAfterReflow = (currentEditor: Editor) => {
      if (editorDisplayModeRef.current !== "paged") return;
      pagedReflowGeneration += 1;
      const generation = pagedReflowGeneration;
      if (pagedReflowFrame !== null) cancelAnimationFrame(pagedReflowFrame);

      let previousSignature: string | null = null;
      let stableFrames = 0;
      let remainingFrames = 8;
      const step = () => {
        pagedReflowFrame = null;
        if (
          generation !== pagedReflowGeneration ||
          editorDisplayModeRef.current !== "paged" ||
          tiptapRef.current !== currentEditor
        ) {
          return;
        }

        syncPageMetricsRef.current?.();
        revealSelectionPageNow(currentEditor);
        syncPageMetricsRef.current?.();
        requestVisibleWindow();
        requestLineBreakMarks();

        const currentScroller = scrollerRef.current;
        const metrics = pageMetricsRef.current;
        const signature = currentScroller
          ? `${currentEditor.state.selection.head}:${metrics.current}:${metrics.total}:` +
            `${currentScroller.scrollLeft}:${currentScroller.scrollTop}:` +
            `${currentScroller.scrollWidth}:${currentScroller.scrollHeight}`
          : "missing";
        stableFrames = signature === previousSignature ? stableFrames + 1 : 0;
        previousSignature = signature;
        remainingFrames -= 1;
        if (stableFrames >= 2 || remainingFrames <= 0) return;
        pagedReflowFrame = requestAnimationFrame(step);
      };

      pagedReflowFrame = requestAnimationFrame(step);
    };

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
        cancelInitialAdjustment();
        const next = astKey.getState(currentEditor.state)?.text ?? docToText(currentEditor.state.doc);
        updateEmptyAttribute(currentEditor, next);
        textRef.current = next;
        const nextRevision = ++localRevisionRef.current;
        onTextChangeRef.current(next, nextRevision);
        onSelectionChangeRef.current();
        if (!isEditorComposing(currentEditor, composingRef)) {
          requestCenterCaret(true, "update");
          requestPagedSelectionAfterReflow(currentEditor);
        }
        requestVisibleWindow();
        if (editorDisplayModeRef.current !== "paged") requestLineBreakMarks();
      },
      onSelectionUpdate: () => {
        onSelectionChangeRef.current();
        // ドラッグ範囲選択中は寄せない（pointerup でまとめて判定する）。
        // キーボードでの選択（Shift+矢印など）はドラッグ外なので従来どおり追従する。
        if (!pointerDraggingRef.current) {
          requestCenterCaret(false, "selection");
          revealSelectionPageRef.current?.(editor);
        }
        requestVisibleWindow();
        requestLineBreakMarks();
      },
    });

    tiptapRef.current = editor;
    if (showLineNumbersRef.current) {
      editor.view.dispatch(
        editor.state.tr
          .setMeta(astKey, {
            rebuild: true,
            fullDecorations: true,
          } satisfies AstMeta)
          .setMeta("addToHistory", false),
      );
    }
    updateEmptyAttribute(editor);

    const visualLayoutObserver = new ResizeObserver(() => requestVisualLines());
    visualLayoutObserver.observe(editor.view.dom);
    visualLayoutObserver.observe(scroller);
    const pageLayoutObserver = new ResizeObserver(() => syncPageMetricsRef.current?.());
    pageLayoutObserver.observe(editor.view.dom);
    pageLayoutObserver.observe(scroller);

    const handleWheel = (event: WheelEvent) => {
      cancelInitialAdjustment();
      stopCenterAnimation();
      event.preventDefault();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      // ページ送りはdeltaYのみを使う。RTLスクロールでのdeltaXはネイティブの
      // スクロール方向と符号解釈が逆になり得るうえ、チルトホイールの誤操作で
      // ページが飛ぶのを避ける。
      if (
        editorDisplayModeRef.current === "paged" &&
        pageFlowDirectionRef.current === "vertical"
      ) {
        const now = performance.now();
        if (Math.abs(event.deltaY) >= 3 && now - lastPagedWheelAt >= 280) {
          lastPagedWheelAt = now;
          movePage(event.deltaY > 0 ? 1 : -1);
        }
        return;
      }
      if (
        editorDisplayModeRef.current === "paged" &&
        pageFlowDirectionRef.current === "horizontal-rtl"
      ) {
        const now = performance.now();
        if (Math.abs(event.deltaY) >= 3 && now - lastHorizontalPagedWheelAt >= 280) {
          lastHorizontalPagedWheelAt = now;
          movePage(event.deltaY > 0 ? 1 : -1);
        }
        return;
      }
      if (isHorizontalWriting(writingModeRef.current)) {
        scroller.scrollTop += delta;
      } else {
        scroller.scrollLeft -= delta;
      }
      // scroll位置の代入で発火するscrollイベントへ描画更新を一本化する。
      // ホイールイベント側でも同期すると、同じ入力でDOM計測が二重に走る。
    };

    const handleMouseDown = (event: MouseEvent) => {
      cancelInitialAdjustment();
      if (event.target !== scroller) return;

      const scrollerRect = scroller.getBoundingClientRect();
      if (
        editorDisplayModeRef.current === "paged" &&
        pageFlowDirectionRef.current === "horizontal-rtl"
      ) {
        const scrollbarHeight = scroller.offsetHeight - scroller.clientHeight;
        if (scrollbarHeight > 0 && event.clientY >= scrollerRect.bottom - scrollbarHeight) return;
      } else if (isHorizontalWriting(writingModeRef.current)) {
        const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
        if (scrollbarWidth > 0 && event.clientX >= scrollerRect.right - scrollbarWidth) return;
      } else {
        const scrollbarHeight = scroller.offsetHeight - scroller.clientHeight;
        if (scrollbarHeight > 0 && event.clientY >= scrollerRect.bottom - scrollbarHeight) return;
      }

      event.preventDefault();
      editor.commands.focus();
      const lastIndex = Math.max(0, editor.state.doc.childCount - 1);
      const lastNode = editor.state.doc.child(lastIndex);
      editor.commands.setTextSelection((pmStartAtIndex(editor.state.doc, lastIndex) ?? 0) + 1 + lastNode.content.size);
      requestCenterCaret(true, "scroller-mousedown");
      requestLineBreakMarks();
    };

    const handleCompositionStart = () => {
      cancelInitialAdjustment();
      stopCenterAnimation();
      composingRef.current = true;
      // 変換中はスクロールスナップを止める。ブラウザがキャレットを見せるために
      // 動かしたスクロールを、スナップがページ境界へ引き戻してしまうため。
      shellRef.current?.setAttribute("data-composing", "true");
      renderLineBreakMarks();
    };

    const handleCompositionUpdate = () => {
      requestVisibleWindow();
      // 変換中テキストが折り返して次のページへ流れたら、そのページへ丸ごと移る。
      // ページの途中で止まらないよう、移動は必ずページ境界単位で行う。
      if (editorDisplayModeRef.current !== "paged") return;
      if (compositionRevealFrame !== null) return;
      let remainingFrames = 6;
      const step = () => {
        compositionRevealFrame = null;
        if (editorDisplayModeRef.current !== "paged") return;
        if (tiptapRef.current !== editor) return;
        const host = editorHostRef.current;
        if (!host) return;
        // 変換中に段が増えていることがあるため、先に総ページ数と断片位置を
        // 揃えてから座標を読む。
        syncPageMetricsRef.current?.();
        // composition中はProseMirrorのselectionがDOMの実キャレットより遅れる
        // ため、変換中テキストの実座標をDOM選択から直接読む。
        const domSelection = window.getSelection();
        if (!domSelection || domSelection.rangeCount === 0) return;
        const domRange = domSelection.getRangeAt(0);
        if (!editor.view.dom.contains(domRange.endContainer)) return;
        const caret = domRange.getBoundingClientRect();
        if (caret.width === 0 && caret.height === 0) return;
        const hostRect = host.getBoundingClientRect();
        const layout = pageLayoutRef.current;
        const vertical = writingModeRef.current === "vertical-rl";
        const areaStart = vertical ? hostRect.top + layout.paddingY : hostRect.left + layout.paddingX;
        const areaEnd = vertical ? hostRect.bottom - layout.paddingY : hostRect.right - layout.paddingX;
        const caretStart = vertical ? caret.top : caret.left;
        const caretEnd = vertical ? caret.bottom : caret.right;
        // 表示中のページに収まっているなら動かさない。
        if (caretStart >= areaStart && caretEnd <= areaEnd) return;
        const target = pageContainingPoint(vertical ? caret.top : caret.left);
        if (target === null || target === pageMetricsRef.current.current) return;
        scrollToPage(target, "auto");
        remainingFrames -= 1;
        if (remainingFrames <= 0) return;
        compositionRevealFrame = requestAnimationFrame(step);
      };
      compositionRevealFrame = requestAnimationFrame(step);
    };

    const handleCompositionEnd = () => {
      composingRef.current = false;
      shellRef.current?.removeAttribute("data-composing");
      // 確定すれば本文は段へ収まる。連続写像をやめてキャレットのページへ吸着
      // し直す。ただしIMEは変換の区切りごとに compositionend → compositionstart
      // を続けて投げてくるので、1フレーム待って本当に変換が終わったかを見る。
      // 途中の区切りで吸着すると、入力中にページ境界へ引き戻されてしまう。
      if (editorDisplayModeRef.current === "paged") {
        if (compositionSettleFrame !== null) cancelAnimationFrame(compositionSettleFrame);
        compositionSettleFrame = requestAnimationFrame(() => {
          compositionSettleFrame = null;
          if (tiptapRef.current !== editor) return;
          if (composingRef.current) return;
          syncPageMetricsRef.current?.();
          scrollToPage(pageMetricsRef.current.current, "auto");
        });
      }
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
      requestPagedSelectionAfterReflow(editor);
      requestVisibleWindow();
      if (editorDisplayModeRef.current !== "paged") requestLineBreakMarks();
    };

    const handleResize = () => {
      if (initialAdjustmentAllowed && initialViewportToRestore) {
        startInitialViewportRestore();
      } else {
        requestCenterCaret(true, "resize");
      }
      requestVisibleWindow();
      requestLineBreakMarks();
      syncPageMetricsRef.current?.();
    };

    const handleFontLoadingDone = () => {
      requestVisibleWindow();
      requestLineBreakMarks();
      // Webフォント適用で文字寸法が変わると断片構成も変わる。ページ表示では
      // 総ページ数を再同期し、表示位置をアンカーのページへ復元する。
      if (editorDisplayModeRef.current === "paged") {
        requestPagedAnchorRestoreRef.current?.();
      }
    };

    const handleScroll = () => {
      // 高解像度ホイールやsmooth scrollは1フレーム中に複数のscrollイベントを
      // 発生させる。可視範囲・行表示は各request関数自身が集約し、Range計測を
      // 含むページ同期もページ表示中だけ表示フレームごとに一度行う。
      requestVisibleWindow();
      requestLineBreakMarks();
      if (editorDisplayModeRef.current !== "paged" || scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        if (editorDisplayModeRef.current !== "paged") return;
        syncPageMetricsRef.current?.();
        requestPagedScrollSettle();
      });
    };

    // 本文上の左ボタンドラッグ開始を、PM が選択を確定する前に捕捉するため
    // キャプチャフェーズで拾う（pointerdown は mousedown より前に発火する）。
    const handlePointerDown = (event: PointerEvent) => {
      cancelInitialAdjustment();
      if (event.button !== 0) return;
      pointerDraggingRef.current = true;
    };

    const handlePointerUp = () => {
      if (!pointerDraggingRef.current) return;
      pointerDraggingRef.current = false;
      const currentEditor = tiptapRef.current;
      // クリック（collapsed）で終わったら一度だけ寄せる。範囲が残るならビューは動かさない。
      if (currentEditor && currentEditor.state.selection.empty) {
        requestCenterCaret(false, "pointer-click");
      }
      requestLineBreakMarks();
    };

    const handlePointerCancel = () => {
      pointerDraggingRef.current = false;
    };

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    scroller.addEventListener("mousedown", handleMouseDown);
    editor.view.dom.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("pointerdown", cancelInitialAdjustment, { capture: true });
    window.addEventListener("keydown", cancelInitialAdjustment, { capture: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    editor.view.dom.addEventListener("compositionstart", handleCompositionStart);
    editor.view.dom.addEventListener("compositionupdate", handleCompositionUpdate);
    editor.view.dom.addEventListener("compositionend", handleCompositionEnd);
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    document.fonts?.addEventListener("loadingdone", handleFontLoadingDone);

    const initialOffset = Math.min(initialSelectionRef.current, docToText(editor.state.doc).length);
    if (initialOffset > 0) {
      setSelectionByTextOffset(editor, initialOffset);
      editor.commands.focus();
    } else {
      editor.commands.focus("start");
    }
    initialAdjustmentDeadline = performance.now() + INITIAL_CENTER_SETTLE_MS;
    initialAdjustmentExpiryTimer = window.setTimeout(
      cancelInitialAdjustment,
      INITIAL_CENTER_SETTLE_MS,
    );
    if (initialViewportToRestore) {
      startInitialViewportRestore();
    } else {
      requestCenterCaret(true, "initial");
      startInitialCaretSettle();
    }
    requestVisibleWindow();
    requestLineBreakMarks();
    syncPageMetricsRef.current?.();
    document.fonts?.ready.then(() => {
      if (tiptapRef.current !== editor) return;
      if (initialAdjustmentAllowed && performance.now() < initialAdjustmentDeadline) {
        if (initialViewportToRestore) {
          startInitialViewportRestore();
        } else {
          requestCenterCaret(true, "font-ready");
          startInitialCaretSettle();
        }
      }
      requestVisibleWindow();
      requestLineBreakMarks();
    });

    onReady(handle);

    return () => {
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("mousedown", handleMouseDown);
      editor.view.dom.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointerdown", cancelInitialAdjustment, { capture: true });
      window.removeEventListener("keydown", cancelInitialAdjustment, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      editor.view.dom.removeEventListener("compositionstart", handleCompositionStart);
      editor.view.dom.removeEventListener("compositionupdate", handleCompositionUpdate);
      editor.view.dom.removeEventListener("compositionend", handleCompositionEnd);
      scroller.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      document.fonts?.removeEventListener("loadingdone", handleFontLoadingDone);
      if (centerFrame !== null) cancelAnimationFrame(centerFrame);
      if (visibleFrame !== null) cancelAnimationFrame(visibleFrame);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      if (lineBreakFrame !== null) cancelAnimationFrame(lineBreakFrame);
      if (visualLineFrame !== null) cancelAnimationFrame(visualLineFrame);
      if (compositionFrame !== null) cancelAnimationFrame(compositionFrame);
      if (compositionSettleFrame !== null) cancelAnimationFrame(compositionSettleFrame);
      if (compositionRevealFrame !== null) cancelAnimationFrame(compositionRevealFrame);
      pagedReflowGeneration += 1;
      if (pagedReflowFrame !== null) cancelAnimationFrame(pagedReflowFrame);
      pagedScrollSettleGenerationRef.current += 1;
      if (pagedScrollSettleFrameRef.current !== null) {
        cancelAnimationFrame(pagedScrollSettleFrameRef.current);
        pagedScrollSettleFrameRef.current = null;
      }
      pagedAnchorRestoreGenerationRef.current += 1;
      if (pagedAnchorRestoreFrameRef.current !== null) {
        cancelAnimationFrame(pagedAnchorRestoreFrameRef.current);
        pagedAnchorRestoreFrameRef.current = null;
      }
      visualLayoutObserver.disconnect();
      pageLayoutObserver.disconnect();
      cancelInitialAdjustment();
      stopCenterAnimation();
      if (startCenterAnimationRef.current === startCenterAnimation) startCenterAnimationRef.current = null;
      if (stopCenterAnimationRef.current === stopCenterAnimation) stopCenterAnimationRef.current = null;
      renderLineBreakMarksRef.current = null;
      requestLineBreakMarksRef.current = null;
      renderVisualLinesRef.current = null;
      requestVisualLinesRef.current = null;
      if (cancelInitialAdjustmentRef.current === cancelInitialAdjustment) {
        cancelInitialAdjustmentRef.current = null;
      }
      if (lineBreakLayerRef.current) lineBreakLayerRef.current.textContent = "";
      if (visualLineLayerRef.current) visualLineLayerRef.current.textContent = "";
      editor.destroy();
      if (tiptapRef.current === editor) tiptapRef.current = null;
      onReady(null);
    };
  }, [handle, onReady]);

  return (
    <div
      ref={shellRef}
      className="verticalTypewriterShell"
      data-show-line-numbers={showLineNumbers ? "true" : undefined}
      data-highlight-current-line={highlightCurrentLine ? "true" : undefined}
      data-colorize-japanese-quotes={colorizeJapaneseQuotes ? "true" : undefined}
      data-editor-display={editorDisplayMode}
      data-page-flow={editorDisplayMode === "paged" ? pageFlowDirection : undefined}
    >
      <div ref={scrollerRef} className="verticalTypewriterScroller">
        <div
          ref={pageSurfaceRef}
          className="verticalTypewriterPageSurface"
          style={
            editorDisplayMode === "paged"
              ? {
                  // 面はページ列そのものの大きさ＋外余白。余白のぶんだけ
                  // ページ枠がスクロール領域の内側へ入り、四辺とも見える。
                  width:
                    pageFlowDirection === "horizontal-rtl"
                      ? `${pageMetrics.total * pageLayout.width + Math.max(0, pageMetrics.total - 1) * pageLayout.gap + pageLayout.outerMargin * 2}px`
                      : `${pageLayout.width + pageLayout.outerMargin * 2}px`,
                  height:
                    pageFlowDirection === "vertical"
                      ? `${pageMetrics.total * pageLayout.height + Math.max(0, pageMetrics.total - 1) * pageLayout.gap + pageLayout.outerMargin * 2}px`
                      : `${pageLayout.height + pageLayout.outerMargin * 2}px`,
                }
              : undefined
          }
        >
          {editorDisplayMode === "paged" &&
            Array.from({ length: pageMetrics.total }, (_, index) => (
              <div
                className="pagedEditorSheet"
                key={index}
                style={
                  pageFlowDirection === "horizontal-rtl"
                    ? {
                        right: `${pageLayout.outerMargin + index * (pageLayout.width + pageLayout.gap)}px`,
                        top: `${pageLayout.outerMargin}px`,
                      }
                    : {
                        left: `${pageLayout.outerMargin}px`,
                        top: `${pageLayout.outerMargin + index * (pageLayout.height + pageLayout.gap)}px`,
                      }
                }
                aria-hidden="true"
              >
                <span>{index + 1}</span>
              </div>
            ))}
          <div ref={editorHostRef} className="verticalTypewriterEditor" />
        </div>
      </div>
      <div
        ref={visualLineLayerRef}
        className="visibleLineNumberLayer"
        aria-hidden="true"
      />
      <div ref={lineBreakLayerRef} className="visibleLineBreakLayer" aria-hidden="true" />
      {editorDisplayMode === "continuous" && typewriterScroll && showTypewriterGuide && (
        <div className="verticalTypewriterGuide" />
      )}
      {editorDisplayMode === "paged" && (
        <>
          <button
            className="pagedEditorNav pagedEditorPrevious"
            type="button"
            aria-label="前のページ"
            title="前のページ"
            disabled={pageMetrics.current <= 1}
            onClick={() => movePage(-1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={pageFlowDirection === "vertical" ? "m7 14 5-5 5 5" : "m9 7 5 5-5 5"} />
            </svg>
          </button>
          <button
            className="pagedEditorNav pagedEditorNext"
            type="button"
            aria-label="次のページ"
            title="次のページ"
            disabled={pageMetrics.current >= pageMetrics.total}
            onClick={() => movePage(1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={pageFlowDirection === "vertical" ? "m7 10 5 5 5-5" : "m15 7-5 5 5 5"} />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
