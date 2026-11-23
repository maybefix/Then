// K7（docs/BINDER_REMAINING_PLAN.md）: 資料の読み取り専用のプレビュー（Canvas の資料のカードの中身）は、ファイルが
// 見つからないとき（Rust の文「reference file does not exist」）は中身の欄を空にして onMissingChange(true) で知らせ、
// エラーの文を出さない。見つからないこと以外の失敗は、今までどおり文を出し、見つからない扱いにしない。
// 本物の ReferenceLayer を esbuild でまとめ、Rust の呼び出し（invoke）だけを入れ物で代える。
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `reference-preview-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: 'export { ReferenceReadOnlyPreview } from "./src/components/references/ReferenceLayer";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react/jsx-runtime", "pdfjs-dist"],
  plugins: [
    {
      name: "stubs",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "invoke", namespace: "stub" }));
        builder.onResolve({ filter: /pdf\.worker\.mjs\?url$/ }, () => ({ path: "worker", namespace: "stub" }));
        builder.onResolve({ filter: /^@tauri-apps\/api\/(event|webviewWindow|window|path)$/ }, () => ({ path: "empty", namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents:
            args.path === "invoke"
              ? "export const invoke = (...args) => globalThis.previewInvoke(...args); export const convertFileSrc = (path) => path;"
              : args.path === "worker"
                ? "export default 'worker.js';"
                : "export const listen = async () => () => {}; export const emit = async () => {};",
          loader: "js",
        }));
      },
    },
  ],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
const { ReferenceReadOnlyPreview } = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
for (const name of ["HTMLElement", "Element", "Node", "Event", "getComputedStyle"]) {
  globalThis[name] = name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(props) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const reports = [];
  await act(async () => {
    root.render(React.createElement(ReferenceReadOnlyPreview, { rootPath: "C:\\work", scope: "project", ...props, onMissingChange: (missing) => reports.push(missing) }));
    await settle();
  });
  await act(settle);
  return { container, reports, unmount: () => act(async () => root.unmount()) };
}

globalThis.previewInvoke = async (command, args) => {
  if (args.sourcePath.includes("ない")) throw "reference file does not exist";
  if (args.sourcePath.includes("鍵")) throw "failed to read reference file: access denied";
  if (command === "read_reference_text") return "本文";
  if (command === "read_reference_binary") return { mimeType: "image/png", dataBase64: "iVBORw0KGgo=" };
  throw new Error(`unexpected ${command}`);
};

for (const kind of ["image", "text", "pdf"]) {
  const missing = await render({ sourcePath: `素材/資料/ない.${kind}`, kind });
  assert.ok(missing.container.querySelector(".referenceMissing"), `${kind}: 見つからないときは空の欄`);
  assert.equal(missing.container.querySelector(".referenceError"), null, `${kind}: エラーの文は出さない`);
  assert.equal(missing.container.textContent, "", `${kind}: 文字は何も出さない`);
  assert.equal(missing.reports.at(-1), true, `${kind}: 見つからないことを知らせる`);
  await missing.unmount();

  const locked = await render({ sourcePath: `素材/資料/鍵.${kind}`, kind });
  assert.match(locked.container.querySelector(".referenceError")?.textContent ?? "", /access denied/, `${kind}: ほかの失敗は文を出す`);
  assert.ok(!locked.reports.includes(true), `${kind}: ほかの失敗は見つからない扱いにしない`);
  await locked.unmount();
}

const found = await render({ sourcePath: "素材/資料/地図.png", kind: "image" });
assert.ok(found.container.querySelector("img"), "読めた画像は今までどおり出す");
assert.ok(!found.reports.includes(true));
await found.unmount();

dom.window.close();
console.log("reference preview: ok (missing files are drawn empty and reported, other failures still show their text)");
