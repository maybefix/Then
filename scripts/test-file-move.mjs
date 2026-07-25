import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/utils/projectTree.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const { movePathsToDropPosition } = await import(moduleUrl);

const paths = ["a.md", "b.md", "c.md", "d.md"];
assert.deepEqual(
  movePathsToDropPosition(paths, ["c.md", "b.md"], "d.md", "after"),
  ["a.md", "d.md", "b.md", "c.md"],
  "multiple files must keep their existing display order",
);
assert.deepEqual(
  movePathsToDropPosition(paths, ["b.md", "c.md"], "a.md", "before"),
  ["b.md", "c.md", "a.md", "d.md"],
);
assert.equal(
  movePathsToDropPosition(paths, ["b.md", "c.md"], "d.md", "before"),
  null,
  "an already-adjacent block must be a no-op",
);
assert.equal(
  movePathsToDropPosition(paths, ["b.md", "c.md"], "c.md", "after"),
  null,
  "a selected file cannot be its own drop target",
);

console.log("multiple file move tests passed");
