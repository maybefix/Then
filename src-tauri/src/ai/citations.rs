//! Sources shown where they are used (docs/AI_PROVIDER_CHECKS.md 2.3).
//!
//! OpenAI asks for inline citations that are visible and clickable, and Claude
//! for citations whenever its output is shown. A provider gives each source a
//! character range of the answer; a numbered link `[〔n〕](url)` goes right
//! after that range, the same source keeping the same number, and the list
//! below the answer (and in a saved reference) follows the same numbering.
//! A range that is already a link in the text gets no second one.

use super::conversation::Citation;

pub struct Numbered {
    pub text: String,
    /// One entry per source, in number order; positions are cleared because
    /// the text has changed.
    pub citations: Vec<Citation>,
}

pub fn number_inline(text: &str, citations: &[Citation]) -> Numbered {
    let mut sources: Vec<Citation> = Vec::new();
    let mut inserts: Vec<(usize, usize)> = Vec::new(); // (char position, source number)
    let chars: Vec<char> = text.chars().collect();
    for citation in citations {
        let number = match sources.iter().position(|source| source.url == citation.url) {
            Some(index) => index + 1,
            None => {
                sources.push(Citation { title: citation.title.clone(), url: citation.url.clone(), start: None, end: None });
                sources.len()
            }
        };
        let (Some(start), Some(end)) = (citation.start, citation.end) else { continue };
        if start > end || end > chars.len() {
            continue;
        }
        let cited: String = chars[start..end].iter().collect();
        if cited.contains("](") || inserts.iter().any(|&(at, n)| at == end && n == number) {
            continue;
        }
        inserts.push((end, number));
    }
    inserts.sort();
    let mut out = String::with_capacity(text.len() + inserts.len() * 32);
    let mut next = inserts.iter().peekable();
    for (index, c) in chars.iter().enumerate() {
        while let Some(&&(at, number)) = next.peek() {
            if at != index {
                break;
            }
            out.push_str(&marker(number, &sources[number - 1].url));
            next.next();
        }
        out.push(*c);
    }
    for &(_, number) in next {
        out.push_str(&marker(number, &sources[number - 1].url));
    }
    Numbered { text: out, citations: sources }
}

fn marker(number: usize, url: &str) -> String {
    format!("[〔{number}〕]({url})")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cite(url: &str, start: usize, end: usize) -> Citation {
        Citation { title: url.into(), url: url.into(), start: Some(start), end: Some(end) }
    }

    #[test]
    fn a_numbered_link_follows_each_cited_range() {
        let text = "東京は首都です。人口は多い。";
        let numbered = number_inline(text, &[cite("https://a.example/", 0, 8), cite("https://b.example/", 8, 14)]);
        assert_eq!(numbered.text, "東京は首都です。[〔1〕](https://a.example/)人口は多い。[〔2〕](https://b.example/)");
        assert_eq!(numbered.citations.iter().map(|c| c.url.as_str()).collect::<Vec<_>>(), ["https://a.example/", "https://b.example/"]);
        assert!(numbered.citations.iter().all(|c| c.start.is_none()));
    }

    #[test]
    fn the_same_source_keeps_its_number() {
        let numbered = number_inline("一。二。三。", &[cite("https://a/", 0, 2), cite("https://b/", 2, 4), cite("https://a/", 4, 6)]);
        assert_eq!(numbered.text, "一。[〔1〕](https://a/)二。[〔2〕](https://b/)三。[〔1〕](https://a/)");
        assert_eq!(numbered.citations.len(), 2);
    }

    #[test]
    fn sources_without_a_range_are_listed_but_not_placed() {
        let numbered = number_inline("本文", &[Citation { title: "T".into(), url: "https://a/".into(), start: None, end: None }]);
        assert_eq!(numbered.text, "本文");
        assert_eq!(numbered.citations.len(), 1);
    }

    #[test]
    fn a_range_that_is_already_a_link_gets_no_second_one() {
        let text = "詳しくは([公式](https://a/))を参照。";
        let numbered = number_inline(text, &[cite("https://a/", 4, 21)]);
        assert_eq!(numbered.text, text);
    }

    #[test]
    fn ranges_outside_the_text_are_ignored() {
        let numbered = number_inline("短い", &[cite("https://a/", 0, 99), cite("https://b/", 2, 1)]);
        assert_eq!(numbered.text, "短い");
        assert_eq!(numbered.citations.len(), 2);
    }
}
