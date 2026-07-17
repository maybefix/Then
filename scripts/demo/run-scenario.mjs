import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const scenarioPath = path.resolve(process.argv[2] ?? "scripts/demo/scenario.json");
const timelinePath = path.resolve(process.argv[3] ?? "artifacts/demo/timeline.json");
const debugPort = process.env.THEN_CDP_PORT ?? "9223";
const demoWorkspace = path.resolve(process.env.THEN_DEMO_WORKSPACE ?? "scripts/demo/sample-workspace");
const recordingOffsetMs = Number(process.env.THEN_RECORDING_OFFSET_MS ?? 0);

const replaceVariables = (value) => {
  if (typeof value === "string") return value.replaceAll("${DEMO_WORKSPACE}", demoWorkspace);
  if (Array.isArray(value)) return value.map(replaceVariables);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVariables(item)]));
  }
  return value;
};

const scenario = replaceVariables(JSON.parse(await readFile(scenarioPath, "utf8")));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page" && !item.url.startsWith("devtools://"));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // WebView2 のデバッグポートが起動するまで待つ。
    }
    await sleep(250);
  }
  throw new Error(`Tauri WebView がデバッグポート ${debugPort} に見つかりませんでした。`);
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = () => reject(new Error("Tauri WebView への接続に失敗しました。"));
});

socket.onmessage = (event) => {
  const message = JSON.parse(event.data.toString());
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
};

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "WebView 内の操作に失敗しました。");
  return result.result.value;
}

function targetExpression(target) {
  const encoded = JSON.stringify(target);
  return `(() => {
    const target = ${encoded};
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      const cssVisible = typeof el.checkVisibility === 'function'
        ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : style.visibility !== "hidden" && style.display !== "none";
      return cssVisible && inViewport && rect.width > 0 && rect.height > 0;
    };
    let items = [];
    if (target.css) items = [...document.querySelectorAll(target.css)];
    else if (target.aria) items = [...document.querySelectorAll('[aria-label]')].filter((el) => el.getAttribute('aria-label') === target.aria);
    else if (target.placeholder) items = [...document.querySelectorAll('[placeholder]')].filter((el) => el.getAttribute('placeholder') === target.placeholder);
    else if (target.text) {
      const roleSelector = target.role === 'button'
        ? 'button, [role="button"]'
        : target.role
          ? '[role="' + CSS.escape(target.role) + '"]'
          : 'button, [role="button"], [role="tab"], [role="menuitem"]';
      items = [...document.querySelectorAll(roleSelector)].filter((el) => el.textContent.trim().replace(/\\s+/g, ' ') === target.text);
    }
    items = items.filter(visible).sort((a, b) => {
      const interactive = (el) => el.matches('button, input, textarea, select, [role="button"], [role="tab"], [role="menuitem"]') ? 1 : 0;
      return interactive(b) - interactive(a);
    });
    return target.last ? items.at(-1) : items[0];
  })()`;
}

async function waitForTarget(target, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(`Boolean(${targetExpression(target)})`);
    if (found) return;
    await sleep(150);
  }
  throw new Error(`UI要素が見つかりません: ${JSON.stringify(target)}`);
}

async function elementInfo(target) {
  await waitForTarget(target);
  return evaluate(`(() => {
    const el = ${targetExpression(target)};
    const rect = el.getBoundingClientRect();
    const screenWidth = window.screen.width || window.innerWidth;
    const screenHeight = window.screen.height || window.innerHeight;
    const x = window.screenX + (window.outerWidth - window.innerWidth) / 2 + rect.left + rect.width / 2;
    const y = window.screenY + (window.outerHeight - window.innerHeight) + rect.top + rect.height / 2;
    return { x: x / screenWidth, y: y / screenHeight, width: rect.width, height: rect.height };
  })()`);
}

async function click(target) {
  await waitForTarget(target);
  return evaluate(`(() => { const el = ${targetExpression(target)}; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.click(); return true; })()`);
}

async function typeText(target, text) {
  await waitForTarget(target);
  return evaluate(`(() => {
    const el = ${targetExpression(target)};
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
    return true;
  })()`);
}

async function typeTextAnimated(target, value, delayMs = 55) {
  await typeText(target, "");
  let current = "";
  for (const character of value) {
    current += character;
    await typeText(target, current);
    await sleep(delayMs);
  }
}

async function dispatchKey(key, { ctrl = false, shift = false, alt = false } = {}) {
  const keyMap = {
    Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
    End: { code: "End", windowsVirtualKeyCode: 35 },
    f: { code: "KeyF", windowsVirtualKeyCode: 70 },
  };
  const mapped = keyMap[key] ?? { code: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, modifiers, ...mapped });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers, ...mapped });
}

async function appendToEditor(action) {
  const target = action.target ?? { css: "[contenteditable=\"true\"]" };
  await waitForTarget(target);
  await evaluate(`(() => {
    const el = ${targetExpression(target)};
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.anchorNode === el || el.contains(selection.anchorNode);
  })()`);
  for (let index = 0; index < (action.leadingNewlines ?? 2); index += 1) await dispatchKey("Enter");
  for (const character of action.text) {
    if (character === "\n") await dispatchKey("Enter");
    else await send("Input.insertText", { text: character });
    await sleep(action.charDelay ?? 55);
  }
}

const timeline = {
  name: scenario.name,
  source: scenarioPath,
  startedAt: new Date().toISOString(),
  capture: {
    width: Number(process.env.THEN_CAPTURE_WIDTH ?? 0),
    height: Number(process.env.THEN_CAPTURE_HEIGHT ?? 0),
  },
  zooms: [],
  markers: [],
};
const started = performance.now();
const seconds = () => (recordingOffsetMs + performance.now() - started) / 1000;

try {
  await send("Runtime.enable");
  for (const [index, action] of scenario.actions.entries()) {
    process.stdout.write(`[${index + 1}/${scenario.actions.length}] ${action.label ?? action.type}\n`);
    if (action.type === "wait") {
      await sleep(action.ms);
      continue;
    }

    if (action.type === "click" || action.type === "clickIfPresent") {
      if (action.type === "clickIfPresent") {
        const present = await evaluate(`Boolean(${targetExpression(action.target)})`);
        if (!present) {
          process.stdout.write(`  skip: ${action.label ?? JSON.stringify(action.target)}\n`);
          continue;
        }
      }
      const info = await elementInfo(action.target);
      const at = seconds();
      if (action.zoom) {
        timeline.zooms.push({
          at,
          x: Math.max(0, Math.min(1, info.x)),
          y: Math.max(0, Math.min(1, info.y)),
          scale: action.zoom,
          label: action.label ?? "",
          lead: action.lead ?? 0.45,
          hold: action.hold ?? 0.65,
          tail: action.tail ?? 0.45,
        });
      }
      await click(action.target);
    } else if (action.type === "focus") {
      const info = await elementInfo(action.target);
      const lead = action.lead ?? 0.6;
      timeline.zooms.push({
        at: seconds() + lead,
        x: Math.max(0, Math.min(1, info.x)),
        y: Math.max(0, Math.min(1, info.y)),
        scale: action.zoom ?? 1.18,
        label: action.label ?? "",
        lead,
        hold: action.hold ?? 1.0,
        tail: action.tail ?? 0.6,
      });
    } else if (action.type === "type") {
      timeline.markers.push({ at: seconds(), label: action.label ?? "入力" });
      if (action.animate) await typeTextAnimated(action.target, action.text, action.charDelay);
      else await typeText(action.target, action.text);
    } else if (action.type === "editorAppend") {
      timeline.markers.push({ at: seconds(), label: action.label ?? "本文編集" });
      await appendToEditor(action);
    } else if (action.type === "shortcut") {
      await dispatchKey(action.key, action);
    } else if (action.type === "assert") {
      await waitForTarget(action.target, action.timeoutMs ?? 10000);
    } else if (action.type === "nativeFolderDialog") {
      timeline.markers.push({ at: seconds(), label: action.label ?? "フォルダ選択" });
      const helper = path.resolve("scripts/demo/select-folder-dialog.ps1");
      const helperArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Path", action.path];
      if (process.env.THEN_APP_PID) helperArgs.push("-OwnerProcessId", process.env.THEN_APP_PID);
      const result = spawnSync("powershell.exe", helperArgs, {
        stdio: "inherit",
      });
      if (result.status !== 0) throw new Error("Windows のフォルダ選択に失敗しました。");
    } else {
      throw new Error(`未対応のアクションです: ${action.type}`);
    }
    await sleep(action.afterMs ?? 500);
  }
  timeline.finishedAt = new Date().toISOString();
  timeline.duration = seconds();
  await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
  process.stdout.write(`タイムラインを書き出しました: ${timelinePath}\n`);
} finally {
  socket.close();
}
