import { hasUnclosedFrontMatter, parseFrontMatter } from "../utils/frontmatter";
import type { LoadedExportSource } from "./types";

/** Returns how many YAML errors the metadata has (analyzeFrontMatter, loaded lazily). */
export type FrontMatterErrorCounter = (metadata: string) => number;

/**
 * One manuscript file as the export screen receives it. Every exporter (PDF,
 * DOCX, submission text) reads `content`, so the front matter and BOM are
 * removed here and nowhere else.
 */
export function createLoadedExportSource(
  file: { path: string; name: string },
  rawContent: string,
  index: number,
  countFrontMatterErrors?: FrontMatterErrorCounter,
): LoadedExportSource {
  const parts = parseFrontMatter(rawContent);
  const content = parts.body;
  const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "txt";
  const frontMatterIssue = hasUnclosedFrontMatter(rawContent)
    ? "unclosed"
    : parts.hasFrontMatter && parts.metadata.trim() && countFrontMatterErrors?.(parts.metadata)
      ? "invalid"
      : undefined;
  return {
    id: file.path || `active-document-${index}`,
    path: file.path,
    extension,
    displayName: file.name,
    chars: content.replace(/\s/g, "").length,
    enabled: true,
    order: index,
    startMode: index === 0 ? "continue" : "new-page",
    markupMode: "then-markup",
    ...(frontMatterIssue ? { frontMatterIssue } : {}),
    content,
  };
}
