// BINDER 4-2: ノート・原稿を指すファイルのカードと、参照先ファイルへの書き戻し。
// 本物の CanvasWindowApp・保存の層・書き戻しの順番待ち・メイン画面の書き込み口（canvasFileWriter.ts）を1つに束ねて
// jsdom で動かし、Tauri の命令とファイルは入れ物で受ける。書き戻しが、いつ・どの中身・どのハッシュで頼まれ、
// ファイルがどうなったかを確かめる。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Node: dom.window.Node,
  CSS: { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&") },
  IS_REACT_ACT_ENVIRONMENT: true,
});
// 0.5 秒の遅延保存は本物の時計で待つので、React は act の外の更新を警告する。警告には束ねたコードの
// data: URL がまるごと付き、出力が膨らむので、その警告だけは出さない（ほかのエラーはそのまま出す）。
const consoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  consoleError(...args);
};
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

// ---- 束ねる ----
const stub = (contents) => ({ contents, loader: "js" });
const stubs = {
  "@tauri-apps/api/core": stub("export const invoke = (...args) => globalThis.fileTest.invoke(...args);"),
  "@tauri-apps/api/event": stub(`
    export const listen = async (event, handler) => globalThis.fileTest.listen(event, handler);
    export const emit = async (event, payload) => globalThis.fileTest.emit(event, payload);
    export const emitTo = async (target, event, payload) => globalThis.fileTest.emit(event, payload, target);`),
  "./components/references/ReferenceLayer": stub("export const ReferenceReadOnlyPreview = () => null;"),
  "./components/canvas/IntermediateDraftPane": stub("export default () => null;"),
  "./intermediateDraftStore": stub("export const prepareDraftBoardTrash = async () => {}; export const flushDraftBoard = async () => {};"),
};
const external = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];
const entry = `
export { default as Canvas } from "./src/CanvasWindowApp.tsx";
export { canvasFileWriteQueue, canvasBoardSaveQueue } from "./src/canvasBoardStore.ts";
export { CanvasFileWriteQueue, canvasFileWriteKey } from "./src/canvasFileWriteQueue.ts";
export { writeCanvasFile } from "./src/canvasFileWriter.ts";
export { flushPendingSaves } from "./src/pendingSaves.ts";
export { normalizeCanvasDocument, serializeCanvasDocument, retargetCanvasReferenceNodes } from "./src/canvasTypes.ts";
export { boardFilePaths, fileCardsToTextCards } from "./src/utils/libraryTransfer.ts";
`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts", sourcefile: "file-nodes-entry.ts" },
  bundle: true, format: "esm", platform: "neutral", write: false, jsx: "automatic",
  plugins: [{
    name: "file-node-test",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (stubs[args.path]) return { path: args.path, namespace: "stub" };
        if (external.includes(args.path)) return { path: pathToFileURL(require.resolve(args.path)).href, external: true };
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => stubs[args.path]);
    },
  }],
});
const lib = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const { Canvas, canvasFileWriteQueue, CanvasFileWriteQueue, writeCanvasFile, flushPendingSaves } = lib;

// ---- 入れ物（Tauri の命令・知らせ・ファイル・メイン画面のタブ） ----
const ROOT = "/work";
const abs = (relative) => `${ROOT}/${relative}`;
const hashOf = (content) => `h${[...content].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) >>> 0, 7)}`;
const listeners = new Map();
let files, docs, calls, emitted, openTabs, activeTab, writeRequests, openedFiles, writeGate;
const conflictError = () => Object.assign(new Error("conflict"), { conflict: true });
const documentOf = (filePath) => {
  const content = files.get(filePath);
  return { path: filePath, name: path.posix.basename(filePath), content, contentHash: hashOf(content) };
};
const boardKey = (rootPath, boardId) => JSON.stringify([rootPath, boardId]);
globalThis.fileTest = {
  invoke: async (command, args = {}) => {
    calls.push({ command, ...structuredClone(args) });
    if (command === "list_canvas_boards") {
      return [...docs].filter(([id]) => JSON.parse(id)[0] === args.rootPath)
        .map(([id, doc]) => ({ id: JSON.parse(id)[1], name: doc.then.name, scope: "project", nodeCount: doc.nodes.length, edgeCount: 0 }));
    }
    if (command === "load_canvas_board") return structuredClone(docs.get(boardKey(args.rootPath, args.boardId)));
    if (command === "save_canvas_board") { docs.set(boardKey(args.rootPath, args.boardId), structuredClone(args.board)); return; }
    if (command === "create_canvas_board") {
      const id = `created-${docs.size}`;
      docs.set(boardKey(args.rootPath, id), { nodes: [], edges: [], then: { version: 1, name: args.name } });
      return { id, name: args.name, scope: "project", nodeCount: 0, edgeCount: 0 };
    }
    if (command === "trash_canvas_board") { docs.delete(boardKey(args.rootPath, args.boardId)); return; }
    if (command === "read_text_file") {
      if (!files.has(args.path)) throw new Error("not found");
      return documentOf(args.path);
    }
    if (command === "library_transfer_destinations") return [{ path: "/other", label: "作品B" }];
    if (command === "load_intermediate_draft") return { versions: [] };
    if (command === "focus_source_in_main" || command === "finish_canvas_close_preparation") return;
    throw new Error(`Unexpected command ${command}`);
  },
  listen: (event, handler) => {
    const list = listeners.get(event) ?? new Set();
    listeners.set(event, list);
    list.add(handler);
    return () => list.delete(handler);
  },
  emit: (event, payload, target) => {
    emitted.push({ event, target, payload: structuredClone(payload) });
    for (const handler of listeners.get(event) ?? []) handler({ event, payload: structuredClone(payload) });
  },
};
window.__TAURI_INTERNALS__ = {};

// メイン画面の書き込み口。タブは openTabs（絶対パス → 中身）。
const host = () => ({
  isActiveTab: (target) => target === activeTab,
  openTabMarkdown: (target) => openTabs.get(target) ?? null,
  updateActiveMarkdown: (markdown) => openTabs.set(activeTab, markdown),
  updateBackgroundTab: (target, markdown) => openTabs.set(target, markdown),
  readFile: async (target) => documentOf(target),
  saveFile: async (target, content, expectedHash) => {
    if (writeGate) await writeGate;
    if (hashOf(files.get(target)) !== expectedHash) throw conflictError();
    files.set(target, content);
    return documentOf(target);
  },
  isConflict: (error) => Boolean(error?.conflict),
  absolutePath: (rootPath, relative) => `${rootPath}/${relative}`,
  noteSaved: () => {},
  fileSaved: (rootPath, relative, document) =>
    globalThis.fileTest.emit("then-canvas-file-saved", { rootPath, path: relative, content: document.content, contentHash: document.contentHash ?? null }),
});
const onWriteFile = (request) => {
  writeRequests.push(structuredClone(request));
  return writeCanvasFile(host(), request);
};

const NOTE = "素材/汐見.md";
const NOTE_TEXT = "---\ntags: [人物]\n---\n本文の一行目\n";
const LAMP = "素材/灯.md";
const SCENE = "第一章/港.md";
const SCENE_TEXT = "---\nsynopsis: 港の場面\n---\n港の本文\n";
const projectFiles = [
  { path: NOTE, role: "note" },
  { path: LAMP, role: "note" },
  { path: SCENE, role: "manuscript" },
];
// 素材の画像（BINDER 4-3: バインダーから Canvas へ落とすと資料のカードになる）。
const MAP = "素材/地図.png";
const referenceFiles = [{ scope: "project", sourcePath: MAP, name: "地図.png", kind: "image", size: 1, imported: false }];
const fileNode = (id, file, x = 0) => ({ id, type: "file", file, x, y: 0, width: 300, height: 240 });
const boardA = () => ({
  nodes: [
    fileNode("f1", NOTE),
    fileNode("f2", SCENE, 400),
    fileNode("gone", "素材/消えた.md", 800),
    { id: "t1", type: "text", text: "カード", x: 0, y: 400, width: 260, height: 150 },
    // Obsidian で足したリンクのカード。Then は読めないが、消さずに書き戻す（確認1の 4）。
    { id: "l1", type: "link", url: "https://example.com", x: 400, y: 400, width: 200, height: 100 },
  ],
  edges: [{ id: "e1", fromNode: "f1", toNode: "l1" }],
  then: { version: 1, name: "A", scope: "project", updatedAt: 1 },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(0);
let root, props;
async function render() {
  await act(async () => {
    root.render(React.createElement(Canvas, props));
    await settle();
  });
  await act(async () => { await settle(); await settle(); });
}
async function mount({ embedded = true } = {}) {
  files = new Map([[abs(NOTE), NOTE_TEXT], [abs(LAMP), "灯の本文\n"], [abs(SCENE), SCENE_TEXT]]);
  docs = new Map([[boardKey(ROOT, "a"), boardA()],
    [boardKey(ROOT, "b"), { nodes: [fileNode("fb", NOTE)], edges: [], then: { version: 1, name: "B", updatedAt: 1 } }]]);
  calls = []; emitted = []; openTabs = new Map(); activeTab = null; writeRequests = []; openedFiles = []; writeGate = null;
  const payload = { requestId: `r${Date.now()}`, scope: "project", rootPath: ROOT, boardId: "a", workspaceName: "作品A",
    theme: "light", uiFontScale: 1, referenceFiles: [], projectFiles, openTabPaths: [] };
  props = embedded
    ? { embedded: true, embeddedPayload: payload, liveProjectFiles: projectFiles, liveOpenTabPaths: [],
      liveReferenceFiles: referenceFiles,
      onWriteFile, onOpenFile: (file) => openedFiles.push(file) }
    : {};
  if (!embedded) globalThis.fileTest.windowPayload = payload;
  root = createRoot(document.getElementById("root"));
  await render();
  await act(async () => { await sleep(20); });
}
async function unmount() { await act(async () => { root.unmount(); await settle(); }); }
const card = (id) => document.querySelector(`[data-node-id="${id}"]`);
const cardText = (id) => card(id)?.querySelector(".canvasFileText, textarea") ?? null;
const shown = (id) => { const element = cardText(id); return element?.value ?? element?.textContent; };
async function dblclick(id) {
  await act(async () => {
    card(id).dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await settle();
  });
}
async function type(id, text) {
  const area = card(id).querySelector("textarea");
  assert.ok(area, `${id} is being edited`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(area, text);
    area.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await settle();
  });
}
async function click(selector) {
  const element = typeof selector === "string" ? document.querySelector(selector) : selector;
  assert.ok(element, String(selector));
  await act(async () => { element.click(); await settle(); });
}
const buttonWithText = (text) => [...document.querySelectorAll("button")].find((button) => button.textContent.includes(text));
const waitWrites = () => act(async () => { await sleep(650); });
const savedBoard = (id = "a") => docs.get(boardKey(ROOT, id));

// ---- 1. 表示と、ボードに書くもの ----
await mount();
assert.equal(card("f1").querySelector("header span").textContent, "ノート");
assert.equal(card("f1").querySelector(".canvasFileTitle").textContent, "汐見");
assert.equal(shown("f1"), "本文の一行目\n", "ノートのカードはフロントマターを除いた本文を映す");
assert.equal(card("f2").querySelector("header span").textContent, "原稿");
assert.equal(shown("f2"), "港の場面", "原稿のカードは概要を映す");
assert.ok(card("gone").classList.contains("isMissing"), "一覧にないファイルのカードは薄く出す");
assert.equal(card("gone").querySelector(".canvasFileOpenButton"), null);
await dblclick("gone");
assert.equal(card("gone").querySelector("textarea"), null, "消えたファイルのカードは直せない");

await click('[aria-label="資料を追加"]');
await click(buttonWithText("灯"));
await act(async () => { await sleep(650); });
const added = savedBoard().nodes.find((node) => node.type === "file" && node.file === LAMP);
assert.ok(added, "資料を追加の一覧からノートを選ぶと、ファイルのカードを置く");
// Tauri へは JSON で渡るので、undefined の欄は書かれない。
assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(added))).sort(), ["file", "height", "id", "type", "width", "x", "y"],
  "ファイルのカードは場所だけを書く（中身・名前・ハッシュは書かない）");
const link = savedBoard().nodes.find((node) => node.id === "l1");
assert.deepEqual(link, boardA().nodes[4], "読めない種類のカードはそのまま書き戻す");
assert.ok(savedBoard().edges.some((edge) => edge.id === "e1"), "読めないカードにつながる線も残す");
assert.ok(savedBoard().nodes.some((node) => node.id === "gone"), "消えたファイルのカードも残す");
await act(async () => { await sleep(20); });
assert.equal(shown(added.id), "灯の本文\n", "置いたカードはファイルを読んで出す");
console.log("PASS show: note body, manuscript synopsis, missing file; placing writes only the location; unknown cards survive");

// ---- 1b. バインダーの行を落とす（BINDER 4-3）: ノートはファイルのカード、素材の画像は資料のカード ----
{
  const viewport = document.querySelector(".canvasViewport");
  assert.ok(viewport.hasAttribute("data-canvas-file-drop"), "埋め込みの Canvas はバインダーの行を受ける");
  const beforeIds = new Set(savedBoard().nodes.map((node) => node.id));
  await act(async () => {
    viewport.dispatchEvent(new dom.window.CustomEvent("then-canvas-file-drop", {
      detail: { paths: [abs(SCENE), abs(MAP)], clientX: 300, clientY: 200 },
    }));
    await settle();
  });
  await act(async () => { await sleep(650); });
  const nodes = savedBoard().nodes;
  assert.equal(nodes.length, beforeIds.size + 2, "落とした2つの行が、それぞれカードになる");
  const dropped = nodes.filter((node) => !beforeIds.has(node.id));
  assert.ok(dropped.some((node) => node.type === "file" && node.file === SCENE), "原稿はファイルのカード");
  const picture = dropped.find((node) => node.type !== "file");
  assert.ok(picture && JSON.stringify(picture).includes(MAP), "素材の画像は資料のカード");
  assert.equal(dropped.some((node) => node.type === "file" && node.file === MAP), false, "画像をファイルのカードにはしない");
}
console.log("PASS binder drop: a note or manuscript becomes a file card, a material image a reference card");

// ---- 2. ノートの本文の書き戻し ----
await dblclick("f1");
await type("f1", "直した本文\n");
assert.equal(writeRequests.length, 0, "0.5 秒たつまでは書かない");
await type("f1", "直した本文、二度目\n");
await waitWrites();
assert.equal(writeRequests.length, 1, "続けて直しても、書き戻しは1回にまとめる");
assert.equal(writeRequests[0].kind, "body");
assert.equal(writeRequests[0].base.contentHash, hashOf(NOTE_TEXT), "読んだときのハッシュを付ける");
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n直した本文、二度目\n", "フロントマターを残して本文だけ書く");
await type("f1", "三度目\n");
await waitWrites();
assert.equal(writeRequests.length, 2);
assert.equal(writeRequests[1].base.contentHash, hashOf("---\ntags: [人物]\n---\n直した本文、二度目\n"),
  "書けたあとは新しいハッシュが次の基準になる");
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n三度目\n");
assert.equal(document.querySelector(".canvasFileConflictModal"), null);
console.log("PASS note write-back: debounced once, front matter kept, read hash sent, next base follows the save");

// 書いているあいだに入れた編集は、書けたあとの中身を基準に書く（外の変更と取り違えない）。
writeGate = sleep(300);
await type("f1", "四度目\n");
await act(async () => { await sleep(550); });
await type("f1", "五度目\n");
await act(async () => { await sleep(900); });
writeGate = null;
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n五度目\n");
assert.equal(document.querySelector(".canvasFileConflictModal"), null, "自分の書き戻しを外の変更と取り違えない");
console.log("PASS note write-back: an edit made while a write is in flight is written on top of it");

// ---- 3. タブで開いているノートは表示だけ ----
openTabs.set(abs(NOTE), files.get(abs(NOTE)));
props = { ...props, liveOpenTabPaths: [NOTE] };
await render();
assert.ok(card("f1").classList.contains("isOpenInTab"));
assert.equal(card("f1").querySelector("textarea"), null, "タブで開いたら直せる状態を閉じる");
await dblclick("f1");
assert.equal(card("f1").querySelector("textarea"), null, "タブで開いているノートは直せない");
assert.deepEqual(openedFiles, [NOTE], "ダブルクリックでそのタブへ移る");
// タブ側で保存すると、カードの表示が新しくなる。
globalThis.fileTest.emit("then-canvas-file-saved", {
  rootPath: ROOT, path: NOTE, content: "---\ntags: [人物]\n---\nタブで直した\n", contentHash: "tab-hash",
});
await act(async () => { await sleep(20); });
assert.equal(shown("f1"), "タブで直した\n");
// 古い情報でカードから頼まれても、メイン画面はタブで開いていれば書かない。
const refused = await writeCanvasFile(host(), { rootPath: ROOT, path: NOTE, kind: "body", text: "x", base: documentOf(abs(NOTE)) });
assert.deepEqual(refused, { status: "open-in-tab" });
openTabs.delete(abs(NOTE));
files.set(abs(NOTE), "---\ntags: [人物]\n---\nタブで直した\n");
props = { ...props, liveOpenTabPaths: [] };
await render();
globalThis.fileTest.emit("then-canvas-file-saved", { rootPath: ROOT, path: NOTE, ...{ content: files.get(abs(NOTE)), contentHash: hashOf(files.get(abs(NOTE))) } });
await act(async () => { await sleep(20); });
await click(card("f1").querySelector(".canvasFileOpenButton"));
assert.deepEqual(openedFiles, [NOTE, NOTE], "「開く」でタブで開く");
await dblclick("f1");
assert.ok(card("f1").querySelector("textarea"), "タブを閉じれば、また直せる");
console.log("PASS open in tab: display only, double-click goes to the tab, tab saves refresh the card, main refuses stale requests");

// ---- 4. 原稿の概要 ----
await dblclick("f2");
assert.equal(card("f2").querySelector("textarea").getAttribute("aria-label"), "概要");
await type("f2", "新しい概要");
await waitWrites();
assert.equal(writeRequests.at(-1).kind, "synopsis");
assert.equal(files.get(abs(SCENE)), "---\nsynopsis: 新しい概要\n---\n港の本文\n", "タブで開いていなければファイルのフロントマターへ");
openTabs.set(abs(SCENE), files.get(abs(SCENE)));
activeTab = abs(SCENE);
props = { ...props, liveOpenTabPaths: [SCENE] };
await render();
await dblclick("f2");
assert.ok(card("f2").querySelector("textarea"), "原稿はタブで開いていても概要を直せる");
const fileBeforeTab = files.get(abs(SCENE));
await type("f2", "タブへ入る概要");
await waitWrites();
assert.equal(openTabs.get(abs(SCENE)), "---\nsynopsis: タブへ入る概要\n---\n港の本文\n", "開いているタブのフロントマターへ入れる");
assert.equal(files.get(abs(SCENE)), fileBeforeTab, "ファイルへはタブの保存が書く");
assert.equal(shown("f2"), "タブへ入る概要", "タブが保存するまで、直した概要を出しておく");
openTabs.delete(abs(SCENE));
activeTab = null;
props = { ...props, liveOpenTabPaths: [] };
await render();
console.log("PASS manuscript synopsis: file front matter when closed, the open tab's front matter when open");

// ---- 5. 外の変更 ----
files.set(abs(NOTE), "---\ntags: [外]\n---\n外のアプリで直した\n");
await dblclick("f1");
await type("f1", "カードで直した");
await waitWrites();
assert.equal(files.get(abs(NOTE)), "---\ntags: [外]\n---\n外のアプリで直した\n", "外で変わっていたら書かない");
assert.ok(document.querySelector(".canvasFileConflictModal"), "選ぶ画面を出す");
await click(buttonWithText("この内容で上書きする"));
await waitWrites();
assert.equal(files.get(abs(NOTE)), "---\ntags: [外]\n---\nカードで直した", "今のファイルの上に書く（今のフロントマターは残る）");
files.set(abs(NOTE), "---\ntags: [外]\n---\nまた外で\n");
await dblclick("f1");
await type("f1", "捨てる編集");
await waitWrites();
await click(buttonWithText("ファイルの内容を読み込む"));
await act(async () => { await sleep(20); });
assert.equal(files.get(abs(NOTE)), "---\ntags: [外]\n---\nまた外で\n");
assert.equal(shown("f1"), "また外で\n", "読み込むを選ぶと、カードはファイルの今の中身になる");
console.log("PASS external change: nothing written, choose overwrite (on the current file) or reload");

// ---- 6. 改名・移動 ----
globalThis.fileTest.emit("then-canvas-path-changes", { rootPath: ROOT, changes: [{ oldPath: LAMP, newPath: "素材/灯台.md" }] });
await act(async () => { await sleep(20); });
await dblclick("t1");
await act(async () => { await sleep(650); });
assert.ok(savedBoard().nodes.some((node) => node.type === "file" && node.file === "素材/灯台.md"), "改名でカードが付いていく");
console.log("PASS rename: file cards follow path changes");
await unmount();

// ---- 7. 書き切る所 ----
// ボードの切り替え: 書き戻してから次のボードを読む。
await mount();
await dblclick("f1");
await type("f1", "切り替え前");
await click('[aria-label="ボードを切り替え"]');
await click('.canvasBoardSelectButton[title="B"]');
await act(async () => { await sleep(20); });
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n切り替え前", "切り替える前に書き戻す");
const loadB = calls.findIndex((call) => call.command === "load_canvas_board" && call.boardId === "b");
assert.ok(loadB > calls.findIndex((call) => call.command === "read_text_file") && writeRequests.length === 1);
assert.equal(shown("fb"), "切り替え前", "次のボードの同じファイルのカードは、書いたあとの中身を出す");
await unmount();
assert.equal(writeRequests.length, 1);

// 閉じる（アンマウント）: 0.5 秒を待たずに書く。
await mount();
await dblclick("f1");
await type("f1", "閉じる直前");
await unmount();
await act(async () => { await sleep(20); });
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n閉じる直前", "Canvas を閉じても書き戻す");

// ゴミ箱: ボードを消しても、直した文章は捨てない。
await mount();
await dblclick("f1");
await type("f1", "ゴミ箱の前");
await click('[aria-label="ボードを切り替え"]');
await click('[aria-label="「A」をゴミ箱へ移動"]');
await click(buttonWithText("ゴミ箱へ移動"));
await act(async () => { await sleep(20); });
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\nゴミ箱の前");
assert.equal(docs.has(boardKey(ROOT, "a")), false);
await unmount();

// 送る: 書き戻してから読み、ファイルのカードは見えていた中身のテキストカードにして送る（確認1の 5）。
await mount();
await dblclick("f1");
await type("f1", "送る前");
await click('[aria-label="ボードを切り替え"]');
await click('[aria-label="「A」を移動・コピー"]');
await act(async () => { await sleep(20); });
await act(async () => {
  document.querySelector(".canvasRenameModal").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
});
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n送る前", "送る前に書き戻す");
const sent = [...docs].find(([id]) => JSON.parse(id)[0] === "/other")?.[1];
assert.ok(sent, "送り先にボードを作る");
const sentNote = sent.nodes.find((node) => node.id === "f1");
assert.deepEqual([sentNote.type, sentNote.title, sentNote.text], ["text", "汐見", "送る前"]);
const sentScene = sent.nodes.find((node) => node.id === "f2");
assert.deepEqual([sentScene.type, sentScene.title, sentScene.text], ["text", "港", "港の場面"]);
assert.ok(sent.nodes.some((node) => node.id === "l1"), "読めないカードも送る");
await unmount();
console.log("PASS flush points: board switch, unmount, trash and transfer write the card edits first");

// ---- 8. 閉じる前の書き切り（癖1）: 0.5 秒を待たずに、ボードと書き戻しの両方を書く ----
await mount();
await dblclick("f1");
await type("f1", "閉じる前の書き切り");
await dblclick("t1");
const textArea = card("t1").querySelector("textarea");
await act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(textArea, "カードも直した");
  textArea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await settle();
});
const savesBefore = calls.filter((call) => call.command === "save_canvas_board").length;
await act(async () => { await flushPendingSaves(); });
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n閉じる前の書き切り", "閉じる前の書き切りで書き戻す");
assert.ok(calls.filter((call) => call.command === "save_canvas_board").length > savesBefore, "ボードも書く");
assert.equal(savedBoard().nodes.find((node) => node.id === "t1").text, "カードも直した");
await unmount();
console.log("PASS before close: pending board save and card write-back are written without waiting 0.5 s");

// ---- 9. 別ウィンドウ: メイン画面に頼んで書き、閉じる前の知らせで書き切って答える ----
files = new Map([[abs(NOTE), NOTE_TEXT], [abs(LAMP), "灯の本文\n"], [abs(SCENE), SCENE_TEXT]]);
const mainSide = globalThis.fileTest.listen("then-canvas-file-write", async ({ payload }) => {
  writeRequests.push(structuredClone(payload.request));
  const result = await writeCanvasFile(host(), payload.request);
  globalThis.fileTest.emit("then-canvas-file-write-result", { requestId: payload.requestId, result }, "idea-canvas");
});
const originalInvoke = globalThis.fileTest.invoke;
globalThis.fileTest.invoke = async (command, args) =>
  command === "get_canvas_window_payload" ? structuredClone(globalThis.fileTest.windowPayload) : originalInvoke(command, args);
await mount({ embedded: false });
await dblclick("f1");
await type("f1", "別ウィンドウで直した");
globalThis.fileTest.emit("then-canvas-flush", { requestId: "close-1" }, "idea-canvas");
await act(async () => { await sleep(50); });
assert.equal(files.get(abs(NOTE)), "---\ntags: [人物]\n---\n別ウィンドウで直した", "メイン画面に頼んで書く");
assert.equal(writeRequests.at(-1).base.contentHash, hashOf(NOTE_TEXT));
assert.ok(emitted.some((item) => item.event === "then-canvas-flush-done" && item.payload.requestId === "close-1" && item.target === "main"),
  "書き切ったらメイン画面へ答える");
assert.ok(calls.some((call) => call.command === "finish_canvas_close_preparation"), "自分の窓の閉じる待ちにも答える");
assert.ok(emitted.some((item) => item.event === "then-canvas-file-write" && item.target === "main"), "書くのはメイン画面");
await unmount();
mainSide();
globalThis.fileTest.invoke = originalInvoke;
console.log("PASS separate window: write-back goes through the main window; the close flush answers both waits");

// ---- 10. 順番待ちそのもの ----
{
  const writes = [];
  let gate;
  const queue = new CanvasFileWriteQueue(async (request) => {
    writes.push(structuredClone(request));
    if (gate) await gate.promise;
    if (request.text === "fail") throw new Error("disk full");
    return { status: "saved", content: `saved:${request.text}`, contentHash: `hash:${request.text}` };
  });
  const base = { content: "c0", contentHash: "h0" };
  const outcomes = [];
  queue.subscribe((outcome) => outcomes.push(outcome.result.status));
  queue.enqueue({ rootPath: ROOT, path: NOTE, kind: "body", text: "one", base });
  queue.enqueue({ rootPath: ROOT, path: NOTE, kind: "body", text: "two", base });
  queue.enqueue({ rootPath: ROOT, path: NOTE, kind: "synopsis", text: "syn", base });
  await queue.flush();
  assert.deepEqual(writes.map((write) => write.text), ["two", "syn"], "同じファイル・種類は新しい中身で置き換える");
  assert.equal(writes[1].base.contentHash, "hash:two", "書けたら同じファイルの次の分の基準を新しくする");
  // 書いている途中に入った同じファイルの分は、書けたあとの中身へつなぐ。
  gate = Promise.withResolvers();
  queue.enqueue({ rootPath: ROOT, path: NOTE, kind: "body", text: "three", base });
  const flushing = queue.flush();
  await Promise.resolve(); await Promise.resolve();
  queue.enqueue({ rootPath: ROOT, path: NOTE, kind: "body", text: "four", base });
  gate.resolve(); gate = null;
  await flushing;
  assert.deepEqual(writes.slice(2).map((write) => [write.text, write.base.contentHash]), [["three", "h0"], ["four", "hash:three"]]);
  queue.enqueue({ rootPath: ROOT, path: LAMP, kind: "body", text: "fail", base });
  await assert.rejects(queue.flush(), /disk full/);
  assert.equal(queue.size, 1, "書けなかったものは残す");
  const unclaimed = new CanvasFileWriteQueue(async () => ({ status: "conflict", content: "x", contentHash: "y" }));
  unclaimed.enqueue({ rootPath: ROOT, path: NOTE, kind: "body", text: "lost?", base });
  await unclaimed.flush();
  const late = [];
  unclaimed.subscribe((outcome) => late.push(outcome.request.text));
  assert.deepEqual(late, ["lost?"], "聞く Canvas がいないあいだの外の変更は、次に聞いた Canvas に渡す");
  assert.deepEqual(outcomes, ["saved", "saved", "saved", "saved"], "書けたものは、すべて聞き手に知らせる");
}
assert.equal(canvasFileWriteQueue.size, 0, "テストの終わりに残った書き戻しはない");
console.log("PASS queue: coalesce per file and kind, hash hand-over, failures stay, unclaimed conflicts are kept");
