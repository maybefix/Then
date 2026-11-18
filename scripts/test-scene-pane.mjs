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
await build({
  entryPoints: ["src/links/linkIndex.ts"],
  outfile: path.join(dir, "link-index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["yaml"],
});
const { LinkIndex } = await import(`${pathToFileURL(path.join(dir, "link-index.mjs")).href}?${Date.now()}`);

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

// BINDER 3-3: 素材の欄。行き先は本物の索引（3-1）に聞く。
const ROOT = "C:\\Novel";
const p = (relative) => `${ROOT}\\${relative.split("/").join("\\")}`;
async function workIndex() {
  const files = ["素材/汐見.md", "素材/灯.md", "素材/人物/港.md", "素材/a#b.md", "素材/地図.png", "第一章/a.md"];
  const index = new LinkIndex(ROOT);
  await index.refresh(
    files.map((relative) => ({
      path: p(relative),
      kind: /\.md$/.test(relative) ? "text" : "asset",
      modifiedAt: 1,
      size: 0,
      role: relative.startsWith("素材") ? "material" : null,
    })),
    async () => "",
  );
  return index;
}
const MATERIALS = '---\r\nslug: a # 残す\r\nmaterials:\r\n  - "[[汐見]]"\r\n  - "[[消えたノート]]"\r\n  - 汐見メモ\r\ntags: [x]\r\n---\r\n\r\n　本文。\r\n';
async function mountMaterials(overrides = {}) {
  const opened = [];
  const index = overrides.index === undefined ? await workIndex() : overrides.index;
  const view = await mount({
    markdown: MATERIALS,
    materials: { index, version: 1, onOpen: (link) => opened.push(link) },
    ...overrides,
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return { ...view, opened, index };
}
const section = (container) => container.querySelector(".sceneMaterials");
const rows = (container) => [...container.querySelectorAll(".sceneMaterial")].map((row) =>
  `${row.dataset.linkState}:${row.querySelector(".sceneMaterialOpen").textContent}`);
const addButton = (container) => container.querySelector(".sceneMaterialAdd");
const pickerOptions = (container) => [...container.querySelectorAll(".sceneMaterialOption")].map((option) => option.textContent);
const query = (container) => container.querySelector(".sceneMaterialQuery");
const LIST = 'materials:\r\n  - "[[汐見]]"\r\n  - "[[消えたノート]]"\r\n  - 汐見メモ\r\n';

test("素材の欄: 項目と数、行き先のない項目は薄く押せない、ただの文字は押せない", async () => {
  const { container, unmount } = await mountMaterials();
  assert.ok(section(container));
  assert.equal(container.querySelector(".sceneSectionCount").textContent, "3");
  assert.deepEqual(rows(container), ["one:汐見", "none:消えたノート", "text:汐見メモ"]);
  const buttons = [...container.querySelectorAll(".sceneMaterialOpen")];
  assert.deepEqual(buttons.map((button) => button.disabled), [false, true, true]);
  assert.equal(section(container).hasAttribute("data-scene-materials-drop"), true);
  assert.equal(container.querySelectorAll(".sceneMaterialRemove").length, 3);
  unmount();
});

test("素材の欄は materials を渡したときだけ（原稿だけ、決定1）", async () => {
  const { container, unmount } = await mount({ markdown: MATERIALS });
  assert.equal(section(container), null);
  unmount();
});

test("項目を押すと 3-2 と同じ流れで開く。「リンクを直して開く」は materials のその名前だけを直す", async () => {
  const { container, calls, opened, unmount } = await mountMaterials();
  await click(container.querySelector(".sceneMaterialOpen"));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].kind, "name");
  assert.equal(opened[0].target, "汐見");
  await act(async () => opened[0].rewriteTarget("人物/汐見"));
  assert.deepEqual(calls.change, [MATERIALS.replace('"[[汐見]]"', '"[[人物/汐見]]"')]);
  unmount();
});

test("「＋」: 入っていないノートだけ。# を含む名前・画像・原稿は出さない。打つと絞り込み、Enter で足す", async () => {
  const { container, calls, unmount } = await mountMaterials();
  assert.equal(addButton(container).disabled, false);
  await click(addButton(container));
  assert.deepEqual(pickerOptions(container), ["港", "灯"]);
  await setValue(query(container), "灯");
  assert.deepEqual(pickerOptions(container), ["灯"]);
  await key(query(container), "Enter", { isComposing: true });
  assert.deepEqual(calls.change, [], "Enter while composing does not add");
  await key(query(container), "Enter");
  assert.deepEqual(calls.change, [MATERIALS.replace(LIST, `${LIST}  - "[[灯]]"\r\n`)]);
  assert.equal(query(container), null, "the picker closes after adding");
  unmount();
});

test("「＋」: ↑↓で選び、Esc で閉じる。押しても足せる", async () => {
  const { container, calls, unmount } = await mountMaterials();
  await click(addButton(container));
  await key(query(container), "ArrowDown");
  assert.equal(container.querySelector(".sceneMaterialOption.isActive").textContent, "灯");
  await key(query(container), "Escape");
  assert.equal(query(container), null);
  assert.equal(calls.exit, 0, "Escape in the picker does not leave the pane");
  await click(addButton(container));
  await click(container.querySelectorAll(".sceneMaterialOption")[0]);
  assert.deepEqual(calls.change, [MATERIALS.replace(LIST, `${LIST}  - "[[港]]"\r\n`)]);
  unmount();
});

test("「＋」: 足せるノートがなければ押せない。索引がまだなければ一覧は空", async () => {
  const all = await mountMaterials({ markdown: '---\nmaterials: ["[[汐見]]", "[[灯]]", "[[港]]"]\n---\n本文' });
  assert.equal(addButton(all.container).disabled, true);
  all.unmount();
  const noIndex = await mountMaterials({ index: null });
  assert.deepEqual(rows(noIndex.container), ["unknown:汐見", "unknown:消えたノート", "text:汐見メモ"]);
  assert.equal(addButton(noIndex.container).disabled, true);
  noIndex.unmount();
});

test("「×」: その項目だけ外す。最後の1つなら materials: [] を残す（決定3）", async () => {
  const { container, calls, unmount } = await mountMaterials();
  await click(container.querySelectorAll(".sceneMaterialRemove")[1]);
  assert.deepEqual(calls.change, [MATERIALS.replace('  - "[[消えたノート]]"\r\n', "")]);
  unmount();
  const last = await mountMaterials({ markdown: '---\nslug: a\nmaterials:\n  - "[[汐見]]"\n---\n本文' });
  await click(last.container.querySelector(".sceneMaterialRemove"));
  assert.deepEqual(last.calls.change, ["---\nslug: a\nmaterials: []\n---\n本文"]);
  last.unmount();
});

test("バインダーから落としたノートを足す。原稿・入っているノートは足さない", async () => {
  const { container, calls, unmount } = await mountMaterials();
  await act(async () => section(container).dispatchEvent(new window.CustomEvent("then-materials-drop", {
    detail: { paths: [p("第一章/a.md"), p("素材/汐見.md"), p("素材/人物/港.md"), p("素材/灯.md")] },
  })));
  assert.deepEqual(calls.change, [MATERIALS.replace(LIST, `${LIST}  - "[[港]]"\r\n  - "[[灯]]"\r\n`)]);
  unmount();
});

test("素材のない原稿に足すとキーを足す。フロントマターのない原稿には作る", async () => {
  const { container, calls, unmount } = await mountMaterials({ markdown: WITHOUT });
  assert.equal(container.querySelector(".sceneSectionCount").textContent, "0");
  assert.equal(container.querySelectorAll(".sceneMaterial").length, 0);
  await click(addButton(container));
  await key(query(container), "Enter");
  assert.deepEqual(calls.change, ['---\nmaterials:\n  - "[[港]]"\n---\n本文だけ（概要なし）。\n']);
  unmount();
});

test("書けない形は読むだけ（決定5）: 開けるが、＋・×・落とす先はない", async () => {
  const { container, opened, unmount } = await mountMaterials({ markdown: "---\nmaterials:\n  - [[汐見]]\n---\n本文" });
  assert.deepEqual(rows(container), ["one:汐見"]);
  assert.equal(addButton(container), null);
  assert.equal(container.querySelectorAll(".sceneMaterialRemove").length, 0);
  assert.equal(section(container).hasAttribute("data-scene-materials-drop"), false);
  await click(container.querySelector(".sceneMaterialOpen"));
  assert.equal(opened.length, 1);
  unmount();
  const broken = await mountMaterials({ markdown: "---\nmaterials: [oops\n---\n本文" });
  assert.equal(section(broken.container), null);
  broken.unmount();
});

test("本文だけ変わったときは同じ表示のまま。フロントマターが変われば読み直す", async () => {
  const { container, render, unmount } = await mountMaterials();
  await render({ markdown: MATERIALS.replace("本文。", "本文が増えた。") });
  assert.deepEqual(rows(container), ["one:汐見", "none:消えたノート", "text:汐見メモ"]);
  await render({ markdown: MATERIALS.replace("  - 汐見メモ\r\n", "") });
  assert.deepEqual(rows(container), ["one:汐見", "none:消えたノート"]);
  unmount();
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
