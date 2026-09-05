import { IJIDOKUN_ITEMS } from './ijidokunExtra';
import { IJIDOKUN, KOYOBUN } from './sources';
import type { ProofreadRule } from './types';

/** 活用する語の項目だけを扱う。名詞の項目は常時動作する異字同訓ルールが見る。 */
const groups = IJIDOKUN_ITEMS.filter(group => group.kind === "predicate");

export const nlpCollocationRule: ProofreadRule = {
  id: "nlp-collocation", name: "文脈解析：異字同訓", severity: "hint", target: "common", respectsDialogue: true, wordScoped: true,
  summary: `手動解析で単語の原形を取り、報告の全${groups.length}項目の手掛かり語と照合します。係り受けモードでは離れた項や修飾先も確認します。`,
  sources: [IJIDOKUN],
  checks: groups.map(group => ({
    id: `nlp-collocation/${group.no}`,
    name: `${group.reading}（${group.variants.map(variant => variant.heads[0]).join("・")}）`,
    summary: `報告の${group.no}（本文${group.page}ページ）。文脈解析での照合を切り替えます。`,
  })),
  scan: () => [],
};
export const nlpDependencyRule: ProofreadRule = {
  id: "nlp-dependency", name: "文脈解析：主述の対応", severity: "hint", target: "common", respectsDialogue: true, wordScoped: false,
  summary: "係り受け解析で「趣味・楽しみ・目標・目的は」と動詞述語の対応を確認。省略や意図的な表現も含む参考情報です。",
  sources: [KOYOBUN], scan: () => [],
};

