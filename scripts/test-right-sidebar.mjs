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
  rightSidebarTab: "plot",
  isDockedPluginRuntimeVisible: false,
  hasOpenedDraft: false,
  projectFolder: null,
  draftCanvasContext: null,
  activePluginView: null,
  documentKey: "doc",
  frontMatter: { hasFrontMatter: false, metadata: "", body: "" },
  propertyTypeSettings: {},
  editorText: "本文",
  settings: {
    proofread: { ...(DEFAULT_PROOFREAD_OPTIONS ?? {}), disabledRules: [], disabledChecks: [] },
    ai: { provider: null, models: {}, defaultMode: "consult", localEndpoint: "" },
  },
  projectProofreadTerms: [],
  appState: { proofreadTerms: [] },
  projectProofreadIgnored: {},
  proofreadIgnoreKey: "doc",
  snippets: [],
  aiInsertRequest: null,
  plotCards: [],
  sortedReferenceCandidates: [],
  isPlotManagerOpen: false,
  transferMenuLabel: null,
  referenceLayout: { ideaThreads: [] },
  draggingId: null,
  ideaFocusRequest: null,
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
  plot: /class="rightSidebarBody plotRightSidebarBody"/,
  idea: /class="binderPane"/,
  ai: /class="aiPane"/,
  proof: /class="proofPane"/,
  properties: /class="propertiesPanel"/,
};
for (const [tab, marker] of Object.entries(panes)) {
  const html = render({ rightSidebarTab: tab });
  assert.match(html, marker, `${tab}: its pane is shown`);
  for (const [other, otherMarker] of Object.entries(panes)) {
    if (other !== tab) assert.doesNotMatch(html, otherMarker, `${tab}: the ${other} pane is not shown`);
  }
}
assert.match(render({ rightSidebarTab: "plot" }), /aria-label="プロット操作"/, "plot: the plot header actions are shown");
assert.match(render({ rightSidebarTab: "idea" }), /aria-label="バインダー操作"/, "idea: the binder header actions are shown");
assert.doesNotMatch(render({ rightSidebarTab: "ai" }), /プロット操作|バインダー操作/, "ai: no header actions of other tabs");

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
assert.match(render({ rightSidebarTab: "plot", hasOpenedDraft: true }), /<div class="draftPaneHost" hidden="">/, "the opened draft pane stays mounted but hidden");

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
  for (const name of ["normalizeRightSidebarCollapsed", "normalizeRightSidebarWide"]) {
    assert.equal(typeof state[name], "function", `${name} reads the stored value back`);
    assert.equal(state[name](true), true, name);
    // 古い状態（項目なし）と知らない値は、開いた・広げていない状態として読む。
    for (const value of [undefined, null, false, "true", 1]) {
      assert.equal(state[name](value), false, `${name}(${JSON.stringify(value)})`);
    }
  }

  // App が、読み込み・起動時の復元・変えたときの保存をつないでいること（App は大きく node で組めないので、ソースで見る）。
  const app = await readFile("src/App.tsx", "utf8");
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
}

console.log("right sidebar tests passed");
