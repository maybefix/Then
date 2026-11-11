//! ファイル一覧の「原稿／素材」の区分（BINDER 1-3b、docs/BINDER_MATERIALS_PLAN.md）を確かめる。
//! 素材は、作品直下の `project.json` の `materialsFolder` に書かれたフォルダと、その中のもの。

use super::{list_project_folder, project_state::update_project_config, rename_project_entry, ProjectEntry};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

struct TempWork(PathBuf);

impl Drop for TempWork {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn temp_work(label: &str, materials_folder: Option<&str>) -> TempWork {
    let root = std::env::temp_dir().join(format!(
        "then-materials-role-{label}-{}-{}",
        std::process::id(),
        super::now_millis()
    ));
    let write = |relative: &str, content: &str| {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    };
    let config = match materials_folder {
        Some(name) => serde_json::json!({ "schemaVersion": 1, "materialsFolder": name }),
        None => serde_json::json!({ "schemaVersion": 1 }),
    };
    write(".then/project.json", &config.to_string());
    write("本編.md", "# 本編\n");
    write("素材メモ.md", "# 素材メモ\n");
    write("素材/人物.md", "# 人物\n");
    write("素材/年表/年表.md", "# 年表\n");
    write("第一章/素材/メモ.md", "# メモ\n");
    TempWork(root)
}

fn roles(root: &Path) -> BTreeMap<String, Option<String>> {
    fn walk(root: &Path, entries: &[ProjectEntry], out: &mut BTreeMap<String, Option<String>>) {
        for entry in entries {
            let relative = Path::new(&entry.path)
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.insert(relative, entry.role.clone());
            walk(root, &entry.children, out);
        }
    }
    let folder = list_project_folder(root).expect("list work");
    let mut out = BTreeMap::new();
    walk(root, &folder.children, &mut out);
    out
}

fn material_paths(root: &Path) -> Vec<String> {
    roles(root)
        .into_iter()
        .filter_map(|(path, role)| match role.as_deref() {
            Some("material") => Some(path),
            None => None,
            Some(other) => panic!("unexpected role {other} for {path}"),
        })
        .collect()
}

#[test]
fn materials_folder_marks_itself_and_everything_inside() {
    let work = temp_work("marks", Some("素材"));
    assert_eq!(
        material_paths(&work.0),
        vec!["素材", "素材/人物.md", "素材/年表", "素材/年表/年表.md"],
        "作品直下の素材フォルダとその中だけが素材。第一章/素材 や 素材メモ.md は原稿",
    );
}

#[test]
fn without_materials_folder_nothing_is_material_and_role_is_not_serialized() {
    let work = temp_work("unset", None);
    assert!(material_paths(&work.0).is_empty());
    let json = serde_json::to_string(&list_project_folder(&work.0).unwrap()).unwrap();
    assert!(!json.contains("\"role\""), "原稿だけの一覧は今と同じ形（role の欄がない）: {json}");
}

#[test]
fn unusable_materials_folder_values_open_the_work_without_materials() {
    for (index, value) in ["../素材", ".then", "a/b", "a\\b", "", " 素材", "素材 ", ".", ".."]
        .into_iter()
        .enumerate()
    {
        let work = temp_work(&format!("bad{index}"), Some(value));
        assert!(
            material_paths(&work.0).is_empty(),
            "materialsFolder={value:?} は未設定と同じに扱う"
        );
    }
}

#[test]
fn renaming_the_materials_folder_at_the_root_keeps_it_material() {
    let work = temp_work("rename", Some("素材"));
    rename_project_entry(work.0.join("素材").to_string_lossy().to_string(), "資料".into())
        .expect("rename materials folder");
    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(work.0.join(".then/project.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(config["materialsFolder"], "資料");
    assert_eq!(
        material_paths(&work.0),
        vec!["資料", "資料/人物.md", "資料/年表", "資料/年表/年表.md"]
    );

    // 作品直下でない同名のフォルダの改名は、記録した名前を変えない。
    rename_project_entry(
        work.0.join("第一章").join("素材").to_string_lossy().to_string(),
        "メモ帳".into(),
    )
    .expect("rename nested folder");
    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(work.0.join(".then/project.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(config["materialsFolder"], "資料");
}

#[test]
fn moving_a_file_out_of_materials_makes_it_a_manuscript_and_keeps_its_progress() {
    let work = temp_work("move", Some("素材"));
    update_project_config(&work.0, |config| {
        config.file_progress.insert(
            "本編.md".into(),
            super::project_state::ProjectFileProgress { status: "writing".into(), updated_at: 1 },
        );
        Ok(())
    })
    .unwrap();
    let moved = super::move_project_entry(
        work.0.to_string_lossy().to_string(),
        work.0.join("本編.md").to_string_lossy().to_string(),
        work.0.join("素材").to_string_lossy().to_string(),
        None,
        None,
    )
    .expect("move into materials");
    assert!(moved.project_folder.children.iter().any(|entry| entry.name == "素材"));
    assert!(material_paths(&work.0).contains(&"素材/本編.md".to_string()));
    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(work.0.join(".then/project.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        config["fileProgress"]["素材/本編.md"]["status"], "writing",
        "素材へ移しても進捗は消さずに残す（D-4）"
    );

    super::move_project_entry(
        work.0.to_string_lossy().to_string(),
        work.0.join("素材").join("本編.md").to_string_lossy().to_string(),
        work.0.to_string_lossy().to_string(),
        None,
        None,
    )
    .expect("move back to manuscripts");
    assert!(!material_paths(&work.0).contains(&"本編.md".to_string()));
    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(work.0.join(".then/project.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(config["fileProgress"]["本編.md"]["status"], "writing");
}

#[test]
fn materials_folder_survives_other_project_config_updates() {
    let work = temp_work("keep", Some("素材"));
    update_project_config(&work.0, |config| {
        config.order.insert(".".into(), vec!["本編.md".into()]);
        Ok(())
    })
    .unwrap();
    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(work.0.join(".then/project.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(config["materialsFolder"], "素材");

    let unset = temp_work("keep-unset", None);
    update_project_config(&unset.0, |config| {
        config.order.insert(".".into(), vec!["本編.md".into()]);
        Ok(())
    })
    .unwrap();
    let text = std::fs::read_to_string(unset.0.join(".then/project.json")).unwrap();
    assert!(!text.contains("materialsFolder"), "未設定の作品には書き足さない: {text}");
}
