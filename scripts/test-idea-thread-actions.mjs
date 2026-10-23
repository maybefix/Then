import assert from "node:assert/strict";
import { build } from "esbuild";

// ideaThreadModel.ts と ideaThreadActions.ts を1つにまとめて読み込む（ID の連番を共有させる）。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/ideaThreadModel.ts"; export * from "./src/ideaThreadActions.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
const {
  createIdeaThreadActions,
  defaultIdeaThreads,
  makeIdeaFragment,
  nextIdeaId,
  normalizeIdeaThreads,
} = await import(moduleUrl);
const { reconcileIdeaThreadLayouts } = await import(
  `data:text/javascript;base64,${Buffer.from((await build({
    entryPoints: ["src/ideaReferenceModel.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
  })).outputFiles[0].text).toString("base64")}`
);

// ---------------------------------------------------------------------------
// 読み込み時の正規化
// ---------------------------------------------------------------------------

{
  for (const empty of [undefined, null, [], "x", {}]) {
    const threads = normalizeIdeaThreads(empty);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].id, "idea-inbox");
    assert.equal(threads[0].kind, "inbox");
    assert.equal(threads[0].title, "インボックス");
    assert.deepEqual(threads[0].fragments, []);
  }
  assert.deepEqual(defaultIdeaThreads().map((thread) => thread.id), ["idea-inbox"]);

  // 旧フラット付箋は、本文（空なら題名）をインボックスの断片へ移す。空の付箋は捨てる。
  const legacy = normalizeIdeaThreads([
    { id: "s1", title: "題A", text: "本文A", category: "", tags: [] },
    { id: "s2", title: "題B", text: "  ", category: "", tags: [] },
    { id: "s3", title: "", text: "", category: "", tags: [] },
  ]);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].kind, "inbox");
  assert.deepEqual(legacy[0].fragments.map((fragment) => fragment.body), ["本文A", "題B"]);
  assert.ok(legacy[0].fragments.every((fragment) => fragment.used === false));

  // サンプルのスレッドと断片は捨てる。インボックスは1つにまとめて先頭へ置く。
  const merged = normalizeIdeaThreads([
    { id: "t1", kind: "thread", title: "場面", fragments: [{ id: "f1", body: "残す" }] },
    { id: "idea-sample-scene", kind: "thread", title: "サンプル", fragments: [] },
    { id: "in-a", kind: "inbox", title: "インボックス", fragments: [{ id: "f2", body: "受け皿1" }] },
    {
      id: "in-b",
      kind: "inbox",
      title: "インボックス",
      fragments: [
        { id: "f3", body: "受け皿2" },
        { id: "f4", body: "主人公が改札の前で一瞬立ち止まる描写を入れる。" },
      ],
    },
    { kind: "other", fragments: [{ body: 3 }, { id: "f5", body: "x", used: 1, createdAt: 5, updatedAt: 6 }] },
  ]);
  assert.deepEqual(merged.map((thread) => thread.id).slice(0, 2), ["idea-inbox", "t1"]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0].fragments.map((fragment) => fragment.id), ["f2", "f3"]);
  const filled = merged[2];
  assert.equal(filled.kind, "thread");
  assert.equal(filled.title, "スレッド");
  assert.match(filled.id, /^thread-/);
  assert.deepEqual(filled.fragments.map((fragment) => [fragment.id, fragment.used, fragment.createdAt, fragment.updatedAt]), [["f5", true, 5, 6]]);

  // Canvas の出どころは project のものだけ残す。
  const origins = normalizeIdeaThreads([
    {
      id: "idea-inbox",
      kind: "inbox",
      title: "インボックス",
      fragments: [
        { id: "o1", body: "a", originRef: { source: "canvas", sourceId: "n1", sourceBoardId: "b1", sourceBoardScope: "project", copiedAt: 9 } },
        { id: "o2", body: "b", originRef: { source: "canvas", sourceId: "n1", sourceBoardId: "b1", sourceBoardScope: "global", copiedAt: 9 } },
        { id: "o3", body: "c", originRef: { source: "idea", sourceId: "n1", sourceBoardId: "b1" } },
      ],
    },
  ])[0].fragments;
  assert.deepEqual(origins[0].originRef, { source: "canvas", sourceId: "n1", sourceBoardId: "b1", sourceBoardScope: "project", copiedAt: 9 });
  assert.equal(origins[1].originRef, undefined);
  assert.equal(origins[2].originRef, undefined);

  const ids = new Set(Array.from({ length: 50 }, () => nextIdeaId("frag")));
  assert.equal(ids.size, 50, "nextIdeaId must not repeat");
  assert.match(makeIdeaFragment("本文").id, /^frag-/);
}

// ---------------------------------------------------------------------------
// 操作: App の値を真似た入れ物を用意し、操作のたびに「描画し直して」最新の値で作り直す
// ---------------------------------------------------------------------------

const frag = (id, body = id) => ({ id, body, used: false, createdAt: 1, updatedAt: 1 });
const thread = (id, kind, title, fragments) => ({
  id, kind, title, starred: false, createdAt: 1, updatedAt: 1, fragments,
});

function createHarness({ mode = "workspace", threads, layouts } = {}) {
  const initialThreads = threads ?? [
    thread("idea-inbox", "inbox", "インボックス", [frag("i1")]),
    thread("t1", "thread", "場面", [frag("a"), frag("b"), frag("c")]),
    thread("t2", "thread", "伏線", [frag("d")]),
  ];
  const state = {
    app: { snippets: initialThreads, profileSnippets: [], settings: { snippetStorageMode: mode } },
    layout: {
      version: 3,
      name: "default",
      cards: [],
      recent: [],
      ideaThreads: layouts ?? reconcileIdeaThreadLayouts([], initialThreads),
    },
    draggingId: null,
    focusRequest: null,
    rightSidebarTab: "plot",
    rightSidebarCollapsed: true,
  };
  const log = { toasts: [], confirms: [], confirmAnswer: true, threadName: "新しい名前" };
  const apply = (current, next) => (typeof next === "function" ? next(current) : next);
  const actions = () =>
    createIdeaThreadActions({
      snippets: state.app.snippets,
      referenceLayout: state.layout,
      setAppState: (next) => { state.app = apply(state.app, next); },
      setReferenceLayout: (next) => { state.layout = apply(state.layout, next); },
      setDraggingId: (next) => { state.draggingId = apply(state.draggingId, next); },
      setIdeaFocusRequest: (next) => { state.focusRequest = apply(state.focusRequest, next); },
      setRightSidebarTab: (tab) => { state.rightSidebarTab = tab; },
      setIsRightSidebarCollapsed: (next) => { state.rightSidebarCollapsed = apply(state.rightSidebarCollapsed, next); },
      showToast: (message, action = null) => { log.toasts.push({ message, action }); },
      requestConfirm: async (options) => { log.confirms.push(options); return log.confirmAnswer; },
      requestNewIdeaThreadName: async () => log.threadName,
    });
  const lastToast = () => log.toasts.at(-1);
  return { state, log, actions, lastToast };
}

const ideaOrder = (state, threadId) =>
  state.layout.ideaThreads
    .find((layout) => layout.threadId === threadId)
    ?.items.map((item) => (item.sourceType === "idea" ? item.fragmentId : `ref:${item.sourcePath}`));
const bodyOrder = (state, threadId) =>
  state.app.snippets.find((entry) => entry.id === threadId)?.fragments.map((fragment) => fragment.id);
const threadIds = (state) => state.app.snippets.map((entry) => entry.id);

/**
 * Idea 本体と並び順が食い違っていれば、App の整合処理がスレッド内の並び順を直してしまう。
 * 直す所がないことを確かめる。スレッドごとの並び順だけを比べる（並び順の一覧そのものの
 * 順番は表示に関係しない。新規スレッドの並び順は一覧の末尾に足される）。
 */
function assertConsistent(state, label) {
  const byThread = (layouts) =>
    Object.fromEntries(layouts.map((layout) => [layout.threadId, layout.items]));
  const reconciled = reconcileIdeaThreadLayouts(state.layout.ideaThreads, state.app.snippets);
  assert.deepEqual(byThread(reconciled), byThread(state.layout.ideaThreads), `${label}: Idea and its order must agree`);
}

// 追加（一覧上部の入力欄・Quick Idea）は先頭に入り、通知を出す。
{
  const { state, actions, lastToast, log } = createHarness();
  actions().captureFragment("  新しい断片  ", "t1");
  const [added] = state.app.snippets.find((entry) => entry.id === "t1").fragments;
  assert.equal(added.body, "新しい断片");
  assert.deepEqual(bodyOrder(state, "t1"), [added.id, "a", "b", "c"]);
  assert.deepEqual(ideaOrder(state, "t1"), [added.id, "a", "b", "c"]);
  assert.equal(lastToast().message, "「場面」に追加しました");
  assertConsistent(state, "capture");

  // 送り先が見つからなければ先頭のスレッドへ入れる。空文字は何もしない。
  actions().captureFragment("迷子", "missing");
  assert.equal(state.app.snippets[0].fragments[0].body, "迷子");
  assert.equal(lastToast().message, "「インボックス」に追加しました");
  const before = JSON.stringify(state);
  const toastCount = log.toasts.length;
  actions().captureFragment("   ", "t1");
  assert.equal(JSON.stringify(state), before);
  assert.equal(log.toasts.length, toastCount);
}

// スレッド詳細からの追加も先頭に入る。通知は出さない。
{
  const { state, actions, log } = createHarness();
  actions().addFragment("t2", "詳細から");
  const [added] = state.app.snippets.find((entry) => entry.id === "t2").fragments;
  assert.deepEqual(ideaOrder(state, "t2"), [added.id, "d"]);
  assert.equal(log.toasts.length, 0);
  assertConsistent(state, "add");
}

// 本文の編集。空にした編集は無視する。
{
  const { state, actions } = createHarness();
  actions().updateFragmentBody("t1", "b", "  直した  ");
  assert.equal(state.app.snippets[1].fragments[1].body, "直した");
  actions().updateFragmentBody("t1", "b", "   ");
  assert.equal(state.app.snippets[1].fragments[1].body, "直した");
}

// 別スレッドへの移動は移動先の先頭へ入り、「元に戻す」で元の位置へ戻る。
{
  const { state, actions, lastToast } = createHarness();
  actions().moveFragment("t1", "b", "t2");
  assert.deepEqual(bodyOrder(state, "t1"), ["a", "c"]);
  assert.deepEqual(bodyOrder(state, "t2"), ["b", "d"]);
  assert.deepEqual(ideaOrder(state, "t1"), ["a", "c"]);
  assert.deepEqual(ideaOrder(state, "t2"), ["b", "d"]);
  assertConsistent(state, "move");
  const toast = lastToast();
  assert.equal(toast.message, "「伏線」へ移動しました");
  assert.equal(toast.action.label, "元に戻す");
  toast.action.onClick();
  assert.deepEqual(bodyOrder(state, "t1"), ["a", "b", "c"]);
  assert.deepEqual(bodyOrder(state, "t2"), ["d"]);
  assert.deepEqual(ideaOrder(state, "t1"), ["a", "b", "c"]);
  assert.deepEqual(ideaOrder(state, "t2"), ["d"]);
  assert.equal(lastToast().message, "移動を元に戻しました");
  assertConsistent(state, "move undo");

  // 同じスレッドへの移動は何もしない。
  const before = JSON.stringify(state);
  actions().moveFragment("t1", "a", "t1");
  assert.equal(JSON.stringify(state), before);
}

// 新規スレッドへの移動。名前を聞き、インボックスの後ろに作って断片を移す。
{
  const { state, actions, log, lastToast } = createHarness();
  log.threadName = "新章";
  await actions().moveFragmentToNewThread("t1", "c");
  const created = state.app.snippets[1];
  assert.equal(created.title, "新章");
  assert.equal(created.kind, "thread");
  assert.deepEqual(threadIds(state), ["idea-inbox", created.id, "t1", "t2"]);
  assert.deepEqual(bodyOrder(state, created.id), ["c"]);
  assert.deepEqual(bodyOrder(state, "t1"), ["a", "b"]);
  assert.deepEqual(ideaOrder(state, created.id), ["c"]);
  assert.deepEqual(ideaOrder(state, "t1"), ["a", "b"]);
  assert.equal(lastToast().message, "新規スレッド「新章」へ移動しました");
  assertConsistent(state, "move to new thread");

  // 名前の入力をやめたら何もしない。
  log.threadName = null;
  const before = JSON.stringify(state);
  await actions().moveFragmentToNewThread("t1", "a");
  assert.equal(JSON.stringify(state), before);
}

// 断片の削除は確認してから消し、「元に戻す」で元の位置へ戻す。
{
  const { state, actions, log, lastToast } = createHarness();
  log.confirmAnswer = false;
  await actions().deleteFragment("t1", "b");
  assert.deepEqual(bodyOrder(state, "t1"), ["a", "b", "c"]);
  assert.deepEqual(log.confirms.at(-1), {
    title: "断片を削除",
    message: "「b」を削除しますか？",
    confirmLabel: "削除",
    danger: true,
  });

  log.confirmAnswer = true;
  await actions().deleteFragment("t1", "b");
  assert.deepEqual(bodyOrder(state, "t1"), ["a", "c"]);
  const toast = lastToast();
  assert.equal(toast.message, "断片を削除しました");
  assert.equal(toast.action.label, "元に戻す");
  toast.action.onClick();
  assert.deepEqual(bodyOrder(state, "t1"), ["a", "b", "c"]);
  assert.equal(lastToast().message, "削除を元に戻しました");

  // 長い本文は36文字で切って確認に出す。
  actions().addFragment("t2", "あ".repeat(40));
  const longId = state.app.snippets[2].fragments[0].id;
  await actions().deleteFragment("t2", longId);
  assert.equal(log.confirms.at(-1).message, `「${"あ".repeat(36)}…」を削除しますか？`);
}

// スレッドの作成・名前変更・スター。
{
  const { state, actions } = createHarness();
  const id = actions().createIdeaThread();
  assert.deepEqual(threadIds(state), ["idea-inbox", id, "t1", "t2"]);
  assert.equal(state.app.snippets[1].title, "新しいスレッド");
  const named = actions().createIdeaThread("  ");
  assert.equal(state.app.snippets.find((entry) => entry.id === named).title, "新しいスレッド");

  actions().renameIdeaThread("t1", "場面（改）");
  assert.equal(state.app.snippets.find((entry) => entry.id === "t1").title, "場面（改）");
  actions().renameIdeaThread("idea-inbox", "名前を変える");
  assert.equal(state.app.snippets[0].title, "インボックス", "the inbox cannot be renamed");

  actions().toggleThreadStar("t2");
  assert.equal(state.app.snippets.find((entry) => entry.id === "t2").starred, true);
  actions().toggleThreadStar("t2");
  assert.equal(state.app.snippets.find((entry) => entry.id === "t2").starred, false);
}

// スレッドの削除は確認してから消し、「元に戻す」で元の位置へ戻す。インボックスは消せない。
{
  const { state, actions, log, lastToast } = createHarness();
  await actions().deleteIdeaThread("idea-inbox");
  assert.equal(log.confirms.length, 0);
  assert.deepEqual(threadIds(state), ["idea-inbox", "t1", "t2"]);

  await actions().deleteIdeaThread("t1");
  assert.deepEqual(log.confirms.at(-1), {
    title: "スレッドを削除",
    message: "「場面」を削除しますか？",
    detail: "断片 3 件もまとめて削除されます。",
    confirmLabel: "削除",
    danger: true,
  });
  assert.deepEqual(threadIds(state), ["idea-inbox", "t2"]);
  assert.equal(lastToast().message, "スレッドを削除しました");
  lastToast().action.onClick();
  assert.deepEqual(threadIds(state), ["idea-inbox", "t1", "t2"]);
  assert.equal(lastToast().message, "スレッドの削除を元に戻しました");
}

// 削除を元に戻すと、表示順（並び順）と資料ボードの Idea カードも元に戻る。
// App の effect（整合処理と、消えた断片のカードを外す処理）を、操作のたびに走らせて確かめる。
{
  const ref = (id, sourcePath) => ({ id, sourceType: "reference", sourcePath, createdAt: 1 });
  const idea = (fragmentId) => ({ sourceType: "idea", fragmentId });
  const card = (id, threadId, fragmentId) => ({
    id, sourceType: "idea", threadId, fragmentId, x: 0, y: 0, width: 320, height: 300, zIndex: 1,
    collapsed: false, pinned: false,
  });
  const setup = () => {
    const harness = createHarness({
      layouts: [
        { threadId: "idea-inbox", items: [idea("i1")] },
        { threadId: "t1", items: [idea("c"), ref("r1", "資料/一.md"), idea("a"), idea("b")] },
        { threadId: "t2", items: [idea("d")] },
      ],
    });
    harness.state.layout.cards = [card("k-a", "t1", "a"), card("k-d", "t2", "d")];
    return harness;
  };
  const runAppEffects = (state) => {
    state.layout = { ...state.layout, ideaThreads: reconcileIdeaThreadLayouts(state.layout.ideaThreads, state.app.snippets) };
    const live = new Set(state.app.snippets.flatMap((entry) => entry.fragments.map((fragment) => `${entry.id}:${fragment.id}`)));
    state.layout = {
      ...state.layout,
      cards: state.layout.cards.filter((entry) => entry.sourceType !== "idea" || live.has(`${entry.threadId}:${entry.fragmentId}`)),
    };
  };
  const cardIds = (state) => state.layout.cards.map((entry) => entry.id).sort();

  // 断片: 資料と混ぜた並び順の途中にあった断片が、末尾ではなく元の位置に戻る。
  {
    const { state, actions, lastToast } = setup();
    await actions().deleteFragment("t1", "a");
    runAppEffects(state);
    assert.deepEqual(ideaOrder(state, "t1"), ["c", "ref:資料/一.md", "b"]);
    assert.deepEqual(cardIds(state), ["k-d"]);
    lastToast().action.onClick();
    runAppEffects(state);
    assert.deepEqual(ideaOrder(state, "t1"), ["c", "ref:資料/一.md", "a", "b"], "undo restores the display position");
    assert.deepEqual(cardIds(state), ["k-a", "k-d"], "undo restores the Idea card");
    assertConsistent(state, "delete fragment undo");
  }

  // スレッド: 受信箱へ移った資料リンクがスレッドへ戻り、並び順とカードも戻る。
  {
    const { state, actions, lastToast } = setup();
    await actions().deleteIdeaThread("t1");
    runAppEffects(state);
    assert.deepEqual(ideaOrder(state, "idea-inbox"), ["i1", "ref:資料/一.md"]);
    assert.deepEqual(cardIds(state), ["k-d"]);
    lastToast().action.onClick();
    runAppEffects(state);
    assert.deepEqual(ideaOrder(state, "t1"), ["c", "ref:資料/一.md", "a", "b"], "undo restores the thread order and its references");
    assert.deepEqual(ideaOrder(state, "idea-inbox"), ["i1"], "undo takes the reference back out of the inbox");
    assert.deepEqual(cardIds(state), ["k-a", "k-d"], "undo restores the Idea cards");
    assertConsistent(state, "delete thread undo");
  }

  // スレッド: 削除のあとで受信箱から外した資料リンクは、元に戻しても戻さない。
  {
    const { state, actions, lastToast } = setup();
    await actions().deleteIdeaThread("t1");
    runAppEffects(state);
    state.layout = {
      ...state.layout,
      ideaThreads: state.layout.ideaThreads.map((layout) =>
        layout.threadId === "idea-inbox"
          ? { ...layout, items: layout.items.filter((item) => item.sourceType !== "reference") }
          : layout.threadId === "t2"
            ? { ...layout, items: [ref("r9", "資料/一.md"), ...layout.items] }
            : layout,
      ),
    };
    lastToast().action.onClick();
    runAppEffects(state);
    assert.deepEqual(ideaOrder(state, "t1"), ["c", "a", "b"]);
    assert.deepEqual(ideaOrder(state, "t2"), ["ref:資料/一.md", "d"]);
  }
}

// 資料リンクを新規スレッドへ移す・追加する。
{
  const threads = [
    thread("idea-inbox", "inbox", "インボックス", []),
    thread("t1", "thread", "場面", [frag("a")]),
  ];
  const layouts = [
    { threadId: "idea-inbox", items: [] },
    {
      threadId: "t1",
      items: [
        { sourceType: "idea", fragmentId: "a" },
        { id: "link-1", sourceType: "reference", sourcePath: ".then/references/imports/map.png", createdAt: 1 },
      ],
    },
  ];
  const moved = createHarness({ threads, layouts });
  moved.log.threadName = "地図";
  await moved.actions().moveReferenceToNewThread("t1", "link-1", false);
  const movedId = moved.state.app.snippets[1].id;
  assert.equal(moved.state.app.snippets[1].title, "地図");
  assert.deepEqual(ideaOrder(moved.state, movedId), ["ref:.then/references/imports/map.png"]);
  assert.deepEqual(ideaOrder(moved.state, "t1"), ["a"]);
  assert.equal(moved.lastToast().message, "新規スレッド「地図」へ移動しました");

  const copied = createHarness({ threads, layouts });
  copied.log.threadName = "地図";
  await copied.actions().moveReferenceToNewThread("t1", "link-1", true);
  const copiedId = copied.state.app.snippets[1].id;
  assert.deepEqual(ideaOrder(copied.state, copiedId), ["ref:.then/references/imports/map.png"]);
  assert.deepEqual(ideaOrder(copied.state, "t1"), ["a", "ref:.then/references/imports/map.png"]);
  assert.equal(copied.lastToast().message, "新規スレッド「地図」へ追加しました");
}

// 管理単位が「共有」のときだけ、共有の Idea も同じ値にする。
{
  const shared = createHarness({ mode: "profile" });
  shared.actions().addFragment("t1", "共有へ");
  assert.equal(shared.state.app.profileSnippets, shared.state.app.snippets);

  const perWork = createHarness({ mode: "workspace" });
  perWork.actions().addFragment("t1", "作品へ");
  assert.deepEqual(perWork.state.app.profileSnippets, []);
}

// Canvas の「Idea へ送る」。
{
  const { state, actions, lastToast } = createHarness();
  const request = {
    boardId: "board-1",
    boardScope: "project",
    boardName: "ボード",
    targetThreadId: "__new__",
    threadTitle: "  グループ名  ",
    items: [
      { nodeId: "n1", text: "一枚目" },
      { nodeId: "n2", text: "   " },
      { nodeId: "n3", text: "二枚目" },
    ],
  };
  actions().receiveCanvasCopyToIdea(request);
  const created = state.app.snippets[1];
  assert.equal(created.title, "グループ名");
  assert.deepEqual(created.fragments.map((fragment) => fragment.body), ["一枚目", "二枚目"]);
  assert.deepEqual(
    created.fragments.map((fragment) => [fragment.originRef.sourceId, fragment.originRef.sourceBoardId, fragment.originRef.source]),
    [["n1", "board-1", "canvas"], ["n3", "board-1", "canvas"]],
  );
  assert.equal(state.rightSidebarTab, "idea");
  assert.equal(state.rightSidebarCollapsed, false);
  assert.equal(state.focusRequest.threadId, created.id);
  assert.equal(lastToast().message, "2 件を Idea へ取り込みました");

  // 既存のスレッドへは末尾に足す。見つからなければインボックスへ。
  actions().receiveCanvasCopyToIdea({ ...request, targetThreadId: "t2", threadTitle: undefined });
  assert.deepEqual(state.app.snippets.find((entry) => entry.id === "t2").fragments.map((fragment) => fragment.body), ["d", "一枚目", "二枚目"]);
  actions().receiveCanvasCopyToIdea({ ...request, targetThreadId: "missing", items: [{ nodeId: "n9", text: "迷子" }] });
  assert.deepEqual(state.app.snippets[0].fragments.map((fragment) => fragment.body), ["i1", "迷子"]);

  // 名前がなければボード名、それもなければ「Canvas から」。
  actions().receiveCanvasCopyToIdea({ ...request, threadTitle: " ", boardName: "" });
  assert.equal(state.app.snippets[1].title, "Canvas から");

  // 本文が空のカードだけなら何もしない。
  const before = JSON.stringify(state);
  actions().receiveCanvasCopyToIdea({ ...request, items: [{ nodeId: "n1", text: "  " }] });
  assert.equal(JSON.stringify(state), before);
}

// Canvas の「元Idea」。
{
  const { state, actions } = createHarness();
  actions().receiveCanvasFocusIdea({ threadId: "t1", fragmentId: "b" });
  assert.equal(state.rightSidebarTab, "idea");
  assert.equal(state.rightSidebarCollapsed, false);
  assert.equal(state.focusRequest.threadId, "t1");
  assert.equal(state.focusRequest.fragmentId, "b");
  assert.equal(typeof state.focusRequest.nonce, "number");
}

// ドラッグ: 断片の ID だけを渡し、本文の文字列は渡さない。Idea は本文へ落とせない。
{
  const { state, actions } = createHarness();
  const data = new Map();
  const dragStart = {
    dataTransfer: {
      effectAllowed: "none",
      setData: (type, value) => data.set(type, value),
    },
  };
  actions().handleFragmentDragStart(dragStart, "t1", "a");
  assert.equal(state.draggingId, "a");
  assert.equal(dragStart.dataTransfer.effectAllowed, "move");
  assert.deepEqual([...data], [["application/x-brew-snippet-id", "a"]]);
  actions().handleFragmentDragEnd();
  assert.equal(state.draggingId, null);

  const dropEvent = (types) => {
    const event = {
      prevented: false,
      stopped: false,
      dataTransfer: { types, dropEffect: "copy" },
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    return event;
  };
  const ideaDrop = dropEvent(["application/x-brew-snippet-id"]);
  actions().blockIdeaDropOnEditor(ideaDrop);
  assert.equal(ideaDrop.prevented, true);
  assert.equal(ideaDrop.stopped, true);
  assert.equal(ideaDrop.dataTransfer.dropEffect, "none");
  const textDrop = dropEvent(["text/plain"]);
  actions().blockIdeaDropOnEditor(textDrop);
  assert.equal(textDrop.prevented, false);
  assert.equal(textDrop.dataTransfer.dropEffect, "copy");
}

console.log("PASS Idea thread actions: normalize/migrate, add/move/undo order, threads, references, Canvas, drag");
