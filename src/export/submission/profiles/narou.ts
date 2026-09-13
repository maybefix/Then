import { splitGraphemes } from "../graphemes";
import type { Warn } from "../types";

export function serializeNarouRuby(text: string, reading: string, warn: Warn): string {
  if (Array.from(text).length > 10 || Array.from(reading).length > 10) {
    warn("ruby-limit", "なろうのルビ上限（親文字10文字、ルビ10文字）を超えています");
  }
  if (/[&"<>]/u.test(text + reading)) {
    warn("literal-notation-conflict", "なろうでルビが表示されない可能性のある記号が含まれています");
  }
  return `｜${text}《${reading}》`;
}
export function serializeNarouEmphasis(text: string): string {
  return splitGraphemes(text).map((part) => /^\s+$/u.test(part) ? part : `｜${part}《・》`).join("");
}
