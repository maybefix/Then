import {
  WHITESPACE_PATTERN,
} from "../storedStateModel";

/**
 * 文字数カウント。`includeWhitespace` が false の場合は空白文字を除外する。
 * サロゲートペアを 1 文字として数えるため Array.from を用いる。
 */
export function countDisplayCharacters(text: string, includeWhitespace: boolean): number {
  const target = includeWhitespace ? text : text.replace(WHITESPACE_PATTERN, "");
  return Array.from(target).length;
}
