export type BreadcrumbLayout = "full" | "compact" | "minimal";

export const BREADCRUMB_COMPACT_WIDTH = 480;
export const BREADCRUMB_MINIMAL_WIDTH = 240;

export function getBreadcrumbLayout(width: number): BreadcrumbLayout {
  if (width < BREADCRUMB_MINIMAL_WIDTH) return "minimal";
  if (width < BREADCRUMB_COMPACT_WIDTH) return "compact";
  return "full";
}

export function isBreadcrumbTrailItemVisible(
  layout: BreadcrumbLayout,
  index: number,
  itemCount: number,
  hasActiveOutline: boolean,
) {
  if (layout === "full") return true;
  const isLast = index === itemCount - 1;
  if (layout === "compact") {
    return index === 0 || (!hasActiveOutline && isLast);
  }
  return !hasActiveOutline && isLast;
}

export function isOutlineBreadcrumbItemVisible(
  layout: BreadcrumbLayout,
  index: number,
  itemCount: number,
) {
  return layout === "full" || index === itemCount - 1;
}
