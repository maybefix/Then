import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile("src/App.tsx", "utf8");

assert.match(
  appSource,
  /commandPaletteSelectionRef\.current = getCurrentEditorSelection\(\);[\s\S]*?return true;/,
  "opening the command palette must snapshot the editor selection before focus moves",
);

for (const commandPath of [
  /applyBoldShortcut\(selection \?\? undefined\)/,
  /applyEmphasisShortcut\(selection \?\? undefined\)/,
  /applyHeadingShortcut\(level, selection \?\? undefined\)/,
  /openRubyNotationModal\(selection\)/,
  /applyInlineNotation\(selection, "tcy"\)/,
  /openDirectionNotationModal\(selection\)/,
  /clearSelectionNotation\(selection\)/,
]) {
  assert.match(
    appSource,
    commandPath,
    `palette command must use the selection captured on open: ${commandPath}`,
  );
}

assert.match(
  appSource,
  /const previousSelection = editorInstanceRef\.current\?\.getSelection\(\) \?\? null;[\s\S]*?\[previousDocument\.path\]: \{[\s\S]*?offset: previousSelection\.head,[\s\S]*?length: previousDocument\.text\.length/,
  "switching files must synchronously save the departing cursor instead of losing a debounced update",
);

const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");

assert.match(
  editorSource,
  /const initialViewportToRestore =[\s\S]*?validatedInitialViewport \?\?[\s\S]*?editorDisplayModeRef\.current === "paged" && initialSelectionRef\.current > 0[\s\S]*?anchorOffset: Math\.min\(initialSelectionRef\.current, textRef\.current\.length\)/,
  "launching in paged mode must use the restored cursor as a viewport anchor when no tab viewport exists",
);

console.log("v0.6.0 editor position memory tests passed");
