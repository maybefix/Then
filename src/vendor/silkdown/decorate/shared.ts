import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";

/**
 * Shared empty `Decoration.replace` used by every decorator that hides a range
 * (markers, leading `# `, etc.). Module-level identity matters — keep this
 * a single instance so equal ranges compare equal in the RangeSet.
 */
export const HIDE = Decoration.replace({});

/**
 * Applied to revealed markdown markers (`**`, `*`, `~~`, `` ` ``, `# `, `> `)
 * when the cursor is on the line so they show but recede visually. Typora-
 * style: marker is dimmed and stripped of inherited bold/italic.
 */
export const MUTED_MARK = Decoration.mark({ class: "sd-mark" });

export function pushAtomicRange(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  decoration: Decoration,
  from: number,
  to: number,
): void {
  ranges.push(decoration.range(from, to));
  atomicRanges.push(decoration.range(from, to));
}

export function pushRevealableMark(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  revealed: boolean,
  from: number,
  to: number,
): void {
  if (revealed) {
    ranges.push(MUTED_MARK.range(from, to));
  } else {
    pushAtomicRange(ranges, atomicRanges, HIDE, from, to);
  }
}
