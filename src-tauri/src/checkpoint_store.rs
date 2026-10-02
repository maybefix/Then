use super::project_state::{
    path_exists_checked, trusted_project_relative_path, validate_stored_project_path,
};
use super::{ProjectEntry, ProjectFolder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

const CHECKPOINT_SCHEMA_VERSION: u32 = 1;
const MAX_AUTO_SHELTERS: usize = 3;
static CHECKPOINT_STORE_LOCK: Mutex<()> = Mutex::new(());

fn default_checkpoint_revision() -> u64 {
    1
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManuscriptSnapshotFile {
    pub(super) path: String,
    pub(super) name: String,
    pub(super) text: String,
    pub(super) text_hash: String,
    pub(super) semantic_hash: String,
    pub(super) line_count: usize,
    pub(super) text_length: usize,
    pub(super) visible_text_length: usize,
    pub(super) outline_count: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManuscriptSnapshot {
    pub(super) id: String,
    #[serde(default = "default_checkpoint_revision")]
    pub(super) revision: u64,
    #[serde(default)]
    pub(super) storage_hash: String,
    pub(super) workspace_path: String,
    pub(super) workspace_name: String,
    pub(super) created_at: i64,
    pub(super) reason: String,
    pub(super) label: String,
    #[serde(default)]
    pub(super) memo: String,
    #[serde(default)]
    pub(super) parent_ids: Vec<String>,
    pub(super) project_tree: ProjectFolder,
    pub(super) files: Vec<ManuscriptSnapshotFile>,
    pub(super) file_count: usize,
    pub(super) total_text_length: usize,
    pub(super) total_visible_text_length: usize,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredCheckpointFile {
    path: String,
    name: String,
    text: String,
    text_hash: String,
    semantic_hash: String,
    line_count: usize,
    text_length: usize,
    visible_text_length: usize,
    outline_count: usize,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredProjectEntry {
    path: String,
    name: String,
    kind: String,
    #[serde(default)]
    children: Vec<StoredProjectEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_hash: Option<String>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredProjectFolder {
    path: String,
    name: String,
    #[serde(default)]
    children: Vec<StoredProjectEntry>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredCheckpoint {
    schema_version: u32,
    revision: u64,
    id: String,
    created_at: i64,
    reason: String,
    label: String,
    memo: String,
    #[serde(default)]
    parent_ids: Vec<String>,
    project_tree: StoredProjectFolder,
    files: Vec<StoredCheckpointFile>,
    file_count: usize,
    total_text_length: usize,
    total_visible_text_length: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CheckpointLoadResult {
    pub(super) snapshots: Vec<ManuscriptSnapshot>,
    pub(super) warnings: Vec<String>,
    pub(super) migrated_count: usize,
    pub(super) migration_complete: bool,
}

struct MigrationOutcome {
    migrated_count: usize,
    complete: bool,
}

fn lock_checkpoint_store() -> Result<MutexGuard<'static, ()>, String> {
    CHECKPOINT_STORE_LOCK
        .lock()
        .map_err(|error| format!("failed to lock checkpoint store: {error}"))
}

fn checkpoint_directory(root: &Path) -> PathBuf {
    root.join(".then").join("checkpoints")
}

fn validate_checkpoint_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("checkpoint id contains invalid characters".to_string());
    }
    Ok(())
}

fn checkpoint_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    validate_checkpoint_id(id)?;
    Ok(checkpoint_directory(root).join(format!("{id}.json")))
}

fn validate_stored_tree_entry(entry: &StoredProjectEntry) -> Result<(), String> {
    validate_stored_project_path(&entry.path)?;
    if entry.kind != "file" && entry.kind != "folder" {
        return Err("checkpoint tree entry kind is invalid".to_string());
    }
    for child in &entry.children {
        validate_stored_tree_entry(child)?;
    }
    Ok(())
}

fn validate_stored_checkpoint(checkpoint: &StoredCheckpoint) -> Result<(), String> {
    if checkpoint.schema_version != CHECKPOINT_SCHEMA_VERSION {
        return Err(format!(
            "unsupported checkpoint schema version: {}",
            checkpoint.schema_version
        ));
    }
    if checkpoint.revision == 0 {
        return Err("checkpoint revision must be positive".to_string());
    }
    validate_checkpoint_id(&checkpoint.id)?;
    if !matches!(checkpoint.reason.as_str(), "manual" | "auto-before-restore") {
        return Err("checkpoint reason is invalid".to_string());
    }
    for parent_id in &checkpoint.parent_ids {
        validate_checkpoint_id(parent_id)?;
    }
    if checkpoint.project_tree.path != "." {
        return Err("checkpoint project root path must be '.'".to_string());
    }
    for entry in &checkpoint.project_tree.children {
        validate_stored_tree_entry(entry)?;
    }
    if checkpoint.files.is_empty() {
        return Err("checkpoint must contain at least one file".to_string());
    }
    let mut paths = BTreeSet::new();
    for file in &checkpoint.files {
        validate_stored_project_path(&file.path)?;
        if !paths.insert(file.path.to_lowercase()) {
            return Err("checkpoint contains duplicate file paths".to_string());
        }
    }
    if checkpoint.file_count != checkpoint.files.len() {
        return Err("checkpoint file count does not match files".to_string());
    }
    Ok(())
}

fn parse_stored_checkpoint_content(path: &Path, content: &str) -> Result<StoredCheckpoint, String> {
    let checkpoint: StoredCheckpoint = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    validate_stored_checkpoint(&checkpoint)?;
    Ok(checkpoint)
}

fn parse_stored_checkpoint_file(path: &Path) -> Result<StoredCheckpoint, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    parse_stored_checkpoint_content(path, &content)
}

fn validate_checkpoint_filename(
    path: &Path,
    checkpoint: StoredCheckpoint,
) -> Result<StoredCheckpoint, String> {
    let expected_id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "checkpoint filename is not valid unicode".to_string())?;
    if checkpoint.id != expected_id {
        return Err("checkpoint id does not match its filename".to_string());
    }
    Ok(checkpoint)
}

fn read_stored_checkpoint_file(path: &Path) -> Result<StoredCheckpoint, String> {
    validate_checkpoint_filename(path, parse_stored_checkpoint_file(path)?)
}

fn read_stored_checkpoint(path: &Path) -> Result<StoredCheckpoint, String> {
    // A read failure can mean a temporarily unavailable file. Only a readable
    // but invalid primary may be recovered from its backup.
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let parsed = String::from_utf8(bytes)
        .map_err(|error| format!("failed to decode {}: {error}", path.display()))
        .and_then(|content| parse_stored_checkpoint_content(path, &content))
        .and_then(|checkpoint| validate_checkpoint_filename(path, checkpoint));
    match parsed {
        Ok(checkpoint) => Ok(checkpoint),
        Err(primary_error) => {
            if primary_error.contains("unsupported checkpoint schema version") {
                return Err(primary_error);
            }
            let backup_path = path.with_extension("json.bak");
            if !path_exists_checked(&backup_path)? {
                return Err(primary_error);
            }
            let backup = parse_stored_checkpoint_file(&backup_path).map_err(|backup_error| {
                format!("{primary_error}; checkpoint backup recovery failed: {backup_error}")
            })?;
            let expected_id = path
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "checkpoint filename is not valid unicode".to_string())?;
            if backup.id != expected_id {
                return Err(format!(
                    "{primary_error}; checkpoint backup id does not match its filename"
                ));
            }
            std::fs::copy(&backup_path, path)
                .map_err(|error| format!("failed to restore checkpoint backup: {error}"))?;
            Ok(backup)
        }
    }
}

fn temporary_checkpoint_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("checkpoint.json");
    path.with_file_name(format!(
        "{file_name}.tmp-{}-{}",
        std::process::id(),
        super::now_millis()
    ))
}

fn write_verified_checkpoint(
    path: &Path,
    checkpoint: &StoredCheckpoint,
) -> Result<PathBuf, String> {
    validate_stored_checkpoint(checkpoint)?;
    let content = serde_json::to_string_pretty(checkpoint)
        .map_err(|error| format!("failed to serialize checkpoint: {error}"))?;
    let temporary_path = temporary_checkpoint_path(path);
    let mut file = std::fs::File::create(&temporary_path)
        .map_err(|error| format!("failed to create temporary checkpoint: {error}"))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("failed to write temporary checkpoint: {error}"))?;
    file.flush()
        .map_err(|error| format!("failed to flush temporary checkpoint: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("failed to sync temporary checkpoint: {error}"))?;
    drop(file);

    let verification = std::fs::read_to_string(&temporary_path)
        .map_err(|error| format!("failed to reread temporary checkpoint: {error}"))
        .and_then(|content| {
            serde_json::from_str::<StoredCheckpoint>(&content)
                .map_err(|error| format!("failed to parse temporary checkpoint: {error}"))
        })
        .and_then(|stored| {
            validate_stored_checkpoint(&stored)?;
            if &stored != checkpoint {
                return Err("temporary checkpoint changed during verification".to_string());
            }
            Ok(())
        });
    if let Err(error) = verification {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("temporary checkpoint verification failed: {error}"));
    }
    Ok(temporary_path)
}

fn create_checkpoint_file(root: &Path, checkpoint: &StoredCheckpoint) -> Result<(), String> {
    let path = checkpoint_path(root, &checkpoint.id)?;
    if path_exists_checked(&path)? {
        return Err("checkpoint already exists".to_string());
    }
    std::fs::create_dir_all(checkpoint_directory(root))
        .map_err(|error| format!("failed to create checkpoint directory: {error}"))?;
    let temporary_path = write_verified_checkpoint(&path, checkpoint)?;
    if let Err(error) = std::fs::rename(&temporary_path, &path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("failed to promote checkpoint: {error}"));
    }
    Ok(())
}

fn replace_checkpoint_file(path: &Path, checkpoint: &StoredCheckpoint) -> Result<(), String> {
    let temporary_path = write_verified_checkpoint(path, checkpoint)?;
    let backup_path = path.with_extension("json.bak");
    if backup_path.exists() {
        std::fs::remove_file(&backup_path)
            .map_err(|error| format!("failed to replace checkpoint backup: {error}"))?;
    }
    if let Err(error) = std::fs::rename(path, &backup_path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("failed to back up checkpoint: {error}"));
    }
    if let Err(error) = std::fs::rename(&temporary_path, path) {
        let rollback_error = std::fs::rename(&backup_path, path).err();
        let _ = std::fs::remove_file(&temporary_path);
        return Err(match rollback_error {
            Some(rollback_error) => format!(
                "failed to promote checkpoint: {error}; checkpoint rollback failed: {rollback_error}"
            ),
            None => format!("failed to promote checkpoint: {error}"),
        });
    }
    Ok(())
}

fn runtime_relative_path(root: &Path, path: &str) -> Result<String, String> {
    let path = Path::new(path);
    if path.exists() {
        let root = root
            .canonicalize()
            .map_err(|error| format!("failed to resolve project root: {error}"))?;
        let path = path
            .canonicalize()
            .map_err(|error| format!("failed to resolve checkpoint path: {error}"))?;
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| "checkpoint path is outside project root".to_string())?;
        let relative = relative.to_string_lossy().replace('\\', "/");
        validate_stored_project_path(&relative)?;
        Ok(relative)
    } else {
        trusted_project_relative_path(root, path)
    }
}

fn stored_tree_entry(root: &Path, entry: &ProjectEntry) -> Result<StoredProjectEntry, String> {
    Ok(StoredProjectEntry {
        path: runtime_relative_path(root, &entry.path)?,
        name: entry.name.clone(),
        kind: entry.kind.clone(),
        children: entry
            .children
            .iter()
            .map(|child| stored_tree_entry(root, child))
            .collect::<Result<Vec<_>, _>>()?,
        file_id: entry.file_id.clone(),
        content_hash: entry.content_hash.clone(),
    })
}

fn stored_from_runtime(
    root: &Path,
    snapshot: &ManuscriptSnapshot,
) -> Result<StoredCheckpoint, String> {
    if !same_workspace(root, Path::new(&snapshot.workspace_path)) {
        return Err("checkpoint belongs to another project".to_string());
    }
    let stored = StoredCheckpoint {
        schema_version: CHECKPOINT_SCHEMA_VERSION,
        revision: snapshot.revision.max(1),
        id: snapshot.id.clone(),
        created_at: snapshot.created_at,
        reason: snapshot.reason.clone(),
        label: snapshot.label.clone(),
        memo: snapshot.memo.clone(),
        parent_ids: snapshot.parent_ids.clone(),
        project_tree: StoredProjectFolder {
            path: ".".to_string(),
            name: snapshot.project_tree.name.clone(),
            children: snapshot
                .project_tree
                .children
                .iter()
                .map(|entry| stored_tree_entry(root, entry))
                .collect::<Result<Vec<_>, _>>()?,
        },
        files: snapshot
            .files
            .iter()
            .map(|file| {
                Ok(StoredCheckpointFile {
                    path: runtime_relative_path(root, &file.path)?,
                    name: file.name.clone(),
                    text: file.text.clone(),
                    text_hash: file.text_hash.clone(),
                    semantic_hash: file.semantic_hash.clone(),
                    line_count: file.line_count,
                    text_length: file.text_length,
                    visible_text_length: file.visible_text_length,
                    outline_count: file.outline_count,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        file_count: snapshot.file_count,
        total_text_length: snapshot.total_text_length,
        total_visible_text_length: snapshot.total_visible_text_length,
    };
    validate_stored_checkpoint(&stored)?;
    Ok(stored)
}

fn absolute_path(root: &Path, relative: &str) -> String {
    relative
        .split('/')
        .fold(root.to_path_buf(), |path, component| path.join(component))
        .to_string_lossy()
        .to_string()
}

fn runtime_tree_entry(root: &Path, entry: StoredProjectEntry) -> ProjectEntry {
    ProjectEntry {
        path: absolute_path(root, &entry.path),
        name: entry.name,
        kind: entry.kind,
        children: entry
            .children
            .into_iter()
            .map(|child| runtime_tree_entry(root, child))
            .collect(),
        file_id: entry.file_id,
        content_hash: entry.content_hash,
        modified_at: None,
    }
}

fn runtime_from_stored(
    root: &Path,
    checkpoint: StoredCheckpoint,
) -> Result<ManuscriptSnapshot, String> {
    let storage_hash = checkpoint_digest(&checkpoint)?;
    Ok(ManuscriptSnapshot {
        id: checkpoint.id,
        revision: checkpoint.revision,
        storage_hash,
        workspace_path: root.to_string_lossy().to_string(),
        workspace_name: checkpoint.project_tree.name.clone(),
        created_at: checkpoint.created_at,
        reason: checkpoint.reason,
        label: checkpoint.label,
        memo: checkpoint.memo,
        parent_ids: checkpoint.parent_ids,
        project_tree: ProjectFolder {
            path: root.to_string_lossy().to_string(),
            name: checkpoint.project_tree.name,
            children: checkpoint
                .project_tree
                .children
                .into_iter()
                .map(|entry| runtime_tree_entry(root, entry))
                .collect(),
            library: None,
        },
        files: checkpoint
            .files
            .into_iter()
            .map(|file| ManuscriptSnapshotFile {
                path: absolute_path(root, &file.path),
                name: file.name,
                text: file.text,
                text_hash: file.text_hash,
                semantic_hash: file.semantic_hash,
                line_count: file.line_count,
                text_length: file.text_length,
                visible_text_length: file.visible_text_length,
                outline_count: file.outline_count,
            })
            .collect(),
        file_count: checkpoint.file_count,
        total_text_length: checkpoint.total_text_length,
        total_visible_text_length: checkpoint.total_visible_text_length,
    })
}

fn same_workspace(root: &Path, candidate: &Path) -> bool {
    match (root.canonicalize(), candidate.canonicalize()) {
        (Ok(root), Ok(candidate)) => root == candidate,
        _ => root
            .to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .eq_ignore_ascii_case(
                candidate
                    .to_string_lossy()
                    .replace('\\', "/")
                    .trim_end_matches('/'),
            ),
    }
}

fn list_stored_checkpoints(root: &Path) -> Result<(Vec<StoredCheckpoint>, Vec<String>), String> {
    let directory = checkpoint_directory(root);
    if !path_exists_checked(&directory)? {
        return Ok((Vec::new(), Vec::new()));
    }
    let entries = std::fs::read_dir(&directory)
        .map_err(|error| format!("チェックポイント一覧を読み込めませんでした: {error}"))?;
    let mut checkpoints = Vec::new();
    let mut warnings = Vec::new();
    for entry in entries {
        let path = match entry {
            Ok(entry) => entry.path(),
            Err(error) => {
                warnings.push(format!(
                    "チェックポイント項目を読み込めませんでした: {error}"
                ));
                continue;
            }
        };
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        match read_stored_checkpoint(&path) {
            Ok(checkpoint) => checkpoints.push(checkpoint),
            Err(error) => warnings.push(format!(
                "{} を読み込めませんでした: {error}",
                path.file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("checkpoint")
            )),
        }
    }
    checkpoints.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    if checkpoints.is_empty() && !warnings.is_empty() {
        return Err(format!(
            "チェックポイントを読み込めませんでした。最初のエラー: {}",
            warnings[0]
        ));
    }
    Ok((checkpoints, warnings))
}

fn checkpoint_digest(checkpoint: &StoredCheckpoint) -> Result<String, String> {
    let bytes = serde_json::to_vec(checkpoint)
        .map_err(|error| format!("failed to hash checkpoint: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn migrate_legacy_checkpoints(
    root: &Path,
    legacy: &[ManuscriptSnapshot],
    warnings: &mut Vec<String>,
) -> Result<MigrationOutcome, String> {
    let mut migrated = 0;
    let mut complete = true;
    for snapshot in legacy {
        if !same_workspace(root, Path::new(&snapshot.workspace_path)) {
            continue;
        }
        let mut stored = match stored_from_runtime(root, snapshot) {
            Ok(stored) => stored,
            Err(error) => {
                complete = false;
                warnings.push(format!(
                    "{} を移行できませんでした: {error}",
                    snapshot.label
                ));
                continue;
            }
        };
        stored.revision = 1;
        let path = checkpoint_path(root, &stored.id)?;
        if path.exists() {
            match read_stored_checkpoint(&path) {
                Ok(existing) if existing == stored => continue,
                Ok(_) => {
                    let digest = checkpoint_digest(&stored)?;
                    let suffix = format!("-import-{}", &digest[..12]);
                    let prefix_length = 128usize.saturating_sub(suffix.len());
                    stored.id = format!(
                        "{}{}",
                        &stored.id[..stored.id.len().min(prefix_length)],
                        suffix
                    );
                    validate_checkpoint_id(&stored.id)?;
                    let alternate = checkpoint_path(root, &stored.id)?;
                    if alternate.exists() {
                        match read_stored_checkpoint(&alternate) {
                            Ok(existing) if existing == stored => continue,
                            _ => {
                                complete = false;
                                warnings.push(format!(
                                    "{} は同じIDの異なるデータと競合したため移行できませんでした",
                                    snapshot.label
                                ));
                                continue;
                            }
                        }
                    }
                    warnings.push(format!(
                        "{} はID競合のため {} として移行しました",
                        snapshot.label, stored.id
                    ));
                }
                Err(error) => {
                    complete = false;
                    warnings.push(format!(
                        "{} の既存データを確認できませんでした: {error}",
                        snapshot.label
                    ));
                    continue;
                }
            }
        }
        create_checkpoint_file(root, &stored)?;
        migrated += 1;
    }
    Ok(MigrationOutcome {
        migrated_count: migrated,
        complete,
    })
}

fn prune_auto_shelters(root: &Path) -> Result<(), String> {
    let (checkpoints, warnings) = list_stored_checkpoints(root)?;
    if !warnings.is_empty() {
        // Do not delete older shelters while the store is only partially visible.
        return Ok(());
    }
    for checkpoint in checkpoints
        .into_iter()
        .filter(|checkpoint| checkpoint.reason == "auto-before-restore")
        .skip(MAX_AUTO_SHELTERS)
    {
        let path = checkpoint_path(root, &checkpoint.id)?;
        if path_exists_checked(&path)? {
            std::fs::remove_file(&path)
                .map_err(|error| format!("failed to prune old shelter: {error}"))?;
        }
    }
    Ok(())
}

fn load_result_unlocked(
    root: &Path,
    migrated_count: usize,
    migration_complete: bool,
    mut warnings: Vec<String>,
) -> Result<CheckpointLoadResult, String> {
    let (checkpoints, read_warnings) = list_stored_checkpoints(root)?;
    warnings.extend(read_warnings);
    Ok(CheckpointLoadResult {
        snapshots: checkpoints
            .into_iter()
            .map(|checkpoint| runtime_from_stored(root, checkpoint))
            .collect::<Result<Vec<_>, _>>()?,
        warnings,
        migrated_count,
        migration_complete,
    })
}

/// Counts stored checkpoints without migrating or pruning anything:
/// `(readable, unreadable)`.
pub(super) fn count_project_checkpoints(root: &Path) -> Result<(usize, usize), String> {
    let _guard = lock_checkpoint_store()?;
    let (checkpoints, warnings) = list_stored_checkpoints(root)?;
    Ok((checkpoints.len(), warnings.len()))
}

pub(super) fn load_project_checkpoints(
    root: &Path,
    legacy: Option<&[ManuscriptSnapshot]>,
) -> Result<CheckpointLoadResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let _guard = lock_checkpoint_store()?;
    // Refuse to treat a wholly unreadable existing store as an empty one,
    // including before legacy migration could add new files to it.
    list_stored_checkpoints(root)?;
    let mut warnings = Vec::new();
    let migration = match legacy {
        Some(legacy) => migrate_legacy_checkpoints(root, legacy, &mut warnings)?,
        None => MigrationOutcome {
            migrated_count: 0,
            complete: true,
        },
    };
    prune_auto_shelters(root)?;
    load_result_unlocked(root, migration.migrated_count, migration.complete, warnings)
}

pub(super) fn create_project_checkpoint(
    root: &Path,
    snapshot: &ManuscriptSnapshot,
) -> Result<CheckpointLoadResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let _guard = lock_checkpoint_store()?;
    let mut stored = stored_from_runtime(root, snapshot)?;
    stored.revision = 1;
    create_checkpoint_file(root, &stored)?;
    if stored.reason == "auto-before-restore" {
        prune_auto_shelters(root)?;
    }
    load_result_unlocked(root, 0, true, Vec::new())
}

pub(super) fn update_project_checkpoint_metadata(
    root: &Path,
    checkpoint_id: &str,
    expected_revision: u64,
    expected_hash: Option<&str>,
    label: &str,
    memo: &str,
) -> Result<CheckpointLoadResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let _guard = lock_checkpoint_store()?;
    let path = checkpoint_path(root, checkpoint_id)?;
    let mut checkpoint = read_stored_checkpoint(&path)?;
    if checkpoint.revision != expected_revision {
        return Err(format!(
            "checkpoint revision conflict: expected {expected_revision}, found {}",
            checkpoint.revision
        ));
    }
    if let Some(expected_hash) = expected_hash.filter(|hash| !hash.is_empty()) {
        if checkpoint_digest(&checkpoint)? != expected_hash {
            return Err(format!(
                "checkpoint content conflict: revision {expected_revision} has different content"
            ));
        }
    }
    checkpoint.revision = checkpoint
        .revision
        .checked_add(1)
        .ok_or_else(|| "checkpoint revision overflow".to_string())?;
    checkpoint.label = label.to_string();
    checkpoint.memo = memo.to_string();
    replace_checkpoint_file(&path, &checkpoint)?;
    load_result_unlocked(root, 0, true, Vec::new())
}

pub(super) fn delete_project_checkpoint(
    root: &Path,
    checkpoint_id: &str,
    expected_revision: u64,
    expected_hash: Option<&str>,
) -> Result<CheckpointLoadResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let _guard = lock_checkpoint_store()?;
    let path = checkpoint_path(root, checkpoint_id)?;
    let checkpoint = read_stored_checkpoint(&path)?;
    if checkpoint.revision != expected_revision {
        return Err(format!(
            "checkpoint revision conflict: expected {expected_revision}, found {}",
            checkpoint.revision
        ));
    }
    if let Some(expected_hash) = expected_hash.filter(|hash| !hash.is_empty()) {
        if checkpoint_digest(&checkpoint)? != expected_hash {
            return Err(format!(
                "checkpoint content conflict: revision {expected_revision} has different content"
            ));
        }
    }
    let deletion_id = super::now_millis();
    let tombstone = path.with_extension(format!("json.deleted-{deletion_id}"));
    let backup = path.with_extension("json.bak");
    let backup_tombstone = path.with_extension(format!("json.bak.deleted-{deletion_id}"));
    if backup.exists() {
        std::fs::rename(&backup, &backup_tombstone)
            .map_err(|error| format!("failed to stage checkpoint backup deletion: {error}"))?;
    }
    std::fs::rename(&path, &tombstone).map_err(|error| {
        if backup_tombstone.exists() {
            let _ = std::fs::rename(&backup_tombstone, &backup);
        }
        format!("failed to stage checkpoint deletion: {error}")
    })?;
    if let Err(error) = std::fs::remove_file(&tombstone) {
        let rollback_error = std::fs::rename(&tombstone, &path).err();
        if backup_tombstone.exists() {
            let _ = std::fs::rename(&backup_tombstone, &backup);
        }
        return Err(match rollback_error {
            Some(rollback_error) => format!(
                "failed to delete checkpoint: {error}; checkpoint deletion rollback failed: {rollback_error}"
            ),
            None => format!("failed to delete checkpoint: {error}"),
        });
    }
    let mut warnings = Vec::new();
    if backup_tombstone.exists() {
        if let Err(error) = std::fs::remove_file(&backup_tombstone) {
            warnings.push(format!(
                "削除済みチェックポイントのバックアップを消去できませんでした: {error}"
            ));
        }
    }
    load_result_unlocked(root, 0, true, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "then-checkpoint-store-{name}-{}-{}",
                std::process::id(),
                super::super::now_millis()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn snapshot(root: &Path, id: &str, reason: &str, created_at: i64) -> ManuscriptSnapshot {
        let file = root.join("chapters").join("one.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "# One\n\nBody").unwrap();
        ManuscriptSnapshot {
            id: id.to_string(),
            revision: 1,
            storage_hash: String::new(),
            workspace_path: root.to_string_lossy().to_string(),
            workspace_name: "Novel".to_string(),
            created_at,
            reason: reason.to_string(),
            label: id.to_string(),
            memo: String::new(),
            parent_ids: Vec::new(),
            project_tree: ProjectFolder {
                path: root.to_string_lossy().to_string(),
                name: "Novel".to_string(),
                children: vec![ProjectEntry {
                    path: file.to_string_lossy().to_string(),
                    name: "one.md".to_string(),
                    kind: "file".to_string(),
                    children: Vec::new(),
                    file_id: None,
                    content_hash: None,
                    modified_at: None,
                }],
                library: None,
            },
            files: vec![ManuscriptSnapshotFile {
                path: file.to_string_lossy().to_string(),
                name: "one.md".to_string(),
                text: "# One\n\nBody".to_string(),
                text_hash: "text-hash".to_string(),
                semantic_hash: "semantic-hash".to_string(),
                line_count: 3,
                text_length: 11,
                visible_text_length: 8,
                outline_count: 1,
            }],
            file_count: 1,
            total_text_length: 11,
            total_visible_text_length: 8,
        }
    }

    #[test]
    fn checkpoint_survives_copy_to_another_root_without_absolute_paths() {
        let source = TestDirectory::new("portable-source");
        let destination = TestDirectory::new("portable-destination");
        let original = snapshot(&source.0, "snapshot-portable", "manual", 10);
        create_project_checkpoint(&source.0, &original).unwrap();

        let source_path = checkpoint_path(&source.0, &original.id).unwrap();
        let destination_path = checkpoint_path(&destination.0, &original.id).unwrap();
        std::fs::create_dir_all(destination_path.parent().unwrap()).unwrap();
        std::fs::copy(&source_path, &destination_path).unwrap();
        let destination_file = destination.0.join("chapters").join("one.md");
        std::fs::create_dir_all(destination_file.parent().unwrap()).unwrap();
        std::fs::write(&destination_file, "copy").unwrap();

        let loaded = load_project_checkpoints(&destination.0, None).unwrap();
        assert_eq!(loaded.snapshots.len(), 1);
        assert_eq!(
            loaded.snapshots[0].workspace_path,
            destination.0.to_string_lossy()
        );
        assert_eq!(
            loaded.snapshots[0].files[0].path,
            destination_file.to_string_lossy()
        );
        let persisted = std::fs::read_to_string(destination_path).unwrap();
        assert!(!persisted.contains(&source.0.to_string_lossy().to_string()));
        assert!(!persisted.contains("workspacePath"));
        assert!(!persisted.contains("storageHash"));
        assert!(persisted.contains("chapters/one.md"));
    }

    #[test]
    fn new_project_without_checkpoints_starts_empty() {
        let root = TestDirectory::new("new-project");
        let loaded = load_project_checkpoints(&root.0, None).unwrap();
        assert!(loaded.snapshots.is_empty());
        assert!(loaded.warnings.is_empty());
        assert!(!checkpoint_directory(&root.0).exists());
    }

    #[test]
    fn legacy_migration_is_idempotent_and_conflicts_get_deterministic_ids() {
        let root = TestDirectory::new("migration");
        let first = snapshot(&root.0, "snapshot-legacy", "manual", 10);
        let migrated =
            load_project_checkpoints(&root.0, Some(std::slice::from_ref(&first))).unwrap();
        let repeated =
            load_project_checkpoints(&root.0, Some(std::slice::from_ref(&first))).unwrap();
        assert_eq!(migrated.migrated_count, 1);
        assert!(migrated.migration_complete);
        assert_eq!(repeated.migrated_count, 0);
        assert!(repeated.migration_complete);
        assert_eq!(repeated.snapshots.len(), 1);

        let mut conflicting = first.clone();
        conflicting.files[0].text = "different".to_string();
        conflicting.files[0].text_hash = "different-hash".to_string();
        let conflict =
            load_project_checkpoints(&root.0, Some(std::slice::from_ref(&conflicting))).unwrap();
        assert_eq!(conflict.migrated_count, 1);
        assert_eq!(conflict.snapshots.len(), 2);
        assert!(conflict
            .snapshots
            .iter()
            .any(|snapshot| snapshot.id.starts_with("snapshot-legacy-import-")));
        assert!(!conflict.warnings.is_empty());
        assert!(conflict.migration_complete);
    }

    #[test]
    fn incomplete_legacy_migration_remains_retryable() {
        let root = TestDirectory::new("migration-retry");
        let mut invalid = snapshot(&root.0, "snapshot-invalid-legacy", "manual", 10);
        invalid.files[0].path = root
            .0
            .join("..")
            .join("outside.md")
            .to_string_lossy()
            .to_string();

        let loaded =
            load_project_checkpoints(&root.0, Some(std::slice::from_ref(&invalid))).unwrap();
        assert!(!loaded.migration_complete);
        assert_eq!(loaded.migrated_count, 0);
        assert!(loaded.snapshots.is_empty());
        assert_eq!(loaded.warnings.len(), 1);
    }

    #[test]
    fn one_corrupt_checkpoint_does_not_hide_valid_checkpoints() {
        let root = TestDirectory::new("partial-read");
        let valid = snapshot(&root.0, "snapshot-valid", "manual", 10);
        create_project_checkpoint(&root.0, &valid).unwrap();
        std::fs::write(
            checkpoint_directory(&root.0).join("snapshot-broken.json"),
            "{",
        )
        .unwrap();

        let loaded = load_project_checkpoints(&root.0, None).unwrap();
        assert_eq!(loaded.snapshots.len(), 1);
        assert_eq!(loaded.snapshots[0].id, "snapshot-valid");
        assert_eq!(loaded.warnings.len(), 1);
    }

    #[test]
    fn wholly_corrupt_checkpoint_store_is_not_reported_as_empty() {
        let root = TestDirectory::new("all-corrupt");
        let path = checkpoint_directory(&root.0).join("snapshot-broken.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{").unwrap();

        let error = load_project_checkpoints(&root.0, None).err().unwrap();
        assert!(error.contains("チェックポイントを読み込めませんでした"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), "{");
    }

    #[test]
    fn inaccessible_checkpoint_directory_is_not_reported_as_empty() {
        let root = TestDirectory::new("unreadable-directory");
        let directory = checkpoint_directory(&root.0);
        std::fs::create_dir_all(directory.parent().unwrap()).unwrap();
        std::fs::write(&directory, "not a directory").unwrap();

        let error = load_project_checkpoints(&root.0, None).err().unwrap();
        assert!(error.contains("チェックポイント一覧を読み込めませんでした"));
        assert_eq!(
            std::fs::read_to_string(directory).unwrap(),
            "not a directory"
        );
    }

    #[test]
    fn corrupt_checkpoint_recovers_its_last_valid_backup() {
        let root = TestDirectory::new("backup-recovery");
        let original = snapshot(&root.0, "snapshot-backup", "manual", 10);
        create_project_checkpoint(&root.0, &original).unwrap();
        update_project_checkpoint_metadata(&root.0, &original.id, 1, None, "Updated", "").unwrap();
        let path = checkpoint_path(&root.0, &original.id).unwrap();
        std::fs::write(&path, "{").unwrap();

        let loaded = load_project_checkpoints(&root.0, None).unwrap();
        assert_eq!(loaded.snapshots.len(), 1);
        assert_eq!(loaded.snapshots[0].revision, 1);
        assert_eq!(loaded.snapshots[0].label, original.label);
        assert!(read_stored_checkpoint_file(&path).is_ok());
    }

    #[test]
    fn invalid_utf8_checkpoint_recovers_its_last_valid_backup() {
        let root = TestDirectory::new("invalid-utf8");
        let original = snapshot(&root.0, "snapshot-invalid-utf8", "manual", 10);
        create_project_checkpoint(&root.0, &original).unwrap();
        update_project_checkpoint_metadata(&root.0, &original.id, 1, None, "Updated", "").unwrap();
        let path = checkpoint_path(&root.0, &original.id).unwrap();
        std::fs::write(&path, [0xff]).unwrap();

        let loaded = load_project_checkpoints(&root.0, None).unwrap();
        assert_eq!(loaded.snapshots[0].revision, 1);
        assert!(read_stored_checkpoint_file(&path).is_ok());
    }

    #[test]
    fn unreadable_checkpoint_does_not_restore_an_older_backup() {
        let root = TestDirectory::new("unreadable-primary");
        let original = snapshot(&root.0, "snapshot-unreadable", "manual", 10);
        create_project_checkpoint(&root.0, &original).unwrap();
        update_project_checkpoint_metadata(&root.0, &original.id, 1, None, "Updated", "").unwrap();
        let path = checkpoint_path(&root.0, &original.id).unwrap();
        let backup = path.with_extension("json.bak");
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        let error = load_project_checkpoints(&root.0, None).err().unwrap();
        assert!(error.contains("failed to read"));
        assert!(path.is_dir());
        assert!(backup.is_file());
    }

    #[test]
    fn metadata_revision_conflicts_and_delete_are_checked() {
        let root = TestDirectory::new("revision");
        let original = snapshot(&root.0, "snapshot-revision", "manual", 10);
        create_project_checkpoint(&root.0, &original).unwrap();

        let updated =
            update_project_checkpoint_metadata(&root.0, &original.id, 1, None, "Renamed", "Memo")
                .unwrap();
        assert_eq!(updated.snapshots[0].revision, 2);
        assert_eq!(updated.snapshots[0].label, "Renamed");
        assert!(
            update_project_checkpoint_metadata(&root.0, &original.id, 1, None, "Stale", "",)
                .err()
                .unwrap()
                .contains("revision conflict")
        );

        let deleted = delete_project_checkpoint(&root.0, &original.id, 2, None).unwrap();
        assert!(deleted.snapshots.is_empty());
        assert!(!checkpoint_path(&root.0, &original.id).unwrap().exists());
        assert!(!checkpoint_path(&root.0, &original.id)
            .unwrap()
            .with_extension("json.bak")
            .exists());
    }

    #[test]
    fn metadata_update_rejects_same_revision_with_different_content() {
        let root = TestDirectory::new("content-conflict");
        let original = snapshot(&root.0, "snapshot-content-conflict", "manual", 10);
        let created = create_project_checkpoint(&root.0, &original).unwrap();
        let known_hash = created.snapshots[0].storage_hash.clone();
        let path = checkpoint_path(&root.0, &original.id).unwrap();
        let mut externally_changed = read_stored_checkpoint_file(&path).unwrap();
        externally_changed.label = "別端末の変更".to_string();
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&externally_changed).unwrap(),
        )
        .unwrap();

        let error = update_project_checkpoint_metadata(
            &root.0,
            &original.id,
            1,
            Some(&known_hash),
            "Local",
            "",
        )
        .err()
        .unwrap();
        assert!(error.contains("content conflict"));
        assert_eq!(
            read_stored_checkpoint_file(&path).unwrap().label,
            "別端末の変更"
        );
    }

    #[test]
    fn auto_shelters_are_pruned_to_three() {
        let root = TestDirectory::new("shelter-limit");
        for index in 0..5 {
            let shelter = snapshot(
                &root.0,
                &format!("shelter-{index}"),
                "auto-before-restore",
                index,
            );
            create_project_checkpoint(&root.0, &shelter).unwrap();
        }
        let loaded = load_project_checkpoints(&root.0, None).unwrap();
        assert_eq!(loaded.snapshots.len(), 3);
        assert_eq!(loaded.snapshots[0].id, "shelter-4");
        assert_eq!(loaded.snapshots[2].id, "shelter-2");
    }

    #[test]
    fn checkpoint_paths_cannot_escape_the_project() {
        let root = TestDirectory::new("path-escape");
        let mut invalid = snapshot(&root.0, "snapshot-invalid", "manual", 10);
        invalid.files[0].path = root
            .0
            .join("..")
            .join("outside.md")
            .to_string_lossy()
            .to_string();
        assert!(create_project_checkpoint(&root.0, &invalid)
            .err()
            .unwrap()
            .contains("invalid component"));
    }
}
