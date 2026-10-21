// Typing latency on a long manuscript, measured in a real (headless) Edge.
//
//   node scripts/benchmark-typing.mjs [--chars 100000] [--samples 60]
//        [--dist <dir>] [--no-build] [--profile] [--trace] [--label name] [--at end|middle]
//        [--project] [--scroll] [--css "<extra css>"]
//        [--typewriter --scenario typing|selection|ime --at middle]
//        [--writing-mode vertical-rl|horizontal-tb] [--line-numbers] [--highlight-line] [--line-breaks]
//        [--manuscript [--manuscript-chars 20] [--manuscript-lines 20]] [--measure-vertical 30] [--zone both] [--jumps 10]  (with --project --typewriter)
//
// Builds the app (unless --dist/--no-build), serves it, opens a blank
// manuscript, pastes a deterministic manuscript and types one character at a
// time at its end. For each keystroke it records:
//   sync     execCommand → ProseMirror has applied the input
//   paint    input → first animation frame (the character becomes visible)
//   status   input → status bar character count updated
//   sidebar  input → sidebar file character count updated
//   settled  input → first frame after both counts updated
// --profile adds a CPU profile summarised by entry point and self time.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { stopBrowser } from "./lib/stop-browser.mjs";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { runTypewriterBenchmark, validateTypewriterOverlays, validateTypewriterManualControls } from "./lib/typewriter-benchmark.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const MANUSCRIPT_TEXT = option("manuscript-file", null)
  ? (await readFile(option("manuscript-file"), "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") : null;
const CHARS = MANUSCRIPT_TEXT?.length ?? Number(option("chars", 100000));
const SAMPLES = Number(option("samples", 60));
const WARMUP = 5;
const label = option("label", "current");
const AT = option("at", "end");
// Experiments: extra CSS injected before measuring, e.g. --css "p { contain: none }".
const EXTRA_CSS = option("css", "");
// Open a mocked library project instead of a blank manuscript.
const PROJECT = flag("project");

let dist = option("dist", null);
if (!dist) {
  // Outside the project: the dev server would otherwise watch the build output.
  dist = path.join(os.tmpdir(), "then-bench-dist");
  if (!flag("no-build")) {
    const result = spawnSync("npx", ["vite", "build", "--base", "./", "--outDir", dist, "--emptyOutDir",
      ...(flag("profile") ? ["--minify", "false"] : [])], { stdio: "inherit", shell: true });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".json": "application/json", ".png": "image/png", ".wasm": "application/wasm" };
const server = http.createServer(async (req, res) => {
  let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (file.endsWith("/")) file += "index.html";
  try {
    const body = await readFile(path.join(dist, file));
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let appUrl = `http://127.0.0.1:${server.address().port}/`;

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-bench-"));
const debugPort = 9400 + Math.floor(Math.random() * 400);
const browser = flag("webview-exe") ? spawn(option("webview-exe"), [], {
  stdio: "ignore", windowsHide: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-allow-origins=*` },
}) : spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
  "--no-first-run", "--disable-extensions", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url, init) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await fetch(url, init).then((response) => response.json()); } catch { await sleep(200); }
  }
  throw new Error(`Could not reach ${url}`);
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const connection = {};
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method) connection.onEvent?.(message);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  await new Promise((resolve) => (socket.onopen = resolve));
  return Object.assign(connection, {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  });
}

// Deterministic manuscript: chapter headings, dialogue, ruby, emphasis, blank lines.
function manuscript(chars, seed = 42) {
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const phrases = ["彼女は窓の外を見た", "雨はまだ止まない", "遠くで汽笛が鳴った", "「それで、どうするの」",
    "|東雲《しののめ》の空が白む", "**誰も答えなかった**", "机の上に古い手紙がある", "時計の針が静かに進む"];
  const lines = [];
  let length = 0;
  let chapter = 1;
  while (length < chars) {
    if (lines.length % 60 === 0) {
      const heading = `# 第${chapter++}章`;
      lines.push(heading, "");
      length += heading.length;
      continue;
    }
    let line = "　";
    const sentences = 3 + Math.floor(random() * 5);
    for (let i = 0; i < sentences; i++) line += `${phrases[Math.floor(random() * phrases.length)]}。`;
    lines.push(line);
    length += line.length;
    if (random() < 0.2) lines.push("");
  }
  return lines.join(String.fromCharCode(10));
}

/*
 * Stands in for the Tauri backend so the app restores a library project on
 * startup, as the desktop app does: three folders of eight files, the first
 * of which is the long manuscript being typed into. Typing then also drives the
 * project AST and the sidebar's per-file and per-folder counts.
 */
function installProjectMock({ chars, manuscriptSource, manuscriptText = null, settings = {} }) {
  const make = new Function(`return (${manuscriptSource})`)();
  const root = "C:/bench/library/work";
  const files = new Map();
  const children = ["本編", "設定", "資料"].map((folder, folderIndex) => ({
    path: `${root}/${folder}`,
    name: folder,
    kind: "folder",
    children: Array.from({ length: 8 }, (_, fileIndex) => {
      const name = folderIndex === 0 && fileIndex === 0 ? "第一部.md" : `${folder}${fileIndex + 1}.md`;
      const path = `${root}/${folder}/${name}`;
      files.set(path, folderIndex === 0 && fileIndex === 0 ? (manuscriptText ?? make(chars)) : make(3000 + fileIndex * 700, 7 + fileIndex));
      return { path, name, kind: "file", children: [], fileId: path, contentHash: null, modifiedAt: 1 };
    }),
  }));
  const folder = {
    path: root,
    name: "work",
    children,
    library: { path: "C:/bench/library", name: "library", role: "project", projects: [{ path: root, name: "work" }], misplacedProjects: [] },
  };
  const state = {
    lastWorkspacePath: root,
    lastFilePath: `${root}/本編/第一部.md`,
    settings: { skipStartupPortal: true, ...settings },
  };
  const responses = {
    load_app_state: () => state,
    list_project_text_files: () => folder,
    read_text_file: ({ path }) => ({ path, name: path.split("/").pop(), content: files.get(path) ?? "", fileId: path, contentHash: null }),
    load_project_file_progress: () => ({ fileProgress: {}, revision: 0, migratedCount: 0, contentHash: "", rebased: false }),
    load_project_checkpoints: () => ({ snapshots: [], warnings: [], migratedCount: 0, migrationComplete: true }),
    get_system_fonts: () => [],
    list_installed_plugins: () => ({ plugins: [], errors: [] }),
    load_reference_layout: () => ({ version: 3, name: "default", cards: [], recent: [], ideaThreads: [] }),
    "plugin:event|unlisten": () => null,
    "plugin:window|is_maximized": () => false,
    "plugin:window|is_fullscreen": () => false,
    "plugin:event|listen": () => callbackId++,
    get_font_faces: () => [],
    journal_recovery_scan: () => [],
    load_library_property_types: () => ({}),
  };
  const arrays = /^(list_|load_project_snippets|load_project_plot_cards|load_project_proofread)/;
  let callbackId = 1;
  window.__benchUnknownCommands = new Set();
  window.__benchCommandCounts = {};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    convertFileSrc: (path) => `asset://localhost/${encodeURIComponent(path)}`,
    transformCallback(callback) {
      const id = callbackId++;
      window[`_${id}`] = callback;
      return id;
    },
    async invoke(command, args) {
      if (responses[command]) return structuredClone(responses[command](args ?? {}));
      if (arrays.test(command)) return [];
      window.__benchUnknownCommands.add(command);
      window.__benchCommandCounts[command] = (window.__benchCommandCounts[command] ?? 0) + 1;
      // Tauri hands invoke arguments over as JSON; pay that cost on the page as the app would.
      JSON.stringify(args ?? {});
      return null;
    },
  };
}

// Runs inside the page.
async function pageBenchmark({ chars, samples, warmup, at, project }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const pm = document.querySelector(".ProseMirror");
  const statusEl = () => document.querySelector(".statusRight");
  // The sidebar row of the manuscript being typed into.
  const sideEl = () => {
    for (const row of document.querySelectorAll(".treeItem")) {
      if (!project || row.querySelector(".treeItemName")?.textContent?.startsWith("第一部")) {
        const countEl = row.querySelector(".treeItemCharCount");
        if (countEl) return countEl;
      }
    }
    return null;
  };
  const count = (el) => Number((el?.textContent ?? "").replace(/[^0-9]/g, ""));

  let pasteSettledMs = null;
  if (!project) {
    pm.focus();
    const data = new DataTransfer();
    data.setData("text/plain", manuscript(chars));
    const pasteStart = performance.now();
    pm.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    let last = -1;
    let stable = 0;
    while (stable < 10) {
      await sleep(100);
      const value = count(statusEl());
      stable = value === last && value > 0 ? stable + 1 : 0;
      last = value;
    }
    pasteSettledMs = Math.round(performance.now() - pasteStart - 1000);
  } else {
    pm.focus();
  }

  const range = document.createRange();
  range.selectNodeContents(at === "middle" ? pm.children[Math.floor(pm.childElementCount / 2)] : pm.lastElementChild);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  await sleep(500);

  // Typing runs as a second step so the caller can sample main-thread metrics around it.
  window.__benchType = async () => {

  const waitFor = (read, before, start) => new Promise((resolve) => {
    if (read() !== before) return resolve(performance.now() - start);
    const observer = new MutationObserver(() => {
      if (read() === before) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(performance.now() - start);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    const timer = setTimeout(() => { observer.disconnect(); resolve(Number.NaN); }, 3000);
  });

  const result = { sync: [], paint: [], status: [], sidebar: [], settled: [] };
  for (let i = 0; i < samples; i++) {
    const statusBefore = count(statusEl());
    const sideBefore = count(sideEl());
    const start = performance.now();
    document.execCommand("insertText", false, "あ");
    const sync = performance.now() - start;
    const paint = frame().then(() => performance.now() - start);
    const [status, sidebar, painted] = await Promise.all([
      waitFor(() => count(statusEl()), statusBefore, start),
      waitFor(() => count(sideEl()), sideBefore, start),
      paint,
    ]);
    await frame();
    const settled = performance.now() - start;
    if (i >= warmup) {
      result.sync.push(sync);
      result.paint.push(painted);
      result.status.push(status);
      result.sidebar.push(sidebar);
      result.settled.push(settled);
    }
    await sleep(150);
  }
  const percentile = (values, p) => {
    const sorted = values.filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
    return sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1) : null;
  };
  const summary = { chars: count(statusEl()), lines: pm.childElementCount, pasteSettledMs };
  for (const [key, values] of Object.entries(result)) {
    summary[key] = { p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: percentile(values, 1) };
  }
  return summary;
  };
  return true;
}

let exitCode = 0;
let summary_manuscriptSettleMs = null;
try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  let target;
  if (flag("webview-exe")) {
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      target = (await json(`http://127.0.0.1:${debugPort}/json/list`)).find(t => t.type === "page" && t.url.includes("tauri.localhost"));
      if (!target) await sleep(200);
    }
  } else target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  if (!target) throw new Error("QA WebView2 page was not found");
  if (flag("webview-exe")) appUrl = target.url;
  const page = await connect(target.webSocketDebuggerUrl);
  const evaluate = async (expression) => {
    const response = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 800));
    return response.result.value;
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const pageErrors = [];
  page.onEvent = (message) => {
    if (message.method === "Runtime.exceptionThrown") pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") pageErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  };
  if (PROJECT) {
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(${installProjectMock})(${JSON.stringify({ chars: CHARS, manuscriptSource: manuscript.toString(), manuscriptText: MANUSCRIPT_TEXT, settings: flag("typewriter") ? {
        typewriterScroll: true, editorDisplayMode: "continuous",
        writingMode: option("writing-mode", "vertical-rl"),
        showLineNumbers: flag("line-numbers"), highlightCurrentLine: flag("highlight-line"),
        showLineBreakMarks: flag("line-breaks"),
        // サイドペインのホバー表示（Zoneモード、--zone both|left|right）。
        ...(option("zone", null) ? { sidebarHoverMode: option("zone", null) } : {}),
        // 縦書きの1列の長さ（編集領域に対する%）。原稿用紙と同じ行長で比べるときに使う。
        ...(option("measure-vertical", null) ? { editorMeasureVertical: Number(option("measure-vertical", null)) } : {}),
        // 原稿用紙モード（--manuscript, 既定 20字×20行）。
        ...(flag("manuscript") ? { manuscript: {
          layoutMode: "manuscript",
          charactersPerLine: Number(option("manuscript-chars", 20)),
          linesPerPage: Number(option("manuscript-lines", 20)),
          showGrid: true,
          showPageBoundaries: true,
        } } : {}),
      } : {} })})`,
    });
  }
  await page.send("Page.navigate", { url: appUrl });
  await sleep(1500);
  await evaluate("localStorage.clear(); location.reload(); 1");
  await sleep(4000);
  const opened = PROJECT
    ? await evaluate(`(async () => {
        for (let i = 0; i < 100; i++) {
          if ((document.querySelector(".ProseMirror")?.textContent.length ?? 0) > ${CHARS * 0.9}) return true;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return false;
      })()`)
    : await evaluate(`(async () => {
        // The native QA app keeps Tauri's read-only IPC bootstrap. Exercise an
        // unsaved manuscript with its isolated QA backend instead of replacing
        // native IPC with the browser-only project mock.
        if (${flag("webview-exe")}) {
          [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='あとで')?.click();
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新しい原稿"));
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return Boolean(document.querySelector(".ProseMirror"));
      })()`);
  if (!opened) {
    const unknown = PROJECT ? await evaluate("[...(window.__benchUnknownCommands ?? [])].join(', ')") : "";
    const text = await evaluate("document.body.innerText.slice(0, 300) + ' | editor chars: ' + (document.querySelector('.ProseMirror')?.textContent.length ?? 'none')");
    throw new Error(`The editor did not open${unknown ? ` (unmocked commands: ${unknown})` : ""}. Page: ${text}\n${pageErrors.slice(0, 5).join("\n").slice(0, 2000)}`);
  }
  if (flag("webview-exe") && flag("typewriter")) {
    await evaluate(`document.querySelector('button[aria-label="設定"]').click();true`);
    await sleep(100);
    await evaluate(`document.getElementById('settings-tab-body').click();true`);
    await evaluate(`(async()=>{
      const desired=${JSON.stringify({ "タイプライタースクロール":true,"行番号を表示":flag("line-numbers"),"現在行をハイライト":flag("highlight-line"),"改行記号を表示":flag("line-breaks") })};
      for(const [text,checked] of Object.entries(desired)){
        const label=[...document.querySelectorAll('.settingsModal label')].find(l=>l.querySelector('span')?.textContent.trim()===text);
        const input=label?.querySelector('input[type="checkbox"]');
        if(!input)throw new Error('Native QA setting missing: '+text);
        if(input.checked!==checked)input.click();
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      for(const [text,value] of [['本文方向',${JSON.stringify(option("writing-mode","vertical-rl"))}],['編集表示','continuous']]){
        const select=[...document.querySelectorAll('.settingsModal label')].find(l=>l.textContent.includes(text)&&l.querySelector('select'))?.querySelector('select');
        if(!select)throw new Error('Native QA select missing: '+text);
        select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      document.querySelector('.settingsModal button[aria-label="閉じる"]').click();
      document.querySelector('.ProseMirror').editor.view.focus();return true;
    })()`);
  }
  await evaluate(`window.manuscript = ${manuscript}; 1`);
  if (EXTRA_CSS) {
    await evaluate(`(() => { const style = document.createElement("style"); style.textContent = ${JSON.stringify(EXTRA_CSS)}; document.head.append(style); return 1; })()`);
  }

  if (flag("profile")) {
    await page.send("Profiler.enable");
    await page.send("Profiler.setSamplingInterval", { interval: 100 });
  }
  await evaluate(`(${pageBenchmark})(${JSON.stringify({ chars: CHARS, samples: SAMPLES, warmup: WARMUP, at: AT, project: PROJECT })})`);
  if (flag("typewriter")) {
    // Exclude initial font loading/viewport restoration from the input run.
    await evaluate("document.fonts.ready.then(() => new Promise(resolve => setTimeout(resolve, 1000)))");
  }
  if (flag("manuscript")) {
    // Manuscript mode settles every paragraph's line count once after opening
    // (idle time); measure typing after that, as a writer would.
    summary_manuscriptSettleMs = await evaluate(`(async () => {
      const start = performance.now();
      while (!document.querySelector(".statusManuscript") && performance.now() - start < 60000) await new Promise(r => setTimeout(r, 100));
      return Math.round(performance.now() - start);
    })()`);
  }
  // Main-thread time per keystroke. Unlike the latencies it does not jump by a
  // frame when work lands either side of a frame boundary.
  // --layers: list the composited layers (diagnosing commit/layerize cost).
  if (flag("layers")) {
    let layers = null;
    const previous = page.onEvent;
    page.onEvent = (message) => { if (message.method === "LayerTree.layerTreeDidChange" && message.params.layers) layers = message.params.layers; previous?.(message); };
    await page.send("DOM.enable");
    await page.send("LayerTree.enable");
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await evaluate("document.execCommand('insertText', false, 'あ'), new Promise((resolve) => setTimeout(resolve, 500))");
    const summary = [];
    for (const layer of layers ?? []) {
      let node = "";
      if (layer.backendNodeId) {
        try {
          const { node: described } = await page.send("DOM.describeNode", { backendNodeId: layer.backendNodeId });
          node = `${described.nodeName}${described.attributes ? "." + (described.attributes[described.attributes.indexOf("class") + 1] ?? "") : ""}`;
        } catch {}
      }
      summary.push({ node: node.slice(0, 80), w: Math.round(layer.width), h: Math.round(layer.height), drawsContent: layer.drawsContent, paints: layer.paintCount });
    }
    console.log(JSON.stringify({ count: summary.length, layers: summary.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 40) }, null, 1));
  }
  // --jumps N: click N outline headings (alternating ends of the manuscript)
  // instead of typing, and record how long the main thread is blocked.
  if (flag("jumps")) {
    await page.send("Performance.enable", { timeDomain: "threadTicks" });
    const jumpMetrics = async () => Object.fromEntries((await page.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const jumpBefore = await jumpMetrics();
    if (flag("profile")) { await page.send("Profiler.enable"); await page.send("Profiler.setSamplingInterval", { interval: 100 }); await page.send("Profiler.start"); }
    const jumps = await evaluate(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const items = [...document.querySelectorAll(".outlineTreeItem[data-outline-file-path]")]
        .filter((item) => item.dataset.outlineFilePath.endsWith("第一部.md"));
      if (items.length < 4) return { error: "outline items: " + items.length };
      const order = [];
      // Alternate between the far end and the middle of the outline.
      const at = (index) => items[Math.max(0, Math.min(items.length - 1, index))];
      for (let i = 0; i < ${Number(option("jumps", 10))}; i += 1) order.push(i % 2 ? at(Math.floor(items.length / 2) - (i % 3)) : at(items.length - 1 - (i % 3)));
      const results = [];
      const probeBefore = document.querySelector(".ProseMirror").__manuscriptProbeQA?.() ?? null;
      for (const item of order) {
        const tasks = [];
        const observer = new PerformanceObserver((list) => tasks.push(...list.getEntries().map((e) => e.duration)));
        observer.observe({ type: "longtask" });
        const start = performance.now();
        item.click();
        const firstFrame = await new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now() - start)));
        await sleep(1500);
        observer.disconnect();
        results.push({ firstFrame, longTasks: tasks.length, blocked: tasks.reduce((a, b) => a + b, 0), max: Math.max(0, ...tasks) });
      }
      const pick = (key) => results.map((r) => r[key]).sort((a, b) => a - b);
      const median = (key) => +pick(key)[Math.floor(results.length / 2)].toFixed(1);
      const max = (key) => +pick(key)[results.length - 1].toFixed(1);
      return { jumps: results.length, firstFrame: { p50: median("firstFrame"), max: max("firstFrame") },
        blocked: { p50: median("blocked"), max: max("blocked") }, longestTask: { p50: median("max"), max: max("max") },
        manuscriptStatus: document.querySelector(".statusManuscript")?.getAttribute("title") ?? null,
        probeBefore, probe: document.querySelector(".ProseMirror").__manuscriptProbeQA?.() ?? null,
        perJump: results.map((r) => Math.round(r.blocked)) };
    })()`);
    const jumpAfter = await jumpMetrics();
    if (flag("profile")) {
      const { profile } = await page.send("Profiler.stop");
      if (option("profile-file", null)) await writeFile(option("profile-file"), JSON.stringify(profile));
    }
    jumps.cpuPerJump = {
      task: +(((jumpAfter.TaskDuration - jumpBefore.TaskDuration) * 1000) / (jumps.jumps || 1)).toFixed(1),
      script: +(((jumpAfter.ScriptDuration - jumpBefore.ScriptDuration) * 1000) / (jumps.jumps || 1)).toFixed(1),
      style: +(((jumpAfter.RecalcStyleDuration - jumpBefore.RecalcStyleDuration) * 1000) / (jumps.jumps || 1)).toFixed(1),
      layout: +(((jumpAfter.LayoutDuration - jumpBefore.LayoutDuration) * 1000) / (jumps.jumps || 1)).toFixed(1),
    };
    console.log(JSON.stringify({ label, scenario: "jumps", ...jumps }));
    page.close();
  } else {
  await page.send("Performance.enable", { timeDomain: "threadTicks" });
  const metrics = async () => Object.fromEntries((await page.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const traceEvents = [];
  let traceDone = null;
  if (flag("trace")) {
    page.onEvent = (message) => {
      if (message.method === "Tracing.dataCollected") traceEvents.push(...message.params.value);
      if (message.method === "Tracing.tracingComplete") traceDone?.();
    };
    await page.send("Tracing.start", {
      traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.invalidationTracking", "blink", "v8.execute"] },
    });
  }
  // Which paragraphs the editor re-renders per keystroke (elements removed
  // under each top-level paragraph), to tell a window shift from the edited
  // paragraph being rebuilt.
  if (flag("count-redraws")) await evaluate(`(() => {
    const root = document.querySelector(".ProseMirror");
    const stats = window.__redraws = { removed: 0, paragraphs: new Map(), classes: new Map() };
    new MutationObserver((records) => {
      for (const record of records) {
        let p = record.target; while (p && p.parentElement !== root) p = p.parentElement;
        const index = p ? Array.prototype.indexOf.call(root.children, p) : -1;
        for (const node of record.removedNodes) {
          if (node.nodeType !== 1) continue;
          const count = 1 + node.querySelectorAll("*").length;
          stats.removed += count;
          const key = node.parentElement === null && record.target === root ? "paragraph" : index;
          stats.paragraphs.set(key, (stats.paragraphs.get(key) ?? 0) + count);
          for (const el of [node, ...node.querySelectorAll("*")]) stats.classes.set(el.className || el.nodeName, (stats.classes.get(el.className || el.nodeName) ?? 0) + 1);
        }
      }
    }).observe(root, { childList: true, subtree: true });
    return true;
  })()`);
  const before = await metrics();
  if (flag("profile") && flag("typewriter")) await page.send("Profiler.start");
  const summary = flag("typewriter")
    ? await runTypewriterBenchmark({ page, evaluate, samples: SAMPLES, scenario: option("scenario", "typing"), interval: Number(option("input-interval", 100)) })
    : await evaluate("window.__benchType()");
  const after = await metrics();
  if (flag("count-redraws")) {
    console.log("-- redraws per keystroke --\n" + await evaluate(`(() => {
      const s = window.__redraws, n = ${SAMPLES};
      const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ":" + (v / n).toFixed(1)).join("  ");
      return "removed elements " + (s.removed / n).toFixed(1) + "\\nby paragraph " + top(s.paragraphs) + "\\nparagraphs touched " + s.paragraphs.size + "\\nby class " + top(s.classes);
    })()`));
  }
  if (flag("profile") && flag("typewriter")) {
    const { profile } = await page.send("Profiler.stop");
    if (option("profile-file", null)) await writeFile(option("profile-file"), JSON.stringify(profile));
    const nodes = new Map(profile.nodes.map(node => [node.id, node]));
    const self = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const node = nodes.get(profile.samples[i]);
      const name = `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber + 1}`;
      self.set(name, (self.get(name) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
    }
    console.log("-- typewriter profile, self ms per input --\n" + [...self].filter(([name]) => !name.startsWith("(idle)")).sort((a,b) => b[1]-a[1]).slice(0,30).map(([name,ms]) => `${(ms/SAMPLES).toFixed(2)} ${name}`).join("\n"));
  }
  if (flag("trace")) {
    await new Promise((resolve) => { traceDone = resolve; page.send("Tracing.end"); });
    if (option("trace-file", null)) await writeFile(option("trace-file"), JSON.stringify({ traceEvents }));
    // The renderer main thread is the one doing layout.
    const layoutCounts = new Map();
    for (const event of traceEvents) {
      if (event.name === "Layout" || event.name === "UpdateLayoutTree") layoutCounts.set(event.tid, (layoutCounts.get(event.tid) ?? 0) + 1);
    }
    const mainThread = [...layoutCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const totals = new Map();
    for (const event of traceEvents) {
      if (event.tid !== mainThread || event.ph !== "X" || !event.dur) continue;
      totals.set(event.name, (totals.get(event.name) ?? 0) + event.dur);
    }
    console.log("\n-- trace events on the main thread, ms per keystroke (nested events overlap) --\n" +
      [...totals].sort((a, b) => b[1] - a[1]).slice(0, 40)
        .map(([name, dur]) => `${(dur / 1000 / SAMPLES).toFixed(2).padStart(7)}  ${name}`).join("\n"));
  }
  const perKey = (name) => +(((after[name] - before[name]) * 1000) / SAMPLES).toFixed(2);
  summary.cpuPerKey = {
    task: perKey("TaskDuration"),
    script: perKey("ScriptDuration"),
    style: perKey("RecalcStyleDuration"),
    layout: perKey("LayoutDuration"),
  };
  // Elements inside the editor: full-document decorations (line numbers,
  // manuscript mode) multiply them, and per-frame paint work grows with them.
  if (summary_manuscriptSettleMs !== null) summary.manuscriptSettleMs = summary_manuscriptSettleMs;
  summary.editorElements = await evaluate("document.querySelector('.ProseMirror').getElementsByTagName('*').length");
  if (flag("manuscript")) summary.manuscriptStatus = await evaluate("document.querySelector('.statusManuscript')?.getAttribute('title') ?? null");
  if (flag("element-classes")) summary.editorElementClasses = await evaluate(`(() => {
    const counts = {};
    for (const el of document.querySelector('.ProseMirror').getElementsByTagName('*')) {
      const key = el.tagName.toLowerCase() + '.' + [...el.classList].sort().join('.');
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25));
  })()`);
  if (flag("verify-overlays")) summary.overlayChecks = await validateTypewriterOverlays({ page, evaluate });
  if (flag("verify-controls")) summary.manualChecks = await validateTypewriterManualControls({ evaluate });
  if (flag("scroll")) {
    // Scroll through the manuscript a viewport at a time and record frame gaps.
    summary.scroll = await evaluate(`(async () => {
      const pm = document.querySelector(".ProseMirror");
      let scroller = pm.parentElement;
      while (scroller && scroller.scrollWidth <= scroller.clientWidth && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
      const gaps = [];
      let last = performance.now();
      const horizontal = scroller.scrollWidth > scroller.clientWidth;
      for (let i = 0; i < 120; i++) {
        if (horizontal) scroller.scrollLeft -= scroller.clientWidth * 0.5; else scroller.scrollTop += scroller.clientHeight * 0.5;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      gaps.sort((a, b) => a - b);
      return { p50: +gaps[60].toFixed(1), p95: +gaps[113].toFixed(1), max: +gaps[119].toFixed(1) };
    })()`);
  }
  if ((flag("qa-production") || flag("expect-clean")) && pageErrors.length) throw new Error(pageErrors.join("\n"));
  // Which unmocked commands the run reached (e.g. that the recovery journal was fed).
  if (PROJECT) summary.commands = await evaluate("({ ...(window.__benchCommandCounts ?? {}) })");
  const runtime = await page.send("Browser.getVersion");
  const result = { label, at: AT, project: PROJECT, requestedChars: CHARS, runtime, ...summary };
  if (option("output", null)) await writeFile(option("output"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));

  if (flag("profile") && !flag("typewriter")) {
    const keys = 20;
    await page.send("Profiler.start");
    await evaluate(`(async () => {
      for (let i = 0; i < ${keys}; i++) {
        document.execCommand("insertText", false, "い");
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    })()`);
    const { profile } = await page.send("Profiler.stop");
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parent = new Map();
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
    const name = (node) => `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber + 1}`;
    const ignored = new Set(["(idle)", "(program)", "(root)", "(garbage collector)"]);
    const self = new Map();
    const inclusive = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const delta = (profile.timeDeltas[i + 1] ?? 0) / 1000;
      let node = nodes.get(profile.samples[i]);
      if (ignored.has(node.callFrame.functionName)) continue;
      self.set(name(node), (self.get(name(node)) ?? 0) + delta);
      const seen = new Set();
      while (node && node.callFrame.functionName !== "(root)") {
        const key = name(node);
        if (!seen.has(key)) inclusive.set(key, (inclusive.get(key) ?? 0) + delta);
        seen.add(key);
        node = nodes.get(parent.get(node.id));
      }
    }
    const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([key, ms]) => `${(ms / keys).toFixed(2).padStart(6)}ms  ${key}`);
    console.log("\n-- self time per keystroke --\n" + top(self, 30).join("\n"));
    console.log("\n-- inclusive time per keystroke --\n" + top(inclusive, 60).join("\n"));
    // Which callback each sample ran under: the outermost frame with a function name.
    const entries = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const delta = (profile.timeDeltas[i + 1] ?? 0) / 1000;
      let node = nodes.get(profile.samples[i]);
      if (ignored.has(node.callFrame.functionName)) continue;
      const chain = [];
      while (node && node.callFrame.functionName !== "(root)") {
        chain.push(node);
        node = nodes.get(parent.get(node.id));
      }
      const appFrame = chain.reverse().find((frame) => /index-|proofread-/.test(frame.callFrame.url));
      const key = appFrame ? name(appFrame) : name(chain[0]);
      entries.set(key, (entries.get(key) ?? 0) + delta);
    }
    console.log("\n-- by outermost app frame, per keystroke --\n" + top(entries, 25).join("\n"));
    const appCode = new Map([...inclusive].filter(([key]) => /\sindex-[^ ]*$|\sproofread-[^ ]*$/.test(key)));
    console.log("\n-- app code, inclusive per keystroke --\n" + top(appCode, 50).join("\n"));
  }
  page.close();
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  server.close();
  await stopBrowser(browser, profileDir);
}
process.exit(exitCode);
