//! 投稿（BINDER 2-1、docs/BINDER_POST_STREAM_PLAN.md）。
//!
//! 投稿は `.then/posts.jsonl` に1行1件の JSON（JSON Lines）で持つ。ライブラリの中ではライブラリの `.then/` に
//! 1本、ライブラリの外の作品ではその作品の `.then/` に持つ。
//!
//! 画面は「この投稿をこう変える」という1件ごとの操作を送り、ここでファイルの書き込みの鍵を取ったまま
//! いまのファイルを読んで当てる。新しい投稿は末尾に1行足すだけ。直す・外す・消すは、その投稿の行だけを
//! 差し替え、ほかの行は1文字も変えずに置き換える。読めない行や知らない版の行は、表示しないが残す。
//! 本文を直す・消すときは、画面が見ていたその行のハッシュを比べ、外で直されていれば書かない。

use super::atomic_file;
use super::library;
use super::now_millis;
use super::project_state::{project_config_path, update_project_config};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// 外で直された・消された投稿を書き換えようとしたときの、エラーの先頭の印。
pub(super) const CONFLICT: &str = "POST_CONFLICT";
const FILE_NAME: &str = "posts.jsonl";
const VERSION: u64 = 1;

fn is_false(value: &bool) -> bool {
    !*value
}

/// ファイルの1行に書く形。欄の順はファイルを開いて読みやすい順にし、知らない欄は `extra` に残す。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostLine {
    v: u64,
    id: String,
    at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    work: Option<StoredWork>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
    body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    edited: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    filed: bool,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredWork {
    id: String,
    name: String,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

/// 画面へ渡す投稿1件。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PostView {
    id: String,
    at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    work: Option<WorkRef>,
    body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    edited: Option<String>,
    filed: bool,
    /// 「ノートにする」（2-3）で作ったノートがあるか。受信箱から外れる。
    noted: bool,
    /// この行のハッシュ。本文を直す・消すときに返してもらう。
    hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct WorkRef {
    /// まだ ID のない作品（`.then/project.json` のないフォルダ）では空。最初の投稿で付ける。
    id: String,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PostsSnapshot {
    posts: Vec<PostView>,
    /// いま開いている作品。ライブラリ直下を開いているときはない。
    #[serde(skip_serializing_if = "Option::is_none")]
    work: Option<WorkRef>,
    /// ファイルの大きさと更新日時。前回と同じなら読み直さなくてよい。
    signature: String,
    /// 今回、作品の `.then/posts.jsonl` からライブラリへ移した件数。
    imported: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeletedPost {
    snapshot: PostsSnapshot,
    /// 元に戻すときに返してもらう、消した行とその位置。
    line: String,
    index: usize,
}

/// 投稿のファイルの場所と、いま開いている作品。
struct Place {
    file: PathBuf,
    /// 作品のフォルダ（ライブラリ直下ではない）。
    work_root: Option<PathBuf>,
    /// ライブラリの中の作品が、ライブラリに入る前に持っていた投稿のファイル。
    own_file: Option<PathBuf>,
}

fn posts_file(root: &Path) -> PathBuf {
    root.join(".then").join(FILE_NAME)
}

fn place_for(scope: &Path) -> Result<Place, String> {
    if !scope.is_dir() {
        return Err("folder does not exist".to_string());
    }
    if library::is_library_root(scope) {
        return Ok(Place { file: posts_file(scope), work_root: None, own_file: None });
    }
    if let Some(library_root) = library::library_of_scope(scope) {
        return Ok(Place {
            file: posts_file(&library_root),
            work_root: Some(scope.to_path_buf()),
            own_file: Some(posts_file(scope)),
        });
    }
    Ok(Place { file: posts_file(scope), work_root: Some(scope.to_path_buf()), own_file: None })
}

fn folder_name(path: &Path) -> String {
    path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_string()
}

fn salt(seed: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let digest = Sha256::digest(format!("{seed}|{nanos}|{}|{count}", std::process::id()));
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn new_post_id() -> String {
    format!("p-{}-{}", base36(now_millis().max(0) as u64), &salt("post")[..6])
}

/// 作品の ID。`create` が偽なら、`.then/project.json` がない作品に ID を付けない（読むだけで作品を書き換えない）。
fn current_work(work_root: &Path, create: bool) -> Result<WorkRef, String> {
    let name = folder_name(work_root);
    if !create && !project_config_path(work_root).is_file() {
        return Ok(WorkRef { id: String::new(), name });
    }
    let config = update_project_config(work_root, |config| {
        if config.work_id.as_deref().map_or(true, |id| id.trim().is_empty()) {
            config.work_id = Some(format!("w-{}", &salt(&work_root.to_string_lossy())[..16]));
        }
        Ok(())
    })?;
    Ok(WorkRef { id: config.work_id.unwrap_or_default(), name })
}

fn line_hash(line: &str) -> String {
    format!("{:x}", Sha256::digest(line.trim_end_matches('\r').as_bytes()))
}

fn parse(line: &str) -> Option<PostLine> {
    let text = line.trim_end_matches('\r').trim();
    if text.is_empty() {
        return None;
    }
    let post: PostLine = serde_json::from_str(text).ok()?;
    (post.v == VERSION && !post.id.is_empty()).then_some(post)
}

fn view(post: &PostLine, line: &str) -> PostView {
    PostView {
        id: post.id.clone(),
        at: post.at.clone(),
        work: post.work.as_ref().map(|work| WorkRef { id: work.id.clone(), name: work.name.clone() }),
        body: post.body.clone(),
        reply_to: post.reply_to.clone(),
        edited: post.edited.clone(),
        filed: post.filed,
        noted: post.extra.get("note").is_some_and(|note| !note.is_null()),
        hash: line_hash(line),
    }
}

/// ファイルを `\n` で分けた行。最後の要素は、末尾が改行で終わっていれば空。ないファイルは行なし。
fn read_lines(file: &Path) -> Result<Vec<String>, String> {
    match std::fs::read(file) {
        Ok(bytes) => {
            let text = String::from_utf8(bytes).map_err(|_| "posts file is not UTF-8".to_string())?;
            if text.is_empty() {
                return Ok(Vec::new());
            }
            Ok(text.split('\n').map(str::to_string).collect())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("failed to read posts: {error}")),
    }
}

fn write_lines(file: &Path, lines: &[String]) -> Result<(), String> {
    atomic_file::replace_while_locked(file, lines.join("\n"))
        .map_err(|error| format!("failed to write posts: {error}"))
}

/// 同じ ID の行が2つあれば後ろを使う（同期ツールの重ね書きなど）。並びは、使う行のファイルの順。
fn latest_indexes(lines: &[String]) -> Vec<(usize, PostLine)> {
    let mut latest: Vec<(usize, PostLine)> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let Some(post) = parse(line) else { continue };
        latest.retain(|(_, existing)| existing.id != post.id);
        latest.push((index, post));
    }
    latest.sort_by_key(|(index, _)| *index);
    latest
}

fn find_latest(lines: &[String], id: &str) -> Option<(usize, PostLine)> {
    latest_indexes(lines).into_iter().find(|(_, post)| post.id == id)
}

fn signature(file: &Path) -> String {
    match std::fs::metadata(file) {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or(0);
            format!("{}-{modified}", meta.len())
        }
        Err(_) => String::new(),
    }
}

fn snapshot(place: &Place, work: Option<WorkRef>, imported: usize) -> Result<PostsSnapshot, String> {
    let lines = read_lines(&place.file)?;
    let posts = latest_indexes(&lines).into_iter().map(|(index, post)| view(&post, &lines[index])).collect();
    Ok(PostsSnapshot { posts, work, signature: signature(&place.file), imported })
}

fn append_lines(file: &Path, new_lines: &[String]) -> Result<(), String> {
    if new_lines.is_empty() {
        return Ok(());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("failed to create .then: {error}"))?;
    }
    let ends_open = match std::fs::read(file) {
        Ok(bytes) => !bytes.is_empty() && !bytes.ends_with(b"\n"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("failed to read posts: {error}")),
    };
    let mut text = String::new();
    if ends_open {
        text.push('\n');
    }
    for line in new_lines {
        text.push_str(line);
        text.push('\n');
    }
    let mut handle = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .map_err(|error| format!("failed to open posts: {error}"))?;
    handle.write_all(text.as_bytes()).map_err(|error| format!("failed to append post: {error}"))?;
    handle.sync_all().map_err(|error| format!("failed to append post: {error}"))
}

/// ライブラリに入る前に作品の `.then/` に書いた投稿を、ライブラリのファイルへ足す（同じ ID は足さない）。
/// 作品の側のファイルは `posts.imported-<日時>.jsonl` に名前を変えて残す。
fn import_own_file(place: &Place) -> Result<usize, String> {
    let Some(own) = place.own_file.as_ref().filter(|own| own.is_file()) else { return Ok(0) };
    let own_lines = read_lines(own)?;
    let count = atomic_file::with_lock(&place.file, || -> Result<usize, String> {
        let lines = read_lines(&place.file)?;
        let mut known: Vec<String> = latest_indexes(&lines).into_iter().map(|(_, post)| post.id).collect();
        let mut added = Vec::new();
        for line in &own_lines {
            let Some(post) = parse(line) else { continue };
            if known.contains(&post.id) {
                continue;
            }
            known.push(post.id.clone());
            added.push(line.trim_end_matches('\r').to_string());
        }
        append_lines(&place.file, &added)?;
        Ok(added.len())
    })?;
    let kept = own.with_file_name(format!("posts.imported-{}.jsonl", now_millis()));
    std::fs::rename(own, &kept).map_err(|error| format!("failed to keep imported posts: {error}"))?;
    Ok(count)
}

pub(super) fn load(scope: &Path) -> Result<PostsSnapshot, String> {
    let place = place_for(scope)?;
    let imported = import_own_file(&place)?;
    let work = place.work_root.as_deref().map(|root| current_work(root, false)).transpose()?;
    snapshot(&place, work, imported)
}

pub(super) fn add(scope: &Path, at: &str, body: &str, reply_to: Option<&str>) -> Result<PostsSnapshot, String> {
    if body.trim().is_empty() {
        return Err("post is empty".to_string());
    }
    let place = place_for(scope)?;
    let work = place.work_root.as_deref().map(|root| current_work(root, true)).transpose()?;
    let post = PostLine {
        v: VERSION,
        id: new_post_id(),
        at: at.to_string(),
        work: work.as_ref().map(|work| StoredWork { id: work.id.clone(), name: work.name.clone(), extra: Map::new() }),
        reply_to: reply_to.filter(|id| !id.is_empty()).map(str::to_string),
        body: body.to_string(),
        edited: None,
        filed: false,
        extra: Map::new(),
    };
    let line = serde_json::to_string(&post).map_err(|error| error.to_string())?;
    atomic_file::with_lock(&place.file, || append_lines(&place.file, &[line]))?;
    snapshot(&place, work, 0)
}

/// 本文を直す（`body`）か、受信箱から外す・戻す（`filed`）。本文を直すときだけハッシュを比べる
/// （外す・戻すは文を消さないので、外で直されていてもそのまま当てる）。
pub(super) fn update(
    scope: &Path,
    id: &str,
    expected_hash: Option<&str>,
    body: Option<&str>,
    edited_at: Option<&str>,
    filed: Option<bool>,
) -> Result<PostsSnapshot, String> {
    let place = place_for(scope)?;
    atomic_file::with_lock(&place.file, || -> Result<(), String> {
        let mut lines = read_lines(&place.file)?;
        let Some((index, mut post)) = find_latest(&lines, id) else {
            return Err(format!("{CONFLICT}: 投稿が見つかりません"));
        };
        if let Some(body) = body {
            if expected_hash.map_or(true, |hash| hash != line_hash(&lines[index])) {
                return Err(format!("{CONFLICT}: 投稿が外部で変更されたため保存しませんでした"));
            }
            if body.trim().is_empty() {
                return Err("post is empty".to_string());
            }
            post.body = body.to_string();
            post.edited = edited_at.map(str::to_string);
        }
        if let Some(filed) = filed {
            post.filed = filed;
        }
        lines[index] = serde_json::to_string(&post).map_err(|error| error.to_string())?;
        write_lines(&place.file, &lines)
    })?;
    let work = place.work_root.as_deref().map(|root| current_work(root, false)).transpose()?;
    snapshot(&place, work, 0)
}

pub(super) fn delete(scope: &Path, id: &str, expected_hash: &str) -> Result<DeletedPost, String> {
    let place = place_for(scope)?;
    let (line, index) = atomic_file::with_lock(&place.file, || -> Result<(String, usize), String> {
        let mut lines = read_lines(&place.file)?;
        let Some((index, _)) = find_latest(&lines, id) else {
            return Err(format!("{CONFLICT}: 投稿が見つかりません"));
        };
        if line_hash(&lines[index]) != expected_hash {
            return Err(format!("{CONFLICT}: 投稿が外部で変更されたため削除しませんでした"));
        }
        let line = lines.remove(index);
        write_lines(&place.file, &lines)?;
        Ok((line, index))
    })?;
    let work = place.work_root.as_deref().map(|root| current_work(root, false)).transpose()?;
    Ok(DeletedPost { snapshot: snapshot(&place, work, 0)?, line, index })
}

/// 消した行を元の位置に戻す。同じ ID の投稿がもうあれば何もしない。
pub(super) fn restore(scope: &Path, line: &str, index: usize) -> Result<PostsSnapshot, String> {
    let place = place_for(scope)?;
    let post = parse(line).ok_or_else(|| "cannot restore this line".to_string())?;
    atomic_file::with_lock(&place.file, || -> Result<(), String> {
        let mut lines = read_lines(&place.file)?;
        if find_latest(&lines, &post.id).is_some() {
            return Ok(());
        }
        // 末尾の改行を外して入れ、入れたあとは改行で閉じる。
        if lines.last().is_some_and(String::is_empty) {
            lines.pop();
        }
        lines.insert(index.min(lines.len()), line.trim_end_matches('\r').to_string());
        lines.push(String::new());
        write_lines(&place.file, &lines)
    })?;
    let work = place.work_root.as_deref().map(|root| current_work(root, false)).transpose()?;
    snapshot(&place, work, 0)
}

pub(super) fn file_signature(scope: &Path) -> Result<String, String> {
    Ok(signature(&place_for(scope)?.file))
}

#[tauri::command(async)]
pub(super) fn posts_load(scope_path: String) -> Result<PostsSnapshot, String> {
    load(Path::new(&scope_path))
}

#[tauri::command(async)]
pub(super) fn posts_signature(scope_path: String) -> Result<String, String> {
    file_signature(Path::new(&scope_path))
}

#[tauri::command(async)]
pub(super) fn posts_add(scope_path: String, at: String, body: String, reply_to: Option<String>) -> Result<PostsSnapshot, String> {
    add(Path::new(&scope_path), &at, &body, reply_to.as_deref())
}

#[tauri::command(async)]
pub(super) fn posts_update(
    scope_path: String,
    id: String,
    expected_hash: Option<String>,
    body: Option<String>,
    edited_at: Option<String>,
    filed: Option<bool>,
) -> Result<PostsSnapshot, String> {
    update(Path::new(&scope_path), &id, expected_hash.as_deref(), body.as_deref(), edited_at.as_deref(), filed)
}

#[tauri::command(async)]
pub(super) fn posts_delete(scope_path: String, id: String, expected_hash: String) -> Result<DeletedPost, String> {
    delete(Path::new(&scope_path), &id, &expected_hash)
}

#[tauri::command(async)]
pub(super) fn posts_restore(scope_path: String, line: String, index: usize) -> Result<PostsSnapshot, String> {
    restore(Path::new(&scope_path), &line, index)
}

#[cfg(test)]
mod tests;
