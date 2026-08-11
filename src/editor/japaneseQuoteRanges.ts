export type JapaneseQuoteRange = {
  from: number;
  to: number;
};

/**
 * 1行に含まれる「...」の範囲を UTF-16 オフセットで返す。
 * ProseMirror の位置と同じ単位を使い、入れ子は最外周を1範囲として扱う。
 * 閉じていない鉤括弧は「囲まれた文」ではないため色分けしない。
 */
export function findJapaneseQuoteRanges(text: string): JapaneseQuoteRange[] {
  const ranges: JapaneseQuoteRange[] = [];
  const openings: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "「") {
      openings.push(index);
      continue;
    }
    if (character !== "」" || openings.length === 0) continue;

    const from = openings.pop();
    if (from !== undefined && openings.length === 0) {
      ranges.push({ from, to: index + 1 });
    }
  }

  return ranges;
}
