use super::{IdeaThreadConfig, PlotCardConfig, ProofreadTermConfig, SnippetConfig};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Component;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

const PROJECT_CONFIG_SCHEMA_VERSION: u32 = 1;
static PROJECT_CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn default_project_config_schema_version() -> u32 {
    PROJECT_CONFIG_SCHEMA_VERSION
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectFileProgress {
    pub(super) status: String,
    #[serde(default)]
    pub(super) updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectFileProgressState {
    pub(super) file_progress: BTreeMap<String, String>,
    pub(super) revision: u64,
    pub(super) migrated_count: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectConfig {
    #[serde(default = "default_project_config_schema_version")]
    pub(super) schema_version: u32,
    #[serde(default)]
    pub(super) revision: u64,
    #[serde(default)]
    pub(super) order: BTreeMap<String, Vec<String>>,
    /// 旧 Idea（フラット付箋）。`ideaThreads` への移行用に読み込むだけで、
    /// 保存時にはクリアされる。
    #[serde(default)]
    pub(super) snippets: Vec<SnippetConfig>,
    #[serde(default, rename = "ideaThreads")]
    pub(super) idea_threads: Vec<IdeaThreadConfig>,
    #[serde(default, rename = "plotCards")]
    pub(super) plot_cards: Vec<PlotCardConfig>,
    /// 校正辞書。固有名詞やキャラクター名など、原稿ごとの語彙。
    #[serde(default, rename = "proofreadTerms")]
    pub(super) proofread_terms: Vec<ProofreadTermConfig>,
    /// 無視した校正の指摘。ワークスペース内の相対パスごとに持つ。
    #[serde(default, rename = "proofreadIgnored")]
    pub(super) proofread_ignored: BTreeMap<String, Vec<String>>,
    /// ファイルの進捗ラベル。Phase 2 で端末ローカルから移行する。
    #[serde(default, rename = "fileProgress")]
    pub(super) file_progress: BTreeMap<String, ProjectFileProgress>,
}

impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            schema_version: PROJECT_CONFIG_SCHEMA_VERSION,
            revision: 0,
            order: BTreeMap::new(),
            snippets: Vec::new(),
            idea_threads: Vec::new(),
            plot_cards: Vec::new(),
            proofread_terms: Vec::new(),
            proofread_ignored: BTreeMap::new(),
            file_progress: BTreeMap::new(),
        }
    }
}

pub(super) fn project_config_path(root: &Path) -> PathBuf {
    root.join(".then").join("project.json")
}

pub(super) fn legacy_project_config_path(root: &Path) -> PathBuf {
    root.join(".brew").join("project.json")
}

pub(super) fn lock_project_config() -> Result<MutexGuard<'static, ()>, String> {
    PROJECT_CONFIG_LOCK
        .lock()
        .map_err(|error| format!("failed to lock project config: {error}"))
}

fn validate_project_config(config: &ProjectConfig) -> Result<(), String> {
    if config.schema_version != PROJECT_CONFIG_SCHEMA_VERSION {
        return Err(format!(
            "unsupported project config schema version: {}",
            config.schema_version
        ));
    }
    for (path, progress) in &config.file_progress {
        validate_stored_project_path(path)?;
        validate_file_progress_status(&progress.status, true)?;
    }
    Ok(())
}

fn validate_file_progress_status(status: &str, allow_todo: bool) -> Result<(), String> {
    if matches!(status, "writing" | "revising" | "done") || (allow_todo && status == "todo") {
        Ok(())
    } else {
        Err(format!("unsupported file progress status: {status}"))
    }
}

pub(super) fn validate_stored_project_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.contains('\\') {
        return Err("project-relative path is not normalized".to_string());
    }
    let mut components = path.split('/');
    let Some(first) = components.next() else {
        return Err("project-relative path is empty".to_string());
    };
    if first.is_empty()
        || first == "."
        || first == ".."
        || first.contains(':')
        || first.eq_ignore_ascii_case(".then")
    {
        return Err("project-relative path is not allowed".to_string());
    }
    if components.any(|component| component.is_empty() || component == "." || component == "..") {
        return Err("project-relative path is not normalized".to_string());
    }
    if Path::new(path).is_absolute() {
        return Err("project-relative path must not be absolute".to_string());
    }
    Ok(())
}

fn normalized_relative_path(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let value = value
                    .to_str()
                    .ok_or_else(|| "project path is not valid unicode".to_string())?;
                parts.push(value.to_string());
            }
            _ => return Err("project-relative path contains an invalid component".to_string()),
        }
    }
    let normalized = parts.join("/");
    validate_stored_project_path(&normalized)?;
    Ok(normalized)
}

pub(super) fn trusted_project_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "path is outside project root".to_string())?;
    normalized_relative_path(relative)
}

fn existing_project_file_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    if !path.is_file() {
        return Err("file progress target does not exist".to_string());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve file progress target: {error}"))?;
    let relative = canonical_path
        .strip_prefix(&canonical_root)
        .map_err(|_| "file progress target is outside project root".to_string())?;
    normalized_relative_path(relative)
}

fn legacy_project_file_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    if path.exists() {
        existing_project_file_relative_path(root, path)
    } else {
        trusted_project_relative_path(root, path)
    }
}

fn absolute_file_progress(root: &Path, config: &ProjectConfig) -> BTreeMap<String, String> {
    config
        .file_progress
        .iter()
        .filter(|(_, progress)| progress.status != "todo")
        .map(|(relative, progress)| {
            let absolute = relative
                .split('/')
                .fold(root.to_path_buf(), |path, component| path.join(component));
            (
                absolute.to_string_lossy().to_string(),
                progress.status.clone(),
            )
        })
        .collect()
}

pub(super) fn remove_file_progress_path(
    config: &mut ProjectConfig,
    relative_path: &str,
    is_directory: bool,
) {
    let prefix = format!("{relative_path}/");
    config
        .file_progress
        .retain(|path, _| path != relative_path && !(is_directory && path.starts_with(&prefix)));
}

pub(super) fn retarget_file_progress_path(
    config: &mut ProjectConfig,
    old_relative_path: &str,
    new_relative_path: &str,
    is_directory: bool,
) {
    let old_prefix = format!("{old_relative_path}/");
    let new_prefix = format!("{new_relative_path}/");
    let mut next = BTreeMap::new();
    for (path, progress) in std::mem::take(&mut config.file_progress) {
        let path = if path == old_relative_path {
            new_relative_path.to_string()
        } else if is_directory && path.starts_with(&old_prefix) {
            format!("{}{}", new_prefix, &path[old_prefix.len()..])
        } else {
            path
        };
        next.insert(path, progress);
    }
    config.file_progress = next;
}

fn read_project_config_file(path: &Path) -> Result<ProjectConfig, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let config: ProjectConfig = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    validate_project_config(&config)?;
    Ok(config)
}

fn restore_project_config_backup(path: &Path, backup_path: &Path) -> Result<ProjectConfig, String> {
    let backup = read_project_config_file(backup_path)?;
    std::fs::copy(backup_path, path).map_err(|error| {
        format!(
            "failed to restore project config backup {}: {error}",
            backup_path.display()
        )
    })?;
    Ok(backup)
}

fn read_primary_or_backup(path: &Path) -> Result<ProjectConfig, String> {
    let backup_path = path.with_extension("json.bak");
    if path.exists() {
        match read_project_config_file(path) {
            Ok(config) => return Ok(config),
            Err(primary_error) => {
                // A newer schema must never be replaced by an older backup.
                if primary_error.contains("unsupported project config schema version") {
                    return Err(primary_error);
                }
                if backup_path.exists() {
                    return restore_project_config_backup(path, &backup_path).map_err(
                        |backup_error| {
                            format!(
                            "{primary_error}; project config backup recovery failed: {backup_error}"
                        )
                        },
                    );
                }
                return Err(primary_error);
            }
        }
    }

    if backup_path.exists() {
        return restore_project_config_backup(path, &backup_path);
    }

    Err("project config does not exist".to_string())
}

pub(super) fn load_project_config_unlocked(root: &Path) -> Result<ProjectConfig, String> {
    let path = project_config_path(root);
    if path.exists() || path.with_extension("json.bak").exists() {
        return read_primary_or_backup(&path);
    }

    let legacy_path = legacy_project_config_path(root);
    if !legacy_path.exists() {
        return Ok(ProjectConfig::default());
    }

    let legacy = read_project_config_file(&legacy_path)?;
    save_project_config_unlocked(root, &legacy)
}

pub(super) fn load_project_config(root: &Path) -> Result<ProjectConfig, String> {
    let _guard = lock_project_config()?;
    load_project_config_unlocked(root)
}

fn temporary_project_config_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("project.json");
    path.with_file_name(format!("{file_name}.tmp-{}", std::process::id()))
}

fn write_verified_temporary_config(path: &Path, config: &ProjectConfig) -> Result<PathBuf, String> {
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize project config: {error}"))?;
    let temporary_path = temporary_project_config_path(path);
    let mut file = std::fs::File::create(&temporary_path)
        .map_err(|error| format!("failed to create temporary project config: {error}"))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("failed to write temporary project config: {error}"))?;
    file.flush()
        .map_err(|error| format!("failed to flush temporary project config: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("failed to sync temporary project config: {error}"))?;
    drop(file);

    if let Err(error) = read_project_config_file(&temporary_path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!(
            "temporary project config verification failed: {error}"
        ));
    }
    Ok(temporary_path)
}

pub(super) fn save_project_config_unlocked(
    root: &Path,
    config: &ProjectConfig,
) -> Result<ProjectConfig, String> {
    validate_project_config(config)?;
    let mut next = config.clone();
    next.revision = config
        .revision
        .checked_add(1)
        .ok_or_else(|| "project config revision overflow".to_string())?;

    let path = project_config_path(root);
    let parent = path
        .parent()
        .ok_or_else(|| "project config directory does not exist".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create project config directory: {error}"))?;

    let temporary_path = write_verified_temporary_config(&path, &next)?;
    let backup_path = path.with_extension("json.bak");
    let had_primary = path.exists();

    if had_primary {
        if backup_path.exists() {
            if let Err(error) = std::fs::remove_file(&backup_path) {
                let _ = std::fs::remove_file(&temporary_path);
                return Err(format!("failed to replace project config backup: {error}"));
            }
        }
        if let Err(error) = std::fs::rename(&path, &backup_path) {
            let _ = std::fs::remove_file(&temporary_path);
            return Err(format!("failed to back up project config: {error}"));
        }
    }

    if let Err(promote_error) = std::fs::rename(&temporary_path, &path) {
        let rollback_error = if had_primary {
            std::fs::rename(&backup_path, &path).err()
        } else {
            None
        };
        let _ = std::fs::remove_file(&temporary_path);
        return Err(match rollback_error {
            Some(rollback_error) => format!(
                "failed to promote project config: {promote_error}; backup rollback failed: {rollback_error}"
            ),
            None => format!("failed to promote project config: {promote_error}"),
        });
    }

    Ok(next)
}

pub(super) fn update_project_config<F>(root: &Path, update: F) -> Result<ProjectConfig, String>
where
    F: FnOnce(&mut ProjectConfig) -> Result<(), String>,
{
    let _guard = lock_project_config()?;
    let mut config = load_project_config_unlocked(root)?;
    update(&mut config)?;
    save_project_config_unlocked(root, &config)
}

pub(super) fn load_project_file_progress(
    root: &Path,
    legacy_file_progress: Option<&BTreeMap<String, String>>,
) -> Result<ProjectFileProgressState, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let _guard = lock_project_config()?;
    let mut config = load_project_config_unlocked(root)?;
    let mut migrated_count = 0;

    if let Some(legacy_file_progress) = legacy_file_progress {
        let updated_at = super::now_millis();
        for (path, status) in legacy_file_progress {
            if validate_file_progress_status(status, false).is_err() {
                continue;
            }
            let Ok(relative_path) = legacy_project_file_relative_path(root, Path::new(path)) else {
                continue;
            };
            if config.file_progress.contains_key(&relative_path) {
                continue;
            }
            config.file_progress.insert(
                relative_path,
                ProjectFileProgress {
                    status: status.clone(),
                    updated_at,
                },
            );
            migrated_count += 1;
        }
    }

    if migrated_count > 0 {
        config = save_project_config_unlocked(root, &config)?;
    }

    Ok(ProjectFileProgressState {
        file_progress: absolute_file_progress(root, &config),
        revision: config.revision,
        migrated_count,
    })
}

pub(super) fn set_project_file_progress(
    root: &Path,
    path: &Path,
    status: &str,
) -> Result<ProjectFileProgressState, String> {
    validate_file_progress_status(status, true)?;
    let relative_path = existing_project_file_relative_path(root, path)?;
    let _guard = lock_project_config()?;
    let mut config = load_project_config_unlocked(root)?;
    let unchanged = match config.file_progress.get(&relative_path) {
        Some(progress) => progress.status == status,
        None => status == "todo",
    };

    if !unchanged {
        if status == "todo" {
            config.file_progress.remove(&relative_path);
        } else {
            config.file_progress.insert(
                relative_path,
                ProjectFileProgress {
                    status: status.to_string(),
                    updated_at: super::now_millis(),
                },
            );
        }
        config = save_project_config_unlocked(root, &config)?;
    }

    Ok(ProjectFileProgressState {
        file_progress: absolute_file_progress(root, &config),
        revision: config.revision,
        migrated_count: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "then-project-state-{name}-{}-{}",
                std::process::id(),
                super::super::now_millis()
            ));
            std::fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn old_project_config_defaults_to_schema_one() {
        let root = TestDirectory::new("legacy-shape");
        let path = project_config_path(&root.0);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"order":{".":["first.md"]}}"#).unwrap();

        let config = load_project_config(&root.0).unwrap();
        assert_eq!(config.schema_version, 1);
        assert_eq!(config.revision, 0);
        assert_eq!(config.order.get(".").unwrap(), &["first.md"]);
        assert!(config.file_progress.is_empty());
    }

    #[test]
    fn atomic_save_keeps_previous_revision_as_backup() {
        let root = TestDirectory::new("backup");
        let mut first = ProjectConfig::default();
        first.order.insert(".".into(), vec!["first.md".into()]);
        let first = update_project_config(&root.0, |config| {
            *config = first;
            Ok(())
        })
        .unwrap();
        assert_eq!(first.revision, 1);

        let second = update_project_config(&root.0, |config| {
            config.order.insert(".".into(), vec!["second.md".into()]);
            Ok(())
        })
        .unwrap();
        assert_eq!(second.revision, 2);

        let backup =
            read_project_config_file(&project_config_path(&root.0).with_extension("json.bak"))
                .unwrap();
        assert_eq!(backup.revision, 1);
        assert_eq!(backup.order.get(".").unwrap(), &["first.md"]);
    }

    #[test]
    fn temporary_write_failure_preserves_primary() {
        let root = TestDirectory::new("write-failure");
        let first = update_project_config(&root.0, |config| {
            config.order.insert(".".into(), vec!["safe.md".into()]);
            Ok(())
        })
        .unwrap();
        let path = project_config_path(&root.0);
        let temporary_path = temporary_project_config_path(&path);
        std::fs::create_dir(&temporary_path).unwrap();

        let error = update_project_config(&root.0, |config| {
            config.order.insert(".".into(), vec!["unsafe.md".into()]);
            Ok(())
        })
        .err()
        .unwrap();
        let preserved = load_project_config(&root.0).unwrap();

        assert!(error.contains("failed to create temporary project config"));
        assert_eq!(preserved.revision, first.revision);
        assert_eq!(preserved.order.get(".").unwrap(), &["safe.md"]);
    }

    #[test]
    fn existing_project_domains_survive_versioned_round_trip() {
        let root = TestDirectory::new("existing-domains");
        let fixture = r#"{
            "order":{".":["chapter.md"]},
            "ideaThreads":[{
                "id":"thread-1","kind":"thread","title":"Idea","starred":true,
                "createdAt":1,"updatedAt":2,"fragments":[]
            }],
            "plotCards":[{
                "id":"plot-1","kind":"section","num":"001","title":"Opening",
                "body":"Body","expanded":true,"managerCollapsed":false
            }],
            "proofreadTerms":[{
                "id":"term-1","surface":"Then","reading":"ぜん","kind":"properNoun",
                "variants":[],"note":"Product name","policy":"allow","createdAt":1,"updatedAt":2
            }],
            "proofreadIgnored":{"chapter.md":["rule-1"]},
            "fileProgress":{"chapter.md":{"status":"writing","updatedAt":3}}
        }"#;
        let fixture_config: ProjectConfig = serde_json::from_str(fixture).unwrap();

        let saved = update_project_config(&root.0, |config| {
            *config = fixture_config;
            Ok(())
        })
        .unwrap();
        let reloaded = load_project_config(&root.0).unwrap();
        let saved_value = serde_json::to_value(saved).unwrap();
        let reloaded_value = serde_json::to_value(reloaded).unwrap();

        assert_eq!(saved_value, reloaded_value);
        assert_eq!(reloaded_value["revision"], 1);
        assert_eq!(reloaded_value["order"]["."][0], "chapter.md");
        assert_eq!(reloaded_value["ideaThreads"][0]["id"], "thread-1");
        assert_eq!(reloaded_value["plotCards"][0]["id"], "plot-1");
        assert_eq!(reloaded_value["proofreadTerms"][0]["id"], "term-1");
        assert_eq!(
            reloaded_value["proofreadIgnored"]["chapter.md"][0],
            "rule-1"
        );
        assert_eq!(
            reloaded_value["fileProgress"]["chapter.md"]["status"],
            "writing"
        );
    }

    #[test]
    fn invalid_primary_recovers_from_valid_backup() {
        let root = TestDirectory::new("recovery");
        update_project_config(&root.0, |config| {
            config.order.insert(".".into(), vec!["safe.md".into()]);
            Ok(())
        })
        .unwrap();
        update_project_config(&root.0, |config| {
            config.order.insert(".".into(), vec!["latest.md".into()]);
            Ok(())
        })
        .unwrap();

        let path = project_config_path(&root.0);
        std::fs::write(&path, "{").unwrap();
        let recovered = load_project_config(&root.0).unwrap();
        assert_eq!(recovered.revision, 1);
        assert_eq!(recovered.order.get(".").unwrap(), &["safe.md"]);
        assert_eq!(read_project_config_file(&path).unwrap().revision, 1);
    }

    #[test]
    fn missing_primary_recovers_after_interrupted_promotion() {
        let root = TestDirectory::new("interrupted-promotion");
        update_project_config(&root.0, |config| {
            config.order.insert(".".into(), vec!["safe.md".into()]);
            Ok(())
        })
        .unwrap();
        update_project_config(&root.0, |config| {
            config.order.insert(".".into(), vec!["latest.md".into()]);
            Ok(())
        })
        .unwrap();

        let path = project_config_path(&root.0);
        std::fs::remove_file(&path).unwrap();
        let recovered = load_project_config(&root.0).unwrap();

        assert_eq!(recovered.revision, 1);
        assert_eq!(recovered.order.get(".").unwrap(), &["safe.md"]);
        assert!(path.is_file());
    }

    #[test]
    fn unsupported_schema_is_not_replaced_by_backup() {
        let root = TestDirectory::new("future-schema");
        update_project_config(&root.0, |_| Ok(())).unwrap();
        update_project_config(&root.0, |_| Ok(())).unwrap();
        let path = project_config_path(&root.0);
        std::fs::write(&path, r#"{"schemaVersion":99,"revision":99}"#).unwrap();

        let error = load_project_config(&root.0).err().unwrap();
        assert!(error.contains("unsupported project config schema version: 99"));
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .contains("\"schemaVersion\":99"));
    }

    #[test]
    fn updates_are_serialized_without_losing_keys() {
        let root = TestDirectory::new("serialized");
        let root_path = std::sync::Arc::new(root.0.clone());
        let threads = (0..4)
            .map(|worker| {
                let root_path = root_path.clone();
                std::thread::spawn(move || {
                    for index in 0..10 {
                        let key = format!("worker-{worker}-{index}");
                        update_project_config(&root_path, |config| {
                            config.order.insert(key, Vec::new());
                            Ok(())
                        })
                        .unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for thread in threads {
            thread.join().unwrap();
        }

        let config = load_project_config(&root.0).unwrap();
        assert_eq!(config.order.len(), 40);
        assert_eq!(config.revision, 40);
    }

    #[test]
    fn relative_paths_reject_escape_absolute_and_then_entries() {
        assert!(validate_stored_project_path("").is_err());
        assert!(validate_stored_project_path("../chapter.md").is_err());
        assert!(validate_stored_project_path("notes//chapter.md").is_err());
        assert!(validate_stored_project_path(".then/project.json").is_err());
        assert!(validate_stored_project_path("notes\\chapter.md").is_err());
        assert!(validate_stored_project_path("C:/Novel/chapter.md").is_err());
        assert!(validate_stored_project_path("notes/chapter.md").is_ok());

        let root = TestDirectory::new("path-escape");
        assert!(trusted_project_relative_path(&root.0, &root.0.join("../outside.md")).is_err());
    }

    #[test]
    fn legacy_progress_migration_is_idempotent_and_shared_values_win() {
        let root = TestDirectory::new("progress-migration");
        let chapter = root.0.join("chapter.md");
        let ending = root.0.join("notes").join("ending.md");
        let pending = root.0.join("notes").join("pending.md");
        std::fs::write(&chapter, "chapter").unwrap();
        std::fs::create_dir_all(ending.parent().unwrap()).unwrap();
        std::fs::write(&ending, "ending").unwrap();

        set_project_file_progress(&root.0, &chapter, "revising").unwrap();
        let legacy = BTreeMap::from([
            (chapter.to_string_lossy().to_string(), "writing".to_string()),
            (ending.to_string_lossy().to_string(), "done".to_string()),
            (pending.to_string_lossy().to_string(), "writing".to_string()),
            ("C:/outside.md".to_string(), "writing".to_string()),
        ]);
        let first = load_project_file_progress(&root.0, Some(&legacy)).unwrap();
        let second = load_project_file_progress(&root.0, Some(&legacy)).unwrap();

        assert_eq!(first.migrated_count, 2);
        assert_eq!(second.migrated_count, 0);
        assert_eq!(
            first.file_progress[&chapter.to_string_lossy().to_string()],
            "revising"
        );
        assert_eq!(
            first.file_progress[&ending.to_string_lossy().to_string()],
            "done"
        );
        assert_eq!(
            first.file_progress[&pending.to_string_lossy().to_string()],
            "writing"
        );

        let cleared = set_project_file_progress(&root.0, &ending, "todo").unwrap();
        assert!(!cleared
            .file_progress
            .contains_key(&ending.to_string_lossy().to_string()));
    }

    #[test]
    fn progress_survives_copy_to_a_different_absolute_root() {
        let source = TestDirectory::new("portable-source");
        let destination = TestDirectory::new("portable-destination");
        let source_file = source.0.join("chapters").join("one.md");
        let destination_file = destination.0.join("chapters").join("one.md");
        std::fs::create_dir_all(source_file.parent().unwrap()).unwrap();
        std::fs::create_dir_all(destination_file.parent().unwrap()).unwrap();
        std::fs::write(&source_file, "source").unwrap();
        std::fs::write(&destination_file, "copy").unwrap();
        set_project_file_progress(&source.0, &source_file, "writing").unwrap();

        let source_config = project_config_path(&source.0);
        let destination_config = project_config_path(&destination.0);
        std::fs::create_dir_all(destination_config.parent().unwrap()).unwrap();
        std::fs::copy(source_config, destination_config).unwrap();

        let loaded = load_project_file_progress(&destination.0, None).unwrap();
        assert_eq!(
            loaded.file_progress[&destination_file.to_string_lossy().to_string()],
            "writing"
        );
        assert!(!loaded
            .file_progress
            .contains_key(&source_file.to_string_lossy().to_string()));
    }

    #[test]
    fn progress_keys_follow_folder_move_and_delete() {
        let root = TestDirectory::new("progress-retarget");
        let config = update_project_config(&root.0, |config| {
            config.file_progress.insert(
                "drafts/one.md".into(),
                ProjectFileProgress {
                    status: "writing".into(),
                    updated_at: 1,
                },
            );
            config.file_progress.insert(
                "drafts/nested/two.md".into(),
                ProjectFileProgress {
                    status: "done".into(),
                    updated_at: 2,
                },
            );
            Ok(())
        })
        .unwrap();
        let mut moved = config.clone();
        retarget_file_progress_path(&mut moved, "drafts", "archive/drafts", true);
        assert!(moved.file_progress.contains_key("archive/drafts/one.md"));
        assert!(moved
            .file_progress
            .contains_key("archive/drafts/nested/two.md"));

        remove_file_progress_path(&mut moved, "archive/drafts", true);
        assert!(moved.file_progress.is_empty());
    }
}
