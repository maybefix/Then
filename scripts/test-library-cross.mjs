import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export * from "./src/library/libraryData.ts";
      export { createDocumentAst } from "./src/editor/ast/documentAst.ts";
      export { createProjectAstSkeleton, upsertProjectAstDocumentAsts } from "./src/editor/ast/projectAst.ts";
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
const {
  computeWorkStats,
  createDocumentAst,
  createProjectAstSkeleton,
  folderSignature,
  normalizeLibraryWorkStats,
  searchLibraryScopes,
  upsertProjectAstDocumentAsts,
} = await import(moduleUrl);

const file = (path, contentHash, modifiedAt) => ({
  path,
  name: path.split("\\").pop(),
  kind: "file",
  children: [],
  contentHash,
  modifiedAt,
});
const folder = {
  path: "C:\\Lib\\作品",
  name: "作品",
  children: [
    {
      path: "C:\\Lib\\作品\\01_本文",
      name: "01_本文",
      kind: "folder",
      children: [file("C:\\Lib\\作品\\01_本文\\第一章.txt", "a", 100), file("C:\\Lib\\作品\\01_本文\\第二章.txt", "b", 300)],
    },
    file("C:\\Lib\\作品\\メモ.txt", "c", 200),
  ],
};

const signature = folderSignature(folder);
assert.equal(signature, folderSignature(structuredClone(folder)));
const edited = structuredClone(folder);
edited.children[1].contentHash = "changed";
assert.notEqual(folderSignature(edited), signature, "an edited file changes the signature");

const documents = [
  createDocumentAst({ path: "C:\\Lib\\作品\\01_本文\\第一章.txt", name: "第一章.txt", text: "岬の灯台。" }),
  createDocumentAst({ path: "C:\\Lib\\作品\\01_本文\\第二章.txt", name: "第二章.txt", text: "灯台守の話" }),
  createDocumentAst({ path: "C:\\Lib\\作品\\メモ.txt", name: "メモ.txt", text: "メモ" }),
];
const ast = upsertProjectAstDocumentAsts(createProjectAstSkeleton(folder, null), documents);

const stats = computeWorkStats(
  { folder, ast },
  { "01_本文/第一章.txt": "done", "01_本文/第二章.TXT": "writing" },
  { includeWhitespace: false, includeCode: true },
);
assert.equal(stats.signature, signature);
assert.equal(stats.fileCount, 3);
assert.equal(stats.charCount, 5 + 5 + 2);
assert.deepEqual(stats.progress, { todo: 1, writing: 1, revising: 0, done: 1 }, "progress keys match case-insensitively");
assert.equal(stats.lastModified, 300);

assert.deepEqual(normalizeLibraryWorkStats({ ok: stats, broken: { charCount: "x" } }), { ok: stats });

const outcome = searchLibraryScopes(
  [
    { label: "ライブラリ直下", ast: null },
    { label: "作品", ast },
  ],
  "灯台",
  { useRegex: false, matchCase: false, includeComments: false },
);
assert.equal(outcome.total, 2);
assert.equal(outcome.matchedFileCount, 2);
assert.ok(outcome.results.every((result) => result.name.startsWith("作品 › ")));
assert.equal(
  searchLibraryScopes([{ label: "作品", ast }], "(", { useRegex: true, matchCase: false, includeComments: false })
    .error !== null,
  true,
  "an invalid pattern reports an error",
);

console.log("library cross-feature tests passed");
