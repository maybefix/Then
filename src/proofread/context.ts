import { findJapaneseQuoteRanges } from "../editor/japaneseQuoteRanges";
import type { ProofreadContext, ProofreadOptions, ProofreadSentence } from "./types";

/** 検査対象から外した位置を埋める文字。本文と長さを揃えるため1文字で置き換える。 */
export const MASK_CHAR = "\uFFFD";
const MASK_PATTERN = /\uFFFD/g;

type Range = { from: number; to: number };

const FENCE_PATTERN = /^\s{0,3}(?:```|~~~)/;
const HEADING_PATTERN = /^\s{0,3}#{1,6}(?:\s|$)/;
/** 行頭の箇条書き・引用・番号の記号。本文ではないので潰す。 */
const LINE_MARKER_PATTERN = /^(\s*(?:(?:[-*+]|\d+[.)]|>)\s+)+)/;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const URL_PATTERN = /https?:\/\/[^\s)）」』】>]+/g;
const LINK_TARGET_PATTERN = /\]\([^)\n]*\)/g;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
/** 青空文庫形式のルビ ｜親文字《ルビ》。読みは校正対象にしない。 */
const AOZORA_RUBY_PATTERN = /《[^》\n]*》/g;
/** Then記法 [本文(rb,ルビ)] [本文(em,goma)] [本文(tcy)] [(al:center)] の指定部分。 */
const NOTATION_PATTERN = /\((?:rb|em|tcy|al)(?:[,:][^)\n]*)?\)/g;

const isNewline = (character: string) => character === "\n" || character === "\r";

const pushRange = (ranges: Range[], from: number, to: number) => {
  if (to > from) ranges.push({ from, to });
};

/** 校正対象から外す範囲を集める。行番号を保つため改行は潰さない。 */
function collectMaskRanges(text: string, lineStarts: number[]): Range[] {
  const ranges: Range[] = [];

  let insideFence = false;
  for (let line = 0; line < lineStarts.length; line += 1) {
    const start = lineStarts[line];
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    const body = text.slice(start, end);

    if (FENCE_PATTERN.test(body)) {
      insideFence = !insideFence;
      pushRange(ranges, start, end);
      continue;
    }
    if (insideFence) {
      pushRange(ranges, start, end);
      continue;
    }
    if (HEADING_PATTERN.test(body)) {
      // 見出し記号だけを潰し、見出し文そのものは校正対象に残す。
      const marker = body.match(/^\s{0,3}#{1,6}\s*/);
      if (marker) pushRange(ranges, start, start + marker[0].length);
      continue;
    }
    const marker = body.match(LINE_MARKER_PATTERN);
    if (marker) pushRange(ranges, start, start + marker[1].length);
  }

  for (const pattern of [
    INLINE_CODE_PATTERN,
    URL_PATTERN,
    LINK_TARGET_PATTERN,
    HTML_COMMENT_PATTERN,
    AOZORA_RUBY_PATTERN,
    NOTATION_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      pushRange(ranges, match.index, match.index + match[0].length);
      match = pattern.exec(text);
    }
  }

  return ranges;
}

/** 範囲を潰した本文を作る。改行は残すので行の対応は崩れない。 */
function applyMask(text: string, ranges: Range[]): string {
  if (!ranges.length) return text;
  const characters = text.split("");
  for (const range of ranges) {
    const from = Math.max(0, range.from);
    const to = Math.min(text.length, range.to);
    for (let index = from; index < to; index += 1) {
      if (isNewline(characters[index])) continue;
      characters[index] = MASK_CHAR;
    }
  }
  return characters.join("");
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

/** 会話文（「」の内側）の範囲。閉じていない鉤括弧は会話文として扱わない。 */
function collectDialogueRanges(text: string, lineStarts: number[]): Range[] {
  const ranges: Range[] = [];
  for (let line = 0; line < lineStarts.length; line += 1) {
    const start = lineStarts[line];
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    for (const range of findJapaneseQuoteRanges(text.slice(start, end))) {
      pushRange(ranges, start + range.from, start + range.to);
    }
  }
  return ranges;
}

const SENTENCE_TERMINATORS = new Set(["。", "．", "！", "？", "!", "?"]);
const SENTENCE_CLOSERS = new Set(["」", "』", "）", ")", "］", "]", "〕", "｝", "”", "’", "…"]);

const isBlankSentence = (text: string) => text.replace(MASK_PATTERN, "").trim().length === 0;

/**
 * 本文を文に区切る。コードブロックと行頭記号は潰し済みの本文を使う。
 * 改行は必ず文の切れ目として扱う。日本語の原稿では改行が段落や台詞の
 * 区切りになるので、行をまたいで一文と数えると長さの指摘が当たらなくなる。
 */
function collectSentences(
  text: string,
  scanText: string,
  lineStarts: number[],
): ProofreadSentence[] {
  const sentences: ProofreadSentence[] = [];

  for (let line = 0; line < lineStarts.length; line += 1) {
    const lineFrom = lineStarts[line];
    const lineTo = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    if (lineTo <= lineFrom) continue;

    let start = lineFrom;
    let index = lineFrom;
    while (index < lineTo) {
      if (!SENTENCE_TERMINATORS.has(scanText[index])) {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (
        end < lineTo &&
        (SENTENCE_TERMINATORS.has(scanText[end]) || SENTENCE_CLOSERS.has(scanText[end]))
      ) {
        end += 1;
      }
      const body = text.slice(start, end);
      if (!isBlankSentence(body)) {
        sentences.push({ from: start, to: end, text: body, line: line + 1 });
      }
      start = end;
      index = end;
    }

    if (start < lineTo) {
      const body = text.slice(start, lineTo);
      if (!isBlankSentence(body)) {
        sentences.push({ from: start, to: lineTo, text: body, line: line + 1 });
      }
    }
  }

  return sentences;
}

export function createProofreadContext(text: string, options: ProofreadOptions): ProofreadContext {
  const lineStarts = computeLineStarts(text);
  const scanText = applyMask(text, collectMaskRanges(text, lineStarts));
  const narrationText = options.skipDialogue
    ? applyMask(scanText, collectDialogueRanges(text, lineStarts))
    : scanText;

  const lineAt = (offset: number) => {
    const target = Math.max(0, Math.min(text.length, offset));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= target) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };

  return {
    text,
    scanText,
    narrationText,
    sentences: collectSentences(text, scanText, lineStarts),
    options,
    lineAt,
    lineStart: (line) => lineStarts[Math.max(0, Math.min(lineStarts.length - 1, line - 1))] ?? 0,
  };
}

/** その範囲が丸ごと潰されているか。会話文を除外したいルールの判定に使う。 */
export function isRangeMasked(masked: string, from: number, to: number): boolean {
  for (let index = Math.max(0, from); index < Math.min(masked.length, to); index += 1) {
    const character = masked[index];
    if (character !== MASK_CHAR && !/\s/.test(character)) return false;
  }
  return true;
}

/** 文の見かけの長さ。空白と潰した範囲は数えない。 */
export function sentenceLength(text: string): number {
  return Array.from(text.replace(MASK_PATTERN, "")).filter(
    (character) => !/\s/.test(character),
  ).length;
}
