//! Canvas のコピーのカード → ノートのカード（BINDER 4-5、docs/BINDER_COPY_CARD_MIGRATION_PLAN.md）。
//!
//! Idea の「Canvas へ送る」で作ったテキストカード（`thenOrigin` 付き）を、2-4・2-5 の移行の記録
//! （`project.json` の `ideaMigration.fragments`）で元の断片の行き先を引き、そのノートを指すファイルのカード
//! （4-2 の `file` ノード）に置き換える。置き換えるのは、行き先が同じ作品のノートで、カードの文が元の断片
//! （移行のバックアップの本文）と同じで、そのボードでそのノートを指すカードがこの1枚だけになるとき（確認1の 1〜4）。
//! ID・位置・大きさ・色は保ち、線はカードの ID でつながるのでそのまま残る（5）。ゴミ箱のボードは触らない（8）。
//! 順番: 置き換えるボードを全部バックアップ（写して読み直す）→ ボードを書く。途中で失敗したら、その回に書いた
//! ボードを元の中身に戻す。置き換えたカードはテキストでなくなるので、何度呼んでも1回しか置き換えない。

use super::idea_migration::{copy_verified, stored_threads};
use super::plot_migration::{backup_stamp, first_free_name, relative_slash_path, write_new_file};
use super::project_state::{load_project_config, IdeaMigrationRecord, ProjectConfig};
use super::{atomic_file, now_millis, post_stream};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CopyCardMigrationResult {
    /// migrated: 今回置き換えた。empty: 置き換えるカードがなかった（置き換え済みを含む）。
    status: &'static str,
    /// 置き換えたカードの数。
    replaced: usize,
    /// 書き換えたボードの ID（`.canvas` を除いたファイル名）。
    boards: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    backup_path: Option<String>,
}

// 失敗を起こす場所（テストだけ）。
#[cfg(test)]
thread_local! {
    static FAIL_AT: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(super) fn fail_at(step: Option<&'static str>) {
    FAIL_AT.with(|cell| cell.set(step));
}

fn checkpoint(step: &'static str) -> Result<(), String> {
    #[cfg(test)]
    if FAIL_AT.with(|cell| cell.get()) == Some(step) {
        return Err(format!("test failure at {step}"));
    }
    let _ = step;
    Ok(())
}

/// 生きているボードのファイル（名前の順）。ゴミ箱（`.trash`）の中は見ない。
fn board_files(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root.join(".then").join("boards")) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("canvas"))
        .collect();
    files.sort();
    files
}

/// コピーのカードなら、元の断片の ID。
fn origin_fragment(node: &Value) -> Option<&str> {
    if node.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    let origin = node.get("thenOrigin")?;
    if origin.get("source").and_then(Value::as_str) != Some("idea") {
        return None;
    }
    origin.get("sourceId").and_then(Value::as_str).filter(|id| !id.is_empty())
}

/// 移行の前の断片の本文（移行のバックアップの `project.json` から）。同じ ID が2つあれば先のもの。
fn fragment_bodies(root: &Path, record: &IdeaMigrationRecord) -> HashMap<String, String> {
    let mut bodies = HashMap::new();
    let Some(backup) = safe_relative(&record.backup_path) else { return bodies };
    let Ok(bytes) = std::fs::read(root.join(backup).join("project.json")) else { return bodies };
    let Ok(config) = serde_json::from_slice::<ProjectConfig>(&bytes) else { return bodies };
    for thread in stored_threads(&config) {
        for fragment in thread.fragments {
            bodies.entry(fragment.id).or_insert(fragment.body);
        }
    }
    bodies
}

/// 作品の中を指す相対パス（`/` 区切り）だけを通す。
fn safe_relative(path: &str) -> Option<PathBuf> {
    let relative = PathBuf::from(path);
    let inside = !path.is_empty()
        && relative.components().all(|component| matches!(component, Component::Normal(_)));
    inside.then_some(relative)
}

/// 改行の形（CRLF・CR）だけをそろえる。
fn comparable_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// 置き換えに使う、作品の移行の記録。
struct Sources {
    record: IdeaMigrationRecord,
    bodies: HashMap<String, String>,
    work_id: Option<String>,
}

impl Sources {
    fn load(root: &Path) -> Result<Option<Self>, String> {
        let config = load_project_config(root)?;
        let Some(record) = config.idea_migration.clone() else { return Ok(None) };
        if record.fragments.is_empty() {
            return Ok(None);
        }
        let bodies = fragment_bodies(root, &record);
        Ok(Some(Self { record, bodies, work_id: config.work_id.clone() }))
    }

    /// 断片の行き先のノート（作品からのパス）と、移行の前の本文。同じ作品のノートで、今もあるときだけ。
    fn resolve(&self, root: &Path, fragment_id: &str) -> Option<(String, &str)> {
        let fragment = self.record.fragments.iter().find(|item| item.id == fragment_id)?;
        let body = self.bodies.get(fragment_id)?;
        let note = match (&fragment.note, &fragment.post) {
            (Some(note), _) => note.clone(),
            // 投稿は、あとで同じ作品のノートにしたときだけ（確認1の 3）。
            (None, Some(post)) => {
                let (work, path) = post_stream::note_of_post(root, post)?;
                if self.work_id.as_deref() != Some(work.as_str()) {
                    return None;
                }
                path
            }
            (None, None) => return None,
        };
        let relative = safe_relative(&note)?;
        root.join(relative).is_file().then_some((note, body.as_str()))
    }
}

/// ボードの置き換えの予定（カードの ID → 指すノート）。同じノートへ行くコピーのカードが2枚以上か、そのノートの
/// ファイルのカードがすでにあれば、どれも置き換えない（4。同じノートのカードを並べない）。
fn plan_board(root: &Path, sources: &Sources, nodes: &[Value]) -> Vec<(String, String, String)> {
    let mut resolved: Vec<(String, String, String, bool)> = Vec::new();
    for node in nodes {
        let Some(fragment_id) = origin_fragment(node) else { continue };
        let Some(id) = node.get("id").and_then(Value::as_str) else { continue };
        let Some((file, body)) = sources.resolve(root, fragment_id) else { continue };
        let text = node.get("text").and_then(Value::as_str).unwrap_or("");
        let same = comparable_text(text) == comparable_text(body);
        resolved.push((id.to_string(), fragment_id.to_string(), file, same));
    }
    // ボードにすでにある同じノートのファイルのカード（置き換え済み・バインダーから置いたもの）も数える。
    let mut counts: HashMap<String, usize> = HashMap::new();
    for node in nodes.iter().filter(|node| node.get("type").and_then(Value::as_str) == Some("file")) {
        if let Some(file) = node.get("file").and_then(Value::as_str) {
            *counts.entry(file.replace('\\', "/")).or_default() += 1;
        }
    }
    for (_, _, file, _) in &resolved {
        *counts.entry(file.clone()).or_default() += 1;
    }
    resolved
        .iter()
        .filter(|(_, _, file, same)| *same && counts.get(file.as_str()) == Some(&1))
        .map(|(id, fragment, file, _)| (id.clone(), fragment.clone(), file.clone()))
        .collect()
}

/// カードをファイルのカードにする。ID・位置・大きさ・色だけを残す（4-4 の `convertCardsToFiles` と同じ形）。
fn file_node(card: &Value, file: &str) -> Value {
    let mut node = Map::new();
    for key in ["id", "type", "x", "y", "width", "height"] {
        if let Some(value) = card.get(key) {
            node.insert(key.to_string(), value.clone());
        }
    }
    node.insert("type".to_string(), json!("file"));
    node.insert("file".to_string(), json!(file));
    if let Some(color) = card.get("color").filter(|value| value.is_string()) {
        node.insert("color".to_string(), color.clone());
    }
    Value::Object(node)
}

/// ボードのカードを置き換える。置き換えたカードを親にしていたスレッドの子は、その場に残してスレッドから外す。
fn replace_cards(board: &mut Value, plan: &[(String, String, String)]) {
    let files: HashMap<&str, &str> = plan.iter().map(|(id, _, file)| (id.as_str(), file.as_str())).collect();
    let Some(nodes) = board.get_mut("nodes").and_then(Value::as_array_mut) else { return };
    for node in nodes.iter_mut() {
        let id = node.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        if let Some(file) = files.get(id.as_str()) {
            *node = file_node(node, file);
            continue;
        }
        let parent = node.get("threadParentId").and_then(Value::as_str).unwrap_or("");
        if files.contains_key(parent) {
            if let Some(object) = node.as_object_mut() {
                object.remove("threadParentId");
                object.remove("threadOrder");
            }
        }
    }
}

struct Planned {
    path: PathBuf,
    before: Vec<u8>,
    after: String,
    cards: Vec<(String, String, String)>,
}

fn write_backup(root: &Path, planned: &[Planned], migrated_at: i64) -> Result<PathBuf, String> {
    let backups = root.join(".then").join("backups");
    std::fs::create_dir_all(&backups).map_err(|error| format!("failed to create backup folder: {error}"))?;
    let name = first_free_name(&format!("copy-cards-{}", backup_stamp(migrated_at)), "", |candidate| {
        backups.join(candidate).exists()
    });
    let dir = backups.join(name);
    std::fs::create_dir(&dir).map_err(|error| format!("failed to create backup folder: {error}"))?;
    let mut cards = Vec::new();
    for board in planned {
        let file_name = board.path.file_name().unwrap_or_default();
        copy_verified(&board.path, &dir.join("boards").join(file_name))?;
        if std::fs::read(dir.join("boards").join(file_name)).ok().as_deref() != Some(board.before.as_slice()) {
            return Err(format!("backup of {} does not match", board.path.display()));
        }
        for (id, fragment, file) in &board.cards {
            cards.push(json!({ "board": file_name.to_string_lossy(), "card": id, "fragment": fragment, "file": file }));
        }
    }
    let content = serde_json::to_string_pretty(&json!({ "migratedAt": migrated_at, "cards": cards }))
        .map_err(|error| error.to_string())?;
    let path = dir.join("cards.json");
    write_new_file(&path, content.as_bytes())?;
    if std::fs::read(&path).ok().as_deref() != Some(content.as_bytes()) {
        return Err("card list backup does not match".to_string());
    }
    Ok(dir)
}

pub(super) fn migrate_cards(root: &Path) -> Result<CopyCardMigrationResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let empty = || CopyCardMigrationResult { status: "empty", replaced: 0, boards: Vec::new(), backup_path: None };
    let files = board_files(root);
    if files.is_empty() {
        return Ok(empty());
    }
    let Some(sources) = Sources::load(root)? else { return Ok(empty()) };

    let mut planned = Vec::new();
    for path in files {
        let before = std::fs::read(&path).map_err(|error| format!("failed to read board: {error}"))?;
        // 読めないボードは、Canvas で開いたときと同じく触らない。
        let Ok(mut board) = serde_json::from_slice::<Value>(&before) else { continue };
        let Some(nodes) = board.get("nodes").and_then(Value::as_array) else { continue };
        let cards = plan_board(root, &sources, nodes);
        if cards.is_empty() {
            continue;
        }
        replace_cards(&mut board, &cards);
        let after = serde_json::to_string_pretty(&board).map_err(|error| error.to_string())?;
        planned.push(Planned { path, before, after, cards });
    }
    if planned.is_empty() {
        return Ok(empty());
    }

    let migrated_at = now_millis();
    let backup = write_backup(root, &planned, migrated_at)?;
    let mut written: Vec<&Planned> = Vec::new();
    for board in &planned {
        let result = checkpoint("board").and_then(|_| {
            atomic_file::write_replacing(&board.path, &board.after)
                .map_err(|error| format!("failed to write {}: {error}", board.path.display()))
        });
        if let Err(error) = result {
            for done in written.iter().rev() {
                let _ = atomic_file::write_replacing(&done.path, &done.before);
            }
            return Err(error);
        }
        written.push(board);
    }
    Ok(CopyCardMigrationResult {
        status: "migrated",
        replaced: planned.iter().map(|board| board.cards.len()).sum(),
        boards: planned
            .iter()
            .map(|board| board.path.file_stem().unwrap_or_default().to_string_lossy().to_string())
            .collect(),
        backup_path: Some(relative_slash_path(root, &backup)),
    })
}

#[tauri::command(async)]
pub(super) fn migrate_copy_cards(root_path: String) -> Result<CopyCardMigrationResult, String> {
    migrate_cards(Path::new(&root_path))
}

#[cfg(test)]
mod tests;
