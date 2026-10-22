// Random edits against the dev server, failing on any DEV shadow divergence
// (decorations, editor text, document index) or page error.
//
//   npm run dev   (in another terminal)
//   node scripts/fuzz-editor-decorations.mjs [--url http://localhost:3000/] [--steps 800] [--seed 7]
//        [--settings '{"showLineNumbers":true}']
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option("url", "http://localhost:3000/");
const steps = Number(option("steps", 800));
const seed = Number(option("seed", 7));

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-fuzz-"));
const debugPort = 9800 + Math.floor(Math.random() * 100);
const browser = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
  "--no-first-run", "--disable-extensions", "about:blank",
], { stdio: "ignore" });
guardBrowser(browser, profileDir);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(target, init) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await fetch(target, init).then((response) => response.json()); } catch { await sleep(200); }
  }
  throw new Error(`Could not reach ${target}`);
}

const problems = [];
const details = [];
let exitCode = 0;
try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      problems.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 600));
    }
    if (message.method === "Runtime.exceptionThrown") {
      problems.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`.slice(0, 600));
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
  // --settings '{"showLineNumbers":true}' starts with these editor settings.
  const settings = option("settings", null);
  await evaluate(`localStorage.clear(); ${settings ? `localStorage.setItem("then.app-state.v1", JSON.stringify({ settings: ${settings} }));` : ""} location.reload(); 1`);
  await sleep(6000);
  const opened = await evaluate(`(async () => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新しい原稿"));
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return Boolean(document.querySelector(".ProseMirror"));
  })()`);
  if (!opened) throw new Error("The editor did not open from the start page.");
  problems.length = 0;
  // Keep the logged objects, which the protocol only previews.
  await evaluate(`window.__fuzzErrors = []; { const original = console.error; console.error = (...values) => { window.__fuzzErrors.push(JSON.stringify(values).slice(0, 4000)); original(...values); }; } 1`);

  // Seed document: every construct whose decorations depend on neighbours.
  const seedLines = [];
  for (let block = 0; block < 40; block++) {
    seedLines.push(`# 第${block + 1}章`, "", "　彼女は窓の外を見た。「それで、どうするの」と|東雲《しののめ》は言った。",
      "- 箇条書きの項目", "　**強調**と《《傍点》》とABCの英字。");
    if (block % 7 === 1) seedLines.push("// コメント行", "// 続くコメント");
    if (block % 7 === 3) seedLines.push("```", "const code = 1;", "```");
    if (block % 7 === 5) seedLines.push("| 見出し1 | 見出し2 |", "| --- | --- |", "| セル | セル |");
    if (block % 7 === 6) seedLines.push("<!--", "HTMLコメント", "-->");
    for (let i = 0; i < 6; i++) seedLines.push("　時計の針が静かに進む。机の上に古い手紙がある。");
  }
  await evaluate(`(async () => {
    const pm = document.querySelector(".ProseMirror");
    pm.focus();
    const data = new DataTransfer();
    data.setData("text/plain", ${JSON.stringify(seedLines.join("\n"))});
    pm.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return pm.childElementCount;
  })()`);

  const pageFuzz = async ({ steps, seed }) => {
    let state = seed;
    const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = (items) => items[Math.floor(random() * items.length)];
    const pm = document.querySelector(".ProseMirror");
    const scroller = pm.closest("[class*='scroll'], .editorScroller") ?? pm.parentElement;
    const placeCaret = (collapse = true) => {
      const blocks = pm.children;
      const block = blocks[Math.floor(random() * blocks.length)];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      const range = document.createRange();
      if (texts.length) {
        const text = pick(texts);
        range.setStart(text, Math.floor(random() * (text.length + 1)));
        if (!collapse) {
          const other = pick(texts);
          try { range.setEnd(other, Math.floor(random() * (other.length + 1))); } catch { range.collapse(true); }
          if (range.collapsed) range.setStart(text, 0);
        }
      } else {
        range.setStart(block, 0);
      }
      if (collapse) range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    };
    const inserts = ["あ", "文字", "|", "| a | b |", "//", "```", "<!--", "-->", "# ", "- ", "《", "》", "「", "」", "A", " "];
    const log = [];
    for (let step = 0; step < steps; step++) {
      const roll = random();
      if (roll < 0.25) placeCaret(true);
      else if (roll < 0.3) placeCaret(false);
      else if (roll < 0.33 && scroller) {
        scroller.scrollLeft = -random() * scroller.scrollWidth;
        scroller.scrollTop = random() * scroller.scrollHeight;
        scroller.dispatchEvent(new Event("scroll"));
      }
      const action = random();
      let name;
      if (action < 0.45) { name = "insert"; document.execCommand("insertText", false, pick(inserts)); }
      else if (action < 0.6) { name = "enter"; document.execCommand("insertParagraph"); }
      else if (action < 0.75) { name = "backspace"; document.execCommand("delete"); }
      else if (action < 0.82) { name = "forwardDelete"; document.execCommand("forwardDelete"); }
      else if (action < 0.9) {
        name = "paste";
        const data = new DataTransfer();
        data.setData("text/plain", pick(["行1\n行2", "| x | y |\n| --- | --- |", "```\ncode", "// a\n// b", "見出し\n\n本文"]));
        pm.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      } else if (action < 0.95) { name = "undo"; document.execCommand("undo"); }
      else { name = "redo"; document.execCommand("redo"); }
      log.push(name);
      await new Promise((resolve) => setTimeout(resolve, random() < 0.1 ? 40 : 0));
    }
    return { lines: pm.childElementCount, counts: log.reduce((map, name) => ({ ...map, [name]: (map[name] ?? 0) + 1 }), {}) };
  };
  const result = await evaluate(`(${pageFuzz})(${JSON.stringify({ steps, seed })})`);
  await sleep(1000);
  console.log(JSON.stringify(result));

  // Composition through the browser's IME path.
  for (let i = 0; i < 20; i++) {
    await evaluate(`(() => { const pm = document.querySelector(".ProseMirror"); const b = pm.children[${i * 7} % pm.children.length]; const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); pm.focus(); return 1; })()`);
    await send("Input.imeSetComposition", { text: "へ", selectionStart: 1, selectionEnd: 1 });
    await send("Input.imeSetComposition", { text: "へん", selectionStart: 2, selectionEnd: 2 });
    await send("Input.insertText", { text: "変" });
    await sleep(30);
    await evaluate(`document.execCommand("insertText", false, "あ"); 1`);
    if (i % 5 === 0) await evaluate(`document.execCommand("insertParagraph"); 1`);
  }
  await sleep(1000);
  details.push(...(await evaluate("window.__fuzzErrors")));
  socket.close();
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await stopBrowser(browser, profileDir);
}
const shadow = problems.filter((problem) => /shadow|exception|Error/i.test(problem));
if (shadow.length) {
  const shown = details.length ? details : shadow;
  console.error(`${shadow.length} problem(s):\n${[...new Set(shown)].slice(0, 5).join("\n---\n")}`);
  exitCode = 1;
} else if (!exitCode) {
  console.log("no shadow divergence or page error");
}
process.exit(exitCode);
