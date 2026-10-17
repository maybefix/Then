// The journal is told what changed instead of comparing whole texts. Every
// shortcut must still describe the change exactly, so each is checked by
// applying it:
// - the editor's splice from its line update (updateTextFromLineDiffWithChange);
// - that splice placed in the full markdown (placeBodyChange with
//   updateMarkdownBodyDetailed), across front matter, BOM and CRLF files;
// - the fallback comparison (textChangeBetween), across chunk boundaries and
//   surrogate pairs.
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  stdin: {
    contents: `
      export { updateTextFromLineDiffWithChange } from "./src/editor/lineTextUpdate.ts";
      export { updateMarkdownBodyDetailed, updateMarkdownBody } from "./src/utils/frontmatter.ts";
      export { placeBodyChange, textChangeBetween } from "./src/editor/saveJournal.ts";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  write: false,
  platform: "neutral",
  define: { "import.meta.env.DEV": "true" },
  plugins: [{
    name: "fake-tauri",
    setup(b) {
      b.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "fake-tauri", namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export const invoke = async () => null;", loader: "js" }));
    },
  }],
});
const lib = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

let seed = 11;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (n) => Math.floor(random() * n);
const pieces = ["あ", "漢字", "。", "a", "𠮷", "「」", " ", "---", "#", ""];
const word = () => Array.from({ length: pick(6) }, () => pieces[pick(pieces.length)]).join("");
const apply = (text, change) => text.slice(0, change.from) + change.insert + text.slice(change.to);

// 1. The editor's line update.
let editorCases = 0;
for (let i = 0; i < 20000; i += 1) {
  const oldLines = Array.from({ length: pick(8) }, () => ({ source: word() }));
  const from = pick(oldLines.length + 1);
  const toOld = from + pick(oldLines.length - from + 1);
  const added = Array.from({ length: pick(4) }, () => ({ source: word() }));
  const nextLines = [...oldLines.slice(0, from), ...added, ...oldLines.slice(toOld)];
  const previous = oldLines.map((line) => line.source).join("\n");
  const result = lib.updateTextFromLineDiffWithChange(previous, oldLines, nextLines, { from, toOld, toNew: from + added.length });
  assert.equal(result.text, nextLines.map((line) => line.source).join("\n"));
  if (result.change) {
    assert.equal(apply(previous, result.change), result.text, `line update splice ${i}`);
    editorCases += 1;
  }
}

// 2. The splice placed in the full markdown.
const placed = { lf: 0, lfFallback: 0, crlf: 0, crlfPlaced: 0 };
for (let i = 0; i < 20000; i += 1) {
  const crlf = random() < 0.3;
  const frontMatter = random() < 0.5 ? `---\ntitle: ${word()}\n---\n` : "";
  const bom = random() < 0.1 ? "﻿" : "";
  const body = Array.from({ length: 1 + pick(5) }, word).join("\n");
  const raw = bom + frontMatter + body;
  const previousMarkdown = crlf ? raw.replace(/\n/g, "\r\n") : raw;
  // The editor's body is LF and has no BOM; start from the text the app would hold.
  const editorBody = lib.updateMarkdownBodyDetailed(previousMarkdown, body).markdown === previousMarkdown ? body : null;
  if (editorBody === null) continue;
  const at = pick(editorBody.length + 1);
  const to = at + pick(Math.min(3, editorBody.length - at) + 1);
  const change = { from: at, to, insert: random() < 0.2 ? "\n" + word() : word() };
  const nextBody = apply(editorBody, change);
  const layout = lib.updateMarkdownBodyDetailed(previousMarkdown, nextBody);
  const markdownChange = lib.placeBodyChange(previousMarkdown, layout, nextBody, change);
  if (markdownChange) {
    assert.equal(apply(previousMarkdown, markdownChange), layout.markdown, `placed splice ${i}`);
    if (crlf) placed.crlfPlaced += 1;
    else placed.lf += 1;
  } else if (crlf) {
    placed.crlf += 1;
  } else {
    placed.lfFallback += 1;
  }
}

// 3. The fallback comparison.
for (let i = 0; i < 3000; i += 1) {
  const long = random() < 0.5;
  const unit = long ? 2000 + pick(20000) : pick(60);
  let previous = "";
  while (previous.length < unit) previous += pieces[pick(pieces.length)] || "x";
  const at = pick(previous.length + 1);
  const to = Math.min(previous.length, at + pick(5));
  let next = previous.slice(0, at) + word() + previous.slice(to);
  if (random() < 0.1) next = previous;
  const change = lib.textChangeBetween(previous, next);
  assert.equal(apply(previous, change), next, `fallback comparison ${i}`);
}

console.log(`editor splices exact: ${editorCases}`);
console.log(
  `placed in markdown: ${placed.lf} LF placed, ${placed.lfFallback} LF compared instead, ` +
    `${placed.crlf} CRLF compared instead, ${placed.crlfPlaced} CRLF placed (no line breaks involved)`,
);
console.log("save journal splice tests passed");
