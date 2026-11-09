import assert from "node:assert/strict";
import { build } from "esbuild";

// plotCardModel.ts と plotCardActions.ts を1つにまとめて読み込む。Rust の命令は
// window.__TAURI_INTERNALS__.invoke の入れ物で受け、作品ごとの project.json の plotCards を持つ。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/plotCardModel.ts"; export * from "./src/plotCardActions.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;

const stored = new Map();
const calls = [];
let failSave = false;
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "load_project_plot_cards") return structuredClone(stored.get(args.rootPath) ?? []);
      if (command === "save_project_plot_cards") {
        if (failSave) throw new Error("disk full");
        stored.set(args.rootPath, structuredClone(args.plotCards));
        return null;
      }
      throw new Error(`unexpected command ${command}`);
    },
    transformCallback: () => 0,
  },
};

const { createPlotCardActions, defaultPlotCards, loadWorkspacePlotCards, saveWorkspacePlotCards } =
  await import(moduleUrl);

const card = (id, title, body = "", kind = "section", num = "001") => ({
  id,
  kind,
  num,
  title,
  body,
  expanded: false,
  managerCollapsed: false,
});

/** App の代わり。操作のたびに、その時点の値で createPlotCardActions を作り直す（App の描画と同じ形）。 */
function makeApp(initialCards, { options = null, existing = [], copied = {} } = {}) {
  const app = {
    plotCards: initialCards,
    rightSidebarTab: "idea",
    collapsed: true,
    toasts: [],
    errors: [],
    requests: [],
    rewriteRequests: [],
  };
  const setPlotCards = (next) => {
    app.plotCards = typeof next === "function" ? next(app.plotCards) : next;
  };
  const actions = () =>
    createPlotCardActions({
      plotCards: app.plotCards,
      setPlotCards,
      requestTransferOptions: async (request) => {
        app.requests.push(request);
        return options;
      },
      isExistingReference: (path) => existing.includes(path),
      prepareReferenceRewrite: async (target, paths, copyReferences) => {
        app.rewriteRequests.push({ target, paths, copyReferences });
        return {
          copied: new Map(Object.entries(copied).map(([from, to]) => [from.toLocaleLowerCase(), { sourcePath: to }])),
          dropped: new Set(),
        };
      },
      showToast: (message) => app.toasts.push(message),
      reportTransferError: (error) => app.errors.push(String(error)),
      setRightSidebarTab: (tab) => {
        app.rightSidebarTab = tab;
      },
      setIsRightSidebarCollapsed: (collapsed) => {
        app.collapsed = collapsed;
      },
    });
  return { app, actions };
}

// ---------------------------------------------------------------------------
// 読み書き（plotCardModel）
// ---------------------------------------------------------------------------

{
  stored.set("/works/A", [card("a1", "Aの章"), { id: "bad" }]);
  calls.length = 0;
  const loaded = await loadWorkspacePlotCards("/works/A");
  assert.deepEqual(calls.map((call) => [call.command, call.args.rootPath]), [["load_project_plot_cards", "/works/A"]]);
  assert.equal(loaded[0].id, "a1", "読み込んだカードは正規化して返す");
  assert.ok(loaded.every((item) => typeof item.title === "string" && typeof item.body === "string"));

  await saveWorkspacePlotCards("/works/A", [card("a2", "新")]);
  assert.deepEqual(stored.get("/works/A").map((item) => item.id), ["a2"]);
  assert.equal(calls.at(-1).command, "save_project_plot_cards");

  assert.equal(defaultPlotCards.length, 3);
  assert.deepEqual(defaultPlotCards.map((item) => item.id), ["plot-1", "plot-2", "plot-3"]);
}

// ---------------------------------------------------------------------------
// 作品間のコピー
// ---------------------------------------------------------------------------

{
  stored.set("/works/B", [card("b1", "Bの章")]);
  const source = card("s1", "港", "@[[資料/地図.png]] と @[[資料/なし.md]]");
  const { app, actions } = makeApp([source, card("s2", "坂")], {
    options: { target: "/works/B", targetLabel: "作品B", move: false, copyReferences: true },
    existing: ["資料/地図.png"],
    copied: { "資料/地図.png": "imports/地図.png" },
  });
  await actions().transferPlotCard("s1");

  assert.deepEqual(app.requests, [{ itemLabel: "プロット", referenceCount: 1 }], "数える資料は、作品にあるものだけ");
  assert.deepEqual(app.rewriteRequests, [
    { target: "/works/B", paths: ["資料/地図.png", "資料/なし.md"], copyReferences: true },
  ]);
  const target = stored.get("/works/B");
  assert.equal(target.length, 2, "行き先の末尾に1枚足す");
  assert.equal(target[0].id, "b1");
  assert.notEqual(target[1].id, "s1", "コピーには新しい ID を付ける");
  assert.equal(target[1].title, "港");
  assert.equal(target[1].body, "@[[imports/地図.png]] と @[[資料/なし.md]]", "コピーした資料へリンクを書き換える");
  assert.deepEqual(app.plotCards.map((item) => item.id), ["s1", "s2"], "コピーでは手元に残す");
  assert.deepEqual(app.toasts, ["作品Bへコピーしました"]);
  assert.deepEqual(app.errors, []);
}

// ---------------------------------------------------------------------------
// 作品間の移動（章ラベル）
// ---------------------------------------------------------------------------

{
  stored.set("/works/C", []);
  const chapter = card("c1", "第一章", "", "chapter", "");
  const { app, actions } = makeApp([chapter, card("s2", "坂")], {
    options: { target: "/works/C", targetLabel: "作品C", move: true, copyReferences: false },
  });
  await actions().transferPlotCard("c1");
  assert.deepEqual(app.requests, [{ itemLabel: "章ラベル", referenceCount: 0 }]);
  assert.deepEqual(stored.get("/works/C").map((item) => [item.kind, item.title]), [["chapter", "第一章"]]);
  assert.deepEqual(app.plotCards.map((item) => item.id), ["s2"], "移動では手元から消す");
  assert.deepEqual(app.toasts, ["作品Cへ移動しました"]);
}

// ---------------------------------------------------------------------------
// やめたとき・見つからないとき・保存に失敗したとき
// ---------------------------------------------------------------------------

{
  const { app, actions } = makeApp([card("s1", "港")], { options: null });
  calls.length = 0;
  await actions().transferPlotCard("s1");
  assert.equal(app.requests.length, 1);
  assert.deepEqual(calls, [], "行き先を選ばなければ、何も読み書きしない");
  assert.deepEqual(app.toasts, []);

  await actions().transferPlotCard("none");
  assert.equal(app.requests.length, 1, "ないカードでは行き先を聞かない");
}

{
  stored.set("/works/D", [card("d1", "D")]);
  failSave = true;
  const { app, actions } = makeApp([card("s1", "港")], {
    options: { target: "/works/D", targetLabel: "作品D", move: true, copyReferences: true },
  });
  await actions().transferPlotCard("s1");
  failSave = false;
  assert.deepEqual(app.errors, ["Error: disk full"]);
  assert.deepEqual(app.plotCards.map((item) => item.id), ["s1"], "保存に失敗したら、移動でも手元に残す");
  assert.deepEqual(stored.get("/works/D").map((item) => item.id), ["d1"]);
  assert.deepEqual(app.toasts, []);
}

// ---------------------------------------------------------------------------
// Canvas からの「プロットへ送る」
// ---------------------------------------------------------------------------

{
  const { app, actions } = makeApp([card("x1", "章", "", "chapter", ""), card("x2", "既存", "", "section", "001")]);
  actions().receiveCanvasCopyToPlot({ payload: { items: [{ text: "  " }, { text: "" }] } });
  assert.equal(app.plotCards.length, 2, "空のカードだけなら何もしない");
  assert.deepEqual(app.toasts, []);
  assert.equal(app.rightSidebarTab, "idea");
  assert.equal(app.collapsed, true);

  const before = Date.now().toString(36);
  actions().receiveCanvasCopyToPlot({
    payload: { items: [{ text: "  題名\n本文1\n本文2  " }, { text: " " }, { text: "一行だけ" }] },
  });
  const after = Date.now().toString(36);
  const added = app.plotCards.slice(2);
  assert.equal(added.length, 2);
  assert.deepEqual(
    added.map(({ kind, num, title, body, expanded, managerCollapsed }) => ({ kind, num, title, body, expanded, managerCollapsed })),
    [
      { kind: "section", num: "002", title: "題名", body: "本文1\n本文2", expanded: false, managerCollapsed: false },
      { kind: "section", num: "003", title: "", body: "一行だけ", expanded: false, managerCollapsed: false },
    ],
    "複数行は1行目を題に、1行だけなら本文に。番号は章を飛ばして振り直す",
  );
  const match = /^plot-([0-9a-z]+)-(\d+)$/;
  assert.deepEqual(added.map((item) => item.id.match(match)?.[2]), ["0", "1"], "ID の連番は空を除いた順");
  const stamp = added[0].id.match(match)[1];
  assert.ok(stamp >= before && stamp <= after, "ID の時刻は受け取ったとき");
  assert.equal(app.plotCards[1].num, "001");
  assert.equal(app.rightSidebarTab, "plot");
  assert.equal(app.collapsed, false);
  assert.deepEqual(app.toasts, ["2 件をプロットへ追加しました"]);
}

console.log("plot card actions: ok");
