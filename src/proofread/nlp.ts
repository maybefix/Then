import { createProofreadContext, MASK_CHAR } from "./context";
import { MAX_PROOFREAD_ISSUES, runProofread } from "./engine";
import { nlpCollocationRule, nlpDependencyRule } from "./nlpRules";
import type { ProofreadTerm } from "./terms";
import type { ProofreadHit, ProofreadOptions } from "./types";

export type AnalysisMode = "morphology" | "dependency";
export type NlpToken = { start: number; end: number; surface: string; lemma: string; pos: string; head: number; dep: string; sentence: number };
export type NlpAnalysis = { mode: AnalysisMode; tokens: NlpToken[]; morphology?: NlpToken[] };

// Context words and meanings come from IJIDOKUN; attachment tests are Then heuristics.
const collocations = [
  { id: "kotaeru", noun: ["期待", "声援", "要請", "恩顧"], particle: "に", wrong: ["答える"], candidate: "応える", section: "057 こたえる", reason: "応じる・報いる意味か確認します。" },
  { id: "kotaeru", noun: ["質問", "設問"], particle: "に", wrong: ["応える"], candidate: "答える", section: "057 こたえる", reason: "解答する意味か確認します。" },
  { id: "atsui", noun: ["お茶", "茶", "湯", "スープ", "コーヒー"], particle: "が", wrong: ["暑い"], candidate: "熱い", section: "008 あつい", reason: "飲み物の温度を表しているか確認します。", attributive: true },
  { id: "kawaku", noun: ["喉", "のど"], particle: "が", wrong: ["乾く"], candidate: "渇く", section: "050 かわく", reason: "喉の潤いがなくなる意味か確認します。" },
  { id: "kawaku", noun: ["空気", "洗濯物", "干し物"], particle: "が", wrong: ["渇く"], candidate: "乾く", section: "050 かわく", reason: "水分がなくなる意味か確認します。" },
  { id: "naosu", noun: ["風邪", "病気", "けが", "怪我"], particle: "を", wrong: ["直す"], candidate: "治す", section: "094 なおす・なおる", reason: "病気やけがを治療する意味か確認します。" },
  { id: "naosu", noun: ["風邪", "病気", "けが", "怪我"], particle: "が", wrong: ["直る"], candidate: "治る", section: "094 なおす・なおる", reason: "病気やけがから回復する意味か確認します。" },
  { id: "naosu", noun: ["誤り", "機械", "服装", "故障", "誤字"], particle: "を", wrong: ["治す"], candidate: "直す", section: "094 なおす・なおる", reason: "正しい状態に戻す意味か確認します。" },
  { id: "narau", noun: ["前例", "慣例"], particle: "に", wrong: ["習う"], candidate: "倣う", section: "097 ならう", reason: "手本としてまねる意味か確認します。" },
  { id: "narau", noun: ["英語", "ピアノ"], particle: "を", wrong: ["倣う"], candidate: "習う", section: "097 ならう", reason: "教わって身に付ける意味か確認します。" },
];

/** Masks use spaces to preserve UTF-16 positions while avoiding NUL in NLP input. */
export function prepareNlpText(text: string, options: ProofreadOptions, terms: ProofreadTerm[]) {
  return createProofreadContext(text, options, terms).narrationText.split(MASK_CHAR).join(" ");
}

export function validateAnalysis(value: NlpAnalysis, input: string): NlpAnalysis {
  if (!value || !["morphology", "dependency"].includes(value.mode) || !Array.isArray(value.tokens) || value.tokens.length > 24000) throw new Error("解析結果の形式が不正です。");
  // Older running desktop backends embed the pre-fix Python script. Sudachi can
  // expand …/‥ into punctuation morphemes with no original span. Only discard
  // these morphology-only placeholders; dependency token indices stay intact.
  const tokens = value.mode === "morphology" ? value.tokens.filter(t => !(
    t.surface === "" && t.start === t.end && Number.isInteger(t.start) && t.start >= 0 && t.start <= input.length && t.head === -1 && t.pos === "補助記号" && t.lemma === "."
  )) : value.tokens;
  let end = 0;
  for (const [index, t] of tokens.entries()) {
    const context = `${value.mode}・単語${index + 1}・位置${t.start}–${t.end}`;
    if (!Number.isInteger(t.start) || !Number.isInteger(t.end) || t.start < end || t.end <= t.start || t.end > input.length) throw new Error(`解析結果の文字範囲が不正です（${context}）。`);
    if (input.slice(t.start, t.end) !== t.surface) throw new Error(`解析結果の文字位置が本文と一致しません（${context}）。`);
    if (typeof t.lemma !== "string" || typeof t.pos !== "string" || typeof t.dep !== "string" || !Number.isInteger(t.sentence) || t.sentence < 0 || !Number.isInteger(t.head) || t.head < -1 || t.head >= value.tokens.length) throw new Error(`解析結果の品詞・係り受け情報が不正です（${context}）。`);
    end = t.end;
  }
  const morphology = value.morphology ? validateAnalysis({ mode: "morphology", tokens: value.morphology }, input).tokens : undefined;
  return { ...value, tokens, ...(morphology ? { morphology } : {}) };
}

export function runNlpChecks(text: string, analysis: NlpAnalysis, options: ProofreadOptions, terms: ProofreadTerm[], disabledRules: string[] = []) {
  const input = prepareNlpText(text, options, terms);
  analysis = validateAnalysis(analysis, input);
  const tokens = analysis.tokens;
  const lexical: ProofreadHit[] = [];
  const dependency: ProofreadHit[] = [];
  const isSpace = (t: NlpToken) => !t.surface.trim();
  const nounPos = (t: NlpToken) => ["名詞", "NOUN", "PROPN"].includes(t.pos);
  const predicatePos = (t: NlpToken) => ["動詞", "形容詞", "VERB", "ADJ"].includes(t.pos);
  for (let i = 0; i < tokens.length; i++) {
    const noun = tokens[i];
    if (!nounPos(noun)) continue;
    for (const entry of collocations) {
      if (!entry.noun.includes(noun.lemma) && !entry.noun.includes(noun.surface)) continue;
      for (let j = Math.max(0, i - 6); j <= Math.min(tokens.length - 1, i + 8); j++) {
        const predicate = tokens[j];
        if (noun.sentence !== predicate.sentence || !predicatePos(predicate) || !entry.wrong.includes(predicate.lemma)) continue;
        // Protected/masked text, newlines and quotes must never be crossed.
        const between = input.slice(Math.min(noun.start, predicate.start), Math.max(noun.end, predicate.end));
        if (/[\r\n「」『』]/.test(between) || between !== text.slice(Math.min(noun.start, predicate.start), Math.max(noun.end, predicate.end))) continue;
        const middle = tokens.slice(Math.min(i, j) + 1, Math.max(i, j)).filter(t => !isSpace(t));
        const attributive = entry.attributive && j < i && (analysis.mode === "dependency" ? predicate.head === i && ["amod", "acl"].includes(predicate.dep) : middle.length === 0 || (middle.length === 1 && ["お", "ご"].includes(middle[0].surface)));
        const caseToken = middle[0];
        const argument = j > i && caseToken?.surface === entry.particle && (
          analysis.mode === "dependency" ? noun.head === j && caseToken.head === i && caseToken.dep === "case" : middle.length === 1
        );
        if (!attributive && !argument) continue;
        lexical.push({ from: predicate.start, to: predicate.end, checkId: `nlp-collocation/${entry.id}`,
          message: `「${entry.candidate}」の意味か確認してください。`,
          detail: `「${noun.surface}」との${analysis.mode === "dependency" ? "係り受け" : "連語"}を検出。${entry.reason} 出典：${entry.section}。解析結果は意味の正誤を保証しません。` });
      }
    }
    if (analysis.mode !== "dependency" || !["趣味", "楽しみ", "目標", "目的"].includes(noun.lemma)) continue;
    const root = tokens[noun.head];
    const topic = tokens[i + 1];
    if (!root || root.dep !== "ROOT" || root.pos !== "VERB" || root.sentence !== noun.sentence || topic?.surface !== "は" || topic.head !== i || !["nsubj", "obl"].includes(noun.dep)) continue;
    const from = noun.start, to = Math.max(root.end, ...tokens.filter(t => t.sentence === noun.sentence).map(t => t.end));
    if (input.slice(from, to) !== text.slice(from, to)) continue;
    dependency.push({ from, to, message: `「${noun.surface}は」と述語「${root.surface}」の対応を確認してください。`, detail: "「〜することだ」のような結びが適切か確認します。係り受けに基づく限定的な推敲候補です。省略・語り口を誤りとは断定しません。出典：公用文作成の考え方「文の書き方」。" });
  }
  const rules = [ { ...nlpCollocationRule, scan: () => lexical }, { ...nlpDependencyRule, scan: () => dependency } ].filter(r => !disabledRules.includes(r.id));
  const result = runProofread(text, options, rules, terms);
  if (analysis.mode === "dependency" && analysis.morphology) {
    const baseline = runNlpChecks(text, { mode: "morphology", tokens: analysis.morphology }, options, terms, disabledRules);
    const existing = new Set(result.issues.map(issue => issue.key));
    result.issues.push(...baseline.issues.filter(issue => !existing.has(issue.key)));
    result.issues.sort((a, b) => a.from - b.from);
    result.truncated ||= baseline.truncated || result.issues.length > MAX_PROOFREAD_ISSUES;
    result.issues = result.issues.slice(0, MAX_PROOFREAD_ISSUES);
  }
  return result;
}
