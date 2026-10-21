import { Editor, Extension, type JSONContent } from "@tiptap/core";
import { findTextChange, mapTextOffsetThroughChange } from "./editor/textOffsetMapping";
import { createTypewriterScroller } from "./editor/typewriterScroller";
import { installNativeImeExperiment } from "./editor/nativeIme";
import { syncOverlayElements } from "./editor/overlayElements";
import { scrollOverlayTranslation, type ScrollOverlaySnapshot } from "./editor/scrollOverlay";
import { VisualLineIndex } from "./editor/visualLineIndex";
import { ParagraphFlow } from "./editor/paragraphFlow";
import {
  endsManuscriptPage,
  findHangingRuns,
  findLatinRuns,
  latinRunAdjustment,
  LatinRunMetrics,
  manuscriptProgress,
  type RunFontKey,
} from "./editor/manuscriptLayout";
import { DEFAULT_MANUSCRIPT_SETTINGS } from "./types";
import { indexRootDecorations } from "./editor/indexedDecorations";
import { spliceRootDecorations } from "./editor/spliceRootDecorations";
import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { baseKeymap } from "@tiptap/pm/commands";
import { closeHistory } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@tiptap/pm/view";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ImageHoverPreview } from "./components/editor/ImageHoverPreview";
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
import { blockHasRole, classifyLines, parseLineNode } from "./editor/ast/documentAst";
import type { InlineMarker, InlineMarkup, LayoutAlign, LineNode } from "./editor/ast/types";
import { type TextSplice, updateTextFromLineDiffWithChange } from "./editor/lineTextUpdate";
import { findJapaneseQuoteRanges } from "./editor/japaneseQuoteRanges";
import { markdownTableRows, type TableRow } from "./editor/markdownTables";
import { tableCaretTarget, tableCellCaret } from "./editor/tableNavigation";
import {
  findClosestVisualLineBand,
  resolveVisualLineLayerUpdate,
  type VisualLineBand,
  type VisualRect,
} from "./editor/visualLineLayout";
import { lineDiffFromSelectionTransaction } from "./editor/transactionLineDiff";
import {
  computePageBreaks,
  measureParagraphs,
  type PageBreaks,
} from "./editor/pageBreaks";
import type {
  EditorDisplayMode,
  ManuscriptProgress,
  ManuscriptSettings,
  PageFlowDirection,
  TextEditorViewportState,
  WritingMode,
} from "./types";

export type TextEditorHandle = {
  focus: () => void;
  /** 選択もスクロールも動かさずにフォーカスだけ戻す（ダイアログを閉じたときなど）。 */
  restoreFocus: () => void;
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
  /** 開いている原稿ファイルの絶対パス。画像記法の相対パスの基準。 */
  documentPath?: string | null;
  colorizeJapaneseQuotes: boolean;
  /** コメント行（// と <!-- -->）を表示するか。false で畳む。 */
  showComments: boolean;
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
  /**
   * `change`, when given, is exactly what turned the previous text into
   * `text` (so the caller need not compare the two).
   */
  onTextChange: (text: string, editorRevision: number, change?: TextSplice | null) => void;
  onSelectionChange: () => void;
  onPageMetricsChange?: (metrics: { current: number; total: number } | null) => void;
  /** 原稿用紙の字詰め・行数。layoutMode が "normal" なら通常の組版。 */
  manuscript?: ManuscriptSettings;
  /** 原稿用紙モードの進み具合。モードを外すと null。 */
  onManuscriptProgressChange?: (progress: ManuscriptProgress | null) => void;
};

type AstPluginState = {
  lines: LineNode[];
  documentIndex: DocumentIndex | null;
  text: string;
  /** The splice of the last text change and the text it was applied to. */
  change: (TextSplice & { base: string }) | null;
  decoSet: DecorationSet;
  /** Rows of Markdown tables by line index (empty for most manuscripts). */
  tableRows: Map<number, TableRow>;
  /**
   * What `decoSet` was last decorated for. IME composition only maps the
   * decorations, so the lines composed into stay `stale` and the window stays
   * where it was until the next update patches them.
   */
  decoWindow: DecorationWindow;
  activeIndex: number;
  visibleCenter: number;
  fullDecorations: boolean;
  /** コメント行を畳むか（キャレットのあるコメントのまとまりは除く）。 */
  commentsHidden: boolean;
  /** 原稿用紙モードの欧文ラン揃え。null なら付けない。 */
  latin: ManuscriptLatinContext | null;
};

type ManuscriptFontKey = RunFontKey;

/** 欧文ランの幅計測に使うフォント条件。フォント設定が変わると作り直す。 */
type ManuscriptLatinContext = {
  metrics: LatinRunMetrics;
  body: ManuscriptFontKey;
  heading: ManuscriptFontKey;
};

type DecorationWindow = {
  activeIndex: number;
  visibleCenter: number;
  stale: { from: number; to: number } | null;
  /** Composition changed tables or line roles, which only a rebuild restyles. */
  rebuild: boolean;
};

type AstMeta = {
  refreshComposition?: boolean;
  /** A composition is starting over this selection; see `clearImeReplaceRange`. */
  imeReplaceRange?: { from: number; to: number };
  visibleCenter?: number;
  rebuild?: boolean;
  fullDecorations?: boolean;
  commentsHidden?: boolean;
  /** 欧文ラン揃えの切替。キーがあれば値（null を含む）へ置き換える。 */
  latin?: ManuscriptLatinContext | null;
};

type EditorViewWithInput = EditorView & {
  input?: {
    composing?: boolean;
  };
};

const ACTIVE_BUILD_RADIUS = 72;
const VISIBLE_BUILD_RADIUS = 72;
/** Characters typed into existing lines before the visible window is re-measured without a scroll. */
const VISIBLE_SYNC_TEXT_DRIFT = 200;
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

/** Replace plain text offsets without recreating unaffected paragraph nodes.
 * Open paragraph edges join the inserted text to the existing prefix/suffix;
 * paragraph boundaries inside the slice represent actual newline characters.
 * The handle emits its own update exactly once, as setContent(false) did. */
function replaceTextRangeTransaction(
  tr: Transaction,
  from: number,
  to: number,
  insert: string,
  cursor: number,
  currentText?: string,
): Transaction {
  // Whole-text commands and external reloads can contain a tiny real edit.
  // Preserve their unchanged prefix/suffix nodes, selection and history mapping.
  if (from === 0 && to === docTextLength(tr.doc)) {
    const change = findTextChange(currentText ?? docToText(tr.doc), normalizeText(insert));
    from = change.from;
    to = change.to;
    insert = change.insert;
  }
  const replacement = tr.doc.type.schema.nodeFromJSON(textToDoc(insert));
  tr.replaceRange(
    pmPosFromTextOffset(tr.doc, from),
    pmPosFromTextOffset(tr.doc, to),
    new Slice(replacement.content, 1, 1),
  );
  tr.setSelection(TextSelection.create(tr.doc, pmPosFromTextOffset(tr.doc, cursor)));
  return tr.setMeta("preventUpdate", true);
}

function topTexts(doc: PMNode): string[] {
  const lines: string[] = [];
  doc.forEach((node) => lines.push(node.textContent));
  return lines.length > 0 ? lines : [""];
}

function docToText(doc: PMNode): string {
  return topTexts(doc).join("\n");
}

/** The editor text, kept up to date by the AST plugin; materialized only as a fallback. */
function editorTextOf(state: EditorState): string {
  return astKey.getState(state)?.text ?? docToText(state.doc);
}

/*
 * The schema holds only paragraphs of plain text, so a paragraph's content size
 * is its text length and the text is the paragraphs joined by one newline.
 */
function docTextLength(doc: PMNode): number {
  return doc.childCount > 0 ? doc.content.size - doc.childCount - 1 : 0;
}

/**
 * React reads the focused element's selection as character offsets before
 * every commit when that element reports `contentEditable === "true"`, walking
 * every text node in front of the caret, so each status-bar update while typing
 * scanned the manuscript. The offsets only serve to restore the selection when
 * a commit moves focus away, and ProseMirror owns this selection anyway. The
 * property alone reports "inherit" here; the attribute, which the browser and
 * ProseMirror use for editing, is untouched.
 */
function hideSelectionFromReact(dom: HTMLElement): void {
  const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "contentEditable");
  if (!native?.set) return;
  Object.defineProperty(dom, "contentEditable", {
    configurable: true,
    get: () => "inherit",
    set: (value: string) => native.set!.call(dom, value),
  });
}

function updateEmptyAttribute(editor: Editor, knownText?: string): void {
  const text = knownText ?? docToText(editor.state.doc);
  editor.view.dom.dataset.empty = text.length === 0 ? "true" : "false";
  editor.view.dom.dataset.placeholder = PLACEHOLDER;
}

function cloneLineNode(line: LineNode, lineIndex: number): LineNode {
  return {
    ...line,
    lineIndex,
  };
}

/**
 * Multi-line comments and code blocks make a line's kind depend on its
 * neighbours, so roles are re-derived for the whole document after every change
 * and only lines whose role changed are re-parsed.
 */
function applyLineRoles(lines: LineNode[]): LineNode[] {
  const roles = classifyLines(lines.map((line) => line.source));
  let next: LineNode[] | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (blockHasRole(lines[index], roles[index])) continue;
    next ??= lines.slice();
    next[index] = parseLineNode(lines[index].source, index, 0, roles[index]);
  }
  return next ?? lines;
}

/** The run of comment lines around `index`, or null when that line is not a comment. */
function commentGroupAt(
  lines: readonly LineNode[],
  index: number,
): { from: number; to: number } | null {
  if (lines[index]?.kind !== "comment") return null;
  let from = index;
  let to = index + 1;
  while (from > 0 && lines[from - 1].kind === "comment") from -= 1;
  while (to < lines.length && lines[to].kind === "comment") to += 1;
  return { from, to };
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

/**
 * Lines after `diff`, with roles re-derived. `rolesChangedOutside` reports a
 * comment or code block opened or closed by the edit, which re-roles lines the
 * diff does not cover.
 */
function incrementalLines(
  oldLines: LineNode[],
  newDoc: PMNode,
  diff: DocumentLineDiff,
): { lines: LineNode[]; rolesChangedOutside: boolean } {
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

  const lines = applyLineRoles(next);
  let rolesChangedOutside = false;
  if (lines !== next) {
    for (let index = 0; index < lines.length; index += 1) {
      if (index >= diff.from && index < diff.toNew) continue;
      if (lines[index] !== next[index]) {
        rolesChangedOutside = true;
        break;
      }
    }
  }
  return { lines, rolesChangedOutside };
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

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * 箇条書きの行頭（字下げの空白＋`- ` や `1. ` などの記号＋空白）の範囲。
 * 折り返し行を本文頭に揃えるぶら下げは、この範囲を固定幅の箱に入れて実現する。
 * 字下げの空白も本文中に描画されるので、箱に含めないと折り返し行がその分ずれる。
 */
function listMarkerRange(line: LineNode): { from: number; to: number } | null {
  if (line.kind !== "list") return null;
  const match = LIST_MARKER.exec(line.source);
  return match ? { from: 0, to: match[0].length } : null;
}

/**
 * Break opportunities inside long unbreakable runs (URLs, paths, hashes, long
 * numbers, leaders). Kinsoku itself is left to the browser's line-break: strict:
 * the per-character kinsoku spans this used to add (keep pairs together, ban
 * line-head/line-end characters) changed no line into a rule violation when
 * removed (scripts/experiment-kinsoku-equivalence.mjs, ~6,500 paragraphs), but
 * made up most of a decorated paragraph's elements and forced the IME preedit
 * into nowrap spans.
 */
function pushBreakableDecos(out: Decoration[], line: LineNode, contentStart: number): void {
  if (!line.source) return;
  // マーカーは固定幅の箱（list-marker）に入れるので、他の装飾で分割させない。
  const listMarker = listMarkerRange(line);
  const markupRanges = listMarker
    ? [...inlineMarkupRanges(line), listMarker]
    : inlineMarkupRanges(line);
  pushBreakableTokenDecos(out, contentStart, findBreakableTokens(line.source, markupRanges));
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

  // Image notation stays as typed; pushImageDecos marks it for the hover preview.
  if (markup.type === "image") return;

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
            { class: "ruby-base", "data-rt": item.reading, style: `--ruby-cells: ${item.range.length}` },
          ),
        );
      }
    } else {
      out.push(
        Decoration.inline(contentStart + contentOffset, contentStart + contentEnd, {
          class: "ruby-base",
          "data-rt": reading,
          // 原稿用紙ではルビを親文字の字数分の幅で升目の脇に置く（App.css）。
          style: `--ruby-cells: ${contentEnd - contentOffset}`,
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

  if (markup.type === "code") {
    const contentOffset = markup.contentRange.offset;
    const contentEnd = contentOffset + markup.contentRange.length;
    addInlineDecoration(out, contentStart, fullStart, contentOffset, "mk-hidden");
    addInlineDecoration(out, contentStart, contentOffset, contentEnd, "mk-code");
    addInlineDecoration(out, contentStart, contentEnd, fullEnd, "mk-hidden");
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

/**
 * Marks `![alt](src)` (also on the caret line) so ImageHoverPreview can find
 * the source under the mouse. The text itself is left as typed.
 */
function pushImageDecos(out: Decoration[], line: LineNode, contentStart: number): void {
  for (const markup of line.inlineMarkups) {
    if (markup.type !== "image") continue;
    const from = contentStart + markup.fullRange.offset;
    out.push(
      Decoration.inline(from, from + markup.fullRange.length, {
        class: "mk-image",
        "data-image-src": markup.imageSrc ?? "",
        "data-image-alt": markup.contentText,
        "data-image-key": `${line.lineIndex}:${markup.fullRange.offset}`,
      }),
    );
  }
}

function pushLineDecos(
  out: Decoration[],
  lines: LineNode[],
  index: number,
  nodeStart: number,
  node: PMNode,
  active: boolean,
  latin: ManuscriptLatinContext | null,
  layoutOnly = false,
): void {
  const line = lines[index];
  if (!line || line.kind === "comment" || line.kind === "code") return;

  const classes = ["pm-line"];
  if (line.kind === "blank") classes.push("blank");
  if (line.kind === "heading") classes.push("heading", `h${line.level}`);
  if (line.kind === "list") classes.push("list-line");
  if (shouldJustifyLine(line)) classes.push("ks-justify");
  if (line.align) classes.push(`align-${line.align}`);
  if (line.jitsuki) classes.push("jitsuki");
  if (active) classes.push("active-line");

  const attrs: Record<string, string> = { class: classes.join(" ") };
  // 行番号の全文装飾で窓の外に付く、割り付け用だけの装飾（原稿用紙の行数は
  // これを最終的な行数とみなさない）。
  if (layoutOnly) attrs["data-deco"] = "layout";
  const listMarker = listMarkerRange(line);
  if (line.kind === "list") attrs["data-level"] = String(line.level);
  // マーカーの箱は1文字1chで取る。記号・数字・空白はどれも1ch以内に収まるので、
  // フォントが変わっても箱からはみ出さず、ぶら下げ幅と箱の幅が常に一致する。
  if (listMarker) attrs.style = `--list-marker-size: ${listMarker.to - listMarker.from}ch`;

  out.push(Decoration.node(nodeStart, nodeStart + node.nodeSize, attrs));

  const contentStart = nodeStart + 1;
  if (listMarker) {
    out.push(
      Decoration.inline(contentStart + listMarker.from, contentStart + listMarker.to, {
        class: "list-marker",
      }),
    );
  }
  if (layoutOnly) {
    pushLayoutOnlyLineDecos(out, line, contentStart, listMarker, latin);
    return;
  }
  pushBreakableDecos(out, line, contentStart);
  pushJapaneseQuoteDecos(out, line, contentStart);
  pushImageDecos(out, line, contentStart);
  if (latin) {
    pushManuscriptLatinDecos(out, line, contentStart, latin, active);
    pushManuscriptHangingDecos(out, line, contentStart, active);
  }

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

/**
 * 原稿用紙モードで、欧文ランを整数セルへ揃えるための装飾。
 *
 * ランの自然幅は隠し要素で測ってキャッシュし（LatinRunMetrics）、整数セルとの
 * 差をランの最後の1字の margin-inline-end で補う（わずかに超えるだけなら負で
 * 詰める）。最後の1字だけに付けるのは、他の装飾の境目がラン内にあっても
 * 調整が二重に付かないようにするため。
 * 後続の和文はこれでセルの境目から始まる。装飾は行単位で作られるので、
 * 入力のたびに計り直すのは変更した行の新しいランだけになる。
 */
function pushManuscriptLatinDecos(
  out: Decoration[],
  line: LineNode,
  contentStart: number,
  latin: ManuscriptLatinContext,
  active: boolean,
): void {
  if (!line.source) return;
  const runs = findLatinRuns(line.source);
  if (!runs.length) return;
  // キャレットのある行は記法を生のまま見せるので、記号も欧文として揃える。
  // それ以外の行では記法は整形済み（隠す・ルビ・縦中横）で、揃えの対象外。
  const markupRanges = active ? [] : inlineMarkupRanges(line);
  if (!active && line.marker) markupRanges.push({ from: 0, to: line.marker.length });
  const protectedRanges = [
    ...markupRanges,
    ...findBreakableTokens(line.source, markupRanges).map((token) => ({ from: token.from, to: token.to })),
  ];
  const font = line.kind === "heading" ? latin.heading : latin.body;
  const icEm = latin.metrics.icEm(font);
  for (const run of runs) {
    if (overlapsProtectedRange(run.from, run.to, protectedRanges)) continue;
    const { adjustEm } = latinRunAdjustment(latin.metrics.widthEm({ ...font, text: run.text }), icEm);
    if (Math.abs(adjustEm) < 0.001) continue;
    const lastLength = run.text.codePointAt(run.text.length - 1)! > 0xffff ? 2 : 1;
    out.push(
      Decoration.inline(contentStart + run.to - lastLength, contentStart + run.to, {
        class: "ms-latin-end",
        style: `margin-inline-end: ${adjustEm.toFixed(4)}em`,
      }),
    );
  }
}

/** 中の約物を1字1セルで組まない記法（縦中横・行内コード・画像・ルビの親文字）。 */
const HANGING_EXCLUDED_MARKUPS = new Set<InlineMarkup["type"]>(["tcy", "code", "image", "ruby"]);

/**
 * 原稿用紙モードで、句読点・閉じ括弧を行末の欄外へぶら下げる装飾（MS-30）。
 *
 * Chromium は hanging-punctuation を持たないので、約物のランを「1ランの字数分
 * 手前へ戻した位置から組み、描く位置だけ同じ字数分ずらし戻す」要素で包み、
 * 後ろに同じ幅の空白（::after）を足す。
 * - 行の途中：戻した分を空白が埋めるので、約物は本来のセルに描かれ、後続も
 *   セルの境目から始まる。
 * - 行末：約物の送りは版面の内側で終わるので次の行へ追い出されず、後ろの空白は
 *   行末の空白としてぶら下がる（pre-wrap）。約物は欄外のセルに描かれる。
 * 戻しを約物より前（margin-inline-start）に置くのは、組版が要素の送りを
 * 足していく途中で版面の幅を超えたところで追い出しを決めるため。約物の後ろで
 * 戻しても追い出しは防げない。描く位置は相対配置でずらすので、キャレットの
 * 位置（約物の前後）も描かれた字と一致する。本文の文字列は変えない。
 */
function pushManuscriptHangingDecos(
  out: Decoration[],
  line: LineNode,
  contentStart: number,
  active: boolean,
): void {
  if (!line.source) return;
  const runs = findHangingRuns(line.source);
  if (!runs.length) return;
  const protectedRanges: Array<{ from: number; to: number }> = [];
  for (const markup of line.inlineMarkups) {
    const from = markup.fullRange.offset;
    const to = from + markup.fullRange.length;
    if (HANGING_EXCLUDED_MARKUPS.has(markup.type)) {
      protectedRanges.push({ from, to });
      continue;
    }
    // 整形した行では記号が隠れるので、記号にかかるランは字数とセル数が合わない。
    if (active) continue;
    const contentFrom = markup.contentRange.offset;
    const contentTo = contentFrom + markup.contentRange.length;
    if (contentFrom > from) protectedRanges.push({ from, to: contentFrom });
    if (to > contentTo) protectedRanges.push({ from: contentTo, to });
  }
  if (!active && line.marker) protectedRanges.push({ from: 0, to: line.marker.length });
  for (const run of runs) {
    if (overlapsProtectedRange(run.from, run.to, protectedRanges)) continue;
    out.push(
      Decoration.inline(contentStart + run.from, contentStart + run.to, run.cells > 1
        ? { class: "ms-hang", style: `--hang-cells: ${run.cells}` }
        : { class: "ms-hang" }),
    );
  }
}

/**
 * 装飾窓の外の行に付ける、行の割りに効く装飾だけ。行番号・原稿用紙の枚数は
 * 全行の実際の組版から数えるので、窓の外も記法は整形済み（記号を隠す・ルビ・
 * 縦中横）の姿で組む必要がある。一方で色分けや禁則の補助 span は画面に出ない
 * 行では要らず（禁則は line-break: strict が同じ規則を持つ）、全行に付けると
 * 本文の要素が数倍になる。要素数に比例して描画系の処理（PrePaint・Commit）が
 * 1キーごとに重くなり、10万字で1キー数十msかかった。窓の中へ入った行は
 * 通常どおりすべての装飾に戻る。
 */
function pushLayoutOnlyLineDecos(
  out: Decoration[],
  line: LineNode,
  contentStart: number,
  listMarker: { from: number; to: number } | null,
  latin: ManuscriptLatinContext | null,
): void {
  if (line.source) {
    const markupRanges = listMarker ? [...inlineMarkupRanges(line), listMarker] : inlineMarkupRanges(line);
    pushBreakableTokenDecos(out, contentStart, findBreakableTokens(line.source, markupRanges));
  }
  // 約物のぶら下げは付けない。句読点ごとに要素が増え、10万字では変換中の
  // 1回の更新が倍（約50ms→100ms）に重くなった。原稿用紙の行数はこの段落を
  // 未整形（raw）として隠し要素の最終的な姿（ぶら下げ込み）で数えるので、
  // 窓の外の組みが1行ずれても枚数・行番号は変わらない。
  if (latin) pushManuscriptLatinDecos(out, line, contentStart, latin, false);
  if (line.marker) {
    out.push(Decoration.inline(contentStart, contentStart + line.marker.length, { class: "mk-hidden" }));
  }
  for (const markup of line.inlineMarkups) pushInlineDecos(markup, contentStart, out);
}

/**
 * 原稿用紙の行数を段落単位の「最終的な行数」キャッシュで数える段落か。
 * 最終的な行数とは、キャレットのない状態で装飾（記号隠し・ルビ・禁則・欧文
 * ラン揃え）が付いたときの行数。装飾窓の外の段落は装飾なしで、キャレット行は
 * 記法を生のまま組むので、DOM の行数をそのまま使うと、窓の位置やキャレットの
 * 位置で枚数が変わってしまう。空行・コメント・コード・表は装飾の有無で行数が
 * 変わらない（構造の装飾は原稿全体に付く）ので DOM のまま数える。
 */
function manuscriptCountIsCached(line: LineNode | undefined): line is LineNode {
  if (!line || !line.source) return false;
  return line.kind === "paragraph" || line.kind === "heading" || line.kind === "list";
}

type DecorationShape = {
  from: number;
  to: number;
  type: { attrs?: Record<string, string>; toDOM?: unknown; spec?: { side?: number } };
};

/** ProseMirror と同じく、同じ範囲に重なる装飾の属性を1つの要素へまとめる。 */
function mergeDecorationAttrs(target: Record<string, string>, attrs: Record<string, string>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "class") target.class = target.class ? `${target.class} ${value}` : value;
    else if (name === "style") target.style = target.style ? `${target.style};${value}` : value;
    else if (name !== "nodeName") target[name] = value;
  }
}

/**
 * 段落を、装飾窓の中にあるときと同じ装飾付きの姿で組み立てる（DOMは本文の
 * 外の隠し要素に置く）。装飾は pushLineDecos をそのまま使うので、記号隠し・
 * ルビ・禁則・欧文ラン揃えが窓の中と一致し、行数も一致する。
 */
function buildManuscriptProbeParagraph(
  lines: LineNode[],
  index: number,
  node: PMNode,
  latin: ManuscriptLatinContext | null,
): HTMLParagraphElement {
  const decorations: Decoration[] = [];
  // nodeStart = -1 なので、本文側の位置（0始まりの文字オフセット）がそのまま得られる。
  pushLineDecos(decorations, lines, index, -1, node, false, latin);
  const paragraph = document.createElement("p");
  const text = node.textContent;
  const inline: DecorationShape[] = [];
  const widgets: DecorationShape[] = [];
  for (const decoration of decorations as unknown as DecorationShape[]) {
    if (typeof decoration.type.toDOM === "function") widgets.push(decoration);
    else if (decoration.from < 0) {
      const attrs: Record<string, string> = {};
      mergeDecorationAttrs(attrs, decoration.type.attrs ?? {});
      for (const [name, value] of Object.entries(attrs)) paragraph.setAttribute(name, value);
    } else if (decoration.to > decoration.from) inline.push(decoration);
  }
  const cuts = new Set<number>([0, text.length]);
  for (const decoration of inline) { cuts.add(decoration.from); cuts.add(decoration.to); }
  for (const widget of widgets) cuts.add(widget.from);
  const points = [...cuts].filter((cut) => cut >= 0 && cut <= text.length).sort((a, b) => a - b);
  for (let i = 0; i < points.length; i += 1) {
    const at = points[i];
    for (const widget of widgets) {
      if (widget.from !== at) continue;
      try {
        const dom = (widget.type.toDOM as () => Node)();
        if (dom instanceof Node) paragraph.appendChild(dom);
      } catch {
        // Widgets that need a live view (none of the line decorations do) are skipped.
      }
    }
    const next = points[i + 1];
    if (next === undefined || next <= at) continue;
    const attrs: Record<string, string> = {};
    for (const decoration of inline) {
      if (decoration.from <= at && decoration.to >= next) mergeDecorationAttrs(attrs, decoration.type.attrs ?? {});
    }
    const piece = document.createTextNode(text.slice(at, next));
    if (Object.keys(attrs).length) {
      const span = document.createElement("span");
      for (const [name, value] of Object.entries(attrs)) span.setAttribute(name, value);
      span.appendChild(piece);
      paragraph.appendChild(span);
    } else {
      paragraph.appendChild(piece);
    }
  }
  if (!text.length) paragraph.appendChild(document.createElement("br"));
  return paragraph;
}

// Classes ProseMirror toggles for focus/selection display, and the inline
// declarations that only place the paged root on the current page.
// nativeImeActive はTSF入力の接続中の印で、フォーカスの出入りのたびに付け外しされる。
// 組版の変化として扱うと、原稿用紙では全段落の行数を測り直す（10万字で約1,500段落）。
const ROOT_DISPLAY_CLASSES = new Set(["ProseMirror-focused", "ProseMirror-hideselection", "nativeImeActive"]);
const ROOT_POSITION_PROPERTIES = new Set(["--paged-root-top", "--paged-root-right", "--paged-root-left"]);

/** Whether a class/style change on the editor root can change how paragraphs are laid out. */
function rootTypesettingChanged(record: MutationRecord): boolean {
  const element = record.target as Element;
  const now = element.getAttribute(record.attributeName!) ?? "";
  const before = record.oldValue ?? "";
  if (record.attributeName === "class") {
    const tokens = (value: string) => value.split(/\s+/).filter((token) => token && !ROOT_DISPLAY_CLASSES.has(token)).sort().join(" ");
    return tokens(before) !== tokens(now);
  }
  const declarations = (value: string) => value.split(";")
    .map((part) => part.trim())
    .filter((part) => part && !ROOT_POSITION_PROPERTIES.has(part.slice(0, part.indexOf(":")).trim()))
    .sort().join(";");
  return declarations(before) !== declarations(now);
}

/** 窓の中の行に現れる未計測の欧文ランを、1回のレイアウトでまとめて測る。 */
function prepareManuscriptLatin(
  lines: LineNode[],
  ranges: DecorationRangeList,
  latin: ManuscriptLatinContext,
): void {
  const body = new Set<string>();
  const heading = new Set<string>();
  for (const range of ranges) {
    for (let i = range.from; i < Math.min(lines.length, range.to); i += 1) {
      const line = lines[i];
      if (!line.source || line.kind === "comment" || line.kind === "code") continue;
      const target = line.kind === "heading" ? heading : body;
      for (const run of findLatinRuns(line.source)) target.add(run.text);
    }
  }
  if (body.size) latin.metrics.prepare(latin.body, body);
  if (heading.size) latin.metrics.prepare(latin.heading, heading);
}

/** Put the DOM caret inside an empty cell's own editable span. */
function focusEmptyCell(input: HTMLElement) {
  input.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Anchor the DOM caret in the cell's own span. A document position at a cell
 * edge has an equivalent DOM position inside the neighbouring zero-font-size
 * pipe, and a caret placed there is invisible.
 */
function placeCaretInCell(
  view: EditorView,
  target: { line: number; column: number; from: number; pos: number },
) {
  const rowDOM = view.dom.children[target.line];
  const cellDOM = target.column >= 0
    ? rowDOM?.querySelector<HTMLElement>(`.pm-table-cell[data-table-column="${target.column}"]`)
    : null;
  const input = cellDOM?.querySelector<HTMLElement>(".pm-table-empty-input");
  if (input) {
    focusEmptyCell(input);
    return;
  }
  view.focus();
  const text = cellDOM?.firstChild;
  if (text?.nodeType === Node.TEXT_NODE) {
    const length = text.textContent?.length ?? 0;
    window.getSelection()?.collapse(text, Math.max(0, Math.min(length, target.pos - target.from)));
  }
}

/**
 * Character the click landed on, measured from the rendered glyphs. A table row
 * is a grid of blockified spans separated by zero-size Markdown syntax, and not
 * every engine resolves a caret inside that layout — WebView2 leaves the caret
 * where it was — so the cell tells us the position rather than the hit test.
 */
function caretPointInCell(cell: HTMLElement, event: MouseEvent, vertical: boolean) {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let best: { node: Text; offset: number } | null = null;
  let bestDistance = Infinity;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    for (let i = 0; i < text.data.length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      for (const rect of Array.from(range.getClientRects())) {
        const dx = Math.max(rect.left - event.clientX, event.clientX - rect.right, 0);
        const dy = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
        const distance = dx * dx + dy * dy;
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        const past = vertical
          ? event.clientY > (rect.top + rect.bottom) / 2
          : event.clientX > (rect.left + rect.right) / 2;
        best = { node: text, offset: past ? i + 1 : i };
      }
    }
  }
  return best;
}

/** Where the current click started, so that a drag keeps the native selection. */
let tableClickOrigin: { x: number; y: number; target: EventTarget | null } | null = null;

function handleTableMouseUp(view: EditorView, event: MouseEvent): boolean {
  const origin = tableClickOrigin;
  tableClickOrigin = null;
  if (view.composing || event.button !== 0 || event.detail > 1) return false;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  // A drag selects text; only a click in place is placed by hand.
  if (!origin || origin.target !== event.target) return false;
  if (Math.abs(event.clientX - origin.x) > 3 || Math.abs(event.clientY - origin.y) > 3) return false;
  const target = event.target instanceof Element ? event.target : null;
  const cell = target?.closest<HTMLElement>(".pm-table-cell");
  if (!cell || !view.dom.contains(cell)) return false;
  const input = cell.querySelector<HTMLElement>(".pm-table-empty-input");
  if (input) {
    focusEmptyCell(input);
    return true;
  }
  const point = caretPointInCell(cell, event, getComputedStyle(view.dom).writingMode === "vertical-rl");
  if (!point) return false;
  const pos = view.posAtDOM(point.node, point.offset, 0);
  if (pos < 0) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  view.focus();
  window.getSelection()?.collapse(point.node, point.offset);
  return true;
}

/** Whether `pos` sits on a Markdown table row; avoids materializing the text elsewhere. */
function isTableRowAt(state: EditorState, pos: number): boolean {
  const ast = astKey.getState(state);
  if (!ast?.tableRows.size) return false;
  return ast.tableRows.has(state.doc.resolve(Math.max(0, Math.min(state.doc.content.size, pos))).index(0));
}

function handleTableKeyDown(view: EditorView, event: KeyboardEvent, position = view.state.selection.head): boolean {
  if (event.isComposing || view.composing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!isTableRowAt(view.state, position)) return false;
  if (!view.state.selection.empty && event.key !== "Tab") return false;
  // Preserve native range selection; ordinary navigation uses visible cells.
  if (event.shiftKey && event.key !== "Tab") return false;
  const target = tableCaretTarget(docToText(view.state.doc), textOffsetFromPmPos(view.state.doc, position), event.key,
    getComputedStyle(view.dom).writingMode === "vertical-rl", event.shiftKey);
  if (!target) return false;
  event.preventDefault();
  if ("insertBefore" in target && target.insertBefore) {
    const tr = view.state.tr.insert(0, view.state.schema.nodes.paragraph.create());
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)));
    view.focus();
    return true;
  }
  const pos = pmPosFromTextOffset(view.state.doc, target.pos);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  placeCaretInCell(view, target);
  return true;
}

function pushTableRowDecos(out: Decoration[], node: PMNode, start: number, row: TableRow, active: boolean) {
  // Content-sized columns: every row of the table gets the same track list, so
  // the cells stay aligned while the table only takes the width it needs. Once
  // the content no longer fits the measure the fractions share it out instead.
  // Each track carries the cell padding (0.25em per side) plus slack for the
  // ideographic spacing the browser adds where Latin meets Japanese.
  const padding = 0.75;
  const tracks = row.widths.map((width) => `0 minmax(0, ${width + padding}fr)`);
  const extent = row.widths.reduce((sum, width) => sum + width + padding, 0);
  out.push(Decoration.node(start, start + node.nodeSize, {
    class: `pm-line pm-table-row pm-table-${row.kind}${active ? " active-line" : ""}`,
    style: `--table-columns: ${row.columns}; --table-tracks: ${tracks.join(" ")} 0;` +
      ` --table-extent: calc(${extent}em + ${row.columns * 2}px)`,
  }));
  let end = 0;
  const marker = (from: number, to: number, column: number) => {
    if (to > from) out.push(Decoration.inline(start + 1 + from, start + 1 + to, {
      class: "pm-table-marker", style: `grid-column: ${column}`,
    }));
  };
  for (let i = 0; i < row.columns; i++) {
    const rawCell = row.cells[i];
    const cell = rawCell ? { ...rawCell } : undefined;
    // Markdown padding is syntax, not cell content. Preserve it in the source
    // while keeping it out of the visible editable text.
    if (cell) {
      while (cell.from < cell.to && /[ \t]/.test(node.textContent[cell.from])) cell.from++;
      while (cell.to > cell.from && /[ \t]/.test(node.textContent[cell.to - 1])) cell.to--;
    }
    const attrs = {
      class: "pm-table-cell",
      "data-table-column": String(i),
      style: `grid-column: ${2 * i + 2}; text-align: ${row.alignments[i] ?? "start"}`,
    };
    if (cell) marker(end, cell.from, 2 * i + 1);
    if (cell && cell.to > cell.from) {
      // During IME composition decorations are mapped rather than rebuilt.
      // Include input at either edge so it stays inside the cell's grid item.
      out.push(Decoration.inline(start + 1 + cell.from, start + 1 + cell.to, attrs, {
        inclusiveStart: true,
        inclusiveEnd: true,
      }));
    } else {
      out.push(Decoration.widget(start + 1 + (cell?.from ?? node.content.size), (view, getPos) => {
        const span = document.createElement("span");
        span.className = attrs.class;
        span.setAttribute("data-table-column", String(i));
        span.setAttribute("style", attrs.style);
        const input = document.createElement("span");
        input.contentEditable = "true";
        input.className = "pm-table-empty-input";
        input.setAttribute("role", "textbox");
        input.setAttribute("aria-label", `${i + 1}列目の空セル`);
        input.appendChild(document.createElement("br"));
        span.appendChild(input);
        let composing = false;
        let committed = false;
        const commit = () => {
          if (composing || committed) return;
          const value = input.textContent ?? "";
          const pos = getPos();
          if (!value || pos === undefined) return;
          committed = true;
          const tr = view.state.tr;
          let cursor: number;
          if (rawCell) {
            const from = pos - (cell!.from - rawCell.from);
            tr.insertText(value, from, from + rawCell.to - rawCell.from);
            cursor = from + value.length;
          } else {
            const last = row.cells[row.cells.length - 1];
            const suffix = (last && last.to < node.content.size ? "" : "|") +
              "|".repeat(i - row.cells.length) + value + "|";
            tr.insertText(suffix, pos);
            cursor = pos + suffix.length - 1;
          }
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, cursor)));
          view.focus();
        };
        input.addEventListener("compositionstart", () => { composing = true; });
        input.addEventListener("compositionend", () => { composing = false; commit(); });
        input.addEventListener("input", (event) => {
          if (!(event as InputEvent).isComposing) commit();
        });
        input.addEventListener("blur", commit);
        input.addEventListener("focus", () => {
          const pos = getPos();
          if (pos !== undefined && (!view.state.selection.empty || view.state.selection.head !== pos)) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
          }
        });
        input.addEventListener("keydown", (event) => {
          if (composing) return;
          const pos = getPos();
          if (pos !== undefined && handleTableKeyDown(view, event, pos)) {
            event.stopPropagation();
          } else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
            // Empty cells share the document undo history, not the browser's
            // independent contenteditable history.
            view.focus();
            if (view.someProp("handleKeyDown", handler => handler(view, event))) {
              event.preventDefault();
              event.stopPropagation();
            }
          }
        });
        span.addEventListener("mousedown", (event) => {
          if (event.target === input || input.contains(event.target as Node)) return;
          event.preventDefault();
          focusEmptyCell(input);
        });
        return span;
      }, {
        side: -1,
        key: `table-empty-${i}-${rawCell?.from}-${rawCell?.to}-${row.columns}-${row.alignments[i]}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }));
    }
    if (cell) end = cell.to;
  }
  marker(end, node.content.size, 2 * row.columns + 1);
}

/**
 * Comment and code lines are styled across the whole document, not only inside
 * the decoration window: folding and the code font change layout, so they must
 * not depend on the scroll position.
 */
function pushStructureDecos(
  out: Decoration[],
  doc: PMNode,
  lines: readonly LineNode[],
  activeIndex: number,
  commentsHidden: boolean,
): void {
  if (!lines.some((line) => line.kind === "comment" || line.kind === "code")) return;
  // The comment group holding the caret stays open so it can be read and edited.
  const open = commentGroupAt(lines, activeIndex);
  let insideCode = false;
  doc.forEach((node, start, index) => {
    const line = lines[index];
    if (line?.kind === "comment") {
      const hidden = commentsHidden && !(open && index >= open.from && index < open.to);
      out.push(Decoration.node(start, start + node.nodeSize, {
        class: hidden ? "pm-line pm-comment pm-comment-hidden" : "pm-line pm-comment",
      }));
      return;
    }
    if (line?.kind !== "code") return;
    const classes = ["pm-line", "pm-code"];
    if (line.codeFence) {
      classes.push("pm-code-fence", insideCode ? "pm-code-end" : "pm-code-start");
      insideCode = !insideCode;
    }
    out.push(Decoration.node(start, start + node.nodeSize, { class: classes.join(" ") }));
  });
}

const CODE_INDENT = "    ";

/**
 * Tab / Shift+Tab inside a code block (docs/CODE_BLOCK_SPEC.md §7): Tab inserts
 * four spaces at the caret, or indents every selected line; Shift+Tab removes up
 * to four leading spaces from every selected line. Fence lines are left alone.
 */
function handleCodeIndent(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey || view.composing) {
    return false;
  }
  const ast = astKey.getState(view.state);
  if (!ast) return false;
  const { selection, doc } = view.state;
  const firstIndex = selection.$from.index(0);
  const lastIndex = selection.$to.index(0);
  const lines = ast.lines;
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    if (lines[index]?.kind !== "code") return false;
  }

  const tr = view.state.tr;
  if (!event.shiftKey && selection.empty) {
    if (lines[firstIndex].codeFence) return true;
    tr.insertText(CODE_INDENT, selection.from);
  } else {
    // Walk bottom-up so earlier positions stay valid while editing.
    for (let index = lastIndex; index >= firstIndex; index -= 1) {
      if (lines[index].codeFence) continue;
      const start = pmStartAtIndex(doc, index);
      if (start === null) continue;
      const lineStart = start + 1;
      if (event.shiftKey) {
        const leading = /^ {1,4}/.exec(doc.child(index).textContent)?.[0].length ?? 0;
        if (leading > 0) tr.delete(lineStart, lineStart + leading);
      } else if (doc.child(index).content.size > 0 || firstIndex === lastIndex) {
        tr.insertText(CODE_INDENT, lineStart);
      }
    }
  }
  if (tr.docChanged) view.dispatch(tr.scrollIntoView());
  return true;
}

const LIST_INDENT = "  ";
const LIST_MAX_LEVEL = 6;

/** 直前の空行でない行が箇条書きならその行番号。違えば null。 */
function previousListIndex(lines: LineNode[], index: number): number | null {
  for (let prev = index - 1; prev >= 0; prev -= 1) {
    if (lines[prev].kind === "blank") continue;
    return lines[prev].kind === "list" ? prev : null;
  }
  return null;
}

/**
 * Tab / Shift+Tab で箇条書きを1段深く・浅くする（docs/LIST_SPEC.md）。
 * 選択範囲にある箇条書きの行を、その子孫（後に続く、より深い行）ごと動かす。
 * 段を飛ばす結果（直前の項目より2段以上深い）やレベル0〜6の外に出る結果になるときは
 * 何もしない。箇条書きの行を含むときは、何もしなくてもキーを消費する。
 */
function handleListIndent(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (view.composing || event.isComposing) return false;
  const ast = astKey.getState(view.state);
  if (!ast) return false;
  const { selection, doc } = view.state;
  const lines = ast.lines;
  const firstIndex = selection.$from.index(0);
  const lastIndex = selection.$to.index(0);

  const moved = new Set<number>();
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    if (lines[index]?.kind !== "list" || moved.has(index)) continue;
    moved.add(index);
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].kind === "blank") continue;
      if (lines[next].kind !== "list" || lines[next].level <= lines[index].level) break;
      moved.add(next);
    }
  }
  if (moved.size === 0) return false;

  const delta = event.shiftKey ? -1 : 1;
  for (const index of moved) {
    const level = lines[index].level + delta;
    if (level < 0 || level > LIST_MAX_LEVEL) return true;
    const prev = previousListIndex(lines, index);
    if (prev !== null && moved.has(prev)) continue;
    const parentLimit = prev === null ? 0 : lines[prev].level + 1;
    if (level > parentLimit) return true;
  }

  const tr = view.state.tr;
  // 下の行から編集し、上の行の位置をずらさない。
  for (const index of [...moved].sort((a, b) => b - a)) {
    const start = pmStartAtIndex(doc, index);
    if (start === null) continue;
    const lineStart = start + 1;
    if (delta > 0) {
      tr.insertText(LIST_INDENT, lineStart);
    } else {
      // AST と同じくタブは空白2個ぶんと数え、字下げ1段（空白2個ぶん）を取り除く。
      const text = doc.child(index).textContent;
      let remove = 0;
      let width = 0;
      while (width < 2 && (text[remove] === " " || text[remove] === "\t")) {
        width += text[remove] === "\t" ? 2 : 1;
        remove += 1;
      }
      if (remove > 0) tr.delete(lineStart, lineStart + remove);
    }
  }
  if (!tr.docChanged) return true;
  // Tab 1回を Ctrl+Z 1回で戻せるよう、前後の入力と履歴をまとめない。
  view.dispatch(closeHistory(tr).scrollIntoView());
  view.dispatch(closeHistory(view.state.tr));
  return true;
}

/**
 * With comments folded, Backspace at a line start (Delete at a line end) next
 * to a folded comment joins with the nearest visible line instead. The default
 * join would merge the text into the comment line, where it would disappear.
 */
function handleFoldedCommentJoin(view: EditorView, event: KeyboardEvent): boolean {
  const backward = event.key === "Backspace";
  if ((!backward && event.key !== "Delete") || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const ast = astKey.getState(view.state);
  const { selection, doc } = view.state;
  if (!ast?.commentsHidden || !selection.empty || view.composing) return false;
  const { $head } = selection;
  const index = $head.index(0);
  const lines = ast.lines;
  if (lines[index]?.kind === "comment") return false;
  const atEdge = backward ? $head.parentOffset === 0 : $head.parentOffset === $head.parent.content.size;
  const neighbour = backward ? index - 1 : index + 1;
  if (!atEdge || lines[neighbour]?.kind !== "comment") return false;

  let target = neighbour;
  while (lines[target]?.kind === "comment") target += backward ? -1 : 1;
  if (target < 0 || target >= doc.childCount) return true;

  // Always move the later line's content onto the end of the earlier one, so
  // the folded comments end up after the joined line.
  const [earlier, later] = backward ? [target, index] : [index, target];
  const earlierStart = pmStartAtIndex(doc, earlier);
  const laterStart = pmStartAtIndex(doc, later);
  if (earlierStart === null || laterStart === null) return true;
  const earlierNode = doc.child(earlier);
  const laterNode = doc.child(later);
  const joinPos = earlierStart + 1 + earlierNode.content.size;
  const tr = view.state.tr
    .delete(laterStart, laterStart + laterNode.nodeSize)
    .insert(joinPos, laterNode.content);
  tr.setSelection(TextSelection.create(tr.doc, joinPos)).scrollIntoView();
  view.dispatch(tr);
  return true;
}

type DecorationRangeList = Array<{ from: number; to: number }>;

/**
 * Lines that get every decoration. With fullDecorations the rest of the
 * document still gets the layout-affecting ones (pushLayoutOnlyLineDecos).
 */
function windowRanges(
  lineCount: number,
  activeIndex: number,
  visibleCenter: number,
): DecorationRangeList {
  return decorationRange(activeIndex, lineCount, visibleCenter);
}

function inRanges(ranges: DecorationRangeList, index: number): boolean {
  return ranges.some((range) => index >= range.from && index < range.to);
}

function buildWindowDecos(
  doc: PMNode,
  lines: LineNode[],
  tableRows: Map<number, TableRow>,
  activeIndex: number,
  visibleCenter: number,
  fullDecorations: boolean,
  commentsHidden: boolean,
  latin: ManuscriptLatinContext | null,
): DecorationSet {
  const out: Decoration[] = [];
  const count = Math.min(doc.childCount, lines.length);
  // Comment lines are styled (and folded) across the whole document, not only
  // inside the decoration window, so hiding never depends on the scroll position.
  pushStructureDecos(out, doc, lines, activeIndex, commentsHidden);
  // Keep table geometry stable outside the decoration window as well: moving
  // the caret or scrolling must never replace the grid with raw paragraphs.
  if (tableRows.size) doc.forEach((node, start, index) => {
    const row = tableRows.get(index);
    if (row) pushTableRowDecos(out, node, start, row, index === activeIndex);
  });
  const ranges = windowRanges(count, activeIndex, visibleCenter);
  if (latin) prepareManuscriptLatin(lines, fullDecorations ? [{ from: 0, to: count }] : ranges, latin);

  if (fullDecorations) {
    doc.forEach((node, nodeStart, i) => {
      if (i >= count || tableRows.has(i)) return;
      pushLineDecos(out, lines, i, nodeStart, node, i === activeIndex, latin, !inRanges(ranges, i));
    });
    return DecorationSet.create(doc, out);
  }

  for (const range of ranges) {
    let nodeStart = pmStartAtIndex(doc, range.from);
    if (nodeStart === null) continue;

    for (let i = range.from; i < Math.min(count, range.to); i += 1) {
      const node = doc.child(i);
      if (!tableRows.has(i)) pushLineDecos(out, lines, i, nodeStart, node, i === activeIndex, latin);
      nodeStart += node.nodeSize;
    }
  }

  return DecorationSet.create(doc, out);
}

/** A range of line indices carried through `diff` (lines inside it map onto the diff). */
function mapLineRange(
  range: { from: number; to: number },
  diff: DocumentLineDiff | null,
): { from: number; to: number } {
  if (!diff) return range;
  const delta = diff.toNew - diff.toOld;
  const from = range.from < diff.from ? range.from : range.from >= diff.toOld ? range.from + delta : diff.from;
  const to = range.to <= diff.from ? range.to : range.to >= diff.toOld ? range.to + delta : diff.toNew;
  return { from, to: Math.max(from, to) };
}

/** Past this many lines to re-decorate, a rebuild is as cheap as a patch. */
const MAX_PATCHED_DECORATION_LINES = 400;

/**
 * Patches the previous decorations instead of rebuilding them. Building a
 * DecorationSet scans every decoration once per top-level node, which costs
 * more than the rest of a keystroke on a long manuscript. Only the lines that
 * changed, the old and new caret lines and lines entering or leaving the window
 * are re-decorated. Returns null when the edit can restyle lines it does not
 * touch (comments, code blocks), which needs a full rebuild.
 */
function patchWindowDecos(
  previous: AstPluginState,
  doc: PMNode,
  mapping: Transaction["mapping"] | null,
  diff: DocumentLineDiff | null,
  lines: LineNode[],
  tableRows: Map<number, TableRow>,
  activeIndex: number,
  visibleCenter: number,
  latin: ManuscriptLatinContext | null,
): DecorationSet | null {
  if (lines.length !== doc.childCount) return null;
  const isStructure = (line: LineNode | undefined) => line?.kind === "comment" || line?.kind === "code";
  const delta = diff ? diff.toNew - diff.toOld : 0;
  const decorated = previous.decoWindow;
  const stale = decorated.stale ? mapLineRange(decorated.stale, diff) : null;
  if (diff) {
    // Neighbours included: their structure decorations are not re-derived here.
    for (let i = Math.max(0, diff.from - 1); i <= diff.toOld; i += 1) if (isStructure(previous.lines[i])) return null;
    for (let i = Math.max(0, diff.from - 1); i <= diff.toNew; i += 1) if (isStructure(lines[i])) return null;
  }
  if (stale) {
    for (let i = stale.from; i < stale.to; i += 1) if (isStructure(lines[i])) return null;
  }
  // A folded comment group opens around the caret.
  if (
    previous.commentsHidden &&
    (isStructure(previous.lines[decorated.activeIndex]) || isStructure(lines[activeIndex]))
  ) {
    return null;
  }

  const oldToNew = (index: number) =>
    !diff || index < diff.from ? index : index >= diff.toOld ? index + delta : -1;
  const newToOld = (index: number) =>
    !diff || index < diff.from ? index : index >= diff.toNew ? index - delta : -1;
  const oldRanges = windowRanges(previous.lines.length, decorated.activeIndex, decorated.visibleCenter);
  const newRanges = windowRanges(lines.length, activeIndex, visibleCenter);

  const dirty = new Set<number>();
  // The lines either side too: joining or splitting rewrites their node
  // boundaries, and mapping drops their decorations even when their text is
  // unchanged.
  if (diff) for (let i = Math.max(0, diff.from - 1); i <= Math.min(lines.length - 1, diff.toNew); i += 1) dirty.add(i);
  if (stale) for (let i = stale.from; i < stale.to; i += 1) dirty.add(i);
  if (oldToNew(decorated.activeIndex) >= 0) dirty.add(oldToNew(decorated.activeIndex));
  dirty.add(activeIndex);
  for (const range of newRanges) {
    for (let i = range.from; i < range.to; i += 1) {
      const old = newToOld(i);
      if (old < 0 || !inRanges(oldRanges, old)) dirty.add(i);
    }
  }
  for (const range of oldRanges) {
    for (let i = range.from; i < range.to; i += 1) {
      const next = oldToNew(i);
      if (next >= 0 && !inRanges(newRanges, next)) dirty.add(next);
    }
  }
  if (dirty.size > MAX_PATCHED_DECORATION_LINES) return null;

  const retained = mapping && diff
    ? spliceRootDecorations(previous.decoSet, previous.lines, lines, diff)
    : mapping ? previous.decoSet.map(mapping, doc) : previous.decoSet;
  if (!retained) return null;
  let set: DecorationSet = retained;
  const removed: Decoration[] = [];
  const added: Decoration[] = [];
  doc.forEach((node, start, index) => {
    if (!dirty.has(index) || isStructure(lines[index])) return;
    // Strictly inside the line, so the neighbours' node decorations stay put.
    removed.push(...set.find(start + 1, start + node.nodeSize - 1));
    const row = tableRows.get(index);
    if (row) pushTableRowDecos(added, node, start, row, index === activeIndex);
    else if (inRanges(newRanges, index)) pushLineDecos(added, lines, index, start, node, index === activeIndex, latin);
    else if (previous.fullDecorations) pushLineDecos(added, lines, index, start, node, false, latin, true);
  });
  if (removed.length) set = set.remove(removed);
  if (added.length) set = set.add(doc, added);
  return set;
}

function decorationSignature(set: DecorationSet): string[] {
  return set
    .find()
    .map((decoration) => {
      const type = (decoration as unknown as { type: { attrs?: unknown; constructor: { name: string } } }).type;
      return `${decoration.from}:${decoration.to}:${type.constructor.name}:${JSON.stringify(type.attrs ?? decoration.spec ?? null)}`;
    })
    .sort();
}

function windowDecosWithShadow(
  previous: AstPluginState,
  doc: PMNode,
  mapping: Transaction["mapping"] | null,
  diff: DocumentLineDiff | null,
  lines: LineNode[],
  tableRows: Map<number, TableRow>,
  activeIndex: number,
  visibleCenter: number,
  fullDecorations: boolean,
  commentsHidden: boolean,
  forceRebuild: boolean,
  latin: ManuscriptLatinContext | null,
): DecorationSet {
  const rebuild = () =>
    buildWindowDecos(doc, lines, tableRows, activeIndex, visibleCenter, fullDecorations, commentsHidden, latin);
  if (
    forceRebuild ||
    previous.decoWindow.rebuild ||
    latin !== previous.latin ||
    fullDecorations !== previous.fullDecorations ||
    commentsHidden !== previous.commentsHidden
  ) {
    return rebuild();
  }
  const patched = patchWindowDecos(previous, doc, mapping, diff, lines, tableRows, activeIndex, visibleCenter, latin);
  if (!patched) return rebuild();
  if (!import.meta.env.DEV) return patched;

  const rebuilt = rebuild();
  const incremental = decorationSignature(patched);
  const expected = decorationSignature(rebuilt);
  if (incremental.length === expected.length && incremental.every((value, index) => value === expected[index])) {
    return patched;
  }
  console.error("[decoration-shadow] patched decorations diverged; using full rebuild", {
    diff,
    activeIndex,
    missing: expected.filter((value) => !incremental.includes(value)).slice(0, 10),
    extra: incremental.filter((value) => !expected.includes(value)).slice(0, 10),
  });
  return rebuilt;
}

/**
 * Table rows after an edit. Tables are found from pairs of lines with pipes,
 * so an edit that touches no pipe, next to no pipe, keeps every table as is.
 */
function nextTableRows(
  previous: AstPluginState,
  lines: LineNode[],
  diff: DocumentLineDiff,
  rolesChangedOutside: boolean,
): { rows: Map<number, TableRow>; changed: boolean } {
  const hasPipe = (source: readonly LineNode[], from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(source.length, to); i += 1) {
      if (source[i].source.includes("|")) return true;
    }
    return false;
  };
  if (
    rolesChangedOutside ||
    hasPipe(previous.lines, diff.from - 1, diff.toOld + 1) ||
    hasPipe(lines, diff.from - 1, diff.toNew + 1)
  ) {
    const rows = markdownTableRows(lines);
    return { rows, changed: rows.size > 0 || previous.tableRows.size > 0 };
  }
  const delta = diff.toNew - diff.toOld;
  if (delta === 0 || previous.tableRows.size === 0) return { rows: previous.tableRows, changed: false };
  const rows = new Map<number, TableRow>();
  for (const [index, row] of previous.tableRows) rows.set(index >= diff.toOld ? index + delta : index, row);
  return { rows, changed: false };
}

function makeAstState(state: EditorState): AstPluginState {
  const texts = topTexts(state.doc);
  const lines = applyLineRoles(texts.map((line, index) => parseLineNode(line, index)));
  const activeIndex = activeLineIndex(state);
  const tableRows = markdownTableRows(lines);
  return {
    lines,
    documentIndex: import.meta.env.DEV ? createDocumentIndexFromLines(texts) : null,
    text: texts.join("\n"),
    change: null,
    activeIndex,
    visibleCenter: activeIndex,
    fullDecorations: false,
    commentsHidden: false,
    tableRows,
    decoWindow: { activeIndex, visibleCenter: activeIndex, stale: null, rebuild: false },
    latin: null,
    decoSet: buildWindowDecos(state.doc, lines, tableRows, activeIndex, activeIndex, false, false, null),
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
): { text: string; change: TextSplice | null } {
  const updated = updateTextFromLineDiffWithChange(previousText, oldLines, newLines, diff);
  if (!import.meta.env.DEV) return updated;

  const { text } = updated;
  const rebuilt = newLines.map((line) => line.source).join("\n");
  if (text === rebuilt) return updated;

  console.error("[editor-text-shadow] incremental text diverged; using full materialization", {
    diff,
    text,
    rebuilt,
  });
  return { text: rebuilt, change: null };
}

/**
 * IME composition over a selection replaces text that decorations may split
 * into several DOM text nodes. ProseMirror keeps only one text node under the
 * IME; when mapping reshapes a decoration that crosses the replaced range, it
 * redraws the others, the IME loses its composition range and each candidate
 * is inserted again beside the last. Dropping the decorations that the
 * replacement would reshape leaves the range plain text. The lines stay stale
 * until compositionend re-decorates them.
 */
function clearImeReplaceRange(
  value: AstPluginState,
  doc: PMNode,
  { from, to }: { from: number; to: number },
): AstPluginState {
  const reshaped = value.decoSet.find(from, to).filter((decoration) => {
    if (decoration.from === decoration.to) return decoration.from > from && decoration.from < to;
    if (!(decoration as unknown as { inline: boolean }).inline) return false;
    if (decoration.to < from || decoration.from > to) return false;
    const spec = decoration.spec as { inclusiveStart?: boolean; inclusiveEnd?: boolean };
    // Still around the composition after mapping the replacement.
    const keepsStart = decoration.from < from || (decoration.from === from && spec.inclusiveStart === true);
    const keepsEnd = decoration.to > to || (decoration.to === to && spec.inclusiveEnd === true);
    if (keepsStart && keepsEnd) return false;
    // Merely adjacent: the replacement does not move its boundary.
    return decoration.to > from && decoration.from < to;
  });
  if (!reshaped.length) return value;
  const first = doc.resolve(from).index(0);
  const last = doc.resolve(to).index(0) + 1;
  const stale = value.decoWindow.stale;
  return {
    ...value,
    decoSet: value.decoSet.remove(reshaped),
    decoWindow: {
      ...value.decoWindow,
      stale: { from: Math.min(first, stale?.from ?? first), to: Math.max(last, stale?.to ?? last) },
    },
  };
}

function applyAst(
  tr: Transaction,
  value: AstPluginState,
  _oldState: EditorState,
  newState: EditorState,
): AstPluginState {
  const meta = tr.getMeta(astKey) as AstMeta | undefined;
  if (meta?.imeReplaceRange && !tr.docChanged) return clearImeReplaceRange(value, newState.doc, meta.imeReplaceRange);
  let visibleCenter = value.visibleCenter;
  const fullDecorations =
    typeof meta?.fullDecorations === "boolean"
      ? meta.fullDecorations
      : value.fullDecorations;
  const commentsHidden =
    typeof meta?.commentsHidden === "boolean"
      ? meta.commentsHidden
      : value.commentsHidden;
  const latin = meta && "latin" in meta ? meta.latin ?? null : value.latin;

  if (typeof meta?.visibleCenter === "number") {
    visibleCenter = Math.max(0, Math.min(newState.doc.childCount - 1, meta.visibleCenter));
  }

  if (!tr.docChanged) {
    const activeIndex = activeLineIndex(newState);
    if (
      meta?.rebuild !== true &&
      meta?.refreshComposition !== true &&
      activeIndex === value.activeIndex &&
      visibleCenter === value.visibleCenter &&
      fullDecorations === value.fullDecorations &&
      commentsHidden === value.commentsHidden &&
      latin === value.latin
    ) {
      return value;
    }

    return {
      ...value,
      activeIndex,
      visibleCenter,
      fullDecorations,
      commentsHidden,
      latin,
      decoWindow: { activeIndex, visibleCenter, stale: null, rebuild: false },
      decoSet: windowDecosWithShadow(
        value,
        newState.doc,
        null,
        null,
        value.lines,
        value.tableRows,
        activeIndex,
        visibleCenter,
        fullDecorations,
        commentsHidden,
        meta?.rebuild === true,
        latin,
      ),
    };
  }

  const selectionDiff = lineDiffFromSelectionTransaction(tr, _oldState, newState);
  const diff = selectionDiff ?? diffTopLevelNodes(_oldState.doc, newState.doc);
  const { lines, rolesChangedOutside } = incrementalLines(value.lines, newState.doc, diff);
  const tables = nextTableRows(value, lines, diff, rolesChangedOutside);
  const documentIndex = updateDocumentIndexWithShadow(value.documentIndex, lines, diff);
  const { text, change: splice } = updateEditorTextWithShadow(value.text, value.lines, lines, diff);
  const change = splice ? { ...splice, base: value.text } : null;
  const activeIndex = activeLineIndex(newState);

  if (tr.getMeta("composition") !== undefined) {
    const previousStale = value.decoWindow.stale ? mapLineRange(value.decoWindow.stale, diff) : null;
    return {
      lines,
      documentIndex,
      text,
      change,
      activeIndex,
      visibleCenter,
      fullDecorations,
      commentsHidden,
      latin,
      tableRows: tables.rows,
      decoWindow: {
        ...value.decoWindow,
        stale: {
          from: Math.min(diff.from, previousStale?.from ?? diff.from),
          to: Math.max(diff.toNew, previousStale?.to ?? diff.toNew),
        },
        // Mapped decorations no longer line up with a window that lines moved through.
        rebuild: value.decoWindow.rebuild || rolesChangedOutside || tables.changed || diff.toNew !== diff.toOld,
      },
      decoSet: value.decoSet.map(tr.mapping, newState.doc),
    };
  }

  return {
    lines,
    documentIndex,
    text,
    change,
    activeIndex,
    visibleCenter,
    fullDecorations,
    commentsHidden,
    latin,
    tableRows: tables.rows,
    decoWindow: { activeIndex, visibleCenter, stale: null, rebuild: false },
    decoSet: windowDecosWithShadow(
      value,
      newState.doc,
      tr.mapping,
      diff,
      lines,
      tables.rows,
      activeIndex,
      visibleCenter,
      fullDecorations,
      commentsHidden,
      meta?.rebuild === true || rolesChangedOutside || tables.changed,
      latin,
    ),
  };
}

const LayoutAstExtension = Extension.create({
  name: "thenLayoutAst",

  addProseMirrorPlugins() {
    return [
      new Plugin<AstPluginState>({
        key: astKey,
        view: () => {
          let frame: number | null = null;
          return {
            update(view) {
              if (frame !== null) cancelAnimationFrame(frame);
              frame = null;
              // Only a caret on a table row can need snapping; skip the text scan otherwise.
              if (!isTableRowAt(view.state, view.state.selection.head)) return;
              frame = requestAnimationFrame(() => {
                frame = null;
                // TSF入力中は本文がDOMフォーカスを持たない（nativeImeActive）。
                const focused = view.hasFocus() || view.dom.classList.contains("nativeImeActive");
                if (view.composing || !focused || !view.state.selection.empty) return;
                if (!isTableRowAt(view.state, view.state.selection.head)) return;
                const offset = textOffsetFromPmPos(view.state.doc, view.state.selection.head);
                const cell = tableCellCaret(docToText(view.state.doc), offset,
                  getComputedStyle(view.dom).writingMode === "vertical-rl");
                if (!cell) return;
                // Arrow keys from the line beside a table let the browser land on
                // hidden syntax. Bring the caret back onto the cell it belongs to.
                if (cell.pos !== offset) {
                  const pos = pmPosFromTextOffset(view.state.doc, cell.pos);
                  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
                }
                const anchor = window.getSelection()?.anchorNode ?? null;
                const element = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element | null);
                if (!element?.closest(".pm-table-cell")) placeCaretInCell(view, cell);
              });
            },
            destroy() { if (frame !== null) cancelAnimationFrame(frame); },
          };
        },
        state: {
          init: (_config, state) => makeAstState(state),
          apply: applyAst,
        },
        props: {
          handleKeyDown: (view, event) =>
            handleTableKeyDown(view, event) ||
            handleCodeIndent(view, event) ||
            handleListIndent(view, event) ||
            handleFoldedCommentJoin(view, event),
          handleDOMEvents: {
            mousedown: (_view, event) => {
              tableClickOrigin = { x: event.clientX, y: event.clientY, target: event.target };
              return false;
            },
            mouseup: handleTableMouseUp,
          },
          decorations(state) {
            return indexRootDecorations(astKey.getState(state)?.decoSet ?? DecorationSet.empty);
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
    const lineLength = node.content.size;

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
  const textLength = docTextLength(doc);
  let remaining = Math.max(0, Math.min(textLength, offset));
  let nodeStart = 0;

  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i);
    const lineLength = node.content.size;
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
  const head = textOffsetFromPmPos(editor.state.doc, selection.head);
  return {
    from: selection.empty ? head : textOffsetFromPmPos(editor.state.doc, selection.from),
    to: selection.empty ? head : textOffsetFromPmPos(editor.state.doc, selection.to),
    head,
    line: lineNumberFromTopLevelIndex(selection.$head.index(0)),
  };
}

function setSelectionByTextOffset(editor: Editor, offset: number): void {
  const pos = pmPosFromTextOffset(editor.state.doc, offset);
  editor.commands.setTextSelection(pos);
}

function setSelectionByTextOffsets(editor: Editor, anchor: number, head: number): void {
  editor.commands.setTextSelection({
    from: pmPosFromTextOffset(editor.state.doc, anchor),
    to: pmPosFromTextOffset(editor.state.doc, head),
  });
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

  // A table cell starts after hidden pipes/padding. Measuring the preceding
  // source character anchors the scroll to that invisible grid track instead
  // of the caret, especially at the beginning of a header cell.
  if (activeBlockElement(view)?.classList.contains("pm-table-row")) {
    const offset = textOffsetFromPmPos(view.state.doc, head);
    const target = tableCaretTarget(docToText(view.state.doc), offset, "Home", !isHorizontalWriting(writingMode));
    const cell = target && activeBlockElement(view)?.querySelector<HTMLElement>(`.pm-table-cell[data-table-column="${target.column}"]`);
    if (cell) {
      const text = cell.firstChild;
      if (text?.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.setStart(text, Math.max(0, Math.min(text.textContent?.length ?? 0, offset - target!.from)));
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        if (rectHasArea(rect)) return { rect, source: "table-cell-caret" };
      }
      const input = cell.querySelector(".pm-table-empty-input");
      if (input) return { rect: input.getBoundingClientRect(), source: "table-empty-cell" };
    }
  }

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
  documentPath = null,
  colorizeJapaneseQuotes,
  showComments,
  textLayoutSignature,
  initialSelectionOffset,
  initialViewportState,
  onViewportSizeChange,
  onReady,
  onTextChange,
  onSelectionChange,
  onPageMetricsChange,
  manuscript = DEFAULT_MANUSCRIPT_SETTINGS,
  onManuscriptProgressChange,
}: VerticalTextEditorProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const lineBreakLayerRef = useRef<HTMLDivElement | null>(null);
  const visualLineLayerRef = useRef<HTMLDivElement | null>(null);
  const visualLineContentRef = useRef<HTMLDivElement | null>(null);
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
  // ページの割りと、測り直しが要るかを見分けるための署名。
  const pageBreaksRef = useRef<PageBreaks>({ pages: [], offsets: [] });
  const pageBreaksSignatureRef = useRef("");
  const paragraphFlowRef = useRef<ParagraphFlow | null>(null);
  // 表示中のページが実際に占めるブロック方向の寸法。版面の幅とは限らない。
  const pageVisibleExtentRef = useRef(0);
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
  const showCommentsRef = useRef(showComments);
  const highlightCurrentLineRef = useRef(highlightCurrentLine);
  const manuscriptActive = manuscript.layoutMode === "manuscript";
  const manuscriptRef = useRef(manuscript);
  manuscriptRef.current = manuscript;
  const onManuscriptProgressChangeRef = useRef(onManuscriptProgressChange);
  onManuscriptProgressChangeRef.current = onManuscriptProgressChange;
  const manuscriptProgressRef = useRef<ManuscriptProgress | null>(null);
  const manuscriptBoundaryLayerRef = useRef<HTMLDivElement | null>(null);
  const latinMetricsRef = useRef<LatinRunMetrics | null>(null);
  // 原稿用紙：段落の最終的な行数（ページ表示のページ割りでも使う）と、その更新世代。
  const manuscriptFinalCountRef = useRef<((index: number) => number | undefined) | null>(null);
  const manuscriptCountGenerationRef = useRef(0);
  const applyManuscriptLatinRef = useRef<(() => void) | null>(null);
  const renderLineBreakMarksRef = useRef<(() => void) | null>(null);
  const requestLineBreakMarksRef = useRef<(() => void) | null>(null);
  const renderVisualLinesRef = useRef<(() => void) | null>(null);
  const requestVisualLinesRef = useRef<(() => void) | null>(null);
  const invalidateTextLayoutRef = useRef<(() => void) | null>(null);
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
    let width = Math.max(1, viewportWidth - outerMargin * 2);
    let height = Math.max(1, viewportHeight - outerMargin * 2);
    const verticalWriting = writingModeRef.current === "vertical-rl";
    const gap = 28;
    let paddingX = Math.max(28, Math.min(72, Math.round(width * 0.08)));
    let paddingY = Math.max(28, Math.min(64, Math.round(height * 0.08)));
    let contentWidth = Math.max(1, width - paddingX * 2);
    let contentHeight = Math.max(1, height - paddingY * 2);
    // 原稿用紙では版面を窓ではなく字数×行数で決める。インライン方向は
    // 字数×1ic（＋CSSと同じ1pxの余裕）、ブロック方向は行数×行送り。
    // ページ割りはこのブロック寸法でそのまま行数どおりに切れる。用紙は
    // 従来どおり窓いっぱいに取り（1画面1ページのまま）、版面を中央に置く。
    // 版面が窓に収まらないときだけ用紙を広げる。
    const manuscriptSettings = manuscriptRef.current;
    if (manuscriptSettings.layoutMode === "manuscript") {
      const latin = tiptapRef.current ? astKey.getState(tiptapRef.current.state)?.latin : null;
      const icPx = latin
        ? latin.metrics.icEm(latin.body) * latin.body.fontSize
        : Number.parseFloat(getComputedStyle(root).fontSize) || 16;
      const measure = manuscriptSettings.charactersPerLine * icPx + 1;
      const block = manuscriptSettings.linesPerPage * lineHeightPx(root);
      contentWidth = verticalWriting ? block : measure;
      contentHeight = verticalWriting ? measure : block;
      width = Math.max(width, contentWidth + paddingX * 2);
      height = Math.max(height, contentHeight + paddingY * 2);
      paddingX = (width - contentWidth) / 2;
      paddingY = (height - contentHeight) / 2;
    }
    const nextLayout: PageLayout = {
      width,
      height,
      gap,
      outerMargin,
      paddingX,
      paddingY,
      contentWidth,
      contentHeight,
    };
    surface.style.setProperty("--paged-page-width", `${width}px`);
    surface.style.setProperty("--paged-page-height", `${height}px`);
    surface.style.setProperty("--paged-page-gap", `${gap}px`);
    surface.style.setProperty("--paged-outer-margin", `${outerMargin}px`);
    // ページ送りボタンはシェル直下でスクロール領域の外にあるため、用紙の辺へ
    // 揃えるにはシェル側にも外余白を渡す必要がある。
    shellRef.current?.style.setProperty("--paged-outer-margin", `${outerMargin}px`);
    surface.style.setProperty("--paged-padding-x", `${paddingX}px`);
    surface.style.setProperty("--paged-padding-y", `${paddingY}px`);
    surface.style.setProperty("--paged-content-width", `${contentWidth}px`);
    surface.style.setProperty("--paged-content-height", `${contentHeight}px`);
    const previousLayout = pageLayoutRef.current;
    if (
      previousLayout.width !== width ||
      previousLayout.height !== height ||
      previousLayout.outerMargin !== outerMargin ||
      previousLayout.paddingX !== paddingX ||
      previousLayout.paddingY !== paddingY ||
      previousLayout.contentWidth !== contentWidth ||
      previousLayout.contentHeight !== contentHeight
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

    // ページの割りは自前で持つ。CSS multicol に切ってもらうと、ページの境目に
    // かかる段落のレイアウトが断片に分かれ、ブラウザが OS へ渡すキャレット座標が
    // 最初の断片（＝前のページ）のものになる。IMEの変換候補ウィンドウが前の
    // ページへ出ていたのはこれが原因だった。
    //
    // 行分割はブラウザに任せたまま（禁則・ルビ・縦中横は既存のCSS組版が担当）、
    // 描かれた行数を測って割り付けだけを計算する。段落は断片に分かれないので、
    // ブラウザの座標計算はそのまま正しく働く。
    const pageBlockSize = verticalWriting ? contentWidth : contentHeight;
    const flowExtent = verticalWriting ? root.offsetWidth : root.offsetHeight;
    // 段落ごとの実測は重いので、行数が変わり得たときだけ測り直す。スクロール
    // だけでは割りは変わらない。
    const flow = paragraphFlowRef.current?.flush(writingModeRef.current);
    const breaksSignature = [
      root.childElementCount,
      Math.round(flowExtent),
      Math.round(pageBlockSize),
      verticalWriting ? "v" : "h",
      flow?.generation ?? "legacy",
      manuscriptSettings.layoutMode === "manuscript" ? manuscriptCountGenerationRef.current : "-",
    ].join(":");
    if (breaksSignature !== pageBreaksSignatureRef.current) {
      pageBreaksSignatureRef.current = breaksSignature;
      let paragraphs = flow?.paragraphs ?? measureParagraphs(root, writingModeRef.current);
      // 原稿用紙では、装飾窓の外やキャレット行の段落も最終的な行数で割り付ける。
      // 未訪問のページの有無でページ数が変わらないようにするため。
      const finalCount = manuscriptSettings.layoutMode === "manuscript" ? manuscriptFinalCountRef.current : null;
      if (finalCount) {
        paragraphs = paragraphs.map((paragraph, index) => {
          const count = paragraph.lineCount > 0 ? finalCount(index) : undefined;
          return count === undefined ? paragraph : { ...paragraph, lineCount: count };
        });
      }
      pageBreaksRef.current = computePageBreaks(
        pageBlockSize,
        paragraphs,
      );
      if (import.meta.env.VITE_QA_PAGE_DIAGNOSTICS === "1") {
        const diagnosticRoot = root as HTMLElement & { __pageBreaksHistoryQA?: unknown[] };
        const history = diagnosticRoot.__pageBreaksHistoryQA ??= [];
        const bounds = root.getBoundingClientRect();
        history.push({ signature: breaksSignature, mode: writingModeRef.current, pageBlockSize,
          root: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
          paragraphs, breaks: pageBreaksRef.current });
        if (history.length > 100) history.shift();
      }
    }
    const breaks = pageBreaksRef.current;

    const total = Math.max(1, breaks.pages.length);
    const pageSpan =
      pageFlowDirectionRef.current === "vertical" ? height + gap : width + gap;
    const rawPage =
      pageFlowDirectionRef.current === "vertical"
        ? scroller.scrollTop / pageSpan
        : Math.abs(scroller.scrollLeft) / pageSpan;
    const current = Math.max(1, Math.min(total, Math.round(rawPage) + 1));
    const pageOffset = breaks.offsets[current - 1] ?? 0;
    // ページの最後の行の次の行は、版面の中から始まって外へはみ出す。
    // paginate はまるごと収まる行までを1ページにするので、収まらない次の行の
    // 頭が版面の残り幅へ食い込む。切る位置は版面の幅ではなく、次のページが
    // 始まる位置にしないと、その頭が見切れとして出る。
    const nextOffset = breaks.offsets[current] ?? pageOffset + pageBlockSize;
    const visibleExtent = Math.max(0, Math.min(pageBlockSize, nextOffset - pageOffset));
    pageVisibleExtentRef.current = visibleExtent;
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

    // 本文は版面の外へも伸びているので、ブロック方向はこのページが実際に
    // 占める分だけに切る。原稿用紙の行末では閉じ括弧・句読点が欄外へ
    // ぶら下がるので、インライン終端だけは用紙の余白まで描く。前後ページを
    // 隠す切り抜きと行頭側は変えず、本文・キャレットの位置も動かさない。
    const inlineEndClip = manuscriptSettings.layoutMode === "manuscript"
      ? 0 : verticalWriting ? paddingY : paddingX;
    host.style.setProperty(
      "--paged-clip",
      verticalWriting
        ? `inset(${paddingY}px ${paddingX}px ${inlineEndClip}px ${width - paddingX - visibleExtent}px)`
        : `inset(${paddingY}px ${inlineEndClip}px ${height - paddingY - visibleExtent}px ${paddingX}px)`,
    );

    // 表示するページを出す。transform ではなくレイアウト上の位置で動かす。
    // ブラウザがキャレット座標を計算する経路をそのまま使わせたいので、座標に
    // 後段の変換を挟まない。本文はブロック方向の始端から流れるので、始端を
    // ページのオフセットぶん戻せば、そのページの行が版面へ現れる。
    if (verticalWriting) {
      // 縦書きは右から左へ流れる。始端はページ右端。
      root.style.setProperty("--paged-root-top", `${paddingY}px`);
      root.style.setProperty("--paged-root-right", `${paddingX - pageOffset}px`);
      root.style.setProperty("--paged-root-left", "auto");
      root.style.setProperty("--paged-root-width", "auto");
      root.style.setProperty("--paged-root-height", `${contentHeight}px`);
    } else {
      root.style.setProperty("--paged-root-top", `${paddingY - pageOffset}px`);
      root.style.setProperty("--paged-root-right", "auto");
      root.style.setProperty("--paged-root-left", `${paddingX}px`);
      root.style.setProperty("--paged-root-width", `${contentWidth}px`);
      root.style.setProperty("--paged-root-height", "auto");
    }
    publishPageMetrics({ current, total });
  };

  syncPageMetricsRef.current = syncPageMetrics;

  // ブロック方向の画面座標が属するページ番号（1始まり）。ページの割りは
  // 実測から計算した区間で持っているので、その区間を引く。レイアウト適用後に
  // 呼ぶこと。
  const pageContainingPoint = (blockCoordinate: number): number | null => {
    const host = editorHostRef.current;
    if (!host) return null;
    const layout = pageLayoutRef.current;
    const verticalWriting = writingModeRef.current === "vertical-rl";
    const hostRect = host.getBoundingClientRect();
    // 縦書きは右から左へ流れるので、版面の右端からの距離がブロック方向の位置。
    const distance = verticalWriting
      ? hostRect.right - layout.paddingX - blockCoordinate
      : blockCoordinate - (hostRect.top + layout.paddingY);
    const breaks = pageBreaksRef.current;
    if (breaks.offsets.length === 0) return pageMetricsRef.current.current;
    const flowOffset =
      (breaks.offsets[pageMetricsRef.current.current - 1] ?? 0) + distance;
    // オフセットは単調増加なので、収まる区間の先頭を後ろから探す。
    for (let index = breaks.offsets.length - 1; index >= 0; index -= 1) {
      if (flowOffset >= breaks.offsets[index]) return index + 1;
    }
    return 1;
  };

  const pageContainingPosition = (editor: Editor, pos: number): number | null => {
    const clamped = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    let caret: { left: number; right: number; top: number; bottom: number };
    try {
      caret = editor.view.coordsAtPos(clamped);
    } catch {
      return null;
    }
    // ブロック方向は縦書きなら横、横書きなら縦。
    return pageContainingPoint(
      writingModeRef.current === "vertical-rl"
        ? (caret.left + caret.right) / 2
        : (caret.top + caret.bottom) / 2,
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
        `${root?.style.getPropertyValue("--paged-root-top") ?? ""}:` +
        `${root?.style.getPropertyValue("--paged-root-right") ?? ""}`;
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

  // CSS-locked page roots need not resize when their font or measure changes.
  // Treat layout settings separately from document/selection transactions.
  useEffect(() => {
    invalidateTextLayoutRef.current?.();
  }, [textLayoutSignature, writingMode, editorDisplayMode]);

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

  // コメントの表示切替。畳む行にキャレットがあれば直後（なければ直前）の表示行へ
  // 移し、キャレットの画面位置を保つようスクロールを補正する（勝手に追わない）。
  useEffect(() => {
    if (showCommentsRef.current === showComments) return;
    showCommentsRef.current = showComments;
    const editor = tiptapRef.current;
    if (!editor) return;
    const { view } = editor;
    const caretPoint = () => {
      try {
        return view.coordsAtPos(view.state.selection.head);
      } catch {
        return null;
      }
    };
    const before = caretPoint();
    const tr = view.state.tr
      .setMeta(astKey, { rebuild: true, commentsHidden: !showComments } satisfies AstMeta)
      .setMeta("addToHistory", false);
    const ast = astKey.getState(view.state);
    const group = !showComments && ast ? commentGroupAt(ast.lines, activeLineIndex(view.state)) : null;
    if (group) {
      const { doc } = view.state;
      const forward = group.to < doc.childCount;
      const target = forward ? group.to : group.from - 1;
      const start = pmStartAtIndex(doc, target);
      if (start !== null) {
        const pos = forward ? start + 1 : start + 1 + doc.child(target).content.size;
        tr.setSelection(TextSelection.create(doc, pos));
      }
    }
    view.dispatch(tr);

    const scroller = scrollerRef.current;
    if (editorDisplayModeRef.current === "paged") {
      requestPagedAnchorRestoreRef.current?.();
    } else if (scroller && before) {
      const after = caretPoint();
      if (after) {
        scroller.scrollLeft += after.left - before.left;
        scroller.scrollTop += after.top - before.top;
      }
    }
    requestVisualLinesRef.current?.();
  }, [showComments]);

  // 行番号は全行の実際の組版から番号を振るので、装飾窓の外の段落も記法を
  // 整形した姿で組んでおく（pushLayoutOnlyLineDecos）。原稿用紙の枚数は全文
  // 装飾を要求しない。窓の外で記法を含む段落だけ、隠し要素で整形後の行数を
  // 測って補正する（manuscriptProbe）。
  useEffect(() => {
    showLineNumbersRef.current = showLineNumbers;
    const fullDecorations = showLineNumbers;
    const editor = tiptapRef.current;
    if (editor) {
      const state = astKey.getState(editor.state);
      if (state?.fullDecorations !== fullDecorations) {
        editor.view.dispatch(
          editor.state.tr
            .setMeta(astKey, {
              rebuild: true,
              fullDecorations,
            } satisfies AstMeta)
            .setMeta("addToHistory", false),
        );
      }
    }
    if (fullDecorations || manuscriptActive) {
      requestVisualLinesRef.current?.();
    } else {
      renderVisualLinesRef.current?.();
    }
  }, [showLineNumbers, manuscriptActive]);

  // 欧文ラン揃えはフォント条件を変えたときだけ作り直す。字数・行数の変更では
  // 送り幅（em）が変わらないので計り直さない。
  useEffect(() => {
    applyManuscriptLatinRef.current?.();
  }, [manuscriptActive, textLayoutSignature, writingMode]);

  // 字数・行数の変更は textLayoutSignature に含まれ、レイアウトの測り直しと
  // ページ表示の再分割はそちらで起きる。ここではモードを外したときの通知だけ。
  useEffect(() => {
    if (manuscriptActive) return;
    manuscriptProgressRef.current = null;
    onManuscriptProgressChangeRef.current?.(null);
  }, [manuscriptActive]);

  useEffect(() => {
    requestVisualLinesRef.current?.();
  }, [manuscript.linesPerPage, manuscript.showPageBoundaries]);

  useEffect(() => {
    highlightCurrentLineRef.current = highlightCurrentLine;
    if (highlightCurrentLine) {
      requestVisualLinesRef.current?.();
    } else {
      renderVisualLinesRef.current?.();
    }
  }, [highlightCurrentLine]);

  /**
   * 外から本文へ飛ぶときのフォーカス。Tiptap の focus コマンドは実際の
   * フォーカスを次フレームに回すため、選択を当ててから本当にフォーカスが
   * 移るまでの間、ブラウザ側には移動前の選択が残る。その隙間に
   * タイプライタースクロールやページ送りが走ると、古い選択が状態へ
   * 読み戻されて移動が無かったことになる。ここでは DOM へ直接
   * フォーカスして隙間をなくす。スクロールは呼び出し側が受け持つので
   * preventScroll を付け、タイプライターの動きには触れない。
   */
  const focusEditorForJump = (editor: Editor) => {
    if (editor.view.hasFocus()) return;
    editor.view.dom.focus({ preventScroll: true });
  };

  /**
   * 飛び先を画面に入れる。ページ表示はページ送り、タイプライター中は
   * 基準線へ寄せる。どちらでもないときは ProseMirror に任せる。
   */
  const revealJumpTarget = (editor: Editor, scroller: HTMLElement | null) => {
    if (editorDisplayModeRef.current === "paged") {
      revealSelectionPageRef.current?.(editor);
      return;
    }
    if (scroller && typewriterScrollRef.current) {
      stopCenterAnimationRef.current?.();
      centerCaretForEditor(editor, scroller, typewriterOffsetRef.current, writingModeRef.current);
      return;
    }
    editor.commands.scrollIntoView();
  };

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
      restoreFocus: () => {
        const editor = tiptapRef.current;
        if (!editor || editor.view.hasFocus()) return;
        // DOM の focus() だけだとブラウザがキャレットを本文冒頭の編集可能な
        // 位置へ置き直す。見出し記号の後ろなど文書の真の先頭でない場合は
        // ProseMirror もそれを本物の移動として読み込んでしまう。
        // view.focus() はフォーカスと同時に状態の選択を DOM へ書き戻す。
        editor.view.focus();
      },
      getValue: () => {
        const editor = tiptapRef.current;
        return editor ? editorTextOf(editor.state) : textRef.current;
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

        focusEditorForJump(editor);
        editor.commands.setTextSelection({
          from: pmPosFromTextOffset(editor.state.doc, start),
          to: pmPosFromTextOffset(editor.state.doc, end),
        });
        onSelectionChangeRef.current();
        revealJumpTarget(editor, scroller);
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
        const inserted = normalizeText(insert);
        const next = `${current.slice(0, insertFrom)}${inserted}${current.slice(insertTo)}`;
        const nextCursor = cursorPos ?? insertFrom + inserted.length;

        editor.view.dispatch(replaceTextRangeTransaction(editor.state.tr, insertFrom, insertTo, inserted, nextCursor, current));
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

        focusEditorForJump(editor);
        editor.commands.setTextSelection(pos);
        onSelectionChangeRef.current();
        revealJumpTarget(editor, scroller);
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

        const mode = writingModeRef.current;
        const currentText = docToText(editor.state.doc);

        if (editorDisplayModeRef.current === "paged") {
          // ページ中央が余白や短い最終ページに当たっても null にしない。
          // ページ先頭の本文アンカーを専用経路で取得し、復元側でその所属ページへ戻す。
          syncPageMetricsRef.current?.();
          capturePagedAnchor();
          const anchorPos = pagedAnchorPosRef.current ?? editor.state.selection.head;
          return {
            textLength: currentText.length,
            writingMode: mode,
            anchorOffset: textOffsetFromPmPos(editor.state.doc, anchorPos),
            // ページ表示ではページ番号で復元するため比率は使わないが、保存形式の
            // 共通バリデーションを通せる有限値を維持する。
            anchorRatio: 0.5,
          };
        }

        const scrollerRect = scroller.getBoundingClientRect();
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

    const editorText = editorTextOf(editor.state);
    if (editorText === text) {
      textRef.current = text;
      return;
    }

    if (editorRevision !== null && editorRevision <= localRevisionRef.current) {
      return;
    }

    // 置換などで本文全体が差し替わっても、キャレットは変更箇所に沿って
    // 元の位置へ写す（先頭へ戻さない）。
    const selection = getTextSelection(editor);
    const anchorOffset = selection.head === selection.from ? selection.to : selection.from;
    const nextText = normalizeText(text);
    const anchor = mapTextOffsetThroughChange(editorText, nextText, anchorOffset);
    const head = mapTextOffsetThroughChange(editorText, nextText, selection.head);
    const tr = replaceTextRangeTransaction(editor.state.tr, 0, editorText.length, nextText, head, editorText);
    tr.setSelection(TextSelection.create(tr.doc, pmPosFromTextOffset(tr.doc, anchor), pmPosFromTextOffset(tr.doc, head)));
    editor.view.dispatch(tr);
    textRef.current = nextText;
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
    // What the visible window was last measured against (see requestVisibleWindowAfterEdit).
    let lastVisibleSyncLines = -1;
    let lastVisibleSyncTextLength = -1;
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
    let initialAdjustmentFrame: number | null = null;
    let initialAdjustmentExpiryTimer: number | null = null;
    let initialAdjustmentAllowed = true;
    let lineBreakQueued = false;
    let visualLineQueued = false;
    let lastPagedWheelAt = 0;
    let lastHorizontalPagedWheelAt = 0;
    let visualLayoutRevision = 0;
    const blockVersions = new WeakMap<Element, number>();
    const visualLineIndex = new VisualLineIndex<Element>();
    // 原稿用紙の枚数補正。装飾窓の外で記法を含む段落の、整形後の行数。
    // キーは段落の種類と本文、測ったときのレイアウト条件で無効にする。
    const manuscriptProbeCounts = new Map<string, number>();
    let manuscriptProbeCondition = "";
    // 同じ本文の段落はいくつあっても1回測り、待っている段落すべてに入れる。
    const manuscriptProbeQueue = new Map<string, Set<number>>();
    let manuscriptProbeHandle: number | null = null;
    let manuscriptProbeHost: HTMLElement | null = null;
    const manuscriptProbeKey = (line: LineNode) => `${line.kind}|${line.source}`;
    // QA: how often counts are measured in the hidden copy and the cache is reset.
    const manuscriptProbeStats = { batches: 0, paragraphs: 0, resets: 0 };
    // DOM の段落がどの姿で組まれているか。final は装飾窓の中でキャレットの
    // ない、最終的な姿（その行数をキャッシュに入れる）。
    const manuscriptParagraphState = (element: Element): "final" | "raw" | "active" | null => {
      const classes = element.classList;
      if (classes.length === 0 || element.getAttribute("data-deco") === "layout") return "raw";
      if (classes.contains("active-line")) return "active";
      return classes.contains("pm-line") ? "final" : null;
    };
    // 段落の行数を最終的な行数に揃える。キャッシュがなければ隠し要素で測る
    // 予約をし、測り終えるまで枚数の表示は更新しない。
    const applyManuscriptFinalCount = (index: number, element: Element, line: LineNode) => {
      const state = manuscriptParagraphState(element);
      if (!state) return;
      const key = manuscriptProbeKey(line);
      // 記法のない段落は、キャレットがあっても最終的な姿と同じ装飾で組まれる
      // （pushLineDecos が active で省くのは記号隠しと記法の装飾だけ）。
      // 本文の段落をそのまま測った行数を使い、入力のたびに隠し要素で組み直さない。
      if (state === "final" || (state === "active" && !line.marker && !line.inlineMarkups.length)) {
        const count = visualLineIndex.countAt(index);
        if (count !== null) manuscriptProbeCounts.set(key, count);
        return;
      }
      const cached = manuscriptProbeCounts.get(key);
      if (cached !== undefined) visualLineIndex.setCount(index, cached);
      else {
        const waiting = manuscriptProbeQueue.get(key);
        if (waiting) waiting.add(index);
        else manuscriptProbeQueue.set(key, new Set([index]));
      }
    };
    manuscriptFinalCountRef.current = (index: number) => {
      if (manuscriptRef.current.layoutMode !== "manuscript") return undefined;
      const editor = tiptapRef.current;
      const element = editor?.view.dom.children[index];
      const line = editor ? astKey.getState(editor.state)?.lines[index] : undefined;
      if (!element || !manuscriptCountIsCached(line)) return undefined;
      const state = manuscriptParagraphState(element);
      if (state !== "raw" && state !== "active") return undefined;
      return manuscriptProbeCounts.get(manuscriptProbeKey(line));
    };
    // One Range for every paragraph measurement. A Range stays registered with
    // the document until it is garbage-collected, and every DOM removal walks all
    // registered Ranges: a fresh Range per paragraph (thousands after the first
    // full measurement) made ProseMirror's paragraph replacements (heading jumps,
    // the decoration window moving while typing) take hundreds of ms.
    const fragmentRange = document.createRange();
    const measureVisualBlock = (
      index: number, element: Element, rect: VisualRect, version: number, mode: WritingMode, unnumbered: boolean,
    ) => {
      visualLineIndex.measure(index, rect, version, visualLayoutRevision, mode, unnumbered, () => {
        fragmentRange.selectNodeContents(element);
        // Fragments are read now; express them in the same coordinates as rect.
        const actual = element.getBoundingClientRect();
        const dx = rect.left - actual.left;
        const dy = rect.top - actual.top;
        const fragments = Array.from(fragmentRange.getClientRects(), fragment => ({
          left: fragment.left + dx, right: fragment.right + dx, top: fragment.top + dy, bottom: fragment.bottom + dy,
        }));
        // Do not keep the paragraph's nodes inside a live range between measurements.
        fragmentRange.setStart(document.documentElement, 0);
        fragmentRange.collapse(true);
        return fragments;
      });
    };
    let visualIndexElements: Element[] = [];
    let visualIndexStructureDirty = true;
    let observedVisualState: EditorState | null = null;
    const blockEndCache = new WeakMap<Element, {
      version: number; revision: number; width: number; height: number;
      rect: { left: number; right: number; top: number; bottom: number };
    }>();
    type VisualLayoutCache = {
      doc: PMNode;
      decorations: DecorationSet | undefined;
      mode: WritingMode;
      revision: number;
      root: DOMRect;
      /** 段落の矩形（この layout の座標系）。読んだ段落だけが入る疎な配列。 */
      blockRects: Array<VisualRect | undefined>;
      flowGeneration?: number;
    };
    let visualLayoutCache: VisualLayoutCache | null = null;
    let visualOverlayCache: {
      layout: VisualLayoutCache;
      selection: EditorState["selection"];
      settings: string;
      parentLeft: number;
      parentTop: number;
      pixelRatio: number;
      snapshot: ScrollOverlaySnapshot;
    } | null = null;
    const candidateViewport = initialViewportRef.current;
    const validatedInitialViewport =
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
    // 起動直後はタブ内だけで保持する viewportState がない。ページ表示では
    // typewriter scroll も無効なので、保存済みカーソルを論理アンカーとして
    // 扱わないと第1ページに残ったままになる。セッション中の表示位置があれば
    // そちらを優先し、なければカーソルを含むページへ復元する。
    const initialViewportToRestore =
      validatedInitialViewport ??
      (editorDisplayModeRef.current === "paged" && initialSelectionRef.current > 0
        ? {
            textLength: textRef.current.length,
            writingMode: writingModeRef.current,
            anchorOffset: Math.min(initialSelectionRef.current, textRef.current.length),
            anchorRatio: 0.5,
          }
        : null);
    let initialAdjustmentDeadline = Number.POSITIVE_INFINITY;

    const centerAnimation = createTypewriterScroller({
      requestFrame: (step) => requestAnimationFrame(step),
      cancelFrame: (frame) => cancelAnimationFrame(frame),
      now: () => performance.now(),
      enabled: () => typewriterScrollRef.current && Boolean(tiptapRef.current) &&
        !pointerDraggingRef.current && (!isEditorComposing(tiptapRef.current, composingRef) ||
          Boolean(tiptapRef.current?.view.dom.classList.contains("nativeImeActive"))),
      pixelSize: () => 1 / (window.devicePixelRatio || 1),
      read: () => scrollAxis(writingModeRef.current).get(scroller),
      write: (value) => scrollAxis(writingModeRef.current).set(scroller, value),
      measureTarget: () => {
        const editor = tiptapRef.current;
        if (!editor) return null;
        const mode = writingModeRef.current;
        const delta = measureCenterDelta(editor, scroller, typewriterOffsetRef.current, mode);
        if (delta === null) return null;
        const current = scrollAxis(mode).get(scroller);
        const extent = isHorizontalWriting(mode)
          ? scroller.scrollHeight - scroller.clientHeight
          : scroller.scrollWidth - scroller.clientWidth;
        return isHorizontalWriting(mode)
          ? Math.max(0, Math.min(extent, current + delta))
          : Math.max(-extent, Math.min(0, current + delta));
      },
      onSettled: () => { requestVisibleWindow(); requestLineBreakMarks(); },
    });
    const stopCenterAnimation = () => {
      centerAnimation.stop();
      if (centerFrame !== null) cancelAnimationFrame(centerFrame);
      centerFrame = null;
      centerQueued = false;
      centerInstant = false;
      centerWaitFrames = 1;
    };
    const startCenterAnimation = (inFrame = false) => centerAnimation.request(inFrame);

    startCenterAnimationRef.current = startCenterAnimation;
    stopCenterAnimationRef.current = stopCenterAnimation;

    const syncVisibleWindow = (editor: Editor, currentScroller: HTMLElement): boolean => {
      if (isEditorComposing(editor, composingRef)) return false;
      lastVisibleSyncLines = editor.state.doc.childCount;
      lastVisibleSyncTextLength = docTextLength(editor.state.doc);
      // While following the caret its paragraph is already known. Hit-testing
      // every scroll frame walks the long document and stalls the animation.
      // Manual scrolling still measures the viewport, and settlement verifies it.
      const index = centerAnimation.isRunning() || centerQueued
        ? activeLineIndex(editor.state)
        : estimateVisibleCenterIndex(editor, currentScroller, writingModeRef.current);
      if (index < 0 || Math.abs(index - lastVisibleCenter) < VISIBLE_UPDATE_STEP) return false;

      lastVisibleCenter = index;
      editor.view.dispatch(
        editor.state.tr
          .setMeta(astKey, { visibleCenter: index } satisfies AstMeta)
          .setMeta("addToHistory", false),
      );
      centerAnimation.invalidate();
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

        // ページ表示ではスクロール軸が writingMode ではなく pageFlowDirection で
        // 決まり、位置もページ境界へスナップする。連続表示用のピクセル差分で
        // 戻すと別ページへ丸められるため、アンカーを含むページを直接復元する。
        if (editorDisplayModeRef.current === "paged") {
          syncPageMetricsRef.current?.();
          const anchorPos = pmPosFromTextOffset(
            editor.state.doc,
            initialViewportToRestore.anchorOffset,
          );
          const targetPage = pageContainingPosition(editor, anchorPos);
          if (targetPage !== null) {
            const clampedTarget = Math.max(
              1,
              Math.min(pageMetricsRef.current.total, targetPage),
            );
            const layout = pageLayoutRef.current;
            const expectedOffset =
              (clampedTarget - 1) *
              (pageFlowDirectionRef.current === "vertical"
                ? layout.height + layout.gap
                : layout.width + layout.gap);
            const currentOffset =
              pageFlowDirectionRef.current === "vertical"
                ? currentScroller.scrollTop
                : Math.abs(currentScroller.scrollLeft);

            if (
              pageMetricsRef.current.current !== clampedTarget ||
              Math.abs(currentOffset - expectedOffset) > 1
            ) {
              scrollToPage(clampedTarget, "auto");
            }
          }

          const metrics = pageMetricsRef.current;
          const offset =
            pageFlowDirectionRef.current === "vertical"
              ? currentScroller.scrollTop
              : Math.abs(currentScroller.scrollLeft);
          const signature = `${metrics.current}:${metrics.total}:${Math.round(offset * 2) / 2}`;
          stableFrames = signature === previousExtent ? stableFrames + 1 : 0;
          previousExtent = signature;
          if (
            stableFrames >= INITIAL_CENTER_STABLE_FRAMES ||
            performance.now() >= initialAdjustmentDeadline
          ) {
            requestPagedScrollSettle();
            return;
          }
          initialAdjustmentFrame = requestAnimationFrame(step);
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
      if (!typewriterScrollRef.current || !editor ||
        (isEditorComposing(editor, composingRef) && !editor.view.dom.classList.contains("nativeImeActive"))) return;

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
              // Already inside the frame after the caret moved: start now.
              startCenterAnimation(true);
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

    /*
     * Hit-testing the viewport centre forces layout, which on a long manuscript
     * costs a few milliseconds per keystroke. Scrolling requests a sync from the
     * scroll handler, so an edit only needs one when it can move lines under
     * the viewport by itself: lines added or removed, or a line grown a lot.
     */
    const requestVisibleWindowAfterEdit = () => {
      const doc = tiptapRef.current?.state.doc;
      if (
        doc &&
        doc.childCount === lastVisibleSyncLines &&
        Math.abs(docTextLength(doc) - lastVisibleSyncTextLength) < VISIBLE_SYNC_TEXT_DRIFT
      ) {
        return;
      }
      requestVisibleWindow();
    };

    const renderVisualLines = () => {
      visualLineQueued = false;
      visualLineFrame = null;
      const layer = visualLineLayerRef.current;
      const content = visualLineContentRef.current;
      const currentEditor = tiptapRef.current;
      if (!layer || !content) return;

      const manuscriptSettings = manuscriptRef.current;
      const manuscriptOn = manuscriptSettings.layoutMode === "manuscript";
      const boundaryLayer = manuscriptBoundaryLayerRef.current;
      const layerUpdate = resolveVisualLineLayerUpdate(
        showLineNumbersRef.current || manuscriptOn,
        highlightCurrentLineRef.current,
        Boolean(currentEditor),
        Boolean(currentEditor && isEditorComposing(currentEditor, composingRef)),
      );
      // IME変換中は一時DOMを再計測せず、確定済みの行番号とハイライトを残す。
      if (layerUpdate === "preserve") return;

      if (layerUpdate === "clear" || !currentEditor) {
        if (content.childNodes.length) content.replaceChildren();
        if (boundaryLayer?.childNodes.length) boundaryLayer.replaceChildren();
        visualLayoutCache = null;
        visualOverlayCache = null;
        content.style.transform = "";
        return;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const layerParentRect = layer.parentElement?.getBoundingClientRect();
      const mode = writingModeRef.current;
      const pagedLayout = editorDisplayModeRef.current === "paged";
      const rootRect = currentEditor.view.dom.getBoundingClientRect();
      collectBlockMutations(blockObserver.takeRecords());
      const flow = paragraphFlowRef.current?.flush(mode);
      const decorations = astKey.getState(currentEditor.state)?.decoSet;
      const activeBlockIndex = activeLineIndex(currentEditor.state);
      let layout = visualLayoutCache;
      const pixelRatio = window.devicePixelRatio || 1;
      const overlaySettings = `${showLineNumbersRef.current}|${highlightCurrentLineRef.current}|${manuscriptOn}|${manuscriptSettings.linesPerPage}|${manuscriptSettings.showPageBoundaries}|${manuscriptCountGenerationRef.current}`;
      if (!pagedLayout && layout && visualOverlayCache?.layout === layout &&
        visualOverlayCache.selection === currentEditor.state.selection &&
        visualOverlayCache.settings === overlaySettings &&
        visualOverlayCache.parentLeft === (layerParentRect?.left ?? 0) &&
        visualOverlayCache.parentTop === (layerParentRect?.top ?? 0) &&
        visualOverlayCache.pixelRatio === pixelRatio &&
        layout.doc === currentEditor.state.doc && layout.decorations === decorations &&
        layout.mode === mode && layout.revision === visualLayoutRevision && layout.flowGeneration === flow?.generation) {
        const translation = scrollOverlayTranslation(visualOverlayCache.snapshot, rootRect, scrollerRect, pixelRatio);
        if (translation) {
          // Text and labels have not changed. Move their existing painted layer
          // together instead of rewriting every label and measuring the caret
          // on each frame of typewriter/manual scrolling.
          const transform = `translate(${translation.x}px, ${translation.y}px)`;
          if (content.style.transform !== transform) content.style.transform = transform;
          return;
        }
      }
      if (!layout || layout.doc !== currentEditor.state.doc ||
        layout.decorations !== decorations || layout.mode !== mode ||
        layout.revision !== visualLayoutRevision ||
        layout.flowGeneration !== flow?.generation ||
        Math.abs(layout.root.width - rootRect.width) > 0.05 || Math.abs(layout.root.height - rootRect.height) > 0.05) {
        if (visualIndexStructureDirty || visualIndexElements.length !== currentEditor.view.dom.childElementCount) {
          visualIndexElements = Array.from(currentEditor.view.dom.children);
          visualLineIndex.reset(visualIndexElements);
          visualIndexStructureDirty = false;
        }
        // Only paragraphs whose DOM changed (or every paragraph after a layout
        // revision) are measured; their shapes are paragraph-local, so an
        // earlier paragraph moving them needs no re-read. Reading every
        // paragraph's rect here cost ~10 ms per keystroke on a 100k-char
        // manuscript (line numbers / manuscript mode). Visible paragraphs are
        // read below and re-checked against their cached size.
        const blockRects: Array<VisualRect | undefined> = new Array(visualIndexElements.length);
        // 原稿用紙：段落は最終的な行数（manuscriptCountIsCached）で数える。
        const probeLines = manuscriptOn ? astKey.getState(currentEditor.state)?.lines : undefined;
        const condition = `${visualLayoutRevision}|${mode}|${manuscriptSettings.charactersPerLine}`;
        if (probeLines && condition !== manuscriptProbeCondition) {
          manuscriptProbeCondition = condition;
          manuscriptProbeCounts.clear();
          manuscriptProbeQueue.clear();
          manuscriptProbeStats.resets++;
        }
        visualIndexElements.forEach((element, index) => {
          const version = flow?.versions[index] ?? blockVersions.get(element) ?? 0;
          const unnumbered = element.classList.contains("pm-comment");
          const current = visualLineIndex.isCurrent(index, version, visualLayoutRevision, mode, unnumbered);
          if (current) return;
          const probeLine = probeLines?.[index];
          const cached = manuscriptCountIsCached(probeLine) ? probeLine : undefined;
          // Undecorated paragraphs with a known final count are not read at all.
          if (cached && manuscriptParagraphState(element) === "raw") {
            const count = manuscriptProbeCounts.get(manuscriptProbeKey(cached));
            if (count !== undefined) {
              visualLineIndex.assignCount(index, count, version, visualLayoutRevision, mode, unnumbered);
              return;
            }
          }
          const rect = flow?.blocks[index] ?? element.getBoundingClientRect();
          blockRects[index] = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          measureVisualBlock(index, element, blockRects[index]!, version, mode, unnumbered);
          if (cached) applyManuscriptFinalCount(index, element, cached);
        });
        if (manuscriptProbeQueue.size) scheduleManuscriptProbe();
        layout = {
          doc: currentEditor.state.doc, decorations, mode, revision: visualLayoutRevision,
          root: rootRect, blockRects,
          flowGeneration: flow?.generation,
        };
        visualLayoutCache = layout;
      }
      // Translate the viewport into the cached coordinate system. Materialize
      // bands only for visible paragraphs and the caret; prefix sums supply the
      // exact global number even after a distant split/join or hidden comment.
      const { blockRects } = layout;
      const dx = rootRect.left - layout.root.left;
      const dy = rootRect.top - layout.root.top;
      const viewport = {
        left: scrollerRect.left - dx, right: scrollerRect.right - dx,
        top: scrollerRect.top - dy, bottom: scrollerRect.bottom - dy,
      };
      const vertical = !isHorizontalWriting(mode);
      const overscan = pagedLayout ? 0 : Math.min(
        vertical ? scrollerRect.width : scrollerRect.height,
        Math.max(64, lineHeightPx(currentEditor.view.dom) * 2),
      );
      const coverage = {
        left: scrollerRect.left - (vertical ? overscan : 0), right: scrollerRect.right + (vertical ? overscan : 0),
        top: scrollerRect.top - (vertical ? 0 : overscan), bottom: scrollerRect.bottom + (vertical ? 0 : overscan),
      };
      const bandViewport = { left: coverage.left - dx, right: coverage.right - dx,
        top: coverage.top - dy, bottom: coverage.bottom - dy };
      // Rects read now are in today's coordinates; store them in the layout's.
      const rectAt = (index: number): VisualRect | undefined => {
        const cached = blockRects[index];
        if (cached) return cached;
        const element = visualIndexElements[index];
        if (!element) return undefined;
        const rect = flow?.blocks[index] ?? element.getBoundingClientRect();
        const translated = { left: rect.left - dx, right: rect.right - dx, top: rect.top - dy, bottom: rect.bottom - dy };
        blockRects[index] = translated;
        // A visible paragraph whose size changed without a DOM mutation (late
        // font metrics) is re-measured here; measure() skips unchanged shapes.
        const version = flow?.versions[index] ?? blockVersions.get(element) ?? 0;
        measureVisualBlock(index, element, translated, version, mode, element.classList.contains("pm-comment"));
        const probeLine = manuscriptOn ? astKey.getState(currentEditor.state)?.lines[index] : undefined;
        if (manuscriptCountIsCached(probeLine)) applyManuscriptFinalCount(index, element, probeLine);
        return translated;
      };
      const bands: VisualLineBand[] = [];
      const pushBands = (index: number) => {
        const rect = rectAt(index);
        if (rect) bands.push(...visualLineIndex.bandsAt(index, rect));
      };
      // Paragraphs are stacked in the block direction, so the ones near the
      // viewport are found by binary search instead of reading every rect.
      // Keep a few extra lines prepared for scrolling and glyph overhang.
      // Paged layouts retain their wider search for fragmented/overflowing bands.
      const blockSpan = vertical ? viewport.right - viewport.left : viewport.bottom - viewport.top;
      const lookupOverscan = pagedLayout ? blockSpan : overscan;
      const near = (rect: VisualRect) => vertical
        ? rect.right >= viewport.left - lookupOverscan && rect.left <= viewport.right + lookupOverscan
        : rect.bottom >= viewport.top - lookupOverscan && rect.top <= viewport.bottom + lookupOverscan;
      // Has the paragraph's block end not yet reached the window's start?
      const before = (rect: VisualRect) => vertical
        ? rect.left > viewport.right + lookupOverscan
        : rect.bottom < viewport.top - lookupOverscan;
      const hidden = (rect: VisualRect) => rect.right - rect.left === 0 && rect.bottom - rect.top === 0;
      const count = visualIndexElements.length;
      let low = 0;
      let high = count;
      while (low < high) {
        const middle = (low + high) >> 1;
        // display:none paragraphs (folded comments) report an empty rect at the
        // origin; probe the next painted one instead.
        let probe = middle;
        let rect = rectAt(probe);
        while (rect && hidden(rect) && probe + 1 < high) rect = rectAt(++probe);
        if (!rect || hidden(rect)) { high = middle; continue; }
        if (before(rect)) low = probe + 1;
        else high = middle;
      }
      // The caret's line is only needed to highlight it or its number. With
      // manuscript mode alone (page boundaries) the caret measurements below
      // would be three extra forced coordinate reads per frame.
      const needsActiveBand = showLineNumbersRef.current || highlightCurrentLineRef.current;
      let activeIncluded = false;
      for (let i = low; i < count; i += 1) {
        const rect = rectAt(i);
        if (!rect) break;
        if (hidden(rect)) continue;
        if (!near(rect)) break;
        if ((needsActiveBand && i === activeBlockIndex) || visualLineIndex.intersects(i, rect, bandViewport)) {
          pushBands(i);
          if (i === activeBlockIndex) activeIncluded = true;
        }
      }
      if (needsActiveBand && !activeIncluded && activeBlockIndex >= 0 && activeBlockIndex < count) pushBands(activeBlockIndex);
      let caretX = 0;
      let caretY = 0;
      let affinityPoint: { x: number; y: number } | null = null;
      if (needsActiveBand) try {
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
        const activeRect = rectAt(activeBlockIndex);
        caretX = activeRect ? (activeRect.left + activeRect.right) / 2 : 0;
        caretY = activeRect ? (activeRect.top + activeRect.bottom) / 2 : 0;
      }
      const activeBand = needsActiveBand && findClosestVisualLineBand(
        bands,
        activeBlockIndex,
        caretX - dx,
        caretY - dy,
        affinityPoint ? { x: affinityPoint.x - dx, y: affinityPoint.y - dy } : null,
      );
      const fragment = document.createDocumentFragment();

      if (highlightCurrentLineRef.current && activeBand) {
        const highlight = document.createElement("div");
        highlight.className = "activeVisualLineHighlight";
        highlight.dataset.visualLineNumber = String(activeBand.number);
        highlight.style.left = `${snapScrollValue(activeBand.left + dx - scrollerRect.left)}px`;
        highlight.style.top = `${snapScrollValue(activeBand.top + dy - scrollerRect.top)}px`;
        highlight.style.width = `${snapScrollValue(activeBand.right - activeBand.left)}px`;
        highlight.style.height = `${snapScrollValue(activeBand.bottom - activeBand.top)}px`;
        fragment.appendChild(highlight);
      }

      // 原稿用紙の枚数は物理行の総数から出す。総数は段落ごとの行数の
      // 先頭和（Fenwick木）なので、全文を数え直さない。
      const totalLines = visualLineIndex.totalCount();
      // 最終的な行数がまだ分からない段落があれば、途中の値は出さない。
      const manuscriptPending = manuscriptProbeQueue.size > 0 || manuscriptProbeHandle !== null;
      if (manuscriptOn && !manuscriptPending) {
        const progress = manuscriptProgress(totalLines, manuscriptSettings.linesPerPage);
        const previous = manuscriptProgressRef.current;
        if (!previous || previous.fullPages !== progress.fullPages ||
          previous.usedLinesOnCurrentPage !== progress.usedLinesOnCurrentPage ||
          previous.linesPerPage !== progress.linesPerPage) {
          manuscriptProgressRef.current = progress;
          onManuscriptProgressChangeRef.current?.(progress);
        }
      }

      // ページ境界。本文には余白も要素も足さず、見えている行のうち
      // linesPerPage の倍数の行の後ろへ線を引く。連続表示だけで出す
      // （ページ表示ではページそのものが境界になる）。
      // 境界の層は本文と一緒にスクロールする枠（.verticalTypewriterEditor）の
      // 中にあり、座標も枠に対する位置で置く。スクロールしても書き換えない。
      // 画面に重ねた層へ描くと、タイプライタースクロールの毎フレーム位置を
      // 書き換えることになり、1キーあたり十数msかかっていた。
      const boundaryFragment = document.createDocumentFragment();
      const boundaryHost = editorHostRef.current;
      if (manuscriptOn && manuscriptSettings.showPageBoundaries && !pagedLayout && boundaryLayer && boundaryHost) {
        const hostRect = boundaryHost.getBoundingClientRect();
        const pitch = lineHeightPx(currentEditor.view.dom);
        const vertical = !isHorizontalWriting(mode);
        for (const band of bands) {
          if (!endsManuscriptPage(band.number, manuscriptSettings.linesPerPage, totalLines)) continue;
          const blockRect = rectAt(band.blockIndex);
          if (!blockRect) continue;
          const page = band.number / manuscriptSettings.linesPerPage;
          const boundary = document.createElement("div");
          boundary.className = "manuscriptPageBoundary";
          boundary.dataset.manuscriptPage = String(page);
          boundary.dataset.axis = vertical ? "vertical" : "horizontal";
          if (vertical) {
            boundary.style.left = `${snapScrollValue(band.centerX - pitch / 2 + dx - hostRect.left)}px`;
            boundary.style.top = `${snapScrollValue(blockRect.top + dy - hostRect.top)}px`;
            boundary.style.height = `${snapScrollValue(blockRect.bottom - blockRect.top)}px`;
          } else {
            boundary.style.top = `${snapScrollValue(band.centerY + pitch / 2 + dy - hostRect.top)}px`;
            boundary.style.left = `${snapScrollValue(blockRect.left + dx - hostRect.left)}px`;
            boundary.style.width = `${snapScrollValue(blockRect.right - blockRect.left)}px`;
          }
          const label = document.createElement("span");
          label.className = "manuscriptPageBoundaryLabel";
          label.textContent = `${page}ページ終了 / ${page + 1}ページ開始`;
          boundary.appendChild(label);
          boundaryFragment.appendChild(boundary);
        }
      }

      if (showLineNumbersRef.current) {
        for (const band of bands) {
          if (
            band.right + dx < coverage.left ||
            band.left + dx > coverage.right ||
            band.bottom + dy < coverage.top ||
            band.top + dy > coverage.bottom
          ) {
            continue;
          }

          const blockRect = rectAt(band.blockIndex);
          if (!blockRect || band.number === 0) continue;
          const number = document.createElement("span");
          number.className = `visibleLineNumber${
            activeBand === band ? " active" : ""
          }`;
          number.dataset.visualLineNumber = String(band.number);
          number.textContent = String(band.number);
          if (isHorizontalWriting(mode)) {
            number.style.left = `${snapScrollValue(
              (pagedLayout ? band.left : blockRect.left) + dx - scrollerRect.left - 10,
            )}px`;
            number.style.top = `${snapScrollValue(band.centerY + dy - scrollerRect.top)}px`;
          } else {
            number.style.left = `${snapScrollValue(band.centerX + dx - scrollerRect.left)}px`;
            number.style.top = `${snapScrollValue(
              (pagedLayout ? band.top : blockRect.top) + dy -
                scrollerRect.top -
                VERTICAL_LINE_NUMBER_TOP_OFFSET_PX,
            )}px`;
          }
          fragment.appendChild(number);
        }
      }

      // Finish geometry reads before changing the overlay DOM/styles.
      layer.style.left = `${snapScrollValue(scrollerRect.left - (layerParentRect?.left ?? 0))}px`;
      layer.style.top = `${snapScrollValue(scrollerRect.top - (layerParentRect?.top ?? 0))}px`;
      layer.style.width = `${snapScrollValue(scrollerRect.width)}px`;
      layer.style.height = `${snapScrollValue(scrollerRect.height)}px`;
      clipLayerToTextBlock(layer, scrollerRect);
      content.style.transform = "";
      syncOverlayElements(content, fragment);
      if (boundaryLayer) syncOverlayElements(boundaryLayer, boundaryFragment);
      visualOverlayCache = pagedLayout || overscan < 48 ? null : {
        layout, selection: currentEditor.state.selection, settings: overlaySettings,
        parentLeft: layerParentRect?.left ?? 0, parentTop: layerParentRect?.top ?? 0,
        pixelRatio,
        // Retain half the overscan as a guard for label/glyph overhang at the
        // edge. Rebuild before the viewport can reach the prepared labels' end.
        snapshot: { root: rootRect, viewport: scrollerRect, coverage: {
          left: scrollerRect.left - (vertical ? overscan / 2 : 0),
          right: scrollerRect.right + (vertical ? overscan / 2 : 0),
          top: scrollerRect.top - (vertical ? 0 : overscan / 2),
          bottom: scrollerRect.bottom + (vertical ? 0 : overscan / 2),
        } },
      };
    };

    // 隠し要素は本文の外（シェル直下）に置き、本文と同じ CSS が当たるよう
    // .verticalTypewriterEditor > .pm-root の形にする。版面の字詰めは
    // --ms-measure で決まり、窓の寸法には依存しない。
    const manuscriptProbeRoot = (): HTMLElement | null => {
      const shell = shellRef.current;
      if (!shell) return null;
      if (!manuscriptProbeHost?.isConnected) {
        manuscriptProbeHost = document.createElement("div");
        manuscriptProbeHost.className = "verticalTypewriterEditor manuscriptLineProbe";
        manuscriptProbeHost.setAttribute("aria-hidden", "true");
        manuscriptProbeHost.style.cssText = "position:absolute;inset:0;width:auto;height:auto;min-width:0;" +
          "visibility:hidden;pointer-events:none;overflow:hidden;contain:strict;z-index:-1;transform:none;clip-path:none;";
        const root = document.createElement("div");
        root.className = "pm-root";
        root.style.cssText = "position:absolute;top:0;left:0;right:auto;margin:0;padding:0;min-width:0;min-height:0;" +
          "max-width:none;max-height:none;width:auto;height:auto;inline-size:var(--ms-measure);block-size:auto;";
        manuscriptProbeHost.appendChild(root);
        shell.appendChild(manuscriptProbeHost);
      }
      return manuscriptProbeHost.firstElementChild as HTMLElement;
    };

    const runManuscriptProbe = (deadline?: IdleDeadline) => {
      manuscriptProbeHandle = null;
      const editor = tiptapRef.current;
      if (!editor || manuscriptRef.current.layoutMode !== "manuscript" || !manuscriptProbeQueue.size) return;
      if (isEditorComposing(editor, composingRef)) { scheduleManuscriptProbe(); return; }
      const ast = astKey.getState(editor.state);
      const root = manuscriptProbeRoot();
      if (!ast || !root) return;
      const { doc } = editor.state;
      const batch: Array<{ key: string; indices: number[]; paragraph: HTMLParagraphElement }> = [];
      const started = performance.now();
      // 未計測の欧文ランは1回のレイアウトでまとめて測る。
      if (ast.latin) {
        const ranges = [...manuscriptProbeQueue.values()].flatMap((indices) => [...indices].map((index) => ({ from: index, to: index + 1 })));
        prepareManuscriptLatin(ast.lines, ranges, ast.latin);
      }
      for (const [key, waiting] of manuscriptProbeQueue) {
        manuscriptProbeQueue.delete(key);
        const indices = [...waiting].filter((index) => {
          const line = ast.lines[index];
          return index < doc.childCount && line !== undefined && manuscriptProbeKey(line) === key;
        });
        if (!indices.length) continue;
        batch.push({ key, indices, paragraph: buildManuscriptProbeParagraph(ast.lines, indices[0], doc.child(indices[0]), ast.latin) });
        if (batch.length >= 200 || (deadline ? deadline.timeRemaining() < 2 : performance.now() - started > 6)) break;
      }
      if (!batch.length) return;
      manuscriptProbeStats.batches++;
      manuscriptProbeStats.paragraphs += batch.length;
      root.replaceChildren(...batch.map((item) => item.paragraph));
      const vertical = !isHorizontalWriting(writingModeRef.current);
      const pitch = lineHeightPx(root);
      const counts = batch.map((item) => {
        const rect = item.paragraph.getBoundingClientRect();
        const size = vertical ? rect.width : rect.height;
        return pitch > 0 ? Math.max(1, Math.round(size / pitch)) : 1;
      });
      root.replaceChildren();
      // Apply each result to its own paragraph only; the rest of the index is
      // untouched (no pass over every paragraph per keystroke).
      const children = editor.view.dom.children;
      batch.forEach((item, i) => {
        manuscriptProbeCounts.set(item.key, counts[i]);
        for (const index of item.indices) {
          const element = children[index];
          const state = element ? manuscriptParagraphState(element) : null;
          if ((state === "raw" || state === "active") && visualIndexElements[index] === element) {
            visualLineIndex.setCount(index, counts[i]);
          }
        }
      });
      manuscriptCountGenerationRef.current += 1;
      requestVisualLines();
      if (manuscriptProbeQueue.size) scheduleManuscriptProbe();
      else if (editorDisplayModeRef.current === "paged") requestAnimationFrame(() => syncPageMetricsRef.current?.());
    };

    const scheduleManuscriptProbe = () => {
      if (manuscriptProbeHandle !== null) return;
      manuscriptProbeHandle = typeof requestIdleCallback === "function"
        ? requestIdleCallback(runManuscriptProbe, { timeout: 1000 })
        : window.setTimeout(() => runManuscriptProbe(), 50);
    };

    const requestVisualLines = () => {
      if (visualLineQueued) return;
      visualLineQueued = true;
      visualLineFrame = requestAnimationFrame(renderVisualLines);
    };

    // ページ表示では本文を1つの流れのまま置いて表示ページの位置へずらすので、
    // 版面の外にも前後のページの行が存在する。行番号や折返し記号の層はスクロール
    // 領域いっぱいに置いてあるため、切らないと前後のページの行に対する印まで出る。
    //
    // 切るのはブロック方向（行が並ぶ向き）だけにする。行番号は版面の外側の余白へ
    // 出す作りなので、四辺で切ると番号そのものが消える。
    const clipLayerToTextBlock = (layer: HTMLElement, scrollerRect: DOMRect) => {
      const pageHost = editorHostRef.current;
      if (editorDisplayModeRef.current !== "paged" || !pageHost) {
        layer.style.clipPath = "";
        return;
      }
      const layout = pageLayoutRef.current;
      const hostRect = pageHost.getBoundingClientRect();
      const extent = pageVisibleExtentRef.current || layout.contentWidth;
      if (writingModeRef.current === "vertical-rl") {
        const right = scrollerRect.right - (hostRect.right - layout.paddingX);
        const left = scrollerRect.width - right - extent;
        layer.style.clipPath = `inset(0px ${right}px 0px ${left}px)`;
        return;
      }
      const top = hostRect.top + layout.paddingY - scrollerRect.top;
      const bottom = scrollerRect.height - top - (pageVisibleExtentRef.current || layout.contentHeight);
      layer.style.clipPath = `inset(${top}px 0px ${bottom}px 0px)`;
    };

    const renderLineBreakMarks = () => {
      lineBreakQueued = false;
      lineBreakFrame = null;
      const layer = lineBreakLayerRef.current;
      const currentEditor = tiptapRef.current;
      if (!layer) return;

      if (
        !showLineBreakMarksRef.current ||
        !currentEditor ||
        isEditorComposing(currentEditor, composingRef)
      ) {
        if (layer.childNodes.length) layer.replaceChildren();
        return;
      }

      const state = astKey.getState(currentEditor.state);
      if (!state) return;

      collectBlockMutations(blockObserver.takeRecords());
      const scrollerRect = scroller.getBoundingClientRect();
      const layerParentRect = layer.parentElement?.getBoundingClientRect();
      const mode = writingModeRef.current;
      const estimatedCenter = centerAnimation.isRunning() || centerQueued
        ? activeLineIndex(currentEditor.state)
        : estimateVisibleCenterIndex(currentEditor, scroller, mode);
      const visibleCenter = estimatedCenter >= 0 ? estimatedCenter : state.visibleCenter;
      const activeIndex = activeLineIndex(currentEditor.state);
      const fragment = document.createDocumentFragment();

      for (const range of decorationRange(state.activeIndex, state.lines.length, visibleCenter)) {
        const to = Math.min(range.to, state.lines.length, currentEditor.state.doc.childCount);

        for (let index = range.from; index < to; index += 1) {
          const line = state.lines[index];
          if (!line) continue;

          const element = currentEditor.view.dom.children[index];
          if (!element) continue;
          const bounds = element.getBoundingClientRect();
          const version = blockVersions.get(element) ?? 0;
          let cached = blockEndCache.get(element);
          if (!cached || cached.version !== version || cached.revision !== visualLayoutRevision ||
            Math.abs(cached.width - bounds.width) > 0.05 || Math.abs(cached.height - bounds.height) > 0.05) {
            const measured = paragraphEndRect(currentEditor, index, mode);
            if (!measured) continue;
            cached = {
              version, revision: visualLayoutRevision, width: bounds.width, height: bounds.height,
              rect: { left: measured.left - bounds.left, right: measured.right - bounds.left,
                top: measured.top - bounds.top, bottom: measured.bottom - bounds.top },
            };
            blockEndCache.set(element, cached);
          }
          const rect = { left: cached.rect.left + bounds.left, right: cached.rect.right + bounds.left,
            top: cached.rect.top + bounds.top, bottom: cached.rect.bottom + bounds.top };

          // 連続表示でも画面外の記号を作り直す必要はない。
          // スクロール領域（マーク描画余白24px込み）内だけ描画する。
          if (
            (rect.right < scrollerRect.left - 24 ||
              rect.left > scrollerRect.right + 24 ||
              rect.bottom < scrollerRect.top - 24 ||
              rect.top > scrollerRect.bottom + 24)
          ) {
            continue;
          }

          const mark = document.createElement("span");
          mark.dataset.blockIndex = String(index);
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

      layer.style.left = `${snapScrollValue(scrollerRect.left - (layerParentRect?.left ?? 0))}px`;
      layer.style.top = `${snapScrollValue(scrollerRect.top - (layerParentRect?.top ?? 0))}px`;
      layer.style.width = `${snapScrollValue(scrollerRect.width)}px`;
      layer.style.height = `${snapScrollValue(scrollerRect.height)}px`;
      clipLayerToTextBlock(layer, scrollerRect);
      syncOverlayElements(layer, fragment);
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

    // 改行・削除・IME確定の後は、ページ割りを取り直してからキャレットの
    // ページへ移る。総ページ数が増えるとReactのページ面の追加が1フレーム
    // 遅れ、その間は新しいページへスクロールできず手前へ丸められる。そこで
    // 何かが動いたフレームの次だけもう一度確かめ、何も動かなければ終える。
    // （以前は2フレーム続けて同じになるまで毎回最低3フレーム同期していた。
    // CSS multicol の再分割を待っていた頃の名残。）
    const requestPagedSelectionAfterReflow = (currentEditor: Editor) => {
      if (editorDisplayModeRef.current !== "paged") return;
      pagedReflowGeneration += 1;
      const generation = pagedReflowGeneration;
      if (pagedReflowFrame !== null) cancelAnimationFrame(pagedReflowFrame);

      const signature = () => {
        const currentScroller = scrollerRef.current;
        const metrics = pageMetricsRef.current;
        return currentScroller
          ? `${currentEditor.state.selection.head}:${metrics.current}:${metrics.total}:` +
            `${currentScroller.scrollLeft}:${currentScroller.scrollTop}:` +
            `${currentScroller.scrollWidth}:${currentScroller.scrollHeight}`
          : "missing";
      };
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

        // 寸法の読み取りはこのフレームの同期でどのみち必要になるので、
        // 入力ハンドラ側では読まず、ここで前後を比べる。
        const initial = signature();
        syncPageMetricsRef.current?.();
        const beforeReveal = signature();
        revealSelectionPageNow(currentEditor);
        // ページを移ったときだけ、移った先のページ位置を反映し直す。
        if (signature() !== beforeReveal) syncPageMetricsRef.current?.();
        requestVisibleWindow();
        requestLineBreakMarks();

        remainingFrames -= 1;
        if (signature() === initial || remainingFrames <= 0) return;
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
        // ProseMirror's immediate reveal must not race the typewriter animation.
        // During IME composition the browser retains its native caret reveal.
        handleScrollToSelection: (view) => typewriterScrollRef.current &&
          view.state.selection.empty && !pointerDraggingRef.current &&
          !isEditorComposing(tiptapRef.current, composingRef),
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
      onTransaction: ({ editor: currentEditor, transaction }) => {
        const next = currentEditor.state;
        const previous = observedVisualState;
        observedVisualState = next;
        if (!previous || previous.doc === next.doc) return;
        const diff = previous.doc === transaction.before && next.doc === transaction.doc
          ? lineDiffFromSelectionTransaction(transaction, previous, next) ?? diffTopLevelNodes(previous.doc, next.doc)
          : diffTopLevelNodes(previous.doc, next.doc);
        // Use the transaction for text invalidation even when a command suppresses
        // onUpdate. DOM mutations separately cover derived decoration changes.
        for (let index = diff.from; index < diff.toNew; index += 1) {
          const element = currentEditor.view.dom.children[index];
          if (element) {
            blockVersions.set(element, (blockVersions.get(element) ?? 0) + 1);
            paragraphFlowRef.current?.mark(element);
          }
        }
        visualLayoutCache = null;
        requestLineBreakMarks();
      },
      onUpdate: ({ editor: currentEditor }) => {
        cancelInitialAdjustment();
        const astState = astKey.getState(currentEditor.state);
        const next = astState?.text ?? docToText(currentEditor.state.doc);
        // The AST's splice describes this update only if it was applied to
        // the text the caller saw last (one transaction since then).
        const change = astState?.change && astState.change.base === textRef.current && astState.text === next
          ? { from: astState.change.from, to: astState.change.to, insert: astState.change.insert }
          : null;
        updateEmptyAttribute(currentEditor, next);
        textRef.current = next;
        const nextRevision = ++localRevisionRef.current;
        onTextChangeRef.current(next, nextRevision, change);
        onSelectionChangeRef.current();
        if (!isEditorComposing(currentEditor, composingRef)) {
          requestCenterCaret(false, "update");
          requestPagedSelectionAfterReflow(currentEditor);
        }
        requestVisibleWindowAfterEdit();
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
        requestVisibleWindowAfterEdit();
        requestLineBreakMarks();
      },
    });

    tiptapRef.current = editor;
    observedVisualState = editor.state;
    hideSelectionFromReact(editor.view.dom);
    if (showLineNumbersRef.current || !showCommentsRef.current) {
      editor.view.dispatch(
        editor.state.tr
          .setMeta(astKey, {
            rebuild: true,
            fullDecorations: showLineNumbersRef.current,
            commentsHidden: !showCommentsRef.current,
          } satisfies AstMeta)
          .setMeta("addToHistory", false),
      );
    }
    updateEmptyAttribute(editor);

    // 欧文ランの計測条件。本文rootの実際の computed style から取るので、
    // フォント設定・見出しフォントの指定がそのまま反映される。
    const applyManuscriptLatin = () => {
      const current = tiptapRef.current;
      if (!current) return;
      const active = manuscriptRef.current.layoutMode === "manuscript";
      let latin: ManuscriptLatinContext | null = null;
      if (active) {
        const style = getComputedStyle(current.view.dom);
        const headingFamily = style.getPropertyValue("--editor-heading-font-family").trim() || style.fontFamily;
        const metrics = latinMetricsRef.current ??= new LatinRunMetrics(shellRef.current);
        const common = {
          fontSize: Number.parseFloat(style.fontSize) || 16,
          fontStyle: style.fontStyle,
          writingMode: style.writingMode === "horizontal-tb" ? "horizontal-tb" as const : "vertical-rl" as const,
        };
        latin = {
          metrics,
          body: { ...common, fontFamily: style.fontFamily, fontWeight: style.fontWeight },
          heading: { ...common, fontFamily: headingFamily, fontWeight: "600" },
        };
        const previous = astKey.getState(current.state)?.latin;
        const same = (a: ManuscriptFontKey, b: ManuscriptFontKey) =>
          a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.fontWeight === b.fontWeight &&
          a.fontStyle === b.fontStyle && a.writingMode === b.writingMode;
        if (previous && same(previous.body, latin.body) && same(previous.heading, latin.heading)) return;
      } else if (!astKey.getState(current.state)?.latin) {
        return;
      }
      current.view.dispatch(
        current.state.tr.setMeta(astKey, { latin } satisfies AstMeta).setMeta("addToHistory", false),
      );
    };
    applyManuscriptLatinRef.current = applyManuscriptLatin;
    applyManuscriptLatin();
    // Web フォントの読み込みが終わると送り幅が変わる。段落のDOMは変わらないので
    // 行の形のキャッシュは自分では気づけない。測り直しを指示し、欧文ランの
    // 古い幅も捨てる。
    const handleFontsLoaded = () => {
      invalidateTextLayoutRef.current?.();
      const current = tiptapRef.current;
      if (!current || !astKey.getState(current.state)?.latin) return;
      latinMetricsRef.current?.clear();
      const latin = astKey.getState(current.state)!.latin!;
      current.view.dispatch(
        current.state.tr.setMeta(astKey, { latin: { ...latin } } satisfies AstMeta).setMeta("addToHistory", false),
      );
    };
    document.fonts?.addEventListener("loadingdone", handleFontsLoaded);

    // Retain geometry for unchanged paragraphs, including when inserting a
    // newline shifts every subsequent paragraph. Only DOM changes/reflow can
    // invalidate the fragments inside a paragraph; scrolling just translates it.
    const collectBlockMutations = (records: MutationRecord[]) => {
      let changed = false;
      for (const record of records) {
        // ProseMirror reapplies equal decoration attributes on unchanged
        // paragraphs. Those MutationRecords do not change their geometry.
        if (record.type === "attributes" && record.target instanceof Element &&
          record.oldValue === record.target.getAttribute(record.attributeName!)) continue;
        changed = true;
        if (record.target === editor.view.dom) {
          if (record.type === "childList") visualIndexStructureDirty = true;
          if (record.type === "attributes" && (record.attributeName === "style" || record.attributeName === "class")) {
            // A new revision discards every paragraph's cached line shapes and
            // (manuscript mode) line counts, i.e. re-measures the whole text.
            // Focus classes and the paged root's position do not change how
            // paragraphs are typeset; on a 100k-char manuscript treating them
            // as a relayout froze heading jumps and page turns for seconds.
            if (!paragraphFlowRef.current && rootTypesettingChanged(record)) visualLayoutRevision += 1;
            centerAnimation.invalidate();
            if (record.attributeName === "style") requestCenterCaret(false, "resize");
          }
        } else {
          let element = record.target instanceof Element ? record.target : record.target.parentElement;
          while (element && element.parentElement !== editor.view.dom) element = element.parentElement;
          if (element) blockVersions.set(element, (blockVersions.get(element) ?? 0) + 1);
        }
      }
      if (changed) {
        visualLayoutCache = null;
        requestLineBreakMarks();
      }
    };
    const blockObserver = new MutationObserver(collectBlockMutations);
    blockObserver.observe(editor.view.dom, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    const layoutSignature = () => {
      const style = getComputedStyle(editor.view.dom);
      return `${scroller.clientWidth}:${scroller.clientHeight}:${style.font}:${style.lineHeight}:${style.letterSpacing}:${style.writingMode}`;
    };
    let lastLayoutSignature = layoutSignature();
    const invalidateTextLayout = () => {
      visualLayoutRevision += 1;
      paragraphFlowRef.current?.invalidate();
      visualLayoutCache = null;
      centerAnimation.invalidate();
      requestLineBreakMarks();
    };
    invalidateTextLayoutRef.current = invalidateTextLayout;
    (editor.view.dom as HTMLElement & { __manuscriptProbeQA?: () => unknown }).__manuscriptProbeQA =
      () => ({ ...manuscriptProbeStats, cached: manuscriptProbeCounts.size, queued: manuscriptProbeQueue.size, revision: visualLayoutRevision });
    if (import.meta.env.VITE_QA_PAGE_DIAGNOSTICS === "1") {
      const root = editor.view.dom as HTMLElement & { __pageBreaksQA?: () => unknown; __pageBreaksHistoryQA?: unknown[] };
      root.__pageBreaksQA = () => ({ breaks: pageBreaksRef.current, signature: pageBreaksSignatureRef.current, history: root.__pageBreaksHistoryQA ?? [] });
    }
    // Compile-time opt-in: normal builds retain the established measurement path.
    if (import.meta.env.VITE_QA_PARAGRAPH_FLOW === "1") {
      const flow = new ParagraphFlow(editor.view.dom, () => requestLineBreakMarks());
      paragraphFlowRef.current = flow;
      const root = editor.view.dom as HTMLElement & { __paragraphFlowQA?: () => unknown };
      root.__paragraphFlowQA = () => ({ snapshot: flow.flush(writingModeRef.current), stats: { ...flow.stats }, breaks: pageBreaksRef.current });
    }
    const visualLayoutObserver = new ResizeObserver(() => {
      const signature = layoutSignature();
      if (signature !== lastLayoutSignature) invalidateTextLayout();
      lastLayoutSignature = signature;
      visualLayoutCache = null;
      centerAnimation.invalidate();
      requestVisualLines();
    });
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
      imeReplacePrepared = false;
      cancelInitialAdjustment();
      stopCenterAnimation();
      composingRef.current = true;
      // 変換中はスクロールスナップを止める。ブラウザがキャレットを見せるために
      // 動かしたスクロールを、スナップがページ境界へ引き戻してしまうため。
      shellRef.current?.setAttribute("data-composing", "true");
      renderLineBreakMarks();
    };

    // 選択範囲を変換で置き換えるときは、範囲をまたぐ装飾を変換開始前に外して
    // 1つのテキストノードにする（clearImeReplaceRange）。compositionstart では
    // ProseMirror が既に変換中として選択位置のノードを保護するため遅い。
    let imeReplacePrepared = false;
    const handleImeKeyDown = (event: KeyboardEvent) => {
      if (editor.view.composing || editor.state.selection.empty) return;
      if (event.keyCode !== 229 && event.key !== "Process" && event.key !== "Convert") return;
      const { from, to } = editor.state.selection;
      imeReplacePrepared = true;
      editor.view.dispatch(
        editor.state.tr
          .setMeta(astKey, { imeReplaceRange: { from, to } } satisfies AstMeta)
          .setMeta("addToHistory", false),
      );
    };
    const handleImeKeyUp = () => {
      if (!imeReplacePrepared || editor.view.composing) return;
      imeReplacePrepared = false;
      // 変換が始まらなかった。compositionend と同じく外した装飾を戻す。
      if (!composingRef.current) {
        editor.view.dispatch(
          editor.state.tr
            .setMeta(astKey, { refreshComposition: true } satisfies AstMeta)
            .setMeta("addToHistory", false),
        );
      }
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
        // ブロック方向で版面に収まっているかを見る。縦書きは横、横書きは縦。
        const areaStart = vertical ? hostRect.left + layout.paddingX : hostRect.top + layout.paddingY;
        const areaEnd = vertical ? hostRect.right - layout.paddingX : hostRect.bottom - layout.paddingY;
        const caretStart = vertical ? caret.left : caret.top;
        const caretEnd = vertical ? caret.right : caret.bottom;
        // 表示中のページに収まっているなら動かさない。
        if (caretStart >= areaStart && caretEnd <= areaEnd) return;
        const target = pageContainingPoint(vertical ? caret.left : caret.top);
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
        if (isEditorComposing(editor, composingRef)) return;
        editor.view.dispatch(
          editor.state.tr
            .setMeta(astKey, { refreshComposition: true } satisfies AstMeta)
            .setMeta("addToHistory", false),
        );
      });
      requestCenterCaret(false, "compositionend");
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
      invalidateTextLayout();
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
      stopCenterAnimation();
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
    editor.view.dom.addEventListener("keydown", handleImeKeyDown);
    editor.view.dom.addEventListener("keyup", handleImeKeyUp);
    editor.view.dom.addEventListener("compositionstart", handleCompositionStart);
    editor.view.dom.addEventListener("compositionupdate", handleCompositionUpdate);
    editor.view.dom.addEventListener("compositionend", handleCompositionEnd);
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    document.fonts?.addEventListener("loadingdone", handleFontLoadingDone);
    let uninstallImeTrace: (() => void) | null = null;
    let imeTraceDisposed = false;
    // IME の記録は開発サーバーを VITE_QA_IME_TRACE=1 で起動したときだけ動かす。
    if (import.meta.env.DEV && import.meta.env.VITE_QA_IME_TRACE === "1") {
      void import("./editor/imeTrace").then(({ installImeTrace }) => {
        if (!imeTraceDisposed) uninstallImeTrace = installImeTrace(editor);
      });
    }

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

    const uninstallNativeIme = installNativeImeExperiment(editor, shellRef.current!, {
      start: handleCompositionStart,
      update: () => {
        requestPagedSelectionAfterReflow(editor);
        requestCenterCaret(false, "native-composition");
      },
      end: handleCompositionEnd,
    });
    onReady(handle);

    return () => {
      uninstallNativeIme();
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("mousedown", handleMouseDown);
      editor.view.dom.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointerdown", cancelInitialAdjustment, { capture: true });
      window.removeEventListener("keydown", cancelInitialAdjustment, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      editor.view.dom.removeEventListener("keydown", handleImeKeyDown);
      editor.view.dom.removeEventListener("keyup", handleImeKeyUp);
      editor.view.dom.removeEventListener("compositionstart", handleCompositionStart);
      editor.view.dom.removeEventListener("compositionupdate", handleCompositionUpdate);
      editor.view.dom.removeEventListener("compositionend", handleCompositionEnd);
      scroller.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      document.fonts?.removeEventListener("loadingdone", handleFontLoadingDone);
      imeTraceDisposed = true;
      uninstallImeTrace?.();
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
      blockObserver.disconnect();
      paragraphFlowRef.current?.dispose();
      paragraphFlowRef.current = null;
      pageLayoutObserver.disconnect();
      cancelInitialAdjustment();
      stopCenterAnimation();
      if (startCenterAnimationRef.current === startCenterAnimation) startCenterAnimationRef.current = null;
      if (stopCenterAnimationRef.current === stopCenterAnimation) stopCenterAnimationRef.current = null;
      renderLineBreakMarksRef.current = null;
      requestLineBreakMarksRef.current = null;
      renderVisualLinesRef.current = null;
      requestVisualLinesRef.current = null;
      if (invalidateTextLayoutRef.current === invalidateTextLayout) invalidateTextLayoutRef.current = null;
      if (cancelInitialAdjustmentRef.current === cancelInitialAdjustment) {
        cancelInitialAdjustmentRef.current = null;
      }
      if (lineBreakLayerRef.current) lineBreakLayerRef.current.textContent = "";
      if (manuscriptBoundaryLayerRef.current) manuscriptBoundaryLayerRef.current.textContent = "";
      if (manuscriptProbeHandle !== null) {
        if (typeof cancelIdleCallback === "function") cancelIdleCallback(manuscriptProbeHandle);
        clearTimeout(manuscriptProbeHandle);
      }
      manuscriptProbeHost?.remove();
      document.fonts?.removeEventListener("loadingdone", handleFontsLoaded);
      if (applyManuscriptLatinRef.current === applyManuscriptLatin) applyManuscriptLatinRef.current = null;
      latinMetricsRef.current?.dispose();
      latinMetricsRef.current = null;
      if (visualLineContentRef.current) {
        visualLineContentRef.current.textContent = "";
        visualLineContentRef.current.style.transform = "";
      }
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
      data-typewriter={editorDisplayMode === "continuous" && !typewriterScroll ? "off" : undefined}
      data-page-flow={editorDisplayMode === "paged" ? pageFlowDirection : undefined}
      data-manuscript={manuscriptActive ? "true" : undefined}
      data-manuscript-grid={manuscriptActive && manuscript.showGrid ? "true" : undefined}
      style={manuscriptActive ? ({
        "--ms-chars": manuscript.charactersPerLine,
        "--ms-font-size": `${manuscript.fontSize}px`,
      } as CSSProperties) : undefined}
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
          <div ref={editorHostRef} className="verticalTypewriterEditor">
            <div ref={manuscriptBoundaryLayerRef} className="manuscriptPageBoundaryLayer" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div
        ref={visualLineLayerRef}
        className="visibleLineNumberLayer"
        aria-hidden="true"
      >
        <div ref={visualLineContentRef} className="visibleLineNumberContent" />
      </div>
      <div ref={lineBreakLayerRef} className="visibleLineBreakLayer" aria-hidden="true" />
      <ImageHoverPreview hostRef={editorHostRef} documentPath={documentPath} />
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
