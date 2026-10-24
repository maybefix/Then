// 左サイドバーのファイルの一覧で、今のファイルの行・選んでいる行の中の文字（ファイル名、進み具合の印、「•••」）が、
// 全テーマで行の背景の上で読めるかを、ヘッドレス Edge で App.css と全テーマの CSS を読み込んで確かめる。
// 行の作りは src/components/layout/WorkspaceSidebar.tsx の行（treeItem ... fileTreeItem）を写す。
import assert from "node:assert/strict";
import { contrast, loadThemeIds, openThemePage } from "./lib/theme-contrast.mjs";

const themes = await loadThemeIds();
assert.ok(themes.length >= 60, `all themes are listed (${themes.length})`);

const STATUSES = { todo: "未", writing: "執", revising: "推", done: "完", archived: "ア" };
// 行の状態。今のファイル（選択済みでもある）、今のファイルだけ、複数選択で選んだだけ。
const ROW_STATES = {
  current: "selectedTreeEntry activeTreeItem",
  active: "activeTreeItem",
  selected: "selectedTreeEntry",
  plain: "",
};

const row = (state, status) => `<div class="treeItem ${ROW_STATES[state]} fileTreeItem" data-row="${state}-${status}">
  <span class="treeFileDisclosurePlaceholder" aria-hidden="true"></span>
  <button class="treeItemPrimary fileTreeItemPrimary" type="button" aria-pressed="true">
    <span class="treeItemName treeItemName-${status}" data-part="name">第一章</span>
    <span class="treeItemCharCount" data-part="count">1,234</span>
  </button>
  <span class="treeStatusColumn"><span class="fileProgressControl">
    <button type="button" class="fileProgressMarker progressText-${status}" data-part="marker"><span aria-hidden="true">${STATUSES[status]}</span></button>
  </span></span>
  <button class="treeEntryMoreButton" type="button" data-part="more">•••</button>
</div>`;

const body = `<section class="appFrame" data-app-mode="write"><div class="workspace" data-app-mode="write">
<div class="leftWorkspaceCluster" data-sidebar-collapsed="false">
  <aside class="workspaceSidebar"><div class="sidebarScroll">
    ${Object.keys(ROW_STATES).flatMap((state) => Object.keys(STATUSES).map((status) => row(state, status))).join("\n")}
  </div></aside>
</div></div></section>`;

// 選んだ行の文字は、3 以上か、選んでいない行の同じ部品の 7 割以上であること。
// 行を淡い色で塗るテーマでは、選ぶと 0.71〜0.85 倍に少し薄まる（控えめな色はもともと 3 未満のこともある）。
// 行を濃い色で塗りつぶすテーマで、部品が自分の色を持ったままだと、ここを大きく下回る。
const MIN_CONTRAST = 3;
const MIN_RATIO_TO_PLAIN = 0.7;

const debug = process.env.TREE_ROW_DEBUG;
const failures = [];
const round = (value) => value.toFixed(2);

const page = await openThemePage("tree-row");
try {
  for (const theme of themes) {
    await page.setScene(body, "editor", theme);
    // 「•••」は、選んでいない行ではマウスを乗せるまで出ない（opacity: 0）。出ているときの色を基準にする。
    await page.evaluate(`document.querySelectorAll('[data-row^="plain-"] [data-part="more"]').forEach((more) => { more.style.opacity = "1"; })`);
    for (const status of Object.keys(STATUSES)) {
      for (const part of ["name", "count", "marker", "more"]) {
        const plain = await page.read(`[data-row="plain-${status}"] [data-part="${part}"]`);
        const plainContrast = contrast(plain.color, plain.surface);
        for (const state of ["current", "active", "selected"]) {
          const seen = await page.read(`[data-row="${state}-${status}"] [data-part="${part}"]`);
          if (seen.opacity === 0) continue;
          const value = contrast(seen.color, seen.surface);
          if (debug) console.log(`${theme}	${state}	${status}	${part}	${round(value)}	${round(plainContrast)}`);
          if (value < MIN_CONTRAST && value < plainContrast * MIN_RATIO_TO_PLAIN) {
            failures.push(`${theme} / ${state} row / ${status}: ${part} ${round(value)} (unselected ${round(plainContrast)}; ${seen.rawColor})`);
          }
        }
      }
    }
  }
} finally {
  await page.close();
}

assert.deepEqual(failures, [], `text on the current and selected file rows must stay readable on every theme:\n${failures.join("\n")}`);
console.log(`tree row contrast tests passed (${themes.length} themes)`);
