import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outputDir = path.join(root, "test-artifacts", "manuscript-tidy");
const bundle = path.join(outputDir, "manuscript-tidy-fixture.mjs");
await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts", "manuscript-tidy-fixture.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: bundle,
  external: ["@tauri-apps/api/*"],
});
await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
