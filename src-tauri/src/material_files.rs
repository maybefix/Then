//! 素材の段の画像・PDF の改名・移動と、ボードの資料カードの付け替え（BINDER 2-6、docs/BINDER_MATERIAL_FILES_PLAN.md）。
//!
//! 画像・PDF はファイルの一覧（`list_project_folder`、txt・md だけ）に入れない。改名・移動は素材フォルダの中だけで、
//! 中身は読まず、並び順（`order`）も持たせない。改名・移動のあと、`.then/boards/*.canvas` の資料カードのパスを付け替える。

use super::{
    atomic_file, library,
    project_state::{load_project_config, project_config_path, trusted_project_relative_path, ProjectConfig},
    reference_kind_for_path,
};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[cfg(test)]
thread_local! {
    static FAIL_BOARDS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// テストで、ボードを1つ書いたあとに失敗させる。
#[cfg(test)]
pub(super) fn fail_after_first_board(value: bool) {
    FAIL_BOARDS.with(|cell| cell.set(value));
}

fn should_fail_after_board() -> bool {
    #[cfg(test)]
    {
        FAIL_BOARDS.with(|cell| cell.get())
    }
    #[cfg(not(test))]
    {
        false
    }
}

/// 素材の段に並べる、文字でない資料（画像・PDF）か。
pub(super) fn is_material_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "pdf")
    )
}

/// 作品の素材フォルダ（実際の綴りに直したもの）。ライブラリ直下と、素材フォルダのない作品は None。
/// project.json の錠を持っているとき（移動）は、錠を取らずに読んだ設定を渡す。
pub(super) fn materials_folder(root: &Path, config: &ProjectConfig) -> Option<PathBuf> {
    if library::is_library_root(root) {
        return None;
    }
    let folder = root.join(config.materials_folder_name()?);
    folder.canonicalize().ok().filter(|path| path.is_dir())
}

/// `path` が素材フォルダ `materials`（materials_folder の結果）そのものか、その中か。
pub(super) fn is_in(materials: Option<&Path>, path: &Path) -> bool {
    let Some(materials) = materials else { return false };
    path.canonicalize().is_ok_and(|path| path.starts_with(materials))
}

/// 錠を持っていないときに、`path` が作品の素材フォルダの中かを見る（改名）。
pub(super) fn is_in_materials(root: &Path, path: &Path) -> bool {
    let Ok(config) = load_project_config(root) else { return false };
    is_in(materials_folder(root, &config).as_deref(), path)
}

/// 画像・PDF の新しい名前。元の拡張子で終わらなければ、元の拡張子を足す（確認1の 2: 拡張子は変えない）。
pub(super) fn material_file_name(name: &str, original: &Path) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("file name is required".to_string());
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("file name contains invalid characters".to_string());
    }
    let extension = original
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "file extension is not valid".to_string())?;
    let suffix = format!(".{}", extension.to_lowercase());
    if trimmed.to_lowercase().ends_with(&suffix) && trimmed.len() > suffix.len() {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}.{extension}"))
    }
}

/// フォルダの中（深さを問わず）に画像・PDF があるか。`.then` は見ない。
pub(super) fn folder_has_material_files(folder: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(folder) else { return false };
    entries.flatten().any(|entry| {
        let path = entry.path();
        if path.is_dir() {
            entry.file_name() != ".then" && folder_has_material_files(&path)
        } else {
            is_material_file(&path)
        }
    })
}

/// 改名・移動の前に、元と先の作品からの相対パス（`/` 区切り）を出す。どちらも動かす前に呼ぶ（先の親フォルダはある）。
/// 作品の外などで出せなければ None（ボードは付け替えない）。
pub(super) fn relative_paths(root: &Path, old: &Path, new: &Path) -> Option<(String, String)> {
    let root = root.canonicalize().ok()?;
    let old = old.canonicalize().ok()?;
    let new = new.parent()?.canonicalize().ok()?.join(new.file_name()?);
    Some((
        trusted_project_relative_path(&root, &old).ok()?,
        trusted_project_relative_path(&root, &new).ok()?,
    ))
}

/// ボードの付け替えに失敗したとき、`project.json` を改名・移動の前の中身に戻すための写し。
pub(super) struct ConfigSnapshot(PathBuf, Option<Vec<u8>>);

impl ConfigSnapshot {
    pub(super) fn take(root: &Path) -> Self {
        let path = project_config_path(root);
        let bytes = std::fs::read(&path).ok();
        Self(path, bytes)
    }

    pub(super) fn restore(self) {
        if let Some(bytes) = self.1 {
            let _ = atomic_file::write_replacing(&self.0, bytes);
        }
    }
}

/// 書き換えたボードの元の中身。失敗したら戻す。
#[derive(Default)]
pub(super) struct BoardUndo(Vec<(PathBuf, Vec<u8>)>);

impl BoardUndo {
    pub(super) fn restore(self) {
        for (path, bytes) in self.0.into_iter().rev() {
            let _ = atomic_file::write_replacing(&path, bytes);
        }
    }
}

/// `source_path` が `old` そのものかその中なら、`new` に付け替えたパス。
fn retarget(source_path: &str, old: &str, new: &str) -> Option<String> {
    let source_path = source_path.replace('\\', "/");
    if source_path == old {
        return Some(new.to_string());
    }
    source_path
        .strip_prefix(&format!("{old}/"))
        .map(|rest| format!("{new}/{rest}"))
}

/// ボードの資料カードのパス・名前・種類を付け替える。変わったら true。
fn retarget_board(board: &mut Value, old: &str, new: &str) -> bool {
    let Some(nodes) = board.get_mut("nodes").and_then(Value::as_array_mut) else { return false };
    let mut changed = false;
    for node in nodes.iter_mut() {
        if node.get("type").and_then(Value::as_str) != Some("reference")
            || node.get("scope").and_then(Value::as_str).is_some_and(|scope| scope != "project")
        {
            continue;
        }
        let Some(next) = node.get("sourcePath").and_then(Value::as_str).and_then(|path| retarget(path, old, new)) else {
            continue;
        };
        let name = next.rsplit('/').next().unwrap_or(&next).to_string();
        node["kind"] = Value::String(reference_kind_for_path(Path::new(&next)));
        node["name"] = Value::String(name);
        node["sourcePath"] = Value::String(next);
        changed = true;
    }
    changed
}

/// 作品の `.then/boards/*.canvas` の資料カードを `old` → `new`（作品からの相対パス、`/` 区切り）に付け替える。
/// 変わるボードだけ書く。途中で失敗したら、書いたボードを戻して失敗にする。
pub(super) fn retarget_boards(root: &Path, old: &str, new: &str) -> Result<BoardUndo, String> {
    let mut undo = BoardUndo::default();
    if old.is_empty() || new.is_empty() || old == new {
        return Ok(undo);
    }
    let folder = root.join(".then").join("boards");
    let Ok(entries) = std::fs::read_dir(&folder) else { return Ok(undo) };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("canvas"))
        .collect();
    files.sort();
    for file in files {
        let result = (|| {
            let before = std::fs::read(&file).map_err(|error| format!("failed to read board: {error}"))?;
            // 読めないボードは触らない（Canvas の読み込みと同じく、壊れたものは書き換えない）。
            let Ok(mut board) = serde_json::from_slice::<Value>(&before) else { return Ok(None) };
            if !retarget_board(&mut board, old, new) {
                return Ok(None);
            }
            if should_fail_after_board() && !undo.0.is_empty() {
                return Err("injected board failure".to_string());
            }
            let text = serde_json::to_string_pretty(&board).map_err(|error| error.to_string())?;
            atomic_file::write_replacing(&file, text).map_err(|error| format!("failed to write board: {error}"))?;
            Ok(Some(before))
        })();
        match result {
            Ok(Some(before)) => undo.0.push((file, before)),
            Ok(None) => {}
            Err(error) => {
                undo.restore();
                return Err(error);
            }
        }
    }
    Ok(undo)
}

#[cfg(test)]
mod tests;
