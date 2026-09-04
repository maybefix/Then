import { createProofreadContext, isRangeMasked } from "./context";
import { PROOFREAD_RULES } from "./rules";
import type { ProofreadIssue, ProofreadOptions, ProofreadRule } from "./types";

/** 抜粋に添える前後の文字数。 */
const EXCERPT_MARGIN = 14;
/** 一度に画面へ出す指摘の上限。これを超えたら打ち切って件数だけ伝える。 */
export const MAX_PROOFREAD_ISSUES = 600;

export type ProofreadResult = {
  issues: ProofreadIssue[];
  /** 上限で打ち切ったか。 */
  truncated: boolean;
  /** 検査した文の数。 */
  sentenceCount: number;
};

const flatten = (text: string) => text.replace(/\s+/g, " ");

export function runProofread(
  text: string,
  options: ProofreadOptions,
  rules: ProofreadRule[] = PROOFREAD_RULES,
): ProofreadResult {
  const context = createProofreadContext(text, options);
  const issues: ProofreadIssue[] = [];
  let truncated = false;

  for (const rule of rules) {
    for (const hit of rule.scan(context)) {
      const from = Math.max(0, Math.min(text.length, hit.from));
      const to = Math.max(from, Math.min(text.length, hit.to));
      if (to === from) continue;

      // 会話文を対象外にする設定のとき、丸ごと会話文に入る指摘は落とす。
      if (
        rule.respectsDialogue &&
        options.skipDialogue &&
        isRangeMasked(context.narrationText, from, to)
      ) {
        continue;
      }

      if (issues.length >= MAX_PROOFREAD_ISSUES) {
        truncated = true;
        break;
      }

      const line = context.lineAt(from);
      const match = text.slice(from, to);
      issues.push({
        ...hit,
        from,
        to,
        key: `${rule.id}:${from}:${match}`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        line,
        column: from - context.lineStart(line) + 1,
        excerpt: {
          before: flatten(text.slice(Math.max(0, from - EXCERPT_MARGIN), from)),
          match: flatten(match),
          after: flatten(text.slice(to, Math.min(text.length, to + EXCERPT_MARGIN))),
        },
      });
    }
    if (truncated) break;
  }

  issues.sort((left, right) => left.from - right.from || left.ruleId.localeCompare(right.ruleId));

  return { issues, truncated, sentenceCount: context.sentences.length };
}
