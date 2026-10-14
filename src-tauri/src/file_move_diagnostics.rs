//! Filesystem regression probes run by scripts/test-sidebar-file-move.cmd.
//! Each probe has its own process and fixture so a lock regression cannot hang
//! the test runner. The external runner enforces a five-second timeout.

use std::path::{Path, PathBuf};

fn path(value: &Path) -> String {
    value.to_string_lossy().into_owned()
}

#[test]
#[ignore = "requires isolated fixture and external timeout; run npm run test:sidebar-file-move"]
fn command_probe() {
    let root =
        PathBuf::from(std::env::var_os("THEN_MOVE_PROBE_ROOT").expect("isolated fixture root"));
    let case = std::env::var("THEN_MOVE_PROBE_CASE").expect("probe case");
    if case.starts_with("library-") {
        super::library::create_library(root.parent().unwrap(), "Probe library")
            .expect("create fixture library");
    }
    let initial = super::update_project_config(&root, |config| {
        config.order.insert(
            ".".into(),
            vec![
                "source-folder".into(),
                "destination".into(),
                "a.md".into(),
                "b.md".into(),
            ],
        );
        config
            .order
            .insert("source-folder".into(), vec!["nested.md".into()]);
        if case.starts_with("ordered-") {
            config
                .order
                .insert("destination".into(), vec!["anchor.md".into()]);
        }
        for (relative, status) in [
            ("a.md", "writing"),
            ("b.md", "revising"),
            ("source-folder/nested.md", "done"),
        ] {
            config.file_progress.insert(
                relative.into(),
                super::project_state::ProjectFileProgress {
                    status: status.into(),
                    updated_at: 123,
                },
            );
        }
        Ok(())
    })
    .expect("seed order and progress");
    let original_file_id = super::stable_file_id(&root.join("a.md"));
    super::list_project_folder(&root).expect("baseline tree read must complete");
    println!("BASELINE_TREE_READ_RETURNED");

    // On Windows a readable handle without FILE_SHARE_DELETE permits validation
    // and tree reads, but makes the second rename fail after the first succeeded.
    #[cfg(windows)]
    let held_file = if case == "rollback" {
        use std::os::windows::fs::OpenOptionsExt;
        Some(
            std::fs::OpenOptions::new()
                .read(true)
                .share_mode(3)
                .open(root.join("b.md"))
                .expect("hold second file against rename"),
        )
    } else {
        None
    };

    println!("COMMAND_ENTER {case}");
    let result = match case.as_str() {
        "single" | "library-single" | "collision" | "same-parent" | "ordered-before"
        | "ordered-after" => {
            let destination = if case == "same-parent" {
                root.clone()
            } else {
                root.join("destination")
            };
            let ordered_target = case
                .starts_with("ordered-")
                .then(|| path(&destination.join("anchor.md")));
            let position = case.strip_prefix("ordered-").map(str::to_owned);
            super::move_project_entry(
                path(&root),
                path(&root.join("a.md")),
                path(&destination),
                ordered_target,
                position,
            )
            .map(|moved| {
                let document = moved
                    .moved_document
                    .as_ref()
                    .expect("moved document returned");
                assert_eq!(document.content, "# Probe A\n");
                assert_eq!(document.file_id, original_file_id);
                assert_eq!(Path::new(&document.path), destination.join("a.md"));
                serde_json::to_value(moved).unwrap()
            })
        }
        "folder" | "library-folder" => super::move_project_entry(
            path(&root),
            path(&root.join("source-folder")),
            path(&root.join("destination")),
            None,
            None,
        )
        .map(|moved| {
            assert!(moved.moved_document.is_none());
            serde_json::to_value(moved).unwrap()
        }),
        "multi" | "library-multi" | "rollback" | "empty-multi" => super::move_project_entries(
            path(&root),
            if case == "empty-multi" {
                vec![]
            } else {
                vec![path(&root.join("a.md")), path(&root.join("b.md"))]
            },
            path(&root.join("destination")),
        )
        .map(|moved| {
            assert_eq!(moved.moves.len(), if case == "empty-multi" { 0 } else { 2 });
            for (entry, expected) in moved.moves.iter().zip(["# Probe A\n", "# Probe B\n"]) {
                assert_eq!(entry.moved_document.as_ref().unwrap().content, expected);
            }
            serde_json::to_value(moved).unwrap()
        }),
        "reorder" => super::reorder_project_entries(
            path(&root),
            path(&root),
            vec![path(&root.join("b.md")), path(&root.join("a.md"))],
        )
        .map(|folder| serde_json::json!({ "projectFolder": folder })),
        _ => panic!("unknown probe case"),
    };
    println!("COMMAND_RETURNED");
    #[cfg(windows)]
    drop(held_file);

    let config = super::load_project_config(&root).expect("config lock released after command");
    match case.as_str() {
        "same-parent" | "collision" | "rollback" => {
            let message = result
                .as_ref()
                .expect_err("invalid move must return an error");
            let expected = match case.as_str() {
                "same-parent" => "entry is already in that folder",
                "collision" => "entry with that name already exists",
                _ => "completed moves were restored",
            };
            assert!(message.contains(expected), "unexpected error: {message}");
            assert_eq!(
                std::fs::read_to_string(root.join("a.md")).unwrap(),
                "# Probe A\n"
            );
            assert_eq!(
                std::fs::read_to_string(root.join("b.md")).unwrap(),
                "# Probe B\n"
            );
            let mut restored = serde_json::to_value(&config).unwrap();
            restored["revision"] = serde_json::json!(initial.revision);
            assert_eq!(
                restored,
                serde_json::to_value(&initial).unwrap(),
                "failed move must preserve order and progress"
            );
            if case == "rollback" {
                assert!(
                    config.revision > initial.revision,
                    "rollback revisions must remain monotonic"
                );
                assert!(!root.join("destination/a.md").exists());
                assert!(!root.join("destination/b.md").exists());
            }
        }
        _ => {
            result.as_ref().expect("move must succeed");
        }
    }
    println!(
        "COMMAND_RESULT {}",
        serde_json::json!({
            "ok": result.is_ok(), "value": result.as_ref().ok(), "error": result.as_ref().err(),
            "config": config,
        })
    );
}
