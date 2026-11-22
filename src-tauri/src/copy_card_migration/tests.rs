//! コピーのカードの移行（BINDER 4-5）を、一時フォルダに作ったライブラリで動かして確かめる。
//! 場面の番号（S1〜S11）は docs/BINDER_COPY_CARD_MIGRATION_SCENARIOS.md と同じ。

use super::{fail_at, migrate_cards};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const NOTE: &str = "素材/場面： 港.md";
const POST_NOTE: &str = "素材/灯台の夢.md";

/// ライブラリと作品A。作品A は 2-4・2-5 の移行が済んだ形（記録・バックアップ・ノート・投稿）。
struct TempLibrary(PathBuf);

impl TempLibrary {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "then-copy-card-migration-{label}-{}-{}",
            std::process::id(),
            super::super::now_millis()
        ));
        let library = Self(path);
        write(&library.0.join(".then/library.json"), "{}");
        let work = library.work();
        let threads = json!([
            { "id": "idea-inbox", "kind": "inbox", "title": "インボックス", "fragments": [
                { "id": "f-dream", "body": "灯台の夢" },
                { "id": "f-used", "body": "使用済みの断片", "used": true }
            ] },
            { "id": "t-harbor", "kind": "thread", "title": "場面: 港", "fragments": [
                { "id": "f-1", "body": "港の場面の一" },
                { "id": "f-2", "body": "港の場面の二" },
                { "id": "f-3", "body": "Canvasから来た断片\r\n二行目" }
            ] }
        ]);
        write(&work.join(".then/backups/idea-1/project.json"), &json!({ "ideaThreads": threads }).to_string());
        let record = json!({
            "backupPath": ".then/backups/idea-1",
            "migratedAt": 1,
            "notes": [{ "threadId": "t-harbor", "path": NOTE }],
            "posts": 2,
            "fragments": [
                { "id": "f-1", "note": NOTE },
                { "id": "f-2", "note": NOTE },
                { "id": "f-3", "note": NOTE },
                { "id": "f-dream", "post": "p-dream" },
                { "id": "f-used", "post": "p-used" },
                { "id": "f-gone-note", "note": "素材/消えたノート.md" }
            ]
        });
        write(
            &work.join(".then/project.json"),
            &json!({ "workId": "w-a", "materialsFolder": "素材", "ideaThreads": [], "ideaMigration": record }).to_string(),
        );
        write(&work.join(NOTE), "# 場面: 港\n\n港の場面の一\n\n港の場面の二\n\nCanvasから来た断片\n二行目\n");
        library
    }
    fn work(&self) -> PathBuf {
        self.0.join("作品A")
    }
    /// 投稿のファイル。`p-dream` をノートにしたかどうかを選ぶ。
    fn posts(&self, dream_noted_in: Option<&str>) {
        let mut dream = json!({ "v": 1, "id": "p-dream", "at": "2026-07-01T10:00:00+09:00", "body": "灯台の夢",
            "work": { "id": "w-a", "name": "作品A" } });
        if let Some(work) = dream_noted_in {
            dream["note"] = json!({ "work": work, "path": POST_NOTE });
            write(&self.work().join(POST_NOTE), "# 灯台の夢\n\n灯台の夢\n");
        }
        let used = json!({ "v": 1, "id": "p-used", "at": "2026-07-01T10:00:00+09:00", "body": "使用済みの断片", "filed": true });
        write(&self.0.join(".then/posts.jsonl"), &format!("{dream}\n{used}\n"));
    }
    fn board(&self, root: &Path, id: &str, nodes: Value, edges: Value) -> PathBuf {
        let path = root.join(".then/boards").join(format!("{id}.canvas"));
        write(&path, &serde_json::to_string_pretty(&json!({ "nodes": nodes, "edges": edges, "then": { "version": 1, "name": id, "updatedAt": 1 } })).unwrap());
        path
    }
}

impl Drop for TempLibrary {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn copy(id: &str, text: &str, fragment: &str) -> Value {
    json!({ "id": id, "type": "text", "x": 10, "y": 20, "width": 260, "height": 150, "text": text,
        "writingMode": "vertical-rl",
        "thenOrigin": { "source": "idea", "sourceId": fragment, "sourceThreadId": "t-harbor",
            "sourceWorkspacePath": "C:\\古い場所\\作品A", "copiedAt": 1 } })
}

fn backups(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root.join(".then/backups")) else { return Vec::new() };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.file_name().unwrap().to_string_lossy().starts_with("copy-cards-"))
        .collect();
    found.sort();
    found
}

#[test]
fn s1_s7_a_card_whose_text_is_unchanged_becomes_the_note_card_keeping_id_place_colour_and_arrows() {
    let library = TempLibrary::new("s1");
    let work = library.work();
    let mut card = copy("c1", "港の場面の一", "f-1");
    card["color"] = json!("3");
    card["title"] = json!("題");
    let child = json!({ "id": "child", "type": "text", "x": 10, "y": 200, "width": 260, "height": 150, "text": "港の補足",
        "threadParentId": "c1", "threadOrder": 0 });
    let foreign = json!({ "id": "link", "type": "link", "x": 0, "y": 0, "width": 100, "height": 100, "url": "https://example.com" });
    let other = json!({ "id": "plain", "type": "text", "x": 400, "y": 20, "width": 260, "height": 150, "text": "ふつうのカード" });
    let edge = json!({ "id": "e1", "fromNode": "c1", "toNode": "plain", "connector": "arrow" });
    let board = library.board(&work, "harbor", json!([card, child, other, foreign]), json!([edge]));

    let result = migrate_cards(&work).expect("migrate");
    assert_eq!(result.status, "migrated");
    assert_eq!(result.replaced, 1);
    assert_eq!(result.boards, vec!["harbor"]);

    let after = read_json(&board);
    assert_eq!(
        after["nodes"][0],
        json!({ "id": "c1", "type": "file", "x": 10, "y": 20, "width": 260, "height": 150, "file": NOTE, "color": "3" }),
        "same id, place, size and colour; text, title, writing mode and origin are not kept on the file card"
    );
    assert!(after["nodes"][1].get("threadParentId").is_none(), "S7: the child leaves the thread");
    assert!(after["nodes"][1].get("threadOrder").is_none());
    assert_eq!(after["nodes"][1]["text"], "港の補足", "S7: the child stays where it is with its text");
    assert_eq!(after["nodes"][2], other, "other cards are untouched");
    assert_eq!(after["nodes"][3], foreign, "cards Then cannot read are kept as they were");
    assert_eq!(after["edges"], json!([edge]), "arrows stay");
    assert_eq!(after["then"]["name"], "harbor");

    // バックアップ: 書き換える前のボードと、置き換えたカードの一覧。
    let backup = &backups(&work)[0];
    assert_eq!(result.backup_path.as_deref(), Some(super::relative_slash_path(&work, backup).as_str()));
    let saved = read_json(&backup.join("boards/harbor.canvas"));
    assert_eq!(saved["nodes"][0]["text"], "港の場面の一", "the backup has the board as it was");
    let list = read_json(&backup.join("cards.json"));
    assert_eq!(list["cards"], json!([{ "board": "harbor.canvas", "card": "c1", "fragment": "f-1", "file": NOTE }]));
}

#[test]
fn line_endings_alone_do_not_count_as_an_edit() {
    let library = TempLibrary::new("crlf");
    let work = library.work();
    let board = library.board(&work, "b", json!([copy("c3", "Canvasから来た断片\n二行目", "f-3")]), json!([]));
    assert_eq!(migrate_cards(&work).unwrap().replaced, 1);
    assert_eq!(read_json(&board)["nodes"][0]["type"], "file");
}

#[test]
fn cards_that_are_not_replaced_leave_the_board_file_byte_for_byte() {
    let library = TempLibrary::new("kept");
    library.posts(None);
    let work = library.work();
    let nodes = json!([
        copy("s2", "港の場面の一（波止場で）", "f-1"), // S2: カードで直した
        copy("s3", "消した断片", "f-deleted"),         // S3: 記録にない
        copy("s4", "灯台の夢", "f-dream"),            // S4: 投稿のまま
        copy("used", "使用済みの断片", "f-used"),      // S4: 受信箱から外した投稿（手元の Books の2枚）
        copy("gone", "消えたノートの断片", "f-gone-note"), // ノートが今はない
        // S11: ドラッグで作ったコピー（元の印がない）。文は断片と同じ。
        json!({ "id": "s11", "type": "text", "x": 0, "y": 0, "width": 260, "height": 150, "text": "港の場面の二" }),
        // スレッドを送った枠（グループにも元の印がある）
        json!({ "id": "g", "type": "group", "x": 0, "y": 0, "width": 600, "height": 300, "label": "場面: 港",
            "thenOrigin": { "source": "idea", "sourceId": "t-harbor", "sourceThreadId": "t-harbor", "sourceWorkspacePath": "", "copiedAt": 1 } })
    ]);
    let board = library.board(&work, "kept", nodes, json!([]));
    let before = std::fs::read(&board).unwrap();
    let result = migrate_cards(&work).unwrap();
    assert_eq!(result.status, "empty");
    assert_eq!(result.replaced, 0);
    assert_eq!(std::fs::read(&board).unwrap(), before, "nothing is written");
    assert!(backups(&work).is_empty(), "no backup when nothing changes");
}

#[test]
fn s5_a_post_made_into_a_note_of_the_same_work_points_to_that_note() {
    let library = TempLibrary::new("s5");
    library.posts(Some("w-a"));
    let work = library.work();
    let board = library.board(&work, "b", json!([copy("s5", "灯台の夢", "f-dream")]), json!([]));
    assert_eq!(migrate_cards(&work).unwrap().replaced, 1);
    assert_eq!(read_json(&board)["nodes"][0]["file"], POST_NOTE);
}

#[test]
fn a_post_made_into_a_note_of_another_work_stays_text() {
    let library = TempLibrary::new("s5-other");
    library.posts(Some("w-other"));
    let work = library.work();
    let board = library.board(&work, "b", json!([copy("s5", "灯台の夢", "f-dream")]), json!([]));
    let before = std::fs::read(&board).unwrap();
    assert_eq!(migrate_cards(&work).unwrap().status, "empty");
    assert_eq!(std::fs::read(&board).unwrap(), before);
}

#[test]
fn s6_two_cards_going_to_the_same_note_both_stay_text() {
    let library = TempLibrary::new("s6");
    let work = library.work();
    // 片方は文を直してある（置き換えの条件を満たすのは1枚だけ）が、同じノートへ行くカードが2枚なので両方残す。
    let nodes = json!([copy("a", "港の場面の一", "f-1"), copy("b", "港の場面の二（直した）", "f-2")]);
    let board = library.board(&work, "s6", nodes, json!([{ "id": "e", "fromNode": "a", "toNode": "b" }]));
    let before = std::fs::read(&board).unwrap();
    assert_eq!(migrate_cards(&work).unwrap().status, "empty");
    assert_eq!(std::fs::read(&board).unwrap(), before);
}

#[test]
fn a_board_that_already_has_a_card_for_the_note_keeps_the_copy_as_text() {
    let library = TempLibrary::new("existing");
    let work = library.work();
    // 置き換え済みのカード（区切りが \ でも同じノート）と、あとから戻ってきたコピーのカード（実機確認の c-new）。
    let existing = json!({ "id": "done", "type": "file", "x": 0, "y": 0, "width": 260, "height": 150, "file": "素材\\場面： 港.md" });
    let board = library.board(&work, "b", json!([existing, copy("again", "港の場面の二", "f-2")]), json!([]));
    let before = std::fs::read(&board).unwrap();
    assert_eq!(migrate_cards(&work).unwrap().status, "empty");
    assert_eq!(std::fs::read(&board).unwrap(), before, "the same note is not shown twice");

    // ほかのノートのファイルのカードは数えない。
    let other = json!({ "id": "other", "type": "file", "x": 0, "y": 0, "width": 260, "height": 150, "file": "素材/別.md" });
    let board = library.board(&work, "c", json!([other, copy("only", "港の場面の一", "f-1")]), json!([]));
    assert_eq!(migrate_cards(&work).unwrap().replaced, 1);
    assert_eq!(read_json(&board)["nodes"][1]["file"], NOTE);
}

#[test]
fn each_board_is_judged_on_its_own() {
    let library = TempLibrary::new("boards");
    let work = library.work();
    let first = library.board(&work, "first", json!([copy("a", "港の場面の一", "f-1")]), json!([]));
    let second = library.board(&work, "second", json!([copy("b", "港の場面の二", "f-2")]), json!([]));
    let result = migrate_cards(&work).unwrap();
    assert_eq!(result.replaced, 2);
    assert_eq!(result.boards, vec!["first", "second"]);
    assert_eq!(read_json(&first)["nodes"][0]["file"], NOTE);
    assert_eq!(read_json(&second)["nodes"][0]["file"], NOTE);
}

#[test]
fn the_second_run_changes_nothing() {
    let library = TempLibrary::new("twice");
    let work = library.work();
    let board = library.board(&work, "b", json!([copy("a", "港の場面の一", "f-1"), copy("s3", "消した断片", "f-deleted")]), json!([]));
    assert_eq!(migrate_cards(&work).unwrap().replaced, 1);
    let after_first = std::fs::read(&board).unwrap();
    let second = migrate_cards(&work).unwrap();
    assert_eq!(second.status, "empty");
    assert_eq!(std::fs::read(&board).unwrap(), after_first);
    assert_eq!(backups(&work).len(), 1, "no second backup");
}

#[test]
fn a_failure_while_writing_puts_every_board_back() {
    let library = TempLibrary::new("fail");
    let work = library.work();
    let first = library.board(&work, "first", json!([copy("a", "港の場面の一", "f-1")]), json!([]));
    let second = library.board(&work, "second", json!([copy("b", "港の場面の二", "f-2")]), json!([]));
    let (before_first, before_second) = (std::fs::read(&first).unwrap(), std::fs::read(&second).unwrap());
    fail_at(Some("board"));
    let result = migrate_cards(&work);
    fail_at(None);
    assert!(result.is_err());
    assert_eq!(std::fs::read(&first).unwrap(), before_first);
    assert_eq!(std::fs::read(&second).unwrap(), before_second);
    // 次の回でやり直せる。
    assert_eq!(migrate_cards(&work).unwrap().replaced, 2);
}

#[test]
fn s10_boards_in_the_trash_are_left_alone() {
    let library = TempLibrary::new("s10");
    let work = library.work();
    let trash = work.join(".then/boards/.trash/1700000000000--old.canvas");
    write(&trash, &json!({ "nodes": [copy("a", "港の場面の一", "f-1")], "edges": [] }).to_string());
    let before = std::fs::read(&trash).unwrap();
    assert_eq!(migrate_cards(&work).unwrap().status, "empty");
    assert_eq!(std::fs::read(&trash).unwrap(), before);
}

#[test]
fn s8_a_library_root_board_does_not_reach_into_a_work() {
    let library = TempLibrary::new("s8");
    write(&library.0.join(".then/project.json"), &json!({}).to_string());
    let board = library.board(&library.0, "root", json!([copy("a", "港の場面の一", "f-1")]), json!([]));
    let before = std::fs::read(&board).unwrap();
    assert_eq!(migrate_cards(&library.0).unwrap().status, "empty");
    assert_eq!(std::fs::read(&board).unwrap(), before);
}

#[test]
fn works_without_boards_records_or_readable_boards_are_skipped() {
    let library = TempLibrary::new("none");
    let work = library.work();
    assert_eq!(migrate_cards(&work).unwrap().status, "empty", "no boards");
    let broken = work.join(".then/boards/broken.canvas");
    write(&broken, "{ not json");
    assert_eq!(migrate_cards(&work).unwrap().status, "empty", "a broken board is not touched");
    assert_eq!(std::fs::read_to_string(&broken).unwrap(), "{ not json");

    let fresh = library.0.join("作品B");
    write(&fresh.join(".then/project.json"), "{}");
    library.board(&fresh, "b", json!([copy("a", "港の場面の一", "f-1")]), json!([]));
    assert_eq!(migrate_cards(&fresh).unwrap().status, "empty", "no migration record");
}
