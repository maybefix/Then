// 本文で選んだ範囲を、右クリックの時点で正しく取れるか（AI-29）。ヘッドレスEdgeで
// 実際のエディタを組み、マウスのドラッグで範囲を選び、右クリックメニューの「コピー」で
// 渡る文字列を確かめる。「AIに渡す」は同じ控え（handleEditorContextMenu）を使う。
// 利用者のクリップボードには触れない（navigator.clipboard.writeText をページ内で受ける）。
//
//   node scripts/test-ai-selection-browser.mjs [--dist <dir>] [--no-build]
//
// 確かめる場面（通常の表示と原稿用紙モードの両方）
//   段落の中 / 見出し・段落・ルビ・傍点・縦中横をまたぐ / コメント行と \// の行をまたぐ /
//   表をまたぐ / 原稿用紙のページ境界と行末のぶら下げをまたぐ /
//   TSF入力中（本文に nativeImeActive、フォーカスは受け皿）/ 選択の外を右クリック
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
let dist = option("dist", null);
if (!dist) {
  dist = path.join(os.tmpdir(), "then-ai-selection-dist");
  if (!args.includes("--no-build")) {
    const result = spawnSync("npx", ["vite", "build", "--base", "./", "--outDir", dist, "--emptyOutDir"], { stdio: "inherit", shell: true });
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
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-ai-selection-qa-"));
const debugPort = 9800 + Math.floor(Math.random() * 150);
const browser = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
  "--no-first-run", "--disable-extensions", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank",
], { stdio: "ignore" });
guardBrowser(browser, profileDir);

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

// Anchor characters appear once each, so a drag can start and end on them.
const longLine = (n) => `　長い段落${n}。あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ、まみむめもやゆよらりるれろわをん。`;
const SOURCE = [
  "# 甲の章",
  "乙一行目の本文です。丙",
  "｜漢字《かんじ》と《《傍点》》と[12(tcy)]の行。丁",
  "// 作者のメモ：ここは伏線",
  "\\// 本文の斜線。戊",
  "| 表A | 表B |",
  "| --- | --- |",
  "| 己 | 1 |",
  "庚の後の段落。",
  ...Array.from({ length: 12 }, (_, i) => longLine(i + 1)),
  "辛のあとの行。あいうえおかきくけこさしすせそたちつてと。",
  ...Array.from({ length: 10 }, (_, i) => longLine(i + 13)),
  "壬で終わる。",
].join("\n");
const between = (from, to) => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to) + to.length);

const results = [];
try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  const page = await connect(target.webSocketDebuggerUrl);
  const evaluate = async (expression) => {
    const response = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 1200));
    return response.result.value;
  };
  const mouse = async (type, x, y, button = "left", clickCount = 1) => {
    const buttons = type === "mouseReleased" ? 0 : button === "left" ? 1 : button === "right" ? 2 : 0;
    await page.send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount });
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 2400, height: 1100, deviceScaleFactor: 1, mobile: false });

  /** Opens a new manuscript with SOURCE in the given layout. */
  const open = async (layoutMode) => {
    await page.send("Page.navigate", { url: appUrl });
    await sleep(1200);
    // The app saves its state about 0.7 s after loading. Stop this page from writing until the
    // reload, or that save can land after ours and bring back the default settings.
    await evaluate(`(() => {
      const setItem = Storage.prototype.setItem;
      localStorage.clear();
      Storage.prototype.setItem = Storage.prototype.removeItem = Storage.prototype.clear = () => {};
      setItem.call(localStorage, "then.app-state.v1", JSON.stringify({ settings: {
        writingMode: "vertical-rl", editorDisplayMode: "continuous", typewriterScroll: false, showComments: true,
        manuscript: { layoutMode: ${JSON.stringify(layoutMode)}, charactersPerLine: 20, linesPerPage: 20, showGrid: true, showPageBoundaries: true },
      } }));
      location.reload();
      return 1;
    })()`);
    await sleep(3000);
    const opened = await evaluate(`(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新しい原稿"))?.click();
      await new Promise((r) => setTimeout(r, 2500));
      const root = document.querySelector(".ProseMirror");
      if (!root) return false;
      root.focus();
      const data = new DataTransfer();
      data.setData("text/plain", ${JSON.stringify(SOURCE)});
      root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 2500));
      await document.fonts.ready;
      window.__copied = [];
      navigator.clipboard.writeText = async (text) => { window.__copied.push(text); };
      return true;
    })()`);
    assert.ok(opened, "editor did not open");
    const settings = await evaluate(`JSON.parse(localStorage.getItem("then.app-state.v1") ?? "null")?.settings ?? null`);
    assert.ok(settings?.typewriterScroll === false && settings?.manuscript?.layoutMode === layoutMode,
      `${layoutMode}: the test settings must survive the reload (typewriterScroll ${settings?.typewriterScroll}, layoutMode ${settings?.manuscript?.layoutMode})`);
    const text = await evaluate(`(() => { const parts = []; document.querySelector(".ProseMirror").editor.state.doc.forEach((n) => parts.push(n.textContent)); return parts.join("\\n"); })()`);
    assert.equal(text, SOURCE, `${layoutMode}: the pasted text must be kept as written`);
    return evaluate(`document.querySelectorAll(".manuscriptPageBoundary").length`);
  };

  /** Viewport rectangle of the visible character `char` (markup characters hidden by the editor are skipped). */
  const rectOf = (char) => evaluate(`(() => {
    const root = document.querySelector(".ProseMirror");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(".mk-hidden")) continue;
      const at = node.data.indexOf(${JSON.stringify(char)});
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + 1);
      const r = range.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return null;
  })()`);

  /** What is selected now: on screen (DOM) and in the editor (ProseMirror). */
  const selectionState = () => evaluate(`(() => {
    const ed = document.querySelector(".ProseMirror").editor;
    const { from, to } = ed.state.selection;
    return { dom: getSelection().toString(), from, to, pm: ed.state.doc.textBetween(from, to, "\\n") };
  })()`);
  let lastDrag = null;

  /**
   * Scrolls the editor sideways so the midpoint of `chars` sits in the middle of the viewport,
   * unless every one of them can already be pressed: off screen or under a sidebar counts as hidden.
   */
  const reveal = async (...chars) => {
    const rects = [];
    for (const char of chars) rects.push(await rectOf(char));
    const hidden = await evaluate(`(() => {
      const root = document.querySelector(".ProseMirror");
      return ${JSON.stringify(rects)}.some((r) => !root.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)));
    })()`);
    if (!hidden) return;
    const xs = rects.flatMap((r) => [r.left, r.right]);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    await evaluate(`(() => {
      let el = document.querySelector(".ProseMirror");
      while (el && !(el.scrollWidth > el.clientWidth + 10 && /auto|scroll/.test(getComputedStyle(el).overflowX))) el = el.parentElement;
      (el ?? document.scrollingElement).scrollLeft += ${mid} - innerWidth / 2;
      return 1;
    })()`);
    await sleep(400);
  };

  /**
   * Selects the source text from the first character of `from` through the last of `to`, by
   * editor position. Lines with notation change width when the caret enters them (hidden
   * markup is shown), so a mouse drag measured beforehand would land on other characters.
   * Paragraphs map one to one onto source lines: position = offset + line index + 1.
   */
  const selectSource = async (fromText, toText) => {
    const start = SOURCE.indexOf(fromText);
    const end = SOURCE.indexOf(toText) + toText.length;
    const pos = (offset) => offset + SOURCE.slice(0, offset).split("\n").length;
    await evaluate(`(() => {
      const ed = document.querySelector(".ProseMirror").editor;
      ed.commands.setTextSelection({ from: ${pos(start)}, to: ${pos(end)} });
      ed.view.focus();
      return 1;
    })()`);
    await sleep(300);
    lastDrag = { select: [fromText, toText], after: await selectionState() };
  };

  /** Drags from the leading edge of `from` to the trailing edge of `to` (vertical-rl: top to bottom of the glyph). */
  const drag = async (from, to) => {
    await reveal(from, to);
    const a = await rectOf(from);
    const b = await rectOf(to);
    assert.ok(a && b, `characters ${from} ${to} must be on screen`);
    const ax = (a.left + a.right) / 2, ay = a.top + 1;
    const bx = (b.left + b.right) / 2, by = b.bottom - 1;
    await mouse("mouseMoved", ax, ay);
    await mouse("mousePressed", ax, ay);
    for (let i = 1; i <= 8; i += 1) await mouse("mouseMoved", ax + ((bx - ax) * i) / 8, ay + ((by - ay) * i) / 8);
    await mouse("mouseReleased", bx, by);
    await sleep(300);
    lastDrag = { press: [Math.round(ax), Math.round(ay)], release: [Math.round(bx), Math.round(by)], after: await selectionState() };
  };

  /** Right-clicks on `char`, then presses コピー if it is enabled. Returns what was copied (null if コピー was disabled). */
  const rightClickCopy = async (char) => {
    await reveal(char);
    const r = await rectOf(char);
    const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    await evaluate("window.__copied = []; 1");
    const hit = await evaluate(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      const chain = [];
      for (let e = el; e && chain.length < 5; e = e.parentElement) chain.push(e.tagName + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").filter(Boolean).slice(0, 2).join(".") : ""));
      return { at: [Math.round(${x}), Math.round(${y})], viewport: [innerWidth, innerHeight], chain, inShell: Boolean(el?.closest(".verticalTypewriterShell")) };
    })()`);
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y, "right");
    await mouse("mouseReleased", x, y, "right");
    await sleep(400);
    const state = await evaluate(`(() => {
      const item = document.querySelector('.editorContextMenu [aria-label="コピー"]');
      if (!item) return { menu: false };
      if (item.disabled) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return { menu: true, disabled: true }; }
      item.click();
      return { menu: true, disabled: false };
    })()`);
    await sleep(300);
    const copied = await evaluate("window.__copied[0] ?? null");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(200);
    return { ...state, copied, diag: { drag: lastDrag, hit, afterRightClick: await selectionState() } };
  };

  const record = (layout, name, expected, got) => {
    results.push({ layout, name, ok: got.copied === expected, expected, got });
  };

  for (const layout of ["normal", "manuscript"]) {
    const boundaries = await open(layout);
    if (layout === "manuscript") results.push({ layout, name: "原稿用紙のページ境界が出ている", ok: boundaries > 0, expected: ">0", got: { copied: boundaries } });

    await drag("乙", "丙");
    record(layout, "段落の中", between("乙", "丙"), await rightClickCopy("一"));

    await selectSource("甲", "丁");
    record(layout, "見出し・段落・ルビ・傍点・縦中横をまたぐ（記法は原文のまま）", between("甲", "丁"), await rightClickCopy("本"));

    await selectSource("丁", "戊");
    record(layout, "コメント行と \\// の行をまたぐ（コメントも含む）", between("丁", "戊"), await rightClickCopy("メ"));

    await selectSource("戊", "庚");
    record(layout, "表をまたぐ", between("戊", "庚"), await rightClickCopy("己"));

    await drag("辛", "壬");
    record(layout, layout === "manuscript" ? "ページ境界と行末のぶら下げをまたぐ" : "長い範囲", between("辛", "壬"), await rightClickCopy("辛"));

    // TSF入力中：本文に nativeImeActive が付き、DOMフォーカスは受け皿にある。
    await drag("乙", "丙");
    await evaluate(`(() => {
      const sink = document.createElement("div"); sink.tabIndex = -1; sink.className = "qaFocusSink"; document.body.append(sink);
      document.querySelector(".ProseMirror").classList.add("nativeImeActive");
      sink.focus({ preventScroll: true });
      return document.activeElement === sink;
    })()`);
    record(layout, "TSF入力中（フォーカスは受け皿）", between("乙", "丙"), await rightClickCopy("一"));
    await evaluate(`(() => { document.querySelector(".ProseMirror").classList.remove("nativeImeActive"); document.querySelector(".qaFocusSink")?.remove(); return 1; })()`);

    // 選択の外を右クリックすると、選択はその位置へ移って外れ、コピー（とAIに渡す）は押せない。
    await drag("乙", "丙");
    const outside = await rightClickCopy("庚");
    results.push({ layout, name: "選択の外を右クリックすると、選択が外れてコピーは押せない",
      ok: Boolean(outside.menu && outside.disabled && outside.copied === null), expected: "（コピーが押せない）", got: outside });
  }

  page.close();
} finally {
  server.close();
  await stopBrowser(browser, profileDir);
}

const diagnose = args.includes("--diagnose");
for (const r of results) {
  if (diagnose || !r.ok) console.log(`      記録: ${JSON.stringify(r.got.diag ?? null)}`);
  const shown = r.got.copied === null ? (r.got.disabled ? "（コピーが押せない）" : "（メニューなし）") : JSON.stringify(r.got.copied);
  console.log(`${r.ok ? "OK  " : "NG  "}[${r.layout}] ${r.name}${r.ok && !r.name.includes("記録") ? "" : `\n      取れたもの: ${shown}${r.ok ? "" : `\n      期待: ${JSON.stringify(r.expected)}`}`}`);
}
if (results.some((r) => !r.ok)) process.exit(1);
console.log("selection capture tests passed");
