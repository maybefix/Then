import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const tauriConfig = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const cargoManifest = await readFile("src-tauri/Cargo.toml", "utf8");
assert.equal(packageJson.version, "0.5.8", "the experimental branch must identify itself as v0.5.8");
assert.equal(tauriConfig.version, packageJson.version, "frontend and Tauri versions must match");
assert.match(cargoManifest, /^version = "0\.5\.8"$/m, "Rust package version must match v0.5.8");

async function importStandaloneTypeScript(path) {
  const source = await readFile(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(moduleUrl);
}

const documentAstModule = await importStandaloneTypeScript("src/editor/ast/documentAst.ts");
const projectMetricsModule = await importStandaloneTypeScript(
  "src/editor/ast/projectAstMetrics.ts",
);
const sidebarMetricsModule = await importStandaloneTypeScript(
  "src/components/layout/sidebarMetrics.ts",
);
const snapshotConflictsModule = await importStandaloneTypeScript(
  "src/editor/ast/snapshotConflicts.ts",
);
const frameSchedulerModule = await importStandaloneTypeScript(
  "src/utils/latestFrameScheduler.ts",
);

const { createDocumentAst, updateDocumentAst } = documentAstModule;
const {
  createIndexedProjectAstFile,
  replaceProjectAstFile,
  replaceProjectAstFiles,
} = projectMetricsModule;
const {
  buildSidebarMetrics,
  getSidebarFolderCharCount,
  getSidebarHeadingCharCount,
} = sidebarMetricsModule;
const { collectSnapshotConflictPaths } = snapshotConflictsModule;
const { createLatestFrameScheduler } = frameSchedulerModule;

let nextFrameId = 1;
const pendingFrames = new Map();
const cancelledFrames = [];
const appliedFrameValues = [];
const scheduler = createLatestFrameScheduler(
  (callback) => {
    const id = nextFrameId++;
    pendingFrames.set(id, callback);
    return id;
  },
  (id) => {
    cancelledFrames.push(id);
    pendingFrames.delete(id);
  },
  (value) => appliedFrameValues.push(value),
);
scheduler.schedule(1);
scheduler.schedule(2);
scheduler.schedule(3);
assert.equal(pendingFrames.size, 1, "pointer movement must request at most one frame at a time");
const [[firstFrameId, firstFrame]] = pendingFrames;
pendingFrames.delete(firstFrameId);
firstFrame();
assert.deepEqual(appliedFrameValues, [3], "the scheduled frame must apply only the latest position");
scheduler.schedule(4);
scheduler.flush();
assert.deepEqual(appliedFrameValues, [3, 4], "pointer-up flush must apply the final pending position");
assert.equal(pendingFrames.size, 0);
assert.equal(cancelledFrames.length, 1, "flushing must cancel the no-longer-needed animation frame");

function pendingFile(path, name) {
  return {
    path,
    name,
    status: "pending",
    documentAst: null,
    textHash: null,
    semanticHash: null,
    lineCount: 0,
    textLength: 0,
    visibleTextLength: 0,
    outlineCount: 0,
    indexedAt: null,
    error: null,
  };
}

function projectAst(files) {
  return {
    kind: "project",
    rootPath: "C:\\fixture",
    name: "fixture",
    status: files.length ? "indexing" : "empty",
    files,
    indexedCount: 0,
    pendingCount: files.length,
    errorCount: 0,
    totalTextLength: 0,
    totalLineCount: 0,
    totalOutlineCount: 0,
    updatedAt: 1,
  };
}

const aPath = "C:\\fixture\\a.md";
const bPath = "C:\\fixture\\sub\\b.md";
const cPath = "C:\\fixture\\c.md";
const aAst = createDocumentAst({
  path: aPath,
  name: "a.md",
  text: "# 親\n本文😀\n## 子\n次　行\n# 次\n終",
  indexedAt: 10,
});
const bAst = createDocumentAst({
  path: bPath,
  name: "b.md",
  text: "# B\nx",
  indexedAt: 11,
});
const cAst = createDocumentAst({
  path: cPath,
  name: "c.md",
  text: "plain",
  indexedAt: 12,
});

const baseProject = projectAst([
  pendingFile(aPath, "a.md"),
  pendingFile(bPath, "b.md"),
  pendingFile(cPath, "c.md"),
]);
const indexedA = createIndexedProjectAstFile(aAst);
const afterA = replaceProjectAstFile(baseProject, indexedA);
assert.equal(
  afterA.files[0].documentAst,
  aAst,
  "an already-built active document AST must be reused by identity",
);
assert.equal(afterA.indexedCount, 1);
assert.equal(afterA.pendingCount, 2);
assert.equal(afterA.totalTextLength, aAst.textLength);
assert.equal(afterA.status, "indexing");

const afterBatch = replaceProjectAstFiles(afterA, [
  createIndexedProjectAstFile(bAst),
  createIndexedProjectAstFile(cAst),
]);
assert.equal(afterBatch.indexedCount, 3);
assert.equal(afterBatch.pendingCount, 0);
assert.equal(afterBatch.status, "ready");
assert.equal(
  afterBatch.totalTextLength,
  aAst.textLength + bAst.textLength + cAst.textLength,
);

const shorterA = createDocumentAst({
  path: aPath,
  name: "a.md",
  text: "# 親\n短い",
  indexedAt: 13,
});
const afterReplace = replaceProjectAstFile(
  afterBatch,
  createIndexedProjectAstFile(shorterA),
);
assert.equal(
  afterReplace.totalTextLength,
  shorterA.textLength + bAst.textLength + cAst.textLength,
  "aggregate totals must subtract the previous file before adding its replacement",
);

const incrementalSource = Array.from(
  { length: 2_000 },
  (_, index) =>
    index % 25 === 0
      ? `# 見出し ${index}`
      : `本文 [対象${index}(rb,たいしょう)] **強調${index}**`,
).join("\n");
const incrementalPrevious = createDocumentAst({
  path: aPath,
  name: "a.md",
  text: incrementalSource,
  indexedAt: 20,
});
const changedLines = incrementalSource.split("\n");
changedLines[1_000] = changedLines[1_000].replace("本文", "変更");
const changedSource = changedLines.join("\n");
const incrementalNext = updateDocumentAst(incrementalPrevious, {
  path: aPath,
  name: "a.md",
  text: changedSource,
  indexedAt: 21,
});
const rebuiltNext = createDocumentAst({
  path: aPath,
  name: "a.md",
  text: changedSource,
  indexedAt: 21,
});
assert.deepEqual(
  incrementalNext,
  rebuiltNext,
  "incremental document updates must be byte-for-byte equivalent to a full AST rebuild",
);
assert.equal(
  incrementalNext.blocks[999],
  incrementalPrevious.blocks[999],
  "unchanged prefix blocks should retain identity",
);
assert.equal(
  incrementalNext.blocks[1_001],
  incrementalPrevious.blocks[1_001],
  "same-length edits should preserve unchanged suffix block identity",
);

const incrementalCases = [
  {
    name: "different-length typing before inline markup",
    transform(lines) {
      lines[999] += "追記";
    },
  },
  {
    name: "line insertion",
    transform(lines) {
      lines.splice(999, 0, "挿入された行");
    },
  },
  {
    name: "line deletion",
    transform(lines) {
      lines.splice(999, 1);
    },
  },
  {
    name: "heading hierarchy change",
    transform(lines) {
      lines[1_000] = "## 新しい子見出し";
    },
  },
];
for (const testCase of incrementalCases) {
  const lines = incrementalSource.split("\n");
  testCase.transform(lines);
  const text = lines.join("\n");
  const incremental = updateDocumentAst(incrementalPrevious, {
    path: aPath,
    name: "a.md",
    text,
    indexedAt: 22,
  });
  const rebuilt = createDocumentAst({
    path: aPath,
    name: "a.md",
    text,
    indexedAt: 22,
  });
  assert.deepEqual(
    incremental,
    rebuilt,
    `incremental AST must match a full rebuild after ${testCase.name}`,
  );
}

const crlfSource = incrementalSource.replaceAll("\n", "\r\n");
assert.deepEqual(
  updateDocumentAst(incrementalPrevious, {
    path: aPath,
    name: "a.md",
    text: crlfSource,
    indexedAt: 23,
  }),
  createDocumentAst({
    path: aPath,
    name: "a.md",
    text: crlfSource,
    indexedAt: 23,
  }),
  "incremental AST must preserve CRLF normalization semantics",
);

for (let pass = 0; pass < 3; pass += 1) {
  updateDocumentAst(incrementalPrevious, {
    path: aPath,
    name: "a.md",
    text: `${changedSource}追`,
  });
  createDocumentAst({ path: aPath, name: "a.md", text: `${changedSource}追` });
}
const incrementalStarted = performance.now();
for (let pass = 0; pass < 10; pass += 1) {
  updateDocumentAst(incrementalPrevious, {
    path: aPath,
    name: "a.md",
    text: `${changedSource}追`,
  });
}
const incrementalElapsed = performance.now() - incrementalStarted;
const rebuildStarted = performance.now();
for (let pass = 0; pass < 10; pass += 1) {
  createDocumentAst({ path: aPath, name: "a.md", text: `${changedSource}追` });
}
const rebuildElapsed = performance.now() - rebuildStarted;
assert.ok(
  incrementalElapsed < rebuildElapsed * 0.7,
  `incremental AST update should materially outperform a rebuild (${incrementalElapsed.toFixed(1)}ms vs ${rebuildElapsed.toFixed(1)}ms)`,
);

let blockReads = 0;
let outlineReads = 0;
const observedA = {
  ...aAst,
  get blocks() {
    blockReads += 1;
    return aAst.blocks;
  },
  get outline() {
    outlineReads += 1;
    return aAst.outline;
  },
};
const sidebarProject = replaceProjectAstFiles(baseProject, [
  createIndexedProjectAstFile(observedA),
  createIndexedProjectAstFile(bAst),
]);
const projectFolder = {
  path: "C:\\fixture",
  name: "fixture",
  children: [
    { path: aPath, name: "a.md", kind: "file", children: [] },
    {
      path: "C:\\fixture\\sub",
      name: "sub",
      kind: "folder",
      children: [{ path: bPath, name: "b.md", kind: "file", children: [] }],
    },
    { path: cPath, name: "c.md", kind: "file", children: [] },
  ],
};

const metricsWithWhitespace = buildSidebarMetrics(projectFolder, sidebarProject, true);
assert.equal(getSidebarFolderCharCount(metricsWithWhitespace, projectFolder.path), aAst.textLength + bAst.textLength);
assert.equal(getSidebarFolderCharCount(metricsWithWhitespace, "C:\\fixture\\sub"), bAst.textLength);
const flatAOutline = [aAst.outline[0], aAst.outline[0].children[0], aAst.outline[1]];
assert.deepEqual(
  flatAOutline.map((item) => getSidebarHeadingCharCount(metricsWithWhitespace, aPath, item)),
  [8, 9, 5],
  "cached heading counts must preserve the existing next-heading section semantics",
);

const readsAfterBuild = { blockReads, outlineReads };
buildSidebarMetrics(projectFolder, sidebarProject, true);
assert.deepEqual(
  { blockReads, outlineReads },
  readsAfterBuild,
  "unchanged document ASTs must reuse cached heading metrics across sidebar rebuilds",
);
for (let pass = 0; pass < 100; pass += 1) {
  for (const item of flatAOutline) {
    getSidebarHeadingCharCount(metricsWithWhitespace, aPath, item);
  }
  getSidebarFolderCharCount(metricsWithWhitespace, projectFolder.path);
}
assert.deepEqual(
  { blockReads, outlineReads },
  readsAfterBuild,
  "render-time metric lookup must not traverse document blocks or outlines again",
);
assert.ok(blockReads <= 2 && outlineReads <= 2, "metrics should inspect each document structure once per build");

const metricsWithoutWhitespace = buildSidebarMetrics(projectFolder, sidebarProject, false);
assert.deepEqual(
  flatAOutline.map((item) => getSidebarHeadingCharCount(metricsWithoutWhitespace, aPath, item)),
  [5, 5, 3],
);

const editedA = createDocumentAst({
  path: aPath,
  name: "a.md",
  text: "# 親\n本文😀追記\n## 改題\n次　行\n# 次\n終",
  indexedAt: 14,
});
const metricsAfterBodyAndHeadingEdit = buildSidebarMetrics(
  projectFolder,
  replaceProjectAstFile(sidebarProject, createIndexedProjectAstFile(editedA)),
  true,
);
assert.equal(
  getSidebarHeadingCharCount(
    metricsAfterBodyAndHeadingEdit,
    aPath,
    editedA.outline[0],
  ),
  10,
  "body edits must invalidate the active file's cached heading count",
);
assert.equal(
  editedA.outline[0].children[0].title,
  "改題",
  "heading edits must be visible in the updated sidebar outline",
);
assert.equal(
  getSidebarFolderCharCount(metricsAfterBodyAndHeadingEdit, projectFolder.path),
  editedA.textLength + bAst.textLength,
  "body edits must update ancestor folder totals",
);

const conflicts = collectSnapshotConflictPaths(
  [
    { id: "same", files: [{ path: aPath, textHash: aAst.textHash }] },
    { id: "changed", files: [{ path: aPath.toLowerCase(), textHash: "different" }] },
    { id: "missing", files: [{ path: cPath, textHash: cAst.textHash }] },
  ],
  new Map([[aPath.toLowerCase(), aAst.textHash]]),
  (path) => path.toLowerCase(),
);
assert.deepEqual([...conflicts.get("same")], []);
assert.deepEqual([...conflicts.get("changed")], [aPath.toLowerCase()]);
assert.deepEqual([...conflicts.get("missing")], []);

const appSource = await readFile("src/App.tsx", "utf8");
assert.match(
  appSource.slice(appSource.indexOf("function debugLog"), appSource.indexOf("const documentData")),
  /if \(!import\.meta\.env\.DEV\) return;/,
  "folder diagnostics must not run in production frontend builds",
);
assert.match(
  appSource,
  /upsertProjectAstDocumentAst\(current, activeDocumentAst\)/,
  "active editor updates must pass the existing AST to the project index",
);
assert.match(
  appSource,
  /updateDocumentAst\(activeDocumentAstCacheRef\.current/,
  "the active editor AST must update incrementally from its previous version",
);
assert.match(
  appSource,
  /PROJECT_AST_INDEX_BATCH_SIZE/,
  "initial project indexing must batch React state updates",
);
assert.match(
  appSource,
  /upsertProjectAstDocumentAsts\(current, completedBatch\)/,
  "each project indexing batch must be committed in one state update",
);
assert.doesNotMatch(
  appSource.slice(appSource.indexOf("const snapshotConflictPaths"), appSource.indexOf("const frontMatter")),
  /createDocumentAst/,
  "checkpoint conflict detection must not rebuild an AST for every snapshot/file pair",
);
const textChangeHandlerSource = appSource.slice(
  appSource.indexOf("const handleTextChange"),
  appSource.indexOf("const updateFrontMatter"),
);
assert.doesNotMatch(
  textChangeHandlerSource.slice(0, textChangeHandlerSource.indexOf("useEffect")),
  /countDisplayCharacters|updateSelectionCharCount/,
  "the editor callback must not duplicate character and selection counts performed by its effects/events",
);
assert.match(
  textChangeHandlerSource,
  /setCharCount\(countDisplayCharacters\(editorText, settings\.countWhitespace\)\)/,
  "character counts must still update after every editor text change",
);

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");
assert.match(
  editorSource,
  /updateEmptyAttribute\(currentEditor, next\)/,
  "the editor update path must reuse its already-materialized text for empty-state updates",
);

const canvasSource = await readFile("src/CanvasWindowApp.tsx", "utf8");
assert.match(
  canvasSource,
  /createLatestFrameScheduler/,
  "canvas pointer movement must be coalesced to the display frame rate",
);

const headingDiagnosticsSource = await readFile("src/utils/headingDndDiagnostics.ts", "utf8");
assert.match(
  headingDiagnosticsSource,
  /if \(!import\.meta\.env\.DEV\) return;/,
  "high-frequency heading drag diagnostics must be disabled in production builds",
);
const rustSource = await readFile("src-tauri/src/lib.rs", "utf8");
assert.match(
  rustSource.slice(rustSource.indexOf("fn debug_log"), rustSource.indexOf("const LINKED_CHILD")),
  /cfg!\(debug_assertions\)/,
  "recursive folder diagnostics must not write to stderr in release builds",
);

const start = performance.now();
for (let pass = 0; pass < 10_000; pass += 1) {
  getSidebarHeadingCharCount(metricsWithWhitespace, aPath, flatAOutline[pass % flatAOutline.length]);
}
assert.ok(
  performance.now() - start < 250,
  "cached sidebar metric lookup should remain constant-time",
);

console.log(
  JSON.stringify({
    astBenchmark: {
      lines: 2_000,
      passes: 10,
      incrementalMs: Number(incrementalElapsed.toFixed(2)),
      rebuildMs: Number(rebuildElapsed.toFixed(2)),
      ratio: Number((incrementalElapsed / rebuildElapsed).toFixed(3)),
    },
  }),
);
console.log("performance regression tests passed");
