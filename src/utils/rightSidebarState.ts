export const restorableRightSidebarTabs = ["idea", "proof", "draft", "properties"] as const;

export type RestorableRightSidebarTab = (typeof restorableRightSidebarTabs)[number];

export function isRestorableRightSidebarTab(
  value: unknown,
): value is RestorableRightSidebarTab {
  return restorableRightSidebarTabs.includes(value as RestorableRightSidebarTab);
}

export function normalizeRightSidebarTab(value: unknown): RestorableRightSidebarTab {
  // 「プロット」は BINDER 1-6 でなくなった。保存されている "plot" も、分からない値と同じく「アイデア」で開く。
  return isRestorableRightSidebarTab(value) ? value : "idea";
}

export function normalizeRightSidebarCollapsed(value: unknown): boolean {
  return value === true;
}

export function normalizeRightSidebarWide(value: unknown): boolean {
  return value === true;
}
