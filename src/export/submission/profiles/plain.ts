import type { InlineMarkup } from "../../../editor/ast/types";

export function serializePlainMarkup(markup: InlineMarkup): string {
  return markup.type === "layoutAlign" || markup.type === "aozoraAnnotation" ? "" : markup.contentText;
}
