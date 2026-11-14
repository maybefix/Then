import assert from "node:assert/strict";
import { build } from "esbuild";

// Plot の画面と、作品間の移動・コピー、Canvas の「プロットへ送る」は BINDER 1-6 でなくなった
// （Plot は作品を開くときにノート「プロット（移行）」へ移す。test:plot-migration）。
// 残るのは、移行の前の見え方を作る読み込み（plotCardModel.ts）だけ。1-3 の test:binder-baseline もこれを使う。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/plotCardModel.ts";',
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
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "load_project_plot_cards") return structuredClone(stored.get(args.rootPath) ?? []);
      throw new Error(`unexpected command ${command}`);
    },
    transformCallback: () => 0,
  },
};

const plotCardModel = await import(moduleUrl);
const { loadWorkspacePlotCards } = plotCardModel;
assert.deepEqual(Object.keys(plotCardModel), ["loadWorkspacePlotCards"], "only the reader is left");

const card = (id, title, body = "", kind = "section", num = "001") => ({
  id,
  kind,
  num,
  title,
  body,
  expanded: false,
  managerCollapsed: false,
});

{
  stored.set("/works/A", [card("a1", "Aの章"), { id: "bad" }]);
  calls.length = 0;
  const loaded = await loadWorkspacePlotCards("/works/A");
  assert.deepEqual(calls.map((call) => [call.command, call.args.rootPath]), [["load_project_plot_cards", "/works/A"]]);
  assert.equal(loaded[0].id, "a1", "読み込んだカードは正規化して返す");
  assert.ok(loaded.every((item) => typeof item.title === "string" && typeof item.body === "string"));
  assert.deepEqual(stored.get("/works/A").map((item) => item.id), ["a1", "bad"], "読むだけで書かない");
}

{
  // Tauri の外（ブラウザ版）では見本カードを出さず、空を返す。
  const saved = globalThis.window;
  globalThis.window = {};
  assert.deepEqual(await loadWorkspacePlotCards("/works/A"), []);
  globalThis.window = saved;
}

console.log("plot card actions: ok");
