import type { JsonCanvasDocument } from "./canvasTypes";

export function nextCanvasPlacement(board: JsonCanvasDocument) {
  const textNodes = board.nodes.filter((node) => node.type === "text");
  if (textNodes.length === 0) return { x: 120, y: 120 };
  const last = textNodes.reduce((rightmost, node) =>
    node.x + node.width > rightmost.x + rightmost.width ? node : rightmost,
  );
  return {
    x: last.x + 32,
    y: last.y + 32,
  };
}
