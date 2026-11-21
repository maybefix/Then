//! 中間稿 → 素材のノート「（ボード名）の中間稿」（BINDER 4-4b、docs/BINDER_INTERMEDIATE_DRAFT_RETIRE_PLAN.md）。
//!
//! 作品の `.then/boards/.intermediate-drafts/<ボード ID>/` と、ゴミ箱のボードの横の
//! `.then/boards/.trash/<日時>--<ボード ID>.draft/` を読み、ボードごとに最新版の本文でノートを作る。
//! 順番: バックアップ（写して読み直す）→ 素材フォルダ（なければ作る）→ ノート → `project.json`（作ったときだけ）
//! → 中間稿を消す。ノートまでのどこかで失敗したら、その回に作ったノートとフォルダを消し、中間稿は消さない。
//! 中間稿がなくなること自体が「済んだ」の印なので、何度呼んでも1回しか移さない。

use super::idea_migration::{copy_tree_verified, copy_verified};
use super::plot_migration::{backup_stamp, first_free_name, note_folder, relative_slash_path, write_new_file, write_note};
use super::project_state::{load_project_config_unlocked, lock_project_config, save_project_config_unlocked};
use super::now_millis;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

const DRAFTS_FOLDER: &str = ".intermediate-drafts";
const NOTE_SUFFIX: &str = "の中間稿";

/// 画面の側が localStorage の終了前の一時保存（`then.draft-recovery.*`）から読んだもの。
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct DraftRecovery {
    board_id: String,
    /// 一時保存の最新版の本文。
    text: String,
    /// 一時保存の中身そのまま（バックアップにだけ書く）。
    #[serde(default)]
    raw: Value,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DraftMigrationResult {
    /// migrated: 今回移した。empty: 中間稿がないので何もしなかった（移行済みを含む）。
    status: &'static str,
    /// 作ったノート（作品のフォルダからの相対パス）。同じ中身のノートがすでにあって作らなかったものも入る。
    notes: Vec<String>,
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

/// 移す中間稿1つ。
struct Source {
    /// 中間稿のフォルダ（一時保存だけのときは None）。
    dir: Option<PathBuf>,
    board_id: String,
    board_name: Option<String>,
    /// 生きているボードの中間稿か（一時保存を当てるのはこちらだけ）。
    live: bool,
}

fn boards_dir(root: &Path) -> PathBuf {
    root.join(".then").join("boards")
}

fn board_name(canvas: &Path) -> Option<String> {
    let text = std::fs::read_to_string(canvas).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let name = value.pointer("/then/name")?.as_str()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

fn sorted_entries(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut paths = std::fs::read_dir(dir)
        .map_err(|error| format!("failed to read {}: {error}", dir.display()))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read {}: {error}", dir.display()))?;
    paths.sort();
    Ok(paths)
}

/// 生きているボードの中間稿（ID の順）→ ゴミ箱のボードの中間稿（ゴミ箱に入れた順）。
fn sources(root: &Path) -> Result<Vec<Source>, String> {
    let boards = boards_dir(root);
    let mut found = Vec::new();
    for dir in sorted_entries(&boards.join(DRAFTS_FOLDER))? {
        if !dir.is_dir() {
            continue;
        }
        let board_id = dir.file_name().unwrap_or_default().to_string_lossy().to_string();
        let board_name = board_name(&boards.join(format!("{board_id}.canvas")));
        found.push(Source { dir: Some(dir), board_id, board_name, live: true });
    }
    for dir in sorted_entries(&boards.join(".trash"))? {
        let is_draft = dir.extension().and_then(|value| value.to_str()) == Some("draft");
        if !dir.is_dir() || !is_draft {
            continue;
        }
        let trash_id = dir.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let board_id = trash_id.split_once("--").map(|(_, id)| id.to_string()).unwrap_or_else(|| trash_id.clone());
        let board_name = board_name(&dir.with_extension("canvas"));
        found.push(Source { dir: Some(dir), board_id, board_name, live: false });
    }
    Ok(found)
}

/// 保存されている最新版の本文。`history.json` が読めなければ、番号のいちばん大きい `v<版>.txt`。
fn latest_text(dir: &Path) -> Option<String> {
    let from_history = std::fs::read_to_string(dir.join("history.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|history| {
            history
                .get("versions")?
                .as_array()?
                .iter()
                .max_by_key(|version| version.get("version").and_then(Value::as_u64).unwrap_or(0))?
                .get("text")?
                .as_str()
                .map(str::to_string)
        });
    if from_history.is_some() {
        return from_history;
    }
    let mut best: Option<(u64, PathBuf)> = None;
    for path in sorted_entries(dir).ok()? {
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let Some(number) = name.strip_prefix('v').and_then(|rest| rest.strip_suffix(".txt")).and_then(|n| n.parse::<u64>().ok()) else {
            continue;
        };
        if best.as_ref().is_none_or(|(current, _)| number > *current) {
            best = Some((number, path));
        }
    }
    std::fs::read_to_string(best?.1).ok()
}

/// ノートの名前。ファイル名に使えない文字を取り除き、残りが空ならボード ID。
pub(super) fn note_name(board_name: Option<&str>, board_id: &str) -> String {
    let clean = |value: &str| {
        value
            .chars()
            .filter(|ch| !matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !ch.is_control())
            .collect::<String>()
            .trim()
            .trim_end_matches('.')
            .trim()
            .to_string()
    };
    let name = board_name.map(clean).filter(|name| !name.is_empty()).unwrap_or_else(|| clean(board_id));
    let name = if name.is_empty() { "ボード".to_string() } else { name };
    format!("{name}{NOTE_SUFFIX}")
}

fn write_backup(root: &Path, found: &[Source], recoveries: &[DraftRecovery], migrated_at: i64) -> Result<PathBuf, String> {
    let backups = root.join(".then").join("backups");
    std::fs::create_dir_all(&backups).map_err(|error| format!("failed to create backup folder: {error}"))?;
    let name = first_free_name(&format!("intermediate-drafts-{}", backup_stamp(migrated_at)), "", |candidate| {
        backups.join(candidate).exists()
    });
    let dir = backups.join(name);
    std::fs::create_dir(&dir).map_err(|error| format!("failed to create backup folder: {error}"))?;
    copy_tree_verified(&boards_dir(root).join(DRAFTS_FOLDER), &dir.join("drafts"))?;
    for source in found.iter().filter(|source| !source.live) {
        let Some(draft) = &source.dir else { continue };
        copy_tree_verified(draft, &dir.join("trash").join(draft.file_name().unwrap_or_default()))?;
        let canvas = draft.with_extension("canvas");
        if canvas.is_file() {
            copy_verified(&canvas, &dir.join("trash").join(canvas.file_name().unwrap_or_default()))?;
        }
    }
    if !recoveries.is_empty() {
        let raw: Vec<Value> = recoveries
            .iter()
            .map(|recovery| serde_json::json!({ "boardId": recovery.board_id, "text": recovery.text, "entry": recovery.raw }))
            .collect();
        let content = serde_json::to_string_pretty(&raw).map_err(|error| format!("failed to serialize recovery: {error}"))?;
        let path = dir.join("recovery.json");
        write_new_file(&path, content.as_bytes())?;
        if std::fs::read(&path).ok().as_deref() != Some(content.as_bytes()) {
            return Err("recovery backup does not match".to_string());
        }
    }
    Ok(dir)
}

pub(super) fn migrate_drafts(root: &Path, recoveries: &[DraftRecovery]) -> Result<DraftMigrationResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let _guard = lock_project_config()?;
    let mut found = sources(root)?;
    // 中間稿のフォルダがない（保存の前に閉じた）ボードの一時保存も移す。
    for recovery in recoveries {
        if !found.iter().any(|source| source.live && source.board_id == recovery.board_id) {
            let board_name = board_name(&boards_dir(root).join(format!("{}.canvas", recovery.board_id)));
            found.push(Source { dir: None, board_id: recovery.board_id.clone(), board_name, live: true });
        }
    }
    if found.is_empty() {
        return Ok(DraftMigrationResult { status: "empty", notes: Vec::new(), backup_path: None });
    }

    let migrated_at = now_millis();
    let backup = write_backup(root, &found, recoveries, migrated_at)?;
    let mut config = load_project_config_unlocked(root)?;
    let texts: Vec<(String, String)> = found
        .iter()
        .filter_map(|source| {
            let saved = source.dir.as_deref().and_then(latest_text);
            let recovered = source
                .live
                .then(|| recoveries.iter().find(|recovery| recovery.board_id == source.board_id))
                .flatten()
                .map(|recovery| recovery.text.clone());
            let text = recovered.or(saved)?;
            (!text.trim().is_empty()).then(|| (note_name(source.board_name.as_deref(), &source.board_id), text))
        })
        .collect();

    let mut written: Vec<PathBuf> = Vec::new();
    let undo = |written: &[PathBuf], created: &Option<String>| {
        for note in written {
            let _ = std::fs::remove_file(note);
        }
        if let Some(name) = created {
            let _ = std::fs::remove_dir(root.join(name));
        }
    };
    let mut notes = Vec::new();
    if !texts.is_empty() {
        let (folder, created_folder) = note_folder(root, config.materials_folder_name())?;
        for (name, text) in &texts {
            match checkpoint("note").and_then(|_| write_note(&folder, name, text)) {
                Ok((path, wrote)) => {
                    if wrote {
                        written.push(path.clone());
                    }
                    notes.push(relative_slash_path(root, &path));
                }
                Err(error) => {
                    undo(&written, &created_folder);
                    return Err(error);
                }
            }
        }
        if let Some(name) = &created_folder {
            config.materials_folder = Some(name.clone());
            if let Err(error) = checkpoint("save").and_then(|_| save_project_config_unlocked(root, &config).map(|_| ())) {
                undo(&written, &created_folder);
                return Err(error);
            }
        }
    }

    // ノートが全部できたので、中間稿を消す（元の中身はバックアップにある）。消せなかったものは次に開いたときに
    // やり直す。そのときは同じ中身のノートを使うので、2本目はできない。
    let mut failed = Vec::new();
    let drafts = boards_dir(root).join(DRAFTS_FOLDER);
    if drafts.exists() {
        if let Err(error) = checkpoint("remove").and_then(|_| std::fs::remove_dir_all(&drafts).map_err(|error| error.to_string())) {
            failed.push(format!("{}: {error}", drafts.display()));
        }
    }
    for source in found.iter().filter(|source| !source.live) {
        if let Some(dir) = &source.dir {
            if let Err(error) = std::fs::remove_dir_all(dir) {
                failed.push(format!("{}: {error}", dir.display()));
            }
        }
    }
    if !failed.is_empty() {
        return Err(format!("failed to remove intermediate drafts: {}", failed.join("; ")));
    }
    Ok(DraftMigrationResult {
        status: "migrated",
        notes,
        backup_path: Some(relative_slash_path(root, &backup)),
    })
}

#[tauri::command(async)]
pub(super) fn migrate_intermediate_drafts(
    root_path: String,
    recoveries: Vec<DraftRecovery>,
) -> Result<DraftMigrationResult, String> {
    migrate_drafts(Path::new(&root_path), &recoveries)
}

#[cfg(test)]
mod tests;
