import assert from "node:assert/strict";
import { build } from "esbuild";

// BINDER 3-5 の素の名前の規則（docs/BINDER_NOTE_MENTIONS_PLAN.md の決定2・3a・3b）を、規則の関数を直接呼んで確かめる。
// どこを数えるか（本文の行だけ、外した場所は前後をつながない、記法は親文字）、重なる名前、短い名前、英字、重さ。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/links/noteMentions.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { prepareMentionText, countMentions, mentionKey, canMention } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const count = (text, names) => Object.fromEntries(countMentions(prepareMentionText(text), names));

// 1. 本文の行だけ数える
{
  const text = [
    "---",
    "synopsis: 汐見が札を裏返す",
    'materials: ["[[汐見]]"]',
    "---",
    "# 汐見の朝",
    "汐見は窓口の札を裏返した。「汐見さん」と呼ばれた。",
    "// メモ: 汐見の台詞を直す",
    "  // 字下げしたコメント 汐見",
    "<!-- 汐見 -->",
    "<!--",
    "汐見（複数行のコメント）",
    "-->",
    "```",
    "汐見（コードブロック）",
    "```",
    "行内コード `汐見` は数えない。@[[素材/汐見.md]] も数えない。",
    "本文の [[汐見]] は見た目どおり1か所。",
  ].join("\r\n");
  assert.deepEqual(count(text, ["汐見"]), { 汐見: 4 }, "見出し・本文・会話文・通常の行の [[ ]] だけ（フロントマター・コメント・コード・@[[パス]] は数えない）");
}

// 2. 閉じていないコメント・コードブロックは、エディタ（classifyLines）と同じく本文のまま
{
  assert.deepEqual(count("<!-- 汐見\n汐見", ["汐見"]), { 汐見: 2 }, "閉じていない <!-- はコメントにならない");
  assert.deepEqual(count("汐見\n```\n汐見\n汐見", ["汐見"]), { 汐見: 3 }, "閉じていないフェンスはコードにならない");
}

// 3. 外した場所の前後をつながない
{
  assert.deepEqual(count("汐@[[素材/別.md]]見", ["汐見"]), {}, "@[[パス]] を外しても前後はつながらない");
  assert.deepEqual(count("汐`x`見", ["汐見"]), {}, "行内コードを外しても前後はつながらない");
  assert.deepEqual(count("汐\n// メモ\n見", ["汐見"]), {}, "コメント行を外しても前後の行はつながらない");
  assert.deepEqual(count("汐\n見", ["汐見"]), {}, "改行をまたがない");
  assert.deepEqual(count("汐［＃改ページ］見", ["汐見"]), {}, "注記を外しても前後はつながらない");
  assert.deepEqual(count("汐![図](a.png)見", ["汐見"]), {}, "画像を外しても前後はつながらない");
}

// 4. ルビ・傍点・縦中横・青空文庫形式は親文字で。読みは数えない
{
  const text = [
    "[汐見(rb,しおみ)]は言った。",
    "[汐(rb,しお)][見(rb,み)]は言った。",
    "｜汐見《しおみ》と汐見《しおみ》。",
    "《《汐見》》と[汐見(em)]と**汐見**。",
    "[汐見(rb,しお み)]。",
  ].join("\n");
  assert.deepEqual(count(text, ["汐見", "しおみ"]), { 汐見: 8 }, "親文字で見つけ、読みの「しおみ」は数えない");
  assert.deepEqual(count("[AB(tcy)]CD", ["ABCD"]), { abcd: 1 }, "縦中横も前後とつながる");
}

// 5. 重なる名前: 文書全体で長い名前から先に当て、二重に取らない。同じ長さなら前にあるほう
{
  assert.deepEqual(count("汐見ミナと汐見", ["汐見", "汐見ミナ"]), { 汐見: 1, 汐見ミナ: 1 }, "頭のそろう重なり");
  assert.deepEqual(count("港町灯台守", ["港町", "町灯台守"]), { 町灯台守: 1 }, "ずれた重なり: 長いほう（左から読む正規表現なら「港町」になる）");
  assert.deepEqual(count("あいう", ["あい", "いう"]), { あい: 1 }, "同じ長さの重なり: 前にあるほう");
  assert.deepEqual(count("ああああ", ["ああ"]), { ああ: 2 }, "同じ名前の重なりも二重に取らない");
}

// 6. 短い名前・英字
{
  assert.equal(canMention("灯"), false);
  assert.equal(canMention("汐見"), true);
  assert.deepEqual(count("灯台の灯が見えた。", ["灯"]), {}, "1文字の名前は数えない");
  assert.deepEqual(count("Ann met Anne. ANN and ann_x and 2Ann. 「Ann」", ["Ann"]), { ann: 3 }, "英字は語の切れ目だけ。大文字・小文字は区別しない");
  assert.equal(mentionKey("Ann"), mentionKey("ANN"));
  assert.deepEqual(count("Ann", ["Ann", "ANN"]), { ann: 1 }, "大小だけ違う名前を二重に数えない");
  assert.deepEqual(count("Ｓｈｉｏ", ["Shio"]), {}, "全角・半角は同じとみなさない");
  assert.deepEqual(count("ミナはみなと", ["ミナ"]), { ミナ: 1 }, "ひらがな・カタカナは同じとみなさない");
}

// 7. CRLF と BOM
{
  assert.deepEqual(count("﻿---\r\ntitle: 汐見\r\n---\r\n汐見\r\n汐見", ["汐見"]), { 汐見: 2 });
}

// 8. 重さ（時間を出すだけ。落とす閾値は置かない）
{
  const line = "汐見は窓口の札を裏返し、潮風で白く曇ったガラスを拭いた。「午後四時ね」と[汐見(rb,しおみ)]は言った。汐見ミナが汽笛を聞いた。";
  const make = (size) => {
    let text = "";
    for (let index = 0; text.length < size; index += 1) text += (index % 25 === 0 ? "// メモ 汐見\r\n" : "") + line + "\r\n";
    return text;
  };
  const names = ["汐見", "汐見ミナ", ...Array.from({ length: 98 }, (_, index) => `人物${index}`)];
  const median = (run) => {
    const times = [];
    for (let round = 0; round < 7; round += 1) {
      const started = performance.now();
      run();
      times.push(performance.now() - started);
    }
    return times.sort((left, right) => left - right)[3];
  };
  const one = make(100_000);
  const prepared = prepareMentionText(one);
  const work = Array.from({ length: 50 }, () => make(20_000));
  const preparedWork = work.map(prepareMentionText);
  const save = median(() => countMentions(prepareMentionText(one), names));
  const recount = median(() => preparedWork.forEach((text) => countMentions(text, names)));
  const fromDisk = median(() => work.forEach((text) => countMentions(prepareMentionText(text), names)));
  assert.equal(Object.fromEntries(countMentions(prepared, names)).汐見ミナ > 0, true);
  console.log(
    `10万字の原稿1本・名前100: 下ごしらえ＋数える ${save.toFixed(1)}ms／50ファイル・100万字を持っている本文で数え直す ${recount.toFixed(1)}ms／下ごしらえから ${fromDisk.toFixed(1)}ms`,
  );
}

console.log("note mentions tests passed");
