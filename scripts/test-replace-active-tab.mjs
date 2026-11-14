import assert from "node:assert/strict";
import { build } from "esbuild";

// 作業中のタブを別のファイルで置き換えるときの、タブの一覧の作り方（docs/DELETE_DUPLICATE_TAB_PLAN.md）。
// タブの ID はパスから作るので、同じファイルのタブを ID で見分けると、古いタブを畳めず2つ残っていた。
const bundled = await build({
  entryPoints: ["src/editor/documentTabState.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
const { replaceDocumentTab, createFileDocumentTab } = await import(moduleUrl);
assert.equal(typeof replaceDocumentTab, "function", "replaceDocumentTab is exported from documentTabState.ts");

const p = (name) => `C:\\作品\\${name}`;
const doc = (name, content = `${name} の中身`) => ({ path: p(name), name, content });
const tab = (name, extra = {}) => ({ ...createFileDocumentTab(doc(name)), ...extra });
const paths = (tabs) => tabs.map((item) => item.path ?? item.kind);

// 名前を付けて保存で、別のタブで開いているファイルに上書きした: 作業中の場所に1つだけ残す。
{
  const tabs = [tab("a.md"), tab("b.md", { markdown: "書きかけ", saveStatus: "dirty" }), tab("c.md")];
  const next = createFileDocumentTab(doc("b.md", "保存した中身"));
  const result = replaceDocumentTab(tabs, tabs[0].id, next);
  assert.deepEqual(paths(result), [p("b.md"), p("c.md")], "the other tab of the same file is folded");
  assert.equal(result[0].markdown, "保存した中身");
}

// ふつうの保存（同じファイルで置き換える）: 一覧は変わらない。
{
  const tabs = [tab("a.md"), tab("c.md")];
  const result = replaceDocumentTab(tabs, tabs[0].id, createFileDocumentTab(doc("a.md", "新しい中身")));
  assert.deepEqual(paths(result), [p("a.md"), p("c.md")]);
  assert.equal(result[0].markdown, "新しい中身");
  assert.equal(result[1], tabs[1], "other tabs are left as they were");
}

// 作業中のタブがもう一覧にない（外したあと）で、同じファイルのタブがある: そのタブの場所で1つにする。
{
  const tabs = [tab("c.md"), tab("b.md"), tab("d.md")];
  const result = replaceDocumentTab(tabs, `file:${p("a.md")}`, createFileDocumentTab(doc("b.md")));
  assert.deepEqual(paths(result), [p("c.md"), p("b.md"), p("d.md")], "no second tab of b.md");
}

// 作業中のタブがもう一覧になく、そのファイルも開いていない: 末尾に足す。
{
  const tabs = [tab("c.md")];
  const result = replaceDocumentTab(tabs, `file:${p("a.md")}`, createFileDocumentTab(doc("b.md")));
  assert.deepEqual(paths(result), [p("c.md"), p("b.md")]);
}

// パスは区切りと大文字小文字を揃えて比べる。
{
  const tabs = [tab("a.md"), { ...tab("B.md"), path: "c:/作品/b.md" }];
  const result = replaceDocumentTab(tabs, tabs[0].id, createFileDocumentTab(doc("B.md")));
  assert.deepEqual(paths(result), [p("B.md")]);
}

// 空のタブ（新しいタブの置き場）は、今までどおり外す。
{
  const tabs = [{ id: "empty-1", kind: "empty", path: null }, tab("a.md")];
  const result = replaceDocumentTab(tabs, tabs[1].id, createFileDocumentTab(doc("a.md")));
  assert.deepEqual(paths(result), [p("a.md")]);
}

console.log("replace active tab tests passed");
