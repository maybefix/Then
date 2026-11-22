//! U5: 素材のノート・画像・PDF を、ほかの作品・ライブラリ直下へ送る（docs/BINDER_REMAINING_PLAN.md）。

use super::super::{library, now_millis, project_state::load_project_config};
use super::{transfer_entries, undo_transfer, TransferredEntry};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

struct TempLibrary(PathBuf);

impl Drop for TempLibrary {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Shelf {
    _dir: TempLibrary,
    library: PathBuf,
    a: PathBuf,
    b: PathBuf,
}

fn write(root: &Path, relative: &str, content: &[u8]) {
    let path = relative.split('/').fold(root.to_path_buf(), |path, part| path.join(part));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn p(root: &Path, relative: &str) -> PathBuf {
    relative.split('/').fold(root.to_path_buf(), |path, part| path.join(part))
}

fn s(root: &Path, relative: &str) -> String {
    p(root, relative).to_string_lossy().to_string()
}

fn set_config(root: &Path, value: Value) {
    write(root, ".then/project.json", value.to_string().as_bytes());
}

/// ライブラリ「本棚」に作品A（素材あり）と作品B（素材に同じ名前の「汐見.md」）。作品C は素材フォルダなし。
fn shelf(label: &str) -> Shelf {
    let dir = TempLibrary(std::env::temp_dir().join(format!("then-entry-transfer-{label}-{}-{}", std::process::id(), now_millis())));
    std::fs::create_dir_all(&dir.0).unwrap();
    let library = PathBuf::from(library::create_library_folder(&dir.0, "lib", "本棚").unwrap());
    let a = PathBuf::from(library::create_library_project(&library, "作品A").unwrap());
    let b = PathBuf::from(library::create_library_project(&library, "作品B").unwrap());
    set_config(&a, json!({
        "schemaVersion": 1, "materialsFolder": "素材",
        "order": { "素材": ["灯台.md", "汐見.md", "資料"] },
        "fileProgress": { "素材/灯台.md": { "status": "writing", "updatedAt": 1 } },
        "noteStars": { "素材/灯台.md": 5 }
    }));
    write(&a, "素材/灯台.md", "# 灯台\n[[汐見]]\n".as_bytes());
    write(&a, "素材/汐見.md", "# 汐見\n@[[素材/資料/地図.pdf]]\n".as_bytes());
    write(&a, "素材/資料/港.png", b"\x89PNG\r\n\x1a\nport");
    write(&a, "素材/資料/地図.pdf", b"%PDF-1.4\nmap");
    write(&a, "本編.md", "# 本編\n".as_bytes());
    set_config(&b, json!({ "schemaVersion": 1, "materialsFolder": "素材" }));
    write(&b, "素材/汐見.md", "# 別の汐見\n".as_bytes());
    write(&library, "共通メモ.md", "# 共通\n".as_bytes());
    write(&library, "資料/表紙案.png", b"\x89PNG\r\n\x1a\ncover");
    Shelf { _dir: dir, library, a, b }
}

fn order(root: &Path, key: &str) -> Vec<String> {
    load_project_config(root).unwrap().order.get(key).cloned().unwrap_or_default()
}

fn no_trash(_: &Path, _: &Path) -> Result<(), String> {
    Err("no trash in tests".to_string())
}

#[test]
fn moves_a_note_to_another_work_with_its_order_and_progress() {
    let shelf = shelf("move");
    let result = transfer_entries(&shelf.a, &shelf.b, &[s(&shelf.a, "素材/灯台.md")], true).unwrap();
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].new_path, s(&shelf.b, "素材/灯台.md"));
    assert_eq!(result.entries[0].kind, "text");
    assert_eq!(result.entries[0].source_order_index, Some(0));
    assert!(!p(&shelf.a, "素材/灯台.md").exists());
    assert_eq!(std::fs::read_to_string(p(&shelf.b, "素材/灯台.md")).unwrap(), "# 灯台\n[[汐見]]\n");
    assert_eq!(order(&shelf.a, "素材"), vec!["汐見.md", "資料"]);
    assert!(order(&shelf.b, "素材").contains(&"灯台.md".to_string()));
    let progress_a = load_project_config(&shelf.a).unwrap().file_progress;
    let progress_b = load_project_config(&shelf.b).unwrap().file_progress;
    assert!(!progress_a.contains_key("素材/灯台.md"));
    assert_eq!(progress_b.get("素材/灯台.md").map(|item| item.status.as_str()), Some("writing"));
    // U10: スターも持っていく。
    assert!(load_project_config(&shelf.a).unwrap().note_stars.is_empty());
    assert_eq!(load_project_config(&shelf.b).unwrap().note_stars.get("素材/灯台.md"), Some(&5));
}

#[test]
fn a_name_already_in_the_destination_gets_a_number() {
    let shelf = shelf("collision");
    let result = transfer_entries(&shelf.a, &shelf.b, &[s(&shelf.a, "素材/汐見.md")], false).unwrap();
    assert_eq!(result.entries[0].new_path, s(&shelf.b, "素材/汐見-2.md"));
    assert_eq!(std::fs::read_to_string(p(&shelf.b, "素材/汐見.md")).unwrap(), "# 別の汐見\n");
    assert!(p(&shelf.a, "素材/汐見.md").is_file(), "a copy leaves the source");
    assert_eq!(order(&shelf.a, "素材"), vec!["灯台.md", "汐見.md", "資料"]);
}

#[test]
fn images_go_to_the_references_folder_and_a_missing_materials_folder_is_made() {
    let shelf = shelf("images");
    let c = PathBuf::from(library::create_library_project(&shelf.library, "作品C").unwrap());
    let result = transfer_entries(
        &shelf.a,
        &c,
        &[s(&shelf.a, "素材/資料/港.png"), s(&shelf.a, "素材/汐見.md")],
        true,
    )
    .unwrap();
    assert_eq!(result.created_materials_folder.as_deref(), Some("素材"));
    assert_eq!(result.entries[0].new_path, s(&c, "素材/資料/港.png"));
    assert_eq!(result.entries[0].kind, "material");
    assert_eq!(result.entries[1].new_path, s(&c, "素材/汐見.md"));
    assert_eq!(load_project_config(&c).unwrap().materials_folder.as_deref(), Some("素材"));
    assert!(!p(&shelf.a, "素材/資料/港.png").exists());
}

#[test]
fn sends_between_the_library_root_and_a_work() {
    let shelf = shelf("root");
    let to_work = transfer_entries(
        &shelf.library,
        &shelf.a,
        &[s(&shelf.library, "共通メモ.md"), s(&shelf.library, "資料/表紙案.png")],
        false,
    )
    .unwrap();
    assert_eq!(to_work.entries[0].new_path, s(&shelf.a, "素材/共通メモ.md"));
    assert_eq!(to_work.entries[1].new_path, s(&shelf.a, "素材/資料/表紙案.png"));
    let to_root = transfer_entries(&shelf.a, &shelf.library, &[s(&shelf.a, "素材/資料/地図.pdf"), s(&shelf.a, "素材/灯台.md")], true).unwrap();
    assert_eq!(to_root.entries[0].new_path, s(&shelf.library, "資料/地図.pdf"));
    assert_eq!(to_root.entries[1].new_path, s(&shelf.library, "灯台.md"));
}

#[test]
fn refuses_manuscripts_folders_app_files_other_libraries_and_the_same_place() {
    let shelf = shelf("refuse");
    let only = |path: &str| transfer_entries(&shelf.a, &shelf.b, &[s(&shelf.a, path)], true);
    assert!(only("本編.md").is_err(), "a manuscript stays in its work");
    assert!(only("素材").is_err(), "folders are not sent");
    write(&shelf.a, ".then/memo.md", b"x");
    assert!(only(".then/memo.md").is_err());
    assert!(transfer_entries(&shelf.a, &shelf.a, &[s(&shelf.a, "素材/灯台.md")], true).is_err());
    assert!(transfer_entries(&shelf.library, &shelf.b, &[s(&shelf.a, "素材/灯台.md")], true).is_err(), "a work's file is not the root's");
    write(&shelf.library, "散らばり.png", b"\x89PNG");
    assert!(transfer_entries(&shelf.library, &shelf.b, &[s(&shelf.library, "散らばり.png")], true).is_err());
    assert!(p(&shelf.a, "素材/灯台.md").is_file(), "nothing moved");
    assert!(!p(&shelf.b, "素材/灯台.md").exists());
}

#[test]
fn a_failure_part_way_puts_everything_back() {
    let shelf = shelf("rollback");
    let before_a = std::fs::read(p(&shelf.a, ".then/project.json")).unwrap();
    // 2つ目は読めない名前にして、1つ目を動かしたあとで止める。
    let result = transfer_entries(
        &shelf.a,
        &shelf.b,
        &[s(&shelf.a, "素材/灯台.md"), s(&shelf.a, "素材/ない.md")],
        true,
    );
    assert!(result.is_err());
    assert!(p(&shelf.a, "素材/灯台.md").is_file());
    assert!(!p(&shelf.b, "素材/灯台.md").exists());
    assert_eq!(std::fs::read(p(&shelf.a, ".then/project.json")).unwrap(), before_a);
}

#[test]
fn undo_puts_a_move_back_where_it_was_unless_the_copy_was_edited() {
    let shelf = shelf("undo");
    let moved = transfer_entries(&shelf.a, &shelf.b, &[s(&shelf.a, "素材/灯台.md")], true).unwrap();
    let undone = undo_transfer(&shelf.a, &shelf.b, &moved.entries, true, no_trash).unwrap();
    assert_eq!(undone.undone.len(), 1);
    assert!(p(&shelf.a, "素材/灯台.md").is_file());
    assert!(!p(&shelf.b, "素材/灯台.md").exists());
    assert_eq!(order(&shelf.a, "素材"), vec!["灯台.md", "汐見.md", "資料"]);
    assert!(load_project_config(&shelf.a).unwrap().file_progress.contains_key("素材/灯台.md"));
    assert_eq!(load_project_config(&shelf.a).unwrap().note_stars.get("素材/灯台.md"), Some(&5), "スターも戻る");
    assert!(load_project_config(&shelf.b).unwrap().note_stars.is_empty());
    assert!(!order(&shelf.b, "素材").contains(&"灯台.md".to_string()));

    let again = transfer_entries(&shelf.a, &shelf.b, &[s(&shelf.a, "素材/灯台.md")], true).unwrap();
    std::fs::write(p(&shelf.b, "素材/灯台.md"), "# 灯台\n直した\n").unwrap();
    let kept = undo_transfer(&shelf.a, &shelf.b, &again.entries, true, no_trash).unwrap();
    assert_eq!(kept, super::TransferUndoResult { undone: vec![], skipped: 1 });
    assert!(p(&shelf.b, "素材/灯台.md").is_file(), "an edited file stays where it was sent");
}

#[test]
fn undo_of_a_copy_sends_the_copy_to_the_trash() {
    let shelf = shelf("undo-copy");
    let copied = transfer_entries(&shelf.a, &shelf.b, &[s(&shelf.a, "素材/灯台.md")], false).unwrap();
    let trashed = std::cell::RefCell::new(Vec::<PathBuf>::new());
    let result = undo_transfer(&shelf.a, &shelf.b, &copied.entries, false, |_, path| {
        trashed.borrow_mut().push(path.to_path_buf());
        std::fs::remove_file(path).map_err(|error| error.to_string())
    })
    .unwrap();
    assert_eq!(result.undone.len(), 1);
    assert_eq!(trashed.borrow().as_slice(), &[p(&shelf.b, "素材/灯台.md")]);
    assert!(p(&shelf.a, "素材/灯台.md").is_file());
    assert!(!order(&shelf.b, "素材").contains(&"灯台.md".to_string()));
    let entry: &TransferredEntry = &copied.entries[0];
    assert_eq!(entry.source_order_index, None);
}
