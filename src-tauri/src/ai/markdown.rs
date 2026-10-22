//! Tidies an AI answer before Then keeps or shows it (AI-12, AI-13).
//!
//! An answer can carry text a searched web page planted, so it gets less trust
//! than a reference the user wrote:
//! - an image becomes a link to it, so opening the answer fetches nothing;
//! - a link that is not http, https or mailto becomes its plain text;
//! - parentheses in a link target are escaped, which the reference view's
//!   link pattern cannot otherwise read;
//! - quote markers (`>`) are dropped, as the view has no quotes.
//!
//! Code blocks and code spans are left exactly as they came.

use crate::external_url::openable;

pub fn tidy_answer(text: &str) -> String {
    let mut out = Vec::new();
    let mut in_fence = false;
    for line in text.split('\n') {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            out.push(line.to_string());
        } else if in_fence {
            out.push(line.to_string());
        } else {
            out.push(tidy_inline(strip_quote(line)));
        }
    }
    out.join("\n")
}

fn strip_quote(line: &str) -> &str {
    let mut rest = line;
    while let Some(after) = rest.trim_start().strip_prefix('>') {
        rest = after.strip_prefix(' ').unwrap_or(after);
    }
    rest
}

struct Bracketed<'a> {
    label: &'a str,
    target: &'a str,
    /// Bytes from the opening `[` through the closing `)`.
    len: usize,
}

/// Reads `[label](target "title")` at the start of `s`. The target may hold
/// balanced parentheses or sit in angle brackets; a title is dropped.
fn bracketed(s: &str) -> Option<Bracketed<'_>> {
    let close = s.find(']')?;
    let label = &s[1..close];
    let rest = s[close + 1..].strip_prefix('(')?;
    let mut depth = 0usize;
    let mut end = None;
    for (index, c) in rest.char_indices() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => {
                end = Some(index);
                break;
            }
            ')' => depth -= 1,
            _ => {}
        }
    }
    let end = end?;
    let inside = rest[..end].trim();
    let target = match inside.strip_prefix('<') {
        Some(angled) => angled.split('>').next().unwrap_or(""),
        None => inside.split_whitespace().next().unwrap_or(""),
    };
    Some(Bracketed { label, target, len: close + 2 + end + 1 })
}

fn escape_target(target: &str) -> String {
    target.replace('(', "%28").replace(')', "%29")
}

fn web_only(target: &str) -> Option<&str> {
    openable(target).filter(|url| !url.to_ascii_lowercase().starts_with("mailto:"))
}

fn tidy_inline(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(c) = rest.chars().next() {
        if c == '`' {
            if let Some(close) = rest[1..].find('`') {
                out.push_str(&rest[..close + 2]);
                rest = &rest[close + 2..];
                continue;
            }
        }
        if rest.starts_with("![") {
            if let Some(image) = bracketed(&rest[1..]) {
                let label = if image.label.trim().is_empty() {
                    "画像".to_string()
                } else {
                    format!("画像: {}", image.label.trim())
                };
                match web_only(image.target) {
                    Some(url) => out.push_str(&format!("[{label}]({})", escape_target(url))),
                    None => out.push_str(&label),
                }
                rest = &rest[1 + image.len..];
                continue;
            }
        }
        if c == '[' {
            if let Some(link) = bracketed(rest) {
                match openable(link.target) {
                    Some(url) => out.push_str(&format!("[{}]({})", link.label, escape_target(url))),
                    None => out.push_str(link.label),
                }
                rest = &rest[link.len..];
                continue;
            }
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::tidy_answer;
    use crate::ai::conversation::{Mode, Provider, Request};
    use crate::ai::fixture;

    #[test]
    fn images_become_links_and_fetch_nothing() {
        assert_eq!(
            tidy_answer("図: ![地図](https://example.com/map.png?q=secret)"),
            "図: [画像: 地図](https://example.com/map.png?q=secret)"
        );
        assert_eq!(tidy_answer("![](https://example.com/a.png)"), "[画像](https://example.com/a.png)");
        assert_eq!(tidy_answer("![x](file:///C:/a.png) ![y](./b.png)"), "画像: x 画像: y");
        assert_eq!(tidy_answer("![x](mailto:a@example.com)"), "画像: x");
    }

    #[test]
    fn only_web_and_mail_links_stay_links() {
        assert_eq!(
            tidy_answer("[公式](https://example.com) と [連絡](mailto:a@example.com)"),
            "[公式](https://example.com) と [連絡](mailto:a@example.com)"
        );
        assert_eq!(tidy_answer("[押す](javascript:alert(1)) [別](./other.md)"), "押す 別");
        assert_eq!(tidy_answer("[t](https://example.com \"題\")"), "[t](https://example.com)");
        assert_eq!(tidy_answer("[t](<https://example.com/a b>)"), "t", "a space is not a link");
    }

    #[test]
    fn parentheses_in_a_target_are_escaped() {
        assert_eq!(
            tidy_answer("[語](https://ja.wikipedia.org/wiki/A_(B))。"),
            "[語](https://ja.wikipedia.org/wiki/A_%28B%29)。"
        );
    }

    #[test]
    fn code_is_left_alone() {
        let text = "`![x](https://e.com/a.png)` と\n```\n[a](javascript:x)\n> 引用\n```\n> 引用";
        assert_eq!(
            tidy_answer(text),
            "`![x](https://e.com/a.png)` と\n```\n[a](javascript:x)\n> 引用\n```\n引用"
        );
    }

    #[test]
    fn quote_markers_are_dropped() {
        assert_eq!(tidy_answer("> 一\n>> 二\n  > 三\n>四"), "一\n二\n三\n四");
    }

    #[test]
    fn text_that_only_looks_like_markdown_survives() {
        for text in ["[注]", "配列[0]と(1)", "![", "a](b)", "[a](b", "１＋１＝２"] {
            assert_eq!(tidy_answer(text), text, "{text}");
        }
    }

    #[test]
    fn the_fixture_unsafe_answer_comes_out_defused() {
        let request = Request {
            provider: Provider::Fixture,
            model: fixture::MODEL.into(),
            mode: Mode::Consult,
            history: vec![],
            input: "[fixture:unsafe]".into(),
        };
        let tidied = tidy_answer(&fixture::send(&request).unwrap().text);
        assert!(!tidied.contains("javascript:"));
        assert!(!tidied.contains("!["));
        assert!(tidied.contains("[画像: 外部画像](https://example.com/pixel.png?q=secret)"));
    }
}
