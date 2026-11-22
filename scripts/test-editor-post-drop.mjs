// U6（docs/BINDER_POST_DRAG_SEARCH_PLAN.md）: アイデアのペインの投稿を本文へ落とすと、落とした位置に本文の写しが入る。
// Edge で本物の VerticalTextEditor を描き（縦書き・横書き）、投稿の ID を運ぶ drop を送る。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const root = process.cwd();
const bundle = path.join(root, "test-artifacts", "editor-post-drop");
await mkdir(bundle, { recursive: true });
await build({
  entryPoints: ["scripts/lib/editor-post-drop-qa.tsx"], bundle: true,
  outdir: bundle, entryNames: "harness", format: "esm", jsx: "automatic",
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".png": "file", ".svg": "file" },
  external: ["/fonts/*", "/assets/*"],
  logLevel: "error",
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  try {
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
    } else {
      response.setHeader("Content-Type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
      response.end(await readFile(path.join(bundle, path.basename(url.pathname))));
    }
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const appUrl = `http://127.0.0.1:${server.address().port}/`;
const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
assert.ok(edgePath, "Edge or Chrome is required");
const profile = await mkdtemp(path.join(os.tmpdir(), "then-post-drop-"));
const port = 9900 + Math.floor(Math.random() * 500);
const browser = spawn(edgePath, ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"],
{ stdio: "ignore", windowsHide: true });
guardBrowser(browser, profile);

const HEADING = "application/x-then-heading";
const failures = [];
const errors = [];
let passed = 0;
let socket;
try {
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,
        { method: "PUT", signal: AbortSignal.timeout(1500) }).then((r) => r.json());
      break;
    } catch { await sleep(200); }
  }
  assert.ok(target, "headless browser must start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
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
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  let run = 0;
  async function open(mode) {
    await send("Page.navigate", { url: `${appUrl}?mode=${mode}&run=${++run}` });
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate("window.__drop?.ready() === true")) { await sleep(150); return; } }
      catch (error) { if (!/context|navigat/i.test(error.message)) throw error; }
      await sleep(50);
    }
    throw new Error("editor did not mount");
  }
  const key = async (keyName, code, vk, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    }
    await sleep(60);
  };
  const undo = () => key("z", "KeyZ", 90, 2);
  const value = () => evaluate("__drop.value()");
  async function check(label, body) {
    try { await body(); passed += 1; console.log(`PASS ${label}`); }
    catch (error) { failures.push(`${label}: ${error.message}`); console.log(`FAIL ${label}: ${error.message}`); }
  }

  for (const mode of ["vertical-rl", "horizontal-tb"]) {
    await check(`${mode} D1: 落とした位置（「港」と「。」のあいだ）に本文の写しが入り、複数行は行に分かれる`, async () => {
      await open(mode);
      const result = await evaluate(`__drop.post(3, "p1")`);
      assert.equal(result.prevented, true, "the drop must be taken by the editor");
      await sleep(80);
      assert.equal(await value(), "朝の港灯台の夢\n波の音が遠い。\n船が出る。");
    });
    await check(`${mode} D2: カーソルは入れた文の後ろで、選ばれていない（続けて打っても消えない）`, async () => {
      const selection = await evaluate("__drop.selection()");
      assert.equal(selection.from, selection.to, "the inserted text must not stay selected");
      assert.equal(selection.head, "朝の港灯台の夢\n波の音が遠い".length);
      await send("Input.insertText", { text: "あ" });
      await sleep(80);
      assert.equal(await value(), "朝の港灯台の夢\n波の音が遠いあ。\n船が出る。");
    });
    await check(`${mode} D3: 打鍵の直後に落としても、Ctrl+Z 1回で入れた文だけが消える`, async () => {
      await open(mode);
      await evaluate("__drop.focus(); __drop.caretAt(3)");
      await sleep(60);
      await send("Input.insertText", { text: "今" });
      await sleep(20);
      assert.equal(await value(), "朝の港今。\n船が出る。");
      // 打った「今」のすぐ後ろへ落とす（隣り合う変更は、区切らないと1回の元に戻すにまとまる）。
      await evaluate(`__drop.post(4, "p2")`);
      await sleep(60);
      assert.equal(await value(), "朝の港今港で拾った言葉。\n船が出る。");
      await undo();
      assert.equal(await value(), "朝の港今。\n船が出る。", "only the dropped text is undone");
    });
    await check(`${mode} D6: 変換中に落としても何も入らない`, async () => {
      await open(mode);
      await evaluate("__drop.compose(true)");
      assert.equal(await evaluate("__drop.composing()"), true);
      await evaluate(`__drop.post(3, "p1")`);
      await sleep(60);
      await evaluate("__drop.compose(false)");
      assert.equal(await value(), "朝の港。\n船が出る。");
    });
    await check(`${mode}: 見つからない投稿は、名前（text/plain）が付いていても何も入らない`, async () => {
      await open(mode);
      const result = await evaluate(`__drop.post(3, "missing", { "text/plain": "名前" })`);
      await sleep(60);
      assert.equal(result.prevented, true);
      assert.equal(await value(), "朝の港。\n船が出る。");
    });
    await check(`${mode} K1: 名前（text/plain）も付いた投稿は、名前ではなく本文の写しが入る`, async () => {
      await open(mode);
      await evaluate(`__drop.post(3, "p1", { "text/plain": "灯台の夢" })`);
      await sleep(60);
      assert.equal(await value(), "朝の港灯台の夢\n波の音が遠い。\n船が出る。");
    });
    await check(`${mode} D10: 見出しのドラッグの形式だけなら何も入らない（今のまま）`, async () => {
      await open(mode);
      await evaluate(`__drop.drop(3, { ${JSON.stringify(HEADING)}: "{}" })`);
      await sleep(60);
      assert.equal(await value(), "朝の港。\n船が出る。");
    });
    await check(`${mode}: ふつうの文（text/plain だけ）の drop は今のまま入る`, async () => {
      await open(mode);
      await evaluate(`__drop.drop(3, { "text/plain": "外の文" })`);
      await sleep(60);
      assert.equal(await value(), "朝の港外の文。\n船が出る。");
    });
  }
  // ---- 狭いペイン（確認1の 4: 入らないときだけ、操作のボタンを次の行へ） ----
  async function openPane(width) {
    await send("Page.navigate", { url: `${appUrl}?pane=${width}&run=${++run}` });
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate("!!document.querySelector('.postItem .postWork')")) { await sleep(150); return evaluate("__drop.measurePane()"); } }
      catch (error) { if (!/context|navigat/i.test(error.message)) throw error; }
      await sleep(50);
    }
    throw new Error("pane did not mount");
  }
  await check("N1: 狭いペイン（300 px）でも、ほかの作品の作品名とボードの札が切れずに読め、ボタンは次の行の右", async () => {
    const pane = await openPane(300);
    assert.ok(pane.workWidth > 0, `作品名の幅 ${pane.workWidth}`);
    assert.equal(pane.workTruncated, false, "作品名は切れない");
    assert.ok(pane.boardWidth > 24, `札の幅 ${pane.boardWidth}`);
    assert.ok(pane.buttonsTop >= pane.headBottom - 1, "ボタンは次の行");
    assert.ok(Math.abs(pane.buttonsRight - pane.footRight) < 2, "ボタンは右に寄せる");
  });
  await check("N3: 広いペイン（420 px）では今のまま1行", async () => {
    const pane = await openPane(420);
    assert.ok(pane.buttonsTop < pane.headBottom, `同じ行（${pane.headBottom} / ${pane.buttonsTop}）`);
    assert.equal(pane.workTruncated, false);
  });
  assert.deepEqual(errors, [], "no browser exceptions");
} finally {
  socket?.close();
  await stopBrowser(browser, profile);
  await new Promise((resolve) => server.close(resolve));
}
assert.deepEqual(failures, [], "post drop regressions");
console.log(`editor post drop: ${passed} browser scenarios passed`);
