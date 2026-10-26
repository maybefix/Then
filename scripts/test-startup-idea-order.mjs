import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

// 作品を開くとき、アプリ状態に残った Idea と作品の Idea が違っても、Idea の並び順（資料ボードのファイル）を
// 変えず、書き直さないことを、App 全体を Edge で動かして確かめる（docs/STARTUP_IDEA_ORDER_FIX_PLAN.md）。
// Rust の代わりに作品ごとの保存先を持つ入れ物を置く。命令は少し待ってから答える（Tauri の IPC と同じく、
// 答えのあいだに描画が入る）。入口は、起動画面の「前回の執筆を続ける」、起動画面を飛ばす起動、
// 開いている作品から別の作品のファイルを「ファイルを開く」の3つ。
//
//   node scripts/test-startup-idea-order.mjs [--dist <dir>] [--debug]

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
  dist = mkdtempSync(path.join(os.tmpdir(), "then-startup-idea-order-dist-"));
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
const STALE_IDEA = "アプリ状態にだけ残ったIdea";

/*
 * Rust の代わり（ページの中で動く）。作品ごとに Idea・プロット・資料ボードを持ち、保存の命令は
 * 記録して中身を置き換える。どちらの作品にも、Then を閉じているあいだに外で足した Idea（ext）があり、
 * 並び順の先頭に置かれている。アプリ状態の Idea は、外で足す前の作品Aのもの（ext がなく、
 * 作品にはない Idea が1つある）。
 */
function installMock({ library, workA, workB, skipStartupPortal, staleIdea, readDelayMs = 15 }) {
  const thread = (id, kind, title, fragments) => ({ id, kind, title, starred: false, createdAt: 1, updatedAt: 1,
    fragments: fragments.map(([fragmentId, body]) => ({ id: fragmentId, body, used: false, createdAt: 1, updatedAt: 1 })) });
  const card = (id, title) => ({ id, kind: "section", num: "1", title, body: "", expanded: false, managerCollapsed: false });
  const projects = [{ path: workA, name: "作品A" }, { path: workB, name: "作品B" }];
  const work = (root, name, letter) => ({
    folder: {
      path: root, name,
      children: [{ path: `${root}/本文.txt`, name: "本文.txt", kind: "file", children: [], fileId: `${root}/本文.txt`, contentHash: null, modifiedAt: 1 }],
      library: { path: library, name: "library", role: "project", projects, misplacedProjects: [] },
    },
    text: `${name}の本文です。`,
    snippets: [thread("idea-inbox", "inbox", "インボックス", [[`${letter}-1`, `${name}のメモ`], [`${letter}-ext`, `${name}の外で足したIdea`]])],
    plotCards: [card(`${letter}-plot-1`, `${name}の章`)],
    // Rust の書き方（項目のキーが名前の順）。外で足した Idea が先頭。
    layout: { version: 3, name: "default", cards: [], recent: [], ideaThreadsMode: "workspace",
      ideaThreads: [{ threadId: "idea-inbox", items: [{ fragmentId: `${letter}-ext`, sourceType: "idea" }, { fragmentId: `${letter}-1`, sourceType: "idea" }] }] },
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
    settings: { skipStartupPortal, snippetStorageMode: "workspace" },
    snippets: [thread("idea-inbox", "inbox", "インボックス", [["a-1", "作品Aのメモ"], ["stale-1", staleIdea]])],
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
    open_text_file_dialog: () => ({ path: `${workB}/本文.txt`, name: "本文.txt", content: works[workB].text, fileId: `${workB}/本文.txt`, contentHash: null }),
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
  };
  const answer = (command, args) => {
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
      // Tauri の IPC は、答えが別のタスクで届く（そのあいだに React が描画する）。
      await new Promise((resolve) => setTimeout(resolve, command === "read_text_file" ? readDelayMs : 15));
      return answer(command, args);
    },
  };
}

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-startup-idea-order-"));
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
    workName: () => [...document.querySelectorAll(".workspaceSwitcherButton")].map(text).find((name) => name.startsWith("作品")) ?? "",
    ideaText: () => [...document.querySelectorAll("section.ideaView")].map(text).join(" / "),
    /** 起動画面があれば「あとで」「前回の執筆を続ける」を押して、作品Aの本文と Idea が出るまで待つ。 */
    async startup() {
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        if (window.t.workName() === "作品A" && document.querySelector(".ProseMirror") && window.t.ideaText()) return;
        [...document.querySelectorAll("button")].find((button) => text(button) === "あとで" || text(button).startsWith("前回の執筆を続ける"))?.click();
        await sleep(200);
      }
      throw new Error(`startup did not finish: ${window.t.workName()} / ${window.t.ideaText().slice(0, 200)} / ${document.querySelector(".rightSidebar")?.innerText.slice(0, 300)}`);
    },
    async openFileFromMenu() {
      must(document.querySelector('[aria-label="ファイルメニュー"]'), "file menu").click();
      await window.t.waitFor(() => document.querySelector(".fileMenuPopover"), "file menu popover", 2000);
      must([...document.querySelectorAll(".fileMenuPopover button")].find((button) => text(button) === "ファイルを開く"), "ファイルを開く").click();
    },
  };
  return "ok";
}

const order = (layout) => layout.ideaThreads.flatMap((thread) => thread.items.map((item) => item.fragmentId ?? item.sourcePath));
let failure = null;
// 場面ごとに、確かめたことを全部見る（最初の失敗で止めない）。
const failures = [];
const expect = new Proxy(assert, {
  get: (target, key) => (...values) => {
    try {
      target[key](...values);
    } catch (error) {
      failures.push(error.message.split("\n")[0]);
    }
  },
});
try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);

  /** 新しいタブで、入れ物を入れたアプリを開く。 */
  async function openApp(mock) {
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
      source: `(${installMock})(${JSON.stringify({ library: LIBRARY, workA: WORK_A, workB: WORK_B, staleIdea: STALE_IDEA, ...mock })})`,
    });
    await send("Page.navigate", { url: appUrl });
    await sleep(1000);
    await evaluate("localStorage.clear(); location.reload(); 1");
    await sleep(1000);
    await evaluate(`(${pageHelpers})()`);
    try {
      await evaluate("t.startup()");
    } catch (error) {
      const unknown = await evaluate("[...window.__unknownCommands].join(', ')");
      throw new Error(`作品Aが開かなかった（差し替えていない命令: ${unknown}）: ${error.message}\n${pageErrors.slice(0, 3).join("\n")}`);
    }
    return { socket, evaluate, pageErrors };
  }

  const stored = (evaluate) => evaluate("JSON.stringify(window.__works)").then(JSON.parse);
  const to = (saves, root, command) => saves.filter((save) => save.root === root && save.command === command);
  const describe = (saves) => saves.map((save) => `${save.at} ${save.command} ${save.root} ${save.body.slice(0, 200)}`);

  /** 作品を開いただけで、並び順を変えず、資料ボードのファイルを書かず、ほかの Idea を書かない。 */
  function assertOpenedUntouched(label, saves, works, root, own) {
    if (DEBUG) console.log(label, describe(saves));
    expect.deepEqual(order(works[root].layout), [`${own}-ext`, `${own}-1`], `${label}: 作品の Idea の並び順は元のまま（外で足した Idea が先頭）`);
    expect.deepEqual(to(saves, root, "save_reference_layout").map((save) => save.body), [], `${label}: 開いただけで、資料ボードのファイルを書かない`);
    for (const save of saves.filter((item) => item.root === root)) {
      expect.ok(!save.body.includes(STALE_IDEA), `${label}: アプリ状態にだけ残った Idea を作品へ書かない: ${save.command} ${save.body.slice(0, 200)}`);
    }
    expect.deepEqual(works[root].snippets.flatMap((thread) => thread.fragments.map((fragment) => fragment.id)), [`${own}-1`, `${own}-ext`], `${label}: 作品の Idea は元のまま`);
  }

  // ---- 1. 起動画面の「前回の執筆を続ける」で作品Aを開く ----
  {
    const { socket, evaluate, pageErrors } = await openApp({ skipStartupPortal: false });
    await sleep(2500);
    const saves = await evaluate("window.__saves.splice(0)");
    const ideas = await evaluate("t.ideaText()");
    assertOpenedUntouched("前回の執筆を続ける", saves, await stored(evaluate), WORK_A, "a");
    // 一覧のスレッドの行には、並び順の先頭の Idea が出る。
    expect.ok(ideas.includes("作品Aの外で足したIdea") && !ideas.includes(STALE_IDEA), `前回の執筆を続ける: 並び順の先頭の Idea が一覧に出る（${ideas}）`);
    expect.deepEqual(pageErrors, [], "the page throws no errors");
    socket.close();
  }

  // ---- 2. 同じく、開いていたファイルを読むのに 0.7 秒より長くかかるとき ----
  {
    const { socket, evaluate, pageErrors } = await openApp({ skipStartupPortal: false, readDelayMs: 1200 });
    await sleep(2500);
    const saves = await evaluate("window.__saves.splice(0)");
    assertOpenedUntouched("前回の執筆を続ける（ファイルを読むのが遅い）", saves, await stored(evaluate), WORK_A, "a");
    expect.deepEqual(pageErrors, [], "the page throws no errors");
    socket.close();
  }

  // ---- 3. 起動画面を飛ばして作品Aを開く ----
  {
    const { socket, evaluate, pageErrors } = await openApp({ skipStartupPortal: true });
    await sleep(2500);
    const saves = await evaluate("window.__saves.splice(0)");
    assertOpenedUntouched("起動画面を飛ばす", saves, await stored(evaluate), WORK_A, "a");

    // ---- 4. 作品Aから、作品Bのファイルを「ファイルを開く」で開く ----
    await evaluate(`(async () => {
      await t.openFileFromMenu();
      await t.waitFor(() => t.workName() === "作品B", "work B");
      await t.sleep(2500);
    })()`);
    const savesB = await evaluate("window.__saves.splice(0)");
    const ideasB = await evaluate("t.ideaText()");
    expect.ok(ideasB.includes("作品Bの外で足したIdea") && !ideasB.includes("作品A"), `別の作品のファイルを開く: 並び順の先頭の Idea が一覧に出る（${ideasB}）`);
    const works = await stored(evaluate);
    assertOpenedUntouched("別の作品のファイルを開く", savesB, works, WORK_B, "b");
    for (const save of savesB.filter((item) => item.root === WORK_B)) {
      expect.ok(!save.body.includes("作品A") && !save.body.includes('"a-'), `作品Aのデータを作品Bへ書かない: ${save.command} ${save.body.slice(0, 200)}`);
    }
    for (const save of savesB.filter((item) => item.root === WORK_A)) {
      expect.ok(!save.body.includes("作品B") && !save.body.includes('"b-'), `作品Bのデータを作品Aへ書かない: ${save.command} ${save.body.slice(0, 200)}`);
    }
    expect.deepEqual(order(works[WORK_A].layout), ["a-ext", "a-1"], "作品Aの並び順も元のまま");
    expect.deepEqual(pageErrors, [], "the page throws no errors");
    socket.close();
  }
} catch (error) {
  failure = error;
} finally {
  await stopBrowser(browser, profileDir);
  server.close();
  if (ownDist) await rm(dist, { recursive: true, force: true });
}
if (failure) throw failure;
if (failures.length) throw new Error(`${failures.length} checks failed:\n${failures.join("\n")}`);
console.log("startup Idea order tests passed");
