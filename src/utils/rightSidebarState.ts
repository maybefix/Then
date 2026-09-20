export const restorableRightSidebarTabs = ["idea", "plot", "proof", "draft"] as const;

export type RestorableRightSidebarTab = (typeof restorableRightSidebarTabs)[number];

export function isRestorableRightSidebarTab(
  value: unknown,
): value is RestorableRightSidebarTab {
  return restorableRightSidebarTabs.includes(value as RestorableRightSidebarTab);
}

export function normalizeRightSidebarTab(value: unknown): RestorableRightSidebarTab {
  return isRestorableRightSidebarTab(value) ? value : "plot";
}
