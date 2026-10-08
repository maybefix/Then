// Typing latency on a long manuscript, measured in a real (headless) Edge.
//
//   node scripts/benchmark-typing.mjs [--chars 100000] [--samples 60]
//        [--dist <dir>] [--no-build] [--profile] [--label name]
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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const CHARS = Number(option("chars", 100000));
const SAMPLES = Number(option("samples", 60));
const WARMUP = 5;
const label = option("label", "current");

let dist = option("dist", null);
if (!dist) {
  dist = path.resolve("tmp/bench-dist");
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
const appUrl = `http://127.0.0.1:${server.address().port}/`;

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-bench-"));
const debugPort = 9400 + Math.floor(Math.random() * 400);
const browser = spawn(edgePath, [
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
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  await new Promise((resolve) => (socket.onopen = resolve));
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  };
}

// Runs inside the page.
async function pageBenchmark({ chars, samples, warmup }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const pm = document.querySelector(".ProseMirror");
  const statusEl = () => document.querySelector(".statusRight");
  const sideEl = () => document.querySelector(".treeItemCharCount");
  const count = (el) => Number((el?.textContent ?? "").replace(/[^0-9]/g, ""));

  // Deterministic manuscript: chapter headings, dialogue, ruby, emphasis, blank lines.
  let seed = 42;
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

  pm.focus();
  const data = new DataTransfer();
  data.setData("text/plain", lines.join("\n"));
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
  const pasteSettledMs = performance.now() - pasteStart - 1000;

  const range = document.createRange();
  range.selectNodeContents(pm.lastElementChild);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  await sleep(500);

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
  const summary = { chars: count(statusEl()), lines: pm.childElementCount, pasteSettledMs: Math.round(pasteSettledMs) };
  for (const [key, values] of Object.entries(result)) {
    summary[key] = { p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: percentile(values, 1) };
  }
  return summary;
}

let exitCode = 0;
try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  const page = await connect(target.webSocketDebuggerUrl);
  const evaluate = async (expression) => {
    const response = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 800));
    return response.result.value;
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: appUrl });
  await sleep(1500);
  await evaluate("localStorage.clear(); location.reload(); 1");
  await sleep(4000);
  const opened = await evaluate(`(async () => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新しい原稿"));
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return Boolean(document.querySelector(".ProseMirror"));
  })()`);
  if (!opened) throw new Error("The editor did not open from the start page.");

  if (flag("profile")) {
    await page.send("Profiler.enable");
    await page.send("Profiler.setSamplingInterval", { interval: 100 });
  }
  const summary = await evaluate(`(${pageBenchmark})(${JSON.stringify({ chars: CHARS, samples: SAMPLES, warmup: WARMUP })})`);
  console.log(JSON.stringify({ label, ...summary }));

  if (flag("profile")) {
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
  }
  page.close();
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  browser.kill();
  server.close();
  await sleep(500);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
process.exit(exitCode);
