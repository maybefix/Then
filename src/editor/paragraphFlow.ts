import type { ParagraphGeometry } from "./pageBreaks";
import type { VisualRect } from "./visualLineLayout";
import type { WritingMode } from "../types";

type Entry = {
  size: number; inlineSize: number; inlineStart: number; hidden: boolean;
  linePitch: number; gapBefore: number; version: number;
};
export type ParagraphFlowSnapshot = {
  elements: Element[]; blocks: VisualRect[]; paragraphs: ParagraphGeometry[];
  versions: number[]; root: DOMRect; generation: number; reads: number;
};

/** QA-only shared measurements. Border-box sizes, never estimated line pitches,
 * determine positions. Drain mutations synchronously before consuming geometry;
 * ResizeObserver is a supplement rather than the invalidation authority. */
export class ParagraphFlow {
  private elements: Element[] = [];
  private entries = new Map<Element, Entry>();
  private dirty = new Set<Element>();
  private structureDirty = true;
  private signature = "";
  private generation = 0;
  private version = 0;
  private localBlocks: VisualRect[] = [];
  private paragraphs: ParagraphGeometry[] = [];
  private versions: number[] = [];
  private mutation: MutationObserver;
  private resize: ResizeObserver;
  private styles: MutationObserver;
  readonly stats = { flushes: 0, paragraphReads: 0, globalResets: 0, structures: 0 };

  constructor(private root: HTMLElement, private changed: () => void) {
    this.mutation = new MutationObserver(records => { if (this.collect(records)) changed(); });
    this.mutation.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    this.resize = new ResizeObserver(records => {
      let dirty = false;
      for (const record of records) {
        const entry = this.entries.get(record.target), size = record.borderBoxSize[0];
        if (!entry || !size || Math.abs(entry.size - size.blockSize) > 1e-7 || Math.abs(entry.inlineSize - size.inlineSize) > 1e-7) {
          this.dirty.add(record.target); dirty = true;
        }
      }
      if (dirty) changed();
    });
    // Stylesheet text/links can change internal glyph positions without changing
    // any paragraph box. App settings and CSSOM callers also call invalidate().
    this.styles = new MutationObserver(() => { this.invalidate(); changed(); });
    this.styles.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true });
  }

  private collect(records: MutationRecord[]): boolean {
    let changed = false;
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element &&
        record.target.getAttribute(record.attributeName!) === record.oldValue) continue;
      if (record.target === this.root) {
        if (record.type === "childList") { this.structureDirty = true; changed = true; }
        // Page positioning writes style on the root. Check effective typesetting
        // in flush(), so translation alone never invalidates paragraph shapes.
        if (record.type === "attributes" && record.attributeName === "class") { this.invalidate(); changed = true; }
      } else {
        let el = record.target instanceof Element ? record.target : record.target.parentElement;
        while (el && el.parentElement !== this.root) el = el.parentElement;
        if (el) { this.dirty.add(el); changed = true; }
      }
    }
    return changed;
  }

  mark(element: Element): void { this.dirty.add(element); }
  invalidate(): void { this.signature = ""; }

  flush(mode: WritingMode): ParagraphFlowSnapshot {
    this.stats.flushes++;
    this.collect(this.mutation.takeRecords());
    if (this.styles.takeRecords().length) this.invalidate();
    const root = this.root.getBoundingClientRect(), style = getComputedStyle(this.root);
    const vertical = mode === "vertical-rl";
    const signature = JSON.stringify([
      mode, vertical ? root.height : root.width, style.fontFamily, style.fontSize,
      style.fontWeight, style.fontStyle, style.lineHeight, style.letterSpacing,
      style.wordSpacing, style.textIndent, style.whiteSpace, style.direction,
      style.paddingTop, style.paddingRight, style.borderTopWidth, style.borderRightWidth,
      this.root.closest(".verticalTypewriterShell")?.getAttribute("data-editor-display"),
      ...["--editor-measure-v-ratio", "--editor-measure-h-ratio", "--editor-heading-font-family", "--editor-code-font-family"].map(p => style.getPropertyValue(p)),
    ]);
    let rebuild = false;
    if (signature !== this.signature) {
      this.signature = signature; this.stats.globalResets++; rebuild = true;
      for (const el of this.elements) this.dirty.add(el);
    }
    if (this.structureDirty) {
      const next = Array.from(this.root.children), keep = new Set(next);
      for (const el of this.elements) if (!keep.has(el)) {
        this.resize.unobserve(el); this.entries.delete(el); this.dirty.delete(el);
      }
      for (const el of next) if (!this.entries.has(el)) { this.dirty.add(el); this.resize.observe(el, { box: "border-box" }); }
      this.elements = next; this.structureDirty = false; this.stats.structures++; rebuild = true;
    }
    let reads = 0;
    for (const el of this.dirty) {
      if (el.parentElement !== this.root) continue;
      const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
      const gapBefore = Number.parseFloat(vertical ? css.marginRight : css.marginTop) || 0;
      const gapAfter = Number.parseFloat(vertical ? css.marginLeft : css.marginBottom) || 0;
      // Fail explicitly in QA if the proven flow contract stops applying.
      if (gapBefore || gapAfter || css.cssFloat !== "none" || css.transform !== "none" || !["static", "relative"].includes(css.position)) {
        throw new Error("QA paragraph flow: unsupported paragraph positioning");
      }
      this.entries.set(el, {
        size: vertical ? rect.width : rect.height, inlineSize: vertical ? rect.height : rect.width,
        inlineStart: vertical ? rect.top - root.top : rect.left - root.left,
        hidden: css.display === "none", linePitch: Number.parseFloat(css.lineHeight),
        gapBefore, version: ++this.version,
      });
      reads++; this.stats.paragraphReads++; rebuild = true;
    }
    this.dirty.clear();
    if (rebuild) {
      let offset = (Number.parseFloat(vertical ? style.paddingRight : style.paddingTop) || 0) +
        (Number.parseFloat(vertical ? style.borderRightWidth : style.borderTopWidth) || 0);
      this.paragraphs = []; this.versions = [];
      this.localBlocks = this.elements.map(el => {
        const entry = this.entries.get(el)!;
        const blockStart = offset;
        const left = vertical ? -offset - entry.size : entry.inlineStart;
        const top = vertical ? entry.inlineStart : offset;
        const rect = entry.hidden ? { left: 0, right: 0, top: 0, bottom: 0 } : {
          left, top, right: left + (vertical ? entry.size : entry.inlineSize), bottom: top + (vertical ? entry.inlineSize : entry.size),
        };
        this.paragraphs.push({
          lineCount: Number.isFinite(entry.linePitch) && entry.linePitch > 0 ? Math.max(1, Math.round(entry.size / entry.linePitch)) : 0,
          linePitch: Number.isFinite(entry.linePitch) && entry.linePitch > 0 ? entry.linePitch : 0,
          gapBefore: entry.gapBefore, blockStart,
        });
        this.versions.push(entry.version);
        if (!entry.hidden) offset += entry.size;
        return rect;
      });
      this.generation++;
    }
    const blocks = this.localBlocks.map((r, i) => {
      if (this.entries.get(this.elements[i])!.hidden) return r;
      const x = vertical ? root.right : root.left;
      return { left: r.left + x, right: r.right + x, top: r.top + root.top, bottom: r.bottom + root.top };
    });
    // Match the legacy zero-box origin for hidden paragraphs without making
    // their position part of the flow. Visible zero-size rule rows still remain.
    const paragraphs = this.paragraphs.map((p, i) => this.entries.get(this.elements[i])!.hidden
      ? { ...p, blockStart: vertical ? root.right : -root.top } : p);
    return { elements: this.elements, blocks, paragraphs, versions: this.versions, root, generation: this.generation, reads };
  }

  dispose(): void { this.mutation.disconnect(); this.resize.disconnect(); this.styles.disconnect(); }
}
