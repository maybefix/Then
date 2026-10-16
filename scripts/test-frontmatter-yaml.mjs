import assert from "node:assert/strict";
import { analyzeFrontMatter } from "../src/utils/frontmatterYaml.ts";

// FM-10: YAML syntax, duplicate keys and the top-level shape of the front matter.

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const errorLines = (metadata) => analyzeFrontMatter(metadata).errors.map((error) => error.line);

test("正しいYAMLはエラーなしで項目を返す", () => {
  const result = analyzeFrontMatter([
    "# サイト用",
    "slug: making-then",
    "date: 2026-10-16",
    "publish: false",
    "tags:",
    "  - 開発",
    "  - Then",
    "series:",
    "  name: 夜の港",
    "memo: |",
    "  一行目",
    "aliases: [a, b]",
  ].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.properties.map((p) => [p.key, p.line]), [
    ["slug", 2], ["date", 3], ["publish", 4], ["tags", 5], ["series", 8], ["memo", 10], ["aliases", 12],
  ]);
});

test("空・コメントだけはエラーなし・0件", () => {
  for (const metadata of ["", "\n", "# メモだけ"]) {
    assert.deepEqual(analyzeFrontMatter(metadata), { properties: [], errors: [] });
  }
});

test("重複キーを行番号つきで知らせる", () => {
  const { errors } = analyzeFrontMatter("date: 2026-10-16\ndate: 2026-10-17\nslug: a");
  assert.deepEqual(errors, [{ line: 2, message: "「date」が重複しています" }]);
});

test("構文エラーを行番号つきで知らせる（1行に1件）", () => {
  assert.deepEqual(errorLines('title: "閉じていない'), [1]);
  assert.deepEqual(errorLines("tags:\n  - x\n  -y"), [3]);
  assert.deepEqual(errorLines("a: 1\n  b: 2"), [1]);
  assert.deepEqual(errorLines("  a: 1\nb: 2"), [2]);
});

test("「名前: 値」の形でないものを知らせる", () => {
  for (const metadata of ["a:1", "ただの文章", "# メモ\n- 一覧\n- 二つ目"]) {
    const { errors } = analyzeFrontMatter(metadata);
    assert.equal(errors.length, 1, metadata);
    assert.match(errors[0].message, /名前: 値/);
  }
  assert.equal(analyzeFrontMatter("# メモ\n- 一覧").errors[0].line, 2);
});

test("CRLFでも行番号がずれない", () => {
  assert.deepEqual(analyzeFrontMatter("a: 1\r\nb: 2\r\na: 3\r\n").errors.map((e) => e.line), [3]);
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
