//! BINDER 2-6: 素材の段の画像・PDF の改名・移動と、ボードの資料カードの付け替え。

use super::super::{move_project_entry, rename_project_entry};
use super::fail_after_first_board;
use serde_json::{json, Value};
use std::path::PathBuf;

struct TempWork(PathBuf);

impl Drop for TempWork {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl TempWork {
    fn p(&self, relative: &str) -> PathBuf {
        relative.split('/').fold(self.0.clone(), |path, part| path.join(part))
    }
    fn s(&self, relative: &str) -> String {
        self.p(relative).to_string_lossy().to_string()
    }
    fn root(&self) -> String {
        self.0.to_string_lossy().to_string()
    }
    fn board(&self, id: &str) -> Value {
        serde_json::from_str(&std::fs::read_to_string(self.p(&format!(".then/boards/{id}.canvas"))).unwrap()).unwrap()
    }
    fn bytes(&self, relative: &str) -> Vec<u8> {
        std::fs::read(self.p(relative)).unwrap()
    }
}

fn reference(id: &str, source_path: &str, kind: &str) -> Value {
    let name = source_path.rsplit('/').next().unwrap();
    json!({ "id": id, "type": "reference", "x": 0, "y": 0, "width": 200, "height": 120,
        "scope": "project", "sourcePath": source_path, "name": name, "kind": kind })
}

fn temp_work(label: &str) -> TempWork {
    let root = std::env::temp_dir().join(format!(
        "then-material-files-{label}-{}-{}",
        std::process::id(),
        super::super::now_millis()
    ));
    let work = TempWork(root);
    let write = |relative: &str, content: &[u8]| {
        let path = work.p(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    };
    write(".then/project.json", json!({ "schemaVersion": 1, "materialsFolder": "素材" }).to_string().as_bytes());
    write("本編.md", "# 本編\n".as_bytes());
    write("第一章/本文.md", "# 本文\n".as_bytes());
    write("第一章/挿絵.png", b"\x89PNG\r\n\x1a\nnot really");
    write("素材/人物.md", "# 人物\n".as_bytes());
    write("素材/資料/地図.png", b"\x89PNG\r\n\x1a\n\xff\xfe");
    write("素材/資料/設定.PDF", b"%PDF-1.4\n\xff");
    write("素材/資料/メモ.md", "# メモ\n".as_bytes());
    write("素材/年表/年表.md", "# 年表\n".as_bytes());
    write("素材/空/置き場.md", "# 置き場\n".as_bytes());
    let board_a = json!({
        "nodes": [
            reference("r1", "素材/資料/地図.png", "image"),
            reference("r2", "素材/資料/メモ.md", "markdown"),
            { "id": "g1", "type": "reference", "x": 0, "y": 0, "width": 1, "height": 1,
              "scope": "global", "sourcePath": "素材/資料/地図.png", "name": "地図.png", "kind": "image" },
            { "id": "t1", "type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "text": "素材/資料/地図.png" },
            // ノート・原稿を指すファイルのカード（BINDER 4-2）。
            { "id": "f1", "type": "file", "x": 0, "y": 0, "width": 1, "height": 1, "file": "素材/資料/メモ.md" },
            { "id": "f2", "type": "file", "x": 0, "y": 0, "width": 1, "height": 1, "file": "第一章/本文.md" }
        ],
        "edges": [],
        "then": { "version": 1, "name": "A" }
    });
    write(".then/boards/a.canvas", serde_json::to_string_pretty(&board_a).unwrap().as_bytes());
    let board_b = json!({ "nodes": [reference("r3", "素材/資料/設定.PDF", "pdf")], "edges": [], "then": { "version": 1, "name": "B" } });
    write(".then/boards/b.canvas", serde_json::to_string_pretty(&board_b).unwrap().as_bytes());
    // 資料カードのないボード。詰めて書いておき、書き直されたら分かるようにする。
    let board_c = json!({ "nodes": [reference("r4", "本編.md", "markdown")], "edges": [], "then": { "version": 1, "name": "C" } });
    write(".then/boards/c.canvas", board_c.to_string().as_bytes());
    work
}

fn node<'a>(board: &'a Value, id: &str) -> &'a Value {
    board["nodes"].as_array().unwrap().iter().find(|node| node["id"] == id).unwrap()
}

fn config(work: &TempWork) -> Value {
    serde_json::from_str(&std::fs::read_to_string(work.p(".then/project.json")).unwrap()).unwrap()
}

#[test]
fn renaming_a_material_image_keeps_its_extension_and_does_not_read_it() {
    let work = temp_work("rename");
    let document = rename_project_entry(work.s("素材/資料/地図.png"), "港の地図".into()).expect("rename image");
    assert_eq!(document.path, work.s("素材/資料/港の地図.png"));
    assert_eq!(document.name, "港の地図.png");
    assert_eq!(document.content, "", "画像の中身は文字として読まない");
    assert_eq!(document.content_hash, None);
    assert!(work.p("素材/資料/港の地図.png").is_file());
    assert!(!work.p("素材/資料/地図.png").exists());

    let document = rename_project_entry(work.s("素材/資料/港の地図.png"), "港の地図2.PNG".into()).expect("with extension");
    assert_eq!(document.name, "港の地図2.PNG", "元の拡張子で終わっていれば、そのまま");
    let document = rename_project_entry(work.s("素材/資料/港の地図2.PNG"), "港の地図3.jpg".into()).expect("other extension");
    assert_eq!(document.name, "港の地図3.jpg.PNG", "違う拡張子は名前の一部になり、元の拡張子を足す（確認1の 2）");

    let document = rename_project_entry(work.s("素材/資料/設定.PDF"), "設定集".into()).expect("rename pdf");
    assert_eq!(document.name, "設定集.PDF");
    assert!(rename_project_entry(work.s("素材/資料/設定集.PDF"), "メモ.md".into()).is_ok_and(|doc| doc.name == "メモ.md.PDF"));
    assert!(rename_project_entry(work.s("素材/資料/メモ.md.PDF"), "  ".into()).is_err(), "名前なしは断る");

    let order = config(&work)["order"].clone();
    assert!(!order.to_string().contains(".PNG") && !order.to_string().contains(".png"), "画像は並び順を持たない: {order}");
}

#[test]
fn images_outside_the_materials_folder_are_not_renamed_or_moved() {
    let work = temp_work("outside");
    assert!(rename_project_entry(work.s("第一章/挿絵.png"), "挿絵2".into()).is_err());
    assert!(work.p("第一章/挿絵.png").is_file());
    assert!(move_project_entry(work.root(), work.s("第一章/挿絵.png"), work.s("素材"), None, None).is_err());
    assert!(work.p("第一章/挿絵.png").is_file());
}

#[test]
fn text_files_are_renamed_as_before() {
    let work = temp_work("text");
    let document = rename_project_entry(work.s("素材/人物.md"), "人物2".into()).expect("rename text");
    assert_eq!(document.name, "人物2.txt", "txt・md は今までどおり（拡張子を書かなければ .txt。画面側が元の拡張子を足す）");
    assert_eq!(document.content, "# 人物\n");
}

#[test]
fn a_material_image_moves_inside_the_materials_folder_without_an_order_entry() {
    let work = temp_work("move");
    let result = move_project_entry(work.root(), work.s("素材/資料/地図.png"), work.s("素材/年表"), None, None).expect("move into folder");
    assert_eq!(result.new_path, work.s("素材/年表/地図.png"));
    assert!(result.moved_document.is_none(), "画像の中身は読まない");
    assert!(work.p("素材/年表/地図.png").is_file());
    assert!(!config(&work)["order"].to_string().contains("地図.png"), "移した先の並び順に入れない");

    // 素材の段の見出し（素材フォルダ）へ。ファイルの行の前・後へ落としても、そのフォルダの中へ入れるだけ。
    let result = move_project_entry(
        work.root(),
        work.s("素材/年表/地図.png"),
        work.s("素材"),
        Some(work.s("素材/人物.md")),
        Some("before".into()),
    )
    .expect("move to materials root");
    assert_eq!(result.new_path, work.s("素材/地図.png"));
    assert!(!config(&work)["order"].to_string().contains("地図.png"));
    assert!(result.project_folder.children.iter().all(|entry| !entry.name.ends_with(".png")), "ファイルの一覧には入らない");
}

#[test]
fn a_material_image_is_not_moved_to_the_manuscript_tier() {
    let work = temp_work("manuscript");
    let before = std::fs::read_to_string(work.p(".then/project.json")).unwrap();
    assert!(move_project_entry(work.root(), work.s("素材/資料/地図.png"), work.root(), None, None).is_err());
    assert!(move_project_entry(work.root(), work.s("素材/資料/地図.png"), work.s("第一章"), None, None).is_err());
    assert!(work.p("素材/資料/地図.png").is_file());
    assert_eq!(std::fs::read_to_string(work.p(".then/project.json")).unwrap(), before);
}

#[test]
fn a_folder_with_images_does_not_leave_the_materials_folder() {
    let work = temp_work("folder-out");
    assert!(move_project_entry(work.root(), work.s("素材/資料"), work.root(), None, None).is_err(), "確認1の 3");
    assert!(work.p("素材/資料/地図.png").is_file());
    assert!(move_project_entry(work.root(), work.s("素材/資料"), work.s("第一章"), None, None).is_err());
    // 画像のないフォルダは、今までどおり原稿の段へ出せる。
    move_project_entry(work.root(), work.s("素材/空"), work.root(), None, None).expect("folder without images");
    assert!(work.p("空/置き場.md").is_file());
    // 素材の中での移動はできる。
    move_project_entry(work.root(), work.s("素材/資料"), work.s("素材/年表"), None, None).expect("inside materials");
    assert!(work.p("素材/年表/資料/地図.png").is_file());
}

#[test]
fn board_reference_cards_follow_image_text_and_folder_changes() {
    let work = temp_work("boards");
    let untouched = work.bytes(".then/boards/c.canvas");

    rename_project_entry(work.s("素材/資料/地図.png"), "港".into()).unwrap();
    let a = work.board("a");
    assert_eq!(node(&a, "r1")["sourcePath"], "素材/資料/港.png");
    assert_eq!(node(&a, "r1")["name"], "港.png");
    assert_eq!(node(&a, "r1")["kind"], "image");
    assert_eq!(node(&a, "g1")["sourcePath"], "素材/資料/地図.png", "作品のものでない資料カードは触らない");
    assert_eq!(node(&a, "t1")["text"], "素材/資料/地図.png", "テキストカードの本文は書き換えない");

    // md の資料も付いていく（確認1の 1）。
    rename_project_entry(work.s("素材/資料/メモ.md"), "覚え書き.md".into()).unwrap();
    assert_eq!(node(&work.board("a"), "r2")["sourcePath"], "素材/資料/覚え書き.md");
    assert_eq!(node(&work.board("a"), "r2")["name"], "覚え書き.md");
    assert_eq!(node(&work.board("a"), "f1")["file"], "素材/資料/覚え書き.md", "ファイルのカードも付いていく");
    assert!(node(&work.board("a"), "f1").get("name").is_none(), "ファイルのカードには名前を書き足さない");

    // フォルダの改名で、中の資料がすべて付いていく。
    rename_project_entry(work.s("素材/資料"), "参考".into()).unwrap();
    assert_eq!(node(&work.board("a"), "r1")["sourcePath"], "素材/参考/港.png");
    assert_eq!(node(&work.board("b"), "r3")["sourcePath"], "素材/参考/設定.PDF");
    assert_eq!(node(&work.board("b"), "r3")["kind"], "pdf");

    // フォルダの移動・画像の移動。
    move_project_entry(work.root(), work.s("素材/参考"), work.s("素材/年表"), None, None).unwrap();
    assert_eq!(node(&work.board("a"), "r1")["sourcePath"], "素材/年表/参考/港.png");
    move_project_entry(work.root(), work.s("素材/年表/参考/港.png"), work.s("素材"), None, None).unwrap();
    assert_eq!(node(&work.board("a"), "r1")["sourcePath"], "素材/港.png");

    // md を原稿の段へ移しても付いていく（資料の候補から外れるが、パスは正しい）。
    move_project_entry(work.root(), work.s("素材/年表/参考/覚え書き.md"), work.root(), None, None).unwrap();
    assert_eq!(node(&work.board("a"), "r2")["sourcePath"], "覚え書き.md");
    assert_eq!(node(&work.board("a"), "f1")["file"], "覚え書き.md");

    // 原稿のフォルダの改名で、原稿のファイルのカードが付いていく。
    rename_project_entry(work.s("第一章"), "第1章".into()).unwrap();
    assert_eq!(node(&work.board("a"), "f2")["file"], "第1章/本文.md");

    assert_eq!(work.bytes(".then/boards/c.canvas"), untouched, "変わらないボードは書かない");
}

#[test]
fn a_board_failure_puts_the_file_the_config_and_the_boards_back() {
    let work = temp_work("rollback");
    // 2つのボードが同じフォルダの資料を持つ。1つ目を書いたあとで失敗させる。
    let config_before = std::fs::read_to_string(work.p(".then/project.json")).unwrap();
    let a = work.bytes(".then/boards/a.canvas");
    let b = work.bytes(".then/boards/b.canvas");

    fail_after_first_board(true);
    let renamed = rename_project_entry(work.s("素材/資料"), "参考".into());
    let moved = move_project_entry(work.root(), work.s("素材/資料"), work.s("素材/年表"), None, None);
    fail_after_first_board(false);

    assert!(renamed.is_err() && moved.is_err());
    assert!(work.p("素材/資料/地図.png").is_file(), "フォルダは元の場所に戻る");
    assert!(!work.p("素材/参考").exists() && !work.p("素材/年表/資料").exists());
    assert_eq!(std::fs::read_to_string(work.p(".then/project.json")).unwrap(), config_before);
    assert_eq!(work.bytes(".then/boards/a.canvas"), a);
    assert_eq!(work.bytes(".then/boards/b.canvas"), b);
}

#[test]
fn a_work_without_boards_or_materials_folder_renames_as_before() {
    let work = temp_work("plain");
    std::fs::remove_dir_all(work.p(".then/boards")).unwrap();
    rename_project_entry(work.s("素材/資料/メモ.md"), "メモ2.md".into()).expect("no boards folder");
    std::fs::write(work.p(".then/project.json"), json!({ "schemaVersion": 1 }).to_string()).unwrap();
    assert!(rename_project_entry(work.s("素材/資料/地図.png"), "地図2".into()).is_err(), "素材フォルダがなければ画像は素材でない");
}
