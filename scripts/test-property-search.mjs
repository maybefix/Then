import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// FM-28: [name:value] conditions in the search query.
const dir = path.resolve("test-artifacts/property-search");
await mkdir(dir, { recursive: true });
await build({
  stdin: {
    contents: `export * from "./src/properties/propertySearch";
export { readPropertyValues } from "./src/utils/frontmatterYaml";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: path.join(dir, "search.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["yaml"],
});
const {
  matchesPropertyConditions, parsePropertyQuery, propertyConditionQuery, propertyFileResults, readPropertyValues,
} = await import(`${pathToFileURL(path.join(dir, "search.mjs")).href}?${Date.now()}`);

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("条件を取り出し、残りを本文の検索語にする", () => {
  assert.deepEqual(parsePropertyQuery("[publish:true] 縦書き [tags:開発]"), {
    text: "縦書き",
    conditions: [{ key: "publish", value: "true" }, { key: "tags", value: "開発" }],
  });
  assert.deepEqual(parsePropertyQuery("[slug] [description:]"), {
    text: "",
    conditions: [{ key: "slug", value: null }, { key: "description", value: "" }],
  });
  assert.deepEqual(parsePropertyQuery("[ status : 推敲 中 ]").conditions, [{ key: "status", value: "推敲 中" }]);
});

test("Then記法や通常の語句は検索語のまま", () => {
  for (const query of ["[東京(rb,とうきょう)]", "[12(tcy)]", "縦書き", "[重要(em,goma)]と本文", "[a,b]"]) {
    assert.deepEqual(parsePropertyQuery(query), { text: query, conditions: [] }, query);
  }
});

const ARTICLE = readPropertyValues("slug: making-then\ndate: 2026-10-16\npublish: true\nwordCount: 1200\ntags:\n  - 開発\n  - Then\ndescription:");

test("型に合わせて比べる", () => {
  const match = (query) => matchesPropertyConditions(ARTICLE, parsePropertyQuery(query).conditions);
  assert.equal(match("[publish:true]"), true);
  assert.equal(match("[publish:false]"), false);
  assert.equal(match("[tags:開発]"), true, "リストはどれかの要素");
  assert.equal(match("[tags:then]"), true, "大文字小文字は区別しない");
  assert.equal(match("[tags:縦書き]"), false);
  assert.equal(match("[date:2026-10]"), true, "日付は前方の一部でも");
  assert.equal(match("[wordCount:1200]"), true);
  assert.equal(match("[wordCount:120]"), false, "数値は等しいときだけ");
  assert.equal(match("[slug:making]"), true, "テキストは含んでいれば");
  assert.equal(match("[SLUG]"), true, "名前は大文字小文字を区別しない");
  assert.equal(match("[title]"), false);
  assert.equal(match("[description:]"), true, "空の値");
  assert.equal(match("[slug:]"), false);
  assert.equal(match("[publish:true] [tags:開発]"), true, "条件はすべて満たすとき");
  assert.equal(match("[publish:true] [tags:縦書き]"), false);
});

test("引用符付きの\"true\"はチェックボックスのtrueと別、不正なYAMLは一致しない", () => {
  const quoted = readPropertyValues('publish: "true"');
  assert.equal(matchesPropertyConditions(quoted, [{ key: "publish", value: "true" }]), true, "テキストとしては含む");
  assert.equal(typeof quoted.publish, "string");
  assert.equal(readPropertyValues("a: 1\na: 2"), null);
  assert.equal(readPropertyValues("ただの文章"), null);
  assert.equal(matchesPropertyConditions(null, [{ key: "a", value: null }]), false);
  assert.deepEqual(readPropertyValues(""), {});
});

test("条件だけの検索はファイルごとに1件返す", () => {
  const values = new Map([
    ["C:/w/b.md", readPropertyValues("publish: true\ntags: [開発]")],
    ["C:/w/a.md", readPropertyValues("publish: true")],
    ["C:/w/c.md", readPropertyValues("publish: false")],
  ]);
  const files = [...values.keys()].map((p) => ({ path: p, name: p.split("/").pop() }));
  const outcome = propertyFileResults(files, (p) => values.get(p), [{ key: "publish", value: "true" }]);
  assert.equal(outcome.total, 2);
  assert.deepEqual(outcome.results.map((r) => r.name), ["a.md", "b.md"]);
  assert.equal(outcome.results[1].excerpt, "publish: true");
});

test("プロパティ欄からの検索語", () => {
  assert.equal(propertyConditionQuery("tags", "開発"), "[tags:開発]");
  assert.equal(propertyConditionQuery("tags", "[a]"), "[tags:a]");
  assert.deepEqual(parsePropertyQuery(propertyConditionQuery("tags", "開発")).conditions, [{ key: "tags", value: "開発" }]);
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
