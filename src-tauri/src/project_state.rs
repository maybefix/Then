use super::{IdeaThreadConfig, PlotCardConfig, ProofreadTermConfig, SnippetConfig};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
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
    pub(super) updated_at: i64,
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
    Ok(())
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
}
