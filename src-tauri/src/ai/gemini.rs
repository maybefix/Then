//! Gemini through `generateContent` (docs/AI_PROVIDER_CHECKS.md).
//!
//! Each send rebuilds the conversation in `contents`: the user's inputs and,
//! for earlier answers, the `content` Gemini returned, sent back unchanged
//! (it can carry thought signatures the next turn needs; AI-30). Only plain
//! consultation for now: answers grounded in Google Search wait for a
//! search-suggestion display (plan 5.3).

use super::conversation::{model_ok, Answer, Ending, Mode, Provider, Request, SendError, Usage, OUTPUT_TOKEN_LIMIT};
use super::{credentials, http, prompt};
use serde_json::{json, Value};

const MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Gemini model ids sit in the URL path before `:generateContent`, so `:` and
/// `/` are refused on top of the shared check.
pub fn model_fits_url(model: &str) -> bool {
    model_ok(model) && !model.contains(':') && !model.contains('/')
}

pub fn request_body(request: &Request, max_output_tokens: u32) -> Value {
    let user = |text: &str| json!({ "role": "user", "parts": [{ "text": text }] });
    let mut contents = Vec::new();
    for turn in &request.history {
        contents.push(user(&turn.input));
        let returned = turn
            .native
            .as_ref()
            .filter(|native| native.get("role").and_then(Value::as_str) == Some("model") && native.get("parts").is_some_and(Value::is_array))
            .cloned();
        contents.push(returned.unwrap_or_else(|| json!({ "role": "model", "parts": [{ "text": turn.answer }] })));
    }
    contents.push(user(&request.input));
    json!({
        "systemInstruction": { "parts": [{ "text": prompt::system_instruction(request.mode) }] },
        "contents": contents,
        "generationConfig": { "maxOutputTokens": max_output_tokens },
    })
}

/// Gemini answers an invalid key with 400; that is an authentication failure
/// to the user.
fn refine(status: u16, body: &Value) -> Option<SendError> {
    let error = body.get("error")?;
    let reasons = error
        .get("details")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|detail| detail.get("reason").and_then(Value::as_str));
    if reasons.into_iter().any(|reason| reason == "API_KEY_INVALID") {
        return Some(SendError::Auth);
    }
    match error.get("status").and_then(Value::as_str) {
        Some("PERMISSION_DENIED" | "UNAUTHENTICATED") => Some(SendError::Auth),
        Some("RESOURCE_EXHAUSTED") => Some(SendError::RateLimited),
        Some("NOT_FOUND") => Some(SendError::ModelUnsupported),
        _ if status == 400 => Some(SendError::Rejected { status }),
        _ => None,
    }
}

pub fn parse_response(reply: &Value) -> Result<Answer, SendError> {
    let candidate = reply.get("candidates").and_then(Value::as_array).and_then(|list| list.first());
    let Some(candidate) = candidate else {
        // No candidate at all: the prompt itself was blocked.
        if reply.pointer("/promptFeedback/blockReason").is_some() {
            return Ok(refused(reply));
        }
        return Err(SendError::BadResponse);
    };
    let ending = match candidate.get("finishReason").and_then(Value::as_str) {
        Some("MAX_TOKENS") => Ending::Truncated,
        Some("SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT" | "SPII" | "IMAGE_SAFETY") => Ending::Refused,
        _ => Ending::Complete,
    };
    let text: String = candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|part| !part.get("thought").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect();
    if text.trim().is_empty() && ending == Ending::Complete {
        return Err(SendError::BadResponse);
    }
    Ok(Answer {
        text,
        citations: vec![],
        searched: None,
        usage: usage(reply),
        ending,
        native: candidate.get("content").filter(|content| content.is_object()).cloned(),
    })
}

fn refused(reply: &Value) -> Answer {
    Answer { text: String::new(), citations: vec![], searched: None, usage: usage(reply), ending: Ending::Refused, native: None }
}

fn usage(reply: &Value) -> Usage {
    let count = |name: &str| reply.pointer(&format!("/usageMetadata/{name}")).and_then(Value::as_u64);
    let output = match (count("candidatesTokenCount"), count("thoughtsTokenCount")) {
        (None, None) => None,
        (answer, thoughts) => Some(answer.unwrap_or(0) + thoughts.unwrap_or(0)),
    };
    Usage { input_tokens: count("promptTokenCount"), output_tokens: output, searches: None }
}

/// Sends to `url` with `key`; split out so tests can point it at loopback.
pub async fn send_to(reach: http::Reach, url: &str, key: String, request: &Request, max_output_tokens: u32) -> Result<Answer, SendError> {
    let body = request_body(request, max_output_tokens);
    let reply = http::post_json_classified(reach, url, &[("x-goog-api-key", key)], &body, refine).await?;
    parse_response(&reply)
}

fn url_for(model: &str) -> Result<String, SendError> {
    if !model_fits_url(model) {
        return Err(SendError::BadModel);
    }
    Ok(format!("{MODELS_URL}/{model}:generateContent"))
}

pub async fn send(request: &Request) -> Result<Answer, SendError> {
    let url = url_for(&request.model)?;
    let key = credentials::read(Provider::Gemini).ok_or(SendError::KeyMissing)?;
    send_to(http::Reach::Cloud, &url, key, request, OUTPUT_TOKEN_LIMIT).await
}

/// One short request, to check the key and the model. It is billed like any send.
pub async fn test_connection(model: &str) -> Result<(), SendError> {
    let request = Request {
        provider: Provider::Gemini,
        model: model.to_string(),
        mode: Mode::Consult,
        history: vec![],
        input: "接続の確認です。「OK」とだけ答えてください。".to_string(),
    };
    let url = url_for(model)?;
    let key = credentials::read(Provider::Gemini).ok_or(SendError::KeyMissing)?;
    send_to(http::Reach::Cloud, &url, key, &request, 256).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::conversation::Turn;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn request(input: &str, history: Vec<Turn>) -> Request {
        Request { provider: Provider::Gemini, model: "gemini-3.5-flash-lite".into(), mode: Mode::Consult, history, input: input.into() }
    }

    #[test]
    fn model_ids_that_would_change_the_url_path_are_refused() {
        assert!(model_fits_url("gemini-3.8-flash"));
        assert!(!model_fits_url("models/x"));
        assert!(!model_fits_url("x:streamGenerateContent"));
        assert_eq!(url_for("gemini-3.8-flash").unwrap(), format!("{MODELS_URL}/gemini-3.8-flash:generateContent"));
        assert!(http::allowed(&url_for("gemini-3.8-flash").unwrap(), http::Reach::Cloud));
    }

    #[test]
    fn the_conversation_is_rebuilt_with_earlier_answers_sent_back_unchanged() {
        let native = json!({ "role": "model", "parts": [{ "text": "一", "thoughtSignature": "sig" }] });
        let body = request_body(
            &request("三", vec![
                Turn { input: "最初".into(), answer: "一".into(), native: Some(native.clone()) },
                Turn { input: "次".into(), answer: "二".into(), native: None },
            ]),
            100,
        );
        let contents = body["contents"].as_array().unwrap();
        assert_eq!(contents.len(), 5);
        assert_eq!(contents[0], json!({ "role": "user", "parts": [{ "text": "最初" }] }));
        assert_eq!(contents[1], native);
        assert_eq!(contents[3], json!({ "role": "model", "parts": [{ "text": "二" }] }));
        assert_eq!(contents[4], json!({ "role": "user", "parts": [{ "text": "三" }] }));
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 100);
        assert!(body["systemInstruction"]["parts"][0]["text"].as_str().unwrap().contains("Webは検索していない"));
    }

    #[test]
    fn an_answer_is_read_without_its_thoughts() {
        let reply = json!({
            "candidates": [{
                "content": { "role": "model", "parts": [
                    { "text": "考え中", "thought": true },
                    { "text": "答え" },
                    { "text": "です。" }
                ] },
                "finishReason": "STOP"
            }],
            "usageMetadata": { "promptTokenCount": 10, "candidatesTokenCount": 5, "thoughtsTokenCount": 7 }
        });
        let answer = parse_response(&reply).unwrap();
        assert_eq!(answer.text, "答えです。");
        assert_eq!(answer.ending, Ending::Complete);
        assert_eq!(answer.usage, Usage { input_tokens: Some(10), output_tokens: Some(12), searches: None });
        assert_eq!(answer.native.unwrap()["parts"].as_array().unwrap().len(), 3, "kept whole for the next turn");
    }

    #[test]
    fn cut_short_and_refused_answers_are_marked() {
        let truncated = json!({ "candidates": [{ "content": { "role": "model", "parts": [{ "text": "途中" }] }, "finishReason": "MAX_TOKENS" }] });
        assert_eq!(parse_response(&truncated).unwrap().ending, Ending::Truncated);
        let unsafe_answer = json!({ "candidates": [{ "finishReason": "SAFETY" }] });
        let refused = parse_response(&unsafe_answer).unwrap();
        assert_eq!(refused.ending, Ending::Refused);
        assert_eq!(refused.text, "");
        let blocked = json!({ "promptFeedback": { "blockReason": "SAFETY" }, "usageMetadata": { "promptTokenCount": 3 } });
        assert_eq!(parse_response(&blocked).unwrap().ending, Ending::Refused);
        assert_eq!(parse_response(&json!({})), Err(SendError::BadResponse));
        let empty = json!({ "candidates": [{ "content": { "role": "model", "parts": [] }, "finishReason": "STOP" }] });
        assert_eq!(parse_response(&empty), Err(SendError::BadResponse));
    }

    #[test]
    fn errors_from_gemini_are_sorted() {
        let invalid_key = json!({ "error": { "code": 400, "status": "INVALID_ARGUMENT", "details": [{ "reason": "API_KEY_INVALID" }] } });
        assert_eq!(refine(400, &invalid_key), Some(SendError::Auth));
        assert_eq!(refine(429, &json!({ "error": { "status": "RESOURCE_EXHAUSTED" } })), Some(SendError::RateLimited));
        assert_eq!(refine(404, &json!({ "error": { "status": "NOT_FOUND" } })), Some(SendError::ModelUnsupported));
        assert_eq!(refine(400, &json!({ "error": { "status": "INVALID_ARGUMENT" } })), Some(SendError::Rejected { status: 400 }));
        assert_eq!(refine(500, &json!(null)), None);
    }

    /// Answers one request on loopback and hands back what was received.
    fn serve_once(status: &str, body: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let response = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}", body.len());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 65536];
            loop {
                let n = stream.read(&mut buffer).unwrap();
                received.extend_from_slice(&buffer[..n]);
                let text = String::from_utf8_lossy(&received);
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if received.len() >= end + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        (format!("http://127.0.0.1:{port}/v1beta/models/m:generateContent"), handle)
    }

    #[test]
    fn the_key_goes_in_a_header_and_never_in_the_url() {
        let (url, server) = serve_once("200 OK", r#"{"candidates":[{"content":{"role":"model","parts":[{"text":"OK"}]},"finishReason":"STOP"}]}"#);
        let answer = tauri::async_runtime::block_on(send_to(http::Reach::Local, &url, "test-key-123".into(), &request("q", vec![]), 50)).unwrap();
        assert_eq!(answer.text, "OK");
        let received = server.join().unwrap();
        let request_line = received.lines().next().unwrap();
        assert!(!request_line.contains("test-key-123"), "{request_line}");
        assert!(received.to_ascii_lowercase().contains("x-goog-api-key: test-key-123"));
    }

    #[test]
    fn an_invalid_key_reply_becomes_an_auth_error() {
        let (url, server) = serve_once("400 Bad Request", r#"{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}"#);
        let result = tauri::async_runtime::block_on(send_to(http::Reach::Local, &url, "bad".into(), &request("q", vec![]), 50));
        server.join().unwrap();
        assert_eq!(result, Err(SendError::Auth));
    }
}
