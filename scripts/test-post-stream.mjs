import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// BINDER 2-1: 右のペイン「アイデア」の投稿の流れ（docs/BINDER_POST_STREAM_PLAN.md）。
// 投稿の並べ方（返信・絞り込み・日の区切り）と、画面から Rust へ送る操作を確かめる。
// Rust の命令は、同じ約束（1件ごとの操作、本文を直す・消すときは行のハッシュを比べる）で動く入れ物に差し替える。
// ファイルの書き方そのものは cargo のテスト（post_stream::tests）で確かめる。
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.__TAURI_INTERNALS__ = {};
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const dir = path.resolve("test-artifacts/post-stream");
await mkdir(dir, { recursive: true });
const tauriStub = {
  name: "tauri-stub",
  setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "tauri-core", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const invoke = (command, args) => globalThis.__invoke(command, args);",
      loader: "js",
    }));
  },
};
await build({
  stdin: {
    contents: `
      import { createElement, useState } from "react";
      import { PostStreamPane } from "./src/components/posts/PostStreamPane";
      import { usePostStream } from "./src/posts/usePostStream";
      export * from "./src/posts/postModel";
      export function Harness({ scope, legacy, legacyFocusNonce, initialFilter = "inbox", onFilter, showToast }) {
        const stream = usePostStream(scope, { showToast });
        const [filter, setFilter] = useState(initialFilter);
        return createElement(PostStreamPane, {
          stream, filter, legacy, legacyFocusNonce,
          onFilterChange: (next) => { onFilter?.(next); setFilter(next); },
        });
      }`,
    resolveDir: path.resolve("."),
    loader: "tsx",
  },
  outfile: path.join(dir, "post-stream.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/jsx-runtime"],
  plugins: [tauriStub],
});
const model = await import(`${pathToFileURL(path.join(dir, "post-stream.mjs")).href}?${Date.now()}`);
const { Harness, arrangePosts, groupByDay, dayLabel, localIsoNow, normalizePostFilter, countInbox } = model;

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// ---- 並べ方 ----
const post = (id, at, extra = {}) => ({ id, at, body: id, filed: false, noted: false, hash: `h-${id}`, ...extra });
const ids = (rows) => rows.map((row) => `${"  ".repeat(row.depth)}${row.post.id}${row.context ? "(ctx)" : ""}`);
const A = { id: "w-a", name: "作品A" };
const B = { id: "w-b", name: "作品B" };

test("流れの先頭は新しい順、返信は返信先の下に古い順", () => {
  const posts = [
    post("p1", "2026-11-14T09:00:00+09:00"),
    post("p2", "2026-11-14T10:00:00+09:00"),
    post("r2", "2026-11-14T10:30:00+09:00", { replyTo: "p2" }),
    post("r1", "2026-11-14T10:10:00+09:00", { replyTo: "p2" }),
    post("rr", "2026-11-14T11:00:00+09:00", { replyTo: "r1" }),
  ];
  assert.deepEqual(ids(arrangePosts(posts, "all", undefined)), ["p2", "  r1", "    rr", "  r2", "p1"]);
});

test("受信箱は、外したもの・ノートにしたものを出さない。返信が残れば返信先を薄く出す", () => {
  const posts = [
    post("p1", "2026-11-14T09:00:00+09:00", { filed: true }),
    post("r1", "2026-11-14T09:10:00+09:00", { replyTo: "p1" }),
    post("p2", "2026-11-14T10:00:00+09:00", { noted: true }),
    post("p3", "2026-11-14T11:00:00+09:00"),
  ];
  assert.deepEqual(ids(arrangePosts(posts, "inbox", undefined)), ["p3", "p1(ctx)", "  r1"]);
  assert.equal(countInbox(posts), 2);
});

test("「この作品」は作品の ID で見て、ID が合わなければ名前で見る", () => {
  const posts = [
    post("a1", "2026-11-14T09:00:00+09:00", { work: A, filed: true }),
    post("a2", "2026-11-14T10:00:00+09:00", { work: { id: "w-old", name: "作品A" } }),
    post("b1", "2026-11-14T11:00:00+09:00", { work: B }),
    post("n1", "2026-11-14T12:00:00+09:00"),
  ];
  assert.deepEqual(ids(arrangePosts(posts, "work", A)), ["a2", "a1"], "filed posts of the work stay");
  assert.deepEqual(ids(arrangePosts(posts, "work", { id: "", name: "作品B" })), ["b1"], "a work without an id yet");
  assert.deepEqual(ids(arrangePosts(posts, "work", undefined)), []);
});

test("返信先が指し合う投稿や、ない返信先でも、全部を一度ずつ出す", () => {
  const posts = [
    post("x", "2026-11-14T09:00:00+09:00", { replyTo: "y" }),
    post("y", "2026-11-14T10:00:00+09:00", { replyTo: "x" }),
    post("z", "2026-11-14T11:00:00+09:00", { replyTo: "missing" }),
    post("s", "2026-11-14T12:00:00+09:00", { replyTo: "s" }),
  ];
  const rows = ids(arrangePosts(posts, "all", undefined));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.trim()).sort(), ["s", "x", "y", "z"]);
});

test("日の区切りは先頭の投稿の日。今日・昨日・今年・去年", () => {
  const rows = arrangePosts([
    post("today", "2026-11-14T09:00:00+09:00"),
    post("late", "2026-11-14T00:10:00+09:00", { replyTo: "y" }),
    post("y", "2026-11-13T23:50:00+09:00"),
  ], "all", undefined);
  const days = groupByDay(rows);
  assert.deepEqual(days.map((day) => day.rows.map((row) => row.post.id)), [["today"], ["y", "late"]]);
  const now = new Date(2026, 10, 14, 12);
  assert.equal(dayLabel("2026-11-14", now), "今日");
  assert.equal(dayLabel("2026-11-13", now), "昨日");
  assert.equal(dayLabel("2026-3-2", now), "3月2日");
  assert.equal(dayLabel("2025-12-31", now), "2025年12月31日");
});

test("時刻は時差つきの地方時。絞り込みの保存値は分からなければ受信箱", () => {
  assert.match(localIsoNow(new Date(2026, 10, 14, 9, 5, 7)), /^2026-11-14T09:05:07[+-]\d\d:\d\d$/);
  assert.equal(normalizePostFilter("work"), "work");
  assert.equal(normalizePostFilter("starred"), "inbox");
  assert.equal(normalizePostFilter(undefined), "inbox");
});

// ---- 画面と、Rust へ送る操作 ----
/** Rust の post_stream と同じ約束で動く入れ物。 */
function fakeBackend({ work = A, initial = [] } = {}) {
  let lines = initial.map((entry) => ({ ...entry }));
  let revision = 0;
  const calls = [];
  const hashOf = (entry) => `h${JSON.stringify(entry).length}-${entry.body}-${entry.filed}`;
  const view = (entry) => ({ ...entry, filed: Boolean(entry.filed), noted: false, hash: hashOf(entry) });
  const snapshot = () => ({ posts: lines.map(view), work, signature: `s${revision}`, imported: 0 });
  const conflict = () => { throw new Error("POST_CONFLICT: 投稿が外部で変更されたため保存しませんでした"); };
  let counter = 0;
  const backend = {
    calls,
    lines: () => lines,
    /** 外部のエディタで投稿を書き換える。 */
    editOutside(id, body) { lines = lines.map((entry) => entry.id === id ? { ...entry, body } : entry); revision += 1; },
    invoke: async (command, args) => {
      calls.push([command, args]);
      await new Promise((resolve) => setTimeout(resolve, 1));
      switch (command) {
        case "posts_load": return snapshot();
        case "posts_signature": return `s${revision}`;
        case "posts_add":
          counter += 1;
          lines.push({ id: `p-new-${counter}`, at: args.at, body: args.body, work, ...(args.replyTo ? { replyTo: args.replyTo } : {}) });
          revision += 1;
          return snapshot();
        case "posts_update": {
          const index = lines.findIndex((entry) => entry.id === args.id);
          if (index < 0) conflict();
          if (args.body != null) {
            if (args.expectedHash !== hashOf(lines[index])) conflict();
            lines[index] = { ...lines[index], body: args.body, edited: args.editedAt };
          }
          if (args.filed != null) lines[index] = { ...lines[index], filed: args.filed };
          revision += 1;
          return snapshot();
        }
        case "posts_delete": {
          const index = lines.findIndex((entry) => entry.id === args.id);
          if (index < 0 || hashOf(lines[index]) !== args.expectedHash) conflict();
          const [removed] = lines.splice(index, 1);
          revision += 1;
          return { snapshot: snapshot(), line: JSON.stringify(removed), index };
        }
        case "posts_restore": {
          const entry = JSON.parse(args.line);
          if (!lines.some((existing) => existing.id === entry.id)) lines.splice(args.index, 0, entry);
          revision += 1;
          return snapshot();
        }
        default: throw new Error(`unexpected command ${command}`);
      }
    },
  };
  globalThis.__invoke = backend.invoke;
  return backend;
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function mount(props = {}) {
  const toasts = [];
  const filters = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const current = {
    scope: "C:/lib/作品A",
    showToast: (message, action) => toasts.push({ message, action }),
    onFilter: (filter) => filters.push(filter),
    ...props,
  };
  const render = async (next = {}) => {
    Object.assign(current, next);
    await act(async () => root.render(React.createElement(Harness, { ...current })));
    await settle();
  };
  await render();
  return { container, toasts, filters, render, unmount: () => act(() => root.unmount()) };
}

const bodies = (container) => [...container.querySelectorAll(".postItem")].map((element) =>
  `${element.classList.contains("isReply") ? "> " : ""}${element.querySelector(".postBody").textContent}`);
const chip = (container, label) => [...container.querySelectorAll(".ideaChip")].find((element) => element.textContent.startsWith(label));
const button = (scope, label) => [...scope.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === label || element.textContent === label);
const setValue = (element, value) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
const key = (element, name, init = {}) =>
  act(async () => element.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })));
const click = async (element) => {
  assert.ok(element, "the button exists");
  await act(async () => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await settle();
};
const composer = (container) => container.querySelector('textarea[aria-label="投稿"]');
const item = (container, body) => [...container.querySelectorAll(".postItem")].find((element) => element.querySelector(".postBody").textContent === body);

test("Enter で投稿する。時刻を付けて送り、入力欄を空にする。変換中の Enter と Shift+Enter では送らない", async () => {
  const backend = fakeBackend();
  const { container, unmount } = await mount();
  assert.equal(backend.calls[0][0], "posts_load");
  assert.equal(backend.calls[0][1].scopePath, "C:/lib/作品A");
  await setValue(composer(container), "閉局の日に、返事が集まる。");
  await key(composer(container), "Enter", { isComposing: true });
  await key(composer(container), "Enter", { shiftKey: true });
  await settle();
  assert.equal(backend.calls.filter(([command]) => command === "posts_add").length, 0);
  await key(composer(container), "Enter");
  await settle();
  const [, args] = backend.calls.find(([command]) => command === "posts_add");
  assert.equal(args.body, "閉局の日に、返事が集まる。");
  assert.equal(args.replyTo, null);
  assert.match(args.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  assert.equal(composer(container).value, "");
  assert.deepEqual(bodies(container), ["閉局の日に、返事が集まる。"]);
  assert.equal(chip(container, "受信箱").textContent, "受信箱1");
  unmount();
});

test("返信は返信先の ID を付けて送り、返信先の下に出る", async () => {
  const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "親", work: A }] });
  const { container, unmount } = await mount();
  await click(button(item(container, "親"), "返信"));
  const reply = container.querySelector('textarea[aria-label="返信"]');
  await setValue(reply, "子");
  await key(reply, "Enter");
  await settle();
  const [, args] = backend.calls.find(([command]) => command === "posts_add");
  assert.equal(args.replyTo, "p1");
  assert.deepEqual(bodies(container), ["親", "> 子"]);
  assert.equal(container.querySelector('textarea[aria-label="返信"]'), null, "the reply box closes");
  unmount();
});

test("受信箱から外すと受信箱から消え、「元に戻す」で戻る。「すべて」には残る", async () => {
  const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "外す", work: A }] });
  const { container, toasts, filters, unmount } = await mount();
  await click(button(item(container, "外す"), "受信箱から外す"));
  assert.deepEqual(backend.calls.find(([command]) => command === "posts_update")[1], {
    scopePath: "C:/lib/作品A", id: "p1", expectedHash: null, body: null, editedAt: null, filed: true,
  });
  assert.deepEqual(bodies(container), []);
  await click(chip(container, "すべて"));
  assert.deepEqual(filters, ["all"]);
  assert.deepEqual(bodies(container), ["外す"]);
  assert.ok(button(item(container, "外す"), "受信箱に戻す"));
  assert.equal(toasts.at(-1).message, "受信箱から外しました");
  await act(async () => toasts.at(-1).action.onClick());
  await settle();
  assert.equal(backend.lines()[0].filed, false);
  assert.ok(button(item(container, "外す"), "受信箱から外す"));
  unmount();
});

test("削除は行のハッシュを付けて送り、「元に戻す」で同じ位置に戻す", async () => {
  const backend = fakeBackend({ initial: [
    { id: "p1", at: "2026-11-14T09:00:00+09:00", body: "一", work: A },
    { id: "p2", at: "2026-11-14T10:00:00+09:00", body: "二", work: A },
  ] });
  const { container, toasts, unmount } = await mount();
  const target = item(container, "一");
  await click(button(target, "その他の操作"));
  await click(button(target, "削除"));
  const [, args] = backend.calls.find(([command]) => command === "posts_delete");
  assert.equal(args.id, "p1");
  assert.ok(args.expectedHash.startsWith("h"));
  assert.deepEqual(bodies(container), ["二"]);
  assert.equal(toasts.at(-1).message, "投稿を削除しました");
  await act(async () => toasts.at(-1).action.onClick());
  await settle();
  const [, restore] = backend.calls.find(([command]) => command === "posts_restore");
  assert.equal(restore.index, 0);
  assert.deepEqual(backend.lines().map((entry) => entry.id), ["p1", "p2"]);
  assert.deepEqual(bodies(container), ["二", "一"]);
  unmount();
});

test("本文はその場で直せる。外で直されていたら書かず、読み直し、直した文を入力欄に残す", async () => {
  const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "元", work: A }] });
  const { container, toasts, unmount } = await mount();
  let body = item(container, "元").querySelector(".postBody");
  body.textContent = "直した";
  await act(async () => body.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
  await settle();
  const [, args] = backend.calls.find(([command]) => command === "posts_update");
  assert.equal(args.body, "直した");
  assert.match(args.editedAt, /T/);
  assert.equal(backend.lines()[0].body, "直した");

  backend.editOutside("p1", "外で直した");
  body = item(container, "直した").querySelector(".postBody");
  body.textContent = "アプリで直した";
  await act(async () => body.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
  await settle();
  assert.equal(backend.lines()[0].body, "外で直した", "the change made outside is kept");
  assert.equal(toasts.at(-1).message, "投稿がほかで変更されていたため、読み込み直しました");
  assert.equal(composer(container).value, "アプリで直した");
  assert.ok(item(container, "外で直した"), "reloaded");
  unmount();
});

test("「この作品」は作品を開いているときだけ。ほかの作品の投稿には作品名を出す", async () => {
  fakeBackend({ initial: [
    { id: "a", at: "2026-11-14T09:00:00+09:00", body: "Aの", work: A },
    { id: "b", at: "2026-11-14T10:00:00+09:00", body: "Bの", work: B },
  ] });
  const { container, unmount } = await mount();
  assert.equal(item(container, "Aの").querySelector(".postWork"), null);
  assert.equal(item(container, "Bの").querySelector(".postWork").textContent, "作品B");
  await click(chip(container, "この作品"));
  assert.deepEqual(bodies(container), ["Aの"]);
  unmount();

  fakeBackend({ work: null, initial: [{ id: "a", at: "2026-11-14T09:00:00+09:00", body: "Aの", work: A }] });
  const atRoot = await mount({ scope: "C:/lib", initialFilter: "work" });
  assert.equal(chip(atRoot.container, "この作品"), undefined);
  assert.deepEqual(bodies(atRoot.container), ["Aの"], "without a work, the inbox is shown");
  assert.equal(chip(atRoot.container, "受信箱").getAttribute("aria-pressed"), "true");
  atRoot.unmount();
});

test("「以前のアイデア」で今の Idea を出し、Canvas からの要求でも切り替える。フォルダがなければ今の Idea をそのまま出す", async () => {
  const backend = fakeBackend();
  const legacy = React.createElement("div", { className: "legacyMarker" }, "古い");
  // BINDER 2-1 の後退 R3: フォルダを開いていなくても、2-1 の前と同じく今の Idea で書ける。
  const none = await mount({ scope: null, legacy });
  assert.ok(none.container.querySelector(".legacyMarker"), "no folder: the current Idea is shown as it was");
  assert.equal(composer(none.container), null, "no folder: no post box that cannot post");
  assert.equal(chip(none.container, "受信箱"), undefined);
  assert.equal(backend.calls.length, 0);
  none.unmount();

  fakeBackend();
  const open = await mount({ legacy });
  assert.equal(open.container.querySelector(".legacyMarker"), null, "a folder: the post stream comes first");
  await click(chip(open.container, "以前のアイデア"));
  assert.ok(open.container.querySelector(".legacyMarker"));
  assert.equal(composer(open.container), null);
  await click(chip(open.container, "受信箱"));
  assert.equal(open.container.querySelector(".legacyMarker"), null);
  open.unmount();

  fakeBackend();
  const pending = await mount({ legacy, legacyFocusNonce: 7 });
  assert.ok(pending.container.querySelector(".legacyMarker"), "a request already waiting when the pane opens");
  await click(chip(pending.container, "受信箱"));
  await pending.render({ legacyFocusNonce: 8 });
  assert.ok(pending.container.querySelector(".legacyMarker"), "a new request switches again");
  await pending.render({ legacy: undefined });
  assert.equal(chip(pending.container, "以前のアイデア"), undefined);
  assert.ok(composer(pending.container));
  pending.unmount();
});

test("アプリに戻ったとき、ファイルが変わっていれば読み直し、変わっていなければ読まない", async () => {
  const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "元", work: A }] });
  const { container, unmount } = await mount();
  const loads = () => backend.calls.filter(([command]) => command === "posts_load").length;
  const before = loads();
  await act(async () => window.dispatchEvent(new window.Event("focus")));
  await settle();
  assert.equal(loads(), before, "unchanged: not read again");
  backend.editOutside("p1", "外で直した");
  await act(async () => window.dispatchEvent(new window.Event("focus")));
  await settle();
  assert.equal(loads(), before + 1);
  assert.ok(item(container, "外で直した"));
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
dom.window.close();
if (failed) {
  console.error(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`post stream tests passed (${cases.length})`);
