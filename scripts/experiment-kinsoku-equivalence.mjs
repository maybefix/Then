// 実験: Then の禁則用 span（ks-*）は、ブラウザの line-break: strict と同じ改行を
// しているだけか？ 同じ原稿を「今のまま」と「禁則 span の効果を消した状態」で組み、
// 全段落の改行位置を比べる。違いが出た段落を、ブラウザだけでは足りない禁則の
// 実例として出力する。コードは変えない（CSS を差し込むだけ）。
//
//   node scripts/experiment-kinsoku-equivalence.mjs [--dist <dir>] [--paragraphs 600] [--seed 1]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
let dist = option("dist", null);
if (!dist) {
  dist = path.join(os.tmpdir(), "then-kinsoku-experiment-dist");
  const result = spawnSync("npx", ["vite", "build", "--base", "./", "--outDir", dist, "--emptyOutDir"], { stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const PARAGRAPHS = Number(option("paragraphs", 600));
const SEED = Number(option("seed", 1));

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".json": "application/json", ".png": "image/png", ".wasm": "application/wasm" };
const server = http.createServer(async (req, res) => {
  let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (file.endsWith("/")) file += "index.html";
  try {
    const body = await readFile(path.join(dist, file));
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const appUrl = `http://127.0.0.1:${server.address().port}/`;
const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((candidate) => existsSync(candidate));
const debugPort = 9950 + Math.floor(Math.random() * 40);
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-kinsoku-"));
const browser = guardBrowser(spawn(edgePath, ["--headless=new", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" }), profileDir);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url, init) {
  for (let i = 0; i < 50; i++) { try { return await fetch(url, init).then((r) => r.json()); } catch { await sleep(200); } }
  throw new Error(`Could not reach ${url}`);
}

// Sentences built from pieces that put kinsoku-relevant characters at varied positions.
function corpus(count, seed) {
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const words = ["彼女", "窓の外", "雨", "汽笛", "古い手紙", "時計の針", "東雲の空", "ちょっと", "キャッシュ", "ショッピング",
    "がっこう", "ぎゅっと", "ヴァイオリン", "コーヒー", "まあ", "えっ", "ふう", "第一章", "二〇二六年", "12月31日", "100円", "iPhone",
    "ABC", "Hello world", "3.14", "七々", "人々", "ゝ", "ーー", "問題", "あいうえお", "かきくけこ", "漢字", "原稿用紙"];
  const tails = ["。", "、", "！", "？", "!?", "……", "――", "」", "』", "）", "】", "〉", "。」", "、」", "！」", "…」", "ー", "っ", "ゃ", "ょ", "ぁ", "ヵ"];
  const heads = ["「", "『", "（", "【", "〈", "“"];
  const lines = [];
  for (let i = 0; i < count; i++) {
    let line = random() < 0.6 ? "　" : "";
    const pieces = 3 + Math.floor(random() * 10);
    for (let p = 0; p < pieces; p++) {
      if (random() < 0.25) line += pick(heads);
      line += pick(words);
      if (random() < 0.7) line += pick(tails);
      if (random() < 0.15) line += "を見た";
    }
    lines.push(line);
  }
  return lines;
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
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  };
  await new Promise((resolve) => (socket.onopen = resolve));
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 800));
    return response.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appUrl });
  await sleep(1500);

  const configs = [
    { label: "縦・通常", settings: { writingMode: "vertical-rl" } },
    { label: "横・通常", settings: { writingMode: "horizontal-tb" } },
    ...[20, 30, 40].flatMap((chars) => ["vertical-rl", "horizontal-tb"].map((writingMode) => ({
      label: `${writingMode === "vertical-rl" ? "縦" : "横"}・原稿用紙${chars}字`,
      settings: { writingMode, manuscript: { layoutMode: "manuscript", charactersPerLine: chars, linesPerPage: 20, showGrid: false, showPageBoundaries: false } },
    }))),
  ];
  const lines = corpus(PARAGRAPHS, SEED);
  const results = [];
  for (const config of configs) {
    await evaluate(`(() => { localStorage.clear(); localStorage.setItem("then.app-state.v1", JSON.stringify({ settings: ${JSON.stringify({ editorDisplayMode: "continuous", typewriterScroll: false, ...config.settings })} })); location.reload(); return 1; })()`);
    await sleep(3000);
    await evaluate(`(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新しい原稿"))?.click(); await new Promise((r) => setTimeout(r, 2000)); return 1; })()`);
    let differing = 0;
    let compared = 0;
    let withSpansViolations = 0;
    let browserViolations = 0;
    const violationKinds = {};
    const examples = [];
    // The decoration window covers about 140 paragraphs around the caret; check in chunks.
    for (let start = 0; start < lines.length; start += 100) {
      const chunk = lines.slice(start, start + 100);
      const result = await evaluate(`(async () => {
        const pm = document.querySelector(".ProseMirror");
        const ed = pm.editor;
        ed.commands.selectAll();
        const data = new DataTransfer();
        data.setData("text/plain", ${JSON.stringify(chunk.join("\n"))} + "\\n");
        pm.focus();
        pm.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 800));
        ed.commands.setTextSelection(ed.state.doc.content.size - 1);
        await new Promise((r) => setTimeout(r, 600));
        const vertical = getComputedStyle(pm).writingMode !== "horizontal-tb";
        const breaks = () => [...pm.children].map((p) => {
          if (!p.classList.contains("pm-line") || p.classList.contains("active-line")) return null;
          const out = [];
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          let offset = 0, lastLine = null;
          const range = document.createRange();
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.parentElement.closest(".mk-hidden")) { offset += node.data.length; continue; }
            for (let i = 0; i < node.data.length; i++) {
              range.setStart(node, i); range.setEnd(node, i + 1);
              const rect = range.getClientRects()[0];
              if (rect) {
                const line = Math.round(vertical ? rect.right : rect.top);
                if (lastLine !== null && Math.abs(line - lastLine) > 2) out.push(offset + i);
                lastLine = line;
              }
            }
            offset += node.data.length;
          }
          return out.join(",");
        });
        const before = breaks();
        const style = document.createElement("style");
        style.textContent = ".verticalTypewriterEditor :is(.ks-keep-short, .ks-line-head-ban, .ks-line-end-ban, .ks-indent-anchor) { white-space: inherit !important; display: inline !important; overflow-wrap: inherit !important; }";
        document.head.append(style);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const after = breaks();
        style.remove();
        // Then's own kinsoku tables (VerticalTextEditor.tsx).
        const HEAD = new Set(Array.from("、。，．・：；？！!?‼⁇⁈⁉）〕］｝〉》」』】〗〙〛’”ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々ゝゞヽヾ〻〃ー"));
        const END = new Set(Array.from("（〔［｛〈《「『【〖〘〚‘“"));
        const violations = (text, breaks) => {
          if (!breaks) return [];
          const out = [];
          for (const at of breaks.split(",").map(Number)) {
            if (HEAD.has(text[at])) out.push("行頭" + text[at]);
            if (END.has(text[at - 1])) out.push("行末" + text[at - 1]);
            const pair = text[at - 1] + text[at];
            if (pair === "……" || pair === "‥‥" || pair === "――") out.push("分離" + pair);
            if (/^[0-9０-９]{2}$/.test(pair)) out.push("数字分離");
          }
          return out;
        };
        const diffs = [];
        let compared = 0, withSpansViolations = 0, browserViolations = 0;
        const violationKinds = {};
        before.forEach((value, index) => {
          if (value === null) return;
          compared++;
          const text = pm.children[index].textContent;
          const a = violations(text, value), b = violations(text, after[index]);
          withSpansViolations += a.length;
          browserViolations += b.length;
          for (const kind of b) violationKinds[kind] = (violationKinds[kind] ?? 0) + 1;
          if (value !== after[index]) diffs.push({ text, withSpans: value, browserOnly: after[index], browserViolations: b });
        });
        return { compared, diffs, withSpansViolations, browserViolations, violationKinds };
      })()`);
      compared += result.compared;
      differing += result.diffs.length;
      withSpansViolations += result.withSpansViolations;
      browserViolations += result.browserViolations;
      for (const [kind, n] of Object.entries(result.violationKinds)) violationKinds[kind] = (violationKinds[kind] ?? 0) + n;
      for (const diff of result.diffs) if (diff.browserViolations.length && examples.length < 6) examples.push(diff);
    }
    results.push({ config: config.label, compared, differing, examples });
    console.log(`${config.label}: ${compared} 段落を比較、改行位置の違い ${differing} 段落、禁則違反 spanあり ${withSpansViolations} / ブラウザのみ ${browserViolations} ${JSON.stringify(violationKinds)}`);
    for (const example of examples) console.log(`   ${example.text}\n     禁則spanあり ${example.withSpans}\n     ブラウザのみ ${example.browserOnly}`);
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await stopBrowser(browser, profileDir);
  server.close();
  process.exit(exitCode);
}
