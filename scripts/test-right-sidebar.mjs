// 右サイドバー（RightSidebar）を実際に描画して、タブごとに出る中身と、
// 畳む・広げる・プラグインの表示が、App から渡した値のとおりになるかを確かめる。
import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `right-sidebar-${process.pid}.mjs`);
const bundled = await build({
  entryPoints: ["src/components/layout/RightSidebar.tsx"],
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
const { RightSidebar } = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));
const { DEFAULT_PROOFREAD_OPTIONS } = await import(pathToFileURL(path.join(process.cwd(), "src/proofread/types.ts")).href)
  .catch(() => ({ DEFAULT_PROOFREAD_OPTIONS: null }));
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const consoleError = console.error;
console.error = (message, ...rest) => {
  if (String(message).includes("useLayoutEffect does nothing on the server")) return;
  consoleError(message, ...rest);
};

const calls = [];
const values = {
  isRightSidebarWide: false,
  isRightSidebarCollapsed: false,
  appMode: "write",
  isEditorFocusMode: false,
  pluginViews: [{ pluginId: "demo", id: "notes", title: "メモ帳" }],
  loadedPlugins: [],
  rightSidebarTab: "idea",
  isDockedPluginRuntimeVisible: false,
  hasOpenedDraft: false,
  projectFolder: null,
  scene: { markdown: "---\nsynopsis: 書庫の手紙。\n---\n本文", onChangeMarkdown: () => {}, progress: "writing", onSetProgress: () => {} },
  draftCanvasContext: null,
  activePluginView: null,
  documentKey: "doc",
  frontMatter: { hasFrontMatter: false, metadata: "", body: "" },
  propertyTypeSettings: {},
  editorText: "本文",
  settings: {
    proofread: { ...(DEFAULT_PROOFREAD_OPTIONS ?? {}), disabledRules: [], disabledChecks: [] },
  },
  projectProofreadTerms: [],
  appState: { proofreadTerms: [] },
  projectProofreadIgnored: {},
  proofreadIgnoreKey: "doc",
  snippets: [],
  sortedReferenceCandidates: [],
  transferMenuLabel: null,
  referenceLayout: { ideaThreads: [] },
  draggingId: null,
  ideaFocusRequest: null,
  // 投稿の流れ（BINDER 2-1）。
  postStream: { scoped: true, available: true, posts: [], work: undefined, add: async () => true, editBody: async () => true, setFiled: async () => {}, remove: async () => {}, refresh: async () => {} },
  postFilter: "inbox",
};
const render = (overrides = {}) => {
  const props = new Proxy({ ...values, ...overrides }, {
    get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, args])),
    has: () => true,
  });
  return renderToStaticMarkup(createElement(RightSidebar, props));
};

// Server rendering does not run effects, so each pane only shows what it draws first.
const panes = {
  idea: /class="ideaPane postStreamPane"/,
  proof: /class="proofPane"/,
  properties: /class="propertiesPanel"/,
  scene: /class="scenePane"/,
};
for (const [tab, marker] of Object.entries(panes)) {
  const html = render({ rightSidebarTab: tab });
  assert.match(html, marker, `${tab}: its pane is shown`);
  for (const [other, otherMarker] of Object.entries(panes)) {
    if (other !== tab) assert.doesNotMatch(html, otherMarker, `${tab}: the ${other} pane is not shown`);
  }
}
// BINDER 2-1: 「アイデア」は投稿の流れ。今の Idea は、中身があるときだけ「以前のアイデア」から開く（2-4 で移すまで）。
{
  const empty = render({ rightSidebarTab: "idea" });
  // 後退 R1: 古い Idea が空でも「以前のアイデア」を出す。資料の取り込み・新しいテキスト資料・スレッドの作成は、ここにしか入口がない。
  assert.match(empty, />以前のアイデア</, "no old ideas: the way to the current Idea is still offered");
  assert.doesNotMatch(empty, /class="binderPane"/, "the old pane opens only when asked");
  assert.match(empty, />受信箱</, "the inbox filter is offered");
  assert.match(empty, />すべて</, "the all filter is offered");
  assert.doesNotMatch(empty, />この作品</, "no open work: no this-work filter");
  const withWork = render({ rightSidebarTab: "idea", postStream: { ...values.postStream, work: { id: "w-1", name: "作品A" } } });
  assert.match(withWork, />この作品</, "an open work offers the this-work filter");
  const oldIdeas = [{ id: "idea-inbox", kind: "inbox", title: "インボックス", starred: false, createdAt: 0, updatedAt: 0, fragments: [{ id: "f1", body: "古い断片", used: false, createdAt: 0, updatedAt: 0 }] }];
  const withOld = render({ rightSidebarTab: "idea", snippets: oldIdeas });
  assert.match(withOld, />以前のアイデア</, "old ideas: the way to them is offered");
  assert.doesNotMatch(withOld, /class="binderPane"/, "the old pane opens only when asked");
  // 後退 R3: フォルダを開いていないときは、今の Idea（資料のクリップを含む）をそのまま出す。
  const noFolder = render({ rightSidebarTab: "idea", postStream: { ...values.postStream, scoped: false, available: false } });
  assert.match(noFolder, /class="binderPane"/, "no folder: the current Idea is shown");
  assert.match(noFolder, /aria-label="資料を追加"/, "no folder: references can still be added");
}
// 「プロット」は BINDER 1-6 でなくなった。切り替えにも出さない。
assert.doesNotMatch(render(), /aria-label="補助ペイン：プロット"|プロット操作|plotPane"/, "the removed plot pane is not offered");
assert.match(render({ rightSidebarTab: "idea" }), /aria-label="アイデア操作"/, "idea: the idea header actions are shown");
assert.doesNotMatch(render({ rightSidebarTab: "proof" }), /アイデア操作/, "proof: no header actions of other tabs");
assert.doesNotMatch(render(), /aria-label="補助ペイン：AI"|class="aiPane"/, "the removed AI pane is not offered");

const open = render();
assert.match(open, /<aside class="rightSidebar " aria-label="補助ペイン" aria-hidden="false">/, "open: the sidebar is visible and not inert");
assert.match(open, /aria-label="ペイン幅を拡張"/);
assert.doesNotMatch(open, /draftPaneHost/, "the draft pane is not mounted before it is opened");

const collapsed = render({ isRightSidebarCollapsed: true });
assert.match(collapsed, /class="rightSidebar  collapsedRightSidebar"[^>]*aria-hidden="true"[^>]*inert=""/, "collapsed: hidden and inert");
assert.match(render({ isEditorFocusMode: true }), /aria-hidden="true"[^>]*inert=""/, "focus mode: hidden and inert");
assert.match(render({ appMode: "plugin" }), /aria-hidden="true"[^>]*inert=""/, "plugin screen: hidden and inert");

const wide = render({ isRightSidebarWide: true });
assert.match(wide, /class="rightSidebar wideRightSidebar"/);
assert.match(wide, /aria-label="ペイン幅を戻す"/);

const draft = render({ rightSidebarTab: "draft", hasOpenedDraft: true });
assert.match(draft, /<div class="draftPaneHost">/, "draft: the draft pane is shown");
assert.doesNotMatch(draft, new RegExp(Object.values(panes).map((re) => re.source).join("|")), "draft: no other pane");
assert.match(render({ rightSidebarTab: "idea", hasOpenedDraft: true }), /<div class="draftPaneHost" hidden="">/, "the opened draft pane stays mounted but hidden");

const pluginView = values.pluginViews[0];
const plugin = render({ rightSidebarTab: "plugin:demo:notes", activePluginView: pluginView, isDockedPluginRuntimeVisible: true });
assert.match(plugin, /<div class="pluginViewBody" aria-label="メモ帳"><\/div>/, "plugin: the plugin view body is shown");
assert.match(plugin, /aria-label="補助ペイン：メモ帳"/, "plugin: the pane switcher names the plugin view");
assert.match(plugin, /class="pluginPaneInitial">メ</, "plugin: a view without an icon shows its initial");
assert.match(plugin, /class="pluginRuntimeAnchor visiblePluginRuntimeAnchor"/, "plugin: the runtime anchor is visible");
assert.doesNotMatch(render(), /visiblePluginRuntimeAnchor/, "no plugin: the runtime anchor is not visible");

// --- 畳みと幅の保存と復元（再起動しても戻る。タブと同じく、アプリ全体で1つ） ---
{
  const stateCode = ts.transpileModule(await readFile("src/utils/rightSidebarState.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const state = await import(`data:text/javascript;base64,${Buffer.from(stateCode).toString("base64")}`);
  assert.equal(state.normalizeRightSidebarTab("ai"), "idea", "a stored AI tab returns to idea");
  assert.equal(state.normalizeRightSidebarTab("plot"), "idea", "a stored plot tab returns to idea (BINDER 1-6)");
  assert.equal(state.normalizeRightSidebarTab("scene"), "scene", "a stored この場面 comes back (BINDER 1-7)");
  for (const name of ["normalizeRightSidebarCollapsed", "normalizeRightSidebarWide"]) {
    assert.equal(typeof state[name], "function", `${name} reads the stored value back`);
    assert.equal(state[name](true), true, name);
    // 古い状態（項目なし）と知らない値は、開いた・広げていない状態として読む。
    for (const value of [undefined, null, false, "true", 1]) {
      assert.equal(state[name](value), false, `${name}(${JSON.stringify(value)})`);
    }
  }

  // App が、読み込み・起動時の復元・変えたときの保存をつないでいること（App は大きく node で組めないので、ソースで見る）。
  // 保存状態の正規化（normalizeState）は storedStateModel.ts へ移した。
  const app = [
    await readFile("src/App.tsx", "utf8"),
    await readFile("src/storedStateModel.ts", "utf8"),
  ].join("\n");
  assert.match(app, /rightSidebarCollapsed: normalizeRightSidebarCollapsed\(value\?\.rightSidebarCollapsed\)/);
  assert.match(app, /rightSidebarWide: normalizeRightSidebarWide\(value\?\.rightSidebarWide\)/);
  assert.match(app, /setIsRightSidebarCollapsedState\(state\.rightSidebarCollapsed\)/);
  assert.match(app, /setIsRightSidebarWideState\(state\.rightSidebarWide\)/);
  assert.match(app, /current\.rightSidebarCollapsed === collapsed/);
  assert.match(app, /current\.rightSidebarWide === wide/);
  // 画面の値を直接書くのは、保存もする関数と起動時の復元の2か所だけ（ほかの変更は全部、保存する関数を通る）。
  assert.equal(app.match(/setIsRightSidebarCollapsedState\(/g)?.length, 2, "only the saving setter and the restore set the collapse");
  assert.equal(app.match(/setIsRightSidebarWideState\(/g)?.length, 2, "only the saving setter and the restore set the width");
  // 幅のボタンは、今の値をひっくり返す関数ではなく、次の値を渡す（保存する関数は値を受け取る）。
  const sidebar = await readFile("src/components/layout/RightSidebar.tsx", "utf8");
  assert.match(sidebar, /onClick=\{\(\) => setIsRightSidebarWide\(!isRightSidebarWide\)\}/);

  // 「この場面」（BINDER 1-7）: 概要はプロパティ欄と同じ書き込み口へ、進捗はバインダーと同じ保存へ、一覧の項目のパスで。
  assert.match(app, /onChangeMarkdown: \(next: string\) => updateFrontMatter\(parseFrontMatter\(next\)\.metadata\)/);
  assert.match(app, /if \(sceneProgressPath\) handleSetFileProgress\(sceneProgressPath, status\)/);
  assert.match(app, /sceneEntry\?\.kind === "file" && sceneEntry\.role !== "material" \? sceneEntry\.path : null/);
}

// --- 切り替えに出るペインの並び（BINDER 1-7 の前に固定する） ---
// 描画した切り替えは選ばれているペインしか出さないので、切り替えを全部の項目を並べる代わりのものに差し替えて組む。
{
  const listedPath = path.join(tmpDir, `right-sidebar-listed-${process.pid}.mjs`);
  const listed = await build({
    entryPoints: ["src/components/layout/RightSidebar.tsx"],
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    loader: { ".css": "empty" },
    external: ["react", "react-dom", "react/jsx-runtime"],
    write: false,
    logLevel: "error",
    plugins: [{
      name: "list-panes",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /\/RightPaneSwitcher$/ }, () => ({ path: "switcher", namespace: "list-panes" }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "list-panes" }, () => ({
          contents: `import { createElement } from "react";
export function RightPaneSwitcher({ items, activeId }) {
  return createElement("ol", { "data-active": activeId }, items.map((item) => createElement("li", { key: item.id, "data-id": item.id }, item.label)));
}`,
          loader: "js",
          resolveDir: process.cwd(),
        }));
      },
    }],
  });
  await writeFile(listedPath, listed.outputFiles[0].text);
  const { RightSidebar: ListedSidebar } = await import(pathToFileURL(listedPath).href).finally(() => unlink(listedPath));
  const renderListed = (overrides = {}) => {
    const props = new Proxy({ ...values, ...overrides }, {
      get: (target, key) => (key in target ? target[key] : () => {}),
      has: () => true,
    });
    return renderToStaticMarkup(createElement(ListedSidebar, props));
  };
  const panes = [...renderListed().matchAll(/<li data-id="([^"]+)">([^<]*)<\/li>/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(panes, ["scene:この場面", "idea:アイデア", "proof:校正", "draft:中間稿", "properties:プロパティ", "plugin:demo:notes:メモ帳"], "the panes offered, in order (BINDER 1-7: この場面 first)");
}

console.log("right sidebar tests passed");
