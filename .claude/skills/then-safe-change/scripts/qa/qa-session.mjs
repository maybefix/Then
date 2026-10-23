// QA 用の Then を1つ起動し、127.0.0.1 の HTTP で画面の操作（CDP）を受け付ける。
// バックグラウンドで動かし、q.mjs から1つずつ操作を送る（シナリオを先に全部書かなくてよい）。
//
// 使い方（リポジトリのルートで、バックグラウンドで）:
//   node .claude/skills/then-safe-change/scripts/qa/qa-session.mjs <identifier> [--port 47811] [--exe <path>]
// 止まる条件: q.mjs stop、10分間操作がない、起動から45分、アプリが閉じた、このプロセスが終わった。
// 止まるとき、QA の Then（ExecutablePath で見分ける）と、識別子を含む WebView2 を止める。
// ふだんの Then（%LOCALAPPDATA%\Then\Then.exe）は止めない。
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { countLeftovers, formatLeftovers, stopLeftovers } from "../lib/processes.mjs";

const [identifier, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : fallback;
};
if (!identifier?.startsWith("local.then.qa.")) throw new Error("usage: qa-session.mjs local.then.qa.<topic> [--port 47811] [--exe <path>]");
const port = Number(option("port", "47811"));
const exe = path.resolve(option("exe", "src-tauri/target/release/Then.exe"));
const { guardBrowser, stopBrowser } = await import(pathToFileURL(path.resolve("scripts/lib/stop-browser.mjs")).href);
const debugPort = 9600 + Math.floor(Math.random() * 150);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const app = spawn(exe, [], {
  stdio: "ignore",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-allow-origins=*` },
});
guardBrowser(app, null);
const leftoverOptions = { exe, identifier };
// 止めるのは QA の Then と WebView2 だけ（同時に動いているテストには触れない）。
const QA_KINDS = ["qaThen", "qaWebView"];
// shutdown() が済んでいれば、終わりぎわにもう一度 PowerShell を動かさない（終了が遅れ、
// 直後の qa-cleanup.mjs に残り物と見なされて止められるため）。
let shutDown = false;
process.once("exit", () => { if (!shutDown) stopLeftovers(leftoverOptions, undefined, QA_KINDS); });

let page = null;
let stopping = false;
let server = null;
/** アプリを止め、残りを数えて返す。返事（/stop）はこれが終わってから送るので、q.mjs stop が
 *  戻った時点でアプリは止まっている（すぐ qa-cleanup.mjs を動かしても、このプロセスを残り物と見なさない）。 */
async function shutdown(reason) {
  try { page?.close(); } catch {}
  await stopBrowser(app, null);
  stopLeftovers(leftoverOptions, undefined, QA_KINDS);
  await sleep(1500);
  const leftovers = countLeftovers(leftoverOptions);
  shutDown = true;
  console.log(`stopped (${reason}); leftovers: ${formatLeftovers(leftovers)}`);
  return leftovers;
}
async function stopAll(reason, beforeExit = () => {}) {
  if (stopping) return;
  stopping = true;
  const leftovers = await shutdown(reason);
  beforeExit(leftovers);
  server?.close();
  setTimeout(() => process.exit(0), 200);
}
app.once("exit", () => { if (!stopping) void stopAll("app exited"); });

let lastUse = Date.now();
const started = Date.now();
setInterval(() => {
  if (Date.now() - lastUse > 10 * 60_000) void stopAll("idle 10 min");
  if (Date.now() - started > 45 * 60_000) void stopAll("45 min limit");
}, 5000).unref();

async function json(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await fetch(url).then((response) => response.json()); } catch { await sleep(200); }
  }
  throw new Error(`Could not reach ${url}`);
}

async function connectPage() {
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) {
    target = (await json(`http://127.0.0.1:${debugPort}/json/list`)).find((item) => item.type === "page" && item.url.includes("tauri.localhost"));
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("QA page not found");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
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
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
    setTimeout(() => reject(new Error("websocket timeout")), 15_000);
  });
  page = {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 60_000);
    }),
    close: () => socket.close(),
  };
}

server = http.createServer(async (req, res) => {
  lastUse = Date.now();
  let body = "";
  for await (const chunk of req) body += chunk;
  const reply = (status, value) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.url === "/stop") {
      if (stopping) return reply(200, { value: "already stopping" });
      await stopAll("requested", (leftovers) => reply(200, { value: `stopped; leftovers: ${formatLeftovers(leftovers)}` }));
      return;
    }
    if (!page) await connectPage();
    const request = JSON.parse(body || "{}");
    if (req.url === "/eval") {
      const result = await page.send("Runtime.evaluate", { expression: request.expr, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) return reply(200, { error: (result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)).slice(0, 1500) });
      return reply(200, { value: result.result.value });
    }
    if (req.url === "/cdp") {
      const results = [];
      for (const step of request.steps) {
        if (step.wait) { await sleep(step.wait); continue; }
        results.push(await page.send(step.method, step.params ?? {}));
      }
      return reply(200, { value: results.length });
    }
    reply(404, { error: "unknown path" });
  } catch (error) {
    reply(500, { error: String(error) });
  }
});
server.listen(port, "127.0.0.1", () => console.log(`qa-session ready on ${port} (app pid ${app.pid}, debug port ${debugPort}, exe ${exe})`));
