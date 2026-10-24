// 右上のウィンドウ操作ボタン（最小化・最大化・閉じる）が、全テーマで、ボタンの下にあるものの上で
// 見えるかを、ヘッドレス Edge で App.css と全テーマの CSS を読み込んで確かめる。
// 下にあるものは画面で違う: 作品の上部の帯、起動画面の帯、起動中の背景、ライブラリの準備の背景。
// 帯のほかのボタン（ファイルメニュー・パンくず・右のアイコン）のホバーの背景も確かめる。
// ホバーはページの中の :hover を、CDP のマウスの移動で実際に起こして読む。
import assert from "node:assert/strict";
import { contrast, loadThemeIds, openThemePage } from "./lib/theme-contrast.mjs";

const themes = await loadThemeIds();
assert.ok(themes.length >= 60, `all themes are listed (${themes.length})`);

// 文字以外の部品のコントラストの目安（WCAG 1.4.11）。
const MIN_ICON_CONTRAST = 3;
// ホバーの背景が見えるとみなす差。白い帯のテーマで、帯のボタンのホバーがいちばん薄いもの
// （Coral、1.10）より少し下に置く。
const MIN_HOVER_CONTRAST = 1.09;
// 起動画面の帯の上の部品。文字は WCAG 1.4.3 の 4.5。控えめな色で描く部品（メニューのアイコン、
// 版の表示）は、白い帯のテーマでも 4.5 を下回るもの（Bronze の版 4.3 など）があるので 3。
const PORTAL_PART_CONTRAST = { menu: 3, wordmark: 4.5, settings: 4.5, skip: 4.5, version: 3 };
// 作品の帯の中の部品。ライブラリ名・作品名・アイコン・「∨」は控えめな色なので 3、画面モードの文字は 4.5。
// 区切りの「›」はテーマが控えめな色（--text-faint）で描き、白い帯のテーマでも 2.09（Flat）〜2.75（Default）
// なので 2.0（直さないと決めた。docs/KNOWN_ISSUES.md）。
const TOPBAR_PART_CONTRAST = { library: 3, separator: 2, work: 3, icon: 3, mode: 4.5, chevron: 3 };
// 直さないと決めたもの（docs/KNOWN_ISSUES.md）: Promise は帯の右側が明るい緑になり、右側のアイコンが 3 を下回る。
const TOPBAR_KNOWN_LOW = { "promise-light": ["icon"], "promise-dark": ["icon"] };

// overPage: App がボタンの下が帯でない画面で付ける印（data-over-page）。
const controls = (overPage = false) => `<div class="windowControls"${overPage ? ' data-over-page="true"' : ""} role="group">
  <button class="windowControlButton" data-button="minimize"><svg viewBox="0 0 12 12"><path d="M1.5 6.5h9" /></svg></button>
  <button class="windowControlButton" data-button="maximize"><svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" /></svg></button>
  <button class="windowControlButton windowCloseButton" data-button="close"><svg viewBox="0 0 12 12"><path d="m2 2 8 8M10 2 2 10" /></svg></button>
</div>`;
const topbar = `<section class="appFrame" data-app-mode="write"><header class="topbar">
  <div class="fileMenu"><button class="menuButton" data-topbar-button="file">ファイル</button></div>
  <nav class="breadcrumbs" style="flex: 1 1 auto">
    <div class="breadcrumbSegment breadcrumbLibrarySegment">
      <button class="breadcrumbFolderButton breadcrumbLibraryButton"><span data-topbar-part="library">QAライブラリ</span></button>
      <span class="crumbSeparator" data-topbar-part="separator">›</span>
    </div>
    <button class="breadcrumbFolderButton workspaceSwitcherButton" data-topbar-button="crumb"><span data-topbar-part="work">作品</span></button>
  </nav>
  <div class="topbarActions">
    <button class="iconButton" data-topbar-button="focus"><svg class="topbarSvgIcon" data-topbar-part="icon" viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg></button>
    <button class="iconButton" data-topbar-button="theme"><svg class="topbarSvgIcon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg></button>
    <div class="modeMenu"><button class="modeMenuButton" type="button"><span class="modeMenuButtonLabel" data-topbar-part="mode">本文</span><svg class="modeMenuChevron" data-topbar-part="chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></button></div>
  </div>
</header></section>`;
const scenes = {
  editor: { view: "editor", body: `${controls()}${topbar}` },
  portal: {
    view: "portal",
    body: `${controls()}<section class="startupPortal">
  <header class="startupPortalHeader">
    <span class="startupPortalMenuIcon" data-portal-part="menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg></span>
    <span class="startupPortalWordmark" data-portal-part="wordmark">Then</span>
  </header>
  <div class="startupPortalMain"></div>
  <footer class="startupPortalFooter">
    <button class="startupPortalSettingsButton" type="button" data-portal-part="settings">設定</button>
    <label class="startupPortalSkipSetting"><input type="checkbox" /><span data-portal-part="skip">次回から前回のライブラリ・作品を直接開く</span></label>
    <span class="startupPortalVersion" data-portal-part="version">Then 0.7.0</span>
  </footer>
</section>`,
  },
  loading: {
    view: "loading",
    body: `${controls(true)}<div class="startupPortalLoading" role="status">Then を読み込んでいます…</div>`,
  },
  librarySetup: {
    view: "editor",
    body: `${controls(true)}<section class="librarySetup"><div class="librarySetupPanel">ライブラリの準備</div></section>${topbar}`,
  },
};

const failures = [];
const fail = (message) => failures.push(message);
const round = (value) => value.toFixed(2);

const page = await openThemePage("window-controls");
const { read, moveMouse } = page;
try {
  for (const [sceneName, scene] of Object.entries(scenes)) {
    for (const theme of themes) {
      const where = `${theme} / ${sceneName}`;
      await moveMouse(640, 700);
      await page.setScene(scene.body, scene.view, theme);

      for (const button of ["minimize", "maximize", "close"]) {
        const selector = `[data-button="${button}"]`;
        const idle = await read(selector);
        const idleContrast = contrast(idle.color, idle.surface);
        if (idleContrast < MIN_ICON_CONTRAST) {
          fail(`${where}: ${button} icon contrast ${round(idleContrast)} (${idle.rawColor} on ${JSON.stringify(idle.surface)})`);
        }

        await moveMouse(idle.point.x, idle.point.y);
        const hover = await read(selector);
        if (button === "close") {
          if (hover.rawBackground !== "rgb(196, 43, 28)" || hover.rawColor !== "rgb(255, 255, 255)") {
            fail(`${where}: close hover must stay red and white (${hover.rawBackground}, ${hover.rawColor})`);
          }
        } else {
          const hoverContrast = contrast(hover.surface, idle.surface);
          if (hoverContrast < MIN_HOVER_CONTRAST) {
            fail(`${where}: ${button} hover background is not visible (${round(hoverContrast)}, ${hover.rawBackground})`);
          }
          const hoverIcon = contrast(hover.color, hover.surface);
          if (hoverIcon < MIN_ICON_CONTRAST) fail(`${where}: ${button} hover icon contrast ${round(hoverIcon)}`);
        }
        await moveMouse(640, 700);
      }

      if (sceneName === "portal") {
        // 起動画面の上下の帯は、作品の画面の帯と同じ色で塗るので、その上の文字も帯の文字色で読めること。
        // 「設定」は自分の背景（--bg-panel）を持つボタン。
        for (const [part, minimum] of Object.entries(PORTAL_PART_CONTRAST)) {
          const seen = await read(`[data-portal-part="${part}"]`);
          const partContrast = contrast(seen.color, seen.surface);
          if (partContrast < minimum) {
            fail(`${where}: portal ${part} contrast ${round(partContrast)} (${seen.rawColor} on ${JSON.stringify(seen.surface)})`);
          }
        }
      }
      if (sceneName !== "editor") continue;
      // 帯の中の文字とアイコン。
      for (const [part, minimum] of Object.entries(TOPBAR_PART_CONTRAST)) {
        if (TOPBAR_KNOWN_LOW[theme]?.includes(part)) continue;
        const seen = await read(`[data-topbar-part="${part}"]`);
        const partContrast = contrast(seen.color, seen.surface);
        if (partContrast < minimum) {
          fail(`${where}: topbar ${part} contrast ${round(partContrast)} (${seen.rawColor} on ${JSON.stringify(seen.surface)})`);
        }
      }
      // 帯のほかのボタン。ホバーをわざと出さないテーマ（--control-hover が transparent）は除く。
      if ((await page.cssVar("--control-hover")) === "transparent") continue;
      for (const button of ["file", "crumb", "focus", "theme"]) {
        const selector = `[data-topbar-button="${button}"]`;
        const idle = await read(selector);
        await moveMouse(idle.point.x, idle.point.y);
        const hover = await read(selector);
        const hoverContrast = contrast(hover.surface, idle.surface);
        if (hoverContrast < MIN_HOVER_CONTRAST) {
          fail(`${where}: topbar ${button} hover background is not visible (${round(hoverContrast)}, ${hover.rawBackground})`);
        }
        await moveMouse(640, 700);
      }
    }
  }
} finally {
  await page.close();
}

assert.deepEqual(failures, [], `window controls and topbar buttons must be visible on every theme:\n${failures.join("\n")}`);
console.log(`window controls contrast tests passed (${themes.length} themes, ${Object.keys(scenes).length} screens)`);
