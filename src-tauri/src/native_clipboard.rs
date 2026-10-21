//! Clipboard operations for the native input owner, independent of webview focus.
#[tauri::command]
pub async fn native_clipboard_read() -> Result<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| unsafe { imp::read().map_err(|e| e.to_string()) })
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Windows専用です".into())
    }
}

#[tauri::command]
pub async fn native_clipboard_write(
    window: tauri::WebviewWindow,
    text: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        tauri::async_runtime::spawn_blocking(move || unsafe {
            imp::write(owner, &text).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, text);
        Err("Windows専用です".into())
    }
}

#[cfg(windows)]
mod imp {
    use windows::{
        core::*,
        Win32::{
            Foundation::*,
            System::{DataExchange::*, Memory::*, Ole::CF_UNICODETEXT},
        },
    };
    struct Clipboard;
    impl Drop for Clipboard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
    unsafe fn open(owner: Option<HWND>) -> Result<Clipboard> {
        for attempt in 0..10 {
            match OpenClipboard(owner) {
                Ok(()) => return Ok(Clipboard),
                Err(error) if attempt == 9 => return Err(error),
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(5)),
            }
        }
        unreachable!()
    }
    struct Memory(HGLOBAL);
    impl Drop for Memory {
        fn drop(&mut self) {
            unsafe {
                let _ = GlobalFree(Some(self.0));
            }
        }
    }
    struct Locked(HGLOBAL, *mut u16);
    impl Drop for Locked {
        fn drop(&mut self) {
            unsafe {
                let _ = GlobalUnlock(self.0);
            }
        }
    }
    unsafe fn lock(handle: HGLOBAL) -> Result<Locked> {
        let pointer = GlobalLock(handle) as *mut u16;
        if pointer.is_null() {
            Err(Error::from_win32())
        } else {
            Ok(Locked(handle, pointer))
        }
    }
    pub unsafe fn write(owner: isize, text: &str) -> Result<()> {
        // Allocate and fill before EmptyClipboard so allocation failure preserves it.
        let units: Vec<u16> = text
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\n', "\r\n")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let memory = Memory(GlobalAlloc(GMEM_MOVEABLE, units.len() * 2)?);
        {
            let locked = lock(memory.0)?;
            std::ptr::copy_nonoverlapping(units.as_ptr(), locked.1, units.len());
        }
        let _clipboard = open(Some(HWND(owner as _)))?;
        EmptyClipboard()?;
        SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(memory.0 .0)))?;
        std::mem::forget(memory); // Windows owns the allocation after SetClipboardData.
        Ok(())
    }
    pub unsafe fn read() -> Result<String> {
        let _clipboard = open(None)?;
        if !IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).is_ok() {
            return Ok(String::new());
        }
        let handle = HGLOBAL(GetClipboardData(CF_UNICODETEXT.0 as u32)?.0);
        let count = GlobalSize(handle) / 2;
        let locked = lock(handle)?;
        let units = std::slice::from_raw_parts(locked.1, count);
        let end = units.iter().position(|c| *c == 0).unwrap_or(count);
        Ok(String::from_utf16_lossy(&units[..end]))
    }
}
