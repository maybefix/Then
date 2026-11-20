import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// BINDER 3-4: the right pane 「つながり」 (docs/BINDER_CONNECTIONS_PLAN.md).
// Put together from the real link index, posts and the boards' reference
// cards; drawn with React; each item calls its own way to open. Typing (a
// render where only the body changed) does not put it together again. A post
// asked for from 「元の投稿」 is scrolled to and marked in the post pane.
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const dir = path.resolve("test-artifacts/connections");
await mkdir(dir, { recursive: true });
const bundle = async (entry, name) => {
  await build({
    entryPoints: [entry],
    outfile: path.join(dir, name),
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    loader: { ".css": "empty" },
    external: ["react", "react/jsx-runtime", "react-dom", "yaml", "@tauri-apps/api/core"],
    logLevel: "error",
  });
  return import(`${pathToFileURL(path.join(dir, name)).href}?${Date.now()}`);
};
const { LinkIndex } = await bundle("src/links/linkIndex.ts", "link-index.mjs");
const { buildConnections, placeSummary, decidedCount, fileSummary } = await bundle("src/links/connections.ts", "connections.mjs");
const { ConnectionsPane } = await bundle("src/components/connections/ConnectionsPane.tsx", "pane.mjs");
const { PostStreamPane } = await bundle("src/components/posts/PostStreamPane.tsx", "posts.mjs");
const { dayKey, dayLabel, timeLabel } = await bundle("src/posts/postModel.ts", "post-model.mjs");

const ROOT = "C:\\Novel";
const p = (relative) => `${ROOT}\\${relative.split("/").join("\\")}`;
const files = {
  "第一章/届かなかった手紙.md": [
    "---",
    'synopsis: "[[汐見]]が札を裏返す"',
    "materials:",
    '  - "[[汐見]]"',
    "---",
    "汐見は窓口の札を裏返した。",
    "// [[汐見]] の台詞を直す",
    "// [[汐見]] もう一度",
  ].join("\n"),
  "第一章/最後の集荷.md": "// [[汐見]]\n// [[第一章/届かなかった手紙]] から続く",
  "第一章/素の名前だけ.md": "汐見が来た。",
  "素材/人物/汐見.md": "# 汐見\n[[灯]]",
  "素材/人物/灯.md": "[[汐見]] と話す",
  "素材/手紙と伏線.md": "[[汐見]] [[汐見]] [[A]]",
  "素材/同名/A.md": "a",
  "素材/別/A.md": "b",
};
const index = new LinkIndex(ROOT);
await index.refresh(
  Object.keys(files).sort().map((relative) => ({
    path: p(relative),
    kind: "text",
    modifiedAt: 1,
    size: files[relative].length,
    role: relative.startsWith("素材/") ? "material" : null,
  })),
  async (path) => files[Object.keys(files).find((relative) => p(relative) === path)] ?? null,
);
let detailCalls = 0;
const backlinkDetails = index.backlinkDetails.bind(index);
index.backlinkDetails = (path) => {
  detailCalls += 1;
  return backlinkDetails(path);
};

const post = (id, at, body, note) => ({ id, at, body, filed: false, noted: Boolean(note), hash: id, ...(note ? { note } : {}) });
const noteOf = (relative, workRoot = "c:/novel") => ({ work: "w-1", path: relative, workRoot, exists: true });
const posts = [
  post("p2", "2026-11-18T21:55:00+09:00", "返信: 届けたいと思う理由", noteOf("素材/人物/汐見.md")),
  post("p1", "2026-11-18T21:50:00+09:00", "\n汐見は「届けたい」と初めて思う。\n二行目", noteOf("素材/人物/汐見.md")),
  post("p3", "2026-11-18T22:00:00+09:00", "別のノート", noteOf("素材/人物/灯.md")),
  post("p4", "2026-11-18T22:01:00+09:00", "別の作品の同じパス", noteOf("素材/人物/汐見.md", "C:/Other")),
  post("p5", "2026-11-18T22:02:00+09:00", "ノートのない投稿"),
];
const boards = [
  { id: "main", name: "潮待ち郵便局", references: [{ nodeId: "n1", sourcePath: "素材/人物/汐見.md" }, { nodeId: "n2", sourcePath: "素材/人物/汐見.md" }] },
  { id: "other", name: "地図", references: [{ nodeId: "m1", sourcePath: "素材/資料/地図.png" }] },
  { id: "case", name: "大文字", references: [{ nodeId: "c1", sourcePath: "素材/人物/汐見.MD" }] },
];

// 1. 組み立て: ノート
{
  const result = buildConnections({ index, path: p("素材/人物/汐見.md"), isNote: true, posts, boards });
  assert.equal(result.kind, "note");
  assert.deepEqual(
    result.manuscripts.map((file) => [file.name, file.count, file.mentions, placeSummary(file.places, file.mentions)]),
    [
      ["最後の集荷", 1, 0, "コメント 1か所"],
      ["素の名前だけ", 0, 1, "本文 1か所"],
      ["届かなかった手紙", 4, 1, "概要 · 素材 · コメント 2か所 · 本文 1か所"],
    ],
    "原稿に登場: [[ ]] で指す原稿と、素の名前だけで出てくる原稿（BINDER 3-5）。経路を添え、素の名前は「本文」に足す。並びはパスの順",
  );
  assert.equal(decidedCount(result.manuscripts), 3, "素の名前だけの原稿も、行き先が決まっていれば数に入る");
  assert.deepEqual(result.sources.map((file) => [file.name, file.count, file.isNote]), [
    ["手紙と伏線", 2, true],
    ["灯", 1, true],
  ], "リンク元: ノート（パスの順）");
  assert.deepEqual(result.posts.map((entry) => entry.id), ["p1", "p2"], "元の投稿: この作品のこのノートだけ、古い順");
  assert.deepEqual(result.boards, [
    { id: "main", name: "潮待ち郵便局", nodeId: "n1", cards: 2 },
    { id: "case", name: "大文字", nodeId: "c1", cards: 1 },
  ], "置かれているボード: 資料カードのパスが同じ（大小は区別しない）");
}

// 2. 組み立て: 原稿（リンク元とボードだけ。リンク元には原稿も入る）
{
  const result = buildConnections({ index, path: p("第一章/届かなかった手紙.md"), isNote: false, posts, boards });
  assert.equal(result.kind, "manuscript");
  assert.deepEqual(result.manuscripts, []);
  assert.deepEqual(result.posts, [], "原稿には元の投稿を出さない");
  assert.deepEqual(result.sources.map((file) => [file.name, file.isNote, placeSummary(file.places)]), [
    ["最後の集荷", false, "コメント 1か所"],
  ]);
}

// 3. 同じ名前のノートが2つ: 両方に薄く出し、数には入れない（確認1の決定6）
{
  for (const target of ["素材/同名/A.md", "素材/別/A.md"]) {
    const result = buildConnections({ index, path: p(target), isNote: true, posts, boards });
    assert.deepEqual(result.sources.map((file) => [file.name, file.undecided, file.undecidedNames]), [["手紙と伏線", true, ["A"]]]);
    assert.equal(decidedCount(result.sources), 0);
  }
}

// 4. 経路の書き方
assert.equal(placeSummary([{ place: { in: "property", key: "materials" }, count: 2 }]), "素材 2か所");
assert.equal(placeSummary([{ place: { in: "property", key: "tags" }, count: 1 }]), "tags");
assert.equal(placeSummary([{ place: { in: "property", key: null }, count: 1 }]), "プロパティ");
assert.equal(placeSummary([{ place: { in: "body", count: 0 }, count: 3 }]), "本文 3か所");

// 5. 画面: 見出しと数（0 の欄も出す）、項目、押したときの口
async function mount(props) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const calls = { file: [], post: [], board: [] };
  const all = {
    index,
    version: 1,
    document: { path: p("素材/人物/汐見.md"), isNote: true },
    posts,
    boards,
    onOpenFile: (path) => calls.file.push(path),
    onOpenPost: (entry) => calls.post.push(entry.id),
    onOpenBoard: (id, node) => calls.board.push(`${id}#${node}`),
    ...props,
  };
  await act(async () => root.render(React.createElement(ConnectionsPane, all)));
  return { container, root, calls, props: all, rerender: (next) => act(async () => root.render(React.createElement(ConnectionsPane, next))) };
}
const sections = (container) =>
  [...container.querySelectorAll(".connectionsSection")].map((section) =>
    `${section.querySelector(".connectionsSectionTitle").textContent} ${section.querySelector(".connectionsSectionCount").textContent}`);
const items = (container, title) =>
  [...container.querySelector(`section[aria-label="${title}"]`).querySelectorAll(".connectionsItem")].map((item) =>
    [...item.querySelectorAll(".connectionsName, .connectionsSub")].map((node) => node.textContent).join(" / "));
const button = (container, title, at) =>
  container.querySelector(`section[aria-label="${title}"]`).querySelectorAll(".connectionsOpen")[at];
{
  detailCalls = 0;
  const view = await mount({});
  assert.deepEqual(sections(view.container), ["原稿に登場 3", "リンク元 2", "元の投稿 2", "置かれているボード 2"]);
  assert.deepEqual(items(view.container, "原稿に登場"), [
    "最後の集荷 / コメント 1か所",
    "素の名前だけ / 本文 1か所",
    "届かなかった手紙 / 概要 · 素材 · コメント 2か所 · 本文 1か所",
  ]);
  const day = dayLabel(dayKey("2026-11-18T21:50:00+09:00"));
  assert.deepEqual(items(view.container, "元の投稿"), [
    `汐見は「届けたい」と初めて思う。 / ${day} ${timeLabel("2026-11-18T21:50:00+09:00")}`,
    `返信: 届けたいと思う理由 / ${day} ${timeLabel("2026-11-18T21:55:00+09:00")}`,
  ], "本文の最初の行と、投稿の日と時刻");
  assert.deepEqual(items(view.container, "置かれているボード"), ["潮待ち郵便局", "大文字"]);
  await act(async () => button(view.container, "原稿に登場", 0).click());
  await act(async () => button(view.container, "リンク元", 1).click());
  await act(async () => button(view.container, "元の投稿", 0).click());
  await act(async () => button(view.container, "置かれているボード", 0).click());
  assert.deepEqual(view.calls, {
    file: [p("第一章/最後の集荷.md"), p("素材/人物/灯.md")],
    post: ["p1"],
    board: ["main#n1"],
  });
  assert.equal(detailCalls, 1, "組み立ては1回");

  // 打鍵: App は同じ値を渡す。押す口だけが新しくなっても組み立て直さない
  await view.rerender(view.props);
  await view.rerender({ ...view.props, onOpenFile: () => {}, onOpenPost: () => {} });
  assert.equal(detailCalls, 1, "打鍵では組み立て直さない");
  // 索引が変わった（version）・文書が変わったときだけ組み立て直す
  await view.rerender({ ...view.props, version: 2 });
  assert.equal(detailCalls, 2);
  await view.rerender({ ...view.props, version: 2, document: { path: p("素材/同名/A.md"), isNote: true } });
  assert.equal(detailCalls, 3);
  assert.deepEqual(sections(view.container), ["原稿に登場 0", "リンク元 0", "元の投稿 0", "置かれているボード 0"], "0 の欄も見出しを出す");
  const faint = view.container.querySelector('section[aria-label="リンク元"] .connectionsItem');
  assert.equal(faint.dataset.undecided, "true", "行き先の決まらないリンクは薄く");
  assert.equal(faint.textContent, "手紙と伏線[[A]]");
  await act(async () => view.root.unmount());
}
{
  const view = await mount({ document: { path: p("第一章/届かなかった手紙.md"), isNote: false } });
  assert.deepEqual(sections(view.container), ["リンク元 1", "置かれているボード 0"], "原稿: リンク元とボードだけ");
  assert.ok(view.container.querySelector('section[aria-label="リンク元"] svg path[d="M6 3h12v18H6z"]'), "原稿の印");
  await act(async () => view.root.unmount());
}
{
  const view = await mount({ document: null });
  assert.equal(view.container.innerHTML, '<div class="connectionsPane" aria-label="つながり"></div>', "作品の中の文書でなければ空");
  await act(async () => view.root.unmount());
  const noIndex = await mount({ index: null });
  assert.equal(noIndex.container.querySelectorAll(".connectionsSection").length, 0, "索引を読む前は空");
  await act(async () => noIndex.root.unmount());
}

// 6. 投稿のペイン: 頼まれた投稿まで送って目立たせる（一度だけ）
{
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push(this.dataset.postId);
  };
  const stream = {
    scoped: true, available: true, posts, work: { id: "w-1", name: "作品" },
    add: async () => true, editBody: async () => true, setFiled: async () => {}, remove: async () => {}, refresh: async () => {},
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (reveal) => act(async () => root.render(React.createElement(PostStreamPane, {
    stream, filter: "all", onFilterChange: () => {}, reveal,
  })));
  await render(null);
  assert.deepEqual(scrolled, []);
  await render({ id: "p1", nonce: 1 });
  assert.deepEqual(scrolled, ["p1"]);
  assert.ok(container.querySelector('[data-post-id="p1"]').classList.contains("isRevealed"));
  assert.ok(!container.querySelector('[data-post-id="p2"]').classList.contains("isRevealed"));
  await render({ id: "p1", nonce: 1 });
  assert.deepEqual(scrolled, ["p1"], "同じ頼みでは二度送らない");
  await render({ id: "p2", nonce: 2 });
  assert.deepEqual(scrolled, ["p1", "p2"]);
  await act(async () => root.unmount());
}

// 7. 投稿を読めていないあいだも、投稿の一覧は描くたびに同じ配列（「つながり」はこれで組み立て直すかを決める）
{
  const { usePostStream } = await bundle("src/posts/usePostStream.ts", "use-post-stream.mjs");
  const seen = [];
  const Probe = () => {
    seen.push(usePostStream(null, { showToast: () => {} }).posts);
    return null;
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => root.render(React.createElement(Probe)));
  assert.ok(seen.length >= 2);
  assert.ok(seen.every((posts) => posts === seen[0]), "読めていないときの空の一覧は同じ配列");
  await act(async () => root.unmount());
}

// 8. 改名のあとのリンクの書き換え（3-1）は索引の setFileText を直接呼ぶ。そのあとの refresh は、
//    ファイルを読んでも索引と同じなので「変わっていない」と言うが、画面（version）には知らせる。
//    知らせないと、「つながり」やリンクの薄い表示が、次に何かが変わるまで古いまま（3-4 の実機確認で見つけた）。
{
  const disk = new Map([
    [p("素材/汐見.md"), "# 汐見"],
    [p("素材/灯.md"), "[[汐見]] と話す"],
  ]);
  const times = new Map([[p("素材/汐見.md"), 1], [p("素材/灯.md"), 1]]);
  globalThis.__qaInvoke = async (command, args) => {
    if (command === "read_link_index_cache" || command === "write_link_index_cache") return null;
    if (command === "list_link_stamps") {
      return [...disk.keys()].sort().map((path) => ({ path, kind: "text", modifiedAt: times.get(path), size: disk.get(path).length, role: "material" }));
    }
    if (command === "read_text_file") return { content: disk.get(args.path) };
    throw new Error(`unexpected ${command}`);
  };
  const stubbed = path.join(dir, "use-link-index.mjs");
  await build({
    entryPoints: ["src/links/useLinkIndex.ts"],
    outfile: stubbed,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["react"],
    logLevel: "error",
    plugins: [{
      name: "stub-tauri",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "tauri-core", namespace: "stub" }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export const invoke = (command, args) => globalThis.__qaInvoke(command, args);",
          loader: "js",
        }));
      },
    }],
  });
  const { useLinkIndex } = await import(`${pathToFileURL(stubbed).href}?${Date.now()}`);
  let handle = null;
  const Probe = () => {
    handle = useLinkIndex({ enabled: true, rootPath: ROOT, treeKey: 1, openText: () => null });
    return null;
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => { await handle.current(ROOT); });
  const index = handle.peek(ROOT);
  assert.ok(index, "索引を読んだ");
  assert.deepEqual(index.backlinksTo(p("素材/汐見.md")).map((item) => item.path), [p("素材/灯.md")]);
  const before = handle.version;

  // 改名の書き換え: ファイルを書き、索引にも直接入れる（rewriteLinksAfterPathChange と同じ）
  disk.set(p("素材/灯.md"), "[[灯台]] と話す");
  times.set(p("素材/灯.md"), 2);
  disk.set(p("素材/灯台.md"), "# 灯台");
  times.set(p("素材/灯台.md"), 2);
  await act(async () => { await handle.refresh(); });
  const listed = handle.version;
  index.setFileText(p("素材/灯.md"), "[[汐見]] と [[灯台]] と話す");
  disk.set(p("素材/灯.md"), "[[汐見]] と [[灯台]] と話す");
  times.set(p("素材/灯.md"), 3);
  await act(async () => { await handle.refresh(); });
  assert.ok(listed > before, "一覧が変われば知らせる（今まで通り）");
  assert.ok(handle.version > listed, "索引を直接変えたあとの refresh でも、画面に知らせる");
  // 何も変わらなければ知らせない
  const settled = handle.version;
  await act(async () => { await handle.refresh(); });
  assert.equal(handle.version, settled, "何も変わらなければ知らせない");
  await act(async () => root.unmount());
}

// 素の名前の行き先が決まらないとき（BINDER 3-5 の決定3c・6）
{
  const MROOT = "C:\\Harbor";
  const at = (relative) => `${MROOT}\\${relative.split("/").join("\\")}`;
  const texts = {
    "第二部/甲.md": '---\nmaterials: ["[[人物/港守]]"]\n---\n港守が来た。港守が去った。\n@[[素材/地名/港守.md]] へ向かう。',
    "第二部/乙.md": "港守だけ。",
    "素材/人物/港守.md": "# 人の港守",
    "素材/地名/港守.md": "# 地名の港守",
  };
  const harbor = new LinkIndex(MROOT);
  await harbor.refresh(
    Object.keys(texts).sort().map((relative) => ({
      path: at(relative),
      kind: "text",
      modifiedAt: 1,
      size: texts[relative].length,
      role: relative.startsWith("素材/") ? "material" : null,
    })),
    async (path) => texts[Object.keys(texts).find((relative) => at(relative) === path)] ?? null,
  );
  const summary = (relative) =>
    buildConnections({ index: harbor, path: at(relative), isNote: true, posts: [], boards: [] }).manuscripts
      .map((file) => [file.name, file.undecided, file.mentions, file.undecidedMentions, fileSummary(file)]);
  assert.deepEqual(summary("素材/人物/港守.md"), [
    ["甲", false, 0, 2, { decided: "素材", undecided: "「港守」2か所" }],
    ["乙", true, 0, 1, { decided: "", undecided: "「港守」1か所" }],
  ], "決まった経路の行は数に入れ、決まらない素の名前は別に薄く。素の名前しかない行は行ごと薄く、[[ ]] とは出さない");
  assert.deepEqual(summary("素材/地名/港守.md"), [
    ["甲", false, 0, 2, { decided: "本文 1か所", undecided: "「港守」2か所" }],
    ["乙", true, 0, 1, { decided: "", undecided: "「港守」1か所" }],
  ], "@[[パス]] の中の名前は素の名前に数えない。決まらない素の名前は「本文」に足さない");

  const view = await mount({ index: harbor, document: { path: at("素材/人物/港守.md"), isNote: true }, posts: [], boards: [] });
  assert.deepEqual(sections(view.container)[0], "原稿に登場 1", "行き先の決まらない素の名前だけの原稿は数えない");
  assert.deepEqual(items(view.container, "原稿に登場"), ["甲 / 素材 · 「港守」2か所", "乙 / 「港守」1か所"]);
  const rows = [...view.container.querySelector('section[aria-label="原稿に登場"]').querySelectorAll(".connectionsItem")];
  assert.deepEqual(rows.map((row) => [row.dataset.undecided ?? null, row.querySelector(".connectionsUndecided")?.textContent ?? null]), [
    [null, "「港守」2か所"],
    ["true", "「港守」1か所"],
  ], "決まらない部分だけが薄い字（connectionsUndecided）");
  await act(async () => view.root.unmount());
}

// 経路の書き方: 素の名前は本文のリンク（@[[パス]]）と1つの「本文」にまとめる
assert.equal(placeSummary([{ place: { in: "body" }, count: 1 }], 2), "本文 3か所");
assert.equal(placeSummary([{ place: { in: "property", key: "materials" }, count: 1 }], 6), "素材 · 本文 6か所");
assert.equal(placeSummary([], 0), "");

console.log("connections tests passed");
