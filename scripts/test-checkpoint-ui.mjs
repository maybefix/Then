import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// react-dom は DOM の有無を読み込み時に判定するので、jsdom を用意してから読み込む。
const { createRoot } = await import("react-dom/client");

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { CheckpointStudio } = await server.ssrLoadModule("/src/components/checkpoints/CheckpointStudio.tsx");
  const root = "C:\\book";
  const filePath = (folder, name) => `${root}\\${folder}\\${name}`;
  const makeFile = (folder, name, text) => ({ path: filePath(folder, name), name, text, textHash: "", semanticHash: "", lineCount: 1, textLength: text.length, visibleTextLength: text.length, outlineCount: 0 });
  const tree = (folders) => ({
    path: root, name: "book", children: folders.map(([folder, names]) => ({
      path: `${root}\\${folder}`, name: folder, kind: "folder",
      children: names.map((name) => ({ path: filePath(folder, name), name, kind: "file", children: [] })),
    })),
  });
  const article = ["はじめに。", "今後はルビや傍点に対応していく予定です。", "おわりに。"].join("\n");
  const oldFiles = [makeFile("01_記事", "記事.md", article), makeFile("02_メモ", "メモ.md", "メモ")];
  const oldTree = tree([["01_記事", ["記事.md"]], ["02_メモ", ["メモ.md"]]]);
  const snapshot = (id, label, createdAt, extra = {}) => ({ id, revision: 1, storageHash: "", workspacePath: root, workspaceName: "book", createdAt, reason: "manual", label, memo: "", parentIds: [], projectTree: oldTree, files: oldFiles, fileCount: oldFiles.length, totalTextLength: 20, totalVisibleTextLength: 20, ...extra });
  const now = Date.now();
  const snapshots = [
    snapshot("s1", "第2稿に入る前", now - 60_000, { memo: "メモ付き" }),
    snapshot("shelter", "復元前の退避", now - 120_000, { reason: "auto-before-restore" }),
    snapshot("s0", "最初", now - 3 * 86_400_000),
  ];
  const currentArticle = article.replace("ルビや傍点に対応していく", "ルビと傍点に対応したうえで、縦中横にも手をつける");
  const currentFiles = new Map([
    [filePath("01_記事", "記事.md").toLocaleLowerCase(), { path: filePath("01_記事", "記事.md"), name: "記事.md", text: currentArticle }],
    [filePath("02_メモ", "メモ.md").toLocaleLowerCase(), { path: filePath("02_メモ", "メモ.md"), name: "メモ.md", text: "メモ" }],
    [filePath("02_メモ", "新規.md").toLocaleLowerCase(), { path: filePath("02_メモ", "新規.md"), name: "新規.md", text: "加わった本文" }],
  ]);
  const currentTree = tree([["02_メモ", ["メモ.md", "新規.md"]], ["01_記事", ["記事.md"]]]);

  const calls = [];
  const container = document.querySelector("#root");
  const reactRoot = createRoot(container);
  const props = {
    projectFolder: currentTree, snapshots, currentProjectFiles: currentFiles, currentProjectStatus: "ready",
    unavailableCurrentProjectPaths: new Set(), currentProjectStats: { fileCount: 3, visibleTextLength: 40 },
    onClose() {}, onEditDetails() {}, onDelete() {},
    async onCreate(label) { calls.push(["create", label]); return "s1"; },
    async onRestore(item) { calls.push(["restore", item.id]); return true; },
    async onRestoreFile(item, path, relocation) { calls.push(["file", item.id, path, relocation]); return true; },
    async onRestoreOrder(item) { calls.push(["order", item.id]); return true; },
  };
  const render = async (next = props) => { await act(async () => { reactRoot.render(React.createElement(CheckpointStudio, next)); }); };
  const click = async (element) => { assert.ok(element, "element to click"); await act(async () => { element.click(); }); };
  const button = (text) => [...container.querySelectorAll("button")].find((item) => item.textContent.includes(text));
  const text = () => container.textContent;

  await render();
  // サイドバー: 日付グループ、件数、選択中
  assert.match(text(), /保存点3件/);
  assert.match(text(), /今日/);
  assert.match(text(), /3ファイル · 40字/);
  assert.equal(container.querySelector(".cpSnap[aria-current='true'] .cpSnapName").textContent, "第2稿に入る前");
  assert.match(text(), /自動退避も表示（1件）/);

  // 要約・ファイルカード・並び順
  assert.match(text(), /1ファイルが加わり、1ファイルの本文と、フォルダの並び順が変わっています/);
  const cards = [...container.querySelectorAll(".cpFile")];
  assert.equal(cards.length, 3);
  assert.equal(cards[0].querySelector(".cpFileToggle").getAttribute("aria-expanded"), "true", "first card opens");
  assert.equal(cards[1].querySelector(".cpFileToggle").getAttribute("aria-expanded"), "false");
  assert.ok(cards[0].querySelector("del") && cards[0].querySelector("ins"), "inline char diff");
  assert.match(cards[0].textContent, /⋯ 1段落 変更なし/);
  assert.equal(cards[1].querySelector(".cpBtnLine"), null, "a file added after the snapshot has nothing to restore");
  assert.match(text(), /変更のないファイル 1件は省略しています/);

  // 左右に並べる
  await click(button("左右に並べる"));
  assert.equal(button("左右に並べる").getAttribute("aria-pressed"), "true");
  assert.ok(cards[0].querySelector(".cpSideRow"));
  assert.match(cards[0].textContent, /この保存点（/);
  await click(button("変わった所だけ"));

  // 自動退避の表示切り替え
  await click(container.querySelector(".cpAutoToggle input"));
  assert.equal(container.querySelectorAll(".cpSnap.auto").length, 0);
  await click(container.querySelector(".cpAutoToggle input"));

  // ファイル単位の復元: 確認 → 実行 → 完了通知
  await click(cards[0].querySelector(".cpBtnLine"));
  assert.match(container.querySelector(".cpDialog").textContent, /「記事.md」だけ戻す/);
  await click(container.querySelector(".cpDialog .cpBtnPrimary"));
  assert.deepEqual(calls.at(-1), ["file", "s1", filePath("01_記事", "記事.md"), null]);
  assert.equal(container.querySelector(".cpDialog"), null);
  assert.match(container.querySelector("[role=status]").textContent, /「記事.md」を戻しました。直前の状態は「復元前の退避」/);

  // 全体の復元: 後から加わったファイルの扱いを確認に出す
  await click(button("この時点に戻す"));
  assert.match(container.querySelector(".cpDialog").textContent, /保存点のあとで加わった1ファイルはごみ箱へ移します/);
  await click(button("キャンセル"));
  assert.equal(calls.filter(([kind]) => kind === "restore").length, 0);

  // 並び順だけ戻す
  await click(button("並び順だけ戻す"));
  await click(container.querySelector(".cpDialog .cpBtnPrimary"));
  assert.deepEqual(calls.at(-1), ["order", "s1"]);

  // 比較先: ひとつ前の保存点（同じ内容なので変更なし）
  const select = container.querySelector(".cpCompareBar select");
  assert.match(select.options[1].textContent, /ひとつ前の保存点/);
  await act(async () => { select.value = "prev"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
  assert.match(text(), /比較先と同じ内容です。戻しても何も変わりません。/);

  // 保存点を切り替えると比較先は現在に戻る
  await click([...container.querySelectorAll(".cpSnap")].find((item) => item.textContent.includes("最初")));
  assert.equal(container.querySelector(".cpCompareBar select").value, "current");

  // 絞り込み
  const search = container.querySelector(".cpSearch input");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(search, "存在しない"); search.dispatchEvent(new window.Event("input", { bubbles: true })); });
  assert.match(text(), /一致する保存点はありません/);
  await act(async () => { setter.call(search, "メモ付き"); search.dispatchEvent(new window.Event("input", { bubbles: true })); });
  assert.equal(container.querySelectorAll(".cpSnap:not(.isSelected)").length, 1);

  // 保存点の作成: 名前が空なら「名前のない保存点」
  await click(button("今の状態を保存点にする"));
  assert.ok(container.querySelector("#cp-snapshot-name"));
  await click(button("保存する"));
  assert.deepEqual(calls.at(-1), ["create", "名前のない保存点"]);
  assert.equal(container.querySelector("#cp-snapshot-name"), null);

  // 現在のプロジェクトの読み込み中・一部失敗
  await render({ ...props, currentProjectStatus: "loading", currentProjectFiles: new Map() });
  assert.match(text(), /現在のプロジェクトを読み込んでいます/);
  await render({ ...props, currentProjectStatus: "error", unavailableCurrentProjectPaths: new Set([filePath("02_メモ", "メモ.md").toLocaleLowerCase()]) });
  assert.match(text(), /読み込めなかった現在のファイル1件は比較から外しています/);
  assert.doesNotMatch(text(), /なくなり/, "an unreadable file must not be reported as deleted");

  // サイドバー・ステータスバーから特定の保存点を選んで開く
  await act(async () => { reactRoot.unmount(); });
  const focusedRoot = createRoot(container);
  await act(async () => { focusedRoot.render(React.createElement(CheckpointStudio, { ...props, focusRequest: { id: "s0", nonce: 1 } })); });
  assert.equal(container.querySelector(".cpSnap[aria-current='true'] .cpSnapName").textContent, "最初");
  await act(async () => { focusedRoot.render(React.createElement(CheckpointStudio, { ...props, focusRequest: { id: "s1", nonce: 2 } })); });
  assert.equal(container.querySelector(".cpSnap[aria-current='true'] .cpSnapName").textContent, "第2稿に入る前");
  await act(async () => { focusedRoot.unmount(); });

  // ステータスバーの「保存点 N分前 · ±字」
  const { CheckpointStatus } = await server.ssrLoadModule("/src/components/status/CheckpointStatus.tsx");
  const statusRoot = createRoot(container);
  const statusCalls = [];
  const status = (latest, current) => React.createElement(CheckpointStatus, {
    latest, currentVisibleTextLength: current, onOpen: () => statusCalls.push("open"), onCreate: () => statusCalls.push("create"),
  });
  await act(async () => { statusRoot.render(status({ label: "第2稿", createdAt: Date.now() - 2 * 3_600_000, visibleTextLength: 1000 }, 2240)); });
  assert.equal(container.textContent, "保存点 2時間前 · +1,240字");
  await click(container.querySelector("button"));
  await act(async () => { statusRoot.render(status({ label: "第2稿", createdAt: Date.now() - 5 * 60_000, visibleTextLength: 1000 }, 680)); });
  assert.equal(container.textContent, "保存点 5分前 · −320字");
  await act(async () => { statusRoot.render(status({ label: "第2稿", createdAt: Date.now(), visibleTextLength: 1000 }, null)); });
  assert.equal(container.textContent, "保存点 たった今", "no delta while the project index is incomplete");
  await act(async () => { statusRoot.render(status(null, 500)); });
  assert.equal(container.textContent, "保存点なし");
  await click(container.querySelector("button"));
  assert.deepEqual(statusCalls, ["open", "create"]);
  await act(async () => { statusRoot.unmount(); });
  console.log("checkpoint studio UI tests passed");
} finally {
  await server.close();
  dom.window.close();
}
