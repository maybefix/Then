//! Canvas のコピーのカード → ノートのカード（BINDER 4-5、docs/BINDER_COPY_CARD_MIGRATION_PLAN.md）。
//!
//! Idea の「Canvas へ送る」で作ったテキストカード（`thenOrigin` 付き）を、2-4・2-5 の移行の記録
//! （`project.json` の `ideaMigration.fragments`）で元の断片の行き先を引き、そのノートを指すファイルのカード
//! （4-2 の `file` ノード）に置き換える。置き換えるのは、行き先が同じ作品のノートで、カードの文が元の断片
//! （移行のバックアップの本文）と同じで、そのボードでそのノートを指すカードがこの1枚だけになるとき（確認1の 1〜4）。
//! ID・位置・大きさ・色は保ち、線はカードの ID でつながるのでそのまま残る（5）。ゴミ箱のボードは触らない（8）。
//! 順番: 置き換えるボードを全部バックアップ（写して読み直す）→ ボードを書く。途中で失敗したら、その回に書いた
//! ボードを元の中身に戻す。置き換えたカードはテキストでなくなるので、何度呼んでも1回しか置き換えない。
//!
//! 元の断片が投稿になっていれば、投稿のカード（`{"type":"post","post":ID}`）に置き換える（docs/BINDER_POST_CARD_PLAN.md の
//! 確認1の 4）。作品のボードでは、その投稿を同じ作品のノートにしていればノートのカード（4-5 のまま）。ライブラリ直下の
//! ボードは、直下の記録に加えてライブラリの全作品の記録から元の断片を引き、1つの記録に決まるときだけ置き換える。
//! 直下のボードから作品のノートは指せないので、作品の断片は投稿のカードにだけなる。

use super::idea_migration::{copy_verified, stored_threads};
use super::plot_migration::{backup_stamp, first_free_name, relative_slash_path, write_new_file};
use super::project_state::{load_project_config, IdeaMigrationRecord, ProjectConfig};
use super::{atomic_file, library, now_millis, post_stream};
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
    /// そのうちノートのカード・投稿のカードにした数（通知の文に使う）。
    notes: usize,
    posts: usize,
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

/// 置き換え先。ノートのカード（作品からのパス）か、投稿のカード（投稿の ID）。
#[derive(Clone, Debug, PartialEq)]
enum Target {
    Note(String),
    Post(String),
}

impl Target {
    /// 同じものを指すカードを数えるときの鍵。
    fn key(&self) -> String {
        match self {
            Target::Note(file) => format!("file:{}", file.replace('\\', "/")),
            Target::Post(id) => format!("post:{id}"),
        }
    }
}

/// 1つの作品（またはライブラリ直下）の移行の記録と、移行の前の断片の本文。
struct Record {
    record: IdeaMigrationRecord,
    bodies: HashMap<String, String>,
    work_id: Option<String>,
    /// ボードと同じフォルダの記録か（その作品のノートを指せるのは、この記録だけ）。
    own: bool,
}

/// 置き換えに使う移行の記録。作品のボードではその作品の記録だけ、ライブラリ直下ではライブラリの全作品の記録も。
struct Sources {
    records: Vec<Record>,
}

fn load_record(root: &Path, own: bool) -> Result<Option<Record>, String> {
    let config = load_project_config(root)?;
    let Some(record) = config.idea_migration.clone() else { return Ok(None) };
    if record.fragments.is_empty() {
        return Ok(None);
    }
    let bodies = fragment_bodies(root, &record);
    Ok(Some(Record { record, bodies, work_id: config.work_id.clone(), own }))
}

impl Sources {
    fn load(root: &Path) -> Result<Option<Self>, String> {
        let mut records = Vec::new();
        if let Some(record) = load_record(root, true)? {
            records.push(record);
        }
        if library::is_library_root(root) {
            // 読めない作品は飛ばす（その作品の断片から来たカードは置き換えない）。
            for project in library::library_projects(root).unwrap_or_default() {
                if let Ok(Some(record)) = load_record(Path::new(&project.path), false) {
                    records.push(record);
                }
            }
        }
        Ok((!records.is_empty()).then_some(Self { records }))
    }

    /// 断片の置き換え先と、移行の前の本文。ボードのフォルダ（`root`）から指せて、今もあるときだけ。
    /// 同じ断片が2つ以上の記録にあれば、どれとも決めない。
    fn resolve(&self, root: &Path, fragment_id: &str) -> Option<(Target, &str)> {
        let mut found = self.records.iter().filter_map(|source| {
            let fragment = source.record.fragments.iter().find(|item| item.id == fragment_id)?;
            Some((source, fragment))
        });
        let (source, fragment) = found.next()?;
        if found.next().is_some() {
            return None;
        }
        let body = source.bodies.get(fragment_id)?;
        let note_here = |note: &str| {
            let relative = safe_relative(note)?;
            root.join(relative).is_file().then(|| Target::Note(note.to_string()))
        };
        let target = match (&fragment.note, &fragment.post) {
            (Some(note), _) if source.own => note_here(note)?,
            (Some(_), _) => return None,
            (None, Some(post)) => {
                let noted = post_stream::post_state(root, post)?;
                // 同じ作品のノートにしていれば、そのノートのカード（4-5 の確認1の 3）。それ以外は投稿のカード。
                let same_work = |work: &str| source.own && source.work_id.as_deref() == Some(work);
                match noted {
                    Some((work, path)) if same_work(&work) => {
                        note_here(&path).unwrap_or_else(|| Target::Post(post.clone()))
                    }
                    _ => Target::Post(post.clone()),
                }
            }
            (None, None) => return None,
        };
        Some((target, body.as_str()))
    }
}

/// ボードの置き換えの予定（カードの ID・元の断片・置き換え先）。同じものへ行くコピーのカードが2枚以上か、それを指す
/// カードがすでにあれば、どれも置き換えない（4。同じノート・投稿のカードを並べない）。
fn plan_board(root: &Path, sources: &Sources, nodes: &[Value]) -> Vec<(String, String, Target)> {
    let mut resolved: Vec<(String, String, Target, bool)> = Vec::new();
    for node in nodes {
        let Some(fragment_id) = origin_fragment(node) else { continue };
        let Some(id) = node.get("id").and_then(Value::as_str) else { continue };
        let Some((target, body)) = sources.resolve(root, fragment_id) else { continue };
        let text = node.get("text").and_then(Value::as_str).unwrap_or("");
        let same = comparable_text(text) == comparable_text(body);
        resolved.push((id.to_string(), fragment_id.to_string(), target, same));
    }
    // ボードにすでにある同じノートのファイルのカード・同じ投稿のカード（置き換え済み・あとから置いたもの）も数える。
    let mut counts: HashMap<String, usize> = HashMap::new();
    for node in nodes {
        let existing = match node.get("type").and_then(Value::as_str) {
            Some("file") => node.get("file").and_then(Value::as_str).map(|file| Target::Note(file.to_string())),
            Some("post") => node.get("post").and_then(Value::as_str).map(|post| Target::Post(post.to_string())),
            _ => None,
        };
        if let Some(existing) = existing {
            *counts.entry(existing.key()).or_default() += 1;
        }
    }
    for (_, _, target, _) in &resolved {
        *counts.entry(target.key()).or_default() += 1;
    }
    resolved
        .into_iter()
        .filter(|(_, _, target, same)| *same && counts.get(&target.key()) == Some(&1))
        .map(|(id, fragment, target, _)| (id, fragment, target))
        .collect()
}

/// カードをファイルのカード・投稿のカードにする。ID・位置・大きさ・色だけを残す（4-4 の `convertCardsToFiles` と同じ形）。
fn target_node(card: &Value, target: &Target) -> Value {
    let mut node = Map::new();
    for key in ["id", "type", "x", "y", "width", "height"] {
        if let Some(value) = card.get(key) {
            node.insert(key.to_string(), value.clone());
        }
    }
    match target {
        Target::Note(file) => {
            node.insert("type".to_string(), json!("file"));
            node.insert("file".to_string(), json!(file));
        }
        Target::Post(post) => {
            node.insert("type".to_string(), json!("post"));
            node.insert("post".to_string(), json!(post));
        }
    }
    if let Some(color) = card.get("color").filter(|value| value.is_string()) {
        node.insert("color".to_string(), color.clone());
    }
    Value::Object(node)
}

/// ボードのカードを置き換える。置き換えたカードを親にしていたスレッドの子は、その場に残してスレッドから外す。
fn replace_cards(board: &mut Value, plan: &[(String, String, Target)]) {
    let files: HashMap<&str, &Target> = plan.iter().map(|(id, _, target)| (id.as_str(), target)).collect();
    let Some(nodes) = board.get_mut("nodes").and_then(Value::as_array_mut) else { return };
    for node in nodes.iter_mut() {
        let id = node.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        if let Some(target) = files.get(id.as_str()) {
            *node = target_node(node, target);
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
    cards: Vec<(String, String, Target)>,
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
        for (id, fragment, target) in &board.cards {
            let mut entry = json!({ "board": file_name.to_string_lossy(), "card": id, "fragment": fragment });
            match target {
                Target::Note(file) => entry["file"] = json!(file),
                Target::Post(post) => entry["post"] = json!(post),
            }
            cards.push(entry);
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
    let empty =
        || CopyCardMigrationResult { status: "empty", replaced: 0, notes: 0, posts: 0, boards: Vec::new(), backup_path: None };
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
    let count = |post: bool| {
        planned
            .iter()
            .flat_map(|board| &board.cards)
            .filter(|(_, _, target)| matches!(target, Target::Post(_)) == post)
            .count()
    };
    Ok(CopyCardMigrationResult {
        status: "migrated",
        replaced: planned.iter().map(|board| board.cards.len()).sum(),
        notes: count(false),
        posts: count(true),
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
