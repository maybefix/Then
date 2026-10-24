// 全テーマの CSS を読み込んだページをヘッドレス Edge で開き、部品の色とその下の色のコントラストを測る。
// test-window-controls-contrast.mjs と test-tree-row-contrast.mjs が使う。
// 色はページの中で計算する（半透明の重なりと linear-gradient の位置の色を含む）。ホバーは CDP のマウスの移動で、
// 本物の :hover を起こして読む。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { guardBrowser, stopBrowser } from "./stop-browser.mjs";

/** themeCatalog のテーマの id の一覧。 */
export async function loadThemeIds() {
  const bundle = await build({
    entryPoints: [path.join(process.cwd(), "src/themes.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "error",
  });
  const { themeCatalog } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  return themeCatalog.map((theme) => theme.id);
}

const luminance = ({ r, g, b }) => {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG のコントラスト比。 */
export const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

const fileUrl = (relative) => pathToFileURL(path.join(process.cwd(), relative)).href;

const pageHtml = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl("src/App.css")}">
<link rel="stylesheet" href="${fileUrl("src/styles/themes/index.css")}">
<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>
</head><body style="margin:0"><main class="appShell"></main>
<script>
const parse = (text) => {
  // color-mix() の結果は color(srgb 0〜1 の値 / 透明度) で返る。
  const srgb = /color\\(srgb ([^)]+)\\)/.exec(text);
  if (srgb) {
    const [r, g, b, a = 1] = srgb[1].split(/[\\s/]+/).filter(Boolean).map(Number);
    return { r: r * 255, g: g * 255, b: b * 255, a };
  }
  const match = /rgba?\\(([^)]+)\\)/.exec(text);
  if (!match) return null;
  const [r, g, b, a = 1] = match[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
};
const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});
// linear-gradient(<角度>deg, <色> <位置>%, ...) の、要素の中の (x, y) の色。
const sampleGradient = (image, box, x, y) => {
  const angle = (Number((/(-?[\\d.]+)deg/.exec(image) ?? [0, 180])[1]) * Math.PI) / 180;
  const stops = [...image.matchAll(/(rgba?\\([^)]+\\))\\s*([\\d.]+)%/g)].map((m) => ({ color: parse(m[1]), at: Number(m[2]) / 100 }));
  if (!image.startsWith("linear-gradient") || stops.length < 2) throw new Error("unsupported background: " + image);
  const length = Math.abs(box.width * Math.sin(angle)) + Math.abs(box.height * Math.cos(angle));
  const t = 0.5 + ((x - box.left - box.width / 2) * Math.sin(angle) - (y - box.top - box.height / 2) * Math.cos(angle)) / length;
  if (t <= stops[0].at) return stops[0].color;
  const last = stops[stops.length - 1];
  if (t >= last.at) return last.color;
  const i = stops.findIndex((stop, index) => t >= stop.at && t <= stops[index + 1].at);
  const [a, b] = [stops[i], stops[i + 1]];
  const k = (t - a.at) / (b.at - a.at);
  return { r: a.color.r + (b.color.r - a.color.r) * k, g: a.color.g + (b.color.g - a.color.g) * k, b: a.color.b + (b.color.b - a.color.b) * k, a: 1 };
};
// 画面の (x, y) に見えている背景の色。ウィンドウ操作ボタンがあれば隠して、その下の要素から親へたどる。
const backdropAt = (x, y) => {
  const controls = document.querySelector(".windowControls");
  if (controls) controls.style.visibility = "hidden";
  let element = document.elementFromPoint(x, y);
  if (controls) controls.style.visibility = "";
  const layers = [];
  for (; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    const color = parse(style.backgroundColor);
    if (style.backgroundImage !== "none") {
      const sampled = sampleGradient(style.backgroundImage, element.getBoundingClientRect(), x, y);
      layers.push(color && color.a > 0 ? over(sampled, color) : sampled);
      if (sampled.a >= 1) break;
    } else if (color && color.a > 0) {
      layers.push(color);
      if (color.a >= 1) break;
    }
  }
  return layers.reduceRight((bottom, top) => over(top, bottom), { r: 255, g: 255, b: 255, a: 1 });
};
const center = (element) => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};
window.__setScene = (body, view, theme) => {
  const shell = document.querySelector(".appShell");
  shell.dataset.theme = theme;
  shell.dataset.startupView = view;
  shell.dataset.nativeWindow = "true";
  shell.innerHTML = body;
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
};
// 部品の文字色を、部品の背景（あれば）とその下に見えている色の上で読む。
window.__read = (selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error("not found: " + selector);
  const point = center(element);
  const backdrop = backdropAt(point.x, point.y);
  const style = getComputedStyle(element);
  const own = parse(style.backgroundColor);
  const surface = own && own.a > 0 ? over(own, backdrop) : backdrop;
  const ink = parse(style.color);
  const opacity = Number(style.opacity);
  return JSON.stringify({ point, backdrop, surface, color: over({ ...ink, a: ink.a * opacity }, surface), opacity, rawBackground: style.backgroundColor, rawColor: style.color });
};
window.__cssVar = (name) => getComputedStyle(document.querySelector(".appShell")).getPropertyValue(name).trim();
</script></body></html>`;

/**
 * 全テーマの CSS を読んだページを開く。name は作業フォルダと一時プロファイルの名前に使う。
 * 返す close() でブラウザを止め、作業フォルダを消す。
 */
export async function openThemePage(name) {
  const workDir = path.join(process.cwd(), ".tmp", `${name}-${process.pid}`);
  await mkdir(workDir, { recursive: true });
  const htmlPath = path.join(workDir, "index.html");
  await writeFile(htmlPath, pageHtml);

  const edgePath = process.env.EDGE_PATH ?? [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find((candidate) => existsSync(candidate));
  if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
  const profileDir = mkdtempSync(path.join(os.tmpdir(), `then-${name}-qa-`));
  const debugPort = 9930 + Math.floor(Math.random() * 40);
  const browser = spawn(edgePath, [
    "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
    "--no-first-run", "--disable-extensions", "--allow-file-access-from-files", "about:blank",
  ], { stdio: "ignore" });
  guardBrowser(browser, profileDir);

  let socket;
  const close = async () => {
    socket?.close();
    await stopBrowser(browser, profileDir);
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const json = async (url, init) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        try { return await fetch(url, init).then((response) => response.json()); } catch { await sleep(200); }
      }
      throw new Error(`Could not reach ${url}`);
    };
    await json(`http://127.0.0.1:${debugPort}/json/version`);
    const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
    socket = new WebSocket(target.webSocketDebuggerUrl);
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

    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("typeof __setScene === 'function' && document.styleSheets.length >= 3")) break;
      await sleep(50);
    }
    // テーマの CSS（@import の先）まで読み終わるのを待つ。
    await evaluate("document.fonts.ready.then(() => true)");
    await sleep(300);

    return {
      evaluate,
      setScene: (body, view, theme) =>
        evaluate(`__setScene(${JSON.stringify(body)}, ${JSON.stringify(view)}, ${JSON.stringify(theme)})`),
      read: async (selector) => JSON.parse(await evaluate(`__read(${JSON.stringify(selector)})`)),
      cssVar: (name) => evaluate(`__cssVar(${JSON.stringify(name)})`),
      moveMouse: (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
