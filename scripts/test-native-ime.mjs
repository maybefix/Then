import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo, redo, closeHistory } from "@tiptap/pm/history";

const bundle = await build({ entryPoints: ["src/editor/nativeIme.ts"], bundle: true, platform: "node", format: "cjs",
  write: false, external: ["@tiptap/*", "@tauri-apps/*"], define: { "import.meta.env.VITE_NATIVE_TSF_LIMITED": '"0"' } });
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
const { nativeImeTransaction, nativeImeCaretRect } = loaded.exports;
assert.deepEqual(nativeImeCaretRect(true, [0,0,0,0], [100,200,24,24], false, [0,0,1,24]), [100,200,24,1]);
assert.deepEqual(nativeImeCaretRect(true, [0,0,0,0], [100,200,24,24], true, [0,0,1,24]), [100,224,24,1]);
assert.deepEqual(nativeImeCaretRect(false, [0,0,0,0], [100,200,24,24], true, [0,0,1,24]), [124,200,1,24]);
assert.deepEqual(nativeImeCaretRect(true, [100,200,24,0], null, false, [0,0,1,24], 1.25), [100,200,24,0.8]);
assert.deepEqual(nativeImeCaretRect(false, [100,200,0,24], null, false, [0,0,1,24], 1.25), [100,200,0.8,24]);
assert.deepEqual(nativeImeCaretRect(true, [0,0,0,0], null, false, [100,200,0,24]), [100,200,24,1]);
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const docOf = lines => schema.node("doc", null, lines.map(text => schema.node("paragraph", null, text ? schema.text(text) : undefined)));
const textOf = state => state.doc.textBetween(0, state.doc.content.size, "\n");
let count = 0;
for (const previous of ["", "入力試験", "あいう", "😀東京😀", "e\u0301", "\uD83D\uDE00\uD83D\uDE01"]) {
  for (const next of ["", "日本語", "あいうえ", "😀大阪😀", "e\u0301東京", previous]) {
    for (const [anchor, head] of [[next.length, next.length], [0, next.length], [next.length, 0]]) {
      let state = EditorState.create({ schema, doc: docOf(["前の段落", previous, "次の段落"]), plugins: [history()] });
      const start = state.doc.child(0).nodeSize + 1;
      const tr = nativeImeTransaction(state, start, previous, { text: next, anchor, head, composing: false, composition: null });
      assert.equal(tr.steps.length, previous === next ? 0 : 1);
      assert.equal(tr.doc.child(0), state.doc.child(0));
      assert.equal(tr.doc.child(2), state.doc.child(2));
      state = state.apply(tr);
      assert.equal(textOf(state), ["前の段落", next, "次の段落"].join("\n"));
      assert.equal(state.selection.anchor, start + anchor); assert.equal(state.selection.head, start + head);
      if (previous !== next) {
        assert.ok(undo(state, tr => { state = state.apply(tr); })); assert.equal(state.doc.child(1).textContent, previous);
        assert.ok(redo(state, tr => { state = state.apply(tr); })); assert.equal(state.doc.child(1).textContent, next);
      }
      count++;
    }
  }
}
let state = EditorState.create({ schema, doc: docOf(["前", "", "後"]), plugins: [history()] });
const start = state.doc.child(0).nodeSize + 1;
state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
const beforeSelection = state.selection.toJSON();
state = state.apply(closeHistory(state.tr));
for (const next of ["n", "に", "にほ", "にほん", "日本"]) {
  state = state.apply(nativeImeTransaction(state, start, state.doc.child(1).textContent,
    { text: next, anchor: next.length, head: next.length, composing: true, composition: [0, next.length] }).setMeta("composition", "test-session"));
}
assert.equal(state.doc.child(1).textContent, "日本");
assert.ok(undo(state, tr => { state = state.apply(tr); }));
assert.equal(state.doc.child(1).textContent, ""); assert.deepEqual(state.selection.toJSON(), beforeSelection);
assert.ok(redo(state, tr => { state = state.apply(tr); })); assert.equal(state.doc.child(1).textContent, "日本");

state = EditorState.create({ schema, doc: docOf(Array.from({ length: 2400 }, (_, i) => `段落${i}　${"長い原稿の入力試験。".repeat(5)}`)) });
let middle = 1; for (let i = 0; i < 1200; i++) middle += state.doc.child(i).nodeSize;
const previous = state.doc.child(1200).textContent;
const tr = nativeImeTransaction(state, middle, previous,
  { text: previous + "追記", anchor: previous.length + 2, head: previous.length + 2, composing: false, composition: null });
assert.ok(textOf(state).length > 100000);
assert.equal(tr.doc.child(100), state.doc.child(100)); assert.equal(tr.doc.child(2300), state.doc.child(2300));
assert.equal(tr.steps.length, 1);
console.log(JSON.stringify({ paragraphReplacementCases: count, compositionUndoRedo: true,
  characters: textOf(state).length, unchangedParagraphsRetained: true }));
