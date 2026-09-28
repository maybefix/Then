import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { buildComparisonEntries } from "../src/components/checkpoints/checkpointComparison.ts";

const file = (path, text) => ({ path: `C:\\book\\${path}`, name: path.split(/[\\/]/).at(-1), text });
const manuscript = "A village beyond the river holds a particular story about its people and their journey. ".repeat(30);

assert.equal(buildComparisonEntries([file("old.md", manuscript)], [file("new.md", manuscript)])[0].match, "relocated");
assert.equal(buildComparisonEntries([file("old.md", manuscript)], [file("new.md", `${manuscript}Afterword.`)])[0].match, "relocated");
assert.deepEqual(
  buildComparisonEntries([file("a.md", manuscript), file("b.md", manuscript)], [file("c.md", manuscript)]).map((entry) => entry.match),
  ["left-only", "left-only", "right-only"],
  "duplicate contents must not be guessed as a move",
);
assert.deepEqual(
  buildComparisonEntries(
    [file("one/chapter.md", `${manuscript}A`), file("two/chapter.md", `${manuscript}B`)],
    [file("three/chapter.md", `${manuscript}C`)],
  ).map((entry) => entry.match),
  ["left-only", "left-only", "right-only"],
  "near-equal candidates must remain unmatched",
);
assert.deepEqual(
  buildComparisonEntries([file("old.md", manuscript)], [file("new.md", manuscript)], false).map((entry) => entry.match),
  ["left-only", "right-only"],
  "an incomplete current-project load must disable inferred moves",
);

const appSource = await readFile("src/App.tsx", "utf8");
const start = appSource.indexOf("function selectedSnapshotFolderTree(");
const end = appSource.indexOf("async function restoreSnapshotTreeOrder(", start);
assert.ok(start >= 0 && end > start);
const selectionSource = `const normalizePathForCompare = (path: string) => path.replace(/[\\\\/]+/g, "\\\\").toLocaleLowerCase();\n${appSource.slice(start, end)}\nexport { selectedSnapshotFolderTree };`;
const selectionCode = ts.transpileModule(selectionSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { selectedSnapshotFolderTree } = await import(`data:text/javascript;base64,${Buffer.from(selectionCode).toString("base64")}`);
const leaf = file("parent/child/chapter.md", manuscript);
const tree = {
  path: "C:\\book", name: "book", children: [{
    path: "C:\\book\\parent", name: "parent", kind: "folder", children: [{
      path: "C:\\book\\parent\\child", name: "child", kind: "folder", children: [{
        path: leaf.path, name: leaf.name, kind: "file", children: [],
      }],
    }],
  }],
};
const parentOnly = selectedSnapshotFolderTree(tree, new Set(["c:\\book\\parent"]));
assert.deepEqual(parentOnly.children.map((entry) => entry.path), ["C:\\book\\parent"]);
assert.deepEqual(parentOnly.children[0].children, [], "unchecked child folders must not be created");
const childOnly = selectedSnapshotFolderTree(tree, new Set(["c:\\book\\parent\\child"]));
assert.equal(childOnly.children[0].children[0].path, "C:\\book\\parent\\child", "a selected nested folder must retain its parent path");

const manyLeft = Array.from({ length: 100 }, (_, index) => file(`old/${index}.md`, `${manuscript.repeat(4)} Unique left marker ${index}.`));
const manyRight = Array.from({ length: 100 }, (_, index) => file(`new/${index}.md`, `${manuscript.repeat(4)} Unique right marker ${index}.`));
const began = performance.now();
assert.equal(buildComparisonEntries(manyLeft, manyRight).length, 200);
console.log(`checkpoint comparison tests passed; 100 files on each side: ${Math.round(performance.now() - began)} ms`);
