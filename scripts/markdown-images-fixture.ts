import assert from "node:assert/strict";
import { parseInlines } from "../src/editor/ast/documentAst";
import { collectExportImageUrls, createLinkedExportDocument, exportBlockHtml } from "../src/export/linkedDocument";
import type { ExportJob, LoadedExportSource } from "../src/export/types";
import { DEFAULT_EXPORT_LAYOUT } from "../src/export/types";
import { buildLinkedVivliostyleHtml } from "../src/export/vivliostyleHtml";
import { serializeSubmission } from "../src/export/submission/serializeSubmission";
import { resolveImageUrl, resolveLocalImagePath, scanImageSources } from "../src/utils/markdownImage";

// --- parsing ---
const [image] = parseInlines('前![挿絵 1](img/a%20b.png "題")後');
assert.equal(image.type, "image");
assert.equal(image.contentText, "挿絵 1");
assert.equal(image.imageSrc, "img/a%20b.png");
assert.equal(image.fullRange.offset, 1);
assert.equal(image.fullText, '![挿絵 1](img/a%20b.png "題")');
// Layout notation and links are not images.
assert.equal(parseInlines("[漢字(rb,かんじ)]").some((m) => m.type === "image"), false);
assert.equal(parseInlines("[リンク](x.png)").length, 0);
// Inline code wins over image notation inside it.
assert.deepEqual(parseInlines("`![a](b.png)`").map((m) => m.type), ["code"]);
assert.deepEqual(scanImageSources("![a](x.png) ![](https://e.x/y.jpg)"), ["x.png", "https://e.x/y.jpg"]);

// --- path resolution ---
// Windows paths, written with "/" for readability.
const win = (path: string) => path.replace(/\//g, "\\");
const doc = win("C:/作品/本文/01.txt");
assert.equal(resolveLocalImagePath("img/a%20b.png", doc), win("C:/作品/本文/img/a b.png"));
assert.equal(resolveLocalImagePath("../画像/c.jpg", doc), win("C:/作品/画像/c.jpg"));
assert.equal(resolveLocalImagePath("../../../../x.png", doc), win("C:/x.png"));
assert.equal(resolveLocalImagePath("D:/pics/d.png", doc), win("D:/pics/d.png"));
assert.equal(resolveLocalImagePath("/etc/x.png", doc), null);
assert.equal(resolveLocalImagePath("file:///C:/x.png", doc), null);
assert.equal(resolveLocalImagePath("x.png", "/home/u/novel/01.md"), "/home/u/novel/x.png");
const base = "http://then-image.localhost/";
assert.equal(resolveImageUrl("https://example.com/a.png", doc, null), "https://example.com/a.png");
assert.equal(resolveImageUrl("javascript:alert(1)", doc, base), null);
assert.equal(resolveImageUrl("a.png", doc, null), null);
assert.equal(resolveImageUrl("a.png", doc, base), `${base}${encodeURIComponent(win("C:/作品/本文/a.png"))}`);

// --- export ---
const sources: LoadedExportSource[] = [{
  id: "s", path: doc, extension: "txt", displayName: "01.txt", chars: 10, enabled: true, order: 0,
  startMode: "continue", markupMode: "then-markup",
  content: "本文の行\n\n![扉絵](img/door.png)\n\n文中に![印](https://example.com/mark.png)がある。\n\n![消えた](missing.png)",
}];
const job: ExportJob = {
  format: "pdf", title: "画像", sources, layout: structuredClone(DEFAULT_EXPORT_LAYOUT), imageUrlBase: base,
};
const urls = collectExportImageUrls(job, sources);
assert.equal(urls.length, 3);
const missing = `${base}${encodeURIComponent(win("C:/作品/本文/missing.png"))}`;
const document = createLinkedExportDocument({ ...job, unavailableImageUrls: [missing] }, sources);
const blocks = document.sections[0].blocks;
assert.deepEqual(blocks.map((b) => b.kind), ["paragraph", "figure", "paragraph", "figure"]);
const figureHtml = exportBlockHtml(blocks[1]);
assert.match(figureHtml, /^<figure class="then-block then-figure then-align-start"><img class="then-figure-image" src="http:\/\/then-image\.localhost\/C%3A%5C/);
assert.match(figureHtml, /alt="扉絵"/);
assert.match(exportBlockHtml(blocks[2]), /<img class="then-image-inline" src="https:\/\/example\.com\/mark\.png" alt="印">/);
assert.equal(exportBlockHtml(blocks[3]), '<figure class="then-block then-figure then-align-start"><span class="then-image-missing">［消えた］</span></figure>');
const html = buildLinkedVivliostyleHtml(document, "http://localhost/");
assert.match(html, /\.then-figure img \{ display: block; margin-inline: auto; max-width: [\d.]+mm; max-height: [\d.]+mm;/);
// Submission text keeps the notation as typed.
const submission = serializeSubmission(
  { sections: [{ source: { id: "s", displayName: "01.txt" }, lines: [{ kind: "paragraph", sourceLine: 1, inlines: [{ kind: "markup", markup: image }] }] }] } as never,
  { target: "plain", headingMode: "keep", sourceSeparator: "\n", lineEnding: "lf" } as never,
);
assert.equal(submission.text, '![挿絵 1](img/a%20b.png "題")\n');
console.log("markdown image tests passed");
