import { createVisualLineBands, type VisualBlockRect, type VisualLineBand, type VisualRect, type VisualWritingMode } from "./visualLineLayout";

type Entry<Key> = {
  key: Key;
  version: number;
  revision: number;
  mode: VisualWritingMode;
  width: number;
  height: number;
  unnumbered: boolean;
  bands: VisualLineBand[];
  bounds: VisualRect;
  count: number;
};

/** Paragraph-local measured line shapes and a prefix sum of numbered lines.
 * Moving a paragraph or changing an earlier line count never rebuilds its shapes.
 * Browser geometry, not estimated font metrics, determines every shape. */
export class VisualLineIndex<Key> {
  private entries: Array<Entry<Key> | null> = [];
  private keys: readonly Key[] = [];
  private counts: number[] = [0];

  reset(keys: readonly Key[]): void {
    const previous = new Map<Key, Entry<Key>>();
    for (const entry of this.entries) if (entry) previous.set(entry.key, entry);
    this.keys = keys;
    this.entries = keys.map(key => previous.get(key) ?? null);
    this.counts = new Array(keys.length + 1).fill(0);
    // Linear Fenwick construction; structural changes do not regroup old lines.
    for (let i = 1; i < this.counts.length; i += 1) {
      this.counts[i] += this.entries[i - 1]?.count ?? 0;
      const parent = i + (i & -i);
      if (parent < this.counts.length) this.counts[parent] += this.counts[i];
    }
  }

  /** True when the paragraph's cached shapes are still valid without reading its rect. */
  isCurrent(index: number, version: number, revision: number, mode: VisualWritingMode, unnumbered: boolean): boolean {
    const entry = this.entries[index];
    return Boolean(entry && entry.version === version && entry.revision === revision &&
      entry.mode === mode && entry.unnumbered === unnumbered);
  }

  measure(
    index: number,
    block: VisualRect,
    version: number,
    revision: number,
    mode: VisualWritingMode,
    unnumbered: boolean,
    readFragments: () => readonly VisualRect[],
  ): boolean {
    const width = block.right - block.left;
    const height = block.bottom - block.top;
    const previous = this.entries[index];
    if (previous && previous.version === version && previous.revision === revision &&
      previous.mode === mode && previous.width === width && previous.height === height &&
      previous.unnumbered === unnumbered) return false;

    const local: VisualBlockRect = {
      left: 0, top: 0, right: width, bottom: height, unnumbered,
      fragments: readFragments().map(rect => ({
        left: rect.left - block.left, right: rect.right - block.left,
        top: rect.top - block.top, bottom: rect.bottom - block.top,
      })),
    };
    const bands = createVisualLineBands([local], mode);
    const bounds: VisualRect = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const band of bands) {
      bounds.left = Math.min(bounds.left, band.left);
      bounds.right = Math.max(bounds.right, band.right);
      bounds.top = Math.min(bounds.top, band.top);
      bounds.bottom = Math.max(bounds.bottom, band.bottom);
    }
    const count = unnumbered ? 0 : bands.length;
    this.entries[index] = {
      key: this.keys[index], version, revision, mode, width, height, unnumbered, bands, bounds, count,
    };
    const delta = count - (previous?.count ?? 0);
    if (delta) for (let i = index + 1; i < this.counts.length; i += i & -i) this.counts[i] += delta;
    return true;
  }

  /**
   * Records a line count measured elsewhere (a hidden copy of the paragraph
   * laid out as it would be with its decorations) instead of the paragraph's
   * own DOM. No line shapes are kept, so the paragraph draws no bands; it is
   * only counted. Used for undecorated paragraphs outside the viewport.
   */
  assignCount(index: number, count: number, version: number, revision: number, mode: VisualWritingMode, unnumbered: boolean): void {
    const previous = this.entries[index];
    const next = unnumbered ? 0 : count;
    this.entries[index] = {
      key: this.keys[index], version, revision, mode, width: -1, height: -1, unnumbered, bands: [],
      bounds: { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }, count: next,
    };
    const delta = next - (previous?.count ?? 0);
    if (delta) for (let i = index + 1; i < this.counts.length; i += i & -i) this.counts[i] += delta;
  }

  /** The paragraph's counted lines, or null before it is measured. */
  countAt(index: number): number | null {
    return this.entries[index]?.count ?? null;
  }

  /**
   * Replaces the paragraph's counted lines while keeping its measured shapes
   * (e.g. the caret's paragraph, drawn as it is but counted as it will be).
   */
  setCount(index: number, count: number): void {
    const entry = this.entries[index];
    if (!entry) return;
    const next = entry.unnumbered ? 0 : count;
    const delta = next - entry.count;
    if (!delta) return;
    entry.count = next;
    for (let i = index + 1; i < this.counts.length; i += i & -i) this.counts[i] += delta;
  }

  private firstNumber(index: number): number {
    let count = 1;
    for (let i = index; i > 0; i -= i & -i) count += this.counts[i];
    return count;
  }

  /** Numbered lines across every paragraph (prefix sum of the whole index). */
  totalCount(): number {
    return this.firstNumber(this.keys.length) - 1;
  }

  /** Uses the union of actual line bands, including overflow outside the block. */
  intersects(index: number, block: VisualRect, viewport: VisualRect): boolean {
    const entry = this.entries[index];
    if (!entry || !entry.bands.length) return false;
    const bounds = entry.bounds;
    return bounds.right + block.left >= viewport.left && bounds.left + block.left <= viewport.right &&
      bounds.bottom + block.top >= viewport.top && bounds.top + block.top <= viewport.bottom;
  }

  bandsAt(index: number, block: VisualRect): VisualLineBand[] {
    const entry = this.entries[index];
    if (!entry) return [];
    const first = this.firstNumber(index);
    return entry.bands.map(band => ({
      ...band, blockIndex: index, number: entry.unnumbered ? 0 : first + band.lineIndex,
      left: band.left + block.left, right: band.right + block.left,
      top: band.top + block.top, bottom: band.bottom + block.top,
      centerX: band.centerX + block.left, centerY: band.centerY + block.top,
    }));
  }
}
