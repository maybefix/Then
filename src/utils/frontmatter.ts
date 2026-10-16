export const FRONTMATTER_DELIMITER = "---";

// UTF-8 BOM as it appears after decoding. Files saved by some Windows editors start
// with it, so the "---" opener is its second character, not its first.
const BOM = String.fromCharCode(0xfeff);

// An empty block ("---" twice) is tried first, so a body that begins with a "---"
// rule right after it is never read as the block's contents.
const FRONT_MATTER = /^---\r?\n(?:---(?:\r?\n|$)|([\s\S]*?)\r?\n---(?:\r?\n|$))/;

// A body whose first line is "---" would read back as front matter once a second
// "---" appears below it. Such a body is saved behind an empty front matter block.
const BODY_STARTS_WITH_DELIMITER = /^---\r?(?:\n|$)/;

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
  const match = source.match(FRONT_MATTER);
  if (!match) {
    return {
      metadata: "",
      body: source,
      hasFrontMatter: false,
      bom,
    };
  }

  return {
    metadata: match[1] ?? "",
    body: source.slice(match[0].length),
    hasFrontMatter: true,
    bom,
  };
}

function splitLeadingBom(body: string): { text: string; bom: boolean } {
  // Bodies saved before the BOM was split off (e.g. checkpoint snapshots) may still
  // carry it. It belongs to the file, so it goes in front of the front matter.
  return body.startsWith(BOM)
    ? { text: body.slice(BOM.length), bom: true }
    : { text: body, bom: false };
}

function emptyFrontMatterFor(body: string): string {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  return `${FRONTMATTER_DELIMITER}${newline}${FRONTMATTER_DELIMITER}${newline}`;
}

export function composeMarkdown(metadata: string, body: string, bom = false): string {
  const { text, bom: bodyHasBom } = splitLeadingBom(body);
  const prefix = bom || bodyHasBom ? BOM : "";
  const normalizedMetadata = metadata.trimEnd();
  if (!normalizedMetadata.trim()) {
    return BODY_STARTS_WITH_DELIMITER.test(text)
      ? prefix + emptyFrontMatterFor(text) + text
      : prefix + text;
  }

  return prefix + [
    FRONTMATTER_DELIMITER,
    normalizedMetadata,
    FRONTMATTER_DELIMITER,
    text.replace(/^\n+/, ""),
  ].join("\n");
}

/**
 * Replace the body and keep everything before it exactly as it was. Editing the
 * body never creates, removes or reformats front matter.
 */
export function updateMarkdownBody(markdown: string, body: string): string {
  const parts = parseFrontMatter(markdown);
  const { text, bom: bodyHasBom } = splitLeadingBom(body);
  let header = markdown.slice(0, markdown.length - parts.body.length);
  if (bodyHasBom && !parts.bom) header = BOM + header;
  if (!parts.hasFrontMatter && BODY_STARTS_WITH_DELIMITER.test(text)) {
    header += emptyFrontMatterFor(text);
  }
  return header + text;
}

export function appendFrontMatterProperty(metadata: string): string {
  const nextProperty = "新規プロパティ: ";
  return metadata.trimEnd() ? `${metadata.trimEnd()}\n${nextProperty}` : nextProperty;
}
