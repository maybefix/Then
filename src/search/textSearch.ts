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

type TextSearchEdit = TextSearchRange & { insert: string };

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
  for (const match of includedMatches(text, compiled.pattern, skip)) {
    total += 1;
    if (matches.length < maxResults) {
      matches.push({ index: match.index, length: match[0].length, text: match[0] });
    }
  }

  return {
    matches,
    total,
    truncated: total > matches.length,
    error: null,
  };
}

function* includedMatches(text: string, pattern: RegExp, skip: readonly TextSearchRange[]) {
  let skipIndex = 0;
  for (const match of text.matchAll(pattern) as Iterable<RegExpExecArray>) {
    const { index } = match;
    while (skipIndex < skip.length && skip[skipIndex].to < index) skipIndex += 1;
    const skipped = skip[skipIndex];
    if (skipped && skipped.from <= index + match[0].length && index <= skipped.to) continue;
    yield match;
  }
}

/** Expand the same replacement tokens as String.replace, in the full body's context. */
function expandReplacement(replacement: string, text: string, match: RegExpExecArray): string {
  const tokens = match.groups ? /\$([$&`']|[0-9]{1,2}|<[^>]*>)/g : /\$([$&`']|[0-9]{1,2})/g;
  return replacement.replace(tokens, (token, key: string) => {
    switch (key) {
      case "$": return "$";
      case "&": return match[0];
      case "`": return text.slice(0, match.index);
      case "'": return text.slice(match.index + match[0].length);
    }
    if (key.startsWith("<")) {
      return match.groups?.[key.slice(1, -1)] ?? "";
    }
    const capture = Number(key);
    if (capture > 0 && capture < match.length) return match[capture] ?? "";
    const firstDigit = Number(key[0]);
    if (key.length === 2 && firstDigit > 0 && firstDigit < match.length) {
      return (match[firstDigit] ?? "") + key[1];
    }
    return token;
  });
}

export function findTextSearchEdits(
  text: string,
  query: string,
  replacement: string,
  options: TextSearchOptions,
  skip: readonly TextSearchRange[] = [],
): { edits: TextSearchEdit[]; error: string | null } {
  const { pattern, error } = compileTextSearchPattern(query, options);
  const edits: TextSearchEdit[] = [];
  if (!pattern) return { edits, error };

  for (const match of includedMatches(text, pattern, skip)) {
    edits.push({
      from: match.index,
      to: match.index + match[0].length,
      insert: options.useRegex ? expandReplacement(replacement, text, match) : replacement,
    });
  }
  return { edits, error: null };
}

export function replaceTextSearchMatches(
  text: string,
  query: string,
  replacement: string,
  options: TextSearchOptions,
  skip: readonly TextSearchRange[] = [],
): TextSearchReplacement {
  const { edits, error } = findTextSearchEdits(text, query, replacement, options, skip);
  if (edits.length === 0) return { text, count: 0, error };
  const chunks: string[] = [];
  let cursor = 0;
  for (const { from, to, insert } of edits) {
    chunks.push(text.slice(cursor, from), insert);
    cursor = to;
  }
  chunks.push(text.slice(cursor));
  return { text: chunks.join(""), count: edits.length, error: null };
}
