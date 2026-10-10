import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { Schema } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Transform } from "@tiptap/pm/transform";

const source = await readFile("src/editor/indexedDecorations.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace('"@tiptap/pm/view"', JSON.stringify(import.meta.resolve("@tiptap/pm/view")));
const { indexRootDecorations } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
let doc = schema.node("doc", null, Array.from({ length: 2400 }, (_, i) => schema.node("paragraph", null, i % 7 ? schema.text(`日本語の段落 ${i}`) : undefined)));
const decorations = [];
doc.forEach((node, pos, index) => {
  decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "pm-line" }));
  if (node.content.size) decorations.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: "bold" }));
  if (index % 19 === 0) decorations.push(Decoration.widget(pos + 1, () => null, { key: `widget-${index}` }));
});
let set = DecorationSet.create(doc, decorations);
const compare = () => {
  const optimized = indexRootDecorations(set);
  assert.ok(optimized instanceof DecorationSet);
  assert.equal(indexRootDecorations(set), optimized);
  doc.forEach((node, pos) => assert.equal(optimized.forChild(pos, node), set.forChild(pos, node), "child sources must be identical to ProseMirror's originals"));
  assert.deepEqual(optimized.find(), set.find());
  const groups = [];
  optimized.forEachSet(value => groups.push(value));
  assert.deepEqual(groups, [optimized]);
  assert.equal(Object.hasOwn(set, "forChild"), false, "the immutable original must not be changed");
};
compare();
for (let step = 0; step < 12; step++) {
  const tr = new Transform(doc).insert(1, schema.text("追加"));
  set = set.map(tr.mapping, tr.doc);
  doc = tr.doc;
  compare();
}
const crossParagraph = DecorationSet.create(doc, [Decoration.inline(1, doc.content.size - 1, { class: "search" })]);
assert.equal(indexRootDecorations(crossParagraph), crossParagraph, "cross-paragraph inline decorations must retain the normal implementation");
assert.equal(indexRootDecorations(DecorationSet.empty).forChild(0, doc.firstChild), DecorationSet.empty);
console.log("PASS indexed decorations: 2400 paragraphs, inline styles, widgets, mapped edits, immutable originals and fallback");
