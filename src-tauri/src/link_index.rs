//! リンク索引（BINDER 3-1、docs/BINDER_LINK_INDEX_PLAN.md）の、ディスクの側だけ。
//!
//! リンクを読む規則・行き先の決め方・書き換えは画面側（`src/links/`）の1か所にある。ここでは、
//! 作品のファイルの更新日時と大きさを中身を読まずに並べることと、索引を残すファイルの読み書きだけをする。
//! 索引のファイルはアプリのデータフォルダに置き（決めてほしいこと 5）、作品フォルダには何も足さない。

use super::{atomic_file, content_hash, library, material_files, project_state::load_project_config, MATERIAL_ROLE};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkStamp {
    pub path: String,
    /// "text"（txt・md）か "asset"（画像・PDF。`@[[…]]` の行き先になる）。
    pub kind: &'static str,
    pub modified_at: Option<i64>,
    pub size: u64,
    pub role: Option<String>,
}

/// ファイルの一覧（`list_project_folder`）と同じ範囲の txt・md と、画像・PDF の更新日時と大きさ。中身は読まない。
pub fn list_stamps(root: &Path) -> Result<Vec<LinkStamp>, String> {
    if !root.is_dir() {
        return Err("folder does not exist".to_string());
    }
    let config = load_project_config(root)?;
    let materials = config.materials_folder_name().map(str::to_string);
    let is_library = library::is_library_root(root);
    let mut stamps = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(folder) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == ".then" || name == ".brew" {
                continue;
            }
            let Ok(metadata) = entry.metadata() else { continue };
            if metadata.is_dir() {
                if is_library && library::is_project_root(&path) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            let kind = if super::is_supported_text_extension(&path) {
                "text"
            } else if material_files::is_material_file(&path) {
                "asset"
            } else {
                continue;
            };
            let role = materials.as_deref().and_then(|materials| {
                let first = path.strip_prefix(root).ok()?.components().next()?;
                first
                    .as_os_str()
                    .to_str()?
                    .eq_ignore_ascii_case(materials)
                    .then(|| MATERIAL_ROLE.to_string())
            });
            stamps.push(LinkStamp {
                path: path.to_string_lossy().to_string(),
                kind,
                modified_at: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis() as i64),
                size: metadata.len(),
                role,
            });
        }
    }
    stamps.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(stamps)
}

/// 作品ごとの索引のファイル。作品のパスの綴りの大小は区別しない（Windows）。
pub fn cache_path(cache_dir: &Path, root: &Path) -> PathBuf {
    let key = content_hash(root.to_string_lossy().to_lowercase().as_bytes());
    cache_dir.join(format!("{}.json", &key[..32.min(key.len())]))
}

pub fn read_cache(cache_dir: &Path, root: &Path) -> Option<String> {
    std::fs::read_to_string(cache_path(cache_dir, root)).ok()
}

pub fn write_cache(cache_dir: &Path, root: &Path, content: &str) -> Result<(), String> {
    std::fs::create_dir_all(cache_dir).map_err(|error| format!("failed to create link index folder: {error}"))?;
    atomic_file::write_replacing(&cache_path(cache_dir, root), content)
        .map_err(|error| format!("failed to write link index: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "then-link-index-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stamps_cover_text_and_assets_but_not_then_or_other_files() {
        let root = temp_dir("stamps");
        std::fs::create_dir_all(root.join(".then")).unwrap();
        std::fs::write(
            root.join(".then").join("project.json"),
            r#"{"version":1,"materialsFolder":"素材"}"#,
        )
        .unwrap();
        std::fs::write(root.join(".then").join("hidden.md"), "x").unwrap();
        std::fs::create_dir_all(root.join("第一章")).unwrap();
        std::fs::write(root.join("第一章").join("a.md"), "本文").unwrap();
        std::fs::create_dir_all(root.join("素材").join("資料")).unwrap();
        std::fs::write(root.join("素材").join("汐見.md"), "ノート").unwrap();
        std::fs::write(root.join("素材").join("資料").join("地図.png"), [0u8; 3]).unwrap();
        std::fs::write(root.join("memo.docx"), "x").unwrap();

        let stamps = list_stamps(&root).unwrap();
        let mut seen: Vec<(String, &str, Option<String>, u64)> = stamps
            .iter()
            .map(|stamp| {
                let relative = Path::new(&stamp.path)
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                (relative, stamp.kind, stamp.role.clone(), stamp.size)
            })
            .collect();
        seen.sort();
        assert_eq!(
            seen,
            vec![
                ("第一章/a.md".to_string(), "text", None, "本文".len() as u64),
                ("素材/汐見.md".to_string(), "text", Some("material".to_string()), "ノート".len() as u64),
                ("素材/資料/地図.png".to_string(), "asset", Some("material".to_string()), 3),
            ]
        );
        assert!(stamps.iter().all(|stamp| stamp.modified_at.is_some()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cache_round_trips_per_work_and_ignores_case() {
        let cache = temp_dir("cache");
        let root = PathBuf::from(r"C:\Books\作品A");
        assert_eq!(read_cache(&cache, &root), None);
        write_cache(&cache, &root, "{\"version\":1}").unwrap();
        assert_eq!(read_cache(&cache, &PathBuf::from(r"c:\books\作品A")).as_deref(), Some("{\"version\":1}"));
        assert_eq!(read_cache(&cache, &PathBuf::from(r"C:\Books\作品B")), None);
        std::fs::remove_dir_all(cache).unwrap();
    }
}
