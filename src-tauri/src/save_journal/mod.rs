//! Journaled manuscript saves for open documents (the scheme is in core.rs).
//!
//! Each open tab gets a journal in `<app local data>/recovery/<run>-<tab>/`,
//! where `<run>` names this process (pid and start time). The editor sends its
//! changes as they happen; autosave then writes the manuscript in place, behind
//! the journal. While the process runs it holds `<run>.lock` open; folders
//! whose lock nobody holds are left by a crash, and `scan_recovery` offers what
//! they kept without writing to any manuscript.

pub mod core;
pub mod fs;

use self::core::{recorded_doc, recover, sha, DiskClass, Journal, SaveError};
use self::fs::{real_file_id, FsError, RealFs};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

struct Entry {
    journal: Journal,
    fs: RealFs,
}

struct Area {
    root: PathBuf,
    run: String,
    _lock: Option<std::fs::File>,
}

static AREA: OnceLock<Area> = OnceLock::new();

fn journals() -> &'static Mutex<HashMap<String, Entry>> {
    static JOURNALS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    JOURNALS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Opens `path` so no other process can open it while the handle lives.
#[cfg(windows)]
fn open_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().read(true).write(true).create(true).share_mode(0).open(path)
}

#[cfg(not(windows))]
fn open_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new().read(true).write(true).create(true).open(path)
}

fn lock_path(root: &Path, run: &str) -> PathBuf {
    root.join(format!("{run}.lock"))
}

pub fn init(recovery_root: PathBuf) {
    let started = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let run = format!("{}x{started:x}", std::process::id());
    let _ = std::fs::create_dir_all(&recovery_root);
    let lock = open_exclusive(&lock_path(&recovery_root, &run)).ok();
    let _ = AREA.set(Area { root: recovery_root, run, _lock: lock });
}

fn area() -> Result<&'static Area, String> {
    AREA.get().ok_or_else(|| "recovery area is not set".to_string())
}

fn journal_dir(key: &str) -> Result<PathBuf, String> {
    let area = area()?;
    let safe: String = key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    Ok(area.root.join(format!("{}-{safe}", area.run)))
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
#[serde(rename_all = "camelCase")]
pub struct EditInput {
    /// Generation this change produces (the editor numbers them).
    gen: u64,
    /// The whole text, replacing whatever the journal holds.
    #[serde(default)]
    replace: bool,
    /// UTF-16 length of the text the change applies to.
    length: usize,
    from: usize,
    to: usize,
    insert: String,
}

/// Record editor changes (UTF-16 offsets into the text before each change).
/// `base` is the text before the first change (generation 0); it opens the journal.
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
    // A rename record that cannot be written yet stays queued ahead of the edits.
    let _ = entry.journal.set_doc(&mut entry.fs, Path::new(path));
    for edit in edits {
        if edit.replace {
            if edit.gen <= entry.journal.gen {
                return Err("replacement does not move forward".into());
            }
            entry.journal.replace(&mut entry.fs, edit.gen, edit.insert.as_bytes()).map_err(fs_error)?;
            continue;
        }
        if edit.gen != entry.journal.gen + 1 {
            return Err("journal is out of step with the editor".into());
        }
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

/// Save `content`, the text of generation `gen` as fixed when the save was
/// requested. Changes recorded after it stay in the journal.
pub fn save(key: &str, path: &str, gen: u64, content: &str) -> Result<Saved, String> {
    let mut journals = journals().lock().map_err(|_| "journal lock poisoned")?;
    if !journals.contains_key(key) {
        let mut fs = RealFs::default();
        let journal = Journal::start(&mut fs, &journal_dir(key)?, Path::new(path), None).map_err(fs_error)?;
        journals.insert(key.to_string(), Entry { journal, fs });
    }
    let entry = journals.get_mut(key).unwrap();
    // Queued if it cannot be written now; the save's own sync writes it first.
    let _ = entry.journal.set_doc(&mut entry.fs, Path::new(path));
    match entry.journal.save(&mut entry.fs, gen, content.as_bytes()) {
        Ok(_) => Ok(Saved {
            file_id: Some(entry.journal.disk_id().to_string()).filter(|id| !id.is_empty()),
        }),
        Err(SaveError::Ahead) => Err("保存する世代の記録がまだ届いていません".into()),
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

/// Text a crashed run kept for one manuscript. `id` names its recovery folder.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryItem {
    pub id: String,
    /// None when the folder predates keeping the path.
    pub path: Option<String>,
    pub content: String,
    /// completed / notStarted / ownPartial: the manuscript is as Then left it.
    /// unknown / idMismatch: changed outside Then. missing: not there.
    pub state: &'static str,
}

fn state_name(class: DiskClass) -> &'static str {
    match class {
        DiskClass::Completed => "completed",
        DiskClass::NotStarted => "notStarted",
        DiskClass::OwnPartial => "ownPartial",
        DiskClass::Unknown => "unknown",
        DiskClass::IdMismatch => "idMismatch",
        DiskClass::Missing => "missing",
    }
}

/// Whether the run that wrote `<run>.lock` still holds it. A lock nobody
/// holds is left by a crash and is removed.
fn run_alive(root: &Path, run: &str) -> bool {
    let path = lock_path(root, run);
    if !path.exists() {
        return false;
    }
    match open_exclusive(&path) {
        Ok(file) => {
            drop(file);
            let _ = std::fs::remove_file(&path);
            false
        }
        Err(_) => true,
    }
}

fn scan_in(root: &Path, own_run: &str) -> Result<Vec<RecoveryItem>, String> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut alive: HashMap<String, bool> = HashMap::new();
    let mut items = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let Some((run, _)) = id.split_once('-') else { continue };
        if run == own_run || *alive.entry(run.to_string()).or_insert_with(|| run_alive(root, run)) {
            continue;
        }
        let dir = entry.path();
        let mut fs = RealFs::default();
        // A folder that cannot be read now stays for the next start.
        let Ok(doc) = recorded_doc(&mut fs, &dir) else { continue };
        // Without a path there is no manuscript to compare: recover says missing.
        let probe = doc.clone().unwrap_or_else(|| dir.join("no-manuscript"));
        let recovered = match recover(&mut fs, &dir, &probe) {
            Ok(recovered) => recovered,
            Err(_) => continue,
        };
        drop(fs);
        let Some(recovered) = recovered else {
            // No base: the run crashed before anything was recorded.
            let _ = std::fs::remove_dir_all(&dir);
            continue;
        };
        if doc.is_some() && std::fs::read(&probe).ok().as_deref() == Some(&recovered.content[..]) {
            // The manuscript already holds the text: nothing to offer.
            let _ = std::fs::remove_dir_all(&dir);
            continue;
        }
        items.push(RecoveryItem {
            id,
            path: doc.map(|p| p.to_string_lossy().into_owned()),
            content: String::from_utf8_lossy(&recovered.content).into_owned(),
            state: state_name(recovered.class),
        });
    }
    Ok(items)
}

fn discard_in(root: &Path, own_run: &str, id: &str) -> Result<(), String> {
    let run = id.split_once('-').map(|(run, _)| run);
    if run.is_none() || run == Some(own_run) || id.contains(['/', '\\', '.']) {
        return Err("not a recovery folder of an earlier run".into());
    }
    match std::fs::remove_dir_all(root.join(id)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

/// What earlier runs that did not close normally kept, one item per manuscript.
/// Reads only; folders with nothing to offer are removed.
pub fn scan_recovery() -> Result<Vec<RecoveryItem>, String> {
    let area = area()?;
    scan_in(&area.root, &area.run)
}

/// The person has dealt with this item (restored it or let it go).
pub fn discard_recovery(id: &str) -> Result<(), String> {
    let area = area()?;
    discard_in(&area.root, &area.run, id)
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
    use super::*;

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(name: &str) -> Self {
            let started = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("then-journal-{name}-{}-{started}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const ME: &str = "999x1";

    /// A run that recorded `edit` after the file's text and then died.
    fn crashed_run(dir: &Path, doc: &Path, edit: &str) {
        let mut fs = RealFs::default();
        let mut journal = Journal::start(&mut fs, dir, doc, None).unwrap();
        let end = journal.content.len();
        journal.edit(&mut fs, end, 0, edit.as_bytes()).unwrap();
        journal.flush(&mut fs).unwrap();
    }

    #[test]
    fn scan_offers_the_text_and_discard_removes_the_folder() {
        let root = TempRoot::new("scan");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "あいう").unwrap();
        let dir = root.0.join("123x1-file_doc");
        crashed_run(&dir, &doc, "え");

        let items = scan_in(&root.0, ME).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "123x1-file_doc");
        assert_eq!(items[0].path.as_deref(), Some(doc.to_string_lossy().as_ref()));
        assert_eq!(items[0].content, "あいうえ");
        assert_eq!(items[0].state, "notStarted");
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "あいう");
        assert!(dir.exists(), "scanning keeps the folder until the person decides");

        discard_in(&root.0, ME, &items[0].id).unwrap();
        assert!(!dir.exists());
        assert!(scan_in(&root.0, ME).unwrap().is_empty());
    }

    #[test]
    fn outside_change_is_reported_without_touching_the_file() {
        let root = TempRoot::new("outside");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "one").unwrap();
        crashed_run(&root.0.join("123x1-k"), &doc, " two");
        std::fs::write(&doc, "changed elsewhere").unwrap();

        let items = scan_in(&root.0, ME).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].state, "unknown");
        assert_eq!(items[0].content, "one two");
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "changed elsewhere");
    }

    #[test]
    fn a_rename_is_followed() {
        let root = TempRoot::new("rename");
        let (old, new) = (root.0.join("old.md"), root.0.join("new.md"));
        std::fs::write(&old, "text").unwrap();
        let dir = root.0.join("123x1-k");
        {
            let mut fs = RealFs::default();
            let mut journal = Journal::start(&mut fs, &dir, &old, None).unwrap();
            std::fs::rename(&old, &new).unwrap();
            journal.set_doc(&mut fs, &new).unwrap();
            journal.edit(&mut fs, 4, 0, b"!").unwrap();
            journal.flush(&mut fs).unwrap();
        }
        let items = scan_in(&root.0, ME).unwrap();
        assert_eq!(items[0].path.as_deref(), Some(new.to_string_lossy().as_ref()));
        assert_eq!(items[0].state, "notStarted");
    }

    #[test]
    fn nothing_to_offer_is_cleared_and_own_run_is_left_alone() {
        let root = TempRoot::new("clear");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "same").unwrap();
        let dead = root.0.join("123x1-k");
        crashed_run(&dead, &doc, "");
        let mine = root.0.join(format!("{ME}-k"));
        crashed_run(&mine, &doc, "!");

        assert!(scan_in(&root.0, ME).unwrap().is_empty());
        assert!(!dead.exists());
        assert!(mine.exists());
        assert!(discard_in(&root.0, ME, &format!("{ME}-k")).is_err());
        assert!(discard_in(&root.0, ME, "..\\x-y").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn a_running_instance_is_skipped() {
        let root = TempRoot::new("alive");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "a").unwrap();
        crashed_run(&root.0.join("123x1-k"), &doc, "b");
        let lock = open_exclusive(&lock_path(&root.0, "123x1")).unwrap();
        assert!(scan_in(&root.0, ME).unwrap().is_empty());
        drop(lock);
        assert_eq!(scan_in(&root.0, ME).unwrap().len(), 1);
        assert!(!lock_path(&root.0, "123x1").exists());
    }

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
