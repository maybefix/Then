// Render the real Then application with isolated in-memory project data.
// Run: node scripts/capture-pink-proposals.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const directory = path.resolve("docs/theme-mockups/pink-proposals");
const typewriterMode = process.argv.includes("--typewriter");
const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
console.log(`Preview server: ${origin}`);
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
assert.ok(edge, "Edge is required to render the proposals");
const profile = mkdtempSync(path.join(os.tmpdir(), "then-pink-preview-"));
const port = 10000 + Math.floor(Math.random() * 1000);
const browser = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--disable-extensions", "--disable-background-timer-throttling", "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
browser.stderr.on("data", (chunk) => process.stderr.write(chunk));
browser.on("exit", (code) => console.log(`Preview browser launcher exited: ${code}`));
console.log(`Preview browser pid ${browser.pid}, CDP ${port}`);
guardBrowser(browser, profile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 80; i++) {
    try { target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json()); break; }
    catch { await sleep(150); }
  }
  assert.ok(target, "Edge did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.onopen = resolve);
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const reports = [];
  for (const writing of ["vertical", "horizontal"]) {
    for (const theme of ["charcoal", "paper", "split", "reverse"]) {
      await send("Page.navigate", { url: `${origin}/docs/theme-mockups/pink-proposals/preview.html?theme=${theme}&writing=${writing}${typewriterMode ? "&typewriter=1" : ""}` });
      let ready = false;
      for (let i = 0; i < 140; i++) {
        ready = await evaluate(`(() => {
          const text = b => b.textContent?.trim() ?? '';
          [...document.querySelectorAll('button')].find(b => text(b) === 'あとで')?.click();
          return !!document.querySelector('.ProseMirror') && document.querySelector('.ProseMirror').innerText.includes('雨がやんだ') && document.querySelectorAll('.plotCard').length >= 3;
        })()`);
        if (ready) break;
        await sleep(200);
      }
      if (!ready) console.log(await evaluate(`document.body.innerText.slice(0,2500)`));
      assert.ok(ready, `${theme}/${writing}: preview failed to load`);
      await evaluate(`document.fonts.ready.then(() => true)`);
      if (typewriterMode) {
        await evaluate(`(() => { const editor = document.querySelector('.ProseMirror').editor; editor.commands.setTextSelection(90); editor.view.focus(); return true; })()`);
      }
      await sleep(650);
      await evaluate(`(() => {
        const style = document.createElement('style');
        style.textContent = '*,*::before,*::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
        document.head.append(style);
        document.activeElement?.blur();
        return true;
      })()`);
      const report = await evaluate(`(() => {
        const shell = document.querySelector('.appShell');
        const ui = getComputedStyle(shell), editor = getComputedStyle(document.querySelector('.editorColumn'));
        const get = (s, key) => s.getPropertyValue(key).trim();
        const rgb = hex => hex.replace('#','').match(/../g).map(x => parseInt(x,16)/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
        const luminance = hex => rgb(hex).reduce((v,x,i) => v+x*[.2126,.7152,.0722][i],0);
        const ratio = (a,b) => {const x=luminance(a),y=luminance(b);return +((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2)};
        const pairs = [
          ['UI body',get(ui,'--text-primary'),get(ui,'--bg-panel')],
          ['UI secondary',get(ui,'--text-secondary'),get(ui,'--bg-panel')],
          ['UI muted',get(ui,'--text-muted'),get(ui,'--sidebar-bg')],
          ['Action',get(ui,'--on-accent'),get(ui,'--accent')],
          ['Editor',get(editor,'--text-primary'),get(editor,'--editor-bg')],
          ['Editor secondary',get(editor,'--text-secondary'),get(editor,'--editor-bg')],
          ['Editor link',get(editor,'--accent-strong'),get(editor,'--editor-bg')],
        ].map(([role,foreground,background]) => ({role,foreground,background,contrast:ratio(foreground,background)}));
        const boxes = Object.fromEntries(['.workspace','.leftWorkspaceCluster','.editorColumn','.rightSidebar','.ProseMirror'].map(s => {
          const r = document.querySelector(s).getBoundingClientRect(); return [s,{x:r.x,y:r.y,width:r.width,height:r.height}];
        }));
        const actualText = getComputedStyle(document.querySelector('.ProseMirror'));
        const toHex = color => '#' + color.match(/[0-9.]+/g).slice(0,3).map(x => Number(x).toString(16).padStart(2,'0')).join('');
        let backdrop = null;
        for (let element = document.querySelector('.ProseMirror'); element; element = element.parentElement) {
          const style = getComputedStyle(element), color = style.backgroundColor;
          if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') { backdrop = color; break; }
        }
        if (!backdrop) throw new Error('No opaque editor backdrop');
        const actualPair = {role:'Rendered editor',foreground:toHex(actualText.color),background:toHex(backdrop)};
        actualPair.contrast = ratio(actualPair.foreground,actualPair.background);
        pairs.push(actualPair);
        const guideElement = document.querySelector('.verticalTypewriterGuide');
        const guideStyle = guideElement ? getComputedStyle(guideElement) : null;
        const horizontal = actualText.writingMode === 'horizontal-tb';
        const guideColor = guideStyle ? (horizontal ? guideStyle.borderTopColor : guideStyle.borderLeftColor) : null;
        const guideChannels = guideColor?.match(/[0-9.]+/g).map(Number);
        return {theme:shell.dataset.theme,writing:getComputedStyle(document.querySelector('.ProseMirror')).writingMode,pairs,boxes,
          guide: guideStyle ? {color:guideColor,alpha:guideChannels[3] ?? 1,opacity:Number(guideStyle.opacity),
            pointerEvents:guideStyle.pointerEvents,zIndex:guideStyle.zIndex,
            width:horizontal ? guideStyle.borderTopWidth : guideStyle.borderLeftWidth,editorScheme:editor.colorScheme} : null,
          headingColor:getComputedStyle(document.querySelector('.ProseMirror')).color,
          editorBackground:getComputedStyle(document.querySelector('.editorColumn')).backgroundColor,
          plotCards:document.querySelectorAll('.plotCard').length, treeRows:document.querySelectorAll('.treeItem').length};
      })()`);
      for (const pair of report.pairs) assert.ok(pair.contrast >= 4.5, `${theme}: ${JSON.stringify(pair)}`);
      const expectedTheme = { charcoal: "aplil-dark", paper: "aplil-light", split: "blossom-dark", reverse: "blossom-light" }[theme];
      assert.equal(report.theme, expectedTheme, "Render the registered production theme");
      if (typewriterMode) {
        assert.ok(report.guide, `${expectedTheme}/${writing}: typewriter guide must render`);
        assert.ok(report.guide.alpha > 0 && report.guide.alpha <= 0.15,
          `${expectedTheme}/${writing}: guide must be translucent, got ${report.guide.color}`);
        assert.equal(report.guide.pointerEvents, "none", "The guide must not intercept editing");
        assert.equal(report.guide.width, "1px", "The guide remains a single hairline");
        assert.equal(report.guide.color, report.guide.editorScheme === "dark"
          ? "rgba(244, 119, 164, 0.14)" : "rgba(199, 43, 104, 0.14)", "Guide color follows the editor rather than the surrounding UI");
      }
      if (theme === "reverse") {
        assert.equal(report.pairs.find((p) => p.role === "UI body").background, "#fffcfd", "D must keep the light UI");
        const rendered = report.pairs.find((p) => p.role === "Rendered editor");
        assert.equal(rendered.background, "#41414c", "D must render a dark manuscript");
        assert.equal(rendered.foreground, "#faf8fa", "D must render light manuscript text");
      }
      const previous = reports.find((r) => r.writing === report.writing);
      if (previous) assert.deepEqual(report.boxes, previous.boxes, `${writing}: theme must preserve geometry`);
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(path.join(directory, `${theme}-${writing}${typewriterMode ? "-typewriter" : ""}.png`), Buffer.from(screenshot.data, "base64"));
      reports.push(report);
      console.log(`${theme}/${writing}: saved; ${report.plotCards} plot cards; ${report.treeRows} tree rows; contrast >= ${Math.min(...report.pairs.map((p) => p.contrast))}`);
    }
  }
  if (!typewriterMode) {
    // Exercise the real picker, including automatic save through the IPC fixture.
    await evaluate(`document.querySelector('button[aria-label="テーマを選択"]').click()`);
    await sleep(250);
    for (const theme of ["aplil-light", "aplil-dark", "blossom-light", "blossom-dark"]) {
      const label = await evaluate(`(() => {
        const input = document.querySelector('input[name="theme"][value="${theme}"]');
        if (!input) throw new Error('Missing picker option: ${theme}');
        const label = input.closest('label');
        const group = input.closest('.themeGroup');
        const copy = label.querySelector('strong').textContent;
        label.click();
        return {copy, group: group.querySelector('h3').textContent};
      })()`);
      assert.equal(label.copy, theme.startsWith("aplil-") ? "Aplil" : "Blossom");
      assert.equal(label.group, theme.endsWith("-light") ? "ライト" : "ダーク");
      let saved = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        saved = await evaluate(`document.querySelector('.appShell').dataset.theme === '${theme}' && window.__previewSavedState?.settings?.theme === '${theme}'`);
        if (saved) break;
        await sleep(100);
      }
      assert.ok(saved, `${theme}: picker selection must apply and save`);
    }
    console.log("PASS picker: both families in light/dark groups, all four selections applied and saved");
  }
  assert.deepEqual(errors, [], "No uncaught runtime errors in preview");
  await writeFile(path.join(directory, typewriterMode ? "typewriter-verification.json" : "verification.json"), JSON.stringify({ viewport: { width: 1600, height: 1000 }, runtimeErrors: errors, reports }, null, 2));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  socket?.close(); await stopBrowser(browser, profile); await server.close();
}
