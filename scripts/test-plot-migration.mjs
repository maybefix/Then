import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

// Plot → ノート「プロット（移行）」（BINDER 1-6、docs/BINDER_PLOT_MIGRATION_PLAN.md）。
// 1-3 の見本データを Rust が返す値（expected/rust-reads.json）のまま移行の処理に通し、できたノートの文字を
// 見出し・番号・本文・資料リンクへ読み戻して、移行の前の見え方（expected/plot.json）と1件ずつ比べる。

const fixture = path.join("scripts", "fixtures", "binder-migration");
const readJson = (file) => JSON.parse(readFileSync(path.join(fixture, "expected", file), "utf8"));
const works = readJson("rust-reads.json").works;
const expectedPlot = readJson("plot.json");

const bundled = await build({
  stdin: {
    contents: 'export * from "./src/plotMigration.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;

const calls = [];
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "load_project_plot_cards") {
        const answer = works[args.rootPath]?.plotCards;
        if (!Array.isArray(answer)) throw new Error(`${args.rootPath}: cannot read`);
        return structuredClone(answer);
      }
      if (command === "migrate_project_plot_to_note") return { status: "migrated", notePath: "素材/プロット（移行）.md" };
      throw new Error(`unexpected command ${command}`);
    },
    transformCallback: () => 0,
  },
};

const { PLOT_MIGRATION_NOTE_NAME, migrateWorkspacePlotToNote, plotCardsToNote } = await import(moduleUrl);
const links = (body) => [...body.matchAll(/@\[\[([^\]]+)\]\]/g)].map((match) => match[1]);

/** ノートの文字を、カードの見え方へ読み戻す（移行の書き方の逆）。 */
function readNote(note) {
  assert.ok(note.endsWith("\n"), "the note ends with a newline");
  return note
    .slice(0, -1)
    .split(/\n\n(?=#{1,2} )/)
    .map((block) => {
      const newline = block.indexOf("\n");
      const heading = newline < 0 ? block : block.slice(0, newline);
      const body = newline < 0 ? "" : block.slice(newline + 1);
      const chapter = /^# (.*)$/.exec(heading);
      if (chapter) return { kind: "chapter", num: "", title: chapter[1], body, links: links(body) };
      const section = /^## (\d+)(?: (.*))?$/.exec(heading);
      assert.ok(section, `a heading of the note is a chapter or a numbered section: ${heading}`);
      return { kind: "section", num: section[1], title: section[2] ?? "", body, links: links(body) };
    });
}

const workNames = { "": "（ライブラリの直下）" };
const label = (rootPath) => workNames[rootPath] ?? rootPath;
let compared = 0;
for (const rootPath of Object.keys(works)) {
  const name = label(rootPath);
  const before = expectedPlot[name];
  if (!Array.isArray(works[rootPath].plotCards)) {
    assert.equal(before, undefined, `${name}: a work Rust cannot read has no baseline`);
    continue;
  }
  calls.length = 0;
  const result = await migrateWorkspacePlotToNote(rootPath);
  if (before.length === 0) {
    assert.deepEqual(result, { status: "empty" }, `${name}: an empty Plot makes no note`);
    assert.deepEqual(calls.map((call) => call.command), ["load_project_plot_cards"], `${name}: nothing is written`);
    continue;
  }
  assert.equal(result.status, "migrated");
  const migrate = calls.find((call) => call.command === "migrate_project_plot_to_note");
  assert.ok(migrate, `${name}: the note is handed to Rust`);
  assert.equal(migrate.args.rootPath, rootPath);
  assert.equal(migrate.args.noteName, "プロット（移行）");
  assert.deepEqual(migrate.args.expectedPlotCards, works[rootPath].plotCards, `${name}: the stored cards go back unchanged`);

  // 題が空の章だけは、見出しに「無題の章」を書く（確認1の 6）。それ以外は見え方と1文字も違わない。
  const expected = before.map((card) =>
    card.kind === "chapter" && card.title === "" ? { ...card, title: "無題の章" } : card,
  );
  assert.deepEqual(readNote(migrate.args.noteText), expected, `${name}: the note reads back as the Plot that was shown`);
  const bodyChars = before.reduce((sum, card) => sum + card.body.length + card.title.length, 0);
  assert.ok(migrate.args.noteText.length > bodyChars, `${name}: every title and body character is in the note`);
  compared += 1;
}
assert.equal(compared, 4, "作品A・作品B・作品E・ライブラリ直下 are migrated; 作品C・作品D are empty");

// 見本 作品A のノートの文字そのもの（手順書の工程2の2）。
calls.length = 0;
await migrateWorkspacePlotToNote("作品A");
const workA = calls.find((call) => call.command === "migrate_project_plot_to_note").args.noteText;
assert.equal(
  workA,
  [
    "# 第一章　港町",
    "",
    "## 001 港に着く",
    "主人公が港に着く。@[[第一章/a.md]] を見ながら書く。",
    "",
    "## 003 坂の上の家",
    "地図は @[[.then/references/imports/map (2).png]]。",
    "二行目の本文。",
    "",
    "# 無題の章",
    "",
    "## 004",
    "題のないセクション。@[[.then/references/imports/資料a.md]] と @[[.then/references/imports/資料a.md]] を二度参照する。@[[消した資料.md]] は行き先がない",
    "",
  ].join("\n"),
);

assert.equal(PLOT_MIGRATION_NOTE_NAME, "プロット（移行）");
assert.equal(plotCardsToNote([]), null, "no cards, no note");
assert.equal(
  plotCardsToNote([{ id: "x", kind: "section", num: "007", title: "題", body: "一行目\n\n三行目", expanded: false, managerCollapsed: false }]),
  "## 007 題\n一行目\n\n三行目\n",
  "blank lines inside a body are kept",
);

console.log("PASS plot migration: the note reads back as expected/plot.json for every fixture work");
