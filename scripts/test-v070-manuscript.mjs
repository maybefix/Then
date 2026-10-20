// 原稿用紙モード（v0.7.0）の計算部分の単体テスト。DOMに触れない純粋な関数だけを見る。
// 組版そのもの（1字1ic・行数・ページ境界の描画）は test-v070-manuscript-browser.mjs で確かめる。
import assert from "node:assert/strict";
import { build } from "esbuild";

async function importBundled(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, platform: "neutral", logLevel: "silent" });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const {
  normalizeManuscriptSettings,
  manuscriptPageIndex,
  endsManuscriptPage,
  manuscriptProgress,
  formatManuscriptSheets,
  findLatinRuns,
  latinRunAdjustment,
  LATIN_OVERHANG,
  LatinRunMetrics,
} = await importBundled("src/editor/manuscriptLayout.ts");

// 設定の正規化：既定は使用しない・20字×20行、範囲外は丸める、壊れた値は既定へ。
assert.deepEqual(normalizeManuscriptSettings(undefined), {
  layoutMode: "normal", charactersPerLine: 20, linesPerPage: 20, showGrid: true, showPageBoundaries: true, fontSize: 21,
});
assert.deepEqual(normalizeManuscriptSettings({ layoutMode: "manuscript", charactersPerLine: 40, linesPerPage: 30, showGrid: false }), {
  layoutMode: "manuscript", charactersPerLine: 40, linesPerPage: 30, showGrid: false, showPageBoundaries: true, fontSize: 21,
});
// 原稿用紙の文字サイズ：未保存なら通常の文字サイズ＋6、範囲は12〜40。
assert.equal(normalizeManuscriptSettings({}, 15).fontSize, 21);
assert.equal(normalizeManuscriptSettings({}, 24).fontSize, 30);
assert.equal(normalizeManuscriptSettings({}, 36).fontSize, 40);
assert.equal(normalizeManuscriptSettings({ fontSize: 28 }, 15).fontSize, 28, "保存した値は通常の文字サイズに左右されない");
assert.equal(normalizeManuscriptSettings({ fontSize: 99 }).fontSize, 40);
assert.equal(normalizeManuscriptSettings({ fontSize: 3 }).fontSize, 12);
assert.equal(normalizeManuscriptSettings({ charactersPerLine: 1 }).charactersPerLine, 5);
assert.equal(normalizeManuscriptSettings({ charactersPerLine: 999 }).charactersPerLine, 80);
assert.equal(normalizeManuscriptSettings({ linesPerPage: 20.6 }).linesPerPage, 21);
assert.equal(normalizeManuscriptSettings({ linesPerPage: "20" }).linesPerPage, 20);
assert.equal(normalizeManuscriptSettings({ layoutMode: "paged" }).layoutMode, "normal");

// ページ番号：pageIndex = floor((行番号 - 1) / 行数)
assert.equal(manuscriptPageIndex(1, 20), 0);
assert.equal(manuscriptPageIndex(20, 20), 0);
assert.equal(manuscriptPageIndex(21, 20), 1);
assert.equal(manuscriptPageIndex(41, 20), 2);
assert.equal(manuscriptPageIndex(30, 30), 0);
assert.equal(manuscriptPageIndex(31, 30), 1);

// 境界は行数の倍数の行の後ろ。最終行の後ろには出さない（20行ちょうどなら境界なし）。
assert.equal(endsManuscriptPage(20, 20, 21), true);
assert.equal(endsManuscriptPage(20, 20, 20), false);
assert.equal(endsManuscriptPage(19, 20, 40), false);
assert.equal(endsManuscriptPage(40, 20, 41), true);
assert.equal(endsManuscriptPage(0, 20, 100), false, "コメント行など番号のない行は境界にならない");

// 枚数：実際の行数から。7ページ完了・8ページ目12行 → 7.6枚。
assert.deepEqual(manuscriptProgress(152, 20), { fullPages: 7, currentPage: 8, usedLinesOnCurrentPage: 12, linesPerPage: 20 });
assert.equal(formatManuscriptSheets(manuscriptProgress(152, 20)), "7.6");
assert.deepEqual(manuscriptProgress(20, 20), { fullPages: 1, currentPage: 2, usedLinesOnCurrentPage: 0, linesPerPage: 20 });
assert.equal(formatManuscriptSheets(manuscriptProgress(20, 20)), "1.0");
assert.equal(formatManuscriptSheets(manuscriptProgress(21, 20)), "1.0", "1行だけでは小数1桁に満たない");
assert.equal(formatManuscriptSheets(manuscriptProgress(0, 20)), "0.0");
assert.equal(formatManuscriptSheets(manuscriptProgress(93, 30)), "3.1");
assert.equal(formatManuscriptSheets(manuscriptProgress(39, 20)), "1.9", "切り上げない");

// 欧文ラン：連続するラテン文字・数字・半角記号（間の半角空白を含む）を1単位にする。
const runs = (text) => findLatinRuns(text).map((run) => run.text);
assert.deepEqual(runs("これはABCです。"), ["ABC"]);
assert.deepEqual(runs("Hello worldと書く"), ["Hello world"]);
assert.deepEqual(runs("iPhone 15を買った"), ["iPhone 15"]);
assert.deepEqual(runs("平成12年12月"), ["12", "12"]);
assert.deepEqual(runs("あ b い"), [" b "], "和文に挟まれた空白は前後の欧文と1つのランになる");
assert.deepEqual(runs("全角ＡＢＣと「括弧」。"), [], "全角英字と和文約物は1字1セルのまま");
assert.deepEqual(runs("あ い"), [" "], "単独の半角空白も1ラン");
assert.deepEqual(findLatinRuns("これはABCです")[0], { from: 3, to: 6, text: "ABC" });

// セル割り当て：ceil（ただし LATIN_OVERHANG までのはみ出しは少ないセル数に収める）。
assert.equal(LATIN_OVERHANG, 0.1);
assert.deepEqual(latinRunAdjustment(2.2, 1), { cells: 3, adjustEm: 3 - 2.2 });
assert.equal(latinRunAdjustment(2.079, 1).cells, 2, "ABC（約2.08字幅）は2セル");
assert.equal(latinRunAdjustment(1.03, 1).cells, 1, "半角数字2字（約1.03字幅）は1セル");
assert.ok(latinRunAdjustment(1.03, 1).adjustEm < 0, "はみ出し分は送りを詰める");
assert.equal(latinRunAdjustment(1.2, 1).cells, 2);
assert.equal(latinRunAdjustment(0.25, 1).cells, 1, "最低1セル");
assert.equal(latinRunAdjustment(3, 1).adjustEm, 0);
for (const width of [0.3, 0.99, 1.05, 1.11, 2.5, 7.779]) {
  const { cells, adjustEm } = latinRunAdjustment(width, 1);
  assert.ok(Math.abs(width + adjustEm - cells) < 1e-9, "調整後の送りは常に整数セル");
}

// 計測キャッシュ：DOMのない環境では概算で埋まり、同じ条件の2回目は測り直さない。
const metrics = new LatinRunMetrics(null);
const font = { fontFamily: "serif", fontSize: 16, fontWeight: "400", fontStyle: "normal", writingMode: "vertical-rl" };
metrics.prepare(font, ["ABC", "Hello"]);
const measured = metrics.stats.measured;
assert.equal(measured, 3, "ABC・Hello・基準字（水）");
metrics.widthEm({ ...font, text: "ABC" });
metrics.widthEm({ ...font, text: "ABC" });
assert.equal(metrics.stats.measured, measured, "キャッシュから返す");
assert.equal(metrics.stats.reused, 2);
metrics.widthEm({ ...font, fontSize: 18, text: "ABC" });
assert.equal(metrics.stats.measured, measured + 2, "文字サイズが変われば別のキー（ランと基準字）");
metrics.widthEm({ ...font, writingMode: "horizontal-tb", text: "ABC" });
assert.equal(metrics.stats.measured, measured + 4, "書字方向が変われば別のキー");
assert.equal(metrics.icEm(font), 1);

console.log("v0.7.0 manuscript layout tests passed");
