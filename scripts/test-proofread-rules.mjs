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

const {
  runProofread,
  DEFAULT_PROOFREAD_OPTIONS,
  PROOFREAD_RULES,
  parseProofreadTermInput,
  mergeProofreadTerms,
  normalizeProofreadTerms,
  collectProtectedSurfaces,
  sortProofreadTerms,
  validateTermSurface,
  updateProofreadTerm,
  retargetProofreadTerm,
  formatProofreadTermsForExport,
  collectTermCandidates,
  IJIDOKUN_GROUPS,
  IJIDOKUN_ITEMS,
  IJIDOKUN_EXTRA_CUES,
} = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);

/** 生成時に実改行が紛れ込まないよう、改行は定数で組み立てる。 */
const NL = String.fromCharCode(10);

const scan = (text, overrides = {}, terms = []) =>
  runProofread(text, { ...DEFAULT_PROOFREAD_OPTIONS, ...overrides }, PROOFREAD_RULES, terms);

/** 一括入力と同じ書式から辞書を組み立てる小さな入口。 */
const dictionary = (...lines) => parseProofreadTermInput(lines.join(NL), "project").terms;

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
assert.equal(PROOFREAD_RULES.length, 13, "13種類のルールを保つ");
for (const rule of PROOFREAD_RULES) {
  assert.ok(rule.sources.length > 0, `${rule.id} must carry a citation`);
  assert.equal(typeof rule.wordScoped, "boolean", `${rule.id} must say what it points at`);
  for (const source of rule.sources) {
    assert.ok(source.title && source.publisher && source.locator && source.basis);
  }
}

// 文全体を指すルールは、その範囲を辞書に登録させない。
assert.deepEqual(
  PROOFREAD_RULES.filter((rule) => !rule.wordScoped).map((rule) => rule.id).sort(),
  ["nlp-dependency", "sentence-flow", "style-consistency"],
);

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
// 閉じ括弧のない行は、段落をまたぐ台詞の書き方とみなして咎めない。
expectNone("「そこまでだ" + NL + "次の行。", "punctuation");
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

// --- 校正辞書 ----------------------------------------------------------------
{
  const input = [
    "# 覚書の行は飛ばす",
    "橘沙耶	たちばなさや	人物",
    "エルディア,,地名",
    "サーバ管理課",
    "見積システム		組織	守る",
    "魔導		用語	揃える",
    "",
    "「かぎ括弧入り」",
    "橘沙耶",
  ].join(NL);
  const parsed = parseProofreadTermInput(input, "project");

  assert.deepEqual(
    parsed.terms.map((term) => [term.surface, term.reading, term.kind, term.policy]),
    [
      ["橘沙耶", "たちばなさや", "person", "protect"],
      ["エルディア", "", "place", "protect"],
      ["サーバ管理課", "", "other", "protect"],
      ["見積システム", "", "org", "protect"],
      ["魔導", "", "term", "unify"],
    ],
  );
  assert.equal(parsed.rejected.length, 2, "括弧入りと重複行は理由つきで弾く");
  assert.ok(parsed.terms.every((term) => term.scope === "project"));
}

// 既存の語は、入力側で埋まっている欄だけ上書きする。
{
  const base = parseProofreadTermInput("橘沙耶	たちばなさや	人物", "project").terms;
  const incoming = parseProofreadTermInput("橘沙耶			揃える", "project").terms;
  const merged = mergeProofreadTerms(base, incoming);
  assert.equal(merged.terms.length, 1);
  assert.equal(merged.added, 0);
  assert.equal(merged.updated, 1);
  assert.equal(merged.terms[0].reading, "たちばなさや", "空欄で読みを消さない");
  assert.equal(merged.terms[0].kind, "person", "種別「その他」で既存を上書きしない");
  assert.equal(merged.terms[0].policy, "unify");
}

// 壊れた保存データは落とす。
{
  const restored = normalizeProofreadTerms(
    [
      { id: "a", surface: "橘沙耶", kind: "person", policy: "both" },
      { surface: "" },
      { surface: "「だめ」" },
      null,
      { id: "b", surface: "橘沙耶" },
    ],
    "global",
  );
  assert.equal(restored.length, 1);
  assert.equal(restored[0].scope, "global");
  assert.equal(restored[0].policy, "both");
}

// 「守る」の語だけを、長い順に集める。
{
  const terms = parseProofreadTermInput(
    ["見積			守る", "見積システム			守る", "魔導			揃える"].join(NL),
    "project",
  ).terms;
  assert.deepEqual(collectProtectedSurfaces(terms), ["見積システム", "見積"]);
}

// --- 辞書で守った語は、どのルールも触らない -----------------------------------
{
  const text = "サーバ管理課に連絡した。サーバーの設定を見直す。";
  assert.ok(
    byRule(text, "notation-variants").length > 0,
    "辞書なしでは組織名がカタカナ長音のゆれとして拾われる",
  );
  assert.equal(
    scan(text, {}, dictionary("サーバ管理課")).issues.filter(
      (issue) => issue.ruleId === "notation-variants",
    ).length,
    0,
    "守った語は表記ゆれの数にも入らない",
  );
}
{
  const text = "破天荒な暮らしを続けた。";
  assert.equal(byRule(text, "word-misuse").length, 1);
  assert.equal(
    scan(text, {}, dictionary("破天荒")).issues.filter((issue) => issue.ruleId === "word-misuse")
      .length,
    0,
  );
}
// 会話文の中でも守りは効く。
{
  const text = "「破天荒な人だ」と彼は言った。";
  assert.equal(
    scan(text, {}, dictionary("破天荒")).issues.filter((issue) => issue.ruleId === "word-misuse")
      .length,
    0,
  );
}
// 長い語を先に伏せるので、短い語が部分一致で残らない。
{
  const text = "見積システムを入れた。見積もりを出す。見積を確認する。";
  const issues = scan(text, {}, dictionary("見積システム")).issues.filter(
    (issue) => issue.ruleId === "notation-variants",
  );
  assert.ok(
    issues.every((issue) => issue.from >= text.indexOf("見積もり")),
    "組織名の中の「見積」は表記ゆれとして数えない",
  );
}
// 守った語は一文の長さや読点の数には影響しない。
{
  const name = "橘沙耶";
  const text = `${name}${"あ".repeat(90)}。`;
  const withDict = scan(text, {}, dictionary(name)).issues.filter(
    (issue) => issue.ruleId === "sentence-flow",
  );
  assert.equal(withDict.length, 1);
  assert.match(withDict[0].message, /一文が94字/, "伏せた語も文の長さには数える");
}

// --- 辞書の編集 --------------------------------------------------------------
{
  const terms = parseProofreadTermInput(
    ["橘沙耶	たちばなさや	人物", "エルディア		地名"].join(NL),
    "project",
  ).terms;

  assert.equal(validateTermSurface("新しい語", terms), null);
  assert.match(validateTermSurface("  ", terms) ?? "", /表記を入力/);
  assert.match(validateTermSurface("「だめ」", terms) ?? "", /鉤括弧/);
  assert.match(validateTermSurface("エルディア", terms) ?? "", /すでに/);
  assert.equal(
    validateTermSurface("エルディア", terms, terms[1].id),
    null,
    "自分自身は重複として弾かない",
  );

  const edited = updateProofreadTerm(terms, terms[0].id, {
    surface: " 橘紗耶 ",
    note: "第2稿で改名",
  });
  assert.equal(edited[0].surface, "橘紗耶", "前後の空白は落とす");
  assert.equal(edited[0].reading, "たちばなさや", "触れていない欄は残す");
  assert.equal(edited[0].note, "第2稿で改名");
  assert.ok(edited[0].updatedAt >= terms[0].updatedAt);

  const moved = retargetProofreadTerm(terms[0], "global");
  assert.equal(moved.scope, "global");
  assert.equal(moved.id, terms[0].id, "移動しても同じ語として扱う");
}

// 並び順。
{
  const terms = parseProofreadTermInput(["さくら", "あかり", "なつめ"].join(NL), "global").terms;
  assert.deepEqual(
    sortProofreadTerms(terms, "surface").map((term) => term.surface),
    ["あかり", "さくら", "なつめ"],
  );
  const stamped = terms.map((term, index) => ({ ...term, updatedAt: index }));
  assert.deepEqual(
    sortProofreadTerms(stamped, "recent").map((term) => term.surface),
    ["なつめ", "あかり", "さくら"],
  );
}

// 書き出しと読み込みで内容が保たれる（覚書は行末の注記なので取り込み時は無視する）。
{
  const source = parseProofreadTermInput(
    ["橘沙耶	たちばなさや	人物	両方", "魔導		用語	揃える"].join(NL),
    "project",
  ).terms;
  const withNote = updateProofreadTerm(source, source[0].id, { note: "主人公" });
  const exported = formatProofreadTermsForExport(withNote);
  assert.match(exported, /# 主人公/);

  const restored = parseProofreadTermInput(exported, "project").terms;
  assert.deepEqual(
    restored.map((term) => [term.surface, term.reading, term.kind, term.policy]),
    [
      ["橘沙耶", "たちばなさや", "person", "both"],
      ["魔導", "", "term", "unify"],
    ],
  );
}

// --- 指摘から辞書へ ----------------------------------------------------------
// 指摘の抜粋をそのまま辞書に入れると守れることを、実際の指摘で確かめる。
{
  const text = "破天荒な暮らしを続けた。";
  const [issue] = byRule(text, "word-misuse");
  assert.equal(issue.excerpt.match, "破天荒");

  const added = parseProofreadTermInput(issue.excerpt.match, "project").terms;
  assert.equal(added.length, 1);
  assert.equal(added[0].policy, "protect", "指摘を黙らせるために足すので既定は守る");

  assert.equal(
    scan(text, {}, added).issues.filter((item) => item.ruleId === "word-misuse").length,
    0,
  );
}
// 抜粋より広い範囲を登録しても、そのまま守りに効く。
{
  const text = "サーバ管理課に連絡した。サーバーの設定を見直す。";
  const [issue] = byRule(text, "notation-variants");
  assert.equal(issue.excerpt.match, "サーバ", "指摘そのものは短い語を指している");

  const widened = parseProofreadTermInput("サーバ管理課", "project").terms;
  assert.equal(
    scan(text, {}, widened).issues.filter((item) => item.ruleId === "notation-variants").length,
    0,
    "書き足した範囲で守れる",
  );
}

// --- 10. 辞書の表記ゆれ -------------------------------------------------------
const unify = (ruleId, text, terms) =>
  scan(text, {}, terms).issues.filter((issue) => issue.ruleId === ruleId);

// 「守る」だけの語では揃えのルールは動かない。
assert.equal(unify("dictionary-unify", "橘紗耶が来た。", dictionary("橘沙耶")).length, 0);

{
  const terms = dictionary("橘沙耶	たちばなさや	人物	揃える	橘紗耶/立花沙耶");
  assert.deepEqual(terms[0].variants, ["橘紗耶", "立花沙耶"]);

  const issues = unify("dictionary-unify", "橘紗耶と立花沙耶と橘沙耶。", terms);
  assert.equal(issues.length, 2);
  assert.deepEqual(
    issues.map((issue) => [issue.excerpt.match, issue.replacement]),
    [
      ["橘紗耶", "橘沙耶"],
      ["立花沙耶", "橘沙耶"],
    ],
  );
}

// 決めた表記の一部に別表記が含まれても、正しい方には当たらない。
{
  const terms = dictionary("モーター		用語	揃える	モータ");
  const issues = unify("dictionary-unify", "モーターを点検する。モータも点検する。", terms);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].from, "モーターを点検する。".length);
}

// 別表記が「守る」の語に含まれるときは、そちらが優先される。
{
  const terms = [
    ...dictionary("モーター		用語	揃える	モータ"),
    ...dictionary("モータ制御部		組織	守る"),
  ];
  assert.equal(unify("dictionary-unify", "モータ制御部に配属された。", terms).length, 0);
}

// ルビの読みが辞書と食い違う。
{
  const terms = dictionary("黒衣	くろご	用語	揃える");
  const issues = unify("dictionary-unify", "｜黒衣《こくい》の男が立つ。", terms);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /読みは辞書では「くろご」/);
  assert.equal(issues[0].replacement, undefined);
}
expectNone("｜黒衣《くろご》の男が立つ。", "dictionary-unify");

// 同じ読みに違う字が当たっている（変換ミス）。
{
  const terms = dictionary("橘沙耶	たちばなさや	人物	揃える");
  const issues = unify("dictionary-unify", "｜橘紗耶《たちばなさや》が振り返る。", terms);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].excerpt.match, "橘紗耶");
  assert.equal(issues[0].replacement, "橘沙耶");
}

// Then記法のルビでも同じように働く。
{
  const terms = dictionary("橘沙耶	たちばなさや	人物	揃える");
  const issues = unify("dictionary-unify", "[橘紗耶(rb,たちばなさや)]が笑う。", terms);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].excerpt.match, "橘紗耶");
}

// 会話文の中も見る。
{
  const terms = dictionary("魔導		用語	揃える	魔道");
  assert.equal(unify("dictionary-unify", "「魔道を学ぶ」と言った。", terms).length, 1);
}

// 別表記の列は書き出しにも残り、読み戻せる。
{
  const terms = dictionary("橘沙耶	たちばなさや	人物	両方	橘紗耶/立花沙耶");
  const restored = parseProofreadTermInput(
    formatProofreadTermsForExport(terms),
    "project",
  ).terms;
  assert.deepEqual(restored[0].variants, ["橘紗耶", "立花沙耶"]);
  assert.equal(restored[0].policy, "both");
}

// --- 原稿からの候補抽出 -------------------------------------------------------
{
  const text = [
    "｜橘沙耶《たちばなさや》は席を立った。",
    "橘沙耶は窓を見た。",
    "田中さんが呼んでいる。",
    "エルディアの城は遠い。エルディアへ向かう。",
    "ドアを開けた。",
  ].join(NL);

  const found = collectTermCandidates(text, []);
  assert.deepEqual(
    found.map((candidate) => [candidate.surface, candidate.source, candidate.reading]),
    [
      ["橘沙耶", "ruby", "たちばなさや"],
      ["田中", "honorific", ""],
      ["エルディア", "katakana", ""],
    ],
  );
  assert.equal(found[0].count, 2, "ルビの読みは数に入れず、本文の出現だけ数える");
  assert.equal(found[1].kind, "person", "敬称つきは人物として拾う");
}

// 1度しか出てこない片仮名語は候補にしない。
{
  const found = collectTermCandidates("ドアを開けた。", []);
  assert.equal(found.length, 0);
}

// すでに辞書にある語と、その別表記は出さない。
{
  const text = "｜橘沙耶《たちばなさや》と橘紗耶。エルディアとエルディア。";
  const existing = parseProofreadTermInput(
    ["橘沙耶		人物	揃える	橘紗耶"].join(NL),
    "project",
  ).terms;
  assert.deepEqual(
    collectTermCandidates(text, existing).map((candidate) => candidate.surface),
    ["エルディア"],
  );
}

// コードブロックの中は拾わない。
{
  const found = collectTermCandidates(
    ["```", "エルディア", "エルディア", "```"].join(NL),
    [],
  );
  assert.equal(found.length, 0);
}

// --- 誤検出の洗い出し ---------------------------------------------------------
// 「の」は名詞をつなぐものだけを数える。接続助詞・指示語・準体助詞は数えない。
expectNone("ルールとは原理的に両立できないので、このモードのときは無効になる。", "sentence-flow");
expectNone("その流れであんまり有益ではなかったので、この件はここまで。", "sentence-flow");
expectNone("彼が来るのが分かるのは、それを見るのが好きだからだ。", "sentence-flow");
expectNone("もののあはれというものの見方があるものの、それはそれだ。", "sentence-flow");
// 名詞の連なりは従来どおり拾う（建議が例に挙げている形）。
{
  const issue = expectOne("本年の当課の取組の中心は広報である。", "sentence-flow", "の当課の取組の");
  assert.match(issue.message, /「の」が3回/);
}
expectOne("私の友人の兄の車が止まっている。", "sentence-flow", "の友人の兄の");

// 「やってみたい」の「みたい」は補助動詞。
expectNone("一度やってみたいと思っていた。", "colloquial");
expectOne("子どもみたいな言い方だ。", "colloquial", "みたいな");

// 「初めて見る」は本動詞の「見る」。
expectNone("初めて見る景色だった。", "kanji-opening");
expectOne("一度やって見る価値はある。", "kanji-opening", "て見る");

// 段落をまたぐ台詞は、行頭の「を閉じないのが通例。閉じ括弧のない行は咎めない。
expectNone(["「ここから長い台詞が始まる。", "「そして次の段落へ続く。", "　最後はここで閉じる」"].join(NL), "punctuation");
// 同じ行の中で対応が取れていないものは拾う。
{
  const issue = expectOne("「ここは閉じた」そして「ここが開いたまま。", "punctuation", "「");
  assert.match(issue.message, /対応が取れていません/);
}
// 閉じ括弧だけの行も、段落をまたぐ台詞の結びなので咎めない。
expectNone("　最後はここで閉じる」", "punctuation");
expectOne("「開いた」あと、対応のない」がある。", "punctuation", "」");

// 送り仮名を省いた形が熟語の一部になっているものは、ゆれとして数えない。
expectNone("見積書を作る。見積もりを添える。", "notation-variants");
expectNone("手続法に沿う。手続きを進める。", "notation-variants");
// 熟語でなければ従来どおり拾う。
{
  const issue = expectOne("見積もりを出す。見積を確認する。", "notation-variants", "見積");
  assert.equal(issue.replacement, "見積もり");
}

// --- 検出項目ごとのオン・オフ ---------------------------------------------------
{
  const notation = PROOFREAD_RULES.find((rule) => rule.id === "notation-variants");
  assert.deepEqual(
    notation.checks.map((check) => check.id),
    [
      "notation-variants/okurigana",
      "notation-variants/width-digits",
      "notation-variants/width-alphabet",
      "notation-variants/width-space",
    ],
  );
  for (const check of notation.checks) assert.ok(check.name && check.summary);
}

// 数字の全角半角だけを止めても、送り仮名のゆれは残る。
{
  const text = "第1章と第３章を読み、打ち合わせと打合せを終えた。";
  const all = byRule(text, "notation-variants").map((issue) => issue.checkId);
  assert.ok(all.includes("notation-variants/width-digits"));
  assert.ok(all.includes("notation-variants/okurigana"));

  const withoutDigits = scan(text, {
    disabledChecks: ["notation-variants/width-digits"],
  }).issues.filter((issue) => issue.ruleId === "notation-variants");
  assert.ok(withoutDigits.every((issue) => issue.checkId !== "notation-variants/width-digits"));
  assert.ok(withoutDigits.some((issue) => issue.checkId === "notation-variants/okurigana"));
}

// 全角と半角の間の空きも、項目として止められる。
{
  const text = "Then は縦書きのエディタです。";
  assert.equal(
    byRule(text, "notation-variants").filter(
      (issue) => issue.checkId === "notation-variants/width-space",
    ).length,
    1,
  );
  assert.equal(
    scan(text, { disabledChecks: ["notation-variants/width-space"] }).issues.filter(
      (issue) => issue.ruleId === "notation-variants",
    ).length,
    0,
  );
}

// 異字同訓：活用、誤検出、保護範囲、設定を実際のエンジンで確認。
// 報告の全項目から手掛かり語を起こしているので、5組だけでなく各行の項目が動く。
assert.ok(IJIDOKUN_GROUPS.length >= 120, `報告の項目をほぼ網羅する: ${IJIDOKUN_GROUPS.length}`);
assert.ok(IJIDOKUN_GROUPS.reduce((total, group) => total + group.cues.length, 0) >= 900);
for (const group of IJIDOKUN_ITEMS) {
  assert.ok(group.variants.length >= 2, `${group.no} must offer a choice`);
  assert.ok(group.cues.length > 0, `${group.no} must carry cues`);
  const owner = new Map();
  for (const [role, word, variant, head] of group.cues) {
    assert.ok(word.length > 0 && role.length > 0);
    assert.ok(group.variants[variant]?.heads[head], `${group.no} cue ${word} points at a real head`);
    // 同じ語が同じ項目の複数の表記を指していたら、決め手にならない。
    const seen = owner.get(word);
    assert.ok(seen === undefined || seen === variant, `${group.no} cue ${word} must point at one spelling`);
    owner.set(word, variant);
  }
}
// 手で足した手掛かり語は、すべて実在する見出しに解決して表に載る。
{
  const byNo = new Map(IJIDOKUN_ITEMS.map((group) => [group.no, group]));
  for (const { no, role, word, head } of IJIDOKUN_EXTRA_CUES) {
    const group = byNo.get(no);
    assert.ok(group, `補いの項目 ${no} が見つからない`);
    const variant = group.variants.findIndex((entry) => entry.heads.includes(head));
    assert.ok(variant >= 0, `補いの見出し ${head}（${no}）が項目に無い`);
    assert.ok(
      group.cues.some((cue) => cue[0] === role && cue[1] === word && cue[2] === variant),
      `補い ${word}[${role}]→${head} が取り込まれていない（${no}）`,
    );
  }
}
for (const [text, matched, candidate] of [
  ["期待に答えたい。", "答え", "応える"],
  ["設問に応えた。", "応え", "答える"],
  ["暑いお茶を飲む。", "暑い", "熱い"],
  ["お茶が暑かった。", "暑かっ", "熱い"],
  ["喉が乾いた。", "乾い", "渇く"],
  // 用例が仮名書きでも漢字書きでも引ける。
  ["のどが乾いた。", "乾い", "渇く"],
  ["干し物が渇く。", "渇く", "乾く"],
  ["風邪を直したい。", "直し", "治す"],
  ["けがが直った。", "直っ", "治る"],
  ["怪我が直った。", "直っ", "治る"],
  ["機械を治そう。", "治そ", "直す"],
  ["前例に習って進める。", "習っ", "倣う"],
  ["ピアノを倣う。", "倣う", "習う"],
  // 先行実装の5組より外の項目。
  ["権利を犯す。", "犯す", "侵す"],
  ["感謝状を送る。", "送る", "贈る"],
  ["審議会に図る。", "図る", "諮る"],
  ["税を収める。", "収める", "納める"],
  ["アイデアが沸く。", "沸く", "湧く"],
  ["議長を勤める。", "勤める", "務める"],
  ["時代を写した言葉。", "写し", "映す"],
  ["犯人を上げる。", "上げる", "挙げる"],
  ["支度を整える。", "整える", "調える"],
  // 報告の用例に無い日常語は、語義に沿って足した手掛かり語で拾う。
  ["質問に応える。", "応える", "答える"],
  ["洗濯物が渇く。", "渇く", "乾く"],
  ["病気を直す。", "直す", "治す"],
  ["会社に務める。", "務める", "勤める"],
  ["司会を勤める。", "勤める", "務める"],
  ["絵を書く。", "書く", "描く"],
  ["ギターを引く。", "引く", "弾く"],
  ["コーヒーが暑い。", "暑い", "熱い"],
  // 名詞の項目は、複合や述語との組合せで見る。
  ["脚の裏を見る。", "脚", "足"],
  ["立つ鳥後を濁さず。", "後", "跡"],
]) {
  const issue = expectOne(text, "ijidokun", matched);
  assert.equal(issue.severity, "hint");
  assert.equal(issue.replacement, undefined);
  assert.ok(issue.message.includes(candidate), `${text}: ${issue.message}`);
  assert.match(issue.detail, /出典/);
}
for (const text of [
  "期待に応える。質問に答えた。", "熱いお茶。暑い部屋。厚い本。",
  "喉が渇いた。空気が乾く。", "風邪を治す。誤りを直す。",
  "前例に倣う。英語を習った。", "彼の答えを待つ。心が熱い。",
  "期待に、彼は答えた。", "期待に。答えた。", "期待に\n答える。",
  "暑いお茶会だった。", "無期待に答える。", "「期待に答える」と言った。",
  "`期待に答える`", "https://example.com/期待に答える",
  "｜言葉《期待に答える》", "[言葉(rb,期待に答える)]",
  ["```", "期待に答える", "```"].join(NL),
  // 広げた項目でも、正しい用法と複合語は静かにする。
  "権利を侵す。感謝状を贈る。審議会に諮る。税を納める。",
  "アイデアが湧く。議長を務める。犯人を挙げる。支度を調える。",
  "正直に話す。直接会う。素直な人。最後に行く。今後の予定。",
  "明らかに違う。上げ底の箱。荷物を引き上げる。",
  "都合が悪い。場合による。具合を見る。満足している。世の中の話。",
  "質問に答える。洗濯物が乾く。病気を治す。会社に勤める。司会を務める。",
  "絵を描く。ギターを弾く。コーヒーが熱い。夏は暑い。",
  // 用例で自動詞・他動詞が対になる項目は、形が対応しないと出さない。
  "国を立つ。",
]) expectNone(text, "ijidokun");
expectOne("「期待に答える」", "ijidokun", "答える", { skipDialogue: false });
expectNone("期待に答える。", "ijidokun", { disabledChecks: ["ijidokun/057"] });
expectOne("喉が乾く。", "ijidokun", "乾く", { disabledChecks: ["ijidokun/057"] });
assert.equal(scan("期待に答える。", {}, dictionary("期待に答える")).issues.filter(i => i.ruleId === "ijidokun").length, 0);
assert.equal(runProofread("期待に答える。", DEFAULT_PROOFREAD_OPTIONS, PROOFREAD_RULES.filter(r => r.id !== "ijidokun")).issues.filter(i => i.ruleId === "ijidokun").length, 0);
expectOne("😀\n期待に答える。", "ijidokun", "答える");
assert.equal(byRule("期待に答える。".repeat(250), "ijidokun").length, 200);

console.log("proofread rules OK");
