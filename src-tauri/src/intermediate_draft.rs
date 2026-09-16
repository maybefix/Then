use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static DRAFT_LOCK: Mutex<()> = Mutex::new(());

/// Move a board and its sidecar together, rolling back the sidecar if the board move fails.
pub(super) fn move_board_with_draft(
    source: &Path,
    destination: &Path,
    source_draft: &Path,
    destination_draft: &Path,
) -> Result<(), String> {
    let _guard = DRAFT_LOCK.lock().map_err(|e| e.to_string())?;
    let has_draft = source_draft.is_dir();
    if has_draft {
        if destination_draft.exists() {
            return Err("移動先に中間稿がすでにあります".into());
        }
        if let Some(parent) = destination_draft.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::rename(source_draft, destination_draft).map_err(|e| e.to_string())?;
    }
    if let Err(error) = std::fs::rename(source, destination) {
        if has_draft {
            std::fs::rename(destination_draft, source_draft).map_err(|rollback| {
                format!("ボード移動失敗: {error}; 中間稿の復元失敗: {rollback}")
            })?;
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct DraftCard {
    id: String,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftVersion {
    version: u64,
    captured_at: u64,
    board_updated_at: u64,
    created_at: u64,
    updated_at: u64,
    cards: Vec<DraftCard>,
    order: Vec<String>,
    #[serde(default)]
    excluded: Vec<String>,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftHistory {
    schema_version: u32,
    board_id: String,
    revision: u64,
    versions: Vec<DraftVersion>,
}

fn draft_dir(
    app: &tauri::AppHandle,
    scope: &str,
    root_path: Option<String>,
    board_id: &str,
) -> Result<PathBuf, String> {
    let boards = super::canvas_boards_dir(app, scope, root_path)?;
    let board = super::canvas_board_path(&boards, board_id)?;
    if !board.is_file() {
        return Err("Canvasボードがありません".into());
    }
    Ok(boards.join(".intermediate-drafts").join(board_id))
}

fn read_history(dir: &Path, board_id: &str) -> Result<DraftHistory, String> {
    let path = dir.join("history.json");
    if !path.exists() {
        return Ok(DraftHistory {
            schema_version: 1,
            board_id: board_id.into(),
            revision: 0,
            versions: vec![],
        });
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("中間稿の読込に失敗しました: {e}"))?;
    let mut history: DraftHistory =
        serde_json::from_str(&text).map_err(|e| format!("中間稿の形式が不正です: {e}"))?;
    // A board restored from trash may have acquired a different filename.
    history.board_id = board_id.into();
    if history.schema_version != 1 {
        return Err("未対応の中間稿形式です".into());
    }
    Ok(history)
}

#[tauri::command]
pub fn load_intermediate_draft(
    app: tauri::AppHandle,
    scope: String,
    root_path: Option<String>,
    board_id: String,
) -> Result<DraftHistory, String> {
    let _guard = DRAFT_LOCK.lock().map_err(|e| e.to_string())?;
    read_history(&draft_dir(&app, &scope, root_path, &board_id)?, &board_id)
}

fn validate_update(
    current: &DraftHistory,
    next: &DraftHistory,
    expected_revision: u64,
) -> Result<(), String> {
    if current.revision != expected_revision {
        return Err("別の画面で中間稿が更新されています。編集内容をコピーしてから保存版を読み直してください。".into());
    }
    if next.schema_version != 1
        || next.board_id != current.board_id
        || next.versions.len() < current.versions.len()
    {
        return Err("中間稿の履歴が不正です".into());
    }
    for (index, version) in next.versions.iter().enumerate() {
        let ids: HashSet<_> = version.cards.iter().map(|card| &card.id).collect();
        let order: HashSet<_> = version.order.iter().collect();
        let excluded: HashSet<_> = version.excluded.iter().collect();
        if version.version != index as u64 + 1
            || ids.len() != version.cards.len()
            || order.len() != version.order.len()
            || ids != order
            || excluded.len() != version.excluded.len()
            || !excluded.is_subset(&ids)
        {
            return Err("中間稿のカード順または版番号が不正です".into());
        }
        if let Some(old) = current.versions.get(index) {
            let mut comparable = version.clone();
            if index + 1 == current.versions.len() {
                comparable.text = old.text.clone();
                comparable.updated_at = old.updated_at;
            }
            if &comparable != old {
                return Err("過去版や取得時のカード情報は上書きできません".into());
            }
        }
    }
    Ok(())
}

fn atomic_write(path: &Path, text: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&temp, path).map_err(|e| e.to_string())
}

fn save_history(
    dir: &Path,
    board_id: &str,
    mut history: DraftHistory,
    expected_revision: u64,
) -> Result<u64, String> {
    let current = read_history(dir, board_id)?;
    validate_update(&current, &history, expected_revision)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    history.revision = current.revision + 1;
    // UTF-8 text files are directly readable outside Then. history.json is the recovery source
    // if a crash occurs between text writes and committing the revision.
    for version in &history.versions {
        if current.versions.get(version.version as usize - 1) != Some(version) {
            atomic_write(
                &dir.join(format!("v{}.txt", version.version)),
                &version.text,
            )?;
        }
    }
    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    atomic_write(&dir.join("history.json"), &json)?;
    Ok(history.revision)
}

#[tauri::command]
pub fn save_intermediate_draft(
    app: tauri::AppHandle,
    scope: String,
    root_path: Option<String>,
    board_id: String,
    history: DraftHistory,
    expected_revision: u64,
) -> Result<u64, String> {
    let _guard = DRAFT_LOCK.lock().map_err(|e| e.to_string())?;
    save_history(
        &draft_dir(&app, &scope, root_path, &board_id)?,
        &board_id,
        history,
        expected_revision,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> DraftHistory {
        DraftHistory {
            schema_version: 1,
            board_id: "board".into(),
            revision: 0,
            versions: vec![DraftVersion {
                version: 1,
                captured_at: 1,
                board_updated_at: 1,
                created_at: 2,
                updated_at: 2,
                cards: vec![DraftCard {
                    id: "a".into(),
                    text: "原本".into(),
                }],
                order: vec!["a".into()],
                excluded: vec![],
                text: "原本".into(),
            }],
        }
    }
    #[test]
    fn round_trip_text_history_and_conflict() {
        let dir = std::env::temp_dir().join(format!(
            "then-draft-test-{}-{}",
            std::process::id(),
            super::super::now_millis()
        ));
        let first = sample();
        assert_eq!(save_history(&dir, "board", first.clone(), 0).unwrap(), 1);
        let mut edited = read_history(&dir, "board").unwrap();
        edited.versions[0].text = "編集した文章\n次の段落".into();
        assert_eq!(save_history(&dir, "board", edited.clone(), 1).unwrap(), 2);
        assert_eq!(
            std::fs::read_to_string(dir.join("v1.txt")).unwrap(),
            edited.versions[0].text
        );
        assert!(save_history(&dir, "board", first, 1).is_err());
        let mut next = edited.clone();
        let mut second = sample().versions.remove(0);
        second.version = 2;
        next.versions.push(second);
        assert_eq!(save_history(&dir, "board", next.clone(), 2).unwrap(), 3);
        next.versions[0].text = "過去版の改変".into();
        assert!(save_history(&dir, "board", next, 3).is_err());
        assert_eq!(
            read_history(&dir, "board").unwrap().versions[0].text,
            edited.versions[0].text
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn board_trash_restore_and_failed_move_preserve_history() {
        let dir = std::env::temp_dir().join(format!(
            "then-draft-trash-test-{}-{}",
            std::process::id(),
            super::super::now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let board = dir.join("board.canvas");
        let drafts = dir.join("drafts").join("board");
        std::fs::write(&board, "{}").unwrap();
        save_history(&drafts, "board", sample(), 0).unwrap();
        let trash = dir.join("trash.canvas");
        let trash_draft = dir.join("trash.draft");
        move_board_with_draft(&board, &trash, &drafts, &trash_draft).unwrap();
        assert!(!board.exists());
        assert!(!drafts.exists());
        assert_eq!(
            read_history(&trash_draft, "board").unwrap().versions.len(),
            1
        );
        let restored = dir.join("renamed.canvas");
        let restored_draft = dir.join("drafts").join("renamed");
        move_board_with_draft(&trash, &restored, &trash_draft, &restored_draft).unwrap();
        assert_eq!(
            read_history(&restored_draft, "renamed").unwrap().board_id,
            "renamed"
        );
        assert!(move_board_with_draft(
            &dir.join("missing.canvas"),
            &trash,
            &restored_draft,
            &trash_draft
        )
        .is_err());
        assert!(restored_draft.join("history.json").is_file());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn reject_invalid_order_and_snapshot_changes() {
        let current = sample();
        let mut next = current.clone();
        next.versions[0].order.push("a".into());
        assert!(validate_update(&current, &next, 0).is_err());
        next = current.clone();
        next.versions[0].cards[0].text = "changed".into();
        assert!(validate_update(&current, &next, 0).is_err());
        next = current.clone();
        next.versions[0].excluded.push("missing".into());
        assert!(validate_update(&current, &next, 0).is_err());
    }
    #[test]
    fn legacy_history_without_excluded_cards_still_loads() {
        let mut value = serde_json::to_value(sample()).unwrap();
        value["versions"][0]
            .as_object_mut()
            .unwrap()
            .remove("excluded");
        let restored: DraftHistory = serde_json::from_value(value).unwrap();
        assert!(restored.versions[0].excluded.is_empty());
    }
}
