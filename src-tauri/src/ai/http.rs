//! The one HTTP path every connector uses (plan 6.1, AI-06).
//!
//! - Cloud requests go only to the providers' fixed HTTPS hosts; a local
//!   server only to a loopback address over HTTP.
//! - Redirects are not followed, so a key never reaches another host.
//! - Certificates are checked by Windows (native-tls); a proxy is taken from
//!   the environment only, not from the Windows settings.
//! - Replies over `RESPONSE_LIMIT` are cut off and refused.
//! - Nothing here logs headers, keys or bodies, and errors carry no provider
//!   text: only a code and, at most, the HTTP status.

use super::conversation::SendError;
use std::sync::OnceLock;
use std::time::Duration;

pub const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
const CLOUD_TIMEOUT: Duration = Duration::from_secs(180);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

pub const CLOUD_HOSTS: [&str; 3] = ["generativelanguage.googleapis.com", "api.openai.com", "api.anthropic.com"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    Cloud,
    Local,
}

fn client(reach: Reach) -> &'static reqwest::Client {
    static CLOUD: OnceLock<reqwest::Client> = OnceLock::new();
    static LOCAL: OnceLock<reqwest::Client> = OnceLock::new();
    let (cell, timeout) = match reach {
        Reach::Cloud => (&CLOUD, CLOUD_TIMEOUT),
        Reach::Local => (&LOCAL, LOCAL_TIMEOUT),
    };
    cell.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("Then/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("the HTTP client settings are fixed")
    })
}

/// Whether `url` may be sent to with `reach`. Checked on every request, so a
/// connector cannot be pointed elsewhere by mistake.
pub fn allowed(url: &str, reach: Reach) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    match reach {
        Reach::Cloud => {
            parsed.scheme() == "https"
                && parsed.port().is_none()
                && parsed.host_str().is_some_and(|host| CLOUD_HOSTS.contains(&host))
        }
        Reach::Local => parsed.scheme() == "http" && is_loopback(&parsed),
    }
}

fn is_loopback(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || bare.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// The chat endpoint of a local OpenAI-compatible server the user started,
/// from the base address they typed (e.g. `http://localhost:11434`).
pub fn local_chat_url(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    let url = format!("{base}/v1/chat/completions");
    let parsed = reqwest::Url::parse(&url).map_err(|_| "ローカルLLMのアドレスが正しくありません".to_string())?;
    if parsed.query().is_some() || parsed.fragment().is_some() || !allowed(&url, Reach::Local) {
        return Err("ローカルLLMはこのPCのアドレス（http://localhost など）だけを使えます".to_string());
    }
    Ok(url)
}

/// Sorts an unsuccessful HTTP status into what the user can act on.
pub fn classify_status(status: u16) -> SendError {
    match status {
        401 | 403 => SendError::Auth,
        404 => SendError::ModelUnsupported,
        408 => SendError::Timeout,
        429 => SendError::RateLimited,
        500..=599 => SendError::ServerError { status },
        _ => SendError::Rejected { status },
    }
}

fn classify_transport(error: &reqwest::Error) -> SendError {
    if error.is_timeout() {
        SendError::Timeout
    } else {
        SendError::Network
    }
}

/// POSTs `body` as JSON and returns the parsed reply. `headers` carry the key;
/// they are attached here, right before sending, and go nowhere else.
pub async fn post_json(
    reach: Reach,
    url: &str,
    headers: &[(&str, String)],
    body: &serde_json::Value,
) -> Result<serde_json::Value, SendError> {
    if !allowed(url, reach) {
        return Err(SendError::BadResponse);
    }
    let body = serde_json::to_vec(body).map_err(|_| SendError::BadResponse)?;
    let mut request = client(reach).post(url).header("content-type", "application/json").body(body);
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let mut response = request.send().await.map_err(|error| classify_transport(&error))?;
    let status = response.status().as_u16();
    let bytes = read_limited(&mut response).await?;
    if !(200..300).contains(&status) {
        return Err(classify_status(status));
    }
    serde_json::from_slice(&bytes).map_err(|_| SendError::BadResponse)
}

async fn read_limited(response: &mut reqwest::Response) -> Result<Vec<u8>, SendError> {
    if response.content_length().is_some_and(|length| length as usize > RESPONSE_LIMIT) {
        return Err(SendError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| classify_transport(&error))? {
        if bytes.len() + chunk.len() > RESPONSE_LIMIT {
            return Err(SendError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn cloud_requests_go_only_to_the_providers_over_https() {
        assert!(allowed("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent", Reach::Cloud));
        assert!(allowed("https://api.openai.com/v1/responses", Reach::Cloud));
        assert!(allowed("https://api.anthropic.com/v1/messages", Reach::Cloud));
        for url in [
            "http://api.openai.com/v1/responses",
            "https://api.openai.com.evil.example/v1",
            "https://evil.example/?api.openai.com",
            "https://user:pass@api.openai.com/v1",
            "https://api.openai.com:8443/v1",
            "https://localhost/v1",
        ] {
            assert!(!allowed(url, Reach::Cloud), "{url}");
        }
    }

    #[test]
    fn local_requests_go_only_to_this_machine() {
        assert_eq!(local_chat_url("http://localhost:11434/").unwrap(), "http://localhost:11434/v1/chat/completions");
        assert!(local_chat_url("http://127.0.0.1:1234").is_ok());
        assert!(local_chat_url("http://[::1]:8080").is_ok());
        for base in [
            "http://192.168.0.10:11434",
            "http://example.com",
            "https://localhost:11434",
            "http://localhost.evil.example",
            "http://user@localhost:11434",
            "http://localhost:11434/?x=1",
            "file:///C:/x",
            "localhost:11434",
        ] {
            assert!(local_chat_url(base).is_err(), "{base}");
        }
    }

    #[test]
    fn statuses_become_codes_the_user_can_act_on() {
        assert_eq!(classify_status(401), SendError::Auth);
        assert_eq!(classify_status(403), SendError::Auth);
        assert_eq!(classify_status(404), SendError::ModelUnsupported);
        assert_eq!(classify_status(429), SendError::RateLimited);
        assert_eq!(classify_status(503), SendError::ServerError { status: 503 });
        assert_eq!(classify_status(400), SendError::Rejected { status: 400 });
        assert_eq!(classify_status(302), SendError::Rejected { status: 302 });
    }

    /// A one-shot HTTP server on loopback that answers with `response`.
    fn serve_once(response: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 8192];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(&response);
            }
        });
        format!("http://127.0.0.1:{port}/v1/chat/completions")
    }

    fn post(url: &str) -> Result<serde_json::Value, SendError> {
        tauri::async_runtime::block_on(post_json(Reach::Local, url, &[], &serde_json::json!({ "q": 1 })))
    }

    #[test]
    fn a_json_reply_is_parsed() {
        let body = br#"{"ok":true}"#;
        let url = serve_once([format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n", body.len()).as_bytes(), body].concat());
        assert_eq!(post(&url).unwrap(), serde_json::json!({ "ok": true }));
    }

    #[test]
    fn a_redirect_is_not_followed() {
        let url = serve_once(b"HTTP/1.1 307 Temporary Redirect\r\nlocation: http://example.com/\r\ncontent-length: 0\r\n\r\n".to_vec());
        assert_eq!(post(&url), Err(SendError::Rejected { status: 307 }));
    }

    #[test]
    fn an_error_status_is_classified_and_its_body_dropped() {
        let body = br#"{"error":{"message":"secret detail"}}"#;
        let url = serve_once([format!("HTTP/1.1 429 Too Many Requests\r\ncontent-length: {}\r\n\r\n", body.len()).as_bytes(), body].concat());
        assert_eq!(post(&url), Err(SendError::RateLimited));
    }

    #[test]
    fn an_oversized_reply_is_refused() {
        let declared = serve_once(format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n", RESPONSE_LIMIT + 1).into_bytes());
        assert_eq!(post(&declared), Err(SendError::ResponseTooLarge));
        // Without a length, the reading stops at the limit.
        let mut chunked = b"HTTP/1.1 200 OK\r\nconnection: close\r\n\r\n".to_vec();
        chunked.extend(std::iter::repeat(b'a').take(RESPONSE_LIMIT + 10));
        assert_eq!(post(&serve_once(chunked)), Err(SendError::ResponseTooLarge));
    }

    #[test]
    fn a_refused_address_is_never_contacted() {
        assert_eq!(
            tauri::async_runtime::block_on(post_json(Reach::Cloud, "https://evil.example/", &[], &serde_json::json!({}))),
            Err(SendError::BadResponse)
        );
    }

    #[test]
    fn nothing_listening_is_a_network_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert_eq!(post(&format!("http://127.0.0.1:{port}/v1/chat/completions")), Err(SendError::Network));
    }
}
