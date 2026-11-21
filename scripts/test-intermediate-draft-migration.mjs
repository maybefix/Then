import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// 中間稿 → 素材のノート（BINDER 4-4b、docs/BINDER_INTERMEDIATE_DRAFT_RETIRE_PLAN.md）の画面の側。
// 終了前の一時保存（localStorage）からその作品の分だけを拾って Rust へ渡すこと、移せたらそのキーを消すこと、
// 失敗してもほかの作品を止めないこと、通知の文、起動時の移行の並び（Plot → Idea → 中間稿）を確かめる。
// ファイルの読み書きは Rust のテスト（intermediate_draft_migration/tests.rs）が確かめる。

const bundled = await build({
  stdin: { contents: 'export * from "./src/intermediateDraftMigration.ts";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "esm", platform: "neutral", write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;

class MemoryStorage {
  constructor(entries = {}) { this.map = new Map(Object.entries(entries)); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const calls = [];
let failFor = new Set();
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push({ command, args: structuredClone(args) });
      if (command !== "migrate_intermediate_drafts") throw new Error(`unexpected command ${command}`);
      if (failFor.has(args.rootPath)) throw new Error(`${args.rootPath}: cannot write`);
      if (args.rootPath.endsWith("empty")) return { status: "empty", notes: [] };
      return { status: "migrated", notes: [`素材/${args.rootPath.split(/[\\/]/).pop()}の中間稿.md`], backupPath: ".then/backups/x" };
    },
  },
};

const { draftRecoveriesFor, migrateIntermediateDrafts, draftMigrationMessage } = await import(moduleUrl);

const recoveryKey = (label, rootPath, boardId) =>
  `then.draft-recovery.${label}.${JSON.stringify(["project", rootPath, boardId])}`;
const entry = (texts) => JSON.stringify({ expectedRevision: 1, history: { schemaVersion: 1, boardId: "b", revision: 1,
  versions: texts.map((text, index) => ({ version: index + 1, text })) } });

// 1. この作品の分だけを拾う（区切りと大文字小文字は問わない）。版の中でいちばん新しい本文を渡す。
{
  const storage = new MemoryStorage({
    [recoveryKey("main", "C:\\Lib\\作品A", "harbor")]: entry(["古い", "新しい"]),
    [recoveryKey("canvas-1", "c:/lib/作品a/", "night")]: entry(["夜"]),
    [recoveryKey("main", "C:\\Lib\\作品B", "other")]: entry(["別の作品"]),
    [recoveryKey("main", "C:\\Lib\\作品A", "broken")]: "{ not json",
    "then.draft-recovery.main.not-a-target": entry(["読めない"]),
    "then.canvas-board.project.x": "{}",
  });
  const found = draftRecoveriesFor("C:\\Lib\\作品A", storage);
  assert.deepEqual(found.map((item) => [item.boardId, item.text]), [["harbor", "新しい"], ["night", "夜"], ["broken", ""]]);
  assert.equal(found[0].raw.expectedRevision, 1, "一時保存の中身はそのまま（バックアップ用）");
  assert.equal(found[2].raw, "{ not json", "読めない一時保存も本文なしで渡し、バックアップに残す");
  console.log("PASS recoveries: only this work, newest version text, broken entries kept for the backup");
}

// 2. 移せたらキーを消す。失敗した作品のキーは残す。同じパスは1回だけ。1つの失敗はほかを止めない。
{
  calls.length = 0;
  failFor = new Set(["C:\\Lib\\作品B"]);
  const storage = new MemoryStorage({
    [recoveryKey("main", "C:\\Lib\\作品A", "harbor")]: entry(["港"]),
    [recoveryKey("main", "C:\\Lib\\作品B", "other")]: entry(["別"]),
    "unrelated": "keep",
  });
  const summary = await migrateIntermediateDrafts(["C:\\Lib\\作品A", "C:\\Lib\\作品B", "c:/lib/作品a", "C:\\Lib\\empty", "C:\\Lib\\作品C"], storage);
  assert.deepEqual(calls.map((call) => call.args.rootPath), ["C:\\Lib\\作品A", "C:\\Lib\\作品B", "C:\\Lib\\empty", "C:\\Lib\\作品C"]);
  assert.deepEqual(calls[0].args.recoveries, [{ boardId: "harbor", text: "港", raw: JSON.parse(entry(["港"])) }]);
  assert.deepEqual(calls[3].args.recoveries, []);
  assert.deepEqual(summary.migrated, ["C:\\Lib\\作品A", "C:\\Lib\\作品C"]);
  assert.deepEqual(summary.notes, ["素材/作品Aの中間稿.md", "素材/作品Cの中間稿.md"]);
  assert.equal(summary.failed.length, 1);
  assert.equal(storage.getItem(recoveryKey("main", "C:\\Lib\\作品A", "harbor")), null, "移せた作品の一時保存は消える");
  assert.notEqual(storage.getItem(recoveryKey("main", "C:\\Lib\\作品B", "other")), null, "失敗した作品の一時保存は残る");
  assert.equal(storage.getItem("unrelated"), "keep");
  failFor = new Set();
  console.log("PASS migrate: recoveries sent and cleared on success, kept on failure, each path once, failures do not stop the rest");
}

// 3. 通知の文。
{
  const base = { migrated: [], notes: [], failed: [] };
  assert.equal(draftMigrationMessage(base), null);
  assert.equal(draftMigrationMessage({ ...base, migrated: ["a"] }), null, "ノートができなければ（空の稿だけ）知らせない");
  assert.equal(draftMigrationMessage({ ...base, migrated: ["a"], notes: ["素材/港の中間稿.md"] }), "中間稿をノート「港の中間稿」に移しました");
  assert.equal(draftMigrationMessage({ ...base, migrated: ["a", "b"], notes: ["a.md", "b.md", "c.md"] }), "中間稿を3本のノートに移しました");
  assert.equal(draftMigrationMessage({ ...base, notes: ["a.md"], failed: [{ rootPath: "x", error: "e" }] }), "中間稿をノートに移せませんでした");
  console.log("PASS message: one note by name, several by count, failures say so");
}

// 4. 起動時と作品を開いたときの移行は Plot → Idea → 中間稿の順で、通知は1つにまとめる。
{
  const app = readFileSync("src/App.tsx", "utf8");
  const start = app.indexOf("const migratePlotBeforeOpening = async");
  const end = app.indexOf("const restoreWorkspaceFromState", start);
  const body = app.slice(start, end);
  const order = ["migratePlotToNotes(rootPaths)", "migrateIdeas(rootPaths, profile)", "migrateIntermediateDrafts(rootPaths)"]
    .map((call) => body.indexOf(call));
  assert.ok(order.every((index) => index > 0) && order[0] < order[1] && order[1] < order[2], "Plot → Idea → 中間稿の順に移す");
  assert.match(body, /\[plotMigrationMessage\(summary\), ideaMigrationMessage\(ideas\), draftMigrationMessage\(drafts\)\]/);
  assert.match(body, /\|\| drafts\.migrated\.length > 0;/, "移したらファイル一覧を読み直す");
  console.log("PASS order: plot, ideas, then drafts, one toast");
}
