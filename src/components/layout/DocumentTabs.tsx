import type { DocumentTab } from "../../types";

type DocumentTabsProps = {
  openTabs: DocumentTab[];
  activeTabId: string;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
};

function isDirtyDocumentTab(tab: DocumentTab): boolean {
  return (
    tab.saveStatus === "dirty" ||
    tab.saveStatus === "error" ||
    tab.markdown !== tab.savedMarkdown
  );
}

function getTabStatusLabel(tab: DocumentTab): string {
  if (tab.saveStatus === "saved" && tab.markdown === tab.savedMarkdown) return "保存済み";
  if (tab.saveStatus === "saving") return "保存中";
  if (tab.saveStatus === "loading") return "読み込み中";
  if (tab.saveStatus === "error") return "保存失敗";
  return "未保存";
}

export function DocumentTabs({
  openTabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onNewTab,
}: DocumentTabsProps) {
  return (
    <nav className="documentTabs" aria-label="開いている文書">
      <div className="documentTabsList" role="tablist" aria-orientation="horizontal">
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const tabStatus = getTabStatusLabel(tab);
          const isDirty = isDirtyDocumentTab(tab);
          return (
            <div
              className={`documentTabItem ${isActive ? "activeDocumentTabItem" : ""} ${
                isDirty ? "dirtyDocumentTabItem" : ""
              } ${tab.saveStatus === "error" ? "errorDocumentTabItem" : ""}`}
              key={tab.id}
            >
              <button
                className="documentTabButton"
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                title={tab.path ?? tab.name}
                onClick={() => onActivateTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const currentIndex = openTabs.findIndex((item) => item.id === tab.id);
                  const delta = event.key === "ArrowLeft" ? -1 : 1;
                  const nextIndex = (currentIndex + delta + openTabs.length) % openTabs.length;
                  onActivateTab(openTabs[nextIndex].id);
                  const tabButtons = event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLButtonElement>(".documentTabButton");
                  tabButtons?.[nextIndex]?.focus();
                }}
              >
                <span
                  className={`documentTabKind ${
                    tab.kind === "scratch" ? "scratchDocumentTabKind" : ""
                  }`}
                  aria-hidden="true"
                />
                <span className="documentTabText">
                  <span className="documentTabName">{tab.name}</span>
                  <span className="documentTabPath">{tab.path ?? "保存先未指定"}</span>
                </span>
                <span className="documentTabStatus" aria-label={tabStatus} title={tabStatus} />
              </button>
              <button
                className="documentTabCloseButton"
                type="button"
                aria-label={`${tab.name} を閉じる`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="documentTabsNewButton"
        type="button"
        aria-label="新しいタブ"
        title="新しいタブ"
        onClick={onNewTab}
      >
        <span aria-hidden="true">＋</span>
      </button>
    </nav>
  );
}
