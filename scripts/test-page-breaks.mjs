import assert from "node:assert/strict";
import { computePageBreaks } from "../src/editor/pageBreaks.ts";

// ページ割りの計算。行分割はブラウザに任せたまま、実測した行数から割り付けだけ
// を決める経路を固定する。断片化した multicol に頼らなくなったことで、ページの
// 境目にかかる段落でもブラウザのキャレット座標が壊れなくなるのが狙い。

// --- 一様な行送り ---

const uniform = Array.from({ length: 5 }, (_unused, index) => ({
  lineCount: 4,
  linePitch: 30,
  gapBefore: 0,
  blockStart: index * 120,
}));

{
  // 版面 300px、行送り 30px なので1ページ10行。全20行で2ページ。
  const { pages, offsets } = computePageBreaks(300, uniform);
  assert.equal(pages.length, 2, "20 lines of 30px must fill exactly two 300px pages");
  assert.deepEqual(offsets, [0, 300], "page offsets must land on the page boundary");

  const firstPageLines = pages[0].reduce(
    (total, slice) => total + (slice.lineEnd - slice.lineStart),
    0,
  );
  assert.equal(firstPageLines, 10, "a page must hold as many lines as fit");
}

{
  // 段落の途中でページが変わる場合、その段落は行範囲で分割される。
  const { pages } = computePageBreaks(300, uniform);
  const split = pages[0].find((slice) => slice.paragraphIndex === 2);
  assert.ok(split, "the paragraph straddling the boundary must appear on the first page");
  assert.equal(split.lineStart, 0);
  assert.equal(split.lineEnd, 2, "only the lines that fit belong to the first page");

  const rest = pages[1].find((slice) => slice.paragraphIndex === 2);
  assert.ok(rest, "the remainder must continue on the next page");
  assert.equal(rest.lineStart, 2, "the next page resumes where the previous one stopped");
  assert.equal(rest.lineEnd, 4);
}

// --- 行送りが混ざる場合 ---
//
// 見出しは font-size も line-height も本文と違う。行送りを一様と決め打ちすると
// ページの割りがずれるので、段落ごとの実測値で計算する。

{
  const mixed = [
    { lineCount: 1, linePitch: 60, gapBefore: 0, blockStart: 0 }, // 見出し
    { lineCount: 9, linePitch: 30, gapBefore: 0, blockStart: 60 }, // 本文
  ];
  const { pages } = computePageBreaks(300, mixed);
  assert.equal(pages.length, 2, "a 60px heading leaves room for only 8 body lines");

  const firstPageBody = pages[0].find((slice) => slice.paragraphIndex === 1);
  assert.ok(firstPageBody);
  assert.equal(firstPageBody.lineEnd, 8, "the heading consumes two body lines worth of space");

  const secondPageBody = pages[1].find((slice) => slice.paragraphIndex === 1);
  assert.ok(secondPageBody);
  assert.equal(secondPageBody.lineStart, 8, "the ninth line is pushed onto the next page");
}

// --- 段落の前隙間 ---
//
// ページ先頭では前隙間を詰める。オフセットの積み上げも同じ扱いにしないと、
// 描画位置と割り付けが食い違う。

{
  const spaced = [
    { lineCount: 5, linePitch: 30, gapBefore: 0, blockStart: 0 },
    { lineCount: 5, linePitch: 30, gapBefore: 20, blockStart: 170 },
  ];
  const { pages, offsets } = computePageBreaks(300, spaced);
  assert.equal(pages.length, 2, "the gap pushes the last line onto a second page");
  assert.equal(offsets[0], 0);
  // 2ページ目の先頭は2段落目の5行目。オフセットは段落の実位置から出す。
  assert.equal(
    offsets[1],
    170 + 4 * 30,
    "the offset must come from the paragraph's measured position, not accumulated pitch",
  );
}

// --- 端の扱い ---

assert.deepEqual(
  computePageBreaks(0, uniform),
  { pages: [], offsets: [] },
  "a page with no room must not produce pages",
);

assert.deepEqual(
  computePageBreaks(300, []),
  { pages: [], offsets: [] },
  "an empty document must not produce pages",
);

console.log("page break tests passed");
