import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// コピーのカード → ノートのカード（BINDER 4-5、docs/BINDER_COPY_CARD_MIGRATION_PLAN.md）の画面の側。
// 作品ごとに Rust を呼ぶこと、1つの失敗はほかを止めないこと、通知の文、Rust が書く形のファイルのカードを Canvas が
// ファイルのカードとして読むこと、起動時と作品を開いたときの移行の並び（Plot → Idea → 中間稿 → コピーのカード）と
// 通知が1つであることを確かめる。ボードの読み書きは Rust のテスト（copy_card_migration/tests.rs）が確かめる。

const bundle = async (entry) => {
  const bundled = await build({
    stdin: { contents: `export * from "./${entry}";`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
};

const calls = [];
let failFor = new Set();
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push({ command, args: structuredClone(args) });
      if (command !== "migrate_copy_cards") throw new Error(`unexpected command ${command}`);
      if (failFor.has(args.rootPath)) throw new Error(`${args.rootPath}: cannot write`);
      if (args.rootPath.endsWith("empty")) return { status: "empty", replaced: 0, boards: [] };
      // 作品C は投稿のカードを1枚含む（docs/BINDER_POST_CARD_PLAN.md）。
      const posts = args.rootPath.endsWith("作品C") ? 1 : 0;
      return { status: "migrated", replaced: 2, posts, boards: ["harbor", "night"], backupPath: ".then/backups/copy-cards-x" };
    },
  },
};

const { migrateCopyCards, copyCardMigrationMessage } = await bundle("src/copyCardMigration.ts");

// 1. 作品ごとに1回ずつ呼ぶ（区切りと大文字小文字は問わない）。1つの失敗はほかを止めない。
{
  failFor = new Set(["C:\\Lib\\作品B"]);
  const summary = await migrateCopyCards(["C:\\Lib\\作品A", "c:/lib/作品a/", "C:\\Lib\\作品B", "C:\\Lib\\empty", "C:\\Lib\\作品C"]);
  assert.deepEqual(calls.map((call) => call.args.rootPath), ["C:\\Lib\\作品A", "C:\\Lib\\作品B", "C:\\Lib\\empty", "C:\\Lib\\作品C"]);
  assert.deepEqual(calls[0].args, { rootPath: "C:\\Lib\\作品A" });
  assert.deepEqual(summary.migrated, [
    { rootPath: "C:\\Lib\\作品A", boards: ["harbor", "night"] },
    { rootPath: "C:\\Lib\\作品C", boards: ["harbor", "night"] },
  ]);
  assert.equal(summary.replaced, 4);
  assert.equal(summary.posts, 1, "post cards are counted across works");
  assert.deepEqual(summary.failed.map((item) => item.rootPath), ["C:\\Lib\\作品B"]);
  console.log("PASS migrate: each path once, boards to read again, failures do not stop the rest");
}

// 2. 通知の文。置き換えがなければ出さない。
{
  assert.equal(copyCardMigrationMessage({ migrated: [], replaced: 0, failed: [] }), null);
  assert.equal(copyCardMigrationMessage({ migrated: [{ rootPath: "a", boards: ["b"] }], replaced: 1, failed: [] }),
    "コピーのカード1枚をノートのカードに置き換えました");
  assert.equal(copyCardMigrationMessage({ migrated: [{ rootPath: "a", boards: ["b"] }], replaced: 3, failed: [] }),
    "コピーのカード3枚をノートのカードに置き換えました");
  // 投稿のカード（docs/BINDER_POST_CARD_PLAN.md の確認1の 4）。投稿だけなら投稿、両方ならノートと投稿。
  assert.equal(copyCardMigrationMessage({ migrated: [{ rootPath: "a", boards: ["b"] }], replaced: 2, posts: 2, failed: [] }),
    "コピーのカード2枚を投稿のカードに置き換えました");
  assert.equal(copyCardMigrationMessage({ migrated: [{ rootPath: "a", boards: ["b"] }], replaced: 3, posts: 1, failed: [] }),
    "コピーのカード3枚をノートと投稿のカードに置き換えました");
  assert.equal(copyCardMigrationMessage({ migrated: [{ rootPath: "a", boards: ["b"] }], replaced: 3, posts: 0, failed: [] }),
    "コピーのカード3枚をノートのカードに置き換えました");
  assert.equal(copyCardMigrationMessage({ migrated: [], replaced: 0, failed: [{ rootPath: "a", error: "x" }] }),
    "コピーのカードを置き換えられませんでした");
  console.log("PASS message: count of replaced cards, nothing when none, failures say so");
}

// 3. Rust が書く形（copy_card_migration.rs の file_node）を、Canvas はファイルのカードとして読み、線も残す。
{
  const { normalizeCanvasDocument } = await bundle("src/canvasTypes.ts");
  const written = {
    nodes: [
      { id: "c1", type: "file", x: 10, y: 20, width: 260, height: 150, file: "素材/場面： 港.md", color: "3" },
      { id: "child", type: "text", x: 10, y: 200, width: 260, height: 150, text: "港の補足" },
      { id: "plain", type: "text", x: 400, y: 20, width: 260, height: 150, text: "ふつうのカード" },
    ],
    edges: [{ id: "e1", fromNode: "c1", toNode: "plain", connector: "arrow" }],
    then: { version: 1, name: "harbor", updatedAt: 1 },
  };
  const board = normalizeCanvasDocument(written, "harbor", "project");
  assert.deepEqual(JSON.parse(JSON.stringify(board.nodes[0])), { id: "c1", type: "file", x: 10, y: 20, width: 260, height: 150, file: "素材/場面： 港.md", color: "3" });
  assert.equal(board.nodes[1].threadParentId, undefined);
  assert.equal(board.edges.length, 1);
  assert.equal(board.edges[0].fromNode, "c1");
  console.log("PASS shape: the card Rust writes is read back as the same file card with its arrow");
}

// 4. 起動時と作品を開いたときの移行は Plot → Idea → 中間稿 → コピーのカードの順。Canvas の保存を先に書き切り、
//    書き換えたボードを知らせる。通知は1つにまとめ、ファイルは増えないので一覧は読み直さない。
{
  const app = readFileSync("src/App.tsx", "utf8");
  const start = app.indexOf("const migratePlotBeforeOpening = async");
  const end = app.indexOf("const restoreWorkspaceFromState", start);
  const body = app.slice(start, end);
  const order = ["migratePlotToNotes(rootPaths)", "migrateIdeas(rootPaths, profile)", "migrateIntermediateDrafts(rootPaths)",
    "flushCanvasWindow(1500)", "migrateCopyCards(rootPaths)", "emit(CANVAS_BOARDS_REWRITTEN_EVENT"].map((call) => body.indexOf(call));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || order[i - 1] < index)), `順: ${order}`);
  assert.match(body, /draftMigrationMessage\(drafts\),\s*copyCardMigrationMessage\(cards\)\]\.filter\(Boolean\)\.join\("。"\)/);
  assert.equal((body.match(/showToast\(/g) ?? []).length, 1, "通知は1つ");
  assert.doesNotMatch(body.slice(body.lastIndexOf("return ")), /cards\./, "ファイルの一覧は読み直さない");
  console.log("PASS order: plot, ideas, drafts, then copy cards after flushing the Canvas; one toast");
}
// 5. 置き換えたファイルのカードも、テキストカードと同じ色で出す（4-5 の実機確認で見つけた癖1）。
{
  const css = readFileSync("src/components/canvas/canvas.css", "utf8");
  assert.match(css, /:is\(\.canvasTextNode, \.canvasFileNode\)\[data-color\] \{[^}]*background:[^}]*--canvas-card-color/, "色の地と枠をファイルのカードにも当てる");
  for (let color = 1; color <= 6; color += 1) {
    const rule = new RegExp(`\\.canvasFileNode\\[data-color="${color}"\\][^{]*\\{\\s*--canvas-card-color: #[0-9a-f]{6};`);
    assert.match(css, rule, `色 ${color} の値をファイルのカードにも渡す`);
  }
  console.log("PASS colour: file cards take the same six colours as text cards");
}
