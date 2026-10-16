// Sets of properties that can be added to a manuscript (FM-27): the front matter
// of a template, or a built-in set. Kept apart from propertyModel so the main
// bundle can name the sets without loading the YAML parser.
import type { PropertyTypeSettings } from "./propertyModel";

export type PropertySet = {
  id: string;
  name: string;
  /** Front matter text (without the --- lines). */
  metadata: string;
  /** Types the set means its properties to have, e.g. date for an empty "date:". */
  types?: PropertyTypeSettings;
};

/** FM-25: properties an article on the personal site needs. */
export const ARTICLE_PROPERTY_SET: PropertySet = {
  id: "builtin:article",
  name: "記事",
  metadata: ["slug:", "date:", "publish: false", "tags: []", "description:"].join("\n"),
  types: { slug: "text", date: "date", publish: "checkbox", tags: "list", description: "text" },
};
