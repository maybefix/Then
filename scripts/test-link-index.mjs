import assert from "node:assert/strict";
import { build } from "esbuild";

// BINDER 3-1 のリンク索引（docs/BINDER_LINK_INDEX_PLAN.md）を実際に動かして確かめる。
// 読む規則（どの行のどのリンクを数えるか）、索引を残して変わったファイルだけ読み直すこと、
// 行き先の決め方（同じ名前が2つなら決めない）、改名・移動での書き換え（ほかの文字を変えない）。
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/links/linkSyntax.ts"; export * from "./src/links/linkIndex.ts"; export * from "./src/links/linkRewrite.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { findLinks, rewriteLinks, LinkIndex, rewriteLinksAfterPathChange, linkRewriteMessage } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const ROOT = "C:\\Novel";
const p = (relative) => `${ROOT}\\${relative.split("/").join("\\")}`;
const targets = (text, isNote) => findLinks(text, isNote).map((link) => `${link.kind}:${link.target}`);

// 1. 読む規則
{
  const manuscript = [
    "---",
    'materials: ["[[汐見]]", "[[手紙と伏線]]"]',
    "---",
    "本文の [[汐見]] はリンクではない。@[[第一章/a.md]] はリンク。",
    "// メモ: [[灯台|あの灯台]] と [[汐見#過去]]",
    "  // 字下げしたコメント [[港]]",
    "\\// エスケープした行 [[本文扱い]]",
    "[[ ]] と [[改行",
    "をまたぐ]] は数えない",
  ].join("\r\n");
  assert.deepEqual(targets(manuscript, false), [
    "name:汐見",
    "name:手紙と伏線",
    "path:第一章/a.md",
    "name:灯台",
    "name:汐見",
    "name:港",
  ]);
  // ノートは全行を数える。@[[ ]] を名前のリンクとしても数えない。
  assert.deepEqual(targets("[[汐見]] と @[[素材/資料/地図.png]]\n[[人物/汐見]]", true), [
    "name:汐見",
    "path:素材/資料/地図.png",
    "name:人物/汐見",
  ]);
  assert.deepEqual(targets("リンクのない文", true), []);
  const found = findLinks("// [[灯台|あの灯台]]", false)[0];
  assert.equal("// [[灯台|あの灯台]]".slice(found.from, found.to), "灯台");
  const rewritten = rewriteLinks("前 [[灯台|あの灯台]] 後 [[港]]", true, (link) => (link.target === "灯台" ? "岬の灯台" : null));
  assert.deepEqual(rewritten, { text: "前 [[岬の灯台|あの灯台]] 後 [[港]]", count: 1 });
}

// 作品の見本。ファイルの中身と更新日時を入れ物で持つ。
function makeWork(files) {
  const texts = new Map(Object.entries(files).map(([relative, text]) => [p(relative), text]));
  const times = new Map([...texts.keys()].map((path) => [path, 1]));
  const roleOf = (path) => (path.startsWith(p("素材")) ? "material" : null);
  const stamps = () =>
    [...texts.keys()].sort().map((path) => ({
      path,
      kind: /\.(md|txt)$/i.test(path) ? "text" : "asset",
      modifiedAt: times.get(path),
      size: texts.get(path).length,
      role: roleOf(path),
    }));
  const reads = [];
  const readText = async (path) => {
    reads.push(path);
    return texts.get(path) ?? null;
  };
  const rename = (from, to) => {
    for (const path of [...texts.keys()]) {
      const moved = path === p(from) ? p(to) : path.startsWith(`${p(from)}\\`) ? p(to) + path.slice(p(from).length) : null;
      if (!moved) continue;
      texts.set(moved, texts.get(path));
      times.set(moved, times.get(path));
      texts.delete(path);
      times.delete(path);
    }
    return { oldPath: p(from), newPath: p(to) };
  };
  return { texts, times, stamps, reads, readText, rename };
}

// 2. 索引を残して、2回目は変わったファイルだけ読む
{
  const work = makeWork({
    "第一章/a.md": "// [[汐見]] を出す\n本文",
    "素材/汐見.md": "# 汐見\n[[灯台]] @[[第一章/a.md]] @[[素材/資料/地図.png]]",
    "素材/灯台.md": "# 灯台",
    "素材/資料/地図.png": "PNG",
  });
  const index = new LinkIndex(ROOT);
  index.loadCache(null);
  const first = await index.refresh(work.stamps(), work.readText);
  assert.equal(first.read, 3, "初回は txt・md を全部読む（画像は読まない）");
  assert.deepEqual(index.backlinksTo(p("素材/汐見.md")), [{ path: p("第一章/a.md"), count: 1 }]);
  assert.deepEqual(
    index.linksFrom(p("素材/汐見.md")).map((link) => link.resolved),
    [p("素材/灯台.md"), p("第一章/a.md"), p("素材/資料/地図.png")],
  );

  const cache = index.toCache();
  const again = new LinkIndex(ROOT);
  again.loadCache(cache);
  work.texts.set(p("素材/灯台.md"), "# 灯台\n[[汐見]]");
  work.times.set(p("素材/灯台.md"), 2);
  const second = await again.refresh(work.stamps(), work.readText);
  assert.equal(second.read, 1, "変わった1本だけ読む");
  assert.equal(second.changed, true);
  assert.deepEqual(again.backlinksTo(p("素材/汐見.md")).map((item) => item.path), [p("第一章/a.md"), p("素材/灯台.md")]);
  const third = await again.refresh(work.stamps(), work.readText);
  assert.deepEqual(third, { read: 0, changed: false }, "何も変わらなければ読まない");

  // 保存のあと: リンクが同じなら変わったと言わない
  assert.equal(again.setFileText(p("第一章/a.md"), "// [[汐見]] を出す\n本文を書き足した"), false);
  assert.equal(again.setFileText(p("第一章/a.md"), "本文だけ"), true);
  assert.deepEqual(again.backlinksTo(p("素材/汐見.md")).map((item) => item.path), [p("素材/灯台.md")]);

  // 削除すると行き先のないリンクになり、戻すと戻る
  const removed = work.texts.get(p("素材/灯台.md"));
  work.texts.delete(p("素材/灯台.md"));
  await again.refresh(work.stamps(), work.readText);
  assert.equal(again.linksFrom(p("素材/汐見.md"))[0].resolved, null);
  work.texts.set(p("素材/灯台.md"), removed);
  await again.refresh(work.stamps(), work.readText);
  assert.equal(again.linksFrom(p("素材/汐見.md"))[0].resolved, p("素材/灯台.md"));

  // 壊れた索引・形の古い索引は捨てて全部読む
  for (const broken of ["{", JSON.stringify({ version: 0, files: {} })]) {
    const fresh = new LinkIndex(ROOT);
    fresh.loadCache(broken);
    assert.equal((await fresh.refresh(work.stamps(), work.readText)).read, 3);
  }
}

// 3. 同じ名前が2つあるときは行き先を決めない（4A）
{
  const work = makeWork({
    "素材/人物/汐見.md": "",
    "素材/地名/汐見.md": "",
    "素材/メモ.md": "[[汐見]] [[人物/汐見]]",
  });
  const index = new LinkIndex(ROOT);
  await index.refresh(work.stamps(), work.readText);
  assert.deepEqual(index.linksFrom(p("素材/メモ.md")).map((link) => link.resolved), [null, p("素材/人物/汐見.md")]);
}

// 4. 改名・移動での書き換え
async function rewriteAfter(files, change, path) {
  const work = makeWork(files);
  const index = new LinkIndex(ROOT);
  await index.refresh(work.stamps(), work.readText);
  const changes = [work.rename(...change)];
  const plan = index.planRewrite(changes, work.stamps());
  const linking = index.filesLinkingTo(changes, work.stamps());
  const result = index.rewriteText(plan, path, work.texts.get(path));
  return { ...result, linking };
}
{
  const note = "# メモ\n[[汐見]]・[[汐見|彼女]]・[[汐見#過去]]・[[汐見.md]]\n@[[素材/汐見.md]] [[灯台]]";
  const renamed = await rewriteAfter(
    { "素材/汐見.md": "", "素材/灯台.md": "", "素材/メモ.md": note, "第一章/a.md": "本文 [[汐見]]\n// [[汐見]]" },
    ["素材/汐見.md", "素材/汐見ミナ.md"],
    p("素材/メモ.md"),
  );
  assert.equal(
    renamed.text,
    "# メモ\n[[汐見ミナ]]・[[汐見ミナ|彼女]]・[[汐見ミナ#過去]]・[[汐見ミナ.md]]\n@[[素材/汐見ミナ.md]] [[灯台]]",
  );
  assert.deepEqual(renamed.linking.sort(), [p("第一章/a.md"), p("素材/メモ.md")]);
  const manuscript = await rewriteAfter(
    { "素材/汐見.md": "", "第一章/a.md": "本文 [[汐見]]\n// [[汐見]]" },
    ["素材/汐見.md", "素材/汐見ミナ.md"],
    p("第一章/a.md"),
  );
  assert.equal(manuscript.text, "本文 [[汐見]]\n// [[汐見ミナ]]", "原稿の本文の [[ ]] は書き換えない");

  // 移動: 名前だけのリンクは替えない。パスのリンクとパス付きの名前は替える
  const moved = await rewriteAfter(
    { "素材/人物/汐見.md": "", "素材/メモ.md": "[[汐見]] [[人物/汐見]] @[[素材/人物/汐見.md]]" },
    ["素材/人物/汐見.md", "素材/脇役/汐見.md"],
    p("素材/メモ.md"),
  );
  assert.equal(moved.text, "[[汐見]] [[脇役/汐見]] @[[素材/脇役/汐見.md]]");

  // フォルダの改名: 中のファイルへのパスのリンクも替える
  const folder = await rewriteAfter(
    { "第一章/a.md": "", "素材/資料/地図.png": "", "素材/メモ.md": "@[[第一章/a.md]] @[[素材/資料/地図.png]]" },
    ["素材/資料", "素材/図版"],
    p("素材/メモ.md"),
  );
  assert.equal(folder.text, "@[[第一章/a.md]] @[[素材/図版/地図.png]]");

  // 画像の改名（3A）
  const image = await rewriteAfter(
    { "素材/資料/地図.png": "", "素材/メモ.md": "@[[素材/資料/地図.png]] [[地図.png]]" },
    ["素材/資料/地図.png", "素材/資料/港の地図.png"],
    p("素材/メモ.md"),
  );
  assert.equal(image.text, "@[[素材/資料/港の地図.png]] [[港の地図.png]]");

  // 改名で同じ名前が2つになるときは、フォルダを足して1つに決める
  const clash = await rewriteAfter(
    { "素材/人物/汐見.md": "", "素材/地名/潮見.md": "", "素材/メモ.md": "[[潮見]]" },
    ["素材/地名/潮見.md", "素材/地名/汐見.md"],
    p("素材/メモ.md"),
  );
  assert.equal(clash.text, "[[地名/汐見]]");

  // 改名の前から行き先が決まらなかったリンクは触らない（4A）
  const ambiguous = await rewriteAfter(
    { "素材/人物/汐見.md": "", "素材/地名/汐見.md": "", "素材/メモ.md": "[[汐見]]" },
    ["素材/人物/汐見.md", "素材/人物/汐見ミナ.md"],
    p("素材/メモ.md"),
  );
  assert.deepEqual([ambiguous.text, ambiguous.count, ambiguous.linking], ["[[汐見]]", 0, []]);

  // 改名したファイル自身の中のリンクも書き換える（新しいパスで読む）
  const self = await rewriteAfter(
    { "素材/汐見.md": "[[汐見]] 自分へのリンク" },
    ["素材/汐見.md", "素材/汐見ミナ.md"],
    p("素材/汐見ミナ.md"),
  );
  assert.equal(self.text, "[[汐見ミナ]] 自分へのリンク");
  assert.deepEqual(self.linking, [p("素材/汐見ミナ.md")]);
}

// 5. 改名のあとの書き換えの流れ: 開いていないファイル・表のタブ・裏のタブ・選んでもらっている最中のタブ
{
  const work = makeWork({
    "素材/汐見.md": "",
    "素材/表.md": "[[汐見]]",
    "素材/裏.md": "[[汐見]]",
    "素材/選択中.md": "[[汐見]]",
    "素材/閉じた.md": "前 [[汐見]] 後",
    "素材/外で変わる.md": "[[汐見]]",
    "素材/無関係.md": "[[灯台]]",
  });
  const index = new LinkIndex(ROOT);
  await index.refresh(work.stamps(), work.readText);
  const changes = [work.rename("素材/汐見.md", "素材/汐見ミナ.md")];
  const tab = (name, extra = {}) => ({ id: name, path: p(`素材/${name}.md`), text: "[[汐見]] 打ちかけ", isActive: false, inConflict: false, ...extra });
  const written = [];
  const applied = [];
  const conflict = new Error("conflict");
  const result = await rewriteLinksAfterPathChange({
    index,
    changes,
    stampsAfter: work.stamps(),
    openTabs: [tab("表", { isActive: true }), tab("裏"), tab("選択中", { inConflict: true })],
    readFile: async (path) => ({ content: work.texts.get(path), contentHash: `hash:${path}` }),
    writeFile: async (path, content, expectedHash) => {
      if (path === p("素材/外で変わる.md")) throw conflict;
      assert.equal(expectedHash, `hash:${path}`, "読んだときのハッシュで書く");
      written.push([path, content]);
      return content;
    },
    isConflict: (error) => error === conflict,
    applyToActiveTab: (item, text) => applied.push(["active", item.id, text]),
    applyToBackgroundTab: async (item, text) => applied.push(["background", item.id, text]),
  });
  assert.deepEqual(result, { rewritten: 3, skipped: 2 });
  assert.deepEqual(written, [[p("素材/閉じた.md"), "前 [[汐見ミナ]] 後"]], "開いていないファイルは読み直して書く");
  assert.deepEqual(applied.sort(), [
    ["active", "表", "[[汐見ミナ]] 打ちかけ"],
    ["background", "裏", "[[汐見ミナ]] 打ちかけ"],
  ], "タブは保存前の本文の上で書き換える");
  // App は書き換えのあとに読み直す。書いたファイルとタブの本文で読み直すと、リンク元が新しい名前に付く。
  for (const [path, content] of written) work.texts.set(path, content);
  const tabTexts = new Map(applied.map(([, id, text]) => [p(`素材/${id}.md`), text]));
  await index.refresh(work.stamps(), work.readText, (path) => tabTexts.get(path) ?? null);
  assert.deepEqual(index.backlinksTo(p("素材/汐見ミナ.md")).map((item) => item.path).sort(), [
    p("素材/表.md"), p("素材/裏.md"), p("素材/閉じた.md"),
  ]);

  assert.equal(linkRewriteMessage("「汐見」をリネームしました", { rewritten: 3, skipped: 0 }), "「汐見」をリネームし、3ファイルのリンクを書き換えました");
  assert.equal(
    linkRewriteMessage("2件のファイルを移動しました", { rewritten: 1, skipped: 2 }),
    "2件のファイルを移動し、1ファイルのリンクを書き換えました（ほかのアプリで変更された2ファイルは書き換えていません）",
  );
  assert.equal(linkRewriteMessage("「汐見」をリネームしました", { rewritten: 0, skipped: 0 }), null);
}

// 6. 10万字・50ファイルの重さ（BINDER 3-1 の工程5の 5-5）。時間は出すだけで、ゆるい上限だけ確かめる。
{
  const files = {};
  const paragraph = "潮の匂いのする坂を、彼女は手紙を抱えて下りていった。".repeat(4);
  for (let n = 0; n < 50; n += 1) {
    const lines = [];
    while (lines.join("\n").length < 2000) lines.push(paragraph);
    lines.splice(3, 0, `// [[汐見]] と [[灯台]] の場面 ${n}`);
    files[n < 40 ? `第${n}章.md` : `素材/ノート${n}.md`] = lines.join("\n") + (n >= 40 ? "\n[[汐見]] @[[第1章.md]]" : "");
  }
  files["素材/汐見.md"] = "# 汐見";
  files["素材/灯台.md"] = "# 灯台";
  const work = makeWork(files);
  const total = Object.values(files).reduce((sum, text) => sum + text.length, 0);
  assert.ok(total >= 100000, `10万字以上（${total}字）`);
  const index = new LinkIndex(ROOT);
  let started = performance.now();
  await index.refresh(work.stamps(), work.readText);
  const firstMs = performance.now() - started;
  const cache = index.toCache();
  const again = new LinkIndex(ROOT);
  started = performance.now();
  again.loadCache(cache);
  const second = await again.refresh(work.stamps(), work.readText);
  const secondMs = performance.now() - started;
  assert.equal(second.read, 0);
  const long = Object.values(files).join("\n");
  started = performance.now();
  for (let n = 0; n < 20; n += 1) again.setFileText(p("第0章.md"), long);
  const saveMs = (performance.now() - started) / 20;
  started = performance.now();
  const backlinks = again.backlinksTo(p("素材/汐見.md"));
  const backlinksMs = performance.now() - started;
  assert.equal(backlinks.length, 50);
  console.log(
    `10万字（${total}字・${Object.keys(files).length}ファイル）: 初回 ${firstMs.toFixed(1)}ms、2回目 ${secondMs.toFixed(1)}ms、` +
      `保存1回（${long.length}字の1本）${saveMs.toFixed(2)}ms、リンク元 ${backlinksMs.toFixed(2)}ms`,
  );
  assert.ok(saveMs < 50, "保存1回の読み直しが重すぎる");
}

console.log("link index tests passed");
