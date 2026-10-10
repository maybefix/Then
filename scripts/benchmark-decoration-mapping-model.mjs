import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { loadEditorAuditModule, decorationSignature } from "./lib/editor-audit-module.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const samples = Number(option("samples", 40));
const repeats = Number(option("repeats", 7));
const modules = {
  before: await loadEditorAuditModule(option("before", "artifacts/decoration-mapping-2026-10-10/before-VerticalTextEditor.tsx"), {
    "./editor/transactionLineDiff":"artifacts/decoration-mapping-2026-10-10/before-transactionLineDiff.ts",
  }),
  after: await loadEditorAuditModule(option("after", "src/VerticalTextEditor.tsx")),
};
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const paragraph = text => schema.node("paragraph", null, text ? schema.text(text) : undefined);
const initialTexts = Array.from({length:2000},(_,i) => i % 7 ? `段落${i}、日本語の原稿を比較する。**強調**と|東京《とうきょう》を含む。` : "");
const initialDoc = schema.node("doc", null, initialTexts.map(paragraph));
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*p))];
const results = [];
function run(version, scenario, full, repeat) {
  const api = modules[version];
  let state = EditorState.create({schema, doc:initialDoc}), ast = api.makeAstState(state);
  const apply = tr => { const next = state.apply(tr); ast = api.applyAst(tr, ast, state, next); state = next; };
  let middle = 1; for (let i=0;i<1001;i++) middle += state.doc.child(i).nodeSize;
  apply(state.tr.setSelection(TextSelection.create(state.doc, middle)).setMeta(api.astKey, { fullDecorations:full, visibleCenter:1001 }));
  const action = () => {
    if (scenario === "typing") apply(state.tr.insertText("あ"));
    if (scenario === "ime") {
      const pos = state.selection.head;
      apply(state.tr.insertText("へん").setMeta("composition", 1));
      apply(state.tr.insertText("変", pos, pos+2).setMeta("composition", 1));
      apply(state.tr.setMeta(api.astKey, { refreshComposition:true }));
    }
    if (scenario === "split-join-away") {
      const tr = state.tr.split(middle);
      apply(tr.setSelection(TextSelection.create(tr.doc, 1)));
      apply(state.tr.join(middle+1));
    }
    if (scenario === "whole-sync") {
      const texts = ast.lines.map(l => l.source); texts[1001] += "追";
      const tr = state.tr.replaceWith(0, state.doc.content.size, schema.node("doc", null, texts.map(paragraph)).content);
      apply(tr.setSelection(TextSelection.create(tr.doc, middle+texts[1001].length)));
    }
    if (scenario === "range-command") {
      const offset=ast.lines.slice(0,1001).reduce((length,line)=>length+line.source.length+1,0)+ast.lines[1001].source.length;
      if(version==="after") apply(api.replaceTextRangeTransaction(state.tr,offset,offset,"追",offset+1));
      else {
        const texts=ast.lines.map(l=>l.source);texts[1001]+="追";
        apply(state.tr.replaceWith(0,state.doc.content.size,schema.node("doc",null,texts.map(paragraph)).content));
        apply(state.tr.setSelection(TextSelection.create(state.doc,middle+texts[1001].length)));
      }
    }
  };
  const SetClass = ast.decoSet.constructor;
  const originalCreate = SetClass.create, originalAdd = SetClass.prototype.add;
  const work = { rebuilds:0, decorationsAdded:0 };
  SetClass.create = (...args) => { work.rebuilds++; return originalCreate(...args); };
  SetClass.prototype.add = function (doc, decorations) { work.decorationsAdded += decorations.length; return originalAdd.call(this, doc, decorations); };
  try { action(); } finally { SetClass.create=originalCreate; SetClass.prototype.add=originalAdd; }
  for (let i=0;i<5;i++) action();
  const elapsed = [];
  for (let i=0;i<samples;i++) { const start=performance.now(); action(); elapsed.push(performance.now()-start); }
  const expected = api.buildWindowDecos(state.doc, ast.lines, ast.tableRows, ast.activeIndex, ast.visibleCenter, ast.fullDecorations, ast.commentsHidden);
  const correct = JSON.stringify(decorationSignature(ast.decoSet)) === JSON.stringify(decorationSignature(expected));
  assert.equal(ast.text, state.doc.textBetween(0,state.doc.content.size,"\n"));
  if (version === "after") assert.ok(correct, `${scenario} failed`);
  const result = {repeat, version, scenario, full, samples, work, correct, mean:elapsed.reduce((a,b)=>a+b,0)/elapsed.length, p50:percentile(elapsed,.5), p95:percentile(elapsed,.95), max:Math.max(...elapsed)};
  results.push(result);
  console.log(JSON.stringify({repeat,version,scenario,full,mean:result.mean,correct}));
}
for (let repeat=0;repeat<repeats;repeat++) for (const full of [false,true]) for (const scenario of ["typing","ime","split-join-away","whole-sync","range-command"]) {
  for (const version of repeat%2 ? ["after","before"] : ["before","after"]) {
    run(version,scenario,full,repeat);
    await writeFile(option("output","artifacts/decoration-mapping-2026-10-10/model-performance.json"),JSON.stringify({partial:true,results},null,2));
  }
}
const summary = [];
for (const full of [false,true]) for (const scenario of ["typing","ime","split-join-away","whole-sync","range-command"]) {
  const row = {full,scenario};
  for (const version of ["before","after"]) {
    const runs=results.filter(r=>r.full===full&&r.scenario===scenario&&r.version===version);
    row[version]={meanMedian:percentile(runs.map(r=>r.mean),.5),p50Median:percentile(runs.map(r=>r.p50),.5),p95Median:percentile(runs.map(r=>r.p95),.5),work:runs[0].work,correct:runs.every(r=>r.correct)};
  }
  summary.push(row);
}
const output={characters:initialTexts.join("\n").length,paragraphs:2000,repeats,samples,results,summary};
await writeFile(option("output","artifacts/decoration-mapping-2026-10-10/model-performance.json"),JSON.stringify(output,null,2));
console.log(JSON.stringify(summary,null,2));
