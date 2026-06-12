export const FRONTMATTER_DELIMITER = "---";

export type FrontMatterParts = {
  metadata: string;
  body: string;
  hasFrontMatter: boolean;
};

export function parseFrontMatter(markdown: string): FrontMatterParts {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      metadata: "",
      body: markdown,
      hasFrontMatter: false,
    };
  }

  return {
    metadata: match[1],
    body: markdown.slice(match[0].length),
    hasFrontMatter: true,
  };
}

export function composeMarkdown(metadata: string, body: string): string {
  const normalizedMetadata = metadata.trimEnd();
  if (!normalizedMetadata.trim()) return body;

  return [
    FRONTMATTER_DELIMITER,
    normalizedMetadata,
    FRONTMATTER_DELIMITER,
    body.replace(/^\n+/, ""),
  ].join("\n");
}

export function updateMarkdownBody(markdown: string, body: string): string {
  const parts = parseFrontMatter(markdown);
  return composeMarkdown(parts.metadata, body);
}

export function appendFrontMatterProperty(metadata: string): string {
  const nextProperty = "新規プロパティ: ";
  return metadata.trimEnd() ? `${metadata.trimEnd()}\n${nextProperty}` : nextProperty;
}
