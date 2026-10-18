// Writes the manuscripts used by docs/FRONTMATTER_QA_CHECKLIST.md into a work
// folder of a test library. Existing files are never overwritten.
//   node scripts/create-frontmatter-qa-files.mjs "C:\path\to\QAライブラリ\作品A"
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const target = process.argv[2];
if (!target || !existsSync(target)) {
  console.error("作品フォルダのパスを指定してください（存在するフォルダ）");
  process.exit(1);
}

const BOM = String.fromCharCode(0xfeff);
const crlf = (text) => text.replace(/\n/g, "\r\n");
const files = {
  "01_BOM付き.md": `${BOM}---\nslug: bom-file\npublish: true\ntags:\n  - 確認\n---\n# BOM付きの原稿\n\n本文その一。`,
  "02_CRLF.md": crlf("---\nslug: crlf-file\ndate: 2026-10-16\n---\n# CRLFの原稿\n\n本文その一。\n"),
  "03_区切り線から始まる.md": "---\n\n　汽笛が二度鳴って、それきり静かになった。\n\n---\n\n　続きの場面。",
  "04_閉じがない.md": "---\nslug: unclosed\npublish: true\n\n本文その一。",
  "05_不正なYAML.md": "---\nslug making-then\npublish: true\npublish: false\n---\n# 不正なYAML\n\n本文その一。",
  "06_扱えない値.md": [
    "---",
    "# 作品メモ",
    "status: 推敲中",
    "series:",
    "  name: 夜の港",
    "  order: 3",
    "memo: |",
    "  港の灯りの数を前章と揃える",
    "anchor: &x 1",
    "inline: 12 # 目標",
    "aliases: [夜の港 3, 港]",
    "---",
    "# 扱えない値",
    "",
    "本文その一。",
  ].join("\n"),
  "07_記事.md": [
    "---",
    "slug: making-then",
    "date: 2026-10-16",
    "publish: true",
    "tags:",
    "  - 開発",
    "  - Then",
    "description: Thenを作った話",
    "---",
    "",
    "# Thenを作った話",
    "",
    "　縦書きで長い原稿を書くためのエディタが欲しくて、Thenを作りはじめた。",
  ].join("\n"),
  "08_記事_非公開.md": "---\nslug: draft-article\ndate: 2026-09-01\npublish: false\ntags: [開発, 下書き]\n---\n# 非公開の記事\n\n本文その一。",
  "09_プロパティなし.md": "# プロパティのない原稿\n\n本文その一。",
};

for (const [name, content] of Object.entries(files)) {
  const file = path.join(target, name);
  if (existsSync(file)) {
    console.log(`skip  ${name}（すでにある）`);
    continue;
  }
  await writeFile(file, content, "utf8");
  console.log(`write ${name}`);
}
