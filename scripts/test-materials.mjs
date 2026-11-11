// ファイル一覧の「原稿／素材」の区分（BINDER 1-3b、docs/BINDER_MATERIALS_PLAN.md）の画面側の扱いを確かめる。
// 一覧（Rust の list_project_folder）が素材に付ける role: "material" を、各処理が 3.6 の表どおりに扱うか:
//   文字数・進捗は数えない／進捗記号は付けない／検索には含める／原稿だけの取り出しから外す。
// 左サイドバーは実際に描画して、進捗記号・絞り込み・合計の字数を見る。
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `materials-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: [
      'export { collectManuscriptFiles, collectProjectTextFiles, createProjectAstSkeleton, upsertProjectAstDocumentAsts, searchProjectAstFullTextWithOptions } from "./src/editor/ast/projectAst";',
      'export { createDocumentAst } from "./src/editor/ast/documentAst";',
      'export { buildSidebarMetrics } from "./src/components/layout/sidebarMetrics";',
      'export { computeWorkStats, folderSignature } from "./src/library/libraryData";',
      'export { WorkspaceSidebar } from "./src/components/layout/WorkspaceSidebar";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react/jsx-runtime", "@tauri-apps/api", "@tauri-apps/api/*"],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
const {
  WorkspaceSidebar,
  buildSidebarMetrics,
  collectManuscriptFiles,
  collectProjectTextFiles,
  computeWorkStats,
  createDocumentAst,
  createProjectAstSkeleton,
  folderSignature,
  searchProjectAstFullTextWithOptions,
  upsertProjectAstDocumentAsts,
} = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));

// 一覧の答えの形。素材フォルダ（素材）とその中だけ role が付く。第一章/素材 は作品直下でないので原稿。
const root = "C:\\work";
const p = (...parts) => [root, ...parts].join("\\");
const file = (relative, extra = {}) => ({
  path: p(...relative.split("/")),
  name: relative.split("/").pop(),
  kind: "file",
  children: [],
  modifiedAt: 1000,
  ...extra,
});
const texts = {
  "本編.md": "# 本編\n\n汐見が来た。",
  "第一章/港.md": "# 港\n\n汐見は手紙を開いた。",
  "第一章/素材/メモ.md": "# メモ\n\n港の地図。",
  "素材/人物.md": "# 人物\n\n## 汐見\n\n港町の生まれ。",
  "素材/年表/年表.md": "# 年表\n\n汐見、十歳。",
};
const folder = {
  path: root,
  name: "work",
  children: [
    file("本編.md"),
    {
      path: p("第一章"),
      name: "第一章",
      kind: "folder",
      children: [
        file("第一章/港.md"),
        { path: p("第一章", "素材"), name: "素材", kind: "folder", children: [file("第一章/素材/メモ.md")] },
      ],
    },
    {
      path: p("素材"),
      name: "素材",
      kind: "folder",
      role: "material",
      children: [
        file("素材/人物.md", { role: "material", modifiedAt: 9000 }),
        {
          path: p("素材", "年表"),
          name: "年表",
          kind: "folder",
          role: "material",
          children: [file("素材/年表/年表.md", { role: "material" })],
        },
      ],
    },
  ],
};
const relative = (absolute) => absolute.slice(root.length + 1).split("\\").join("/");
const ast = upsertProjectAstDocumentAsts(
  createProjectAstSkeleton(folder, null),
  collectProjectTextFiles(folder).map((entry) =>
    createDocumentAst({ path: entry.path, name: entry.name, text: texts[relative(entry.path)] }),
  ),
);
const countOptions = { includeWhitespace: false, includeCode: true };
const chars = (relativePath) =>
  ast.files.find((entry) => relative(entry.path) === relativePath).visibleTextLength;
const manuscriptChars = chars("本編.md") + chars("第一章/港.md") + chars("第一章/素材/メモ.md");
const materialChars = chars("素材/人物.md") + chars("素材/年表/年表.md");

// 一覧から取り出す: 全部（AST・検索・チェックポイント・置換）と、原稿だけ（書き出し）。
assert.deepEqual(
  collectProjectTextFiles(folder).map((entry) => [relative(entry.path), entry.role ?? "manuscript"]),
  [
    ["本編.md", "manuscript"],
    ["第一章/港.md", "manuscript"],
    ["第一章/素材/メモ.md", "manuscript"],
    ["素材/人物.md", "material"],
    ["素材/年表/年表.md", "material"],
  ],
  "区分は一覧の role をそのまま写す",
);
assert.deepEqual(
  collectManuscriptFiles(folder).map((entry) => relative(entry.path)),
  ["本編.md", "第一章/港.md", "第一章/素材/メモ.md"],
  "原稿だけの取り出しは素材を外す（書き出しの候補）",
);
assert.equal(ast.files.length, 5, "AST は素材も含めて全ファイルで作る（D-2。検索とチェックポイントが使う）");

// 左のツリーの字数: 作品の合計とルートは原稿だけ。素材フォルダは自分の字数を出す。
const metrics = buildSidebarMetrics(folder, ast, countOptions.includeWhitespace, countOptions.includeCode);
assert.equal(metrics.projectTotalCharCount, manuscriptChars, "作品の合計字数に素材を入れない");
assert.equal(metrics.folderCharCounts.get(root), manuscriptChars, "ルートの字数に素材を入れない");
assert.equal(metrics.folderCharCounts.get(p("素材")), materialChars, "素材フォルダは中の素材の字数を出す");
assert.equal(metrics.folderCharCounts.get(p("素材", "年表")), chars("素材/年表/年表.md"));
assert.equal(
  metrics.folderCharCounts.get(p("第一章")),
  chars("第一章/港.md") + chars("第一章/素材/メモ.md"),
  "作品直下でない「素材」は原稿として数える",
);

// ライブラリ画面: 字数・ファイル数・進捗の内訳は原稿だけ。最終更新は素材も入れる（D-5）。
const stats = computeWorkStats(
  { folder, ast },
  { "本編.md": "writing", "素材/人物.md": "done" },
  countOptions,
);
assert.equal(stats.charCount, manuscriptChars);
assert.equal(stats.fileCount, 3);
assert.deepEqual(stats.progress, { todo: 2, writing: 1, revising: 0, done: 0, archived: 0 }, "素材に残った進捗は数えない（D-4）");
assert.equal(stats.lastModified, 9000, "最終更新は素材の更新も入れる");
const changedMaterial = structuredClone(folder);
changedMaterial.children[2].children[0].contentHash = "changed";
assert.notEqual(folderSignature(changedMaterial), folderSignature(folder), "素材が変わってもライブラリ画面は数え直す");

// 全文検索は素材も探す（D-1）。
const search = searchProjectAstFullTextWithOptions(ast, "汐見", { useRegex: false, matchCase: false });
assert.deepEqual(
  [...new Set(search.results.map((hit) => relative(hit.path)))].sort(),
  ["本編.md", "第一章/港.md", "素材/人物.md", "素材/年表/年表.md"],
  "全文検索に素材も出る",
);

// 左サイドバーを描画する。
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://127.0.0.1/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
for (const name of ["HTMLElement", "Element", "Node", "MouseEvent", "Event", "KeyboardEvent", "getComputedStyle"]) {
  globalThis[name] = name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
}
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const noop = () => {};
const sidebarProps = {
  projectFolder: folder,
  currentFilePath: p("本編.md"),
  currentFileName: "本編.md",
  currentFileCharCount: chars("本編.md"),
  focusedFolderPath: null,
  activeDocumentOutline: [],
  activeOutlineIds: new Set(),
  activeOutlineBlockId: null,
  projectAst: ast,
  countWhitespace: false,
  countCode: true,
  showOutlineGuides: true,
  fileProgress: { [p("本編.md")]: "writing", [p("素材", "人物.md")]: "done" },
  onSetFileProgress: noop,
  collapsedFolderPaths: new Set(),
  onFolderCollapsedChange: noop,
  collapsedOutlinePaths: new Set(ast.files.map((entry) => entry.path)),
  onOutlineCollapsedChange: noop,
  collapsedOutlineHeadingKeys: new Set(),
  onOutlineHeadingCollapsedChange: noop,
  projectSearchQuery: "",
  projectSearchResults: [],
  searchScope: "project",
  projectReplaceValue: "",
  isProjectReplacing: false,
  isProjectSearchMode: false,
  onProjectSearchModeChange: noop,
  onProjectSearchQueryChange: noop,
  onSearchScopeChange: noop,
  onProjectReplaceValueChange: noop,
  onOpenProjectSearchResult: noop,
  onReplaceInCurrentFile: noop,
  onReplaceInProject: noop,
  onJumpOutline: noop,
  onJumpProjectOutline: noop,
  onMoveHeadings: noop,
  onExtractHeading: noop,
  onOpenProjectFolder: noop,
  onNewDocument: noop,
  onCreateFile: noop,
  onCreateFolder: noop,
  onSelectFile: noop,
  onSelectFolder: noop,
  onOpenFileInNewTab: noop,
  onRenameEntry: noop,
  onDeleteEntry: noop,
  onMoveEntry: noop,
  onReorderEntry: noop,
  snapshots: [],
  isSnapshotSectionCollapsed: true,
  onSnapshotSectionCollapsedChange: noop,
  onCreateSnapshot: noop,
  onOpenSnapshot: noop,
  onEditSnapshotDetails: noop,
  showSnapshotSection: false,
  onRestoreSnapshot: noop,
  onDeleteSnapshot: noop,
  onCollapse: noop,
};

async function renderSidebar(progressFilter) {
  if (progressFilter) localStorage.setItem("then.sidebar.progressFilter", progressFilter);
  else localStorage.removeItem("then.sidebar.progressFilter");
  const container = document.createElement("div");
  document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(React.createElement(WorkspaceSidebar, sidebarProps)));
  const row = (absolute) =>
    container.querySelector(`[data-tree-entry-path="${absolute.replaceAll("\\", "\\\\")}"]`);
  return {
    container,
    row,
    unmount: () => act(async () => reactRoot.unmount()).then(() => container.remove()),
  };
}

{
  const view = await renderSidebar(null);
  const progressMark = (absolute) => view.row(absolute)?.querySelector(".fileProgressMarker") ?? null;
  assert.ok(progressMark(p("本編.md")), "原稿には進捗記号を出す");
  assert.ok(progressMark(p("第一章", "素材", "メモ.md")), "作品直下でない「素材」の中は原稿");
  assert.ok(view.row(p("素材", "人物.md")), "「すべて」では素材を出す（D-3: 今のツリーのまま）");
  assert.equal(progressMark(p("素材", "人物.md")), null, "素材には進捗記号を出さない（進捗が残っていても）");
  assert.equal(progressMark(p("素材", "年表", "年表.md")), null);
  assert.equal(
    view.row(p("素材"))?.querySelector(".folderProgressDot") ?? null,
    null,
    "素材フォルダには進捗の印を出さない",
  );
  assert.ok(view.row(p("第一章"))?.querySelector(".folderProgressDot"), "原稿のフォルダには進捗の印を出す");
  const total = view.container.querySelector(".fileViewSummary strong")?.textContent ?? "";
  assert.match(total.replace(/[,，]/g, ""), new RegExp(`${manuscriptChars}`), `合計は原稿だけの字数: ${total}`);
  await view.unmount();
}

{
  const view = await renderSidebar("todo");
  assert.ok(view.row(p("第一章", "港.md")), "絞り込み（未着手）で原稿の未着手は出る");
  assert.equal(view.row(p("素材")), null, "「すべて」以外の絞り込みでは素材フォルダを出さない（D-5）");
  assert.equal(view.row(p("素材", "人物.md")), null);
  await view.unmount();
}

console.log("materials: ok (roles, manuscript-only counts and export, search with materials, sidebar markers and filter)");
