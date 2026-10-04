import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [appSource, appCss, settingsSource, tabsSource, typesSource, manualSource] =
  await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/App.css", "utf8"),
    readFile("src/components/dialogs/FileSettings.tsx", "utf8"),
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

const topbarStart = appSource.indexOf('<header className="topbar"');
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
assert.match(appSource, /onCloseTabs=\{\(tabIds\) => void closeDocumentTabs\(tabIds\)\}/);
assert.match(appSource, /onMoveTab=\{moveDocumentTab\}/);
assert.match(appSource, /onReopenClosedTab=\{\(\) => void reopenClosedDocumentTab\(\)\}/);
assert.match(appSource, /onNewTab=\{handleNewTab\}/);
assert.match(
  appSource,
  /const isClosingActiveTab = targetIds\.has\(currentActiveId\);[\s\S]*?if \(isClosingActiveTab\) syncDocumentTabToEditor\(fallbackTab\);/,
  "closing a background tab must not switch away from the active document",
);

assert.match(tabsSource, /aria-orientation="horizontal"/);
assert.match(tabsSource, /if \(suppressClickRef\.current\) return;\s*onActivateTab\(tab\.id\);/);
assert.match(tabsSource, /onCloseTabs\(\[tab\.id\]\)/);
assert.match(tabsSource, /onClick=\{onNewTab\}/);
assert.match(tabsSource, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);

// 中クリックで閉じ、押下時の自動スクロールカーソルは出さない。
assert.match(tabsSource, /onAuxClick=\{\(event\) => \{\s*if \(event\.button !== 1\) return;/);
assert.match(tabsSource, /if \(event\.button === 1\) \{\s*event\.preventDefault\(\);/);
// ドラッグはポインターキャプチャで続け、ホバー表示モードでもバーを保持する。
assert.match(tabsSource, /setPointerCapture\(event\.pointerId\)/);
assert.match(tabsSource, /heldDocumentTabs/);
assert.match(appCss, /\.hoverDocumentTabs\.heldDocumentTabs \{/);
// ホイールの横送りは非 passive で登録する。
assert.match(tabsSource, /addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
// アクティブタブの追従は scrollIntoView を使わず、リストの横スクロールだけで行う。
assert.doesNotMatch(tabsSource, /\.scrollIntoView\(/);
// タブ操作のショートカット。
assert.match(appSource, /const isDocumentTabShortcut = mod && !event\.altKey/);
// 新しいタブはアクティブなタブの右に置く。置き換えは元の位置で行う。
assert.match(appSource, /function insertTabAfter\(/);
assert.match(appSource, /current\.map\(\(tab\) => \(tab\.id === activeTabId \? nextTab : tab\)\)/);

assert.match(appCss, /--document-tabs-height: 35px/);
assert.match(appCss, /\.documentTabs \{[\s\S]*?width: 100%;[\s\S]*?flex: 0 0 var\(--document-tabs-height\)/);
assert.match(appCss, /\.documentTabsList \{[\s\S]*?overflow-x: auto/);
assert.match(appCss, /\.activeDocumentTabItem \{[\s\S]*?border-bottom-color: var\(--accent\)/);
assert.match(manualSource, /タブはパンくずの下に横並びで表示されます/);
assert.match(manualSource, /「タブを表示」で、タブバーの表示／非表示を切り替えられます/);
assert.match(manualSource, /本文位置はプロジェクトごとに記憶されます/);
assert.match(appSource, /「\$\{projectFolder\.name\}」のタブを記憶/);

console.log("document tab UI tests passed");
