import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, projectEntryActions, types, rustLib, projectState, checkpointStore, plan, legacyStateText] = await Promise.all([
  // 保存状態の正規化（normalizeState）は storedStateModel.ts へ移した。
  Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/storedStateModel.ts", "utf8"),
  ]).then((sources) => sources.join("\n")),
  readFile("src/projectEntryActions.ts", "utf8"),
  readFile("src/types.ts", "utf8"),
  readFile("src-tauri/src/lib.rs", "utf8"),
  readFile("src-tauri/src/project_state.rs", "utf8"),
  readFile("src-tauri/src/checkpoint_store.rs", "utf8"),
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
assert.match(types, /fileProgressMigrationVersions: Record<string, number>/);
assert.match(types, /checkpointMigrationVersions: Record<string, number>/);
assert.match(types, /revision: number/);
assert.match(types, /storageHash: string/);
assert.match(types, /snapshots: ManuscriptSnapshot\[\]/);
assert.match(app, /const MAX_AUTO_SHELTER_SNAPSHOTS = 3/);
assert.equal(legacyState.fileProgress["C:\\Cloud\\Novel\\chapter.md"], "writing");
assert.equal(legacyState.snapshots[0].workspacePath, "C:\\Cloud\\Novel");
assert.equal(legacyState.snapshots[0].files[0].path, "C:\\Cloud\\Novel\\chapter.md");
assert.match(app, /fileProgress: normalizeFileProgress\(value\?\.fileProgress\)/);
assert.match(app, /snapshots: normalizeSnapshots\(value\?\.snapshots\)/);
assert.match(app, /const FILE_PROGRESS_MIGRATION_VERSION = 1/);

const progressLoader = section(
  app,
  "async function loadWorkspaceFileProgress",
  "function replaceWorkspaceFileProgress",
);
assert.match(progressLoader, /load_project_file_progress/);
assert.match(progressLoader, /legacyFileProgress: shouldMigrate \? state\.fileProgress : null/);

const progressSetter = section(
  app,
  "const handleSetFileProgress =",
  "const handleSnippetStorageModeChange",
);
const persistedProgressIndex = progressSetter.indexOf('invoke<ProjectFileProgressState>("set_project_file_progress"');
const mirroredProgressIndex = progressSetter.indexOf("setAppState((current)", persistedProgressIndex);
assert.ok(persistedProgressIndex >= 0, "progress changes must use the project store");
assert.ok(
  mirroredProgressIndex > persistedProgressIndex,
  "the compatibility mirror must update only after project persistence succeeds",
);
assert.match(progressSetter, /expectedRevision: expected\?\.revision/);
assert.match(progressSetter, /expectedContentHash: expected\?\.contentHash/);
assert.match(progressSetter, /saved\.rebased/);

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
const shelterPersistIndex = fullRestore.indexOf('"create_project_checkpoint"');
const treeRestoreIndex = fullRestore.indexOf('invoke("ensure_project_folder_tree"');
assert.ok(shelterIndex >= 0, "full restore must create a pre-restore shelter");
assert.ok(
  shelterPersistIndex > shelterIndex && treeRestoreIndex > shelterPersistIndex,
  "the shelter must be persisted before restoring the project tree",
);
assert.match(fullRestore, /delete_project_entry_to_trash/);

const partialRestore = section(
  app,
  "const handleRestoreManuscriptSnapshotFiles = useCallback",
  "const handleProjectFolderSelect = useCallback",
);
assert.match(partialRestore, /selectedSnapshotFolderTree/);
assert.match(partialRestore, /selectedPathKeys/);
assert.ok(
  partialRestore.indexOf('"create_project_checkpoint"') <
    partialRestore.indexOf('invoke("ensure_project_folder_tree"'),
  "partial restore must persist its shelter before changing project files",
);

// 名前の変更・移動は、パスを覚えている置き場所を retargetPathOwners でまとめて付け替える（進み具合を含む）。
const pathOwners = section(
  projectEntryActions,
  "const retargetPathOwners = (",
  "const handleCreateProjectFile = async",
);
assert.match(pathOwners, /fileProgress: retargetRecord\(current\.fileProgress\)/);

const renameFlow = section(
  projectEntryActions,
  "const handleRenameProjectEntry = async",
  "const handleDeleteProjectEntry = async",
);
assert.match(renameFlow, /retargetPathOwners\(/);

const singleMoveFlow = section(
  projectEntryActions,
  "const handleMoveProjectEntryToFolder = async",
  "const handleMoveProjectEntriesToFolder = async",
);
assert.match(singleMoveFlow, /retargetPathOwners\(/);

const multiMoveFlow = section(
  projectEntryActions,
  "const handleMoveProjectEntriesToFolder = async",
  "const saveProjectEntryOrder = async",
);
assert.match(multiMoveFlow, /retargetPathOwners\(/);

assert.match(projectState, /schema_version: u32/);
assert.match(projectState, /revision: u64/);
assert.match(projectState, /file_progress: BTreeMap<String, ProjectFileProgress>/);
assert.match(projectState, /file\.flush\(\)/);
assert.match(projectState, /file\.sync_all\(\)/);
assert.match(projectState, /temporary project config verification failed/);
assert.match(projectState, /backup rollback failed/);
assert.match(projectState, /static PROJECT_CONFIG_LOCK: Mutex<\(\)>/);
assert.match(projectState, /fn validate_stored_project_path/);
assert.match(projectState, /fn legacy_project_file_relative_path/);
assert.match(projectState, /pub\(super\) fn load_project_file_progress/);
assert.match(projectState, /pub\(super\) fn set_project_file_progress/);
assert.match(projectState, /set_project_file_progress_guarded/);
assert.match(projectState, /project_config_digest/);
assert.match(projectState, /project state rollback conflict/);
assert.match(projectState, /project state branch conflict/);
assert.match(projectState, /config\.file_progress\.contains_key\(&relative_path\)/);
assert.match(projectState, /original_digest = project_config_digest\(&config\)/);
assert.match(projectState, /project_config_digest\(&config\)\? == original_digest/);

const deleteConfig = section(
  rustLib,
  "fn cleanup_project_config_after_delete",
  "fn hash_path_for_trash",
);
assert.match(deleteConfig, /remove_file_progress_path/);
const renameConfig = section(
  rustLib,
  "fn update_project_config_after_rename",
  "fn project_entry_names_in_display_order",
);
assert.match(renameConfig, /retarget_file_progress_path/);
const moveConfig = section(
  rustLib,
  "fn prepare_project_config_after_move",
  "fn find_project_root",
);
assert.match(moveConfig, /retarget_file_progress_path/);
assert.match(rustLib, /load_project_file_progress,/);
assert.match(rustLib, /set_project_file_progress,/);
assert.match(rustLib, /load_project_checkpoints,/);
assert.match(rustLib, /create_project_checkpoint,/);
assert.match(rustLib, /update_project_checkpoint_metadata,/);
assert.match(rustLib, /delete_project_checkpoint,/);

assert.match(checkpointStore, /const MAX_AUTO_SHELTERS: usize = 3/);
assert.match(checkpointStore, /struct StoredCheckpoint/);
const storedCheckpoint = section(
  checkpointStore,
  "struct StoredCheckpoint {",
  "pub(super) struct CheckpointLoadResult",
);
assert.doesNotMatch(storedCheckpoint, /workspace_path/);
assert.match(checkpointStore, /temporary checkpoint verification failed/);
assert.match(checkpointStore, /checkpoint revision conflict/);
assert.match(checkpointStore, /checkpoint content conflict/);
assert.match(checkpointStore, /storage_hash/);
assert.match(checkpointStore, /warnings: Vec<String>/);
assert.match(checkpointStore, /migrate_legacy_checkpoints/);
assert.match(checkpointStore, /migration_complete/);
assert.match(app, /restoredCheckpoints\.migrationComplete/);
assert.match(checkpointStore, /runtime_from_stored/);

const createSnapshot = section(
  app,
  "const handleCreateManuscriptSnapshot",
  "const handleDeleteManuscriptSnapshot",
);
assert.ok(
  createSnapshot.indexOf('invoke<CheckpointLoadResult>("create_project_checkpoint"') <
    createSnapshot.indexOf("applyCheckpointStoreResult"),
  "checkpoint mirror must update only after project persistence succeeds",
);
assert.match(app, /expectedRevision: snapshot\.revision/);
assert.match(app, /expectedHash: snapshot\.storageHash/);
assert.match(app, /detectPortableProjectConflict/);
assert.match(app, /portableProjectConflictsRef/);
assert.match(app, /portableStorageErrorMessage/);
const portableRefresh = section(
  app,
  "const refreshPortableProjectState = useCallback",
  "const openIdeaCanvasBoard",
);
assert.match(portableRefresh, /loadWorkspaceFileProgress/);
assert.match(portableRefresh, /loadWorkspaceCheckpoints/);
assert.match(portableRefresh, /window\.addEventListener\("focus", refreshOnFocus\)/);
assert.match(portableRefresh, /appMode !== "checkpoint"/);
assert.match(portableRefresh, /portableProjectMutationGenerationRef/);
assert.match(portableRefresh, /canWritePortableProjectState/);
assert.match(portableRefresh, /hasWorkspaceFileProgressChanged/);
assert.doesNotMatch(
  portableRefresh,
  /knownProgress\.revision !== progress\.revision/,
  "unrelated project.json revisions must not produce a reload notification",
);

assert.match(plan, /### Phase 0: 基準固定と失敗時設計/);
assert.match(plan, /### Phase 1: プロジェクト保存基盤の強化/);
assert.match(plan, /### Phase 2: 進捗ラベルの共有化/);
assert.match(plan, /### Phase 3: チェックポイントストアの導入/);
assert.match(plan, /### Phase 4: 外部変更と同期遅延への防御/);
assert.match(plan, /Phase 4[\s\S]*実装状況（2026-09-21）: 実装済み/);

console.log(
  "PASS portability Phase 0-4: portable state, migrations, restore safety, sync conflict guards",
);
