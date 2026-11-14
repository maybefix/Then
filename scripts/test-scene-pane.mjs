import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// BINDER 1-7: the right pane 「この場面」. It shows the synopsis and the progress
// of the document shown in the body; the synopsis goes into that tab's text
// (only its synopsis line changes) when the field is committed, and progress
// goes through the binder's progress call.
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const dir = path.resolve("test-artifacts/scene-pane");
await mkdir(dir, { recursive: true });
await build({
  entryPoints: ["src/components/scene/ScenePane.tsx"],
  outfile: path.join(dir, "scene-pane.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/jsx-runtime", "yaml"],
});
const { ScenePane } = await import(`${pathToFileURL(path.join(dir, "scene-pane.mjs")).href}?${Date.now()}`);

const WITH = "---\r\nslug: a # 残す\r\nsynopsis: 書庫に眠っていた未発送の手紙。\r\ntags:\r\n  - x\r\n---\r\n\r\n　本文。\r\n";
const WITHOUT = "本文だけ（概要なし）。\n";

async function mount(overrides = {}) {
  const calls = { change: [], progress: [], exit: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    documentKey: "tab-1",
    markdown: WITH,
    onChangeMarkdown: (next) => calls.change.push(next),
    progress: "revising",
    onSetProgress: (status) => calls.progress.push(status),
    onExit: () => { calls.exit += 1; },
    ...overrides,
  };
  const render = (next = {}) => act(async () => {
    Object.assign(props, next);
    root.render(React.createElement(ScenePane, { ...props }));
  });
  await render();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return { container, calls, render, unmount: () => act(() => root.unmount()) };
}
const field = (container) => container.querySelector("textarea.sceneSynopsis");
const options = (container) => [...container.querySelectorAll(".sceneProgressOption")];
const setValue = (element, value) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
const key = (element, name, init = {}) =>
  act(async () => element.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })));
const blur = (element) => act(async () => element.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
const click = (element) => act(async () => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("概要と進捗を出す。見出しは対応表の「概要」と「進捗」", async () => {
  const { container, unmount } = await mount();
  assert.equal(field(container).value, "書庫に眠っていた未発送の手紙。");
  assert.equal(field(container).readOnly, false);
  assert.deepEqual([...container.querySelectorAll(".sceneSectionTitle")].map((element) => element.textContent), ["概要", "進捗"]);
  assert.deepEqual(options(container).map((element) => element.textContent), ["未", "執", "推", "完", "ア"]);
  assert.deepEqual(options(container).map((element) => element.getAttribute("aria-checked")), ["false", "false", "true", "false", "false"]);
  assert.equal(options(container)[2].title, "推敲中");
  unmount();
});

test("概要がない・空・読むだけ・YAMLの誤り", async () => {
  const none = await mount({ markdown: WITHOUT });
  assert.equal(field(none.container).value, "");
  assert.equal(field(none.container).readOnly, false);
  none.unmount();
  const empty = await mount({ markdown: "---\nsynopsis:\n---\n本文" });
  assert.equal(field(empty.container).value, "");
  assert.equal(field(empty.container).readOnly, false);
  empty.unmount();
  const block = await mount({ markdown: "---\nsynopsis: |\n  一行目\n  二行目\n---\n本文" });
  assert.equal(field(block.container).value, "一行目 二行目");
  assert.equal(field(block.container).readOnly, true, "a value the form cannot edit is shown, not edited");
  block.unmount();
  const broken = await mount({ markdown: "---\nsynopsis: a\n: : b\n---\n本文" });
  assert.equal(field(broken.container).value, "");
  assert.equal(field(broken.container).readOnly, true);
  broken.unmount();
});

test("Enter で確定すると、概要の行だけを変えた文をタブへ渡す", async () => {
  const { container, calls, unmount } = await mount();
  await setValue(field(container), "後の概要");
  assert.deepEqual(calls.change, [], "typing alone writes nothing");
  await key(field(container), "Enter");
  assert.deepEqual(calls.change, [WITH.replace("synopsis: 書庫に眠っていた未発送の手紙。", "synopsis: 後の概要")]);
  unmount();
});

test("フォーカスを外して確定する。概要のない文書には足す。改行は入らない", async () => {
  const { container, calls, unmount } = await mount({ markdown: WITHOUT });
  await setValue(field(container), "あら\nすじ");
  await blur(field(container));
  assert.deepEqual(calls.change, ["---\nsynopsis: あらすじ\n---\n本文だけ（概要なし）。\n"]);
  unmount();
});

test("全部消すと空の synopsis: を残す", async () => {
  const { container, calls, unmount } = await mount();
  await setValue(field(container), "");
  await key(field(container), "Enter");
  assert.equal(calls.change.length, 1);
  assert.match(calls.change[0], /\r\nsynopsis:\r\n/);
  assert.match(calls.change[0], /slug: a # 残す\r\n/);
  unmount();
});

test("変えずに確定しても書かない。Esc は取り消して本文へ戻る。変換中の Enter では確定しない", async () => {
  const { container, calls, unmount } = await mount();
  await key(field(container), "Enter");
  await blur(field(container));
  assert.deepEqual(calls.change, [], "unchanged: nothing written");
  await setValue(field(container), "途中");
  await key(field(container), "Enter", { isComposing: true });
  assert.deepEqual(calls.change, [], "Enter while composing does not commit");
  await key(field(container), "Escape");
  assert.equal(calls.exit, 1);
  assert.equal(field(container).value, "書庫に眠っていた未発送の手紙。", "Escape puts the synopsis back");
  await blur(field(container));
  assert.deepEqual(calls.change, [], "nothing written after Escape");
  unmount();
});

test("ほかで直した概要（プロパティ欄・コルクボード）がすぐ出る", async () => {
  const { container, render, unmount } = await mount();
  await render({ markdown: WITH.replace("書庫に眠っていた未発送の手紙。", "直した概要") });
  assert.equal(field(container).value, "直した概要");
  unmount();
});

test("タブが替わったら、入力途中の概要は捨てて、新しいタブの概要を出す", async () => {
  const { container, calls, render, unmount } = await mount();
  await setValue(field(container), "前のタブで入力途中");
  await render({ documentKey: "tab-2", markdown: WITHOUT, progress: "todo" });
  assert.equal(field(container).value, "");
  await blur(field(container));
  assert.deepEqual(calls.change, [], "the previous tab's draft is not written into the new tab");
  assert.equal(options(container)[0].getAttribute("aria-checked"), "true");
  unmount();
});

test("進捗のボタンで進捗を変える。同じものを押しても呼ばない", async () => {
  const { container, calls, unmount } = await mount();
  await click(options(container)[1]);
  await click(options(container)[2]);
  assert.deepEqual(calls.progress, ["writing"]);
  unmount();
});

test("進捗のない文書（素材など）は進捗の区画を出さない。文書がないときは中を空にする", async () => {
  const material = await mount({ progress: null });
  assert.equal(options(material.container).length, 0);
  assert.ok(field(material.container), "the synopsis is still shown");
  material.unmount();
  const empty = await mount({ markdown: null, progress: null });
  assert.equal(empty.container.querySelector(".scenePane").children.length, 0);
  assert.equal(empty.container.textContent, "");
  empty.unmount();
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`NG - ${name}`);
    console.log(error);
  }
}
console.log(`${cases.length - failed} passed`);
if (failed) process.exit(1);
