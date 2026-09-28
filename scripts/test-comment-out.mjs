import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: `
export * from './src/editor/ast/documentAst';
export * from './src/export/documentExport';
export * from './src/export/submission/createSubmissionDocument';
export * from './src/export/submission/serializeSubmission';
export * from './src/export/submission/types';
export { createProofreadContext, MASK_CHAR } from './src/proofread/context';
export { toggleLineComments } from './src/editor/lineComments';
export { findTextSearchMatches, replaceTextSearchMatches } from './src/search/textSearch';
`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const {
  detectCommentLines, createDocumentAst, updateDocumentAst, createExportDocument,
  createSubmissionDocument, serializeSubmission, DEFAULT_SUBMISSION_OPTIONS,
  createProofreadContext, MASK_CHAR, toggleLineComments,
  findTextSearchMatches, replaceTextSearchMatches, findCommentLineRanges,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const kinds = (text) => detectCommentLines(text.split("\n"));

// Slash comments: whole line, indentation allowed, full-width slashes ignored.
assert.deepEqual(kinds("// memo\n　// indented\n  //x\n／／ full\n本文 // tail\n\\// escaped"),
  ["slash", "slash", "slash", null, null, null]);

// HTML comments: single line, multi line, unclosed, inline-only.
assert.deepEqual(kinds("<!-- one -->\n本文"), ["html", null]);
assert.deepEqual(kinds("<!-- open\nmiddle\nclose -->\n本文"), ["html", "html", "html", null]);
assert.deepEqual(kinds("<!-- open\n本文\n本文"), [null, null, null], "unclosed opener stays text");
assert.deepEqual(kinds("本文<!-- x -->"), [null], "inline HTML comments are out of scope");
assert.deepEqual(kinds("<!-->\nx -->"), ["html", "html"], "<!--> does not close itself");

// Code fences shield their content.
assert.deepEqual(kinds("```\n// code\n```\n// memo"), [null, null, null, "slash"]);

// AST: comments carry no characters and never become headings.
const text = "# 章\n本文\n// # 没見出し\n続き";
const ast = createDocumentAst({ text, name: "c.md", indexedAt: 1 });
assert.equal(ast.blocks[2].kind, "comment");
assert.equal(ast.outline.length, 1, "a commented heading is not in the outline");
const plain = createDocumentAst({ text: "# 章\n本文\n続き", name: "p.md", indexedAt: 1 });
assert.equal(ast.textLength, plain.textLength, "comments add neither characters nor line breaks");
assert.equal(ast.visibleTextLength, plain.visibleTextLength);
assert.equal(ast.outline[0].sectionVisibleTextLength, plain.outline[0].sectionVisibleTextLength);

// Incremental update re-derives comment state for untouched lines.
const opened = updateDocumentAst(createDocumentAst({ text: "a\nb\nc -->", name: "u.md", indexedAt: 1 }),
  { text: "<!-- a\nb\nc -->", name: "u.md", indexedAt: 2 });
assert.deepEqual(opened.blocks.map((block) => block.kind), ["comment", "comment", "comment"]);
const reopened = updateDocumentAst(opened, { text: "a\nb\nc -->", name: "u.md", indexedAt: 3 });
assert.deepEqual(reopened.blocks.map((block) => block.kind), ["paragraph", "paragraph", "paragraph"]);

// Export: comments vanish, escapes become literal slashes.
const exported = createExportDocument(
  createDocumentAst({ text: "一行目\n// メモ\n二行目\n\\// 本文の斜線", name: "e.md", indexedAt: 1 }),
  "Noto Serif CJK JP",
);
assert.deepEqual(exported.blocks.map((block) => block.inlines.map((inline) => inline.text).join("")),
  ["一行目", "二行目", "// 本文の斜線"]);

const submission = serializeSubmission(
  createSubmissionDocument([{ id: "1", path: "s.md", displayName: "s.md", enabled: true, order: 0,
    content: "本文\n<!-- 没\n案 -->\n\\//斜線" }]),
  DEFAULT_SUBMISSION_OPTIONS,
);
assert.ok(!/没|案|<!--/.test(submission.text), "submission text drops comments");
assert.ok(submission.text.includes("//斜線"));
assert.ok(!submission.text.includes("\\//"));

// Proofread never inspects comment lines.
const proof = createProofreadContext("本文\n// ここは校正しない", { skipDialogue: false });
assert.ok(proof.scanText.split("\n")[1].split("").every((character) => character === MASK_CHAR));

// Ctrl+/ toggle.
const apply = (text, from, to = from) => {
  const edit = toggleLineComments(text, from, to);
  if (!edit) return { text, selection: [from, to] };
  return { text: text.slice(0, edit.from) + edit.insert + text.slice(edit.to), selection: [edit.selectionFrom, edit.selectionTo] };
};
assert.deepEqual(apply("本文", 1), { text: "// 本文", selection: [4, 4] }, "caret stays on its character");
assert.deepEqual(apply("//本文", 3).text, "本文");
assert.deepEqual(apply("// 本文", 3).text, "本文", "one space after // is removed");
assert.equal(apply("　字下げ", 2).text, "　// 字下げ", "// goes after the indentation");
assert.equal(apply("a\n\nb", 0, 4).text, "// a\n\n// b", "blank lines are skipped in a multi-line toggle");
assert.equal(apply("//a\nb", 0, 5).text, "//a\n// b", "mixed lines are all commented");
assert.equal(apply("//a\n//b", 0, 7).text, "a\nb");
assert.equal(apply("a\nb", 0, 2).text, "// a\nb", "a selection ending at a line start excludes that line");
assert.equal(apply(apply("本文", 0).text, 0).text, "本文", "toggling twice restores the line");
assert.equal(apply("<!-- memo -->", 5).text, "memo");
assert.equal(apply("<!-- a\nb\nc -->\nd", 8).text, "a\nb\nc\nd", "unwraps the whole group from a middle line");

// Search skips comment lines unless asked to include them.
const searchText = "猫がいる\n// 猫メモ\n猫";
const skip = findCommentLineRanges(searchText);
assert.deepEqual(skip, [{ from: 5, to: 11 }]);
const plainOptions = { useRegex: false, matchCase: false };
assert.equal(findTextSearchMatches(searchText, "猫", plainOptions, Infinity, skip).total, 2);
assert.equal(findTextSearchMatches(searchText, "猫", plainOptions).total, 3);
assert.equal(replaceTextSearchMatches(searchText, "猫", "犬", plainOptions, skip).text, "犬がいる\n// 猫メモ\n犬");
assert.equal(
  replaceTextSearchMatches(searchText, "^猫", "犬", { useRegex: true, matchCase: false }, skip).text,
  "犬がいる\n// 猫メモ\n犬",
  "line anchors still work around skipped lines",
);

console.log("comment-out tests passed");
