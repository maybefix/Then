import assert from "node:assert/strict";
import { build } from "esbuild";

// App.tsx から移した、保存したデータを読み込んだときに形と値を整える処理を、実際に動かして確かめる
// （docs/APP_STATE_NORMALIZE_SEPARATION_PLAN.md）。期待値は、移す前の App.tsx の関数でも同じになる。
const bundled = await build({
  stdin: {
    contents: [
      'export * from "./src/storedStateModel.ts";',
      'export { PROOFREAD_RULES } from "./src/proofread/rules.ts";',
      'export { DEFAULT_EDITOR_MEASURE_PERCENT, UI_FONT_SCALE_MAX, UI_FONT_SCALE_MIN } from "./src/types.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const {
  DEFAULT_EDITOR_MEASURE_PERCENT,
  MAX_RECENT_REFERENCES,
  PROOFREAD_RULES,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_MIN,
  clampReferenceCardToStage,
  createDefaultState,
  fitReferenceLayoutToStage,
  initialMarkdown,
  normalizeFileProgress,
  normalizePathForCompare,
  normalizePlotCards,
  normalizeProofreadIgnored,
  normalizeReferenceLayout,
  normalizeSnapshots,
  normalizeState,
  toCssFontFamilyValue,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

// 既定の Idea のスレッドが作った時刻を持つので、比べられるように時刻を止める。
Date.now = () => 1_700_000_000_000;

// ---------------------------------------------------------------------------
// 保存状態: 空や壊れた値からでも、全項目がそろう
// ---------------------------------------------------------------------------

{
  const defaults = createDefaultState();
  assert.equal(defaults.markdown, initialMarkdown);
  for (const empty of [undefined, null, {}]) {
    assert.deepEqual(normalizeState(empty), defaults, "nothing stored reads back as the default state");
  }
  const broken = normalizeState({
    markdown: 3,
    settings: { fontSize: "big", theme: "no-such-theme", writingMode: "sideways" },
    recentWorkspaces: "x",
    lastWorkspacePath: 1,
    snapshots: {},
  });
  assert.deepEqual(Object.keys(broken).sort(), Object.keys(defaults).sort());
  assert.equal(broken.markdown, initialMarkdown);
  assert.equal(broken.settings.fontSize, defaults.settings.fontSize);
  assert.equal(broken.settings.theme, defaults.settings.theme);
  assert.equal(broken.settings.writingMode, defaults.settings.writingMode);
  assert.deepEqual(broken.recentWorkspaces, []);
  assert.equal(broken.lastWorkspacePath, null);
  assert.deepEqual(broken.snapshots, []);
}

// ---------------------------------------------------------------------------
// 設定: 古い形式の読み替え、範囲外の丸め、知らない値の差し戻し
// ---------------------------------------------------------------------------

{
  const legacy = normalizeState({ settings: { zoneMode: true } }).settings;
  assert.equal(legacy.sidebarHoverMode, "both", "v0.6.1 zoneMode: true means hover on both sides");
  assert.equal("zoneMode" in legacy, false, "the old key is not written back");
  assert.equal(
    normalizeState({ settings: { zoneMode: true, sidebarHoverMode: "left" } }).settings.sidebarHoverMode,
    "left",
    "a stored sidebarHoverMode wins over the old key",
  );
  assert.equal(normalizeState({ settings: { zoneMode: false } }).settings.sidebarHoverMode, "none");

  const high = normalizeState({
    settings: {
      fontSize: 99,
      lineHeight: 9,
      typewriterOffset: 99,
      zoneModeOpacity: 2,
      uiFontScale: 99,
      editorMeasureHorizontal: 63.4,
      editorMeasureVertical: 5000,
    },
  }).settings;
  assert.equal(high.fontSize, 24);
  assert.equal(high.lineHeight, 2.4);
  assert.equal(high.typewriterOffset, 65);
  assert.equal(high.zoneModeOpacity, 0.85);
  assert.equal(high.uiFontScale, UI_FONT_SCALE_MAX);
  assert.equal(high.editorMeasureHorizontal, 63, "in-range measure is rounded");
  assert.equal(high.editorMeasureVertical, DEFAULT_EDITOR_MEASURE_PERCENT, "old px value falls back");

  const low = normalizeState({
    settings: { fontSize: 3, lineHeight: 0.5, typewriterOffset: 0, zoneModeOpacity: -1, uiFontScale: 0 },
  }).settings;
  assert.equal(low.fontSize, 12);
  assert.equal(low.lineHeight, 1.4);
  assert.equal(low.typewriterOffset, 30);
  assert.equal(low.zoneModeOpacity, 0);
  assert.equal(low.uiFontScale, UI_FONT_SCALE_MIN);

  const choices = normalizeState({
    settings: {
      exportFontFamily: "Comic Sans",
      snippetStorageMode: "cloud",
      editorDisplayMode: "paged",
      pageFlowDirection: "vertical",
      documentTabsDisplayMode: "hover",
      headingFontSource: "custom",
      showLineNumbers: true,
      showComments: "yes",
    },
  }).settings;
  const defaults = createDefaultState().settings;
  assert.equal(choices.exportFontFamily, defaults.exportFontFamily);
  assert.equal(choices.snippetStorageMode, "workspace");
  assert.equal(choices.editorDisplayMode, "paged");
  assert.equal(choices.pageFlowDirection, "vertical");
  assert.equal(choices.documentTabsDisplayMode, "hover");
  assert.equal(choices.headingFontSource, "custom");
  assert.equal(choices.showLineNumbers, true);
  assert.equal(choices.showComments, defaults.showComments, "non-boolean switches fall back");
}

{
  // 改行の印の切り替えだけ、保存された値を確かめずに通していた（APP_STATE_NORMALIZE_SEPARATION_PLAN.md 2-5 の 1）。
  const read = (value) => normalizeState({ settings: { showLineBreakMarks: value } }).settings.showLineBreakMarks;
  assert.equal(read(true), true);
  assert.equal(read(false), false);
  for (const broken of ["yes", 1, null, {}]) {
    assert.equal(read(broken), createDefaultState().settings.showLineBreakMarks, `showLineBreakMarks ${JSON.stringify(broken)} falls back`);
  }
}

// ---------------------------------------------------------------------------
// フォント名: ヒラギノの別名の読み替えと、引用符の付け方
// ---------------------------------------------------------------------------

{
  assert.equal(toCssFontFamilyValue("ヒラギノ明朝 Pro W3"), '"Hiragino Mincho Pro", "ヒラギノ明朝 Pro"');
  assert.equal(toCssFontFamilyValue(" Yu Mincho "), '"Yu Mincho"');
  const fonts = normalizeState({
    settings: {
      editorFontFamily: '"ヒラギノ角ゴ Pro W6"',
      uiFontFamily: '"Foo", serif',
      headingFontFamily: "   ",
    },
  }).settings;
  assert.equal(fonts.editorFontFamily, '"Hiragino Kaku Gothic Pro", "ヒラギノ角ゴ Pro"');
  assert.equal(fonts.uiFontFamily, '"Foo", serif', "a stack is kept as stored");
  assert.equal(fonts.headingFontFamily, createDefaultState().settings.headingFontFamily);
}

// ---------------------------------------------------------------------------
// 校正の設定: 無くなったルールは捨て、しきい値は入力欄の範囲へ
// ---------------------------------------------------------------------------

{
  const ruleId = PROOFREAD_RULES[0].id;
  const checkId = PROOFREAD_RULES.find((rule) => rule.checks?.length).checks[0].id;
  const proofread = normalizeState({
    settings: {
      proofread: {
        maxSentenceLength: 1000,
        maxCommasPerSentence: 0,
        skipDialogue: false,
        disabledRules: ["no-such-rule", ruleId, ruleId],
        disabledChecks: [checkId, 5, "no-such-check"],
      },
    },
  }).settings.proofread;
  assert.deepEqual(proofread, {
    maxSentenceLength: 200,
    maxCommasPerSentence: 1,
    skipDialogue: false,
    disabledRules: [ruleId],
    disabledChecks: [checkId],
  });
}

// ---------------------------------------------------------------------------
// 作品をまたぐ記録: 開閉・進み具合・カーソル位置・移行の印
// ---------------------------------------------------------------------------

{
  const state = normalizeState({
    recentWorkspaces: [
      { path: "C:/a", name: "A", lastOpenedAt: 1 },
      { path: "C:/b", name: "B" },
      null,
    ],
    collapsedFolderPathsByWorkspace: { "C:/a": ["x", "x", "", 3], "": ["y"], "C:/b": "no" },
    collapsedOutlinePathsByWorkspace: [],
    fileProgress: { "a.md": "done", "b.md": "finished", "c.md": "todo" },
    cursorPositions: {
      "a.md": { offset: 3.7, length: 1.2 },
      "b.md": { offset: -1, length: 0 },
      "c.md": { offset: 1 },
    },
    fileProgressMigrationVersions: { a: 1, b: 0, c: 1.5, "": 2 },
  });
  assert.deepEqual(state.recentWorkspaces, [{ path: "C:/a", name: "A", lastOpenedAt: 1 }]);
  assert.deepEqual(state.collapsedFolderPathsByWorkspace, { "C:/a": ["x"] });
  assert.deepEqual(state.collapsedOutlinePathsByWorkspace, {});
  assert.deepEqual(state.fileProgress, { "a.md": "done", "c.md": "todo" });
  assert.deepEqual(state.cursorPositions, { "a.md": { offset: 3, length: 1 } });
  assert.deepEqual(state.fileProgressMigrationVersions, { a: 1 });
  assert.deepEqual(normalizeFileProgress(null), {});
}

// ---------------------------------------------------------------------------
// チェックポイント: 古い形式の補い、空のものの除外、自動の退避は作品ごとに新しい3つ
// ---------------------------------------------------------------------------

{
  const [legacy] = normalizeSnapshots([
    { id: "s1", workspacePath: "C:/w", createdAt: 10, files: [{ path: "a.md", name: "a.md", text: "あ い\nう" }] },
  ]);
  assert.equal(legacy.revision, 1);
  assert.equal(legacy.reason, "manual");
  assert.equal(legacy.label, "チェックポイント");
  assert.equal(legacy.workspaceName, "プロジェクト");
  assert.deepEqual(legacy.projectTree, { path: "C:/w", name: "プロジェクト", children: [] });
  assert.equal(legacy.files[0].lineCount, 2);
  assert.equal(legacy.files[0].textLength, 5);
  assert.equal(legacy.files[0].visibleTextLength, 3, "spaces and newlines are not visible characters");
  assert.equal(legacy.fileCount, 1);
  assert.equal(legacy.totalTextLength, 5);
  assert.equal(legacy.totalVisibleTextLength, 3);

  assert.deepEqual(
    normalizeSnapshots([
      { id: "empty", workspacePath: "C:/w", files: [] },
      { id: "nowhere", files: [{ path: "a", name: "a", text: "x" }] },
      { id: "bad-file", workspacePath: "C:/w", files: [{ path: "a", name: "a" }] },
    ]),
    [],
  );

  const file = [{ path: "a.md", name: "a.md", text: "x" }];
  const shelters = [1, 2, 3, 4, 5].map((n) => ({
    id: `auto-${n}`,
    reason: "auto-before-restore",
    workspacePath: n % 2 ? "C:/Work" : "c:\\work\\",
    createdAt: n,
    files: file,
  }));
  const trimmed = normalizeSnapshots([
    ...shelters,
    { id: "manual", workspacePath: "C:/Work", createdAt: 0, files: file },
    { id: "other", reason: "auto-before-restore", workspacePath: "C:/Other", createdAt: 6, files: file },
  ]);
  assert.deepEqual(
    trimmed.map((snapshot) => snapshot.id),
    ["other", "auto-5", "auto-4", "auto-3", "manual"],
    "newest three shelters per project (paths compared loosely), manual ones always kept",
  );
}

{
  assert.equal(normalizePathForCompare("C:/Foo//Bar/"), "c:\\foo\\bar");
  assert.equal(normalizePathForCompare("c:\\foo\\bar"), normalizePathForCompare("C:/FOO/BAR"));
}

// ---------------------------------------------------------------------------
// 作品のファイル: プロット
// ---------------------------------------------------------------------------

{
  assert.deepEqual(normalizePlotCards("x"), []);
  assert.deepEqual(
    normalizePlotCards([
      { id: "c", kind: "chapter", num: "9", title: "一章" },
      { id: "s", title: 5, body: "本文", expanded: 1 },
      { title: "no id" },
      { id: "n", num: "  " },
    ]),
    [
      { id: "c", kind: "chapter", num: "", title: "一章", body: "", expanded: false, managerCollapsed: false },
      { id: "s", kind: "section", num: "002", title: "", body: "本文", expanded: true, managerCollapsed: false },
      { id: "n", kind: "section", num: "003", title: "", body: "", expanded: false, managerCollapsed: false },
    ],
    "section numbers follow the position among the kept cards",
  );
}

// ---------------------------------------------------------------------------
// 作品のファイル: 資料のレイアウト
// ---------------------------------------------------------------------------

{
  const empty = normalizeReferenceLayout(null);
  assert.deepEqual(empty, { version: 3, name: "default", recent: [], cards: [], ideaThreads: [] });

  const layout = normalizeReferenceLayout(
    {
      name: "  ",
      cards: [
        { id: "r1", sourcePath: "資料/a.png", x: 5000, y: -20, width: 9000, height: 50 },
        { id: "g", sourcePath: "global.md", scope: "global" },
        { id: "i1", sourceType: "idea", threadId: "t", fragmentId: "f" },
        { id: "bad" },
      ],
      recent: [
        { sourcePath: "資料/b.md", name: "b.md", kind: "markdown", size: 1, scope: "project" },
        { sourcePath: "g.md", name: "g.md", kind: "markdown", size: 1, scope: "global" },
        { sourcePath: "broken" },
      ],
      ideaThreads: [{ threadId: "t", items: [] }, { threadId: 1 }],
      ideaThreadsMode: "workspace",
      otherIdea: { mode: "profile", ideaThreads: [], cards: [{ id: "i2", sourceType: "idea", threadId: "u", fragmentId: "g" }] },
    },
  );
  assert.equal(layout.name, "default");
  assert.deepEqual(layout.cards.map((card) => card.id), ["r1", "i1"], "global and broken cards are dropped");
  const [reference, idea] = layout.cards;
  assert.equal(reference.kind, "image", "kind comes from the extension when not stored");
  assert.equal(reference.scope, "project");
  assert.equal(reference.editing, false);
  // 読み込みでは画面の大きさが分からないので、収めない（docs/REFERENCE_LAYOUT_STARTUP_FIT_PLAN.md）。
  assert.deepEqual(
    { x: reference.x, y: reference.y, width: reference.width, height: reference.height },
    { x: 5000, y: -20, width: 9000, height: 50 },
    "loading keeps the stored positions instead of fitting them to a guessed stage",
  );
  const fitted = fitReferenceLayoutToStage(layout, { width: 800, height: 600 });
  const [fittedReference, fittedIdea] = fitted.cards;
  assert.deepEqual(
    { x: fittedReference.x, y: fittedReference.y, width: fittedReference.width, height: fittedReference.height },
    { x: 12, y: 0, width: 776, height: 140 },
    "cards are clamped into the stage",
  );
  assert.equal(fittedIdea, idea, "a card already inside the stage is kept as it is");
  assert.equal(fitted.otherIdea, layout.otherIdea, "the hidden Idea cards are fitted when they are shown");
  assert.equal(fitted.recent, layout.recent);
  assert.equal(
    fitReferenceLayoutToStage(fitted, { width: 800, height: 600 }),
    fitted,
    "fitting a layout that already fits returns the same layout, so it is not saved again",
  );
  assert.deepEqual(
    normalizeReferenceLayout({ cards: [{ id: "far", sourcePath: "a.md", x: 1100, y: 700, width: 320, height: 300 }] })
      .cards.map((card) => [card.x, card.y]),
    [[1100, 700]],
    "there is no hidden 1200×800 stage",
  );
  assert.deepEqual(
    idea,
    {
      id: "i1", sourceType: "idea", threadId: "t", fragmentId: "f",
      x: 72 + 1 * 32, y: 96 + 1 * 32, width: 320, height: 300, zIndex: 2, collapsed: false, pinned: false,
    },
    "missing positions follow the order among the kept cards",
  );
  assert.deepEqual(
    layout.recent.map((file) => file.sourcePath),
    ["資料/b.md", "資料/a.png"],
    "recent keeps project files and adds the files of open cards",
  );
  assert.deepEqual(layout.ideaThreads, [{ threadId: "t", items: [] }]);
  assert.equal(layout.ideaThreadsMode, "workspace");
  assert.deepEqual(layout.otherIdea.cards.map((card) => card.id), ["i2"]);
  assert.equal(
    normalizeReferenceLayout({ ideaThreadsMode: "workspace", otherIdea: { mode: "workspace" } }).otherIdea,
    undefined,
    "the other Idea layout is kept only for the other storage mode",
  );

  const many = Array.from({ length: MAX_RECENT_REFERENCES + 5 }, (_, index) => ({
    sourcePath: `r${index}.md`, name: `r${index}.md`, kind: "markdown", size: 0, scope: "project",
  }));
  assert.equal(normalizeReferenceLayout({ recent: many }).recent.length, MAX_RECENT_REFERENCES);

  const clamped = clampReferenceCardToStage({ x: -5, y: 10, width: 100, height: 100 }, 200, 150);
  assert.deepEqual(clamped, { x: 0, y: 0, width: 220, height: 140 });
}

// ---------------------------------------------------------------------------
// 作品のファイル: 校正の無視リスト
// ---------------------------------------------------------------------------

{
  assert.deepEqual(normalizeProofreadIgnored([]), {});
  assert.deepEqual(
    normalizeProofreadIgnored({ "a.md": ["k", "k", "", 1], "b.md": [], "": ["x"], "c.md": "k" }),
    { "a.md": ["k"] },
  );
}

console.log("stored state model tests passed");
