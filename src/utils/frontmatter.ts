export const FRONTMATTER_DELIMITER = "---";

// UTF-8 BOM as it appears after decoding. Files saved by some Windows editors start
// with it, so the "---" opener is its second character, not its first.
const BOM = "﻿";

export type FrontMatterParts = {
  metadata: string;
  /** Text after the front matter, never starting with the BOM. */
  body: string;
  hasFrontMatter: boolean;
  /** The file starts with a BOM; composeMarkdown puts it back in front. */
  bom: boolean;
};

export function parseFrontMatter(markdown: string): FrontMatterParts {
  const bom = markdown.startsWith(BOM);
  const source = bom ? markdown.slice(BOM.length) : markdown;
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      metadata: "",
      body: source,
      hasFrontMatter: false,
      bom,
    };
  }

  return {
    metadata: match[1],
    body: source.slice(match[0].length),
    hasFrontMatter: true,
    bom,
  };
}

export function composeMarkdown(metadata: string, body: string, bom = false): string {
  // Bodies saved before the BOM was split off (e.g. checkpoint snapshots) may still
  // carry it. It belongs to the file, so it goes in front of the front matter.
  const bodyHasBom = body.startsWith(BOM);
  const text = bodyHasBom ? body.slice(BOM.length) : body;
  const prefix = bom || bodyHasBom ? BOM : "";
  const normalizedMetadata = metadata.trimEnd();
  if (!normalizedMetadata.trim()) return prefix + text;

  return prefix + [
    FRONTMATTER_DELIMITER,
    normalizedMetadata,
    FRONTMATTER_DELIMITER,
    text.replace(/^\n+/, ""),
  ].join("\n");
}

export function updateMarkdownBody(markdown: string, body: string): string {
  const parts = parseFrontMatter(markdown);
  return composeMarkdown(parts.metadata, body, parts.bom);
}

export function appendFrontMatterProperty(metadata: string): string {
  const nextProperty = "新規プロパティ: ";
  return metadata.trimEnd() ? `${metadata.trimEnd()}\n${nextProperty}` : nextProperty;
}
