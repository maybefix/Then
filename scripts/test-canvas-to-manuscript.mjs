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
  const refs = [content.sourceCardRef("潮待ち#1", "a1"), content.sourceCardRef("潮待ち#1", "b2")];
  const file = content.joinedManuscript("第一章", [{ title: "港", text: "朝。\n\n波。" }, { text: "夜。" }, { title: "", text: "  " }], refs);
  const parts = parseFrontMatter(file);
  assert.equal(parts.body, "# 第一章\n\n## 港\n\n朝。\n\n波。\n\n夜。\n");
  const row = readProperties(parts.metadata).rows.find((item) => item.key === "sourceCards");
  assert.deepEqual(row.value, ["潮待ち#1#a1", "潮待ち#1#b2"]);
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
