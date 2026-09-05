import { IJIDOKUN, KOYOBUN } from './sources';
import type { ProofreadRule } from './types';

export const nlpCollocationRule: ProofreadRule = {
  id: "nlp-collocation", name: "文脈解析：異字同訓", severity: "hint", target: "common", respectsDialogue: true, wordScoped: true,
  summary: "手動解析で単語の原形と連語辞書を照合。係り受けモードでは修飾先も確認します。", sources: [IJIDOKUN],
  checks: ["kotaeru", "atsui", "kawaku", "naosu", "narau"].map((id, i) => ({ id: `nlp-collocation/${id}`, name: ["答・応", "熱・暑", "乾・渇", "直・治", "習・倣"][i], summary: "文脈解析の連語照合を切り替えます。" })),
  scan: () => [],
};
export const nlpDependencyRule: ProofreadRule = {
  id: "nlp-dependency", name: "文脈解析：主述の対応", severity: "hint", target: "common", respectsDialogue: true, wordScoped: false,
  summary: "係り受け解析で「趣味・楽しみ・目標・目的は」と動詞述語の対応を確認。省略や意図的な表現も含む参考情報です。",
  sources: [KOYOBUN], scan: () => [],
};

