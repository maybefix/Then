import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// FM-21: the frontend side of the library's property types (Rust side:
// library.rs tests remembers_property_types_for_the_whole_library and
// reads_library_json_without_property_types_and_skips_unknown_types).
const dir = path.resolve("test-artifacts/property-type-store");
await mkdir(dir, { recursive: true });
await build({
  entryPoints: ["src/properties/propertyTypeStore.ts"],
  outfile: path.join(dir, "store.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
});

const calls = [];
let stored = { date: "date", rating: "stars" };
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === "load_library_property_types") return stored;
      if (command === "save_library_property_type") {
        if (args.scopePath === "C:/単独") throw new Error("ライブラリまたはライブラリ内の作品ではありません");
        stored = { ...stored, [args.name]: args.propertyType };
        return stored;
      }
      throw new Error(`unexpected ${command}`);
    },
    transformCallback: () => 0,
  },
};
const { loadPropertyTypes, savePropertyType } = await import(`${pathToFileURL(path.join(dir, "store.mjs")).href}?${Date.now()}`);

assert.deepEqual(await loadPropertyTypes("C:/lib/作品A"), { date: "date" }, "unknown types are dropped");
assert.deepEqual(calls.at(-1), ["load_library_property_types", { scopePath: "C:/lib/作品A" }]);

assert.deepEqual(await savePropertyType("C:/lib", "publish", "checkbox"), { date: "date", publish: "checkbox" });
assert.deepEqual(calls.at(-1), ["save_library_property_type", { scopePath: "C:/lib", name: "publish", propertyType: "checkbox" }]);

await assert.rejects(savePropertyType("C:/単独", "a", "text"), /ライブラリ/);
console.log("property type store tests passed");
