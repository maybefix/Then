//! Journaled in-place save.
//!
//! Recovery area (per document, in Then's app data): numbered segments, each a
//! base file (the full text of a generation known to be on disk) and a log of
//! records after it. The base is written last, so a segment exists only once
//! its log is already durable.
//!
//! Save of generation G:
//!   1. the manuscript on disk still has the identity and hash Then last saw;
//!   2. an intent record (G, file id, hash before, hash planned) is appended,
//!      and the log is synced, so every edit up to G is durable;
//!   3. the manuscript is rewritten in place (grown first, shrunk last);
//!   4. it is read back and its hash checked;
//!   5. a done record is appended (not synced).
//! The manuscript itself is synced only when its records are about to be
//! dropped, which happens when the log has grown to the size of the text.

use crate::fs::{Fs, FsError, R};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

pub type Hash = [u8; 32];

pub fn sha(bytes: &[u8]) -> Hash {
    Sha256::digest(bytes).into()
}

const REC_MAGIC: &[u8; 4] = b"TLR1";
const BASE_MAGIC: &[u8; 4] = b"TBS1";

#[derive(Clone, Debug)]
pub enum Rec {
    /// Replace `del` bytes at `pos` with `ins`; `after` is the hash of the result.
    Edit { gen: u64, pos: u64, del: u64, ins: Vec<u8>, after: Hash },
    Intent { gen: u64, pre_gen: u64, id: String, pre: Hash, planned: Hash },
    Done { gen: u64 },
}

impl Rec {
    fn gen(&self) -> u64 {
        match self {
            Rec::Edit { gen, .. } | Rec::Intent { gen, .. } | Rec::Done { gen } => *gen,
        }
    }
}

fn put_u32(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn put_u64(v: &mut Vec<u8>, x: u64) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn put_bytes(v: &mut Vec<u8>, b: &[u8]) {
    put_u32(v, b.len() as u32);
    v.extend_from_slice(b);
}

pub fn encode(rec: &Rec) -> Vec<u8> {
    let (kind, gen, payload) = match rec {
        Rec::Edit { gen, pos, del, ins, after } => {
            let mut p = Vec::with_capacity(ins.len() + 56);
            put_u64(&mut p, *pos);
            put_u64(&mut p, *del);
            put_bytes(&mut p, ins);
            p.extend_from_slice(after);
            (1u8, *gen, p)
        }
        Rec::Intent { gen, pre_gen, id, pre, planned } => {
            let mut p = Vec::new();
            put_u64(&mut p, *pre_gen);
            put_bytes(&mut p, id.as_bytes());
            p.extend_from_slice(pre);
            p.extend_from_slice(planned);
            (2u8, *gen, p)
        }
        Rec::Done { gen } => (3u8, *gen, Vec::new()),
    };
    let mut v = Vec::with_capacity(payload.len() + 53);
    v.extend_from_slice(REC_MAGIC);
    v.push(kind);
    put_u64(&mut v, gen);
    put_bytes(&mut v, &payload);
    let h = sha(&v);
    v.extend_from_slice(&h);
    v
}

struct Cur<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Cur<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.i.checked_add(n)?;
        if end > self.b.len() {
            return None;
        }
        let s = &self.b[self.i..end];
        self.i = end;
        Some(s)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn bytes(&mut self) -> Option<&'a [u8]> {
        let n = self.u32()? as usize;
        self.take(n)
    }
    fn hash(&mut self) -> Option<Hash> {
        self.take(32)?.try_into().ok()
    }
}

fn decode_one(b: &[u8]) -> Option<(Rec, usize)> {
    let mut c = Cur { b, i: 0 };
    if c.take(4)? != REC_MAGIC {
        return None;
    }
    let kind = c.take(1)?[0];
    let gen = c.u64()?;
    let payload = c.bytes()?;
    let end = c.i;
    let h = c.hash()?;
    if sha(&b[..end]) != h {
        return None;
    }
    let mut p = Cur { b: payload, i: 0 };
    let rec = match kind {
        1 => Rec::Edit {
            gen,
            pos: p.u64()?,
            del: p.u64()?,
            ins: p.bytes()?.to_vec(),
            after: p.hash()?,
        },
        2 => Rec::Intent {
            gen,
            pre_gen: p.u64()?,
            id: String::from_utf8(p.bytes()?.to_vec()).ok()?,
            pre: p.hash()?,
            planned: p.hash()?,
        },
        3 => Rec::Done { gen },
        _ => return None,
    };
    Some((rec, c.i))
}

/// Records up to the first one that does not check out, and whether the log
/// ended cleanly (a torn tail is normal after a crash).
pub fn decode_log(b: &[u8]) -> (Vec<Rec>, bool) {
    let mut recs = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match decode_one(&b[i..]) {
            Some((rec, n)) => {
                recs.push(rec);
                i += n;
            }
            None => return (recs, false),
        }
    }
    (recs, true)
}

pub struct Base {
    pub gen: u64,
    pub id: String,
    pub content: Vec<u8>,
}

pub fn encode_base(base: &Base) -> Vec<u8> {
    let mut v = Vec::with_capacity(base.content.len() + 64);
    v.extend_from_slice(BASE_MAGIC);
    put_u64(&mut v, base.gen);
    put_bytes(&mut v, base.id.as_bytes());
    put_u64(&mut v, base.content.len() as u64);
    v.extend_from_slice(&base.content);
    let h = sha(&v);
    v.extend_from_slice(&h);
    v
}

pub fn decode_base(b: &[u8]) -> Option<Base> {
    if b.len() < 32 {
        return None;
    }
    let (body, h) = b.split_at(b.len() - 32);
    if sha(body)[..] != h[..] {
        return None;
    }
    let mut c = Cur { b: body, i: 0 };
    if c.take(4)? != BASE_MAGIC {
        return None;
    }
    let gen = c.u64()?;
    let id = String::from_utf8(c.bytes()?.to_vec()).ok()?;
    let n = c.u64()? as usize;
    let content = c.take(n)?.to_vec();
    if c.i != body.len() {
        return None;
    }
    Some(Base { gen, id, content })
}

pub fn seg_base(dir: &Path, k: u64) -> PathBuf {
    dir.join(format!("seg-{k:08}.base"))
}
pub fn seg_log(dir: &Path, k: u64) -> PathBuf {
    dir.join(format!("seg-{k:08}.log"))
}

#[derive(Debug)]
pub enum SaveError {
    /// The manuscript changed outside Then; nothing was written to it.
    External(&'static str),
    /// The recovery area could not be written; nothing was written to the manuscript.
    Journal(FsError),
    /// Reading or writing the manuscript failed.
    Original(FsError),
    /// The read-back did not match what was written.
    Verify,
}

#[derive(Default, Clone, Debug)]
pub struct JStats {
    pub compactions: u64,
    pub compaction_failures: u64,
    pub saves: u64,
}

pub struct Journal {
    pub dir: PathBuf,
    pub doc: PathBuf,
    seg: u64,
    log_len: u64,
    log_durable: u64,
    log_since_base: u64,
    /// Records not yet handed to the OS (only non-empty after a write failed).
    queue: VecDeque<(u64, Vec<u8>)>,
    /// Latest edit generation (the text Then shows).
    pub gen: u64,
    /// Latest generation whose record the OS has (survives an app crash).
    pub logged_gen: u64,
    /// Latest generation whose record is synced (survives a power cut).
    pub durable_gen: u64,
    pub content: Vec<u8>,
    pub disk_gen: u64,
    disk_hash: Hash,
    disk_id: String,
    pub stats: JStats,
}

impl Journal {
    /// Start journaling a document whose on-disk text is the base (gen 0).
    pub fn start<F: Fs>(fs: &mut F, dir: &Path, doc: &Path) -> R<Journal> {
        fs.mkdirs(dir)?;
        let content = fs.read(doc)?;
        let id = fs.file_id(doc)?.unwrap_or_default();
        let log = seg_log(dir, 0);
        fs.create_write(&log, &[])?;
        fs.sync(&log)?;
        let base = seg_base(dir, 0);
        fs.create_write(&base, &encode_base(&Base { gen: 0, id: id.clone(), content: content.clone() }))?;
        fs.sync(&base)?;
        Ok(Journal {
            dir: dir.to_path_buf(),
            doc: doc.to_path_buf(),
            seg: 0,
            log_len: 0,
            log_durable: 0,
            log_since_base: 0,
            queue: VecDeque::new(),
            gen: 0,
            logged_gen: 0,
            durable_gen: 0,
            disk_gen: 0,
            disk_hash: sha(&content),
            disk_id: id,
            content,
            stats: JStats::default(),
        })
    }

    fn log_path(&self) -> PathBuf {
        seg_log(&self.dir, self.seg)
    }

    fn drain<F: Fs>(&mut self, fs: &mut F) -> R<()> {
        while let Some((gen, bytes)) = self.queue.front() {
            fs.append(&self.log_path(), bytes)?;
            let n = bytes.len() as u64;
            self.logged_gen = self.logged_gen.max(*gen);
            self.log_len += n;
            self.log_since_base += n;
            self.queue.pop_front();
        }
        Ok(())
    }

    /// One editor change, in byte offsets of the UTF-8 text. The text changes
    /// even if the record cannot be written; it is retried on the next call.
    pub fn edit<F: Fs>(&mut self, fs: &mut F, pos: usize, del: usize, ins: &[u8]) -> R<()> {
        self.content.splice(pos..pos + del, ins.iter().copied());
        self.gen += 1;
        let rec = Rec::Edit {
            gen: self.gen,
            pos: pos as u64,
            del: del as u64,
            ins: ins.to_vec(),
            after: sha(&self.content),
        };
        self.queue.push_back((self.gen, encode(&rec)));
        self.drain(fs)
    }

    /// What the background flusher does: sync whatever the log holds.
    pub fn flush<F: Fs>(&mut self, fs: &mut F) -> R<()> {
        self.drain(fs)?;
        if self.log_durable < self.log_len {
            fs.sync(&self.log_path())?;
            self.log_durable = self.log_len;
        }
        self.durable_gen = self.logged_gen;
        Ok(())
    }

    pub fn save<F: Fs>(&mut self, fs: &mut F) -> Result<bool, SaveError> {
        if self.gen == self.disk_gen {
            return Ok(false);
        }
        let g = self.gen;
        let snapshot = self.content.clone();
        let planned = sha(&snapshot);

        // 1. The manuscript is still the one Then last saw.
        let current = fs.read(&self.doc).map_err(SaveError::Original)?;
        let id = fs.file_id(&self.doc).map_err(SaveError::Original)?.unwrap_or_default();
        if id != self.disk_id {
            return Err(SaveError::External("file identity changed"));
        }
        if sha(&current) != self.disk_hash {
            return Err(SaveError::External("content changed"));
        }

        // 2. Everything up to G is durable before the manuscript is touched.
        let intent = Rec::Intent { gen: g, pre_gen: self.disk_gen, id: id.clone(), pre: self.disk_hash, planned };
        self.queue.push_back((g, encode(&intent)));
        self.flush(fs).map_err(SaveError::Journal)?;

        // 3. In place. Growing first means a full disk fails before any byte changes.
        let (old_len, new_len) = (current.len(), snapshot.len());
        if new_len > old_len {
            fs.set_len(&self.doc, new_len as u64).map_err(SaveError::Original)?;
        }
        fs.write_at(&self.doc, 0, &snapshot).map_err(SaveError::Original)?;
        if new_len < old_len {
            fs.set_len(&self.doc, new_len as u64).map_err(SaveError::Original)?;
        }

        // 4. Read back.
        let back = fs.read(&self.doc).map_err(SaveError::Original)?;
        if sha(&back) != planned {
            return Err(SaveError::Verify);
        }
        self.disk_gen = g;
        self.disk_hash = planned;
        self.disk_id = id;
        self.stats.saves += 1;

        // 5. Done (best effort; recovery does not need it).
        self.queue.push_back((g, encode(&Rec::Done { gen: g })));
        let _ = self.drain(fs);

        // The save itself is complete here. A failed compaction leaves the
        // current segment in use (still valid) and is retried on a later save.
        if self.log_since_base >= (snapshot.len() as u64).max(1) && self.compact(fs, g, &snapshot).is_err() {
            self.stats.compaction_failures += 1;
        }
        Ok(true)
    }

    /// New segment whose base is generation `g`, which is on disk and now synced.
    fn compact<F: Fs>(&mut self, fs: &mut F, g: u64, snapshot: &[u8]) -> R<()> {
        self.drain(fs)?;
        fs.sync(&self.doc)?;
        let (recs, _) = decode_log(&fs.read(&self.log_path())?);
        let mut keep = Vec::new();
        for rec in recs.iter().filter(|r| matches!(r, Rec::Edit { .. }) && r.gen() > g) {
            keep.extend(encode(rec));
        }
        let k = self.seg + 1;
        let log = seg_log(&self.dir, k);
        fs.create_write(&log, &keep)?;
        fs.sync(&log)?;
        let base = seg_base(&self.dir, k);
        fs.create_write(&base, &encode_base(&Base { gen: g, id: self.disk_id.clone(), content: snapshot.to_vec() }))?;
        fs.sync(&base)?;
        let old = self.seg;
        self.seg = k;
        self.log_len = keep.len() as u64;
        self.log_durable = self.log_len;
        self.log_since_base = self.log_len;
        let _ = fs.remove(&seg_log(&self.dir, old));
        let _ = fs.remove(&seg_base(&self.dir, old));
        self.stats.compactions += 1;
        Ok(())
    }
}

// ------------------------------------------------------------------ recovery

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum DiskClass {
    /// The last planned write is on disk.
    Completed,
    /// The manuscript is as it was before the last planned write.
    NotStarted,
    /// Every byte comes from versions Then itself wrote (an unfinished write).
    OwnPartial,
    /// Same identity, content Then cannot explain: treat as an outside change.
    Unknown,
    /// The file was replaced by another one.
    IdMismatch,
    Missing,
}

pub struct Recovered {
    /// The text to put back in Then (latest replayable generation).
    pub content: Vec<u8>,
    pub gen: u64,
    pub base_gen: u64,
    pub class: DiskClass,
    pub replay_ok: bool,
}

/// Each byte matches one of the versions Then wrote, and the length is one of theirs.
fn is_mix(orig: &[u8], versions: &[Vec<u8>]) -> bool {
    if !versions.iter().any(|v| v.len() == orig.len()) {
        return false;
    }
    orig.iter().enumerate().all(|(i, b)| {
        versions.iter().any(|v| match v.get(i) {
            Some(x) => x == b,
            None => *b == 0,
        })
    })
}

/// Reads the recovery area and the manuscript; never writes either.
pub fn recover<F: Fs>(fs: &mut F, dir: &Path, doc: &Path) -> R<Option<Recovered>> {
    let names = match fs.list(dir) {
        Ok(names) => names,
        Err(FsError::NotFound) => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut segs: Vec<u64> = names
        .iter()
        .filter_map(|n| n.strip_prefix("seg-")?.strip_suffix(".base")?.parse().ok())
        .collect();
    segs.sort_unstable_by(|a, b| b.cmp(a));
    let mut chosen = None;
    for k in segs {
        if let Ok(bytes) = fs.read(&seg_base(dir, k)) {
            if let Some(base) = decode_base(&bytes) {
                chosen = Some((k, base));
                break;
            }
        }
    }
    let Some((k, base)) = chosen else { return Ok(None) };
    let log = match fs.read(&seg_log(dir, k)) {
        Ok(bytes) => bytes,
        Err(FsError::NotFound) => Vec::new(),
        Err(e) => return Err(e),
    };
    let (recs, _) = decode_log(&log);

    let mut content = base.content.clone();
    let mut gen = base.gen;
    let mut replay_ok = true;
    let mut versions = vec![base.content.clone()];
    let mut last_intent: Option<(Hash, Hash, String)> = None;
    for rec in &recs {
        match rec {
            Rec::Edit { gen: g, pos, del, ins, after } => {
                if !replay_ok || *g <= gen {
                    continue;
                }
                let (p, d) = (*pos as usize, *del as usize);
                if *g != gen + 1 || p + d > content.len() {
                    replay_ok = false;
                    continue;
                }
                let mut next = content.clone();
                next.splice(p..p + d, ins.iter().copied());
                if sha(&next) != *after {
                    replay_ok = false;
                    continue;
                }
                content = next;
                gen = *g;
            }
            Rec::Intent { gen: g, id, pre, planned, .. } => {
                if replay_ok && *g == gen && sha(&content) == *planned {
                    versions.push(content.clone());
                }
                last_intent = Some((*pre, *planned, id.clone()));
            }
            Rec::Done { .. } => {}
        }
    }

    let (pre, planned, expected_id) = match last_intent {
        Some((pre, planned, id)) => (pre, Some(planned), id),
        None => (sha(&base.content), None, base.id.clone()),
    };
    let class = match fs.read(doc) {
        Err(FsError::NotFound) => DiskClass::Missing,
        Err(e) => return Err(e),
        Ok(orig) => {
            let id = fs.file_id(doc)?.unwrap_or_default();
            let h = sha(&orig);
            if !expected_id.is_empty() && !id.is_empty() && id != expected_id {
                DiskClass::IdMismatch
            } else if Some(h) == planned {
                DiskClass::Completed
            } else if h == pre {
                DiskClass::NotStarted
            } else if is_mix(&orig, &versions) {
                DiskClass::OwnPartial
            } else {
                DiskClass::Unknown
            }
        }
    };
    Ok(Some(Recovered { content, gen, base_gen: base.gen, class, replay_ok }))
}
