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
import { DEFAULT_EXPORT_LAYOUT } from "../src/export/types";
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

console.log(JSON.stringify({ astUnchanged: true, sources: linkedDocument.sections.length, pages: pages.length, docxBytes: docxBytes.length }));
