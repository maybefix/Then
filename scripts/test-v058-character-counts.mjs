import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importStandaloneTypeScript(path) {
  const source = await readFile(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { createDocumentAst, updateDocumentAst } = await importStandaloneTypeScript(
  "src/editor/ast/documentAst.ts",
);

const initialText = "# 見出し\n本文😀\n空　白\n";
let ast = createDocumentAst({ text: initialText, name: "counts.md", indexedAt: 1 });
assert.equal(ast.blocks[1].length, 4, "the existing block length remains UTF-16 based");
assert.equal(ast.blocks[1].textLength, 3, "a surrogate pair counts as one code point");
assert.equal(ast.blocks[2].visibleTextLength, 2, "full-width whitespace is excluded");
assert.equal(ast.textLength, Array.from(initialText).length, "document code-point total matches full text");
assert.equal(
  ast.visibleTextLength,
  Array.from(initialText.replace(/[\s　]/g, "")).length,
  "document visible total matches full text",
);

const unchangedFirstBlock = ast.blocks[0];
const nextText = "# 見出し\n本文😀追記\n空　白\n";
ast = updateDocumentAst(ast, { text: nextText, name: "counts.md", indexedAt: 2 });
assert.equal(ast.blocks[0], unchangedFirstBlock, "unchanged block metrics retain object identity");
assert.equal(ast.textLength, Array.from(nextText).length, "updated code-point total remains exact");
assert.equal(
  ast.visibleTextLength,
  Array.from(nextText.replace(/[\s　]/g, "")).length,
  "updated visible total remains exact",
);

const sectionAst = createDocumentAst({
  text: "# A\nab\n## B\nc d\n# C\n終",
  name: "sections.md",
  indexedAt: 3,
});
const sectionHeadings = [
  sectionAst.outline[0],
  sectionAst.outline[0].children[0],
  sectionAst.outline[1],
];
assert.deepEqual(
  sectionHeadings.map((item) => [item.title, item.sectionTextLength, item.sectionVisibleTextLength]),
  [
    ["A", 7, 4],
    ["B", 9, 5],
    ["C", 5, 3],
  ],
  "each heading stores the exact range count through the line before the next heading",
);

const documentAstSource = await readFile("src/editor/ast/documentAst.ts", "utf8");
assert.doesNotMatch(
  documentAstSource,
  /textLength:\s*Array\.from\(normalized\)\.length/,
  "document assembly must not rescan the complete text for character counts",
);

const appSource = await readFile("src/App.tsx", "utf8");
assert.match(
  appSource,
  /const charCount = settings\.countWhitespace\s*\? activeDocumentAst\.textLength\s*:\s*activeDocumentAst\.visibleTextLength;/,
  "the status bar must consume Document AST aggregate metrics",
);
assert.match(
  appSource,
  /currentFileCharCount=\{charCount\}/,
  "the sidebar active file count must reuse the same aggregate",
);
assert.doesNotMatch(
  appSource,
  /setCharCount\(countDisplayCharacters\(editorText/,
  "App must not recount the complete editor text in an effect",
);

const sidebarSource = await readFile("src/components/layout/sidebarMetrics.ts", "utf8");
assert.match(
  sidebarSource,
  /includeWhitespace \? item\.sectionTextLength : item\.sectionVisibleTextLength/,
  "heading counts must read the range aggregate stored on each outline item",
);
assert.doesNotMatch(
  sidebarSource,
  /const prefix = new Array<number>/,
  "sidebar updates must not rebuild a document-wide line prefix",
);

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
assert.doesNotMatch(
  editorSource,
  /measureDocumentIndexLine/,
  "the production editor parser must not duplicate unused character metrics",
);

console.log("v0.5.8 incremental character count tests passed");
