// FM-28: narrowing a search by property values, written like Obsidian:
//   [publish:true]  [tags:開発]  [date:2026-10]  [slug]  [description:]
// Conditions are ANDed and combine with the text that remains in the query. The
// YAML parsing that produces the values lives in frontmatterYaml (loaded lazily);
// this module only reads the query and compares plain values.
import type { ProjectSearchOutcome, ProjectSearchResult } from "../editor/ast/types";

export type PropertyCondition = {
  key: string;
  /** null: the property only has to exist. "": it has to be empty. */
  value: string | null;
};

export type PropertyQuery = {
  /** The query with the conditions taken out, for the text search. */
  text: string;
  conditions: PropertyCondition[];
};

/** Plain values of one file's properties (YAML toJS). null when the YAML is invalid. */
export type PropertyValues = Record<string, unknown> | null;

// A key is a run of characters without brackets, parentheses, commas or colons,
// so Then markup such as [東京(rb,とうきょう)] or [12(tcy)] stays search text.
const CONDITION = /\[\s*([^\s[\]():,][^[\]():,]*?)\s*(?::([^[\]]*))?\]/g;

export function parsePropertyQuery(raw: string): PropertyQuery {
  const conditions: PropertyCondition[] = [];
  const text = raw.replace(CONDITION, (_match, key: string, value: string | undefined) => {
    conditions.push({ key: key.trim(), value: value === undefined ? null : value.trim() });
    return " ";
  });
  return { text: conditions.length ? text.replace(/\s+/g, " ").trim() : raw, conditions };
}

function scalarMatches(actual: unknown, wanted: string): boolean {
  if (actual === null || actual === undefined) return false;
  if (typeof actual === "boolean") return String(actual) === wanted.toLowerCase();
  if (typeof actual === "number") {
    return wanted !== "" && !Number.isNaN(Number(wanted)) ? actual === Number(wanted) : false;
  }
  if (typeof actual === "string") return actual.toLowerCase().includes(wanted.toLowerCase());
  return false;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Text matches when it contains the wanted value (so [date:2026-10] finds the
 * month), numbers and true/false must be equal, and a list matches when any of
 * its items does. Property names ignore case.
 */
export function matchesPropertyConditions(values: PropertyValues, conditions: readonly PropertyCondition[]): boolean {
  if (!values) return false;
  const entries = Object.entries(values);
  return conditions.every((condition) => {
    const entry = entries.find(([key]) => key.toLowerCase() === condition.key.toLowerCase());
    if (!entry) return false;
    const actual = entry[1];
    if (condition.value === null) return true;
    if (condition.value === "") return isEmpty(actual);
    if (Array.isArray(actual)) return actual.some((item) => scalarMatches(item, condition.value as string));
    return scalarMatches(actual, condition.value);
  });
}

/** The query text for searching one property value from the properties pane. */
export function propertyConditionQuery(key: string, value: string): string {
  const safe = (part: string) => part.replace(/[[\]]/g, "");
  return `[${safe(key)}:${safe(value)}]`;
}

function summarize(values: PropertyValues, conditions: readonly PropertyCondition[]): string {
  if (!values) return "";
  return conditions
    .map((condition) => {
      const entry = Object.entries(values).find(([key]) => key.toLowerCase() === condition.key.toLowerCase());
      if (!entry) return "";
      const value = Array.isArray(entry[1]) ? entry[1].join(", ") : entry[1] === null ? "" : String(entry[1]);
      return `${entry[0]}: ${value}`;
    })
    .filter(Boolean)
    .join(" / ");
}

/** One result per matching file, for a query that is only property conditions. */
export function propertyFileResults(
  files: ReadonlyArray<{ path: string; name: string }>,
  valuesFor: (path: string) => PropertyValues | undefined,
  conditions: readonly PropertyCondition[],
  maxResults = 200,
): ProjectSearchOutcome {
  const matched = files.filter((file) => matchesPropertyConditions(valuesFor(file.path) ?? null, conditions));
  const results: ProjectSearchResult[] = matched.slice(0, maxResults).map((file) => {
    const excerpt = summarize(valuesFor(file.path) ?? null, conditions);
    return {
      id: `property:${file.path}`,
      kind: "body",
      path: file.path,
      name: file.name,
      line: 1,
      column: 1,
      title: null,
      excerpt,
      headingChain: [],
      matchStart: 0,
      matchLength: 0,
      score: 60,
    };
  });
  results.sort((left, right) => left.name.localeCompare(right.name, "ja"));
  return {
    results,
    total: matched.length,
    matchedFileCount: matched.length,
    truncated: matched.length > maxResults,
    error: null,
  };
}
