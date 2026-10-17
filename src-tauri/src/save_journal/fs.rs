//! File operations the journal needs, behind one trait so the same journal code
//! runs on the real disk and on a simulated disk that can lose power.
//!
//! Every mutating call counts as one "op". A crash can be injected at any op:
//! the real implementation aborts the process there; the simulated one stops
//! accepting calls and lets the test decide what the disk kept.

use std::collections::HashMap;
use std::io::{self, Seek, SeekFrom, Write};
use std::path::Path;

#[derive(Debug)]
pub enum FsError {
    Io(io::Error),
    NotFound,
    DiskFull,
    Crash,
}

impl From<io::Error> for FsError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::NotFound {
            FsError::NotFound
        } else {
            FsError::Io(error)
        }
    }
}

pub type R<T> = Result<T, FsError>;

pub trait Fs {
    fn read(&mut self, p: &Path) -> R<Vec<u8>>;
    fn list(&mut self, dir: &Path) -> R<Vec<String>>;
    fn mkdirs(&mut self, p: &Path) -> R<()>;
    /// Create the file, or truncate it if it exists, then write `data`.
    fn create_write(&mut self, p: &Path, data: &[u8]) -> R<()>;
    /// Overwrite bytes of an existing file in place.
    fn write_at(&mut self, p: &Path, off: u64, data: &[u8]) -> R<()>;
    fn set_len(&mut self, p: &Path, len: u64) -> R<()>;
    /// Append, creating the file if needed.
    fn append(&mut self, p: &Path, data: &[u8]) -> R<()>;
    /// FlushFileBuffers / fsync.
    fn sync(&mut self, p: &Path) -> R<()>;
    fn remove(&mut self, p: &Path) -> R<()>;
    fn rename(&mut self, from: &Path, to: &Path) -> R<()>;
    fn file_id(&mut self, p: &Path) -> R<Option<String>>;
    /// Let go of a held handle (real disk only).
    fn close(&mut self, _p: &Path) {}
    /// True once an injected crash has happened (simulated disk only).
    fn dead(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------- real disk

#[derive(Default, Clone, Debug)]
pub struct Stats {
    pub bytes_written: u64,
    pub bytes_read: u64,
    pub syncs: u64,
}

/// Keeps a handle per file once it has been written, so a read right after a
/// write goes through the same handle instead of reopening the file.
#[derive(Default)]
pub struct RealFs {
    pub ops: u64,
    pub crash_at: Option<u64>,
    pub stats: Stats,
    pub(crate) handles: HashMap<std::path::PathBuf, std::fs::File>,
}

impl RealFs {
    fn tick(&mut self) -> bool {
        self.ops += 1;
        self.crash_at == Some(self.ops)
    }

    fn handle(&mut self, p: &Path, create: bool) -> R<&mut std::fs::File> {
        if !self.handles.contains_key(p) {
            let file = std::fs::OpenOptions::new().read(true).write(true).create(create).open(p)?;
            self.handles.insert(p.to_path_buf(), file);
        }
        Ok(self.handles.get_mut(p).unwrap())
    }
}

fn die() -> ! {
    std::process::abort()
}

impl Fs for RealFs {
    fn read(&mut self, p: &Path) -> R<Vec<u8>> {
        use std::io::Read;
        let data = match self.handles.get_mut(p) {
            Some(file) => {
                let mut data = Vec::new();
                file.seek(SeekFrom::Start(0))?;
                file.read_to_end(&mut data)?;
                data
            }
            None => std::fs::read(p)?,
        };
        self.stats.bytes_read += data.len() as u64;
        Ok(data)
    }

    fn list(&mut self, dir: &Path) -> R<Vec<String>> {
        let mut names = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            names.push(entry?.file_name().to_string_lossy().into_owned());
        }
        Ok(names)
    }

    fn mkdirs(&mut self, p: &Path) -> R<()> {
        std::fs::create_dir_all(p)?;
        Ok(())
    }

    fn create_write(&mut self, p: &Path, data: &[u8]) -> R<()> {
        let crash = self.tick();
        let file = self.handle(p, true)?;
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        if crash {
            file.write_all(&data[..data.len() / 2])?;
            die();
        }
        file.write_all(data)?;
        self.stats.bytes_written += data.len() as u64;
        Ok(())
    }

    fn write_at(&mut self, p: &Path, off: u64, data: &[u8]) -> R<()> {
        let crash = self.tick();
        let file = self.handle(p, false)?;
        file.seek(SeekFrom::Start(off))?;
        if crash {
            file.write_all(&data[..data.len() / 2])?;
            die();
        }
        file.write_all(data)?;
        self.stats.bytes_written += data.len() as u64;
        Ok(())
    }

    fn set_len(&mut self, p: &Path, len: u64) -> R<()> {
        if self.tick() {
            die();
        }
        self.handle(p, false)?.set_len(len)?;
        Ok(())
    }

    fn append(&mut self, p: &Path, data: &[u8]) -> R<()> {
        let crash = self.tick();
        let file = self.handle(p, true)?;
        file.seek(SeekFrom::End(0))?;
        if crash {
            file.write_all(&data[..data.len() / 2])?;
            die();
        }
        file.write_all(data)?;
        self.stats.bytes_written += data.len() as u64;
        Ok(())
    }

    fn sync(&mut self, p: &Path) -> R<()> {
        if self.tick() {
            die();
        }
        self.handle(p, false)?.sync_all()?;
        self.stats.syncs += 1;
        Ok(())
    }

    fn remove(&mut self, p: &Path) -> R<()> {
        if self.tick() {
            die();
        }
        self.handles.remove(p);
        std::fs::remove_file(p)?;
        Ok(())
    }

    fn rename(&mut self, from: &Path, to: &Path) -> R<()> {
        if self.tick() {
            die();
        }
        self.handles.remove(from);
        self.handles.remove(to);
        std::fs::rename(from, to)?;
        Ok(())
    }

    fn file_id(&mut self, p: &Path) -> R<Option<String>> {
        real_file_id(p)
    }

    fn close(&mut self, p: &Path) {
        self.handles.remove(p);
    }
}

/// Same identity Then already uses: volume serial + NTFS file index.
#[cfg(windows)]
pub fn real_file_id(p: &Path) -> R<Option<String>> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let file = std::fs::File::open(p)?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe {
        if GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info).is_err() {
            return Ok(None);
        }
    }
    let index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    if index == 0 {
        return Ok(None);
    }
    Ok(Some(format!("{:08x}:{:016x}", info.dwVolumeSerialNumber, index)))
}

#[cfg(not(windows))]
pub fn real_file_id(_p: &Path) -> R<Option<String>> {
    Ok(None)
}

