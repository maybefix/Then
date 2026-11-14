//! 投稿 →「ノートにする」（BINDER 2-3、docs/BINDER_POST_TO_NOTE_PLAN.md）。
//!
//! いま開いている作品の素材フォルダにノートを作り、元の投稿の行に `note`（作品の ID と、作品のフォルダからの
//! 相対パス）を書く。投稿の鍵を取ったまま、投稿のハッシュを比べてから、素材フォルダ（なければ作る。1-6 と同じ
//! 決め方）→ ノート → `project.json`（素材フォルダを作ったときだけ）→ 投稿の行、の順に書く。途中で失敗したら、
//! その回に作ったノートと素材フォルダを消し、`materialsFolder` も戻す。

use super::*;
use crate::content_hash;
use crate::plot_migration::{first_free_name, note_folder, relative_slash_path, write_new_file};
use crate::project_state::{
    load_project_config, load_project_config_unlocked, lock_project_config, save_project_config_unlocked,
};
use std::collections::HashMap;

const NOTE_KEY: &str = "note";

/// 投稿の行に書く、ノートの場所。
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub(super) struct StoredNote {
    /// ノートを作った作品の `workId`。
    pub(super) work: String,
    /// 作品のフォルダからの相対パス（区切りは `/`）。
    pub(super) path: String,
}

/// 画面へ渡すノートの場所。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NoteView {
    work: String,
    path: String,
    /// ノートのある作品のフォルダ。ライブラリの中で見つからなければない。
    #[serde(skip_serializing_if = "Option::is_none")]
    work_root: Option<String>,
    /// ノートのある作品の名前（フォルダ名）。
    #[serde(skip_serializing_if = "Option::is_none")]
    work_name: Option<String>,
    /// ノートのファイルがあるか。外で改名・移動・削除されていれば偽（札を薄く出す）。
    exists: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PostHash {
    id: String,
    hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MadeNote {
    snapshot: PostsSnapshot,
    /// 作ったノートの絶対パス。
    note_path: String,
    /// 作ったときのノートの中身のハッシュ（元に戻すとき、書き足していないかを見る）。
    note_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnlinkedNote {
    snapshot: PostsSnapshot,
    /// ノートの中身が作ったときのままか。ままならゴミ箱へ移してよい。
    note_unchanged: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathChange {
    old_path: String,
    new_path: String,
}

pub(super) fn stored_note(post: &PostLine) -> Option<StoredNote> {
    serde_json::from_value(post.extra.get(NOTE_KEY)?.clone()).ok()
}

pub(super) fn has_note(post: &PostLine) -> bool {
    post.extra.get(NOTE_KEY).is_some_and(|note| !note.is_null())
}

/// ライブラリの作品の `workId` → 作品のフォルダ。ライブラリの外の作品では、その作品だけ。
fn known_works(place: &Place) -> HashMap<String, PathBuf> {
    let mut works = HashMap::new();
    let library_root = place
        .file
        .parent()
        .and_then(Path::parent)
        .filter(|root| library::is_library_root(root))
        .map(Path::to_path_buf);
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(library_root) = library_root {
        if let Ok(entries) = std::fs::read_dir(&library_root) {
            roots.extend(entries.flatten().map(|entry| entry.path()).filter(|path| library::is_project_root(path)));
        }
    } else if let Some(work_root) = &place.work_root {
        roots.push(work_root.clone());
    }
    for root in roots {
        if let Ok(config) = load_project_config(&root) {
            if let Some(id) = config.work_id.filter(|id| !id.trim().is_empty()) {
                works.entry(id).or_insert(root);
            }
        }
    }
    works
}

/// 投稿の一覧に、ノートの場所（作品のフォルダ・名前・ファイルがあるか）を付ける。
pub(super) fn resolve_notes(place: &Place, entries: &mut [(PostView, Option<StoredNote>)]) {
    if entries.iter().all(|(_, note)| note.is_none()) {
        return;
    }
    let works = known_works(place);
    for (view, note) in entries.iter_mut() {
        let Some(note) = note else { continue };
        let root = works.get(&note.work);
        let exists = root.is_some_and(|root| {
            let path = root.join(&note.path);
            path.strip_prefix(root).is_ok() && !note.path.split('/').any(|part| part == "..") && path.is_file()
        });
        view.note = Some(NoteView {
            work: note.work.clone(),
            path: note.path.clone(),
            work_root: root.map(|root| root.to_string_lossy().to_string()),
            work_name: root.map(|root| folder_name(root)),
            exists,
        });
    }
}

/// 入力された名前を、ノートのファイル名の幹にする（末尾の `.md` は付けても付けなくてもよい）。
fn note_stem(note_name: &str) -> Result<String, String> {
    let trimmed = note_name.trim();
    let stem = if trimmed.to_lowercase().ends_with(".md") { &trimmed[..trimmed.len() - 3] } else { trimmed };
    let file_name = crate::normalize_text_file_name(&format!("{}.md", stem.trim()))?;
    let stem = file_name.strip_suffix(".md").unwrap_or(&file_name).trim().to_string();
    if stem.is_empty() || stem.starts_with('.') {
        return Err("note name cannot be used".to_string());
    }
    Ok(stem)
}

/// 素材フォルダ（なければ作って登録する）に、同じ名前を避けてノートを書く。
/// 返り値は、ノートと、今回作った素材フォルダの名前。
fn write_note(work_root: &Path, stem: &str, note_text: &str) -> Result<(PathBuf, Option<String>), String> {
    let _guard = lock_project_config()?;
    let mut config = load_project_config_unlocked(work_root)?;
    let (folder, created_folder) = note_folder(work_root, config.materials_folder_name())?;
    let undo_folder = |created: &Option<String>| {
        if let Some(name) = created {
            let _ = std::fs::remove_dir(work_root.join(name));
        }
    };
    let file_name = first_free_name(stem, ".md", |candidate| folder.join(candidate).exists());
    let note = folder.join(file_name);
    if let Err(error) = write_new_file(&note, note_text.as_bytes()) {
        undo_folder(&created_folder);
        return Err(error);
    }
    if let Some(name) = &created_folder {
        config.materials_folder = Some(name.clone());
        if let Err(error) = save_project_config_unlocked(work_root, &config) {
            let _ = std::fs::remove_file(&note);
            undo_folder(&created_folder);
            return Err(error);
        }
    }
    Ok((note, created_folder))
}

/// 投稿の行が書けなかったとき、`write_note` でしたことを戻す。
fn undo_write_note(work_root: &Path, note: &Path, created_folder: &Option<String>) {
    let _ = std::fs::remove_file(note);
    let Some(name) = created_folder else { return };
    let _ = std::fs::remove_dir(work_root.join(name));
    if let Ok(_guard) = lock_project_config() {
        if let Ok(mut config) = load_project_config_unlocked(work_root) {
            if config.materials_folder.as_deref() == Some(name.as_str()) {
                config.materials_folder = None;
                let _ = save_project_config_unlocked(work_root, &config);
            }
        }
    }
}

pub(super) fn make_note(scope: &Path, posts: &[PostHash], note_name: &str, note_text: &str) -> Result<MadeNote, String> {
    if posts.is_empty() {
        return Err("no posts".to_string());
    }
    if note_text.trim().is_empty() {
        return Err("note text is empty".to_string());
    }
    let stem = note_stem(note_name)?;
    let place = place_for(scope)?;
    // ライブラリ直下には素材の区分がないので作らない（確認1の 1）。
    let Some(work_root) = place.work_root.clone() else {
        return Err("no work is open".to_string());
    };
    let work = current_work(&work_root, true)?;
    let note = atomic_file::with_lock(&place.file, || -> Result<PathBuf, String> {
        let mut lines = read_lines(&place.file)?;
        let latest = latest_indexes(&lines);
        let mut targets = Vec::new();
        for item in posts {
            let Some((index, post)) = latest.iter().find(|(_, post)| post.id == item.id).cloned() else {
                return Err(format!("{CONFLICT}: 投稿が見つかりません"));
            };
            if line_hash(&lines[index]) != item.hash {
                return Err(format!("{CONFLICT}: 投稿が外部で変更されたためノートにしませんでした"));
            }
            if has_note(&post) {
                return Err(format!("{CONFLICT}: すでにノートにした投稿です"));
            }
            targets.push((index, post));
        }
        let (note, created_folder) = write_note(&work_root, &stem, note_text)?;
        let stored = StoredNote { work: work.id.clone(), path: relative_slash_path(&work_root, &note) };
        let value = serde_json::to_value(&stored).map_err(|error| error.to_string())?;
        for (index, mut post) in targets {
            post.extra.insert(NOTE_KEY.to_string(), value.clone());
            match serde_json::to_string(&post) {
                Ok(line) => lines[index] = line,
                Err(error) => {
                    undo_write_note(&work_root, &note, &created_folder);
                    return Err(error.to_string());
                }
            }
        }
        if let Err(error) = write_lines(&place.file, &lines) {
            undo_write_note(&work_root, &note, &created_folder);
            return Err(error);
        }
        Ok(note)
    })?;
    let note_hash = content_hash(note_text.as_bytes());
    Ok(MadeNote {
        snapshot: snapshot(&place, Some(work), 0)?,
        note_path: note.to_string_lossy().to_string(),
        note_hash,
    })
}

/// 「元に戻す」: 投稿からノートへのリンクを外す（受信箱に戻る）。リンク先が `note_path` の投稿だけ外す。
/// ノートは消さず、中身が作ったときのままかを返す（ままなら画面がゴミ箱へ移す）。
pub(super) fn unlink_note(scope: &Path, ids: &[String], note_path: &Path, note_hash: &str) -> Result<UnlinkedNote, String> {
    let place = place_for(scope)?;
    let Some(work_root) = place.work_root.clone() else {
        return Err("no work is open".to_string());
    };
    let relative = relative_slash_path(&work_root, note_path);
    atomic_file::with_lock(&place.file, || -> Result<(), String> {
        let mut lines = read_lines(&place.file)?;
        let mut changed = false;
        for (index, mut post) in latest_indexes(&lines) {
            if !ids.contains(&post.id) || stored_note(&post).map_or(true, |note| note.path != relative) {
                continue;
            }
            post.extra.remove(NOTE_KEY);
            lines[index] = serde_json::to_string(&post).map_err(|error| error.to_string())?;
            changed = true;
        }
        if changed {
            write_lines(&place.file, &lines)?;
        }
        Ok(())
    })?;
    let note_unchanged = std::fs::read(note_path).is_ok_and(|bytes| content_hash(&bytes) == note_hash);
    let work = current_work(&work_root, false)?;
    Ok(UnlinkedNote { snapshot: snapshot(&place, Some(work), 0)?, note_unchanged })
}

/// `old` が `path` そのものか、その親のフォルダなら、付け替えた先。大文字小文字は区別しない（Windows）。
fn retarget_relative(path: &str, old: &str, new: &str) -> Option<String> {
    let lower_path = path.to_lowercase();
    let lower_old = old.to_lowercase();
    if lower_path == lower_old {
        return Some(new.to_string());
    }
    let prefix = format!("{lower_old}/");
    lower_path.starts_with(&prefix).then(|| format!("{new}/{}", &path[prefix.len()..]))
}

/// Then の中でファイル・フォルダを改名・移動したとき、そこを指すノートのリンクを付け替える。
/// 本文を変えないので、投稿のハッシュは比べない（受信箱から外す・戻すと同じ）。何も変わらなければ書かない。
pub(super) fn retarget_notes(scope: &Path, changes: &[PathChange]) -> Result<Option<PostsSnapshot>, String> {
    let place = place_for(scope)?;
    let Some(work_root) = place.work_root.clone() else { return Ok(None) };
    let work = current_work(&work_root, false)?;
    if work.id.is_empty() || !place.file.is_file() {
        return Ok(None);
    }
    let relative_changes: Vec<(String, String)> = changes
        .iter()
        .filter_map(|change| {
            let old = Path::new(&change.old_path);
            let new = Path::new(&change.new_path);
            (old.strip_prefix(&work_root).is_ok() && new.strip_prefix(&work_root).is_ok())
                .then(|| (relative_slash_path(&work_root, old), relative_slash_path(&work_root, new)))
        })
        .collect();
    if relative_changes.is_empty() {
        return Ok(None);
    }
    let changed = atomic_file::with_lock(&place.file, || -> Result<bool, String> {
        let mut lines = read_lines(&place.file)?;
        let mut changed = false;
        for (index, mut post) in latest_indexes(&lines) {
            let Some(mut note) = stored_note(&post).filter(|note| note.work == work.id) else { continue };
            let mut moved = false;
            for (old, new) in &relative_changes {
                if let Some(next) = retarget_relative(&note.path, old, new) {
                    note.path = next;
                    moved = true;
                }
            }
            if !moved {
                continue;
            }
            post.extra.insert(NOTE_KEY.to_string(), serde_json::to_value(&note).map_err(|error| error.to_string())?);
            lines[index] = serde_json::to_string(&post).map_err(|error| error.to_string())?;
            changed = true;
        }
        if changed {
            write_lines(&place.file, &lines)?;
        }
        Ok(changed)
    })?;
    if !changed {
        return Ok(None);
    }
    Ok(Some(snapshot(&place, Some(work), 0)?))
}

#[tauri::command(async)]
pub(crate) fn posts_make_note(
    scope_path: String,
    posts: Vec<PostHash>,
    note_name: String,
    note_text: String,
) -> Result<MadeNote, String> {
    make_note(Path::new(&scope_path), &posts, &note_name, &note_text)
}

#[tauri::command(async)]
pub(crate) fn posts_unlink_note(
    scope_path: String,
    ids: Vec<String>,
    note_path: String,
    note_hash: String,
) -> Result<UnlinkedNote, String> {
    unlink_note(Path::new(&scope_path), &ids, Path::new(&note_path), &note_hash)
}

#[tauri::command(async)]
pub(crate) fn posts_retarget_notes(scope_path: String, changes: Vec<PathChange>) -> Result<Option<PostsSnapshot>, String> {
    retarget_notes(Path::new(&scope_path), &changes)
}

#[cfg(test)]
mod tests;
