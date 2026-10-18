//! Library: a folder holding several projects (works) directly under it.
//!
//! ```text
//! <library>/.then/library.json      marks the library
//! <library>/<work>/.then/project.json  marks a project
//! ```
//!
//! The library root itself behaves like a project whose tree stops at the
//! project folders, so every existing per-project store is reused as is.

use super::checkpoint_store::count_project_checkpoints;
use super::project_state::{
    legacy_project_config_path, load_project_config, lock_project_config, path_exists_checked,
    project_config_path, save_project_config_unlocked, update_project_config,
    validate_work_status, ProjectConfig, WorkMeta,
};
use super::{content_hash, now_millis};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const LIBRARY_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryConfig {
    schema_version: u32,
    id: String,
    name: String,
    /// Project folder names in the order the sidebar lists them. Projects not
    /// named here follow, sorted by name.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    project_order: Vec<String>,
    /// Property name -> the type the properties form uses for it, shared by every
    /// work in the library. Only picks the input; values are never converted.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    property_types: BTreeMap<String, String>,
}

const PROPERTY_TYPES: [&str; 6] = ["text", "list", "number", "checkbox", "date", "datetime"];
const MAX_PROPERTY_NAME_BYTES: usize = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LibraryProjectSummary {
    path: String,
    name: String,
}

/// Where an opened folder sits in its library.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LibraryContext {
    path: String,
    name: String,
    /// "root" when the library root is open, "project" when one of its works is.
    role: String,
    projects: Vec<LibraryProjectSummary>,
    /// Project folders found below the library root but not directly under it.
    /// They are left out of the tree and reported instead.
    misplaced_projects: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FolderInspection {
    /// "library" | "libraryProject" | "project" | "folder"
    kind: String,
    path: String,
    name: String,
    /// The library containing this folder (or the folder itself), if any.
    library_path: Option<String>,
    /// The library project containing this folder (or the folder itself), if any.
    project_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectImportReport {
    project_path: String,
    name: String,
    file_count: usize,
    checkpoint_count: usize,
    warnings: Vec<String>,
}

fn library_config_path(root: &Path) -> PathBuf {
    root.join(".then").join("library.json")
}

fn imports_directory(library: &Path) -> PathBuf {
    library.join(".then").join("importing")
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Library")
        .to_string()
}

pub(super) fn is_library_root(path: &Path) -> bool {
    library_config_path(path).is_file()
}

pub(super) fn is_project_root(path: &Path) -> bool {
    path.is_dir()
        && (project_config_path(path).is_file() || legacy_project_config_path(path).is_file())
        && !is_library_root(path)
}

fn read_library_config(root: &Path) -> Result<LibraryConfig, String> {
    let content = std::fs::read_to_string(library_config_path(root))
        .map_err(|error| format!("failed to read library.json: {error}"))?;
    let config: LibraryConfig = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse library.json: {error}"))?;
    if config.schema_version > LIBRARY_SCHEMA_VERSION {
        return Err(format!(
            "unsupported library schema version: {}",
            config.schema_version
        ));
    }
    Ok(config)
}

fn library_name(root: &Path) -> String {
    read_library_config(root)
        .ok()
        .map(|config| config.name)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| folder_name(root))
}

pub(super) fn library_projects(library: &Path) -> Result<Vec<LibraryProjectSummary>, String> {
    let mut projects = Vec::new();
    for entry in std::fs::read_dir(library)
        .map_err(|error| format!("failed to read library folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read library entry: {error}"))?;
        let path = entry.path();
        let name = folder_name(&path);
        if name.starts_with('.') || !is_project_root(&path) {
            continue;
        }
        projects.push(LibraryProjectSummary {
            path: path.to_string_lossy().to_string(),
            name,
        });
    }
    let order = read_library_config(library)
        .map(|config| config.project_order)
        .unwrap_or_default();
    projects.sort_by_key(|project| {
        (
            order.iter().position(|name| name == &project.name).unwrap_or(usize::MAX),
            project.name.to_lowercase(),
        )
    });
    Ok(projects)
}

fn write_library_config(root: &Path, config: &LibraryConfig) -> Result<(), String> {
    let path = library_config_path(root);
    std::fs::create_dir_all(path.parent().expect("library config has a parent"))
        .map_err(|error| format!("failed to create .then folder: {error}"))?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize library.json: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, content)
        .map_err(|error| format!("failed to write library.json: {error}"))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("failed to save library.json: {error}"))
}

/// Saves the sidebar order of a library's projects (by folder name).
pub(super) fn reorder_library_projects(
    library: &Path,
    ordered_names: Vec<String>,
) -> Result<Vec<LibraryProjectSummary>, String> {
    let mut config = read_library_config(library)?;
    let existing: Vec<String> = library_projects(library)?
        .into_iter()
        .map(|project| project.name)
        .collect();
    let mut order: Vec<String> = Vec::new();
    for name in ordered_names {
        if existing.contains(&name) && !order.contains(&name) {
            order.push(name);
        }
    }
    config.project_order = order;
    write_library_config(library, &config)?;
    library_projects(library)
}

/// The property types saved for the library `scope` belongs to. Empty outside a
/// library; unknown type names (from a newer version) are left out.
pub(super) fn library_property_types(scope: &Path) -> Result<BTreeMap<String, String>, String> {
    let Some(library) = library_of_scope(scope) else {
        return Ok(BTreeMap::new());
    };
    Ok(read_library_config(&library)?
        .property_types
        .into_iter()
        .filter(|(_, property_type)| PROPERTY_TYPES.contains(&property_type.as_str()))
        .collect())
}

/// Remembers the type chosen for a property name in the library `scope` belongs to.
pub(super) fn set_library_property_type(
    scope: &Path,
    name: &str,
    property_type: &str,
) -> Result<BTreeMap<String, String>, String> {
    if !PROPERTY_TYPES.contains(&property_type) {
        return Err(format!("unknown property type: {property_type}"));
    }
    if name.trim().is_empty() || name.len() > MAX_PROPERTY_NAME_BYTES {
        return Err("invalid property name".to_string());
    }
    let library = library_of_scope(scope)
        .ok_or_else(|| "ライブラリまたはライブラリ内の作品ではありません".to_string())?;
    let mut config = read_library_config(&library)?;
    if config.property_types.get(name).map(String::as_str) != Some(property_type) {
        config.property_types.insert(name.to_string(), property_type.to_string());
        write_library_config(&library, &config)?;
    }
    library_property_types(&library)
}

/// The library an opened folder belongs to, if any. `misplaced_projects` is
/// filled by the tree listing, which already walks the library root.
pub(super) fn library_context_for(
    path: &Path,
    misplaced_projects: Vec<String>,
) -> Result<Option<LibraryContext>, String> {
    let (library, role) = if is_library_root(path) {
        (path.to_path_buf(), "root")
    } else if let Some(parent) = path.parent().filter(|parent| is_library_root(parent)) {
        if !is_project_root(path) {
            return Ok(None);
        }
        (parent.to_path_buf(), "project")
    } else {
        return Ok(None);
    };
    Ok(Some(LibraryContext {
        path: library.to_string_lossy().to_string(),
        name: library_name(&library),
        role: role.to_string(),
        projects: library_projects(&library)?,
        misplaced_projects,
    }))
}

/// The library a scope (library root or library project) belongs to.
pub(super) fn library_of_scope(path: &Path) -> Option<PathBuf> {
    if is_library_root(path) {
        return Some(path.to_path_buf());
    }
    let parent = path.parent()?;
    (is_library_root(parent) && is_project_root(path)).then(|| parent.to_path_buf())
}

/// Items may only move between the root and the projects of one library.
pub(super) fn ensure_same_library(source: &Path, target: &Path) -> Result<(), String> {
    let source_library = library_of_scope(source)
        .ok_or_else(|| "移動元がライブラリまたはライブラリ内の作品ではありません".to_string())?;
    let target_library = library_of_scope(target)
        .ok_or_else(|| "移動先がライブラリまたはライブラリ内の作品ではありません".to_string())?;
    if source_library != target_library {
        return Err("別のライブラリへは移動・コピーできません".to_string());
    }
    if source == target {
        return Err("移動元と移動先が同じです".to_string());
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LibraryProjectOverview {
    path: String,
    name: String,
    work: Option<WorkMeta>,
    /// Project-relative path -> progress status (todo is not stored).
    file_progress: BTreeMap<String, String>,
}

/// What the library home lists for each project, read from its project.json.
/// A project whose config cannot be read is still listed, without details.
pub(super) fn library_overview(library: &Path) -> Result<Vec<LibraryProjectOverview>, String> {
    if !is_library_root(library) {
        return Err("library does not exist".to_string());
    }
    Ok(library_projects(library)?
        .into_iter()
        .map(|project| {
            let config = load_project_config(Path::new(&project.path)).ok();
            LibraryProjectOverview {
                work: config.as_ref().and_then(|config| config.work.clone()),
                file_progress: config
                    .map(|config| {
                        config
                            .file_progress
                            .into_iter()
                            .map(|(path, progress)| (path, progress.status))
                            .collect()
                    })
                    .unwrap_or_default(),
                path: project.path,
                name: project.name,
            }
        })
        .collect())
}

pub(super) fn save_project_work(project: &Path, status: &str, summary: &str) -> Result<WorkMeta, String> {
    if library_of_scope(project).is_none() || is_library_root(project) {
        return Err("ライブラリ内の作品ではありません".to_string());
    }
    validate_work_status(status)?;
    let work = WorkMeta {
        status: status.to_string(),
        summary: summary.trim().to_string(),
        updated_at: now_millis(),
    };
    let saved = work.clone();
    update_project_config(project, move |config| {
        config.work = Some(work);
        Ok(())
    })?;
    Ok(saved)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransferDestination {
    path: String,
    label: String,
}

/// Where items of a scope can be sent: a library root sends to its projects,
/// a project sends to its library root.
pub(super) fn transfer_destinations(scope: &Path) -> Result<Vec<TransferDestination>, String> {
    let Some(context) = library_context_for(scope, Vec::new())? else {
        return Ok(Vec::new());
    };
    Ok(if context.role == "root" {
        context
            .projects
            .into_iter()
            .map(|project| TransferDestination {
                label: format!("作品「{}」", project.name),
                path: project.path,
            })
            .collect()
    } else {
        vec![TransferDestination {
            label: format!("ライブラリ「{}」の直下", context.name),
            path: context.path,
        }]
    })
}

pub(super) fn inspect_folder(path: &Path) -> Result<FolderInspection, String> {
    if !path.is_dir() {
        return Err("folder does not exist".to_string());
    }
    let library = path.ancestors().find(|candidate| is_library_root(candidate));
    // The project is the ancestor sitting directly under the library.
    let project = library.and_then(|library| {
        path.ancestors()
            .find(|candidate| candidate.parent() == Some(library))
            .filter(|candidate| is_project_root(candidate))
    });
    let kind = if is_library_root(path) {
        "library"
    } else if project == Some(path) {
        "libraryProject"
    } else if library.is_none() && is_project_root(path) {
        "project"
    } else {
        "folder"
    };
    let as_string = |path: &Path| path.to_string_lossy().to_string();
    Ok(FolderInspection {
        kind: kind.to_string(),
        path: as_string(path),
        name: folder_name(path),
        library_path: library.map(as_string),
        project_path: project.map(as_string),
    })
}

fn ensure_project_config(root: &Path) -> Result<(), String> {
    // Loading first migrates a legacy .brew config by itself; only a folder
    // with neither config gets a fresh one.
    load_project_config(root)?;
    let _guard = lock_project_config()?;
    if !path_exists_checked(&project_config_path(root))? {
        save_project_config_unlocked(root, &ProjectConfig::default())?;
    }
    Ok(())
}

pub(super) fn create_library(folder: &Path, name: &str) -> Result<LibraryContext, String> {
    if !folder.is_dir() {
        return Err("folder does not exist".to_string());
    }
    if is_library_root(folder) {
        return library_context_for(folder, Vec::new())?
            .ok_or_else(|| "library could not be opened".to_string());
    }
    if is_project_root(folder) {
        return Err("作品フォルダはライブラリにできません".to_string());
    }
    if folder.ancestors().skip(1).any(is_library_root) {
        return Err("ライブラリの中に別のライブラリは作れません".to_string());
    }
    let name = name.trim();
    let config = LibraryConfig {
        schema_version: LIBRARY_SCHEMA_VERSION,
        id: format!("lib-{}", now_millis()),
        name: if name.is_empty() { folder_name(folder) } else { name.to_string() },
        project_order: Vec::new(),
        property_types: BTreeMap::new(),
    };
    write_library_config(folder, &config)?;
    library_context_for(folder, Vec::new())?.ok_or_else(|| "library could not be opened".to_string())
}

/// Creates a new folder under `parent` and makes it a library. An existing
/// folder is never turned into one here, so its contents cannot end up as
/// library-root files by accident.
pub(super) fn create_library_folder(
    parent: &Path,
    folder_name: &str,
    display_name: &str,
) -> Result<String, String> {
    if parent.ancestors().any(is_library_root) {
        return Err("ライブラリの中に別のライブラリは作れません".to_string());
    }
    let path = parent.join(folder_name);
    if path.exists() {
        return Err(format!("同じ名前のフォルダが既にあります: {}", path.display()));
    }
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create library folder: {error}"))?;
    if let Err(error) = create_library(&path, display_name) {
        let _ = std::fs::remove_dir_all(&path);
        return Err(error);
    }
    Ok(path.to_string_lossy().to_string())
}

fn unique_child_path(parent: &Path, name: &str) -> PathBuf {
    let first = parent.join(name);
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|index| parent.join(format!("{name} ({index})")))
        .find(|candidate| !candidate.exists())
        .expect("an unused name exists")
}

pub(super) fn create_library_project(library: &Path, folder_name: &str) -> Result<String, String> {
    if !is_library_root(library) {
        return Err("library does not exist".to_string());
    }
    let path = library.join(folder_name);
    if path.exists() {
        return Err("同じ名前のフォルダが既にあります".to_string());
    }
    std::fs::create_dir(&path).map_err(|error| format!("failed to create project folder: {error}"))?;
    if let Err(error) = ensure_project_config(&path) {
        let _ = std::fs::remove_dir_all(&path);
        return Err(error);
    }
    Ok(path.to_string_lossy().to_string())
}

#[derive(PartialEq, Eq, Debug)]
struct FileFingerprint {
    size: u64,
    hash: String,
}

fn fingerprint_tree(
    root: &Path,
    path: &Path,
    out: &mut BTreeMap<String, FileFingerprint>,
    folders: &mut usize,
) -> Result<(), String> {
    for entry in std::fs::read_dir(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to read folder entry: {error}"))?;
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", entry_path.display()))?;
        if file_type.is_symlink() {
            return Err(format!(
                "シンボリックリンクを含むフォルダは取り込めません: {}",
                entry_path.display()
            ));
        }
        if file_type.is_dir() {
            *folders += 1;
            fingerprint_tree(root, &entry_path, out, folders)?;
            continue;
        }
        let bytes = std::fs::read(&entry_path)
            .map_err(|error| format!("failed to read {}: {error}", entry_path.display()))?;
        let relative = entry_path
            .strip_prefix(root)
            .map_err(|_| "file outside the project".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        out.insert(
            relative,
            FileFingerprint {
                size: bytes.len() as u64,
                hash: content_hash(&bytes),
            },
        );
    }
    Ok(())
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target)
        .map_err(|error| format!("failed to create {}: {error}", target.display()))?;
    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("failed to read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to read folder entry: {error}"))?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", from.display()))?;
        if file_type.is_dir() {
            copy_tree(&from, &to)?;
        } else if file_type.is_file() {
            std::fs::copy(&from, &to)
                .map_err(|error| format!("failed to copy {}: {error}", from.display()))?;
        }
    }
    Ok(())
}

fn verify_copy(source: &Path, copy: &Path) -> Result<(usize, usize, Vec<String>), String> {
    let mut source_files = BTreeMap::new();
    let mut copy_files = BTreeMap::new();
    let mut source_folders = 0;
    let mut copy_folders = 0;
    fingerprint_tree(source, source, &mut source_files, &mut source_folders)?;
    fingerprint_tree(copy, copy, &mut copy_files, &mut copy_folders)?;

    if source_folders != copy_folders {
        return Err(format!(
            "フォルダ数が一致しません（元 {source_folders} / コピー {copy_folders}）"
        ));
    }
    if source_files.len() != copy_files.len() {
        return Err(format!(
            "ファイル数が一致しません（元 {} / コピー {}）",
            source_files.len(),
            copy_files.len()
        ));
    }
    for (path, fingerprint) in &source_files {
        match copy_files.get(path) {
            Some(copied) if copied == fingerprint => {}
            Some(_) => return Err(format!("内容が一致しません: {path}")),
            None => return Err(format!("コピーされていません: {path}")),
        }
    }

    let source_config = load_project_config(source)?;
    let copy_config = load_project_config(copy)?;
    if source_config.revision != copy_config.revision {
        return Err("project.json の revision が一致しません".to_string());
    }

    let (source_checkpoints, source_unreadable) = count_project_checkpoints(source)?;
    let (copy_checkpoints, copy_unreadable) = count_project_checkpoints(copy)?;
    if source_checkpoints != copy_checkpoints {
        return Err(format!(
            "読み込めるチェックポイントの数が一致しません（元 {source_checkpoints} / コピー {copy_checkpoints}）"
        ));
    }

    let mut warnings = Vec::new();
    if source_unreadable > 0 || copy_unreadable > 0 {
        warnings.push(format!(
            "取り込み元で読み込めないチェックポイントが {source_unreadable} 件あります"
        ));
    }
    for key in copy_config.file_progress.keys() {
        if !copy.join(key).is_file() {
            warnings.push(format!("進捗ラベルの対象が見つかりません: {key}"));
        }
    }
    Ok((source_files.len(), copy_checkpoints, warnings))
}

/// Copies a project folder into the library, verifies the copy and only then
/// gives it its final name. The source folder is never written to.
pub(super) fn import_project_into_library(
    source: &Path,
    library: &Path,
) -> Result<ProjectImportReport, String> {
    if !source.is_dir() {
        return Err("取り込み元のフォルダがありません".to_string());
    }
    if !is_library_root(library) {
        return Err("取り込み先のライブラリがありません".to_string());
    }
    if is_library_root(source) {
        return Err("ライブラリは作品として取り込めません".to_string());
    }
    if source.parent() == Some(library) {
        return Err("この作品は既にライブラリの中にあります".to_string());
    }
    if library.starts_with(source) || source.starts_with(library) {
        return Err("ライブラリの中のフォルダや、ライブラリを含むフォルダは取り込めません".to_string());
    }

    let staging_root = imports_directory(library);
    std::fs::create_dir_all(&staging_root)
        .map_err(|error| format!("failed to create import folder: {error}"))?;
    let staging = staging_root.join(format!("import-{}", now_millis()));

    let result = copy_tree(source, &staging).and_then(|_| verify_copy(source, &staging));
    let (file_count, checkpoint_count, warnings) = match result {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };

    let finish = || -> Result<PathBuf, String> {
        ensure_project_config(&staging)?;
        let target = unique_child_path(library, &folder_name(source));
        std::fs::rename(&staging, &target)
            .map_err(|error| format!("failed to move the verified copy into place: {error}"))?;
        Ok(target)
    };
    let target = match finish() {
        Ok(target) => target,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };

    Ok(ProjectImportReport {
        name: folder_name(&target),
        project_path: target.to_string_lossy().to_string(),
        file_count,
        checkpoint_count,
        warnings,
    })
}

/// Unfinished imports left by a crash.
pub(super) fn list_stale_imports(library: &Path) -> Result<Vec<String>, String> {
    let directory = imports_directory(library);
    if !path_exists_checked(&directory)? {
        return Ok(Vec::new());
    }
    let mut stale = Vec::new();
    for entry in std::fs::read_dir(&directory)
        .map_err(|error| format!("failed to read import folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read import entry: {error}"))?;
        stale.push(entry.path().to_string_lossy().to_string());
    }
    stale.sort();
    Ok(stale)
}

pub(super) fn discard_stale_imports(library: &Path) -> Result<(), String> {
    let directory = imports_directory(library);
    if !path_exists_checked(&directory)? {
        return Ok(());
    }
    std::fs::remove_dir_all(&directory)
        .map_err(|error| format!("failed to remove unfinished imports: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "then-library-{name}-{}-{}",
                std::process::id(),
                now_millis()
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

    fn write(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn detects_library_and_its_projects() {
        let dir = TestDirectory::new("detect");
        let library = dir.0.join("lib");
        std::fs::create_dir_all(&library).unwrap();
        create_library(&library, "作品集").unwrap();
        let work = create_library_project(&library, "作品A").unwrap();
        std::fs::create_dir_all(library.join("資料")).unwrap();

        let root = library_context_for(&library, Vec::new()).unwrap().unwrap();
        assert_eq!(root.role, "root");
        assert_eq!(root.name, "作品集");
        assert_eq!(root.projects.len(), 1);
        assert_eq!(root.projects[0].name, "作品A");

        let project = library_context_for(Path::new(&work), Vec::new()).unwrap().unwrap();
        assert_eq!(project.role, "project");
        assert_eq!(inspect_folder(Path::new(&work)).unwrap().kind, "libraryProject");
        let shared = inspect_folder(&library.join("資料")).unwrap();
        assert_eq!(shared.kind, "folder");
        assert_eq!(shared.library_path.as_deref(), Some(library.to_str().unwrap()));
        assert!(shared.project_path.is_none());
        std::fs::create_dir_all(Path::new(&work).join("01_本文")).unwrap();
        let chapter = inspect_folder(&Path::new(&work).join("01_本文")).unwrap();
        assert_eq!(chapter.kind, "folder");
        assert_eq!(chapter.project_path.as_deref(), Some(work.as_str()));
        assert!(library_context_for(&library.join("資料"), Vec::new()).unwrap().is_none());
    }

    #[test]
    fn remembers_property_types_for_the_whole_library() {
        let dir = TestDirectory::new("property-types");
        let library = dir.0.join("lib");
        std::fs::create_dir_all(&library).unwrap();
        create_library(&library, "作品集").unwrap();
        let work_a = create_library_project(&library, "作品A").unwrap();
        let work_b = create_library_project(&library, "作品B").unwrap();
        reorder_library_projects(&library, vec!["作品B".into(), "作品A".into()]).unwrap();

        assert!(library_property_types(Path::new(&work_a)).unwrap().is_empty());
        set_library_property_type(Path::new(&work_a), "date", "date").unwrap();
        set_library_property_type(&library, "publish", "checkbox").unwrap();

        // Shared by every work and the root; the project order is untouched.
        let from_b = library_property_types(Path::new(&work_b)).unwrap();
        assert_eq!(from_b.get("date").map(String::as_str), Some("date"));
        assert_eq!(from_b.get("publish").map(String::as_str), Some("checkbox"));
        let names: Vec<String> = library_projects(&library).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["作品B".to_string(), "作品A".to_string()]);

        assert!(set_library_property_type(&library, "date", "colour").is_err());
        assert!(set_library_property_type(&library, " ", "text").is_err());
        let outside = dir.0.join("単独");
        std::fs::create_dir_all(&outside).unwrap();
        assert!(library_property_types(&outside).unwrap().is_empty());
        assert!(set_library_property_type(&outside, "date", "date").is_err());
    }

    #[test]
    fn reads_library_json_without_property_types_and_skips_unknown_types() {
        let dir = TestDirectory::new("property-types-old");
        let library = dir.0.join("lib");
        write(
            &library_config_path(&library),
            r#"{"schemaVersion":1,"id":"lib-1","name":"作品集","propertyTypes":{"a":"text","b":"rating"}}"#,
        );
        let types = library_property_types(&library).unwrap();
        assert_eq!(types.len(), 1);
        assert_eq!(types.get("a").map(String::as_str), Some("text"));
        write(&library_config_path(&library), r#"{"schemaVersion":1,"id":"lib-1","name":"作品集"}"#);
        assert!(library_property_types(&library).unwrap().is_empty());
    }

    #[test]
    fn creates_a_new_library_folder_but_never_reuses_an_existing_one() {
        let dir = TestDirectory::new("folder");
        let library = create_library_folder(&dir.0.join("Then"), "作品集", "わたしの作品集").unwrap();
        let context = library_context_for(Path::new(&library), Vec::new()).unwrap().unwrap();
        assert_eq!(context.name, "わたしの作品集");
        assert!(create_library_folder(&dir.0.join("Then"), "作品集", "").is_err());
        assert!(create_library_folder(Path::new(&library), "inner", "").is_err());
    }

    #[test]
    fn transfers_stay_within_one_library() {
        let dir = TestDirectory::new("same");
        let first = PathBuf::from(create_library_folder(&dir.0, "a", "").unwrap());
        let second = PathBuf::from(create_library_folder(&dir.0, "b", "").unwrap());
        let work = PathBuf::from(create_library_project(&first, "作品").unwrap());
        let other = PathBuf::from(create_library_project(&second, "別").unwrap());
        assert!(ensure_same_library(&first, &work).is_ok());
        assert!(ensure_same_library(&work, &first).is_ok());
        assert!(ensure_same_library(&work, &work).is_err());
        assert!(ensure_same_library(&work, &other).is_err());
        assert!(ensure_same_library(&dir.0, &work).is_err());
    }

    #[test]
    fn lists_transfer_destinations_for_both_directions() {
        let dir = TestDirectory::new("dest");
        let library = PathBuf::from(create_library_folder(&dir.0, "lib", "作品集").unwrap());
        let work = PathBuf::from(create_library_project(&library, "作品").unwrap());
        let from_root = transfer_destinations(&library).unwrap();
        assert_eq!(from_root.len(), 1);
        assert_eq!(from_root[0].label, "作品「作品」");
        let from_project = transfer_destinations(&work).unwrap();
        assert_eq!(from_project[0].path, library.to_string_lossy());
        assert!(transfer_destinations(&dir.0).unwrap().is_empty());
    }

    #[test]
    fn keeps_the_saved_project_order() {
        let dir = TestDirectory::new("order");
        let library = PathBuf::from(create_library_folder(&dir.0, "lib", "").unwrap());
        for name in ["あ", "い", "う"] {
            create_library_project(&library, name).unwrap();
        }
        let names = |projects: Vec<LibraryProjectSummary>| -> Vec<String> {
            projects.into_iter().map(|project| project.name).collect()
        };
        assert_eq!(names(library_projects(&library).unwrap()), ["あ", "い", "う"]);
        let reordered = reorder_library_projects(
            &library,
            vec!["う".into(), "あ".into(), "消えた作品".into()],
        )
        .unwrap();
        assert_eq!(names(reordered), ["う", "あ", "い"], "unknown names are ignored, unlisted ones follow");
        create_library_project(&library, "え").unwrap();
        assert_eq!(names(library_projects(&library).unwrap()), ["う", "あ", "い", "え"]);
    }

    #[test]
    fn overview_reads_work_meta_and_progress() {
        let dir = TestDirectory::new("overview");
        let library = PathBuf::from(create_library_folder(&dir.0, "lib", "").unwrap());
        let work = PathBuf::from(create_library_project(&library, "作品").unwrap());
        create_library_project(&library, "白紙").unwrap();
        save_project_work(&work, "writing", "  あらすじ  ").unwrap();
        assert!(save_project_work(&work, "unknown", "").is_err());
        assert!(save_project_work(&library, "writing", "").is_err());

        let overview = library_overview(&library).unwrap();
        assert_eq!(overview.len(), 2);
        let meta = overview[0].work.as_ref().expect("work meta");
        assert_eq!((meta.status.as_str(), meta.summary.as_str()), ("writing", "あらすじ"));
        assert!(overview[1].work.is_none());
    }

    #[test]
    fn refuses_libraries_inside_libraries_and_projects() {
        let dir = TestDirectory::new("nested");
        let library = dir.0.join("lib");
        std::fs::create_dir_all(library.join("inner")).unwrap();
        create_library(&library, "").unwrap();
        assert!(create_library(&library.join("inner"), "").is_err());
        let work = create_library_project(&library, "作品").unwrap();
        assert!(create_library(Path::new(&work), "").is_err());
    }

    #[test]
    fn imports_a_verified_copy_and_leaves_the_source_untouched() {
        let dir = TestDirectory::new("import");
        let library = dir.0.join("lib");
        let source = dir.0.join("old-work");
        std::fs::create_dir_all(&library).unwrap();
        create_library(&library, "").unwrap();
        write(&source.join("01_本文").join("第一章.txt"), "本文");
        write(&source.join("メモ.md"), "memo");
        let before = std::fs::read_dir(&source).unwrap().count();

        let report = import_project_into_library(&source, &library).unwrap();
        assert_eq!(report.name, "old-work");
        assert_eq!(report.file_count, 2);
        let target = PathBuf::from(&report.project_path);
        assert_eq!(std::fs::read_to_string(target.join("01_本文").join("第一章.txt")).unwrap(), "本文");
        assert!(is_project_root(&target), "import gives the copy a project.json");
        assert!(!project_config_path(&source).exists(), "the source is not written to");
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), before);
        assert!(list_stale_imports(&library).unwrap().is_empty());

        let again = import_project_into_library(&source, &library).unwrap();
        assert_eq!(again.name, "old-work (2)");
    }

    #[test]
    fn library_root_tree_stops_at_project_folders() {
        let dir = TestDirectory::new("tree");
        let library = dir.0.join("lib");
        std::fs::create_dir_all(&library).unwrap();
        create_library(&library, "").unwrap();
        let work = PathBuf::from(create_library_project(&library, "作品").unwrap());
        write(&work.join("本文.txt"), "work");
        write(&library.join("メモ.txt"), "memo");
        let grouped = library.join("まとめ").join("迷子");
        std::fs::create_dir_all(&grouped).unwrap();
        ensure_project_config(&grouped).unwrap();
        write(&grouped.join("本文.txt"), "lost");

        let listed = super::super::list_project_folder(&library).unwrap();
        let names: Vec<_> = listed.children.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, vec!["まとめ", "メモ.txt"]);
        assert!(listed.children[0].children.is_empty(), "misplaced project is not listed");
        let context = listed.library.expect("library context");
        assert_eq!(context.projects.len(), 1);
        assert_eq!(context.misplaced_projects, vec![grouped.to_string_lossy().to_string()]);

        let project = super::super::list_project_folder(&work).unwrap();
        assert_eq!(project.children.len(), 1);
        assert_eq!(project.library.expect("project context").role, "project");
    }

    #[test]
    fn refuses_to_import_from_inside_the_library() {
        let dir = TestDirectory::new("inside");
        let library = dir.0.join("lib");
        std::fs::create_dir_all(&library).unwrap();
        create_library(&library, "").unwrap();
        let work = create_library_project(&library, "作品").unwrap();
        assert!(import_project_into_library(Path::new(&work), &library).is_err());
        assert!(import_project_into_library(&library, &library).is_err());
    }
}
