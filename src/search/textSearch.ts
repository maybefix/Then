export type TextSearchOptions = {
  useRegex: boolean;
  matchCase: boolean;
  /** コメント行も検索・置換の対象にするか。既定（未指定）は対象外。 */
  includeComments?: boolean;
};

/** 検索・置換から外す範囲（コメント行など）。昇順で重ならないこと。 */
export type TextSearchRange = {
  from: number;
  to: number;
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
  skip: readonly TextSearchRange[] = [],
): TextSearchMatches {
  const compiled = compileTextSearchPattern(query, options);
  if (!compiled.pattern) {
    return { matches: [], total: 0, truncated: false, error: compiled.error };
  }

  const matches: TextSearchMatch[] = [];
  let total = 0;
  let skipIndex = 0;
  for (const match of text.matchAll(compiled.pattern)) {
    const index = match.index ?? 0;
    while (skipIndex < skip.length && skip[skipIndex].to < index) skipIndex += 1;
    const skipped = skip[skipIndex];
    if (skipped && skipped.from <= index + match[0].length && index <= skipped.to) continue;
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
  skip: readonly TextSearchRange[] = [],
): TextSearchReplacement {
  const compiled = compileTextSearchPattern(query, options);
  if (!compiled.pattern) {
    return { text, count: 0, error: compiled.error };
  }

  if (skip.length > 0) {
    // 外す範囲は行単位なので、その間の区間ごとに置換すれば ^ $ の意味も保たれる。
    const chunks: string[] = [];
    let count = 0;
    let cursor = 0;
    for (const range of [...skip, { from: text.length, to: text.length }]) {
      const segment = replaceTextSearchMatches(text.slice(cursor, range.from), query, replacement, options);
      chunks.push(segment.text, text.slice(range.from, range.to));
      count += segment.count;
      cursor = range.to;
    }
    return { text: count > 0 ? chunks.join("") : text, count, error: null };
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
