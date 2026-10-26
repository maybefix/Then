import assert from "node:assert/strict";
import { build } from "esbuild";

// App.tsx から移した、プラグインの受け口（pluginHostActions）と、プラグインの値・読み込み・
// アンカーの保存（usePluginHost）を、実際に動かして確かめる（docs/PLUGIN_HOST_SEPARATION_PLAN.md）。
// Rust の命令（invoke）とタイマーは入れ物で代える。react は、描画の順に useState・useRef・
// useCallback・useEffect を覚える小さな入れ物に差し替え、App の描画と同じく、値が変わるたびに
// フックを呼び直して effect を流す。
const bundled = await build({
  stdin: {
    contents: [
      'export { createPluginHostActions } from "./src/plugins/pluginHostActions.ts";',
      'export { usePluginHost } from "./src/plugins/usePluginHost.ts";',
      'export { flushPendingSaves } from "./src/pendingSaves.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  define: { "import.meta.env.DEV": "false" },
  plugins: [
    {
      name: "stubs",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "invoke", namespace: "stub" }));
        builder.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "stub" }));
        builder.onLoad({ filter: /^invoke$/, namespace: "stub" }, () => ({
          contents: "export const invoke = (command, args) => globalThis.__pluginInvoke(command, args);",
          loader: "js",
        }));
        builder.onLoad({ filter: /^react$/, namespace: "stub" }, () => ({
          contents: `
            const hooks = () => globalThis.__pluginHooks;
            const slot = (create) => {
              const state = hooks();
              const index = state.index++;
              if (!(index in state.slots)) state.slots[index] = create();
              return state.slots[index];
            };
            const changed = (previous, next) =>
              !previous || !next || previous.length !== next.length || previous.some((value, i) => !Object.is(value, next[i]));
            export function useState(initial) {
              const hook = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
              if (!hook.set) {
                hook.set = (next) => {
                  const value = typeof next === "function" ? next(hook.value) : next;
                  if (!Object.is(value, hook.value)) {
                    hook.value = value;
                    hooks().dirty = true;
                  }
                };
              }
              return [hook.value, hook.set];
            }
            export function useRef(initial) {
              return slot(() => ({ current: initial }));
            }
            export function useCallback(fn, deps) {
              const hook = slot(() => ({}));
              if (!hook.fn || changed(hook.deps, deps)) {
                hook.fn = fn;
                hook.deps = deps;
              }
              return hook.fn;
            }
            export function useEffect(fn, deps) {
              const hook = slot(() => ({ first: true }));
              if (hook.first || changed(hook.deps, deps)) {
                hook.first = false;
                hook.deps = deps;
                hooks().pending.push({ hook, fn });
              }
            }
          `,
          loader: "js",
        }));
      },
    },
  ],
});
const { createPluginHostActions, usePluginHost, flushPendingSaves } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const ROOT = "C:\\Novel";
const OTHER = "C:\\Other";
const p = (...parts) => [ROOT, ...parts].join("\\");
const file = (path) => ({ path, name: path.split("\\").pop(), kind: "file", children: [] });
const folder = (path, children) => ({ path, name: path.split("\\").pop(), kind: "folder", children });
const novel = () => ({
  path: ROOT,
  name: "Novel",
  children: [folder(p("第一章"), [file(p("第一章", "a.txt")), file(p("第一章", "b.txt"))]), file(p("c.txt"))],
});
const other = () => ({ path: OTHER, name: "Other", children: [file(`${OTHER}\\x.txt`)] });
const plugin = (id, permissions, extra = {}) => ({
  manifest: { id, name: `名前 ${id}`, version: "1.0.0", permissions, ...extra },
});
const ALL = ["document:selection", "document:navigate", "document:anchors", "views", "statusbar", "storage", "commands"];
const anchor = (id, documentPath, from, to, pluginId = "p") => ({
  id,
  pluginId,
  documentPath,
  from,
  to,
  selectedText: "",
  contextBefore: "",
  contextAfter: "",
  createdAt: 1,
  updatedAt: 1,
});

// ---- 入れ物: window・タイマー・invoke ----

const timers = new Map();
let nextTimer = 1;
const windowListeners = [];
const animationFrames = [];
const flushTimers = () => {
  for (const [id, callback] of [...timers]) {
    timers.delete(id);
    callback();
  }
};
const flushAnimationFrames = () => {
  while (animationFrames.length) animationFrames.shift()();
};
function resetWindow({ tauri = true } = {}) {
  timers.clear();
  windowListeners.length = 0;
  animationFrames.length = 0;
  globalThis.window = {
    ...(tauri ? { __TAURI_INTERNALS__: {} } : {}),
    setTimeout: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, listener, capture) => windowListeners.push({ type, listener, capture }),
    removeEventListener: (type, listener, capture) => {
      const index = windowListeners.findIndex(
        (item) => item.type === type && item.listener === listener && item.capture === capture,
      );
      if (index >= 0) windowListeners.splice(index, 1);
    },
    requestAnimationFrame: (callback) => animationFrames.push(callback),
  };
}

/** Rust 側の代わり。命令ごとの処理と、呼ばれた記録。 */
function createRust(handlers = {}) {
  const calls = [];
  globalThis.__pluginInvoke = async (command, args) => {
    calls.push([command, args]);
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected invoke ${command}`);
    return handler(args);
  };
  return calls;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ---- 受け口（createPluginHostActions） ----

// App の値と道具の代わり。頼みのたびに、最新の値で createPluginHostActions を作り直す（App の描画と同じ形）。
function setupActions({ plugins = [plugin("p", ALL)], projectFolder = novel(), currentFilePath = p("第一章", "a.txt") } = {}) {
  const editor = {
    text: "冒頭。追跡する範囲です。末尾。",
    selection: { from: 3, to: 5, head: 5, line: 1 },
    selected: [],
    focused: 0,
    getSelection() { return { ...this.selection }; },
    getValue() { return this.text; },
    selectRange(from, to) { this.selected.push([from, to]); },
    focus() { this.focused += 1; },
  };
  const app = {
    projectFolder,
    currentFilePath,
    editorText: editor.text,
    loadedPlugins: plugins,
    pluginCommands: [],
    pluginViews: [],
    pluginScreens: [],
    pluginModals: [],
    pluginStatusItems: [],
    activePluginModalKey: null,
    activePluginScreenKey: null,
    anchors: [],
    persisted: [],
    appModes: [],
    rightSidebarTabs: [],
    collapsed: [],
    opened: [],
    toasts: [],
    errors: [],
    confirms: [],
    confirmAnswer: true,
    reloads: 0,
  };
  const pluginAnchorsRef = { current: app.anchors };
  const pluginStorageQueuesRef = { current: new Map() };
  const setter = (key) => (next) => {
    app[key] = typeof next === "function" ? next(app[key]) : next;
  };
  const actions = () => createPluginHostActions({
    projectFolder: app.projectFolder,
    currentFilePath: app.currentFilePath,
    editorText: app.editorText,
    editorInstanceRef: { current: editor },
    handleProjectFileSelect: async (path) => {
      app.opened.push(path);
      app.currentFilePath = path;
    },
    setAppMode: (mode) => app.appModes.push(mode),
    setIsRightSidebarCollapsed: (collapsed) => app.collapsed.push(collapsed),
    setRightSidebarTab: (tab) => app.rightSidebarTabs.push(tab),
    loadedPlugins: app.loadedPlugins,
    pluginAnchorsRef,
    persistPluginAnchors: (anchors) => {
      app.persisted.push(anchors);
      pluginAnchorsRef.current = anchors;
    },
    pluginStorageQueuesRef,
    setPluginCommands: setter("pluginCommands"),
    setPluginViews: setter("pluginViews"),
    setPluginScreens: setter("pluginScreens"),
    setPluginModals: setter("pluginModals"),
    setPluginStatusItems: setter("pluginStatusItems"),
    pluginModals: app.pluginModals,
    pluginScreens: app.pluginScreens,
    pluginViews: app.pluginViews,
    activePluginModal: app.pluginModals.find(
      (modal) => app.activePluginModalKey === `${modal.pluginId}:${modal.id}`,
    ) ?? null,
    activePluginModalKey: app.activePluginModalKey,
    setActivePluginModalKey: setter("activePluginModalKey"),
    setActivePluginScreenKey: setter("activePluginScreenKey"),
    reloadInstalledPlugins: async () => {
      app.reloads += 1;
      return true;
    },
    requestConfirm: async (options) => {
      app.confirms.push(options);
      return app.confirmAnswer;
    },
    showToast: (message) => app.toasts.push(message),
    setLastError: (message) => app.errors.push(message),
  });
  const request = (method, args, pluginId = "p") => actions().handlePluginRequest({ pluginId, method, args });
  return { app, editor, actions, request, pluginAnchorsRef, pluginStorageQueuesRef };
}

// 読み込まれていないプラグインと、権限のない頼みは断る。
{
  resetWindow();
  createRust();
  const { request } = setupActions({ plugins: [plugin("p", ["views"])] });
  await assert.rejects(request("views.register", { id: "v", title: "V" }, "missing"), /プラグインが読み込まれていません/);
  await assert.rejects(request("commands.register", { id: "c", title: "C" }), /権限がありません: commands/);
  await assert.rejects(request("unknown.method", {}), /権限がありません: unknown\.method/);
}

// コマンド: 登録・同じ id での置き換え・ショートカットとメニューの確かめ・取り消し。
{
  resetWindow();
  createRust();
  const { app, request } = setupActions();
  assert.equal(await request("commands.register", { id: " c ", title: " 一つ目 ", keybinding: "Mod+Shift+K", menus: ["editor.selection"] }), true);
  assert.deepEqual(app.pluginCommands, [{ pluginId: "p", id: "c", title: "一つ目", keybinding: "Mod+Shift+K", menus: ["editor.selection"] }]);
  await request("commands.register", { id: "c", title: "置き換え" });
  assert.deepEqual(app.pluginCommands.map((command) => command.title), ["置き換え"], "the same id must replace the command");
  await assert.rejects(request("commands.register", { id: "d", title: "D", keybinding: "K" }), /ショートカットは Mod\/Ctrl\/Cmd を含む形式/);
  await assert.rejects(request("commands.register", { id: "d", title: "D", menus: ["editor.other"] }), /未対応のコマンドメニュー/);
  await assert.rejects(request("commands.register", { id: "", title: "D" }), /command id と title が必要です/);
  await request("commands.unregister", { id: "c" });
  assert.deepEqual(app.pluginCommands, []);
}

// 横の欄・画面: 登録、icon の確かめ、開く先。
{
  resetWindow();
  createRust();
  const { app, request } = setupActions({ plugins: [plugin("p", ALL), plugin("q", ALL, { icon: { paths: ["M0 0h1"] } })] });
  await request("views.register", { id: "side", title: "横", icon: { paths: ["M0 0h2"] } });
  assert.deepEqual(app.pluginViews, [{ pluginId: "p", id: "side", title: "横", icon: { paths: ["M0 0h2"] } }]);
  await assert.rejects(request("views.register", { id: "bad", title: "B", icon: { paths: ["<script>"] } }), /view iconは1〜8本/);
  await assert.rejects(request("views.registerScreen", { id: "full", title: "全面" }), /manifest\.jsonのiconが必要です/);
  await request("views.registerScreen", { id: "full", title: "全面" }, "q");
  assert.deepEqual(app.pluginScreens, [{ pluginId: "q", id: "full", title: "全面", icon: undefined }]);

  await request("views.open", { id: "side" });
  assert.deepEqual(app.appModes, ["write"]);
  assert.deepEqual(app.collapsed, [false]);
  assert.deepEqual(app.rightSidebarTabs, ["plugin:p:side"]);
  await request("views.open", { id: "full" }, "q");
  assert.equal(app.activePluginScreenKey, "q:full");
  assert.deepEqual(app.appModes, ["write", "plugin"]);
  await assert.rejects(request("views.open", { id: "none" }), /登録されていないviewです: none/);

  await request("views.unregister", { id: "side" });
  await request("views.unregisterScreen", { id: "full" }, "q");
  assert.deepEqual([app.pluginViews, app.pluginScreens], [[], []]);
}

// モーダル: 開いても今の画面のまま。閉じる・取り消すと、開いているモーダルを空にする。
{
  resetWindow();
  createRust();
  const { app, request } = setupActions();
  await request("views.registerModal", { id: "m", title: "重ねる" });
  await assert.rejects(request("views.openModal", { id: "none" }), /登録されていないmodalです/);
  await request("views.openModal", { id: "m" });
  assert.equal(app.activePluginModalKey, "p:m");
  assert.deepEqual(app.appModes, [], "opening a modal must keep the current screen");
  assert.equal(await request("views.closeModal", { id: "other" }), false);
  assert.equal(await request("views.closeModal", { id: "m" }), true);
  assert.equal(app.activePluginModalKey, null);
  assert.equal(await request("views.closeModal", {}), false, "nothing to close");
  await request("views.openModal", { id: "m" });
  await request("views.unregisterModal", { id: "m" });
  assert.deepEqual([app.pluginModals, app.activePluginModalKey], [[], null]);
}

// 状態表示: 160 文字まで。
{
  resetWindow();
  createRust();
  const { app, request } = setupActions();
  await assert.rejects(request("statusbar.set", { id: "s", text: "あ".repeat(161) }), /160文字以内/);
  await request("statusbar.set", { id: "s", text: " 進捗 ", tooltip: "説明", commandId: "c" });
  assert.deepEqual(app.pluginStatusItems, [{ pluginId: "p", id: "s", text: "進捗", tooltip: "説明", commandId: "c" }]);
  await request("statusbar.remove", { id: "s" });
  assert.deepEqual(app.pluginStatusItems, []);
}

// 選択範囲とカーソルの移動。別の文書へ移るときはファイルを開き、書くモードにしてから範囲を選ぶ。
{
  resetWindow();
  createRust();
  const { app, editor, request } = setupActions();
  assert.deepEqual(await request("editor.getSelection"), {
    documentPath: "第一章/a.txt",
    from: 3,
    to: 5,
    head: 5,
    line: 1,
    text: "追跡",
  });
  await assert.rejects(request("editor.moveCursor", { documentPath: "missing.txt" }), /文書が見つかりません: missing\.txt/);
  assert.equal(await request("editor.moveCursor", { documentPath: "c.txt", offset: 4 }), true);
  assert.deepEqual(app.opened, [p("c.txt")]);
  assert.deepEqual(app.appModes, ["write"], "a missing document must stop before switching modes");
  flushAnimationFrames();
  assert.deepEqual(editor.selected, [[4, 4]]);
  assert.equal(editor.focused, 1);
  await request("editor.moveCursor", { from: 1, to: 2 });
  assert.deepEqual(app.opened, [p("c.txt")], "the open document must not be reopened");
  flushAnimationFrames();
  assert.deepEqual(editor.selected, [[4, 4], [1, 2]]);
}

// アンカー: 作る・つなぎ直す・見せる・消す。
{
  resetWindow();
  createRust({ read_text_file: () => ({ content: "別の文書" }) });
  const { app, editor, request, pluginAnchorsRef } = setupActions();
  const created = await request("anchors.create");
  assert.equal(created.documentPath, "第一章/a.txt");
  assert.equal(created.selectedText, "追跡");
  assert.deepEqual(app.persisted, [[created]]);

  editor.text = `前書き。${editor.text}`;
  const resolved = await request("anchors.resolve", { anchorId: created.id });
  assert.equal(editor.text.slice(resolved.from, resolved.to), "追跡", "the anchor must reconnect to the edited text");
  assert.deepEqual(pluginAnchorsRef.current, [resolved], "a moved anchor must be saved");
  await request("anchors.reveal", { anchorId: created.id });
  flushAnimationFrames();
  assert.deepEqual(editor.selected.at(-1), [resolved.from, resolved.to]);
  await assert.rejects(request("anchors.resolve", { anchorId: "missing" }), /アンカーが見つかりません/);
  await assert.rejects(request("anchors.delete", { anchorId: created.id }, "other"), /プラグインが読み込まれていません/);

  // 癖4: 消せたときだけ true を返す（docs/PLUGIN_HOST_SEPARATION_PLAN.md 工程7）。
  assert.equal(await request("anchors.delete", { anchorId: "missing" }), false);
  assert.equal(await request("anchors.delete", { anchorId: created.id }), true, "deleting an existing anchor must answer true");
  assert.deepEqual(pluginAnchorsRef.current, []);
}
{
  resetWindow();
  createRust();
  const { request } = setupActions({ currentFilePath: "D:\\outside.txt" });
  await assert.rejects(request("anchors.create"), /プロジェクト外の文書にはアンカーを作成できません/);
}

// プラグインのデータ: 書き込みはプラグインごとに1つずつ。読むときは、待っている書き込みを待つ。
{
  resetWindow();
  const stored = new Map();
  const releases = [];
  let hold = true;
  const calls = createRust({
    load_plugin_project_data: ({ pluginId }) => ({ ...(stored.get(pluginId) ?? {}) }),
    save_plugin_project_data: ({ pluginId, data }) => !hold
      ? void stored.set(pluginId, data)
      : new Promise((resolve) => releases.push(() => {
        stored.set(pluginId, data);
        resolve();
      })),
  });
  const { request } = setupActions();
  await assert.rejects(request("storage.set", { key: "x".repeat(201), value: 1 }), /storage key が不正です/);
  const first = request("storage.set", { key: "a", value: 1 });
  const second = request("storage.set", { key: "b", value: 2 });
  const read = request("storage.get", { key: "a" });
  await settle();
  assert.deepEqual(calls.map(([command]) => command), ["load_plugin_project_data", "save_plugin_project_data"], "the second write must wait for the first");
  releases.shift()();
  await settle();
  releases.shift()();
  await Promise.all([first, second]);
  assert.equal(await read, 1);
  assert.deepEqual(stored.get("p"), { a: 1, b: 2 }, "the second write must start from the first write's data");
  hold = false;
  assert.equal(await request("storage.delete", { key: "a" }).then(() => request("storage.get", { key: "a" })), null);
}

// 導入: 選ぶ → 確かめる → 入れる → 読み込み直す。
{
  resetWindow({ tauri: false });
  createRust();
  const { app, actions } = setupActions();
  await actions().handleInstallPlugin();
  assert.deepEqual(app.toasts, ["デスクトップ版で利用してください"]);
}
{
  resetWindow();
  let candidate = null;
  const calls = createRust({
    inspect_plugin_dialog: () => candidate,
    install_plugin: ({ expectedManifest }) => ({ manifest: expectedManifest }),
  });
  const { app, actions } = setupActions();
  await actions().handleInstallPlugin();
  assert.deepEqual([app.confirms, app.reloads], [[], 0], "cancelling the folder dialog must do nothing");

  candidate = { sourcePath: "D:\\plugin", manifest: { id: "n", name: "新しい", version: "2.0.0", permissions: ["views", "storage"] } };
  app.confirmAnswer = false;
  await actions().handleInstallPlugin();
  assert.deepEqual(app.confirms.at(-1), {
    title: "プラグインを導入",
    message: "「新しい」v2.0.0 をThen全体へ導入しますか？",
    detail: "要求する権限: views / storage",
    confirmLabel: "導入",
  });
  assert.equal(calls.some(([command]) => command === "install_plugin"), false);

  app.confirmAnswer = true;
  candidate.manifest.permissions = [];
  await actions().handleInstallPlugin();
  assert.equal(app.confirms.at(-1).detail, "このプラグインはThen API権限を要求しません。");
  assert.deepEqual(calls.at(-1), ["install_plugin", { sourcePath: "D:\\plugin", expectedManifest: candidate.manifest }]);
  assert.equal(app.reloads, 1);
  assert.deepEqual(app.toasts, ["プラグイン「新しい」を導入しました"]);
}
{
  resetWindow();
  createRust({ inspect_plugin_dialog: () => { throw new Error("壊れた manifest"); } });
  const { app, actions } = setupActions();
  await actions().handleInstallPlugin();
  assert.deepEqual([app.errors, app.toasts], [["Error: 壊れた manifest"], ["プラグインを導入できませんでした"]]);
}

// 削除: 確かめてから消して、読み込み直す。
{
  resetWindow();
  let fail = false;
  const calls = createRust({ uninstall_plugin: () => { if (fail) throw new Error("使用中"); } });
  const { app, actions } = setupActions();
  const target = plugin("p", ALL);
  app.confirmAnswer = false;
  await actions().handleUninstallPlugin(target);
  assert.deepEqual(app.confirms[0], {
    title: "プラグインを削除",
    message: "「名前 p」v1.0.0 をThenから削除しますか？",
    detail: "プラグイン本体だけを削除します。各プロジェクトに保存されたデータと永続アンカーは、再導入時に復元できるよう残します。",
    confirmLabel: "削除",
    danger: true,
  });
  assert.deepEqual(calls, []);
  app.confirmAnswer = true;
  await actions().handleUninstallPlugin(target);
  assert.deepEqual(calls, [["uninstall_plugin", { pluginId: "p" }]]);
  assert.deepEqual([app.reloads, app.toasts], [1, ["プラグイン「名前 p」を削除しました"]]);
  fail = true;
  await actions().handleUninstallPlugin(target);
  assert.deepEqual([app.errors, app.toasts.at(-1)], [["Error: 使用中"], "プラグインを削除できませんでした"]);
}

// ---- 値・読み込み・アンカーの保存（usePluginHost） ----

// App の代わり。値が変わるたびにフックを呼び直し、effect を書いた順に流す（後片付けが先）。
function mountHost({ projectFolder = novel() } = {}) {
  globalThis.__pluginHooks = { slots: [], index: 0, pending: [], dirty: false };
  const app = {
    projectFolder,
    appMode: "write",
    rightSidebarTab: "plot",
    isRightSidebarCollapsed: false,
    isEditorFocusMode: false,
    errors: [],
  };
  let host = null;
  const render = () => {
    for (let round = 0; round < 20; round++) {
      const hooks = globalThis.__pluginHooks;
      hooks.index = 0;
      hooks.dirty = false;
      host = usePluginHost({
        projectFolder: app.projectFolder,
        setLastError: (message) => {
          app.errors.push(message);
        },
        appMode: app.appMode,
        setAppMode: (mode) => {
          app.appMode = mode;
          hooks.dirty = true;
        },
        rightSidebarTab: app.rightSidebarTab,
        setRightSidebarTab: (tab) => {
          app.rightSidebarTab = tab;
          hooks.dirty = true;
        },
        isRightSidebarCollapsed: app.isRightSidebarCollapsed,
        isEditorFocusMode: app.isEditorFocusMode,
      });
      const pending = hooks.pending.splice(0);
      for (const { hook } of pending) hook.cleanup?.();
      for (const { hook, fn } of pending) hook.cleanup = fn();
      if (!hooks.dirty) return host;
    }
    throw new Error("the host kept re-rendering");
  };
  const unmount = () => {
    for (const hook of globalThis.__pluginHooks.slots) hook?.cleanup?.();
  };
  return { app, render, unmount, get host() { return host; } };
}

// 起動: 導入したプラグインを読み込む。読めないものがあれば、上のエラー表示へ。
{
  resetWindow();
  const calls = createRust({
    list_installed_plugins: () => ({ plugins: [plugin("p", ALL)], errors: ["broken: manifest"] }),
    load_plugin_anchors: () => null,
  });
  const view = mountHost();
  view.render();
  await settle();
  view.render();
  assert.deepEqual(view.host.loadedPlugins.map((item) => item.manifest.id), ["p"]);
  assert.deepEqual(view.app.errors, ["読み込めないプラグインがあります: broken: manifest"]);
  assert.deepEqual(calls.map(([command]) => command), ["list_installed_plugins", "load_plugin_anchors"]);
}

// 読み込み直すと、登録されたものと開いているモーダルを空にする。
{
  resetWindow();
  createRust({ list_installed_plugins: () => ({ plugins: [plugin("p", ALL)], errors: [] }), load_plugin_anchors: () => null });
  const view = mountHost();
  view.render();
  await settle();
  view.render();
  view.host.setPluginCommands([{ pluginId: "p", id: "c", title: "C" }]);
  view.host.setPluginModals([{ pluginId: "p", id: "m", title: "M" }]);
  view.host.setActivePluginModalKey("p:m");
  view.render();
  assert.equal(view.host.activePluginModal?.id, "m");
  assert.equal(await view.host.reloadInstalledPlugins(), true);
  view.render();
  assert.deepEqual([view.host.pluginCommands, view.host.pluginModals, view.host.activePluginModalKey], [[], [], null]);
}

// 登録が消えたら、画面は書くモードへ、横の欄はプロットへ戻し、モーダルは閉じる。Esc でもモーダルを閉じる。
{
  resetWindow();
  createRust({ list_installed_plugins: () => ({ plugins: [], errors: [] }), load_plugin_anchors: () => null });
  const view = mountHost();
  view.render();
  view.host.setPluginScreens([{ pluginId: "p", id: "s", title: "S" }]);
  view.host.setPluginViews([{ pluginId: "p", id: "v", title: "V" }]);
  view.host.setActivePluginScreenKey("p:s");
  view.app.appMode = "plugin";
  view.render();
  assert.deepEqual(view.host.pluginRuntimeActiveView, { pluginId: "p", viewId: "s" });
  assert.equal(view.host.isDockedPluginRuntimeVisible, true);
  view.host.setPluginScreens([]);
  view.render();
  assert.equal(view.app.appMode, "write", "a removed screen must send the app back to writing");

  view.app.rightSidebarTab = "plugin:p:v";
  view.render();
  assert.equal(view.host.activePluginView?.id, "v");
  view.host.setPluginViews([]);
  view.render();
  assert.equal(view.app.rightSidebarTab, "plot");

  view.host.setPluginModals([{ pluginId: "p", id: "m", title: "M" }]);
  view.host.setActivePluginModalKey("p:m");
  view.render();
  const escape = windowListeners.find((item) => item.type === "keydown" && item.capture === true);
  assert.ok(escape, "an open modal must listen for Escape");
  const event = { key: "Escape", prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  escape.listener(event);
  view.render();
  assert.deepEqual([view.host.activePluginModalKey, event.prevented, event.stopped], [null, true, true]);
  assert.equal(windowListeners.some((item) => item.type === "keydown"), false, "closing the modal must remove the Escape listener");

  view.host.setActivePluginModalKey("p:missing");
  view.render();
  assert.equal(view.host.activePluginModalKey, null, "a modal key without a registered modal must be cleared");
}

// アンカー: 書き換えは 0.18 秒待ってまとめて保存。作品を切り替えるときは、待っている保存を前の作品へ書き、
// 新しい作品へは書かない。
{
  resetWindow();
  const files = new Map([[ROOT, { version: 1, anchors: [anchor("a1", "c.txt", 0, 1)] }], [OTHER, { version: 1, anchors: [anchor("o1", "x.txt", 0, 1)] }]]);
  const saves = [];
  createRust({
    list_installed_plugins: () => ({ plugins: [], errors: [] }),
    load_plugin_anchors: ({ rootPath }) => files.get(rootPath) ?? null,
    save_plugin_anchors: ({ rootPath, store }) => {
      saves.push([rootPath, store.anchors.map((item) => item.id)]);
    },
  });
  const view = mountHost();
  view.render();
  await settle();
  view.render();
  assert.deepEqual(view.host.pluginAnchorsRef.current.map((item) => item.id), ["a1"]);

  view.host.persistPluginAnchors([...view.host.pluginAnchorsRef.current, anchor("a2", "c.txt", 2, 3)]);
  view.render();
  assert.deepEqual(saves, [], "saving must wait");
  flushTimers();
  assert.deepEqual(saves, [[ROOT, ["a1", "a2"]]]);

  view.host.persistPluginAnchors([anchor("a3", "c.txt", 0, 1)]);
  view.render();
  view.app.projectFolder = other();
  view.render();
  assert.deepEqual(saves.at(-1), [ROOT, ["a3"]], "a pending save must go to the previous work when switching");
  assert.equal(timers.size, 0, "the pending save timer must be cancelled");
  await settle();
  view.render();
  assert.deepEqual(view.host.pluginAnchorsRef.current.map((item) => item.id), ["o1"]);
  flushTimers();
  assert.equal(saves.some(([rootPath]) => rootPath === OTHER), false, "the new work's file must not be written");

  // 名前の変更・移動で、アンカーの文書のパスを付け替える（大文字小文字は区別しない）。
  view.host.retargetPluginAnchors(`${OTHER}\\X.TXT`, `${OTHER}\\章\\y.txt`);
  view.render();
  assert.deepEqual(view.host.pluginAnchorsRef.current.map((item) => item.documentPath), ["章/y.txt"]);
  flushTimers();
  assert.deepEqual(saves.at(-1), [OTHER, ["o1"]]);
  view.host.retargetPluginAnchors(`${OTHER}\\none.txt`, `${OTHER}\\z.txt`);
  assert.equal(timers.size, 0, "nothing to retarget must not save");
  view.unmount();
}

// 読み込みの途中でアンカーを書き換えたら、読み込んだ値で上書きしない。
{
  resetWindow();
  let release;
  createRust({
    list_installed_plugins: () => ({ plugins: [], errors: [] }),
    load_plugin_anchors: () => new Promise((resolve) => { release = () => resolve({ version: 1, anchors: [anchor("old", "c.txt", 0, 1)] }); }),
    save_plugin_anchors: () => undefined,
  });
  const view = mountHost();
  view.render();
  await settle();
  view.host.persistPluginAnchors([anchor("new", "c.txt", 0, 1)]);
  view.render();
  release();
  await settle();
  view.render();
  assert.deepEqual(view.host.pluginAnchorsRef.current.map((item) => item.id), ["new"]);
  view.unmount();
}

// 作品が変わったら、プラグインへ知らせる（同じ作品のままなら知らせない）。
{
  resetWindow();
  createRust({ list_installed_plugins: () => ({ plugins: [], errors: [] }), load_plugin_anchors: () => null });
  const view = mountHost({ projectFolder: null });
  const events = [];
  view.render();
  view.host.pluginRuntimeHostRef.current = { emit: (name, payload) => events.push([name, payload]) };
  view.app.projectFolder = novel();
  view.render();
  view.app.projectFolder = { ...novel() };
  view.render();
  assert.deepEqual(events, [["workspace.change", { name: "Novel", hasProject: true }]]);
  view.unmount();
}

// 癖1: アンカーのファイルが読めない作品（壊れている・version が 1 でない）では、アンカーを保存しない。
// 読めなかったファイルを、空から始めた一覧で上書きしないため（docs/PLUGIN_HOST_SEPARATION_PLAN.md 工程2の5）。
for (const [label, load, message] of [
  ["broken", () => { throw new Error("failed to parse plugin anchors"); }, "アンカーの読み込みに失敗しました: Error: failed to parse plugin anchors"],
  ["version", () => ({ version: 2, anchors: [] }), "アンカーの読み込みに失敗しました: 対応していない形式です"],
  ["anchors", () => ({ version: 1, anchors: "x" }), "アンカーの読み込みに失敗しました: 対応していない形式です"],
]) {
  resetWindow();
  const saves = [];
  createRust({
    list_installed_plugins: () => ({ plugins: [], errors: [] }),
    load_plugin_anchors: ({ rootPath }) => (rootPath === ROOT ? load() : null),
    save_plugin_anchors: ({ rootPath }) => {
      saves.push(rootPath);
    },
  });
  const view = mountHost();
  view.render();
  await settle();
  view.render();
  assert.deepEqual(view.app.errors, [message], `${label}: the failure must be shown`);
  view.host.persistPluginAnchors([anchor("a", "c.txt", 0, 1)]);
  view.render();
  assert.deepEqual(view.host.pluginAnchorsRef.current.map((item) => item.id), ["a"], `${label}: anchors still work in memory`);
  flushTimers();
  assert.deepEqual(saves, [], `${label}: an unreadable anchor file must not be overwritten`);
  view.host.persistPluginAnchors([anchor("b", "c.txt", 0, 1)]);
  view.app.projectFolder = other();
  view.render();
  await settle();
  assert.deepEqual(saves, [], `${label}: switching works must not overwrite it either`);
  view.host.persistPluginAnchors([anchor("o", "x.txt", 0, 1)]);
  view.render();
  flushTimers();
  assert.deepEqual(saves, [OTHER], `${label}: a readable work must still save`);
  view.unmount();
}

// 閉じる前の書き切り: 0.18 秒の保存を待っているアンカーを、待たずにすぐ書く
// （docs/ANCHOR_SAVE_ON_CLOSE_FIX_PLAN.md）。待っていなければ何も書かない。読めなかった作品では書かない。
{
  resetWindow();
  const saves = [];
  createRust({
    list_installed_plugins: () => ({ plugins: [], errors: [] }),
    load_plugin_anchors: ({ rootPath }) => {
      if (rootPath === OTHER) throw new Error("failed to parse plugin anchors");
      return null;
    },
    save_plugin_anchors: ({ rootPath, store }) => {
      saves.push([rootPath, store.anchors.map((item) => item.id)]);
    },
  });
  const view = mountHost();
  view.render();
  await settle();
  view.render();
  await flushPendingSaves();
  assert.deepEqual(saves, [], "nothing pending must write nothing");

  view.host.persistPluginAnchors([anchor("a", "c.txt", 0, 1)]);
  view.host.persistPluginAnchors([anchor("a", "c.txt", 0, 1), anchor("b", "c.txt", 2, 3)]);
  view.render();
  await flushPendingSaves();
  assert.deepEqual(saves, [[ROOT, ["a", "b"]]], "a pending anchor save must be written at once, with the latest anchors");
  assert.equal(timers.size, 0, "the save timer must be cancelled");
  flushTimers();
  assert.equal(saves.length, 1, "the anchors must not be written twice");

  view.app.projectFolder = other();
  view.render();
  await settle();
  view.render();
  view.host.persistPluginAnchors([anchor("o", "x.txt", 0, 1)]);
  view.render();
  await flushPendingSaves();
  assert.equal(saves.length, 1, "an unreadable anchor file must not be written before closing either");
  view.unmount();
}

console.log("plugin host: ok");
