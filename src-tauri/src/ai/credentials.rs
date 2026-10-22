//! API keys in the Windows Credential Manager (AI-07, plan 6.1).
//!
//! One generic credential per provider, named `Then/ai/<provider>`, kept on
//! this machine only (it does not roam with a domain profile). The page can
//! store, replace, delete, and ask whether a key is there; nothing hands a
//! stored key back to it. Only the send path reads a key, right before the
//! request goes out.
//!
//! The Credential Manager keeps keys out of works, settings files and logs;
//! it does not shield them from other programs running as the same user.

use super::conversation::Provider;

fn provider_name(provider: Provider) -> Option<&'static str> {
    match provider {
        Provider::Gemini => Some("gemini"),
        Provider::OpenAi => Some("openai"),
        Provider::Claude => Some("claude"),
        // A local server needs no key, and the fixture is not a provider.
        Provider::Local | Provider::Fixture => None,
    }
}

pub fn target(provider: Provider) -> Option<String> {
    provider_name(provider).map(|name| format!("Then/ai/{name}"))
}

/// Keys are single tokens; anything with spaces or line breaks is a paste
/// mistake. The Credential Manager holds at most 2560 bytes.
pub fn check_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("APIキーを入力してください".to_string());
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("APIキーに空白や改行が含まれています".to_string());
    }
    if key.len() > 2560 {
        return Err("APIキーが長すぎます".to_string());
    }
    Ok(key)
}

#[cfg(windows)]
mod platform {
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    pub fn write(target: &str, secret: &str) -> Result<(), String> {
        let mut target_wide: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let mut blob = secret.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target_wide.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        let result = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        result.map_err(|_| "APIキーを保存できませんでした".to_string())
    }

    pub fn read(target: &str) -> Option<String> {
        let mut found: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            CredReadW(&HSTRING::from(target), CRED_TYPE_GENERIC, None, &mut found).ok()?;
            let credential = &*found;
            let bytes = std::slice::from_raw_parts(credential.CredentialBlob, credential.CredentialBlobSize as usize);
            let secret = String::from_utf8(bytes.to_vec()).ok();
            CredFree(found as *const _);
            secret
        }
    }

    /// Deleting a key that is not there is not an error.
    pub fn delete(target: &str) -> Result<(), String> {
        match unsafe { CredDeleteW(&HSTRING::from(target), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(error) if error.code() == windows::Win32::Foundation::ERROR_NOT_FOUND.to_hresult() => Ok(()),
            Err(_) => Err("APIキーを削除できませんでした".to_string()),
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn write(_target: &str, _secret: &str) -> Result<(), String> {
        Err("APIキーの保存はWindows版だけで使えます".to_string())
    }
    pub fn read(_target: &str) -> Option<String> {
        None
    }
    pub fn delete(_target: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn store(provider: Provider, key: &str) -> Result<(), String> {
    let target = target(provider).ok_or_else(|| "この接続先にはAPIキーがいりません".to_string())?;
    platform::write(&target, check_key(key)?)
}

pub fn remove(provider: Provider) -> Result<(), String> {
    match target(provider) {
        Some(target) => platform::delete(&target),
        None => Ok(()),
    }
}

pub fn is_stored(provider: Provider) -> bool {
    target(provider).is_some_and(|target| platform::read(&target).is_some())
}

/// For the send path only; never returned to the page.
pub fn read(provider: Provider) -> Option<String> {
    platform::read(&target(provider)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_cloud_provider_has_its_own_name_and_the_rest_none() {
        assert_eq!(target(Provider::Gemini).as_deref(), Some("Then/ai/gemini"));
        assert_eq!(target(Provider::OpenAi).as_deref(), Some("Then/ai/openai"));
        assert_eq!(target(Provider::Claude).as_deref(), Some("Then/ai/claude"));
        assert_eq!(target(Provider::Local), None);
        assert_eq!(target(Provider::Fixture), None);
    }

    #[test]
    fn keys_are_trimmed_and_pasting_mistakes_refused() {
        assert_eq!(check_key("  abc-123_XYZ\n"), Ok("abc-123_XYZ"));
        for bad in ["", "   ", "ab cd", "ab\ncd", "ab\u{3000}cd"] {
            assert!(check_key(bad).is_err(), "{bad:?}");
        }
        assert!(check_key(&"a".repeat(2561)).is_err());
        assert!(check_key(&"a".repeat(2560)).is_ok());
    }

    /// Writes to the real Credential Manager under a throwaway name and
    /// removes it. Never touches `Then/ai/*`. Run on purpose:
    /// `cargo test --lib ai::credentials -- --ignored`
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn round_trip_in_the_credential_manager() {
        let name = format!("Then/ai-test/{}", std::process::id());
        assert_eq!(platform::read(&name), None);
        platform::write(&name, "first-key").unwrap();
        assert_eq!(platform::read(&name).as_deref(), Some("first-key"));
        platform::write(&name, "second-key").unwrap();
        assert_eq!(platform::read(&name).as_deref(), Some("second-key"));
        platform::delete(&name).unwrap();
        assert_eq!(platform::read(&name), None);
        platform::delete(&name).unwrap();
    }
}
