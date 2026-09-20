export type TextSearchOptions = {
  useRegex: boolean;
  matchCase: boolean;
};

export type TextSearchMatch = {
  index: number;
  length: number;
  text: string;
};

export type TextSearchMatches = {
  matches: TextSearchMatch[];
  total: number;
  truncated: boolean;
  error: string | null;
};

export type TextSearchReplacement = {
  text: string;
  count: number;
  error: string | null;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compileTextSearchPattern(
  query: string,
  options: TextSearchOptions,
): { pattern: RegExp | null; error: string | null } {
  if (query.length === 0) return { pattern: null, error: null };

  try {
    return {
      pattern: new RegExp(
        options.useRegex ? query : escapeRegExp(query),
        `gmu${options.matchCase ? "" : "i"}`,
      ),
      error: null,
    };
  } catch (error) {
    return {
      pattern: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function findTextSearchMatches(
  text: string,
  query: string,
  options: TextSearchOptions,
  maxResults = Number.POSITIVE_INFINITY,
): TextSearchMatches {
  const compiled = compileTextSearchPattern(query, options);
  if (!compiled.pattern) {
    return { matches: [], total: 0, truncated: false, error: compiled.error };
  }

  const matches: TextSearchMatch[] = [];
  let total = 0;
  for (const match of text.matchAll(compiled.pattern)) {
    const index = match.index ?? 0;
    total += 1;
    if (matches.length < maxResults) {
      matches.push({ index, length: match[0].length, text: match[0] });
    }
  }

  return {
    matches,
    total,
    truncated: total > matches.length,
    error: null,
  };
}

export function replaceTextSearchMatches(
  text: string,
  query: string,
  replacement: string,
  options: TextSearchOptions,
): TextSearchReplacement {
  const compiled = compileTextSearchPattern(query, options);
  if (!compiled.pattern) {
    return { text, count: 0, error: compiled.error };
  }

  let count = 0;
  for (const _match of text.matchAll(compiled.pattern)) count += 1;
  if (count === 0) return { text, count: 0, error: null };

  return {
    text: options.useRegex
      ? text.replace(compiled.pattern, replacement)
      : text.replace(compiled.pattern, () => replacement),
    count,
    error: null,
  };
}
