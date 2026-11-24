import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { loadSettingsTestComponents } from "./lib/settings-test-components.mjs";

const dom = new JSDOM("<button id='opener'>設定</button><div id='root'></div>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
dom.window.HTMLElement.prototype.getClientRects = function () {
  return this.closest("[hidden]") ? [] : [{ width: 1, height: 1 }];
};
const { createElement, useState, act } = await import("react");
const { createRoot } = await import("react-dom/client");
let root;
try {
  const { SettingsModal, createDefaultState } = await loadSettingsTestComponents();
  const initial = structuredClone(createDefaultState().settings);
  const updates = [];
  let current;
  let themes = 0;
  function Harness() {
    const [settings, setSettings] = useState(initial);
    current = settings;
    return createElement(SettingsModal, {
      settings, systemFonts: [{ label: "Test Font", cssFamily: '"Test Font"' }],
      editorMeasureLimit: 800, onClose: () => {}, onOpenThemePicker: () => themes++,
      onUpdateSettings: (key, value) => {
        updates.push([key, value]);
        setSettings((previous) => ({ ...previous, [key]: value }));
      },
    });
  }
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(Harness)));
  const click = async (element) => act(async () => element.click());
  const findLabel = (text) => [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) label')]
    .find((label) => label.textContent.trim().startsWith(text));
  async function control(text) {
    if (findLabel(text)) return findLabel(text).querySelector("input, select");
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      await click(tab);
      if (findLabel(text)) return findLabel(text).querySelector("input, select");
    }
    assert.fail(`Missing setting: ${text}`);
  }
  async function change(text, value, key) {
    const element = await control(text);
    assert.equal(element.disabled, false, `${text} must be editable`);
    const count = updates.length;
    if (element.type === "checkbox") {
      assert.notEqual(element.checked, value);
      await click(element);
    } else {
      await act(async () => {
        const prototype = element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, String(value));
        element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      });
    }
    assert.ok(updates.length > count, `${text} must update immediately`);
    assert.equal(updates.at(-1)[0], key);
    assert.deepEqual(current[key], value);
  }
  await click(document.querySelector(".themePickerButton"));
  assert.equal(themes, 1);
  for (const [label, value, key] of [
    ["UIフォント", '"Test Font"', "uiFontFamily"],
    ["作品一覧・スタート画面のフォント", "editor", "startPageFontSource"],
    ["UI表示サイズ", 1.3, "uiFontScale"],
    ["集中表示で完全フルスクリーンを使用", true, "focusModeUsesNativeFullscreen"],
    ["本文フォント", '"Test Font"', "editorFontFamily"],
    ["見出し・太字フォント", "custom", "headingFontSource"],
    ["見出し・太字の指定フォント", '"Test Font"', "headingFontFamily"],
    ["文字サイズ", 20, "fontSize"], ["行間", 2, "lineHeight"],
    ["文字表示幅", 70, "editorMeasureVertical"],
    ["本文方向", "horizontal-tb", "writingMode"],
    ["文字表示幅", 80, "editorMeasureHorizontal"],
    ["編集表示", "paged", "editorDisplayMode"],
    ["ページ送り", "vertical", "pageFlowDirection"],
    ["改行記号を表示", true, "showLineBreakMarks"],
    ["行番号を表示", true, "showLineNumbers"],
    ["現在行をハイライト", true, "highlightCurrentLine"],
    ["「」内を色分け", true, "colorizeJapaneseQuotes"],
    ["コメントを表示", false, "showComments"],
    ["文字数に空白を含める", false, "countWhitespace"],
    ["文字数にコードを含める", false, "countCode"],
    ["固定位置", 55, "typewriterOffset"],
    ["タイプライター中央線を表示", false, "showTypewriterGuide"],
    ["タイプライタースクロール", false, "typewriterScroll"],
  ]) await change(label, value, key);
  assert.equal((await control("固定位置")).disabled, true);
  assert.equal((await control("タイプライター中央線を表示")).disabled, true);
  await change("タイプライタースクロール", true, "typewriterScroll");
  assert.equal((await control("固定位置")).disabled, false);

  // Nested manuscript changes retain the other saved manuscript properties.
  async function manuscriptChange(label, value, key) {
    const previous = { ...current.manuscript };
    const element = await control(label);
    await act(async () => {
      if (element.type === "checkbox") element.click();
      else {
        const proto = element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(element, String(value));
        element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      }
    });
    assert.deepEqual(current.manuscript, { ...previous, [key]: value });
    assert.equal(updates.at(-1)[0], "manuscript");
  }
  await manuscriptChange("原稿用紙", "manuscript", "layoutMode");
  await manuscriptChange("1行の字数", 30, "charactersPerLine");
  await manuscriptChange("1ページの行数", 25, "linesPerPage");
  await manuscriptChange("罫線を表示", !current.manuscript.showGrid, "showGrid");
  await manuscriptChange("原稿用紙の文字サイズ", 22, "fontSize");
  assert.equal(current.fontSize, 20);
  assert.equal((await control("ページ境界を表示")).disabled, true);
  assert.equal((await control("文字表示幅")).disabled, true);
  await change("編集表示", "continuous", "editorDisplayMode");
  assert.equal((await control("ページ境界を表示")).disabled, false);
  await manuscriptChange("ページ境界を表示", !current.manuscript.showPageBoundaries, "showPageBoundaries");
  await manuscriptChange("原稿用紙", "normal", "layoutMode");
  assert.equal((await control("文字表示幅")).disabled, false);
  assert.equal((await control("文字サイズ")).value, "20");
  for (const [label, key] of [
    ["見出しのガイド線を表示", "showOutlineGuides"],
    ["プロジェクト切替にパスを表示", "showWorkspacePaths"],
    ["画面下部にファイルパスを表示", "showStatusFilePath"],
    ["画面下部に最後の保存点を表示", "showCheckpointStatus"],
    ["サイドバーにチェックポイントを表示", "showCheckpointSection"],
    ["起動時に前回のワークスペースを直接開く", "skipStartupPortal"],
    ["エクスポートを別ウィンドウで開く", "exportOpensInWindow"],
  ]) await change(label, !current[key], key);
  await change("タブバーの表示方法", "hover", "documentTabsDisplayMode");
  await change("タブを表示", false, "showDocumentTabs");
  assert.equal((await control("タブバーの表示方法")).disabled, true);
  await change("カードの既定方向", "vertical-rl", "canvasDefaultWritingMode");
  await change("カードの既定フォント", "editor", "canvasDefaultFontSource");
  const exportFont = await control("DOCX・PDF出力フォント");
  await change("DOCX・PDF出力フォント", [...exportFont.options].find((option) => option.value !== exportFont.value).value, "exportFontFamily");
  console.log("PASS existing settings: immediate updates, nested values, conditional fields and dependencies");

  const list = document.querySelector('[role="tablist"]');
  assert.equal(list.getAttribute("aria-orientation"), "vertical");
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs.map((tab) => tab.textContent), ["外観", "ファイルと起動", "本文", "原稿用紙", "執筆サポート", "キャンバス", "出力"]);
  async function key(tab, key, expected) {
    await act(async () => {
      tab.focus();
      tab.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    assert.equal(document.activeElement, expected);
    assert.equal(expected.getAttribute("aria-selected"), "true");
    assert.equal(document.querySelectorAll('[role="tab"][tabindex="0"]').length, 1);
    const panels = [...document.querySelectorAll('[role="tabpanel"]')].filter((panel) => !panel.hidden);
    assert.equal(panels.length, 1);
    assert.equal(panels[0].id, expected.getAttribute("aria-controls"));
    assert.ok(panels[0].querySelector("h3"), "the content must have a category heading");
  }
  await key(tabs[0], "ArrowDown", tabs[1]);
  await key(tabs[1], "ArrowUp", tabs[0]);
  await key(tabs[0], "ArrowUp", tabs.at(-1));
  await key(tabs.at(-1), "ArrowDown", tabs[0]);
  await key(tabs[0], "End", tabs.at(-1));
  await key(tabs.at(-1), "Home", tabs[0]);
  const placement = [
    ["UIフォント", "集中表示で完全フルスクリーンを使用"],
    ["見出しのガイド線を表示", "タブを表示", "起動時に前回のワークスペースを直接開く"],
    ["本文フォント", "本文方向", "文字表示幅"],
    ["原稿用紙"],
    ["タイプライタースクロール", "行番号を表示", "文字数にコードを含める"],
    ["カードの既定方向", "カードの既定フォント"],
    ["DOCX・PDF出力フォント", "エクスポートを別ウィンドウで開く"],
  ];
  for (const [index, tab] of tabs.entries()) {
    await click(tab);
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    assert.equal(panel.hidden, false);
    assert.equal(panel.querySelector("h3").textContent, tab.textContent);
    for (const text of placement[index]) {
      assert.ok(findLabel(text), `${text} belongs in ${tab.textContent}`);
    }
    for (const label of panel.querySelectorAll("label")) {
      assert.ok(label.closest(".settingsGroup"), "every setting belongs to a named group");
    }
  }
  const last = document.querySelector(".modalActions button");
  await act(async () => {
    last.focus();
    last.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  });
  assert.equal(document.activeElement, document.querySelector(".modalClose"));
  await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
  assert.equal(document.activeElement, last);
  console.log("PASS sidebar: category placement, vertical keyboard navigation, focus trap");
} finally {
  if (root) await act(async () => root.unmount());
  dom.window.close();
}
