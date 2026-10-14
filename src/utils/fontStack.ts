/**
 * App.css の @font-face で定義する、全角スペース（U+3000）専用のフォント。
 * BIZ UDPゴシックや MS Pゴシックなどのプロポーショナル和文フォントは
 * U+3000 自体を 0.6〜0.67em で設計しているため、字下げが半角幅のように
 * 見える。U+3000 だけを等幅和文フォントから描かせ、常に 1em にする。
 * テキストと DOM には手を入れないので、キャレット・削除・IME の挙動は変わらない。
 */
export const IDEOGRAPHIC_SPACE_FONT_FAMILY = '"Then Ideographic Space"';

/** 本文系のフォントスタックの先頭に、全角スペース専用フォントを差し込む。 */
export function withIdeographicSpaceFont(fontFamily: string): string;
export function withIdeographicSpaceFont(fontFamily: string | undefined): string | undefined;
export function withIdeographicSpaceFont(fontFamily: string | undefined): string | undefined {
  if (!fontFamily) return fontFamily;
  return `${IDEOGRAPHIC_SPACE_FONT_FAMILY}, ${fontFamily}`;
}

export function quoteCssFontFamily(family: string): string {
  const escaped = family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** 引用符で囲んだ単一ファミリーだけを取り出す。複数指定や無引用は null。 */
export function unquoteSingleCssFontFamily(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^"((?:\\.|[^"\\])*)"$/) ?? trimmed.match(/^'((?:\\.|[^'\\])*)'$/);
  return match ? match[1].replace(/\\(["'\\])/g, "$1").replace(/\\\\/g, "\\") : null;
}
