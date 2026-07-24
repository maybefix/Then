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
const {
  extractHeadingSection,
  moveHeadingSection,
  moveHeadingSections,
} = await import(moduleUrl);

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

const movedMany = moveHeadingSections({
  documents: [
    {
      path: "many.md",
      markdown: "# A\nbody A\n# B\nbody B\n# C\nbody C\n",
    },
  ],
  sources: [
    { path: "many.md", line: 1 },
    { path: "many.md", line: 5 },
  ],
  targetPath: "many.md",
  targetLine: 3,
  position: "after",
});
assert.equal(movedMany.changed, true);
assert.deepEqual(movedMany.movedTitles, ["A", "C"]);
assert.equal(
  movedMany.documents[0].markdown,
  "# B\nbody B\n# A\nbody A\n# C\nbody C\n",
);

const movedAcrossFiles = moveHeadingSections({
  documents: [
    { path: "one.md", markdown: "# A\nbody A\n# B\nbody B\n" },
    { path: "two.md", markdown: "# X\nbody X\n" },
  ],
  sources: [
    { path: "one.md", line: 1 },
    { path: "one.md", line: 3 },
  ],
  targetPath: "two.md",
  targetLine: null,
  position: "append",
});
assert.equal(movedAcrossFiles.documents[0].markdown, "");
assert.equal(
  movedAcrossFiles.documents[1].markdown,
  "# X\nbody X\n# A\nbody A\n# B\nbody B\n",
);

const nestedSelection = moveHeadingSections({
  documents: [
    { path: "nested.md", markdown: "# Parent\nlead\n## Child\nchild\n" },
    { path: "target.md", markdown: "" },
  ],
  sources: [
    { path: "nested.md", line: 1 },
    { path: "nested.md", line: 3 },
  ],
  targetPath: "target.md",
  targetLine: null,
  position: "append",
});
assert.deepEqual(nestedSelection.movedTitles, ["Parent"]);
assert.equal(nestedSelection.documents[0].markdown, "");
assert.equal(
  nestedSelection.documents[1].markdown,
  "# Parent\nlead\n## Child\nchild\n",
);

const extractedOnly = extractHeadingSection({
  sourceMarkdown: "# Parent\nlead\n## Child\nchild\n# Stay\nstay\n",
  sourceLine: 1,
  includeChildren: false,
});
assert.equal(extractedOnly.extractedMarkdown, "# Parent\nlead\n");
assert.equal(extractedOnly.sourceMarkdown, "## Child\nchild\n# Stay\nstay\n");

const extractedWithChildren = extractHeadingSection({
  sourceMarkdown: "# Parent\nlead\n## Child\nchild\n# Stay\nstay\n",
  sourceLine: 1,
  includeChildren: true,
});
assert.equal(
  extractedWithChildren.extractedMarkdown,
  "# Parent\nlead\n## Child\nchild\n",
);
assert.equal(extractedWithChildren.sourceMarkdown, "# Stay\nstay\n");

console.log("heading move tests passed");
