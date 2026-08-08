import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import ts from "typescript";

function staticRuntimeImports(source, fileName) {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = new Set();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const hasRuntimeDefault = Boolean(clause.name);
    const hasRuntimeBinding = clause.namedBindings
      ? ts.isNamespaceImport(clause.namedBindings) ||
        clause.namedBindings.elements.some((element) => !element.isTypeOnly)
      : false;
    if (hasRuntimeDefault || hasRuntimeBinding) imports.add(statement.moduleSpecifier.text);
  }
  return imports;
}

const mainSource = await readFile("src/main.tsx", "utf8");
const appSource = await readFile("src/App.tsx", "utf8");
const mainImports = staticRuntimeImports(mainSource, "src/main.tsx");
const appImports = staticRuntimeImports(appSource, "src/App.tsx");

for (const modulePath of ["./App", "./CanvasWindowApp", "./ExportWindowApp"]) {
  assert.equal(
    mainImports.has(modulePath),
    true,
    `${modulePath} must remain eagerly available when the application starts`,
  );
}

for (const modulePath of [
  "./VerticalTextEditor",
  "./CanvasWindowApp",
  "./components/export/LinkedExportScreen",
  "./components/checkpoints/CheckpointStudio",
  "./components/references/ReferencePane",
  "./components/snippets/IdeaPane",
]) {
  assert.equal(
    appImports.has(modulePath),
    true,
    `${modulePath} must remain eagerly available when the main screen starts`,
  );
}

assert.doesNotMatch(mainSource, /\blazy\(/, "root screens must not wait for a first-use import");
assert.doesNotMatch(appSource, /\blazy\(/, "feature screens must not wait for a first-use import");

const viteSource = await readFile("vite.config.ts", "utf8");
assert.match(
  viteSource,
  /manualChunks\s*\(/,
  "the eager application graph must be separated through Rollup manual chunks",
);

const manifest = JSON.parse(await readFile("dist/.vite/manifest.json", "utf8"));
const mainEntry = manifest["index.html"];
assert.ok(mainEntry?.isEntry, "the production manifest must identify the main entry");
const eagerEntries = ["index.html", ...(mainEntry.imports ?? [])].map((key) => manifest[key]);
assert.equal(
  eagerEntries.some((entry) => entry?.name?.includes("pdf")),
  false,
  "the existing on-demand PDF implementation must not become an eager startup dependency",
);
assert.equal(
  eagerEntries.some((entry) => entry?.isDynamicEntry),
  false,
  "an on-demand dependency chunk must not also be preloaded by the main entry",
);
const emittedJs = new Set(
  Object.values(manifest)
    .filter((entry) => entry.name)
    .map((entry) => entry.file)
    .filter((file) => file.endsWith(".js") || file.endsWith(".mjs")),
);
const chunkSizes = await Promise.all(
  [...emittedJs].map(async (file) => ({ file, bytes: (await stat(`dist/${file}`)).size })),
);
const eagerBytes = (
  await Promise.all(eagerEntries.map(async (entry) => (await stat(`dist/${entry.file}`)).size))
).reduce((sum, bytes) => sum + bytes, 0);
const largestChunk = chunkSizes.sort((left, right) => right.bytes - left.bytes)[0];
const totalBytes = chunkSizes.reduce((sum, chunk) => sum + chunk.bytes, 0);
assert.ok(largestChunk, "the production manifest must contain JavaScript chunks");
assert.ok(
  largestChunk.bytes < 500_000,
  `largest JavaScript chunk must stay below Vite's 500 kB warning (${largestChunk.file}: ${largestChunk.bytes})`,
);

console.log(JSON.stringify({ largestChunk, eagerBytes, totalBytes, chunks: chunkSizes.length }, null, 2));
console.log("v0.5.8 bundle splitting tests passed");
