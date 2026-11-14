import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// BINDER 2-1: 右のペイン「アイデア」の投稿の流れ（docs/BINDER_POST_STREAM_PLAN.md）。
// BINDER 2-3: 投稿 →「ノートにする」（docs/BINDER_POST_TO_NOTE_PLAN.md）の画面の側の流れも、同じ入れ物で確かめる。
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
      import { createElement, useMemo, useRef, useState } from "react";
      import { PostStreamPane } from "./src/components/posts/PostStreamPane";
      import { usePostStream } from "./src/posts/usePostStream";
      import { createPostNoteActions } from "./src/posts/postNoteActions";
      export * from "./src/posts/postModel";
      export function Harness({ scope, legacy, legacyFocusNonce, initialFilter = "inbox", onFilter, showToast, noteDeps }) {
        const stream = usePostStream(scope, { showToast });
        const [filter, setFilter] = useState(initialFilter);
        // App と同じく、描画のたびに deps を入れ替える（BINDER 2-3）。
        const depsRef = useRef(null);
        depsRef.current = { stream, showToast, projectFolder: scope ? { path: scope, name: "", children: [] } : null, ...noteDeps };
        const noteActions = useMemo(() => createPostNoteActions(depsRef), []);
        return createElement(PostStreamPane, {
          stream, filter, legacy, legacyFocusNonce,
          onFilterChange: (next) => { onFilter?.(next); setFilter(next); },
          onMakeNote: noteDeps && stream.work ? (post) => void noteActions.makeNote(post) : undefined,
          onOpenNote: (post) => void noteActions.openNote(post),
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
const { Harness, arrangePosts, groupByDay, dayLabel, localIsoNow, normalizePostFilter, countInbox, noteThread, noteNameFromBody, noteTextFor, joinWorkPath, noteLabel } = model;

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

// ---- ノートにする（2-3）: まとめ方・名前・本文 ----
test("ノートにするのは、押した投稿とその下の返信（返信の返信も）。古い順で、ノートにした返信は入れない", () => {
  const posts = [
    post("p1", "2026-11-14T09:00:00+09:00"),
    post("r2", "2026-11-14T09:30:00+09:00", { replyTo: "p1" }),
    post("r1", "2026-11-14T09:10:00+09:00", { replyTo: "p1" }),
    post("rr", "2026-11-14T09:40:00+09:00", { replyTo: "r1" }),
    post("rn", "2026-11-14T09:50:00+09:00", { replyTo: "p1", noted: true }),
    post("p2", "2026-11-14T10:00:00+09:00"),
  ];
  assert.deepEqual(noteThread(posts, "p1").map((entry) => entry.id), ["p1", "r1", "r2", "rr"]);
  assert.deepEqual(noteThread(posts, "r1").map((entry) => entry.id), ["r1", "rr"], "a reply takes only what is under it");
  assert.deepEqual(noteThread(posts, "rn"), [], "an already noted post");
  assert.deepEqual(noteThread(posts, "nope"), []);
});

test("名前の初期値は書き出しの1行目。使えない文字と行頭の記号を除き、20字まで", () => {
  assert.equal(noteNameFromBody("\n  閉局の日に、返事が集まる。\n二行目"), "閉局の日に、返事が集まる。");
  assert.equal(noteNameFromBody("# 見出し: A/B?"), "見出し AB");
  assert.equal(noteNameFromBody("- ・ 箇条"), "箇条");
  assert.equal(noteNameFromBody("..隠し"), "隠し");
  assert.equal(noteNameFromBody("一二三四五六七八九十一二三四五六七八九十超える"), "一二三四五六七八九十一二三四五六七八九十");
  assert.equal(noteNameFromBody("😀".repeat(25)), "😀".repeat(20), "counts characters, not UTF-16 units");
  assert.equal(noteNameFromBody("   "), "");
});

test("本文は見出しのあと、投稿1件を1段落。日時は書かない", () => {
  const posts = [post("p1", "2026-11-14T09:00:00+09:00", { body: " 一つ目\n続き " }), post("r1", "2026-11-14T09:10:00+09:00", { body: "二つ目" })];
  assert.equal(noteTextFor(" 手紙 ", posts), "# 手紙\n\n一つ目\n続き\n\n二つ目\n");
});

test("作品のフォルダと相対パスをつなぎ、札にはファイル名を拡張子なしで出す", () => {
  assert.equal(joinWorkPath("C:\\lib\\作品A", "素材/人物/汐見.md"), "C:\\lib\\作品A\\素材\\人物\\汐見.md");
  assert.equal(joinWorkPath("/lib/作品A/", "素材/汐見.md"), "/lib/作品A/素材/汐見.md");
  assert.equal(noteLabel("素材/人物/汐見.md"), "汐見");
  assert.equal(noteLabel("素材/メモ.MD"), "メモ");
});

// ---- 画面と、Rust へ送る操作 ----
/** Rust の post_stream と同じ約束で動く入れ物。 */
function fakeBackend({ work = A, initial = [] } = {}) {
  let lines = initial.map((entry) => ({ ...entry }));
  let revision = 0;
  const calls = [];
  const hashOf = (entry) => `h${JSON.stringify(entry).length}-${entry.body}-${entry.filed}`;
  const view = ({ note, noteExists, ...entry }) => ({
    ...entry,
    filed: Boolean(entry.filed),
    noted: Boolean(note),
    ...(note ? { note: { ...note, exists: noteExists ?? true } } : {}),
    hash: hashOf(entry),
  });
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
        case "posts_make_note": {
          for (const { id, hash } of args.posts) {
            const entry = lines.find((existing) => existing.id === id);
            if (!entry || hashOf(entry) !== hash || entry.note) conflict();
          }
          const notePath = `C:\\lib\\作品A\\素材\\${args.noteName}.md`;
          const note = { work: work.id, path: `素材/${args.noteName}.md`, workRoot: "C:\\lib\\作品A", workName: work.name };
          lines = lines.map((entry) => args.posts.some(({ id }) => id === entry.id) ? { ...entry, note } : entry);
          revision += 1;
          return { snapshot: snapshot(), notePath, noteHash: `nh-${args.noteName}` };
        }
        case "posts_unlink_note": {
          lines = lines.map(({ note, ...entry }) => args.ids.includes(entry.id) ? entry : { ...entry, ...(note ? { note } : {}) });
          revision += 1;
          return { snapshot: snapshot(), noteUnchanged: backend.noteUnchanged ?? true };
        }
        case "posts_retarget_notes": return null;
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

/** 「ノートにする」の App 側の入れ物。呼ばれた操作を記録する。 */
function noteDepsFor({ name = "手紙", dirty = false } = {}) {
  const log = [];
  let active = "C:\\lib\\作品A\\本文.md";
  const deps = {
    requestInput: async (options) => { log.push(["input", options]); return name; },
    refreshProjectFolder: async (folderPath) => { log.push(["refresh", folderPath]); return { path: folderPath, name: "", children: [] }; },
    openFile: async (path) => { log.push(["open", path]); active = path; },
    openFileInWork: async (workRoot, path) => { log.push(["openInWork", workRoot, path]); },
    isFileDirty: () => dirty,
    activeFilePath: () => active,
    trashFile: async (_folder, path) => { log.push(["trash", path]); return true; },
  };
  return { deps, log };
}

test("「ノートにする」は名前を聞き、押した投稿とその下の返信を1本にし、開いて、受信箱から外す", async () => {
  const backend = fakeBackend({ initial: [
    { id: "p1", at: "2026-11-14T09:00:00+09:00", body: "閉局の日に、返事が集まる。", work: A },
    { id: "r1", at: "2026-11-14T09:10:00+09:00", body: "返事を書くのは町の人。", work: A, replyTo: "p1" },
    { id: "p2", at: "2026-11-14T10:00:00+09:00", body: "別の投稿", work: A },
  ] });
  const { deps, log } = noteDepsFor();
  const { container, toasts, unmount } = await mount({ noteDeps: deps });
  await click(button(item(container, "閉局の日に、返事が集まる。"), "ノートにする"));
  const [, options] = log.find(([kind]) => kind === "input");
  assert.equal(options.initialValue, "閉局の日に、返事が集まる。");
  assert.equal(options.confirmLabel, "ノートを作る");
  const [, args] = backend.calls.find(([command]) => command === "posts_make_note");
  assert.deepEqual(args.posts.map((entry) => entry.id), ["p1", "r1"]);
  assert.ok(args.posts.every((entry) => entry.hash.startsWith("h")));
  assert.equal(args.noteName, "手紙");
  assert.equal(args.noteText, "# 手紙\n\n閉局の日に、返事が集まる。\n\n返事を書くのは町の人。\n");
  assert.deepEqual(log.slice(1), [
    ["refresh", "C:/lib/作品A"],
    ["open", "C:\\lib\\作品A\\素材\\手紙.md"],
  ], "the list is read again before the note opens (note mode comes from the list)");
  assert.equal(toasts.at(-1).message, "ノート「手紙」を作りました");
  assert.equal(toasts.at(-1).action.label, "元に戻す");
  assert.deepEqual(bodies(container), ["別の投稿"], "both left the inbox");
  assert.equal(chip(container, "受信箱").textContent, "受信箱1");
  await click(chip(container, "すべて"));
  for (const body of ["閉局の日に、返事が集まる。", "返事を書くのは町の人。"]) {
    const entry = item(container, body);
    assert.equal(entry.querySelector(".postNoteTag").textContent, "手紙");
    assert.equal(button(entry, "ノートにする"), undefined);
    assert.equal(button(entry, "受信箱から外す"), undefined);
    assert.equal(button(entry, "受信箱に戻す"), undefined);
    assert.ok(button(entry, "返信"), "reply stays");
  }
  assert.ok(button(item(container, "別の投稿"), "ノートにする"));
  await click(item(container, "返事を書くのは町の人。").querySelector(".postNoteTag"));
  assert.deepEqual(log.at(-1), ["open", "C:\\lib\\作品A\\素材\\手紙.md"]);
  unmount();
});

test("名前の小窓を閉じたら何も作らない", async () => {
  const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "一", work: A }] });
  const { deps } = noteDepsFor({ name: null });
  const { container, unmount } = await mount({ noteDeps: deps });
  await click(button(item(container, "一"), "ノートにする"));
  assert.equal(backend.calls.some(([command]) => command === "posts_make_note"), false);
  assert.deepEqual(bodies(container), ["一"]);
  unmount();
});

test("「元に戻す」はリンクを外して受信箱に戻し、作ったときのままのノートをゴミ箱へ移す", async () => {
  const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "一", work: A }] });
  const { deps, log } = noteDepsFor();
  const { container, toasts, unmount } = await mount({ noteDeps: deps });
  await click(button(item(container, "一"), "ノートにする"));
  await act(async () => toasts.at(-1).action.onClick());
  await settle();
  const [, args] = backend.calls.find(([command]) => command === "posts_unlink_note");
  assert.deepEqual(args, { scopePath: "C:/lib/作品A", ids: ["p1"], notePath: "C:\\lib\\作品A\\素材\\手紙.md", noteHash: "nh-手紙" });
  assert.deepEqual(log.slice(-3), [
    ["open", "C:\\lib\\作品A\\本文.md"],
    ["refresh", "C:/lib/作品A"],
    ["trash", "C:\\lib\\作品A\\素材\\手紙.md"],
  ], "back to the file open before, then the note goes (deleting the open file would reopen the first file in the list)");
  assert.equal(toasts.at(-1).message, "投稿を受信箱に戻し、ノート「手紙」をゴミ箱へ移しました");
  assert.deepEqual(bodies(container), ["一"]);
  assert.ok(button(item(container, "一"), "ノートにする"));
  unmount();
});

test("書き足したノートは、元に戻してもゴミ箱へ移さない（保存前の変更も）", async () => {
  for (const [dirty, unchanged] of [[true, true], [false, false]]) {
    const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "一", work: A }] });
    backend.noteUnchanged = unchanged;
    const { deps, log } = noteDepsFor({ dirty });
    const { container, toasts, unmount } = await mount({ noteDeps: deps });
    await click(button(item(container, "一"), "ノートにする"));
    await act(async () => toasts.at(-1).action.onClick());
    await settle();
    assert.equal(log.some(([kind]) => kind === "trash"), false, `dirty=${dirty} unchanged=${unchanged}`);
    assert.equal(toasts.at(-1).message, "投稿を受信箱に戻しました（ノート「手紙」は残しました）");
    assert.deepEqual(bodies(container), ["一"]);
    unmount();
  }
});

test("ライブラリ直下では「ノートにする」を出さない", async () => {
  fakeBackend({ work: null, initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "着想" }] });
  const { deps } = noteDepsFor();
  const { container, unmount } = await mount({ scope: "C:/lib", noteDeps: deps });
  assert.ok(item(container, "着想"));
  assert.equal(button(item(container, "着想"), "ノートにする"), undefined);
  unmount();
});

test("別の作品のノートの札は作品名を添え、その作品に切り替えて開く。なくなったノートの札は薄く、押せない", async () => {
  fakeBackend({ initial: [
    { id: "p1", at: "2026-11-14T09:00:00+09:00", body: "Bで", work: B, note: { work: B.id, path: "素材/汐見.md", workRoot: "C:\\lib\\作品B", workName: "作品B" } },
    { id: "p2", at: "2026-11-14T10:00:00+09:00", body: "消えた", work: A, note: { work: A.id, path: "素材/消えた.md", workRoot: "C:\\lib\\作品A", workName: "作品A" }, noteExists: false },
  ] });
  const { deps, log } = noteDepsFor();
  const { container, unmount } = await mount({ noteDeps: deps, initialFilter: "all" });
  const other = item(container, "Bで").querySelector(".postNoteTag");
  assert.equal(other.textContent, "作品B / 汐見");
  await click(other);
  assert.deepEqual(log.at(-1), ["openInWork", "C:\\lib\\作品B", "C:\\lib\\作品B\\素材\\汐見.md"]);
  const missing = item(container, "消えた").querySelector(".postNoteTag");
  assert.equal(missing.textContent, "消えた");
  assert.ok(missing.classList.contains("isMissing"));
  assert.equal(missing.disabled, true);
  const before = log.length;
  await click(missing);
  assert.equal(log.length, before);
  unmount();
});

test("ノートの札があれば、投稿のファイルが同じでもアプリに戻ったときに読み直す（ノートが消えたかを見る）", async () => {
  const backend = fakeBackend({ initial: [{ id: "p1", at: "2026-11-14T09:00:00+09:00", body: "札", work: A, note: { work: A.id, path: "素材/札.md", workRoot: "C:/lib/作品A", workName: "作品A" } }] });
  const { container, unmount } = await mount({ initialFilter: "all" });
  const loads = () => backend.calls.filter(([command]) => command === "posts_load").length;
  const before = loads();
  backend.lines()[0].noteExists = false;
  await act(async () => window.dispatchEvent(new window.Event("focus")));
  await settle();
  assert.equal(loads(), before + 1);
  assert.ok(item(container, "札").querySelector(".postNoteTag").classList.contains("isMissing"));
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
