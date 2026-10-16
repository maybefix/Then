import assert from "node:assert/strict";
import {
  appendFrontMatterProperty,
  countFrontMatterProperties,
  hasUnclosedFrontMatter,
  parseFrontMatter,
  replaceFrontMatter,
  updateMarkdownBody,
} from "../src/utils/frontmatter.ts";

const BOM = String.fromCharCode(0xfeff);
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("BOM付きのフロントマターを認識する（LF）", () => {
  const parts = parseFrontMatter(`${BOM}---\ntitle: 夜の港\n---\n本文`);
  assert.equal(parts.hasFrontMatter, true);
  assert.equal(parts.metadata, "title: 夜の港");
  assert.equal(parts.body, "本文");
  assert.equal(parts.bom, true);
});

test("BOM付きのフロントマターを認識する（CRLF）", () => {
  const parts = parseFrontMatter(`${BOM}---\r\ntitle: 夜の港\r\n---\r\n本文\r\n`);
  assert.equal(parts.hasFrontMatter, true);
  assert.equal(parts.metadata, "title: 夜の港");
  assert.equal(parts.body, "本文\r\n");
});

test("書き出しに渡す本文にYAMLもBOMも残らない", () => {
  for (const source of [`${BOM}---\nslug: a\n---\n# 見出し`, `${BOM}# 見出し`]) {
    const { body } = parseFrontMatter(source);
    assert.equal(body, "# 見出し");
  }
});

test("BOMのない原稿は従来どおり", () => {
  assert.deepEqual(parseFrontMatter("---\na: 1\n---\n本文"), {
    metadata: "a: 1", body: "本文", hasFrontMatter: true, bom: false,
  });
  assert.deepEqual(parseFrontMatter("本文だけ"), {
    metadata: "", body: "本文だけ", hasFrontMatter: false, bom: false,
  });
});

test("本文の編集で保存してもBOMとフロントマターを保つ", () => {
  const source = `${BOM}---\ntitle: 夜の港\n---\n本文`;
  assert.equal(updateMarkdownBody(source, "書き換えた本文"), `${BOM}---\ntitle: 夜の港\n---\n書き換えた本文`);
});

test("未編集の再結合でファイルが変わらない", () => {
  for (const source of [
    `${BOM}---\ntitle: a\n---\n本文`,
    `${BOM}本文だけ`,
    `${BOM}`,
    "---\ntitle: a\n---\n本文",
    "本文だけ",
  ]) {
    assert.equal(updateMarkdownBody(source, parseFrontMatter(source).body), source, JSON.stringify(source));
  }
});

test("BOM付きでフロントマターのない原稿にプロパティを足すとBOMは先頭に残る", () => {
  assert.equal(replaceFrontMatter(`${BOM}本文`, "a: 1"), `${BOM}---\na: 1\n---\n本文`);
});

test("プロパティを全部消してもBOMは残る", () => {
  assert.equal(replaceFrontMatter(`${BOM}---\na: 1\n---\n本文`, ""), `${BOM}本文`);
});

test("BOMを含む古い本文（チェックポイントなど）でもBOMが二重にならない", () => {
  assert.equal(updateMarkdownBody(`${BOM}---\na: 1\n---\n古い`, `${BOM}新しい`), `${BOM}---\na: 1\n---\n新しい`);
});

// FM-02 / FM-05: a "---" rule at the top of the body
test("本文の先頭に---を書いても、本文がフロントマターに移らない", () => {
  const body = "---\n\n　汽笛が二度鳴った。\n\n---\n続き";
  const saved = updateMarkdownBody("　汽笛が二度鳴った。", body);
  assert.equal(saved, `---\n---\n${body}`);
  const parts = parseFrontMatter(saved);
  assert.equal(parts.body, body);
  assert.equal(parts.metadata, "");
});

test("1行目が---だけの段階でも空のフロントマターを付ける", () => {
  assert.equal(updateMarkdownBody("", "---"), "---\n---\n---");
  assert.equal(parseFrontMatter("---\n---\n---").body, "---");
  assert.equal(updateMarkdownBody("", "--"), "--");
  assert.equal(updateMarkdownBody("", "----"), "----");
});

test("CRLFの原稿では空のフロントマターもCRLFで付ける", () => {
  assert.equal(updateMarkdownBody("", "---\r\n本文\r\n---\r\n"), "---\r\n---\r\n---\r\n本文\r\n---\r\n");
});

test("BOM付きの原稿ではBOMの後ろに空のフロントマターを付ける", () => {
  assert.equal(updateMarkdownBody(`${BOM}本文`, "---\n本文"), `${BOM}---\n---\n---\n本文`);
});

test("空のフロントマターを読める", () => {
  assert.deepEqual(parseFrontMatter("---\n---\n"), { metadata: "", body: "", hasFrontMatter: true, bom: false });
  assert.deepEqual(parseFrontMatter("---\n---"), { metadata: "", body: "", hasFrontMatter: true, bom: false });
  assert.deepEqual(parseFrontMatter("---\n---\n本文\n---\nx"), { metadata: "", body: "本文\n---\nx", hasFrontMatter: true, bom: false });
});

test("フロントマターがある原稿は空のフロントマターを足さない", () => {
  assert.equal(updateMarkdownBody("---\na: 1\n---\n本文", "---\n場面2"), "---\na: 1\n---\n---\n場面2");
});

test("プロパティを全部消しても、本文が---で始まるなら空のフロントマターを残す", () => {
  assert.equal(replaceFrontMatter("---\na: 1\n---\n---\n場面2", ""), "---\n---\n---\n場面2");
  assert.equal(replaceFrontMatter("---\na: 1\n---\n---\n場面2", "a: 2"), "---\na: 2\n---\n---\n場面2");
});

test("本文の編集ではフロントマターの原文を1文字も変えない", () => {
  assert.equal(updateMarkdownBody("---\na: 1  \n---\n\n本文", "\n書き換え"), "---\na: 1  \n---\n\n書き換え");
  assert.equal(updateMarkdownBody("---\n---\n---\n場面", "場面"), "---\n---\n場面");
});

test("空のフロントマター付きの原稿も未編集なら変わらない", () => {
  for (const source of ["---\n---\n---\n場面", "---\r\n---\r\n---\r\n場面", `${BOM}---\n---\n---\n場面`]) {
    assert.equal(updateMarkdownBody(source, parseFrontMatter(source).body), source, JSON.stringify(source));
  }
});

// FM-11: changing properties touches only the front matter
test("プロパティを変えても本文先頭の空行を消さない", () => {
  assert.equal(replaceFrontMatter("---\na: 1\n---\n\n\n本文", "a: 2"), "---\na: 2\n---\n\n\n本文");
});

test("入力したメタデータの末尾の改行・空白をそのまま書く", () => {
  const saved = replaceFrontMatter("---\na: 1\n---\n本文", "a: 1\n");
  assert.equal(saved, "---\na: 1\n\n---\n本文");
  assert.equal(parseFrontMatter(saved).metadata, "a: 1\n");
  assert.equal(replaceFrontMatter("---\na: 1\n---\n本文", "a: 1  "), "---\na: 1  \n---\n本文");
});

test("CRLFの原稿ではメタデータもCRLFで書く", () => {
  assert.equal(
    replaceFrontMatter("---\r\na: 1\r\n---\r\n本文\r\n", "a: 2\nb: 3"),
    "---\r\na: 2\r\nb: 3\r\n---\r\n本文\r\n",
  );
  assert.equal(replaceFrontMatter("本文\r\n次\r\n", "a: 1"), "---\r\na: 1\r\n---\r\n本文\r\n次\r\n");
});

test("閉じの---でファイルが終わっていても形を保つ", () => {
  assert.equal(replaceFrontMatter("---\na: 1\n---", "a: 2"), "---\na: 2\n---");
});

test("フロントマターのない原稿に追加すると先頭に付く", () => {
  assert.equal(replaceFrontMatter("本文", "a: 1"), "---\na: 1\n---\n本文");
  assert.equal(replaceFrontMatter("\n本文", "a: 1"), "---\na: 1\n---\n\n本文");
});

test("「＋」で追加しても既存の行と本文は変わらない", () => {
  const source = "---\na: 1\n---\n\n本文";
  assert.equal(
    replaceFrontMatter(source, appendFrontMatterProperty(parseFrontMatter(source).metadata)),
    "---\na: 1\n新規プロパティ: \n---\n\n本文",
  );
});

test("メタデータが変わらなければファイルも変わらない", () => {
  for (const source of ["---\n---\n本文", "---\na: 1\n\n---\n本文", `${BOM}---\r\na: 1\r\n---\r\n本文`]) {
    assert.equal(replaceFrontMatter(source, parseFrontMatter(source).metadata), source, JSON.stringify(source));
  }
});

// FM-08: count top-level properties, not lines
test("件数はトップレベルの項目数で数える", () => {
  const metadata = [
    "# サイト用",
    "slug: making-then",
    "tags:",
    "  - 開発",
    "  - Then",
    "",
    "series:",
    "  name: 夜の港",
    "  order: 3",
    "memo: |",
    "  一行目",
    "  二行目",
    "aliases: [夜の港 3, 港]",
    '"quoted key": 1',
    "url: https://example.com/a:b",
    "empty:",
  ].join("\n");
  assert.equal(countFrontMatterProperties(metadata), 8);
});

test("件数：空・コメントだけ・CRLF・「＋」で足した行", () => {
  assert.equal(countFrontMatterProperties(""), 0);
  assert.equal(countFrontMatterProperties("# メモ\n\n"), 0);
  assert.equal(countFrontMatterProperties("a: 1\r\nb:\r\n  - x\r\n"), 2);
  assert.equal(countFrontMatterProperties(appendFrontMatterProperty("a: 1")), 2);
  assert.equal(countFrontMatterProperties("- 一覧だけ\n- 二つ目"), 0);
  assert.equal(countFrontMatterProperties("http://example.com"), 0);
});

// FM-09: "＋" never creates a duplicate key
test("「＋」を続けて押しても名前が重複しない", () => {
  let metadata = "";
  for (let i = 0; i < 3; i += 1) metadata = appendFrontMatterProperty(metadata);
  assert.equal(metadata, "新規プロパティ: \n新規プロパティ2: \n新規プロパティ3: ");
  assert.equal(countFrontMatterProperties(metadata), 3);
});

test("「＋」は既存の行を整形しない", () => {
  assert.equal(appendFrontMatterProperty("a: 1  "), "a: 1  \n新規プロパティ: ");
  assert.equal(appendFrontMatterProperty("a: 1\n"), "a: 1\n新規プロパティ: ");
  assert.equal(appendFrontMatterProperty("  \n"), "新規プロパティ: ");
  assert.equal(
    appendFrontMatterProperty("新規プロパティ: x\ntags:\n  - 新規プロパティ2"),
    "新規プロパティ: x\ntags:\n  - 新規プロパティ2\n新規プロパティ2: ",
  );
});

// FM-03: a leading --- with no closing --- stays body, and is reported
test("閉じの---がない原稿を見分ける", () => {
  assert.equal(hasUnclosedFrontMatter("---\nslug: a\n\n本文"), true);
  assert.equal(hasUnclosedFrontMatter(`${BOM}---\r\nslug: a\r\n本文`), true);
  assert.equal(parseFrontMatter("---\nslug: a\n\n本文").hasFrontMatter, false);
  for (const source of ["---\na: 1\n---\n本文", "---\n---\n---\n場面", "本文\n---\n", "----\n本文", "---"]) {
    assert.equal(hasUnclosedFrontMatter(source), false, JSON.stringify(source));
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error.message}`);
  }
}
if (failed) {
  console.error(`${failed} / ${cases.length} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);
