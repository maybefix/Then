import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

// 素材の区分（BINDER 1-3b）を入れる前の、ファイル一覧から先の処理の結果を確かめる（docs/BINDER_MATERIALS_PLAN.md）。
// 見本データ scripts/fixtures/materials-baseline の一覧（expected/listing.json。test:materials-baseline-rust が、
// Rust の list_project_folder の答えと同じことを確かめている）を今の処理へ通し、文字数・進捗の集計、
// 書き出しとチェックポイントの対象、全文検索、見出しの数を expected/derived.json と比べる。
//
//   node scripts/test-materials-baseline.mjs [--update]
//
// --update は期待値を書き直す。見本データを足したときだけ使い、書き直した差分はコミットの前に人が読む。

const update = process.argv.includes("--update");
const fixture = path.join("scripts", "fixtures", "materials-baseline");
const expectedDir = path.join(fixture, "expected");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const bundled = await build({
  stdin: {
    contents: [
      'export { collectProjectTextFiles, createProjectAstSkeleton, upsertProjectAstDocumentAsts, searchProjectAstFullTextWithOptions } from "./src/editor/ast/projectAst.ts";',
      'export { createDocumentAst } from "./src/editor/ast/documentAst.ts";',
      'export { buildSidebarMetrics } from "./src/components/layout/sidebarMetrics.ts";',
      'export { computeWorkStats } from "./src/library/libraryData.ts";',
      'export { parseFrontMatter } from "./src/utils/frontmatter.ts";',
    ].join("\n"),
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
  buildSidebarMetrics,
  collectProjectTextFiles,
  computeWorkStats,
  createDocumentAst,
  createProjectAstSkeleton,
  parseFrontMatter,
  searchProjectAstFullTextWithOptions,
  upsertProjectAstDocumentAsts,
} = await import(moduleUrl);

const listing = readJson(path.join(expectedDir, "listing.json"));
// 画面が受け取るのと同じ Windows のパスにする（区切りは path.win32.sep）。
const SEP = path.win32.sep;
const VIRTUAL_ROOT = ["C:", "materials-baseline"].join(SEP);
const workRoot = (work) => [VIRTUAL_ROOT, work].join(SEP);
const toAbsolute = (work, relative) => [workRoot(work), ...relative.split("/")].join(SEP);
const toRelative = (work, absolute) => absolute.slice(workRoot(work).length + 1).split(SEP).join("/");

// 一覧（Rust の答え）を、画面が受け取る ProjectFolder の形へ戻す。ハッシュは中身から作らず、あるかどうかだけを写す。
function toEntry(work, entry) {
  const base = { path: toAbsolute(work, entry.path), name: entry.name, kind: entry.kind };
  if (entry.kind === "folder") return { ...base, children: entry.children.map((child) => toEntry(work, child)) };
  return {
    ...base,
    children: [],
    fileId: entry.hasFileId ? `id:${entry.path}` : null,
    contentHash: entry.hasContentHash ? `hash:${entry.path}` : null,
    ...(entry.hasModifiedAt ? { modifiedAt: 0 } : {}),
  };
}

const countOptions = { includeWhitespace: false, includeCode: true };
const searchOptions = { useRegex: false, matchCase: false };
const derived = {};
for (const [work, value] of Object.entries(listing.works)) {
  const folder = {
    path: workRoot(work),
    name: value.name,
    children: value.children.map((entry) => toEntry(work, entry)),
  };
  const files = collectProjectTextFiles(folder);
  const documents = files.map((file) => {
    const text = readFileSync(path.join(fixture, "library", work, ...toRelative(work, file.path).split("/")), "utf8");
    return createDocumentAst({ path: file.path, name: file.name, text: parseFrontMatter(text).body });
  });
  const ast = upsertProjectAstDocumentAsts(createProjectAstSkeleton(folder, null), documents);
  const metrics = buildSidebarMetrics(folder, ast, countOptions.includeWhitespace, countOptions.includeCode);
  const configPath = path.join(fixture, "library", work, ".then", "project.json");
  const fileProgress = existsSync(configPath)
    ? Object.fromEntries(Object.entries(readJson(configPath).fileProgress ?? {}).map(([key, item]) => [key, item.status]))
    : {};
  const stats = computeWorkStats({ folder, ast }, fileProgress, countOptions);
  const search = searchProjectAstFullTextWithOptions(ast, "汐見", searchOptions);
  const searchWithComments = searchProjectAstFullTextWithOptions(ast, "汐見", { ...searchOptions, includeComments: true });
  const relativeFiles = files.map((file) => toRelative(work, file.path));

  derived[work] = {
    // collectProjectTextFiles の答え。書き出し（handleOpenLinkedExport）、チェックポイント（buildManuscriptSnapshot）、
    // プロジェクト全体の置換、プラグインの文書の探し方は、どれもこの並びをそのまま使う。
    textFiles: relativeFiles,
    ast: {
      fileCount: ast.files.length,
      indexedCount: ast.indexedCount,
      totalTextLength: ast.totalTextLength,
      totalOutlineCount: ast.totalOutlineCount,
      outlineByFile: Object.fromEntries(ast.files.map((file) => [toRelative(work, file.path), file.outlineCount])),
    },
    sidebar: {
      projectTotalCharCount: metrics.projectTotalCharCount,
      folderCharCounts: Object.fromEntries(
        [...metrics.folderCharCounts].map(([key, count]) => [key === folder.path ? "." : toRelative(work, key), count]),
      ),
    },
    library: {
      charCount: stats.charCount,
      fileCount: stats.fileCount,
      progress: stats.progress,
    },
    search: {
      total: search.total,
      matchedFileCount: search.matchedFileCount,
      hits: search.results.map((hit) => `${toRelative(work, hit.path)}:${hit.line}:${hit.column}`),
      totalWithComments: searchWithComments.total,
    },
  };
}

const expectedPath = path.join(expectedDir, "derived.json");
if (update) {
  writeFileSync(expectedPath, `${JSON.stringify(derived, null, 2)}\n`.split("\n").join("\r\n"));
  console.log(`wrote ${expectedPath}`);
} else {
  const expected = readJson(expectedPath);
  for (const work of Object.keys(expected)) {
    assert.deepEqual(derived[work], expected[work], `${work} の結果が期待値と違う`);
  }
  assert.deepEqual(derived, expected);
  console.log(`materials baseline ok (${Object.keys(derived).length} works)`);
}
