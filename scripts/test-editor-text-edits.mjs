import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// App.tsx から移した、本文の文字列を書き換える処理とアイコンの部品を、実際に動かして確かめる
// （docs/EDITOR_TEXT_EDITS_SEPARATION_PLAN.md）。期待値は、移す前の App.tsx の関数でも同じになる。
const root = process.cwd();
const outputDir = path.join(root, "test-artifacts", "editor-text-edits");
const outfile = path.join(outputDir, "editor-text-edits.mjs");
await mkdir(outputDir, { recursive: true });
await build({
  stdin: {
    contents: `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppIcon } from "./src/components/layout/AppIcon";
export * from "./src/editor/selectionEdits";
export * from "./src/search/editorFindReplace";
export { createDocumentAst } from "./src/editor/ast/documentAst";
export const renderIcon = (name, className) => renderToStaticMarkup(createElement(AppIcon, { name, className }));
`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  jsx: "automatic",
  outfile,
  external: ["react", "react-dom", "react/*", "react-dom/*", "@tauri-apps/api/*"],
  logLevel: "silent",
});
const m = await import(`${pathToFileURL(outfile).href}?${Date.now()}`);

const select = (text, from, to = from) => m.normalizeSelectionRange({ from, to }, text);
const ast = (text) => m.createDocumentAst({ text, path: "a.md" });

// 選択範囲は本文の長さに収め、開始と終了の順を整える。
assert.deepEqual(m.normalizeSelectionRange({ from: 5, to: 2 }, "abcdef"), { from: 2, to: 5, text: "cde" });
assert.deepEqual(m.normalizeSelectionRange({ from: -3, to: 99 }, "abc"), { from: 0, to: 3, text: "abc" });

assert.equal(m.canWrapInlineSelection({ from: 0, to: 2, text: "ab" }), true);
assert.equal(m.canWrapInlineSelection({ from: 1, to: 1, text: "" }), false);
assert.equal(m.canWrapInlineSelection({ from: 0, to: 3, text: "a\nb" }), false);

assert.equal(m.sanitizeNotationArgument(" と\nう]きょう) "), "と う きょう");

// 文章方向: 選択を含む各行の末尾に付け直す。行頭の >> とその後の空白は外れる（手順書 2-5 の癖4）。
assert.deepEqual(m.applyDirectionToSelection(">> 見出し", select(">> 見出し", 3), "center"), {
  from: 0,
  to: 6,
  insert: "見出し[(al:center)]",
  cursorPos: 16,
});
{
  const text = "A[(al:end)]\nB\nC";
  // 選択の末尾が改行の直後なら、その次の行は含めない。
  assert.deepEqual(m.applyDirectionToSelection(text, select(text, 0, 14), "start"), {
    from: 0,
    to: 13,
    insert: "A[(al:start)]\nB[(al:start)]",
    cursorPos: 27,
  });
}
// 旧来の地付き ［＃地付き］ も外してから付け直す（docs/EDITOR_TEXT_QUIRKS_FIX_PLAN.md の癖8）。
assert.deepEqual(m.applyDirectionToSelection("［＃地付き］著者名", select("［＃地付き］著者名", 7), "center"), {
  from: 0,
  to: 9,
  insert: "著者名[(al:center)]",
  cursorPos: 16,
});

// 記法のクリア
const clear = (text, from, to = from) => m.clearNotationFromSelection(text, select(text, from, to));
assert.deepEqual(clear("本文[(al:end)] と **太字**", 0), {
  // 文章方向の指示は、選択に触れていなくても行ごと外れる（癖5）。太字は触れていないので残る。
  from: 0,
  to: 21,
  insert: "本文 と **太字**",
  cursorPos: 0,
  changed: true,
});
assert.deepEqual(clear("前[東京(rb,とうきょう)]後", 3), { from: 0, to: 16, insert: "前東京後", cursorPos: 3, changed: true });
assert.equal(clear("｜漢字《かんじ》", 0).insert, "漢字");
assert.equal(clear("漢字《かんじ》です", 0).insert, "漢字です");
assert.deepEqual(clear("《《傍点》》", 3), { from: 0, to: 6, insert: "傍点", cursorPos: 2, changed: true });
assert.equal(clear("[12(tcy)]と[重要(em,goma)]", 0, 20).insert, "12と重要");
assert.equal(clear("**太字**", 0, 6).insert, "太字");
// カーソルが記法の端に接していれば、その記法を外す。範囲を選んでいるときは、重なる記法だけ。
assert.equal(clear("**a** b **c**", 5).insert, "a b **c**");
assert.deepEqual(clear("**a** b **c**", 6, 7), { from: 0, to: 13, insert: "**a** b **c**", cursorPos: 6, changed: false });
// 行内のコード、コードの行、コメントの行の中は外さない。
assert.equal(clear("`**x**` と **y**", 0, 15).insert, "`**x**` と y");
assert.equal(clear("```\n**x**\n```\n**y**", 0, 19).insert, "```\n**x**\n```\ny");
assert.equal(clear("// **x**\n**y**", 0, 14).insert, "// **x**\ny");
assert.equal(clear("ただの文", 0).changed, false);
// 旧来の地付き（行頭の >> と ［＃地付き］）も、[(al:…)] と同じく行ごと外す（癖7）。
assert.deepEqual(clear(">> 著者名", 4), { from: 0, to: 6, insert: "著者名", cursorPos: 3, changed: true });
assert.deepEqual(clear("［＃地付き］著者名", 7), { from: 0, to: 9, insert: "著者名", cursorPos: 3, changed: true });
assert.equal(clear("本文 >> 途中", 0).changed, false); // 行頭でなければ地付きではない
assert.equal(clear("```\n>> x\n```", 4).changed, false);

// Ctrl+B
assert.deepEqual(m.toggleBoldSelection("abc", select("abc", 1)), { from: 1, to: 1, insert: "****", cursorPos: 3 });
assert.deepEqual(m.toggleBoldSelection("abc", select("abc", 0, 3)), { from: 0, to: 3, insert: "**abc**", cursorPos: 7 });
assert.deepEqual(m.toggleBoldSelection("**abc**", select("**abc**", 2, 5)), { from: 0, to: 7, insert: "abc", cursorPos: 3 });
assert.deepEqual(m.toggleBoldSelection("**abc**", select("**abc**", 0, 7)), { from: 0, to: 7, insert: "abc", cursorPos: 3 });
assert.equal(m.toggleBoldSelection("a\nb", select("a\nb", 0, 3)), null);

// Ctrl+I
assert.equal(m.toggleEmphasisSelection("傍点", select("傍点", 1)), null);
assert.deepEqual(m.toggleEmphasisSelection("傍点", select("傍点", 0, 2)), { from: 0, to: 2, insert: "[傍点(em,goma)]", cursorPos: 13 });
{
  const text = "[傍点(em,goma)]";
  assert.deepEqual(m.toggleEmphasisSelection(text, select(text, 1, 3)), { from: 0, to: 13, insert: "傍点", cursorPos: 2 });
  assert.deepEqual(m.toggleEmphasisSelection(text, select(text, 0, 13)), { from: 0, to: 13, insert: "傍点", cursorPos: 2 });
}
// 青空文庫形式の 《《傍点》》 も、中身か全体を選んで押すと外れる（癖6）。
assert.deepEqual(m.toggleEmphasisSelection("《《傍点》》", select("《《傍点》》", 2, 4)), { from: 0, to: 6, insert: "傍点", cursorPos: 2 });
assert.deepEqual(m.toggleEmphasisSelection("《《傍点》》", select("《《傍点》》", 0, 6)), { from: 0, to: 6, insert: "傍点", cursorPos: 2 });
assert.deepEqual(m.toggleEmphasisSelection("前《《傍点》》後", select("前《《傍点》》後", 3, 5)), { from: 1, to: 7, insert: "傍点", cursorPos: 3 });
assert.equal(m.toggleEmphasisSelection("a\nb", select("a\nb", 0, 3)), null);

// 縦中横の付け外し（右クリックの「縦中横」。docs/MENU_EMPHASIS_FIX_PLAN.md）
assert.deepEqual(m.toggleTcySelection("12", select("12", 0, 2)), { from: 0, to: 2, insert: "[12(tcy)]", cursorPos: 9 });
assert.deepEqual(m.toggleTcySelection("[12(tcy)]", select("[12(tcy)]", 1, 3)), { from: 0, to: 9, insert: "12", cursorPos: 2 });
assert.deepEqual(m.toggleTcySelection("[12(tcy)]", select("[12(tcy)]", 0, 9)), { from: 0, to: 9, insert: "12", cursorPos: 2 });
assert.deepEqual(m.toggleTcySelection("年[12(tcy)]", select("年[12(tcy)]", 2, 4)), { from: 1, to: 10, insert: "12", cursorPos: 3 });
// 2つ並んだ縦中横の全体は、1つと見ずに外側へ付ける。圏点の中身は縦中横として外さない。
assert.deepEqual(m.toggleTcySelection("[a(tcy)][b(tcy)]", select("[a(tcy)][b(tcy)]", 0, 16)), { from: 0, to: 16, insert: "[[a(tcy)][b(tcy)](tcy)]", cursorPos: 23 });
assert.deepEqual(m.toggleTcySelection("[12(em,goma)]", select("[12(em,goma)]", 1, 3)), { from: 1, to: 3, insert: "[12(tcy)]", cursorPos: 10 });
assert.equal(m.toggleTcySelection("a\nb", select("a\nb", 0, 3)), null);
assert.equal(m.toggleTcySelection("ab", select("ab", 1)), null);

// ルビ: すでに付いたルビに当たれば、書き方はそのままで読みだけを置き換える。
{
  const then = "[東京(rb,とうきょう)]へ";
  assert.deepEqual(m.applyRubyToSelection("東京", select("東京", 0, 2), "とうきょう"), { from: 0, to: 2, insert: "[東京(rb,とうきょう)]", cursorPos: 14 });
  assert.deepEqual(m.applyRubyToSelection(then, select(then, 1, 3), "ひがし"), { from: 0, to: 14, insert: "[東京(rb,ひがし)]", cursorPos: 12 });
  assert.deepEqual(m.applyRubyToSelection(then, select(then, 0, 14), "ひがし"), { from: 0, to: 14, insert: "[東京(rb,ひがし)]", cursorPos: 12 });

  const bar = "｜東京《とうきょう》へ";
  assert.deepEqual(m.applyRubyToSelection(bar, select(bar, 1, 3), "ひがし"), { from: 0, to: 10, insert: "｜東京《ひがし》", cursorPos: 8 });
  assert.deepEqual(m.applyRubyToSelection(bar, select(bar, 0, 10), "ひがし"), { from: 0, to: 10, insert: "｜東京《ひがし》", cursorPos: 8 });
  // 青空文庫風では、読みの 《 》 も空白にする。
  assert.deepEqual(m.applyRubyToSelection(bar, select(bar, 1, 3), "ひ《が》し"), { from: 0, to: 10, insert: "｜東京《ひ が し》", cursorPos: 10 });

  const kanji = "東京《とうきょう》へ";
  assert.deepEqual(m.applyRubyToSelection(kanji, select(kanji, 0, 2), "ひがし"), { from: 0, to: 9, insert: "東京《ひがし》", cursorPos: 7 });
  assert.deepEqual(m.applyRubyToSelection(kanji, select(kanji, 0, 9), "ひがし"), { from: 0, to: 9, insert: "東京《ひがし》", cursorPos: 7 });
  // ルビの付く語の一部だけ（前に漢字が続く）なら、置き換えずに外側へ付ける。
  const part = "大東京《とうきょう》";
  assert.deepEqual(m.applyRubyToSelection(part, select(part, 1, 3), "ひがし"), { from: 1, to: 3, insert: "[東京(rb,ひがし)]", cursorPos: 13 });
  // 圏点の 《《…》》 はルビではない。
  const emphasis = "《《東京》》";
  assert.deepEqual(m.applyRubyToSelection(emphasis, select(emphasis, 2, 4), "ひがし"), { from: 2, to: 4, insert: "[東京(rb,ひがし)]", cursorPos: 14 });
}

// Ctrl+数字
assert.deepEqual(m.applyHeadingToSelection("## 見出し\n本文", select("## 見出し\n本文", 0), 1), {
  from: 0,
  to: 6,
  insert: "# 見出し",
  cursorPos: 5,
});
assert.deepEqual(m.applyHeadingToSelection("# a\n## b", select("# a\n## b", 0, 8), 0), { from: 0, to: 8, insert: "a\nb", cursorPos: 3 });
assert.equal(m.applyHeadingToSelection("a", select("a", 0), 9).insert, "###### a");

// 検索バーの「すべて置換」: 大文字小文字を区別しない。検索語の前後の空白も検索語の一部（癖1。検索サイドバーと同じ）。
assert.deepEqual(m.replaceLiteralMatches("東京と 東京", " 東京", "X", true), { text: "東京とX", count: 1 });
assert.deepEqual(m.replaceLiteralMatches("a b", " ", "_", true), { text: "a_b", count: 1 });
assert.deepEqual(m.replaceLiteralMatches("Abc abc", "ABC", "x", true), { text: "x x", count: 2 });
assert.deepEqual(m.replaceLiteralMatches("abc", "  ", "x", true), { text: "abc", count: 0 });
assert.deepEqual(m.replaceLiteralMatches("abc", "", "x", true), { text: "abc", count: 0 });
assert.deepEqual(m.replaceLiteralMatches("a.c abc", ".", "$&$1", true), { text: "a$&$1c abc", count: 1 }); // 書いたとおりに入れる
assert.deepEqual(m.replaceLiteralMatches("abc", "z", "x", true), { text: "abc", count: 0 });
assert.deepEqual(m.replaceLiteralMatches("東京\n// 東京\n東京", "東京", "X", false), { text: "X\n// 東京\nX", count: 2 });
assert.deepEqual(m.replaceLiteralMatches("東京\n// 東京\n東京", "東京", "X", true), { text: "X\n// X\nX", count: 3 });
// 小文字にすると長くなる文字が前にあっても、置換する位置はずれない（癖3）。
assert.deepEqual(m.replaceLiteralMatches("İab", "a", "X", true), { text: "İXb", count: 1 });

// 検索サイドバーの置換: 前付けは置換しない。
{
  const markdown = "---\ntitle: 東京\n---\n東京へ";
  assert.deepEqual(m.replaceMarkdownBodyMatches(markdown, "東京", "大阪", { useRegex: false, matchCase: false }), {
    markdown: "---\ntitle: 東京\n---\n大阪へ",
    count: 1,
    error: null,
  });
  const none = m.replaceMarkdownBodyMatches(markdown, "名古屋", "大阪", { useRegex: false, matchCase: false });
  assert.equal(none.markdown, markdown);
  assert.equal(none.count, 0);
  const comments = "東京\n// 東京";
  assert.equal(m.replaceMarkdownBodyMatches(comments, "東京", "X", { useRegex: false, matchCase: false }).markdown, "X\n// 東京");
  assert.equal(
    m.replaceMarkdownBodyMatches(comments, "東京", "X", { useRegex: false, matchCase: false, includeComments: true }).markdown,
    "X\n// X",
  );
  const broken = m.replaceMarkdownBodyMatches("東京", "(", "X", { useRegex: true, matchCase: false });
  assert.equal(broken.count, 0);
  assert.equal(broken.markdown, "東京");
  assert.equal(typeof broken.error, "string");
}

// 検索バーの一致
{
  const pick = (list) => list.map(({ id, from, to, line, column, excerpt }) => ({ id, from, to, line, column, excerpt }));
  assert.deepEqual(pick(m.collectEditorFindMatches(ast("東京と 東京"), "東京", true)), [
    { id: "editor-find:0:0:0:東京", from: 0, to: 2, line: 1, column: 1, excerpt: "東京と 東京" },
    { id: "editor-find:0:4:1:東京", from: 4, to: 6, line: 1, column: 5, excerpt: "東京と 東京" },
  ]);
  // 前後の空白も検索語の一部（癖1）。
  assert.deepEqual(pick(m.collectEditorFindMatches(ast("東京と 東京"), " 東京", true)), [
    { id: "editor-find:0:3:0: 東京", from: 3, to: 6, line: 1, column: 4, excerpt: "東京と 東京" },
  ]);
  // 小文字にすると長くなる文字が前にあっても、位置はずれない（癖3）。
  assert.deepEqual(m.collectEditorFindMatches(ast("İab"), "A", true).map((match) => [match.from, match.to]), [[1, 2]]);
  const second = m.collectEditorFindMatches(ast("前\nabc ABC"), "abc", true);
  assert.deepEqual(second.map((match) => [match.from, match.line, match.column]), [[2, 2, 1], [6, 2, 5]]);
}
assert.equal(m.collectEditorFindMatches(ast("a\nb"), "a\nb", true).length, 0); // 行をまたがない（癖2）
assert.equal(m.collectEditorFindMatches(ast("東京\n// 東京"), "東京", false).length, 1);
assert.equal(m.collectEditorFindMatches(ast("東京\n// 東京"), "東京", true).length, 2);
assert.equal(m.collectEditorFindMatches(ast("aaa"), "aa", true).length, 1); // 重なる一致は数えない
assert.equal(m.collectEditorFindMatches(ast("aaaa"), "a", true, 3).length, 3);
assert.equal(m.collectEditorFindMatches(ast("a".repeat(600)), "a", true).length, 500);
assert.deepEqual(m.collectEditorFindMatches(ast("abc"), "   ", true), []);

// アイコン: 型に並べた名前のすべてに絵があり、知らない名前は何も描かない。
{
  const source = await readFile("src/components/layout/AppIcon.tsx", "utf8");
  const typeBody = source.slice(source.indexOf("export type AppIconName"), source.indexOf("export function AppIcon"));
  const names = [...typeBody.matchAll(/\| "(\w+)"/g)].map((match) => match[1]);
  assert.ok(names.length >= 20, `icon names: ${names.length}`);
  const seen = new Set();
  for (const name of names) {
    const markup = m.renderIcon(name, "icon-test");
    assert.match(markup, /^<svg class="icon-test" viewBox="0 0 24 24" aria-hidden="true" focusable="false">.+<\/svg>$/, name);
    seen.add(markup);
  }
  assert.equal(seen.size, names.length, "every icon draws its own picture");
  assert.match(m.renderIcon("book"), /^<svg class="" /);
  assert.equal(m.renderIcon("no-such-icon"), "");
}

console.log("editor text edits tests passed");
