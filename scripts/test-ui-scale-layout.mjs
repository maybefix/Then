import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile("src/App.css", "utf8");
const zoomRules = [...css.matchAll(/([^{}]+)\{([^{}]*zoom:\s*var\(--ui-font-scale,\s*1\);[^{}]*)\}/g)];
const chromeZoomRule = zoomRules.find((match) => match[1].includes(".topbar"));

assert.ok(chromeZoomRule, "the application chrome must define a UI scale rule");
const chromeZoomSelectors = chromeZoomRule[1];
assert.match(
  chromeZoomSelectors,
  /\.leftWorkspaceCluster/,
  "the left workspace cluster must scale as one layout unit",
);
assert.doesNotMatch(
  chromeZoomSelectors,
  /\.workspaceActivityBar/,
  "the activity bar must not be scaled separately from its cluster",
);
assert.doesNotMatch(
  chromeZoomSelectors,
  /\.workspaceSidebar/,
  "the workspace sidebar must not be scaled separately from its cluster",
);

const clusterLayoutRules = [...css.matchAll(/\.leftWorkspaceCluster\s*\{([^{}]*)\}/g)];
const boundedClusterRule = clusterLayoutRules.find((match) =>
  match[1].includes("max-width: calc(44px + var(--left-sidebar-width))"),
);
assert.ok(boundedClusterRule, "the left workspace cluster must retain its bounded base width");
assert.match(
  boundedClusterRule[1],
  /overflow:\s*hidden/,
  "the cluster should still clip only during collapse and focus-mode transitions",
);

console.log("UI scale layout tests passed");
