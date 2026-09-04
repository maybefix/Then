/**
 * 本文に振られたルビを取り出す。
 *
 * ルビは書き手が「この字をこう読ませる」と決めた場所なので、固有名詞の
 * 表記ゆれを見つける手がかりになる。同じ読みで違う字が当ててあれば、
 * 変換ミスか揺れの可能性が高い。
 */

export type RubyAnnotation = {
  /** 記法全体の範囲。 */
  from: number;
  to: number;
  /** 親文字（ルビを振られる本文）の範囲。 */
  baseFrom: number;
  baseTo: number;
  base: string;
  reading: string;
};

/** 青空文庫形式。区切り記号つき ｜親文字《ルビ》。 */
const AOZORA_DELIMITED = /｜([^《｜\n]+)《([^》\n]+)》/g;
/** 青空文庫形式。区切り記号なしで、直前の漢字列に掛かるもの。 */
const AOZORA_BARE = /([一-龥々ヶヵ]+)《([^》\n]+)》/g;
/** Then記法 [親文字(rb,ルビ)]。 */
const THEN_NOTATION = /\[([^[\]\n(]+)\(rb,([^)\n]+)\)\]/g;

type Capture = {
  pattern: RegExp;
  /** 記法全体の先頭から、親文字が始まるまでの文字数。 */
  baseOffset: number;
};

const CAPTURES: Capture[] = [
  { pattern: AOZORA_DELIMITED, baseOffset: 1 },
  { pattern: AOZORA_BARE, baseOffset: 0 },
  { pattern: THEN_NOTATION, baseOffset: 1 },
];

/**
 * ルビの一覧を本文の順に返す。区切り記号のあるなしで同じ箇所が二重に
 * 当たることがあるため、先に始まるものを残して重なりは捨てる。
 */
export function collectRubyAnnotations(text: string): RubyAnnotation[] {
  const found: RubyAnnotation[] = [];

  for (const capture of CAPTURES) {
    const pattern = new RegExp(capture.pattern.source, capture.pattern.flags);
    let match = pattern.exec(text);
    while (match) {
      const base = match[1];
      const reading = match[2];
      if (base && reading) {
        const baseFrom = match.index + capture.baseOffset;
        found.push({
          from: match.index,
          to: match.index + match[0].length,
          baseFrom,
          baseTo: baseFrom + base.length,
          base,
          reading,
        });
      }
      match = pattern.exec(text);
    }
  }

  found.sort((left, right) => left.from - right.from || right.to - left.to);

  const annotations: RubyAnnotation[] = [];
  let consumedTo = -1;
  for (const annotation of found) {
    if (annotation.from < consumedTo) continue;
    annotations.push(annotation);
    consumedTo = annotation.to;
  }
  return annotations;
}
