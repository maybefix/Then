// BINDER 3-3: a manuscript's material list, the `materials` property of its
// front matter (BINDER 3.5b, D-2). Each item is written `"[[name]]"`, as in
// Obsidian. Which text is a link is decided by the rule in linkSyntax.ts, the
// same one the link index (3-1) reads with; where a name goes is the index's
// business. Writing goes through the properties model, so only the materials
// lines change; the body and every other property stay byte for byte. Loads
// the YAML parser, so callers import this lazily (loadMaterialList.ts).
import { addProperty, readProperties, setPropertyValue } from "../properties/propertyModel";
import { findLinksInLine } from "./linkSyntax";

export const MATERIALS_KEY = "materials";

export type MaterialItem = {
  /** The item as written (the value, without YAML quotes). */
  text: string;
  /** The name it links to, when the item is exactly one `[[name]]`; else null. */
  target: string | null;
};

export type MaterialList =
  /** No materials key (also: no front matter). Adding writes a new one. */
  | { kind: "none" }
  /** A list the pane can add to and remove from. */
  | { kind: "list"; items: MaterialItem[] }
  /**
   * A value the pane cannot write without losing something (an unquoted
   * `- [[name]]`, which YAML reads as a nested list; a comment; another type).
   * Its links are shown and open, but nothing is written (確認1の決定5).
   */
  | { kind: "readonly"; items: MaterialItem[] }
  /** The front matter is not valid YAML: nothing is shown or written. */
  | { kind: "error" };

/** The link an item holds, when the item is exactly one `[[name]]` (spaces around allowed). */
export function itemTarget(text: string): string | null {
  const trimmed = text.trim();
  const links = findLinksInLine(trimmed, true);
  if (links.length !== 1) return null;
  const [link] = links;
  return link.kind === "name" && link.fullFrom === 0 && link.fullTo === trimmed.length ? link.target : null;
}

function itemOf(text: string): MaterialItem {
  return { text, target: itemTarget(text) };
}

export function readMaterials(metadata: string): MaterialList {
  if (!metadata.trim()) return { kind: "none" };
  const sheet = readProperties(metadata);
  if (sheet.errors.length > 0) return { kind: "error" };
  const row = sheet.rows.find((candidate) => candidate.key === MATERIALS_KEY);
  if (!row) return { kind: "none" };
  if (!row.readOnly) {
    if (row.value === null) return { kind: "list", items: [] };
    if (Array.isArray(row.value)) return { kind: "list", items: row.value.map(itemOf) };
    if (row.type === "text") return { kind: "list", items: [itemOf(row.value as string)] };
  }
  // Not writable: show the links its lines hold, read by the same rule as the index.
  const items = row.raw.split(/\r?\n/).flatMap((line) =>
    findLinksInLine(line, true)
      .filter((link) => link.kind === "name")
      .map((link) => ({ text: line.slice(link.fullFrom, link.fullTo), target: link.target })),
  );
  return { kind: "readonly", items };
}

function writeItems(metadata: string, list: MaterialList, texts: string[]): string {
  if (list.kind === "error") throw new Error("YAMLにエラーがあるため、素材を書き込めません");
  if (list.kind === "readonly") throw new Error("この素材はプロパティ欄のYAMLで編集してください");
  if (list.kind === "none") {
    return texts.length === 0 ? metadata : addProperty(metadata, MATERIALS_KEY, "list", texts);
  }
  // The last one removed leaves `materials: []` (確認1の決定3).
  return setPropertyValue(metadata, MATERIALS_KEY, "list", texts);
}

/**
 * `metadata` with `[[name]]` added at the end for each name not already there
 * (same name as written). Whether two names mean the same note is the caller's
 * to decide with the index. Unchanged when nothing is new.
 */
export function addMaterials(metadata: string, names: readonly string[]): string {
  const list = readMaterials(metadata);
  const items = list.kind === "list" ? list.items : [];
  const known = new Set(items.flatMap((item) => (item.target === null ? [] : [item.target])));
  const added: string[] = [];
  for (const name of names) {
    if (known.has(name)) continue;
    known.add(name);
    added.push(`[[${name}]]`);
  }
  if (added.length === 0) return metadata;
  return writeItems(metadata, list, [...items.map((item) => item.text), ...added]);
}

/** `metadata` without the item at `at`. */
export function removeMaterial(metadata: string, at: number): string {
  const list = readMaterials(metadata);
  if (list.kind !== "list" || at < 0 || at >= list.items.length) return metadata;
  return writeItems(metadata, list, list.items.filter((_, index) => index !== at).map((item) => item.text));
}

/**
 * `metadata` with the name of the link at `at` replaced by `nextTarget`
 * (3-2's 「リンクを直して開く」). `|shown` and `#heading` stay.
 */
export function renameMaterial(metadata: string, at: number, nextTarget: string): string {
  const list = readMaterials(metadata);
  if (list.kind !== "list") return metadata;
  const item = list.items[at];
  if (!item || item.target === null || item.target === nextTarget) return metadata;
  const [link] = findLinksInLine(item.text, true).filter((candidate) => candidate.kind === "name");
  const text = `${item.text.slice(0, link.from)}${nextTarget}${item.text.slice(link.to)}`;
  return writeItems(metadata, list, list.items.map((current, index) => (index === at ? text : current.text)));
}
