//! The shape shared by every connector: what is sent, what comes back, and
//! the checks made before anything leaves the machine.

use serde::{Deserialize, Serialize};

/// Input and earlier turns together, in characters. Over this the send stops
/// before it starts and the pane offers a new conversation; old turns are
/// never dropped to make room.
pub const INPUT_CHAR_LIMIT: usize = 40_000;
/// Thinking counts against the output limit on the models that think, so a
/// smaller limit cuts answers short (docs/AI_PROVIDER_CHECKS.md 2.2).
pub const OUTPUT_TOKEN_LIMIT: u32 = 16_000;
/// Searches per send where the provider lets Then set a number.
pub const SEARCH_LIMIT: u32 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Gemini,
    OpenAi,
    Claude,
    Local,
    Fixture,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// The model's own knowledge; never shown as checked on the web.
    Consult,
    WebResearch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capabilities {
    pub web_research: bool,
}

/// What Then offers per provider, whatever the provider itself could do.
/// Gemini's grounded answers wait for a search-suggestion display (plan 5.3).
pub fn capabilities(provider: Provider) -> Capabilities {
    let web_research = match provider {
        Provider::OpenAi | Provider::Claude | Provider::Fixture => true,
        Provider::Gemini | Provider::Local => false,
    };
    Capabilities { web_research }
}

/// One earlier exchange as Then recorded it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub input: String,
    pub answer: String,
    /// The provider's own reply blocks that must go back unchanged when the
    /// conversation goes on (encrypted search results, thinking); the next
    /// request is built from these, not from the tidied `answer`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub provider: Provider,
    pub model: String,
    pub mode: Mode,
    pub history: Vec<Turn>,
    pub input: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub title: String,
    pub url: String,
    /// Character range in `Answer::text` the source supports, when the
    /// provider says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<usize>,
}

/// Counts the provider reported. A count it did not report stays unknown
/// rather than becoming zero.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub searches: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Ending {
    Complete,
    /// Stopped at the output limit; the answer is partial.
    Truncated,
    /// The provider declined. No other model is tried on the user's behalf.
    Refused,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub text: String,
    pub citations: Vec<Citation>,
    /// Whether a search actually ran: `None` in consult mode, `Some(false)`
    /// when web research was asked for and no search happened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub searched: Option<bool>,
    pub usage: Usage,
    pub ending: Ending,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<serde_json::Value>,
}

/// Why a send failed, in words that carry no key, URL or provider message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "code")]
pub enum SendError {
    EmptyInput,
    InputTooLong { chars: usize, limit: usize },
    SearchUnsupported,
    KeyMissing,
    Auth,
    RateLimited,
    Network,
    ModelUnsupported,
    SearchFailed,
    BadResponse,
}

pub fn input_chars(request: &Request) -> usize {
    let history: usize = request
        .history
        .iter()
        .map(|turn| turn.input.chars().count() + turn.answer.chars().count())
        .sum();
    history + request.input.chars().count()
}

/// The checks every send passes before a connector sees it.
pub fn check(request: &Request) -> Result<(), SendError> {
    if request.input.trim().is_empty() {
        return Err(SendError::EmptyInput);
    }
    let chars = input_chars(request);
    if chars > INPUT_CHAR_LIMIT {
        return Err(SendError::InputTooLong { chars, limit: INPUT_CHAR_LIMIT });
    }
    if request.mode == Mode::WebResearch && !capabilities(request.provider).web_research {
        return Err(SendError::SearchUnsupported);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(provider: Provider, mode: Mode, input: &str, history: Vec<Turn>) -> Request {
        Request { provider, model: "m".into(), mode, history, input: input.into() }
    }

    fn turn(input: &str, answer: &str) -> Turn {
        Turn { input: input.into(), answer: answer.into(), native: None }
    }

    #[test]
    fn counts_earlier_turns_with_the_input_in_characters() {
        let r = request(Provider::Fixture, Mode::Consult, "あいう", vec![turn("かき", "くけこ")]);
        assert_eq!(input_chars(&r), 8);
    }

    #[test]
    fn stops_before_sending_when_the_conversation_is_over_the_limit() {
        let long = "字".repeat(INPUT_CHAR_LIMIT);
        let r = request(Provider::Fixture, Mode::Consult, "続き", vec![turn(&long, "")]);
        assert_eq!(
            check(&r),
            Err(SendError::InputTooLong { chars: INPUT_CHAR_LIMIT + 2, limit: INPUT_CHAR_LIMIT })
        );
        // Exactly at the limit still goes.
        let r = request(Provider::Fixture, Mode::Consult, "続き", vec![turn(&long[..long.len() - 6], "")]);
        assert_eq!(check(&r), Ok(()));
    }

    #[test]
    fn refuses_blank_input() {
        assert_eq!(check(&request(Provider::Fixture, Mode::Consult, " \n　", vec![])), Err(SendError::EmptyInput));
    }

    #[test]
    fn web_research_only_where_then_offers_it() {
        for provider in [Provider::Gemini, Provider::Local] {
            assert_eq!(check(&request(provider, Mode::WebResearch, "q", vec![])), Err(SendError::SearchUnsupported));
            assert_eq!(check(&request(provider, Mode::Consult, "q", vec![])), Ok(()));
        }
        for provider in [Provider::OpenAi, Provider::Claude, Provider::Fixture] {
            assert_eq!(check(&request(provider, Mode::WebResearch, "q", vec![])), Ok(()));
        }
    }

    #[test]
    fn errors_serialize_with_a_code_and_no_free_text() {
        let json = serde_json::to_value(SendError::InputTooLong { chars: 5, limit: 4 }).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "inputTooLong", "chars": 5, "limit": 4 }));
        assert_eq!(serde_json::to_value(SendError::Auth).unwrap(), serde_json::json!({ "code": "auth" }));
    }
}
