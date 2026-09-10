import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/editor/markdownTables.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { splitTableRow, markdownTableRows, createMarkdownTable, tableAtOffset, tableAlignmentEdit, textExtent } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const parse = (text) => markdownTableRows(text.split("\n").map((source) => ({ source })));
const sample = "前文\n| 名前 | 個数 |\n| :--- | ---: |\n| りんご | 12 |\n| みかん | 3 |\n\n後文";
const rows = parse(sample);
assert.equal(rows.size, 4);
assert.deepEqual(rows.get(1).alignments, ["start", "end"]);
assert.equal(rows.get(4).kind, "body");
assert.equal(parse("a | b\n--- | :---:\nc | d").size, 3);
assert.equal(parse("a | b\n---\nc | d").size, 0);
assert.equal(parse("a | b\n-- | ---").size, 0);
assert.equal(parse("```md\n" + sample + "\n```").size, 0);
assert.equal(parse("~~~\n" + sample + "\n~~~").size, 0);
assert.equal(parse("    | a | b |\n    | --- | --- |").size, 0);
for (const text of ["| a\\|b | c |", "a | b", "||", "| | |", "| a\\\\| b |", " | 日本語 | 😀 | "]) {
  const cells = splitTableRow(text);
  assert.ok(cells);
  let cursor = 0;
  let reconstructed = "";
  for (const cell of cells) {
    assert.ok(cell.to >= cell.from);
    reconstructed += text.slice(cursor, cell.from) + text.slice(cell.from, cell.to);
    cursor = cell.to;
  }
  reconstructed += text.slice(cursor);
  assert.equal(reconstructed, text, "source offsets must preserve exact Markdown");
}
assert.equal(splitTableRow("| a\\|b | c |").length, 2);
assert.equal(splitTableRow("| a\\\\| b |").length, 2);
assert.equal(splitTableRow("a\\|b"), null);
assert.equal(splitTableRow("||")[0].from, splitTableRow("||")[0].to);
const uneven = parse("| a | b |\n| --- | --- |\n| c |\n| d | e | f |");
assert.ok([...uneven.values()].every((row) => row.columns === 3));
assert.equal(parse(sample.replace("りんご", "長い日本語のセル内容")).size, 4);
assert.equal(parse(sample.replace("| :--- | ---: |", "通常の文章")).size, 0);
console.log("Markdown table parsing and source preservation passed.");

const widthSample = "| 品名 | 数量 | 備考 |\n| --- | --- | --- |\n| りんご | 12 | 青森県産のとても甘いりんごです |\n| み | 3 | 甘い |";
const widthRows = parse(widthSample);
const widths = widthRows.get(0).widths;
assert.equal(widths.length, 3);
for (const row of widthRows.values()) assert.equal(row.widths, widths, "one table shares one set of column extents");
assert.ok(widths[2] > widths[0] && widths[0] > widths[1], "columns are ordered by their widest cell");
assert.equal(widths[0], textExtent("りんご"), "a column is as wide as its widest cell, header included");
assert.ok(widths[1] >= 2, "a narrow column still keeps a usable minimum");
assert.ok(textExtent("12") < 2 * textExtent("あ"), "half-width characters advance less than an em");
assert.deepEqual(parse(createMarkdownTable(2, 1)).get(0).widths,
  [textExtent("見出し1"), textExtent("見出し2")], "a new table is sized by its headings");
assert.equal(parse("| a |\n| --- |\n| " + "あ".repeat(80) + " |").get(0).widths[0], 24,
  "a very long cell is capped so the other columns stay readable");
console.log("Table column extents passed.");

const created = createMarkdownTable(3, 2);
assert.equal(created.includes(" "), false, "generated tables must not contain padding spaces");
assert.equal(created.split("\n")[2], "||||", "empty cells have no source text");
assert.equal(parse(created).size, 4);
assert.equal(parse(created).get(0).cells.length, 3);
assert.equal(parse(createMarkdownTable(1, 1)).size, 3);
const secondColumn = sample.indexOf("12");
assert.equal(tableAtOffset(sample, secondColumn).column, 1);
for (const alignment of ["start", "center", "end"]) {
  const edit = tableAlignmentEdit(sample, secondColumn, alignment);
  const next = sample.slice(0, edit.from) + edit.insert + sample.slice(edit.to);
  assert.equal(parse(next).get(1).alignments[1], alignment);
  assert.equal(parse(next).get(1).alignments[0], "start");
  assert.equal(next.slice(edit.cursorPos, edit.cursorPos + 2), "12", "caret stays in the original cell after rule length changes");
  assert.equal(next.split("\n")[3], sample.split("\n")[3], "cell content is preserved");
}
const headerEdit = tableAlignmentEdit(sample, sample.indexOf("名前"), "center");
assert.equal(headerEdit.cursorPos, sample.indexOf("名前"));
assert.equal(tableAlignmentEdit(sample, 0, "center"), null);
console.log("Table creation, column alignment and caret restoration passed.");
