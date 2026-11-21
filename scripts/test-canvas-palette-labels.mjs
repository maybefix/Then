// Canvas の下の作成パレット（選択・カード・グループ・接続線）は、窓が狭くてもボタンの文字を出す。
// 2026-11-21: 窓の幅が 1120px 以下だと文字が消えていた（上の帯にボタンがあったころの規則が、
// 下のパレットにも効いたまま残っていた）。本物の CanvasWindowApp を埋め込みで描き、App.css を読み込んで確かめる。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const work = path.resolve(".tmp", `canvas-palette-labels-${process.pid}`);
await mkdir(work, { recursive: true });
const entry = path.join(work, "entry.tsx");
const html = path.join(work, "index.html");
await writeFile(entry, `
import React from "react";
import { createRoot } from "react-dom/client";
import "${path.resolve("src/App.css").replaceAll("\\", "/")}";
import CanvasWindowApp from "${path.resolve("src/CanvasWindowApp.tsx").replaceAll("\\", "/")}";
const payload = { requestId: "test", rootPath: "palette-test", workspaceName: "作品", scope: "project", theme: "dark",
  editorFontFamily: "serif", uiFontFamily: "sans-serif", uiFontScale: 1,
  canvasDefaultWritingMode: "horizontal-tb", canvasDefaultFontSource: "ui", referenceFiles: [] };
// メイン画面と同じく canvasEmbeddedHost の中に描く（App.tsx の appMode === "canvas"）。
createRoot(document.getElementById("root")).render(<div className="canvasEmbeddedHost"><CanvasWindowApp embedded embeddedPayload={payload} /></div>);
window.paletteLabels = () => [...document.querySelectorAll('[aria-label="作成ツール"] button')].map((button) => {
  const label = button.querySelector("span");
  const rect = label?.getBoundingClientRect();
  const hit = rect && rect.width > 0 ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
  return { text: label?.textContent ?? "", display: label ? getComputedStyle(label).display : "missing",
    width: rect?.width ?? 0, height: rect?.height ?? 0, onTop: !!hit && (hit === label || label.contains(hit)),
    insideButton: !!rect && (b => rect.left >= b.left - 0.5 && rect.right <= b.right + 0.5 && rect.top >= b.top - 0.5 && rect.bottom <= b.bottom + 0.5)(button.getBoundingClientRect()),
    // 文字の両端も、ほかの部品の下に入っていない（BINDER 4-3: 右端が拡大率の帯の下に入っていた）。
    endsOnTop: !!rect && rect.width > 0 && [rect.left + 1, rect.right - 1].every((x) => { const h = document.elementFromPoint(x, rect.top + rect.height / 2); return !!h && (h === label || label.contains(h)); }) };
});
// 作成パレットと、下の左右の隅の部品（保存の状態・拡大率の帯）が重ならない。
window.paletteClear = () => {
  const palette = document.querySelector('[aria-label="作成ツール"]').getBoundingClientRect();
  return [...document.querySelectorAll(".canvasCorner")].map((corner) => {
    const r = corner.getBoundingClientRect();
    const overlap = !(r.right <= palette.left || r.left >= palette.right || r.bottom <= palette.top || r.top >= palette.bottom);
    return { corner: corner.className, overlap };
  });
};
`);
// Vite の「?url」の import（pdf.js の worker）は、このテストでは使わないので空の URL にする。
const viteUrlImports = { name: "vite-url", setup(build) {
  build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "vite-url" }));
  build.onLoad({ filter: /.*/, namespace: "vite-url" }, () => ({ contents: 'export default "";', loader: "js" }));
} };
try {
  await build({ entryPoints: [entry], outfile: path.join(work, "entry.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file", ".png": "file" }, plugins: [viteUrlImports], logLevel: "error" });
} catch (error) {
  await rm(work, { recursive: true, force: true });
  throw error;
}
await writeFile(html, '<!doctype html><html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="entry.css"></head><body style="margin:0;overflow:hidden"><main class="appShell" data-theme="dark" style="width:100vw;height:100vh"><div id="root" style="display:flex;width:100%;height:100%"></div></main><script type="module" src="entry.js"></script></body></html>');

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!edge) throw new Error("Edge missing");
const profile = mkdtempSync(path.join(os.tmpdir(), "then-canvas-palette-labels-"));
const port = 9800 + Math.floor(Math.random() * 100);
const browser = spawn(edge, ["--headless=new", "--no-first-run", "--disable-extensions", "--allow-file-access-from-files", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
guardBrowser(browser, profile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let version;
  for (let i = 0; i < 70 && !version; i++) { try { version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()); } catch { await sleep(150); } }
  assert.ok(version, "browser debug endpoint is ready");
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data), item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timeout); pending.delete(message.id);
    if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)); }, 25_000);
    pending.set(requestId, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || "page error");
    return result.result.value;
  };
  const viewport = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await viewport(1280, 800);
  await send("Page.navigate", { url: pathToFileURL(html).href });
  for (let i = 0; i < 80; i++) { if (await evaluate('document.querySelectorAll(\'[aria-label="作成ツール"] button\').length === 4')) break; await sleep(100); }
  await evaluate("document.fonts.ready.then(() => true)");
  // 1280: 前から文字が出ていた幅。960: QA の窓の幅。820: 別ウィンドウの最小の幅。
  // 724: 狭いときの置き方に切り替わる幅（720px）のすぐ上。602: QA の窓（CSS 1266px）で左サイドバーと右のペインを開いたときの Canvas の幅（BINDER 4-3）。520: それより狭いとき。
  for (const [width, height] of [[1280, 800], [1120, 760], [960, 680], [820, 560], [724, 600], [602, 680], [520, 560]]) {
    await viewport(width, height);
    await sleep(150);
    const labels = await evaluate("paletteLabels()");
    assert.deepEqual(labels.map((label) => label.text), ["選択", "カード", "グループ", "接続線"], `${width}px: four tools`);
    for (const label of labels) {
      assert.notEqual(label.display, "none", `${width}px: 「${label.text}」の文字が消えている`);
      assert.ok(label.width > 0 && label.height > 0, `${width}px: 「${label.text}」の文字に大きさがない`);
      assert.ok(label.onTop, `${width}px: 「${label.text}」の文字がほかの部品に隠れている`);
      assert.ok(label.insideButton, `${width}px: 「${label.text}」の文字がボタンからはみ出している`);
      assert.ok(label.endsOnTop, `${width}px: 「${label.text}」の文字の端がほかの部品に隠れている`);
    }
    for (const corner of await evaluate("paletteClear()")) {
      assert.equal(corner.overlap, false, `${width}px: 作成パレットが ${corner.corner} と重なっている`);
    }
  }
  console.log("PASS canvas palette labels: shown inside their buttons, clear of the corners, at 1280, 1120, 960, 820, 724, 602 and 520 px");
} finally {
  socket?.close();
  await stopBrowser(browser, profile);
  if (path.dirname(work) !== path.resolve(".tmp") || !path.basename(work).startsWith("canvas-palette-labels-")) throw Error("unexpected fixture cleanup path");
  await rm(work, { recursive: true, force: true });
}
