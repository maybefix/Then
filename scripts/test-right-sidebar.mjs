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
const { RightSidebar, auxiliaryPanelItems } = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));
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
  active: true,
  pluginViews: [{ pluginId: "demo", id: "notes", title: "メモ帳" }],
  loadedPlugins: [],
  panelId: "idea",
  projectFolder: null,
  scene: { markdown: "---\nsynopsis: 書庫の手紙。\n---\n本文", onChangeMarkdown: () => {}, progress: "writing", onSetProgress: () => {} },
  connections: { index: null, version: 0, document: null, posts: [], boards: [], onOpenFile: () => {}, onOpenPost: () => {}, onOpenBoard: () => {} },
  postReveal: null,
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
  // 投稿の流れ（BINDER 2-1）。
  postStream: { scoped: true, available: true, posts: [], work: undefined, add: async () => true, editBody: async () => true, setFiled: async () => {}, remove: async () => {}, refresh: async () => {} },
  postFilter: "inbox",
  // 投稿の側の置かれているボード（docs/BINDER_POST_CARD_FOLLOWUPS_PLAN.md）。
  postBoards: { places: new Map(), open: () => {} },
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
  connections: /class="connectionsPane"/,
};
for (const [tab, marker] of Object.entries(panes)) {
  const html = render({ panelId: tab });
  assert.match(html, marker, `${tab}: its pane is shown`);
  for (const [other, otherMarker] of Object.entries(panes)) {
    if (other !== tab) assert.doesNotMatch(html, otherMarker, `${tab}: the ${other} pane is not shown`);
  }
}
// BINDER 2-1: 「アイデア」は投稿の流れ。2-4 で Idea を投稿とノートへ移し、「以前のアイデア」を外した。
// 資料の取り込みは素材の段の「資料を取り込む…」、テキスト資料とスレッドの代わりはノート（2-4 の手順書 5-2）。
{
  const empty = render({ panelId: "idea" });
  assert.doesNotMatch(empty, /以前のアイデア/, "the old Idea view is gone");
  assert.doesNotMatch(empty, /class="binderPane"/, "the old Idea pane is gone");
  assert.match(empty, />受信箱</, "the inbox filter is offered");
  assert.match(empty, />すべて</, "the all filter is offered");
  assert.doesNotMatch(empty, />この作品</, "no open work: no this-work filter");
  const withWork = render({ panelId: "idea", postStream: { ...values.postStream, work: { id: "w-1", name: "作品A" } } });
  assert.match(withWork, />この作品</, "an open work offers the this-work filter");
  // フォルダを開いていないときは、投稿を書く場所がないので投稿の欄を出さない。
  const noFolder = render({ panelId: "idea", postStream: { ...values.postStream, scoped: false, available: false } });
  assert.match(noFolder, /class="ideaPane postStreamPane"/, "no folder: the pane is there");
  assert.doesNotMatch(noFolder, /aria-label="投稿"|class="binderPane"/, "no folder: no post box and no old Idea");
}
// 「プロット」は BINDER 1-6 でなくなった。切り替えにも出さない。
assert.doesNotMatch(render(), /aria-label="補助ペイン：プロット"|プロット操作|plotPane"/, "the removed plot pane is not offered");
assert.doesNotMatch(render(), /class="aiPane"|draftPaneHost|中間稿/, "removed panes stay unavailable");
assert.match(render(), /class="rightSidebarBody floatingAuxiliaryBody"/);

const pluginView = values.pluginViews[0];
const plugin = render({ panelId: "plugin:demo:notes", activePluginView: pluginView });
assert.match(plugin, /<div class="pluginViewBody" aria-label="メモ帳"><\/div>/, "plugin: the plugin view body is shown");
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
  assert.equal(state.normalizeRightSidebarTab("connections"), "connections", "a stored つながり comes back (BINDER 3-4)");
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
  assert.match(app, /state\.rightSidebarCollapsed \? null : state\.rightSidebarTab/);
  assert.match(app, /migratePanels\([\s\S]*?state\.rightSidebarWide/);

  // 「この場面」（BINDER 1-7）: 概要はプロパティ欄と同じ書き込み口へ、進捗はバインダーと同じ保存へ、一覧の項目のパスで。
  assert.match(app, /onChangeMarkdown: \(next: string\) => updateFrontMatter\(parseFrontMatter\(next\)\.metadata\)/);
  assert.match(app, /if \(sceneProgressPath\) handleSetFileProgress\(sceneProgressPath, status\)/);
  assert.match(app, /sceneEntry\?\.kind === "file" && sceneEntry\.role !== "material" \? sceneEntry\.path : null/);
}

const items = auxiliaryPanelItems(values.pluginViews, values.loadedPlugins);
assert.deepEqual(items.map(({ id, label }) => `${id}:${label}`),
  ["scene:この場面", "connections:つながり", "idea:アイデア", "proof:校正", "properties:プロパティ", "plugin:demo:notes:メモ帳"]);
assert.equal(items.find((item) => item.id === "plugin:demo:notes").icon.props.children, "メ");

console.log("right sidebar tests passed");
