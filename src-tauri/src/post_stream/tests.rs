use super::*;
use crate::library::{create_library, create_library_project};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("then-posts-{name}-{}-{}", std::process::id(), now_millis()));
        std::fs::create_dir_all(&path).expect("create test directory");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// ライブラリ「作品集」と、その中の作品「作品A」「作品B」。
fn library(dir: &TestDirectory) -> (PathBuf, PathBuf, PathBuf) {
    let root = dir.0.join("lib");
    std::fs::create_dir_all(&root).unwrap();
    create_library(&root, "作品集").unwrap();
    let a = PathBuf::from(create_library_project(&root, "作品A").unwrap());
    let b = PathBuf::from(create_library_project(&root, "作品B").unwrap());
    (root, a, b)
}

fn file_text(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

const AT: &str = "2026-11-14T10:42:05+09:00";

#[test]
fn a_post_in_a_library_work_goes_to_the_library_file_with_the_work_recorded() {
    let dir = TestDirectory::new("library");
    let (root, a, b) = library(&dir);

    let after = add(&a, AT, "閉局の日に、返事が集まる。", None).unwrap();
    assert!(!posts_file(&a).exists(), "作品の .then/ には書かない");
    let text = file_text(&posts_file(&root));
    assert_eq!(text.lines().count(), 1);
    assert!(text.ends_with('\n'));
    let line: Value = serde_json::from_str(text.trim_end()).unwrap();
    assert_eq!(line["v"], 1);
    assert_eq!(line["at"], AT);
    assert_eq!(line["body"], "閉局の日に、返事が集まる。");
    assert_eq!(line["work"]["name"], "作品A");
    let work_id = line["work"]["id"].as_str().unwrap().to_string();
    assert!(work_id.starts_with("w-"));
    assert_eq!(after.work.as_ref().unwrap().id, work_id);
    // 欄の順は v, id, at, work, body（ファイルを開いて読みやすい順）。
    let order: Vec<usize> = ["\"v\"", "\"id\"", "\"at\"", "\"work\"", "\"body\""]
        .iter()
        .map(|key| text.find(key).unwrap())
        .collect();
    assert!(order.windows(2).all(|pair| pair[0] < pair[1]), "{text}");

    // 作品の ID は project.json に残り、2回目も同じ。
    let config = std::fs::read_to_string(project_config_path(&a)).unwrap();
    assert!(config.contains(&work_id));
    add(&a, AT, "二つ目", None).unwrap();
    // 別の作品から開いても同じ流れが見え、いまの作品は作品B。
    let from_b = load(&b).unwrap();
    assert_eq!(from_b.posts.len(), 2);
    assert_eq!(from_b.work.as_ref().unwrap().name, "作品B");
    assert!(from_b.posts.iter().all(|post| post.work.as_ref().unwrap().id == work_id));
    // ライブラリ直下では作品はない。直下で書いた投稿にも作品は付かない。
    let at_root = add(&root, AT, "着想", None).unwrap();
    assert!(at_root.work.is_none());
    assert!(at_root.posts.last().unwrap().work.is_none());
}

#[test]
fn a_work_outside_a_library_keeps_its_own_file() {
    let dir = TestDirectory::new("standalone");
    let work = dir.0.join("単独");
    std::fs::create_dir_all(&work).unwrap();
    // .then/project.json のない作品を読むだけでは、作品を書き換えない。
    let before = load(&work).unwrap();
    assert!(before.posts.is_empty());
    assert_eq!(before.work.as_ref().unwrap().id, "");
    assert!(!work.join(".then").exists());
    let after = add(&work, AT, "ひとつ", None).unwrap();
    assert_eq!(after.posts.len(), 1);
    assert!(posts_file(&work).is_file());
    assert!(!after.work.unwrap().id.is_empty());
}

#[test]
fn changing_one_post_keeps_every_other_line_as_it_was() {
    let dir = TestDirectory::new("replace");
    let work = dir.0.join("w");
    std::fs::create_dir_all(work.join(".then")).unwrap();
    // 外で書かれた行（欄の順・空白が違う）、読めない行、知らない版、空行を混ぜる。
    let foreign = "{ \"body\": \"外で書いた\", \"id\": \"p-x\", \"at\": \"2026-01-01T00:00:00Z\", \"v\": 1, \"star\": true }";
    let broken = "{\"v\":1,\"id\":\"p-bro";
    let future = "{\"v\":2,\"id\":\"p-f\",\"at\":\"x\",\"body\":\"新しい版\"}";
    std::fs::write(posts_file(&work), format!("{foreign}\n{broken}\n\n{future}\n")).unwrap();
    let mine = add(&work, AT, "元の文", None).unwrap();
    assert_eq!(mine.posts.len(), 2, "読めない行と知らない版は出さない");
    let target = mine.posts.iter().find(|post| post.body == "元の文").unwrap().clone();

    let edited = update(&work, &target.id, Some(&target.hash), Some("直した文"), Some("2026-11-14T11:00:00+09:00"), None).unwrap();
    let text = file_text(&posts_file(&work));
    let lines: Vec<&str> = text.split('\n').collect();
    assert_eq!(lines[0], foreign);
    assert_eq!(lines[1], broken);
    assert_eq!(lines[2], "");
    assert_eq!(lines[3], future);
    assert!(lines[4].contains("直した文") && lines[4].contains("\"edited\":\"2026-11-14T11:00:00+09:00\""));
    assert_eq!(lines[5], "");
    assert_eq!(lines.len(), 6);
    assert!(edited.posts.iter().any(|post| post.body == "直した文"));

    // 知らない欄（star）は、その行を直しても残る。
    let other = edited.posts.iter().find(|post| post.id == "p-x").unwrap().clone();
    update(&work, &other.id, None, None, None, Some(true)).unwrap();
    let text = file_text(&posts_file(&work));
    let line = text.lines().find(|line| line.contains("外で書いた")).unwrap();
    let value: Value = serde_json::from_str(line).unwrap();
    assert_eq!(value["star"], true);
    assert_eq!(value["filed"], true);
    assert_eq!(text.lines().nth(1).unwrap(), broken);
}

#[test]
fn a_post_changed_outside_is_not_overwritten_or_deleted() {
    let dir = TestDirectory::new("conflict");
    let work = dir.0.join("w");
    std::fs::create_dir_all(&work).unwrap();
    let seen = add(&work, AT, "見ていた文", None).unwrap().posts[0].clone();
    // 外部のエディタが同じ投稿を直す。
    let file = posts_file(&work);
    std::fs::write(&file, file_text(&file).replace("見ていた文", "外で直した文")).unwrap();

    let error = update(&work, &seen.id, Some(&seen.hash), Some("アプリで直した文"), None, None).unwrap_err();
    assert!(error.starts_with(CONFLICT), "{error}");
    let error = delete(&work, &seen.id, &seen.hash).unwrap_err();
    assert!(error.starts_with(CONFLICT), "{error}");
    assert!(file_text(&file).contains("外で直した文"));
    // 受信箱から外すのは文を消さないので、そのまま当たる。
    let filed = update(&work, &seen.id, None, None, None, Some(true)).unwrap();
    assert!(filed.posts[0].filed);
    assert_eq!(filed.posts[0].body, "外で直した文");
    // ハッシュなしで本文は直せない。
    assert!(update(&work, &seen.id, None, Some("x"), None, None).unwrap_err().starts_with(CONFLICT));
}

#[test]
fn delete_then_restore_puts_the_line_back_where_it_was() {
    let dir = TestDirectory::new("delete");
    let work = dir.0.join("w");
    std::fs::create_dir_all(&work).unwrap();
    add(&work, AT, "一", None).unwrap();
    let middle = add(&work, AT, "二", None).unwrap().posts[1].clone();
    add(&work, AT, "三", None).unwrap();
    let before = file_text(&posts_file(&work));

    let deleted = delete(&work, &middle.id, &middle.hash).unwrap();
    assert_eq!(deleted.index, 1);
    assert_eq!(deleted.snapshot.posts.len(), 2);
    assert!(!file_text(&posts_file(&work)).contains("\"二\""));
    let restored = restore(&work, &deleted.line, deleted.index).unwrap();
    assert_eq!(restored.posts.len(), 3);
    assert_eq!(file_text(&posts_file(&work)), before);
    // 2回戻しても増えない。
    restore(&work, &deleted.line, deleted.index).unwrap();
    assert_eq!(file_text(&posts_file(&work)), before);
}

#[test]
fn appending_to_a_file_without_a_final_newline_starts_a_new_line() {
    let dir = TestDirectory::new("newline");
    let work = dir.0.join("w");
    std::fs::create_dir_all(work.join(".then")).unwrap();
    let last = "{\"v\":1,\"id\":\"p-a\",\"at\":\"x\",\"body\":\"末尾に改行なし\"}";
    std::fs::write(posts_file(&work), last).unwrap();
    let after = add(&work, AT, "次", None).unwrap();
    assert_eq!(after.posts.len(), 2);
    let text = file_text(&posts_file(&work));
    assert!(text.starts_with(&format!("{last}\n")));
}

#[test]
fn the_later_of_two_lines_with_one_id_wins_and_is_the_one_changed() {
    let dir = TestDirectory::new("duplicate");
    let work = dir.0.join("w");
    std::fs::create_dir_all(work.join(".then")).unwrap();
    let first = "{\"v\":1,\"id\":\"p-d\",\"at\":\"x\",\"body\":\"前\"}";
    let second = "{\"v\":1,\"id\":\"p-d\",\"at\":\"x\",\"body\":\"後\"}";
    std::fs::write(posts_file(&work), format!("{first}\n{second}\n")).unwrap();
    let loaded = load(&work).unwrap();
    assert_eq!(loaded.posts.len(), 1);
    assert_eq!(loaded.posts[0].body, "後");
    update(&work, "p-d", Some(&loaded.posts[0].hash), Some("直した"), None, None).unwrap();
    let text = file_text(&posts_file(&work));
    assert!(text.starts_with(&format!("{first}\n")), "前の行は消さない");
    assert!(text.contains("直した"));
}

#[test]
fn a_reply_records_what_it_answers() {
    let dir = TestDirectory::new("reply");
    let work = dir.0.join("w");
    std::fs::create_dir_all(&work).unwrap();
    let parent = add(&work, AT, "親", None).unwrap().posts[0].clone();
    let after = add(&work, AT, "返信", Some(&parent.id)).unwrap();
    assert_eq!(after.posts[1].reply_to.as_deref(), Some(parent.id.as_str()));
    assert!(add(&work, AT, "  ", None).is_err(), "空の投稿は書かない");
}

#[test]
fn posts_written_before_joining_a_library_move_into_the_library_file() {
    let dir = TestDirectory::new("import");
    let (root, a, _) = library(&dir);
    add(&root, AT, "ライブラリの投稿", None).unwrap();
    let existing_id = load(&root).unwrap().posts[0].id.clone();
    // 作品Aが単独だったころの投稿（1件はライブラリと同じ ID）。
    let own = format!(
        "{{\"v\":1,\"id\":\"p-own\",\"at\":\"x\",\"work\":{{\"id\":\"w-a\",\"name\":\"作品A\"}},\"body\":\"単独のとき\"}}\n{{\"v\":1,\"id\":\"{existing_id}\",\"at\":\"x\",\"body\":\"重複\"}}\n"
    );
    std::fs::write(posts_file(&a), &own).unwrap();

    let loaded = load(&a).unwrap();
    assert_eq!(loaded.imported, 1);
    assert_eq!(loaded.posts.len(), 2);
    assert!(loaded.posts.iter().any(|post| post.body == "単独のとき"));
    assert!(!posts_file(&a).exists());
    let kept: Vec<_> = std::fs::read_dir(a.join(".then"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with("posts.imported-"))
        .collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(file_text(&a.join(".then").join(&kept[0])), own);
    assert_eq!(load(&a).unwrap().imported, 0, "2回目は何もしない");
}

#[test]
fn the_work_id_survives_other_project_json_writes() {
    let dir = TestDirectory::new("work-id");
    let (_, a, _) = library(&dir);
    let id = add(&a, AT, "x", None).unwrap().work.unwrap().id;
    update_project_config(&a, |config| {
        config.materials_folder = Some("素材".to_string());
        Ok(())
    })
    .unwrap();
    assert_eq!(load(&a).unwrap().work.unwrap().id, id);
}
