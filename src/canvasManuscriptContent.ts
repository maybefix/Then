/**
 * 「この順で原稿を作る」（BINDER 4-4）で作る原稿の中身。YAML の書き方はプロパティ欄と同じ部品を使う
 * （概要は synopsis.ts、元のカードは formatProperty）。YAML の部品を読み込むので、メイン画面が遅れて読む。
 */
import { writeSynopsis } from "./corkboard/synopsis";
import { formatProperty } from "./properties/propertyModel";
import { replaceFrontMatter } from "./utils/frontmatter";

/** 概要に入れる文。改行（続く改行もまとめて）は全角の空白にする（4-4 の確認1の 4、癖2）。 */
export function synopsisFromCard(text: string): string {
  return text.trim().replace(/[ \t]*(?:\r?\n[ \t]*)+/g, "　");
}

/** 「カードごと」の原稿: 先頭の見出しだけの本文と、カードの文章の概要。文章が空なら概要は書かない。 */
export function perCardManuscript(name: string, text: string): string {
  const base = `# ${name.trim()}\n`;
  const synopsis = synopsisFromCard(text);
  return synopsis ? writeSynopsis(base, synopsis) : base;
}

/** `sourceCards` の1つ。カードの ID には `#` がないので、ボード名に `#` があっても最後の `#` で分けられる。 */
export const sourceCardRef = (boardName: string, cardId: string) => `${boardName}#${cardId}`;

/**
 * 「1本につなげる」の原稿。カードのあいだは空行、タイトルのあるカードは文章の前に `## タイトル`（確認1の 3）。
 * フロントマターに `sourceCards`（元のカード）を一覧の順で書く。
 */
export function joinedManuscript(
  name: string,
  cards: { title?: string; text: string }[],
  sourceCards: string[],
): string {
  const parts = cards
    .map((card) => {
      const title = card.title?.trim();
      const text = card.text.trim();
      return [title ? `## ${title}` : "", text].filter(Boolean).join("\n\n");
    })
    .filter(Boolean);
  const body = `# ${name.trim()}\n${parts.length ? `\n${parts.join("\n\n")}\n` : ""}`;
  return replaceFrontMatter(body, formatProperty("sourceCards", "list", sourceCards));
}
