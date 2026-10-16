import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Typed properties over the front matter text: FM-20 (type order), FM-21 (saved
// types), FM-24 (keep what the form cannot show), FM-06 (named "properties").
const outputDir = path.join(process.cwd(), "test-artifacts", "property-model");
const bundle = path.join(outputDir, "property-model.mjs");
await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: ["src/properties/propertyModel.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: bundle,
  external: ["yaml"],
});
const {
  addMissingProperties, addProperty, ARTICLE_PROPERTY_SET, formatProperty, readProperties, removeProperty,
  renameProperty, setPropertyValue,
} = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const summary = (metadata, settings) =>
  readProperties(metadata, settings).rows.map((row) => [row.key, row.type, row.value, row.readOnly]);

const ARTICLE = [
  "# サイト用",
  "slug: making-then",
  "date: 2026-10-16",
  "publish: false",
  "tags:",
  "  - 開発",
  "  - Then",
  "description: Thenを作った話",
].join("\n");

test("値から型を決める（FM-20 ②③）", () => {
  assert.deepEqual(summary([
    "a: テキスト",
    "b: 12",
    "c: 1.50",
    "d: true",
    "e: 2026-10-16",
    "f: 2026-10-16 09:30",
    "g:",
    "  - x",
    "  - y",
    "h: [x, \"y\"]",
    "i:",
  ].join("\n")), [
    ["a", "text", "テキスト", null],
    ["b", "number", "12", null],
    ["c", "number", "1.50", null],
    ["d", "checkbox", true, null],
    ["e", "date", "2026-10-16", null],
    ["f", "datetime", "2026-10-16T09:30", null],
    ["g", "list", ["x", "y"], null],
    ["h", "list", ["x", "y"], null],
    ["i", "text", null, null],
  ]);
});

test("引用符付きの値はテキスト（\"true\"・\"2026-10-16\"・\"12\"）", () => {
  assert.deepEqual(summary('a: "true"\nb: "2026-10-16"\nc: \'12\''), [
    ["a", "text", "true", null],
    ["b", "text", "2026-10-16", null],
    ["c", "text", "12", null],
  ]);
});

test("保存済みの型を優先し、値に合わなければ変換せず読み取り専用（FM-20 ①）", () => {
  assert.deepEqual(summary("a: 2026-10-16\nb: abc\nc:\nd: 12", { a: "text", b: "date", c: "date", d: "text" }), [
    ["a", "text", "2026-10-16", null],
    ["b", "date", null, "type-mismatch"],
    ["c", "date", null, null],
    ["d", "text", "12", null],
  ]);
});

test("フォームで扱えない構造は読み取り専用（FM-24）", () => {
  const rows = summary([
    "series:",
    "  name: 夜の港",
    "memo: |",
    "  一行目",
    "anchor: &x 1",
    "alias: *x",
    "tagged: !!str 1",
    "hex: 0x1F",
    "yes_no: True",
    "nested_list:",
    "  - [a, b]",
    "inline: 1 # メモ",
    "listed:",
    "  - a # メモ",
  ].join("\n"));
  assert.deepEqual(rows.map(([key, , , readOnly]) => [key, readOnly]), [
    ["series", "structure"], ["memo", "structure"], ["anchor", "structure"], ["alias", "structure"],
    ["tagged", "structure"], ["hex", "structure"], ["yes_no", "structure"], ["nested_list", "structure"],
    ["inline", "comment"], ["listed", "comment"],
  ]);
});

test("YAMLが不正なら行を返さずエラーを返す", () => {
  const sheet = readProperties("a: 1\na: 2");
  assert.equal(sheet.rows.length, 0);
  assert.equal(sheet.errors[0].line, 2);
  assert.throws(() => setPropertyValue("a: 1\na: 2", "a", "number", "3"), /エラー/);
});

test("値を変えると、その項目の行だけが変わる", () => {
  assert.equal(
    setPropertyValue(ARTICLE, "publish", "checkbox", true),
    ARTICLE.replace("publish: false", "publish: true"),
  );
  assert.equal(
    setPropertyValue(ARTICLE, "tags", "list", ["開発", "Then", "縦書き"]),
    ARTICLE.replace("  - Then", "  - Then\n  - 縦書き"),
  );
});

test("CRLFと他の行の空白・コメントを保つ", () => {
  const source = "# メモ\r\na: 1   \r\nb: x\r\n\r\nc: 2\r\n";
  assert.equal(setPropertyValue(source, "b", "text", "y"), "# メモ\r\na: 1   \r\nb: y\r\n\r\nc: 2\r\n");
});

test("テキストは必要なときだけ引用符で囲む", () => {
  assert.equal(formatProperty("a", "text", "true"), 'a: "true"');
  assert.equal(formatProperty("a", "text", "2026-10-16"), 'a: "2026-10-16"');
  assert.equal(formatProperty("a", "text", "時刻: 9時"), 'a: "時刻: 9時"');
  assert.equal(formatProperty("a", "text", "夜の港"), "a: 夜の港");
  assert.equal(formatProperty("a", "list", []), "a: []");
  assert.equal(formatProperty("a", "list", ["1", "夜"]), 'a:\n  - "1"\n  - 夜');
  assert.equal(formatProperty("a", "checkbox", null), "a:");
  assert.equal(formatProperty("a: b", "text", "x"), '"a: b": x');
});

test("書き込んだ値を読み直すと同じ型・値になる", () => {
  for (const [type, value] of [
    ["text", "true"], ["text", "12"], ["text", "2026-10-16"], ["number", "3.25"], ["checkbox", false],
    ["date", "2026-10-16"], ["datetime", "2026-10-16T09:30"], ["list", ["a", "true", "1"]],
  ]) {
    const metadata = formatProperty("p", type, value);
    const [row] = readProperties(metadata).rows;
    assert.deepEqual([row.type, row.value], [type, value], `${type} ${JSON.stringify(value)}`);
  }
});

test("読み取り専用の項目は値を変えられない", () => {
  assert.throws(() => setPropertyValue("series:\n  name: 夜の港", "series", "text", "x"), /変更できません/);
});

test("名前を変えても値の書き方はそのまま", () => {
  assert.equal(renameProperty("a: 1 # メモ\nb: 2", "a", "c"), "c: 1 # メモ\nb: 2");
  assert.equal(renameProperty("memo: |\n  一行目\nb: 2", "memo", "メモ"), "メモ: |\n  一行目\nb: 2");
  assert.throws(() => renameProperty("a: 1\nb: 2", "a", "b"), /すでにあります/);
});

test("削除はその項目の行だけを消す", () => {
  assert.equal(removeProperty(ARTICLE, "tags"), ARTICLE.replace("tags:\n  - 開発\n  - Then\n", ""));
  assert.equal(removeProperty("# メモ\na: 1\n\nb: 2", "a"), "# メモ\n\nb: 2");
});

test("追加は末尾に付け、重複は拒む", () => {
  assert.equal(addProperty("", "slug", "text", null), "slug:");
  assert.equal(addProperty("a: 1\n", "b", "checkbox", false), "a: 1\nb: false");
  assert.equal(addProperty("a: 1", "tags", "list", []), "a: 1\ntags: []");
  assert.throws(() => addProperty("a: 1", "a", "text", "x"), /すでにあります/);
});

// FM-27 / FM-25: add a set's missing properties
test("記事用セット：空の原稿には5項目を足し、型を覚えさせる", () => {
  const { metadata, added } = addMissingProperties("", ARTICLE_PROPERTY_SET);
  assert.equal(metadata, "slug:\ndate:\npublish: false\ntags: []\ndescription:");
  assert.deepEqual(added, [
    { key: "slug", type: "text" }, { key: "date", type: "date" }, { key: "publish", type: "checkbox" },
    { key: "tags", type: "list" }, { key: "description", type: "text" },
  ]);
  assert.deepEqual(
    readProperties(metadata, Object.fromEntries(added.map((a) => [a.key, a.type]))).rows.map((r) => [r.key, r.type]),
    [["slug", "text"], ["date", "date"], ["publish", "checkbox"], ["tags", "list"], ["description", "text"]],
  );
});

test("足りない項目だけを末尾に足し、既存の値と書式は変えない", () => {
  const source = "# メモ\r\ntags:\r\n  - 開発\r\npublish: true   \r\n";
  const { metadata, added } = addMissingProperties(source, ARTICLE_PROPERTY_SET);
  assert.equal(metadata, `${source}slug:\r\ndate:\r\ndescription:`);
  assert.deepEqual(added.map((a) => a.key), ["slug", "date", "description"]);
});

test("全部そろっていれば何もしない", () => {
  const full = "slug: a\ndate: 2026-10-16\npublish: true\ntags: [x]\ndescription: d";
  assert.deepEqual(addMissingProperties(full, ARTICLE_PROPERTY_SET), { metadata: full, added: [] });
});

test("テンプレートのセットは値も書式もそのまま写し、空の値の型は決めない", () => {
  const template = {
    id: "workspace:章.md",
    name: "章",
    metadata: "status: 下書き\nwordGoal: 12000\npov:\nseries:\n  name: 夜の港\ntags:\n  - 本編",
  };
  const { metadata, added } = addMissingProperties("status: 推敲中", template);
  assert.equal(metadata, "status: 推敲中\nwordGoal: 12000\npov:\nseries:\n  name: 夜の港\ntags:\n  - 本編");
  assert.deepEqual(added, [
    { key: "wordGoal", type: "number" }, { key: "pov", type: null },
    { key: "series", type: null }, { key: "tags", type: "list" },
  ]);
});

test("原稿かセットのYAMLが壊れていれば書かない", () => {
  assert.throws(() => addMissingProperties("a: 1\na: 2", ARTICLE_PROPERTY_SET), /エラー/);
  assert.throws(() => addMissingProperties("a: 1", { id: "x", name: "壊れた", metadata: "a:1\nb: [" }), /壊れた/);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error.message}`);
  }
}
if (failed) {
  console.error(`${failed} / ${cases.length} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);
