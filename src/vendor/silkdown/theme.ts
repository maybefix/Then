import { EditorView } from "@codemirror/view";

/**
 * Minimal CM6-side theme for hidden marks and inline styles. Typography rules
 * (heading sizes, link colors, blockquote bars) live in `theme.css` so consumers
 * can swap them without losing the structural styles defined here.
 */
export const baseTheme = EditorView.baseTheme({
  ".sd-strong": { fontWeight: "700" },
  ".sd-em": { fontStyle: "italic" },
  ".sd-strike": { textDecoration: "line-through" },
  ".sd-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: "0.95em",
    backgroundColor: "var(--silkdown-code-bg, rgba(135, 131, 120, 0.15))",
    padding: "0.1em 0.3em",
    borderRadius: "3px",
  },
});
