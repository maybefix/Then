//! 書き出しの前付け（表紙・目次）に使う作品ごとの値と表紙画像。
//!
//! 文字列は `.then/project.json` の `exportFrontMatter` に、表紙画像は
//! `.then/export/cover.<ext>` に置く。Vivliostyle は組版文書を data URL で
//! 受け取るため、画像は埋め込まずに `then-cover` スキームで配信する。

use super::project_state::{load_project_config, update_project_config, ExportFrontMatterConfig};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

pub(super) const COVER_SCHEME: &str = "then-cover";
const COVER_STEM: &str = "cover";
const MAX_COVER_BYTES: u64 = 30 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CoverImagePayload {
    path: String,
    mime: &'static str,
    data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExportFrontMatterState {
    title: String,
    subtitle: String,
    author: String,
    cover_image: Option<CoverImagePayload>,
    layout: Option<serde_json::Value>,
}

fn cover_dir(root: &Path) -> PathBuf {
    root.join(".then").join("export")
}

fn cover_mime(name: &str) -> Option<&'static str> {
    let extension = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        _ => None,
    }
}

pub(super) fn is_cover_file_name(name: &str) -> bool {
    let path = Path::new(name);
    path.file_stem().and_then(|stem| stem.to_str()) == Some(COVER_STEM)
        && path.file_name().and_then(|file| file.to_str()) == Some(name)
        && cover_mime(name).is_some()
}

fn project_root(project_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_path);
    if !root.is_dir() {
        return Err("作品フォルダが見つかりません".to_string());
    }
    Ok(root)
}

fn read_cover_file(path: &Path) -> Result<(&'static str, Vec<u8>), String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "表紙画像のファイル名が不正です".to_string())?;
    let mime = cover_mime(name).ok_or_else(|| "表紙画像はPNGかJPEGを選んでください".to_string())?;
    let size = std::fs::metadata(path)
        .map_err(|error| format!("表紙画像を読み込めませんでした: {error}"))?
        .len();
    if size > MAX_COVER_BYTES {
        return Err("表紙画像が大きすぎます（30MBまで）".to_string());
    }
    let bytes =
        std::fs::read(path).map_err(|error| format!("表紙画像を読み込めませんでした: {error}"))?;
    Ok((mime, bytes))
}

fn cover_payload(path: &Path) -> Result<CoverImagePayload, String> {
    use base64::Engine;
    let (mime, bytes) = read_cover_file(path)?;
    Ok(CoverImagePayload {
        path: path.to_string_lossy().to_string(),
        mime,
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

fn remove_cover_files(root: &Path) -> Result<(), String> {
    let dir = cover_dir(root);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_str().is_some_and(is_cover_file_name) {
            std::fs::remove_file(entry.path())
                .map_err(|error| format!("以前の表紙画像を削除できませんでした: {error}"))?;
        }
    }
    Ok(())
}

fn is_empty(config: &ExportFrontMatterConfig) -> bool {
    config.title.is_empty()
        && config.subtitle.is_empty()
        && config.author.is_empty()
        && config.cover_image.is_none()
        && config.layout.is_none()
}

#[tauri::command]
pub(super) fn load_export_front_matter(project_path: String) -> Result<ExportFrontMatterState, String> {
    let root = project_root(&project_path)?;
    let config = load_project_config(&root)?
        .export_front_matter
        .unwrap_or_default();
    // 画像が消えていても文字列は使えるようにする。
    let cover_image = config
        .cover_image
        .as_deref()
        .map(|name| cover_dir(&root).join(name))
        .filter(|path| path.is_file())
        .map(|path| cover_payload(&path))
        .transpose()
        .unwrap_or(None);
    Ok(ExportFrontMatterState {
        title: config.title,
        subtitle: config.subtitle,
        author: config.author,
        cover_image,
        layout: config.layout,
    })
}

#[tauri::command]
pub(super) fn save_export_front_matter_layout(
    project_path: String,
    layout: serde_json::Value,
) -> Result<(), String> {
    if !layout.is_object() {
        return Err("表紙・目次の設定が不正です".to_string());
    }
    let root = project_root(&project_path)?;
    update_project_config(&root, |config| {
        config
            .export_front_matter
            .get_or_insert_with(Default::default)
            .layout = Some(layout);
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub(super) fn save_export_front_matter(
    project_path: String,
    title: String,
    subtitle: String,
    author: String,
) -> Result<(), String> {
    let root = project_root(&project_path)?;
    update_project_config(&root, |config| {
        let mut front_matter = config.export_front_matter.take().unwrap_or_default();
        front_matter.title = title.trim().to_string();
        front_matter.subtitle = subtitle.trim().to_string();
        front_matter.author = author.trim().to_string();
        config.export_front_matter = (!is_empty(&front_matter)).then_some(front_matter);
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub(super) fn pick_export_cover_image(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<Option<CoverImagePayload>, String> {
    let root = project_root(&project_path)?;
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("表紙画像", &["png", "jpg", "jpeg"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source = selected
        .into_path()
        .map_err(|error| format!("選択した画像を開けませんでした: {error}"))?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let name = format!("{COVER_STEM}.{}", if extension == "png" { "png" } else { "jpg" });
    if cover_mime(&name).is_none() || cover_mime(&source.to_string_lossy()).is_none() {
        return Err("表紙画像はPNGかJPEGを選んでください".to_string());
    }
    // 読めるか・大きすぎないかを先に確かめてから差し替える。
    read_cover_file(&source)?;
    let dir = cover_dir(&root);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("表紙画像の保存先を作成できませんでした: {error}"))?;
    remove_cover_files(&root)?;
    let destination = dir.join(&name);
    std::fs::copy(&source, &destination)
        .map_err(|error| format!("表紙画像を保存できませんでした: {error}"))?;
    update_project_config(&root, |config| {
        config
            .export_front_matter
            .get_or_insert_with(Default::default)
            .cover_image = Some(name.clone());
        Ok(())
    })?;
    cover_payload(&destination).map(Some)
}

#[tauri::command]
pub(super) fn clear_export_cover_image(project_path: String) -> Result<(), String> {
    let root = project_root(&project_path)?;
    remove_cover_files(&root)?;
    update_project_config(&root, |config| {
        if let Some(front_matter) = config.export_front_matter.as_mut() {
            front_matter.cover_image = None;
            if is_empty(front_matter) {
                config.export_front_matter = None;
            }
        }
        Ok(())
    })?;
    Ok(())
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// Only `<project>/.then/export/cover.<png|jpg|jpeg>` is ever served.
fn cover_request_path(uri_path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(percent_decode(uri_path.trim_start_matches('/'))?);
    let name = path.file_name()?.to_str()?;
    let export_dir = path.parent()?;
    let then_dir = export_dir.parent()?;
    (is_cover_file_name(name)
        && export_dir.file_name()?.to_str()? == "export"
        && then_dir.file_name()?.to_str()? == ".then")
        .then_some(path)
}

pub(super) fn serve_cover(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let builder = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    let served = cover_request_path(request.uri().path())
        .ok_or_else(|| "not a cover image".to_string())
        .and_then(|path| read_cover_file(&path));
    match served {
        Ok((mime, bytes)) => builder
            .header(tauri::http::header::CONTENT_TYPE, mime)
            .body(bytes),
        Err(_) => builder.status(404).body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cover_file_names_are_restricted() {
        assert!(is_cover_file_name("cover.png"));
        assert!(is_cover_file_name("cover.jpg"));
        assert!(is_cover_file_name("cover.JPEG"));
        assert!(!is_cover_file_name("cover.webp"));
        assert!(!is_cover_file_name("other.png"));
        assert!(!is_cover_file_name("../cover.png"));
        assert!(!is_cover_file_name("x/cover.png"));
    }

    #[test]
    fn scheme_serves_only_project_cover_paths() {
        let encoded = "/C%3A%5Cwork%5Cnovel%5C.then%5Cexport%5Ccover.png";
        let decoded = cover_request_path(encoded);
        if cfg!(windows) {
            assert_eq!(decoded, Some(PathBuf::from(r"C:\work\novel\.then\export\cover.png")));
        }
        assert!(cover_request_path("/%2Fetc%2Fpasswd").is_none());
        assert!(cover_request_path("/C%3A%5Cwork%5Cnovel%5Ccover.png").is_none());
        assert!(cover_request_path("/C%3A%5Cwork%5C.then%5Cexport%5Csecret.png").is_none());
        assert!(cover_request_path("/bad%zz").is_none());
    }

    /// Mirrors `convertFileSrc(path, "then-cover")` (encodeURIComponent).
    fn encode_uri_component(value: &str) -> String {
        value
            .bytes()
            .map(|byte| match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                    (byte as char).to_string()
                }
                _ => format!("%{byte:02X}"),
            })
            .collect()
    }

    #[test]
    fn scheme_serves_cover_from_non_ascii_project_path() {
        let root = std::env::temp_dir().join(format!("then-表紙テスト_{}", std::process::id()));
        let dir = root.join(".then").join("export");
        std::fs::create_dir_all(&dir).unwrap();
        let cover = dir.join("cover.png");
        std::fs::write(&cover, b"\x89PNG-test").unwrap();
        let uri = format!(
            "http://then-cover.localhost/{}?v=1",
            encode_uri_component(&cover.to_string_lossy())
        );
        let request = tauri::http::Request::builder().uri(uri).body(Vec::new()).unwrap();
        let response = serve_cover(&request);
        assert_eq!(response.status(), 200);
        assert_eq!(response.body().as_slice(), b"\x89PNG-test");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn front_matter_round_trips_through_project_config() {
        let root = std::env::temp_dir().join(format!("then-front-matter-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.to_string_lossy().to_string();
        save_export_front_matter(path.clone(), " 題 ".into(), "副題".into(), "著者".into()).unwrap();
        let loaded = load_export_front_matter(path.clone()).unwrap();
        assert_eq!((loaded.title.as_str(), loaded.subtitle.as_str(), loaded.author.as_str()), ("題", "副題", "著者"));
        assert!(loaded.cover_image.is_none());
        save_export_front_matter(path.clone(), String::new(), String::new(), String::new()).unwrap();
        let config = load_project_config(&root).unwrap();
        assert!(config.export_front_matter.is_none());
        let layout = serde_json::json!({ "cover": { "enabled": true }, "toc": { "enabled": false } });
        save_export_front_matter_layout(path.clone(), layout.clone()).unwrap();
        assert_eq!(load_export_front_matter(path.clone()).unwrap().layout, Some(layout));
        assert!(save_export_front_matter_layout(path.clone(), serde_json::json!(1)).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
