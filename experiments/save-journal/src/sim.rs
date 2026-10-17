//! Simulated disk for the crash tests: app crash and power loss.

use crate::fs::{Fs, FsError, R};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

// ----------------------------------------------------------- simulated disk

/// Small deterministic generator so every failing run can be replayed by seed.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }
}

#[derive(Clone)]
enum Op {
    Write(u64, Vec<u8>),
    SetLen(u64),
}

#[derive(Clone, Default)]
struct SimFile {
    /// What survives a power cut.
    durable: Vec<u8>,
    /// What a running process reads (the OS cache).
    cur: Vec<u8>,
    /// Writes since the last sync, in order.
    pending: Vec<Op>,
}

#[derive(Clone)]
enum DirOp {
    Link(String, u64),
    Unlink(String),
    Rename(String, String, u64),
}

fn apply(buf: &mut Vec<u8>, op: &Op) {
    match op {
        Op::Write(off, data) => {
            let off = *off as usize;
            if buf.len() < off + data.len() {
                buf.resize(off + data.len(), 0);
            }
            buf[off..off + data.len()].copy_from_slice(data);
        }
        Op::SetLen(len) => buf.resize(*len as usize, 0),
    }
}

fn apply_dir(names: &mut BTreeMap<String, u64>, op: &DirOp) {
    match op {
        DirOp::Link(name, key) => {
            names.insert(name.clone(), *key);
        }
        DirOp::Unlink(name) => {
            names.remove(name);
        }
        DirOp::Rename(from, to, key) => {
            names.remove(from);
            names.insert(to.clone(), *key);
        }
    }
}

fn key_of(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// A disk model with two crash kinds:
/// - app crash: the process dies, the OS keeps everything it was handed;
/// - power loss: each file keeps its synced data plus an arbitrary prefix of
///   later writes, and the next write may land torn (any subset of 512-byte
///   sectors). Directory changes keep an arbitrary prefix too.
///
/// Assumption (NTFS): metadata changes go through one ordered log, so a sync
/// of any file also makes every earlier directory change durable.
pub struct SimFs {
    files: HashMap<u64, SimFile>,
    next_key: u64,
    names: BTreeMap<String, u64>,
    durable_names: BTreeMap<String, u64>,
    pending_dir: Vec<DirOp>,
    pub ops: u64,
    pub crash_at: Option<u64>,
    /// Crash in the middle of a write instead of before it.
    pub partial: bool,
    /// From the n-th growing op on, every growing op fails with DiskFull.
    pub fail_growth_from: Option<u64>,
    pub growth_ops: u64,
    crashed: bool,
}

impl Default for SimFs {
    fn default() -> Self {
        SimFs {
            files: HashMap::new(),
            next_key: 1,
            names: BTreeMap::new(),
            durable_names: BTreeMap::new(),
            pending_dir: Vec::new(),
            ops: 0,
            crash_at: None,
            partial: false,
            fail_growth_from: None,
            growth_ops: 0,
            crashed: false,
        }
    }
}

impl SimFs {
    /// Counts the op; Ok(true) means "crash now".
    fn begin(&mut self, growth: bool) -> R<bool> {
        if self.crashed {
            return Err(FsError::Crash);
        }
        self.ops += 1;
        if self.crash_at == Some(self.ops) {
            self.crashed = true;
            return Ok(true);
        }
        if growth {
            self.growth_ops += 1;
            if let Some(n) = self.fail_growth_from {
                if self.growth_ops >= n {
                    return Err(FsError::DiskFull);
                }
            }
        }
        Ok(false)
    }

    fn push(&mut self, key: u64, op: Op) {
        let file = self.files.get_mut(&key).expect("live file");
        apply(&mut file.cur, &op);
        file.pending.push(op);
    }

    fn write_op(&mut self, key: u64, op: Op, crash: bool) -> R<()> {
        if crash {
            if self.partial {
                if let Op::Write(off, data) = &op {
                    let half = data[..data.len() / 2].to_vec();
                    self.push(key, Op::Write(*off, half));
                }
            }
            return Err(FsError::Crash);
        }
        self.push(key, op);
        Ok(())
    }

    fn link_new(&mut self, name: String) -> u64 {
        let key = self.next_key;
        self.next_key += 1;
        self.files.insert(key, SimFile::default());
        self.names.insert(name.clone(), key);
        self.pending_dir.push(DirOp::Link(name, key));
        key
    }

    fn lookup(&self, p: &Path) -> R<u64> {
        self.names.get(&key_of(p)).copied().ok_or(FsError::NotFound)
    }

    fn reset_flags(&mut self) {
        self.crashed = false;
        self.crash_at = None;
        self.partial = false;
        self.fail_growth_from = None;
    }

    pub fn app_crash(&mut self) {
        for file in self.files.values_mut() {
            file.durable = file.cur.clone();
            file.pending.clear();
        }
        self.durable_names = self.names.clone();
        self.pending_dir.clear();
        self.reset_flags();
    }

    pub fn power_loss(&mut self, rng: &mut Rng) {
        for file in self.files.values_mut() {
            let n = file.pending.len();
            let kept = rng.below(n as u64 + 1) as usize;
            for op in &file.pending[..kept] {
                apply(&mut file.durable, op);
            }
            if kept < n && rng.below(2) == 1 {
                if let Op::Write(off, data) = &file.pending[kept] {
                    let mut i = 0;
                    while i < data.len() {
                        let end = (i + 512).min(data.len());
                        if rng.below(2) == 1 {
                            apply(&mut file.durable, &Op::Write(off + i as u64, data[i..end].to_vec()));
                        }
                        i = end;
                    }
                }
            }
            file.cur = file.durable.clone();
            file.pending.clear();
        }
        let n = self.pending_dir.len();
        let kept = rng.below(n as u64 + 1) as usize;
        for op in self.pending_dir[..kept].to_vec() {
            apply_dir(&mut self.durable_names, &op);
        }
        self.names = self.durable_names.clone();
        self.pending_dir.clear();
        let live: HashSet<u64> = self.names.values().copied().collect();
        self.files.retain(|key, _| live.contains(key));
        self.reset_flags();
    }

    /// Test setup and inspection; not counted as ops.
    pub fn put_durable(&mut self, p: &Path, data: &[u8]) {
        let name = key_of(p);
        let key = match self.names.get(&name) {
            Some(key) => *key,
            None => self.link_new(name),
        };
        let file = self.files.get_mut(&key).unwrap();
        file.cur = data.to_vec();
        file.durable = data.to_vec();
        file.pending.clear();
        self.durable_names = self.names.clone();
        self.pending_dir.clear();
    }

    pub fn peek(&self, p: &Path) -> Option<Vec<u8>> {
        let key = self.names.get(&key_of(p))?;
        Some(self.files[key].cur.clone())
    }
}

impl Fs for SimFs {
    fn read(&mut self, p: &Path) -> R<Vec<u8>> {
        if self.crashed {
            return Err(FsError::Crash);
        }
        let key = self.lookup(p)?;
        Ok(self.files[&key].cur.clone())
    }

    fn list(&mut self, dir: &Path) -> R<Vec<String>> {
        let prefix = format!("{}/", key_of(dir));
        Ok(self
            .names
            .keys()
            .filter_map(|name| name.strip_prefix(&prefix))
            .filter(|rest| !rest.contains('/'))
            .map(str::to_string)
            .collect())
    }

    fn mkdirs(&mut self, _p: &Path) -> R<()> {
        Ok(())
    }

    fn create_write(&mut self, p: &Path, data: &[u8]) -> R<()> {
        let crash = self.begin(true)?;
        if crash && !self.partial {
            return Err(FsError::Crash);
        }
        let name = key_of(p);
        let key = match self.names.get(&name) {
            Some(key) => *key,
            None => self.link_new(name),
        };
        self.push(key, Op::SetLen(0));
        self.write_op(key, Op::Write(0, data.to_vec()), crash)
    }

    fn write_at(&mut self, p: &Path, off: u64, data: &[u8]) -> R<()> {
        let key = self.lookup(p)?;
        let len = self.files[&key].cur.len();
        let growth = off as usize + data.len() > len;
        let crash = match self.begin(growth) {
            // A full disk still takes the bytes that fit in the file's
            // existing space before the write fails.
            Err(FsError::DiskFull) => {
                let fit = len.saturating_sub(off as usize).min(data.len());
                if fit > 0 {
                    self.push(key, Op::Write(off, data[..fit].to_vec()));
                }
                return Err(FsError::DiskFull);
            }
            other => other?,
        };
        self.write_op(key, Op::Write(off, data.to_vec()), crash)
    }

    fn set_len(&mut self, p: &Path, len: u64) -> R<()> {
        let key = self.lookup(p)?;
        let growth = len as usize > self.files[&key].cur.len();
        if self.begin(growth)? {
            return Err(FsError::Crash);
        }
        self.push(key, Op::SetLen(len));
        Ok(())
    }

    fn append(&mut self, p: &Path, data: &[u8]) -> R<()> {
        let crash = self.begin(true)?;
        if crash && !self.partial {
            return Err(FsError::Crash);
        }
        let name = key_of(p);
        let key = match self.names.get(&name) {
            Some(key) => *key,
            None => self.link_new(name),
        };
        let off = self.files[&key].cur.len() as u64;
        self.write_op(key, Op::Write(off, data.to_vec()), crash)
    }

    fn sync(&mut self, p: &Path) -> R<()> {
        let key = self.lookup(p)?;
        if self.begin(false)? {
            return Err(FsError::Crash);
        }
        let file = self.files.get_mut(&key).unwrap();
        file.durable = file.cur.clone();
        file.pending.clear();
        for op in std::mem::take(&mut self.pending_dir) {
            apply_dir(&mut self.durable_names, &op);
        }
        Ok(())
    }

    fn remove(&mut self, p: &Path) -> R<()> {
        self.lookup(p)?;
        if self.begin(false)? {
            return Err(FsError::Crash);
        }
        let name = key_of(p);
        self.names.remove(&name);
        self.pending_dir.push(DirOp::Unlink(name));
        Ok(())
    }

    fn rename(&mut self, from: &Path, to: &Path) -> R<()> {
        let key = self.lookup(from)?;
        if self.begin(false)? {
            return Err(FsError::Crash);
        }
        let (from, to) = (key_of(from), key_of(to));
        self.names.remove(&from);
        self.names.insert(to.clone(), key);
        self.pending_dir.push(DirOp::Rename(from, to, key));
        Ok(())
    }

    fn file_id(&mut self, p: &Path) -> R<Option<String>> {
        Ok(Some(format!("sim:{}", self.lookup(p)?)))
    }

    fn dead(&self) -> bool {
        self.crashed
    }
}
