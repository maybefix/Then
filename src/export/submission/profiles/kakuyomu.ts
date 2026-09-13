import type { Warn } from "../types";

export function serializeKakuyomuRuby(text: string, reading: string, warn: Warn): string {
  if (Array.from(text).length > 20 || Array.from(reading).length > 50) {
    warn("ruby-limit", "カクヨムのルビ上限（親文字20文字、ルビ50文字）を超えています");
  }
  return `｜${text}《${reading}》`;
}
export function serializeKakuyomuEmphasis(text: string): string { return `《《${text}》》`; }
