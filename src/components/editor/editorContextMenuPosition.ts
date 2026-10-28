export type MenuRect = { left: number; top: number; width: number; height: number };
type Viewport = { width: number; height: number };
type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

// All inputs and results use viewport CSS pixels. The rendering layer applies UI zoom once.
export function placeEditorMenu(point: Point, size: Pick<MenuRect, "width" | "height">, viewport: Viewport, margin = 8) {
  return {
    left: clamp(point.x, margin, viewport.width - size.width - margin),
    top: clamp(point.y, margin, viewport.height - size.height - margin),
  };
}

export function placeEditorSubmenu(anchor: MenuRect, size: Pick<MenuRect, "width" | "height">, viewport: Viewport) {
  const gap = 8;
  const right = anchor.left + anchor.width + gap;
  const left = anchor.left - size.width - gap;
  const side = right + size.width <= viewport.width - 8
    ? "right"
    : left >= 8 || anchor.left > viewport.width - anchor.left - anchor.width ? "left" : "right";
  return { ...placeEditorMenu({ x: side === "right" ? right : left, y: anchor.top }, size, viewport), side };
}
