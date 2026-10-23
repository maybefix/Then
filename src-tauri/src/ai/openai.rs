//! OpenAI through the Responses API (docs/AI_PROVIDER_CHECKS.md).
//!
//! Nothing is stored on OpenAI's side (`store: false`): each send rebuilds the
//! conversation in `input`. For an earlier answer the whole `output` array it
//! came with is sent back unchanged, as OpenAI asks for reasoning models
//! (AI-30). Web research adds the `web_search` tool; whether a search really
//! ran is read from the `web_search_call` items, never assumed.

use super::conversation::{Answer, Citation, Ending, Mode, Provider, Request, SendError, Usage, OUTPUT_TOKEN_LIMIT};
use super::{credentials, http, prompt};
use serde_json::{json, Value};

const RESPONSES_URL: &str = "https://api.openai.com/v1/responses";

pub fn request_body(request: &Request, max_output_tokens: u32) -> Value {
    let mut input = Vec::new();
    for turn in &request.history {
        input.push(json!({ "role": "user", "content": turn.input }));
        match turn.native.as_ref().and_then(Value::as_array) {
            Some(items) if !items.is_empty() => input.extend(items.iter().cloned()),
            _ => input.push(json!({ "role": "assistant", "content": turn.answer })),
        }
    }
    input.push(json!({ "role": "user", "content": request.input }));
    let mut body = json!({
        "model": request.model,
        "instructions": prompt::system_instruction(request.mode),
        "input": input,
        "max_output_tokens": max_output_tokens,
        "store": false,
        "include": ["reasoning.encrypted_content"],
    });
    if request.mode == Mode::WebResearch {
        body["tools"] = json!([{ "type": "web_search", "search_context_size": "low" }]);
    }
    body
}

/// OpenAI's error body says which 401/403/429 it is.
fn refine(status: u16, body: &Value) -> Option<SendError> {
    let error = body.get("error")?;
    let code = error.get("code").and_then(Value::as_str).unwrap_or("");
    let kind = error.get("type").and_then(Value::as_str).unwrap_or("");
    if code == "invalid_api_key" || status == 401 {
        return Some(SendError::Auth);
    }
    if kind == "insufficient_quota"
        || matches!(
            code,
            "insufficient_quota"
                | "credit_balance_exhausted"
                | "organization_spend_limit_exceeded"
                | "project_spend_limit_exceeded"
                | "organization_usage_limit_exceeded"
        )
    {
        return Some(SendError::QuotaExceeded);
    }
    if code == "model_not_found" {
        return Some(SendError::ModelUnsupported);
    }
    if status == 403 {
        // Unsupported region, or a key without access: not a wrong key.
        return Some(SendError::Rejected { status });
    }
    None
}

pub fn parse_response(reply: &Value, mode: Mode) -> Result<Answer, SendError> {
    let status = reply.get("status").and_then(Value::as_str).unwrap_or("");
    if status == "failed" {
        return Err(match reply.pointer("/error/code").and_then(Value::as_str) {
            Some("rate_limit_exceeded") => SendError::RateLimited,
            Some("server_error") => SendError::ServerError { status: 500 },
            _ => SendError::BadResponse,
        });
    }
    let items = reply.get("output").and_then(Value::as_array).ok_or(SendError::BadResponse)?;

    let mut text = String::new();
    let mut citations = Vec::new();
    let mut refused = false;
    for item in items.iter().filter(|item| item.get("type").and_then(Value::as_str) == Some("message")) {
        for part in item.get("content").and_then(Value::as_array).into_iter().flatten() {
            match part.get("type").and_then(Value::as_str) {
                Some("output_text") => {
                    let offset = text.chars().count();
                    let part_text = part.get("text").and_then(Value::as_str).unwrap_or("");
                    let length = part_text.chars().count();
                    for annotation in part.get("annotations").and_then(Value::as_array).into_iter().flatten() {
                        if annotation.get("type").and_then(Value::as_str) != Some("url_citation") {
                            continue;
                        }
                        let Some(url) = annotation.get("url").and_then(Value::as_str) else { continue };
                        let index = |name: &str| annotation.get(name).and_then(Value::as_u64).map(|value| value as usize);
                        // Offsets outside the text (or counted another way) are dropped, the source kept.
                        let (start, end) = match (index("start_index"), index("end_index")) {
                            (Some(start), Some(end)) if start <= end && end <= length => (Some(offset + start), Some(offset + end)),
                            _ => (None, None),
                        };
                        citations.push(Citation {
                            title: annotation.get("title").and_then(Value::as_str).unwrap_or(url).to_string(),
                            url: url.to_string(),
                            start,
                            end,
                        });
                    }
                    text.push_str(part_text);
                }
                Some("refusal") => refused = true,
                _ => {}
            }
        }
    }

    let searches = items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("web_search_call"))
        .filter(|item| item.get("status").and_then(Value::as_str) == Some("completed"))
        .count() as u32;
    let ending = match reply.pointer("/incomplete_details/reason").and_then(Value::as_str) {
        Some("max_output_tokens") => Ending::Truncated,
        Some("content_filter") => Ending::Refused,
        _ if refused && text.trim().is_empty() => Ending::Refused,
        _ => Ending::Complete,
    };
    if text.trim().is_empty() && ending == Ending::Complete {
        return Err(SendError::BadResponse);
    }
    let count = |pointer: &str| reply.pointer(pointer).and_then(Value::as_u64);
    Ok(Answer {
        text,
        citations,
        searched: (mode == Mode::WebResearch).then_some(searches > 0),
        usage: Usage {
            input_tokens: count("/usage/input_tokens"),
            output_tokens: count("/usage/output_tokens"),
            searches: (mode == Mode::WebResearch).then_some(searches),
        },
        ending,
        native: Some(Value::Array(items.clone())),
    })
}

/// Sends to `url` with `key`; split out so tests can point it at loopback.
pub async fn send_to(reach: http::Reach, url: &str, key: String, request: &Request, max_output_tokens: u32) -> Result<Answer, SendError> {
    let body = request_body(request, max_output_tokens);
    let reply = http::post_json_classified(reach, url, &[("authorization", format!("Bearer {key}"))], &body, refine).await?;
    parse_response(&reply, request.mode)
}

pub async fn send(request: &Request) -> Result<Answer, SendError> {
    let key = credentials::read(Provider::OpenAi).ok_or(SendError::KeyMissing)?;
    send_to(http::Reach::Cloud, RESPONSES_URL, key, request, OUTPUT_TOKEN_LIMIT).await
}

/// One short request, to check the key and the model. It is billed like any send.
pub async fn test_connection(model: &str) -> Result<(), SendError> {
    let request = Request {
        provider: Provider::OpenAi,
        model: model.to_string(),
        mode: Mode::Consult,
        history: vec![],
        input: "接続の確認です。「OK」とだけ答えてください。".to_string(),
    };
    if !super::conversation::model_ok(model) {
        return Err(SendError::BadModel);
    }
    let key = credentials::read(Provider::OpenAi).ok_or(SendError::KeyMissing)?;
    match send_to(http::Reach::Cloud, RESPONSES_URL, key, &request, 512).await {
        // A reasoning model may spend a tiny budget before answering; the key and model still worked.
        Ok(_) => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::conversation::Turn;

    fn request(mode: Mode, input: &str, history: Vec<Turn>) -> Request {
        Request { provider: Provider::OpenAi, model: "gpt-6-luna".into(), mode, history, input: input.into() }
    }

    #[test]
    fn earlier_output_is_sent_back_whole_and_nothing_is_stored() {
        let output = json!([
            { "type": "reasoning", "id": "rs_1", "encrypted_content": "enc" },
            { "type": "message", "id": "msg_1", "role": "assistant", "content": [{ "type": "output_text", "text": "一", "annotations": [] }] }
        ]);
        let body = request_body(
            &request(Mode::Consult, "三", vec![
                Turn { input: "最初".into(), answer: "一".into(), native: Some(output.clone()) },
                Turn { input: "次".into(), answer: "二".into(), native: None },
            ]),
            100,
        );
        let input = body["input"].as_array().unwrap();
        assert_eq!(input.len(), 6);
        assert_eq!(input[0], json!({ "role": "user", "content": "最初" }));
        assert_eq!(input[1], output[0]);
        assert_eq!(input[2], output[1]);
        assert_eq!(input[4], json!({ "role": "assistant", "content": "二" }));
        assert_eq!(input[5], json!({ "role": "user", "content": "三" }));
        assert_eq!(body["store"], false);
        assert_eq!(body["max_output_tokens"], 100);
        assert!(body.get("tools").is_none(), "consulting does not search");
        assert!(body["instructions"].as_str().unwrap().contains("Webは検索していない"));
    }

    #[test]
    fn web_research_adds_the_search_tool() {
        let body = request_body(&request(Mode::WebResearch, "q", vec![]), 100);
        assert_eq!(body["tools"], json!([{ "type": "web_search", "search_context_size": "low" }]));
        assert!(body["instructions"].as_str().unwrap().contains("Web検索を使ってよい"));
    }

    fn researched_reply() -> Value {
        json!({
            "status": "completed",
            "output": [
                { "type": "web_search_call", "id": "ws_1", "status": "completed", "action": { "type": "search", "query": "q" } },
                { "type": "message", "id": "msg_1", "role": "assistant", "status": "completed", "content": [{
                    "type": "output_text",
                    "text": "東京は日本の首都です。人口は多い。",
                    "annotations": [
                        { "type": "url_citation", "start_index": 0, "end_index": 11, "url": "https://example.com/a", "title": "A" },
                        { "type": "url_citation", "start_index": 11, "end_index": 99, "url": "https://example.com/b", "title": "B" }
                    ]
                }] }
            ],
            "usage": { "input_tokens": 40, "output_tokens": 20 }
        })
    }

    #[test]
    fn a_researched_answer_keeps_its_sources_and_search_count() {
        let answer = parse_response(&researched_reply(), Mode::WebResearch).unwrap();
        assert_eq!(answer.text, "東京は日本の首都です。人口は多い。");
        assert_eq!(answer.searched, Some(true));
        assert_eq!(answer.usage, Usage { input_tokens: Some(40), output_tokens: Some(20), searches: Some(1) });
        assert_eq!(answer.citations[0], Citation { title: "A".into(), url: "https://example.com/a".into(), start: Some(0), end: Some(11) });
        assert_eq!((answer.citations[1].start, answer.citations[1].end), (None, None), "an offset past the text is dropped");
        assert_eq!(answer.native.unwrap().as_array().unwrap().len(), 2);
    }

    #[test]
    fn web_research_without_a_search_is_marked() {
        let reply = json!({ "status": "completed", "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "知識で答えます", "annotations": [] }] }] });
        let answer = parse_response(&reply, Mode::WebResearch).unwrap();
        assert_eq!(answer.searched, Some(false));
        assert_eq!(answer.usage.searches, Some(0));
        assert_eq!(parse_response(&reply, Mode::Consult).unwrap().searched, None);
    }

    #[test]
    fn cut_short_refused_and_failed_replies_are_told_apart() {
        let truncated = json!({ "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" },
            "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "途中", "annotations": [] }] }] });
        assert_eq!(parse_response(&truncated, Mode::Consult).unwrap().ending, Ending::Truncated);
        let filtered = json!({ "status": "incomplete", "incomplete_details": { "reason": "content_filter" }, "output": [] });
        assert_eq!(parse_response(&filtered, Mode::Consult).unwrap().ending, Ending::Refused);
        let refusal = json!({ "status": "completed", "output": [{ "type": "message", "content": [{ "type": "refusal", "refusal": "できません" }] }] });
        let refused = parse_response(&refusal, Mode::Consult).unwrap();
        assert_eq!(refused.ending, Ending::Refused);
        assert_eq!(refused.text, "");
        assert_eq!(parse_response(&json!({ "status": "failed", "error": { "code": "rate_limit_exceeded" } }), Mode::Consult), Err(SendError::RateLimited));
        assert_eq!(parse_response(&json!({ "status": "completed", "output": [] }), Mode::Consult), Err(SendError::BadResponse));
    }

    #[test]
    fn errors_from_openai_are_sorted() {
        assert_eq!(refine(401, &json!({ "error": { "code": "invalid_api_key" } })), Some(SendError::Auth));
        assert_eq!(refine(429, &json!({ "error": { "type": "insufficient_quota", "code": "credit_balance_exhausted" } })), Some(SendError::QuotaExceeded));
        assert_eq!(refine(429, &json!({ "error": { "type": "rate_limit_error", "code": "slow_down" } })), None, "plain rate limits fall back to RateLimited");
        assert_eq!(refine(404, &json!({ "error": { "code": "model_not_found" } })), Some(SendError::ModelUnsupported));
        assert_eq!(refine(403, &json!({ "error": { "type": "invalid_request_error" } })), Some(SendError::Rejected { status: 403 }));
    }

    #[test]
    fn the_key_goes_in_the_authorization_header() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let reply = r#"{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK","annotations":[]}]}]}"#;
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 65536];
            while !String::from_utf8_lossy(&received).contains("\"max_output_tokens\"") {
                let n = stream.read(&mut buffer).unwrap();
                if n == 0 { break; }
                received.extend_from_slice(&buffer[..n]);
            }
            let response = format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{reply}", reply.len());
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        let url = format!("http://127.0.0.1:{port}/v1/responses");
        let answer = tauri::async_runtime::block_on(send_to(http::Reach::Local, &url, "sk-test".into(), &request(Mode::Consult, "q", vec![]), 50)).unwrap();
        assert_eq!(answer.text, "OK");
        let received = server.join().unwrap().to_ascii_lowercase();
        assert!(received.contains("authorization: bearer sk-test"));
        assert!(!received.lines().next().unwrap().contains("sk-test"));
    }
}
