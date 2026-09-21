import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, types, projectState, plan, legacyStateText] = await Promise.all([
  readFile("src/App.tsx", "utf8"),
  readFile("src/types.ts", "utf8"),
  readFile("src-tauri/src/project_state.rs", "utf8"),
  readFile("docs/PROJECT_PORTABILITY_IMPLEMENTATION_PLAN.md", "utf8"),
  readFile("scripts/fixtures/app-state-pre-portability.json", "utf8"),
]);
const legacyState = JSON.parse(legacyStateText);

const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
};

assert.match(types, /fileProgress: Record<string, FileProgressStatus>/);
assert.match(types, /snapshots: ManuscriptSnapshot\[\]/);
assert.match(app, /const MAX_AUTO_SHELTER_SNAPSHOTS = 3/);
assert.equal(legacyState.fileProgress["C:\\Cloud\\Novel\\chapter.md"], "writing");
assert.equal(legacyState.snapshots[0].workspacePath, "C:\\Cloud\\Novel");
assert.equal(legacyState.snapshots[0].files[0].path, "C:\\Cloud\\Novel\\chapter.md");
assert.match(app, /fileProgress: normalizeFileProgress\(value\?\.fileProgress\)/);
assert.match(app, /snapshots: normalizeSnapshots\(value\?\.snapshots\)/);

const snapshotBuilder = section(
  app,
  "const buildManuscriptSnapshot = useCallback",
  "const handleCreateManuscriptSnapshot",
);
assert.match(snapshotBuilder, /collectProjectTextFiles\(projectFolder\)/);
assert.match(snapshotBuilder, /projectTree: projectFolder/);
assert.match(snapshotBuilder, /textHash: documentAst\.textHash/);

const fullRestore = section(
  app,
  "const handleRestoreManuscriptSnapshot = useCallback",
  "const handleRestoreManuscriptSnapshotFiles = useCallback",
);
const shelterIndex = fullRestore.indexOf('"復元前の退避"');
const treeRestoreIndex = fullRestore.indexOf('invoke("ensure_project_folder_tree"');
assert.ok(shelterIndex >= 0, "full restore must create a pre-restore shelter");
assert.ok(
  treeRestoreIndex > shelterIndex,
  "the shelter must be recorded before restoring the project tree",
);
assert.match(fullRestore, /delete_project_entry_to_trash/);

const partialRestore = section(
  app,
  "const handleRestoreManuscriptSnapshotFiles = useCallback",
  "const handleProjectFolderSelect = useCallback",
);
assert.match(partialRestore, /selectedSnapshotFolderTree/);
assert.match(partialRestore, /selectedPathKeys/);

const renameFlow = section(
  app,
  "const handleRenameProjectEntry = async",
  "const handleDeleteProjectEntry = async",
);
assert.match(renameFlow, /fileProgress: retargetRecord\(current\.fileProgress\)/);

const singleMoveFlow = section(
  app,
  "const handleMoveProjectEntryToFolder = async",
  "const handleMoveProjectEntriesToFolder = async",
);
assert.match(singleMoveFlow, /fileProgress: retargetRecord\(current\.fileProgress\)/);

const multiMoveFlow = section(
  app,
  "const handleMoveProjectEntriesToFolder = async",
  "const saveProjectEntryOrder = async",
);
assert.match(multiMoveFlow, /fileProgress: retargetRecord\(current\.fileProgress\)/);

assert.match(projectState, /schema_version: u32/);
assert.match(projectState, /revision: u64/);
assert.match(projectState, /file_progress: BTreeMap<String, ProjectFileProgress>/);
assert.match(projectState, /file\.flush\(\)/);
assert.match(projectState, /file\.sync_all\(\)/);
assert.match(projectState, /temporary project config verification failed/);
assert.match(projectState, /backup rollback failed/);
assert.match(projectState, /static PROJECT_CONFIG_LOCK: Mutex<\(\)>/);

assert.match(plan, /### Phase 0: 基準固定と失敗時設計/);
assert.match(plan, /### Phase 1: プロジェクト保存基盤の強化/);

console.log(
  "PASS portability Phase 0-1: checkpoint invariants, path retargeting, versioned atomic project state",
);
