import { existsSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

// Tauri reuses a cached compressed asset whenever its file exists. An interrupted
// build can leave an empty or truncated file which would otherwise be embedded.
export function repairTauriAssetCache(targetDirectory) {
  if (!existsSync(targetDirectory)) return [];
  const target = realpathSync(targetDirectory);
  const build = path.join(target, "release", "build");
  if (!existsSync(build)) return [];
  const removed = [];
  for (const entry of readdirSync(build, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("Then-")) continue;
    const directory = path.join(build, entry.name, "out", "tauri-codegen-assets");
    if (!existsSync(directory)) continue;
    const cache = realpathSync(directory);
    const relative = path.relative(target, cache);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Asset cache is outside the build directory: ${cache}`);
    }
    for (const file of readdirSync(cache, { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-f0-9]{64}(?:\.[a-z0-9]+)?$/i.test(file.name)) continue;
      const filename = path.join(cache, file.name);
      const compressed = readFileSync(filename);
      let valid = false;
      try {
        brotliDecompressSync(compressed);
        valid = true;
      } catch {
        // Only invalid generated compression data is removed, never source files.
      }
      if (!valid) {
        unlinkSync(filename);
        removed.push(filename);
      }
    }
  }
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = fileURLToPath(new URL("../src-tauri/target/", import.meta.url));
  const removed = repairTauriAssetCache(target);
  console.log(`Tauri compressed asset cache: removed ${removed.length} invalid file(s).`);
}
