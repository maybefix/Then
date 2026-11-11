//! 素材の区分（BINDER 1-3b）を入れる前の、ファイル一覧（list_project_folder）の姿を確かめる。
//! 見本データ `scripts/fixtures/materials-baseline/library` を一時フォルダへ写し、作品ごとに一覧の
//! 中身（並び・名前・種類・入れ子）を `expected/listing.json` と比べる。画面側のテスト
//! （`test:materials-baseline`）は、この期待値を一覧の答えとして使う（docs/BINDER_MATERIALS_PLAN.md）。
//!
//! 比べるのは、端末やチェックアウトで変わらない項目だけ（ファイル ID・更新時刻・ハッシュは、あるかどうかだけ）。
//! 期待値を書き直すときだけ、環境変数 `THEN_UPDATE_MATERIALS_BASELINE=1` を付けて動かす。

use super::{list_project_folder, ProjectEntry};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

const WORKS: [&str; 3] = ["作品A", "作品B", "作品C"];

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("fixtures")
        .join("materials-baseline")
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("create copy directory");
    for entry in std::fs::read_dir(from).expect("read fixture directory") {
        let entry = entry.expect("read fixture entry");
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("copy fixture file");
        }
    }
}

fn relative(root: &Path, path: &str) -> String {
    Path::new(path)
        .strip_prefix(root)
        .expect("entry is inside the work")
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn entry_value(root: &Path, entry: &ProjectEntry) -> Value {
    let mut value = Map::new();
    value.insert("path".into(), json!(relative(root, &entry.path)));
    value.insert("name".into(), json!(entry.name));
    value.insert("kind".into(), json!(entry.kind));
    if entry.kind == "folder" {
        let children: Vec<Value> = entry.children.iter().map(|child| entry_value(root, child)).collect();
        value.insert("children".into(), Value::Array(children));
    } else {
        value.insert("hasFileId".into(), json!(entry.file_id.is_some()));
        value.insert("hasContentHash".into(), json!(entry.content_hash.is_some()));
        value.insert("hasModifiedAt".into(), json!(entry.modified_at.is_some()));
    }
    Value::Object(value)
}

fn list_all_works(library: &Path) -> Value {
    let mut works = Map::new();
    for name in WORKS {
        let root = library.join(name);
        let folder = list_project_folder(&root).expect("list fixture work");
        let children: Vec<Value> = folder.children.iter().map(|entry| entry_value(&root, entry)).collect();
        works.insert(name.into(), json!({ "name": folder.name, "children": children }));
    }
    json!({ "works": works })
}

#[test]
fn current_listing_without_materials_matches_the_baseline() {
    let unique = format!("then-materials-baseline-{}-{}", std::process::id(), super::now_millis());
    let temp = std::env::temp_dir().join(unique);
    let library = temp.join("library");
    copy_tree(&fixture_dir().join("library"), &library);

    let actual = list_all_works(&library);
    std::fs::remove_dir_all(&temp).expect("remove copied fixture");

    let expected_path = fixture_dir().join("expected").join("listing.json");
    if std::env::var("THEN_UPDATE_MATERIALS_BASELINE").as_deref() == Ok("1") {
        std::fs::create_dir_all(expected_path.parent().unwrap()).expect("create expected directory");
        let text = serde_json::to_string_pretty(&actual).expect("serialize baseline");
        std::fs::write(&expected_path, format!("{text}\n")).expect("write baseline");
        return;
    }
    let expected: Value = serde_json::from_str(
        &std::fs::read_to_string(&expected_path).expect("read expected/listing.json"),
    )
    .expect("parse expected/listing.json");
    for name in WORKS {
        assert_eq!(actual["works"][name], expected["works"][name], "{name} の一覧が期待値と違う");
    }
    assert_eq!(actual, expected);
}
