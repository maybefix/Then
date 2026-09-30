/** How displayed character counts are taken (settings: 空白を含める / コードの文字数を数える). */
export type CharacterCountOptions = {
  includeWhitespace: boolean;
  includeCode: boolean;
};

type CountedMetrics = {
  textLength: number;
  visibleTextLength: number;
  codeTextLength: number;
  codeVisibleTextLength: number;
};

type CountedSection = {
  sectionTextLength: number;
  sectionVisibleTextLength: number;
  sectionCodeTextLength: number;
  sectionCodeVisibleTextLength: number;
};

/** Character count of a document or project file under the display options. */
export function displayedCharacterCount(metrics: CountedMetrics, options: CharacterCountOptions): number {
  const total = options.includeWhitespace ? metrics.textLength : metrics.visibleTextLength;
  if (options.includeCode) return total;
  return total - (options.includeWhitespace ? metrics.codeTextLength : metrics.codeVisibleTextLength);
}

/** Character count of an outline section under the display options. */
export function displayedSectionCount(section: CountedSection, options: CharacterCountOptions): number {
  return displayedCharacterCount(
    {
      textLength: section.sectionTextLength,
      visibleTextLength: section.sectionVisibleTextLength,
      codeTextLength: section.sectionCodeTextLength,
      codeVisibleTextLength: section.sectionCodeVisibleTextLength,
    },
    options,
  );
}

/** Stable cache key for per-options memoization. */
export function characterCountOptionsKey(options: CharacterCountOptions): string {
  return `${options.includeWhitespace ? "ws" : "nows"}|${options.includeCode ? "code" : "nocode"}`;
}
