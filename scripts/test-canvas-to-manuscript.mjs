import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// BINDER 4-4「この順で原稿を作る」: 選んだカードの並べ方・名前・原稿の中身・置き換えと取り消し
// （docs/BINDER_CANVAS_TO_MANUSCRIPT_PLAN.md）。
const dir = path.resolve("test-artifacts/canvas-to-manuscript");
await mkdir(dir, { recursive: true });
const bundle = async (entry, name) => {
  await build({ entryPoints: [entry], outfile: path.join(dir, name), bundle: true, platform: "node", format: "esm", external: ["yaml"], logLevel: "silent" });
  return import(`${pathToFileURL(path.join(dir, name)).href}?${Date.now()}`);
};
const board = await bundle("src/canvasToManuscript.ts", "board.mjs");
const content = await bundle("src/canvasManuscriptContent.ts", "content.mjs");
const { readSynopsis } = await bundle("src/corkboard/synopsis.ts", "synopsis.mjs");
const { readProperties } = await bundle("src/properties/propertyModel.ts", "properties.mjs");
const { parseFrontMatter } = await bundle("src/utils/frontmatter.ts", "frontmatter.mjs");

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const text = (id, x, y, body, extra = {}) => ({ id, type: "text", x, y, width: 200, height: 120, text: body, ...extra });
const doc = (nodes, edges = []) => ({ nodes, edges, then: { version: 1, name: "潮待ち#1", updatedAt: 1 } });

test("対象: 選んだテキストカードと、選んだグループの中のカード。ファイル・資料のカードは入れない", () => {
  const nodes = [
    text("a", 0, 0, "A"),
    text("b", 1000, 0, "B"),
    text("c", 1050, 50, "C"),
    { id: "g", type: "group", x: 990, y: -10, width: 400, height: 400, label: "章" },
    { id: "f", type: "file", x: 1100, y: 100, width: 100, height: 100, file: "原稿/一.txt" },
    { id: "r", type: "reference", x: 0, y: 500, width: 100, height: 100, scope: "project", sourcePath: "x.png", name: "x", kind: "image" },
    text("d", 0, 900, "D"),
  ];
  const picked = board.manuscriptSourceCards(doc(nodes), ["a", "g", "f", "r", "b"]).map((card) => card.id);
  assert.deepEqual(picked.sort(), ["a", "b", "c"]);
});

test("名前: タイトル → 書き出しの1行（20文字）→ 空。ファイル名に使えない文字は除く", () => {
  assert.equal(board.cardManuscriptName({ title: " 第一場: 港 ", text: "本文" }), "第一場 港");
  assert.equal(board.cardManuscriptName({ title: "", text: "\n# 書庫に眠っていた未発送の手紙が、ある朝見つかる\n二行目" }), "書庫に眠っていた未発送の手紙が、ある朝見");
  assert.equal(board.cardManuscriptName({ text: "   \n  " }), "");
});

test("並び: 選んだカードどうしの矢印 → 上・左。空のカードは最初から除外", () => {
  const nodes = [text("a", 0, 0, "A"), text("b", 0, 300, "B"), text("c", 400, 0, "C"), text("e", 0, 600, " ")];
  const edges = [
    { id: "1", fromNode: "b", toNode: "a", connector: "arrow" },
    { id: "2", fromNode: "a", toNode: "x" },
  ];
  const capture = board.captureManuscriptCards(doc([...nodes, text("x", 0, -500, "X")], edges), nodes);
  assert.deepEqual(capture.order, ["c", "b", "a", "e"]);
  assert.deepEqual(capture.excluded, ["e"]);
  assert.deepEqual(board.orderedManuscriptCards({ ...capture, excluded: ["e", "c"] }, nodes).map((card) => card.id), ["b", "a"]);
});

test("置き換え: ID・位置・大きさ・色はそのまま、線も残る。縦書き・フォントの指定は落ちる", () => {
  const source = doc(
    [text("a", 10, 20, "A", { color: "3", writingMode: "vertical-rl", fontSource: "editor", title: "T" }), text("b", 0, 300, "B")],
    [{ id: "1", fromNode: "a", toNode: "b", connector: "arrow" }],
  );
  const result = board.convertCardsToFiles(source, [{ id: "a", file: "原稿/T.txt" }]);
  assert.deepEqual(result.board.nodes[0], { id: "a", type: "file", x: 10, y: 20, width: 200, height: 120, file: "原稿/T.txt", color: "3" });
  assert.equal(result.board.nodes[1], source.nodes[1]);
  assert.equal(result.board.edges, source.edges);
  assert.equal(result.cards[0].original, source.nodes[0]);
});

test("置き換え: 置き換えたカードを親にしていたスレッドの子は、その場に残してスレッドから外す（癖1）", () => {
  const source = doc([
    text("p", 0, 0, "親", { threadCollapsed: true }),
    text("c1", 0, 150, "子", { threadParentId: "p", threadOrder: 0 }),
    text("c2", 0, 300, "孫", { threadParentId: "c1", threadOrder: 0 }),
  ]);
  const result = board.convertCardsToFiles(source, [{ id: "p", file: "親.txt" }]);
  assert.equal(result.board.nodes[1].threadParentId, undefined);
  assert.equal("threadOrder" in result.board.nodes[1], false);
  assert.equal(result.board.nodes[2].threadParentId, "c1");
  assert.deepEqual(result.detached, [{ id: "c1", threadParentId: "p", threadOrder: 0 }]);
});

test("取り消し: 置き換えたままのファイルのカードだけをテキストに戻し、子をスレッドに付け直す", () => {
  const source = doc([
    text("p", 0, 0, "親", { color: "2" }),
    text("c1", 0, 150, "子", { threadParentId: "p", threadOrder: 1 }),
    text("q", 500, 0, "別"),
  ]);
  const made = board.convertCardsToFiles(source, [{ id: "p", file: "親.txt" }, { id: "q", file: "別.txt" }]);
  const conversion = { id: "v", boardId: "b", cards: made.cards, detached: made.detached };
  // 置き換えのあとで動かした・色を変えた・別の原稿へ付け替えたカード。
  const moved = {
    ...made.board,
    nodes: made.board.nodes.map((node) =>
      node.id === "p" ? { ...node, x: 99, color: undefined } : node.id === "q" ? { ...node, file: "ほか.txt" } : node),
  };
  const reverted = board.revertCardConversion(moved, conversion);
  const expected = { ...source.nodes[0], x: 99 };
  delete expected.color;
  assert.deepEqual(reverted.nodes[0], expected);
  assert.deepEqual(reverted.nodes[1], source.nodes[1]);
  assert.equal(reverted.nodes[2].type, "file");
  assert.equal(board.revertCardConversion(source, conversion), source);
  assert.equal(board.crossesConversion(made.board, source, conversion), true);
  assert.equal(board.crossesConversion(made.board, made.board, conversion), false);
});

test("概要: 改行は全角の空白にする（続く改行は1つ）", () => {
  assert.equal(content.synopsisFromCard("  一段落目。\n二行目。\r\n\r\n  三段落目。 \n"), "一段落目。　二行目。　三段落目。");
});

test("カードごとの原稿: 見出しと概要。概要はコルクボードと同じ読み方で読める。空なら概要なし", () => {
  const file = content.perCardManuscript("港の朝", "汐見が手紙を見つける。\n\n局長は黙っている。");
  assert.deepEqual(readSynopsis(file), { kind: "text", text: "汐見が手紙を見つける。　局長は黙っている。" });
  assert.equal(parseFrontMatter(file).body, "# 港の朝\n");
  assert.equal(content.perCardManuscript("空", "  "), "# 空\n");
  assert.deepEqual(readSynopsis(content.perCardManuscript("記号", "a: b # c")), { kind: "text", text: "a: b # c" });
});

test("1本の原稿: 空行で区切り、タイトルは ## 見出し。元のカードを一覧の順で書く", () => {
  const refs = [content.sourceCardRef("潮待ち#1", "a1"), content.sourceCardRef("潮待ち #1", "b2")];
  const file = content.joinedManuscript("第一章", [{ title: "港", text: "朝。\n\n波。" }, { text: "夜。" }, { title: "", text: "  " }], refs);
  const parts = parseFrontMatter(file);
  assert.equal(parts.body, "# 第一章\n\n## 港\n\n朝。\n\n波。\n\n夜。\n");
  const row = readProperties(parts.metadata).rows.find((item) => item.key === "sourceCards");
  assert.deepEqual(row.value, ["潮待ち#1#a1", "潮待ち #1#b2"], "ボード名に # や空白があっても、そのまま読める");
});

// ---- メイン画面の処理（canvasManuscriptActions.ts）を、入れ物の deps で動かす ----
const { createCanvasManuscriptActions } = await bundle("src/canvasManuscriptActions.ts", "actions.mjs");
const ROOT = "/work";
const hashOf = (value) => `h${[...value].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) >>> 0, 7)}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function host({ failOn = null } = {}) {
  const files = new Map([["/work/第一章/既存.txt", "# 既存\n"]]);
  const log = { orders: [], toasts: [], trashed: [], opened: [], refreshed: 0, reverts: [] };
  const state = { dirty: new Set(), active: "/work/第一章/既存.txt", revert: true };
  const doc = (filePath) => ({ path: filePath, name: filePath.split("/").pop(), content: files.get(filePath), contentHash: hashOf(files.get(filePath)) });
  const tree = () => ({
    path: ROOT, name: "作品", children: [{
      path: "/work/第一章", name: "第一章", kind: "folder",
      children: [...files.keys()].filter((filePath) => filePath.startsWith("/work/第一章/"))
        .map((filePath) => ({ path: filePath, name: filePath.split("/").pop(), kind: "file", children: [] })),
    }],
  });
  const deps = {
    projectFolder: tree(),
    absolutePath: (root, relative) => `${root}/${relative}`,
    createFile: async (folder, name) => {
      if (failOn && name === failOn) throw new Error("disk full");
      const stem = name.replace(/\.(txt|md)$/i, "");
      let filePath = `${folder}/${stem}.txt`;
      for (let index = 2; files.has(filePath); index += 1) filePath = `${folder}/${stem}-${index}.txt`;
      files.set(filePath, `# ${filePath.split("/").pop().replace(/\.txt$/, "")}\n`);
      return doc(filePath);
    },
    saveFile: async (filePath, value, expected) => {
      if (hashOf(files.get(filePath)) !== expected) throw new Error("conflict");
      files.set(filePath, value);
      return doc(filePath);
    },
    readFile: async (filePath) => {
      if (!files.has(filePath)) throw new Error("not found");
      return doc(filePath);
    },
    saveOrder: async (root, folder, paths) => { log.orders.push({ root, folder, paths }); },
    refreshProjectFolder: async () => { log.refreshed += 1; deps.projectFolder = tree(); return deps.projectFolder; },
    openFile: async (filePath) => { log.opened.push(filePath); state.active = filePath; },
    activeFilePath: () => state.active,
    isFileDirty: (filePath) => state.dirty.has(filePath),
    trashFile: async (filePath) => { log.trashed.push(filePath); files.delete(filePath); return true; },
    showToast: (message, action) => log.toasts.push({ message, action }),
    revertOnCanvas: async (id) => { log.reverts.push(id); return state.revert; },
  };
  return { files, log, state, actions: createCanvasManuscriptActions({ current: deps }) };
}
const cardsRequest = (cards, conversionId = "v1") => ({ kind: "cards", rootPath: ROOT, folder: "第一章", conversionId, cards });

test("メイン画面: カードごとに原稿を作り、中身を書き、フォルダの後ろに一覧の順で並べる", async () => {
  const { files, log, actions } = host();
  const result = await actions.handle(cardsRequest([
    { id: "a", name: "港", text: "朝。\n\n波。" }, { id: "b", name: "既存", text: "" }, { id: "c", name: "港", text: "夜" },
  ]));
  assert.deepEqual(result, { kind: "cards", failed: [], made: [
    { id: "a", path: "第一章/港.txt" }, { id: "b", path: "第一章/既存-2.txt" }, { id: "c", path: "第一章/港-2.txt" }] });
  assert.equal(files.get("/work/第一章/港.txt"), "---\nsynopsis: 朝。　波。\n---\n# 港\n");
  assert.equal(files.get("/work/第一章/既存-2.txt"), "# 既存\n", "同じ名前は「-2」、見出しはカードの名前");
  assert.equal(files.get("/work/第一章/港-2.txt"), "---\nsynopsis: 夜\n---\n# 港\n");
  assert.deepEqual(log.orders, [{ root: ROOT, folder: "/work/第一章",
    paths: ["/work/第一章/既存.txt", "/work/第一章/港.txt", "/work/第一章/既存-2.txt", "/work/第一章/港-2.txt"] }]);
  assert.ok(log.refreshed >= 1);
  assert.equal(log.toasts.at(-1).message, "原稿を 3 本作りました");
  assert.equal(log.toasts.at(-1).action.label, "元に戻す");
  assert.deepEqual(log.opened, [], "カードごとでは原稿を開かない");
});

test("メイン画面: 途中で作れなかったカードは failed にし、作れた分だけ返す", async () => {
  const { files, log, actions } = host({ failOn: "壊" });
  const result = await actions.handle(cardsRequest([{ id: "a", name: "一", text: "" }, { id: "x", name: "壊", text: "" }, { id: "b", name: "二", text: "" }]));
  assert.deepEqual(result.failed, ["x"]);
  assert.deepEqual(result.made.map((item) => item.id), ["a", "b"]);
  assert.equal([...files.keys()].filter((filePath) => filePath.includes("壊")).length, 0);
  assert.equal(log.toasts.at(-1).message, "原稿を 2 本作りました");
});

test("メイン画面: Ctrl+Z から。作ったままの原稿だけゴミ箱へ。2回目と通知からは何もしない", async () => {
  const { files, log, state, actions } = host();
  await actions.handle(cardsRequest([{ id: "a", name: "一", text: "" }, { id: "b", name: "二", text: "" }, { id: "c", name: "三", text: "" }]));
  files.set("/work/第一章/二.txt", "# 二\n書き足した\n");
  state.dirty.add("/work/第一章/三.txt");
  const undo = await actions.handle({ kind: "undo", rootPath: ROOT, conversionId: "v1" });
  assert.deepEqual(undo, { kind: "undo", done: true, trashed: 1, kept: 2 });
  assert.deepEqual(log.trashed, ["/work/第一章/一.txt"]);
  assert.match(log.toasts.at(-1).message, /原稿 2 本は書き足してあるので残しました/);
  assert.deepEqual(await actions.handle({ kind: "undo", rootPath: ROOT, conversionId: "v1" }), { kind: "undo", done: false, trashed: 0, kept: 0 });
  log.toasts.find((item) => item.action).action.onClick();
  await tick();
  assert.deepEqual(log.reverts, [], "Canvas で戻したあとの通知の「元に戻す」は、キャンバスに頼まない");
  assert.deepEqual(log.trashed, ["/work/第一章/一.txt"]);
});

test("メイン画面: 通知から。キャンバスで外せたときだけゴミ箱へ。外せなければ何も消さない", async () => {
  const { log, state, actions } = host();
  await actions.handle(cardsRequest([{ id: "a", name: "一", text: "" }]));
  state.revert = false;
  log.toasts.at(-1).action.onClick();
  await tick();
  assert.deepEqual(log.reverts, ["v1"]);
  assert.deepEqual(log.trashed, []);
  assert.equal(log.toasts.at(-1).message, "Canvas でそのボードを開いていないため、元に戻せませんでした");
  state.revert = true;
  log.toasts.find((item) => item.action).action.onClick();
  await tick();
  assert.deepEqual(log.trashed, ["/work/第一章/一.txt"], "外せなかったあとは、もう一度押せる");
  assert.equal(log.toasts.at(-1).message, "カードを元に戻し、原稿 1 本をゴミ箱へ移しました");
  assert.deepEqual(await actions.handle({ kind: "undo", rootPath: ROOT, conversionId: "v1" }), { kind: "undo", done: false, trashed: 0, kept: 0 },
    "通知から戻したあとの Ctrl+Z では、もう消さない");
});

test("メイン画面: 1本につなげる。原稿を開き、通知の「元に戻す」で作る前のファイルへ戻ってからゴミ箱へ", async () => {
  const { files, log, actions } = host();
  const result = await actions.handle({ kind: "joined", rootPath: ROOT, folder: "第一章", name: "第一章の稿", boardName: "潮待ち",
    cards: [{ id: "a1", title: "港", text: "朝。" }, { id: "b2", text: "夜。" }] });
  assert.deepEqual(result, { kind: "joined", path: "第一章/第一章の稿.txt" });
  assert.equal(files.get("/work/第一章/第一章の稿.txt"),
    "---\nsourceCards:\n  - 潮待ち#a1\n  - 潮待ち#b2\n---\n# 第一章の稿\n\n## 港\n\n朝。\n\n夜。\n");
  assert.deepEqual(log.opened, ["/work/第一章/第一章の稿.txt"]);
  assert.equal(log.toasts.at(-1).message, "原稿「第一章の稿」を作りました");
  log.toasts.at(-1).action.onClick();
  await tick();
  assert.deepEqual(log.opened, ["/work/第一章/第一章の稿.txt", "/work/第一章/既存.txt"]);
  assert.deepEqual(log.trashed, ["/work/第一章/第一章の稿.txt"]);
  assert.equal(log.toasts.at(-1).message, "原稿「第一章の稿」をゴミ箱へ移しました");
});

test("メイン画面: 1本の原稿に書き足してあれば、通知の「元に戻す」でも残す", async () => {
  const { files, log, actions } = host();
  await actions.handle({ kind: "joined", rootPath: ROOT, folder: "", name: "稿", boardName: "B", cards: [{ id: "a", text: "x" }] });
  files.set("/work/稿.txt", `${files.get("/work/稿.txt")}書き足し\n`);
  log.toasts.at(-1).action.onClick();
  await tick();
  assert.deepEqual(log.trashed, []);
  assert.equal(log.toasts.at(-1).message, "原稿「稿」は書き足してあるので残しました");
});

test("メイン画面: 開いていない作品の頼みは断る", async () => {
  const { actions } = host();
  await assert.rejects(actions.handle({ ...cardsRequest([]), rootPath: "/other" }), /この作品を開いていない/);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`NG   ${name}`);
    console.log(error);
  }
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);
