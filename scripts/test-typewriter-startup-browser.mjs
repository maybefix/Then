// node scripts/test-typewriter-startup-browser.mjs [--baseline]
// --baseline bundles the committed editor without modifying the working tree.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const baseline = process.argv.includes("--baseline");
const onlyCaret = process.argv.includes("--only-caret");
const root = process.cwd();
const directory = path.join(root, "tmp", "typewriter-startup-regression");
await mkdir(directory, { recursive: true });
const bundle = path.join(directory, baseline ? "baseline" : "fixed");
await build({
  entryPoints: ["scripts/lib/typewriter-startup-qa.tsx"], bundle: true,
  outdir: bundle, entryNames: "harness", format: "esm", jsx: "automatic",
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".png": "file", ".svg": "file" },
  external: ["/fonts/*", "/assets/*"],
  plugins: baseline ? [{ name: "committed-editor", setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/]VerticalTextEditor\.tsx$/ }, () => ({
      contents: execFileSync("git", ["show", "HEAD:src/VerticalTextEditor.tsx"], { encoding: "utf8" }),
      loader: "tsx", resolveDir: path.join(root, "src"),
    }));
  } }] : [],
});
const font = await readFile("public/fonts/NotoSerifCJKjp-Regular.otf");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  try {
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/late-font.otf") {
      await sleep(900);
      response.setHeader("Content-Type", "font/otf");
      response.end(font);
    } else if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
    } else {
      response.setHeader("Content-Type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
      response.end(await readFile(path.join(bundle, path.basename(url.pathname))));
    }
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const appUrl = `http://127.0.0.1:${server.address().port}/`;
const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
assert.ok(edgePath, "Edge or Chrome is required");
const profile = await mkdtemp(path.join(os.tmpdir(), "then-typewriter-regression-"));
const port = 9900 + Math.floor(Math.random() * 500);
const browser = spawn(edgePath, ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"],
{ stdio: "ignore", windowsHide: true });
guardBrowser(browser, profile);
let socket;
const reports = [], failures = [], errors = [];
try {
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,
        { method: "PUT", signal: AbortSignal.timeout(1500) }).then(r => r.json());
      break;
    } catch { await sleep(200); }
  }
  assert.ok(target, "headless browser must start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1020, deviceScaleFactor: 1, mobile: false });
  let run = 0;
  async function open(mode, scenario, viewport = false, captured = null, offset = 63) {
    const token = String(++run);
    await send("Page.navigate", { url: `${appUrl}?mode=${mode}&case=${scenario}&run=${token}&offset=${offset}${viewport ? "&viewport=1" : ""}${captured ? `&captured=${encodeURIComponent(JSON.stringify(captured))}` : ""}` });
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate(`window.__startup?.run === ${JSON.stringify(token)} && !!__startup.snapshot()`)) return; }
      catch (error) { if (!/context|navigat/i.test(error.message)) throw error; }
      await sleep(50);
    }
    throw new Error("editor did not mount");
  }
  async function waitUntil(ms) {
    await evaluate(`new Promise(resolve => setTimeout(resolve, Math.max(0, ${ms} - __startup.snapshot().elapsed)))`);
  }
  function check(label, snapshot, predicate) {
    reports.push({ label, ...snapshot });
    try { predicate(snapshot); console.log(`PASS ${label}: delta=${snapshot.delta.toFixed(2)}px`); }
    catch (error) { failures.push(`${label}: ${error.message}`); console.log(`FAIL ${label}: delta=${snapshot.delta.toFixed(2)}px`); }
  }
  const aligned = s => {
    assert.ok(Math.abs(s.delta) < 1, `expected <1px, got ${s.delta}`);
    assert.equal(s.selection, s.textLength, "restored cursor must stay at the end");
  };
  for (const mode of ["vertical-rl", "horizontal-tb"]) {
    for (const scenario of onlyCaret ? ["saved-caret", "saved-empty-caret"] : ["baseline", "width-150", "width-800", "font", "metrics", "decorations", "saved-caret", "saved-empty-caret"]) {
      await open(mode, scenario);
      const before = await evaluate("__startup.snapshot()");
      await waitUntil(1600);
      if (["font", "metrics"].includes(scenario)) {
        for (let i = 0; i < 80; i++) {
          if (await evaluate("__startup.snapshot().fontLoaded")) break;
          await sleep(50);
        }
        await sleep(200);
      }
      check(`${mode}/${scenario}`, await evaluate("__startup.snapshot()"), s => {
        aligned(s);
        if (!["width-150", "width-800"].includes(scenario)) {
          assert.equal(s.width, before.width, "viewport width stays fixed");
          assert.equal(s.height, before.height, "viewport height stays fixed");
        }
        if (["font", "metrics"].includes(scenario)) assert.ok(s.fontLoaded, "the actual font must finish loading");
      });
      if (scenario === "saved-empty-caret") {
        const captured = await evaluate("__startup.capture()");
        assert.ok(captured, "the final empty paragraph must have a saved viewport");
        await open(mode, scenario, false, captured);
        await waitUntil(1600);
        check(`${mode}/capture-restore-empty-caret`, await evaluate("__startup.snapshot()"), aligned);
      }
    }
    if (onlyCaret) continue;
    await open(mode, "width-800", true);
    await waitUntil(1500);
    check(`${mode}/typewriter-over-saved-viewport`, await evaluate("__startup.snapshot()"), aligned);
    await open(mode, "saved-viewport-off", true);
    await waitUntil(800);
    check(`${mode}/saved-viewport-off`, await evaluate("__startup.snapshot()"), s => {
      assert.ok(Math.abs(s.anchorDelta) < 1, `saved anchor drifted ${s.anchorDelta}px`);
      assert.ok(Math.abs(s.delta) > 20, "typewriter-off must restore the reading position");
    });
    for (const offset of [30, 46, 65]) {
      await open(mode, "baseline", true, null, offset);
      await waitUntil(600);
      check(`${mode}/configured-${offset}-over-saved-viewport`, await evaluate("__startup.snapshot()"), aligned);
    }
    await open(mode, "baseline");
    await waitUntil(100);
    await evaluate(`document.querySelector('.verticalTypewriterScroller').dispatchEvent(new WheelEvent('wheel', {deltaY:-240, cancelable:true}))`);
    const manual = await evaluate("__startup.snapshot()");
    await evaluate("__startup.notifyFonts()");
    await waitUntil(850);
    check(`${mode}/manual-scroll`, await evaluate("__startup.snapshot()"), s => {
      assert.ok(Math.abs(s.scroll - manual.scroll) < 1, "font completion must not undo a manual scroll");
      assert.ok(Math.abs(s.delta) > 100, "the caret must remain away from the guide after manual scrolling");
    });
    await open(mode, "baseline");
    await waitUntil(100);
    await evaluate("__startup.select()");
    await sleep(300);
    const selection = await evaluate("__startup.snapshot()");
    await evaluate("__startup.resize();__startup.notifyFonts()");
    await sleep(300);
    check(`${mode}/range-selection`, await evaluate("__startup.snapshot()"), s => {
      assert.equal(s.selection, selection.selection, "late layout must not restore the original cursor");
    });
    await open(mode, "baseline");
    await waitUntil(100);
    await evaluate("document.querySelector('.pm-root').dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true,data:'変換'}))");
    const composing = await evaluate("__startup.snapshot()");
    await evaluate("__startup.notifyFonts()");
    await sleep(200);
    check(`${mode}/IME`, await evaluate("__startup.snapshot()"), s => {
      assert.ok(s.composing);
      assert.ok(Math.abs(s.scroll - composing.scroll) < 1, "late font events must not move an IME composition");
    });
  }
  assert.deepEqual(errors, [], "no browser exceptions");
} finally {
  socket?.close();
  await stopBrowser(browser, profile);
  await new Promise(resolve => server.close(resolve));
  const artifacts = path.join(root, "test-artifacts", "typewriter-startup");
  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, baseline ? "baseline.json" : "fixed.json"),
    JSON.stringify({ reports, failures, errors }, null, 2) + "\n");
}
assert.deepEqual(failures, [], "startup layout regressions");
console.log(`typewriter startup: ${reports.length} browser scenarios passed`);
