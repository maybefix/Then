// 原稿用紙モード（v0.7.0）のブラウザQA。ヘッドレスEdgeで実際に組版し、
// 字詰め・行数・ページ境界・枚数・入力操作を確かめる。
//
//   node scripts/test-v070-manuscript-browser.mjs [--dist <dir>] [--no-build]
//
// 確かめること
//   基本  20字×20行 / 40字×30行 / 設定変更 / 縦書き / 横書き / continuous / paged
//   入力  日本語連続入力 / IME変換（CDP Input.imeSetComposition）/ 変換候補の切り替え /
//         長文貼り付け / Backspace / Delete / Undo / Redo
//   組版  20字ちょうど / 21字 / 20行ちょうど / 21行 / 句読点・閉じ括弧・開き括弧の行末 /
//         会話文 / 空行 / 段落字下げ / ルビ / 縦中横 / 欧文 / 欧文と和文の混在
//   保存  原稿用紙の有無で本文テキストが変わらない
import assert from "node:assert/strict";
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
const flag = (name) => args.includes(`--${name}`);
// 利用者の環境に合わせて組む：--editor-font "BIZ UD明朝 Medium" --manuscript-font-size 24
const EDITOR_FONT = option("editor-font", null);
const MANUSCRIPT_FONT_SIZE = option("manuscript-font-size", null) === null ? null : Number(option("manuscript-font-size", null));
// 利用者の環境に合わせて組む：--editor-font "BIZ UD明朝 Medium" --manuscript-font-size 24

let dist = option("dist", null);
if (!dist) {
  dist = path.join(os.tmpdir(), "then-manuscript-qa-dist");
  if (!flag("no-build")) {
    const result = spawnSync("npx", ["vite", "build", "--base", "./", "--outDir", dist, "--emptyOutDir"], { stdio: "inherit", shell: true });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
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

const edgePath = process.env.EDGE_PATH ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Edge or Chrome was not found; set EDGE_PATH.");
const profileDir = mkdtempSync(path.join(os.tmpdir(), "then-ms-qa-"));
const debugPort = 9800 + Math.floor(Math.random() * 150);
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
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const connection = {};
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method) connection.onEvent?.(message);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  await new Promise((resolve) => (socket.onopen = resolve));
  return Object.assign(connection, {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  });
}

const helpers = await readFile(new URL("./lib/manuscript-qa-helpers.js", import.meta.url), "utf8");
const passed = [];
const check = (name, fn) => { fn(); passed.push(name); };

try {
  await json(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  const page = await connect(target.webSocketDebuggerUrl);
  const pageErrors = [];
  page.onEvent = (message) => {
    if (message.method === "Runtime.exceptionThrown") pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") pageErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  };
  const evaluate = async (expression) => {
    const response = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 1200));
    return response.result.value;
  };
  const key = async (keyName, code, keyCode, modifiers = 0) => {
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await sleep(60);
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: appUrl });
  await sleep(1500);
  // 原稿用紙ON・20字×20行・縦書き・連続表示・タイプライターONで起動する。
  await evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem("then.app-state.v1", JSON.stringify({ settings: {
      writingMode: "vertical-rl", editorDisplayMode: "continuous", typewriterScroll: true,
      // --line-numbers：窓の外の段落にも割り付け用の装飾が付く（全文装飾）。
      showLineNumbers: ${flag("line-numbers")},
      manuscript: { layoutMode: "manuscript", charactersPerLine: 20, linesPerPage: 20, showGrid: true, showPageBoundaries: true,
        ...(${MANUSCRIPT_FONT_SIZE ?? "null"} === null ? {} : { fontSize: ${MANUSCRIPT_FONT_SIZE ?? "null"} }) },
      ...(${JSON.stringify(EDITOR_FONT)} === null ? {} : { editorFontFamily: ${JSON.stringify(JSON.stringify(EDITOR_FONT ?? ""))} }),
    } }));
    location.reload();
    return 1;
  })()`);
  await sleep(3500);
  const opened = await evaluate(`(async () => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新しい原稿"))?.click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return Boolean(document.querySelector(".ProseMirror"));
  })()`);
  assert.ok(opened, "editor did not open");
  await evaluate(`${helpers}; 1`);
  await evaluate("document.fonts.ready.then(() => 1)");

  // 長文貼り付け
  await evaluate(`(async () => { __ms.paste(__ms.sampleText()); await __ms.sleep(1500); await __ms.frames(4); return 1; })()`);
  const sample = await evaluate("__ms.sampleText()");
  const editorText = () => evaluate(`(() => { const ed = __ms.pm().editor; const parts = []; ed.state.doc.forEach((node) => parts.push(node.textContent)); return parts.join("\\n"); })()`);
  const pasted = await editorText();
  check("長文貼り付け：本文はそのまま", () => assert.equal(pasted, sample));
  // 段落 index の末尾へキャレットを置く。
  const caretAtEnd = (index) => evaluate(`(() => {
    const ed = __ms.pm().editor; let pos = 0;
    for (let i = 0; i <= ${index}; i += 1) pos += ed.state.doc.child(i).nodeSize;
    ed.commands.setTextSelection(pos - 1); ed.view.focus(); return pos - 1;
  })()`);

  const layoutReport = () => evaluate(`(async () => {
    await __ms.sleep(300); await __ms.frames(3);
    const root = __ms.pm();
    const n = root.childElementCount;
    const checks = {};
    for (let i = 0; i < n; i += 1) checks[i] = __ms.check(i);
    const boundaries = [...document.querySelectorAll(".manuscriptPageBoundary")].map((b) => Number(b.dataset.manuscriptPage));
    return {
      mode: getComputedStyle(root).writingMode,
      display: document.querySelector(".verticalTypewriterShell").dataset.editorDisplay,
      lines: __ms.laidOutLines(), status: __ms.status(), checks, boundaries, offGrid: __ms.offGrid(),
      hangHtml: root.children[49]?.outerHTML.slice(-600),
      grid: getComputedStyle(root).backgroundImage !== "none",
      sheetGrid: document.querySelector(".pagedEditorSheet") ? getComputedStyle(document.querySelector(".pagedEditorSheet")).backgroundImage !== "none" : null,
      sheets: document.querySelectorAll(".pagedEditorSheet").length,
      statusPages: document.querySelector(".statusPages")?.textContent ?? null,
      pInline: (() => { const p = root.children[0].getBoundingClientRect(); return getComputedStyle(root).writingMode === "horizontal-tb" ? p.width : p.height; })(),
      fontSize: Number.parseFloat(getComputedStyle(root).fontSize),
      // 境界線より流れの先頭側にある行の数（各段落の行を行送りから求める）。
      boundaryPositions: [...document.querySelectorAll(".manuscriptPageBoundary")].map((b) => {
        const vertical = getComputedStyle(root).writingMode !== "horizontal-tb";
        const pitch = Number.parseFloat(getComputedStyle(root).lineHeight);
        const r = b.getBoundingClientRect();
        const at = vertical ? r.left : r.top;
        let before = 0;
        for (const p of root.children) {
          const pr = p.getBoundingClientRect();
          const n = Math.round((vertical ? pr.width : pr.height) / pitch);
          for (let k = 0; k < n; k += 1) {
            const center = vertical ? pr.right - (k + 0.5) * pitch : pr.top + (k + 0.5) * pitch;
            if (vertical ? center > at : center < at) before += 1;
          }
        }
        return { page: Number(b.dataset.manuscriptPage), before };
      }),
      blankLines: (() => { const p = root.children[4]; const pitch = Number.parseFloat(getComputedStyle(root).lineHeight);
        return Math.round((getComputedStyle(root).writingMode === "horizontal-tb" ? p.getBoundingClientRect().height : p.getBoundingClientRect().width) / pitch); })(),
    };
  })()`);

  const assertLayout = (report, chars, linesPerPage, label) => {
    assert.deepEqual(report.offGrid, [], `${label}: 行が太って以降の行が升目からずれる段落がある`);
    const misaligned = Object.entries(report.checks).filter(([, c]) => c.misaligned.length);
    const gaps = Object.entries(report.checks).filter(([, c]) => c.gaps.length).map(([index, c]) => `${index}: ${c.gaps.join(" ")}`);
    assert.deepEqual(gaps, [], `${label}: 字の間に1セルを超える空きがある`);
    assert.deepEqual(misaligned, [], `${label}: 通常和文がセルの基準位置からずれている`);
    assert.ok(Math.abs(report.pInline - (chars * report.fontSize + 1)) < 0.5, `${label}: 版面の字詰めが ${chars}字×1ic でない (${report.pInline})`);
    const full = Math.floor(report.lines / linesPerPage);
    assert.equal(report.status?.title, `${full}枚と${report.lines - full * linesPerPage}行（1枚${linesPerPage}行）`, `${label}: 枚数が組版の行数と合わない`);
  };

  // --- 20字×20行・縦書き・continuous ---
  let report = await layoutReport();
  check("縦書き continuous 20×20", () => {
    assert.equal(report.mode, "vertical-rl");
    assert.equal(report.display, "continuous");
    assert.equal(report.fontSize, MANUSCRIPT_FONT_SIZE ?? 21, "原稿用紙の文字サイズ（未設定なら通常の15px＋6）で組む");
    assertLayout(report, 20, 20, "縦 20×20");
    assert.ok(report.grid, "罫線がない");
    const c = report.checks;
    assert.equal(c[0].lines, 1, "20字ちょうどは1行");
    assert.equal(c[1].lines, 2, "21字は2行");
    assert.equal(c[1].first, "あいうえおかきくけこさしすせそたちつてと");
    assert.equal(c[2].first, "これはABCです。Hello worldと書く。", "欧文混在の1行目");
    assert.equal(c[3].first, "「会話文です。とても長い会話文が続きます", "会話文");
    assert.equal(report.blankLines, 1, "空行も1行として数える");
    assert.equal(c[5].first, "　字下げの段落。句読点が行末に来る場合の", "段落字下げは1字");
    assert.equal(c[46].lines, 2, "ルビの行が太らない（2行ちょうど）");
    assert.equal(c[48].lines, 1, "句読点が20字目なら1行に収まる");
    assert.equal(c[48].first, "あいうえおかきくけこさしすせそたちつて。");
    assert.equal(c[49].first, "あいうえおかきくけこさしすせそたちつ「て」", `21字目の閉じ括弧は欄外へぶら下げる ${report.hangHtml}`);
    assert.equal(c[50].first, "あいうえおかきくけこさしすせそたちつて", "開き括弧を行末に残さない");
    assert.equal(c[55].first, "あいうえおかきくけこさしすせそたちつてと。", "21字目の句点は欄外へぶら下げる");
    assert.equal(c[56].first, "あいうえおかきくけこさしすせそたちつてと。」", "続く約物はまとめてぶら下げる");
    assert.equal(c[57].first, "あいう、えお。かきくけこさしすせそたちつ", "行の途中の句読点は1字1セル");
    assert.equal(c[55].hangs, "。", "ぶら下げた句点は升目の外");
  });
  check("ページ境界（20行ごと）", () => {
    assert.ok(report.boundaryPositions.length > 0, "見えている範囲に境界がない");
    for (const page of report.boundaries) assert.ok(page >= 1 && page < Math.ceil(report.lines / 20));
    for (const { page, before } of report.boundaryPositions) assert.equal(before, page * 20, `${page}ページ目の境界が ${page * 20} 行の後ろにない`);
  });
  const bodyHasNoBoundaries = await evaluate(`!__ms.pm().querySelector(".manuscriptPageBoundary, .manuscriptPageBoundaryLabel")`);
  check("本文へページ区切り要素を入れない", () => assert.ok(bodyHasNoBoundaries));

  // 20行ちょうど・21行：20字の行を順に足して境界を確かめる（別文書で）。
  const exactLines = await evaluate(`(async () => {
    const ed = __ms.pm().editor;
    ed.commands.selectAll();
    const row = "あいうえおかきくけこさしすせそたちつてと";
    __ms.paste(Array.from({ length: 20 }, () => row).join("\\n"));
    await __ms.sleep(800); await __ms.frames(4);
    const twenty = { lines: __ms.laidOutLines(), status: __ms.status(), boundaries: document.querySelectorAll(".manuscriptPageBoundary").length };
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    __ms.paste("\\n" + row);
    await __ms.sleep(800); await __ms.frames(4);
    const twentyOne = { lines: __ms.laidOutLines(), status: __ms.status(), boundaries: [...document.querySelectorAll(".manuscriptPageBoundary")].map((b) => b.dataset.manuscriptPage) };
    return { twenty, twentyOne };
  })()`);
  check("20行ちょうど・21行", () => {
    assert.equal(exactLines.twenty.lines, 20);
    assert.equal(exactLines.twenty.status.text, "原稿用紙 1.0枚");
    assert.equal(exactLines.twenty.boundaries, 0, "20行ちょうどでは境界を出さない");
    assert.equal(exactLines.twentyOne.lines, 21);
    assert.deepEqual(exactLines.twentyOne.boundaries, ["1"], "21行目の前に1ページ目の終わり");
  });

  // 入力：日本語連続入力・Backspace・Delete・Undo・Redo
  await evaluate(`(async () => { const ed = __ms.pm().editor; ed.commands.selectAll(); __ms.paste(__ms.sampleText()); await __ms.sleep(1200); return 1; })()`);
  await caretAtEnd(0);
  const before = await editorText();
  for (const ch of "吾輩は猫である") await page.send("Input.insertText", { text: ch });
  await sleep(300);
  let after = await editorText();
  check("日本語連続入力", () => assert.equal(after.split("\n")[0], "あいうえおかきくけこさしすせそたちつてと吾輩は猫である"));
  await key("Backspace", "Backspace", 8);
  after = await editorText();
  check("Backspace", () => assert.equal(after.split("\n")[0], "あいうえおかきくけこさしすせそたちつてと吾輩は猫であ"));
  // 「猫」と「で」の間から Delete。
  await evaluate(`(() => { const ed = __ms.pm().editor; ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize - 3); return 1; })()`);
  await key("Delete", "Delete", 46);
  after = await editorText();
  check("Delete", () => assert.equal(after.split("\n")[0], "あいうえおかきくけこさしすせそたちつてと吾輩は猫あ"));
  for (let i = 0; i < 10 && (await editorText()) !== before; i += 1) await key("z", "KeyZ", 90, 2);
  await sleep(200);
  after = await editorText();
  check("Undo", () => assert.equal(after, before));
  await key("y", "KeyY", 89, 2);
  await sleep(200);
  after = await editorText();
  check("Redo", () => assert.notEqual(after, before));

  // ぶら下げた約物の前後でキャレットが重ならない（約物の送りを0にしない）。
  // 段落内の文字オフセットにキャレットを置き、DOMの選択範囲の位置をセル単位で返す。
  const caretCell = (index, offset) => evaluate(`(async () => {
    const ed = __ms.pm().editor; let pos = 1;
    for (let i = 0; i < ${index}; i += 1) pos += ed.state.doc.child(i).nodeSize;
    ed.commands.setTextSelection(pos + ${offset}); ed.view.focus(); await __ms.frames(2);
    const p = __ms.pm().children[${index}]; const box = p.getBoundingClientRect();
    const ic = Number.parseFloat(getComputedStyle(p).fontSize);
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    const vertical = getComputedStyle(p).writingMode !== "horizontal-tb";
    return { cell: +(((vertical ? r.top - box.top : r.left - box.left)) / ic).toFixed(2),
      line: Math.round((vertical ? box.right - r.right : r.top - box.top) / Number.parseFloat(getComputedStyle(p).lineHeight)) };
  })()`);
  const hangCarets = [await caretCell(55, 20), await caretCell(55, 21), await caretCell(57, 3), await caretCell(57, 4)];
  check("ぶら下げた約物の前後のキャレット位置", () => {
    assert.deepEqual(hangCarets.map((c) => Math.round(c.cell)), [20, 21, 3, 4], JSON.stringify(hangCarets));
    assert.deepEqual(hangCarets.map((c) => c.line), [0, 0, 0, 0], JSON.stringify(hangCarets));
  });
  // 約物の直後で変換すると、変換中の字が約物の装飾の中に入ることがある。字が重ならず、
  // 後続の字と同じくセルの境目から始まること。
  await caretCell(57, 4);
  await page.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
  await sleep(150);
  const composingCells = await evaluate(`(() => {
    const p = __ms.pm().children[57]; const box = p.getBoundingClientRect();
    const ic = Number.parseFloat(getComputedStyle(p).fontSize);
    return __ms.characters(p).slice(3, 8).map((c) => c.ch + Math.round(c.offset / ic * 100) / 100).join(" ");
  })()`);
  await page.send("Input.insertText", { text: "かな" });
  await sleep(300);
  check("約物の直後の変換中の字", () => assert.equal(composingCells, "、3 か4 な5 え6 お7"));
  await key("z", "KeyZ", 90, 2);
  await sleep(200);

  // IME変換と候補の切り替え（CDP Input.imeSetComposition は実際の composition イベントを起こす）
  await caretAtEnd(3);
  const lineBefore = (await editorText()).split("\n")[3];
  const imeStates = [];
  for (const candidate of ["へんかん", "変換", "返還", "変換"]) {
    await page.send("Input.imeSetComposition", { text: candidate, selectionStart: candidate.length, selectionEnd: candidate.length });
    await sleep(120);
    imeStates.push(await evaluate(`(() => ({ composing: __ms.pm().editor.view.composing, boundaryLayer: document.querySelector(".manuscriptPageBoundaryLayer").childElementCount, status: __ms.status()?.text }))()`));
  }
  await page.send("Input.insertText", { text: "変換" });
  await sleep(500);
  const lineAfter = (await editorText()).split("\n")[3];
  check("IME変換・候補の切り替え", () => {
    assert.ok(imeStates.every((state) => state.composing), "変換中は composing のまま");
    assert.equal(lineAfter, lineBefore + "変換", "確定した文字だけが本文に入る");
  });
  report = await layoutReport();
  check("IME確定後も字詰めと枚数が一致", () => assertLayout(report, 20, 20, "IME後"));

  // 枚数補正：全文装飾なしでも、装飾窓の外の記法段落を整形後の行数で数える。
  // 同じ本文の記法段落が何度も出る（測った行数は本文ごとに1つなので、同じ本文の
  // 段落すべてに入らないと、残りが未整形の行数のまま数えられる）。
  // 正解は、キャレットを動かして装飾窓を原稿全体に順に当て、装飾された状態の
  // 段落の実際の行数を DOM から集めたもの（キャレット行は記法が生表示になるので除く）。
  const probeCheck = await evaluate(`(async () => {
    const ed = __ms.pm().editor;
    const lines = [];
    for (let i = 0; i < 400; i += 1) {
      // 6段落に1つは同じ本文（記号込み41字で3行、整形後27字で2行）。
      lines.push(i % 6 === 0
        ? "　｜東雲《しののめ》の空が白む。彼女は窓の外を見た。｜東雲《しののめ》の空が白む。"
        : i % 3 === 0
        ? "　｜東雲《しののめ》の空が白む。**誰も答えなかった**。iPhone 15とMacBookを机に置いた。第" + i + "段"
        : i % 3 === 1 ? "# 見出し" + i : "　ふつうの段落です。あいうえおかきくけこさしすせそたちつてとなにぬねの" + i);
    }
    lines.push("");
    ed.commands.selectAll();
    __ms.paste(lines.join("\\n"));
    await __ms.sleep(1500);
    const total = () => { const t = __ms.status()?.title ?? ""; const m = t.match(/(\\d+)枚と(\\d+)行（1枚(\\d+)行）/); return m ? Number(m[1]) * Number(m[3]) + Number(m[2]) : NaN; };
    const totals = [];
    const caretAt = async (index) => {
      let pos = 1; for (let i = 0; i < index; i += 1) pos += ed.state.doc.child(i).nodeSize;
      ed.commands.setTextSelection(pos); await __ms.sleep(300); await __ms.frames(4);
      totals.push(total());
    };
    // 最終の空行にキャレットを置き、段落ごとの最終的な行数が揃うのを待つ。
    // 揃うまでは枚数を出さない（途中の値を出さない）ことも確かめる。
    await caretAt(ed.state.doc.childCount - 1);
    const seen = new Set();
    let corrected = NaN;
    for (let i = 0; i < 80; i += 1) { await __ms.sleep(100); const now = total(); if (!Number.isNaN(now)) seen.add(now); if (now === corrected && i > 10) break; corrected = now; }
    totals.length = 0;
    const decoratedElements = __ms.pm().querySelectorAll("p.pm-line").length;
    const root = __ms.pm();
    const pitch = Number.parseFloat(getComputedStyle(root).lineHeight);
    const truth = new Map();
    for (let at = 0; at < root.childElementCount; at += 60) {
      await caretAt(at);
      [...root.children].forEach((p, index) => {
        if (index === at || truth.has(index) || !p.classList.contains("pm-line")) return;
        truth.set(index, Math.round(p.getBoundingClientRect().width / pitch));
      });
    }
    await caretAt(root.childElementCount - 1);
    truth.set(root.childElementCount - 1, 1);
    let truthTotal = 0; for (const n of truth.values()) truthTotal += n;
    await __ms.sleep(500);
    const visitTotals = [...new Set(totals)];
    // TSF入力の接続中の印（nativeImeActive）はフォーカスの出入りで付け外しされる。
    // 組版は変わらないので、行数のキャッシュを捨てて全段落を測り直してはいけない。
    const probeBeforeToggle = root.__manuscriptProbeQA();
    for (const on of [true, false, true, false]) { root.classList.toggle("nativeImeActive", on); await __ms.frames(3); }
    await __ms.sleep(300);
    const probeAfterToggle = root.__manuscriptProbeQA();
    // ページ表示：用紙数は最終的な行数から割り付け、未訪問のページがあっても変わらない。
    await __ms.setSelect("編集表示", "paged");
    await __ms.sleep(1500);
    const sheets = () => document.querySelectorAll(".pagedEditorSheet").length;
    const sheetCounts = [sheets()];
    for (const at of [0, Math.floor(root.childElementCount / 2), root.childElementCount - 1]) {
      await caretAt(at); await __ms.sleep(800); sheetCounts.push(sheets());
    }
    await __ms.setSelect("編集表示", "continuous");
    await __ms.sleep(800);
    return { corrected, seen: [...seen], truthTotal, covered: truth.size, paragraphs: root.childElementCount, decoratedElements,
      visitTotals, afterScroll: total(), sheetCounts, probeBeforeToggle, probeAfterToggle };
  })()`);
  check("枚数補正：装飾窓の外の記法段落も整形後の行数で数える", () => {
    assert.equal(probeCheck.covered, probeCheck.paragraphs, "正解側で全段落を測れていない");
    if (!flag("line-numbers")) assert.ok(probeCheck.decoratedElements < probeCheck.paragraphs, "原稿用紙だけで全文装飾になっている");
    assert.equal(probeCheck.corrected, probeCheck.truthTotal, `補正後の行数 ${probeCheck.corrected} と実測 ${probeCheck.truthTotal} が違う`);
    assert.deepEqual(probeCheck.seen, [probeCheck.corrected], `枚数が途中の値を経て変わった: ${probeCheck.seen}`);
    assert.deepEqual(probeCheck.visitTotals, [probeCheck.corrected], `キャレット・装飾窓の移動で枚数が変わった: ${probeCheck.visitTotals}`);
    assert.equal(probeCheck.afterScroll, probeCheck.corrected, "装飾窓を動かすと枚数が変わる");
  });
  check("TSF入力の切り替えで行数を測り直さない", () => {
    const { probeBeforeToggle: before, probeAfterToggle: after } = probeCheck;
    assert.equal(after.resets, before.resets, `行数キャッシュが捨てられた: ${JSON.stringify({ before, after })}`);
    assert.equal(after.paragraphs, before.paragraphs, `隠し要素で測り直した: ${JSON.stringify({ before, after })}`);
  });
  check("ページ表示：用紙数は未訪問ページの有無で変わらない", () => {
    const expected = Math.ceil(probeCheck.corrected / 20);
    assert.deepEqual([...new Set(probeCheck.sheetCounts)], [expected], `用紙数 ${probeCheck.sheetCounts} / 期待 ${expected}`);
  });
  // 元のサンプルへ戻す。
  await evaluate(`(async () => { const ed = __ms.pm().editor; ed.commands.selectAll(); __ms.paste(__ms.sampleText()); await __ms.sleep(1200); return 1; })()`);

  // 保存：原稿用紙の有無で本文テキストは変わらない
  const textManuscript = await editorText();
  await evaluate(`__ms.setSelect("原稿用紙", "normal").then(() => 1)`);
  await sleep(500);
  const textNormal = await editorText();
  const normalState = await evaluate(`({ status: __ms.status(), grid: getComputedStyle(__ms.pm()).backgroundImage, boundaries: document.querySelectorAll(".manuscriptPageBoundary").length, latin: __ms.pm().querySelectorAll(".ms-latin-end").length, fontSize: Number.parseFloat(getComputedStyle(__ms.pm()).fontSize) })`);
  check("原稿用紙OFFで本文不変・表示が戻る", () => {
    assert.equal(textNormal, textManuscript);
    assert.equal(normalState.status, null);
    assert.equal(normalState.grid, "none");
    assert.equal(normalState.boundaries, 0);
    assert.equal(normalState.latin, 0);
    assert.equal(normalState.fontSize, 15, "原稿用紙を外すと通常の文字サイズに戻る");
  });
  await evaluate(`__ms.setSelect("原稿用紙", "manuscript").then(() => 1)`);

  // --- 設定変更：40字×30行 ---
  await evaluate(`(async () => { await __ms.setNumber("1行の字数", 40); await __ms.setNumber("1ページの行数", 30); return 1; })()`);
  report = await layoutReport();
  check("設定変更 40×30（縦書き）", () => {
    assertLayout(report, 40, 30, "縦 40×30");
    assert.equal(report.checks[1].lines, 1, "21字は40字詰めでは1行");
  });

  // --- 横書き ---
  await evaluate(`__ms.setSelect("本文方向", "horizontal-tb").then(() => 1)`);
  report = await layoutReport();
  check("横書き continuous 40×30", () => {
    assert.equal(report.mode, "horizontal-tb");
    assertLayout(report, 40, 30, "横 40×30");
  });
  await evaluate(`(async () => { await __ms.setNumber("1行の字数", 20); await __ms.setNumber("1ページの行数", 20); return 1; })()`);
  report = await layoutReport();
  check("横書き continuous 20×20", () => assertLayout(report, 20, 20, "横 20×20"));

  // --- paged ---
  await evaluate(`__ms.setSelect("編集表示", "paged").then(() => 1)`);
  await sleep(800);
  report = await layoutReport();
  check("横書き paged 20×20", () => {
    assert.equal(report.display, "paged");
    assertLayout(report, 20, 20, "横 paged");
    assert.equal(report.sheets, Math.ceil(report.lines / 20), "ページ数は行数÷20の切り上げ");
    assert.equal(report.boundaries.length, 0, "ページ表示では境界線を出さない（ページが境界）");
    assert.ok(report.sheetGrid, "用紙に罫線");
  });
  await evaluate(`__ms.setSelect("本文方向", "vertical-rl").then(() => 1)`);
  await sleep(800);
  report = await layoutReport();
  check("縦書き paged 20×20", () => {
    assertLayout(report, 20, 20, "縦 paged");
    assert.equal(report.sheets, Math.ceil(report.lines / 20));
  });
  await evaluate(`(async () => { await __ms.setNumber("1行の字数", 40); await __ms.setNumber("1ページの行数", 30); return 1; })()`);
  await sleep(800);
  report = await layoutReport();
  check("縦書き paged 40×30", () => {
    assertLayout(report, 40, 30, "縦 paged 40×30");
    assert.equal(report.sheets, Math.ceil(report.lines / 30));
  });

  // A Range can report a glyph outside its ancestor's clip even though none of
  // its ink is painted. Check the page clip as well as the typeset positions.
  for (const mode of ["vertical-rl", "horizontal-tb"]) {
    const hangingClip = await evaluate(`(async () => {
      await __ms.setNumber("1行の字数", 20);
      await __ms.setNumber("1ページの行数", 20);
      await __ms.setSelect("本文方向", ${JSON.stringify(mode)});
      const ed = __ms.pm().editor;
      const lines = ["あ".repeat(20) + "」", "「" + "い".repeat(19) + "」", "う".repeat(20) + "。」』",
        ...Array.from({ length: 20 }, () => "え".repeat(20))];
      ed.commands.setContent({ type: "doc", content: lines.map(text => ({
        type: "paragraph", content: [{ type: "text", text }],
      })) });
      ed.commands.setTextSelection(1);
      await __ms.sleep(1000); await __ms.frames(4);
      const root = __ms.pm(), host = root.parentElement, hostRect = host.getBoundingClientRect();
      const inset = getComputedStyle(host).clipPath.match(/inset\\(([^)]+)\\)/)[1].split(" ").map(parseFloat);
      const top = inset[0], right = inset[1] ?? top, bottom = inset[2] ?? top, left = inset[3] ?? right;
      const clip = { top: hostRect.top + top, right: hostRect.right - right,
        bottom: hostRect.bottom - bottom, left: hostRect.left + left };
      const rects = [];
      const range = document.createRange();
      for (const p of [...root.children].slice(0, 3)) {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) for (let i = 0; i < node.length; i++) {
          if (!"。」』".includes(node.data[i])) continue;
          range.setStart(node, i); range.setEnd(node, i + 1);
          rects.push(...[...range.getClientRects()].map(r => ({
            top: r.top, right: r.right, bottom: r.bottom, left: r.left,
          })));
        }
      }
      const next = root.children[20].getBoundingClientRect();
      return { clip, rects, next: { top: next.top, right: next.right },
        textMatches: ed.state.doc.textBetween(0, ed.state.doc.content.size, "\\n") === lines.join("\\n") };
    })()`);
    check(`${mode} ページ表示でぶら下げ括弧を切らず、次ページは隠す`, () => {
      assert.equal(hangingClip.textMatches, true);
      assert.ok(hangingClip.rects.length >= 5);
      for (const rect of hangingClip.rects) {
        if (mode === "vertical-rl") assert.ok(rect.bottom <= hangingClip.clip.bottom + 0.5, JSON.stringify(hangingClip));
        else assert.ok(rect.right <= hangingClip.clip.right + 0.5, JSON.stringify(hangingClip));
      }
      if (mode === "vertical-rl") assert.ok(hangingClip.next.right <= hangingClip.clip.left + 0.5);
      else assert.ok(hangingClip.next.top >= hangingClip.clip.bottom - 0.5);
    });
  }

  assert.deepEqual(pageErrors, [], `page errors:\n${pageErrors.join("\n")}`);
  for (const name of passed) console.log(`ok - ${name}`);
  console.log(`v0.7.0 manuscript browser QA passed (${passed.length} checks)`);
  page.close();
} catch (error) {
  for (const name of passed) console.log(`ok - ${name}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  server.close();
  await stopBrowser(browser, profileDir);
  // 失敗時は CDP の接続が残ってイベントループが終わらないので、明示的に終える。
  process.exit(process.exitCode ?? 0);
}
