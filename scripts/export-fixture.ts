import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { createDocumentAst } from "../src/editor/ast/documentAst";
import { createExportDocument } from "../src/export/documentExport";
import {
  buildLinkedPrintHtml,
  createLinkedExportDocument,
  paginateLinkedDocument,
} from "../src/export/linkedDocument";
import type { ExportJob, LoadedExportSource } from "../src/export/types";
import { DEFAULT_EXPORT_LAYOUT, withFrontMatterDefaults } from "../src/export/types";
import { buildLinkedVivliostyleHtml } from "../src/export/vivliostyleHtml";
import { generateVerticalDocx } from "../src/export/wordprocessingMl";

const root = process.cwd();
const outputDir = path.join(root, "test-artifacts", "export");
const paragraph = "これは[日本語(rb,に ほん ご)]のルビと、[傍点(em,goma)]、西暦[2026(tcy)]年の縦中横を確認する文章です。";
const sources: LoadedExportSource[] = [
  {
    id: "door", path: "00_扉.txt", extension: "txt", displayName: "00_扉.txt",
    chars: 80, enabled: true, order: 0, startMode: "continue", markupMode: "then-markup",
    content: `# 連結組版テスト\n\n${paragraph}`,
  },
  {
    id: "chapter-1", path: "01_第一章.txt", extension: "txt", displayName: "01_第一章.txt",
    chars: paragraph.length * 10, enabled: true, order: 1, startMode: "odd-page", markupMode: "then-markup",
    content: `# 第一章\n\n${Array.from({ length: 10 }, () => paragraph).join("\n\n")}`,
  },
  {
    id: "chapter-2", path: "02_第二章.md", extension: "md", displayName: "02_第二章.md",
    chars: paragraph.length * 8, enabled: true, order: 2, startMode: "even-page", markupMode: "then-markup",
    content: `# 第二章\n\n${Array.from({ length: 8 }, () => paragraph).join("\n\n")}`,
  },
];

const ast = createDocumentAst({ path: sources[0].path, name: sources[0].displayName, text: sources[0].content });
const before = JSON.stringify(ast);
createExportDocument(ast, "Noto Serif CJK JP");
if (JSON.stringify(ast) !== before) throw new Error("createExportDocument mutated DocumentAst");

const layout = JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT));
layout.header.content = "chapter";
layout.header.differentOddEven = true;
layout.footer.pageNumberPosition = "outer";
const job: ExportJob = {
  format: "pdf",
  title: "本文連結組版テスト",
  sources: sources.map(({ content: _content, ...source }) => source),
  layout,
};
const linkedDocument = createLinkedExportDocument(job, sources);
const pages = paginateLinkedDocument(linkedDocument);
if (pages.length < 3) throw new Error("linked pagination did not create multiple pages");
const firstChapterPage = pages.find((page) => page.sourceId === "chapter-1");
const secondChapterPage = pages.find((page) => page.sourceId === "chapter-2");
if (!firstChapterPage || firstChapterPage.pageNumber % 2 !== 1) throw new Error("odd-page source did not start on an odd page");
if (!secondChapterPage || secondChapterPage.pageNumber % 2 !== 0) throw new Error("even-page source did not start on an even page");

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const fileName = String(input).includes("Sans") ? "NotoSansCJKjp-Regular.otf" : "NotoSerifCJKjp-Regular.otf";
  const bytes = await readFile(path.join(root, "public", "fonts", fileName));
  return new Response(bytes, { status: 200 });
};
const docxBytes = await generateVerticalDocx(linkedDocument);
globalThis.fetch = originalFetch;
await writeFile(path.join(outputDir, "linked-vertical-export.docx"), docxBytes);
await writeFile(path.join(outputDir, "linked-vertical-export.html"), buildLinkedPrintHtml(linkedDocument, "http://127.0.0.1:1420/"), "utf8");

const zip = await JSZip.loadAsync(docxBytes);
const documentXml = await zip.file("word/document.xml")?.async("string");
const stylesXml = await zip.file("word/styles.xml")?.async("string");
const settingsXml = await zip.file("word/settings.xml")?.async("string");
const fontTableXml = await zip.file("word/fontTable.xml")?.async("string");
if (!documentXml?.includes('<w:textDirection w:val="tbRl"/>')) throw new Error("DOCX section is not vertical");
if (!documentXml.includes('<w:type w:val="oddPage"/>') || !documentXml.includes('<w:type w:val="evenPage"/>')) throw new Error("DOCX section start modes are missing");
if (!documentXml.includes("第一章") || !documentXml.includes("第二章")) throw new Error("DOCX did not concatenate source files");
if (!documentXml.includes("<w:ruby>") || !documentXml.includes("<w:em ")) throw new Error("DOCX ruby or emphasis markup is missing");
if (!fontTableXml?.includes("Yu Mincho")) throw new Error("DOCX Word-compatible Japanese font mapping is missing");
if (!settingsXml?.includes("w:evenAndOddHeaders")) throw new Error("DOCX odd/even header setting is missing");
if (documentXml.includes("<w:docGrid") || stylesXml?.includes('w:lineRule="exact"')) throw new Error("DOCX contains clipping-prone fixed line geometry");
if (!stylesXml?.includes('w:lineRule="atLeast"')) throw new Error("DOCX minimum line spacing is missing");

const firstPageOnlyLayout = JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT));
firstPageOnlyLayout.header.hideOnTitlePage = false;
firstPageOnlyLayout.footer.hideOnTitlePage = false;
firstPageOnlyLayout.header.hideOnFirstPage = true;
firstPageOnlyLayout.footer.hideOnFirstPage = true;
const firstPageOnlyDocx = await generateVerticalDocx({
  ...linkedDocument,
  layout: firstPageOnlyLayout,
});
const firstPageOnlyZip = await JSZip.loadAsync(firstPageOnlyDocx);
const firstPageOnlyXml = await firstPageOnlyZip.file("word/document.xml")?.async("string");
const firstPageOnlyTitlePages = firstPageOnlyXml?.match(/<w:titlePg\/>/g)?.length ?? 0;
if (firstPageOnlyTitlePages !== 1) throw new Error("DOCX first-page hiding leaked to later sections");

const mixedFirstPageLayout = JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT));
mixedFirstPageLayout.header.hideOnTitlePage = true;
mixedFirstPageLayout.footer.hideOnTitlePage = false;
mixedFirstPageLayout.header.hideOnFirstPage = false;
mixedFirstPageLayout.footer.hideOnFirstPage = false;
const mixedFirstPageDocx = await generateVerticalDocx({
  ...linkedDocument,
  layout: mixedFirstPageLayout,
});
const mixedFirstPageZip = await JSZip.loadAsync(mixedFirstPageDocx);
const mixedFirstPageXml = await mixedFirstPageZip.file("word/document.xml")?.async("string");
if (!mixedFirstPageXml?.includes('<w:footerReference w:type="first"')) {
  throw new Error("DOCX first-page footer reference is missing when only the header is hidden");
}

const staleDisabledHeaderLayout = JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT));
staleDisabledHeaderLayout.header.enabled = false;
staleDisabledHeaderLayout.header.content = "none";
staleDisabledHeaderLayout.header.hideOnTitlePage = true;
staleDisabledHeaderLayout.header.hideOnFirstPage = true;
staleDisabledHeaderLayout.footer.hideOnTitlePage = false;
staleDisabledHeaderLayout.footer.hideOnFirstPage = false;
const staleDisabledHeaderDocx = await generateVerticalDocx({
  ...linkedDocument,
  layout: staleDisabledHeaderLayout,
});
const staleDisabledHeaderZip = await JSZip.loadAsync(staleDisabledHeaderDocx);
const staleDisabledHeaderXml = await staleDisabledHeaderZip.file("word/document.xml")?.async("string");
if (staleDisabledHeaderXml?.includes("<w:titlePg/>")) {
  throw new Error("DOCX stale disabled header hiding created first-page headers/footers");
}

const printHtml = buildLinkedPrintHtml(linkedDocument, "http://127.0.0.1:1420/");
if (printHtml.match(/class="then-export-page/g)?.length !== pages.length) throw new Error("print HTML page count differs from pagination model");
if (printHtml.includes("vivliostyle")) throw new Error("print HTML unexpectedly references Vivliostyle");

// Without front matter the Vivliostyle document keeps the plain body flow.
const plainVivliostyle = buildLinkedVivliostyleHtml(linkedDocument, "http://127.0.0.1:1420/");
if (linkedDocument.frontMatter) throw new Error("front matter resolved although cover and TOC are disabled");
if (!plainVivliostyle.includes("counter-reset: page 0") || plainVivliostyle.includes("then-main")) {
  throw new Error("Vivliostyle body flow changed without front matter");
}

// Legacy stored layouts (no frontMatter key) are completed with disabled defaults.
const legacyLayout = JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT));
delete legacyLayout.frontMatter;
const completed = withFrontMatterDefaults(legacyLayout);
if (completed.frontMatter.cover.enabled || completed.frontMatter.toc.enabled) throw new Error("legacy layout gained front matter");

// Front matter: text cover + TOC down to h2.
const headingSources: LoadedExportSource[] = [
  ...sources,
  {
    id: "chapter-3", path: "03_第三章.txt", extension: "txt", displayName: "03_第三章.txt",
    chars: paragraph.length * 3, enabled: true, order: 3, startMode: "new-page", markupMode: "then-markup",
    content: `${paragraph}\n\n## 途中の節\n\n${paragraph}\n\n## 二つ目の節\n\n${paragraph}`,
  },
];
const frontLayout = JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT));
frontLayout.frontMatter.cover.enabled = true;
frontLayout.frontMatter.toc.enabled = true;
frontLayout.frontMatter.toc.depth = 2;
frontLayout.footer.startPageNumber = 3;
const frontJob: ExportJob = {
  format: "pdf",
  title: "前付けテスト",
  sources: headingSources.map(({ content: _content, ...source }) => source),
  layout: frontLayout,
  frontMatter: { subtitle: "副題", author: "著者名" },
};
const frontDocument = createLinkedExportDocument(frontJob, headingSources);
const entries = frontDocument.frontMatter?.toc?.entries ?? [];
const labels = entries.map((entry) => `${entry.indent}:${entry.label}`);
// The file whose chapterTitle comes from its first (mid-file) heading lists it once.
const expectedLabels = ["0:連結組版テスト", "0:第一章", "0:第二章", "0:途中の節", "1:二つ目の節"];
if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) throw new Error(`unexpected TOC entries: ${labels.join(", ")}`);
if (frontDocument.frontMatter?.cover?.kind !== "text" || frontDocument.frontMatter.cover.subtitle !== "副題") {
  throw new Error("text cover was not resolved");
}

const frontVivliostyle = buildLinkedVivliostyleHtml(frontDocument, "http://127.0.0.1:1420/");
for (const entry of entries) {
  if (!frontVivliostyle.includes(`href="#${entry.id}"`) || !frontVivliostyle.includes(`id="${entry.id}"`)) {
    throw new Error(`Vivliostyle TOC target is missing: ${entry.label}`);
  }
}
if (frontVivliostyle.includes("counter-reset: page")) throw new Error("front matter must not reset the page counter (breaks target-counter)");
if (!frontVivliostyle.includes("thencover:first, thenfront:first { counter-increment: page 2; }")) {
  throw new Error("front matter does not offset the body start page number");
}
if (!frontVivliostyle.includes("thenmain:nth(1 of thenmain):blank")) throw new Error("blank page before the body is not suppressed");

globalThis.fetch = async (input) => {
  const fileName = String(input).includes("Sans") ? "NotoSansCJKjp-Regular.otf" : "NotoSerifCJKjp-Regular.otf";
  const bytes = await readFile(path.join(root, "public", "fonts", fileName));
  return new Response(bytes, { status: 200 });
};
const frontDocx = await generateVerticalDocx(frontDocument);
await writeFile(path.join(outputDir, "front-matter-export.docx"), frontDocx);
const frontZip = await JSZip.loadAsync(frontDocx);
const frontXml = await frontZip.file("word/document.xml")?.async("string") ?? "";
const frontSettings = await frontZip.file("word/settings.xml")?.async("string") ?? "";
const frontStyles = await frontZip.file("word/styles.xml")?.async("string") ?? "";
const tcCount = frontXml.match(/ TC &quot;/g)?.length ?? 0;
if (tcCount !== entries.length) throw new Error(`DOCX TC entries ${tcCount} != TOC entries ${entries.length}`);
// TC field codes must be hidden text, or Word prints { TC "…" } in the body.
const hiddenTcCount = frontXml.split('<w:r><w:rPr><w:vanish/></w:rPr><w:instrText xml:space="preserve"> TC ').length - 1;
if (hiddenTcCount !== entries.length) throw new Error("DOCX TC fields are not hidden text");
if (!frontXml.includes(" TOC \\f \\l &quot;1-3&quot; \\h \\z ")) throw new Error("DOCX TOC field is missing");
if (!frontSettings.includes('<w:updateFields w:val="true"/>')) throw new Error("DOCX does not ask Word to update the TOC");
if (!frontStyles.includes('w:styleId="TOC2"') || !frontStyles.includes('w:leader="dot"')) throw new Error("DOCX TOC styles are missing");
const sectPrs = frontXml.match(/<w:sectPr>.*?<\/w:sectPr>/g) ?? [];
// cover, cover back (spreads), TOC, then one per body file.
if (sectPrs.length !== 3 + headingSources.length) throw new Error(`unexpected DOCX section count: ${sectPrs.length}`);
if (sectPrs.slice(0, 3).some((sectPr) => sectPr.includes("Reference") || sectPr.includes("pgNumType"))) {
  throw new Error("DOCX front matter sections carry headers or page numbering");
}
if (!sectPrs[3].includes('<w:pgNumType w:start="3"/>')) throw new Error("DOCX body does not restart at the start page number");
if (!frontXml.includes(" =MOD(")) throw new Error("DOCX TOC does not pad to an even page before the body");
// w:type belongs to the section it starts: chapter-1 is odd-page, chapter-2 even-page.
if (!sectPrs[4].includes('<w:type w:val="oddPage"/>') || !sectPrs[5].includes('<w:type w:val="evenPage"/>')) {
  throw new Error("DOCX section start types are attached to the wrong sections");
}

// Image cover: a full-bleed anchored picture in its own zero-margin section.
const pngBytes = await readFile(path.join(root, "src-tauri", "icons", "32x32.png"));
const imageJob: ExportJob = {
  ...frontJob,
  layout: { ...frontLayout, frontMatter: { ...frontLayout.frontMatter, cover: { ...frontLayout.frontMatter.cover, kind: "image" } } },
  frontMatter: { coverImage: { url: "", mime: "image/png", dataBase64: pngBytes.toString("base64"), widthPx: 32, heightPx: 32 } },
};
const imageDocument = createLinkedExportDocument(imageJob, headingSources);
if (imageDocument.frontMatter?.cover?.kind !== "image") throw new Error("image cover was not resolved");
const imageDocx = await generateVerticalDocx(imageDocument);
globalThis.fetch = originalFetch;
const imageZip = await JSZip.loadAsync(imageDocx);
const imageXml = await imageZip.file("word/document.xml")?.async("string") ?? "";
const imageRels = await imageZip.file("word/_rels/document.xml.rels")?.async("string") ?? "";
const imageTypes = await imageZip.file("[Content_Types].xml")?.async("string") ?? "";
if (!imageZip.file("word/media/cover.png")) throw new Error("DOCX cover image part is missing");
if (!imageXml.includes('r:embed="rIdThenCover"') || !imageRels.includes('Target="media/cover.png"') || !imageTypes.includes("/word/media/cover.png")) {
  throw new Error("DOCX cover image is not wired up");
}
if (!imageXml.includes('<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"')) throw new Error("DOCX image cover is not full-bleed");
// A square picture on a tall page is cropped left/right like object-fit: cover.
if (!/<a:srcRect l="\d+" r="\d+"\/>/.test(imageXml)) throw new Error("DOCX image cover is not cropped to the page");
const imageVivliostyle = buildLinkedVivliostyleHtml(imageDocument, "http://127.0.0.1:1420/");
if (!imageVivliostyle.includes('<div class="then-cover-image" style="background-image: url(&quot;data:image/png;base64,')) {
  throw new Error("Vivliostyle image cover is missing");
}
if (imageVivliostyle.includes("then-cover-box")) throw new Error("image cover shows text although overlay is off");

// Image cover with the title overlaid: text sits on the picture inside the page margins.
const overlayJob: ExportJob = {
  ...imageJob,
  layout: { ...imageJob.layout, frontMatter: { ...imageJob.layout.frontMatter, cover: { ...imageJob.layout.frontMatter.cover, overlayText: true, textColor: "light" } } },
  frontMatter: { ...imageJob.frontMatter, subtitle: "重ねる副題", author: "重ねる著者" },
};
const overlayDocument = createLinkedExportDocument(overlayJob, headingSources);
const overlayCover = overlayDocument.frontMatter?.cover;
if (overlayCover?.kind !== "image" || overlayCover.overlay?.subtitle !== "重ねる副題") throw new Error("overlay text was not resolved");
const overlayVivliostyle = buildLinkedVivliostyleHtml(overlayDocument, "http://127.0.0.1:1420/");
if (!/<div class="then-cover-image then-cover-light"[^>]*><div class="then-cover-box"><p class="then-cover-title">前付けテスト<\/p>/.test(overlayVivliostyle)) {
  throw new Error("Vivliostyle overlay text is not inside the image cover");
}
globalThis.fetch = async (input) => {
  const fileName = String(input).includes("Sans") ? "NotoSansCJKjp-Regular.otf" : "NotoSerifCJKjp-Regular.otf";
  return new Response(await readFile(path.join(root, "public", "fonts", fileName)), { status: 200 });
};
const overlayDocx = await generateVerticalDocx(overlayDocument);
globalThis.fetch = originalFetch;
await writeFile(path.join(outputDir, "front-matter-overlay.docx"), overlayDocx);
const overlayXml = await (await JSZip.loadAsync(overlayDocx)).file("word/document.xml")?.async("string") ?? "";
// The cover section ends with the paragraph whose pPr holds the first sectPr.
const overlayCoverXml = overlayXml.slice(0, overlayXml.indexOf("</w:p>", overlayXml.indexOf("</w:sectPr>")));
if (!overlayCoverXml.includes('r:embed="rIdThenCover"') || !overlayCoverXml.includes('<w:color w:val="FFFFFF"/>') || !overlayCoverXml.includes("重ねる著者")) {
  throw new Error("DOCX overlay cover is missing the picture or the coloured text");
}
if (overlayCoverXml.includes('<w:pgMar w:top="0"')) throw new Error("DOCX overlay text lost the page margins");

console.log(JSON.stringify({ astUnchanged: true, sources: linkedDocument.sections.length, pages: pages.length, docxBytes: docxBytes.length, tocEntries: entries.length }));
