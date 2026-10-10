import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const directory = process.argv[2] ?? "artifacts/decoration-mapping-2026-10-10";
const model = JSON.parse(await readFile(`${directory}/model-performance.json`, "utf8"));
const browser = JSON.parse(await readFile(`${directory}/browser-performance.json`, "utf8"));
assert.equal(model.results.length, model.repeats * 20);
assert.equal(browser.results.length, browser.repeats * 2);
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
function compare(results, get, repeats) {
  const rows = Array.from({length:repeats}, (_, repeat) => {
    const before = get(results.find(r=>r.repeat===repeat && r.version==="before"));
    const after = get(results.find(r=>r.repeat===repeat && r.version==="after"));
    assert.ok(Number.isFinite(before) && Number.isFinite(after));
    return { repeat, before, after, difference:after-before, ratio:after/before };
  });
  return { beforeMedian:median(rows.map(r=>r.before)), afterMedian:median(rows.map(r=>r.after)),
    differenceMedian:median(rows.map(r=>r.difference)),
    differenceRange:[Math.min(...rows.map(r=>r.difference)),Math.max(...rows.map(r=>r.difference))],
    pairs:rows };
}
const browserMetrics = {
  "character.sync.p50": r=>r.characterTyping.sync.p50,
  "character.sync.p95": r=>r.characterTyping.sync.p95,
  "character.paint.p95": r=>r.characterTyping.paint.p95,
  "character.settled.p95": r=>r.characterTyping.settled.p95,
  "enter.frameGap.p95": r=>r.enters.frameGap.p95,
  "ime.frameGap.p95": r=>r.ime.frameGap.p95,
  "whole-sync.sync.p50": r=>r.commands["whole-sync"].sync.p50,
  "whole-sync.sync.p95": r=>r.commands["whole-sync"].sync.p95,
  "whole-sync.twoFrames.p50": r=>r.commands["whole-sync"].twoFrames.p50,
  "whole-sync.twoFrames.p95": r=>r.commands["whole-sync"].twoFrames.p95,
  "bold-shortcut.sync.p50": r=>r.commands["bold-shortcut"].sync.p50,
  "bold-shortcut.sync.p95": r=>r.commands["bold-shortcut"].sync.p95,
  "bold-shortcut.twoFrames.p50": r=>r.commands["bold-shortcut"].twoFrames.p50,
  "bold-shortcut.twoFrames.p95": r=>r.commands["bold-shortcut"].twoFrames.p95,
};
const browserSummary = Object.fromEntries(Object.entries(browserMetrics).map(([name,get])=>[name,compare(browser.results,get,browser.repeats)]));
const modelSummary = model.summary.map(row=>({...row,paired:compare(model.results.filter(r=>r.full===row.full && r.scenario===row.scenario),r=>r.mean,model.repeats)}));
const browserCorrectness = Object.fromEntries(["before","after"].map(version=>{
  const rows=browser.results.filter(r=>r.version===version);
  return [version, {
    textSelectionHistoryIntact:rows.every(r=>[r.enters,r.ime].every(s=>s.textMatches&&s.selectionUnchangedByScroll&&s.undoRestores&&s.redoRestores)),
    maximumAlignmentError:Math.max(...rows.flatMap(r=>[r.enters.alignmentError,r.ime.alignmentError])),
    paragraphDecorationLoss:rows.map(r=>({repeat:r.repeat,wholeSync:r.commands["whole-sync"].missingParagraphClasses,bold:r.commands["bold-shortcut"].missingParagraphClasses})),
  }];
}));
assert.ok(browserCorrectness.after.textSelectionHistoryIntact);
assert.ok(browserCorrectness.after.paragraphDecorationLoss.every(r=>!r.wholeSync&&!r.bold));
const summary={ model:{characters:model.characters,paragraphs:model.paragraphs,repeats:model.repeats,samples:model.samples,summary:modelSummary},
  browser:{requestedChars:browser.requestedChars,repeats:browser.repeats,summary:browserSummary,correctness:browserCorrectness} };
await writeFile(`${directory}/summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify({model:modelSummary.map(r=>({full:r.full,scenario:r.scenario,before:r.before.meanMedian,after:r.after.meanMedian})),
  browser:Object.fromEntries(Object.entries(browserSummary).map(([key,r])=>[key,{before:r.beforeMedian,after:r.afterMedian,differenceRange:r.differenceRange}])),
  correctness:browserCorrectness},null,2));
