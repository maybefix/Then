//! Plot と Idea の移行（BINDER 1-6・2-4）の前後比較に使う、今の読み込みの結果を確かめる。
//! 見本データ `scripts/fixtures/binder-migration/library` を一時フォルダへ写し、作品ごとに Rust の命令が
//! 返す値を `expected/rust-reads.json` と比べる。画面側のテスト（`test:binder-baseline`）は、この期待値を
//! Rust の答えとして使う（docs/PLOT_IDEA_BASELINE_PLAN.md）。
//!
//! 期待値を書き直すときだけ、環境変数 `THEN_UPDATE_BINDER_BASELINE=1` を付けて動かす。

use super::{
    collect_reference_candidates, load_project_plot_cards, load_project_snippets,
    load_reference_layout, reference_imports_dir,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const WORKS: [&str; 6] = ["", "作品A", "作品B", "作品C", "作品D", "作品E"];

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("fixtures")
        .join("binder-migration")
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

/// フォルダの中の全ファイルの中身（相対パス → バイト列）。
fn read_tree(root: &Path, folder: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
    for entry in std::fs::read_dir(folder).expect("read copied directory") {
        let path = entry.expect("read copied entry").path();
        if path.is_dir() {
            read_tree(root, &path, files);
        } else {
            let relative = path
                .strip_prefix(root)
                .expect("relative path")
                .components()
                .map(|component| component.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            files.insert(relative, std::fs::read(&path).expect("read copied file"));
        }
    }
}

/// 読んだ時刻で作られた値（旧形式から作り直した Idea の時刻）を、決まった文字にする。
fn mask_read_time(value: &mut Value, started_at: i64) {
    match value {
        Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                if (key == "createdAt" || key == "updatedAt")
                    && item.as_i64().is_some_and(|time| time >= started_at)
                {
                    *item = json!("読んだ時刻");
                } else {
                    mask_read_time(item, started_at);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| mask_read_time(item, started_at)),
        _ => {}
    }
}

fn result_value<T: serde::Serialize>(result: Result<T, String>) -> Value {
    match result {
        Ok(value) => serde_json::to_value(value).expect("serialize command result"),
        Err(_) => json!({ "error": "読めない" }),
    }
}

fn read_all_works(library: &Path) -> Value {
    let started_at = super::now_millis();
    let mut before = BTreeMap::new();
    read_tree(library, library, &mut before);

    let mut works = Map::new();
    for name in WORKS {
        let root = if name.is_empty() { library.to_path_buf() } else { library.join(name) };
        let root_path = root.to_string_lossy().to_string();
        // list_reference_candidates の作品の場合（AppHandle を使わない部分）と同じ。
        let candidates = {
            let canonical = root.canonicalize().expect("canonicalize work root");
            let imports_dir = reference_imports_dir(&canonical);
            let mut files = Vec::new();
            let listed = if imports_dir.is_dir() {
                collect_reference_candidates(&canonical, &imports_dir, "project", &mut files)
            } else {
                Ok(())
            };
            files.sort_by_key(|file| file.source_path.to_lowercase());
            result_value(listed.map(|_| files))
        };
        let mut work = json!({
            "plotCards": result_value(load_project_plot_cards(root_path.clone())),
            "ideaThreads": result_value(load_project_snippets(root_path.clone())),
            "layout": result_value(load_reference_layout(root_path)),
            "candidates": candidates,
        });
        mask_read_time(&mut work, started_at);
        works.insert(if name.is_empty() { "（ライブラリの直下）".to_string() } else { name.to_string() }, work);
    }

    // 読むだけで書き換わったファイル（.bak からの復旧など）。
    let mut after = BTreeMap::new();
    read_tree(library, library, &mut after);
    let changed: Vec<String> = after
        .iter()
        .filter(|(path, bytes)| before.get(*path) != Some(*bytes))
        .map(|(path, _)| path.clone())
        .chain(before.keys().filter(|path| !after.contains_key(*path)).cloned())
        .collect();

    json!({ "works": works, "changedFiles": changed })
}

#[test]
fn current_reads_of_plot_and_idea_match_the_baseline() {
    let unique = format!("then-binder-baseline-{}-{}", std::process::id(), super::now_millis());
    let temp = std::env::temp_dir().join(unique);
    let library = temp.join("library");
    copy_tree(&fixture_dir().join("library"), &library);

    let actual = read_all_works(&library);
    std::fs::remove_dir_all(&temp).expect("remove copied fixture");

    let expected_path = fixture_dir().join("expected").join("rust-reads.json");
    if std::env::var("THEN_UPDATE_BINDER_BASELINE").as_deref() == Ok("1") {
        std::fs::create_dir_all(expected_path.parent().unwrap()).expect("create expected directory");
        let text = serde_json::to_string_pretty(&actual).expect("serialize baseline");
        std::fs::write(&expected_path, format!("{text}\n")).expect("write baseline");
        return;
    }
    let expected: Value = serde_json::from_str(
        &std::fs::read_to_string(&expected_path).expect("read expected/rust-reads.json"),
    )
    .expect("parse expected/rust-reads.json");
    for name in actual["works"].as_object().unwrap().keys() {
        assert_eq!(actual["works"][name], expected["works"][name], "{name} の読み込みが期待値と違う");
    }
    assert_eq!(actual, expected);
}
