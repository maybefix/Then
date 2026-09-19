export type CanvasResizeCorner = "nw" | "ne" | "sw" | "se";

export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Resize a canvas rectangle from one corner while keeping the opposite corner
 * fixed. The minimum size is applied by stopping the dragged edge instead of
 * allowing the rectangle to flip over.
 */
export function resizeCanvasRect(
  rect: CanvasRect,
  corner: CanvasResizeCorner,
  dx: number,
  dy: number,
  minWidth: number,
  minHeight: number,
): CanvasRect {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const fromWest = corner === "nw" || corner === "sw";
  const fromNorth = corner === "nw" || corner === "ne";

  const x = fromWest ? Math.min(rect.x + dx, right - minWidth) : rect.x;
  const y = fromNorth ? Math.min(rect.y + dy, bottom - minHeight) : rect.y;
  const width = fromWest
    ? right - x
    : Math.max(minWidth, rect.width + dx);
  const height = fromNorth
    ? bottom - y
    : Math.max(minHeight, rect.height + dy);

  return { x, y, width, height };
}
