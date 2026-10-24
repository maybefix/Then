// AI の回答を「資料に保存」するとき、保存先のスレッドの欄に選んだ名前が収まるかを、
// ヘッドレス Edge で実際の AiPane を組んで確かめる。Tauri の呼び出しはページの中で受ける。
// 右サイドバーの幅（300px／広げた 480px）、文字の幅が広い UI フォント、UI 表示サイズを変えて見る。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const workDir = path.join(process.cwd(), ".tmp", `ai-pane-layout-${process.pid}`);
await mkdir(workDir, { recursive: true });
const entryPath = path.join(workDir, "entry.tsx");
const htmlPath = path.join(workDir, "index.html");
const fileUrl = (relative) => pathToFileURL(path.join(process.cwd(), relative)).href;

const LONG_THREAD = "Then開発ログについて";
const THREADS = [
  { id: "inbox", kind: "inbox", title: "インボックス", fragments: [], createdAt: 0, updatedAt: 0 },
  { id: "songs", kind: "thread", title: "Inspiration Songs", fragments: [], createdAt: 0, updatedAt: 0 },
  { id: "log", kind: "thread", title: LONG_THREAD, fragments: [], createdAt: 0, updatedAt: 0 },
];
const CASES = [
  { name: "default", width: 300, scale: 1, font: null },
  { name: "wideFont", width: 300, scale: 1, font: "\"MS Gothic\", \"BIZ UDGothic\", monospace" },
  { name: "wideFontScaled", width: 300, scale: 1.25, font: "\"MS Gothic\", \"BIZ UDGothic\", monospace" },
  { name: "wideSidebar", width: 480, scale: 1, font: null },
];

await writeFile(entryPath, `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AiPane } from ${JSON.stringify(path.join(process.cwd(), "src/components/ai/AiPane.tsx"))};

const turn = {
  id: "t1", input: "App.tsx が1500行あります", answer: "分けることをおすすめします。",
  provider: "local", model: "m", mode: "consult", promptVersion: 1, status: "complete", createdAt: 1, updatedAt: 1,
};
const conversation = { id: "c1", title: "app.tsxが1500", provider: "local", model: "m", createdAt: 1, updatedAt: 1, turns: [turn] };
const replies = {
  ai_providers: [{ id: "local", label: "Local", models: ["m"], webResearch: false, needsKey: false, keySaved: false, available: true }],
  ai_list_conversations: [{ id: "c1", title: conversation.title, provider: "local", model: "m", updatedAt: 1 }],
  ai_load_conversation: conversation,
};
window.__TAURI_INTERNALS__ = {
  invoke: async (command) => {
    if (command in replies) return replies[command];
    throw new Error("unexpected " + command);
  },
  transformCallback: () => 0,
};

const threads = ${JSON.stringify(THREADS)};
const settings = { provider: null, models: {}, defaultMode: "consult", localEndpoint: "" };
for (const host of document.querySelectorAll("[data-case] .rightSidebarBody")) {
  createRoot(host).render(createElement(AiPane, {
    rootPath: "C:/work", settings, threads, onReferenceSaved: () => {}, onOpenReference: () => {},
  }));
}
`);
await build({
  entryPoints: [entryPath],
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  outdir: workDir,
  define: { "process.env.NODE_ENV": "\"production\"" },
  logLevel: "error",
});
await writeFile(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl("src/App.css")}">
<link rel="stylesheet" href="${fileUrl("src/styles/themes/index.css")}">
<link rel="stylesheet" href="entry.css"></head>
<body style="margin:0;overflow:auto">${CASES.map(({ name, width, scale, font }) =>
  `<div class="appShell" data-theme="dark" data-case="${name}" style="width:auto;height:520px;--right-sidebar-width:${width}px;--ui-font-scale:${scale};${font ? `--ui-font-family:${font.replace(/"/g, "&quot;")};` : ""}">
    <aside class="rightSidebar"><div class="rightSidebarBody"></div></aside></div>`).join("")}
<script src="entry.js"></script></body></html>`);

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-ai-pane-layout-qa-"));
const debugPort = 9990 + Math.floor(Math.random() * 40);
const browser = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
  "--no-first-run", "--disable-extensions", "--allow-file-access-from-files", "about:blank",
], { stdio: "ignore" });
guardBrowser(browser, profileDir);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url, init) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await fetch(url, init).then((response) => response.json()); } catch { await sleep(200); }
  }
  throw new Error(`Could not reach ${url}`);
}

try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 1200));
    return response.result.value;
  };

  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(htmlPath).href });

  // 会話を開き、回答の「資料に保存」を押して、長い名前のスレッドを選ぶ。
  const measured = await evaluate(`(async () => {
    const wait = async (find) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const found = find();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("timed out: " + find);
    };
    const choose = (select, value) => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    await wait(() => document.readyState === "complete");
    await document.fonts.ready;
    const result = {};
    for (const host of document.querySelectorAll("[data-case]")) {
      const conversationSelect = await wait(() => {
        const select = host.querySelector('select[aria-label="会話"]');
        return select && select.options.length > 1 ? select : null;
      });
      choose(conversationSelect, "c1");
      const saveButton = await wait(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "資料に保存"));
      const answerRow = saveButton.parentElement.getBoundingClientRect();
      saveButton.click();
      const select = await wait(() => host.querySelector('select[aria-label="保存先のスレッド"]'));
      choose(select, "log");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const form = select.closest("form");
      const style = getComputedStyle(select);
      const canvas = document.createElement("canvas").getContext("2d");
      canvas.font = style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
      const label = select.options[select.selectedIndex].textContent;
      const textBox = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const buttons = [...form.querySelectorAll("button")].map((button) => {
        const box = button.getBoundingClientRect();
        return { text: button.textContent, right: box.right, left: box.left, width: box.width, scrollWidth: button.scrollWidth };
      });
      const formBox = form.getBoundingClientRect();
      result[host.dataset.case] = {
        label, textBox, textWidth: canvas.measureText(label).width, selectHeight: select.getBoundingClientRect().height,
        answerRowHeight: answerRow.height, formRight: formBox.right, formLeft: formBox.left,
        formOverflow: form.scrollWidth - form.clientWidth, buttons,
      };
    }
    return JSON.stringify(result);
  })()`);
  const result = JSON.parse(measured);
  if (process.env.AI_PANE_LAYOUT_DEBUG) console.log(JSON.stringify(result, null, 1));

  for (const [name, item] of Object.entries(result)) {
    assert.equal(item.label, LONG_THREAD, `${name}: the chosen thread is selected`);
    assert.ok(
      item.textBox >= item.textWidth,
      `${name}: the chosen thread name fits in the save-target box (room ${item.textBox}px, name ${item.textWidth}px)`,
    );
    assert.ok(item.formOverflow <= 0, `${name}: the save row does not overflow (${item.formOverflow}px)`);
    for (const button of item.buttons) {
      assert.ok(button.left >= item.formLeft - 0.5 && button.right <= item.formRight + 0.5, `${name}: "${button.text}" stays inside the row`);
      assert.ok(button.scrollWidth <= Math.ceil(button.width) + 0.5, `${name}: "${button.text}" is not cut`);
    }
    // 「資料に保存」などのボタンの行は、ボタン1つの高さのまま（1行）。
    assert.ok(item.answerRowHeight <= item.selectHeight + 0.5, `${name}: the answer's button row stays one line (${item.answerRowHeight}px)`);
  }
  socket.close();
} finally {
  await stopBrowser(browser, profileDir);
  await rm(workDir, { recursive: true, force: true });
}
console.log("AI pane layout tests passed");
