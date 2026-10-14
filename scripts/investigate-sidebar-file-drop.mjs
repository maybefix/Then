import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";

// Reuse the existing React/JSDOM sidebar fixture and its baseline assertions.
// These additional cases record which callback the real pointer handlers select.
const directory = resolve("test-artifacts/sidebar-file-drop");
await mkdir(directory, { recursive: true });
const source = await readFile("scripts/test-heading-dnd-ui.mjs", "utf8");
const diagnostics = `
const diagnosticResults = [];
for (const [label, moveTarget, releaseTarget, y] of [
  ["folder-center", destinationFolderRow, destinationFolderRow, 10],
  ["folder-upper-20-percent", destinationFolderRow, destinationFolderRow, 4],
  ["folder-lower-80-percent", destinationFolderRow, destinationFolderRow, 16],
  ["release-enters-folder-after-last-move", fileRowA, destinationFolderRow, 10],
  ["adjacent-file-on-folder-upper-edge", destinationFolderRow, destinationFolderRow, 4],
]) {
  const dragButton = label.startsWith("adjacent-") ? fileRowC.querySelector(".treeItemPrimary") : fileButtonA;
  await clickFile(dragButton, 90);
  const before = globalThis.__fileMoveLogs.length;
  treePointerTarget = moveTarget;
  await act(async () => {
    dragButton.dispatchEvent(pointerEvent("pointerdown", 91, 0, 0));
    dragButton.dispatchEvent(pointerEvent("pointermove", 91, 0, y));
  });
  const highlighted = document.querySelector(".treeDrop-into, .treeDrop-before, .treeDrop-after")?.className ?? null;
  treePointerTarget = releaseTarget;
  await act(async () => {
    dragButton.dispatchEvent(pointerEvent("pointerup", 91, 0, y));
  });
  diagnosticResults.push({ label, highlighted, callbacks: globalThis.__fileMoveLogs.slice(before) });
}
globalThis.__sidebarDropInvestigation = diagnosticResults;
console.log(JSON.stringify({ diagnosticResults }, null, 2));
`;
const fixture = source.replace(
  'console.log(JSON.stringify({ stages, domOrder, logs: globalThis.__headingLogs }, null, 2));',
  diagnostics,
);
if (fixture === source) throw new Error("Sidebar fixture insertion point changed");
const fixturePath = resolve(directory, "fixture.mjs");
await writeFile(fixturePath, fixture);
await import(pathToFileURL(fixturePath).href);
const treeSource = await readFile("src/utils/projectTree.ts", "utf8");
const treeCode = ts.transpileModule(treeSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { movePathsToDropPosition } = await import(`data:text/javascript;base64,${Buffer.from(treeCode).toString("base64")}`);
for (const result of globalThis.__sidebarDropInvestigation) {
  const reorder = result.callbacks.find(([kind]) => kind === "reorder-files");
  if (reorder) {
    const { sourcePaths, targetPath, position } = reorder[1];
    result.reorderResult = movePathsToDropPosition(
      ["a.md", "b.md", "c.md", "destination"].map((name) => `C:\\fixture\\${name}`),
      sourcePaths, targetPath, position,
    );
  }
}
await writeFile(resolve(directory, "results.json"), JSON.stringify(globalThis.__sidebarDropInvestigation, null, 2));
