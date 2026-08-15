import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appCss = await readFile(new URL("../src/App.css", import.meta.url), "utf8");

function ruleBody(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = appCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `CSS rule not found: ${selector}`);
  return match[1];
}

const focusTopbar = ruleBody('.appFrame[data-editor-focus="true"] .topbar');
assert.match(focusTopbar, /box-shadow:\s*none;/);
assert.match(focusTopbar, /transform:\s*translateY\(calc\(-100% \+ 7px\)\);/);
assert.doesNotMatch(
  appCss,
  /\.appFrame\[data-editor-focus="true"\] \.topbar::after/,
  "focus mode must not draw an edge gradient",
);

const focusStatusbar = ruleBody('.appFrame[data-editor-focus="true"] .statusbar');
assert.match(focusStatusbar, /box-shadow:\s*none;/);
assert.match(focusStatusbar, /clip-path:\s*inset\(calc\(100% - 7px\) 0 0\);/);

assert.match(
  appCss,
  /\.appFrame\[data-editor-focus="true"\] \.topbar:hover,\s*\n\.appFrame\[data-editor-focus="true"\] \.topbar:focus-within\s*\{[\s\S]*?transform:\s*translateY\(0\);/,
  "topbar hover/focus reveal must remain available",
);
assert.match(
  appCss,
  /\.appFrame\[data-editor-focus="true"\] \.statusbar:hover,\s*\n\.appFrame\[data-editor-focus="true"\] \.statusbar:focus-within\s*\{[\s\S]*?clip-path:\s*inset\(0\);/,
  "statusbar hover/focus reveal must remain available",
);

console.log("v0.5.11 focus-mode regression checks passed.");
