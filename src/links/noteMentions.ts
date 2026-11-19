// BINDER 3-5: note names written in a manuscript without `[[ ]]`
// (docs/BINDER_NOTE_MENTIONS_PLAN.md). This is the one place the rule lives;
// the link index (linkIndex.ts) is its only reader.
//
// - Only the body lines count: the front matter, `//` and `<!-- -->` comment
//   lines, code blocks, inline code and `@[[path]]` links do not. What is taken
//   out leaves a break behind, so the text on either side never joins into a
//   name that is not written (決定2).
// - Ruby, emphasis dots and tate-chu-yoko count by their base text, joined as
//   the screen shows them: `[汐(rb,しお)][見(rb,み)]` is 「汐見」. Readings do not
//   count.
// - Longer names are taken first over the whole text, and a character is
//   counted for one name only; between names of the same length the earlier
//   one wins (決定3a, as the proofreading dictionary does).
// - A name of one character is not looked for. Latin letters match only where
//   the name is not part of a longer word, and their case does not matter
//   (決定3b).
import { classifyLines, parseInlines } from "../editor/ast/documentAst";
import { parseFrontMatter } from "../utils/frontmatter";
import { findLinksInLine } from "./linkSyntax";

/** What stands where something was taken out: no name holds a line break. */
const BREAK = "\n";

/** Markup whose content reads on the screen as part of the text around it. */
const JOINED = new Set(["ruby", "emphasis", "tcy", "bold"]);

const WORD = /[A-Za-z0-9_]/;

/** A character every notation of parseInlines starts with (`[`, `｜`, `《`, `` ` ``, `*`, `［`, `!`), or a kanji run before `《`. */
const NOTATION_OPENER = /[[｜《`*［!]/;

/** ASCII letters lower-cased; every other character as it is (the length stays). */
function foldCase(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** The key a name is counted under: the same for `Ann` and `ANN`. */
export function mentionKey(name: string): string {
  return foldCase(name);
}

/** Whether a note of this name is looked for at all (two characters or more, one line). */
export function canMention(name: string): boolean {
  return Array.from(name).length >= 2 && !/[\r\n]/.test(name);
}

/** One body line with links, code and notation taken out, base text joined. */
function prepareLine(line: string): string {
  let text = line;
  // `@[[path]]` is a link already (3-1). Taken out first, while the positions
  // still are those of the written line.
  const links = findLinksInLine(text, false);
  for (let index = links.length - 1; index >= 0; index -= 1) {
    const link = links[index];
    text = text.slice(0, link.fullFrom) + BREAK + text.slice(link.fullTo);
  }
  // Every notation parseInlines reads opens with one of these.
  if (!NOTATION_OPENER.test(text)) return text;
  const markups = parseInlines(text);
  if (!markups.length) return text;
  let out = "";
  let at = 0;
  for (const markup of markups) {
    const from = markup.fullRange.offset;
    out += text.slice(at, from);
    out += JOINED.has(markup.type) ? markup.contentText : BREAK;
    at = from + markup.fullRange.length;
  }
  return out + text.slice(at);
}

/**
 * The text the names are looked for in: the body lines of `text`, prepared.
 * The index keeps this (決定1 A′) so a change of the names counts again
 * without reading the file.
 */
export function prepareMentionText(text: string): string {
  const body = parseFrontMatter(text).body;
  const lines = body.split("\n").map((line) => line.replace(/\r$/, ""));
  const roles = classifyLines(lines);
  return lines.map((line, index) => (roles[index] ? "" : prepareLine(line))).join(BREAK);
}

/**
 * How many times each name appears in `prepared`, by `mentionKey`. Names that
 * do not appear are left out; the order is by key.
 */
export function countMentions(prepared: string, names: readonly string[]): Array<[string, number]> {
  const keys = [...new Set(names.filter(canMention).map(mentionKey))];
  if (!keys.length || !prepared) return [];
  const text = foldCase(prepared);
  // Longer first over the whole text; the same length, the earlier first.
  // Names are taken a length at a time, so only names of one length are
  // put in order of position with each other.
  const byLength = new Map<number, string[]>();
  for (const key of keys) byLength.set(key.length, [...(byLength.get(key.length) ?? []), key]);
  const taken = new Uint8Array(text.length);
  const counts = new Map<string, number>();
  for (const length of [...byLength.keys()].sort((left, right) => right - left)) {
    const found: Array<{ from: number; key: string }> = [];
    for (const key of byLength.get(length)!) {
      const startsWord = WORD.test(key[0]);
      const endsWord = WORD.test(key[key.length - 1]);
      for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1)) {
        const to = at + length;
        if (startsWord && at > 0 && WORD.test(text[at - 1])) continue;
        if (endsWord && to < text.length && WORD.test(text[to])) continue;
        found.push({ from: at, key });
      }
    }
    if (byLength.get(length)!.length > 1) found.sort((left, right) => left.from - right.from);
    for (const { from, key } of found) {
      let free = true;
      for (let index = from; index < from + length; index += 1) {
        if (taken[index]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      taken.fill(1, from, from + length);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}
