import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: `
export * from './src/export/submission/createSubmissionDocument';
export * from './src/export/submission/serializeSubmission';
export * from './src/export/submission/types';
export * from './src/export/submission/graphemes';
export * from './src/editor/ast/documentAst';
`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const { createSubmissionDocument, createSubmissionSection, serializeSubmission, DEFAULT_SUBMISSION_OPTIONS,
  splitGraphemes, createDocumentAst } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const source = (content, extra = {}) => ({ id: "one", displayName: "本文.txt", path: "本文.txt",
  extension: "txt", enabled: true, order: 0, startMode: "continue", markupMode: "then-markup", content, ...extra });
const convert = (content, options = {}) => serializeSubmission(createSubmissionDocument([source(content)]),
  { ...DEFAULT_SUBMISSION_OPTIONS, lineEnding: "lf", ...options });

assert.equal(convert("一行\r\n次行\r\n\r\n　 空白\t\r終わり\n\n").text, "一行\n次行\n\n　 空白\t\n終わり\n");
for (let level = 1; level <= 6; level++) assert.equal(convert(`${"#".repeat(level)} 題\n本文`).text, "題\n本文\n");
assert.equal(convert("# 題\n本文\n## 節", { headingMode: "remove-first" }).text, "本文\n節\n");
assert.equal(convert("# 題\n本文\n## 節", { headingMode: "remove-all" }).text, "本文\n");
for (const target of ["kakuyomu", "narou"]) {
  assert.equal(convert("[東京(rb,とうきょう)]と[東京(rb,とう きょう)]と漢字《かんじ》", { target }).text,
    "｜東京《とうきょう》と｜東《とう》｜京《きょう》と｜漢字《かんじ》\n");
}
for (const style of ["goma", "dot", "auto"]) {
  assert.equal(convert(`[重要(em,${style})]`).text, "《《重要》》\n");
}
for (const [input, expected] of [
  ["重要", "｜重《・》｜要《・》"],
  ["とても重要", "｜と《・》｜て《・》｜も《・》｜重《・》｜要《・》"],
  ["A級", "｜A《・》｜級《・》"], ["重要！", "｜重《・》｜要《・》｜！《・》"],
  ["重要 語句", "｜重《・》｜要《・》 ｜語《・》｜句《・》"],
  ["👨‍👩‍👧‍👦か\u3099葛\u{E0100}", "｜👨‍👩‍👧‍👦《・》｜か\u3099《・》｜葛\u{E0100}《・》"],
]) assert.equal(convert(`[${input}(em,goma)]`, { target: "narou" }).text, `${expected}\n`);
assert.equal(splitGraphemes("👨‍👩‍👧‍👦か\u3099葛\u{E0100}").length, 3);
assert.equal(convert("[重要(em)]", { target: "narou", narouEmphasisMode: "plain" }).text, "重要\n");
const decorations = "[(al:center)][字(rb,じ)][重要(em,goma)][12(tcy)]**太字**";
assert.equal(convert(decorations, { target: "plain" }).text, "字重要12太字\n");
assert.equal(convert(decorations, { target: "plain" }).warnings.length, 0);
assert.equal(convert(decorations).warnings.filter(w => w.kind === "decoration-removed").length, 2);
assert.equal(convert("記号｜《》").warnings[0].kind, "literal-notation-conflict");
assert.equal(convert(`[${"字".repeat(21)}(rb,じ)]`).warnings[0].kind, "ruby-limit");
assert.equal(convert(`[字(rb,${"じ".repeat(51)})]`).warnings[0].kind, "ruby-limit");
assert.equal(convert(`[字(rb,${"じ".repeat(11)})]`, { target: "narou" }).warnings[0].kind, "ruby-limit");
assert.equal(convert('[A&B(rb,えー)]', { target: "narou" }).warnings[0].kind, "literal-notation-conflict");
assert.equal(convert("本文\n［＃未知］").warnings[0].line, 2);
assert.equal(convert("本文［＃未知］").text, "本文［＃未知］\n");
assert.equal(convert("本文［＃未知］", { target: "plain" }).text, "本文\n");
assert.equal(convert("［＃地付き］本文").text, "本文\n");
assert.equal(convert("[**重要**(em)]").warnings[0].kind, "nested-decoration");
const sources = [source("# 二\n乙\n\n", { order: 2 }), source("除外", { enabled: false }),
  source("# 一\n甲", { id: "two", order: 1 })];
const before = structuredClone(sources);
const doc = createSubmissionDocument(sources);
const docBefore = structuredClone(doc);
assert.equal(serializeSubmission(doc, { ...DEFAULT_SUBMISSION_OPTIONS, headingMode: "remove-first" }).text, "甲\r\n\r\n\r\n乙\r\n");
assert.equal(serializeSubmission(doc, { ...DEFAULT_SUBMISSION_OPTIONS, sourceSeparator: "\r\n＊\r\n", lineEnding: "lf" }).text,
  "一\n甲\n＊\n二\n乙\n");
assert.deepEqual(sources, before);
assert.deepEqual(doc, docBefore);
const ast = createDocumentAst({ text: decorations });
const astBefore = structuredClone(ast);
const section = createSubmissionSection(ast, source(decorations));
serializeSubmission({ schemaVersion: 1, title: "", sections: [section] }, DEFAULT_SUBMISSION_OPTIONS);
assert.deepEqual(ast, astBefore);
assert.throws(() => createSubmissionDocument([]), /出力対象/);
assert.equal(convert("😀", { lineEnding: "lf" }).chars, convert("😀", { lineEnding: "crlf" }).chars);
const started = performance.now();
convert("本文[重要(em,goma)]\n".repeat(10000), { target: "narou" });
console.log(`Submission export assertions passed; 10,000-line AST + serialization: ${Math.round(performance.now() - started)}ms`);
