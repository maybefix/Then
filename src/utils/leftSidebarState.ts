export const leftSidebarViews = ["files", "search", "reference"] as const;

export type LeftSidebarView = (typeof leftSidebarViews)[number];

export function normalizeLeftSidebarView(value: unknown): LeftSidebarView {
  return leftSidebarViews.includes(value as LeftSidebarView) ? (value as LeftSidebarView) : "files";
}

export function normalizeLeftSidebarCollapsed(value: unknown): boolean {
  return value === true;
}
