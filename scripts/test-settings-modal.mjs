import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body><button id='opener'>設定</button><div id='root'></div></body></html>", {
  url: "http://localhost/",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  KeyboardEvent: dom.window.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 1, height: 1 }];

const { createElement, useState, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

try {
  const { BoundedNumberInput } = await server.ssrLoadModule(
    "/src/components/dialogs/BoundedNumberInput.tsx",
  );
  const { SettingsModal } = await server.ssrLoadModule(
    "/src/components/dialogs/SettingsModal.tsx",
  );
  const { SettingsFontSelect } = await server.ssrLoadModule(
    "/src/components/dialogs/SettingsFontSelect.tsx",
  );
  const { ThemePickerModal } = await server.ssrLoadModule(
    "/src/components/dialogs/ThemePickerModal.tsx",
  );
  const rootElement = document.getElementById("root");
  const root = createRoot(rootElement);
  const updates = [];

  function NumberHarness() {
    const [value, setValue] = useState(18);
    return createElement(BoundedNumberInput, {
      min: 12,
      max: 24,
      value,
      onChange: (next) => {
        updates.push(next);
        setValue(next);
      },
    });
  }

  await act(async () => root.render(createElement(NumberHarness)));
  const input = rootElement.querySelector("input");
  const setInput = async (value) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  await act(async () => input.focus());
  await setInput("");
  assert.deepEqual(updates, [], "clearing a number field must not update saved settings");
  await setInput("0");
  assert.deepEqual(updates, [], "out of range drafts must not update saved settings");
  await setInput("20");
  assert.deepEqual(updates, [20], "valid values must retain immediate preview");
  await setInput("");
  await act(async () => input.blur());
  assert.equal(input.value, "20", "an empty draft must restore the last valid value on blur");

  await act(async () => root.render(null));
  const opener = document.getElementById("opener");
  opener.focus();
  const settings = {
    theme: "dark",
    uiFontFamily: '"Segoe UI"',
    uiFontScale: 1,
    sidebarHoverMode: "none",
    focusModeUsesNativeFullscreen: false,
  };
  function ModalHarness() {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(SettingsModal, {
          settings,
          systemFonts: [{ label: "Segoe UI", cssFamily: '"Segoe UI"' }],
          editorMeasureLimit: null,
          onClose: () => setOpen(false),
          onOpenThemePicker: () => {},
          onUpdateSettings: () => {},
          onSnippetStorageModeChange: () => {},
        })
      : null;
  }

  await act(async () => root.render(createElement(ModalHarness)));
  assert.equal(document.activeElement?.getAttribute("aria-label"), "閉じる");
  for (const tab of ["appearance", "body", "files", "canvas", "export"]) {
    assert.ok(document.getElementById(`settings-panel-${tab}`));
  }
  const appearanceTab = document.getElementById("settings-tab-appearance");
  await act(async () => appearanceTab.focus());
  await act(async () => appearanceTab.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
  })));
  assert.equal(document.activeElement?.id, "settings-tab-body");
  assert.equal(document.getElementById("settings-panel-body").hidden, false);
  assert.equal(document.getElementById("settings-panel-appearance").hidden, true);

  const footerClose = rootElement.querySelector(".settingsModal .modalActions button");
  await act(async () => footerClose.focus());
  await act(async () => footerClose.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
  })));
  assert.equal(document.activeElement?.getAttribute("aria-label"), "閉じる");
  await act(async () => opener.focus());
  assert.ok(document.querySelector(".settingsModal")?.contains(document.activeElement));

  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
  })));
  assert.equal(document.querySelector(".settingsModal"), null);
  assert.equal(document.activeElement, opener, "closing the modal must restore focus");

  await act(async () => root.render(createElement(SettingsFontSelect, {
    value: '"Missing Font"',
    systemFonts: [{ label: "Segoe UI", cssFamily: '"Segoe UI"' }],
    onChange: () => {},
  })));
  assert.equal(rootElement.querySelector("select").value, '"Missing Font"');
  assert.match(rootElement.querySelector("option").textContent, /フォント一覧にありません/);
  await act(async () => root.render(null));

  opener.focus();
  function ThemeRoundTrip() {
    const [screen, setScreen] = useState("settings");
    if (screen === "theme") {
      return createElement(ThemePickerModal, {
        selectedTheme: "dark",
        onClose: () => setScreen("settings"),
        onSelect: () => {},
      });
    }
    if (screen === "closed") return null;
    return createElement(SettingsModal, {
      settings,
      systemFonts: [{ label: "Segoe UI", cssFamily: '"Segoe UI"' }],
      editorMeasureLimit: null,
      onClose: () => setScreen("closed"),
      onOpenThemePicker: () => setScreen("theme"),
      onUpdateSettings: () => {},
      onSnippetStorageModeChange: () => {},
    });
  }
  await act(async () => root.render(createElement(ThemeRoundTrip)));
  await act(async () => rootElement.querySelector(".themePickerButton").click());
  assert.ok(document.querySelector(".themePickerModal")?.contains(document.activeElement));
  await act(async () => rootElement.querySelector(".themePickerModal .modalClose").click());
  assert.ok(document.querySelector(".settingsModal")?.contains(document.activeElement));
  await act(async () => rootElement.querySelector(".settingsModal .modalClose").click());
  assert.equal(document.activeElement, opener, "focus must survive the theme picker round trip");

  await act(async () => root.unmount());
  console.log("settings modal interaction tests passed");
} finally {
  await server.close();
  dom.window.close();
}
