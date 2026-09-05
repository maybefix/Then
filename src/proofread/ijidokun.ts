/**
 * 異字同訓（同じ訓を持つ漢字）の使い分けを、近くの語との組合せから確認する。
 *
 * 連語をひとつずつ正規表現で書く代わりに、報告の全項目から起こした手掛かり語の
 * 表（{@link IJIDOKUN_ITEMS}）を引く。本文に現れた表記の格・連体・複合の相手を
 * 取り出し、その語が同じ項目の別の表記を指しているときだけ「確認」を出す。
 * 語の意味を解析するものではないので、指摘は参考にとどめ、置換は出さない。
 */

import { MASK_CHAR } from "./context";
import { type IjidokunCue, type IjidokunGroup, type IjidokunRole } from "./ijidokunData";
import { IJIDOKUN_ITEMS } from "./ijidokunExtra";
import { IJIDOKUN } from "./sources";
import type { ProofreadHit, ProofreadRule } from "./types";

/** 語をつくる文字。マスク（U+FFFD）・記号・空白はここで切れる。 */
const WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆0-9０-９]/u;
const KANA = /[\p{Script=Hiragana}]/u;
/** 複合語の途中に偶然一致した場合を除くための、直前の文字。 */
const COMPOUND_LEFT = /[\p{Script=Han}\p{Script=Katakana}ー々]/u;
/** 語をまたいで項を結び付けないための区切り。 */
const BREAK = new RegExp(`[、。．，！？!?…「」『』（）()\\s${MASK_CHAR}]`);
/** 項の切れ目にならない範囲で、述語の前にさかのぼる文字数。 */
const ARGUMENT_WINDOW = 8;
/** 助詞の前後で語を拾う長さの上限。 */
const RUN_LIMIT = 12;
/** 述語や連体修飾の間に入りうる語。ここで切らずに読み飛ばす。 */
const AUXILIARIES = ["なかった", "ている", "ていた", "ない", "てる", "だ", "た", "ぬ", "ん"];
const CASE_PARTICLES = ["から", "が", "を", "に", "と", "へ", "で"];

/** 五段活用の語尾。見出し形の最後の仮名から引く。 */
const GODAN_ROWS: Record<string, string> = {
  う: "わいうえおっ", く: "かきくけこい", ぐ: "がぎぐげごい", す: "さしすせそ",
  つ: "たちつてとっ", ぬ: "なにぬねのん", ぶ: "ばびぶべぼん", む: "まみむめもん",
  る: "らりるれろっ",
};
const ADJECTIVE_ENDINGS = ["かろ", "かっ", "けれ", "い", "く"];
const NA_ADJECTIVE_ENDINGS = ["なら", "だ", "な", "に", "で"];

/**
 * 見出し形から、本文に現れうる表層形を作る。活用の種類は判定せず、語尾の行を
 * まとめて許す。実際に指摘するかどうかは手掛かり語の一致で決めるので、ここは
 * 拾いすぎても構わない。ただし「明らか」のような別語に化けないよう、送り仮名を
 * 落とした形（一段動詞の連用形）は「〜る」で終わる語だけに認める。
 */
export function inflectedForms(head: string): string[] {
  const last = head.slice(-1);
  const stem = head.slice(0, -1);
  if (!stem) return [head];
  if (last === "い") return ADJECTIVE_ENDINGS.map((ending) => stem + ending);
  if (last === "だ") return NA_ADJECTIVE_ENDINGS.map((ending) => stem + ending);
  const row = GODAN_ROWS[last];
  if (!row) return [head];
  const forms = [...row].map((ending) => stem + ending);
  if (last === "る" && KANA.test(stem.slice(-1))) forms.push(stem);
  return forms;
}

type FormEntry = { group: IjidokunGroup; variant: number; head: string; form: string };

/** 表層形の先頭文字で引く索引。本文は1回だけなめる。 */
const FORM_INDEX = new Map<string, FormEntry[]>();
for (const group of IJIDOKUN_ITEMS) {
  for (const [variant, entry] of group.variants.entries()) {
    for (const head of entry.heads) {
      for (const form of inflectedForms(head)) {
        const bucket = FORM_INDEX.get(form[0]) ?? [];
        bucket.push({ group, variant, head, form });
        FORM_INDEX.set(form[0], bucket);
      }
    }
  }
}
for (const bucket of FORM_INDEX.values()) bucket.sort((left, right) => right.form.length - left.form.length);

/** 項目ごとに、関係別の手掛かり語。長い語から先に当てる。 */
const CUE_INDEX = new Map<string, Map<IjidokunRole, IjidokunCue[]>>();
for (const group of IJIDOKUN_ITEMS) {
  const byRole = new Map<IjidokunRole, IjidokunCue[]>();
  for (const cue of group.cues) {
    const list = byRole.get(cue[0]) ?? [];
    list.push(cue);
    byRole.set(cue[0], list);
  }
  for (const list of byRole.values()) list.sort((left, right) => right[1].length - left[1].length);
  CUE_INDEX.set(group.no, byRole);
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

/**
 * 拾った語列が手掛かり語を指しているか。語列そのものか、仮名（「の」「な」など）
 * で区切られた末尾のときだけ認める。「大根」の「根」のように、漢字が続いた末尾は
 * 別語の一部とみなして採らない。
 */
export function runMatchesCue(run: string, cue: string): boolean {
  if (run === cue) return true;
  if (cue.length < 2 || !run.endsWith(cue)) return false;
  return KANA.test(run[run.length - cue.length - 1]);
}

/**
 * 後ろに続く語列の先頭が手掛かり語か。語列は助詞で切らずに拾うので、続きが
 * 仮名（助詞や送り仮名）のときだけ語の切れ目とみなす。「思い出」の「思い」の
 * ように漢字が続く場合は別語の一部として採らない。
 */
export function runStartsWithCue(run: string, cue: string): boolean {
  if (run === cue) return true;
  return run.startsWith(cue) && KANA.test(run[cue.length]);
}

/**
 * 同じ手掛かりとして扱える関係。「お茶が熱い」と「熱いお茶」のように、
 * 連体修飾の被修飾名詞はガ格の項と同じ語であることが多い。
 */
const equivalentRoles = (role: IjidokunRole): IjidokunRole[] =>
  role === "が" ? ["が", "連体"] : role === "連体" ? ["連体", "が"] : [role];

/** 見出しから送り仮名だけを取り出す。「上げる」なら「げる」。 */
const okurigana = (head: string) => head.replace(/^[\p{Script=Han}々]+/u, "");

/** 言い換えの見出し。手掛かり語が実際に使われていた形を返す。 */
export const cueHead = (group: IjidokunGroup, cue: IjidokunCue) =>
  group.variants[cue[2]].heads[cue[3]] ?? group.variants[cue[2]].heads[0];

/**
 * 本文の語と、用例で使われていた語が同じ役割の形か。
 *
 * 項目の見出しは「上がる・上げる」「揚がる・揚げる」のように自動詞・他動詞が
 * 同じ並びで載る。並びの位置か送り仮名がそろっているときだけ言い換え候補にし、
 * 「国を建てる」を根拠に「国を立つ」を疑うような取り違えを避ける。見出しが
 * 一つしかない表記は対応する相手がないので、この照合は課さない。
 */
export function comparableHead(group: IjidokunGroup, cue: IjidokunCue, variant: number, head: string): boolean {
  const written = group.variants[variant];
  const candidate = group.variants[cue[2]];
  if (written.heads.length === 1 || candidate.heads.length === 1) return true;
  return written.heads.indexOf(head) === cue[3] || okurigana(cueHead(group, cue)) === okurigana(head);
}

/** 述語の直前にある「〜が」「〜を」などの項。間に入るのは修飾語だけとみなす。 */
function findArgument(text: string, from: number) {
  const limit = Math.max(0, from - ARGUMENT_WINDOW);
  for (let index = from; index > limit; index -= 1) {
    const particle = CASE_PARTICLES.find((candidate) => text.startsWith(candidate, index - candidate.length));
    if (!particle) continue;
    // 文や引用をまたいだ語は結び付けない。
    if (BREAK.test(text.slice(index, from))) return null;
    return { particle, run: runBefore(text, index - particle.length) };
  }
  return null;
}

/** 連体修飾を受ける名詞。「乾いた土」のように助動詞が挟まる形も見る。 */
function findModifiee(text: string, to: number) {
  const auxiliary = AUXILIARIES.find((candidate) => text.startsWith(candidate, to)) ?? "";
  return runAfter(text, to + auxiliary.length);
}

export type IjidokunFinding = { cue: IjidokunCue; suggestion: string; relation: string };

/**
 * 本文に現れた表記について、手掛かり語が別の表記を指しているかを調べる。
 *
 * `joined` は直前が漢字・片仮名で、複合語の一部に見えることを表す。そのときは
 * 「立つ鳥跡」のように前に付く語が決め手になる形だけを認める。
 */
export function inspect(group: IjidokunGroup, variant: number, head: string, text: string, from: number, to: number, joined: boolean): IjidokunFinding | null {
  const form = text.slice(from, to);
  /** その関係の手掛かり語のうち、別の表記を指していて形の対応も取れるものを探す。 */
  const pick = (role: IjidokunRole, test: (word: string) => boolean): IjidokunFinding | null => {
    for (const alternative of equivalentRoles(role)) {
      const cue = CUE_INDEX.get(group.no)?.get(alternative)?.find(
        (candidate) => candidate[2] !== variant && comparableHead(group, candidate, variant, head) && test(candidate[1]),
      );
      if (cue) return { cue, suggestion: cueHead(group, cue), relation: "" };
    }
    return null;
  };
  const at = (finding: IjidokunFinding | null, relation: (cue: IjidokunCue) => string) =>
    finding && { ...finding, relation: relation(finding.cue) };

  if (joined) {
    if (group.kind !== "noun") return null;
    const before = runBefore(text, from);
    return at(pick("前接", (word) => before.endsWith(word)), (cue) => `直前の「${cue[1]}」`);
  }

  if (group.kind === "predicate") {
    const argument = findArgument(text, from);
    const asArgument = argument && at(
      pick(argument.particle as IjidokunRole, (word) => runMatchesCue(argument.run, word)),
      (cue) => `「${cue[1]}${argument.particle}」`,
    );
    if (asArgument) return asArgument;
    const modifiee = findModifiee(text, to);
    if (!modifiee) return null;
    return at(pick("連体", (word) => runStartsWithCue(modifiee, word)), (cue) => `修飾先の「${cue[1]}」`);
  }

  const before = runBefore(text, from);
  const prefix = at(pick("前接", (word) => before.endsWith(word)), (cue) => `直前の「${cue[1]}」`);
  if (prefix) return prefix;
  const after = runAfter(text, to);
  const suffix = at(pick("後接", (word) => runStartsWithCue(after, word)), (cue) => `直後の「${cue[1]}」`);
  if (suffix) return suffix;
  if (text.startsWith("の", to)) {
    const noun = runAfter(text, to + 1);
    const linked = at(pick("の", (word) => runStartsWithCue(noun, word)), (cue) => `「${form}の${cue[1]}」`);
    if (linked) return linked;
  }
  const particle = CASE_PARTICLES.find((candidate) => text.startsWith(candidate, to));
  if (!particle) return null;
  const rest = text.slice(to + particle.length);
  return at(
    pick(`述語${particle}` as IjidokunRole, (word) => inflectedForms(word).some((verb) => rest.startsWith(verb))),
    (cue) => `「${form}${particle}${cue[1]}」`,
  );
}

const checks = IJIDOKUN_ITEMS.map((group) => ({
  id: `ijidokun/${group.no}`,
  name: `${group.reading}（${group.variants.map((variant) => variant.heads[0]).join("・")}）`,
  summary: `報告の${group.no}（本文${group.page}ページ）。${group.cues.length}語の手掛かりで確認します。`,
}));

export const ijidokunRule: ProofreadRule = {
  id: "ijidokun",
  name: "異字同訓の使い分け",
  summary: `同じ訓を持つ漢字の使い分けを、報告の全${IJIDOKUN_ITEMS.length}項目分の手掛かり語（${IJIDOKUN_ITEMS.reduce((total, group) => total + group.cues.length, 0)}語）と照らして確認します。近くの語が別の表記を指すときだけ出します。比喩や意図的な表記はそのまま使えます。`,
  severity: "hint",
  target: "common",
  respectsDialogue: true,
  wordScoped: true,
  sources: [IJIDOKUN],
  checks,
  scan(context) {
    const hits: ProofreadHit[] = [];
    const disabled = new Set(context.options.disabledChecks);
    const text = context.narrationText;
    /** 同じ範囲に同じ項目の指摘を重ねない。 */
    const seen = new Set<string>();
    for (let index = 0; index < text.length; index += 1) {
      const bucket = FORM_INDEX.get(text[index]);
      if (!bucket) continue;
      // 複合語の末尾に偶然一致する場合は、前に付く語が決め手になる形だけを見る。
      const joined = index > 0 && COMPOUND_LEFT.test(text[index - 1]);
      for (const entry of bucket) {
        const checkId = `ijidokun/${entry.group.no}`;
        if (disabled.has(checkId)) continue;
        const to = index + entry.form.length;
        if (!text.startsWith(entry.form, index)) continue;
        const key = `${entry.group.no}:${index}`;
        if (seen.has(key)) continue;
        const result = inspect(entry.group, entry.variant, entry.head, text, index, to, joined);
        if (!result) continue;
        seen.add(key);
        const candidate = entry.group.variants[result.cue[2]];
        const written = entry.group.variants[entry.variant];
        const suggestion = result.suggestion;
        hits.push({
          checkId,
          from: index,
          to,
          message: `「${suggestion}」の意味か確認してください。`,
          detail:
            `${result.relation}との組合せによる候補です。` +
            `${candidate.sense}意味では「${suggestion}」、${written.sense}意味では「${entry.head}」が目安です。` +
            `出典：報告${entry.group.no}「${entry.group.reading}」（本文${entry.group.page}ページ）。` +
            "近接する語だけを見た判断で、意味の正誤を決めるものではありません。比喩・作中の語法は文脈に応じて判断してください。",
          // 文脈で意味が変わるため、ワンクリック置換は提供しない。
        });
        if (hits.length >= 200) return hits;
      }
    }
    return hits;
  },
};
