import { build } from "esbuild";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Bundle the real components and defaults, sharing the test runner's React instance.
export async function loadSettingsTestComponents() {
  const bundle = await build({
    stdin: { contents: [
      'export { createDefaultState } from "./src/storedStateModel";',
      ...["SettingsModal", "BoundedNumberInput", "SettingsFontSelect", "ThemePickerModal"].map((name) => `export { ${name} } from "./src/components/dialogs/${name}";`),
    ].join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "node", external: ["react", "react-dom"], jsx: "automatic", write: false, logLevel: "error",
  });
  await mkdir("tmp", { recursive: true });
  const filename = path.resolve("tmp", `settings-test-${process.pid}.mjs`);
  try {
    await writeFile(filename, bundle.outputFiles[0].text);
    return await import(pathToFileURL(filename).href);
  } finally {
    await unlink(filename);
  }
}
