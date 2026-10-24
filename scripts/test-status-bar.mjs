import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// StatusBar.tsx と useCheckpointStatusInfo.ts を束ねて読み込む。React は同じものを共有させる。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/components/status/StatusBar.tsx"; export * from "./src/components/status/useCheckpointStatusInfo.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
});
// react を node_modules から解決させるため、リポジトリの中に書き出して読む。
const compiledPath = join(process.cwd(), ".tmp", `status-bar-test-${process.pid}.mjs`);
await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
await writeFile(compiledPath, bundled.outputFiles[0].text);

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { StatusBar, useCheckpointStatusInfo } = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));
const { act, createElement } = React;
const root = createRoot(document.getElementById("root"));

const baseProps = {
  currentFilePath: null,
  showFilePath: false,
  lastError: "",
  charCount: 0,
  selectionCharCount: null,
  pageMetrics: null,
  checkpoint: null,
  pluginItems: [],
  onPluginItemClick: () => {},
};

const renderStatus = async (props) => {
  await act(async () => root.render(createElement(StatusBar, { ...baseProps, ...props })));
  return document.querySelector("footer.statusbar");
};

// ---------------------------------------------------------------------------
// 保存の印: 保存済みはチェック、未保存・保存中・読み込み中はサイクル、失敗は「!」
// ---------------------------------------------------------------------------

{
  const expected = { saved: "check", dirty: "cycle", saving: "cycle", loading: "cycle", error: "alert" };
  const labels = { saved: "保存済み", dirty: "未保存", saving: "保存中", loading: "読み込み中", error: "保存失敗" };
  for (const [saveStatus, shape] of Object.entries(expected)) {
    const footer = await renderStatus({ saveStatus });
    assert.ok(footer.classList.contains(`status-${saveStatus}`), `${saveStatus}: status class stays`);
    assert.equal(footer.querySelector(".statusDot"), null, `${saveStatus}: the round lamp is gone`);
    const icons = footer.querySelectorAll("svg.statusSaveIcon");
    assert.equal(icons.length, 1, `${saveStatus}: exactly one save icon`);
    assert.equal(icons[0].getAttribute("data-shape"), shape, `${saveStatus}: icon shape`);
    assert.equal(icons[0].getAttribute("aria-hidden"), "true", `${saveStatus}: icon is decorative`);
    assert.equal(icons[0].getAttribute("stroke"), "currentColor", `${saveStatus}: icon follows the CSS color`);
    assert.equal(icons[0].nextElementSibling?.textContent, labels[saveStatus], `${saveStatus}: label unchanged`);
  }
}

// ---------------------------------------------------------------------------
// 保存点の表示の値（App.tsx から移したフック）
// ---------------------------------------------------------------------------

const folder = { path: "C:/works/a", name: "a", entries: [] };
const ast = (files, rootPath = folder.path) => ({ rootPath, files });
const snapshot = (id, reason, createdAt, totalVisibleTextLength) => ({
  id, reason, createdAt, label: `label-${id}`, totalVisibleTextLength,
});

const runHook = async (deps) => {
  let result;
  function Probe() {
    result = useCheckpointStatusInfo(deps);
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  return result;
};

{
  const calls = [];
  const deps = {
    settings: { showCheckpointStatus: true },
    // App から渡すのは、新しい順に並んだ今のプロジェクトの保存点。
    currentWorkspaceSnapshots: [
      snapshot("auto-newest", "restore", 300, 999),
      snapshot("manual-new", "manual", 200, 1000),
      snapshot("manual-old", "manual", 100, 10),
    ],
    projectAst: ast([
      { status: "indexed", visibleTextLength: 700 },
      { status: "indexed", visibleTextLength: 540 },
    ]),
    projectFolder: folder,
    openCheckpointStudio: (id) => calls.push(["open", id]),
    handleQuickCreateManuscriptSnapshot: async () => { calls.push(["create"]); },
  };

  const info = await runHook(deps);
  assert.deepEqual(info.latest, { label: "label-manual-new", createdAt: 200, visibleTextLength: 1000 }, "latest manual snapshot");
  assert.equal(info.currentVisibleTextLength, 1240, "sum of visible text");
  info.onOpen();
  info.onCreate();
  assert.deepEqual(calls, [["open", "manual-new"], ["create"]], "open goes to the latest manual snapshot");

  assert.equal(await runHook({ ...deps, settings: { showCheckpointStatus: false } }), null, "hidden by setting");
  assert.equal(await runHook({ ...deps, projectFolder: null, projectAst: null }), null, "no project");

  const noManual = await runHook({ ...deps, currentWorkspaceSnapshots: [snapshot("auto", "restore", 1, 1)] });
  assert.equal(noManual.latest, null, "no manual snapshot yet");
  calls.length = 0;
  noManual.onOpen();
  assert.deepEqual(calls, [["open", undefined]], "open without a snapshot");

  const pending = await runHook({ ...deps, projectAst: ast([{ status: "indexed", visibleTextLength: 1 }, { status: "pending", visibleTextLength: 0 }]) });
  assert.equal(pending.currentVisibleTextLength, null, "no count while indexing");
  const otherRoot = await runHook({ ...deps, projectAst: ast([{ status: "indexed", visibleTextLength: 5 }], "C:/works/b") });
  assert.equal(otherRoot.currentVisibleTextLength, null, "no count for another project's index");
}

await act(async () => root.unmount());
dom.window.close();
console.log("status bar tests passed");
