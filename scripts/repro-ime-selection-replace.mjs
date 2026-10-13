// Replacing a selection by IME composition, then switching candidates, keeps
// the text node the IME composes into (docs/KNOWN_ISSUES.md, 2026-10-13).
//
//   node scripts/repro-ime-selection-replace.mjs
//
// Starts its own Vite dev server with VITE_QA_IME_TRACE=1, which turns on the
// IME trace (src/editor/imeTrace.ts) this check reads. With --url, use a dev
// server already started that way instead.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server = null;
let url = option("url", null);
if (!url) {
  const port = 5600 + Math.floor(Math.random() * 300);
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], {
    stdio: "ignore", env: { ...process.env, VITE_QA_IME_TRACE: "1" },
  });
  url = `http://localhost:${port}/`;
  for (let attempt = 0; ; attempt++) {
    try { await fetch(url); break; } catch { if (attempt > 100) throw new Error(`Vite did not start on ${url}`); await sleep(200); }
  }
}
const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-ime-"));
const debugPort = 9700 + Math.floor(Math.random() * 100);
const browser = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
  "--no-first-run", "--disable-extensions", "about:blank",
], { stdio: "ignore" });
async function json(target, init) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await fetch(target, init).then((response) => response.json()); } catch { await sleep(200); }
  }
  throw new Error(`Could not reach ${target}`);
}

let exitCode = 0;
try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
      console.log("[page " + message.params.type + "]", message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 400));
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  await new Promise((resolve) => (socket.onopen = resolve));
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 800));
    return response.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(4000);
  await evaluate("localStorage.clear(); location.reload(); 1");
  // A freshly started Vite optimizes dependencies on the first load.
  const opened = await evaluate(`(async () => {
    const wait = async (find) => {
      for (let i = 0; i < 300; i++) {
        const found = find();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return null;
    };
    const button = await wait(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新しい原稿")));
    button?.click();
    return Boolean(await wait(() => document.querySelector(".ProseMirror")));
  })()`);
  if (!opened) throw new Error("The editor did not open from the start page.");

  const seed = [
    "　春の朝、彼女は窓の外を見た。「それで、どうするの」と言った。",
    "　週末は船橋市に行った。駅前の店で、古い手紙を買った。",
    "　時計の針が静かに進む。机の上に古い手紙がある。",
    "　それを見た|東雲《しののめ》は**強調**して笑った。",
  ].join("\n");
  await evaluate(`(async () => {
    const pm = document.querySelector(".ProseMirror");
    pm.focus();
    const data = new DataTransfer();
    data.setData("text/plain", ${JSON.stringify(seed)});
    pm.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return 1;
  })()`);

  // block: paragraph index; word: text to select (may cross decoration spans).
  const scenarios = [
    // Typing right after a paragraph's first character still redraws under the
    // composition (docs/KNOWN_ISSUES.md); reported, not yet required to pass.
    { block: 0, word: "春", collapse: true, known: true, steps: ["た", "田", "多"], commit: "太" },
    { block: 0, word: "春", steps: ["た", "田", "多", "他", "足", "タ"], commit: "太" },
    { block: 1, word: "船橋市に", steps: ["ち", "ちば", "ちばけ", "ちばけん", "チバケン", "千馬兼", "千葉県"], commit: "千葉県" },
    // From inside the indent anchor span into plain text, as in the recorded failure.
    { block: 2, word: "時計の針が", steps: ["と", "とけ", "時計", "徒刑"], commit: "時計" },
    // Across ruby and bold markup, whose syntax decorations hide characters.
    { block: 3, word: "|東雲《しののめ》は**強", steps: ["そ", "そら", "空"], commit: "空" },
    { block: 1, word: "た。駅前", steps: ["え", "えき", "駅", "液"], commit: "駅" },
  ];
  for (const scenario of scenarios) {
    const before = await evaluate(`(async () => {
      const pm = document.querySelector(".ProseMirror");
      const block = pm.children[${scenario.block}];
      const at = block.textContent.indexOf(${JSON.stringify(scenario.word)});
      if (at < 0) return null;
      const point = (offset) => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (offset <= node.length) return [node, offset];
          offset -= node.length;
        }
        return null;
      };
      const range = document.createRange();
      range.setStart(...point(at + (${Boolean(scenario.collapse)} ? ${scenario.word.length} : 0)));
      range.setEnd(...point(at + ${scenario.word.length}));
      pm.focus();
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      await new Promise((resolve) => setTimeout(resolve, 300));

      return [...pm.children].map((c) => c.textContent).join("\\n");
    })()`);
    if (before === null) throw new Error(`seed word ${scenario.word} not found`);
    // A Windows IME announces each key it takes as "Process" (keyCode 229)
    // before composition starts.
    const imeKey = { windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: "Process", code: "" };
    for (const [index, text] of scenario.steps.entries()) {
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...imeKey });
      await send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...imeKey });
      await sleep(index === 0 ? 120 : 60);
    }
    await send("Input.insertText", { text: scenario.commit });
    // The DEV trace (src/editor/imeTrace.ts) closes a session after 1s of quiet.
    await sleep(1300);
    // The IME addresses the DOM it composed into. Script writes to the editor
    // between the first compositionupdate and compositionend are redraws
    // under the composition, which a real Windows IME does not survive.
    const after = await evaluate(`(() => {
      const entries = window.__thenImeTraces?.at(-1)?.entries ?? [];
      const first = entries.findIndex((entry) => entry.kind === "event" && entry.type === "compositionupdate");
      const end = entries.findIndex((entry) => entry.kind === "event" && entry.type === "compositionend");
      const redraws = first < 0 ? [] : entries.slice(first, end < 0 ? undefined : end)
        .filter((entry) => entry.kind === "write" && !String(entry.target).includes("pm-root"));
      return {
        text: [...document.querySelector(".ProseMirror").children].map((c) => c.textContent).join("\\n"),
        traced: first >= 0,
        redraws: redraws.length,
      };
    })()`);
    if (!after.traced) throw new Error("No IME trace: the dev server must run with VITE_QA_IME_TRACE=1.");
    const expected = scenario.collapse
      ? before.replace(scenario.word, scenario.word + scenario.commit)
      : before.replace(scenario.word, scenario.commit);
    const ok = after.text === expected && after.redraws === 0;
    if (!ok && !scenario.known) exitCode = 1;
    console.log(`${ok ? "PASS" : scenario.known ? "KNOWN" : "FAIL"} ${scenario.collapse ? "after" : "replace"} 「${scenario.word}」 -> 「${scenario.commit}」${after.redraws ? ` (${after.redraws} DOM writes under the composition)` : ""}`);
    if (after.text !== expected) console.log(`  expected:\n${expected}\n  actual:\n${after.text}`);
  }
  socket.close();
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  browser.kill();
  server?.kill();
  await sleep(500);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
process.exit(exitCode);
