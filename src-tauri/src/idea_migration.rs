//! Idea → 投稿・ノート、資料 → 素材フォルダ（BINDER 2-4・2-5、docs/BINDER_IDEA_MIGRATION_PLAN.md）。
//!
//! 画面の側が Idea を今の読み込みで整え、投稿にする断片とノートにするスレッドを決めて、読んだときのままの
//! `ideaThreads` と一緒に渡す。ここでは投稿のファイルの鍵と `project.json` の鍵を取ったまま（2-3「ノートにする」と
//! 同じ順）、読み直して同じであることを確かめてから、バックアップ → 素材フォルダ → 資料を移す → 資料のパスを
//! 書き換える → ノート → 投稿 → 空の `ideaThreads` と移行の印、の順に書く。
//! 途中で失敗したら、その回に移した資料・書き換えたファイル・作ったノートとフォルダを戻し、`project.json` は
//! 書かない。足した投稿は残す（ID が断片から決まるので、次の回に重ならない）。移行の印があれば、もう何もしない。

use super::atomic_file;
use super::plot_migration::{backup_stamp, first_free_name, note_folder, relative_slash_path, write_new_file, write_note};
use super::post_stream::{self, MigratedPost};
use super::project_state::{
    load_project_config, load_project_config_unlocked, lock_project_config, project_config_path,
    save_project_config_unlocked, IdeaMigrationFragment, IdeaMigrationMove, IdeaMigrationNote, IdeaMigrationRecord,
    ProjectConfig,
};
use super::{library, migrate_snippets_to_threads, now_millis, reference_imports_dir, IdeaThreadConfig};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 資料を移すフォルダの名前（決めてほしいこと 6・9）。作品では素材フォルダの中、ライブラリ直下では直下に作る。
pub(super) const REFERENCES_FOLDER_NAME: &str = "資料";
/// アプリ側の Idea（`profileSnippets`）の投稿の ID に使う印。
const PROFILE_KEY: &str = "profile";
/// ライブラリ直下の Idea の投稿の ID に使う印。
const LIBRARY_ROOT_KEY: &str = "library";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PlannedPost {
    fragment_id: String,
    /// 断片を書いた時刻（時差つきの ISO 8601）。
    at: String,
    body: String,
    #[serde(default)]
    edited: Option<String>,
    /// 本文へ入れた断片（`used`）は受信箱から外す（決めてほしいこと 3）。
    #[serde(default)]
    filed: bool,
    #[serde(default)]
    origin: Option<Value>,
}

/// ノートの1段落。断片の本文か、資料リンクのパス。
#[derive(Debug, Deserialize)]
pub(super) struct PlannedParagraph {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    link: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PlannedNote {
    thread_id: String,
    title: String,
    #[serde(default)]
    paragraphs: Vec<PlannedParagraph>,
    #[serde(default)]
    fragment_ids: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct IdeaMigrationPlan {
    #[serde(default)]
    posts: Vec<PlannedPost>,
    #[serde(default)]
    notes: Vec<PlannedNote>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IdeaMigrationResult {
    /// migrated: 今回移した。empty: 移すものがない、または移行済みなので何もしなかった。
    status: &'static str,
    /// 今回ファイルへ足した投稿の数（前回の失敗で足してあった分は数えない）。
    posts: usize,
    /// 作ったノート（作品のフォルダからの相対パス）。
    notes: Vec<String>,
    /// 移した資料の数。
    moved: usize,
}

impl IdeaMigrationResult {
    fn empty() -> Self {
        Self { status: "empty", posts: 0, notes: Vec::new(), moved: 0 }
    }
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

/// 読み込みと同じ形の Idea（旧形式 `snippets` はスレッドにしたもの）。
pub(super) fn stored_threads(config: &ProjectConfig) -> Vec<IdeaThreadConfig> {
    if !config.idea_threads.is_empty() {
        config.idea_threads.clone()
    } else if !config.snippets.is_empty() {
        migrate_snippets_to_threads(&config.snippets)
    } else {
        Vec::new()
    }
}

fn strip_times(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("createdAt");
            map.remove("updatedAt");
            map.values_mut().for_each(strip_times);
        }
        Value::Array(items) => items.iter_mut().for_each(strip_times),
        _ => {}
    }
}

/// 比べる形。旧形式は読むたびに時刻が変わる（今の時刻を入れる）ので、時刻を外して比べる。
fn comparable(threads: &[IdeaThreadConfig], legacy: bool) -> Value {
    let mut value = serde_json::to_value(threads).unwrap_or(Value::Null);
    if legacy {
        strip_times(&mut value);
    }
    value
}

/// 資料のパスを比べる形（画面の `normalizedReferenceKey` と同じ。大文字小文字は区別しない）。
fn path_key(path: &str) -> String {
    let mut normalized = path.replace('\\', "/");
    if let Some(rest) = normalized.strip_prefix("./") {
        normalized = rest.to_string();
    }
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    normalized.to_lowercase()
}

/// 資料の元のパス → 移した先。書き換えはすべてこの表で行う。
#[derive(Default)]
struct PathMap(Vec<(String, String)>);

impl PathMap {
    fn from_moves(moves: &[IdeaMigrationMove]) -> Self {
        Self(moves.iter().map(|item| (path_key(&item.from), item.to.clone())).collect())
    }

    fn get(&self, path: &str) -> Option<&str> {
        let key = path_key(path);
        self.0.iter().find(|(from, _)| *from == key).map(|(_, to)| to.as_str())
    }
}

/// `.then/references/imports/` の中のファイル（中のフォルダも見る）。並びは相対パスの順。
fn imported_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    fn walk(folder: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in std::fs::read_dir(folder).map_err(|error| format!("failed to read references: {error}"))? {
            let path = entry.map_err(|error| format!("failed to read references: {error}"))?.path();
            if path.is_dir() {
                walk(&path, files)?;
            } else if path.is_file() {
                files.push(path);
            }
        }
        Ok(())
    }
    let imports = reference_imports_dir(root);
    let mut files = Vec::new();
    if imports.is_dir() {
        walk(&imports, &mut files)?;
    }
    files.sort_by_key(|path| path.to_string_lossy().to_lowercase());
    Ok(files)
}

/// その回にしたことを戻すための記録。
#[derive(Default)]
struct Undo {
    moved: Vec<(PathBuf, PathBuf)>,
    rewritten: Vec<(PathBuf, Vec<u8>)>,
    notes: Vec<PathBuf>,
    folders: Vec<PathBuf>,
}

impl Undo {
    fn run(self) {
        for note in self.notes.iter().rev() {
            let _ = std::fs::remove_file(note);
        }
        for (path, bytes) in self.rewritten.iter().rev() {
            let _ = atomic_file::write_replacing(path, bytes);
        }
        for (from, to) in self.moved.iter().rev() {
            if let Some(parent) = from.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::rename(to, from);
        }
        for folder in self.folders.iter().rev() {
            let _ = std::fs::remove_dir(folder);
        }
    }

    /// フォルダを作り、作ったものを覚える（親から順に）。
    fn create_dirs(&mut self, folder: &Path) -> Result<(), String> {
        let mut missing = Vec::new();
        let mut current = Some(folder);
        while let Some(path) = current {
            if path.exists() {
                break;
            }
            missing.push(path.to_path_buf());
            current = path.parent();
        }
        for path in missing.into_iter().rev() {
            std::fs::create_dir(&path).map_err(|error| format!("failed to create {}: {error}", path.display()))?;
            self.folders.push(path);
        }
        Ok(())
    }

    /// ファイルを書き換える前の中身を覚えてから書く。
    fn rewrite(&mut self, path: &Path, before: Vec<u8>, after: &str) -> Result<(), String> {
        atomic_file::write_replacing(path, after).map_err(|error| format!("failed to write {}: {error}", path.display()))?;
        self.rewritten.push((path.to_path_buf(), before));
        Ok(())
    }
}

pub(super) fn copy_verified(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("failed to create backup folder: {error}"))?;
    }
    std::fs::copy(from, to).map_err(|error| format!("failed to back up {}: {error}", from.display()))?;
    let same = std::fs::read(from).ok().zip(std::fs::read(to).ok()).is_some_and(|(a, b)| a == b);
    if !same {
        return Err(format!("backup of {} does not match", from.display()));
    }
    Ok(())
}

pub(super) fn copy_tree_verified(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(from).map_err(|error| format!("failed to read {}: {error}", from.display()))? {
        let path = entry.map_err(|error| format!("failed to read {}: {error}", from.display()))?.path();
        let target = to.join(path.file_name().unwrap_or_default());
        if path.is_dir() {
            copy_tree_verified(&path, &target)?;
        } else if path.is_file() {
            copy_verified(&path, &target)?;
        }
    }
    Ok(())
}

/// `project.json`・資料の並び・ボード・ノート「プロット（移行）」・資料をまるごと写し、写したものを読み直して確かめる。
fn write_backup(root: &Path, plot_note: Option<&Path>, migrated_at: i64) -> Result<PathBuf, String> {
    let backups = root.join(".then").join("backups");
    std::fs::create_dir_all(&backups).map_err(|error| format!("failed to create backup folder: {error}"))?;
    let name = first_free_name(&format!("idea-{}", backup_stamp(migrated_at)), "", |candidate| {
        backups.join(candidate).exists()
    });
    let dir = backups.join(name);
    std::fs::create_dir(&dir).map_err(|error| format!("failed to create backup folder: {error}"))?;
    let then = root.join(".then");
    copy_verified(&project_config_path(root), &dir.join("project.json"))?;
    copy_tree_verified(&then.join("reference-layouts"), &dir.join("reference-layouts"))?;
    copy_tree_verified(&then.join("boards"), &dir.join("boards"))?;
    copy_tree_verified(&then.join("references"), &dir.join("references"))?;
    if let Some(note) = plot_note {
        copy_verified(note, &dir.join("plot-note").join(note.file_name().unwrap_or_default()))?;
    }
    Ok(dir)
}

/// 移す先を決める。中のフォルダの形はそのままで、同じ名前があれば `-2` …（今の取り込みと同じ付け方）。
fn plan_moves(imports: &Path, files: &[PathBuf], destination: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut taken: HashSet<String> = HashSet::new();
    files
        .iter()
        .map(|file| {
            let relative = file.strip_prefix(imports).unwrap_or(file);
            let folder = destination.join(relative.parent().unwrap_or(Path::new("")));
            let path = Path::new(relative);
            let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("reference");
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| format!(".{value}"))
                .unwrap_or_default();
            let name = first_free_name(stem, &extension, |candidate| {
                let target = folder.join(candidate);
                target.exists() || taken.contains(&target.to_string_lossy().to_lowercase())
            });
            let target = folder.join(name);
            taken.insert(target.to_string_lossy().to_lowercase());
            (file.clone(), target)
        })
        .collect()
}

/// 資料の並び（資料カード・最近の資料）のパスを書き換え、Idea の部分（Idea カード・並び順・管理単位）を外す。
fn rewrite_layout(layout: &mut Value, map: &PathMap) {
    let Some(object) = layout.as_object_mut() else { return };
    if let Some(cards) = object.get_mut("cards").and_then(Value::as_array_mut) {
        cards.retain(|card| card.get("sourceType").and_then(Value::as_str) != Some("idea"));
        for card in cards.iter_mut() {
            retarget_source_path(card, map);
        }
    }
    if let Some(recent) = object.get_mut("recent").and_then(Value::as_array_mut) {
        for file in recent.iter_mut() {
            retarget_source_path(file, map);
        }
    }
    for key in ["ideaThreads", "ideaThreadsMode", "otherIdea"] {
        object.remove(key);
    }
}

fn retarget_source_path(value: &mut Value, map: &PathMap) -> bool {
    let Some(next) = value.get("sourcePath").and_then(Value::as_str).and_then(|path| map.get(path)) else {
        return false;
    };
    let next = next.to_string();
    value["sourcePath"] = Value::String(next);
    true
}

fn rewrite_layouts(root: &Path, map: &PathMap, undo: &mut Undo) -> Result<(), String> {
    let folder = root.join(".then").join("reference-layouts");
    let Ok(entries) = std::fs::read_dir(&folder) else { return Ok(()) };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect();
    files.sort();
    for file in files {
        let before = std::fs::read(&file).map_err(|error| format!("failed to read reference layout: {error}"))?;
        let mut layout: Value = serde_json::from_slice(&before)
            .map_err(|error| format!("failed to parse reference layout: {error}"))?;
        let original = layout.clone();
        rewrite_layout(&mut layout, map);
        if layout == original {
            continue;
        }
        let text = serde_json::to_string_pretty(&layout).map_err(|error| error.to_string())?;
        undo.rewrite(&file, before, &text)?;
    }
    Ok(())
}

/// ボードの資料カードのパスを書き換える。変わらないボードは書かない。
fn rewrite_boards(root: &Path, map: &PathMap, undo: &mut Undo) -> Result<(), String> {
    let folder = root.join(".then").join("boards");
    let Ok(entries) = std::fs::read_dir(&folder) else { return Ok(()) };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("canvas"))
        .collect();
    files.sort();
    for file in files {
        let before = std::fs::read(&file).map_err(|error| format!("failed to read board: {error}"))?;
        let Ok(mut board) = serde_json::from_slice::<Value>(&before) else { continue };
        let mut changed = false;
        if let Some(nodes) = board.get_mut("nodes").and_then(Value::as_array_mut) {
            for node in nodes.iter_mut() {
                if node.get("type").and_then(Value::as_str) == Some("reference") {
                    changed |= retarget_source_path(node, map);
                }
            }
        }
        if !changed {
            continue;
        }
        let text = serde_json::to_string_pretty(&board).map_err(|error| error.to_string())?;
        undo.rewrite(&file, before, &text)?;
    }
    Ok(())
}

/// 本文の `@[[パス]]` のうち、移した資料のものだけを書き換える。ほかの文字は変えない。
fn rewrite_links(text: &str, map: &PathMap) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("@[[") {
        let after = &rest[start + 3..];
        let Some(end) = after.find("]]") else { break };
        let inner = &after[..end];
        out.push_str(&rest[..start + 3]);
        out.push_str(map.get(inner).unwrap_or(inner));
        out.push_str("]]");
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

/// ファイル名に使えない文字を全角にしたノートの名前（決めてほしいこと 11）。見出しは元の名前のまま書く。
fn note_name_for(title: &str) -> String {
    let replaced: String = title
        .trim()
        .chars()
        .map(|c| match c {
            '/' => '／',
            '\\' => '＼',
            ':' => '：',
            '*' => '＊',
            '?' => '？',
            '"' => '＂',
            '<' => '＜',
            '>' => '＞',
            '|' => '｜',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let trimmed = replaced.trim().trim_end_matches('.').trim_end();
    let name = match trimmed.strip_prefix('.') {
        Some(rest) => format!("．{rest}"),
        None => trimmed.to_string(),
    };
    if name.is_empty() {
        "スレッド".to_string()
    } else {
        name
    }
}

/// ノートの本文。2-3 の「ノートにする」と同じく、見出しのあと1段落ずつ。断片の本文は1文字も変えない。
fn note_text(title: &str, paragraphs: &[PlannedParagraph], map: &PathMap) -> String {
    let heading = if title.trim().is_empty() { "スレッド" } else { title.trim() };
    let blocks: Vec<String> = paragraphs
        .iter()
        .filter_map(|paragraph| match (&paragraph.link, &paragraph.text) {
            (Some(link), _) => Some(format!("@[[{}]]", map.get(link).unwrap_or(link))),
            (None, Some(text)) if !text.trim().is_empty() => Some(text.clone()),
            _ => None,
        })
        .collect();
    if blocks.is_empty() {
        format!("# {heading}\n")
    } else {
        format!("# {heading}\n\n{}\n", blocks.join("\n\n"))
    }
}

fn migrated_posts(key: &str, planned: &[PlannedPost]) -> Vec<MigratedPost> {
    planned
        .iter()
        .map(|post| MigratedPost {
            id: post_stream::migrated_post_id(key, &post.fragment_id),
            at: post.at.clone(),
            body: post.body.clone(),
            edited: post.edited.clone(),
            filed: post.filed,
            origin: post.origin.clone(),
        })
        .collect()
}

/// 作品のフォルダからのパス（`/` 区切り）。
fn relative(root: &Path, path: &Path) -> String {
    relative_slash_path(root, path)
}

/// ノートを書き、断片の行き先を記録する。
fn write_notes(
    root: &Path,
    folder: &Path,
    notes: &[PlannedNote],
    map: &PathMap,
    undo: &mut Undo,
    written: &mut Vec<IdeaMigrationNote>,
    fragments: &mut Vec<IdeaMigrationFragment>,
) -> Result<(), String> {
    for planned in notes {
        let text = note_text(&planned.title, &planned.paragraphs, map);
        let (path, wrote) = write_note(folder, &note_name_for(&planned.title), &text)?;
        if wrote {
            undo.notes.push(path.clone());
        }
        let path = relative(root, &path);
        written.push(IdeaMigrationNote { thread_id: planned.thread_id.clone(), path: path.clone() });
        fragments.extend(planned.fragment_ids.iter().map(|id| IdeaMigrationFragment {
            id: id.clone(),
            post: None,
            note: Some(path.clone()),
        }));
        checkpoint("note")?;
    }
    Ok(())
}

struct Applied {
    record: IdeaMigrationRecord,
    created_materials: Option<String>,
    added_posts: usize,
}

#[allow(clippy::too_many_arguments)]
fn apply(
    root: &Path,
    config: &ProjectConfig,
    plan: &IdeaMigrationPlan,
    files: &[PathBuf],
    backup: &Path,
    plot_note: Option<&Path>,
    posts_target: Option<&(PathBuf, Option<(String, String)>)>,
    migrated_at: i64,
    undo: &mut Undo,
) -> Result<Applied, String> {
    let is_library_root = library::is_library_root(root);
    let needs_folder = !plan.notes.is_empty() || !files.is_empty();
    let (note_dir, created_materials) = if needs_folder {
        note_folder(root, config.materials_folder_name())?
    } else {
        (root.to_path_buf(), None)
    };
    if let Some(name) = &created_materials {
        undo.folders.push(root.join(name));
    }

    // 資料を移す。移す予定を先にバックアップのフォルダへ書く。
    let mut moved = Vec::new();
    let mut references_folder = None;
    if !files.is_empty() {
        let destination = if is_library_root {
            root.join(first_free_name(REFERENCES_FOLDER_NAME, "", |candidate| root.join(candidate).exists()))
        } else {
            note_dir.join(REFERENCES_FOLDER_NAME)
        };
        undo.create_dirs(&destination)?;
        let moves = plan_moves(&reference_imports_dir(root), files, &destination);
        moved = moves
            .iter()
            .map(|(from, to)| IdeaMigrationMove { from: relative(root, from), to: relative(root, to) })
            .collect();
        let planned = serde_json::to_string_pretty(&moved).map_err(|error| error.to_string())?;
        write_new_file(&backup.join("moves.json"), planned.as_bytes())?;
        for (from, to) in &moves {
            if let Some(parent) = to.parent() {
                undo.create_dirs(parent)?;
            }
            std::fs::rename(from, to).map_err(|error| format!("failed to move {}: {error}", from.display()))?;
            undo.moved.push((from.clone(), to.clone()));
            checkpoint("move")?;
        }
        references_folder = Some(relative(root, &destination));
    }

    // 資料のパスを持つものを、対応表で書き換える。
    let map = PathMap::from_moves(&moved);
    rewrite_layouts(root, &map, undo)?;
    checkpoint("rewrite")?;
    rewrite_boards(root, &map, undo)?;
    if let Some(note) = plot_note {
        let before = std::fs::read(note).map_err(|error| format!("failed to read plot note: {error}"))?;
        let text = String::from_utf8(before.clone()).map_err(|_| "plot note is not UTF-8".to_string())?;
        let after = rewrite_links(&text, &map);
        if after != text {
            undo.rewrite(note, before, &after)?;
        }
    }

    let mut notes = Vec::new();
    let mut fragments = Vec::new();
    write_notes(root, &note_dir, &plan.notes, &map, undo, &mut notes, &mut fragments)?;

    let mut added_posts = 0;
    if let Some((file, work)) = posts_target {
        let key = if is_library_root {
            LIBRARY_ROOT_KEY.to_string()
        } else {
            work.as_ref().map(|(id, _)| id.clone()).unwrap_or_default()
        };
        let posts = migrated_posts(&key, &plan.posts);
        fragments.extend(plan.posts.iter().zip(&posts).map(|(planned, post)| IdeaMigrationFragment {
            id: planned.fragment_id.clone(),
            post: Some(post.id.clone()),
            note: None,
        }));
        added_posts = post_stream::append_migrated_while_locked(file, work.as_ref(), &posts)?;
        checkpoint("posts")?;
    }

    Ok(Applied {
        record: IdeaMigrationRecord {
            backup_path: relative(root, backup),
            migrated_at,
            notes,
            posts: plan.posts.len(),
            moved,
            fragments,
            references_folder,
        },
        created_materials,
        added_posts,
    })
}

fn migrate_locked(
    root: &Path,
    expected: &[IdeaThreadConfig],
    plan: &IdeaMigrationPlan,
    posts_target: Option<&(PathBuf, Option<(String, String)>)>,
) -> Result<IdeaMigrationResult, String> {
    let _guard = lock_project_config()?;
    let mut config = load_project_config_unlocked(root)?;
    if config.idea_migration.is_some() {
        return Ok(IdeaMigrationResult::empty());
    }
    let legacy = config.idea_threads.is_empty() && !config.snippets.is_empty();
    let stored = stored_threads(&config);
    if comparable(&stored, legacy) != comparable(expected, legacy) {
        return Err("idea threads changed since they were read".to_string());
    }
    let files = imported_files(root)?;
    if stored.is_empty() && files.is_empty() {
        return Ok(IdeaMigrationResult::empty());
    }

    let migrated_at = now_millis();
    let plot_note = config
        .plot_migration
        .as_ref()
        .map(|record| root.join(&record.note_path))
        .filter(|path| path.is_file());
    let backup = write_backup(root, plot_note.as_deref(), migrated_at)?;
    let mut undo = Undo::default();
    let applied = match apply(root, &config, plan, &files, &backup, plot_note.as_deref(), posts_target, migrated_at, &mut undo) {
        Ok(applied) => applied,
        Err(error) => {
            undo.run();
            return Err(error);
        }
    };

    if let Some(name) = &applied.created_materials {
        config.materials_folder = Some(name.clone());
    }
    // U10: スターの付いていたスレッドから作ったノートに、スターを付ける（3-3）。
    let starred: std::collections::HashSet<&str> =
        config.idea_threads.iter().filter(|thread| thread.starred).map(|thread| thread.id.as_str()).collect();
    let stars: Vec<String> = applied
        .record
        .notes
        .iter()
        .filter(|note| starred.contains(note.thread_id.as_str()))
        .map(|note| note.path.clone())
        .collect();
    for path in stars {
        config.note_stars.entry(path).or_insert(migrated_at);
    }
    config.idea_threads.clear();
    config.snippets.clear();
    let notes = applied.record.notes.iter().map(|note| note.path.clone()).collect();
    let moved = applied.record.moved.len();
    config.idea_migration = Some(applied.record);
    if let Err(error) = checkpoint("save").and_then(|_| save_project_config_unlocked(root, &config).map(|_| ())) {
        undo.run();
        return Err(error);
    }
    // 空になった取り込みのフォルダは消す（元の中身はバックアップに残る）。
    let _ = std::fs::remove_dir(reference_imports_dir(root));
    Ok(IdeaMigrationResult { status: "migrated", posts: applied.added_posts, notes, moved })
}

pub(super) fn migrate_ideas(
    root: &Path,
    expected: &[IdeaThreadConfig],
    plan: &IdeaMigrationPlan,
) -> Result<IdeaMigrationResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    // 移すものがない作品は、作品の ID も付けずに終える（読むだけで作品を書き換えない）。
    let config = load_project_config(root)?;
    if config.idea_migration.is_some() || (stored_threads(&config).is_empty() && imported_files(root)?.is_empty()) {
        return Ok(IdeaMigrationResult::empty());
    }
    if plan.posts.is_empty() {
        return migrate_locked(root, expected, plan, None);
    }
    // 投稿のファイルの鍵 → `project.json` の鍵の順に取る（2-3「ノートにする」と同じ順）。
    let target = post_stream::migration_target(root)?;
    atomic_file::with_lock(&target.0, || migrate_locked(root, expected, plan, Some(&target)))
}

/// アプリ側の Idea（`profileSnippets`）を、ライブラリ直下のノートと作品なしの投稿にする（決めてほしいこと 4）。
/// 元の値はそのまま `.then/backups/profile-ideas-<日時>.json` に残す。何度呼んでも、投稿は ID で、ノートは
/// 同じ中身で見分けるので重ならない。
pub(super) fn migrate_profile_ideas(
    library_root: &Path,
    stored: &Value,
    plan: &IdeaMigrationPlan,
) -> Result<IdeaMigrationResult, String> {
    if !library::is_library_root(library_root) {
        return Err("not a library".to_string());
    }
    let migrated_at = now_millis();
    let backups = library_root.join(".then").join("backups");
    std::fs::create_dir_all(&backups).map_err(|error| format!("failed to create backup folder: {error}"))?;
    let name = first_free_name(&format!("profile-ideas-{}", backup_stamp(migrated_at)), ".json", |candidate| {
        backups.join(candidate).exists()
    });
    let backup = backups.join(name);
    let content = serde_json::to_string_pretty(&serde_json::json!({ "profileSnippets": stored, "migratedAt": migrated_at }))
        .map_err(|error| error.to_string())?;
    write_new_file(&backup, content.as_bytes())?;
    let reread: Value = std::fs::read_to_string(&backup)
        .map_err(|error| format!("failed to read profile backup: {error}"))
        .and_then(|text| serde_json::from_str(&text).map_err(|error| format!("profile backup is broken: {error}")))?;
    if &reread["profileSnippets"] != stored {
        return Err("profile backup does not match".to_string());
    }

    // ライブラリ直下の資料を移してあれば、同じ対応表でリンクを書く。
    let map = load_project_config(library_root)
        .ok()
        .and_then(|config| config.idea_migration)
        .map(|record| PathMap::from_moves(&record.moved))
        .unwrap_or_default();
    let (file, _) = post_stream::migration_target(library_root)?;
    atomic_file::with_lock(&file, || {
        let mut undo = Undo::default();
        let mut notes = Vec::new();
        let mut fragments = Vec::new();
        let result = write_notes(library_root, library_root, &plan.notes, &map, &mut undo, &mut notes, &mut fragments)
            .and_then(|_| post_stream::append_migrated_while_locked(&file, None, &migrated_posts(PROFILE_KEY, &plan.posts)));
        match result {
            Ok(added) => Ok(IdeaMigrationResult {
                status: "migrated",
                posts: added,
                notes: notes.into_iter().map(|note| note.path).collect(),
                moved: 0,
            }),
            Err(error) => {
                undo.run();
                Err(error)
            }
        }
    })
}

/// 2-5 のあとで資料を置く場所。作品は `<素材フォルダ>/資料/`、ライブラリ直下は移行で作った資料のフォルダ
/// （なければ「資料」）。作品に素材フォルダがなければ「素材」を作って登録する（1-6 と同じ決め方）。
pub(super) fn references_folder_for_import(root: &Path) -> Result<PathBuf, String> {
    let folder = if library::is_library_root(root) {
        let config = load_project_config(root)?;
        let name = config
            .idea_migration
            .and_then(|record| record.references_folder)
            .unwrap_or_else(|| REFERENCES_FOLDER_NAME.to_string());
        root.join(name)
    } else {
        let _guard = lock_project_config()?;
        let mut config = load_project_config_unlocked(root)?;
        let (materials, created) = note_folder(root, config.materials_folder_name())?;
        if let Some(name) = created {
            config.materials_folder = Some(name.clone());
            if let Err(error) = save_project_config_unlocked(root, &config) {
                let _ = std::fs::remove_dir(root.join(&name));
                return Err(error);
            }
        }
        materials.join(REFERENCES_FOLDER_NAME)
    };
    std::fs::create_dir_all(&folder).map_err(|error| format!("failed to create reference folder: {error}"))?;
    Ok(folder)
}

/// 資料として扱う場所（候補に出し、消せる）。作品は素材フォルダ全体、ライブラリ直下は資料のフォルダ。
/// 移行の前の（または移行に失敗した）`.then/references/imports/` も含める。あるものだけ返す。
pub(super) fn reference_areas(root: &Path) -> Vec<PathBuf> {
    let mut areas = vec![reference_imports_dir(root)];
    if let Ok(config) = load_project_config(root) {
        if library::is_library_root(root) {
            let name = config
                .idea_migration
                .and_then(|record| record.references_folder)
                .unwrap_or_else(|| REFERENCES_FOLDER_NAME.to_string());
            areas.push(root.join(name));
        } else if let Some(name) = config.materials_folder_name() {
            areas.push(root.join(name));
        }
    }
    areas.into_iter().filter(|area| area.is_dir()).collect()
}

#[tauri::command(async)]
pub(super) fn migrate_project_ideas(
    root_path: String,
    expected_idea_threads: Vec<IdeaThreadConfig>,
    plan: IdeaMigrationPlan,
) -> Result<IdeaMigrationResult, String> {
    migrate_ideas(Path::new(&root_path), &expected_idea_threads, &plan)
}

#[tauri::command(async)]
pub(super) fn migrate_profile_snippets(
    library_root: String,
    profile_snippets: Value,
    plan: IdeaMigrationPlan,
) -> Result<IdeaMigrationResult, String> {
    migrate_profile_ideas(Path::new(&library_root), &profile_snippets, &plan)
}

#[cfg(test)]
mod tests;
