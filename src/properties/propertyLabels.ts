// Keys and the names the screen shows for them (BINDER 3.5b). The front matter
// keeps the English key; only the screen says 「概要」. Shared by the properties
// pane, the inspector and the corkboard. Kept apart from propertyModel so the
// main bundle can use it without loading the YAML parser.
import type { PropertyType } from "./propertyModel";

export type PropertyLabel = { label: string; type: PropertyType };

export const PROPERTY_LABELS: Readonly<Record<string, PropertyLabel>> = Object.freeze({
  synopsis: { label: "概要", type: "text" },
  materials: { label: "素材", type: "list" },
  sourceCards: { label: "元のカード", type: "list" },
});

/** The key of a manuscript's synopsis. */
export const SYNOPSIS_KEY = "synopsis";

/** The name the screen shows for a key, or null when the key is shown as written. */
export function propertyLabel(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(PROPERTY_LABELS, key) ? PROPERTY_LABELS[key].label : null;
}

/** The key whose shown name is exactly `label`, or null. */
export function keyOfLabel(label: string): string | null {
  return Object.entries(PROPERTY_LABELS).find(([, entry]) => entry.label === label)?.[0] ?? null;
}

/** The type the app writes a labelled key with, or null for other keys. */
export function labelledPropertyType(key: string): PropertyType | null {
  return Object.prototype.hasOwnProperty.call(PROPERTY_LABELS, key) ? PROPERTY_LABELS[key].type : null;
}
