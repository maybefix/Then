import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const folder = 'artifacts/paragraph-flow-qa-2026-10-10';
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1 / 32, `${actual} != ${expected}`);
const conditions = [];
for (const version of ['before', 'after']) {
  const report = JSON.parse(await readFile(`${folder}/${version}-page-diagnosis.json`, 'utf8'));
  const failure = report.failure, first = failure.firstParagraph;
  assert.equal(report.failedLabel, 'horizontal-tb/paged/distant line-count change');
  assert.equal(first.display, 'none');
  assert.deepEqual(first.rect, { left: 0, right: 0, top: 0, bottom: 0 });
  assert.equal(first.freshMeasure.lineCount, 1);
  const calculation = failure.diagnostics.history.at(-1);
  close(failure.actual, -calculation.root.top);
  close(failure.expected, -failure.root.top);
  close(failure.delta, failure.root.top - calculation.root.top);
  const control = failure.translationControl;
  assert.ok(control.hiddenParagraphs.includes(first.index));
  let visibleMaxDifference = 0, hiddenMaxDifference = 0;
  for (let index = 0; index < failure.freshParagraphs.length; index++) {
    const difference = failure.freshParagraphs[index].blockStart - calculation.paragraphs[index].blockStart;
    if (control.hiddenParagraphs.includes(index)) {
      close(difference, -failure.delta);
      hiddenMaxDifference = Math.max(hiddenMaxDifference, Math.abs(difference));
    } else visibleMaxDifference = Math.max(visibleMaxDifference, Math.abs(difference));
  }
  close(visibleMaxDifference, 0);
  close(control.visibleMaxBlockStartDelta, 0);
  assert.equal(control.legacyChangedOffsets.length, 1);
  const moved = control.legacyChangedOffsets[0];
  assert.equal(moved.pageIndex, failure.pageIndex);
  close(moved.delta, -control.requestedShift);
  assert.ok(control.normalizedPagesEqual);
  close(control.normalizedMaxOffsetDelta, 0);
  conditions.push({
    version, passedChecks: report.checks, paragraphIndex: first.index, text: first.text,
    storedOffset: failure.actual, freshOffset: failure.expected, delta: failure.delta,
    rootTopAtCalculation: calculation.root.top, rootTopAfterPagePositioning: failure.root.top,
    visibleMaxDifference, hiddenMaxDifference,
    translationControl: { shift: control.requestedShift, legacyOffsetDelta: moved.delta, hiddenZeroLineOffsetDelta: control.normalizedMaxOffsetDelta },
  });
}
close(conditions[0].delta, conditions[1].delta);
const installed = JSON.parse(await readFile(`${folder}/installed-page-diagnosis.json`, 'utf8'));
const installedBinary = JSON.parse(await readFile(`${folder}/installed-binary-metadata.json`, 'utf8'));
const installedScript = JSON.parse(await readFile(`${folder}/installed-script-metadata.json`, 'utf8'));
const restored = JSON.parse(await readFile(`${folder}/installed-state-restoration.json`, 'utf8'));
assert.equal(installed.failedLabel, 'horizontal-tb/paged/distant line-count change');
assert.equal(installed.failure.firstParagraph.display, 'none');
assert.equal(installed.failure.firstParagraph.freshMeasure.lineCount, 1);
close(installed.failure.delta, conditions[0].delta);
close(installed.failure.expected, -installed.failure.root.top);
close(installed.failure.translationControl.legacyChangedOffsets[0].delta, -137);
close(installed.failure.translationControl.normalizedMaxOffsetDelta, 0);
assert.ok(installedScript.exposed);
assert.equal(installedScript.scriptSha256, '834c59cb8d05be7a940ca38d291d5fb9226f19fea118e454dff75e853b30fe36');
assert.ok(restored.restoration.every(item => item.restoredByteForByte));
const summary = {
  rootCause: 'Hidden display:none paragraphs are counted as one line and can become a page start; their zero viewport rect makes blockStart depend on the moving root viewport origin.',
  presentWithIncrementalFlowDisabled: true, reproducedWithIncrementalFlowEnabled: true,
  observedDeltaPx: conditions[0].delta, conditions,
  installedBuild: { reproduced: true, ...installedBinary, ...installedScript,
    passedChecks: installed.checks, storedOffset: installed.failure.actual, freshOffset: installed.failure.expected,
    delta: installed.failure.delta, stateRestoredByteForByte: true },
  applicationFixImplemented: false, deployed: false,
};
await writeFile(`${folder}/page-diagnosis-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
