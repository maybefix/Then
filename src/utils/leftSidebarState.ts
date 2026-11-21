export const leftSidebarViews = ["files", "search", "reference"] as const;

export type LeftSidebarView = (typeof leftSidebarViews)[number];

export function normalizeLeftSidebarView(value: unknown): LeftSidebarView {
  return leftSidebarViews.includes(value as LeftSidebarView) ? (value as LeftSidebarView) : "files";
}

export function normalizeLeftSidebarCollapsed(value: unknown): boolean {
  return value === true;
}

/** Canvas の画面の左サイドバーは、カードを並べる場所を狭くしないよう、既定で畳む（BINDER 4-3）。 */
export function normalizeCanvasLeftSidebarCollapsed(value: unknown): boolean {
  return value !== false;
}

/**
 * Whether the left sidebar is folded in this screen. The Canvas keeps its own
 * state; with the left hover setting the binder floats over the Canvas, as it
 * does over the body, and is never folded away there (BINDER 4-3).
 */
export function isLeftSidebarCollapsedIn(
  appMode: string,
  state: { collapsed: boolean; canvasCollapsed: boolean; hoverSidebar: boolean },
): boolean {
  if (appMode === "canvas") return !state.hoverSidebar && state.canvasCollapsed;
  return state.collapsed;
}
