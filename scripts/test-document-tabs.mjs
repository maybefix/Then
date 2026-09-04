import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [appSource, appCss, settingsSource, tabsSource, typesSource, manualSource] =
  await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/App.css", "utf8"),
    readFile("src/components/dialogs/SettingsModal.tsx", "utf8"),
    readFile("src/components/layout/DocumentTabs.tsx", "utf8"),
    readFile("src/types.ts", "utf8"),
    readFile("docs/USER_MANUAL.md", "utf8"),
  ]);

assert.match(typesSource, /showDocumentTabs: boolean;/);
assert.match(appSource, /showDocumentTabs: true,/);
assert.match(
  appSource,
  /typeof settings\.showDocumentTabs === "boolean"[\s\S]*?defaultSettings\.showDocumentTabs/,
  "stored settings must preserve the tab visibility switch and default older state to visible",
);
assert.match(settingsSource, /checked=\{settings\.showDocumentTabs\}/);
assert.match(settingsSource, /onUpdateSettings\("showDocumentTabs", event\.target\.checked\)/);

const topbarStart = appSource.indexOf('<header className="topbar">');
const topbarEnd = appSource.indexOf("</header>", topbarStart);
const tabBar = appSource.indexOf("<DocumentTabs", topbarEnd);
const workspace = appSource.indexOf('className={`workspace ', topbarEnd);
assert.ok(
  topbarStart >= 0 && topbarEnd > topbarStart && tabBar > topbarEnd && workspace > tabBar,
  "the document tab bar must be rendered directly below the breadcrumb topbar and before the workspace",
);
assert.match(
  appSource.slice(topbarEnd, workspace),
  /settings\.showDocumentTabs && appMode === "write" && !isEditorFocusMode/,
);
assert.match(appSource, /onActivateTab=\{activateDocumentTab\}/);
assert.match(appSource, /onCloseTab=\{\(tabId\) => void closeDocumentTab\(tabId\)\}/);
assert.match(appSource, /onNewTab=\{handleNewTab\}/);
assert.match(
  appSource,
  /const isClosingActiveTab = tabId === activeTabId;[\s\S]*?if \(isClosingActiveTab\) syncDocumentTabToEditor\(fallbackTab\);/,
  "closing a background tab must not switch away from the active document",
);

assert.match(tabsSource, /aria-orientation="horizontal"/);
assert.match(tabsSource, /onClick=\{\(\) => onActivateTab\(tab\.id\)\}/);
assert.match(tabsSource, /onCloseTab\(tab\.id\)/);
assert.match(tabsSource, /onClick=\{onNewTab\}/);
assert.match(tabsSource, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);

assert.match(appCss, /--document-tabs-height: 35px/);
assert.match(appCss, /\.documentTabs \{[\s\S]*?width: 100%;[\s\S]*?flex: 0 0 var\(--document-tabs-height\)/);
assert.match(appCss, /\.documentTabsList \{[\s\S]*?overflow-x: auto/);
assert.match(appCss, /\.activeDocumentTabItem \{[\s\S]*?border-bottom-color: var\(--accent\)/);
assert.match(manualSource, /タブはパンくずの下に横並びで表示されます/);
assert.match(manualSource, /「タブを表示」で、タブバーの表示／非表示を切り替えられます/);
assert.match(manualSource, /本文位置はプロジェクトごとに記憶されます/);
assert.match(appSource, /「\$\{projectFolder\.name\}」のタブを記憶/);

console.log("document tab UI tests passed");
