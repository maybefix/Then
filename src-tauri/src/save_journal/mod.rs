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

use self::core::{recorded_doc, recover, sha, DiskClass, Hash, Journal, SaveError};
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
    /// Held while this run lives; let go and removed when it closes normally.
    lock: Mutex<Option<std::fs::File>>,
}

static AREA: OnceLock<Area> = OnceLock::new();

fn journals() -> &'static Mutex<HashMap<String, Entry>> {
    static JOURNALS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    JOURNALS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// What Then itself last wrote to each manuscript (any path: journal saves,
/// replace, restore), so a journal that starts later does not take Then's own
/// write for an outside change.
fn then_writes() -> &'static Mutex<HashMap<PathBuf, Hash>> {
    static WRITES: OnceLock<Mutex<HashMap<PathBuf, Hash>>> = OnceLock::new();
    WRITES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn then_wrote(path: &Path) -> Option<Hash> {
    then_writes().lock().ok()?.get(path).copied()
}

fn remember_then_write(path: &Path, hash: Hash) {
    if let Ok(mut writes) = then_writes().lock() {
        writes.insert(path.to_path_buf(), hash);
    }
}

/// The 64-character hex SHA-256 the app passes around (TextDocument.contentHash).
/// Empty or malformed means "not known": nothing to compare.
pub fn parse_hash(hex: Option<&str>) -> Option<Hash> {
    let hex = hex?.trim();
    if hex.len() != 64 {
        return None;
    }
    let mut hash = [0u8; 32];
    for (index, byte) in hash.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(index * 2..index * 2 + 2)?, 16).ok()?;
    }
    Some(hash)
}

/// Prefix of every refusal because the file is not the one Then knows; the
/// app tells these apart from other save failures by it.
pub const CONFLICT: &str = "document content conflict";

fn start_journal(key: &str, path: &str, text: Option<Vec<u8>>, opened: Option<&str>) -> Result<Entry, String> {
    let mut fs = RealFs::default();
    let doc = Path::new(path);
    let journal = Journal::start_from(&mut fs, &journal_dir(key)?, doc, text, parse_hash(opened), then_wrote(doc))
        .map_err(fs_error)?;
    Ok(Entry { journal, fs })
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
    let _ = AREA.set(Area { root: recovery_root, run, lock: Mutex::new(lock) });
}

/// A normal close: this run leaves no lock behind.
fn release_run_lock() {
    let Ok(area) = area() else { return };
    let held = area.lock.lock().ok().and_then(|mut lock| lock.take());
    if held.is_some() {
        drop(held);
        let _ = std::fs::remove_file(lock_path(&area.root, &area.run));
    }
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
/// `base` is the text before the first change (generation 0); it opens the
/// journal, with `opened` the hash of the file when the tab read it.
pub fn record_edits(
    key: &str,
    path: &str,
    base: Option<String>,
    opened: Option<&str>,
    edits: Vec<EditInput>,
) -> Result<(), String> {
    let mut journals = journals().lock().map_err(|_| "journal lock poisoned")?;
    if !journals.contains_key(key) {
        let Some(base) = base else {
            return Err("journal is not open".into());
        };
        let entry = start_journal(key, path, Some(base.into_bytes()), opened)?;
        journals.insert(key.to_string(), entry);
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
/// requested. Changes recorded after it stay in the journal. `opened` is
/// used only when no journal is open yet (see record_edits).
pub fn save(key: &str, path: &str, gen: u64, content: &str, opened: Option<&str>) -> Result<Saved, String> {
    let mut journals = journals().lock().map_err(|_| "journal lock poisoned")?;
    if !journals.contains_key(key) {
        let entry = start_journal(key, path, None, opened)?;
        journals.insert(key.to_string(), entry);
    }
    let entry = journals.get_mut(key).unwrap();
    // Queued if it cannot be written now; the save's own sync writes it first.
    let _ = entry.journal.set_doc(&mut entry.fs, Path::new(path));
    let result = entry.journal.save(&mut entry.fs, gen, content.as_bytes());
    if matches!(result, Ok(true)) {
        remember_then_write(Path::new(path), sha(content.as_bytes()));
    }
    match result {
        Ok(_) => Ok(Saved {
            file_id: Some(entry.journal.disk_id().to_string()).filter(|id| !id.is_empty()),
        }),
        Err(SaveError::Ahead) => Err("保存する世代の記録がまだ届いていません".into()),
        Err(SaveError::External(why)) => Err(format!("{CONFLICT}: ファイルが外部で変更されたため保存しませんでした（{why}）")),
        Err(SaveError::Journal(error)) => Err(format!("復旧用の記録を書けないため保存しませんでした（{}）", fs_error(error))),
        Err(SaveError::Original(error)) => Err(format!("failed to write text file: {}", fs_error(error))),
        Err(SaveError::Verify) => Err("保存した内容を読み直すと一致しませんでした".into()),
    }
}

/// Then wrote `path` through another command; journals on it take that as
/// the file's known state instead of an outside change.
pub fn note_then_write(path: &Path, content: &[u8]) {
    remember_then_write(path, sha(content));
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

/// The person chose to overwrite the file as it is now: `expected` is the
/// hash of the file they saw (and Then kept). If it changed again since,
/// refuse, so a newer outside change is not lost either.
pub fn accept_disk(key: &str, path: &str, expected: &str) -> Result<(), String> {
    let doc = Path::new(path);
    let expected = parse_hash(Some(expected)).ok_or("expected hash is not a SHA-256")?;
    let current = std::fs::read(doc).map_err(|error| format!("failed to read text file: {error}"))?;
    if sha(&current) != expected {
        return Err(format!("{CONFLICT}: 確かめたあとにファイルがまた変更されました"));
    }
    let mut journals = journals().lock().map_err(|_| "journal lock poisoned")?;
    match journals.get_mut(key) {
        Some(entry) => {
            let id = real_file_id(doc).map_err(fs_error)?.unwrap_or_default();
            entry.journal.note_disk(expected, id);
        }
        // No journal yet: one started now takes the file as it is.
        None => {
            let entry = start_journal(key, path, None, None)?;
            journals.insert(key.to_string(), entry);
        }
    }
    Ok(())
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
            // A lock left by an earlier run that kept no folder: run_alive
            // removes it once nobody holds it.
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(run) = name.strip_suffix(".lock") {
                if run != own_run {
                    alive.entry(run.to_string()).or_insert_with(|| run_alive(root, run));
                }
            }
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
    release_run_lock();
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

    // Saves while the file changes outside Then (BINDER 1-3a,
    // docs/SAVE_EXTERNAL_CHANGE_FIX_PLAN.md). These go through record_edits
    // and save as the app does, so they need the recovery area set.
    fn test_area() {
        static AREA_ROOT: OnceLock<()> = OnceLock::new();
        AREA_ROOT.get_or_init(|| {
            let own = format!("then-journal-area-{}", std::process::id());
            // Earlier test runs leave their area behind (the run lock is held until the process ends).
            if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("then-journal-area-") && name != own {
                        let _ = std::fs::remove_dir_all(entry.path());
                    }
                }
            }
            init(std::env::temp_dir().join(own));
        });
    }

    /// TextDocument.contentHash of `text`.
    fn hex(text: &str) -> String {
        sha(text.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// One change appended at the end of `before`, as the editor would send it.
    fn append_edit(gen: u64, before: &str, insert: &str) -> EditInput {
        let length = before.encode_utf16().count();
        EditInput { gen, replace: false, length, from: length, to: length, insert: insert.into() }
    }

    #[test]
    fn external_change_before_the_first_edit_is_not_overwritten() {
        test_area();
        let root = TempRoot::new("external-before-edit");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "開いたときの本文").unwrap();
        // The tab holds what was read when the file was opened.
        let opened = std::fs::read_to_string(&doc).unwrap();
        std::fs::write(&doc, "外部で書き換えた本文").unwrap();

        let key = "external-before-edit";
        let path = doc.to_string_lossy().to_string();
        record_edits(key, &path, Some(opened.clone()), Some(&hex(&opened)), vec![append_edit(1, &opened, "。")]).unwrap();
        let result = save(key, &path, 1, &format!("{opened}。"), None);
        forget(key, true);

        assert_eq!(
            std::fs::read_to_string(&doc).unwrap(),
            "外部で書き換えた本文",
            "a change made between opening and the first edit must not be overwritten"
        );
        let error = result.err().expect("the save must report the outside change");
        assert!(error.starts_with(CONFLICT), "the app tells a conflict apart by its prefix: {error}");
    }

    #[test]
    fn external_change_without_a_journal_is_refused_too() {
        // A save before any recorded change (no journal yet) uses the same baseline.
        test_area();
        let root = TempRoot::new("external-no-journal");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "本文").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();
        std::fs::write(&doc, "外部").unwrap();

        let key = "external-no-journal";
        let path = doc.to_string_lossy().to_string();
        let result = save(key, &path, 0, "本文。", Some(&hex(&opened)));
        forget(key, true);

        assert!(result.err().is_some_and(|error| error.starts_with(CONFLICT)));
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "外部");
    }

    #[test]
    fn external_change_by_then_itself_is_not_a_conflict() {
        // Replace or restore wrote the file after the tab read it; the tab's hash is older.
        test_area();
        let root = TempRoot::new("external-then-write");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "本文").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();
        std::fs::write(&doc, "置換した本文").unwrap();
        note_then_write(&doc, "置換した本文".as_bytes());

        let key = "external-then-write";
        let path = doc.to_string_lossy().to_string();
        let replaced = "置換した本文".to_string();
        record_edits(key, &path, Some(replaced.clone()), Some(&hex(&opened)), vec![append_edit(1, &replaced, "。")])
            .unwrap();
        let result = save(key, &path, 1, "置換した本文。", None);
        forget(key, true);

        assert!(result.is_ok(), "{result:?}", result = result.err());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "置換した本文。");
    }

    #[test]
    fn external_change_overwrite_after_accepting_the_file() {
        // 「この内容で上書きする」: the person saw the file as it is now.
        test_area();
        let root = TempRoot::new("external-overwrite");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "本文").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();
        let key = "external-overwrite";
        let path = doc.to_string_lossy().to_string();
        record_edits(key, &path, Some(opened.clone()), Some(&hex(&opened)), vec![append_edit(1, &opened, "。")]).unwrap();
        std::fs::write(&doc, "外部").unwrap();
        assert!(save(key, &path, 1, "本文。", None).is_err());

        accept_disk(key, &path, &hex("外部")).unwrap();
        let first = save(key, &path, 1, "本文。", None);
        record_edits(key, &path, None, None, vec![append_edit(2, "本文。", "続き")]).unwrap();
        let second = save(key, &path, 2, "本文。続き", None);
        forget(key, true);

        assert!(first.is_ok() && second.is_ok());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "本文。続き");
    }

    #[test]
    fn external_change_accept_refuses_a_newer_change() {
        test_area();
        let root = TempRoot::new("external-accept-stale");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "本文").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();
        let key = "external-accept-stale";
        let path = doc.to_string_lossy().to_string();
        record_edits(key, &path, Some(opened.clone()), Some(&hex(&opened)), vec![append_edit(1, &opened, "。")]).unwrap();
        std::fs::write(&doc, "外部2").unwrap();

        // The person saw "外部1"; the file changed again before they chose.
        let accepted = accept_disk(key, &path, &hex("外部1"));
        let saved = save(key, &path, 1, "本文。", None);
        forget(key, true);

        assert!(accepted.err().is_some_and(|error| error.starts_with(CONFLICT)));
        assert!(saved.is_err());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "外部2");
    }

    #[test]
    fn external_change_reload_starts_again_from_the_file() {
        // 「ファイルの内容を読み込む」: the journal is dropped and the tab holds the file.
        test_area();
        let root = TempRoot::new("external-reload");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "本文").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();
        let key = "external-reload";
        let path = doc.to_string_lossy().to_string();
        record_edits(key, &path, Some(opened.clone()), Some(&hex(&opened)), vec![append_edit(1, &opened, "。")]).unwrap();
        std::fs::write(&doc, "外部").unwrap();
        assert!(save(key, &path, 1, "本文。", None).is_err());

        forget(key, true);
        let reloaded = std::fs::read_to_string(&doc).unwrap();
        record_edits(key, &path, Some(reloaded.clone()), Some(&hex(&reloaded)), vec![append_edit(1, &reloaded, "！")])
            .unwrap();
        let result = save(key, &path, 1, "外部！", None);
        forget(key, true);

        assert!(result.is_ok());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "外部！");
    }

    #[test]
    fn external_change_after_an_edit_is_refused() {
        test_area();
        let root = TempRoot::new("external-after-edit");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "本文").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();

        let key = "external-after-edit";
        let path = doc.to_string_lossy().to_string();
        record_edits(key, &path, Some(opened.clone()), Some(&hex(&opened)), vec![append_edit(1, &opened, "。")]).unwrap();
        std::fs::write(&doc, "外部で書き換えた本文").unwrap();
        let result = save(key, &path, 1, &format!("{opened}。"), None);
        forget(key, true);

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "外部で書き換えた本文");
    }

    #[test]
    fn external_change_absent_saves_quietly() {
        test_area();
        let root = TempRoot::new("external-none");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "本文").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();

        let key = "external-none";
        let path = doc.to_string_lossy().to_string();
        record_edits(key, &path, Some(opened.clone()), Some(&hex(&opened)), vec![append_edit(1, &opened, "。")]).unwrap();
        let first = save(key, &path, 1, "本文。", None);
        record_edits(key, &path, None, None, vec![append_edit(2, "本文。", "続き")]).unwrap();
        let second = save(key, &path, 2, "本文。続き", None);
        forget(key, true);

        assert!(first.is_ok() && second.is_ok());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "本文。続き");
    }

    #[test]
    fn external_change_of_line_endings_only_is_refused() {
        // The whole file is compared byte for byte, so CRLF <-> LF alone counts
        // as a change (plan Q2: asking beats losing an outside edit).
        test_area();
        let root = TempRoot::new("external-crlf");
        let doc = root.0.join("doc.md");
        std::fs::write(&doc, "一行目\n二行目").unwrap();
        let opened = std::fs::read_to_string(&doc).unwrap();

        let key = "external-crlf";
        let path = doc.to_string_lossy().to_string();
        record_edits(key, &path, Some(opened.clone()), Some(&hex(&opened)), vec![append_edit(1, &opened, "。")]).unwrap();
        std::fs::write(&doc, "一行目\r\n二行目").unwrap();
        let result = save(key, &path, 1, &format!("{opened}。"), None);
        forget(key, true);

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "一行目\r\n二行目");
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

    #[test]
    fn scan_removes_locks_nobody_holds_even_without_a_folder() {
        let root = TempRoot::new("stale-locks");
        // Two earlier runs closed without a journal folder; one is still running.
        std::fs::write(lock_path(&root.0, "111x1"), b"").unwrap();
        std::fs::write(lock_path(&root.0, "222x2"), b"").unwrap();
        let held = open_exclusive(&lock_path(&root.0, "333x3")).unwrap();
        let own = open_exclusive(&lock_path(&root.0, ME)).unwrap();

        let items = scan_in(&root.0, ME).unwrap();

        assert!(items.is_empty());
        assert!(!lock_path(&root.0, "111x1").exists());
        assert!(!lock_path(&root.0, "222x2").exists());
        assert!(lock_path(&root.0, "333x3").exists(), "a running instance keeps its lock");
        assert!(lock_path(&root.0, ME).exists(), "this run keeps its own lock");
        drop(held);
        drop(own);
    }
}
