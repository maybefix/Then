import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { loadEditorAuditModule, decorationSignature } from "./lib/editor-audit-module.mjs";

const { makeAstState, applyAst, astKey, buildWindowDecos, spliceRootDecorations } = await loadEditorAuditModule();
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const paragraph = text => schema.node("paragraph", null, text ? schema.text(text) : undefined);
const docOf = lines => schema.node("doc", null, lines.map(paragraph));
const alphabet = ["", "a", "# h", "**b**"];
const documents = [];
function enumerate(prefix) {
  if (prefix.length) documents.push(docOf(prefix));
  if (prefix.length < 3) for (const line of alphabet) enumerate([...prefix, line]);
}
enumerate([]);
let checks = 0;
function apply(state, ast, tr) {
  const previousSignature = decorationSignature(ast.decoSet);
  const next = state.apply(tr);
  const result = applyAst(tr, ast, state, next);
  const expected = buildWindowDecos(next.doc, result.lines, result.tableRows, result.activeIndex, result.visibleCenter, result.fullDecorations, result.commentsHidden);
  assert.deepEqual(decorationSignature(result.decoSet), decorationSignature(expected), JSON.stringify({ old: state.doc.toJSON(), new: next.doc.toJSON(), steps: tr.steps.map(s => s.toJSON()) }));
  assert.equal(result.text, next.doc.textBetween(0, next.doc.content.size, "\n"));
  assert.deepEqual(decorationSignature(ast.decoSet), previousSignature, "previous editor states remain immutable");
  checks++;
  return [next, result];
}
for (const full of [false, true]) for (const oldDoc of documents) {
  const base = EditorState.create({ schema, doc: oldDoc });
  let ast = makeAstState(base);
  if (full) [, ast] = apply(base, ast, base.tr.setMeta(astKey, { fullDecorations: true }));
  for (const newDoc of documents) {
    // Every ordered pair of documents, including identical and repeated lines.
    const tr = base.tr.replaceWith(0, oldDoc.content.size, newDoc.content);
    tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
    apply(base, ast, tr);
  }
  let start = 1;
  oldDoc.forEach(node => {
    for (let offset = 0; offset <= node.content.size; offset++) {
      const tr = base.tr.split(start + offset);
      tr.setSelection(TextSelection.create(tr.doc, 1));
      apply(base, ast, tr);
    }
    if (start > 1) apply(base, ast, base.tr.join(start - 1));
    start += node.nodeSize;
  });
}

// Verify work counts separately from wall-clock timing. A one-line update in
// a fully formatted long document must preserve far-away decoration branches.
const longDoc = docOf(Array.from({ length: 2400 }, (_, i) => `段落${i} **太字**`));
let state = EditorState.create({ schema, doc: longDoc });
let ast = makeAstState(state);
// The caret sits in the edited paragraph, so the decoration window (every
// decoration) stays put; lines outside it carry only the layout-affecting
// ones and must not be touched by the edit either.
let caret = 1;
for (let i = 0; i < 1200; i++) caret += longDoc.child(i).nodeSize;
[state, ast] = apply(state, ast, state.tr.setSelection(TextSelection.create(state.doc, caret)).setMeta(astKey, { fullDecorations: true, visibleCenter: 1200 }));
// The extracted bundle loads the CommonJS library; spy on the actual set's
// constructor, rather than the separate ESM entry point used by this script.
const SetClass = ast.decoSet.constructor;
const originalCreate = SetClass.create;
const originalAdd = SetClass.prototype.add;
const work = { rebuilds: 0, decorationsAdded: 0 };
SetClass.create = (...args) => { work.rebuilds++; return originalCreate(...args); };
SetClass.prototype.add = function (doc, decorations) { work.decorationsAdded += decorations.length; return originalAdd.call(this, doc, decorations); };
const texts = ast.lines.map(l => l.source);
const previousSignature = decorationSignature(ast.decoSet);
texts[1200] += "追記";
const tr = state.tr.replaceWith(0, state.doc.content.size, docOf(texts).content);
tr.setSelection(TextSelection.create(tr.doc, caret));
const next = state.apply(tr);
let updated;
try { updated = applyAst(tr, ast, state, next); }
finally { SetClass.create = originalCreate; SetClass.prototype.add = originalAdd; }
assert.equal(work.rebuilds, 0, "one-paragraph synchronization must not rebuild the whole set");
assert.deepEqual(decorationSignature(ast.decoSet), previousSignature, "splicing must not mutate the previous tree");
assert.ok(work.decorationsAdded > 0, "the counter must observe the actual decoration implementation");
assert.ok(work.decorationsAdded < 40, "only changed/adjacent/caret lines are redecorated");
let unchangedStart = 0;
for (let i = 0; i < 100; i++) unchangedStart += state.doc.child(i).nodeSize;
assert.equal(updated.decoSet.forChild(unchangedStart, next.doc.child(100)), ast.decoSet.forChild(unchangedStart, state.doc.child(100)), "unchanged far-away inline branches retain identity");
assert.deepEqual(decorationSignature(updated.decoSet), decorationSignature(buildWindowDecos(next.doc, updated.lines, updated.tableRows, updated.activeIndex, updated.visibleCenter, updated.fullDecorations, updated.commentsHidden)));
// ProseMirror normalizes empty local/child arrays separately. Both node-only
// and empty roots must remain supported without triggering a full rebuild.
const blankState = EditorState.create({ schema, doc: docOf(["", "", ""]) });
const blankAst = makeAstState(blankState);
assert.ok(spliceRootDecorations(blankAst.decoSet, blankAst.lines, [{source:""},{source:"a"},{source:""}], {from:1,toOld:2,toNew:2}));
assert.equal(spliceRootDecorations(SetClass.empty, [{source:""}], [{source:"a"}], {from:0,toOld:1,toNew:1}), SetClass.empty);
assert.equal(spliceRootDecorations({local:[],children:[0,2,{}]}, [{source:""}], [{source:"a"}], {from:0,toOld:1,toNew:1}), null, "unsupported child shapes request the standard rebuild");
assert.equal(spliceRootDecorations({local:[{inline:true}],children:[]}, [{source:""}], [{source:"a"}], {from:0,toOld:1,toNew:1}), null, "unsupported root decorations request the standard rebuild");
console.log(JSON.stringify({ checks, documents: documents.length, longDocumentWork: work }));
