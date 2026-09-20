import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/search/textSearch.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const search = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

const literalOptions = { useRegex: false, matchCase: false };
const regexOptions = { useRegex: true, matchCase: false };

const spaces = search.findTextSearchMatches("　本文\n本文", "　", literalOptions);
assert.equal(spaces.total, 1, "full-width spaces must remain searchable");
assert.equal(spaces.matches[0].index, 0);

assert.equal(
  search.findTextSearchMatches("Alpha alpha", "alpha", literalOptions).total,
  2,
  "literal search is case-insensitive by default",
);
assert.equal(
  search.findTextSearchMatches("Alpha alpha", "alpha", {
    ...literalOptions,
    matchCase: true,
  }).total,
  1,
  "Aa enables case-sensitive matching",
);

const indents = search.findTextSearchMatches("　段落1\n段落2\n　段落3", "^　", regexOptions);
assert.deepEqual(
  indents.matches.map((match) => match.index),
  [0, 9],
  "regular expressions use multiline anchors over the complete document body",
);

const invalid = search.findTextSearchMatches("本文", "[", regexOptions);
assert.equal(invalid.total, 0);
assert.ok(invalid.error, "invalid regular expressions return an inline-safe error");

const zeroWidth = search.findTextSearchMatches("ab", "(?=.)", regexOptions);
assert.equal(zeroWidth.total, 2, "zero-width expressions terminate and report every match");

const captureReplace = search.replaceTextSearchMatches(
  "姓:山田",
  "姓:(.+)",
  "氏名:$1",
  regexOptions,
);
assert.equal(captureReplace.text, "氏名:山田");
assert.equal(captureReplace.count, 1);

const literalReplacement = search.replaceTextSearchMatches(
  "本文",
  "本文",
  "$&-$1",
  literalOptions,
);
assert.equal(literalReplacement.text, "$&-$1", "literal replacement keeps dollar tokens literal");

const appSource = await readFile("src/App.tsx", "utf8");
const sidebarSource = await readFile("src/components/layout/WorkspaceSidebar.tsx", "utf8");
assert.match(appSource, /useState<WorkspaceSearchScope>\("file"\)/);
assert.match(sidebarSource, />\s*現在の本文\s*</);
assert.match(sidebarSource, /正規表現を使用/);
assert.match(sidebarSource, /projectSearchResultGroup/);

console.log("PASS search sidebar: exact whitespace, regex, case, captures, zero-width matches");
