// A manuscript's synopsis (BINDER 3.5 / 3.5b): the `synopsis` property of its
// front matter. Reading and writing go through the properties model, so only
// the synopsis line changes; the body and every other property stay byte for
// byte. Loads the YAML parser, so callers import this lazily.
import { addProperty, readProperties, setPropertyValue } from "../properties/propertyModel";
import { SYNOPSIS_KEY } from "../properties/propertyLabels";
import { parseFrontMatter, replaceFrontMatter } from "../utils/frontmatter";

export type SynopsisState =
  /** No synopsis key (also: no front matter). */
  | { kind: "none" }
  /** A synopsis the card can edit; "" when the key is there but empty. */
  | { kind: "text"; text: string }
  /** A value the form cannot edit (multi-line block, list, comment…): shown, not edited. */
  | { kind: "readonly"; text: string }
  /** The front matter is not valid YAML: nothing is written. */
  | { kind: "error" };

export function readSynopsis(markdown: string): SynopsisState {
  const parts = parseFrontMatter(markdown);
  if (!parts.hasFrontMatter) return { kind: "none" };
  const sheet = readProperties(parts.metadata);
  if (sheet.errors.length > 0) return { kind: "error" };
  const row = sheet.rows.find((candidate) => candidate.key === SYNOPSIS_KEY);
  if (!row) return { kind: "none" };
  const editable = !row.readOnly && !Array.isArray(row.value) && typeof row.value !== "boolean";
  if (editable) return { kind: "text", text: row.value === null ? "" : String(row.value) };
  return { kind: "readonly", text: rawSynopsisText(row.raw) };
}

/** The value part of a property's lines, for showing a value the card cannot edit. */
function rawSynopsisText(raw: string): string {
  return raw
    .replace(/^[^:]*:\s*[|>]?[-+]?\s*/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * The file text with `text` as its synopsis. Without a synopsis key, an empty
 * text leaves the file as it is; with one, an empty text keeps an empty
 * `synopsis:` (decided at 確認1, 2026-11-12). Line breaks are dropped, like the
 * properties form does for text. Throws when the synopsis cannot be written.
 */
export function writeSynopsis(markdown: string, text: string): string {
  const value = text.replace(/\r?\n/g, "");
  const state = readSynopsis(markdown);
  if (state.kind === "error") throw new Error("YAMLにエラーがあるため、概要を書き込めません");
  if (state.kind === "readonly") throw new Error("この概要はプロパティ欄のYAMLで編集してください");
  if (state.kind === "none") {
    if (value === "") return markdown;
    const { metadata } = parseFrontMatter(markdown);
    return replaceFrontMatter(markdown, addProperty(metadata, SYNOPSIS_KEY, "text", value));
  }
  if (state.text === value) return markdown;
  const { metadata } = parseFrontMatter(markdown);
  return replaceFrontMatter(markdown, setPropertyValue(metadata, SYNOPSIS_KEY, "text", value === "" ? null : value));
}
