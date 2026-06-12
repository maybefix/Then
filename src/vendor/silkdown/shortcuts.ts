import { keymap, type KeyBinding } from "@codemirror/view";
import { EditorSelection, Prec, type EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import type { ToggleInlineNodeName } from "./types.js";

type ToggleMarker = "**" | "*" | "`";

function findAncestor(
  state: EditorState,
  pos: number,
  name: ToggleInlineNodeName,
): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0);
  while (node) {
    if (node.name === name) return node;
    node = node.parent;
  }
  return null;
}

/**
 * Toggle markdown inline wrapping (bold/italic/code).
 *
 * Behavior, in order:
 *  1. Cursor or selection inside an enclosing node of `nodeName` → unwrap.
 *  2. Selection present → wrap the selection.
 *  3. No selection, cursor on a word → expand to the word and wrap.
 *  4. No selection, no word at cursor → insert paired markers and place the
 *     cursor between them so the user can start typing.
 *
 * The dispatched transaction has no `userEvent` so it forms its own undo step
 * and does not coalesce with later typing.
 */
function toggleInline(nodeName: ToggleInlineNodeName, marker: ToggleMarker): KeyBinding["run"] {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    const len = marker.length;

    const tr = state.changeByRange((range) => {
      const enclosing = findAncestor(state, range.from, nodeName);
      const stillInside = enclosing && range.to >= enclosing.from && range.to <= enclosing.to;

      if (stillInside && enclosing.firstChild && enclosing.lastChild) {
        const open = enclosing.firstChild;
        const close = enclosing.lastChild;
        const openLen = open.to - open.from;
        const closeLen = close.to - close.from;

        const shift = (pos: number) => {
          let p = pos;
          if (p > open.from) p -= Math.min(openLen, p - open.from);
          if (p > close.from - openLen) p -= Math.min(closeLen, p - (close.from - openLen));
          return p;
        };

        return {
          changes: [
            { from: open.from, to: open.to, insert: "" },
            { from: close.from, to: close.to, insert: "" },
          ],
          range: EditorSelection.range(shift(range.from), shift(range.to)),
        };
      }

      let from = range.from;
      let to = range.to;
      if (from === to) {
        const word = state.wordAt(from);
        if (word) {
          from = word.from;
          to = word.to;
        }
      }

      const newSelection =
        from === to
          ? EditorSelection.cursor(from + len)
          : EditorSelection.range(from + len, to + len);

      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: newSelection,
      };
    });

    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "format.silkdown" }));
    return true;
  };
}

// Prec.high so basicSetup's keymap (which binds Mod-i et al.) doesn't shadow these.
export const markdownKeymap = Prec.high(
  keymap.of([
    { key: "Enter", run: insertNewlineContinueMarkup },
    { key: "Mod-b", run: toggleInline("StrongEmphasis", "**") },
    { key: "Mod-i", run: toggleInline("Emphasis", "*") },
    { key: "Mod-`", run: toggleInline("InlineCode", "`") },
  ]),
);
