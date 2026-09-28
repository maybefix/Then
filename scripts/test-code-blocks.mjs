import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: `
export * from './src/editor/ast/documentAst';
export * from './src/editor/ast/characterCount';
export { markdownTableRows } from './src/editor/markdownTables';
export { createProofreadContext, MASK_CHAR } from './src/proofread/context';
`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const {
  classifyLines, createDocumentAst, updateDocumentAst, parseInlines, markdownTableRows,
  createProofreadContext, MASK_CHAR, displayedCharacterCount, displayedSectionCount,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const roles = (text) => classifyLines(text.split("\n"));

// Fences: CommonMark closing rules, unclosed fences stay text.
assert.deepEqual(roles("```js\nconst a = 1;\n```\n本文"), ["codeFence", "code", "codeFence", null]);
assert.deepEqual(roles("~~~\n```\n~~~"), ["codeFence", "code", "codeFence"], "a backtick line cannot close a tilde fence");
assert.deepEqual(roles("````\n```\n````"), ["codeFence", "code", "codeFence"], "a shorter fence cannot close");
assert.deepEqual(roles("```\n```` "), ["codeFence", "codeFence"], "a longer fence with trailing spaces closes");
assert.deepEqual(roles("```\n``` js"), [null, null], "a closing fence cannot carry an info string");
assert.deepEqual(roles("```\n本文\n本文"), [null, null, null], "unclosed fences are plain text");
assert.deepEqual(roles("    ```\nx\n```"), [null, null, null], "four-space indent is not a fence");
assert.deepEqual(roles("``` a`b\nx\n```"), [null, null, null], "backtick info strings cannot contain backticks");

// Code and comments: whichever opens first owns the lines.
assert.deepEqual(roles("```\n// code\n<!-- x -->\n```"), ["codeFence", "code", "code", "codeFence"]);
assert.deepEqual(roles("<!--\n```\n-->\n本文"), ["html", "html", "html", null]);
assert.deepEqual(roles("//```\n本文\n```"), ["slash", null, null], "a commented-out fence does not open code");
assert.deepEqual(roles("//```\n//x\n//```"), ["slash", "slash", "slash"], "a whole block can be commented out");

// AST: code lines keep their text literally.
const ast = createDocumentAst({ text: "# 章\n```md\n# not a heading\n**not bold**\n```\n本文", name: "c.md", indexedAt: 1 });
assert.deepEqual(ast.blocks.map((block) => block.kind), ["heading", "code", "code", "code", "code", "paragraph"]);
assert.equal(ast.outline.length, 1, "a heading inside code is not in the outline");
assert.equal(ast.blocks[1].codeFence, true);
assert.equal(ast.blocks[1].codeInfo, "md");
assert.equal(ast.blocks[3].inlineMarkups.length, 0, "no notation inside code");

// Character counts: code amounts are tracked so they can be excluded.
const plain = createDocumentAst({ text: "# 章\n本文", name: "p.md", indexedAt: 1 });
assert.equal(ast.textLength - ast.codeTextLength, plain.textLength, "excluding code = the text without the code block");
assert.equal(ast.visibleTextLength - ast.codeVisibleTextLength, plain.visibleTextLength);
assert.equal(ast.outline[0].sectionTextLength - ast.outline[0].sectionCodeTextLength, plain.outline[0].sectionTextLength);

// Inline code: literal content, tracked for counting.
const inline = parseInlines("a `**x**` b **y**");
assert.deepEqual(inline.map((markup) => [markup.type, markup.contentText]), [["code", "**x**"], ["bold", "y"]]);
assert.deepEqual(parseInlines("``a`b``").map((markup) => markup.contentText), ["a`b"]);
assert.deepEqual(parseInlines("``").length, 0, "empty backtick pairs are not code");
assert.deepEqual(parseInlines("`open only").length, 0);
const inlineAst = createDocumentAst({ text: "本文`code`", name: "i.md", indexedAt: 1 });
assert.equal(inlineAst.codeTextLength, "`code`".length);
assert.equal(inlineAst.textLength - inlineAst.codeTextLength, 2);

// Incremental update re-derives roles when a fence is opened or closed elsewhere.
let doc = createDocumentAst({ text: "```\n# 見出し\n本文", name: "u.md", indexedAt: 1 });
assert.equal(doc.outline.length, 1);
doc = updateDocumentAst(doc, { text: "```\n# 見出し\n```", name: "u.md", indexedAt: 2 });
assert.deepEqual(doc.blocks.map((block) => block.kind), ["code", "code", "code"]);
assert.equal(doc.outline.length, 0);
doc = updateDocumentAst(doc, { text: "```\n# 見出し\n本文", name: "u.md", indexedAt: 3 });
assert.deepEqual(doc.blocks.map((block) => block.kind), ["paragraph", "heading", "paragraph"]);

// Shared by tables and proofreading.
assert.equal(markdownTableRows("```\n| a | b |\n| --- | --- |\n```".split("\n").map((source) => ({ source }))).size, 0);
assert.equal(markdownTableRows("```\n| a | b |\n| --- | --- |".split("\n").map((source) => ({ source }))).size, 2, "an unclosed fence does not hide a table");
const proof = createProofreadContext("本文\n```\nコード\n```", { skipDialogue: false });
assert.ok(proof.scanText.split("\n").slice(1).every((line) => [...line].every((character) => character === MASK_CHAR)));

// Display options pick the right figure.
const withCode = { includeWhitespace: true, includeCode: true };
const withoutCode = { includeWhitespace: true, includeCode: false };
assert.equal(displayedCharacterCount(ast, withCode), ast.textLength);
assert.equal(displayedCharacterCount(ast, withoutCode), plain.textLength);
assert.equal(displayedCharacterCount(ast, { includeWhitespace: false, includeCode: false }), plain.visibleTextLength);
assert.equal(displayedSectionCount(ast.outline[0], withoutCode), plain.outline[0].sectionTextLength);

console.log("code block tests passed");
