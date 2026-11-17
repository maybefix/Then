import assert from "node:assert/strict";
import { build } from "esbuild";

// BINDER 3-2（docs/BINDER_LINK_SYNTAX_PLAN.md）の、本文のリンクを押したときの流れ。
// 行き先が1つなら開く、2つ以上なら選んでもらう、直したら保存してから開く、
// 通知の「元に戻す」で直す前の本文へ戻す（変わっていたら戻さない）。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/links/linkOpenActions.ts"; export * from "./src/links/linkIndex.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { createLinkOpenActions, LinkIndex } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const ROOT = "C:\\Novel";
const p = (relative) => ROOT + "\\" + relative.split("/").join("\\");

async function makeIndex() {
  const index = new LinkIndex(ROOT);
  await index.refresh(
    [
      { path: p("第一章.md"), kind: "text", modifiedAt: 1, size: 10, role: null },
      { path: p("素材/汐見.md"), kind: "text", modifiedAt: 1, size: 10, role: "material" },
      { path: p("素材/人物/汐見.md"), kind: "text", modifiedAt: 1, size: 10, role: "material" },
      { path: p("素材/灯台.md"), kind: "text", modifiedAt: 1, size: 10, role: "material" },
    ],
    async () => "",
    () => null,
  );
  return index;
}

/** 画面とファイルの代わり。呼ばれたことを記録する。 */
function makeDeps(index, { chooses = null, tabMarkdown = "// [[汐見]] のこと", file = null } = {}) {
  const calls = { opened: [], toasts: [], saved: 0, options: null, applied: [], wrote: [], read: [] };
  let activeMarkdown = tabMarkdown;
  let tabOpen = true;
  const deps = {
    workRoot: () => ROOT,
    index: () => index,
    relativePath: (root, path) => path.slice(root.length + 1).split("\\").join("/"),
    requestOption: async (options) => {
      calls.options = options;
      return chooses;
    },
    showToast: (message, action) => calls.toasts.push({ message, action: action ?? null }),
    openFile: async (path) => { calls.opened.push(path); },
    activeTab: () => (tabOpen ? { id: "tab-1", path: p("第一章.md"), markdown: activeMarkdown } : null),
    saveActive: async () => { calls.saved += 1; },
    openTab: (id) => (tabOpen && id === "tab-1"
      ? { path: p("第一章.md"), markdown: activeMarkdown, isActive: true }
      : null),
    readFile: async (path) => { calls.read.push(path); if (!file) throw new Error("no file"); return file; },
    writeFile: async (path, content) => { calls.wrote.push({ path, content }); },
    applyToActiveTab: (tab, text) => { calls.applied.push({ id: tab.id, text }); activeMarkdown = text; },
    applyToBackgroundTab: async (tab, text) => { calls.applied.push({ id: tab.id, text, background: true }); },
  };
  return {
    calls,
    deps,
    actions: createLinkOpenActions({ get current() { return deps; } }),
    /** エディタが本文を書き換えたことにする。 */
    rewrite: (next) => { activeMarkdown = activeMarkdown.replace("[[汐見]]", `[[${next}]]`); },
    setMarkdown: (text) => { activeMarkdown = text; },
    closeTab: () => { tabOpen = false; },
    markdown: () => activeMarkdown,
  };
}

const index = await makeIndex();

// 1. 行き先が1つならそのまま開く
{
  const h = makeDeps(index);
  await h.actions.activate({ kind: "name", target: "灯台", rewriteTarget: () => assert.fail("書き換えない") });
  assert.deepEqual(h.calls.opened, [p("素材/灯台.md")]);
  assert.equal(h.calls.options, null, "1つに決まるなら選ばせない");
  assert.deepEqual(h.calls.toasts, []);
}

// 2. 行き先がなければ何もしない
{
  const h = makeDeps(index);
  await h.actions.activate({ kind: "name", target: "いない人", rewriteTarget: () => assert.fail("書き換えない") });
  assert.deepEqual(h.calls.opened, []);
  assert.equal(h.calls.options, null);
}

// 3. 2つ以上なら、開くことと直すことを一緒に選ばせる
{
  const h = makeDeps(index, { chooses: null });
  await h.actions.activate({ kind: "name", target: "汐見", rewriteTarget: () => assert.fail("書き換えない") });
  assert.equal(h.calls.options.title, "リンクの行き先");
  assert.equal(h.calls.options.message, "[[汐見]]");
  assert.deepEqual(h.calls.options.options.map((option) => option.label), [
    "「素材/汐見」を開く",
    "リンクを「素材/汐見」に直して開く",
    "「人物/汐見」を開く",
    "リンクを「人物/汐見」に直して開く",
  ]);
  assert.deepEqual(h.calls.options.options.map((option) => option.description ?? null), [
    "素材/汐見.md", null, "素材/人物/汐見.md", null,
  ]);
  assert.deepEqual(h.calls.opened, [], "キャンセルなら開かない");
}

// 4.「開く」は本文を変えない
{
  const h = makeDeps(index, { chooses: "open:1" });
  await h.actions.activate({ kind: "name", target: "汐見", rewriteTarget: () => assert.fail("書き換えない") });
  assert.deepEqual(h.calls.opened, [p("素材/人物/汐見.md")]);
  assert.equal(h.calls.saved, 0);
  assert.deepEqual(h.calls.toasts, []);
}

// 5.「直して開く」は、直す → その場で保存 → 開く。通知に「元に戻す」が付く
{
  const h = makeDeps(index, { chooses: "fix:1" });
  await h.actions.activate({ kind: "name", target: "汐見", rewriteTarget: (next) => h.rewrite(next) });
  assert.equal(h.markdown(), "// [[人物/汐見]] のこと");
  assert.equal(h.calls.saved, 1, "遅延保存を待たずに書く");
  assert.deepEqual(h.calls.opened, [p("素材/人物/汐見.md")]);
  assert.equal(h.calls.toasts[0].message, "リンクを「人物/汐見」に直しました");
  assert.equal(h.calls.toasts[0].action.label, "元に戻す");

  // 6. 元に戻すと、直す前の本文に戻る
  h.calls.toasts[0].action.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.calls.applied, [{ id: "tab-1", text: "// [[汐見]] のこと" }]);
  assert.equal(h.calls.toasts[1].message, "リンクを「汐見」に戻しました");
}

// 7. 直したあとに書き足されていたら戻さない
{
  const h = makeDeps(index, { chooses: "fix:0" });
  await h.actions.activate({ kind: "name", target: "汐見", rewriteTarget: (next) => h.rewrite(next) });
  h.setMarkdown("// [[素材/汐見]] のこと（書き足した）");
  h.calls.toasts[0].action.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.calls.applied, [], "本文が変わっていたら書かない");
  assert.equal(h.calls.toasts[1].message, "リンクを戻しませんでした（そのファイルが変わっています）");
}

// 8. タブを閉じていたら、読んだときのハッシュを付けてファイルへ書く
{
  const h = makeDeps(index, { chooses: "fix:0", file: { content: "// [[素材/汐見]] のこと", contentHash: "h1" } });
  await h.actions.activate({ kind: "name", target: "汐見", rewriteTarget: (next) => h.rewrite(next) });
  h.closeTab();
  h.calls.toasts[0].action.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.calls.read, [p("第一章.md")]);
  assert.deepEqual(h.calls.wrote, [{ path: p("第一章.md"), content: "// [[汐見]] のこと" }]);
  assert.equal(h.calls.toasts[1].message, "リンクを「汐見」に戻しました");
}

// 9. ファイルが外で変わっていたら戻さない
{
  const h = makeDeps(index, { chooses: "fix:0", file: { content: "ほかのアプリが書いた", contentHash: "h2" } });
  await h.actions.activate({ kind: "name", target: "汐見", rewriteTarget: (next) => h.rewrite(next) });
  h.closeTab();
  h.calls.toasts[0].action.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.calls.wrote, []);
  assert.equal(h.calls.toasts[1].message, "リンクを戻しませんでした（そのファイルが変わっています）");
}

console.log("link open action tests passed");
