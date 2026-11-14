import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

// BINDER 2-2: 素材（一覧で role: "material"）のノートは、同じエディタを横書きのノートモードで開く
// （docs/BINDER_NOTE_MODE_PLAN.md）。前半は設定の差し替えの関数、後半は App 全体を Edge で動かし、
// 縦書き・原稿用紙・タイプライター（またはページ表示）にした設定で、原稿のタブは設定どおり、
// ノートのタブは横書き・連続表示になり、ステータスバー・タブの印・縦横ボタンが決めたとおりかを確かめる。
//
//   node scripts/test-note-mode.mjs [--dist <dir>] [--debug]

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const DEBUG = args.includes("--debug");

// ---- 1. 設定の差し替え ----
{
  const dir = path.resolve("test-artifacts/note-mode");
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: ["src/editor/noteMode.ts"],
    outfile: path.join(dir, "note-mode.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const m = await import(`${pathToFileURL(path.join(dir, "note-mode.mjs")).href}?${Date.now()}`);
  const settings = {
    writingMode: "vertical-rl",
    editorDisplayMode: "paged",
    pageFlowDirection: "horizontal-rtl",
    typewriterScroll: true,
    showTypewriterGuide: true,
    typewriterOffset: 40,
    manuscript: { layoutMode: "manuscript", charactersPerLine: 20, linesPerPage: 20, showGrid: true, showPageBoundaries: true, fontSize: 21 },
    editorFontFamily: "Yu Mincho",
    fontSize: 18,
    lineHeight: 1.9,
    editorMeasureHorizontal: 70,
    editorMeasureVertical: 80,
    showLineNumbers: true,
    showLineBreakMarks: true,
    highlightCurrentLine: true,
    colorizeJapaneseQuotes: true,
    showComments: false,
  };
  assert.equal(m.editorSettingsFor(settings, "manuscript"), settings, "原稿は設定をそのまま使う");
  const note = m.editorSettingsFor(settings, "note");
  assert.deepEqual(
    Object.keys(note).filter((key) => JSON.stringify(note[key]) !== JSON.stringify(settings[key])).sort(),
    ["editorDisplayMode", "manuscript", "showTypewriterGuide", "typewriterScroll", "writingMode"],
    "ノートで変えるのは4つの機能の値だけ",
  );
  assert.equal(note.writingMode, "horizontal-tb");
  assert.equal(note.editorDisplayMode, "continuous");
  assert.equal(note.typewriterScroll, false);
  assert.equal(note.showTypewriterGuide, false);
  assert.deepEqual(note.manuscript, { ...settings.manuscript, layoutMode: "normal" }, "原稿用紙は使わない（字詰めなどの値は残す）");
  assert.equal(settings.writingMode, "vertical-rl", "保存される設定は書き換えない");
  assert.equal(settings.manuscript.layoutMode, "manuscript", "保存される設定は書き換えない");

  const paths = m.collectMaterialPaths([
    { path: "C:/w/素材", role: "material" },
    { path: "C:/w/素材/人物.md", role: "material" },
    { path: "C:/w/資料/素材.md" },
    { path: "C:/w/本文.md", role: null },
  ]);
  assert.equal(m.documentModeFor("C:/w/素材/人物.md", paths), "note");
  assert.equal(m.documentModeFor("C:\\W\\素材\\人物.md", paths), "note", "区切りと大文字小文字はほかの比べ方（isSamePath）と同じに扱う");
  assert.equal(m.documentModeFor("C:/w/資料/素材.md", paths), "manuscript", "パスに「素材」が入っていても、role がなければ原稿");
  assert.equal(m.documentModeFor("C:/w/本文.md", paths), "manuscript");
  assert.equal(m.documentModeFor(null, paths), "manuscript", "保存先のない文書は原稿");
  assert.equal(m.documentModeFor("C:/w/素材/人物.md", new Set()), "manuscript", "素材の区分がなければ原稿（ライブラリ直下など）");
}

// ---- 2. App 全体 ----
let dist = option("dist", null);
const ownDist = !dist;
if (!dist) {
  dist = mkdtempSync(path.join(os.tmpdir(), "then-note-mode-dist-"));
  const result = spawnSync("npx", ["vite", "build", "--base", "./", "--outDir", `"${dist}"`, "--emptyOutDir", "--logLevel", "warn"],
    { stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
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

const WORK = "C:/qa/library/作品A";

/* Rust の代わり。作品Aに原稿2本（1本は「資料/素材.md」で、パスに「素材」が入るが role はない）と素材のノート1本。 */
function installMock({ work, settings }) {
  const file = (relative, extra = {}) => ({ path: `${work}/${relative}`, name: relative.split("/").pop(), kind: "file", children: [],
    fileId: `${work}/${relative}`, contentHash: null, modifiedAt: 1, ...extra });
  const folder = (relative, children, extra = {}) => ({ path: `${work}/${relative}`, name: relative.split("/").pop(), kind: "folder", children, ...extra });
  const texts = {
    [`${work}/本文.md`]: "原稿の本文です。",
    [`${work}/資料/素材.md`]: "原稿の資料です。",
    [`${work}/素材/人物.md`]: "人物のノートです。",
  };
  const projectFolder = {
    path: work, name: "作品A",
    children: [
      file("本文.md"),
      folder("資料", [file("資料/素材.md")]),
      folder("素材", [file("素材/人物.md", { role: "material" })], { role: "material" }),
    ],
    library: { path: "C:/qa/library", name: "library", role: "project", projects: [{ path: work, name: "作品A" }], misplacedProjects: [] },
  };
  const state = {
    lastWorkspacePath: work,
    lastFilePath: `${work}/本文.md`,
    recentWorkspaces: [{ path: work, name: "作品A", lastOpenedAt: 1 }],
    settings: { skipStartupPortal: true, ...settings },
  };
  // 素材には進捗が残っていることがある（1-3b: 素材へ移しても進捗は消さない）。タブに色を付けないこと。
  const fileProgress = { [`${work}/本文.md`]: "writing", [`${work}/素材/人物.md`]: "writing" };
  window.__unknownCommands = new Set();
  let callbackId = 1;
  const responses = {
    load_app_state: () => state,
    list_project_text_files: () => projectFolder,
    read_text_file: ({ path }) => ({ path, name: path.split("/").pop(), content: texts[path] ?? "", fileId: path, contentHash: null }),
    load_project_file_progress: () => ({ fileProgress, revision: 1, migratedCount: 0, contentHash: "", rebased: false }),
    load_project_checkpoints: () => ({ snapshots: [], warnings: [], migratedCount: 0, migrationComplete: true }),
    load_project_snippets: () => [],
    load_project_plot_cards: () => [],
    load_reference_layout: () => ({ version: 3, name: "default", cards: [], recent: [], ideaThreads: [] }),
    get_system_fonts: () => [],
    list_installed_plugins: () => ({ plugins: [], errors: [] }),
    "plugin:event|unlisten": () => null,
    "plugin:window|is_maximized": () => false,
    "plugin:window|is_fullscreen": () => false,
    "plugin:event|listen": () => callbackId++,
    get_font_faces: () => [],
    journal_recovery_scan: () => [],
    load_library_property_types: () => ({}),
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    convertFileSrc: (path) => `asset://localhost/${encodeURIComponent(path)}`,
    transformCallback(callback) {
      const id = callbackId++;
      window[`_${id}`] = callback;
      return id;
    },
    async invoke(command, args = {}) {
      if (responses[command]) return structuredClone(responses[command](args));
      if (/^(list_|load_)/.test(command)) return [];
      window.__unknownCommands.add(command);
      return null;
    },
  };
}

function pageHelpers() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (element) => element?.textContent?.trim() ?? "";
  window.t = {
    sleep,
    async waitFor(check, what, timeoutMs = 15_000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (check()) return;
        await sleep(50);
      }
      throw new Error(`timed out: ${what}`);
    },
    body: () => text(document.querySelector(".verticalTypewriterEditor .pm-root")),
    async open(relative, expectedText) {
      const row = [...document.querySelectorAll("[data-tree-entry-path]")]
        .find((element) => element.dataset.treeEntryPath.replace(/\\/g, "/").endsWith(`/${relative}`));
      if (!row) throw new Error(`tree row ${relative}`);
      (row.matches("button") ? row : row.querySelector("button")).click();
      await t.waitFor(() => t.body().includes(expectedText), `body of ${relative}`);
      await sleep(400);
    },
    async activateTab(name) {
      const button = [...document.querySelectorAll(".documentTabButton")].find((element) => text(element.querySelector(".documentTabName")) === name);
      if (!button) throw new Error(`tab ${name}`);
      button.click();
      await sleep(600);
    },
    look() {
      const shell = document.querySelector(".verticalTypewriterShell");
      const activeTab = document.querySelector(".activeDocumentTabItem .documentTabKind");
      const writingButton = [...document.querySelectorAll(".topbar .iconButton")]
        .find((button) => /^(縦書き|横書き)に切り替え$/.test(button.getAttribute("aria-label") ?? ""));
      return {
        appShell: document.querySelector(".appShell")?.dataset.writingMode,
        computed: getComputedStyle(document.querySelector(".verticalTypewriterEditor .pm-root")).writingMode,
        display: shell?.dataset.editorDisplay,
        manuscript: shell?.dataset.manuscript ?? null,
        guide: Boolean(document.querySelector(".verticalTypewriterGuide")),
        status: text(document.querySelector(".statusRight")),
        statusBar: text(document.querySelector(".statusbar")),
        tabNote: activeTab?.classList.contains("noteDocumentTabKind") ?? null,
        tabProgress: activeTab?.classList.contains("progressDocumentTabKind") ?? null,
        tabTitle: document.querySelector(".activeDocumentTabItem .documentTabButton")?.title ?? "",
        writingButton: writingButton ? { label: writingButton.getAttribute("aria-label"), disabled: writingButton.disabled,
          active: writingButton.classList.contains("activeIconButton") } : null,
      };
    },
  };
  return "ok";
}

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-note-mode-"));
const debugPort = 9500 + Math.floor(Math.random() * 400);
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

const MANUSCRIPT_SETTINGS = {
  writingMode: "vertical-rl",
  editorDisplayMode: "continuous",
  typewriterScroll: true,
  showTypewriterGuide: true,
  manuscript: { layoutMode: "manuscript", charactersPerLine: 20, linesPerPage: 20, showGrid: true, showPageBoundaries: true, fontSize: 21 },
};

let failure = null;
try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));
  let nextId = 0;
  const pending = new Map();
  const pageErrors = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  let mockScript = null;
  async function start(settings) {
    if (mockScript) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: mockScript });
    ({ identifier: mockScript } = await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.clear(); (${installMock})(${JSON.stringify({ work: WORK, settings })})`,
    }));
    await send("Page.navigate", { url: appUrl });
    await sleep(1500);
    await evaluate(`(${pageHelpers})()`);
    const opened = await evaluate(`(async () => {
      try { await t.waitFor(() => t.body().includes("原稿の本文です。"), "manuscript body", 30_000); return true; } catch { return false; }
    })()`);
    if (!opened) {
      const unknown = await evaluate("[...window.__unknownCommands].join(', ')");
      throw new Error(`作品Aの本文が開かなかった（差し替えていない命令: ${unknown}）\n${pageErrors.slice(0, 3).join("\n")}`);
    }
    await sleep(800);
  }

  // ---- 2-1. 縦書き・原稿用紙・タイプライター ----
  await start(MANUSCRIPT_SETTINGS);
  const manuscript = await evaluate("t.look()");
  await evaluate(`t.open("素材/人物.md", "人物のノートです。")`);
  const note = await evaluate("t.look()");
  await evaluate(`t.open("資料/素材.md", "原稿の資料です。")`);
  const pathWithMaterialName = await evaluate("t.look()");
  await evaluate(`t.activateTab("人物.md")`);
  const noteAgain = await evaluate("t.look()");
  await evaluate(`t.activateTab("本文.md")`);
  const manuscriptAgain = await evaluate("t.look()");
  if (DEBUG) console.log({ manuscript, note, pathWithMaterialName, noteAgain, manuscriptAgain });

  assert.equal(manuscript.appShell, "vertical-rl", "原稿は設定どおり縦書き");
  assert.equal(manuscript.computed, "vertical-rl");
  assert.equal(manuscript.manuscript, "true", "原稿は設定どおり原稿用紙");
  assert.equal(manuscript.guide, true, "原稿は設定どおりタイプライターのガイドを出す");
  assert.match(manuscript.statusBar, /原稿用紙 .+枚/, "原稿はステータスバーに原稿用紙の枚数");
  assert.match(manuscript.status, /^\d+文字$/, `原稿の字数は今のまま（${manuscript.status}）`);
  assert.deepEqual([manuscript.tabNote, manuscript.tabProgress], [false, true], "原稿のタブは今の印と進捗の色");
  assert.deepEqual(manuscript.writingButton, { label: "横書きに切り替え", disabled: false, active: false }, "原稿では縦横ボタンを押せる");

  assert.equal(note.appShell, "horizontal-tb", "ノートは横書き（横書き用の CSS も効く）");
  assert.equal(note.computed, "horizontal-tb");
  assert.equal(note.display, "continuous");
  assert.equal(note.manuscript, null, "ノートは原稿用紙を使わない");
  assert.equal(note.guide, false, "ノートはタイプライターのガイドを出さない");
  assert.doesNotMatch(note.statusBar, /原稿用紙|ページ/, "ノートでは原稿用紙の枚数とページ数を出さない");
  assert.match(note.status, /^ノート · \d+文字$/, `ノートの字数は「ノート · N文字」（${note.status}）`);
  assert.deepEqual([note.tabNote, note.tabProgress], [true, false], "ノートのタブはノートの印で、進捗が残っていても色を付けない");
  assert.doesNotMatch(note.tabTitle, /進捗/, "ノートのタブに進捗を出さない");
  assert.deepEqual(note.writingButton, { label: "横書きに切り替え", disabled: true, active: false }, "ノートのあいだ縦横ボタンは同じ場所で押せない");

  assert.equal(pathWithMaterialName.appShell, "vertical-rl", "パスに「素材」が入っていても、role がなければ原稿");
  assert.equal(pathWithMaterialName.manuscript, "true");
  assert.equal(pathWithMaterialName.tabNote, false);
  assert.deepEqual(noteAgain, note, "タブを切り替えてノートへ戻ると、またノートモード");
  assert.deepEqual({ ...manuscriptAgain, statusBar: null }, { ...manuscript, statusBar: null }, "原稿へ戻ると、設定どおりに戻る");

  // ---- 2-2. ページ表示 ----
  await start({ ...MANUSCRIPT_SETTINGS, editorDisplayMode: "paged", manuscript: { ...MANUSCRIPT_SETTINGS.manuscript, layoutMode: "normal" } });
  const pagedManuscript = await evaluate("t.look()");
  await evaluate(`t.open("素材/人物.md", "人物のノートです。")`);
  const pagedNote = await evaluate("t.look()");
  if (DEBUG) console.log({ pagedManuscript, pagedNote });
  assert.equal(pagedManuscript.display, "paged", "原稿は設定どおりページ表示");
  assert.match(pagedManuscript.statusBar, /\d+ \/ \d+ページ/, "原稿はページ数を出す");
  assert.equal(pagedNote.display, "continuous", "ノートはページ表示を使わない");
  assert.equal(pagedNote.appShell, "horizontal-tb");
  assert.doesNotMatch(pagedNote.statusBar, /ページ/, "ノートではページ数を出さない");

  assert.deepEqual(pageErrors, [], "the page throws no errors");
  socket.close();
} catch (error) {
  failure = error;
} finally {
  await stopBrowser(browser, profileDir);
  server.close();
  if (ownDist) await rm(dist, { recursive: true, force: true });
}
if (failure) throw failure;
console.log("note mode tests passed");
