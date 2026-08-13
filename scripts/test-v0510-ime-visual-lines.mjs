import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

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

const { resolveVisualLineLayerUpdate } = await importStandaloneTypeScript(
  "src/editor/visualLineLayout.ts",
);

assert.equal(
  resolveVisualLineLayerUpdate(true, true, true, true),
  "preserve",
  "IME composition must retain the last stable line numbers and current-line highlight",
);
assert.equal(
  resolveVisualLineLayerUpdate(false, false, true, true),
  "clear",
  "turning both visual-line features off must clear the layer even during composition",
);
assert.equal(
  resolveVisualLineLayerUpdate(true, false, true, false),
  "render",
  "the visual-line layer must resume measurement after composition",
);
assert.equal(
  resolveVisualLineLayerUpdate(true, true, false, true),
  "clear",
  "destroying the editor must clear a retained visual-line layer",
);

console.log("v0.5.10 IME visual-line tests passed");
