import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const asModuleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const frontmatterSource = await readFile("src/utils/frontmatter.ts", "utf8");
const frontmatterUrl = asModuleUrl(transpile(frontmatterSource));
const headingMoveSource = (
  await readFile("src/editor/ast/headingMove.ts", "utf8")
).replace('"../../utils/frontmatter"', `"${frontmatterUrl}"`);
const moduleUrl = asModuleUrl(transpile(headingMoveSource));
const { moveHeadingSection } = await import(moduleUrl);

const sameFile = `---
title: test
---
# A
intro
## A child
child body
# B
body B
# C
body C
`;
const reordered = moveHeadingSection({
  sourceMarkdown: sameFile,
  targetMarkdown: sameFile,
  sourceLine: 1,
  targetLine: 5,
  position: "after",
  sameDocument: true,
});
assert.equal(reordered.changed, true);
assert.equal(
  reordered.sourceMarkdown,
  `---
title: test
---
# B
body B
# A
intro
## A child
child body
# C
body C
`,
);

const adjacentNoop = moveHeadingSection({
  sourceMarkdown: sameFile,
  targetMarkdown: sameFile,
  sourceLine: 5,
  targetLine: 7,
  position: "before",
  sameDocument: true,
});
assert.equal(adjacentNoop.changed, false);

const descendantNoop = moveHeadingSection({
  sourceMarkdown: sameFile,
  targetMarkdown: sameFile,
  sourceLine: 1,
  targetLine: 3,
  position: "after",
  sameDocument: true,
});
assert.equal(descendantNoop.changed, false);

const sourceFile = `---
owner: source
---
# Root
lead
## Move
move body
### Nested
nested body
## Stay
stay body
`;
const targetFile = `---
owner: target
---
# Target
target body
`;
const crossFile = moveHeadingSection({
  sourceMarkdown: sourceFile,
  targetMarkdown: targetFile,
  sourceLine: 3,
  targetLine: 1,
  position: "after",
  sameDocument: false,
});
assert.equal(
  crossFile.sourceMarkdown,
  `---
owner: source
---
# Root
lead
## Stay
stay body
`,
);
assert.equal(
  crossFile.targetMarkdown,
  `---
owner: target
---
# Target
target body
## Move
move body
### Nested
nested body
`,
);

const appended = moveHeadingSection({
  sourceMarkdown: "# Move\nbody\n",
  targetMarkdown: "",
  sourceLine: 1,
  targetLine: null,
  position: "append",
  sameDocument: false,
});
assert.equal(appended.sourceMarkdown, "");
assert.equal(appended.targetMarkdown, "# Move\nbody\n");

console.log("heading move tests passed");
