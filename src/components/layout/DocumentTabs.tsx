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
    <aside className="documentTabs" aria-label="開いている文書">
      <div className="documentTabsHeader">
        <span>開いている文書</span>
        <span className="documentTabsCount" aria-label={`${openTabs.length}件`}>
          {openTabs.length}
        </span>
      </div>
      <div className="documentTabsList" role="tablist" aria-orientation="vertical">
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
                title={tab.path ?? tab.name}
                onClick={() => onActivateTab(tab.id)}
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
                <span className="documentTabStatus" aria-label={tabStatus} />
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
      <div className="documentTabsFooter">
        <button className="documentTabsNewButton" type="button" onClick={onNewTab}>
          <span aria-hidden="true">＋</span>
          <span>新しいタブ</span>
        </button>
      </div>
    </aside>
  );
}
