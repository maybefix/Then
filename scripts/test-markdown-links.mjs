import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outputDir = path.join(root, "test-artifacts", "markdown-links");
const outfile = path.join(outputDir, "markdown-links.mjs");
await mkdir(outputDir, { recursive: true });
await build({
  stdin: {
    contents: `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownLite } from "./src/components/markdown/MarkdownLite";
export { openableUrl } from "./src/externalUrl";
export const render = (text) =>
  renderToStaticMarkup(createElement(MarkdownLite, { rootPath: "", sourcePath: "a.md", scope: "project", text }));
`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  jsx: "automatic",
  outfile,
  external: ["react", "react-dom", "react/*", "react-dom/*", "@tauri-apps/api/*"],
  logLevel: "silent",
});
const { openableUrl, render } = await import(`${pathToFileURL(outfile).href}?${Date.now()}`);

// Web and mail links open; the rest are not links (same rules as src-tauri/src/external_url.rs).
for (const url of ["https://example.com/a?b#c", "http://example.com", "HTTPS://E.com", "mailto:a@example.com"]) {
  assert.equal(openableUrl(url), url, url);
}
assert.equal(openableUrl("  https://example.com "), "https://example.com");
for (const url of [
  "", "javascript:alert(1)", "JavaScript:alert(1)", "file:///C:/x.exe", "C:\\x.exe", "\\\\server\\x",
  "./other.md", "//example.com", "ms-settings:privacy", "http:///etc", "https://", "mailto:",
  "https://e.com/a b", "data:text/html,x",
]) {
  assert.equal(openableUrl(url), null, JSON.stringify(url));
}

// Rendering: an openable link is an anchor with no target; anything else is text.
const html = render("[公式](https://example.com) [押す](javascript:alert(1)) [隣](./other.md) [手紙](mailto:a@example.com)");
assert.match(html, /<a href="https:\/\/example.com">公式<\/a>/);
assert.match(html, /<a href="mailto:a@example.com">手紙<\/a>/);
assert.match(html, /<span>押す<\/span>/);
assert.match(html, /<span>隣<\/span>/);
assert.doesNotMatch(html, /javascript:/);
assert.doesNotMatch(html, /other\.md/);
assert.doesNotMatch(html, /target=/, "no link may ask the WebView for a window");

// Links inside tables and headings follow the same rule.
const table = render("| a | b |\n| --- | --- |\n| [x](javascript:1) | [y](https://e.com) |\n# [h](file:///x)");
assert.doesNotMatch(table, /javascript:|file:/);
assert.match(table, /<a href="https:\/\/e.com">y<\/a>/);

console.log("markdown links: ok");
