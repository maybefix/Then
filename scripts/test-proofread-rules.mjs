import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outputDir = path.join(root, "test-artifacts", "proofread");
const bundle = path.join(outputDir, "proofread-engine.mjs");
await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "proofread", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: bundle,
});

const { runProofread, DEFAULT_PROOFREAD_OPTIONS, PROOFREAD_RULES } = await import(
  `${pathToFileURL(bundle).href}?${Date.now()}`
);

/** 生成時に実改行が紛れ込まないよう、改行は定数で組み立てる。 */
const NL = String.fromCharCode(10);

const scan = (text, overrides = {}) =>
  runProofread(text, { ...DEFAULT_PROOFREAD_OPTIONS, ...overrides });

const byRule = (text, ruleId, overrides) =>
  scan(text, overrides).issues.filter((issue) => issue.ruleId === ruleId);

const expectOne = (text, ruleId, matched, overrides) => {
  const issues = byRule(text, ruleId, overrides);
  assert.equal(issues.length, 1, `${ruleId} on ${JSON.stringify(text)}: ${JSON.stringify(issues)}`);
  assert.equal(text.slice(issues[0].from, issues[0].to), matched, "offsets must point at the match");
  return issues[0];
};

const expectNone = (text, ruleId, overrides) => {
  const issues = byRule(text, ruleId, overrides);
  assert.equal(issues.length, 0, `${ruleId} must stay quiet on ${JSON.stringify(text)}`);
};

// --- ルールの棚卸し -----------------------------------------------------------
assert.equal(PROOFREAD_RULES.length, 9, "9種類のルールを保つ");
for (const rule of PROOFREAD_RULES) {
  assert.ok(rule.sources.length > 0, `${rule.id} must carry a citation`);
  for (const source of rule.sources) {
    assert.ok(source.title && source.publisher && source.locator && source.basis);
  }
}

// --- 1. 話し言葉 --------------------------------------------------------------
{
  const issue = expectOne("一人でも見れると思った。", "colloquial", "見れる");
  assert.equal(issue.replacement, "見られる");
}
// 仮定形「〜れば」は正しい形なので拾わない。
expectNone("よく考えれば分かるはずだ。", "colloquial");
// 五段動詞から作る可能動詞は正しい形。
expectNone("この紙はよく切れる。", "colloquial");
{
  const issue = expectOne("ずっと待ってた。", "colloquial", "ってた");
  assert.equal(issue.replacement, "っていた");
}
{
  const issue = expectOne("彼はまだ本を読んでる。", "colloquial", "んでる");
  assert.equal(issue.replacement, "んでいる");
}
// 「なんてない」は い抜きではない。
expectNone("そんな決まりなんてない。", "colloquial");
{
  const issue = expectOne("明日は休まさせていただきます。", "colloquial", "休まさせて");
  assert.equal(issue.replacement, "休ませて");
}

// 会話文は既定で対象外、設定を外すと拾う。
expectNone("「見れるよ」と彼は言った。", "colloquial");
expectOne("「見れるよ」と彼は言った。", "colloquial", "見れる", { skipDialogue: false });

// --- 2. 漢字を開く ------------------------------------------------------------
{
  const issues = byRule("出来るだけ早く連絡して下さい。", "kanji-opening");
  assert.deepEqual(
    issues.map((issue) => [issue.excerpt.match, issue.replacement]),
    [
      ["出来る", "できる"],
      ["て下さい", "てください"],
    ],
  );
}
// 「出来事」は語の一部なので触らない。
expectNone("不思議な出来事だった。", "kanji-opening");
// 熟語の一部になっている副詞用漢字は拾わない。
expectNone("高尚な趣味の話をした。", "kanji-opening");
{
  const issue = expectOne("その様な話は聞いていない。", "kanji-opening", "その様");
  assert.equal(issue.replacement, "そのよう");
}
expectNone("その様子を見ていた。", "kanji-opening");
{
  const issue = expectOne("誰でも使う事ができる。", "kanji-opening", "事");
  assert.equal(issue.replacement, "こと");
}
// 熟語の「事」は前が漢字なので触らない。
expectNone("彼は返事をしなかった。仕事に戻る。", "kanji-opening");
expectNone("無事に到着した。", "kanji-opening");

// --- 3. 一文の長さ ------------------------------------------------------------
{
  const long = `${"あ".repeat(90)}。`;
  const issues = byRule(long, "sentence-flow");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /一文が91字/);
}
expectNone(`${"あ".repeat(30)}。`, "sentence-flow");
{
  const issue = expectOne("私の友人の兄の車が止まっている。", "sentence-flow", "の友人の兄の");
  assert.match(issue.message, /「の」が3回/);
}
{
  const issues = byRule("朝、起き、顔を洗い、着替え、鞄を持ち、家を出た。", "sentence-flow");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /読点が5個/);
}

// --- 4. 重複表現 --------------------------------------------------------------
{
  const issue = expectOne("まず最初に手順を確認する。", "redundancy", "まず最初に");
  assert.equal(issue.replacement, "まず");
}
{
  const issue = expectOne("誰でも参加することができる。", "redundancy", "することができる");
  assert.equal(issue.replacement, "できる");
}
{
  const issue = expectOne("彼が来ないわけではない。", "redundancy", "ないわけではない");
  assert.equal(issue.replacement, undefined);
}

// --- 5. 約物 ------------------------------------------------------------------
{
  const issue = expectOne("そうか…そうだったのか。", "punctuation", "…");
  assert.equal(issue.replacement, "……");
}
expectNone("そうか……そうだったのか。", "punctuation");
{
  const issue = expectOne("「行こう。」", "punctuation", "。");
  assert.equal(issue.replacement, "");
}
{
  const issue = expectOne("本当に!", "punctuation", "!");
  assert.equal(issue.replacement, "！");
}
{
  const issue = expectOne("待って！彼は振り返った。", "punctuation", "！");
  assert.equal(issue.replacement, "！　");
}
// 行末と閉じ括弧の前は空けない。
expectNone("待って！\n次の行。", "punctuation");
expectNone("「待って！」と叫んだ。", "punctuation");

// --- 6. 表記のゆれ ------------------------------------------------------------
{
  const text = "打ち合わせを設定した。打ち合わせの前に打合せ資料を配る。";
  const issue = expectOne(text, "notation-variants", "打合せ");
  assert.equal(issue.replacement, "打ち合わせ");
}
expectNone("打ち合わせを二回開いた。打ち合わせは短かった。", "notation-variants");
{
  const text = "第1章と第2章を読み、第３章は飛ばした。";
  const issue = expectOne(text, "notation-variants", "３");
  assert.equal(issue.replacement, "3");
}

// --- 7. 語句の誤用 ------------------------------------------------------------
{
  const issue = expectOne("彼には役不足の仕事だ。", "word-misuse", "役不足");
  assert.equal(issue.replacement, undefined, "意味の取り違えは置き換えでは直せない");
  assert.match(issue.message, /役目が軽すぎる/);
}
{
  const issue = expectOne("次こそ雪辱を晴らすつもりだ。", "word-misuse", "雪辱を晴らす");
  assert.equal(issue.replacement, "雪辱を果たす");
}
{
  const issue = expectOne("耳ざわりのよい話ばかりだ。", "word-misuse", "耳ざわりのよ");
  assert.match(issue.message, /耳に障る/);
}
// 誤用チェックは会話文の中でも働く。
expectOne("「役不足だな」と彼は言った。", "word-misuse", "役不足");

// --- 8. 敬語の誤り ------------------------------------------------------------
{
  const issue = expectOne("先生がお読みになられる。", "keigo", "お読みになられる");
  assert.equal(issue.replacement, "お読みになる");
}
{
  const issue = expectOne("会長がおっしゃられました。", "keigo", "おっしゃられました");
  assert.equal(issue.replacement, "おっしゃいました");
}
{
  const issue = expectOne("担当者にお聞きしてください。", "keigo", "お聞きしてください");
  assert.equal(issue.replacement, "お聞きください");
}
// 第三者へ依頼する「お願いしてください」は誤りではない。
expectNone("彼にお願いしてください。", "keigo");
// 指針が定着した二重敬語として挙げる形は指摘しない。
expectNone("お召し上がりになるところです。", "keigo");
// 敬語チェックも会話文の中で働く。
expectOne("「どうぞお使いになられてください」", "keigo", "お使いになられて");
// 1回や2回の「させていただく」は誤りではない。
expectNone("本日は発表させていただきます。", "keigo");
{
  const text = "発表させていただきます。説明させていただきます。配布させていただきます。";
  const issues = byRule(text, "keigo");
  assert.equal(issues.length, 3);
  assert.match(issues[0].message, /3か所/);
}

// --- 9. 文体の混在 ------------------------------------------------------------
{
  const text = [
    "これは試験です。",
    "内容は次のとおりです。",
    "手順は三つあります。",
    "まず準備します。",
    "最後に確認である。",
  ].join(NL);
  const issues = byRule(text, "style-consistency");
  assert.equal(issues.length, 1);
  assert.equal(text.slice(issues[0].from, issues[0].to), "最後に確認である。");
  assert.match(issues[0].message, /敬体4文・常体1文/);
}
// 短い断片では騒がない。
expectNone("これは試験です。確認である。", "style-consistency");
// 会話文の常体は地の文の文体と数えない。
expectNone(
  ["彼は言いました。", "「そうだ」", "私も答えました。", "外は雨です。", "話は続きます。"].join(NL),
  "style-consistency",
);

// --- 括弧の閉じ忘れ -----------------------------------------------------------
{
  const issue = expectOne("「そこまでだ" + NL + "次の行。", "punctuation", "「");
  assert.match(issue.message, /閉じられていない/);
}
expectNone("「そこまでだ」" + NL + "次の行。", "punctuation");

// --- 検査対象から外す範囲 -----------------------------------------------------
expectNone("```\n出来る\n```\n", "kanji-opening");
expectNone("｜見《み》れる", "colloquial");
expectNone("詳細は https://example.com/a...b を参照。", "punctuation");

// --- オフセットの整合 ---------------------------------------------------------
{
  const text = "彼は出来るだけ早く来ると言った。まず最初に確認する。\n見れると思う。";
  for (const issue of scan(text).issues) {
    assert.equal(text.slice(issue.from, issue.to).replace(/\s+/g, " "), issue.excerpt.match);
    assert.ok(issue.line >= 1 && issue.column >= 1);
  }
}

console.log("proofread rules OK");
