import { IJIDOKUN } from "./sources";
import type { ProofreadRule, ProofreadHit } from "./types";

/** 資料の語義を基にした限定的な連語照合。文の意味を解析するものではない。 */
const entries = [
  { id: "kotaeru", name: "答える・応える", section: "057 こたえる（本文14ページ）", patterns: [
    { pattern: /(期待|声援|要請|恩顧)に答え/g, candidate: "応える", reason: "応じる・報いる意味では「応える」が目安です。" },
    { pattern: /(質問|設問)に応え/g, candidate: "答える", reason: "解答する意味では「答える」が目安です。" },
  ] },
  { id: "atsui", name: "熱い・暑い", section: "008 あつい（本文5ページ）", patterns: [
    { pattern: /暑い(?:お茶|湯|スープ|コーヒー)(?![\p{Script=Han}ァ-ヶー])/gu, candidate: "熱い", reason: "飲み物などの温度には「熱い」が目安です。" },
    { pattern: /(?:お茶|湯|スープ|コーヒー)が暑(?:い|く|かった)/g, candidate: "熱い", reason: "物の温度には「熱い」、気温には「暑い」が目安です。" },
  ] },
  { id: "kawaku", name: "乾く・渇く", section: "050 かわく（本文12ページ）", patterns: [
    { pattern: /(喉|のど)が乾(?:く|き|か|け|こ|いた|いて)/g, candidate: "渇く", reason: "喉の潤いがなくなる意味では「渇く」が目安です。" },
    { pattern: /(空気|洗濯物|干し物)が渇(?:く|き|か|け|こ|いた|いて)/g, candidate: "乾く", reason: "水分がなくなる意味では「乾く」が目安です。" },
  ] },
  { id: "naosu", name: "直す・治す", section: "094 なおす・なおる（本文20ページ）", patterns: [
    { pattern: /(風邪|病気|けが|怪我)を直(?:す|し|さ|せ|そ)/g, candidate: "治す", reason: "病気やけがから回復させる意味では「治す」が目安です。" },
    { pattern: /(風邪|病気|けが|怪我)が直(?:る|り|ら|れ|ろ|っ)/g, candidate: "治る", reason: "病気やけがから回復する意味では「治る」が目安です。" },
    { pattern: /(誤り|機械|服装|故障|誤字)を治(?:す|し|さ|せ|そ)/g, candidate: "直す", reason: "正しい状態に戻す意味では「直す」が目安です。" },
  ] },
  { id: "narau", name: "習う・倣う", section: "097 ならう（本文21ページ）", patterns: [
    { pattern: /(前例|慣例)に習(?:う|い|わ|え|お|っ)/g, candidate: "倣う", reason: "手本としてまねる意味では「倣う」が目安です。" },
    { pattern: /(英語|ピアノ)を倣(?:う|い|わ|え|お|っ)/g, candidate: "習う", reason: "教わって身に付ける意味では「習う」が目安です。" },
  ] },
];

export const ijidokunRule: ProofreadRule = {
  id: "ijidokun",
  name: "異字同訓の使い分け",
  summary: "答・応、熱・暑、乾・渇、直・治、習・倣を、近接する語との組合せから確認。比喩や意図的な表記はそのまま使えます。",
  severity: "hint",
  target: "common",
  respectsDialogue: true,
  wordScoped: true,
  sources: [IJIDOKUN],
  checks: entries.map((entry) => ({ id: `ijidokun/${entry.id}`, name: entry.name, summary: `${entry.section}を参考に、限定した連語を確認します。` })),
  scan(context) {
    const hits: ProofreadHit[] = [];
    for (const entry of entries) {
      if (context.options.disabledChecks.includes(`ijidokun/${entry.id}`)) continue;
      for (const item of entry.patterns) {
        for (const match of context.narrationText.matchAll(new RegExp(item.pattern.source, item.pattern.flags))) {
          // 複合語の末尾に偶然一致する場合は保守的に除く。
          const previous = context.narrationText[match.index - 1] ?? "";
          if (/[\p{Script=Han}ァ-ヶー]/u.test(previous)) continue;
          hits.push({
            checkId: `ijidokun/${entry.id}`,
            from: match.index,
            to: match.index + match[0].length,
            message: `「${item.candidate}」の意味か確認してください。`,
            detail: `${item.reason} 出典：${entry.section}。近接する語による候補です。比喩・作中の語法は文脈に応じて判断してください。`,
            // 文脈で意味が変わるため、ワンクリック置換は提供しない。
          });
          if (hits.length >= 200) return hits;
        }
      }
    }
    return hits;
  },
};
