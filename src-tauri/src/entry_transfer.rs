//! U5: 素材のノート・画像・PDF を、同じライブラリのほかの作品・ライブラリ直下へ送る（移動・コピー）。
//! 手順書は docs/BINDER_REMAINING_PLAN.md。
//!
//! - 送れるのは、作品では素材フォルダの中のファイル（txt・md・画像・PDF）、直下では作品のフォルダの外の
//!   txt・md と、資料のフォルダ（`資料/`）の画像・PDF。フォルダと原稿の段のファイルは送らない。
//! - 送り先は、作品ならノートを素材フォルダの直下へ（なければ「素材」を作る）、画像・PDF を `<素材>/資料/`
//!   へ。直下ならノートを直下へ、画像・PDF を直下の資料のフォルダへ。同じ名前があれば `-2` … を付ける。
//! - 両方の `project.json`（並び・進捗）を、ファイルを動かしたのと同じ錠の中で書く。途中で失敗したら、
//!   動かしたファイルと書いた `project.json` を元に戻して失敗にする。
//! - 本文のリンクは書き換えない（画面の側が、一緒に送ったもの同士の `@[[ ]]` だけを書き換える）。

use super::idea_migration::REFERENCES_FOLDER_NAME;
use super::material_files::{self, ConfigSnapshot};
use super::plot_migration::{first_free_name, note_folder};
use super::project_state::{
    load_project_config_unlocked, lock_project_config, remove_file_progress_path, save_project_config_unlocked,
    trusted_project_relative_path, ProjectConfig, ProjectFileProgress,
};
use super::{
    content_hash, has_reserved_project_component, is_supported_text_extension, library,
    project_entry_names_in_display_order, project_order_key,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransferredEntry {
    pub(super) old_path: String,
    pub(super) new_path: String,
    /// "text"（txt・md）か "material"（画像・PDF）。
    pub(super) kind: String,
    /// 送った先のファイルの中身のハッシュ（元に戻すとき、送り先で直していないかを見る）。
    pub(super) content_hash: String,
    /// 移動したとき、送り元のフォルダの並びでの位置（元に戻すときにそこへ入れる）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_order_index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransferResult {
    pub(super) entries: Vec<TransferredEntry>,
    /// 送り先に素材フォルダがなく、今回作ったときの名前。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) created_materials_folder: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransferUndoResult {
    pub(super) undone: Vec<TransferredEntry>,
    /// 送り先で直されていた・なくなっていた・元の場所がふさがっていたので戻さなかった数。
    pub(super) skipped: usize,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Text,
    Material,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Text => "text",
            Kind::Material => "material",
        }
    }
}

struct Planned {
    source: PathBuf,
    target: PathBuf,
    kind: Kind,
    source_order_index: Option<usize>,
}

/// 直下の資料のフォルダ（2-5 の移行で決めた名前。なければ「資料」）。
fn library_references_folder(root: &Path, config: &ProjectConfig) -> PathBuf {
    let name = config
        .idea_migration
        .as_ref()
        .and_then(|record| record.references_folder.clone())
        .unwrap_or_else(|| REFERENCES_FOLDER_NAME.to_string());
    root.join(name)
}

fn kind_of(path: &Path) -> Option<Kind> {
    if is_supported_text_extension(path) {
        Some(Kind::Text)
    } else if material_files::is_material_file(path) {
        Some(Kind::Material)
    } else {
        None
    }
}

fn is_inside(folder: &Path, path: &Path) -> bool {
    match (folder.canonicalize(), path.canonicalize()) {
        (Ok(folder), Ok(path)) => path.starts_with(folder),
        _ => false,
    }
}

/// 送れるファイルか（素材の中・直下の作品の外）。送れなければ理由。
fn check_source(root: &Path, config: &ProjectConfig, path: &Path) -> Result<Kind, String> {
    if !path.is_file() {
        return Err("only files can be sent to another work".to_string());
    }
    if !is_inside(root, path) {
        return Err("the file is outside the work".to_string());
    }
    let relative = path.strip_prefix(root).map_err(|_| "the file is outside the work".to_string())?;
    if has_reserved_project_component(relative) {
        return Err("app-managed files cannot be sent".to_string());
    }
    let kind = kind_of(path).ok_or_else(|| "only notes, images and PDFs can be sent".to_string())?;
    if library::is_library_root(root) {
        let first = relative.components().next().map(|part| root.join(part.as_os_str()));
        if first.as_deref().is_some_and(library::is_project_root) {
            return Err("the file belongs to a work".to_string());
        }
        if kind == Kind::Material && !is_inside(&library_references_folder(root, config), path) {
            return Err("images and PDFs are sent from the references folder".to_string());
        }
    } else {
        let materials = material_files::materials_folder(root, config);
        if !material_files::is_in(materials.as_deref(), path) {
            return Err("only materials can be sent to another work".to_string());
        }
    }
    Ok(kind)
}

fn split_name(path: &Path) -> (String, String) {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_string();
    match name.rfind('.') {
        Some(at) if at > 0 => (name[..at].to_string(), name[at..].to_string()),
        _ => (name, String::new()),
    }
}

fn move_file(source: &Path, target: &Path) -> Result<(), String> {
    if std::fs::rename(source, target).is_ok() {
        return Ok(());
    }
    std::fs::copy(source, target).map_err(|error| format!("failed to move {}: {error}", source.display()))?;
    std::fs::remove_file(source).map_err(|error| {
        let _ = std::fs::remove_file(target);
        format!("failed to remove {} after copying: {error}", source.display())
    })
}

fn file_name(path: &Path) -> String {
    path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_string()
}

/// フォルダの並びに名前を入れる（`index` がなければ最後）。
fn insert_order(root: &Path, config: &mut ProjectConfig, folder: &Path, name: &str, index: Option<usize>) -> Result<(), String> {
    let mut names: Vec<String> = project_entry_names_in_display_order(root, folder, config)?
        .into_iter()
        .filter(|item| item != name)
        .collect();
    let at = index.unwrap_or(names.len()).min(names.len());
    names.insert(at, name.to_string());
    config.order.insert(project_order_key(root, folder)?, names);
    Ok(())
}

fn remove_order(root: &Path, config: &mut ProjectConfig, folder: &Path, name: &str) -> Result<(), String> {
    let key = project_order_key(root, folder)?;
    if let Some(order) = config.order.get_mut(&key) {
        order.retain(|item| item != name);
    }
    Ok(())
}

fn take_progress(root: &Path, config: &mut ProjectConfig, path: &Path) -> Option<ProjectFileProgress> {
    let relative = trusted_project_relative_path(root, path).ok()?;
    let progress = config.file_progress.get(&relative).cloned();
    remove_file_progress_path(config, &relative, false);
    progress
}

fn put_progress(root: &Path, config: &mut ProjectConfig, path: &Path, progress: Option<ProjectFileProgress>) {
    let (Some(progress), Ok(relative)) = (progress, trusted_project_relative_path(root, path)) else { return };
    config.file_progress.insert(relative, progress);
}

/// 送る。`move_entries` が偽ならコピー（元に残す）。
pub(super) fn transfer_entries(
    source_root: &Path,
    target_root: &Path,
    source_paths: &[String],
    move_entries: bool,
) -> Result<TransferResult, String> {
    library::ensure_same_library(source_root, target_root)?;
    if source_paths.is_empty() {
        return Err("no files to send".to_string());
    }
    let _guard = lock_project_config()?;
    let source_before = ConfigSnapshot::take(source_root);
    let target_before = ConfigSnapshot::take(target_root);
    let mut source_config = load_project_config_unlocked(source_root)?;
    let mut target_config = load_project_config_unlocked(target_root)?;

    let mut sources: Vec<(PathBuf, Kind)> = Vec::new();
    for path in source_paths {
        let path = PathBuf::from(path);
        let kind = check_source(source_root, &source_config, &path)?;
        if !sources.iter().any(|(seen, _)| seen == &path) {
            sources.push((path, kind));
        }
    }

    // 送り先のフォルダ。素材フォルダがなければ作る（作ったら、失敗したときに消す）。
    let (notes_folder, created_materials_folder) =
        note_folder(target_root, target_config.materials_folder_name())?;
    if let Some(name) = &created_materials_folder {
        target_config.materials_folder = Some(name.clone());
    }
    let references_folder = if library::is_library_root(target_root) {
        library_references_folder(target_root, &target_config)
    } else {
        notes_folder.join(REFERENCES_FOLDER_NAME)
    };
    let created_references_folder = sources.iter().any(|(_, kind)| *kind == Kind::Material) && !references_folder.exists();
    let undo_folders = |created_materials: &Option<String>| {
        if created_references_folder {
            let _ = std::fs::remove_dir(&references_folder);
        }
        if let Some(name) = created_materials {
            let _ = std::fs::remove_dir(target_root.join(name));
        }
    };
    if created_references_folder {
        if let Err(error) = std::fs::create_dir_all(&references_folder) {
            undo_folders(&created_materials_folder);
            return Err(format!("failed to create the references folder: {error}"));
        }
    }

    let mut planned: Vec<Planned> = Vec::new();
    for (source, kind) in sources {
        let folder = if kind == Kind::Text { &notes_folder } else { &references_folder };
        let (stem, extension) = split_name(&source);
        let name = first_free_name(&stem, &extension, |candidate| {
            folder.join(candidate).exists()
                || planned.iter().any(|item| file_name(&item.target).to_lowercase() == candidate.to_lowercase()
                    && item.target.parent() == Some(folder.as_path()))
        });
        let source_order_index = (move_entries && kind == Kind::Text)
            .then(|| {
                let parent = source.parent()?;
                project_entry_names_in_display_order(source_root, parent, &source_config)
                    .ok()?
                    .iter()
                    .position(|item| item == &file_name(&source))
            })
            .flatten();
        planned.push(Planned { target: folder.join(name), source, kind, source_order_index });
    }

    let mut done: Vec<&Planned> = Vec::new();
    let rollback = |done: &[&Planned]| {
        for item in done.iter().rev() {
            if move_entries {
                let _ = move_file(&item.target, &item.source);
            } else {
                let _ = std::fs::remove_file(&item.target);
            }
        }
    };
    for item in &planned {
        let result = if move_entries {
            move_file(&item.source, &item.target)
        } else {
            std::fs::copy(&item.source, &item.target)
                .map(|_| ())
                .map_err(|error| format!("failed to copy {}: {error}", item.source.display()))
        };
        if let Err(error) = result {
            rollback(&done);
            undo_folders(&created_materials_folder);
            return Err(error);
        }
        done.push(item);
    }

    let mut update_configs = || -> Result<(), String> {
        for item in &planned {
            if item.kind != Kind::Text {
                continue;
            }
            let progress = if move_entries {
                let parent = item.source.parent().ok_or_else(|| "entry parent does not exist".to_string())?;
                remove_order(source_root, &mut source_config, parent, &file_name(&item.source))?;
                take_progress(source_root, &mut source_config, &item.source)
            } else {
                trusted_project_relative_path(source_root, &item.source)
                    .ok()
                    .and_then(|relative| source_config.file_progress.get(&relative).cloned())
            };
            insert_order(target_root, &mut target_config, &notes_folder, &file_name(&item.target), None)?;
            put_progress(target_root, &mut target_config, &item.target, progress);
        }
        save_project_config_unlocked(target_root, &target_config)?;
        if move_entries {
            save_project_config_unlocked(source_root, &source_config)?;
        }
        Ok(())
    };
    if let Err(error) = update_configs() {
        source_before.restore();
        target_before.restore();
        rollback(&done);
        undo_folders(&created_materials_folder);
        return Err(error);
    }

    let entries = planned
        .iter()
        .map(|item| {
            Ok(TransferredEntry {
                old_path: item.source.to_string_lossy().to_string(),
                new_path: item.target.to_string_lossy().to_string(),
                kind: item.kind.as_str().to_string(),
                content_hash: content_hash(
                    &std::fs::read(&item.target).map_err(|error| format!("failed to read the sent file: {error}"))?,
                ),
                source_order_index: item.source_order_index,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(TransferResult { entries, created_materials_folder })
}

/// 通知の「元に戻す」。移動は送り元の元の場所へ戻し、コピーは写しを OS のゴミ箱へ送る。送り先で直されて
/// いたもの・なくなっていたもの・元の場所がふさがっているものは戻さずに数える。
pub(super) fn undo_transfer(
    source_root: &Path,
    target_root: &Path,
    entries: &[TransferredEntry],
    moved: bool,
    trash: impl Fn(&Path, &Path) -> Result<(), String>,
) -> Result<TransferUndoResult, String> {
    library::ensure_same_library(source_root, target_root)?;
    let _guard = lock_project_config()?;
    let mut source_config = load_project_config_unlocked(source_root)?;
    let mut target_config = load_project_config_unlocked(target_root)?;
    let mut undone = Vec::new();
    let mut skipped = 0;
    for entry in entries {
        let sent = PathBuf::from(&entry.new_path);
        let original = PathBuf::from(&entry.old_path);
        let unchanged = std::fs::read(&sent).is_ok_and(|bytes| content_hash(&bytes) == entry.content_hash);
        let inside = sent.starts_with(target_root) && original.starts_with(source_root);
        if !unchanged || !inside || (moved && original.exists()) {
            skipped += 1;
            continue;
        }
        let text = entry.kind == "text";
        if moved {
            if let Some(parent) = original.parent() {
                std::fs::create_dir_all(parent).map_err(|error| format!("failed to recreate the folder: {error}"))?;
            }
            move_file(&sent, &original)?;
            if text {
                let progress = take_progress(target_root, &mut target_config, &sent);
                if let Some(parent) = sent.parent() {
                    remove_order(target_root, &mut target_config, parent, &file_name(&sent))?;
                }
                if let Some(parent) = original.parent() {
                    insert_order(source_root, &mut source_config, parent, &file_name(&original), entry.source_order_index)?;
                }
                put_progress(source_root, &mut source_config, &original, progress);
            }
        } else {
            if trash(target_root, &sent).is_err() {
                skipped += 1;
                continue;
            }
            if text {
                take_progress(target_root, &mut target_config, &sent);
                if let Some(parent) = sent.parent() {
                    remove_order(target_root, &mut target_config, parent, &file_name(&sent))?;
                }
            }
        }
        undone.push(entry.clone());
    }
    if !undone.is_empty() {
        save_project_config_unlocked(target_root, &target_config)?;
        if moved {
            save_project_config_unlocked(source_root, &source_config)?;
        }
    }
    Ok(TransferUndoResult { undone, skipped })
}

#[cfg(test)]
mod tests;
