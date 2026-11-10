import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

// Plot と Idea の移行（BINDER 1-6・2-4）の前後比較に使う「移行の前の姿」を確かめる
// （docs/PLOT_IDEA_BASELINE_PLAN.md）。見本データ scripts/fixtures/binder-migration を、作品を開いたときと
// 同じ順に今の処理へ通し、利用者に見えているもの（見え方の写し）を expected/*.json と比べる。
// Rust の命令の答えは expected/rust-reads.json（test:binder-baseline-rust が、見本データを Rust で読んだ結果と
// 同じことを確かめている）。
//
//   node scripts/test-binder-migration-baseline.mjs [--update]
//
// --update は期待値を書き直す。見本データを足したときだけ使い、書き直した差分はコミットの前に人が読む。
// 1-6・2-4 で今の読み込みのコードが消えても、expected/*.json は移行した結果と比べる相手として残す。

const update = process.argv.includes("--update");
const fixture = path.join("scripts", "fixtures", "binder-migration");
const expectedDir = path.join(fixture, "expected");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function hashTree(folder) {
  const hashes = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else hashes[path.relative(fixture, file)] = createHash("sha256").update(readFileSync(file)).digest("hex");
    }
  };
  walk(folder);
  return hashes;
}
const fixtureBefore = hashTree(path.join(fixture, "library"));

// 作品を開いたときに通る今の処理を1つにまとめて読み込む。
const bundled = await build({
  stdin: {
    contents: [
      'export { loadWorkspacePlotCards } from "./src/plotCardModel.ts";',
      'export { loadWorkspaceSnippets } from "./src/ideaThreadStorage.ts";',
      'export { normalizeReferenceLayout, normalizeState } from "./src/storedStateModel.ts";',
      'export { alignIdeaLayoutToMode, reconcileIdeaThreadLayouts } from "./src/ideaReferenceModel.ts";',
      'export { isIdeaBinderCard } from "./src/types.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;

const rustReads = readJson(path.join(expectedDir, "rust-reads.json"));
const appState = readJson(path.join(fixture, "app-state.json"));
const works = rustReads.works;
const readError = (value) => Boolean(value && !Array.isArray(value) && value.error);

globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      const work = works[args.rootPath];
      if (!work) throw new Error(`unknown work ${args.rootPath}`);
      const answer = { load_project_plot_cards: work.plotCards, load_project_snippets: work.ideaThreads }[command];
      if (answer === undefined) throw new Error(`unexpected command ${command}`);
      if (readError(answer)) throw new Error(`${args.rootPath}: ${command} failed`);
      return structuredClone(answer);
    },
    transformCallback: () => 0,
  },
};

const startedAt = Date.now();
const {
  alignIdeaLayoutToMode,
  isIdeaBinderCard,
  loadWorkspacePlotCards,
  loadWorkspaceSnippets,
  normalizeReferenceLayout,
  normalizeState,
  reconcileIdeaThreadLayouts,
} = await import(moduleUrl);

// 読み込んだ時刻で作られた値は決まらないので、決まった文字にする（Rust 側と同じ書き方）。
const time = (value) => (typeof value === "number" && value >= startedAt ? "読んだ時刻" : value);
const links = (body) => [...body.matchAll(/@\[\[([^\]]+)\]\]/g)].map((match) => match[1]);

/** Plot の見え方。ID と開閉の状態は移行で変わってよいので入れない。 */
const plotView = (cards) =>
  cards.map((card) => ({ kind: card.kind, num: card.num, title: card.title, body: card.body, links: links(card.body) }));

/** Idea の見え方。スレッドの順に、断片と資料リンクを画面に出る順で並べる。 */
function ideaView(threads, layouts, cards) {
  const byThread = new Map(layouts.map((layout) => [layout.threadId, layout.items]));
  const titleOf = new Map(threads.map((thread) => [thread.id, thread.title]));
  const bodyOf = new Map(threads.flatMap((thread) => thread.fragments.map((fragment) => [`${thread.id}:${fragment.id}`, fragment.body])));
  return {
    threads: threads.map((thread) => {
      const fragments = new Map(thread.fragments.map((fragment) => [fragment.id, fragment]));
      return {
        kind: thread.kind,
        title: thread.title,
        starred: thread.starred,
        createdAt: time(thread.createdAt),
        updatedAt: time(thread.updatedAt),
        items: (byThread.get(thread.id) ?? []).map((item) => {
          if (item.sourceType === "reference") return { type: "reference", path: item.sourcePath, createdAt: time(item.createdAt) };
          const fragment = fragments.get(item.fragmentId);
          return {
            type: "idea",
            body: fragment.body,
            used: fragment.used,
            createdAt: time(fragment.createdAt),
            updatedAt: time(fragment.updatedAt),
            ...(fragment.originRef ? { origin: fragment.originRef } : {}),
          };
        }),
      };
    }),
    // 資料ボードに開いている Idea カード。消えた断片のカードは App が閉じる（D-2）ので入れない。
    openCards: cards
      .filter((card) => isIdeaBinderCard(card) && bodyOf.has(`${card.threadId}:${card.fragmentId}`))
      .map((card) => ({ thread: titleOf.get(card.threadId), body: bodyOf.get(`${card.threadId}:${card.fragmentId}`) })),
  };
}

const referencePaths = (view) =>
  view.threads.flatMap((thread) => thread.items.filter((item) => item.type === "reference").map((item) => item.path));

const state = normalizeState(appState);
const actual = { plot: {}, "idea-workspace": {}, "idea-profile": {}, references: {} };
for (const [name, work] of Object.entries(works)) {
  // 作品を開く（Plot・作品の Idea）。読めない作品は、App では作品を開く処理ごと失敗する。
  if (readError(work.plotCards) || readError(work.ideaThreads) || readError(work.layout)) {
    for (const key of Object.keys(actual)) actual[key][name] = "読めない";
    continue;
  }
  const plotCards = await loadWorkspacePlotCards(name);
  const workspaceIdeas = await loadWorkspaceSnippets(name);
  // 資料ボードを読む（App の loadReferenceLayout と、読み込みの effect の管理単位合わせ）。
  const layout = normalizeReferenceLayout(structuredClone(work.layout));
  const imported = (readError(work.candidates) ? [] : work.candidates).filter((file) => file.scope === "project" && file.imported);
  const opened = (mode, threads) => {
    const aligned = alignIdeaLayoutToMode(layout, mode);
    return ideaView(threads, reconcileIdeaThreadLayouts(aligned.ideaThreads, threads, imported), aligned.cards);
  };
  const workspaceView = opened("workspace", workspaceIdeas);
  const profileView = opened("profile", state.profileSnippets);
  actual.plot[name] = plotView(plotCards);
  actual["idea-workspace"][name] = workspaceView;
  actual["idea-profile"][name] = profileView;
  actual.references[name] = {
    files: imported.map((file) => file.sourcePath),
    plot: plotCards.flatMap((card) => links(card.body)),
    ideaWorkspace: referencePaths(workspaceView),
    ideaProfile: referencePaths(profileView),
  };
}

if (update) {
  for (const [key, value] of Object.entries(actual)) {
    writeFileSync(path.join(expectedDir, `${key}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }
  console.log(`updated ${Object.keys(actual).map((key) => `expected/${key}.json`).join(", ")}`);
} else {
  for (const [key, value] of Object.entries(actual)) {
    const expected = readJson(path.join(expectedDir, `${key}.json`));
    assert.deepEqual(Object.keys(value), Object.keys(expected), `${key}: 作品の並びが期待値と違う`);
    for (const name of Object.keys(expected)) {
      assert.deepEqual(value[name], expected[name], `${key}: ${name} の見え方が期待値と違う`);
    }
  }
}

assert.deepEqual(hashTree(path.join(fixture, "library")), fixtureBefore, "the fixture folder must not be rewritten");
console.log("PASS binder migration baseline: Plot and Idea as shown on opening each work match expected/*.json");
