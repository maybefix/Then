import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { decorateInline } from "./decorate/inline.js";
import { decorateHeading, decorateSetextHeading } from "./decorate/heading.js";
import { decorateBlockquote } from "./decorate/blockquote.js";
import { decorateListItem } from "./decorate/list.js";
import { decorateTable } from "./decorate/table.js";
import {
  buildLinkReferences,
  decorateAutolink,
  decorateBareUrl,
  decorateImage,
  decorateLink,
  decorateLinkReference,
} from "./decorate/link.js";
import { decorateHardBreak, decorateHorizontalRule, decorateHtmlBlock } from "./decorate/block.js";
import { decorateFencedCode } from "./decorate/fence.js";
import type { UrlPolicy } from "./url.js";

export interface SilkdownPluginOptions {
  /** Disable rendering for these node names. Useful for debugging or opt-out. */
  disable?: readonly string[];
  /**
   * URL allowlist applied to link `href` and image `src`. Defaults to
   * `defaultUrlPolicy` (http, https, data:image/\*, relative).
   */
  urlPolicy?: UrlPolicy;
}

const INLINE_NODES = new Set(["Emphasis", "StrongEmphasis", "InlineCode", "Strikethrough"]);

const HEADING_NODES = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
]);

const SETEXT_HEADING_NODES = new Set(["SetextHeading1", "SetextHeading2"]);

export function silkdownPlugin(opts: SilkdownPluginOptions = {}): Extension {
  const disabled = new Set(opts.disable ?? []);
  const urlPolicy = opts.urlPolicy;

  interface BuildOutput {
    decorations: DecorationSet;
    atomicDecorations: DecorationSet;
  }

  return ViewPlugin.fromClass(
    class implements PluginValue {
      decorations: DecorationSet;
      atomicDecorations: DecorationSet;
      composing: boolean;

      constructor(view: EditorView) {
        this.composing = view.composing;
        const built = this.build(view);
        this.decorations = built.decorations;
        this.atomicDecorations = built.atomicDecorations;
      }

      update(u: ViewUpdate) {
        const composingChanged = u.view.composing !== this.composing;
        this.composing = u.view.composing;

        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          composingChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          const built = this.build(u.view);
          this.decorations = built.decorations;
          this.atomicDecorations = built.atomicDecorations;
        }
      }

      build(view: EditorView): BuildOutput {
        const ranges: Range<Decoration>[] = [];
        const atomicRanges: Range<Decoration>[] = [];
        const tree = syntaxTree(view.state);
        const sel = view.state.selection;
        const doc = view.state.doc;
        const references = buildLinkReferences(tree, doc);

        for (const { from, to } of view.visibleRanges) {
          tree.iterate({
            from,
            to,
            enter: (n) => {
              if (disabled.has(n.name)) return false;

              if (HEADING_NODES.has(n.name)) {
                decorateHeading(ranges, atomicRanges, n.node, doc, sel);
                return false;
              }

              if (SETEXT_HEADING_NODES.has(n.name)) {
                decorateSetextHeading(ranges, atomicRanges, n.node, doc, sel);
                return false;
              }

              if (INLINE_NODES.has(n.name)) {
                decorateInline(ranges, atomicRanges, n.node, doc, sel);
                // Descend so combined marks (e.g. *** = Emphasis > StrongEmphasis)
                // get nested decoration from each level.
              }

              if (n.name === "Blockquote") {
                decorateBlockquote(ranges, atomicRanges, n.node, doc, sel);
              }

              if (n.name === "ListItem") {
                decorateListItem(ranges, atomicRanges, n.node, doc, sel, view.composing);
              }

              if (n.name === "Table") {
                if (decorateTable(ranges, atomicRanges, n.node, doc, sel)) return false;
              }

              if (n.name === "Link") {
                decorateLink(ranges, atomicRanges, n.node, doc, sel, references, urlPolicy);
                return false;
              }

              if (n.name === "Image") {
                decorateImage(ranges, atomicRanges, n.node, doc, sel, references, urlPolicy);
                return false;
              }

              if (n.name === "Autolink") {
                decorateAutolink(ranges, atomicRanges, n.node, doc, sel, urlPolicy);
                return false;
              }

              if (n.name === "URL") {
                // Reaching a URL node here means it's a bare GFM autolink in
                // prose. URLs inside Link/Image/Autolink/LinkReference never
                // arrive because those parents return false.
                decorateBareUrl(ranges, n.node, doc, urlPolicy);
                return false;
              }

              if (n.name === "LinkReference") {
                decorateLinkReference(ranges, atomicRanges, n.node, doc, sel);
                return false;
              }

              if (n.name === "HorizontalRule") {
                decorateHorizontalRule(ranges, atomicRanges, n.node, doc, sel);
                return false;
              }

              if (n.name === "HTMLBlock") {
                decorateHtmlBlock(ranges, n.node, doc);
                return false;
              }

              if (n.name === "HardBreak") {
                decorateHardBreak(ranges, atomicRanges, n.node, doc, sel);
                return false;
              }

              if (n.name === "FencedCode") {
                decorateFencedCode(ranges, atomicRanges, n.node, doc, sel);
                // Descend so lang-markdown's highlight tags still apply.
              }
            },
          });
        }

        return {
          decorations: Decoration.set(ranges, true),
          atomicDecorations: Decoration.set(atomicRanges, true),
        };
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.atomicDecorations ?? Decoration.none),
    },
  );
}
