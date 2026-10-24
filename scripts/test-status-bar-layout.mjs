// ステータスバーの並びをヘッドレス Edge で実際に組んで確かめる。
// 狭い幅で長いエラーが出ても、ほかの項目は1行のまま縮まず、エラーの文だけが省略されること。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `status-bar-layout-${process.pid}.mjs`);
const htmlPath = path.join(tmpDir, `status-bar-layout-${process.pid}.html`);
const bundled = await build({
  entryPoints: ["src/components/status/StatusBar.tsx"],
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
const { StatusBar } = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const longError = "failed to write text file: アクセスが拒否されました。 (os error 5)";
const bar = (props) => renderToStaticMarkup(createElement(StatusBar, {
  currentFilePath: null,
  showFilePath: false,
  lastError: "",
  charCount: 12,
  selectionCharCount: null,
  pageMetrics: null,
  checkpoint: null,
  pluginItems: [],
  onPluginItemClick: () => {},
  ...props,
}));
const cases = {
  narrowError: { width: 296, html: bar({ saveStatus: "error", lastError: longError }) },
  narrowPath: { width: 296, html: bar({ saveStatus: "saved", showFilePath: true, currentFilePath: "C:/Users/someone/Documents/とても長い作品の名前/第一章/本文.txt", pageMetrics: { current: 12, total: 340 } }) },
  wideError: { width: 1200, html: bar({ saveStatus: "error", lastError: longError }) },
};
await writeFile(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(path.join(process.cwd(), "src/App.css")).href}"></head>
<body style="margin:0">${Object.entries(cases).map(([name, { width, html }]) =>
  `<div class="appShell" data-theme="dark" data-case="${name}" style="width:${width}px">${html}</div>`).join("")}</body></html>`);

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-statusbar-qa-"));
const debugPort = 9950 + Math.floor(Math.random() * 40);
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
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

  // エラーの欄の上限は画面の幅（vw）で決まるので、Then のふつうの窓と同じくらいの幅にする。
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 400, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(`document.readyState === "complete" && getComputedStyle(document.querySelector(".statusbar")).display === "flex"`)) break;
    await sleep(100);
  }

  const measured = await evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll("[data-case]")].map((host) => {
    const footer = host.querySelector("footer.statusbar");
    const lineHeight = parseFloat(getComputedStyle(footer).fontSize) * 1.6;
    const items = [...footer.children].map((element) => {
      const box = element.getBoundingClientRect();
      return { cls: element.getAttribute("class") || element.tagName, text: element.textContent, height: box.height, right: box.right, width: box.width, scrollWidth: element.scrollWidth };
    });
    return [host.dataset.case, { lineHeight, footerRight: footer.getBoundingClientRect().right, overflow: footer.scrollWidth - footer.clientWidth, items }];
  })))`);
  const result = JSON.parse(measured);

  for (const [name, { lineHeight, footerRight, overflow, items }] of Object.entries(result)) {
    for (const item of items) {
      assert.ok(item.height <= lineHeight, `${name}: "${item.text}" stays on one line (height ${item.height})`);
      assert.ok(item.right <= footerRight + 0.5, `${name}: "${item.text}" stays inside the bar`);
    }
    assert.ok(overflow <= 0, `${name}: the bar does not overflow (${overflow}px)`);
    const fixed = items.filter((item) => !/statusError|statusPath/.test(item.cls) && item.text);
    for (const item of fixed) assert.ok(item.scrollWidth <= Math.ceil(item.width) + 0.5, `${name}: "${item.text}" is not cut`);
  }
  const narrowError = result.narrowError.items.find((item) => item.cls === "statusError");
  assert.ok(narrowError.width > 0 && narrowError.width < narrowError.scrollWidth, "narrow: the error text is shortened, not the other items");
  const narrowPath = result.narrowPath.items.find((item) => item.cls === "statusPath");
  assert.ok(narrowPath.width < narrowPath.scrollWidth, "narrow: the file path is shortened");
  const wideError = result.wideError.items.find((item) => item.cls === "statusError");
  assert.ok(wideError.width >= wideError.scrollWidth - 0.5, "wide: the whole error text fits");
  socket.close();
} finally {
  await stopBrowser(browser, profileDir);
  await unlink(htmlPath).catch(() => {});
}
console.log("status bar layout tests passed");
