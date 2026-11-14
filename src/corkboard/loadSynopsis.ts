// The synopsis module (BINDER 1-5) loads the YAML parser, so the screens that
// show a synopsis (the corkboard, 「この場面」) load it on first use.
type SynopsisModule = typeof import("./synopsis");

let loaded: SynopsisModule | null = null;

/** The loaded module, or null before the first loadSynopsis() has finished. */
export function loadedSynopsis(): SynopsisModule | null {
  return loaded;
}

export function loadSynopsis(): Promise<SynopsisModule> {
  return loaded ? Promise.resolve(loaded) : import("./synopsis").then((module) => (loaded = module));
}
