import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

// 作品を切り替える直前（0.7秒以内）の遅延保存が、前の作品へ書かれることを、App 全体を Edge で動かして
// 確かめる（docs/SAVE_ON_WORK_SWITCH_FIX_PLAN.md）。Rust の代わりに、作品ごとの保存先を持つ入れ物を
// 置き、どの作品へ何を保存したかを記録する。前の作品のデータを新しい作品へ書かないことも確かめる。
// 遅延保存の例は、資料カードを畳むこと（資料の並びのファイルを0.7秒遅れて書く）。BINDER 2-4 で Idea を
// 投稿とノートへ移して Idea の遅延保存がなくなったので、Idea から資料カードに替えた。
//
//   node scripts/test-save-on-work-switch.mjs [--dist <dir>] [--debug]

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const DEBUG = args.includes("--debug");

// build は作品の外へ出す（dist を書き換えない。開発サーバーにも見られない）。
let dist = option("dist", null);
const ownDist = !dist;
if (!dist) {
  dist = mkdtempSync(path.join(os.tmpdir(), "then-switch-save-dist-"));
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

const LIBRARY = "C:/qa/library";
const WORK_A = `${LIBRARY}/作品A`;
const WORK_B = `${LIBRARY}/作品B`;
/*
 * Rust の代わり（ページの中で動く）。作品ごとに資料ボード（開いた資料カード1枚）を持ち（Plot と Idea は移行済みで
 * 空）、保存の命令は記録して中身を置き換える（もう一度開くと、保存したものが読まれる）。
 */
function installMock({ library, workA, workB }) {
  const referenceCard = (id, sourcePath) => ({ id, sourceType: "reference", scope: "project", sourcePath, kind: "markdown",
    x: 40, y: 60, width: 320, height: 300, zIndex: 1, collapsed: false, pinned: false });
  const projects = [{ path: workA, name: "作品A" }, { path: workB, name: "作品B" }];
  const work = (root, name, letter) => ({
    folder: {
      path: root, name,
      children: [{ path: `${root}/本文.txt`, name: "本文.txt", kind: "file", children: [], fileId: `${root}/本文.txt`, contentHash: null, modifiedAt: 1 }],
      library: { path: library, name: "library", role: "project", projects, misplacedProjects: [] },
    },
    text: `${name}の本文です。`,
    snippets: [],
    plotCards: [],
    layout: { version: 3, name: "default", cards: [referenceCard(`card-${letter}`, `素材/資料/${name}の資料.md`)], recent: [], ideaThreads: [] },
    proofreadTerms: [],
    proofreadIgnored: {},
  });
  const works = { [workA]: work(workA, "作品A", "a"), [workB]: work(workB, "作品B", "b") };
  const rootOf = (value) => Object.keys(works).find((root) => value === root || value?.startsWith(`${root}/`));
  const state = {
    lastWorkspacePath: workA,
    lastFilePath: `${workA}/本文.txt`,
    rightSidebarTab: "idea",
    recentWorkspaces: projects.map((project, index) => ({ ...project, lastOpenedAt: 2 - index })),
    settings: { skipStartupPortal: true },
  };
  const saves = { save_project_snippets: "snippets", save_project_plot_cards: "plotCards", save_reference_layout: "layout",
    save_project_proofread_terms: "proofreadTerms", save_project_proofread_ignored: "proofreadIgnored" };
  const loads = { load_project_snippets: "snippets", load_project_plot_cards: "plotCards", load_reference_layout: "layout",
    load_project_proofread_terms: "proofreadTerms", load_project_proofread_ignored: "proofreadIgnored" };
  window.__saves = [];
  window.__works = works;
  window.__unknownCommands = new Set();
  let callbackId = 1;
  const responses = {
    load_app_state: () => state,
    list_project_text_files: ({ folderPath }) => works[rootOf(folderPath)].folder,
    read_text_file: ({ path }) => ({ path, name: path.split("/").pop(), content: works[rootOf(path)]?.text ?? "", fileId: path, contentHash: null }),
    load_project_file_progress: () => ({ fileProgress: {}, revision: 0, migratedCount: 0, contentHash: "", rebased: false }),
    load_project_checkpoints: () => ({ snapshots: [], warnings: [], migratedCount: 0, migrationComplete: true }),
    get_system_fonts: () => [],
    list_installed_plugins: () => ({ plugins: [], errors: [] }),
    "plugin:event|unlisten": () => null,
    "plugin:window|is_maximized": () => false,
    "plugin:window|is_fullscreen": () => false,
    "plugin:event|listen": () => callbackId++,
    get_font_faces: () => [],
    journal_recovery_scan: () => [],
    load_library_property_types: () => ({}),
    read_reference_text: ({ sourcePath }) => `${sourcePath} の本文`,
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
      if (saves[command]) {
        const value = Object.entries(args).find(([key]) => key !== "rootPath")?.[1];
        window.__saves.push({ command, root: args.rootPath, body: JSON.stringify(value), at: Math.round(performance.now()) });
        const stored = structuredClone(value);
        // Rust は並び順の項目を serde_json::Value のまま書くので、項目のキーが名前の順に並び替わる。
        if (command === "save_reference_layout") {
          for (const layout of stored.ideaThreads ?? []) {
            layout.items = layout.items.map((item) => Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1))));
          }
        }
        works[args.rootPath][saves[command]] = stored;
        return null;
      }
      if (loads[command]) return structuredClone(works[args.rootPath][loads[command]]);
      if (responses[command]) return structuredClone(responses[command](args));
      if (/^list_/.test(command)) return [];
      window.__unknownCommands.add(command);
      return null;
    },
  };
}

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-switch-save-"));
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

// 画面の中で使う手助け。
function pageHelpers() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (element) => element?.textContent?.trim() ?? "";
  const must = (value, what) => {
    if (!value) throw new Error(`not found: ${what}`);
    return value;
  };
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
    // パンくずは「ライブラリ › 作品 › ファイル」。作品のボタン（作品の切り替え）の文字で、開いている作品を見る。
    workName: () => [...document.querySelectorAll(".workspaceSwitcherButton")].map(text).find((name) => name.startsWith("作品")) ?? "",
    // 開いている資料カード（題はファイル名）と、畳んでいるか。
    cardTitle: () => text(document.querySelector(".referenceCard .referenceCardHeader strong")),
    cardCollapsed: () => Boolean(document.querySelector(".referenceCard.collapsedReferenceCard")),
    /** 資料カードの「折り畳み」／「展開」を押す。 */
    toggleCard() {
      must(document.querySelector('.referenceCard .referenceCardActions button[aria-label="折り畳み"], .referenceCard .referenceCardActions button[aria-label="展開"]'), "card toggle").click();
    },
    /** 作品の切り替えメニューを開いて、作品を押す（待たない）。 */
    async startSwitch(name) {
      must(document.querySelector('[aria-label="プロジェクトを切り替え"]'), "switcher").click();
      await window.t.waitFor(() => document.querySelector(".workspaceRecordButton"), "switch menu", 2000);
      must([...document.querySelectorAll(".workspaceRecordButton")].find((button) => text(button.querySelector(".workspaceRecordName")) === name), `work ${name}`).click();
    },
    async switchTo(name) {
      await window.t.startSwitch(name);
      await window.t.waitFor(() => window.t.workName() === name, `work ${name}`);
    },
    async rightPane(label) {
      must([...document.querySelectorAll(".rightPaneSwitcherButton")].find((element) => element.getAttribute("aria-label")?.startsWith("補助ペイン")), "right pane switcher").click();
      await sleep(250);
      must([...document.querySelectorAll(".rightPaneSwitcherPopover button, .rightPaneSwitcherPopover [role^=menuitem]")].find((element) => text(element).startsWith(label)), `pane ${label}`).click();
      await sleep(400);
    },
  };
  return "ok";
}

const parse = (save) => JSON.parse(save.body);
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
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(${installMock})(${JSON.stringify({ library: LIBRARY, workA: WORK_A, workB: WORK_B })})`,
  });
  await send("Page.navigate", { url: appUrl });
  await sleep(1000);
  await evaluate("localStorage.clear(); location.reload(); 1");
  await sleep(1000);
  await evaluate(`(${pageHelpers})()`);
  const opened = await evaluate(`(async () => {
    try {
      await t.waitFor(() => t.workName() === "作品A" && t.cardTitle() === "作品Aの資料.md", "work A with its card", 30_000);
      return true;
    } catch { return false; }
  })()`);
  if (!opened) {
    const unknown = await evaluate("[...window.__unknownCommands].join(', ')");
    const page = await evaluate("[...document.querySelectorAll('.breadcrumbFolderButton, .workspaceSwitcherButton')].map((b) => b.outerHTML.slice(0, 300)).join(' | ')");
    throw new Error(`作品Aが開かなかった（差し替えていない命令: ${unknown}）。画面: ${page}\n${pageErrors.slice(0, 3).join("\n")}`);
  }
  // 開いた直後の保存が落ち着いてから記録を始める。
  await sleep(1500);
  await evaluate("window.__saves.length = 0; 1");

  // ---- 1. 作品Aで資料カードを畳み、0.7秒たたないうちに作品Bへ切り替える ----
  const cardSwitch = await evaluate(`(async () => {
    const started = performance.now();
    t.toggleCard();
    await t.waitFor(() => t.cardCollapsed(), "card A collapsed", 2000);
    await t.startSwitch("作品B");
    const clickedAfter = Math.round(performance.now() - started);
    await t.waitFor(() => t.workName() === "作品B" && t.cardTitle() === "作品Bの資料.md", "work B with its card");
    await t.sleep(2000);
    return { clickedAfter, collapsedInB: t.cardCollapsed() };
  })()`);
  const savesAfterCard = await evaluate("window.__saves.splice(0)");
  if (DEBUG) console.log("card → B", cardSwitch, savesAfterCard.map((save) => `${save.at} ${save.command} ${save.root} ${save.body.slice(0, 160)}`));
  assert.ok(cardSwitch.clickedAfter < 700, `the switch must start within 0.7 s of the edit (${cardSwitch.clickedAfter} ms)`);
  assert.equal(cardSwitch.collapsedInB, false, "作品Bのカードは畳まれていない");

  // ---- 2. 作品Bから作品Aへ切り替える（Plot は BINDER 1-6 でなくなったので、ここでは何も足さない） ----
  await evaluate(`(async () => {
    await t.startSwitch("作品A");
    await t.waitFor(() => t.workName() === "作品A", "work A");
    await t.sleep(2000);
  })()`);
  const savesAfterReturn = await evaluate("window.__saves.splice(0)");
  if (DEBUG) console.log("→ A", savesAfterReturn.map((save) => `${save.at} ${save.command} ${save.root} ${save.body.slice(0, 160)}`));

  // ---- 3. 作品Aに戻ったら、畳んだカードは畳んだまま ----
  const collapsedBackInA = await evaluate(`(async () => { await t.sleep(300); return t.cardTitle() === "作品Aの資料.md" && t.cardCollapsed(); })()`);

  // ---- 4. 同じ作品の中で続けて変えると、待ち直して最後に1回だけ書く ----
  await evaluate("window.__saves.length = 0; 1");
  await evaluate(`(async () => {
    t.toggleCard();
    await t.sleep(200);
    t.toggleCard();
    await t.sleep(200);
    t.toggleCard();
    await t.sleep(1500);
  })()`);
  const savesSameWork = await evaluate("window.__saves.splice(0)");
  if (DEBUG) console.log("same work", savesSameWork.map((save) => `${save.at} ${save.command} ${save.root}`));

  const all = [...savesAfterCard, ...savesAfterReturn, ...savesSameWork];
  const to = (saves, root, command) => saves.filter((save) => save.root === root && save.command === command);
  // 最後に、作品ごとの保存先（ディスクの代わり）に残ったもの。
  const stored = await evaluate("JSON.stringify(window.__works)").then(JSON.parse);
  if (DEBUG) console.log("stored", JSON.stringify(Object.fromEntries(Object.entries(stored).map(([root, work]) => [root, { layout: work.layout }]))));

  // 前の作品のデータを、新しい作品へ書かない。
  for (const save of all.filter((item) => item.root === WORK_B)) {
    assert.ok(!save.body.includes("作品A"), `作品Aのデータを作品Bへ書いてはいけない: ${save.command} ${save.body.slice(0, 200)}`);
  }
  for (const save of all.filter((item) => item.root === WORK_A)) {
    assert.ok(!save.body.includes("作品B"), `作品Bのデータを作品Aへ書いてはいけない: ${save.command} ${save.body.slice(0, 200)}`);
  }

  // 切り替える直前に畳んだカードは、作品Aの資料ボードのファイルへ書かれる。
  const savedA = to(savesAfterCard, WORK_A, "save_reference_layout").map(parse);
  assert.ok(savedA.some((layout) => layout.cards.some((card) => card.id === "card-a" && card.collapsed)), "切り替える直前に畳んだカードを、作品Bへ切り替えるときに作品Aの資料ボードのファイルへ保存する");
  // 保存先（最後に読む）は、手順4で3回切り替えた最後の状態（開いている）。
  assert.equal(stored[WORK_A].layout.cards.find((card) => card.id === "card-a")?.collapsed, false, "作品Aの保存先には、最後に書いた状態が残る");
  assert.ok(collapsedBackInA, "作品Aへ戻ると、切り替える直前に畳んだカードは畳んだまま");
  // 開き直しただけでは、資料ボードのファイル（と .bak）を書き直さない。
  assert.deepEqual(to(savesAfterReturn, WORK_A, "save_reference_layout").map((save) => save.body), [], "作品Aを開き直しただけで、資料ボードのファイルを書き直さない");

  // Plot と Idea はもう保存しない（BINDER 1-6・2-4）。
  assert.deepEqual(all.filter((save) => save.command === "save_project_plot_cards"), [], "Plot is no longer saved");
  assert.deepEqual(all.filter((save) => save.command === "save_project_snippets"), [], "Idea is no longer saved");
  // 相手の作品の保存先は、元のまま。
  assert.deepEqual(stored[WORK_B].layout.cards.map((card) => [card.id, card.collapsed]), [["card-b", false]], "作品Bの資料ボードは元のまま");

  // 同じ作品の中では、今までどおり待ち直す（書き換えのたびには書かない）。
  const sameWork = to(savesSameWork, WORK_A, "save_reference_layout");
  assert.equal(sameWork.length, 1, `同じ作品の中で続けて変えた資料ボードは、最後に1回だけ書く（${sameWork.length}回）`);
  assert.equal(parse(sameWork[0]).cards.find((card) => card.id === "card-a")?.collapsed, false, "その1回に、最後の状態（開いている）が入っている");

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
console.log("save on work switch tests passed");
