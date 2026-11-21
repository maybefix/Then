//! 中間稿の移行（BINDER 4-4b）を、一時フォルダに作った作品で動かして確かめる。

use super::super::project_state::{load_project_config, project_config_path};
use super::{fail_at, migrate_drafts, note_name, DraftRecovery};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

struct TempWork(PathBuf);

impl TempWork {
    fn new(label: &str, materials: Option<&str>) -> Self {
        let path = std::env::temp_dir().join(format!(
            "then-draft-migration-{label}-{}-{}",
            std::process::id(),
            super::super::now_millis()
        ));
        std::fs::create_dir_all(path.join(".then").join("boards")).unwrap();
        let mut config = json!({});
        if let Some(name) = materials {
            std::fs::create_dir_all(path.join(name)).unwrap();
            config["materialsFolder"] = json!(name);
        }
        std::fs::write(project_config_path(&path), serde_json::to_string_pretty(&config).unwrap()).unwrap();
        Self(path)
    }
    fn boards(&self) -> PathBuf {
        self.0.join(".then").join("boards")
    }
    fn board(&self, id: &str, name: &str) {
        std::fs::write(self.boards().join(format!("{id}.canvas")), json!({ "nodes": [], "edges": [], "then": { "name": name } }).to_string()).unwrap();
    }
    fn trashed_board(&self, trash_id: &str, name: &str) {
        let trash = self.boards().join(".trash");
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join(format!("{trash_id}.canvas")), json!({ "nodes": [], "edges": [], "then": { "name": name } }).to_string()).unwrap();
    }
    fn read(&self, relative: &str) -> String {
        std::fs::read_to_string(self.0.join(relative)).unwrap()
    }
}

impl Drop for TempWork {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn version(number: u64, text: &str) -> Value {
    json!({ "version": number, "capturedAt": 1, "boardUpdatedAt": 1, "createdAt": 2, "updatedAt": 2,
        "cards": [{ "id": "a", "text": text }], "order": ["a"], "excluded": [], "text": text })
}

fn write_history(dir: &Path, board_id: &str, texts: &[&str]) {
    std::fs::create_dir_all(dir).unwrap();
    let versions: Vec<Value> = texts.iter().enumerate().map(|(index, text)| version(index as u64 + 1, text)).collect();
    for (index, text) in texts.iter().enumerate() {
        std::fs::write(dir.join(format!("v{}.txt", index + 1)), text).unwrap();
    }
    std::fs::write(
        dir.join("history.json"),
        serde_json::to_string_pretty(&json!({ "schemaVersion": 1, "boardId": board_id, "revision": texts.len(), "versions": versions })).unwrap(),
    )
    .unwrap();
}

fn draft_dir(work: &TempWork, board_id: &str) -> PathBuf {
    work.boards().join(".intermediate-drafts").join(board_id)
}

fn result_json(work: &TempWork, recoveries: &[DraftRecovery]) -> Value {
    serde_json::to_value(migrate_drafts(&work.0, recoveries).unwrap()).unwrap()
}

#[test]
fn latest_version_becomes_a_note_and_the_drafts_are_backed_up_then_removed() {
    let work = TempWork::new("latest", Some("素材"));
    work.board("harbor", "港の場面");
    write_history(&draft_dir(&work, "harbor"), "harbor", &["最初の版", "直した版\n\n次の段落"]);
    let before = std::fs::read(draft_dir(&work, "harbor").join("history.json")).unwrap();

    let result = result_json(&work, &[]);
    assert_eq!(result["status"], "migrated");
    assert_eq!(result["notes"], json!(["素材/港の場面の中間稿.md"]));
    assert_eq!(work.read("素材/港の場面の中間稿.md"), "直した版\n\n次の段落", "最新版の本文を1文字も変えずに書く");
    assert!(!work.boards().join(".intermediate-drafts").exists(), "中間稿のフォルダは消える");
    let backup = work.0.join(result["backupPath"].as_str().unwrap());
    assert!(result["backupPath"].as_str().unwrap().starts_with(".then/backups/intermediate-drafts-"));
    assert_eq!(std::fs::read(backup.join("drafts").join("harbor").join("history.json")).unwrap(), before);
    assert_eq!(std::fs::read_to_string(backup.join("drafts").join("harbor").join("v1.txt")).unwrap(), "最初の版");

    assert_eq!(result_json(&work, &[])["status"], "empty", "2回目は何もしない");
}

#[test]
fn names_collide_and_same_content_is_reused() {
    let work = TempWork::new("names", Some("素材"));
    work.board("one", "夜");
    work.board("two", "夜");
    std::fs::write(work.0.join("素材").join("夜の中間稿.md"), "別のノート").unwrap();
    write_history(&draft_dir(&work, "one"), "one", &["一つ目"]);
    write_history(&draft_dir(&work, "two"), "two", &["二つ目"]);
    let result = result_json(&work, &[]);
    assert_eq!(result["notes"], json!(["素材/夜の中間稿-2.md", "素材/夜の中間稿-3.md"]));
    assert_eq!(work.read("素材/夜の中間稿.md"), "別のノート");
    assert_eq!(work.read("素材/夜の中間稿-2.md"), "一つ目");

    // 前回ノートを書いたあとで止まった（中間稿が残っている）ときは、同じ中身のノートを使う。
    write_history(&draft_dir(&work, "one"), "one", &["一つ目"]);
    let again = result_json(&work, &[]);
    assert_eq!(again["notes"], json!(["素材/夜の中間稿-2.md"]));
    assert!(!work.0.join("素材").join("夜の中間稿-4.md").exists());
}

#[test]
fn a_work_without_materials_gets_a_materials_folder() {
    let work = TempWork::new("materials", None);
    std::fs::create_dir_all(work.0.join("素材")).unwrap(); // 登録されていない普通のフォルダ（原稿）
    work.board("b", "章立て");
    write_history(&draft_dir(&work, "b"), "b", &["本文"]);
    let result = result_json(&work, &[]);
    assert_eq!(result["notes"], json!(["素材-2/章立ての中間稿.md"]));
    assert_eq!(load_project_config(&work.0).unwrap().materials_folder.as_deref(), Some("素材-2"));
}

#[test]
fn missing_and_trashed_boards_and_empty_text() {
    let work = TempWork::new("orphans", Some("素材"));
    write_history(&draft_dir(&work, "gone-board"), "gone-board", &["消えたボードの稿"]);
    work.board("blank", "空");
    write_history(&draft_dir(&work, "blank"), "blank", &["文", "  \n "]);
    work.trashed_board("1700000000000--old", "古い構想");
    write_history(&work.boards().join(".trash").join("1700000000000--old.draft"), "old", &["ゴミ箱の稿"]);

    let result = result_json(&work, &[]);
    assert_eq!(result["notes"], json!(["素材/gone-boardの中間稿.md", "素材/古い構想の中間稿.md"]), "空の最新版はノートにしない");
    assert_eq!(work.read("素材/古い構想の中間稿.md"), "ゴミ箱の稿");
    assert!(!work.boards().join(".trash").join("1700000000000--old.draft").exists());
    assert!(work.boards().join(".trash").join("1700000000000--old.canvas").is_file(), "ゴミ箱のボードはそのまま");
    let backup = work.0.join(result["backupPath"].as_str().unwrap());
    assert!(backup.join("trash").join("1700000000000--old.draft").join("history.json").is_file());
    assert!(backup.join("trash").join("1700000000000--old.canvas").is_file());
    assert!(backup.join("drafts").join("blank").join("v2.txt").is_file(), "ノートにしなかった稿もバックアップに残る");
}

#[test]
fn recovery_text_wins_and_is_backed_up() {
    let work = TempWork::new("recovery", Some("素材"));
    work.board("live", "生きている");
    write_history(&draft_dir(&work, "live"), "live", &["保存版"]);
    work.board("unsaved", "未保存");
    let recoveries = vec![
        DraftRecovery { board_id: "live".into(), text: "閉じる前の文".into(), raw: json!({ "expectedRevision": 1 }) },
        DraftRecovery { board_id: "unsaved".into(), text: "保存前の文".into(), raw: json!(null) },
    ];
    let result = result_json(&work, &recoveries);
    assert_eq!(work.read("素材/生きているの中間稿.md"), "閉じる前の文");
    assert_eq!(work.read("素材/未保存の中間稿.md"), "保存前の文");
    let backup = work.0.join(result["backupPath"].as_str().unwrap());
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(backup.join("recovery.json")).unwrap()).unwrap();
    assert_eq!(saved[0]["entry"]["expectedRevision"], 1);
}

#[test]
fn broken_history_falls_back_to_the_newest_text_file() {
    let work = TempWork::new("broken", Some("素材"));
    work.board("b", "壊れた");
    let dir = draft_dir(&work, "b");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("history.json"), "{ broken").unwrap();
    std::fs::write(dir.join("v2.txt"), "二").unwrap();
    std::fs::write(dir.join("v10.txt"), "十").unwrap();
    result_json(&work, &[]);
    assert_eq!(work.read("素材/壊れたの中間稿.md"), "十");
}

#[test]
fn a_failure_keeps_the_drafts_and_removes_what_this_run_made() {
    let work = TempWork::new("failure", None);
    work.board("b", "失敗");
    write_history(&draft_dir(&work, "b"), "b", &["残る"]);
    for step in ["note", "save"] {
        fail_at(Some(step));
        assert!(migrate_drafts(&work.0, &[]).is_err(), "{step}");
        fail_at(None);
        assert!(draft_dir(&work, "b").join("history.json").is_file(), "{step}: 中間稿は消さない");
        assert!(!work.0.join("素材").exists(), "{step}: 作ったフォルダを消す");
        assert_eq!(load_project_config(&work.0).unwrap().materials_folder, None);
    }
    assert_eq!(result_json(&work, &[])["notes"], json!(["素材/失敗の中間稿.md"]), "次に開いたときにやり直せる");
}

#[test]
fn nothing_to_move_writes_nothing() {
    let work = TempWork::new("empty", None);
    let config = std::fs::read(project_config_path(&work.0)).unwrap();
    assert_eq!(result_json(&work, &[])["status"], "empty");
    assert!(!work.0.join(".then").join("backups").exists());
    assert_eq!(std::fs::read(project_config_path(&work.0)).unwrap(), config);
}

#[test]
fn note_names_drop_characters_files_cannot_have() {
    assert_eq!(note_name(Some("章/1: 始まり?"), "id"), "章1 始まりの中間稿");
    assert_eq!(note_name(Some(" ... "), "board-id"), "board-idの中間稿");
    assert_eq!(note_name(None, "x"), "xの中間稿");
    assert_eq!(note_name(Some("終わり."), "id"), "終わりの中間稿");
}
