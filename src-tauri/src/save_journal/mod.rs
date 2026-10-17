//! Journaled manuscript saves for open documents (the scheme is in core.rs).
//!
//! Each open tab gets a journal in `<app local data>/recovery/<pid>-<tab>/`.
//! The editor sends its changes as they happen; autosave then writes the
//! manuscript in place, behind the journal. Recovery after a crash reads those
//! folders; this module only writes them.

pub mod core;
pub mod fs;

use self::core::{sha, Journal, SaveError};
use self::fs::{real_file_id, FsError, RealFs};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

struct Entry {
    journal: Journal,
    fs: RealFs,
}

static RECOVERY_ROOT: OnceLock<PathBuf> = OnceLock::new();

fn journals() -> &'static Mutex<HashMap<String, Entry>> {
    static JOURNALS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    JOURNALS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn init(recovery_root: PathBuf) {
    let _ = RECOVERY_ROOT.set(recovery_root);
}

fn journal_dir(key: &str) -> Result<PathBuf, String> {
    let root = RECOVERY_ROOT.get().ok_or("recovery area is not set")?;
    let safe: String = key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    Ok(root.join(format!("{}-{safe}", std::process::id())))
}

fn fs_error(error: FsError) -> String {
    match error {
        FsError::Io(error) => error.to_string(),
        FsError::NotFound => "file not found".into(),
        FsError::DiskFull => "disk full".into(),
        FsError::Crash => "crash".into(),
    }
}

/// UTF-16 offset (the editor's) to a byte offset in `text`.
fn byte_offset(text: &str, units: usize) -> Option<usize> {
    let mut seen = 0;
    for (index, ch) in text.char_indices() {
        if seen == units {
            return Some(index);
        }
        seen += ch.len_utf16();
        if seen > units {
            return None;
        }
    }
    (seen == units).then_some(text.len())
}

#[derive(Deserialize)]
pub struct EditInput {
    /// UTF-16 length of the text the change applies to.
    length: usize,
    from: usize,
    to: usize,
    insert: String,
}

/// Record editor changes (UTF-16 offsets into the text before each change).
/// `base` is the text before the first change; it opens the journal.
pub fn record_edits(key: &str, path: &str, base: Option<String>, edits: Vec<EditInput>) -> Result<(), String> {
    let mut journals = journals().lock().map_err(|_| "journal lock poisoned")?;
    if !journals.contains_key(key) {
        let Some(base) = base else {
            return Err("journal is not open".into());
        };
        let mut fs = RealFs::default();
        let journal = Journal::start(&mut fs, &journal_dir(key)?, Path::new(path), Some(base.into_bytes()))
            .map_err(fs_error)?;
        journals.insert(key.to_string(), Entry { journal, fs });
    }
    let entry = journals.get_mut(key).unwrap();
    if entry.journal.doc != Path::new(path) {
        entry.journal.set_doc(Path::new(path));
    }
    for edit in edits {
        let text = std::str::from_utf8(&entry.journal.content).map_err(|e| e.to_string())?;
        if text.encode_utf16().count() != edit.length {
            return Err("journal is out of step with the editor".into());
        }
        let (Some(from), Some(to)) = (byte_offset(text, edit.from), byte_offset(text, edit.to)) else {
            // Out of step with the editor: the next save brings it level.
            return Err("edit outside the journaled text".into());
        };
        if to < from {
            return Err("edit range is reversed".into());
        }
        entry.journal.edit(&mut entry.fs, from, to - from, edit.insert.as_bytes()).map_err(fs_error)?;
    }
    // The OS has the records now (an app crash keeps them); the sync makes
    // them survive a power cut. The editor sends its next batch only after
    // this returns, so syncs pace themselves to the disk.
    entry.journal.flush(&mut entry.fs).map_err(fs_error)
}

pub struct Saved {
    pub file_id: Option<String>,
}

pub fn save(key: &str, path: &str, content: &str) -> Result<Saved, String> {
    let mut journals = journals().lock().map_err(|_| "journal lock poisoned")?;
    if !journals.contains_key(key) {
        let mut fs = RealFs::default();
        let journal = Journal::start(&mut fs, &journal_dir(key)?, Path::new(path), None).map_err(fs_error)?;
        journals.insert(key.to_string(), Entry { journal, fs });
    }
    let entry = journals.get_mut(key).unwrap();
    if entry.journal.doc != Path::new(path) {
        entry.journal.set_doc(Path::new(path));
    }
    match entry.journal.save(&mut entry.fs, content.as_bytes()) {
        Ok(_) => Ok(Saved {
            file_id: Some(entry.journal.disk_id().to_string()).filter(|id| !id.is_empty()),
        }),
        Err(SaveError::External(why)) => Err(format!("ファイルが外部で変更されたため保存しませんでした（{why}）")),
        Err(SaveError::Journal(error)) => Err(format!("復旧用の記録を書けないため保存しませんでした（{}）", fs_error(error))),
        Err(SaveError::Original(error)) => Err(format!("failed to write text file: {}", fs_error(error))),
        Err(SaveError::Verify) => Err("保存した内容を読み直すと一致しませんでした".into()),
    }
}

/// Then wrote `path` through another command; journals on it take that as
/// the file's known state instead of an outside change.
pub fn note_then_write(path: &Path, content: &[u8]) {
    let Ok(mut journals) = journals().lock() else { return };
    let matching: Vec<&mut Entry> = journals.values_mut().filter(|e| e.journal.doc == path).collect();
    if matching.is_empty() {
        return;
    }
    let hash = sha(content);
    let id = real_file_id(path).ok().flatten().unwrap_or_default();
    for entry in matching {
        entry.journal.note_disk(hash, id.clone());
    }
}

/// Close a journal. Its files stay when something is not on disk, unless
/// `discard` (the person closed the tab and chose what to keep).
pub fn forget(key: &str, discard: bool) {
    let Ok(mut journals) = journals().lock() else { return };
    if let Some(mut entry) = journals.remove(key) {
        let closed = entry.journal.close(&mut entry.fs).unwrap_or(false);
        drop(entry.fs);
        if closed || discard {
            let _ = std::fs::remove_dir_all(&entry.journal.dir);
        }
    }
}

pub fn close_all() {
    let keys: Vec<String> = match journals().lock() {
        Ok(journals) => journals.keys().cloned().collect(),
        Err(_) => return,
    };
    for key in keys {
        forget(&key, false);
    }
}

#[cfg(test)]
mod tests {
    use super::byte_offset;

    #[test]
    fn utf16_offsets_map_to_bytes() {
        let text = "あa𠮷b";
        assert_eq!(byte_offset(text, 0), Some(0));
        assert_eq!(byte_offset(text, 1), Some(3));
        assert_eq!(byte_offset(text, 2), Some(4));
        assert_eq!(byte_offset(text, 3), None); // inside the surrogate pair
        assert_eq!(byte_offset(text, 4), Some(8));
        assert_eq!(byte_offset(text, 5), Some(9));
        assert_eq!(byte_offset(text, 6), None);
    }
}
