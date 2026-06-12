import { Decoration } from "@codemirror/view";
import type { EditorSelection, Range, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { InlineNodeName } from "../types.js";
import { selectionTouchesLineRange } from "../util/selection.js";
import { children } from "../util/tree.js";
import { pushRevealableMark } from "./shared.js";

const STRONG_MARK = Decoration.mark({ class: "sd-strong" });
const EM_MARK = Decoration.mark({ class: "sd-em" });
const CODE_MARK = Decoration.mark({ class: "sd-code" });
const STRIKE_MARK = Decoration.mark({ class: "sd-strike" });

const STYLES: Record<InlineNodeName, Decoration> = {
  StrongEmphasis: STRONG_MARK,
  Emphasis: EM_MARK,
  InlineCode: CODE_MARK,
  Strikethrough: STRIKE_MARK,
};

function isInlineNodeName(name: string): name is InlineNodeName {
  return name in STYLES;
}

const MARKER_NODES = new Set(["EmphasisMark", "CodeMark", "StrikethroughMark"]);

export function decorateInline(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  // Type narrow only — plugin.ts gates by INLINE_NODES so this is unreachable at runtime.
  /* v8 ignore next */
  if (!isInlineNodeName(node.name)) return;
  const styling = STYLES[node.name];

  ranges.push(styling.range(node.from, node.to));

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  if (!revealed) {
    atomicRanges.push(styling.range(node.from, node.to));
  }
  for (const child of children(node)) {
    if (!MARKER_NODES.has(child.name)) continue;
    pushRevealableMark(ranges, atomicRanges, revealed, child.from, child.to);
  }
}
