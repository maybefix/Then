//! A connector that answers without a network or a key (AI-22).
//!
//! The answer repeats the input and says how many earlier turns came with it,
//! so tests can see what was sent. A marker in the input picks a case the
//! real providers produce only now and then:
//!
//! | marker | result |
//! | --- | --- |
//! | `[fixture:auth]` | `SendError::Auth` |
//! | `[fixture:rate]` | `SendError::RateLimited` |
//! | `[fixture:network]` | `SendError::Network` |
//! | `[fixture:truncated]` | a partial answer, `Ending::Truncated` |
//! | `[fixture:refused]` | no answer, `Ending::Refused` |
//! | `[fixture:no-search]` | web research asked for, no search ran |
//! | `[fixture:search-failed]` | `SendError::SearchFailed` |
//! | `[fixture:unsafe]` | an answer with a script link and a remote image |

use super::conversation::{check, Answer, Citation, Ending, Mode, Request, SendError, Usage};

pub const MODEL: &str = "fixture";

fn has(request: &Request, marker: &str) -> bool {
    request.input.contains(&format!("[fixture:{marker}]"))
}

pub fn send(request: &Request) -> Result<Answer, SendError> {
    check(request)?;
    for (marker, error) in [
        ("auth", SendError::Auth),
        ("rate", SendError::RateLimited),
        ("network", SendError::Network),
    ] {
        if has(request, marker) {
            return Err(error);
        }
    }
    let researching = request.mode == Mode::WebResearch;
    if researching && has(request, "search-failed") {
        return Err(SendError::SearchFailed);
    }

    let usage = Usage {
        input_tokens: Some(super::conversation::input_chars(request) as u64),
        output_tokens: None,
        searches: researching.then_some(if has(request, "no-search") { 0 } else { 1 }),
    };
    if has(request, "refused") {
        return Ok(Answer {
            text: String::new(),
            citations: vec![],
            searched: researching.then_some(false),
            usage,
            ending: Ending::Refused,
            native: None,
        });
    }

    let mut text = format!(
        "## 固定応答\n\n受け取った質問: {}\n\nこれまでの往復: {}件\n",
        request.input.trim(),
        request.history.len()
    );
    if has(request, "unsafe") {
        text.push_str("\n[押さないでください](javascript:alert(1))\n\n![外部画像](https://example.com/pixel.png?q=secret)\n");
    }

    let mut citations = vec![];
    let searched = if researching {
        let ran = !has(request, "no-search");
        if ran {
            let sentence = "出典の例です。";
            let start = text.chars().count();
            text.push('\n');
            text.push_str(sentence);
            citations.push(Citation {
                title: "Example Domain".into(),
                url: "https://example.com/".into(),
                start: Some(start + 1),
                end: Some(start + 1 + sentence.chars().count()),
            });
        }
        Some(ran)
    } else {
        None
    };

    let ending = if has(request, "truncated") {
        text.push_str("\n（ここで出力の上限に達し");
        Ending::Truncated
    } else {
        Ending::Complete
    };

    Ok(Answer {
        text,
        citations,
        searched,
        usage,
        ending,
        native: Some(serde_json::json!({ "fixtureTurn": request.history.len() + 1 })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::conversation::{Provider, Turn};

    fn request(mode: Mode, input: &str, history: usize) -> Request {
        Request {
            provider: Provider::Fixture,
            model: MODEL.into(),
            mode,
            history: (0..history)
                .map(|i| Turn { input: format!("q{i}"), answer: format!("a{i}"), native: None })
                .collect(),
            input: input.into(),
        }
    }

    #[test]
    fn answers_with_what_was_sent() {
        let answer = send(&request(Mode::Consult, "主人公の年齢は？", 2)).unwrap();
        assert!(answer.text.contains("受け取った質問: 主人公の年齢は？"));
        assert!(answer.text.contains("これまでの往復: 2件"));
        assert_eq!(answer.ending, Ending::Complete);
        assert_eq!(answer.searched, None);
        assert!(answer.citations.is_empty());
        assert_eq!(answer.usage.output_tokens, None, "an unreported count stays unknown");
        assert_eq!(answer.native, Some(serde_json::json!({ "fixtureTurn": 3 })));
    }

    #[test]
    fn web_research_cites_the_sentence_it_supports() {
        let answer = send(&request(Mode::WebResearch, "q", 0)).unwrap();
        assert_eq!(answer.searched, Some(true));
        assert_eq!(answer.usage.searches, Some(1));
        let citation = &answer.citations[0];
        let cited: String = answer
            .text
            .chars()
            .skip(citation.start.unwrap())
            .take(citation.end.unwrap() - citation.start.unwrap())
            .collect();
        assert_eq!(cited, "出典の例です。");
    }

    #[test]
    fn web_research_without_a_search_says_so() {
        let answer = send(&request(Mode::WebResearch, "q [fixture:no-search]", 0)).unwrap();
        assert_eq!(answer.searched, Some(false));
        assert!(answer.citations.is_empty());
        assert_eq!(answer.ending, Ending::Complete);
    }

    #[test]
    fn markers_produce_each_failure() {
        assert_eq!(send(&request(Mode::Consult, "[fixture:auth]", 0)), Err(SendError::Auth));
        assert_eq!(send(&request(Mode::Consult, "[fixture:rate]", 0)), Err(SendError::RateLimited));
        assert_eq!(send(&request(Mode::Consult, "[fixture:network]", 0)), Err(SendError::Network));
        assert_eq!(send(&request(Mode::WebResearch, "[fixture:search-failed]", 0)), Err(SendError::SearchFailed));
        assert_eq!(send(&request(Mode::Consult, "[fixture:truncated]", 0)).unwrap().ending, Ending::Truncated);
        let refused = send(&request(Mode::Consult, "[fixture:refused]", 0)).unwrap();
        assert_eq!(refused.ending, Ending::Refused);
        assert!(refused.text.is_empty());
    }

    #[test]
    fn unsafe_marker_returns_the_links_the_display_must_defuse() {
        let answer = send(&request(Mode::Consult, "[fixture:unsafe]", 0)).unwrap();
        assert!(answer.text.contains("](javascript:"));
        assert!(answer.text.contains("![外部画像](https://"));
    }

    #[test]
    fn the_shared_checks_run_first() {
        assert_eq!(send(&request(Mode::Consult, "  ", 0)), Err(SendError::EmptyInput));
    }
}
