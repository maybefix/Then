// FM-07: front matter never reaches PDF (Vivliostyle), DOCX or submission text,
// and no body text is lost on the way. Sources go through the same
// createLoadedExportSource the export screen uses.
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { createLoadedExportSource } from "../src/export/exportSource";
import { createLinkedExportDocument } from "../src/export/linkedDocument";
import { createSubmissionDocument } from "../src/export/submission/createSubmissionDocument";
import { serializeSubmission } from "../src/export/submission/serializeSubmission";
import { DEFAULT_SUBMISSION_OPTIONS } from "../src/export/submission/types";
import type { ExportJob } from "../src/export/types";
import { DEFAULT_EXPORT_LAYOUT } from "../src/export/types";
import { buildLinkedVivliostyleHtml } from "../src/export/vivliostyleHtml";
import { generateVerticalDocx } from "../src/export/wordprocessingMl";
import { updateMarkdownBody } from "../src/utils/frontmatter";

const BOM = String.fromCharCode(0xfeff);
const YAML_MARKERS = ["slug", "making-then", "publish", "夜の港シリーズ"];

type Case = { name: string; file: string; mustContain: string[] };
const cases: Case[] = [
  {
    name: "BOM付き",
    file: `${BOM}---\nslug: making-then\npublish: true\n---\n# 見出し\n\n本文その一。`,
    mustContain: ["見出し", "本文その一"],
  },
  {
    name: "CRLF",
    file: "---\r\nslug: making-then\r\npublish: true\r\n---\r\n# 見出し\r\n\r\n本文その一。\r\n",
    mustContain: ["見出し", "本文その一"],
  },
  {
    name: "BOM付き・CRLF",
    file: `${BOM}---\r\nslug: making-then\r\n---\r\n本文その一。\r\n`,
    mustContain: ["本文その一"],
  },
  {
    name: "不正なYAML",
    file: "---\nslug making-then\n: : publish\n  - 夜の港シリーズ\n---\n# 見出し\n\n本文その一。",
    mustContain: ["見出し", "本文その一"],
  },
  {
    name: "区切り線から始まる本文（Thenで保存した形）",
    file: updateMarkdownBody("", "---\n\n　本文その一。\n\n---\n\n続きの場面。"),
    mustContain: ["本文その一", "続きの場面"],
  },
  {
    name: "区切り線から始まる本文＋プロパティ",
    file: "---\nslug: making-then\n---\n---\n\n　本文その一。\n\n---\n\n続きの場面。",
    mustContain: ["本文その一", "続きの場面"],
  },
  {
    name: "フロントマターなし・BOM付き",
    file: `${BOM}# 見出し\n\n本文その一。`,
    mustContain: ["見出し", "本文その一"],
  },
];

const root = process.cwd();
globalThis.fetch = async (input) => {
  const fileName = String(input).includes("Sans") ? "NotoSansCJKjp-Regular.otf" : "NotoSerifCJKjp-Regular.otf";
  return new Response(await readFile(path.join(root, "public", "fonts", fileName)), { status: 200 });
};

function check(caseName: string, format: string, output: string, mustContain: string[]): string[] {
  const problems: string[] = [];
  for (const marker of YAML_MARKERS) {
    if (output.includes(marker)) problems.push(`${format}: YAMLの「${marker}」が出ている`);
  }
  if (output.includes(BOM)) problems.push(`${format}: BOMが本文に残っている`);
  for (const text of mustContain) {
    if (!output.includes(text)) problems.push(`${format}: 本文の「${text}」が欠けている`);
  }
  return problems.map((problem) => `${caseName} / ${problem}`);
}

const failures: string[] = [];
for (const testCase of cases) {
  const source = createLoadedExportSource({ path: `C:\\fixture\\${testCase.name}.md`, name: `${testCase.name}.md` }, testCase.file, 0);
  const job: ExportJob = {
    format: "pdf",
    title: "書き出し確認",
    sources: [(({ content: _content, ...rest }) => rest)(source)],
    layout: JSON.parse(JSON.stringify(DEFAULT_EXPORT_LAYOUT)),
  };
  const linked = createLinkedExportDocument(job, [source]);
  const failuresBefore = failures.length;

  const html = buildLinkedVivliostyleHtml(linked, "http://127.0.0.1:1420/");
  failures.push(...check(testCase.name, "PDF（Vivliostyle）", html, testCase.mustContain));

  const docx = await JSZip.loadAsync(await generateVerticalDocx(linked));
  const documentXml = (await docx.file("word/document.xml")?.async("string")) ?? "";
  failures.push(...check(testCase.name, "DOCX", documentXml, testCase.mustContain));

  const submission = serializeSubmission(createSubmissionDocument([source]), { ...DEFAULT_SUBMISSION_OPTIONS, lineEnding: "lf" }).text;
  failures.push(...check(testCase.name, "投稿用テキスト", submission, testCase.mustContain));
  if (submission.trimStart().startsWith("---") && !testCase.name.startsWith("区切り線")) {
    failures.push(`${testCase.name} / 投稿用テキスト: 先頭に---が出ている`);
  }

  console.log(`${failures.length > failuresBefore ? "not ok" : "ok"} - ${testCase.name}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  throw new Error(`${failures.length} 件の書き出し不備`);
}
console.log(`front matter export checks passed (${cases.length} files × 3 formats)`);
