import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const asModule = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64")}`;
const parser = asModule(await readFile("src/editor/markdownTables.ts", "utf8"));
const module = asModule((await readFile("src/editor/tableNavigation.ts", "utf8")).replace('"./markdownTables"', JSON.stringify(parser)));
const { tableCaretTarget: move, tableCellCaret: home } = await import(module);
const text = "前文\n|甲|乙|\n|---|---|\n||内容|\n|末尾|次|\n後文";
const header = text.indexOf("甲");
const empty = text.indexOf("||") + 1;
const content = text.indexOf("内容");
for (const vertical of [false, true]) {
  const nextRow = vertical ? "ArrowLeft" : "ArrowDown";
  const previousRow = vertical ? "ArrowRight" : "ArrowUp";
  const forward = vertical ? "ArrowDown" : "ArrowRight";
  const backward = vertical ? "ArrowUp" : "ArrowLeft";
  assert.equal(move(text, header, nextRow, vertical).pos, empty, "skip hidden rule and enter empty cell");
  assert.equal(move(text, empty, forward, vertical).pos, content);
  assert.equal(move(text, empty, previousRow, vertical).pos, header);
  assert.equal(move(text, content, backward, vertical).pos, empty);
  assert.equal(move(text, content + 1, forward, vertical), null, "native movement inside content");
  assert.equal(move(text, empty, "Tab", vertical).pos, content);
  assert.equal(move(text, content, "Tab", vertical, true).pos, empty);
  assert.equal(move(text, content, "Backspace", vertical).pos, content, "do not erase hidden pipe");
  assert.equal(move(text, content + 2, "Delete", vertical).pos, content + 2);
  assert.equal(move(text, text.indexOf("次") + 1, "Tab", vertical).pos, text.indexOf("後文"));
}
const padded = "|  見出し  |\n|---|\n|  本文  |";
assert.equal(move(padded, padded.indexOf("本文"), "Home", false).pos, padded.indexOf("本文"));
assert.equal(move(padded, padded.indexOf("本文"), "End", false).pos, padded.indexOf("本文") + 2);
assert.equal(move("普通の本文", 0, "ArrowDown", false), null);
const firstTable = "|甲|乙|\n|---|---|\n|本文|内容|";
for (const vertical of [false, true]) {
  const before = move(firstTable, 1, vertical ? "ArrowRight" : "ArrowUp", vertical);
  assert.equal(before.insertBefore, true, "moving before a leading table creates a text paragraph");
  const existing = move("\n" + firstTable, 2, vertical ? "ArrowRight" : "ArrowUp", vertical);
  assert.equal(existing.pos, 0);
  assert.equal(existing.insertBefore, undefined, "reuse the preceding paragraph");
}
// Arrow keys from the line beside a table drop the caret on hidden syntax.
for (const vertical of [false, true]) {
  const lines = text.split("\n");
  const startAt = (index) => lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
  const lastRow = 4;
  assert.equal(home(text, startAt(lastRow) + lines[lastRow].length, vertical).pos,
    text.indexOf("|次|") + 2, "the end of a row belongs to its last cell, not the closing pipe");
  assert.equal(home(text, startAt(lastRow), vertical).pos, text.indexOf("末尾"),
    "the start of a row belongs to its first cell, not the opening pipe");
  assert.equal(home(text, startAt(2) + 2, vertical).pos, empty,
    "the hidden rule row hands the caret to the first body cell");
  const inside = text.indexOf("内容") + 1;
  assert.equal(home(text, inside, vertical).pos, inside, "a caret already in a cell is left alone");
  assert.equal(home("普通の本文", 2, vertical), null, "plain paragraphs are untouched");
}
const paddedHome = "| 甲 | 乙 |\n| --- | --- |\n| 本文 | 内容 |";
assert.equal(home(paddedHome, paddedHome.indexOf("| 本文") + 1, false).pos, paddedHome.indexOf("本文"),
  "Markdown padding is not a caret position either");
console.log("Table navigation: both writing modes, hidden syntax, empty cells and boundaries passed.");
