export type VisualWritingMode = "vertical-rl" | "horizontal-tb";

export type VisualRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type VisualBlockRect = VisualRect & {
  /** Range#getClientRects() が返した、ブラウザによる実際の行断片。 */
  fragments?: readonly VisualRect[];
};

export type VisualLineBand = {
  number: number;
  blockIndex: number;
  lineIndex: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

export type VisualPoint = {
  x: number;
  y: number;
};

type MutableLineRect = VisualRect & {
  primaryCenter: number;
};

const finiteRect = (rect: VisualRect): boolean =>
  Number.isFinite(rect.left) &&
  Number.isFinite(rect.right) &&
  Number.isFinite(rect.top) &&
  Number.isFinite(rect.bottom) &&
  rect.right - rect.left > 0.01 &&
  rect.bottom - rect.top > 0.01;

const primaryStart = (rect: VisualRect, vertical: boolean) =>
  vertical ? rect.left : rect.top;
const primaryEnd = (rect: VisualRect, vertical: boolean) =>
  vertical ? rect.right : rect.bottom;
const primaryCenter = (rect: VisualRect, vertical: boolean) =>
  (primaryStart(rect, vertical) + primaryEnd(rect, vertical)) / 2;

function belongsToSameRenderedLine(
  line: MutableLineRect,
  fragment: VisualRect,
  vertical: boolean,
): boolean {
  const lineStart = primaryStart(line, vertical);
  const lineEnd = primaryEnd(line, vertical);
  const fragmentStart = primaryStart(fragment, vertical);
  const fragmentEnd = primaryEnd(fragment, vertical);
  const overlap = Math.min(lineEnd, fragmentEnd) - Math.max(lineStart, fragmentStart);
  const smallerExtent = Math.min(lineEnd - lineStart, fragmentEnd - fragmentStart);
  if (overlap > Math.max(0.5, smallerExtent * 0.25)) return true;

  // 同じ行でも mark/span ごとに矩形が分かれ、フォントのメトリクス差で
  // 主軸の中心がわずかにずれることがある。
  return Math.abs(line.primaryCenter - primaryCenter(fragment, vertical)) <= 1;
}

function mergeRect(line: MutableLineRect, fragment: VisualRect, vertical: boolean) {
  line.left = Math.min(line.left, fragment.left);
  line.right = Math.max(line.right, fragment.right);
  line.top = Math.min(line.top, fragment.top);
  line.bottom = Math.max(line.bottom, fragment.bottom);
  line.primaryCenter = primaryCenter(line, vertical);
}

function collectRenderedLines(block: VisualBlockRect, vertical: boolean): MutableLineRect[] {
  const fragments = (block.fragments ?? []).filter(finiteRect);
  if (fragments.length === 0) {
    return finiteRect(block)
      ? [{ ...block, primaryCenter: primaryCenter(block, vertical) }]
      : [];
  }

  const lines: MutableLineRect[] = [];
  for (const fragment of fragments) {
    const existing = lines.find((line) =>
      belongsToSameRenderedLine(line, fragment, vertical),
    );
    if (existing) {
      mergeRect(existing, fragment, vertical);
    } else {
      lines.push({ ...fragment, primaryCenter: primaryCenter(fragment, vertical) });
    }
  }

  lines.sort((a, b) =>
    vertical ? b.primaryCenter - a.primaryCenter : a.primaryCenter - b.primaryCenter,
  );
  return lines;
}

/**
 * Range#getClientRects() 由来の実レイアウト断片を、表示行（縦書きでは列）へ統合する。
 * 段落寸法や line-height から行数を推測しないため、フォント固有の端数にも追従する。
 */
export function createVisualLineBands(
  blocks: readonly VisualBlockRect[],
  writingMode: VisualWritingMode,
): VisualLineBand[] {
  const bands: VisualLineBand[] = [];
  const vertical = writingMode === "vertical-rl";
  let number = 1;

  blocks.forEach((block, blockIndex) => {
    const renderedLines = collectRenderedLines(block, vertical);
    renderedLines.forEach((line, lineIndex) => {
      // ハイライトは文字断片だけでなく、その段落のインライン方向全体へ伸ばす。
      const left = vertical ? line.left : block.left;
      const right = vertical ? line.right : block.right;
      const top = vertical ? block.top : line.top;
      const bottom = vertical ? block.bottom : line.bottom;
      bands.push({
        number,
        blockIndex,
        lineIndex,
        left,
        right,
        top,
        bottom,
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2,
      });
      number += 1;
    });
  });

  return bands;
}

function squaredDistanceToBand(band: VisualLineBand, point: VisualPoint): number {
  const dx =
    point.x < band.left
      ? band.left - point.x
      : point.x > band.right
        ? point.x - band.right
        : 0;
  const dy =
    point.y < band.top
      ? band.top - point.y
      : point.y > band.bottom
        ? point.y - band.bottom
        : 0;
  return dx * dx + dy * dy;
}

/**
 * キャレットに最も近い表示行を返す。共有境界で同距離になった場合は、
 * キャレットに隣接する実文字の内側座標（affinityPoint）で所属行を確定する。
 */
export function findClosestVisualLineBand(
  bands: readonly VisualLineBand[],
  blockIndex: number,
  x: number,
  y: number,
  affinityPoint?: VisualPoint | null,
): VisualLineBand | null {
  let closest: VisualLineBand | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestAffinityDistance = Number.POSITIVE_INFINITY;
  const point = { x, y };
  const epsilon = 0.01;

  for (const band of bands) {
    if (band.blockIndex !== blockIndex) continue;
    const distance = squaredDistanceToBand(band, point);
    const affinityDistance = affinityPoint
      ? squaredDistanceToBand(band, affinityPoint)
      : Number.POSITIVE_INFINITY;
    if (
      distance < closestDistance - epsilon ||
      (Math.abs(distance - closestDistance) <= epsilon &&
        affinityDistance < closestAffinityDistance)
    ) {
      closest = band;
      closestDistance = distance;
      closestAffinityDistance = affinityDistance;
    }
  }

  return closest;
}
