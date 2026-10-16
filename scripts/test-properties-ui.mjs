import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// The DOM must exist before react-dom loads, or it picks its legacy input-event path.
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.CSS = { escape: (value) => value.replace(/["\\]/g, "\\$&") };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

// The properties form, driven like a user would: values, lists, rename, type
// change, add with a name, YAML source view, Escape back to the body.
const dir = path.resolve("test-artifacts/properties-ui");
await mkdir(dir, { recursive: true });
await build({
  entryPoints: ["src/components/properties/PropertiesForm.tsx"],
  outfile: path.join(dir, "form.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/jsx-runtime", "yaml"],
});
const { default: PropertiesForm } = await import(`${pathToFileURL(path.join(dir, "form.mjs")).href}?${Date.now()}`);
await build({
  entryPoints: ["src/components/properties/PropertiesPanel.tsx"],
  outfile: path.join(dir, "panel.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/jsx-runtime", "yaml"],
});
const { PropertiesPanel } = await import(`${pathToFileURL(path.join(dir, "panel.mjs")).href}?${Date.now()}`);

const ARTICLE = [
  "# サイト用",
  "slug: making-then",
  "publish: false",
  "tags:",
  "  - 開発",
  "description: Thenを作った話",
  "series:",
  "  name: 夜の港",
].join("\n");

function mount(initial, extra = {}) {
  const state = { metadata: initial, remembered: [], exits: 0, view: "form", writes: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (props = {}) =>
    act(() => {
      root.render(React.createElement(PropertiesForm, {
        documentKey: extra.documentKey ?? "doc-1",
        metadata: state.metadata,
        typeSettings: extra.typeSettings ?? {},
        view: state.view,
        addRequest: 0,
        onViewChange: (view) => {
          state.view = view;
          render(props);
        },
        onChangeMetadata: (next) => {
          state.metadata = next;
          state.writes += 1;
          render(props);
        },
        onRememberType: (key, type) => state.remembered.push([key, type]),
        onExit: () => {
          state.exits += 1;
        },
        ...props,
      }));
    });
  render();
  return { state, container, render, unmount: () => act(() => root.unmount()) };
}

const setValue = (element, value) =>
  act(() => {
    const proto = Object.getPrototypeOf(element);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
const blur = (element) => act(() => element.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
const key = (element, name, init = {}) =>
  act(() => element.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, ...init })));
const click = (element) => act(() => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const row = (container, name) => container.querySelector(`[data-property-key="${name}"]`);
const buttonByText = (container, text) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent.includes(text));

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("項目ごとに型・名前・値を出し、扱えない値はソースへ案内する", () => {
  const { container, unmount } = mount(ARTICLE);
  const keys = [...container.querySelectorAll(".propertyKey")].map((input) => input.value);
  assert.deepEqual(keys, ["slug", "publish", "tags", "description", "series"]);
  assert.equal(row(container, "publish").querySelector("input[type=checkbox]").checked, false);
  assert.ok(row(container, "series").textContent.includes("ソースで編集"));
  unmount();
});

test("チェックボックスを変えると、その行だけが変わる", () => {
  const { container, state, unmount } = mount(ARTICLE);
  click(row(container, "publish").querySelector("input[type=checkbox]"));
  assert.equal(state.metadata, ARTICLE.replace("publish: false", "publish: true"));
  unmount();
});

test("テキストは確定（Enter・フォーカス移動）したときだけ書く", () => {
  const { container, state, unmount } = mount(ARTICLE);
  const text = row(container, "description").querySelector("textarea");
  setValue(text, "書き換えた説明");
  assert.equal(state.writes, 0);
  key(text, "Enter");
  assert.equal(state.metadata, ARTICLE.replace("description: Thenを作った話", "description: 書き換えた説明"));
  setValue(text, "もう一度");
  key(text, "Enter", { isComposing: true });
  assert.equal(state.writes, 1, "変換中のEnterでは書かない");
  blur(text);
  assert.ok(state.metadata.includes("description: もう一度"));
  unmount();
});

test("リストに項目を足し、×で消せる", () => {
  const { container, state, unmount } = mount(ARTICLE);
  const input = row(container, "tags").querySelector(".propertyChipInput");
  setValue(input, "縦書き");
  key(input, "Enter");
  assert.ok(state.metadata.includes("tags:\n  - 開発\n  - 縦書き\n"));
  click(row(container, "tags").querySelector('[aria-label="開発を削除"]'));
  assert.ok(state.metadata.includes("tags:\n  - 縦書き\n"));
  unmount();
});

test("名前を変えられ、重複する名前は元に戻す", () => {
  const { container, state, unmount } = mount(ARTICLE);
  const slug = row(container, "slug").querySelector(".propertyKey");
  setValue(slug, "publish");
  assert.equal(slug.getAttribute("aria-invalid"), "true");
  blur(slug);
  assert.equal(slug.value, "slug");
  assert.equal(state.writes, 0);
  setValue(slug, "url");
  key(slug, "Enter");
  assert.ok(state.metadata.includes("url: making-then"));
  unmount();
});

test("値を失う型変更は確認してから行い、型を覚える", () => {
  const { container, state, unmount } = mount(ARTICLE);
  click(row(container, "slug").querySelector(".propertyTypeButton"));
  click(buttonByText(container, "数値"));
  assert.ok(buttonByText(container, "値を消して数値にする"));
  assert.equal(state.writes, 0);
  click(buttonByText(container, "値を消して数値にする"));
  assert.ok(state.metadata.includes("\nslug:\n"));
  assert.deepEqual(state.remembered, [["slug", "number"]]);
  unmount();
});

test("値を失わない型変更はすぐ行う", () => {
  const { container, state, unmount } = mount("count: 12");
  click(row(container, "count").querySelector(".propertyTypeButton"));
  click(buttonByText(container, "テキスト"));
  assert.equal(state.metadata, 'count: "12"');
  assert.deepEqual(state.remembered, [["count", "text"]]);
  unmount();
});

test("名前を入れて追加し、覚えた型と候補を使う", () => {
  const { container, state, render, unmount } = mount(ARTICLE, { typeSettings: { date: "date", publish: "checkbox" } });
  render({ addRequest: 1 });
  const input = container.querySelector('[aria-label="新しいプロパティ名"]');
  assert.ok(container.querySelector(".propertySuggestions").textContent.includes("date"));
  assert.ok(!container.querySelector(".propertySuggestions").textContent.includes("publish"), "既存の名前は候補に出さない");
  setValue(input, "date");
  key(input, "Enter");
  assert.ok(state.metadata.endsWith("\ndate:"));
  assert.ok(row(container, "date").querySelector('input[type="date"]'));
  unmount();
});

test("ソース表示：不正なYAMLはファイルに書かず、下書きとして残す", () => {
  const first = mount("a: 1", { documentKey: "doc-src" });
  first.state.view = "source";
  first.render();
  const area = first.container.querySelector(".propertiesSourceText");
  setValue(area, "a: 1\na: 2");
  assert.equal(first.state.writes, 0);
  assert.ok(first.container.querySelector(".propertiesErrors").textContent.includes("重複"));
  first.unmount();
  // Switching back to the document restores the unsaved draft.
  const again = mount("a: 1", { documentKey: "doc-src" });
  again.state.view = "source";
  again.render();
  assert.equal(again.container.querySelector(".propertiesSourceText").value, "a: 1\na: 2");
  setValue(again.container.querySelector(".propertiesSourceText"), "a: 1\nb: 2");
  assert.equal(again.state.metadata, "a: 1\nb: 2");
  again.unmount();
});

test("YAMLが不正ならフォームは書かず、ソースでの修正へ案内する", () => {
  const { container, state, unmount } = mount("a: 1\na: 2");
  assert.equal(container.querySelectorAll(".propertyRow").length, 0);
  click(buttonByText(container, "ソースで修正"));
  assert.equal(state.view, "source");
  unmount();
});

test("Escapeで本文へ戻る", () => {
  const { container, state, unmount } = mount(ARTICLE);
  key(row(container, "slug").querySelector(".propertyKey"), "Escape");
  assert.equal(state.exits, 1);
  unmount();
});

// FM-22: Undo/Redo of property edits, through the whole pane.
async function mountPanel(initial, documentKey = "doc-a") {
  const state = { metadata: initial, documentKey };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    act(() => {
      root.render(React.createElement(PropertiesPanel, {
        documentKey: state.documentKey,
        metadata: state.metadata,
        hasFrontMatter: state.metadata !== "",
        typeSettings: {},
        onRememberType: () => {},
        onExit: () => {},
        onClear: () => {},
        onChangeMetadata: (next) => {
          state.metadata = next;
          render();
        },
      }));
    });
  render();
  // The form is lazy-loaded.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { state, container, render, unmount: () => act(() => root.unmount()) };
}

const shortcut = (element, key, init = {}) => {
  let event;
  act(() => {
    event = new window.KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...init });
    element.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

test("プロパティの変更を Ctrl+Z で戻し、Ctrl+Shift+Z・Ctrl+Y でやり直す", async () => {
  const { container, state, unmount } = await mountPanel(ARTICLE);
  const checkbox = row(container, "publish").querySelector("input[type=checkbox]");
  click(checkbox);
  const tags = row(container, "tags").querySelector(".propertyChipInput");
  setValue(tags, "縦書き");
  key(tags, "Enter");
  const afterBoth = state.metadata;
  assert.ok(afterBoth.includes("publish: true") && afterBoth.includes("  - 縦書き"));

  assert.equal(shortcut(checkbox, "z"), true);
  assert.ok(state.metadata.includes("publish: true") && !state.metadata.includes("縦書き"));
  shortcut(checkbox, "z");
  assert.equal(state.metadata, ARTICLE);
  assert.equal(shortcut(checkbox, "z"), true, "戻す先がなくてもブラウザの既定動作には渡さない");
  assert.equal(state.metadata, ARTICLE);

  shortcut(checkbox, "z", { shiftKey: true });
  assert.ok(state.metadata.includes("publish: true") && !state.metadata.includes("縦書き"));
  shortcut(checkbox, "y");
  assert.equal(state.metadata, afterBoth);
  unmount();
});

test("確定前の入力欄とYAMLソースでは、欄の中のUndoに任せる", async () => {
  const { container, state, render, unmount } = await mountPanel(ARTICLE);
  const text = row(container, "description").querySelector("textarea");
  setValue(text, "打ちかけ");
  assert.equal(shortcut(text, "z"), false);
  assert.equal(state.metadata, ARTICLE);
  click(container.querySelector('[aria-label="YAMLで編集"]'));
  const source = container.querySelector(".propertiesSourceText");
  assert.ok(source);
  assert.equal(shortcut(source, "z"), false);
  render();
  unmount();
});

test("履歴は文書ごとに分かれ、タブを戻せば続きから戻せる", async () => {
  const { container, state, render, unmount } = await mountPanel("a: 1", "doc-x");
  setValue(row(container, "a").querySelector("input[type=number]"), "2");
  key(row(container, "a").querySelector("input[type=number]"), "Enter");
  assert.equal(state.metadata, "a: 2");

  state.documentKey = "doc-y";
  state.metadata = "b: 1";
  render();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  shortcut(row(container, "b").querySelector(".propertyKey"), "z");
  assert.equal(state.metadata, "b: 1", "別の文書の履歴は使わない");

  state.documentKey = "doc-x";
  state.metadata = "a: 2";
  render();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  shortcut(row(container, "a").querySelector(".propertyKey"), "z");
  assert.equal(state.metadata, "a: 1");
  unmount();
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error.stack}`);
  }
}
if (failed) {
  console.error(`${failed} / ${cases.length} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);
