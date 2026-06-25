import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outputDir = path.join(root, "test-artifacts", "export");
const fixtureBundle = path.join(outputDir, "export-fixture.mjs");
await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts", "export-fixture.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: fixtureBundle,
});
await import(`${pathToFileURL(fixtureBundle).href}?${Date.now()}`);
