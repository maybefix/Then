/**
 * 同音異義語（同じ音読みを持つ漢語）の使い分けを、近くの語との組合せから確認する。
 *
 * 異字同訓のルールと同じ考え方で、本文に現れた表記に接する語を取り出し、その語が
 * 同じ読みの別の表記でしか使わない語のときだけ「確認」を出す。「品質保障」の
 * 「品質」、「関心する」の「する」のように、複合語の相手か直後の述語を見る。
 * 変換の取り違えは意味を読まないと決められないので、指摘は参考にとどめ、
 * 置換は出さない。
 */

import { MASK_CHAR } from "./context";
import { HOMOPHONE_GROUPS, type HomophoneCue, type HomophoneGroup } from "./homophoneData";
import { inflectedForms, runMatchesCue, runStartsWithCue } from "./ijidokun";
import { KISHA_HANDBOOK } from "./sources";
import type { ProofreadHit, ProofreadRule } from "./types";

/** 語をつくる文字。マスク・記号・空白はここで切れる。 */
const WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆0-9０-９]/u;
/** 手掛かり語を拾う長さの上限。 */
const RUN_LIMIT = 12;
/** 「損害の補償」「損害を補償」のように、直前の語と対象語をつなぐ助詞。 */
const LINKERS = ["には", "から", "の", "を", "が", "に", "へ", "と", "は", "も"];
/** 述語の前に入る格助詞。「関心を持つ」の「を」。 */
const CASE_PARTICLES = ["から", "が", "を", "に", "と", "へ", "で"];

/**
 * 述語の表層形。サ変動詞は語尾の行から作れないので、ここで別に持つ。
 */
function predicateForms(head: string): string[] {
  if (!head.endsWith("する")) return inflectedForms(head);
  const stem = head.slice(0, -2);
  return ["する", "し", "さ", "せ", "すれ"].map((ending) => stem + ending);
}

type Entry = { group: HomophoneGroup; variant: number; word: string };

/** 表記の先頭文字で引く索引。本文は1回だけなめる。 */
const WORD_INDEX = new Map<string, Entry[]>();
for (const group of HOMOPHONE_GROUPS) {
  for (const [variant, entry] of group.variants.entries()) {
    const bucket = WORD_INDEX.get(entry.word[0]) ?? [];
    bucket.push({ group, variant, word: entry.word });
    WORD_INDEX.set(entry.word[0], bucket);
  }
}

const runBefore = (text: string, index: number) => {
  let start = index;
  while (start > 0 && index - start < RUN_LIMIT && WORD.test(text[start - 1])) start -= 1;
  return text.slice(start, index);
};

const runAfter = (text: string, index: number) => {
  let end = index;
  while (end < text.length && end - index < RUN_LIMIT && WORD.test(text[end])) end += 1;
  return text.slice(index, end);
};

/** 直前の語。「損害の」「損害を」のような助詞は落として名詞だけを見る。 */
const modifierBefore = (text: string, from: number) => {
  const run = runBefore(text, from);
  const linker = LINKERS.find((candidate) => run.endsWith(candidate) && run.length > candidate.length);
  return linker ? run.slice(0, -linker.length) : run;
};

export type HomophoneFinding = { cue: HomophoneCue; relation: string };

/** 本文に現れた表記について、接する語が別の表記を指しているかを調べる。 */
export function inspectHomophone(group: HomophoneGroup, variant: number, text: string, from: number, to: number): HomophoneFinding | null {
  const pick = (role: HomophoneCue["role"], test: (word: string) => boolean) =>
    group.cues.find((cue) => cue.role === role && cue.variant !== variant && test(cue.word));

  const before = modifierBefore(text, from);
  const prefix = before && pick("前", (word) => runMatchesCue(before, word));
  if (prefix) return { cue: prefix, relation: `直前の「${prefix.word}」` };

  const after = runAfter(text, to);
  const suffix = after && pick("後", (word) => runStartsWithCue(after, word));
  if (suffix) return { cue: suffix, relation: `直後の「${suffix.word}」` };

  const particle = CASE_PARTICLES.find((candidate) => text.startsWith(candidate, to)) ?? "";
  const rest = text.slice(to + particle.length);
  const predicate = pick("述", (word) => predicateForms(word).some((form) => rest.startsWith(form)));
  return predicate ? { cue: predicate, relation: `直後の「${particle}${predicate.word}」` } : null;
}

const checks = HOMOPHONE_GROUPS.map((group) => ({
  id: `homophone/${group.id}`,
  name: `${group.reading}（${group.variants.map((variant) => variant.word).join("・")}）`,
  summary: `${group.cues.length}語の手掛かりで確認します。`,
}));

export const homophoneRule: ProofreadRule = {
  id: "homophone",
  name: "同音異義語の使い分け",
  summary: `同じ音読みで意味の違う漢語を、接する語との組合せから確認します（${HOMOPHONE_GROUPS.length}組）。「品質保障→保証」「経済生長→成長」のように、その表記でしか使わない語が近くにあるときだけ出します。変換の取り違えかどうかは書き手が判断してください。`,
  severity: "hint",
  target: "common",
  respectsDialogue: true,
  wordScoped: true,
  sources: [KISHA_HANDBOOK],
  checks,
  scan(context) {
    const hits: ProofreadHit[] = [];
    const disabled = new Set(context.options.disabledChecks);
    const text = context.narrationText;
    for (let index = 0; index < text.length; index += 1) {
      const bucket = WORD_INDEX.get(text[index]);
      if (!bucket) continue;
      for (const entry of bucket) {
        const checkId = `homophone/${entry.group.id}`;
        if (disabled.has(checkId)) continue;
        if (!text.startsWith(entry.word, index)) continue;
        const to = index + entry.word.length;
        if (text[index] === MASK_CHAR) continue;
        const result = inspectHomophone(entry.group, entry.variant, text, index, to);
        if (!result) continue;
        const candidate = entry.group.variants[result.cue.variant];
        const written = entry.group.variants[entry.variant];
        hits.push({
          checkId,
          from: index,
          to,
          message: `「${candidate.word}」の意味か確認してください。`,
          detail:
            `${result.relation}との組合せによる候補です。` +
            `${candidate.sense}意味では「${candidate.word}」、${written.sense}意味では「${written.word}」を使います。` +
            "出典：記者ハンドブック（同音異義語の使い分け）。語義に沿ってThenが編んだ一覧で、告示や報告が定めた区別ではありません。",
          // 意味で決まるため、ワンクリック置換は提供しない。
        });
        if (hits.length >= 200) return hits;
        break;
      }
    }
    return hits;
  },
};
