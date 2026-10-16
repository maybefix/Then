// YAML analysis of the front matter text. Loaded on demand (see
// useFrontMatterAnalysis) so the parser stays out of the main bundle, and fed only
// the metadata string, so body edits never re-run it.
import { isMap, isScalar, LineCounter, parseDocument, type YAMLError } from "yaml";

export type FrontMatterProperty = {
  key: string;
  /** 1-based line inside the metadata (the line after the opening ---). */
  line: number;
};

export type FrontMatterIssue = {
  line: number;
  message: string;
};

export type FrontMatterAnalysis = {
  properties: FrontMatterProperty[];
  errors: FrontMatterIssue[];
};

const NOT_A_MAPPING = "プロパティは「名前: 値」の形で書いてください（「:」の後に空白）";

function messageFor(error: YAMLError, lineText: string): string {
  switch (error.code) {
    case "DUPLICATE_KEY": {
      const key = lineText.split(":")[0]?.trim();
      return key ? `「${key}」が重複しています` : "同じ名前のプロパティが重複しています";
    }
    case "TAB_AS_INDENT":
      return "字下げにタブは使えません";
    case "MISSING_CHAR":
      return "引用符や括弧の閉じ、または「:」が足りません";
    case "BAD_INDENT":
    case "BLOCK_AS_IMPLICIT_KEY":
    case "MULTILINE_IMPLICIT_KEY":
    case "UNEXPECTED_TOKEN":
      return "字下げか書き方が正しくありません";
    default:
      return "YAMLとして読めません";
  }
}

function firstContentLine(lines: string[]): number {
  const index = lines.findIndex((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  return index < 0 ? 1 : index + 1;
}

/**
 * Plain values of the top-level properties, for property search (FM-28). null
 * when the YAML is invalid or not a "name: value" mapping.
 */
export function readPropertyValues(metadata: string): Record<string, unknown> | null {
  if (!metadata.trim()) return {};
  const document = parseDocument(metadata, { prettyErrors: false });
  if (document.errors.length > 0) return null;
  if (document.contents === null) return {};
  if (!isMap(document.contents)) return null;
  try {
    const values = document.toJS({ maxAliasCount: 100 }) as unknown;
    return values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function analyzeFrontMatter(metadata: string): FrontMatterAnalysis {
  const lines = metadata.split(/\r?\n/);
  const lineCounter = new LineCounter();
  const document = parseDocument(metadata, { lineCounter, prettyErrors: false });

  const errors: FrontMatterIssue[] = [];
  const seenLines = new Set<number>();
  for (const error of document.errors) {
    const line = lineCounter.linePos(error.pos[0]).line;
    // One message per line: the parser often reports a single mistake several times.
    if (seenLines.has(line)) continue;
    seenLines.add(line);
    errors.push({ line, message: messageFor(error, lines[line - 1] ?? "") });
  }

  const contents = document.contents;
  const properties: FrontMatterProperty[] = [];
  if (isMap(contents)) {
    for (const item of contents.items) {
      const key = isScalar(item.key) ? String(item.key.value) : String(item.key ?? "");
      const offset = isScalar(item.key) && item.key.range ? item.key.range[0] : 0;
      properties.push({ key, line: lineCounter.linePos(offset).line });
    }
  } else if (contents !== null && errors.length === 0) {
    errors.push({ line: firstContentLine(lines), message: NOT_A_MAPPING });
  }

  errors.sort((left, right) => left.line - right.line);
  return { properties, errors };
}
