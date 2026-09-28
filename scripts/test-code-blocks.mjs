import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: `
export * from './src/editor/ast/documentAst';
export * from './src/editor/ast/characterCount';
export { markdownTableRows } from './src/editor/markdownTables';
export { createProofreadContext, MASK_CHAR } from './src/proofread/context';
export { createExportDocument } from './src/export/documentExport';
export { createLinkedExportDocument, buildLinkedPrintHtml, paginateLinkedDocument } from './src/export/linkedDocument';
export { buildLinkedVivliostyleHtml } from './src/export/vivliostyleHtml';
export { generateVerticalDocx } from './src/export/wordprocessingMl';
export { DEFAULT_EXPORT_LAYOUT } from './src/export/types';
export * from './src/export/submission/createSubmissionDocument';
export * from './src/export/submission/serializeSubmission';
export * from './src/export/submission/types';
`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const exportsModule = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
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

// Export: code keeps its lines verbatim, fences are not printed, notation is literal.
const {
  createExportDocument, createLinkedExportDocument, buildLinkedPrintHtml, paginateLinkedDocument,
  buildLinkedVivliostyleHtml, generateVerticalDocx, DEFAULT_EXPORT_LAYOUT,
  createSubmissionDocument, serializeSubmission, DEFAULT_SUBMISSION_OPTIONS,
} = exportsModule;
const manuscript = "本文一行目\n本文二行目\n```js\nif (a) {\n    **b**();\n}\n```\n本文`x<y`の続き";
const exported = createExportDocument(createDocumentAst({ text: manuscript, name: "e.md", indexedAt: 1 }), "Noto Serif CJK JP");
const codeBlock = exported.blocks.find((block) => block.kind === "code");
assert.ok(codeBlock, "a code block is exported as one block");
assert.deepEqual(
  codeBlock.inlines.map((inline) => (inline.kind === "break" ? "\n" : inline.text)).join(""),
  "if (a) {\n    **b**();\n}",
  "code lines are verbatim and fences are dropped",
);
assert.ok(exported.blocks.at(-1).inlines.some((inline) => inline.kind === "code" && inline.text === "x<y"));

const source = { id: "s", path: "s.md", extension: "md", displayName: "s.md", chars: 0, enabled: true, order: 0, startMode: "continue", markupMode: "then-markup", content: manuscript };
const job = { format: "pdf", title: "t", sources: [{ ...source, content: undefined }], layout: JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT)) };
const linked = createLinkedExportDocument(job, [source]);
const blocks = linked.sections[0].blocks;
assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "code", "paragraph"], "code is not merged into body paragraphs");
assert.ok(paginateLinkedDocument(linked).length >= 1);
const viv = buildLinkedVivliostyleHtml(linked, "http://127.0.0.1:1420/");
assert.match(viv, /<p class="then-block then-code[^"]*">if \(a\) \{<br>    \*\*b\*\*\(\);<br>\}<\/p>/);
assert.match(viv, /<code class="then-code-inline">x&lt;y<\/code>/);
assert.match(viv, /\.then-code \{ white-space: pre-wrap;/);
assert.doesNotMatch(viv, /```/, "fences are not printed");
assert.match(buildLinkedPrintHtml(linked, "http://127.0.0.1:1420/"), /then-code/);

const { readFile } = await import("node:fs/promises");
const JSZip = (await import("jszip")).default;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => new Response(await readFile(`public/fonts/${String(input).includes("Sans") ? "NotoSansCJKjp-Regular.otf" : "NotoSerifCJKjp-Regular.otf"}`));
const docx = await generateVerticalDocx(linked);
globalThis.fetch = originalFetch;
const documentXml = await (await JSZip.loadAsync(docx)).file("word/document.xml").async("string");
assert.match(documentXml, /<w:t xml:space="preserve">    \*\*b\*\*\(\);<\/w:t>/, "DOCX keeps code spaces and notation");
assert.match(documentXml, /w:ascii="MS Gothic"/);

const submission = serializeSubmission(createSubmissionDocument([source]), { ...DEFAULT_SUBMISSION_OPTIONS, lineEnding: "lf" });
assert.ok(submission.text.includes("```js\nif (a) {\n    **b**();\n}\n```"), "novel text keeps code as typed");
assert.ok(submission.text.includes("本文`x<y`の続き"));

console.log("code block tests passed");
