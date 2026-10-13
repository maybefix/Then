import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildComparisonEntries } from "../src/components/checkpoints/checkpointComparison.ts";
import { buildProjectDiff, compareTreeOrder, diffChars, diffParagraphs, summarizeDiff } from "../src/components/checkpoints/checkpointDiff.ts";

const root = "C:\\book";
const file = (path, text) => ({ path: `${root}\\${path}`, name: path.split("\\").at(-1), text });
const tree = (folders) => ({
  path: root, name: "book", children: Object.entries(folders).map(([folder, names]) => ({
    path: `${root}\\${folder}`, name: folder, kind: "folder",
    children: names.map((name) => ({ path: `${root}\\${folder}\\${name}`, name, kind: "file", children: [] })),
  })),
});
const paragraphs = (count, prefix = "段落") => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}の本文です。`);

// 段落の変更: 変わった段落だけが行番号付きで出て、間は畳まれる。
{
  const before = paragraphs(40);
  const after = before.slice();
  after[32] = "段落33の本文を書き直しました。";
  const diff = diffParagraphs(before.join("\n"), after.join("\n"));
  assert.equal(diff.rows.length, 1);
  assert.deepEqual(diff.rows[0], { oldLine: 33, newLine: 33, oldText: before[32], newText: after[32], gapBefore: 32 });
  assert.ok(diff.plus > 0 && diff.minus > 0);
}

// 段落の追加・削除
{
  const before = paragraphs(5);
  const added = [...before.slice(0, 2), "新しい段落", ...before.slice(2)];
  const addDiff = diffParagraphs(before.join("\n"), added.join("\n"));
  assert.deepEqual(addDiff.rows.map((row) => [row.oldText, row.newText, row.newLine, row.gapBefore]), [[null, "新しい段落", 3, 2]]);
  assert.equal(addDiff.plus, 5);
  assert.equal(addDiff.minus, 0);

  const removed = [...before.slice(0, 4)];
  const removeDiff = diffParagraphs(before.join("\n"), removed.join("\n"));
  assert.deepEqual(removeDiff.rows.map((row) => [row.oldText, row.newText, row.oldLine]), [[before[4], null, 5]]);
  assert.equal(removeDiff.plus, 0);
}

// 空行の増減だけでは行を出さない。
{
  const diff = diffParagraphs("一\n二", "一\n\n二");
  assert.equal(diff.rows.length, 0);
}

// 文字単位: 共通部・削除・追加に分かれ、細切れの一致は変更へ吸収される。
{
  const segments = diffChars("今後はルビや傍点に対応していく予定です。", "今後はルビと傍点に対応したうえで、縦中横にも手をつける予定です。");
  assert.equal(segments[0][0], "s");
  assert.ok(segments[0][1].startsWith("今後はルビ"));
  assert.equal(segments.map(([, text]) => text).join("").length > 0, true);
  const oldSide = segments.filter(([kind]) => kind !== "a").map(([, text]) => text).join("");
  const newSide = segments.filter(([kind]) => kind !== "d").map(([, text]) => text).join("");
  assert.equal(oldSide, "今後はルビや傍点に対応していく予定です。");
  assert.equal(newSide, "今後はルビと傍点に対応したうえで、縦中横にも手をつける予定です。");
  assert.deepEqual(diffChars("同じ文", "同じ文"), [["s", "同じ文"]]);
  assert.deepEqual(diffChars("", "新しい文"), [["a", "新しい文"]]);
}

// 並び順: 両方にある項目だけで比べる。
{
  const before = tree({ "01_記事": ["a.md", "b.md"], "02_メモ": ["c.md"], "03_野球": [] });
  const reordered = { ...before, children: [before.children[0], before.children[2], before.children[1]] };
  const changes = compareTreeOrder(before, reordered);
  assert.deepEqual(changes, [{ folder: "", before: ["01_記事", "02_メモ", "03_野球"], after: ["01_記事", "03_野球", "02_メモ"] }]);
  const appended = { ...before, children: [...before.children, { path: `${root}\\04`, name: "04", kind: "folder", children: [] }] };
  assert.deepEqual(compareTreeOrder(before, appended), [], "adding a folder is not a reorder");
}

// プロジェクト全体: 変更・追加・変更なしの分類と要約。
{
  const oldFiles = [file("01_記事\\a.md", paragraphs(10).join("\n")), file("01_記事\\b.md", "同じ"), file("02_メモ\\c.md", "消える本文")];
  const newFiles = [file("01_記事\\a.md", paragraphs(10).join("\n").replace("段落3の", "段落3を直した")), file("01_記事\\b.md", "同じ"), file("02_メモ\\d.md", "加わった本文")];
  const oldTree = tree({ "01_記事": ["a.md", "b.md"], "02_メモ": ["c.md"] });
  const newTree = tree({ "01_記事": ["a.md", "b.md"], "02_メモ": ["d.md"] });
  const diff = buildProjectDiff(buildComparisonEntries(oldFiles, newFiles), oldTree, newTree);
  assert.deepEqual(diff.files.map((item) => [item.name, item.kind, item.folder]), [["a.md", "changed", "01_記事"], ["c.md", "removed", "02_メモ"], ["d.md", "added", "02_メモ"]]);
  assert.equal(diff.unchangedCount, 1);
  assert.equal(diff.summary, "1ファイルが加わり、1ファイルがなくなり、1ファイルの本文が変わっています");
  assert.equal(diff.empty, false);

  const same = buildProjectDiff(buildComparisonEntries(oldFiles, oldFiles), oldTree, oldTree);
  assert.equal(same.empty, true);
  assert.equal(same.summary, "変更はありません");
  assert.equal(same.unchangedCount, 3);
}

assert.equal(summarizeDiff([{ kind: "changed" }, { kind: "changed" }], true), "2ファイルの本文と、フォルダの並び順が変わっています");
assert.equal(summarizeDiff([{ kind: "added" }, { kind: "added" }, { kind: "added" }, { kind: "added" }, { kind: "added" }, { kind: "changed" }], false), "5ファイルが加わり、1ファイルの本文が変わっています");
assert.equal(summarizeDiff([{ kind: "added" }], false), "1ファイルが加わっています");

// 10万字規模でも段落単位の計算は画面を開く時間に収まる。
{
  const big = paragraphs(2500, "長い原稿の段落").join("\n");
  const edited = big.split("\n").map((line, index) => index % 50 === 0 ? `${line}加筆。` : line).join("\n");
  const started = performance.now();
  const diff = diffParagraphs(big, edited);
  const elapsed = performance.now() - started;
  assert.equal(diff.rows.length, 50);
  assert.ok(elapsed < 1000, `paragraph diff took ${elapsed.toFixed(0)}ms`);
  const rewrite = diffParagraphs(big, paragraphs(2500, "全面改稿").join("\n"));
  assert.equal(rewrite.rows.length, 2500, "a full rewrite falls back to paired rows");
}

console.log("checkpoint diff tests passed");
