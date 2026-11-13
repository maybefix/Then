import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// BINDER 1-5: the corkboard. Cards are the manuscripts directly in the folder,
// in its order; materials and folders are not cards. Dragging reorders through
// the binder's reorder; the synopsis is edited on the card.
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const dir = path.resolve("test-artifacts/corkboard");
await mkdir(dir, { recursive: true });
await build({
  entryPoints: ["src/components/corkboard/Corkboard.tsx"],
  outfile: path.join(dir, "corkboard.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/jsx-runtime", "yaml"],
});
const { Corkboard } = await import(`${pathToFileURL(path.join(dir, "corkboard.mjs")).href}?${Date.now()}`);

const file = (name, extra = {}) => ({ path: `C:/w/原稿/${name}`, name, kind: "file", children: [], contentHash: `h-${name}`, ...extra });
const ENTRIES = [
  file("01 第一章.md"),
  { path: "C:/w/原稿/下書き", name: "下書き", kind: "folder", children: [file("下書き/x.md")] },
  file("02 第二章.txt"),
  file("メモ.md", { role: "material" }),
  file("03 第三章.md"),
];
const DISK = {
  "C:/w/原稿/01 第一章.md": "---\nsynopsis: 書庫に眠っていた未発送の手紙。\n---\n本文一",
  "C:/w/原稿/02 第二章.txt": "本文二（概要なし）",
  "C:/w/原稿/03 第三章.md": `---\nsynopsis: ${"長い概要。".repeat(80)}\n---\n本文三`,
};

async function mount(overrides = {}) {
  const calls = { open: [], reorder: [], save: [], read: [] };
  const disk = { ...DISK };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    folderName: "原稿",
    entries: ENTRIES,
    fileProgress: { "C:/w/原稿/01 第一章.md": "revising", "C:/w/原稿/02 第二章.txt": "writing" },
    charCountOf: (p) => ({ "C:/w/原稿/01 第一章.md": 709, "C:/w/原稿/02 第二章.txt": 1237 })[p] ?? null,
    openTabMarkdown: () => null,
    readFile: async (p) => {
      calls.read.push(p);
      return { path: p, name: p, content: disk[p], contentHash: `hash:${disk[p].length}` };
    },
    onSaveSynopsis: async (p, text, base) => {
      calls.save.push([p, text, base?.contentHash ?? null]);
    },
    onOpen: (p) => calls.open.push(p),
    onReorder: (...args) => calls.reorder.push(args),
    ...overrides,
  };
  const render = (next = {}) => act(async () => {
    Object.assign(props, next);
    root.render(React.createElement(Corkboard, { ...props }));
  });
  await render();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return { container, calls, disk, render, unmount: () => act(() => root.unmount()) };
}
const cards = (container) => [...container.querySelectorAll(".corkboardCard")];
const card = (container, name) => cards(container).find((element) => element.getAttribute("aria-label") === name);
const fire = (element, type, init = {}) =>
  act(async () => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, init);
    element.dispatchEvent(event);
  });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const setValue = (element, value) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
const key = (element, name) =>
  act(async () => element.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })));

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("直下の原稿だけを並び順どおりにカードにする（フォルダと素材は出さない）", async () => {
  const { container, unmount } = await mount();
  assert.deepEqual(cards(container).map((element) => element.getAttribute("aria-label")), ["01 第一章.md", "02 第二章", "03 第三章.md"]);
  assert.equal(container.querySelector(".corkboardSummary").textContent, "3 ファイル · 1,946字");
  unmount();
});

test("カードに名前・進捗の印・概要・字数を出し、概要のないカードは概要の欄に何も出さない", async () => {
  const { container, unmount } = await mount();
  const first = card(container, "01 第一章.md");
  assert.equal(first.querySelector(".corkboardProgress").textContent, "推");
  assert.equal(first.querySelector(".corkboardProgress").title, "推敲中");
  assert.equal(first.querySelector(".corkboardSynopsis").textContent, "書庫に眠っていた未発送の手紙。");
  assert.equal(first.querySelector(".corkboardCardFoot").textContent, "709字");
  const second = card(container, "02 第二章");
  assert.equal(second.querySelector(".corkboardProgress").textContent, "執");
  assert.equal(second.querySelector(".corkboardSynopsis").textContent, "");
  assert.equal(card(container, "03 第三章.md").querySelector(".corkboardProgress").textContent, "未");
  assert.equal(card(container, "03 第三章.md").querySelector(".corkboardCardFoot").textContent, "");
  unmount();
});

test("長い概要は全文を持ち、切るのは表示（CSS）だけ", async () => {
  const { container, unmount } = await mount();
  assert.equal(card(container, "03 第三章.md").querySelector(".corkboardSynopsis").textContent, "長い概要。".repeat(80));
  unmount();
});

test("タブで開いているファイルはタブの文から読み、ファイルは読まない", async () => {
  const { container, calls, unmount } = await mount({
    openTabMarkdown: (p) => (p.endsWith("02 第二章.txt") ? "---\nsynopsis: タブの概要\n---\n" : null),
  });
  assert.equal(card(container, "02 第二章").querySelector(".corkboardSynopsis").textContent, "タブの概要");
  assert.ok(!calls.read.some((p) => p.endsWith("02 第二章.txt")));
  unmount();
});

test("概要を押して直し、Enter で確定すると、読んだときの中身を添えて書く", async () => {
  const { container, calls, unmount } = await mount();
  await fire(card(container, "02 第二章").querySelector(".corkboardSynopsis"), "click");
  const input = card(container, "02 第二章").querySelector("textarea");
  assert.ok(input);
  await setValue(input, "最初の宛先。\n坂の上の家。");
  await key(input, "Enter");
  await settle();
  assert.deepEqual(calls.save, [["C:/w/原稿/02 第二章.txt", "最初の宛先。坂の上の家。", `hash:${DISK["C:/w/原稿/02 第二章.txt"].length}`]]);
  assert.equal(card(container, "02 第二章").querySelector("textarea"), null);
  unmount();
});

test("Esc で取り消すと書かない。変えずに確定しても書かない", async () => {
  const { container, calls, unmount } = await mount();
  await fire(card(container, "01 第一章.md").querySelector(".corkboardSynopsis"), "click");
  let input = card(container, "01 第一章.md").querySelector("textarea");
  await setValue(input, "捨てる");
  await key(input, "Escape");
  await fire(card(container, "01 第一章.md").querySelector(".corkboardSynopsis"), "click");
  input = card(container, "01 第一章.md").querySelector("textarea");
  assert.equal(input.value, "書庫に眠っていた未発送の手紙。");
  await key(input, "Enter");
  await settle();
  assert.deepEqual(calls.save, []);
  unmount();
});

test("ダブルクリックと Enter でそのファイルを開く", async () => {
  const { container, calls, unmount } = await mount();
  await fire(card(container, "01 第一章.md"), "dblclick");
  await key(card(container, "03 第三章.md"), "Enter");
  assert.deepEqual(calls.open, ["C:/w/原稿/01 第一章.md", "C:/w/原稿/03 第三章.md"]);
  unmount();
});

test("カードを別のカードの前後へ落とすと、その位置への並べ替えを頼む", async () => {
  const { container, calls, unmount } = await mount();
  const target = card(container, "01 第一章.md");
  target.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 100, right: 200, bottom: 100 });
  const dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
  await fire(card(container, "03 第三章.md"), "dragstart", { dataTransfer });
  await fire(target, "dragover", { dataTransfer, clientX: 20 });
  assert.equal(target.dataset.drop, "before");
  await fire(target, "drop", { dataTransfer });
  assert.deepEqual(calls.reorder, [["C:/w/原稿/03 第三章.md", "C:/w/原稿/01 第一章.md", "before"]]);
  assert.equal(target.dataset.drop, undefined);
  // Onto itself: nothing.
  await fire(card(container, "02 第二章"), "dragstart", { dataTransfer });
  await fire(card(container, "02 第二章"), "dragover", { dataTransfer, clientX: 150 });
  await fire(card(container, "02 第二章"), "drop", { dataTransfer });
  assert.equal(calls.reorder.length, 1);
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
