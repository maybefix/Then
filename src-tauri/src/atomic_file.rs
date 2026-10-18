//! Replaces a file Then owns (settings, canvas boards, plugin data, exports)
//! so that a crash leaves either the old content or the new, never a part of
//! one. The new content goes to a hidden file beside the target, is synced,
//! and then takes the target's place in one rename.
//!
//! Not for manuscripts: a replaced file is a new file (a new identity, links
//! broken), which save_journal avoids by writing manuscripts in place.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Save commands run off the main thread, so two of them can reach the same
/// file at once; one write per file at a time keeps them from interleaving.
fn file_lock(path: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner());
    locks.entry(path.to_path_buf()).or_default().clone()
}

fn temporary_path(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("file");
    let started = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    path.with_file_name(format!(".{name}.tmp-{}-{started:x}", std::process::id()))
}

/// Writes `content` to `path`, replacing any file there all at once.
pub fn write_replacing(path: &Path, content: impl AsRef<[u8]>) -> std::io::Result<()> {
    let lock = file_lock(path);
    let _one_at_a_time = lock.lock().unwrap_or_else(|e| e.into_inner());
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(content.as_ref())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::write_replacing;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let started = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("then-atomic-{name}-{}-{started}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn replaces_the_file_and_leaves_nothing_beside_it() {
        let dir = temp_dir("replace");
        let path = dir.join("app-state.json");
        write_replacing(&path, "{\"a\":1}").unwrap();
        write_replacing(&path, "{\"a\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}");
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("app-state.json")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_replace_keeps_the_target_and_removes_the_temporary_file() {
        let dir = temp_dir("fail");
        // A directory cannot be replaced by a file: the rename fails.
        let target = dir.join("board.canvas");
        std::fs::create_dir_all(target.join("inside")).unwrap();
        assert!(write_replacing(&target, "{}").is_err());
        assert!(target.join("inside").is_dir());
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("board.canvas")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
