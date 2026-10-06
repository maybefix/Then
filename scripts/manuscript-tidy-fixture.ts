import assert from "node:assert/strict";
import { tidyManuscript } from "../src/editor/manuscriptTidy";

const both = { indentParagraphs: true, spaceAfterExclamation: true };
const indentOnly = { indentParagraphs: true, spaceAfterExclamation: false };
const spaceOnly = { indentParagraphs: false, spaceAfterExclamation: true };
const tidy = (text: string, options = both) => tidyManuscript(text, options).text;

// --- 字下げ ---
assert.equal(tidy("地の文です。", indentOnly), "　地の文です。");
// 既に字下げ済み（全角・半角とも）は除外する。
assert.equal(tidy("　字下げ済み。", indentOnly), "　字下げ済み。");
assert.equal(tidy(" 半角で空けた行", indentOnly), " 半角で空けた行");
// 会話文などの括弧始まりは字下げしない。
assert.equal(tidy("「会話」\n『書名』\n（注記）", indentOnly), "「会話」\n『書名』\n（注記）");
// 見出し・リスト・空行・地付き・配置指示・表・区切り線・画像だけの行は対象外。
const untouched = [
  "# 見出し",
  "- 項目",
  "1. 項目",
  "",
  ">>地付きの行",
  "中央の行[(al:center)]",
  "| 表 | 表 |",
  "---",
  "![挿絵](img/a.png)",
].join("\n");
assert.equal(tidy(untouched, indentOnly), untouched);
// ルビなどの記法で始まる行は本文なので字下げする。
assert.equal(tidy("[漢字(rb,かんじ)]を読む。", indentOnly), "　[漢字(rb,かんじ)]を読む。");
// コメントとコードブロックには触れない。
assert.equal(tidy("// メモ\n```\nコード\n```", indentOnly), "// メモ\n```\nコード\n```");
assert.equal(tidy("<!--\n書きかけ\n-->", indentOnly), "<!--\n書きかけ\n-->");
// フロントマターには触れない。
assert.equal(tidy("---\ntitle: 題\n---\n本文", indentOnly), "---\ntitle: 題\n---\n　本文");

// --- 感嘆符・疑問符のあとの全角スペース ---
assert.equal(tidy("えっ！本当に？うそ。", spaceOnly), "えっ！　本当に？　うそ。");
// 連続する記号は、そのまとまりの後ろに入れる。
assert.equal(tidy("えっ！？本当", spaceOnly), "えっ！？　本当");
assert.equal(tidy("やった！！！勝った", spaceOnly), "やった！！！　勝った");
// 閉じ括弧・句読点・行末・既存の空白の前には入れない。
assert.equal(tidy("「本当！？」と言った。", spaceOnly), "「本当！？」と言った。");
assert.equal(tidy("まさか！", spaceOnly), "まさか！");
assert.equal(tidy("まさか！　そんな", spaceOnly), "まさか！　そんな");
// 半角スペースで空けてあるなら全角に揃える。
assert.equal(tidy("まさか！ そんな", spaceOnly), "まさか！　そんな");
// 半角の「!?」は和文に挟まれているときだけ。
assert.equal(tidy("えっ!?本当", spaceOnly), "えっ!?　本当");
assert.equal(tidy("https://example.com/?q=1", spaceOnly), "https://example.com/?q=1");
assert.equal(tidy("Hello!World", spaceOnly), "Hello!World");
// 縦中横の感嘆符は記号のまとまりとして扱う。
assert.equal(tidy("えっ[!?(tcy)]本当", spaceOnly), "えっ[!?(tcy)]　本当");
assert.equal(tidy("えっ！[!!(tcy)]本当", spaceOnly), "えっ！[!!(tcy)]　本当");
// 画像記法の「!」や、ルビの中身は書き換えない。
assert.equal(tidy("前![図](a.png)後", spaceOnly), "前![図](a.png)後");
assert.equal(tidy("[驚！嘆(rb,きょうたん)]だ", spaceOnly), "[驚！嘆(rb,きょうたん)]だ");
// 見出しやリストの中でも入れる。コメント・コードでは入れない。
assert.equal(tidy("# 第一話　え！？嘘", spaceOnly), "# 第一話　え！？　嘘");
assert.equal(tidy("// えっ！本当\n```\na!?b\n```", spaceOnly), "// えっ！本当\n```\na!?b\n```");

// --- 組み合わせと件数 ---
const result = tidyManuscript("えっ！本当？\n「待って！」\n　もう一度！行こう", both);
assert.equal(result.text, "　えっ！　本当？\n「待って！」\n　もう一度！　行こう");
assert.equal(result.indented, 1);
assert.equal(result.spaced, 2);
// 二度かけても変わらない。
assert.equal(tidy(result.text), result.text);

// --- 範囲指定 ---
assert.equal(
  tidyManuscript("一行目\n二行目\n三行目", indentOnly, { from: 1, to: 1 }).text,
  "一行目\n　二行目\n三行目",
);

console.log("manuscript tidy tests passed");
