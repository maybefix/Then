use std::path::PathBuf;

pub fn safe_file_name(name: &str) -> String {
    let replaced: String = name.chars().map(|ch| {
        if ch <= '\u{1f}' || "<>:\"/\\|?*".contains(ch) { '_' } else { ch }
    }).collect();
    let trimmed = replaced.trim().trim_end_matches('.');
    if trimmed.is_empty() { "本文連結.txt".into() } else { trimmed.into() }
}

pub fn save_selected(selected: Option<PathBuf>, content: &str) -> Result<Option<PathBuf>, String> {
    let Some(mut path) = selected else { return Ok(None); };
    if path.extension().is_none_or(|extension| extension.is_empty()) {
        path.set_extension("txt");
    }
    // str::as_bytes is UTF-8 without adding a BOM or changing line endings.
    std::fs::write(&path, content.as_bytes())
        .map_err(|error| format!("{} を保存できませんでした: {error}", path.display()))?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn submission_file_name_and_cancel() {
        assert_eq!(safe_file_name(" 章<>:\"/\\|?*\n.txt "), "章__________.txt");
        assert_eq!(safe_file_name(" ... "), "本文連結.txt");
        assert_eq!(save_selected(None, "保存しない").unwrap(), None);
    }

    #[test]
    fn submission_utf8_and_line_endings() {
        let folder = std::env::temp_dir().join(format!("then-submission-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&folder).unwrap();
        for (name, content, expected) in [
            ("拡張子なし", "本文😀\r\n\r\n終\r\n", "拡張子なし.txt"),
            ("本文.TXT", "本文\n\n終\n", "本文.TXT"),
            ("任意.md", "本文\n", "任意.md"),
        ] {
            let saved = save_selected(Some(folder.join(name)), content).unwrap().unwrap();
            assert_eq!(saved.file_name().unwrap(), expected);
            assert_eq!(std::fs::read(&saved).unwrap(), content.as_bytes());
            std::fs::remove_file(saved).unwrap();
        }
        assert!(save_selected(Some(folder.join("missing").join("本文.txt")), "本文").is_err());
        std::fs::remove_dir(folder).unwrap();
    }
}
