//! 移行の命令を、1-3 の見本データ `scripts/fixtures/binder-migration/library` の写しで動かして確かめる。
//! ノートの文字そのもの（見え方と1文字も違わないこと）は `test:plot-migration` が確かめる。

use super::super::project_state::{load_project_config, project_config_path};
use super::super::{load_project_plot_cards, save_project_plot_cards, PlotCardConfig};
use super::{backup_stamp, migrate_plot_to_note};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const NOTE_NAME: &str = "プロット（移行）";

fn fixture_library() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("fixtures")
        .join("binder-migration")
        .join("library")
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

struct TempLibrary(PathBuf);

impl TempLibrary {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "then-plot-migration-{label}-{}-{}",
            std::process::id(),
            super::super::now_millis()
        ));
        copy_tree(&fixture_library(), &path);
        Self(path)
    }

    fn work(&self, name: &str) -> PathBuf {
        if name.is_empty() {
            self.0.clone()
        } else {
            self.0.join(name)
        }
    }
}

impl Drop for TempLibrary {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn plot_cards(root: &Path) -> Vec<PlotCardConfig> {
    load_project_plot_cards(root.to_string_lossy().to_string()).expect("read plot cards")
}

fn project_json(root: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(project_config_path(root)).expect("read project.json"))
        .expect("parse project.json")
}

/// 作品のフォルダの中身（`.then` の中を除く、相対パス → バイト列）。
fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, folder: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(folder).expect("read folder") {
            let path = entry.expect("read entry").path();
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if relative == ".then" {
                continue;
            }
            if path.is_dir() {
                files.insert(format!("{relative}/"), Vec::new());
                walk(root, &path, files);
            } else {
                files.insert(relative, std::fs::read(&path).expect("read file"));
            }
        }
    }
    let mut files = BTreeMap::new();
    walk(root, root, &mut files);
    files
}

#[test]
fn plot_migration_moves_every_fixture_work_once_and_keeps_a_backup() {
    let library = TempLibrary::new("fixture");
    // 移行の前の `project.json` の書き方と比べる相手: 今までの Plot の保存で `plotCards` を空にしたもの。
    let reference = TempLibrary::new("reference");

    for name in ["", "作品A", "作品B", "作品C", "作品D", "作品E"] {
        let root = library.work(name);
        let before_cards = plot_cards(&root);
        let before_tree = tree(&root);
        let note_text = format!("{name} のノート\n");
        let result = migrate_plot_to_note(&root, &before_cards, NOTE_NAME, &note_text).expect("migrate");

        if before_cards.is_empty() {
            assert_eq!(result.status, "empty", "{name}: empty Plot");
            assert_eq!(tree(&root), before_tree, "{name}: no note or folder for an empty Plot");
            assert!(project_json(&root).get("plotMigration").is_none(), "{name}: no record");
            continue;
        }

        let is_library_root = name.is_empty();
        let expected_note = if is_library_root { "プロット（移行）.md" } else { "素材/プロット（移行）.md" };
        assert_eq!(result.status, "migrated", "{name}");
        assert_eq!(result.note_path.as_deref(), Some(expected_note), "{name}: note path");
        assert_eq!(
            std::fs::read_to_string(root.join(expected_note)).expect("read note"),
            note_text,
            "{name}: the note is written as handed over"
        );

        // `plotCards` は空になり、移行の印が残る。
        assert!(plot_cards(&root).is_empty(), "{name}: plotCards emptied");
        let after = project_json(&root);
        let record = &after["plotMigration"];
        assert_eq!(record["notePath"], expected_note, "{name}: record of the note");
        let backup_path = record["backupPath"].as_str().expect("backup path");
        assert!(backup_path.starts_with(".then/backups/plot-cards-"), "{name}: {backup_path}");

        // バックアップは元の `plotCards` を ID・開閉の状態ごとそのまま持つ。
        let backup: Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(backup_path)).expect("read backup")).unwrap();
        let backup_cards: Vec<PlotCardConfig> = serde_json::from_value(backup["plotCards"].clone()).unwrap();
        assert_eq!(backup_cards, before_cards, "{name}: backup keeps the cards as stored");

        // 素材フォルダのない作品には「素材」を作って登録する。ライブラリ直下はそのまま。
        if is_library_root {
            assert!(after.get("materialsFolder").is_none(), "library root has no materials folder");
        } else {
            assert_eq!(after["materialsFolder"], "素材", "{name}: materials folder registered");
        }

        // `plotCards`・印・素材フォルダ・版のほかは、今までの Plot の保存で空にしたときと同じ。
        let reference_root = reference.work(name);
        save_project_plot_cards(reference_root.to_string_lossy().to_string(), Vec::new()).expect("save reference");
        let strip = |mut value: Value| {
            let object = value.as_object_mut().unwrap();
            for key in ["plotMigration", "materialsFolder", "revision"] {
                object.remove(key);
            }
            value
        };
        assert_eq!(strip(after.clone()), strip(project_json(&reference_root)), "{name}: other settings unchanged");

        // 2回目は何もしない。
        let tree_after = tree(&root);
        let again = migrate_plot_to_note(&root, &before_cards, NOTE_NAME, &note_text).expect("second run");
        assert_eq!(again.status, "empty", "{name}: second run does nothing");
        assert_eq!(tree(&root), tree_after, "{name}: second run writes nothing");
        assert_eq!(project_json(&root), after, "{name}: second run keeps project.json");
    }
}

#[test]
fn plot_migration_refuses_cards_that_changed_and_writes_nothing() {
    let library = TempLibrary::new("changed");
    let root = library.work("作品A");
    let mut stale = plot_cards(&root);
    stale[0].title.push_str("（古い）");
    let before = std::fs::read(project_config_path(&root)).unwrap();
    let before_tree = tree(&root);

    assert!(migrate_plot_to_note(&root, &stale, NOTE_NAME, "ノート\n").is_err());
    assert_eq!(std::fs::read(project_config_path(&root)).unwrap(), before, "project.json unchanged");
    assert_eq!(tree(&root), before_tree, "no note, no folder");
    assert!(!root.join(".then").join("backups").exists(), "no backup");
}

#[test]
fn plot_migration_undoes_the_folder_when_the_note_cannot_be_written() {
    let library = TempLibrary::new("note-fails");
    let root = library.work("作品A");
    let cards = plot_cards(&root);
    let before = std::fs::read(project_config_path(&root)).unwrap();
    let before_tree = tree(&root);

    // ファイル名に使えない名前で、ノートを書けない場合を起こす。
    assert!(migrate_plot_to_note(&root, &cards, "プロット/移行", "ノート\n").is_err());
    assert_eq!(std::fs::read(project_config_path(&root)).unwrap(), before, "project.json unchanged");
    assert_eq!(tree(&root), before_tree, "the created materials folder is removed");
    assert_eq!(plot_cards(&root), cards, "plotCards kept for the next try");
}

#[test]
fn plot_migration_uses_the_registered_materials_folder_and_avoids_a_plain_one() {
    let library = TempLibrary::new("folders");

    // 登録済みの素材フォルダがあれば、そこへ置く。
    let registered = library.work("作品A");
    std::fs::create_dir(registered.join("資料")).unwrap();
    super::super::project_state::update_project_config(&registered, |config| {
        config.materials_folder = Some("資料".to_string());
        Ok(())
    })
    .unwrap();
    let cards = plot_cards(&registered);
    let result = migrate_plot_to_note(&registered, &cards, NOTE_NAME, "A\n").unwrap();
    assert_eq!(result.note_path.as_deref(), Some("資料/プロット（移行）.md"));
    assert_eq!(project_json(&registered)["materialsFolder"], "資料");
    assert!(!registered.join("素材").exists());

    // 登録されていないふつうのフォルダ「素材」は原稿なので使わず、「素材-2」を作る。
    let plain = library.work("作品B");
    std::fs::create_dir(plain.join("素材")).unwrap();
    std::fs::write(plain.join("素材").join("原稿.md"), "原稿\n").unwrap();
    let cards = plot_cards(&plain);
    let result = migrate_plot_to_note(&plain, &cards, NOTE_NAME, "B\n").unwrap();
    assert_eq!(result.note_path.as_deref(), Some("素材-2/プロット（移行）.md"));
    assert_eq!(project_json(&plain)["materialsFolder"], "素材-2");
    let plain_folder: Vec<_> = std::fs::read_dir(plain.join("素材")).unwrap().collect();
    assert_eq!(plain_folder.len(), 1, "the plain folder is left as it was");
}

#[test]
fn plot_migration_names_around_an_existing_note_but_reuses_the_same_one() {
    let library = TempLibrary::new("names");

    // 同じ名前で中身の違うノートがあれば、「-2」にする。
    let other = library.work("作品A");
    std::fs::create_dir(other.join("素材")).unwrap();
    super::super::project_state::update_project_config(&other, |config| {
        config.materials_folder = Some("素材".to_string());
        Ok(())
    })
    .unwrap();
    std::fs::write(other.join("素材").join("プロット（移行）.md"), "利用者のノート\n").unwrap();
    let cards = plot_cards(&other);
    let result = migrate_plot_to_note(&other, &cards, NOTE_NAME, "移したノート\n").unwrap();
    assert_eq!(result.note_path.as_deref(), Some("素材/プロット（移行）-2.md"));
    assert_eq!(
        std::fs::read_to_string(other.join("素材").join("プロット（移行）.md")).unwrap(),
        "利用者のノート\n",
        "the existing note is not touched"
    );

    // 前回ノートを書いたあとで止まった（同じ中身のノートがある）なら、それを使い、2本目を作らない。
    let resumed = library.work("作品B");
    let cards = plot_cards(&resumed);
    std::fs::create_dir(resumed.join("素材")).unwrap();
    super::super::project_state::update_project_config(&resumed, |config| {
        config.materials_folder = Some("素材".to_string());
        Ok(())
    })
    .unwrap();
    std::fs::write(resumed.join("素材").join("プロット（移行）.md"), "同じノート\n").unwrap();
    let result = migrate_plot_to_note(&resumed, &cards, NOTE_NAME, "同じノート\n").unwrap();
    assert_eq!(result.note_path.as_deref(), Some("素材/プロット（移行）.md"));
    assert_eq!(std::fs::read_dir(resumed.join("素材")).unwrap().count(), 1, "no second note");
    assert!(load_project_config(&resumed).unwrap().plot_cards.is_empty());
}

#[test]
fn plot_migration_backup_stamp_is_a_utc_date_and_time() {
    assert_eq!(backup_stamp(0), "19700101-000000");
    // 2026-11-14 03:15:09 UTC
    assert_eq!(backup_stamp(1_794_626_109_000), "20261114-031509");
    assert_eq!(backup_stamp(951_782_400_000), "20000229-000000");
}
