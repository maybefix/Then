import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// BINDER 1-5: works without a synopsis must look and save exactly as before the
// corkboard and the key → label table were added. The properties form of such
// works is pinned as rendered HTML (scripts/fixtures/synopsis-baseline/), and the
// front matter edits the form makes are pinned as text. `--update` rewrites the
// fixture; only do that on the checkpoint before 1-5.
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.CSS = { escape: (value) => value.replace(/["\\]/g, "\\$&") };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const dir = path.resolve("test-artifacts/synopsis-baseline");
await mkdir(dir, { recursive: true });
const bundle = async (entry, name) => {
  await build({
    entryPoints: [entry],
    outfile: path.join(dir, name),
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    loader: { ".css": "empty" },
    external: ["react", "react/jsx-runtime", "yaml"],
  });
  return import(`${pathToFileURL(path.join(dir, name)).href}?${Date.now()}`);
};
const { default: PropertiesForm } = await bundle("src/components/properties/PropertiesForm.tsx", "form.mjs");
const model = await bundle("src/properties/propertyModel.ts", "model.mjs");
const frontmatter = await bundle("src/utils/frontmatter.ts", "frontmatter.mjs");

const SHEETS = {
  article: ["slug: making-then", "date: 2026-11-01", "publish: false", "tags:", "  - 開発", "description: Thenを作った話"].join("\n"),
  custom: ["title: 潮待ち郵便局", "summary: あらすじ", "materials_note: メモ", "series:", "  name: 夜の港"].join("\n"),
  empty: "",
};

function renderForm(metadata, typeSettings = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(PropertiesForm, {
      documentKey: "baseline",
      metadata,
      typeSettings,
      view: "form",
      addRequest: 0,
      onViewChange: () => {},
      onChangeMetadata: () => {},
      onRememberType: () => {},
      onExit: () => {},
    }));
  });
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return html;
}

const actual = {};
for (const [name, metadata] of Object.entries(SHEETS)) {
  actual[`form:${name}`] = renderForm(metadata);
}
actual["form:article-with-types"] = renderForm(SHEETS.article, { date: "text", tags: "list" });

// Edits the form makes, as text.
const article = SHEETS.article;
actual["edit:set-text"] = model.setPropertyValue(article, "description", "text", "書き直し");
actual["edit:add-text"] = model.addProperty(article, "summary", "text", "あらすじ");
actual["edit:add-empty"] = model.addProperty(article, "note", "text", null);
actual["edit:remove"] = model.removeProperty(article, "slug");
actual["edit:rename"] = model.renameProperty(article, "description", "lead");
actual["edit:replace-front-matter"] = frontmatter.replaceFrontMatter("---\nslug: a\n---\n本文。\n", "slug: b");
actual["edit:replace-front-matter-crlf"] = frontmatter.replaceFrontMatter("---\r\nslug: a\r\n---\r\n本文。\r\n", "slug: b");
actual["edit:add-front-matter"] = frontmatter.replaceFrontMatter("本文だけ。\n", "slug: b");
actual["edit:remove-front-matter"] = frontmatter.replaceFrontMatter("---\nslug: a\n---\n本文。\n", "");

const fixture = path.resolve("scripts/fixtures/synopsis-baseline/expected.json");
if (process.argv.includes("--update") || !existsSync(fixture)) {
  await mkdir(path.dirname(fixture), { recursive: true });
  await writeFile(fixture, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), fixture)} (${Object.keys(actual).length} entries)`);
} else {
  const expected = JSON.parse(await readFile(fixture, "utf8"));
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), "pinned entries");
  let failures = 0;
  for (const [name, value] of Object.entries(expected)) {
    if (actual[name] === value) {
      console.log(`ok - ${name}`);
    } else {
      failures += 1;
      console.log(`not ok - ${name}\n  expected: ${value}\n  actual:   ${actual[name]}`);
    }
  }
  if (failures) throw new Error(`${failures} 件が 1-5 の前と違う`);
  console.log(`synopsis baseline: ${Object.keys(expected).length} entries unchanged`);
}
