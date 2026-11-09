import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { repairTauriAssetCache } from "./repair-tauri-asset-cache.mjs";

const tempRoot = path.resolve(".tmp");
mkdirSync(tempRoot, { recursive: true });
const target = mkdtempSync(path.join(tempRoot, "tauri-cache-test-"));
try {
  const cache = path.join(target, "release", "build", "Then-test", "out", "tauri-codegen-assets");
  mkdirSync(cache, { recursive: true });
  const valid = path.join(cache, `${"a".repeat(64)}.js`);
  const empty = path.join(cache, `${"b".repeat(64)}.js`);
  const truncated = path.join(cache, `${"c".repeat(64)}.js`);
  const compressed = brotliCompressSync(Buffer.from("window.appStarted = true;"));
  writeFileSync(valid, compressed);
  writeFileSync(empty, Buffer.alloc(0));
  writeFileSync(truncated, compressed.subarray(0, 2));
  const unrelated = path.join(cache, "keep.txt");
  writeFileSync(unrelated, "not a generated asset");
  assert.deepEqual(repairTauriAssetCache(target).sort(), [empty, truncated].sort());
  assert.equal(existsSync(empty), false);
  assert.equal(existsSync(truncated), false);
  assert.deepEqual(readFileSync(valid), compressed);
  assert.equal(readFileSync(unrelated, "utf8"), "not a generated asset");
  assert.deepEqual(repairTauriAssetCache(target), []);
  console.log("Tauri asset cache recovery tests passed");
} finally {
  const resolved = realpathSync(target);
  assert.ok(resolved.startsWith(realpathSync(tempRoot) + path.sep));
  assert.ok(path.basename(resolved).startsWith("tauri-cache-test-"));
  rmSync(resolved, { recursive: true });
}
