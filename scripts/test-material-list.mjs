import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// BINDER 3-3: 原稿のフロントマターの素材リスト `materials`（docs/BINDER_MATERIAL_LIST_PLAN.md）。
// 読み（どの形を受け付け、どの項目がリンクか）、書き（`materials` の行だけが変わり、ほかの行と本文は
// 1バイトも変わらない）、索引と同じ規則で読めること、改名の書き換えのあとも YAML として読めること。
const dir = path.resolve("test-artifacts/material-list");
await mkdir(dir, { recursive: true });
await build({
  stdin: {
    contents: [
      'export * from "./src/links/materialList.ts";',
      'export { findLinks, canWriteNameLink } from "./src/links/linkSyntax.ts";',
      'export { LinkIndex } from "./src/links/linkIndex.ts";',
      'export { parseFrontMatter, replaceFrontMatter } from "./src/utils/frontmatter.ts";',
      'export { readProperties } from "./src/properties/propertyModel.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: path.join(dir, "material-list.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["yaml"],
});
const {
  readMaterials, addMaterials, removeMaterial, renameMaterial, itemTarget,
  findLinks, canWriteNameLink, LinkIndex, parseFrontMatter, replaceFrontMatter, readProperties,
} = await import(`${pathToFileURL(path.join(dir, "material-list.mjs")).href}?${Date.now()}`);

let failures = 0;
function test(name, run) {
  try {
    run();
    console.log(`ok ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`NG ${name}`);
    console.error(error);
  }
}
const items = (metadata) => {
  const list = readMaterials(metadata);
  return { kind: list.kind, items: list.items?.map((item) => `${item.target ?? "-"}|${item.text}`) };
};

// 1. 読み
test("リストの項目と、どれがリンクか", () => {
  assert.deepEqual(items('materials: ["[[汐見]]", "[[手紙と伏線]]"]'), { kind: "list", items: ["汐見|[[汐見]]", "手紙と伏線|[[手紙と伏線]]"] });
  assert.deepEqual(
    items('slug: a\nmaterials:\n  - "[[汐見]]"\n  - 汐見メモ\n  - "[[灯台|あの灯台]]"\n  - "[[人物/汐見#過去]]"\n  - "@[[素材/地図.png]]"\n  - "[[a]] と [[b]]"'),
    {
      kind: "list",
      items: ["汐見|[[汐見]]", "-|汐見メモ", "灯台|[[灯台|あの灯台]]", "人物/汐見|[[人物/汐見#過去]]", "-|@[[素材/地図.png]]", "-|[[a]] と [[b]]"],
    },
  );
});
test("キーがない・空・1つだけの文字", () => {
  assert.deepEqual(items(""), { kind: "none", items: undefined });
  assert.deepEqual(items("slug: a"), { kind: "none", items: undefined });
  assert.deepEqual(items("materials:"), { kind: "list", items: [] });
  assert.deepEqual(items("materials: []"), { kind: "list", items: [] });
  assert.deepEqual(items('materials: "[[汐見]]"'), { kind: "list", items: ["汐見|[[汐見]]"] });
});
test("書けない形は読むだけで、リンクは拾う（決定5）", () => {
  assert.deepEqual(items("materials:\n  - [[汐見]]\n  - [[灯]]"), { kind: "readonly", items: ["汐見|[[汐見]]", "灯|[[灯]]"] });
  assert.deepEqual(items('materials:\n  - "[[汐見]]" # 主役'), { kind: "readonly", items: ["汐見|[[汐見]]"] });
  assert.deepEqual(items("materials: [[汐見]]"), { kind: "readonly", items: ["汐見|[[汐見]]"] });
  assert.deepEqual(items("materials: [oops"), { kind: "error", items: undefined });
});
test("項目がリンクかどうかの見分け", () => {
  assert.equal(itemTarget("[[汐見]]"), "汐見");
  assert.equal(itemTarget("  [[汐見]] "), "汐見");
  assert.equal(itemTarget("汐見"), null);
  assert.equal(itemTarget("[[汐見]]です"), null);
  assert.equal(itemTarget("[[ ]]"), null);
});

// 2. 書き: materials の行だけが変わる
const FILE = "\uFEFF---\r\ntitle: 潮待ち郵便局 # 残す\r\nmaterials:\r\n  - \"[[汐見]]\"\r\n  - 汐見メモ\r\ntags: [a, b]\r\n---\r\n\r\n　本文。[[汐見]]\r\n";
const metadataOf = (text) => parseFrontMatter(text).metadata;
const write = (text, edit) => replaceFrontMatter(text, edit(metadataOf(text)));
const outside = (text) => {
  const lines = text.split("\r\n");
  return lines.filter((line) => !/^materials:|^  - /.test(line)).join("\r\n");
};
test("足す: 末尾に二重引用符で足し、ほかの行と本文は変わらない", () => {
  const next = write(FILE, (metadata) => addMaterials(metadata, ["灯", "人物/汐見"]));
  assert.equal(
    next,
    "\uFEFF---\r\ntitle: 潮待ち郵便局 # 残す\r\nmaterials:\r\n  - \"[[汐見]]\"\r\n  - 汐見メモ\r\n  - \"[[灯]]\"\r\n  - \"[[人物/汐見]]\"\r\ntags: [a, b]\r\n---\r\n\r\n　本文。[[汐見]]\r\n",
  );
  assert.equal(outside(next), outside(FILE));
});
test("足す: 同じ名前は足さない（何も変わらなければ同じ文字列）", () => {
  const metadata = metadataOf(FILE);
  assert.equal(addMaterials(metadata, ["汐見"]), metadata);
  assert.equal(addMaterials(metadata, []), metadata);
  const twice = addMaterials(metadata, ["灯", "灯"]);
  assert.deepEqual(items(twice).items.slice(-1), ["灯|[[灯]]"]);
  assert.equal(items(twice).items.length, 3);
});
test("足す: キーがなければ末尾に足し、フロントマターがなければ作る", () => {
  assert.equal(write("---\r\nslug: a\r\n---\r\n本文\r\n", (m) => addMaterials(m, ["汐見"])), "---\r\nslug: a\r\nmaterials:\r\n  - \"[[汐見]]\"\r\n---\r\n本文\r\n");
  assert.equal(write("本文だけ\r\n", (m) => addMaterials(m, ["汐見"])), "---\r\nmaterials:\r\n  - \"[[汐見]]\"\r\n---\r\n本文だけ\r\n");
  assert.equal(write("本文だけ\n", (m) => addMaterials(m, ["汐見"])), "---\nmaterials:\n  - \"[[汐見]]\"\n---\n本文だけ\n");
  assert.equal(write('---\nmaterials: "[[汐見]]"\n---\n', (m) => addMaterials(m, ["灯"])), '---\nmaterials:\n  - "[[汐見]]"\n  - "[[灯]]"\n---\n');
});
test("外す: その項目だけ。最後の1つなら materials: [] を残す（決定3）", () => {
  const next = write(FILE, (metadata) => removeMaterial(metadata, 0));
  assert.equal(next, FILE.replace('  - "[[汐見]]"\r\n', ""));
  const empty = write(next, (metadata) => removeMaterial(metadata, 0));
  assert.equal(empty, FILE.replace('materials:\r\n  - "[[汐見]]"\r\n  - 汐見メモ\r\n', "materials: []\r\n"));
  assert.equal(removeMaterial(metadataOf(FILE), 5), metadataOf(FILE));
});
test("名前を直す: | と # は残す", () => {
  const metadata = 'materials:\n  - "[[汐見|彼女]]"\n  - "[[灯]]"';
  assert.equal(renameMaterial(metadata, 0, "人物/汐見"), 'materials:\n  - "[[人物/汐見|彼女]]"\n  - "[[灯]]"');
  assert.equal(renameMaterial(metadata, 1, "灯"), metadata);
});
test("書けない形には書かない", () => {
  assert.throws(() => addMaterials("materials:\n  - [[汐見]]", ["灯"]));
  assert.throws(() => addMaterials("materials: [oops", ["灯"]));
  assert.equal(removeMaterial("materials:\n  - [[汐見]]", 0), "materials:\n  - [[汐見]]");
});

// 3. 索引（3-1）と同じ規則で読める
test("足した項目を、索引の読む規則も同じ名前で読む", () => {
  const next = write(FILE, (metadata) => addMaterials(metadata, ["灯", "人物/汐見"]));
  const names = findLinks(next, false).map((link) => `${link.kind}:${link.target}`);
  // 本文の [[汐見]] は原稿なので数えない。フロントマターの3つだけ。
  assert.deepEqual(names, ["name:汐見", "name:灯", "name:人物/汐見"]);
});
test("[[名前]] で指せない名前（決定5）", () => {
  for (const name of ["汐見", "人物/汐見", "a[b", "灯 台"]) assert.equal(canWriteNameLink(name), true, name);
  for (const name of ["a#b", "a|b", "a]", "a]]b", "a[[b", "", " "]) assert.equal(canWriteNameLink(name), false, name);
});

// 4. 改名の書き換え（3-1）のあとも YAML として読める
await (async () => {
  const ROOT = "C:\\Novel";
  const p = (relative) => `${ROOT}\\${relative.split("/").join("\\")}`;
  const manuscript = write("---\nslug: a\n---\n本文\n", (m) => addMaterials(m, ["汐見", "灯"]));
  const files = new Map([[p("素材/汐見.md"), ""], [p("素材/灯.md"), ""], [p("第一章/a.md"), manuscript]]);
  const stamps = (paths) => paths.map((file) => ({ path: file, kind: "text", modifiedAt: 1, size: 0, role: file.startsWith(p("素材")) ? "material" : null }));
  const index = new LinkIndex(ROOT);
  await index.refresh(stamps([...files.keys()]), async (file) => files.get(file) ?? null);
  const after = stamps([p("素材/人物/汐見.md"), p("素材/灯.md"), p("第一章/a.md")]);
  const plan = index.planRewrite([{ oldPath: p("素材/汐見.md"), newPath: p("素材/人物/汐見.md") }], after);
  const { text, count } = index.rewriteText(plan, p("第一章/a.md"), manuscript);
  test("フォルダへ移しても名前が1つに決まるなら、materials は書き換えない", () => {
    assert.equal(count, 0);
    assert.equal(text, manuscript);
  });
  const moved = stamps([p("素材/人物/汐見ミナ.md"), p("素材/灯.md"), p("第一章/a.md")]);
  const renamed = index.rewriteText(index.planRewrite([{ oldPath: p("素材/汐見.md"), newPath: p("素材/人物/汐見ミナ.md") }], moved), p("第一章/a.md"), manuscript);
  test("別の名前への改名でも、materials は読める", () => {
    assert.equal(renamed.text, '---\nslug: a\nmaterials:\n  - "[[汐見ミナ]]"\n  - "[[灯]]"\n---\n本文\n');
    assert.equal(renamed.count, 1);
    assert.equal(readProperties(metadataOf(renamed.text)).errors.length, 0);
    assert.deepEqual(items(metadataOf(renamed.text)).items, ["汐見ミナ|[[汐見ミナ]]", "灯|[[灯]]"]);
  });
})();

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("material list: all passed");
