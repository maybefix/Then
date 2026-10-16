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
  /** The file starts with a BOM; replaceFrontMatter and updateMarkdownBody keep it. */
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

function newlineOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function emptyFrontMatterFor(body: string): string {
  const newline = newlineOf(body);
  return `${FRONTMATTER_DELIMITER}${newline}${FRONTMATTER_DELIMITER}${newline}`;
}

/**
 * Replace the front matter and keep everything else exactly as it was: the BOM,
 * the body (blank lines at its start included) and the file's line endings.
 * `metadata` is written as given, so a trailing newline or space typed into the
 * editor stays. Blank metadata removes the block, unless the body starts with a
 * "---" rule (see BODY_STARTS_WITH_DELIMITER).
 */
export function replaceFrontMatter(markdown: string, metadata: string): string {
  const parts = parseFrontMatter(markdown);
  if (metadata === parts.metadata) return markdown;

  const prefix = parts.bom ? BOM : "";
  const source = parts.bom ? markdown.slice(BOM.length) : markdown;
  const header = source.slice(0, source.length - parts.body.length);
  const body = parts.body;
  if (!metadata.trim()) {
    return BODY_STARTS_WITH_DELIMITER.test(body)
      ? prefix + emptyFrontMatterFor(header || body) + body
      : prefix + body;
  }

  const newline = newlineOf(header || body);
  // Keep how the old closing "---" ended (a file may end right after it).
  const closingEnd = parts.hasFrontMatter ? (header.match(/---(\r?\n)?$/)?.[1] ?? "") : newline;
  const lines = metadata.replace(/\r\n/g, "\n").replace(/\n/g, newline);
  return `${prefix}${FRONTMATTER_DELIMITER}${newline}${lines}${newline}${FRONTMATTER_DELIMITER}${closingEnd}${body}`;
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

// A top-level YAML key: starts at column 0, is not a comment, list item or document
// marker, and is followed by ":" and a space or the end of the line.
const TOP_LEVEL_KEY = /^(?:"[^"]*"|'[^']*'|[^\s#\-?:'"][^:]*?|-[^\s:][^:]*?)\s*:(?:\s|$)/;

/**
 * Number of top-level properties. List items, nested keys and the lines of a
 * multi-line value are indented under their key and are not counted.
 */
export function countFrontMatterProperties(metadata: string): number {
  let count = 0;
  for (const line of metadata.split(/\r?\n/)) {
    if (TOP_LEVEL_KEY.test(line)) count += 1;
  }
  return count;
}

export function appendFrontMatterProperty(metadata: string): string {
  const nextProperty = "新規プロパティ: ";
  return metadata.trimEnd() ? `${metadata.trimEnd()}\n${nextProperty}` : nextProperty;
}
