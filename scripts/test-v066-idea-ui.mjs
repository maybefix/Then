import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, ideaPane, css, userManual, packageJson, packageLock, tauriConfig, cargoToml] =
  await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/snippets/IdeaPane.tsx", "utf8"),
    readFile("src/App.css", "utf8"),
    readFile("docs/USER_MANUAL.md", "utf8"),
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("package-lock.json", "utf8").then(JSON.parse),
    readFile("src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
    readFile("src-tauri/Cargo.toml", "utf8"),
  ]);

assert.equal(packageJson.version, "0.6.7");
assert.equal(packageLock.version, "0.6.7");
assert.equal(packageLock.packages[""].version, "0.6.7");
assert.equal(tauriConfig.version, "0.6.7");
assert.match(cargoToml, /^version = "0\.6\.7"$/m);

for (const removedUi of [
  "未使用",
  "消化済み",
  "onToggleUsed",
  "onInsertFragment",
  "onInsertThread",
  "onSendFragmentToCanvas",
  "onSendThreadToCanvas",
  "CanvasSendIcon",
]) {
  assert.ok(!ideaPane.includes(removedUi), `IdeaPane must not expose ${removedUi}`);
}

assert.match(ideaPane, /type IdeaFilter = "all" \| "starred"/);
assert.match(ideaPane, /className="dangerMenuItem" onClick=\{\(\) => \{ setFragmentMenu\(null\); onDeleteFragment/);
assert.match(ideaPane, /title="ドラッグで並び替え \/ Canvasへ"/);
assert.match(ideaPane, /className="ideaMiniIcon ideaOpenCardBtn"/);
assert.match(ideaPane, /title="カードで開く"/);
assert.match(ideaPane, /aria-label="別スレッドへ移動"[\s\S]*?aria-label="カードで開く"[\s\S]*?aria-label="その他の操作"/);
const dragOverSource = ideaPane.slice(
  ideaPane.indexOf("const dragOverItem"),
  ideaPane.indexOf("const dropItem"),
);
const dropStart = ideaPane.indexOf("const dropItem");
const dropSource = ideaPane.slice(
  dropStart,
  ideaPane.indexOf("\n\n  const renderClipButton", dropStart),
);
assert.doesNotMatch(
  dragOverSource,
  /onReorderItem/,
  "reordering must not commit while merely hovering",
);
assert.match(
  dropSource,
  /onReorderItem\(threadId, source\.key, targetKey/,
  "reordering must commit on drop",
);

assert.match(
  app,
  /const captureFragment[\s\S]*?fragments: \[fragment, \.\.\.thread\.fragments\][\s\S]*?items: \[makeIdeaItem\(fragment\.id\), \.\.\.layout\.items\]/,
  "quick capture must put new Ideas at the top of every thread",
);
assert.match(
  app,
  /const addFragment[\s\S]*?fragments: \[fragment, \.\.\.thread\.fragments\][\s\S]*?items: \[makeIdeaItem\(fragment\.id\), \.\.\.layout\.items\]/,
  "thread detail additions must use the same newest-first order as quick capture",
);
assert.match(app, /title: "断片を削除"/);
assert.match(app, /showToast\("断片を削除しました", \{\s*label: "元に戻す"/);
assert.match(app, /showToast\(`「\$\{toThread\.title\}」へ移動しました`, \{\s*label: "元に戻す"/);
assert.match(app, /showToast\("並び順を変更しました", \{\s*label: "元に戻す"/);
assert.match(css, /\.toast\.hasAction\s*\{[^}]*pointer-events:\s*auto;/s);
assert.match(css, /\.referenceContextMenu \.dangerMenuItem\s*\{[^}]*var\(--danger\)/s);

assert.match(userManual, /> 対象バージョン: 0\.6\.7/);
assert.doesNotMatch(userManual, /「すべて」「未使用」「スター」/);

console.log("PASS v0.6.6 Idea UI: focused actions, consistent Inbox order, confirmations, undo");
