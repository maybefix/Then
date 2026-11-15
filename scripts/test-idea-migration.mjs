import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

// Idea → 投稿・ノート（BINDER 2-4、docs/BINDER_IDEA_MIGRATION_PLAN.md）。
// 1-3 の見本データを Rust が返す値（expected/rust-reads.json）のまま移行の処理に通し、Rust へ渡す投稿とノートの
// 中身を、移行の前の見え方（expected/idea-workspace.json・idea-profile.json）と1件ずつ比べる。
// 見え方と違ってよいのは、確認1で決めた点（インボックスの資料リンクは投稿にしない＝2、used は受信箱から外す＝3、
// サンプルの ID のスレッドの利用者の断片を拾う＝5）だけで、下の「違いの一覧」に書いたとおりであることも確かめる。

const fixture = path.join("scripts", "fixtures", "binder-migration");
const readJson = (file) => JSON.parse(readFileSync(path.join(fixture, file), "utf8"));
const works = readJson("expected/rust-reads.json").works;
const expectedWorkspace = readJson("expected/idea-workspace.json");
const expectedProfile = readJson("expected/idea-profile.json");
const appState = readJson("app-state.json");
const ROOT = "（ライブラリの直下）";

const bundled = await build({
  stdin: {
    contents: [
      'export * from "./src/ideaMigration.ts";',
      'export { normalizeState } from "./src/storedStateModel.ts";',
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

const calls = [];
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push({ command, args: structuredClone(args) });
      const work = works[args.rootPath ?? args.libraryRoot];
      if (command === "load_project_snippets") return structuredClone(work.ideaThreads);
      if (command === "load_reference_layout") return structuredClone(work.layout);
      if (command === "migrate_project_ideas") return { status: "migrated", posts: args.plan.posts.length, notes: [], moved: 0 };
      if (command === "migrate_profile_snippets") return { status: "migrated", posts: args.plan.posts.length, notes: [], moved: 0 };
      throw new Error(`unexpected command ${command}`);
    },
    transformCallback: () => 0,
  },
};

const { ideaMigrationMessage, isoAt, migrateIdeas, migrateWorkspaceIdeas, normalizeState } = await import(moduleUrl);

const startedAt = Date.now();
const time = (value) => (typeof value === "number" && value >= startedAt ? "読んだ時刻" : value);
const isIso = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value);

/** Rust へ渡した中身を、見え方の形に読み戻す。 */
function readPlan(plan) {
  return {
    posts: plan.posts.map((post) => {
      assert.ok(isIso(post.at), `post time is ISO 8601 with an offset: ${post.at}`);
      return {
        body: post.body,
        filed: post.filed,
        at: post.at,
        edited: post.edited ?? null,
        origin: post.origin ?? null,
      };
    }),
    notes: plan.notes.map((note) => ({
      title: note.title,
      paragraphs: note.paragraphs.map((paragraph) => ("link" in paragraph ? { link: paragraph.link } : { text: paragraph.text })),
    })),
  };
}

/** 見え方から、移行で作るはずの投稿とノート。 */
function fromView(view, { readTimes = false } = {}) {
  const posts = [];
  const notes = [];
  for (const thread of view.threads) {
    if (thread.kind === "inbox") {
      for (const item of thread.items) {
        if (item.type !== "idea") continue; // 決めてほしいこと 2
        const at = readTimes ? null : isoAt(item.createdAt);
        posts.push({
          body: item.body,
          filed: item.used, // 決めてほしいこと 3
          at,
          edited: !readTimes && item.updatedAt > item.createdAt ? isoAt(item.updatedAt) : null,
          origin: item.origin ?? null,
        });
      }
      continue;
    }
    notes.push({
      title: thread.title,
      paragraphs: thread.items.map((item) => (item.type === "reference" ? { link: item.path } : { text: item.body })),
    });
  }
  return { posts, notes };
}

// 違いの一覧（決めてほしいこと 5）: 作品B のサンプルの ID のスレッドの中の、利用者の断片を拾う。
const rescued = {
  作品B: [{ title: "サンプル: 場面", paragraphs: [{ text: "利用者が書いた断片（サンプルのスレッドの中）" }] }],
};

let compared = 0;
for (const rootPath of Object.keys(works)) {
  const expected = expectedWorkspace[rootPath];
  calls.length = 0;
  const result = await migrateWorkspaceIdeas(rootPath);
  assert.equal(result.status, "migrated");
  const migrate = calls.find((call) => call.command === "migrate_project_ideas");
  assert.ok(migrate, `${rootPath}: the plan is handed to Rust`);
  assert.deepEqual(migrate.args.expectedIdeaThreads, works[rootPath].ideaThreads, `${rootPath}: the stored threads go back unchanged`);
  const actual = readPlan(migrate.args.plan);
  const legacy = expected.threads.some((thread) => thread.items.some((item) => time(item.createdAt) === "読んだ時刻"));
  const want = fromView(expected, { readTimes: legacy });
  if (legacy) {
    // 旧形式は時刻が「読んだ時刻」なので、時刻は形だけを見る（手順書 M5）。
    for (const post of actual.posts) {
      post.at = null;
      post.edited = null;
    }
  }
  const extra = rescued[rootPath] ?? [];
  const rescuedNotes = actual.notes.filter((note) => extra.some((item) => item.title === note.title));
  assert.deepEqual(rescuedNotes, extra, `${rootPath}: rescued sample-thread fragments (decision 5)`);
  actual.notes = actual.notes.filter((note) => !rescuedNotes.includes(note));
  assert.deepEqual(actual, want, `${rootPath}: posts and notes read back as expected/idea-workspace.json`);
  compared += 1;
}
assert.equal(compared, 6, "every fixture work and the library root");

// 見本 作品A の中身そのもの（手順書 工程2の2・3）。
calls.length = 0;
await migrateWorkspaceIdeas("作品A");
const workA = calls.find((call) => call.command === "migrate_project_ideas").args.plan;
assert.deepEqual(
  workA.posts.map((post) => [post.fragmentId, post.body, post.filed, Boolean(post.edited)]),
  [
    ["a-i2", "使用済みの断片", true, true],
    ["a-i1", "インボックスの一つ目", false, false],
  ],
);
assert.deepEqual(workA.notes[0], {
  threadId: "a-t1",
  title: "場面: 港",
  paragraphs: [
    { text: "港の場面の一" },
    { link: ".then/references/imports/資料a.md" },
    { text: "港の場面の二" },
    { link: ".then/references/imports/map (2).png" },
    { text: "Canvasから来た断片" },
  ],
  fragmentIds: ["a-s1", "a-s2", "a-s3"],
});
assert.deepEqual(workA.notes[2], { threadId: "a-t3", title: "空のスレッド", paragraphs: [], fragmentIds: [] });

// アプリ側の Idea: ライブラリ直下の並び順の「アプリ側」を、直下を移す前に読む。
const state = normalizeState(appState);
calls.length = 0;
const summary = await migrateIdeas([ROOT, "作品A", "作品A"], { libraryRoot: ROOT, threads: state.profileSnippets });
assert.deepEqual(
  calls.map((call) => call.command),
  [
    "load_reference_layout",
    "load_project_snippets",
    "load_reference_layout",
    "migrate_project_ideas",
    "load_project_snippets",
    "load_reference_layout",
    "migrate_project_ideas",
    "migrate_profile_snippets",
  ],
  "profile layout first, each work once, then the profile ideas",
);
assert.deepEqual(summary, { migrated: [ROOT, "作品A"], failed: [], profileMigrated: true, profileFailed: false });
const profile = calls.find((call) => call.command === "migrate_profile_snippets").args;
assert.deepEqual(profile.profileSnippets, state.profileSnippets, "the profile ideas are backed up as held");
assert.deepEqual(readPlan(profile.plan), fromView(expectedProfile[ROOT]), "profile posts and notes read back as expected/idea-profile.json");
assert.ok(profile.plan.posts.length > 0 && profile.plan.notes.length > 0);

// 通知の文。
assert.equal(ideaMigrationMessage({ migrated: [], failed: [], profileMigrated: false, profileFailed: false }), null);
assert.equal(ideaMigrationMessage({ migrated: ["a"], failed: [], profileMigrated: false, profileFailed: false }), "Idea を投稿とノートに移しました");
assert.equal(ideaMigrationMessage({ migrated: ["a", "b"], failed: [], profileMigrated: true, profileFailed: false }), "2作品の Idea を投稿とノートに移しました");
assert.equal(ideaMigrationMessage({ migrated: [], failed: [], profileMigrated: true, profileFailed: false }), "Idea を投稿とノートに移しました");
assert.equal(ideaMigrationMessage({ migrated: ["a"], failed: [{ rootPath: "b", error: "x" }], profileMigrated: false, profileFailed: false }), "Idea を投稿とノートに移せませんでした");

console.log("PASS idea migration: posts and notes read back as expected/idea-*.json for every fixture work");
