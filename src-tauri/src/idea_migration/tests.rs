//! 移行の命令を、1-3 の見本データ `scripts/fixtures/binder-migration/library` の写しで動かして確かめる。
//! 投稿・ノートの中身が Idea の見え方と同じであることは `test:idea-migration` が確かめる。

use super::super::project_state::{load_project_config, project_config_path, update_project_config};
use super::super::{load_project_snippets, now_millis, save_project_snippets, IdeaThreadConfig};
use super::{
    fail_at, migrate_ideas, migrate_profile_ideas, note_name_for, reference_areas, references_folder_for_import,
    IdeaMigrationPlan,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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
        let path = std::env::temp_dir().join(format!("then-idea-migration-{label}-{}-{}", std::process::id(), now_millis()));
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
        fail_at(None);
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn threads(root: &Path) -> Vec<IdeaThreadConfig> {
    load_project_snippets(root.to_string_lossy().to_string()).expect("read idea threads")
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).expect("read json")).expect("parse json")
}

/// テストの移行の中身: インボックスの断片を投稿に、ほかのスレッドを断片の本文の段落と資料リンクのノートにする
/// （画面の側の作り方は `test:idea-migration` が確かめる）。
fn plan_for(root: &Path) -> IdeaMigrationPlan {
    let stored = serde_json::to_value(threads(root)).unwrap();
    let layout_file = root.join(".then").join("reference-layouts").join("default.json");
    let layout = if layout_file.is_file() { read_json(&layout_file) } else { Value::Null };
    let links_of = |thread_id: &str| -> Vec<String> {
        layout["ideaThreads"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| item["threadId"] == thread_id)
            .flat_map(|item| item["items"].as_array().cloned().unwrap_or_default())
            .filter_map(|item| item["sourcePath"].as_str().map(str::to_string))
            .collect()
    };
    let mut posts = Vec::new();
    let mut notes = Vec::new();
    for thread in stored.as_array().unwrap() {
        let fragments = thread["fragments"].as_array().cloned().unwrap_or_default();
        if thread["kind"] == "inbox" {
            for fragment in fragments {
                posts.push(json!({
                    "fragmentId": fragment["id"],
                    "at": "2026-01-01T09:00:00+09:00",
                    "body": fragment["body"],
                    "filed": fragment["used"],
                    "origin": fragment.get("originRef").cloned().unwrap_or(Value::Null),
                }));
            }
        } else {
            let mut paragraphs: Vec<Value> = fragments.iter().map(|fragment| json!({ "text": fragment["body"] })).collect();
            paragraphs.extend(links_of(thread["id"].as_str().unwrap()).into_iter().map(|link| json!({ "link": link })));
            notes.push(json!({
                "threadId": thread["id"],
                "title": thread["title"],
                "paragraphs": paragraphs,
                "fragmentIds": fragments.iter().map(|fragment| fragment["id"].clone()).collect::<Vec<_>>(),
            }));
        }
    }
    serde_json::from_value(json!({ "posts": posts, "notes": notes })).unwrap()
}

/// フォルダの中身（相対パス → バイト列）。バックアップと投稿のファイルは除く。
fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, folder: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(folder).expect("read folder") {
            let path = entry.expect("read entry").path();
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if relative == ".then/backups" || relative.starts_with(".then/posts") {
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

fn posts(library: &TempLibrary) -> Vec<Value> {
    let file = library.0.join(".then").join("posts.jsonl");
    std::fs::read_to_string(file)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("parse post"))
        .collect()
}

fn give_work_id(root: &Path) {
    update_project_config(root, |config| {
        config.work_id = Some(format!("w-test-{}", root.file_name().unwrap().to_string_lossy()));
        Ok(())
    })
    .unwrap();
}

/// 見本のボードを足す（1-3 の見本にはボードがない）。資料カード2つ（移す資料と原稿のファイル）と「元 Idea」のカード。
fn add_board(root: &Path) -> PathBuf {
    let folder = root.join(".then").join("boards");
    std::fs::create_dir_all(&folder).unwrap();
    let board = folder.join("board-1.canvas");
    let content = json!({
        "nodes": [
            { "id": "n1", "type": "reference", "x": 0, "y": 0, "width": 100, "height": 100, "scope": "project",
              "sourcePath": ".then/references/imports/資料a.md", "name": "資料a.md", "kind": "markdown" },
            { "id": "n2", "type": "reference", "x": 0, "y": 0, "width": 100, "height": 100, "scope": "project",
              "sourcePath": "第一章/a.md", "name": "a.md", "kind": "markdown" },
            { "id": "n3", "type": "text", "x": 0, "y": 0, "width": 100, "height": 100, "text": "元 Idea",
              "thenOrigin": { "source": "idea", "sourceThreadId": "a-t1", "sourceId": "a-s1" } }
        ],
        "edges": []
    });
    std::fs::write(&board, serde_json::to_string_pretty(&content).unwrap()).unwrap();
    board
}

#[test]
fn idea_migration_moves_work_a_into_posts_notes_and_materials_once() {
    let library = TempLibrary::new("work-a");
    let root = library.work("作品A");
    give_work_id(&root);
    let board = add_board(&root);
    let before_threads = threads(&root);
    let before_config = read_json(&project_config_path(&root));
    let before_layout = std::fs::read(root.join(".then/reference-layouts/default.json")).unwrap();
    let before_board = std::fs::read(&board).unwrap();
    let plan = plan_for(&root);

    let result = migrate_ideas(&root, &before_threads, &plan).expect("migrate");
    assert_eq!(result.status, "migrated");
    assert_eq!(result.posts, 2, "two inbox fragments become posts");
    assert_eq!(result.moved, 4, "four imported references are moved");
    assert_eq!(
        result.notes,
        vec!["素材/場面： 港.md", "素材/伏線.md", "素材/空のスレッド.md"],
        "named threads become notes; the colon is made full-width"
    );

    // 資料は 素材/資料/ へ移り、元の場所は空になって消える。
    for name in ["map (2).png", "どこにもない資料.txt", "設定集.pdf", "資料a.md"] {
        assert_eq!(
            std::fs::read(root.join("素材/資料").join(name)).unwrap(),
            std::fs::read(fixture_library().join("作品A/.then/references/imports").join(name)).unwrap(),
            "{name} moved unchanged"
        );
    }
    assert!(!root.join(".then/references/imports").exists(), "the emptied import folder is removed");

    // ノートの資料リンクは移した先を指す。原稿のファイルのリンクはそのまま。
    let note = std::fs::read_to_string(root.join("素材/場面： 港.md")).unwrap();
    assert_eq!(
        note,
        "# 場面: 港\n\n港の場面の一\n\n港の場面の二\n\nCanvasから来た断片\n\n@[[素材/資料/資料a.md]]\n\n@[[素材/資料/map (2).png]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("素材/伏線.md")).unwrap(),
        "# 伏線\n\n手紙の伏線\n二行目\n\n@[[第一章/a.md]]\n"
    );
    assert_eq!(std::fs::read_to_string(root.join("素材/空のスレッド.md")).unwrap(), "# 空のスレッド\n");

    // 投稿はライブラリの posts.jsonl に、作品を記録して入る。used は受信箱から外す。
    let stored_posts = posts(&library);
    assert_eq!(stored_posts.len(), 2);
    for post in &stored_posts {
        assert_eq!(post["work"]["id"], "w-test-作品A");
        assert_eq!(post["work"]["name"], "作品A");
        assert!(post["id"].as_str().unwrap().starts_with("p-idea-"));
    }
    let used = stored_posts.iter().find(|post| post["body"] == "使用済みの断片").unwrap();
    assert_eq!(used["filed"], true);
    let open = stored_posts.iter().find(|post| post["body"] == "インボックスの一つ目").unwrap();
    assert!(open.get("filed").is_none(), "an unused fragment stays in the inbox");

    // 資料の並び: 資料カードのパスを書き換え、Idea カード・並び順・管理単位を外す。
    let layout = read_json(&root.join(".then/reference-layouts/default.json"));
    assert_eq!(layout["cards"].as_array().unwrap().len(), 1, "the Idea card is closed");
    assert_eq!(layout["cards"][0]["sourcePath"], "素材/資料/設定集.pdf");
    for key in ["ideaThreads", "ideaThreadsMode", "otherIdea"] {
        assert!(layout.get(key).is_none(), "{key} removed");
    }

    // ボードの資料カード: 移した資料だけ書き換える。「元 Idea」のカードはそのまま。
    let board_after = read_json(&board);
    assert_eq!(board_after["nodes"][0]["sourcePath"], "素材/資料/資料a.md");
    assert_eq!(board_after["nodes"][1]["sourcePath"], "第一章/a.md");
    assert_eq!(board_after["nodes"][2]["thenOrigin"]["sourceId"], "a-s1");

    // project.json: Idea は空になり、移行の印と素材フォルダが入る。ほかは変わらない。
    let after = read_json(&project_config_path(&root));
    assert!(threads(&root).is_empty(), "ideaThreads emptied");
    assert_eq!(after["materialsFolder"], "素材");
    let record = &after["ideaMigration"];
    assert_eq!(record["posts"], 2);
    assert_eq!(record["referencesFolder"], "素材/資料");
    assert_eq!(record["moved"].as_array().unwrap().len(), 4);
    assert_eq!(record["moved"][3], json!({ "from": ".then/references/imports/資料a.md", "to": "素材/資料/資料a.md" }));
    let fragment = record["fragments"].as_array().unwrap().iter().find(|item| item["id"] == "a-s1").unwrap();
    assert_eq!(fragment["note"], "素材/場面： 港.md", "the record knows where each fragment went (for 4-5)");
    // U10（3-3）: スターの付いていたスレッド「場面: 港」のノートにだけスターが付く。
    let stars: Vec<&String> = after["noteStars"].as_object().unwrap().keys().collect();
    assert_eq!(stars, vec!["素材/場面： 港.md"]);
    let reference = TempLibrary::new("work-a-reference");
    let reference_root = reference.work("作品A");
    give_work_id(&reference_root);
    save_project_snippets(reference_root.to_string_lossy().to_string(), Vec::new()).unwrap();
    let strip = |mut value: Value| {
        let object = value.as_object_mut().unwrap();
        for key in ["ideaMigration", "materialsFolder", "revision", "noteStars"] {
            object.remove(key);
        }
        value
    };
    assert_eq!(strip(after.clone()), strip(read_json(&project_config_path(&reference_root))), "other settings unchanged");
    assert_eq!(before_config["plotCards"], after["plotCards"], "Plot untouched");

    // バックアップは元のまま。
    let backup = root.join(record["backupPath"].as_str().unwrap());
    assert_eq!(read_json(&backup.join("project.json")), before_config);
    assert_eq!(std::fs::read(backup.join("reference-layouts/default.json")).unwrap(), before_layout);
    assert_eq!(std::fs::read(backup.join("boards/board-1.canvas")).unwrap(), before_board);
    assert!(backup.join("references/imports/設定集.pdf").is_file());
    assert_eq!(read_json(&backup.join("moves.json")), record["moved"]);

    // 2回目は何もしない（投稿もノートも増えない）。
    let tree_after = tree(&root);
    let again = migrate_ideas(&root, &before_threads, &plan).expect("second run");
    assert_eq!(again.status, "empty");
    assert_eq!(tree(&root), tree_after);
    assert_eq!(posts(&library).len(), 2);
}

#[test]
fn idea_migration_refuses_threads_that_changed_and_writes_nothing() {
    let library = TempLibrary::new("changed");
    let root = library.work("作品A");
    give_work_id(&root);
    let plan = plan_for(&root);
    let mut stale = threads(&root);
    stale[0].fragments[0].body.push_str("（古い）");
    let before = tree(&root);

    assert!(migrate_ideas(&root, &stale, &plan).is_err());
    assert_eq!(tree(&root), before, "nothing moved or written");
    assert!(!root.join(".then/backups").exists(), "no backup");
    assert!(posts(&library).is_empty(), "no posts");
}

#[test]
fn idea_migration_undoes_a_failed_run_and_the_next_run_does_not_duplicate() {
    for step in ["move", "rewrite", "note", "posts", "save"] {
        let library = TempLibrary::new(&format!("fail-{step}"));
        let root = library.work("作品A");
        give_work_id(&root);
        add_board(&root);
        let before_threads = threads(&root);
        let plan = plan_for(&root);
        let before = tree(&root);

        fail_at(Some(step));
        assert!(migrate_ideas(&root, &before_threads, &plan).is_err(), "{step}: fails");
        fail_at(None);
        assert_eq!(tree(&root), before, "{step}: references, layout, board, notes and project.json are as before");
        assert_eq!(threads(&root).len(), before_threads.len(), "{step}: ideas are kept for the next try");

        let result = migrate_ideas(&root, &before_threads, &plan).expect("retry");
        assert_eq!(result.status, "migrated", "{step}: the next run migrates");
        let stored = posts(&library);
        assert_eq!(stored.len(), 2, "{step}: posts from the failed run are not added twice");
        assert_eq!(result.notes.len(), 3, "{step}: one note per thread");
        assert_eq!(std::fs::read_dir(root.join("素材")).unwrap().count(), 4, "{step}: three notes and 資料");
        assert!(threads(&root).is_empty());
    }
}

#[test]
fn idea_migration_covers_legacy_snippets_empty_works_and_rescued_sample_threads() {
    let library = TempLibrary::new("others");

    // 旧形式 snippets（読むたびに時刻が変わる）も、ID と本文で同じと見て移す。
    let legacy = library.work("作品C");
    let legacy_threads = threads(&legacy);
    let plan = plan_for(&legacy);
    std::thread::sleep(std::time::Duration::from_millis(5));
    let result = migrate_ideas(&legacy, &legacy_threads, &plan).expect("legacy");
    assert_eq!(result.status, "migrated");
    assert_eq!(result.posts, 2);
    let config = read_json(&project_config_path(&legacy));
    assert!(config.get("snippets").map_or(true, |value| value.as_array().is_some_and(Vec::is_empty)));
    assert!(threads(&legacy).is_empty());
    assert!(config.get("materialsFolder").is_none(), "no notes and no references, so no materials folder");

    // 移すものがない作品は何も書かない。
    let empty = library.work("作品D");
    let before = tree(&empty);
    let result = migrate_ideas(&empty, &[], &IdeaMigrationPlan::default()).expect("empty");
    assert_eq!(result.status, "empty");
    assert_eq!(tree(&empty), before);
    assert!(!empty.join(".then/backups").exists());

    // 作品B: 資料リンクのないインボックスの資料（どこにもない・消えたスレッドの）も 素材/資料/ へ移す。
    let work_b = library.work("作品B");
    let plan = plan_for(&work_b);
    let result = migrate_ideas(&work_b, &threads(&work_b), &plan).expect("work B");
    assert_eq!(result.moved, 2);
    assert!(work_b.join("素材/資料/重複.md").is_file());
    assert!(work_b.join("素材/資料/消えたスレッドの資料.md").is_file());
}

#[test]
fn idea_migration_uses_registered_materials_and_avoids_name_clashes() {
    let library = TempLibrary::new("folders");

    // ふつうのフォルダ「素材」は原稿なので使わず、「素材-2」を作る。資料の同じ名前は「-2」。
    let root = library.work("作品A");
    std::fs::create_dir(root.join("素材")).unwrap();
    std::fs::write(root.join("素材/原稿.md"), "原稿\n").unwrap();
    let plan = plan_for(&root);
    let result = migrate_ideas(&root, &threads(&root), &plan).expect("plain folder");
    assert_eq!(result.notes[0], "素材-2/場面： 港.md");
    assert_eq!(read_json(&project_config_path(&root))["materialsFolder"], "素材-2");
    assert_eq!(std::fs::read_dir(root.join("素材")).unwrap().count(), 1, "the plain folder is left as it was");

    let registered = library.work("作品B");
    std::fs::create_dir_all(registered.join("メモ/資料")).unwrap();
    std::fs::write(registered.join("メモ/資料/重複.md"), "前からある\n").unwrap();
    update_project_config(&registered, |config| {
        config.materials_folder = Some("メモ".to_string());
        Ok(())
    })
    .unwrap();
    let plan = plan_for(&registered);
    migrate_ideas(&registered, &threads(&registered), &plan).expect("registered folder");
    assert_eq!(std::fs::read_to_string(registered.join("メモ/資料/重複.md")).unwrap(), "前からある\n");
    assert!(registered.join("メモ/資料/重複-2.md").is_file(), "a clashing name gets -2");
    assert_eq!(read_json(&project_config_path(&registered))["ideaMigration"]["moved"][1]["to"], "メモ/資料/重複-2.md");
}

#[test]
fn idea_migration_of_the_library_root_moves_references_to_a_folder_at_the_root() {
    let library = TempLibrary::new("root");
    let root = library.work("");
    // ライブラリ直下に、作品ではないふつうのフォルダ「資料」があれば「資料-2」にする。
    std::fs::create_dir(root.join("資料")).unwrap();
    let board = add_board(&root);
    std::fs::write(
        &board,
        serde_json::to_string(&json!({ "nodes": [{ "id": "n", "type": "reference", "sourcePath": ".then/references/imports/港の写真.png" }], "edges": [] }))
            .unwrap(),
    )
    .unwrap();
    let plan = plan_for(&root);
    let result = migrate_ideas(&root, &threads(&root), &plan).expect("root");
    assert_eq!(result.moved, 1);
    assert!(root.join("資料-2/港の写真.png").is_file());
    assert_eq!(result.notes, vec!["作品Aから送ったスレッド.md"], "notes sit at the root (no materials tier)");
    let config = read_json(&project_config_path(&root));
    assert!(config.get("materialsFolder").is_none());
    assert_eq!(config["ideaMigration"]["referencesFolder"], "資料-2");
    assert_eq!(read_json(&board)["nodes"][0]["sourcePath"], "資料-2/港の写真.png");
    let stored = posts(&library);
    assert_eq!(stored.len(), 1);
    assert!(stored[0].get("work").is_none(), "a post from the root has no work");
}

#[test]
fn idea_migration_rewrites_links_in_the_migrated_plot_note() {
    let library = TempLibrary::new("plot-note");
    let root = library.work("作品A");
    let cards = super::super::load_project_plot_cards(root.to_string_lossy().to_string()).unwrap();
    let text = "地図は @[[.then/references/imports/map (2).png]]。@[[第一章/a.md]] と @[[消した資料.md]]\n";
    super::super::plot_migration::migrate_plot_to_note(&root, &cards, "プロット（移行）", text).unwrap();
    let plan = plan_for(&root);
    migrate_ideas(&root, &threads(&root), &plan).expect("migrate");
    assert_eq!(
        std::fs::read_to_string(root.join("素材/プロット（移行）.md")).unwrap(),
        "地図は @[[素材/資料/map (2).png]]。@[[第一章/a.md]] と @[[消した資料.md]]\n",
        "only links to moved references change"
    );
    let config = load_project_config(&root).unwrap();
    let backup = root.join(config.idea_migration.unwrap().backup_path);
    assert_eq!(std::fs::read_to_string(backup.join("plot-note/プロット（移行）.md")).unwrap(), text);
}

#[test]
fn profile_ideas_become_root_notes_and_posts_without_a_work_once() {
    let library = TempLibrary::new("profile");
    let root = library.work("");
    let stored = json!([{ "id": "idea-inbox", "kind": "inbox", "fragments": [{ "id": "p-i1", "body": "共有の一" }] }]);
    let plan: IdeaMigrationPlan = serde_json::from_value(json!({
        "posts": [{ "fragmentId": "p-i1", "at": "2026-01-01T09:00:00+09:00", "body": "共有の一" }],
        "notes": [{ "threadId": "p-t1", "title": "共有のスレッド", "paragraphs": [{ "text": "共有の断片" }], "fragmentIds": ["p-s1"] }]
    }))
    .unwrap();
    let result = migrate_profile_ideas(&root, &stored, &plan).expect("profile");
    assert_eq!(result.posts, 1);
    assert_eq!(result.notes, vec!["共有のスレッド.md"]);
    assert_eq!(std::fs::read_to_string(root.join("共有のスレッド.md")).unwrap(), "# 共有のスレッド\n\n共有の断片\n");
    let backups: Vec<_> = std::fs::read_dir(root.join(".then/backups")).unwrap().flatten().collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(read_json(&backups[0].path())["profileSnippets"], stored);

    // もう一度呼んでも（アプリ状態を空にする前に止まったとき）、投稿もノートも増えない。
    let again = migrate_profile_ideas(&root, &stored, &plan).expect("again");
    assert_eq!(again.posts, 0);
    assert_eq!(again.notes, vec!["共有のスレッド.md"]);
    assert_eq!(posts(&library).len(), 1);
    assert!(posts(&library)[0].get("work").is_none());
    assert!(migrate_profile_ideas(&library.work("作品A"), &stored, &plan).is_err(), "only a library root");
}

#[test]
fn references_are_imported_into_the_materials_folder_and_listed_from_it() {
    let library = TempLibrary::new("areas");

    // 素材フォルダのない作品: 取り込むと「素材」を作って登録し、その中の「資料」へ入れる。
    let root = library.work("作品C");
    assert_eq!(reference_areas(&root), Vec::<PathBuf>::new(), "nothing to list yet");
    let folder = references_folder_for_import(&root).expect("import folder");
    assert_eq!(folder, root.join("素材").join("資料"));
    assert_eq!(read_json(&project_config_path(&root))["materialsFolder"], "素材");
    assert_eq!(reference_areas(&root), vec![root.join("素材")], "the whole materials folder is listed");

    // 移行の前の取り込みのフォルダも、残っていれば並べる（移行に失敗した作品の資料が消えて見えないように）。
    let before = library.work("作品A");
    let areas = reference_areas(&before);
    assert_eq!(areas, vec![before.join(".then").join("references").join("imports")]);

    // 移行のあとは素材フォルダ（取り込みのフォルダはなくなる）。
    migrate_ideas(&before, &threads(&before), &plan_for(&before)).unwrap();
    assert_eq!(reference_areas(&before), vec![before.join("素材")]);
    assert_eq!(references_folder_for_import(&before).unwrap(), before.join("素材").join("資料"));

    // ライブラリ直下: 移行で作った資料のフォルダ（ふつうのフォルダ「資料」があったので「資料-2」）へ。
    let top = library.work("");
    std::fs::create_dir(top.join("資料")).unwrap();
    migrate_ideas(&top, &threads(&top), &plan_for(&top)).unwrap();
    assert_eq!(references_folder_for_import(&top).unwrap(), top.join("資料-2"));
    assert_eq!(reference_areas(&top), vec![top.join("資料-2")]);
    assert!(read_json(&project_config_path(&top)).get("materialsFolder").is_none(), "no materials folder at the root");
}

#[test]
fn idea_migration_note_names_keep_the_title_readable() {
    assert_eq!(note_name_for("場面: 港"), "場面： 港");
    assert_eq!(note_name_for("a/b\\c*d?e\"f<g>h|i"), "a／b＼c＊d？e＂f＜g＞h｜i");
    assert_eq!(note_name_for(".隠し"), "．隠し");
    assert_eq!(note_name_for("  "), "スレッド");
    assert_eq!(note_name_for("末尾の点."), "末尾の点");
}
