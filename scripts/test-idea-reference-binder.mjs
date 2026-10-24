import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const [types, model, app, ideaActions, binderPane, ideaPane, openCards, canvasApp, layer, css, rust] = await Promise.all([
  readFile("src/types.ts", "utf8"),
  readFile("src/ideaReferenceModel.ts", "utf8"),
  Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/layout/RightSidebar.tsx", "utf8"),
  ]).then((parts) => parts.join("\n")),
  readFile("src/ideaThreadActions.ts", "utf8"),
  readFile("src/components/binder/BinderPane.tsx", "utf8"),
  readFile("src/components/snippets/IdeaPane.tsx", "utf8"),
  readFile("src/components/binder/OpenCardsPane.tsx", "utf8"),
  readFile("src/CanvasWindowApp.tsx", "utf8"),
  readFile("src/components/references/ReferenceLayer.tsx", "utf8"),
  readFile("src/App.css", "utf8"),
  readFile("src-tauri/src/lib.rs", "utf8"),
]);

assert.match(types, /export type IdeaReferenceLink/);
assert.match(types, /sourceType: "reference"/);
assert.match(types, /export type IdeaThreadItemLink = IdeaFragmentLink \| IdeaReferenceLink/);
assert.match(types, /ideaThreads: IdeaThreadLayout\[\]/);
assert.match(types, /version: 1 \| 2 \| 3/);

assert.match(model, /normalizeIdeaReferencePath/);
assert.match(model, /reconcileIdeaThreadLayouts/);
assert.match(model, /orphanReferences/);
assert.match(model, /existingImportedFiles/);
assert.match(model, /seenReferencePaths/);

assert.match(app, /<BinderPane/);
assert.match(app, /threadLayouts=\{referenceLayout\.ideaThreads\}/);
assert.match(app, /pick_reference_files/);
assert.match(app, /addReferencesToIdeaThread/);
assert.match(app, /items: \[\.\.\.additions, \.\.\.layout\.items\]/);
assert.match(app, /items: \[makeReferenceLink\(link\.sourcePath\), \.\.\.layout\.items\]/);
assert.match(app, /countIdeaReferenceLinks/);
assert.match(app, /onMoveReference=\{moveIdeaReference\}/);
assert.match(app, /moveFragmentToNewThread/);
assert.match(app, /moveReferenceToNewThread/);
assert.match(app, /title: "新規スレッドに追加"/);
assert.match(app, /onReorderItem=\{reorderIdeaThreadItem\}/);
assert.match(app, /<OpenCardsPane/);

assert.doesNotMatch(binderPane, /BinderMode|まとめて探す|<ReferencePane/);
assert.match(binderPane, /<IdeaPane/);
assert.match(ideaPane, /placeholder="Ideaと資料を検索"/);
assert.match(ideaPane, /ファイルを追加/);
assert.match(ideaPane, /新しいテキスト資料/);
assert.match(ideaPane, /REFERENCE_FILE_DRAG_MIME/);
assert.match(ideaPane, /ideaReferenceItem/);
assert.match(ideaPane, /ファイルが見つかりません/);
assert.match(ideaPane, /別スレッドにも追加/);
assert.match(ideaPane, /新規スレッドに移動/);
assert.match(ideaPane, /新規スレッドに追加/);
assert.match(ideaPane, /資料ファイルを削除/);
assert.doesNotMatch(ideaPane, /onDoubleClick/);

assert.match(openCards, /開いているカード/);
assert.match(openCards, /onFocusCard/);
assert.match(openCards, /onCollapseCard/);
assert.doesNotMatch(openCards, /onAddReference|onQueryChange/);
assert.doesNotMatch(canvasApp, /canvasScopeSwitch|すべての作品で使えるボード/);

assert.match(app, /onDragOverCapture=\{blockIdeaDropOnEditor\}/);
assert.match(app, /onDropCapture=\{blockIdeaDropOnEditor\}/);
assert.doesNotMatch(app, /event\.dataTransfer\.setData\("text\/plain", fragment\.body\)/);
// Canvas は本文からカードを作るので本文も渡す。本文エディタへは上の blockIdeaDropOnEditor で落とさせない。
assert.match(ideaActions, /event\.dataTransfer\.setData\("text\/plain", fragment\.body\)/);

assert.match(layer, /function IdeaBinderCardBody/);
assert.doesNotMatch(layer, /onToggleIdeaUsed/);
assert.match(layer, /aria-label="バインダーカードレイヤー"/);
assert.match(layer, /window\.devicePixelRatio/);
assert.match(layer, /renderPdfPageAtDisplayScale/);

assert.match(css, /\.ideaReferenceItem\s*\{/);
assert.match(css, /\.ideaClipMenu/);
assert.match(css, /\.openCardsPane\s*\{/);

assert.match(rust, /struct IdeaThreadLayoutConfig/);
assert.match(rust, /idea_threads: Vec<IdeaThreadLayoutConfig>/);
assert.match(rust, /fn default_reference_layout_version\(\) -> i64 \{\s*3\s*\}/);
assert.match(rust, /fn pick_reference_files/);
assert.match(rust, /blocking_pick_files\(\)/);
assert.match(rust, /ReferenceImportBatchResult/);

const compiledModel = ts.transpileModule(model, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modelRuntime = await import(`data:text/javascript;base64,${Buffer.from(compiledModel).toString("base64")}`);
const threads = [
  { id: "inbox", kind: "inbox", title: "Inbox", starred: false, createdAt: 1, updatedAt: 1, fragments: [{ id: "a", body: "A", used: false, createdAt: 1, updatedAt: 1 }] },
  { id: "live", kind: "thread", title: "Live", starred: false, createdAt: 1, updatedAt: 1, fragments: [{ id: "b", body: "B", used: false, createdAt: 1, updatedAt: 1 }] },
];
const imported = [{ scope: "project", sourcePath: ".then\\references\\imports\\map.png", name: "map.png", kind: "image", size: 1, imported: true }];
const migrated = modelRuntime.reconcileIdeaThreadLayouts(
  [{ threadId: "missing-profile-thread", items: [{ id: "orphan", sourceType: "reference", sourcePath: ".then/references/imports/orphan.pdf", createdAt: 3 }] }],
  threads,
  imported,
);
assert.deepEqual(migrated.map((layout) => layout.threadId), ["inbox", "live"]);
assert.deepEqual(migrated[0].items.map((item) => item.sourceType), ["idea", "reference", "reference"]);
assert.equal(migrated[0].items[1].sourcePath, ".then/references/imports/orphan.pdf");
assert.equal(migrated[0].items[2].sourcePath, ".then/references/imports/map.png");
assert.equal(migrated[1].items[0].fragmentId, "b");

console.log("PASS binder: mixed Idea/reference threads, migration, multi-import, open-card sidebar");
