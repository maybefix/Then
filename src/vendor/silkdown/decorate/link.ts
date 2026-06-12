import { Decoration, EditorView } from "@codemirror/view";
import type { EditorSelection, Range, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { selectionTouchesLineRange } from "../util/selection.js";
import { children } from "../util/tree.js";
import { HIDE, MUTED_MARK, pushAtomicRange, pushRevealableMark } from "./shared.js";
import { defaultUrlPolicy, type UrlPolicy } from "../url.js";
import { ImageWidget } from "../widgets/image.js";

type LinkReferenceMap = ReadonlyMap<string, string>;

interface LinkParts {
  marks: SyntaxNode[];
  urlNode: SyntaxNode | null;
  labelNode: SyntaxNode | null;
  textFrom: number;
  textTo: number;
  url: string;
}

const LABEL_WHITESPACE_RE = /\s+/g;

/**
 * Walk the doc once for `LinkReference` definitions and return a label → URL
 * map. Labels are normalized (trimmed + lowercased) per CommonMark.
 */
export function buildLinkReferences(tree: Tree, doc: Text): LinkReferenceMap {
  const refs = new Map<string, string>();
  tree.iterate({
    enter(node) {
      if (node.name !== "LinkReference") return;
      let label: string | null = null;
      let url: string | null = null;
      for (const child of children(node.node)) {
        if (child.name === "LinkLabel") label = labelKey(doc, child);
        else if (child.name === "URL") url = doc.sliceString(child.from, child.to);
      }
      if (label && url) refs.set(label, url);
    },
  });
  return refs;
}

function labelKey(doc: Text, labelNode: SyntaxNode): string {
  // LinkLabel spans `[label]` including brackets. Strip them.
  return normalizeReferenceLabel(doc.sliceString(labelNode.from + 1, labelNode.to - 1));
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(LABEL_WHITESPACE_RE, " ").toLowerCase();
}

function parseLink(node: SyntaxNode, doc: Text, references: LinkReferenceMap): LinkParts | null {
  const marks: SyntaxNode[] = [];
  let urlNode: SyntaxNode | null = null;
  let labelNode: SyntaxNode | null = null;
  let bangMark: SyntaxNode | null = null;

  for (const child of children(node)) {
    if (child.name === "LinkMark") {
      const literal = doc.sliceString(child.from, child.to);
      if (literal === "!") bangMark = child;
      else marks.push(child);
    } else if (child.name === "URL") {
      urlNode = child;
    } else if (child.name === "LinkLabel") {
      labelNode = child;
    }
  }

  const open = marks[0];
  const close = marks[1];
  if (!open || !close) return null;

  const textFrom = open.to;
  const textTo = close.from;

  let url = "";
  if (urlNode) {
    url = doc.sliceString(urlNode.from, urlNode.to);
  } else if (labelNode) {
    // Full reference: `[text][label]`. Resolve via the references map.
    url = references.get(labelKey(doc, labelNode)) ?? "";
  } else {
    // Shortcut reference: `[label]` where the brackets contain the label.
    const key = normalizeReferenceLabel(doc.sliceString(textFrom, textTo));
    url = references.get(key) ?? "";
  }

  const allMarks = bangMark ? [bangMark, ...marks] : marks;
  return { marks: allMarks, urlNode, labelNode, textFrom, textTo, url };
}

function muteLinkSyntax(ranges: Range<Decoration>[], parts: LinkParts): void {
  for (const m of parts.marks) {
    ranges.push(MUTED_MARK.range(m.from, m.to));
  }
  if (parts.urlNode) {
    ranges.push(MUTED_MARK.range(parts.urlNode.from, parts.urlNode.to));
  }
  if (parts.labelNode) {
    ranges.push(MUTED_MARK.range(parts.labelNode.from, parts.labelNode.to));
  }
}

export function decorateLink(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
  references: LinkReferenceMap,
  urlPolicy: UrlPolicy = defaultUrlPolicy,
): void {
  const parts = parseLink(node, doc, references);
  if (!parts) return;

  const safe = urlPolicy(parts.url);
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);

  if (revealed) {
    muteLinkSyntax(ranges, parts);
    if (safe && parts.textFrom < parts.textTo) {
      ranges.push(linkMark(safe).range(parts.textFrom, parts.textTo));
    }
    return;
  }

  if (parts.textFrom > node.from) {
    pushAtomicRange(ranges, atomicRanges, HIDE, node.from, parts.textFrom);
  }
  if (safe && parts.textFrom < parts.textTo) {
    ranges.push(linkMark(safe).range(parts.textFrom, parts.textTo));
  }
  if (parts.textTo < node.to) {
    pushAtomicRange(ranges, atomicRanges, HIDE, parts.textTo, node.to);
  }
}

export function decorateImage(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
  references: LinkReferenceMap,
  urlPolicy: UrlPolicy = defaultUrlPolicy,
): void {
  const parts = parseLink(node, doc, references);
  if (!parts) return;

  const alt = doc.sliceString(parts.textFrom, parts.textTo);
  const safe = urlPolicy(parts.url);
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);

  if (revealed) {
    muteLinkSyntax(ranges, parts);
    return;
  }

  if (!safe) return;
  pushAtomicRange(
    ranges,
    atomicRanges,
    Decoration.replace({ widget: new ImageWidget(safe, alt) }),
    node.from,
    node.to,
  );
}

/**
 * Angle-bracketed autolink (`<https://example.com>`) and bare URLs that Lezer
 * detects in plain prose. Both are made clickable; for `Autolink` the angle
 * brackets hide off-line and mute on-line.
 */
export function decorateAutolink(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
  urlPolicy: UrlPolicy = defaultUrlPolicy,
): void {
  let urlNode: SyntaxNode | null = null;
  const marks: SyntaxNode[] = [];
  for (const child of children(node)) {
    if (child.name === "URL") urlNode = child;
    else if (child.name === "LinkMark") marks.push(child);
  }
  if (!urlNode) return;

  const url = doc.sliceString(urlNode.from, urlNode.to);
  const safe = urlPolicy(url);
  if (!safe) return;

  ranges.push(linkMark(safe).range(urlNode.from, urlNode.to));

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  for (const m of marks) {
    pushRevealableMark(ranges, atomicRanges, revealed, m.from, m.to);
  }
}

/** A bare URL (Lezer's GFM extended-autolink) parsed as a top-level `URL` node. */
export function decorateBareUrl(
  ranges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  urlPolicy: UrlPolicy = defaultUrlPolicy,
): void {
  const url = doc.sliceString(node.from, node.to);
  const safe = urlPolicy(url);
  if (!safe) return;
  ranges.push(linkMark(safe).range(node.from, node.to));
}

/**
 * `[label]: url` definition lines. Hidden entirely when cursor is off the
 * line (they're auxiliary metadata, not part of the rendered document).
 */
export function decorateLinkReference(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  if (selectionTouchesLineRange(doc, sel, node.from, node.to)) return;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);
  if (startLine.from === endLine.from) {
    pushAtomicRange(ranges, atomicRanges, HIDE, startLine.from, endLine.to);
  } else {
    // Hide only the reference node so adjacent content on boundary lines stays visible.
    pushAtomicRange(ranges, atomicRanges, HIDE, node.from, node.to);
  }
}

function linkMark(href: string) {
  return Decoration.mark({
    class: "sd-link",
    attributes: { "data-href": href },
  });
}

function closestHrefElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest("[data-href]") : null;
}

/** Modifier-click opens the URL; plain click stays as cursor positioning so users can edit the link text. */
export const linkClickHandler = EditorView.domEventHandlers({
  click(event) {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const link = closestHrefElement(event.target);
    if (!link) return false;
    const href = link.getAttribute("data-href");
    if (!href) return false;
    window.open(href, "_blank", "noopener,noreferrer");
    event.preventDefault();
    return true;
  },
});
