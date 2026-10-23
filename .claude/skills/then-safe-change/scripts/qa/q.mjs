// qa-session.mjs へ操作を送るクライアント。1回の呼び出しで1つの確認をする。
//
//   node q.mjs [--port 47811] eval '<式>'        ページで式を評価して値を出す（await できる）
//   node q.mjs evalfile <file.js>               ファイルの中身を評価する（qa-page.js の読み込みなど）
//   node q.mjs type '<文字>'                     フォーカスのある所へ文字を入れる（IME を通さない Input.insertText）
//   node q.mjs key Enter|Escape|Tab|Backspace    キーを押して離す
//   node q.mjs key i --mods ctrl,alt            修飾キー付き（ctrl/alt/shift/meta）
//   node q.mjs click <x> <y>                    その座標をマウスでクリックする
//   node q.mjs cdp '<steps の JSON>'             CDP をそのまま送る（[{method, params} | {wait: ms}]）
//   node q.mjs stop                             アプリを止める（残ったプロセスの数も出す）
// 文字入力とキーは CDP の Input.* を使う。React の onChange・onKeyDown が本物の操作と同じく動く。
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? args.splice(portIndex, 2)[1] : "47811";
const modsIndex = args.indexOf("--mods");
const mods = modsIndex >= 0 ? args.splice(modsIndex, 2)[1].split(",") : [];
const [mode, ...values] = args;

const KEYS = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
};
const modifierBits = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

async function send(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}/${path}`, { method: "POST", body: JSON.stringify(body ?? {}) });
  const result = await response.json();
  if (result.error) {
    console.log(JSON.stringify({ error: result.error }, null, 1));
    process.exitCode = 1;
  } else console.log(JSON.stringify(result.value, null, 1));
}

function keySteps(key) {
  const known = KEYS[key] ?? { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
  const modifiers = mods.reduce((bits, name) => bits | (modifierBits[name] ?? 0), 0);
  const type = modifiers || !KEYS[key] ? "rawKeyDown" : "keyDown";
  return [
    { method: "Input.dispatchKeyEvent", params: { type, key, ...known, modifiers } },
    { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key, ...known, modifiers } },
    { wait: 150 },
  ];
}

if (mode === "eval") await send("eval", { expr: values[0] });
else if (mode === "evalfile") await send("eval", { expr: readFileSync(values[0], "utf8") });
else if (mode === "type") await send("cdp", { steps: [{ method: "Input.insertText", params: { text: values[0] } }, { wait: 150 }] });
else if (mode === "key") await send("cdp", { steps: keySteps(values[0]) });
else if (mode === "click") {
  const [x, y] = values.map(Number);
  await send("cdp", { steps: [
    { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x, y } },
    { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x, y, button: "left", clickCount: 1 } },
    { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x, y, button: "left", clickCount: 1 } },
    { wait: 300 },
  ] });
} else if (mode === "cdp") await send("cdp", { steps: JSON.parse(values[0]) });
else if (mode === "stop") await send("stop");
else throw new Error("usage: q.mjs [--port N] eval|evalfile|type|key|click|cdp|stop ...");
