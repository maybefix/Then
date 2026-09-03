import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createWorkspaceDocumentTabs,
  normalizeWorkspaceDocumentTabs,
  reconcileWorkspaceDocumentTabs,
  workspaceDocumentTabsKey,
} from "../src/editor/workspaceDocumentTabs.ts";

const file = (path, fileId, contentHash) => ({
  path,
  name: path.split(/[\\/]/).pop(),
  kind: "file",
  children: [],
  fileId,
  contentHash,
});
const folder = (children) => ({
  path: "C:\\project",
  name: "project",
  children,
});
const saved = (path, fileId, contentHash) => ({
  path,
  name: path.split(/[\\/]/).pop(),
  fileId,
  contentHash,
  activeOutlineLine: null,
  viewportState: null,
});

{
  const session = {
    tabs: [saved("C:\\project\\a.md", "volume:1", "old-hash")],
    activeIndex: 0,
    updatedAt: 1,
  };
  const result = reconcileWorkspaceDocumentTabs(
    session,
    folder([file("C:\\project\\a.md", "volume:99", "new-hash")]),
  );
  assert.equal(result.restored[0].match, "path", "same path must win after content changes");
  assert.equal(result.moved.length, 0);
}

{
  const session = {
    tabs: [saved("C:\\project\\old\\a.md", "volume:1", "old-hash")],
    activeIndex: 0,
    updatedAt: 1,
  };
  const result = reconcileWorkspaceDocumentTabs(
    session,
    folder([file("C:\\project\\new\\renamed.md", "volume:1", "new-hash")]),
  );
  assert.equal(result.restored[0].match, "fileId");
  assert.equal(result.moved[0].newPath, "C:\\project\\new\\renamed.md");
}

{
  const session = {
    tabs: [saved("D:\\old\\a.md", null, "same-content")],
    activeIndex: 0,
    updatedAt: 1,
  };
  const result = reconcileWorkspaceDocumentTabs(
    session,
    folder([file("C:\\project\\copied.md", "new-volume:2", "same-content")]),
  );
  assert.equal(result.restored[0].match, "contentHash");
}

{
  const session = {
    tabs: [saved("C:\\project\\missing.md", null, "duplicate")],
    activeIndex: 0,
    updatedAt: 1,
  };
  const result = reconcileWorkspaceDocumentTabs(
    session,
    folder([
      file("C:\\project\\one.md", "1", "duplicate"),
      file("C:\\project\\two.md", "2", "duplicate"),
    ]),
  );
  assert.equal(result.restored.length, 0, "ambiguous hashes must never silently pick a file");
  assert.deepEqual(result.missing.map((tab) => tab.name), ["missing.md"]);
}

{
  const session = {
    tabs: [
      saved("C:\\project\\before.md", "1", "a"),
      saved("C:\\project\\active-missing.md", "2", "b"),
      saved("C:\\project\\after.md", "3", "c"),
    ],
    activeIndex: 1,
    updatedAt: 1,
  };
  const result = reconcileWorkspaceDocumentTabs(
    session,
    folder([
      file("C:\\project\\before.md", "1", "a"),
      file("C:\\project\\after.md", "3", "c"),
    ]),
  );
  assert.equal(result.activeRestoredIndex, 1, "the next valid tab must become active");
  assert.equal(result.restored[1].entry.name, "after.md");
}

{
  const session = {
    tabs: [
      saved("C:\\project\\gone-one.md", "same-id", "same"),
      saved("C:\\project\\gone-two.md", "same-id", "same"),
    ],
    activeIndex: 0,
    updatedAt: 1,
  };
  const result = reconcileWorkspaceDocumentTabs(
    session,
    folder([file("C:\\project\\only.md", "same-id", "same")]),
  );
  assert.equal(result.restored.length, 1, "one file cannot restore two tabs");
  assert.equal(result.missing.length, 1);
}

{
  const viewportState = {
    textLength: 20,
    writingMode: "vertical-rl",
    anchorOffset: 8,
    anchorRatio: 0.4,
  };
  const session = createWorkspaceDocumentTabs(
    [
      {
        id: "file:a",
        kind: "file",
        path: "C:\\project\\a.md",
        fileId: "1",
        contentHash: "a",
        name: "a.md",
        markdown: "a",
        savedMarkdown: "a",
        editorRevision: null,
        saveStatus: "saved",
        documentKey: "a",
        activeOutlineLine: 12,
        viewportState: null,
      },
      {
        id: "scratch",
        kind: "scratch",
        path: null,
        fileId: null,
        contentHash: null,
        name: "新しいタブ",
        markdown: "",
        savedMarkdown: "",
        editorRevision: null,
        saveStatus: "saved",
        documentKey: "scratch",
        activeOutlineLine: null,
        viewportState: null,
      },
    ],
    "file:a",
    viewportState,
  );
  assert.equal(session.tabs.length, 1, "empty scratch tabs are not persisted");
  assert.deepEqual(session.tabs[0].viewportState, viewportState);
  assert.equal(session.activeIndex, 0);
}

{
  const normalized = normalizeWorkspaceDocumentTabs({
    "C:/PROJECT/": {
      tabs: [saved("C:\\project\\a.md", "1", "a"), { nope: true }],
      activeIndex: 8,
      updatedAt: 9,
    },
  });
  const key = workspaceDocumentTabsKey("c:\\project");
  assert.equal(normalized[key].tabs.length, 1);
  assert.equal(normalized[key].activeIndex, 8);
}

const [appSource, typesSource, rustSource, manualSource] = await Promise.all([
  readFile("src/App.tsx", "utf8"),
  readFile("src/types.ts", "utf8"),
  readFile("src-tauri/src/lib.rs", "utf8"),
  readFile("docs/USER_MANUAL.md", "utf8"),
]);
assert.match(typesSource, /documentTabsByWorkspace: Record<string, WorkspaceDocumentTabs>/);
assert.match(appSource, /rememberCurrentWorkspaceTabs\(\)/);
assert.match(appSource, /loadWorkspaceDocumentTabs\(folder, savedTabs\)/);
assert.match(appSource, /setOpenTabs\(nextTabs\)/);
assert.match(appSource, /移動したタブ.*件を追跡/);
assert.match(appSource, /見つからないタブ.*件を除外/);
assert.match(rustSource, /GetFileInformationByHandle/);
assert.match(rustSource, /Sha256::digest/);
assert.match(manualSource, /本文位置はプロジェクトごとに記憶されます/);
assert.match(manualSource, /ファイルIDまたは内容が一意に一致すれば復元時に追従します/);

console.log("workspace document tab reconciliation tests passed");
