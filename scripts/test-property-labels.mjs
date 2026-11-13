import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// BINDER 1-5 (3.5b): the key → name table. The properties form shows 「概要」 for
// synopsis, keeps writing the English key, and leaves every other key as written.
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.CSS = { escape: (value) => value.replace(/["\\]/g, "\\$&") };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const dir = path.resolve("test-artifacts/property-labels");
await mkdir(dir, { recursive: true });
const bundle = async (entry, name) => {
  await build({
    entryPoints: [entry],
    outfile: path.join(dir, name),
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    loader: { ".css": "empty" },
    external: ["react", "react/jsx-runtime", "yaml"],
  });
  return import(`${pathToFileURL(path.join(dir, name)).href}?${Date.now()}`);
};
const { default: PropertiesForm } = await bundle("src/components/properties/PropertiesForm.tsx", "form.mjs");
const labels = await bundle("src/properties/propertyLabels.ts", "labels.mjs");

function mount(initial, typeSettings = {}) {
  const state = { metadata: initial, remembered: [] };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let addRequest = 0;
  const render = () =>
    act(() => {
      root.render(React.createElement(PropertiesForm, {
        documentKey: "labels",
        metadata: state.metadata,
        typeSettings,
        view: "form",
        addRequest,
        onViewChange: () => {},
        onChangeMetadata: (next) => {
          state.metadata = next;
          render();
        },
        onRememberType: (key, type) => state.remembered.push([key, type]),
        onExit: () => {},
      }));
    });
  render();
  return {
    state,
    container,
    requestAdd: () => {
      addRequest += 1;
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}
const setValue = (element, value) =>
  act(() => {
    const proto = Object.getPrototypeOf(element);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
const key = (element, name) =>
  act(() => element.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true })));
const row = (container, name) => container.querySelector(`[data-property-key="${name}"]`);

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("対応表は synopsis・materials・sourceCards の3つ", () => {
  assert.deepEqual(
    Object.entries(labels.PROPERTY_LABELS).map(([k, v]) => [k, v.label, v.type]),
    [["synopsis", "概要", "text"], ["materials", "素材", "list"], ["sourceCards", "元のカード", "list"]],
  );
  assert.equal(labels.propertyLabel("synopsis"), "概要");
  assert.equal(labels.propertyLabel("title"), null);
  assert.equal(labels.propertyLabel("toString"), null);
  assert.equal(labels.keyOfLabel("素材"), "materials");
  assert.equal(labels.keyOfLabel("synopsis"), null);
});

test("概要の行は「概要」と出し、キーは title に出し、名前は変えられない", () => {
  const { container, unmount } = mount("synopsis: 書庫に眠っていた手紙。\nslug: a");
  const name = row(container, "synopsis").querySelector(".propertyKey");
  assert.equal(name.value, "概要");
  assert.equal(name.title, "synopsis");
  assert.equal(name.readOnly, true);
  assert.equal(row(container, "synopsis").querySelector(".propertyRemove").getAttribute("aria-label"), "概要を削除");
  const other = row(container, "slug").querySelector(".propertyKey");
  assert.equal(other.value, "slug");
  assert.equal(other.readOnly, false);
  unmount();
});

test("概要の値を直すと、英語のキーのまま書く", () => {
  const { container, state, unmount } = mount("slug: a\nsynopsis: 前の概要");
  const value = row(container, "synopsis").querySelector("textarea");
  setValue(value, "新しい概要");
  key(value, "Enter");
  assert.equal(state.metadata, "slug: a\nsynopsis: 新しい概要");
  unmount();
});

test("素材と元のカードはリストのまま表示名で出す", () => {
  const { container, unmount } = mount('materials:\n  - "[[汐見]]"\nsourceCards: []');
  assert.equal(row(container, "materials").querySelector(".propertyKey").value, "素材");
  assert.equal(row(container, "sourceCards").querySelector(".propertyKey").value, "元のカード");
  assert.ok(row(container, "materials").textContent.includes("[[汐見]]"));
  unmount();
});

test("「概要」と打って追加すると synopsis をテキストで足す", () => {
  const { container, state, requestAdd, unmount } = mount("slug: a");
  requestAdd();
  const input = container.querySelector('[aria-label="新しいプロパティ名"]');
  setValue(input, "概要");
  key(input, "Enter");
  assert.equal(state.metadata, "slug: a\nsynopsis:");
  unmount();
});

test("概要があるときに「概要」と打つと、重複として足さない", () => {
  const { container, state, requestAdd, unmount } = mount("synopsis: あり");
  requestAdd();
  const input = container.querySelector('[aria-label="新しいプロパティ名"]');
  setValue(input, "概要");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  key(input, "Enter");
  assert.equal(state.metadata, "synopsis: あり");
  unmount();
});

test("型を覚えたキーの候補は表示名で出し、表示名でも絞り込める", () => {
  const { container, requestAdd, unmount } = mount("slug: a", { synopsis: "text", tags: "list" });
  requestAdd();
  const input = container.querySelector('[aria-label="新しいプロパティ名"]');
  const names = () => [...container.querySelectorAll(".propertySuggestions [role=option] span")].map((span) => span.textContent);
  assert.deepEqual(names(), ["概要", "tags"]);
  setValue(input, "概");
  assert.deepEqual(names(), ["概要"]);
  unmount();
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}\n${error.stack}`);
  }
}
if (failed) throw new Error(`${failed} failed`);
console.log(`${cases.length} passed`);
