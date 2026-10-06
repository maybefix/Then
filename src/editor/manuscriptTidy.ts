import { classifyLines, isCodeRole, isCommentRole, parseLineNode } from "./ast/documentAst";
import type { InlineMarkup, LineNode } from "./ast/types";
import { parseFrontMatter } from "../utils/frontmatter";

/**
 * 原稿を整える：段落頭の字下げと、感嘆符・疑問符のあとの全角スペースを一括で入れる。
 *
 * どちらも本文の地の文だけを対象にし、見出し・リスト（字下げのみ）・コメント・
 * コード・表・フロントマター・配置指示のある行には手を付けない。
 */
export type ManuscriptTidyOptions = {
  indentParagraphs: boolean;
  spaceAfterExclamation: boolean;
};

export type ManuscriptTidyResult = {
  text: string;
  indented: number;
  spaced: number;
};

/** 対象にする行の範囲（0 始まり、両端を含む）。省略時は文書全体。 */
export type ManuscriptTidyLineRange = { from: number; to: number };

const IDEOGRAPHIC_SPACE = "　";

// 会話文などの括弧で始まる行は、慣例どおり字下げしない。
const OPENING_BRACKETS = new Set([..."「『（(〈《【〔［〘〖“‘〝"]);
const FULL_WIDTH_EXCLAMATIONS = new Set([..."！？‼⁇⁈⁉"]);
const HALF_WIDTH_EXCLAMATIONS = new Set([..."!?"]);
// 閉じ括弧や句読点が続くときは、記号の直後に空きを入れない。
const NO_SPACE_BEFORE = new Set([..."」』）)】〕〉》］]〙〗｝}”’〟、。，．,."]);
const EXCLAMATION_TCY = /^[!?！？‼⁇⁈⁉]+$/;
const HORIZONTAL_RULE = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === IDEOGRAPHIC_SPACE;
}

function isAscii(char: string): boolean {
  return char.charCodeAt(0) < 0x80;
}

function frontMatterLineCount(text: string): number {
  const parts = parseFrontMatter(text);
  if (!parts.hasFrontMatter) return 0;
  const header = text.slice(0, text.length - parts.body.length);
  return header.split("\n").length - (header.endsWith("\n") ? 1 : 0);
}

function isTableLine(line: string): boolean {
  return line.trimStart().startsWith("|");
}

function shouldIndent(line: string, node: LineNode): boolean {
  if (node.kind !== "paragraph" || node.align !== null || node.jitsuki) return false;
  const first = line[0];
  if (!first || isWhitespace(first) || OPENING_BRACKETS.has(first)) return false;
  // 表・引用・HTML・区切り線は地の文ではない。
  if (first === "|" || first === ">" || first === "<" || HORIZONTAL_RULE.test(line)) return false;
  // 画像だけの行や改ページ注記だけの行など、本文の文字を持たない行。
  return hasBodyText(line, node.inlineMarkups);
}

const NON_BODY_MARKUPS = new Set<InlineMarkup["type"]>(["image", "aozoraAnnotation", "layoutAlign"]);

function hasBodyText(line: string, markups: readonly InlineMarkup[]): boolean {
  let rest = line;
  // 後ろから消すと、手前の記法の座標がずれない。
  for (const markup of [...markups].sort((a, b) => b.fullRange.offset - a.fullRange.offset)) {
    if (!NON_BODY_MARKUPS.has(markup.type)) continue;
    const { offset, length } = markup.fullRange;
    rest = rest.slice(0, offset) + rest.slice(offset + length);
  }
  return /[^\s　]/.test(rest);
}

type Segment = { start: number; end: number; kind: "full" | "half" | "other" };

/** 行を、感嘆符（全角／半角）と、それ以外の文字・保護する記法に分ける。 */
function segmentLine(line: string, markups: readonly InlineMarkup[]): Segment[] {
  const protectedRanges = markups
    .filter((markup) => markup.type !== "bold")
    .map((markup) => ({
      start: markup.fullRange.offset,
      end: markup.fullRange.offset + markup.fullRange.length,
      // 「[!?(tcy)]」のような縦中横の感嘆符は、ひとつの感嘆符として扱う。
      exclamation: markup.type === "tcy" && EXCLAMATION_TCY.test(markup.contentText),
    }))
    .sort((left, right) => left.start - right.start);

  const segments: Segment[] = [];
  let index = 0;
  let protectedIndex = 0;
  while (index < line.length) {
    while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].end <= index) {
      protectedIndex += 1;
    }
    const range = protectedRanges[protectedIndex];
    if (range && range.start <= index) {
      segments.push({ start: index, end: range.end, kind: range.exclamation ? "full" : "other" });
      index = range.end;
      continue;
    }
    const char = line[index];
    const kind = FULL_WIDTH_EXCLAMATIONS.has(char)
      ? "full"
      : HALF_WIDTH_EXCLAMATIONS.has(char)
        ? "half"
        : "other";
    segments.push({ start: index, end: index + 1, kind });
    index += 1;
  }
  return segments;
}

type Edit = { at: number; remove: number; insert: string };

function exclamationSpaceEdits(line: string, markups: readonly InlineMarkup[]): Edit[] {
  const segments = segmentLine(line, markups);
  const edits: Edit[] = [];
  let index = 0;
  while (index < segments.length) {
    if (segments[index].kind === "other") {
      index += 1;
      continue;
    }
    const runStart = segments[index].start;
    let halfOnly = true;
    while (index < segments.length && segments[index].kind !== "other") {
      if (segments[index].kind === "full") halfOnly = false;
      index += 1;
    }
    const runEnd = index < segments.length ? segments[index].start : line.length;
    const next = line[runEnd];
    if (next === undefined || next === IDEOGRAPHIC_SPACE || next === "\t" || NO_SPACE_BEFORE.has(next)) {
      continue;
    }
    // 半角の「!?」は URL や記法にも現れるので、和文に挟まれているときだけ扱う。
    if (halfOnly) {
      const previous = line[runStart - 1];
      if (previous === undefined || isAscii(previous)) continue;
    }
    if (next === " ") {
      // 半角スペースで空けてあるなら、全角に揃える。
      const after = line[runEnd + 1];
      if (after !== undefined && !isWhitespace(after) && !isAscii(after) && !NO_SPACE_BEFORE.has(after)) {
        edits.push({ at: runEnd, remove: 1, insert: IDEOGRAPHIC_SPACE });
      }
      continue;
    }
    if (halfOnly && isAscii(next)) continue;
    edits.push({ at: runEnd, remove: 0, insert: IDEOGRAPHIC_SPACE });
  }
  return edits;
}

function applyEdits(line: string, edits: readonly Edit[]): string {
  let result = "";
  let cursor = 0;
  for (const edit of edits) {
    result += line.slice(cursor, edit.at) + edit.insert;
    cursor = edit.at + edit.remove;
  }
  return result + line.slice(cursor);
}

export function tidyManuscript(
  text: string,
  options: ManuscriptTidyOptions,
  lineRange?: ManuscriptTidyLineRange,
): ManuscriptTidyResult {
  const lines = text.split("\n");
  const roles = classifyLines(lines);
  const firstBodyLine = frontMatterLineCount(text);
  const from = Math.max(firstBodyLine, lineRange?.from ?? 0);
  const to = Math.min(lines.length - 1, lineRange?.to ?? lines.length - 1);
  let indented = 0;
  let spaced = 0;

  for (let index = from; index <= to; index += 1) {
    const role = roles[index];
    if (isCommentRole(role) || isCodeRole(role)) continue;
    let line = lines[index];
    if (!line || isTableLine(line)) continue;
    const node = parseLineNode(line, index, 0, role);

    if (options.spaceAfterExclamation && node.kind !== "blank") {
      const edits = exclamationSpaceEdits(line, node.inlineMarkups);
      if (edits.length > 0) {
        line = applyEdits(line, edits);
        spaced += edits.length;
      }
    }
    // 字下げの判定は元の行で行う（記法の位置は元の行の座標）。
    if (options.indentParagraphs && shouldIndent(lines[index], node)) {
      line = IDEOGRAPHIC_SPACE + line;
      indented += 1;
    }
    lines[index] = line;
  }

  return { text: lines.join("\n"), indented, spaced };
}
