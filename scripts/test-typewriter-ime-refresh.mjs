import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

const source = await readFile("src/VerticalTextEditor.tsx", "utf8");
const bundle = await build({
  stdin: { contents: source.slice(0, source.indexOf("const LayoutAstExtension")) + "\nexport { makeAstState, applyAst, astKey, buildWindowDecos };", resolveDir: fileURLToPath(new URL("../src", import.meta.url)), loader: "tsx" },
  bundle: true, platform: "node", format: "cjs", write: false,
  external: ["@tiptap/*"], define: { "import.meta.env.DEV": "false" },
});
const module = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { makeAstState, applyAst, astKey, buildWindowDecos } = module.exports;
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
for (const full of [false, true]) {
  let state = EditorState.create({ schema, doc: schema.node("doc", null, Array.from({ length: 100 }, (_, i) => schema.node("paragraph", null, i % 8 ? schema.text(`段落${i} **強調** |漢字《かんじ》`) : undefined))) });
  let ast = makeAstState(state);
  const apply = tr => { const next = state.apply(tr); ast = applyAst(tr, ast, state, next); state = next; };
  apply(state.tr.setMeta(astKey, { rebuild: true, fullDecorations: full }));
  let middle = 1; for (let i = 0; i < 50; i++) middle += state.doc.child(i).nodeSize;
  apply(state.tr.setSelection(TextSelection.create(state.doc, middle)));
  for (const text of ["日本語", "**太字**", "|東京《とうきょう》", "。"]) {
    apply(state.tr.insertText(text).setMeta("composition", 1));
    assert.ok(ast.decoWindow.stale);
    const SetClass = ast.decoSet.constructor;
    const original = SetClass.create;
    let rebuilds = 0;
    SetClass.create = (...args) => { rebuilds++; return original(...args); };
    try { apply(state.tr.setMeta(astKey, { refreshComposition: true })); }
    finally { SetClass.create = original; }
    assert.equal(rebuilds, 0, "ordinary IME confirmation must patch rather than rebuild the document");
    const expected = buildWindowDecos(state.doc, ast.lines, ast.tableRows, ast.activeIndex, ast.visibleCenter, ast.fullDecorations, ast.commentsHidden);
    assert.ok(ast.decoSet.eq(expected), "patched IME decorations must equal a fresh rebuild");
    assert.equal(ast.decoWindow.stale, null);
  }
  apply(state.tr.split(state.selection.head).setMeta("composition", 2));
  assert.equal(ast.decoWindow.rebuild, true, "changing paragraph structure retains the safe rebuild path");
  apply(state.tr.setMeta(astKey, { refreshComposition: true }));
  const expected = buildWindowDecos(state.doc, ast.lines, ast.tableRows, ast.activeIndex, ast.visibleCenter, ast.fullDecorations, ast.commentsHidden);
  assert.ok(ast.decoSet.eq(expected));
}
console.log("PASS IME refresh: normal/windowed and full formatting, ruby/bold, zero unnecessary rebuilds and structural fallback");
