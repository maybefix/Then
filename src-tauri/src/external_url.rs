//! Opens a link from a reference or an AI answer in the user's own browser
//! or mail program, never inside Then's window.
//!
//! The text being shown can come from a web page an AI read, so only web and
//! mail links pass; the check is repeated here because the page side is not
//! the last word on what Windows is asked to open.

/// The link as Windows will receive it, or `None` when it is not an http,
/// https or mailto link (javascript:, file:, relative paths, UNC paths, ...).
pub fn openable(url: &str) -> Option<&str> {
    let url = url.trim();
    if url.is_empty() || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return None;
    }
    let lower = url.to_ascii_lowercase();
    let rest = ["https://", "http://", "mailto:"]
        .iter()
        .find_map(|scheme| lower.strip_prefix(scheme))?;
    // A host (or an address) has to follow; "http:///x" and "mailto:" alone do not.
    if rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\') {
        return None;
    }
    Some(url)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let url = openable(&url).ok_or_else(|| "このリンクは開けません".to_string())?;
    open(url)
}

#[cfg(windows)]
fn open(url: &str) -> Result<(), String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let target = HSTRING::from(url);
    let result = unsafe { ShellExecuteW(None, w!("open"), &target, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    // Values above 32 mean success (ShellExecuteW's documented contract).
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("リンクを開けませんでした".to_string())
    }
}

#[cfg(not(windows))]
fn open(_url: &str) -> Result<(), String> {
    Err("リンクを開けませんでした".to_string())
}

#[cfg(test)]
mod tests {
    use super::openable;

    #[test]
    fn web_and_mail_links_pass_unchanged() {
        for url in [
            "https://example.com/a?b=c#d",
            "http://example.com",
            "HTTPS://Example.com/",
            "mailto:someone@example.com",
            "https://ja.wikipedia.org/wiki/%E5%B0%8F%E8%AA%AC",
        ] {
            assert_eq!(openable(url), Some(url), "{url}");
        }
        assert_eq!(openable("  https://example.com  "), Some("https://example.com"));
    }

    #[test]
    fn everything_else_is_refused() {
        for url in [
            "",
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\System32\\calc.exe",
            "\\\\server\\share\\x.exe",
            "./other.md",
            "//example.com",
            "ms-settings:privacy",
            "http:///etc/passwd",
            "https://",
            "mailto:",
            "https://example.com/a b",
            "https://example.com/\nfile:///x",
            "data:text/html,<script>alert(1)</script>",
        ] {
            assert_eq!(openable(url), None, "{url:?}");
        }
    }
}
