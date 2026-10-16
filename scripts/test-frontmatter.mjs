import assert from "node:assert/strict";
import {
  composeMarkdown,
  parseFrontMatter,
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
  const parts = parseFrontMatter(`${BOM}本文`);
  assert.equal(composeMarkdown("a: 1", parts.body, parts.bom), `${BOM}---\na: 1\n---\n本文`);
});

test("プロパティを全部消してもBOMは残る", () => {
  const parts = parseFrontMatter(`${BOM}---\na: 1\n---\n本文`);
  assert.equal(composeMarkdown("", parts.body, parts.bom), `${BOM}本文`);
});

test("BOMを含む古い本文（チェックポイントなど）でもBOMが二重にならない", () => {
  assert.equal(composeMarkdown("a: 1", `${BOM}本文`), `${BOM}---\na: 1\n---\n本文`);
  assert.equal(composeMarkdown("", `${BOM}本文`, true), `${BOM}本文`);
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
  assert.equal(composeMarkdown("", "---\n場面2"), "---\n---\n---\n場面2");
  assert.equal(composeMarkdown("a: 1", "---\n場面2"), "---\na: 1\n---\n---\n場面2");
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
