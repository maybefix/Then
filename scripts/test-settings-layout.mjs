// Real Chromium layout checks for the settings component with the shipped CSS.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(path.resolve("tmp/settings-layout-"));
const screenshots = path.resolve("artifacts/settings");
await mkdir(screenshots, { recursive: true });
await build({
  stdin: {
    contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { SettingsModal } from "./src/components/dialogs/SettingsModal";
      import { createDefaultState } from "./src/storedStateModel";
      import { themeCatalog } from "./src/themes";
      import "./src/App.css";
      import "./src/styles/themes/index.css";
      function Harness() {
        const [settings, setSettings] = useState(createDefaultState().settings);
        window.configureSettings = values => {
          if (!themeCatalog.some(theme => theme.id === values.theme)) throw new Error("Unknown test theme");
          setSettings(s => ({...s, ...values}));
        };
        return <div className="appShell" data-theme={settings.theme} style={{"--ui-font-scale": settings.uiFontScale}}>
          <SettingsModal settings={settings} systemFonts={[{label:"Segoe UI", cssFamily:'"Segoe UI"'}]}
            editorMeasureLimit={800} onClose={() => {}} onOpenThemePicker={() => {}}
            onUpdateSettings={(key,value) => setSettings(s => ({...s,[key]:value}))}/>
        </div>;
      }
      createRoot(document.getElementById("root")).render(<Harness/>);
    `,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, format: "esm", outdir: directory, entryNames: "app",
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file" },
  logLevel: "error",
});
await writeFile(path.join(directory, "index.html"), '<meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');
const server = http.createServer(async (request, response) => {
  const name = new URL(request.url, "http://localhost").pathname;
  const filename = path.resolve(directory, `.${name === "/" ? "/index.html" : name}`);
  if (!filename.startsWith(directory + path.sep)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff": "font/woff" }[path.extname(filename)] ?? "application/octet-stream");
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const edge = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
assert.ok(edge, "Set EDGE_PATH to a Chromium browser");
const profile = await mkdtemp(path.join(os.tmpdir(), "then-settings-layout-"));
assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
const browser = guardBrowser(spawn(edge, [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--disable-extensions", "about:blank",
], { stdio: "ignore" }), profile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await sleep(100); }
  }
  assert.ok(port, "Browser must start");
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.onopen = resolve);
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 100 && !await evaluate('!!document.querySelector(".settingsModal")'); i++) await sleep(100);
  assert.ok(await evaluate('!!document.querySelector(".settingsModal")'));
  const frame = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const measurements = `(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height};
    };
    const content = document.querySelector('.settingsContent');
    const sidebar = document.querySelector('.settingsSidebar');
    const overflows = [...content.querySelectorAll('input, select, button')].filter(e => {
      const r=e.getBoundingClientRect(), c=content.getBoundingClientRect();
      return r.width>0 && (r.left<c.left-1 || r.right>c.right+1);
    }).map(e => e.outerHTML.slice(0,180));
    return {modal:rect('.settingsModal'),sidebar:rect('.settingsSidebar'),content:rect('.settingsContent'),
      header:rect('.modalHeader'),footer:rect('.modalActions'),
      overflow:content.scrollWidth>content.clientWidth+1 || sidebar.scrollWidth>sidebar.clientWidth+1,
      overflows, contentScrolls:content.scrollHeight>content.clientHeight, sidebarScroll:sidebar.scrollTop};
  })()`;
  const cases = [
    { width: 1280, height: 900, scale: 1, theme: "dark" },
    { width: 1280, height: 900, scale: 1, theme: "default" },
    { width: 800, height: 600, scale: 1.3, theme: "dark" },
    { width: 640, height: 520, scale: 1.3, theme: "sen-light" },
    { width: 640, height: 520, scale: 1.3, theme: "sen-dark" },
  ];
  for (const scenario of cases) {
    await send("Emulation.setDeviceMetricsOverride", { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.configureSettings(${JSON.stringify({ uiFontScale: scenario.scale, theme: scenario.theme })})`);
    await frame();
    for (const category of ["appearance", "files", "body", "manuscript", "writing", "canvas", "export"]) {
      await evaluate(`document.getElementById('settings-tab-${category}').click()`);
      await frame();
      if (category === "manuscript") {
        await evaluate(`(() => { const s=document.querySelector('#settings-panel-manuscript select'); s.value='manuscript'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
        await frame();
      }
      const result = await evaluate(measurements);
      const context = JSON.stringify({ scenario, category, result });
      assert.ok(result.modal.left >= 0 && result.modal.right <= scenario.width + 1, context);
      assert.ok(result.modal.top >= 0 && result.modal.bottom <= scenario.height + 1, context);
      assert.ok(result.sidebar.right <= result.content.left + 1, context);
      assert.ok(result.header.bottom <= result.content.top + 1 && result.content.bottom <= result.footer.top + 1, context);
      assert.equal(result.overflow, false, context);
      assert.deepEqual(result.overflows, [], context);
      assert.equal(await evaluate('document.querySelector(".settingsContent").scrollTop'), 0, "category changes reset content scroll");
      if (category === "writing") {
        assert.equal(result.contentScrolls, true, "long categories must scroll independently");
        await evaluate('document.querySelector(".settingsContent").scrollTop=10000');
        const after = await evaluate(measurements);
        assert.deepEqual(after.sidebar, result.sidebar);
        assert.deepEqual(after.footer, result.footer);
        assert.equal(after.sidebarScroll, 0);
      }
      if (["appearance", "writing"].includes(category)) {
        await evaluate('document.querySelector(".settingsContent").scrollTop=0');
        const png = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(screenshots, `${scenario.theme}-${scenario.width}-${scenario.scale}-${category}.png`), Buffer.from(png.data, "base64"));
      }
    }
    console.log(`PASS layout: ${scenario.width}×${scenario.height}, ${scenario.scale * 100}%, ${scenario.theme}, 7 categories`);
  }
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  await stopBrowser(browser, profile);
  await new Promise((resolve) => server.close(resolve));
}
