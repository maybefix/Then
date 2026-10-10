// Differential audit with production fallbacks disabled: incremental results
// must match a fresh rebuild after mixed edits and composition transactions.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, Plugin } from "@tiptap/pm/state";
import { history as editorHistory, undo, redo } from "@tiptap/pm/history";

const refIndex = process.argv.indexOf("--source-ref");
const fileIndex = process.argv.indexOf("--source-file");
const source = fileIndex >= 0 ? await readFile(process.argv[fileIndex + 1], "utf8")
  : refIndex < 0 ? await readFile("src/VerticalTextEditor.tsx", "utf8")
  : execFileSync("git", ["show", `${process.argv[refIndex + 1]}:src/VerticalTextEditor.tsx`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const bundle = await build({
  stdin: {
    contents: source.slice(0, source.indexOf("const LayoutAstExtension")) +
      source.slice(source.indexOf("function textOffsetFromPmPos("), source.indexOf("function getTextSelection(")) +
      `\nexport { makeAstState, applyAst, astKey, buildWindowDecos, textOffsetFromPmPos, pmPosFromTextOffset${source.includes("function docTextLength(") ? ", docTextLength" : ""} };`,
    resolveDir: fileURLToPath(new URL("../src", import.meta.url)), loader: "tsx",
  },
  bundle: true, platform: "node", format: "cjs", write: false,
  external: ["@tiptap/*"], define: { "import.meta.env.DEV": "false" },
});
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
const {
  makeAstState, applyAst, astKey, buildWindowDecos,
  docTextLength, textOffsetFromPmPos, pmPosFromTextOffset,
} = loaded.exports;
const decorationSignature = set => set.find().map(d => `${d.from}:${d.to}:${d.type.constructor.name}:${JSON.stringify(d.type.attrs ?? d.spec ?? null)}`).sort();
const findings = [];
const compare = (ast, state, label) => {
  const expected = "tableRows" in ast
    ? buildWindowDecos(state.doc, ast.lines, ast.tableRows, ast.activeIndex, ast.visibleCenter, ast.fullDecorations, ast.commentsHidden)
    : buildWindowDecos(state.doc, ast.lines, ast.activeIndex, ast.visibleCenter, ast.fullDecorations, ast.commentsHidden);
  const actual = decorationSignature(ast.decoSet), fresh = decorationSignature(expected);
  const mismatch = JSON.stringify(actual) !== JSON.stringify(fresh);
  if (mismatch) findings.push({ label, missing: fresh.filter(value => !actual.includes(value)), extra: actual.filter(value => !fresh.includes(value)) });
  return mismatch ? expected : ast.decoSet;
};
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const paragraph = text => schema.node("paragraph", null, text ? schema.text(text) : undefined);
const samples = ["本文😀。", "", "**太字**", "|東京《とうきょう》", "# 見出し", "// コメント", "<!--", "-->", "```", "| a | b |", "| --- | --- |", "| c | d |", "　全角空白", "e\u0301"];
{
  let state = EditorState.create({ schema,
    doc: schema.node("doc", null, ["a", "", "", "b"].map(paragraph)),
    plugins: [new Plugin({ key: astKey, state: { init: (_config, value) => makeAstState(value), apply: applyAst } }), editorHistory()],
  });
  const apply = tr => { state = state.apply(tr); };
  apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
  const split = state.tr.split(4);
  apply(split.setSelection(TextSelection.create(split.doc, 6)));
  apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  undo(state, apply);
  apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  redo(state, apply);
  const ast = astKey.getState(state);
  compare(ast, state, "Enter in consecutive blank lines, move caret, Undo, move caret, Redo");
}
{
  const texts = Array.from({length:12},(_,i) => i % 2 ? `**太字${i}**` : `# 見出し${i}`);
  let state = EditorState.create({ schema, doc: schema.node("doc", null, texts.map(paragraph)) });
  let ast = makeAstState(state);
  texts[6] += "追記";
  const doc = schema.node("doc", null, texts.map(paragraph));
  const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
  const next = state.apply(tr);
  ast = applyAst(tr, ast, state, next);
  compare(ast, next, "Full content synchronization with only one paragraph changed");
}
let total = 0;
for (const seed of process.argv.includes("--minimal") ? [] : [7, 42, 20261010]) {
  let randomState = seed;
  const random = n => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState % n; };
  let state = EditorState.create({ schema, doc: schema.node("doc", null, Array.from({ length: 180 }, (_, i) => paragraph(samples[i % samples.length]))) });
  let ast = makeAstState(state);
  const apply = tr => { const next = state.apply(tr); ast = applyAst(tr, ast, state, next); state = next; total++; };
  const at = index => { let pos = 1; for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize; return pos; };
  const check = step => {
    const context = `seed=${seed} step=${step}`;
    assert.equal(ast.text, state.doc.textBetween(0, state.doc.content.size, "\n"), `text ${context}`);
    assert.equal(docTextLength(state.doc), ast.text.length, `length ${context}`);
    // Continue from a fresh result after a mismatch so one missing decoration
    // does not turn all subsequent checks into duplicate failures.
    ast.decoSet = compare(ast, state, context);
    const offset = random(ast.text.length + 1);
    assert.equal(textOffsetFromPmPos(state.doc, pmPosFromTextOffset(state.doc, offset)), offset, `offset ${context}`);
  };
  for (let step = 0; step < 1200; step++) {
    const index = random(state.doc.childCount);
    const node = state.doc.child(index);
    const start = at(index);
    const pos = start + random(node.content.size + 1);
    const action = random(8);
    if (action === 0) apply(state.tr.insertText(samples[random(samples.length)], pos));
    else if (action === 1) apply(state.tr.split(pos));
    else if (action === 2 && index > 0) apply(state.tr.join(start - 1));
    else if (action === 3) {
      const endIndex = Math.min(state.doc.childCount - 1, index + random(4));
      const end = at(endIndex) + state.doc.child(endIndex).content.size;
      apply(state.tr.insertText(samples[random(samples.length)], pos, Math.max(pos, end)));
    } else if (action === 4) apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    else if (action === 5) apply(state.tr.setMeta(astKey, {
      fullDecorations: Boolean(random(2)), commentsHidden: Boolean(random(2)), visibleCenter: random(state.doc.childCount),
    }));
    else if (action === 6) {
      apply(state.tr.insertText("へん", pos).setMeta("composition", step));
      apply(state.tr.insertText(samples[random(samples.length)], pos, pos + 2).setMeta("composition", step));
      if (random(3) === 0) apply(state.tr.split(pos).setMeta("composition", step));
      apply(state.tr.setMeta(astKey, { refreshComposition: true }));
    } else {
      // Multiple steps affect opposite ends of the document in one transaction.
      const tr = state.tr.insertText("先", 1);
      tr.insertText("後", tr.doc.content.size - 1);
      apply(tr);
    }
    check(step);
  }
}
const result = { sourceRef: fileIndex >= 0 ? process.argv[fileIndex + 1] : refIndex < 0 ? "working-copy" : process.argv[refIndex + 1], transactions: total, findings };
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) writeFileSync(process.argv[outputIndex + 1], JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
