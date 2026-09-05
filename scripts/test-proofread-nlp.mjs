import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const dir = path.join(root, "test-artifacts", "nlp");
await mkdir(dir, { recursive: true });
await build({ entryPoints: ["src/proofread/nlp.ts"], bundle: true, platform: "node", format: "esm", outfile: path.join(dir, "checks.mjs") });
const { prepareNlpText, runNlpChecks, validateAnalysis } = await import(pathToFileURL(path.join(dir, "checks.mjs")));
const options = { maxSentenceLength: 80, maxCommasPerSentence: 4, skipDialogue: true, disabledChecks: [] };
const lines = [
  "😀期待に答える。", "期待に十分答える。", "期待に応える。",
  "私の趣味は本を読む。", "私の趣味は本を読むことだ。",
  "「期待に答える」", "喉が乾いた。", "風邪を直した。", "前例に習った。",
  "暑いお茶を飲む。", "暑い部屋だった。", "質問に答えた。",
  "期待に胸を膨らませて、質問に答えた。",
  "期待に。答える。", "期待に\n答える。",
  "｜単語《期待に答える》", "`期待に答える`",
  "故障を治す。", "洗濯物が渇く。", "ピアノを倣う。",
  "期待…", "（…", "‥", "[…(em,goma)]",
  "😀（…）期待に十分答える。", "か\u3099㍍ｶﾞ期待に答える。",
];
const text = lines.join("\n");
const input = prepareNlpText(text, options, []);
assert.ok(!input.includes("\uFFFD"), "mask characters must be replaced with spaces for the parser");
assert.equal(input.length, text.length, "masking keeps UTF-16 offsets");
const phantom = { start: 1, end: 1, surface: "", lemma: ".", pos: "補助記号", head: -1, dep: "", sentence: 0 };
assert.deepEqual(validateAnalysis({ mode: "morphology", tokens: [phantom] }, "…").tokens, []);
assert.deepEqual(validateAnalysis({ mode: "dependency", tokens: [], morphology: [phantom] }, "…").morphology, []);
assert.throws(() => validateAnalysis({ mode: "dependency", tokens: [{ ...phantom, head: 0 }] }, "…"), "do not remove dependency nodes and corrupt head indices");
assert.throws(() => validateAnalysis({ mode: "morphology", tokens: [{ ...phantom, surface: "x", end: 2 }] }, "ab"), "actual surface mismatch is still rejected");
const results = {};
for (const mode of ["morphology", "dependency"]) {
  const start = performance.now();
  const processResult = spawnSync(path.join(root, ".venv-nlp", "Scripts", "python.exe"), ["-I", "scripts/nlp/analyze.py"], { input: JSON.stringify({ text: input, mode }), encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 8_000_000 });
  assert.equal(processResult.status, 0, processResult.stderr || String(processResult.error));
  const rawAnalysis = JSON.parse(processResult.stdout);
  assert.ok([...rawAnalysis.tokens, ...(rawAnalysis.morphology ?? [])].every(t => t.end > t.start), "Python must not return empty normalization morphemes");
  const analysis = validateAnalysis(rawAnalysis, input);
  const checked = runNlpChecks(text, analysis, options, []);
  results[mode] = checked.issues;
  await writeFile(path.join(dir, `${mode}.json`), JSON.stringify({ analysis, issues: checked.issues }, null, 2));
  assert.ok(checked.issues.some(i => i.line === 1 && text.slice(i.from, i.to) === "答える"), "UTF-16 positions after emoji");
  assert.ok(checked.issues.some(i => i.line === 7), "inflected kawaku");
  assert.ok(checked.issues.some(i => i.line === 8), "inflected naosu");
  assert.ok(checked.issues.some(i => i.line === 9), "inflected narau");
  assert.ok(checked.issues.some(i => i.line === 10), "attributive adjective with honorific prefix");
  for (const line of [3, 5, 6, 11, 12, 13, 14, 15, 16, 17, 18]) assert.ok(!checked.issues.some(i => i.line === line), `${mode} false positive on line ${line}`);
  assert.ok(checked.issues.every(i => !i.replacement && i.severity === "hint"));
  assert.equal(runNlpChecks(text, analysis, options, [], ["nlp-collocation", "nlp-dependency"]).issues.length, 0);
  assert.ok(checked.issues.some(i => i.checkId === "nlp-collocation/057"), "checks are keyed by the report item number");
  assert.ok(!runNlpChecks(text, analysis, { ...options, disabledChecks: ["nlp-collocation/057"] }, []).issues.some(i => i.checkId === "nlp-collocation/057"), "one item can be switched off");
  assert.throws(() => validateAnalysis({ ...analysis, tokens: [{ ...analysis.tokens[0], start: -1 }] }, input));
  console.log(`${mode}: ${checked.issues.length} hints, ${Math.round(performance.now() - start)} ms`);
}
assert.ok(!results.morphology.some(i => i.line === 2), "morphology must not guess distant attachment");
assert.ok(results.dependency.some(i => i.line === 2), "dependency finds an intervening adverb");
assert.ok(results.dependency.some(i => i.line === 4 && i.ruleId === "nlp-dependency"), "topic-predicate hint");
console.log("NLP integration OK (real Sudachi and GiNZA)");
