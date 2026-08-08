import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import ts from "typescript";

async function importStandaloneTypeScript(path) {
  const source = await readFile(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
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

let randomState = 0x5a17c9e3;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x1_0000_0000;
}

function randomInt(max) {
  return Math.floor(random() * max);
}

const lineFixtures = [
  "",
  "通常の本文です。",
  "絵文字😀と結合文字e\u0301と異体字󠄀",
  "# 第一見出し",
  "## 子見出し **強調**",
  "### 孫見出し [漢字(rb,かんじ)]",
  "- 箇条書き",
  "  1. 順序付き",
  ">> 地付き",
  "［＃地付き］青空文庫",
  "[(al:center)]中央",
  "｜親文字《おやもじ》と《《圏点》》",
  "半角 space\t全角　空白",
  "[縦中横(tcy)] [傍点(em,goma)]",
];

function makeLine(serial) {
  return `${lineFixtures[randomInt(lineFixtures.length)]}${serial % 7 === 0 ? ` ${serial}` : ""}`;
}

const fuzzPathA = "C:\\fixture\\fuzz-a.md";
const fuzzPathB = "C:\\fixture\\fuzz-b.md";
let fuzzLines = Array.from({ length: 500 }, (_, index) => makeLine(index));
let incrementalAst = createDocumentAst({
  path: fuzzPathA,
  name: "fuzz-a.md",
  text: fuzzLines.join("\n"),
  indexedAt: 0,
});

const fuzzOperationCounts = {
  replace: 0,
  append: 0,
  insert: 0,
  delete: 0,
  newlineStyle: 0,
  pathChange: 0,
};

for (let iteration = 1; iteration <= 500; iteration += 1) {
  const operation = randomInt(6);
  if (operation === 0) {
    fuzzLines[randomInt(fuzzLines.length)] = makeLine(iteration + 10_000);
    fuzzOperationCounts.replace += 1;
  } else if (operation === 1) {
    const index = randomInt(fuzzLines.length);
    fuzzLines[index] += lineFixtures[randomInt(lineFixtures.length)].slice(0, 4);
    fuzzOperationCounts.append += 1;
  } else if (operation === 2) {
    fuzzLines.splice(randomInt(fuzzLines.length + 1), 0, makeLine(iteration + 20_000));
    fuzzOperationCounts.insert += 1;
  } else if (operation === 3 && fuzzLines.length > 1) {
    fuzzLines.splice(randomInt(fuzzLines.length), 1);
    fuzzOperationCounts.delete += 1;
  } else if (operation === 4) {
    fuzzOperationCounts.newlineStyle += 1;
  } else {
    fuzzOperationCounts.pathChange += 1;
  }

  const useCrLf = operation === 4 || random() < 0.2;
  const path = operation === 5 && iteration % 2 === 0 ? fuzzPathB : fuzzPathA;
  const name = path === fuzzPathB ? "fuzz-b.md" : "fuzz-a.md";
  const text = fuzzLines.join(useCrLf ? "\r\n" : "\n");
  const input = { path, name, text, indexedAt: iteration };
  incrementalAst = updateDocumentAst(incrementalAst, input);
  assert.deepEqual(
    incrementalAst,
    createDocumentAst(input),
    `incremental AST diverged at deterministic fuzz iteration ${iteration}`,
  );
}

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

function projectFromFiles(files) {
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
    updatedAt: 0,
  };
}

function expectedStatus(files) {
  if (files.length === 0) return "empty";
  if (files.some((file) => file.status === "pending")) return "indexing";
  if (files.some((file) => file.status === "error")) return "partial";
  return "ready";
}

function assertProjectAggregates(project, label) {
  const expected = {
    status: expectedStatus(project.files),
    indexedCount: project.files.filter((file) => file.status === "indexed").length,
    pendingCount: project.files.filter((file) => file.status === "pending").length,
    errorCount: project.files.filter((file) => file.status === "error").length,
    totalTextLength: project.files.reduce((sum, file) => sum + file.textLength, 0),
    totalLineCount: project.files.reduce((sum, file) => sum + file.lineCount, 0),
    totalOutlineCount: project.files.reduce((sum, file) => sum + file.outlineCount, 0),
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(project[key], value, `${label}: ${key}`);
  }
}

const aggregatePaths = Array.from(
  { length: 120 },
  (_, index) => `C:\\fixture\\aggregate-${index}.md`,
);
let aggregateProject = projectFromFiles(
  aggregatePaths.map((path, index) => pendingFile(path, `aggregate-${index}.md`)),
);
for (let start = 0; start < aggregatePaths.length; start += 17) {
  const batch = aggregatePaths.slice(start, start + 17).map((path, offset) =>
    createIndexedProjectAstFile(
      createDocumentAst({
        path,
        name: path.split("\\").pop(),
        text: `# ${start + offset}\n本文😀 ${"x".repeat(offset)}`,
        indexedAt: start + offset,
      }),
    ),
  );
  aggregateProject = replaceProjectAstFiles(aggregateProject, batch);
  assertProjectAggregates(aggregateProject, `batch ${start}`);
}

const aggregateError = {
  ...aggregateProject.files[11],
  status: "error",
  error: "fixture error",
};
aggregateProject = replaceProjectAstFile(aggregateProject, aggregateError);
assertProjectAggregates(aggregateProject, "error transition");
aggregateProject = replaceProjectAstFiles(aggregateProject, [
  createIndexedProjectAstFile(
    createDocumentAst({
      path: "C:\\fixture\\new-file.md",
      name: "new-file.md",
      text: "# new\nnew body",
      indexedAt: 999,
    }),
  ),
  createIndexedProjectAstFile(
    createDocumentAst({
      path: aggregatePaths[0],
      name: "aggregate-0.md",
      text: "# replacement\nreplaced",
      indexedAt: 1_000,
    }),
  ),
]);
assertProjectAggregates(aggregateProject, "replace and append");

function flattenOutline(items) {
  return items.flatMap((item) => [item, ...flattenOutline(item.children)]);
}

function countCharacters(value, includeWhitespace) {
  return Array.from(includeWhitespace ? value : value.replace(/[\s　]/g, "")).length;
}

function naiveHeadingCount(documentAst, item, includeWhitespace) {
  const headings = flattenOutline(documentAst.outline).sort((left, right) => left.line - right.line);
  const currentIndex = headings.findIndex(
    (heading) => heading.blockId === item.blockId || heading.id === item.id,
  );
  const startIndex = Math.max(0, item.line - 1);
  const nextHeading = headings[currentIndex + 1];
  const endIndex = nextHeading
    ? Math.max(startIndex, nextHeading.line - 1)
    : documentAst.blocks.length;
  const source = documentAst.blocks
    .slice(startIndex, endIndex)
    .map((block) => block.source)
    .join("\n");
  return countCharacters(
    endIndex < documentAst.blocks.length ? `${source}\n` : source,
    includeWhitespace,
  );
}

const sidebarRoot = "C:\\sidebar";
const sidebarFolders = ["一", "二", "三"].map((name) => `${sidebarRoot}\\${name}`);
const sidebarDocuments = [];
const sidebarChildren = sidebarFolders.map((folderPath, folderIndex) => ({
  path: folderPath,
  name: folderPath.split("\\").pop(),
  kind: "folder",
  children: Array.from({ length: 8 }, (_, fileIndex) => {
    const path = `${folderPath}\\doc-${fileIndex}.md`;
    const text = [
      `# 親 ${folderIndex}-${fileIndex}`,
      `本文😀 ${"字".repeat(fileIndex)}`,
      `## 子 ${fileIndex}`,
      "子本文　空白",
      "### 孫",
      "[漢字(rb,かんじ)] **強調**",
      "# 次",
      "終端",
    ].join("\n");
    const documentAst = createDocumentAst({ path, name: `doc-${fileIndex}.md`, text });
    sidebarDocuments.push(documentAst);
    return { path, name: `doc-${fileIndex}.md`, kind: "file", children: [] };
  }),
}));
const sidebarFolder = { path: sidebarRoot, name: "sidebar", children: sidebarChildren };
let sidebarProject = projectFromFiles(
  sidebarDocuments.map((documentAst) => pendingFile(documentAst.path, documentAst.name)),
);
sidebarProject = replaceProjectAstFiles(
  sidebarProject,
  sidebarDocuments.map(createIndexedProjectAstFile),
);

for (const includeWhitespace of [true, false]) {
  const metrics = buildSidebarMetrics(sidebarFolder, sidebarProject, includeWhitespace);
  for (const documentAst of sidebarDocuments) {
    for (const item of flattenOutline(documentAst.outline)) {
      assert.equal(
        getSidebarHeadingCharCount(metrics, documentAst.path, item),
        naiveHeadingCount(documentAst, item, includeWhitespace),
        `sidebar heading count mismatch for ${documentAst.path}:${item.line}`,
      );
    }
  }
  for (const child of sidebarChildren) {
    const expected = child.children.reduce((sum, entry) => {
      const file = sidebarProject.files.find((candidate) => candidate.path === entry.path);
      return sum + (includeWhitespace ? file.textLength : file.visibleTextLength);
    }, 0);
    assert.equal(getSidebarFolderCharCount(metrics, child.path), expected);
  }
  const expectedRoot = sidebarProject.files.reduce(
    (sum, file) => sum + (includeWhitespace ? file.textLength : file.visibleTextLength),
    0,
  );
  assert.equal(getSidebarFolderCharCount(metrics, sidebarRoot), expectedRoot);
  assert.equal(metrics.projectTotalCharCount, expectedRoot);
}

const currentHashes = new Map(
  sidebarDocuments.map((documentAst) => [documentAst.path.toLowerCase(), documentAst.textHash]),
);
const snapshots = Array.from({ length: 50 }, (_, snapshotIndex) => ({
  id: `snapshot-${snapshotIndex}`,
  files: sidebarDocuments.slice(0, 12).map((documentAst, fileIndex) => ({
    path: fileIndex % 2 === 0 ? documentAst.path.toUpperCase() : documentAst.path,
    textHash:
      (snapshotIndex + fileIndex) % 5 === 0 ? `changed-${snapshotIndex}` : documentAst.textHash,
  })),
}));
const conflicts = collectSnapshotConflictPaths(
  snapshots,
  currentHashes,
  (path) => path.toLowerCase(),
);
for (const snapshot of snapshots) {
  const expected = snapshot.files
    .filter((file) => {
      const hash = currentHashes.get(file.path.toLowerCase());
      return hash && hash !== file.textHash;
    })
    .map((file) => file.path.toLowerCase());
  assert.deepEqual([...conflicts.get(snapshot.id)], expected);
}

let nextFrameId = 1;
const frames = new Map();
const appliedFrames = [];
const scheduler = createLatestFrameScheduler(
  (callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  },
  (id) => frames.delete(id),
  (value) => appliedFrames.push(value),
);
for (let index = 0; index < 1_000; index += 1) scheduler.schedule({ index });
assert.equal(frames.size, 1);
const [frameId, frameCallback] = frames.entries().next().value;
frames.delete(frameId);
frameCallback();
assert.deepEqual(appliedFrames, [{ index: 999 }]);
scheduler.schedule({ index: 1_000 });
scheduler.cancel();
assert.deepEqual(appliedFrames, [{ index: 999 }]);
scheduler.schedule({ index: 1_001 });
scheduler.flush();
assert.deepEqual(appliedFrames, [{ index: 999 }, { index: 1_001 }]);

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

const performanceResults = [];
for (const targetCharacters of [10_000, 100_000, 500_000]) {
  const line = "本文 [対象(rb,たいしょう)] **強調** ｜親《おや》\n";
  const baseText = line.repeat(Math.ceil(targetCharacters / line.length)).slice(0, targetCharacters);
  const lines = baseText.split("\n");
  const middle = Math.floor(lines.length / 2);
  lines[middle] += "追";
  const nextText = lines.join("\n");
  const previous = createDocumentAst({ path: fuzzPathA, name: "large.md", text: baseText, indexedAt: 1 });
  assert.deepEqual(
    updateDocumentAst(previous, { path: fuzzPathA, name: "large.md", text: nextText, indexedAt: 2 }),
    createDocumentAst({ path: fuzzPathA, name: "large.md", text: nextText, indexedAt: 2 }),
  );
  updateDocumentAst(previous, { path: fuzzPathA, name: "large.md", text: nextText });
  createDocumentAst({ path: fuzzPathA, name: "large.md", text: nextText });
  const passes = targetCharacters >= 500_000 ? 5 : 9;
  const incrementalTimes = [];
  const rebuildTimes = [];
  for (let pass = 0; pass < passes; pass += 1) {
    let started = performance.now();
    updateDocumentAst(previous, { path: fuzzPathA, name: "large.md", text: nextText });
    incrementalTimes.push(performance.now() - started);
    started = performance.now();
    createDocumentAst({ path: fuzzPathA, name: "large.md", text: nextText });
    rebuildTimes.push(performance.now() - started);
  }
  const incrementalMs = median(incrementalTimes);
  const rebuildMs = median(rebuildTimes);
  performanceResults.push({
    characters: targetCharacters,
    lines: lines.length,
    incrementalMs: Number(incrementalMs.toFixed(2)),
    rebuildMs: Number(rebuildMs.toFixed(2)),
    ratio: Number((incrementalMs / rebuildMs).toFixed(3)),
  });
}

// The initial-index batch must not overwrite a fresher active AST that was
// committed while file reads were still in flight.
const racePath = "C:\\fixture\\active.md";
const staleActive = createDocumentAst({
  path: racePath,
  name: "active.md",
  text: "# old\nold body",
  indexedAt: 1,
});
const freshActive = createDocumentAst({
  path: racePath,
  name: "active.md",
  text: "# new\nnew body",
  indexedAt: 2,
});
const raceOtherPath = "C:\\fixture\\other.md";
const raceOther = createDocumentAst({
  path: raceOtherPath,
  name: "other.md",
  text: "# other",
  indexedAt: 3,
});
let raceProject = projectFromFiles([
  pendingFile(racePath, "active.md"),
  pendingFile(raceOtherPath, "other.md"),
]);
raceProject = replaceProjectAstFile(raceProject, createIndexedProjectAstFile(freshActive));
raceProject = replaceProjectAstFiles(raceProject, [
  createIndexedProjectAstFile(staleActive),
  createIndexedProjectAstFile(raceOther),
], { preserveNewerIndexed: true });
const activeAfterLateBatch = raceProject.files.find((file) => file.path === racePath).documentAst;
const staleBatchOverwritePrevented = activeAfterLateBatch.textHash === freshActive.textHash;
assert.equal(
  staleBatchOverwritePrevented,
  true,
  "a stale initial-index batch must preserve the fresher active document AST",
);
const sameTimestampStaleActive = createDocumentAst({
  path: racePath,
  name: "active.md",
  text: "# old at same timestamp\nold body",
  indexedAt: freshActive.indexedAt,
});
raceProject = replaceProjectAstFiles(
  raceProject,
  [createIndexedProjectAstFile(sameTimestampStaleActive)],
  { preserveNewerIndexed: true },
);
assert.equal(
  raceProject.files.find((file) => file.path === racePath).textHash,
  freshActive.textHash,
  "equal timestamps must conservatively preserve the AST already committed by the editor",
);
const newerIndexedActive = createDocumentAst({
  path: racePath,
  name: "active.md",
  text: "# disk is newer\nnew disk body",
  indexedAt: freshActive.indexedAt + 1,
});
raceProject = replaceProjectAstFiles(
  raceProject,
  [createIndexedProjectAstFile(newerIndexedActive)],
  { preserveNewerIndexed: true },
);
assert.equal(
  raceProject.files.find((file) => file.path === racePath).textHash,
  newerIndexedActive.textHash,
  "the freshness guard must still accept a genuinely newer indexed AST",
);

console.log(
  JSON.stringify(
    {
      deterministicAstFuzz: {
        iterations: 500,
        finalLines: fuzzLines.length,
        operations: fuzzOperationCounts,
      },
      projectAggregateFiles: aggregateProject.files.length,
      sidebarDocuments: sidebarDocuments.length,
      snapshotCount: snapshots.length,
      scheduledPointerEvents: 1_000,
      performance: performanceResults,
      concurrencyGuards: {
        staleInitialIndexBatchPreservesFreshActiveAst: staleBatchOverwritePrevented,
      },
    },
    null,
    2,
  ),
);
console.log("v0.5.7 deep regression tests passed");
