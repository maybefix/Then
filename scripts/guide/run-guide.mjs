import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const scenarioPath = path.resolve(process.argv[2] ?? "scripts/guide/scenario.json");
const outputDirectory = path.resolve(process.argv[3] ?? "artifacts/guide");
const screenshotsDirectory = path.join(outputDirectory, "screenshots");
const debugPort = process.env.THEN_CDP_PORT ?? "9224";
const guideWorkspace = path.resolve(process.env.THEN_GUIDE_WORKSPACE ?? "scripts/demo/sample-workspace");

const replaceVariables = (value) => {
  if (typeof value === "string") return value.replaceAll("${GUIDE_WORKSPACE}", guideWorkspace);
  if (Array.isArray(value)) return value.map(replaceVariables);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVariables(item)]));
  }
  return value;
};

const scenario = replaceVariables(JSON.parse(await readFile(scenarioPath, "utf8")));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(screenshotsDirectory, { recursive: true });

async function findPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page" && !item.url.startsWith("devtools://"));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // WebView2 のデバッグポートが利用可能になるまで待つ。
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

async function click(target) {
  await waitForTarget(target);
  return evaluate(`(() => {
    const el = ${targetExpression(target)};
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    el.click();
    return true;
  })()`);
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

async function dispatchKey(key, { ctrl = false, shift = false, alt = false } = {}) {
  const keyMap = {
    Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
    Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
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
    return true;
  })()`);
  for (let index = 0; index < (action.leadingNewlines ?? 2); index += 1) await dispatchKey("Enter");
  for (const character of action.text) {
    if (character === "\n") await dispatchKey("Enter");
    else await send("Input.insertText", { text: character });
    if (action.charDelay) await sleep(action.charDelay);
  }
}

async function removeMarker() {
  await evaluate(`document.getElementById('then-guide-step-marker')?.remove()`);
}

async function showMarker(target, stepNumber, marker = {}) {
  await waitForTarget(target);
  const size = Number(marker.size ?? 34);
  const offsetX = Number(marker.offsetX ?? 10);
  const offsetY = Number(marker.offsetY ?? -10);
  const background = JSON.stringify(marker.background ?? "#d40000");
  const foreground = JSON.stringify(marker.foreground ?? "#ffffff");

  await evaluate(`(() => {
    document.getElementById('then-guide-step-marker')?.remove();
    const el = ${targetExpression(target)};
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = el.getBoundingClientRect();
    const marker = document.createElement('div');
    marker.id = 'then-guide-step-marker';
    marker.textContent = ${JSON.stringify(String(stepNumber))};
    Object.assign(marker.style, {
      position: 'fixed',
      left: Math.max(4, Math.min(innerWidth - ${size} - 4, rect.right + ${offsetX})) + 'px',
      top: Math.max(4, Math.min(innerHeight - ${size} - 4, rect.top + ${offsetY})) + 'px',
      width: '${size}px',
      height: '${size}px',
      borderRadius: '999px',
      background: ${background},
      color: ${foreground},
      border: '2px solid #ffffff',
      boxShadow: '0 1px 4px rgba(0,0,0,.55)',
      font: '700 18px/1 system-ui, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '2147483647',
      pointerEvents: 'none',
      boxSizing: 'border-box'
    });
    document.documentElement.appendChild(marker);
    return true;
  })()`);
}

async function capturePng(filePath) {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(filePath, Buffer.from(result.data, "base64"));
}

function instructionFor(action) {
  if (action.guide?.instruction) return action.guide.instruction;
  if (action.type === "click" || action.type === "clickIfPresent") return `［${action.label ?? "対象"}］をクリックします。`;
  if (action.type === "type") return `［${action.label ?? "入力欄"}］に「${action.text}」と入力します。`;
  if (action.type === "assert") return `${action.label ?? "画面"}を確認します。`;
  if (action.type === "shortcut") return `${action.label ?? action.key}を実行します。`;
  return action.label ?? action.type;
}

const steps = [];
let guideStep = 0;

async function captureGuideStep(action, actionIndex, phase) {
  if (!action.guide || action.guide === false) return;
  const capturePhase = action.guide.capture ?? (action.type === "type" || action.type === "assert" ? "after" : "before");
  if (capturePhase !== phase) return;

  guideStep += 1;
  const target = action.guide.target ?? action.target;
  if (target && action.guide.marker !== false) {
    await showMarker(target, guideStep, action.guide.markerStyle);
  } else {
    await removeMarker();
  }

  await sleep(action.guide.captureDelayMs ?? 120);
  const fileName = `${String(guideStep).padStart(3, "0")}.png`;
  await capturePng(path.join(screenshotsDirectory, fileName));
  await removeMarker();

  steps.push({
    step: guideStep,
    actionIndex: actionIndex + 1,
    type: action.type,
    instruction: instructionFor(action),
    screenshot: `screenshots/${fileName}`,
    capture: capturePhase,
    target: target ?? null,
  });
}

async function executeAction(action) {
  if (action.type === "wait") {
    await sleep(action.ms);
  } else if (action.type === "click" || action.type === "clickIfPresent") {
    if (action.type === "clickIfPresent") {
      const present = await evaluate(`Boolean(${targetExpression(action.target)})`);
      if (!present) return { skipped: true };
    }
    await click(action.target);
  } else if (action.type === "type") {
    await typeText(action.target, action.text);
  } else if (action.type === "editorAppend") {
    await appendToEditor(action);
  } else if (action.type === "shortcut") {
    await dispatchKey(action.key, action);
  } else if (action.type === "assert" || action.type === "focus") {
    await waitForTarget(action.target, action.timeoutMs ?? 10000);
  } else if (action.type === "nativeFolderDialog") {
    const helper = path.resolve("scripts/demo/select-folder-dialog.ps1");
    const helperArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Path", action.path];
    if (process.env.THEN_APP_PID) helperArgs.push("-OwnerProcessId", process.env.THEN_APP_PID);
    const result = spawnSync("powershell.exe", helperArgs, { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Windows のフォルダ選択に失敗しました。");
  } else {
    throw new Error(`未対応のアクションです: ${action.type}`);
  }
  return { skipped: false };
}

function renderMarkdown() {
  const lines = [`# ${scenario.title ?? scenario.name ?? "操作ガイド"}`, ""];
  if (scenario.description) lines.push(scenario.description, "");
  for (const step of steps) {
    lines.push(`${step.step}. ${step.instruction}`, "", `   ![手順${step.step}](${step.screenshot})`, "");
  }
  return `${lines.join("\n").trim()}\n`;
}

try {
  await send("Runtime.enable");
  await send("Page.enable");

  for (const [index, action] of scenario.actions.entries()) {
    process.stdout.write(`[${index + 1}/${scenario.actions.length}] ${action.label ?? action.type}\n`);
    await captureGuideStep(action, index, "before");
    const result = await executeAction(action);
    if (result.skipped) {
      process.stdout.write(`  skip: ${action.label ?? JSON.stringify(action.target)}\n`);
      continue;
    }
    await sleep(action.afterMs ?? 350);
    await captureGuideStep(action, index, "after");
  }

  const manifest = {
    name: scenario.name ?? scenario.title ?? "操作ガイド",
    source: scenarioPath,
    generatedAt: new Date().toISOString(),
    steps,
  };
  await writeFile(path.join(outputDirectory, "steps.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDirectory, "guide.md"), renderMarkdown(), "utf8");

  process.stdout.write(`操作ガイドを書き出しました: ${outputDirectory}\n`);
} finally {
  try { await removeMarker(); } catch {}
  socket.close();
}
