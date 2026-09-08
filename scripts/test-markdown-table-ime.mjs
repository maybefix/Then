import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { JSDOM } from "jsdom";

const source = await readFile("src/VerticalTextEditor.tsx", "utf8");
const functionSource = source.slice(source.indexOf("function pushTableRowDecos("), source.indexOf("function buildWindowDecos("));
const js = ts.transpileModule(functionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const decorate = new Function("Decoration", "TextSelection", `${js}; return pushTableRowDecos;`)(Decoration, TextSelection);
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const stateFor = (text) => EditorState.create({ schema, doc: schema.node("doc", null, [schema.node("paragraph", null, schema.text(text))]) });

// The live editor maps these same decorations during composition. Test both
// cell boundaries, including replacing an in-progress composition string.
for (const pos of [2, 4]) {
  const state = stateFor("|ab|");
  const decos = [];
  decorate(decos, state.doc.firstChild, 0, { cells: [{ from: 1, to: 3 }], columns: 1, alignments: ["start"], kind: "body" }, true);
  const tr = state.tr.insertText("にほん", pos).setMeta("composition", 1);
  const mapped = DecorationSet.create(state.doc, decos).map(tr.mapping, tr.doc);
  const cell = mapped.find().find((d) => d.type.attrs?.class === "pm-table-cell");
  assert.ok(cell.from <= pos && cell.to >= pos + 3, "composition text must stay inside its cell at either boundary");
  const next = state.apply(tr);
  const commit = next.tr.insertText("日本", pos, pos + 3).setMeta("composition", 1);
  const committed = mapped.map(commit.mapping, commit.doc).find().find((d) => d.type.attrs?.class === "pm-table-cell");
  assert.ok(committed.from <= pos && committed.to >= pos + 2);
  assert.equal(commit.doc.textContent, pos === 2 ? "|日本ab|" : "|ab日本|");
}

const dom = new JSDOM("<!doctype html><body></body>");
globalThis.document = dom.window.document;
const empty = stateFor("||");
const decos = [];
decorate(decos, empty.doc.firstChild, 0, { cells: [{ from: 1, to: 1 }], columns: 1, alignments: ["start"], kind: "body" }, true);
const widget = decos.find((d) => d.spec.key?.startsWith("table-empty-0-"));
let resulting;
let focused = false;
const span = widget.type.toDOM({ state: empty, dispatch: (tr) => { resulting = empty.apply(tr); }, focus: () => { focused = true; } }, () => 2);
span.dispatchEvent(new dom.window.MouseEvent("mousedown", { cancelable: true }));
assert.equal(resulting, undefined, "focusing an empty cell must not change source text");
const input = span.firstElementChild;
input.dispatchEvent(new dom.window.CompositionEvent("compositionstart"));
input.textContent = "日本";
input.dispatchEvent(new dom.window.InputEvent("input", { isComposing: true }));
assert.equal(resulting, undefined, "keep unfinished IME text in the input DOM");
input.dispatchEvent(new dom.window.CompositionEvent("compositionend"));
assert.equal(resulting.doc.textContent, "|日本|", "commit only typed text, without padding");
assert.equal(resulting.selection.from, 4);
assert.ok(focused);
dom.window.close();
console.log("Table IME boundary mapping, conversion and empty-cell preparation passed.");

