import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";

const dir = path.resolve("test-artifacts/submission-ui");
await mkdir(dir, { recursive: true });
await build({ stdin: { contents: `export * from './src/components/export/LinkedExportScreen';
export * from './src/export/submission/options';
export * from './src/export/submission/submissionHostActions';`, resolveDir: process.cwd() },
  outfile: path.join(dir, "screen.mjs"), bundle: true, platform: "node", format: "esm", jsx: "automatic",
  loader: { ".css": "empty" }, external: ["react", "react/jsx-runtime"] });
const { LinkedExportScreen, readSubmissionOptions, SUBMISSION_OPTIONS_KEY, submissionFileName } = await import(pathToFileURL(path.join(dir, "screen.mjs")));
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let copied = "";
let savedArgs;
let saveMode = "success";
let finishSave;
window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
  assert.equal(command, "save_submission_text_dialog");
  savedArgs = args;
  if (saveMode === "cancel") return null;
  if (saveMode === "fail") throw Error("disk full");
  if (saveMode === "pending") return new Promise(resolve => { finishSave = resolve; });
  return { name: args.fileName, path: `C:/exports/${args.fileName}` };
} };
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { copied = text; } } });
localStorage.setItem(SUBMISSION_OPTIONS_KEY, JSON.stringify({ version: 1, options: { target: "narou", lineEnding: "bad", sourceSeparator: 5 } }));
assert.equal(readSubmissionOptions().target, "narou");
assert.equal(readSubmissionOptions().lineEnding, "crlf");
assert.equal(readSubmissionOptions().sourceSeparator, "\n\n\n");
for (const value of ["{", "null", '{"version":0,"options":{"target":"plain"}}']) {
  localStorage.setItem(SUBMISSION_OPTIONS_KEY, value);
  assert.equal(readSubmissionOptions().target, "kakuyomu");
}
localStorage.clear();
const sources = ["[重要(em,goma)]", "第二本文"].map((content, order) => ({
  id: String(order), path: `${order}.txt`, displayName: `${order}.txt`, content, order,
  extension: "txt", enabled: true, startMode: "new-page", markupMode: "then-markup",
}));
const noop = () => {};
assert.equal(submissionFileName("作品", sources, "narou"), "作品_narou.txt");
assert.equal(submissionFileName("作品", [{ ...sources[0], displayName: '第01話:旅立ち.md' }, { ...sources[1], enabled: false }], "kakuyomu"), "第01話_旅立ち_kakuyomu.txt");
assert.equal(submissionFileName("", sources, "plain"), "本文連結_plain.txt");
let opened = "";
const props = { title: "作品", initialSources: sources, onClose: noop, onOpenSource: p => { opened = p; },
  onExportPdf: async () => { throw Error("unexpected print"); }, onExportDocx: async () => { throw Error("unexpected print"); }, onOpenResult: noop };
const button = text => [...document.querySelectorAll("button")].find(item => item.textContent === text);
const click = async element => { assert.ok(element); await act(async () => element.click()); };
const select = async (label, value) => {
  const el = [...document.querySelectorAll("label")].find(item => item.firstChild?.textContent === label)?.querySelector("select");
  assert.ok(el, label); await act(async () => { el.value = value; el.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
};
const preview = () => document.querySelector('[aria-label="変換後テキスト"]')?.value;

for (const embedded of [false, true]) {
  localStorage.clear();
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(LinkedExportScreen, { ...props, embedded })));
  await click(document.querySelector('[aria-label="下へ移動"]'));
  await click(button("投稿用テキスト"));
  assert.equal(preview(), "第二本文\n\n\n《《重要》》\n");
  assert.ok(!document.querySelector(".exportSourceMeta select"));
  await select("投稿先", "narou");
  assert.equal(preview(), "第二本文\n\n\n｜重《・》｜要《・》\n");
  await click(button("クリップボードへコピー"));
  assert.equal(copied, "第二本文\r\n\r\n\r\n｜重《・》｜要《・》\r\n");
  assert.ok(document.querySelector('[role="status"]').textContent.includes("コピーしました"));
  await click(button("テキストファイルに保存"));
  assert.deepEqual(savedArgs, { content: copied, fileName: "作品_narou.txt" });
  assert.ok(document.querySelector('[role="status"]').textContent.includes("保存しました"));
  await select("改行コード", "lf");
  await click(button("クリップボードへコピー"));
  assert.equal(copied, preview());
  await click(button("テキストファイルに保存"));
  assert.equal(savedArgs.content, copied);
  saveMode = "cancel";
  await click(button("テキストファイルに保存"));
  assert.ok(document.querySelector('[role="status"]').textContent.includes("保存をキャンセル"));
  saveMode = "fail";
  await click(button("テキストファイルに保存"));
  assert.ok(document.querySelector('[role="alert"]').textContent.includes("保存に失敗"));
  saveMode = "pending";
  await click(button("テキストファイルに保存"));
  assert.equal(button("保存中…").disabled, true);
  assert.equal(button("クリップボードへコピー").disabled, true);
  await act(async () => finishSave(null));
  saveMode = "success";
  await click(button("印刷・文書"));
  assert.ok(document.querySelector(".exportSourceMeta select"));
  await click(button("投稿用テキスト"));
  assert.equal(preview(), "第二本文\n\n\n｜重《・》｜要《・》\n");
  await select("なろうの傍点", "plain");
  assert.equal(preview(), "第二本文\n\n\n重要\n");
  await select("ファイル間区切り", "stars");
  assert.equal(preview(), "第二本文\n\n＊　＊　＊\n\n重要\n");
  await select("投稿先", "plain");
  assert.ok(![...document.querySelectorAll("label")].some(el => el.firstChild?.textContent === "なろうの傍点"));
  for (const tab of ["設定", "プレビュー", "出力対象"]) {
    await click(button(tab));
    assert.equal(document.querySelectorAll(".mobileActive").length, 1);
  }
  await click(button("すべて解除"));
  assert.equal(button("クリップボードへコピー").disabled, true);
  assert.equal(button("テキストファイルに保存").disabled, true);
  await click(button("すべて選択"));
  navigator.clipboard.writeText = async () => { throw Error("denied"); };
  await click(button("クリップボードへコピー"));
  assert.ok(document.querySelector('[role="alert"]').textContent.includes("コピーに失敗"));
  navigator.clipboard.writeText = undefined;
  await click(button("クリップボードへコピー"));
  assert.ok(document.querySelector('[role="alert"]').textContent.includes("クリップボードへ書き込めません"));
  navigator.clipboard.writeText = async text => { copied = text; };
  await act(async () => root.unmount());
}
const root = createRoot(document.getElementById("root"));
await act(async () => root.render(React.createElement(LinkedExportScreen, { ...props,
  initialSources: [{ ...sources[0], content: "本文\n［＃未知］" }], sourceError: "失敗.txt: 読めません" })));
await click(button("投稿用テキスト"));
assert.ok(document.querySelector(".submissionSummary").textContent.includes("警告2件"));
await click(document.querySelector(".submissionWarnings button"));
assert.equal(opened, "0.txt");
await click(button("クリップボードへコピー"));
assert.ok(document.querySelector('[role="status"]').textContent.includes("2件の警告"));
await click(button("テキストファイルに保存"));
assert.equal(savedArgs.fileName, "0_plain.txt");
assert.equal(savedArgs.content, copied);
assert.ok(document.querySelector('[role="status"]').textContent.includes("2件の警告"));
assert.ok(!localStorage.getItem(SUBMISSION_OPTIONS_KEY).includes("未知"));
await act(async () => root.unmount());
// Delayed worker responses must never re-enable export for obsolete inputs.
let worker;
let workerStopped = false;
globalThis.Worker = class {
  constructor() { worker = this; this.requests = []; }
  postMessage(request) { this.requests.push(request); }
  terminate() { workerStopped = true; }
};
const asyncRoot = createRoot(document.getElementById("root"));
await act(async () => asyncRoot.render(React.createElement(LinkedExportScreen, props)));
await click(button("投稿用テキスト"));
assert.equal(button("クリップボードへコピー").disabled, true);
await select("投稿先", "kakuyomu");
await act(async () => worker.onmessage({ data: { id: worker.requests[0].id, result: { target: "plain", text: "古い結果", chars: 4, sourceCount: 2, warnings: [] } } }));
assert.equal(button("テキストファイルに保存").disabled, true);
assert.equal(preview(), undefined);
await act(async () => worker.onmessage({ data: { id: worker.requests[1].id, result: { target: "kakuyomu", text: "新しい結果\n", chars: 6, sourceCount: 2, warnings: [] } } }));
assert.equal(preview(), "新しい結果\n");
await act(async () => asyncRoot.unmount());
assert.equal(workerStopped, true);
delete globalThis.Worker;
dom.window.close();
console.log("Submission UI passed: both host modes, selection/order, profiles, persistence, clipboard and warnings");
