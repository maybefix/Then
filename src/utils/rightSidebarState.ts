export const restorableRightSidebarTabs = ["scene", "connections", "idea", "proof", "properties"] as const;

export type RestorableRightSidebarTab = (typeof restorableRightSidebarTabs)[number];

export function isRestorableRightSidebarTab(
  value: unknown,
): value is RestorableRightSidebarTab {
  return restorableRightSidebarTabs.includes(value as RestorableRightSidebarTab);
}

export function normalizeRightSidebarTab(value: unknown): RestorableRightSidebarTab {
  // 「プロット」は BINDER 1-6 で、「中間稿」は 4-4b でなくなった。保存されている "plot"・"draft" も、分からない値と
  // 同じく「アイデア」で開く。
  return isRestorableRightSidebarTab(value) ? value : "idea";
}

export function normalizeRightSidebarCollapsed(value: unknown): boolean {
  return value === true;
}

export function normalizeRightSidebarWide(value: unknown): boolean {
  return value === true;
}
