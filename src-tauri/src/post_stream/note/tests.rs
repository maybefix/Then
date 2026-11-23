use super::*;
use crate::library::{create_library, create_library_project};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("then-post-note-{name}-{}-{}", std::process::id(), now_millis()));
        std::fs::create_dir_all(&path).expect("create test directory");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn library(dir: &TestDirectory) -> (PathBuf, PathBuf, PathBuf) {
    let root = dir.0.join("lib");
    std::fs::create_dir_all(&root).unwrap();
    create_library(&root, "作品集").unwrap();
    let a = PathBuf::from(create_library_project(&root, "作品A").unwrap());
    let b = PathBuf::from(create_library_project(&root, "作品B").unwrap());
    (root, a, b)
}

const AT: &str = "2026-11-14T10:42:05+09:00";
const NOTE: &str = "# 手紙\n\n閉局の日に、返事が集まる。\n";

fn hashes(scope: &Path, ids: &[&str]) -> Vec<PostHash> {
    let snapshot = load(scope).unwrap();
    ids.iter()
        .map(|id| {
            let post = snapshot.posts.iter().find(|post| post.id == *id).unwrap();
            PostHash { id: post.id.clone(), hash: post.hash.clone() }
        })
        .collect()
}

fn post_id(snapshot: &PostsSnapshot, body: &str) -> String {
    snapshot.posts.iter().find(|post| post.body == body).unwrap().id.clone()
}

fn line_of(root: &Path, id: &str) -> Value {
    let text = std::fs::read_to_string(posts_file(root)).unwrap();
    let line = text.lines().find(|line| line.contains(id)).unwrap();
    serde_json::from_str(line).unwrap()
}

fn materials_folder(work: &Path) -> Option<String> {
    load_project_config(work).unwrap().materials_folder
}

#[test]
fn making_a_note_creates_the_materials_folder_and_links_only_that_post() {
    let dir = TestDirectory::new("make");
    let (root, a, _) = library(&dir);
    add(&a, AT, "前の投稿", None).unwrap();
    let after = add(&a, AT, "閉局の日に、返事が集まる。", None).unwrap();
    let id = post_id(&after, "閉局の日に、返事が集まる。");
    add(&a, AT, "後の投稿", None).unwrap();
    // 知らない欄を持つ行と、読めない行。どちらも1文字も変わらない。
    let unknown = r#"{"v":1,"id":"p-x","at":"2026-11-14T09:00:00+09:00","body":"x","star":true}"#;
    let broken = "{not json";
    let mut text = std::fs::read_to_string(posts_file(&root)).unwrap();
    text.push_str(unknown);
    text.push('\n');
    text.push_str(broken);
    text.push('\n');
    std::fs::write(posts_file(&root), &text).unwrap();
    let before: Vec<String> = text.split('\n').map(str::to_string).collect();
    assert_eq!(materials_folder(&a), None);

    let made = make_note(&a, &hashes(&a, &[&id]), "手紙", NOTE).unwrap();

    let note = a.join("素材").join("手紙.md");
    assert_eq!(PathBuf::from(&made.note_path), note);
    assert_eq!(std::fs::read_to_string(&note).unwrap(), NOTE);
    assert_eq!(made.note_hash, content_hash(NOTE.as_bytes()));
    assert_eq!(materials_folder(&a).as_deref(), Some("素材"));
    let work_id = load_project_config(&a).unwrap().work_id.unwrap();
    let line = line_of(&root, &id);
    assert_eq!(line["note"], serde_json::json!({ "work": work_id, "path": "素材/手紙.md" }));
    assert_eq!(line["body"], "閉局の日に、返事が集まる。", "投稿はそのまま残る");
    // ほかの行は1文字も変わらない。
    let after_text = std::fs::read_to_string(posts_file(&root)).unwrap();
    let after_lines: Vec<&str> = after_text.split('\n').collect();
    assert_eq!(after_lines.len(), before.len());
    for (old, new) in before.iter().zip(&after_lines) {
        if !old.contains(&id) {
            assert_eq!(old, new);
        }
    }
    // 画面へは、ノートの場所と、受信箱から外れる印が届く。
    let view = made.snapshot.posts.iter().find(|post| post.id == id).unwrap();
    assert!(view.noted);
    let note_view = view.note.as_ref().unwrap();
    assert_eq!(note_view.path, "素材/手紙.md");
    assert_eq!(note_view.work_root.as_deref(), Some(a.to_string_lossy().as_ref()));
    assert_eq!(note_view.work_name.as_deref(), Some("作品A"));
    assert!(note_view.exists);
    assert!(made.snapshot.posts.iter().filter(|post| post.id != id).all(|post| !post.noted && post.note.is_none()));
}

#[test]
fn an_unregistered_folder_named_like_the_materials_folder_is_left_alone() {
    let dir = TestDirectory::new("plain");
    let (_, a, _) = library(&dir);
    std::fs::create_dir_all(a.join("素材")).unwrap();
    let id = post_id(&add(&a, AT, "汽笛", None).unwrap(), "汽笛");

    make_note(&a, &hashes(&a, &[&id]), "汽笛", NOTE).unwrap();

    assert!(a.join("素材-2").join("汽笛.md").is_file());
    assert!(!a.join("素材").join("汽笛.md").exists());
    assert_eq!(materials_folder(&a).as_deref(), Some("素材-2"));
}

#[test]
fn a_registered_materials_folder_is_used_and_a_taken_name_gets_a_number() {
    let dir = TestDirectory::new("taken");
    let (root, a, _) = library(&dir);
    crate::project_state::update_project_config(&a, |config| {
        config.materials_folder = Some("資料".to_string());
        Ok(())
    })
    .unwrap();
    std::fs::create_dir_all(a.join("資料")).unwrap();
    std::fs::write(a.join("資料").join("手紙.md"), "既存").unwrap();
    let id = post_id(&add(&a, AT, "手紙", None).unwrap(), "手紙");

    // 名前に .md を付けても、付けなくても同じ。
    make_note(&a, &hashes(&a, &[&id]), "手紙.md", NOTE).unwrap();

    assert_eq!(std::fs::read_to_string(a.join("資料").join("手紙.md")).unwrap(), "既存", "上書きしない");
    assert_eq!(std::fs::read_to_string(a.join("資料").join("手紙-2.md")).unwrap(), NOTE);
    assert_eq!(line_of(&root, &id)["note"]["path"], "資料/手紙-2.md");
    assert_eq!(materials_folder(&a).as_deref(), Some("資料"));
}

#[test]
fn a_thread_becomes_one_note_linked_from_every_post() {
    let dir = TestDirectory::new("thread");
    let (root, a, _) = library(&dir);
    let head = post_id(&add(&a, AT, "先頭", None).unwrap(), "先頭");
    let reply = post_id(&add(&a, AT, "返信", Some(&head)).unwrap(), "返信");

    let made = make_note(&a, &hashes(&a, &[&head, &reply]), "まとめ", NOTE).unwrap();

    assert_eq!(line_of(&root, &head)["note"], line_of(&root, &reply)["note"]);
    assert!(made.snapshot.posts.iter().all(|post| post.noted));
    assert_eq!(std::fs::read_dir(a.join("素材")).unwrap().count(), 1, "ノートは1本");
}

#[test]
fn a_post_changed_elsewhere_writes_nothing() {
    let dir = TestDirectory::new("conflict");
    let (root, a, _) = library(&dir);
    let head = post_id(&add(&a, AT, "先頭", None).unwrap(), "先頭");
    let reply = post_id(&add(&a, AT, "返信", Some(&head)).unwrap(), "返信");
    let seen = hashes(&a, &[&head, &reply]);
    // 返信だけ外で直された。
    let text = std::fs::read_to_string(posts_file(&root)).unwrap().replace("\"返信\"", "\"外で直した返信\"");
    std::fs::write(posts_file(&root), &text).unwrap();
    let config_before = std::fs::read_to_string(project_config_path(&a)).unwrap();

    let error = make_note(&a, &seen, "まとめ", NOTE).unwrap_err();

    assert!(error.starts_with(CONFLICT), "{error}");
    assert_eq!(std::fs::read_to_string(posts_file(&root)).unwrap(), text);
    assert!(!a.join("素材").exists(), "素材フォルダを作らない");
    assert_eq!(std::fs::read_to_string(project_config_path(&a)).unwrap(), config_before);
}

#[test]
fn a_post_already_made_into_a_note_is_not_made_again() {
    let dir = TestDirectory::new("twice");
    let (_, a, _) = library(&dir);
    let id = post_id(&add(&a, AT, "一度だけ", None).unwrap(), "一度だけ");
    make_note(&a, &hashes(&a, &[&id]), "一度だけ", NOTE).unwrap();

    let error = make_note(&a, &hashes(&a, &[&id]), "二度目", NOTE).unwrap_err();

    assert!(error.starts_with(CONFLICT), "{error}");
    assert!(!a.join("素材").join("二度目.md").exists());
}

#[test]
fn the_library_root_has_no_place_for_a_note() {
    let dir = TestDirectory::new("root");
    let (root, _, _) = library(&dir);
    let id = post_id(&add(&root, AT, "着想", None).unwrap(), "着想");
    let text = std::fs::read_to_string(posts_file(&root)).unwrap();

    assert!(make_note(&root, &hashes(&root, &[&id]), "着想", NOTE).is_err());

    assert_eq!(std::fs::read_to_string(posts_file(&root)).unwrap(), text);
    assert!(!root.join("素材").exists());
    assert!(!root.join("着想.md").exists());
}

#[test]
fn a_bad_note_name_writes_nothing() {
    let dir = TestDirectory::new("name");
    let (root, a, _) = library(&dir);
    let id = post_id(&add(&a, AT, "名前", None).unwrap(), "名前");
    let text = std::fs::read_to_string(posts_file(&root)).unwrap();

    for name in ["", "  ", "a/b", ".md", "x:y"] {
        assert!(make_note(&a, &hashes(&a, &[&id]), name, NOTE).is_err(), "{name}");
    }
    assert!(make_note(&a, &hashes(&a, &[&id]), "空", "  \n").is_err());

    assert_eq!(std::fs::read_to_string(posts_file(&root)).unwrap(), text);
    assert!(!a.join("素材").exists());
}

#[test]
fn a_standalone_work_keeps_the_post_and_the_note_inside() {
    let dir = TestDirectory::new("standalone");
    let work = dir.0.join("単独");
    std::fs::create_dir_all(&work).unwrap();
    let id = post_id(&add(&work, AT, "単独の投稿", None).unwrap(), "単独の投稿");

    let made = make_note(&work, &hashes(&work, &[&id]), "単独", NOTE).unwrap();

    assert!(work.join("素材").join("単独.md").is_file());
    assert_eq!(line_of(&work, &id)["note"]["path"], "素材/単独.md");
    assert!(made.snapshot.posts[0].note.as_ref().unwrap().exists);
}

#[test]
fn undo_unlinks_the_posts_and_tells_whether_the_note_is_untouched() {
    let dir = TestDirectory::new("undo");
    let (root, a, _) = library(&dir);
    let head = post_id(&add(&a, AT, "先頭", None).unwrap(), "先頭");
    let reply = post_id(&add(&a, AT, "返信", Some(&head)).unwrap(), "返信");
    let made = make_note(&a, &hashes(&a, &[&head, &reply]), "まとめ", NOTE).unwrap();
    let note = PathBuf::from(&made.note_path);

    let undone = unlink_note(&a, &[head.clone(), reply.clone()], &note, &made.note_hash).unwrap();

    assert!(undone.note_unchanged);
    assert!(line_of(&root, &head).get("note").is_none());
    assert!(line_of(&root, &reply).get("note").is_none());
    assert!(undone.snapshot.posts.iter().all(|post| !post.noted));
    assert!(note.is_file(), "ノートは画面がゴミ箱へ移す");

    // 書き足したノートは、作ったときのままではない。
    let again = make_note(&a, &hashes(&a, &[&head]), "もう一度", NOTE).unwrap();
    std::fs::write(&again.note_path, format!("{NOTE}書き足した\n")).unwrap();
    let undone = unlink_note(&a, &[head.clone()], Path::new(&again.note_path), &again.note_hash).unwrap();
    assert!(!undone.note_unchanged);
    assert!(line_of(&root, &head).get("note").is_none());
}

#[test]
fn undo_leaves_a_post_linked_to_another_note_alone() {
    let dir = TestDirectory::new("undo-other");
    let (root, a, _) = library(&dir);
    let first = post_id(&add(&a, AT, "一", None).unwrap(), "一");
    let second = post_id(&add(&a, AT, "二", None).unwrap(), "二");
    let made = make_note(&a, &hashes(&a, &[&first]), "一", NOTE).unwrap();
    make_note(&a, &hashes(&a, &[&second]), "二", NOTE).unwrap();

    unlink_note(&a, &[first.clone(), second.clone()], Path::new(&made.note_path), &made.note_hash).unwrap();

    assert!(line_of(&root, &first).get("note").is_none());
    assert_eq!(line_of(&root, &second)["note"]["path"], "素材/二.md");
}

#[test]
fn renaming_or_moving_inside_then_follows_the_link() {
    let dir = TestDirectory::new("retarget");
    let (root, a, b) = library(&dir);
    let in_a = post_id(&add(&a, AT, "Aの投稿", None).unwrap(), "Aの投稿");
    let in_b = post_id(&add(&b, AT, "Bの投稿", None).unwrap(), "Bの投稿");
    make_note(&a, &hashes(&a, &[&in_a]), "手紙", NOTE).unwrap();
    make_note(&b, &hashes(&b, &[&in_b]), "手紙", NOTE).unwrap();
    let change = |old: PathBuf, new: PathBuf| PathChange {
        old_path: old.to_string_lossy().to_string(),
        new_path: new.to_string_lossy().to_string(),
    };

    // ノートの改名。作品B の同じパスのノートは変えない。
    let after = retarget_notes(&a, &[change(a.join("素材").join("手紙.md"), a.join("素材").join("宛先.md"))]).unwrap();
    assert!(after.is_some());
    assert_eq!(line_of(&root, &in_a)["note"]["path"], "素材/宛先.md");
    assert_eq!(line_of(&root, &in_b)["note"]["path"], "素材/手紙.md");

    // フォルダの改名（素材フォルダそのもの）。大文字小文字の違いも同じパスとみなす。
    retarget_notes(&a, &[change(a.join("素材"), a.join("設定"))]).unwrap();
    assert_eq!(line_of(&root, &in_a)["note"]["path"], "設定/宛先.md");

    // 原稿へ出した（作品直下へ移した）。
    retarget_notes(&a, &[change(a.join("設定").join("宛先.md"), a.join("宛先.md"))]).unwrap();
    assert_eq!(line_of(&root, &in_a)["note"]["path"], "宛先.md");

    // 関係のない改名では書かない。
    let text = std::fs::read_to_string(posts_file(&root)).unwrap();
    assert!(retarget_notes(&a, &[change(a.join("第一章.md"), a.join("第1章.md"))]).unwrap().is_none());
    // 名前の前の方が同じだけのフォルダは別物。
    assert!(retarget_notes(&a, &[change(a.join("宛"), a.join("別"))]).unwrap().is_none());
    assert_eq!(std::fs::read_to_string(posts_file(&root)).unwrap(), text);
}

/// U5: ノートをほかの作品へ送ったら、札はその作品のノートを指す。直下へ送ったら付け替えない（札は薄くなる）。
#[test]
fn sending_a_note_to_another_work_moves_the_link_with_it() {
    let dir = TestDirectory::new("send");
    let (root, a, b) = library(&dir);
    let id = post_id(&add(&a, AT, "Aの投稿", None).unwrap(), "Aの投稿");
    make_note(&a, &hashes(&a, &[&id]), "手紙", NOTE).unwrap();
    let work_a = line_of(&root, &id)["note"]["work"].as_str().unwrap().to_string();
    let change = |old: PathBuf, new: PathBuf| PathChange {
        old_path: old.to_string_lossy().to_string(),
        new_path: new.to_string_lossy().to_string(),
    };

    let after = move_notes_to_work(&a, &b, &[change(a.join("素材").join("手紙.md"), b.join("素材").join("手紙-2.md"))]).unwrap();
    assert!(after.is_some());
    let note = &line_of(&root, &id)["note"];
    assert_ne!(note["work"].as_str().unwrap(), work_a);
    assert_eq!(note["work"], load_project_config(&b).unwrap().work_id.unwrap().as_str());
    assert_eq!(note["path"], "素材/手紙-2.md");
    let snapshot = load(&a).unwrap();
    let view = snapshot.posts.iter().find(|post| post.id == id).unwrap().note.as_ref().unwrap();
    assert_eq!(view.work_name.as_deref(), Some("作品B"));

    // 戻す（元に戻す）。
    move_notes_to_work(&b, &a, &[change(b.join("素材").join("手紙-2.md"), a.join("素材").join("手紙.md"))]).unwrap();
    assert_eq!(line_of(&root, &id)["note"]["work"], work_a.as_str());
    assert_eq!(line_of(&root, &id)["note"]["path"], "素材/手紙.md");

    // 直下へは付け替えない。
    let text = std::fs::read_to_string(posts_file(&root)).unwrap();
    assert!(move_notes_to_work(&a, &root, &[change(a.join("素材").join("手紙.md"), root.join("手紙.md"))]).unwrap().is_none());
    assert_eq!(std::fs::read_to_string(posts_file(&root)).unwrap(), text);
}

#[test]
fn a_note_in_another_work_or_gone_missing_is_shown_as_such() {
    let dir = TestDirectory::new("view");
    let (root, a, b) = library(&dir);
    let id = post_id(&add(&a, AT, "Aで書いた", None).unwrap(), "Aで書いた");
    let made = make_note(&a, &hashes(&a, &[&id]), "手紙", NOTE).unwrap();

    // 作品B から見ても、ライブラリ直下から見ても、作品A のノートとして出る。
    for scope in [&b, &root] {
        let snapshot = load(scope).unwrap();
        let note = snapshot.posts[0].note.as_ref().unwrap();
        assert_eq!(note.work_name.as_deref(), Some("作品A"));
        assert_eq!(note.work_root.as_deref(), Some(a.to_string_lossy().as_ref()));
        assert!(note.exists);
    }
    // 外で消された（改名された）ノートは、ないものとして出る。リンクは残る。
    std::fs::remove_file(&made.note_path).unwrap();
    let snapshot = load(&b).unwrap();
    assert!(!snapshot.posts[0].note.as_ref().unwrap().exists);
    assert!(snapshot.posts[0].noted);
}

#[test]
fn retarget_helper_matches_whole_names_only() {
    assert_eq!(retarget_relative("素材/手紙.md", "素材", "設定").as_deref(), Some("設定/手紙.md"));
    assert_eq!(retarget_relative("素材/手紙.md", "素材/手紙.md", "素材/宛先.md").as_deref(), Some("素材/宛先.md"));
    assert_eq!(retarget_relative("Notes/a.md", "notes", "Memo").as_deref(), Some("Memo/a.md"));
    assert_eq!(retarget_relative("素材2/手紙.md", "素材", "設定"), None);
    assert_eq!(retarget_relative("素材", "素材/手紙.md", "x"), None);
}

#[test]
fn when_the_post_cannot_be_written_the_note_and_the_new_folder_are_taken_back() {
    let dir = TestDirectory::new("rollback");
    let (root, a, _) = library(&dir);
    let id = post_id(&add(&a, AT, "書けない", None).unwrap(), "書けない");
    let seen = hashes(&a, &[&id]);
    let file = posts_file(&root);
    let text = std::fs::read_to_string(&file).unwrap();
    let mut permissions = std::fs::metadata(&file).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&file, permissions.clone()).unwrap();

    let result = make_note(&a, &seen, "書けない", NOTE);

    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(&file, permissions).unwrap();
    assert!(result.is_err(), "the posts file is read-only");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), text);
    assert!(!a.join("素材").exists(), "the note and the folder made this time are removed");
    assert_eq!(materials_folder(&a), None, "materialsFolder is put back");
}
