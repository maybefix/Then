// The material list module (BINDER 3-3) loads the YAML parser, so 「この場面」
// loads it on first use, like the synopsis (src/corkboard/loadSynopsis.ts).
type MaterialListModule = typeof import("./materialList");

let loaded: MaterialListModule | null = null;

/** The loaded module, or null before the first loadMaterialList() has finished. */
export function loadedMaterialList(): MaterialListModule | null {
  return loaded;
}

export function loadMaterialList(): Promise<MaterialListModule> {
  return loaded ? Promise.resolve(loaded) : import("./materialList").then((module) => (loaded = module));
}
