// FM-28: property values of the files a search covers. Built only while the
// search has a [name:value] condition, from each file's front matter, apart
// from the body index (FM-12). Open documents use their current text and are
// re-parsed only when their front matter changes; other files are read once per
// property search.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseFrontMatter } from "../utils/frontmatter";
import type { PropertyValues } from "./propertySearch";

type Analyzer = typeof import("../utils/frontmatterYaml");

export function usePropertyValueIndex({
  enabled,
  paths,
  openTexts,
  readText,
}: {
  enabled: boolean;
  paths: readonly string[];
  /** Full text of documents open in tabs, by path. These are always current. */
  openTexts: ReadonlyMap<string, string>;
  /** Reads a file that is not open. */
  readText: (path: string) => Promise<string>;
}): { valuesFor: (path: string) => PropertyValues | undefined; isLoading: boolean } {
  const [analyzer, setAnalyzer] = useState<Analyzer | null>(null);
  const fileCacheRef = useRef(new Map<string, PropertyValues>());
  const openCacheRef = useRef(new Map<string, { metadata: string; values: PropertyValues }>());
  const [version, setVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const readTextRef = useRef(readText);
  readTextRef.current = readText;
  const openTextsRef = useRef(openTexts);
  openTextsRef.current = openTexts;

  useEffect(() => {
    if (!enabled) {
      // A new property search reads the files afresh.
      fileCacheRef.current = new Map();
      return;
    }
    if (analyzer) return;
    let cancelled = false;
    import("../utils/frontmatterYaml").then(
      (module) => {
        if (!cancelled) setAnalyzer(module);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [analyzer, enabled]);

  useEffect(() => {
    if (!enabled || !analyzer) return;
    const missing = paths.filter((path) => !openTextsRef.current.has(path) && !fileCacheRef.current.has(path));
    if (missing.length === 0) return;
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      for (const [index, path] of missing.entries()) {
        let values: PropertyValues = null;
        try {
          const text = await readTextRef.current(path);
          values = analyzer.readPropertyValues(parseFrontMatter(text).metadata);
        } catch {
          values = null;
        }
        if (cancelled) return;
        fileCacheRef.current.set(path, values);
        // Show results as they arrive without re-rendering for every file.
        if (index % 20 === 19) setVersion((current) => current + 1);
      }
      if (!cancelled) {
        setIsLoading(false);
        setVersion((current) => current + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analyzer, enabled, paths]);

  const openValues = useMemo(() => {
    const values = new Map<string, PropertyValues>();
    if (!enabled || !analyzer) return values;
    const cache = openCacheRef.current;
    for (const [path, text] of openTexts) {
      // Splitting off the front matter is cheap; YAML is parsed only when it changed.
      const metadata = parseFrontMatter(text).metadata;
      let entry = cache.get(path);
      if (!entry || entry.metadata !== metadata) {
        entry = { metadata, values: analyzer.readPropertyValues(metadata) };
        cache.set(path, entry);
      }
      values.set(path, entry.values);
    }
    return values;
  }, [analyzer, enabled, openTexts]);

  const valuesFor = useMemo(() => {
    void version;
    return (path: string) => (openValues.has(path) ? openValues.get(path) : fileCacheRef.current.get(path));
  }, [openValues, version]);

  return { valuesFor, isLoading: enabled && (isLoading || !analyzer) };
}
