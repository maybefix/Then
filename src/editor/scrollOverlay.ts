import type { VisualRect } from "./visualLineLayout";

export type ScrollOverlaySnapshot = {
  root: VisualRect;
  viewport: VisualRect;
  coverage: VisualRect;
};

/** Reuse painted labels only for a pixel-exact translation inside their coverage.
 * Typesetting/selection validity is checked by the caller. Fractional movement,
 * resizes and movement beyond the prepared labels use the normal renderer. */
export function scrollOverlayTranslation(
  snapshot: ScrollOverlaySnapshot,
  root: VisualRect,
  viewport: VisualRect,
  pixelRatio: number,
): { x: number; y: number } | null {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  if (!same(root.right - root.left, snapshot.root.right - snapshot.root.left) ||
    !same(root.bottom - root.top, snapshot.root.bottom - snapshot.root.top) ||
    !same(viewport.left, snapshot.viewport.left) || !same(viewport.right, snapshot.viewport.right) ||
    !same(viewport.top, snapshot.viewport.top) || !same(viewport.bottom, snapshot.viewport.bottom)) return null;
  const x = root.left - snapshot.root.left;
  const y = root.top - snapshot.root.top;
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  if (!same(x * ratio, Math.round(x * ratio)) || !same(y * ratio, Math.round(y * ratio))) return null;
  const coverage = snapshot.coverage;
  if (viewport.left - x < coverage.left || viewport.right - x > coverage.right ||
    viewport.top - y < coverage.top || viewport.bottom - y > coverage.bottom) return null;
  return { x, y };
}
