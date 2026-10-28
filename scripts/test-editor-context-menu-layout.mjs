// 実際の本文メニューとCSSをブラウザで動かし、四隅・倍率・長い子メニューを検証する。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const work = path.resolve(".tmp", `editor-menu-layout-${process.pid}`);
await mkdir(work, { recursive: true });
const entry = path.join(work, "entry.tsx");
const html = path.join(work, "index.html");
await writeFile(entry, `
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { EditorContextMenu } from ${JSON.stringify(path.resolve("src/components/editor/EditorContextMenu.tsx"))};
import ${JSON.stringify(path.resolve("src/App.css"))};
import ${JSON.stringify(path.resolve("src/styles/themes/index.css"))};
const root = createRoot(document.getElementById("root"));
let serial = 0;
window.mountMenu = async ({ x, y, scale = 1, plugins = 1, theme = "dark", text = "選択範囲" }) => {
  document.querySelector(".appShell").style.setProperty("--ui-font-scale", String(scale));
  document.querySelector(".appShell").dataset.theme = theme;
  window.menuCalls = [];
  const record = name => (...args) => { window.menuCalls.push({ name, args }); };
  const selection = { x, y, from: 1, to: 1 + text.length, text };
  flushSync(() => root.render(window.fixtureElement = <EditorContextMenu key={++serial}
    editorContextMenu={selection} editorContextMenuRef={{ current: null }}
    pluginSelectionCommands={Array.from({ length: plugins }, (_, i) => ({ pluginId: "qa.menu", id: "item-" + i, title: "検証用コマンド " + i }))}
    pluginRuntimeHostRef={{ current: { executeCommand: record("plugin") } }}
    copyEditorSelection={async (...args) => record("copy")(...args)} cutEditorSelection={async (...args) => record("cut")(...args)}
    pasteIntoEditorSelection={async (...args) => record("paste")(...args)} handTextToAi={record("ai")} closeEditorContextMenu={record("close")}
    openRubyNotationModal={record("ruby")} applyInlineNotation={(...args) => { record("inline")(...args); return true; }}
    clearSelectionNotation={record("clear")} openDirectionNotationModal={record("direction")} openManuscriptTidy={record("tidy")}
  />));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
window.setMenuScale = async scale => {
  document.querySelector(".appShell").style.setProperty("--ui-font-scale", String(scale));
  flushSync(() => root.render(React.cloneElement(window.fixtureElement)));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
window.openMenuGroup = async name => {
  const button = document.querySelector('[aria-haspopup="menu"][aria-label="' + name + '"]');
  if (!button) throw Error("missing group " + name);
  button.scrollIntoView({ block: "nearest" });
  button.click();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
window.menuBounds = () => [...document.querySelectorAll('.editorContextMenu, .editorContextMenu [role="toolbar"], .editorContextMenu [role="menu"]')]
  .filter(el => getComputedStyle(el).visibility !== "hidden")
  .map(el => { const r = el.getBoundingClientRect(); return { label: el.getAttribute("aria-label") || el.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height, scroll: el.scrollHeight, client: el.clientHeight }; });
`);
await build({ entryPoints: [entry], outfile: path.join(work, "entry.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic", loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file", ".png": "file" }, logLevel: "error" });
await writeFile(html, '<!doctype html><html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="entry.css"></head><body style="margin:0;overflow:hidden"><main class="appShell" data-theme="dark"><div id="root"></div></main><script type="module" src="entry.js"></script></body></html>');
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!edge) throw new Error("Edge missing");
const profile = mkdtempSync(path.join(os.tmpdir(), "then-editor-menu-layout-qa-"));
const port = 9900 + Math.floor(Math.random() * 100);
const browser = spawn(edge, ["--headless=new", "--no-first-run", "--disable-extensions", "--allow-file-access-from-files", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
guardBrowser(browser, profile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let version;
  for (let i = 0; i < 70 && !version; i++) { try { version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()); } catch { await sleep(150); } }
  assert.ok(version, "browser debug endpoint is ready");
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timeout); pending.delete(message.id);
    if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(Error(method + " timed out")); }, 25_000);
    pending.set(requestId, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || "page error");
    return result.result.value;
  };
  const viewport = async (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await viewport(960, 680);
  await send("Page.navigate", { url: pathToFileURL(html).href });
  for (let i = 0; i < 80; i++) { if (await evaluate('typeof window.mountMenu === "function"')) break; await sleep(100); }
  await evaluate("document.fonts.ready.then(() => true)");
  const checkBounds = async (width, height, label) => {
    const boxes = await evaluate("menuBounds()");
    assert.ok(boxes.length > 0, `${label}: menu is visible`);
    for (const box of boxes) assert.ok(box.left >= -0.5 && box.top >= -0.5 && box.right <= width + 0.5 && box.bottom <= height + 0.5,
      `${label}: menu must fit viewport ${width}x${height}: ${JSON.stringify(box)}`);
    return boxes;
  };
  // この最初の場面は、修正前の固定高さで必ず画面下にはみ出す。
  await evaluate('mountMenu({ x: 956, y: 676, plugins: 1 })');
  await checkBounds(960, 680, "bottom-right reproduction");
  assert.equal(await evaluate('document.querySelectorAll(\'[role="toolbar"] button\').length'), 6, "six quick actions are available");
  let scenarios = 0;
  for (const [width, height] of [[960, 680], [640, 360], [320, 240]]) {
    await viewport(width, height);
    for (const scale of [1, 1.25, 1.5, 2]) for (const [x, y] of [[2, 2], [width - 2, 2], [2, height - 2], [width - 2, height - 2]]) {
      const label = `${width}x${height} scale ${scale} at ${x},${y}`;
      await evaluate(`mountMenu(${JSON.stringify({ x, y, scale, plugins: 1 })})`);
      await checkBounds(width, height, label);
      for (const group of ["独自記法", "行の操作", "プラグイン"]) {
        await evaluate(`openMenuGroup(${JSON.stringify(group)})`);
        await checkBounds(width, height, label + " / " + group);
      }
      scenarios++;
    }
  }
  await viewport(640, 360);
  await evaluate('mountMenu({ x: 638, y: 358, scale: 1.5, plugins: 60, theme: "default" })');
  await evaluate('openMenuGroup("プラグイン")');
  const longBoxes = await checkBounds(640, 360, "long plugin menu");
  const longMenu = longBoxes.find(box => box.label === "プラグイン");
  assert.ok(longMenu.scroll > longMenu.client, "long plugin list scrolls inside its panel");
  const last = await evaluate('(async () => { const panel = document.querySelector(\'[role="menu"][aria-label="プラグイン"]\'); const button = [...panel.querySelectorAll("button")].at(-1); button.scrollIntoView({ block: "nearest" }); button.click(); return menuCalls; })()');
  assert.deepEqual(last.map(call => call.name), ["plugin", "close"]);
  assert.deepEqual(last[0].args, ["qa.menu", "item-59"]);
  await viewport(960, 680);
  await evaluate('mountMenu({ x: 958, y: 678, plugins: 1 })');
  await evaluate('openMenuGroup("独自記法")');
  const side = await evaluate('document.querySelector(\'[role="menu"][aria-label="独自記法"]\').dataset.side');
  assert.equal(side, "left", "near the right edge, submenu opens left");
  await evaluate("setMenuScale(2)");
  await checkBounds(960, 680, "zoom change with submenu open");
  await viewport(420, 300);
  await sleep(100);
  await checkBounds(420, 300, "resize with submenu open");
  await evaluate('mountMenu({ x: 15, y: 15, plugins: 0, text: "" })');
  assert.equal(await evaluate('!!document.querySelector(\'[aria-haspopup="menu"][aria-label="プラグイン"]\')'), false);
  assert.equal(await evaluate('document.querySelector(\'[aria-label="コピー"]\').disabled'), true);
  assert.equal(await evaluate('document.querySelector(\'[aria-label="貼り付け"]\').disabled'), false);
  await viewport(960, 680);
  await evaluate('mountMenu({ x: 100, y: 100, plugins: 1 })');
  const triggerPoint = await evaluate('(() => { const r = document.querySelector(\'[aria-haspopup="menu"][aria-label="独自記法"]\').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...triggerPoint });
  await sleep(80);
  assert.equal(await evaluate('!!document.querySelector(\'[role="menu"][aria-label="独自記法"]\')'), true, "hover opens submenu");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...triggerPoint, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...triggerPoint, button: "left", clickCount: 1 });
  await sleep(80);
  assert.equal(await evaluate('!!document.querySelector(\'[role="menu"][aria-label="独自記法"]\')'), true, "click after hover keeps submenu open");
  const childPoint = await evaluate('(() => { const r = document.querySelector(\'[role="menu"][aria-label="独自記法"]\').getBoundingClientRect(); return { x: r.left + 3, y: r.top + 3 }; })()');
  for (let step = 1; step <= 5; step++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: triggerPoint.x + (childPoint.x - triggerPoint.x) * step / 5, y: triggerPoint.y + (childPoint.y - triggerPoint.y) * step / 5 });
  await sleep(260);
  assert.equal(await evaluate('!!document.querySelector(\'[role="menu"][aria-label="独自記法"]\')'), true, "pointer can cross from parent to child");
  await checkBounds(960, 680, "pointer navigation");
  const capture = process.argv.indexOf("--screenshot");
  if (capture >= 0) {
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.resolve(process.argv[capture + 1]), Buffer.from(screenshot.data, "base64"));
  }
  console.log(`editor context menu layout: ${scenarios} corner/scale cases, submenus, resize, live zoom, long plugin scrolling, hover/click navigation and selection guards passed`);
} finally {
  socket?.close();
  await stopBrowser(browser, profile);
  if (path.dirname(work) !== path.resolve(".tmp") || !path.basename(work).startsWith("editor-menu-layout-")) throw Error("unexpected fixture cleanup path");
  await rm(work, { recursive: true, force: true });
}
