/// <reference lib="es2022.intl" />

let segmenter: Intl.Segmenter | undefined;
export function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter !== "function") {
    throw new Error("この環境は書記素単位の文字分割に対応していません");
  }
  segmenter ??= new Intl.Segmenter("ja", { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}
