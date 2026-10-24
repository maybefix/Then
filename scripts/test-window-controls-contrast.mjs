// 右上のウィンドウ操作ボタン（最小化・最大化・閉じる）が、全テーマで、ボタンの下にあるものの上で
// 見えるかを、ヘッドレス Edge で App.css と全テーマの CSS を読み込んで確かめる。
// 下にあるものは画面で違う: 作品の上部の帯、起動画面の帯、起動中の背景、ライブラリの準備の背景。
// 帯のほかのボタン（ファイルメニュー・パンくず・右のアイコン）のホバーの背景も確かめる。
// ホバーはページの中の :hover を、CDP のマウスの移動で実際に起こして読む。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const workDir = path.join(process.cwd(), ".tmp", `window-controls-${process.pid}`);
await mkdir(workDir, { recursive: true });
const htmlPath = path.join(workDir, "index.html");
const fileUrl = (relative) => pathToFileURL(path.join(process.cwd(), relative)).href;

const themesBundle = await build({
  entryPoints: [path.join(process.cwd(), "src/themes.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  logLevel: "error",
});
const { themeCatalog } = await import(
  `data:text/javascript;base64,${Buffer.from(themesBundle.outputFiles[0].text).toString("base64")}`
);
const themes = themeCatalog.map((theme) => theme.id);
assert.ok(themes.length >= 60, `all themes are listed (${themes.length})`);

// 文字以外の部品のコントラストの目安（WCAG 1.4.11）。
const MIN_ICON_CONTRAST = 3;
// ホバーの背景が見えるとみなす差。白い帯のテーマで、帯のボタンのホバーがいちばん薄いもの
// （Coral、1.10）より少し下に置く。
const MIN_HOVER_CONTRAST = 1.09;

// overPage: App がボタンの下が帯でない画面で付ける印（data-over-page）。
const controls = (overPage = false) => `<div class="windowControls"${overPage ? ' data-over-page="true"' : ""} role="group">
  <button class="windowControlButton" data-button="minimize"><svg viewBox="0 0 12 12"><path d="M1.5 6.5h9" /></svg></button>
  <button class="windowControlButton" data-button="maximize"><svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" /></svg></button>
  <button class="windowControlButton windowCloseButton" data-button="close"><svg viewBox="0 0 12 12"><path d="m2 2 8 8M10 2 2 10" /></svg></button>
</div>`;
const topbar = `<section class="appFrame" data-app-mode="write"><header class="topbar">
  <div class="fileMenu"><button class="menuButton" data-topbar-button="file">ファイル</button></div>
  <nav class="breadcrumbs" style="flex: 1 1 auto"><button class="breadcrumbFolderButton workspaceSwitcherButton" data-topbar-button="crumb">作品</button></nav>
  <div class="topbarActions">
    <button class="iconButton" data-topbar-button="focus">◎</button>
    <button class="iconButton" data-topbar-button="theme">◎</button>
  </div>
</header></section>`;
const scenes = {
  editor: { view: "editor", body: `${controls()}${topbar}` },
  portal: {
    view: "portal",
    body: `${controls()}<section class="startupPortal"><header class="startupPortalHeader"><span class="startupPortalWordmark">Then</span></header></section>`,
  },
  loading: {
    view: "loading",
    body: `${controls(true)}<div class="startupPortalLoading" role="status">Then を読み込んでいます…</div>`,
  },
  librarySetup: {
    view: "editor",
    body: `${controls(true)}<section class="librarySetup"><div class="librarySetupPanel">ライブラリの準備</div></section>${topbar}`,
  },
};

await writeFile(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
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
// 画面の (x, y) に見えている背景の色。ウィンドウ操作ボタンを隠して、その下の要素から親へたどる。
const backdropAt = (x, y) => {
  const controls = document.querySelector(".windowControls");
  controls.style.visibility = "hidden";
  let element = document.elementFromPoint(x, y);
  controls.style.visibility = "";
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
window.__read = (selector) => {
  const element = document.querySelector(selector);
  const point = center(element);
  const backdrop = backdropAt(point.x, point.y);
  const style = getComputedStyle(element);
  const own = parse(style.backgroundColor);
  const surface = own && own.a > 0 ? over(own, backdrop) : backdrop;
  return JSON.stringify({ point, backdrop, surface, color: over(parse(style.color), surface), rawBackground: style.backgroundColor, rawColor: style.color });
};
window.__controlHover = () => getComputedStyle(document.querySelector(".appShell")).getPropertyValue("--control-hover").trim();
</script></body></html>`);

const luminance = ({ r, g, b }) => {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-window-controls-qa-"));
const debugPort = 9930 + Math.floor(Math.random() * 40);
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

const failures = [];
const fail = (message) => failures.push(message);
const round = (value) => value.toFixed(2);

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
  const read = async (selector) => JSON.parse(await evaluate(`__read(${JSON.stringify(selector)})`));
  const moveMouse = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });

  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("typeof __setScene === 'function' && document.styleSheets.length >= 3")) break;
    await sleep(50);
  }
  // テーマの CSS（@import の先）まで読み終わるのを待つ。
  await evaluate("document.fonts.ready.then(() => true)");
  await sleep(300);

  for (const [sceneName, scene] of Object.entries(scenes)) {
    for (const theme of themes) {
      const where = `${theme} / ${sceneName}`;
      await moveMouse(640, 700);
      await evaluate(`__setScene(${JSON.stringify(scene.body)}, ${JSON.stringify(scene.view)}, ${JSON.stringify(theme)})`);

      for (const button of ["minimize", "maximize", "close"]) {
        const selector = `[data-button="${button}"]`;
        const idle = await read(selector);
        const idleContrast = contrast(idle.color, idle.surface);
        if (idleContrast < MIN_ICON_CONTRAST) {
          fail(`${where}: ${button} icon contrast ${round(idleContrast)} (${idle.rawColor} on ${JSON.stringify(idle.surface)})`);
        }

        await moveMouse(idle.point.x, idle.point.y);
        const hover = await read(selector);
        if (button === "close") {
          if (hover.rawBackground !== "rgb(196, 43, 28)" || hover.rawColor !== "rgb(255, 255, 255)") {
            fail(`${where}: close hover must stay red and white (${hover.rawBackground}, ${hover.rawColor})`);
          }
        } else {
          const hoverContrast = contrast(hover.surface, idle.surface);
          if (hoverContrast < MIN_HOVER_CONTRAST) {
            fail(`${where}: ${button} hover background is not visible (${round(hoverContrast)}, ${hover.rawBackground})`);
          }
          const hoverIcon = contrast(hover.color, hover.surface);
          if (hoverIcon < MIN_ICON_CONTRAST) fail(`${where}: ${button} hover icon contrast ${round(hoverIcon)}`);
        }
        await moveMouse(640, 700);
      }

      if (sceneName !== "editor") continue;
      // 帯のほかのボタン。ホバーをわざと出さないテーマ（--control-hover が transparent）は除く。
      if ((await evaluate("__controlHover()")) === "transparent") continue;
      for (const button of ["file", "crumb", "focus", "theme"]) {
        const selector = `[data-topbar-button="${button}"]`;
        const idle = await read(selector);
        await moveMouse(idle.point.x, idle.point.y);
        const hover = await read(selector);
        const hoverContrast = contrast(hover.surface, idle.surface);
        if (hoverContrast < MIN_HOVER_CONTRAST) {
          fail(`${where}: topbar ${button} hover background is not visible (${round(hoverContrast)}, ${hover.rawBackground})`);
        }
        await moveMouse(640, 700);
      }
    }
  }
  socket.close();
} finally {
  await stopBrowser(browser, profileDir);
  await rm(workDir, { recursive: true, force: true });
}

assert.deepEqual(failures, [], `window controls and topbar buttons must be visible on every theme:\n${failures.join("\n")}`);
console.log(`window controls contrast tests passed (${themes.length} themes, ${Object.keys(scenes).length} screens)`);
