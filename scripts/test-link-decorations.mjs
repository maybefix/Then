import assert from "node:assert/strict";
import { build } from "esbuild";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

// BINDER 3-2（docs/BINDER_LINK_SYNTAX_PLAN.md）のエディタ側のリンク。
// 1行ずつ読む入口が全文の findLinks と同じ規則であること、装飾の範囲、行き先の
// 見分け（ない・1つ・2つ以上・まだ分からない）、押したときに開く先、候補の絞り込み。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/links/linkSyntax.ts"; export * from "./src/links/linkIndex.ts"; export * from "./src/editor/linkDecorations.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const {
  findLinks, findLinksInLine, LinkIndex,
  linkSpansInLine, namesCountedOn, linkDestination, linkOpenTarget, suggestNames, suggestQueryAt,
  linkPressAction, suggestOpensAfterInsert, typedTextOf, createLinkLookup,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

// 1. 1行ずつの入口が、全文の規則と同じ結果を出す
{
  const docs = [
    "---\nmaterials: [\"[[汐見]]\"]\n---\n本文の [[汐見]] は数えない\n// メモ [[汐見]] と @[[素材/地図.png]]\n",
    "ノートの1行目 [[汐見|彼女]]\n2行目 [[灯台#過去]] と [[  ]] と [[a [[b]]\n",
    "閉じない [[汐見\n次の行 ]] は別\r\n// CRLF の行 [[汐見]]\r\n",
    "@[[素材/資料/地図.png]] は全行で数える\n[[名前]] は原稿の本文では数えない\n",
    "```\n// コードの中 [[汐見]]\n```\n\\// 打ち消し [[灯台]]\n",
    "リンクなし",
    "",
  ];
  for (const isNote of [false, true]) {
    for (const text of docs) {
      const whole = findLinks(text, isNote).map((link) => `${link.kind}:${link.target}:${link.fullFrom}-${link.fullTo}`);
      // 同じ規則を行ごとに当てた結果（フロントマターの行はノートと同じ扱い）
      const perLine = [];
      let offset = 0;
      let metadata = /^---\r?\n/.test(text);
      let first = true;
      for (const line of text.split("\n")) {
        const bare = line.replace(/\r$/, "");
        const inFrontMatter = metadata && !first && !/^---\s*$/.test(bare) ? true : metadata && first;
        const names = isNote || inFrontMatter || /^[ \u3000\t]*\/\//.test(bare);
        for (const link of findLinksInLine(line, names)) {
          perLine.push(`${link.kind}:${link.target}:${link.fullFrom + offset}-${link.fullTo + offset}`);
        }
        if (metadata && !first && /^---\s*$/.test(bare)) metadata = false;
        first = false;
        offset += line.length + 1;
      }
      assert.deepEqual(perLine, whole, `行ごとの規則が全文と違う（isNote=${isNote}）: ${JSON.stringify(text)}`);
    }
  }
}

// 2. 装飾の範囲は記法のまるごと（@ と括弧を含む）
{
  const spans = linkSpansInLine("メモ [[汐見|彼女]] と @[[素材/地図.png]]", true);
  assert.deepEqual(spans.map((span) => [span.from, span.to, span.kind, span.target]), [
    [3, 12, "name", "汐見"],
    [15, 29, "path", "素材/地図.png"],
  ]);
  const manuscript = (source) => linkSpansInLine(source, namesCountedOn(false, source)).map((span) => span.target);
  const note = (source) => linkSpansInLine(source, namesCountedOn(true, source)).map((span) => span.target);
  assert.deepEqual(manuscript("本文の [[汐見]]"), [], "原稿の本文の行は数えない");
  assert.deepEqual(manuscript("// メモ [[汐見]]"), ["汐見"], "原稿の // の行は数える");
  assert.deepEqual(manuscript("　// 字下げでも [[汐見]]"), ["汐見"], "字下げのある // の行も数える");
  assert.deepEqual(manuscript("\\// 打ち消した行の [[汐見]]"), [], "\\// の行は本文なので数えない");
  assert.deepEqual(manuscript("本文の @[[素材/地図.png]]"), ["素材/地図.png"], "@[[パス]] は原稿の本文でも数える");
  assert.deepEqual(note("ノートの本文の [[汐見]]"), ["汐見"], "ノートは全行で数える");
}

// 3. 行き先の見分けと、押したときに開く先
{
  const ROOT = "C:\\Novel";
  const p = (relative) => `${ROOT}\\${relative.split("/").join("\\")}`;
  const index = new LinkIndex(ROOT);
  const stamps = [
    { path: p("第一章.md"), kind: "text", modifiedAt: 1, size: 10, role: null },
    { path: p("素材/汐見.md"), kind: "text", modifiedAt: 1, size: 10, role: "material" },
    { path: p("素材/人物/汐見.md"), kind: "text", modifiedAt: 1, size: 10, role: "material" },
    { path: p("素材/灯台.md"), kind: "text", modifiedAt: 1, size: 10, role: "material" },
    { path: p("素材/地図.png"), kind: "asset", modifiedAt: 1, size: 10, role: "material" },
  ];
  await index.refresh(stamps, async () => "", () => null);

  assert.equal(linkDestination(null, { kind: "name", target: "汐見" }), "unknown", "索引がなければ分からない");
  assert.equal(linkDestination(index, { kind: "name", target: "灯台" }), "one");
  assert.equal(linkDestination(index, { kind: "name", target: "汐見" }), "many", "同じ名前が2つ");
  assert.equal(linkDestination(index, { kind: "name", target: "いない人" }), "none");
  assert.equal(linkDestination(index, { kind: "path", target: "素材/地図.png" }), "one", "画像も行き先になる");
  assert.equal(linkDestination(index, { kind: "path", target: "素材/ない.png" }), "none");

  assert.deepEqual(linkOpenTarget(index, { kind: "name", target: "灯台" }), { path: p("素材/灯台.md"), choices: [] });
  assert.deepEqual(linkOpenTarget(index, { kind: "name", target: "いない人" }), { path: null, choices: [] });
  assert.deepEqual(linkOpenTarget(null, { kind: "name", target: "灯台" }), { path: null, choices: [] },
    "索引がまだなければ開かない");
  const ambiguous = linkOpenTarget(index, { kind: "name", target: "汐見" });
  assert.equal(ambiguous.path, null, "2つ以上は勝手に開かない");
  // 直すときに書く名前（そのファイルだけを指す、いちばん短い形）を一緒に返す
  assert.deepEqual(ambiguous.choices.map((choice) => choice.name), ["素材/汐見", "人物/汐見"]);
  assert.deepEqual(ambiguous.choices.map((choice) => choice.path), [p("素材/汐見.md"), p("素材/人物/汐見.md")]);

  // 4. 候補はこの作品のノートだけ（原稿も画像も出さない）
  assert.deepEqual(index.noteNames().map((item) => item.name), ["人物/汐見", "素材/汐見", "灯台"]);
  assert.deepEqual(suggestNames(index, "し").map((item) => item.name), [], "名前の先頭から絞り込む（読みでは引かない）");
  assert.deepEqual(suggestNames(index, "汐").map((item) => item.name), ["人物/汐見", "素材/汐見"],
    "フォルダ付きの名前も、ファイル名の側で絞り込める");
  assert.deepEqual(suggestNames(index, "人物/").map((item) => item.name), ["人物/汐見"]);
  assert.deepEqual(suggestNames(index, "").map((item) => item.name), ["人物/汐見", "素材/汐見", "灯台"]);
  assert.deepEqual(suggestNames(null, "汐"), [], "索引がまだなければ候補を出さない");
}

// 5. 候補を出す位置（`[[` のあとだけ。閉じたあとや別の行では出さない）
{
  assert.deepEqual(suggestQueryAt("メモ [[汐", 6), { from: 5, to: 6, query: "汐" });
  assert.deepEqual(suggestQueryAt("メモ [[", 5), { from: 5, to: 5, query: "" }, "打った直後は全部の候補");
  assert.deepEqual(suggestQueryAt("メモ [[汐見]] のこと", 12), null, "閉じたあとでは出さない");
  assert.deepEqual(suggestQueryAt("メモ [汐", 5), null, "括弧が1つでは出さない");
  assert.deepEqual(suggestQueryAt("メモ [[汐見|彼", 9), null, "表示名の側では出さない");
  assert.deepEqual(suggestQueryAt("@[[素材/地図", 8), null, "@[[パス]] では出さない");
  assert.deepEqual(suggestQueryAt("メモ [[汐見", 5), { from: 5, to: 5, query: "" },
    "名前の途中にカーソルがあるときは、その手前までで絞り込む");
}

// 6. 押したときの決まり（確認1の決定1B）
{
  const press = (over) => linkPressAction({
    caretLine: 3, pressedLine: 7, ctrl: false, moved: 0, detail: 1, selectionEmpty: true, ...over,
  });
  assert.equal(press({}), "open", "別の行のリンクはクリックで開く");
  assert.equal(press({ caretLine: 7 }), "caret", "カーソルがその行にあるときは、開かずにカーソルを置く");
  assert.equal(press({ caretLine: 7, ctrl: true }), "open", "Ctrl を押していれば同じ行でも開く");
  assert.equal(press({ moved: 12 }), "none", "押して引いたとき（文字を選ぶ）は開かない");
  assert.equal(press({ detail: 2 }), "none", "ダブルクリックは開かない（語の選択）");
  assert.equal(press({ selectionEmpty: false }), "none", "文字を選んでいるときは開かない");
}

// 7. 候補が開く打ち方（[[ を打ち終えた直後だけ）
{
  assert.equal(suggestOpensAfterInsert("[", "メモ [[", 5), true, "2つめの [ を打ったら開く");
  assert.equal(suggestOpensAfterInsert("[[", "メモ [[", 5), true, "まとめて入っても開く");
  assert.equal(suggestOpensAfterInsert("[", "メモ [", 4), false, "1つめの [ では開かない");
  assert.equal(suggestOpensAfterInsert("汐", "メモ [[汐", 6), false, "名前を打っている途中では開き直さない");
  assert.equal(suggestOpensAfterInsert("[", "メモ [[汐見]]", 5), true, "既存のリンクの前でも、[[ を打ち終えたら開く");
}

// 7b. 打った文字は transaction から読む。エディタの差分（変わった行の全体と改行）では
// 最後の行の末尾でしか `[` で終わらず、候補が開かなかった（2026-11-17 の不具合）。
{
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
  const p = (text) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
  const state = EditorState.create({ schema, doc: schema.node("doc", null, [p("// メモ と。"), p("次の行")]) });
  // 1行目の「と」のあと（行の途中、下にも行がある）に [ を2回打つ
  const at = 1 + "// メモ と".length;
  const first = state.tr.insertText("[", at);
  assert.equal(typedTextOf(first), "[");
  const second = first.doc && state.apply(first).tr.insertText("[", at + 1);
  assert.equal(typedTextOf(second), "[");
  const line = second.doc.child(0).textContent;
  assert.equal(suggestOpensAfterInsert(typedTextOf(second), line, "// メモ と[[".length), true, "行の途中で [[ を打っても開く");
  assert.equal(typedTextOf(state.tr.delete(at - 1, at)), "", "消しただけなら何も打っていない");
  assert.equal(typedTextOf(state.tr.insertText("灯台", at)), "灯台");
}

// 8. 引き口（同じ名前は1回しか索引に聞かない）
{
  const asked = [];
  const fake = {
    candidatesFor: (link) => { asked.push(link.target); return link.target === "灯台" ? ["C:/w/灯台.md"] : []; },
    noteNames: () => [{ name: "灯台", path: "C:/w/灯台.md" }],
    shortestName: () => null,
  };
  const lookup = createLinkLookup(fake, true);
  assert.equal(lookup.isNote, true);
  assert.equal(lookup.destination("name", "灯台"), "one");
  assert.equal(lookup.destination("name", "灯台"), "one");
  assert.equal(lookup.destination("name", "いない"), "none");
  assert.deepEqual(asked, ["灯台", "いない"], "同じ名前は覚えておく");
  assert.deepEqual(lookup.names("灯").map((item) => item.name), ["灯台"]);
  const empty = createLinkLookup(null, false);
  assert.equal(empty.destination("name", "灯台"), "unknown", "索引がまだなければ濃いまま描く");
  assert.deepEqual(empty.names(""), []);
}

console.log("link decoration tests passed");
