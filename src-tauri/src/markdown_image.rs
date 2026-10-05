//! 本文の画像記法 `![](path)` が指すローカル画像を配信する `then-image` スキーム。
//!
//! Vivliostyle の組版文書は data URL なので相対パスを解決できず、エディタも
//! ファイルを直接は読めない。そこで画面側が絶対パスを
//! `convertFileSrc(path, "then-image")` で URL にし、ここで読み出して返す。
//! 配信するのは作品フォルダ（祖先に `.then` フォルダを持つ場所）の中にある
//! 画像ファイルだけで、それ以外のパスは 404 にする。Web の画像はこのスキームを
//! 通らない（URL のまま WebView が読み込む）。

use std::path::{Path, PathBuf};

pub(super) const IMAGE_SCHEME: &str = "then-image";
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

fn image_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
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

/// 祖先のどこかに `.then` フォルダがある＝作品フォルダの中。
fn is_inside_project(path: &Path) -> bool {
    path.ancestors()
        .skip(1)
        .any(|dir| dir.join(".then").is_dir())
}

/// URI のパス部分から、配信してよい画像ファイルの実パスを返す。
fn image_request_path(uri_path: &str) -> Option<PathBuf> {
    let requested = PathBuf::from(percent_decode(uri_path.trim_start_matches('/'))?);
    if !requested.is_absolute() {
        return None;
    }
    // `..` やシンボリックリンクを解決してから判定する。
    let resolved = requested.canonicalize().ok()?;
    (resolved.is_file() && image_mime(&resolved).is_some() && is_inside_project(&resolved))
        .then_some(resolved)
}

fn read_image(path: &Path) -> Result<(&'static str, Vec<u8>), String> {
    let mime = image_mime(path).ok_or_else(|| "画像ではありません".to_string())?;
    let size = std::fs::metadata(path).map_err(|error| error.to_string())?.len();
    if size > MAX_IMAGE_BYTES {
        return Err("画像が大きすぎます".to_string());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    Ok((mime, bytes))
}

pub(super) fn serve_image(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let builder = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    let served = image_request_path(request.uri().path())
        .ok_or_else(|| "not a project image".to_string())
        .and_then(|path| read_image(&path));
    match served {
        Ok((mime, bytes)) => builder
            .header(tauri::http::header::CONTENT_TYPE, mime)
            // 画像を差し替えたら次の読み込みで反映されるようにする。
            .header(tauri::http::header::CACHE_CONTROL, "no-cache")
            .body(bytes),
        Err(_) => builder.status(404).body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors `convertFileSrc(path, "then-image")` (encodeURIComponent).
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

    fn request(path: &Path) -> tauri::http::Request<Vec<u8>> {
        let uri = format!(
            "http://then-image.localhost/{}",
            encode_uri_component(&path.to_string_lossy())
        );
        tauri::http::Request::builder().uri(uri).body(Vec::new()).unwrap()
    }

    #[test]
    fn serves_only_images_inside_a_project() {
        let base = std::env::temp_dir().join(format!("then-画像テスト_{}", std::process::id()));
        let project = base.join("作品");
        std::fs::create_dir_all(project.join(".then")).unwrap();
        std::fs::create_dir_all(project.join("本文").join("img")).unwrap();
        let image = project.join("本文").join("img").join("挿絵.png");
        std::fs::write(&image, b"\x89PNG-test").unwrap();
        let text = project.join("本文").join("secret.txt");
        std::fs::write(&text, b"secret").unwrap();
        let outside = base.join("outside.png");
        std::fs::write(&outside, b"\x89PNG-out").unwrap();

        let response = serve_image(&request(&image));
        assert_eq!(response.status(), 200);
        assert_eq!(response.body().as_slice(), b"\x89PNG-test");

        // `..` を含むパスも、解決後の場所で判定する。
        let dotted = project.join("本文").join("..").join("本文").join("img").join("挿絵.png");
        assert_eq!(serve_image(&request(&dotted)).status(), 200);

        assert_eq!(serve_image(&request(&text)).status(), 404);
        assert_eq!(serve_image(&request(&outside)).status(), 404);
        let escaped = project.join("..").join("outside.png");
        assert_eq!(serve_image(&request(&escaped)).status(), 404);
        assert_eq!(serve_image(&request(&project.join("missing.png"))).status(), 404);
        assert!(image_request_path("/relative%2Fimg.png").is_none());
        assert!(image_request_path("/bad%zz").is_none());

        let _ = std::fs::remove_dir_all(&base);
    }
}
