import { useEffect, useMemo, useState } from "react";
import { runProofread, type ProofreadResult } from "../../proofread/engine";
import { PROOFREAD_RULES } from "../../proofread/rules";
import {
  proofreadSeverityLabels,
  proofreadTargetLabels,
  type ProofreadIssue,
  type ProofreadOptions,
  type ProofreadRule,
} from "../../proofread/types";

/** 入力が続いている間は走らせない。止まってから校正する。 */
const SCAN_DEBOUNCE_MS = 320;

const EMPTY_RESULT: ProofreadResult = { issues: [], truncated: false, sentenceCount: 0 };

type ProofreadPaneProps = {
  /** 校正する本文。フロントマターを除いた本文と同じオフセットで扱う。 */
  text: string;
  /** 対象ファイルの識別子。切り替わったら「無視」を捨てる。 */
  documentKey: string;
  /** ペインが表示されているか。隠れている間は走らせない。 */
  active: boolean;
  options: ProofreadOptions;
  onOptionsChange: (options: ProofreadOptions) => void;
  disabledRuleIds: string[];
  onDisabledRuleIdsChange: (ruleIds: string[]) => void;
  /** 該当箇所を本文で選択する。 */
  onJump: (from: number, to: number) => void;
  /** 該当箇所を置き換える。 */
  onReplace: (from: number, to: number, insert: string) => void;
};

const sourceLabel = (rule: ProofreadRule) =>
  rule.sources.map((source) => source.title).join(" / ");

function IssueCard({
  issue,
  isSelected,
  onJump,
  onReplace,
  onIgnore,
}: {
  issue: ProofreadIssue;
  isSelected: boolean;
  onJump: () => void;
  onReplace: () => void;
  onIgnore: () => void;
}) {
  return (
    <li className={`proofIssue ${isSelected ? "isSelected" : ""}`}>
      <button className="proofIssueMain" type="button" onClick={onJump}>
        <span className="proofIssueHead">
          <span className={`proofSeverity is${issue.severity}`}>
            {proofreadSeverityLabels[issue.severity]}
          </span>
          <span className="proofIssueRule">{issue.ruleName}</span>
          <span className="proofIssueLine">{issue.line}行</span>
        </span>
        <span className="proofExcerpt">
          <span className="proofExcerptSide">{issue.excerpt.before}</span>
          <mark>{issue.excerpt.match}</mark>
          <span className="proofExcerptSide">{issue.excerpt.after}</span>
        </span>
        <span className="proofIssueMessage">{issue.message}</span>
        {issue.detail && <span className="proofIssueDetail">{issue.detail}</span>}
      </button>
      <div className="proofIssueActions">
        {issue.replacement !== undefined && (
          <button
            className="proofActionButton isPrimary"
            type="button"
            title={
              issue.replacement === ""
                ? "この箇所を削除する"
                : `「${issue.replacement}」に置き換える`
            }
            onClick={onReplace}
          >
            {issue.replacement === "" ? "削除" : `→ ${issue.replacement}`}
          </button>
        )}
        <button className="proofActionButton" type="button" onClick={onIgnore}>
          無視
        </button>
      </div>
    </li>
  );
}

function RuleCard({
  rule,
  count,
  enabled,
  skipDialogue,
  onToggle,
}: {
  rule: ProofreadRule;
  count: number;
  enabled: boolean;
  skipDialogue: boolean;
  onToggle: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <li className={`proofRule ${enabled ? "" : "isDisabled"}`}>
      <div className="proofRuleHead">
        <label className="proofRuleToggle">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="proofRuleName">{rule.name}</span>
        </label>
        <span className="proofRuleBadges">
          <span className="proofTarget">{proofreadTargetLabels[rule.target]}</span>
          <span className={`proofSeverity is${rule.severity}`}>
            {proofreadSeverityLabels[rule.severity]}
          </span>
          <span className="proofRuleCount">{count}</span>
        </span>
      </div>
      <p className="proofRuleSummary">{rule.summary}</p>
      <p className="proofRuleScope">
        {rule.respectsDialogue && skipDialogue
          ? "会話文（「」）は対象外"
          : "会話文（「」）も対象"}
      </p>
      <button
        className="proofSourceToggle"
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? "出典を閉じる" : `出典: ${sourceLabel(rule)}`}
      </button>
      {isOpen && (
        <ul className="proofSourceList">
          {rule.sources.map((source) => (
            <li className="proofSource" key={source.title}>
              <p className="proofSourceTitle">{source.title}</p>
              <p className="proofSourceMeta">
                {[source.publisher, source.edition, source.year ? `${source.year}年` : null]
                  .filter(Boolean)
                  .join(" / ")}
              </p>
              <p className="proofSourceBasis">{source.basis}</p>
              <p className="proofSourceLocator">参照先: {source.locator}</p>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ProofreadPane({
  text,
  documentKey,
  active,
  options,
  onOptionsChange,
  disabledRuleIds,
  onDisabledRuleIdsChange,
  onJump,
  onReplace,
}: ProofreadPaneProps) {
  const [view, setView] = useState<"issues" | "rules">("issues");
  const [result, setResult] = useState<ProofreadResult>(EMPTY_RESULT);
  const [isScanning, setIsScanning] = useState(false);
  const [ignoredKeys, setIgnoredKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState<string | null>(null);

  const enabledRules = useMemo(
    () => PROOFREAD_RULES.filter((rule) => !disabledRuleIds.includes(rule.id)),
    [disabledRuleIds],
  );

  // ファイルを切り替えたら、前のファイルに対する「無視」は持ち越さない。
  useEffect(() => {
    setIgnoredKeys([]);
    setSelectedKey(null);
  }, [documentKey]);

  useEffect(() => {
    if (!active) return;
    setIsScanning(true);
    const timer = window.setTimeout(() => {
      setResult(runProofread(text, options, enabledRules));
      setIsScanning(false);
    }, SCAN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, text, options, enabledRules]);

  const visibleIssues = useMemo(
    () =>
      result.issues.filter(
        (issue) =>
          !ignoredKeys.includes(issue.key) && (!ruleFilter || issue.ruleId === ruleFilter),
      ),
    [ignoredKeys, result.issues, ruleFilter],
  );

  const countByRule = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of result.issues) {
      if (ignoredKeys.includes(issue.key)) continue;
      counts.set(issue.ruleId, (counts.get(issue.ruleId) ?? 0) + 1);
    }
    return counts;
  }, [ignoredKeys, result.issues]);

  const activeCount = result.issues.filter((issue) => !ignoredKeys.includes(issue.key)).length;

  const toggleRule = (ruleId: string) => {
    onDisabledRuleIdsChange(
      disabledRuleIds.includes(ruleId)
        ? disabledRuleIds.filter((id) => id !== ruleId)
        : [...disabledRuleIds, ruleId],
    );
  };

  const patchOptions = (patch: Partial<ProofreadOptions>) =>
    onOptionsChange({ ...options, ...patch });

  return (
    <div className="proofPane">
      <div className="proofTopRow">
        <div className="proofViewSwitch" role="tablist" aria-label="校正の表示">
          <button
            className={`proofViewTab ${view === "issues" ? "isActive" : ""}`}
            type="button"
            role="tab"
            aria-selected={view === "issues"}
            onClick={() => setView("issues")}
          >
            指摘
            <span className="proofViewCount">{activeCount}</span>
          </button>
          <button
            className={`proofViewTab ${view === "rules" ? "isActive" : ""}`}
            type="button"
            role="tab"
            aria-selected={view === "rules"}
            onClick={() => setView("rules")}
          >
            ルール
            <span className="proofViewCount">{enabledRules.length}</span>
          </button>
        </div>
        <span className="proofStatus">
          {isScanning ? "校正中…" : `${result.sentenceCount}文`}
        </span>
      </div>

      {view === "issues" ? (
        <div className="proofBody">
          {countByRule.size > 0 && (
            <div className="proofFilterRow">
              <button
                className={`proofFilterChip ${ruleFilter ? "" : "isActive"}`}
                type="button"
                onClick={() => setRuleFilter(null)}
              >
                すべて
              </button>
              {enabledRules
                .filter((rule) => (countByRule.get(rule.id) ?? 0) > 0)
                .map((rule) => (
                  <button
                    className={`proofFilterChip ${ruleFilter === rule.id ? "isActive" : ""}`}
                    type="button"
                    key={rule.id}
                    title={`出典: ${sourceLabel(rule)}`}
                    onClick={() => setRuleFilter(ruleFilter === rule.id ? null : rule.id)}
                  >
                    {rule.name}
                    <span className="proofFilterCount">{countByRule.get(rule.id)}</span>
                  </button>
                ))}
            </div>
          )}

          {visibleIssues.length === 0 ? (
            <p className="proofEmpty">
              {enabledRules.length === 0
                ? "ルールがすべて外れています。「ルール」から選び直してください。"
                : activeCount === 0
                  ? "指摘はありません。"
                  : "この絞り込みに合う指摘はありません。"}
            </p>
          ) : (
            <ul className="proofIssueList">
              {visibleIssues.map((issue) => (
                <IssueCard
                  key={issue.key}
                  issue={issue}
                  isSelected={selectedKey === issue.key}
                  onJump={() => {
                    setSelectedKey(issue.key);
                    onJump(issue.from, issue.to);
                  }}
                  onReplace={() => {
                    setSelectedKey(issue.key);
                    onReplace(issue.from, issue.to, issue.replacement ?? "");
                  }}
                  onIgnore={() => setIgnoredKeys((keys) => [...keys, issue.key])}
                />
              ))}
            </ul>
          )}

          {result.truncated && (
            <p className="proofNote">指摘が多いため途中で打ち切りました。直してから再度確認します。</p>
          )}
          {ignoredKeys.length > 0 && (
            <button
              className="proofActionButton proofRestoreIgnored"
              type="button"
              onClick={() => setIgnoredKeys([])}
            >
              無視した{ignoredKeys.length}件を戻す
            </button>
          )}
        </div>
      ) : (
        <div className="proofBody">
          <div className="proofOptions">
            <label className="proofOptionRow">
              <span>一文の目安</span>
              <input
                type="number"
                min={20}
                max={200}
                step={5}
                value={options.maxSentenceLength}
                onChange={(event) =>
                  patchOptions({
                    maxSentenceLength: Math.max(
                      20,
                      Math.min(200, Number(event.target.value) || 80),
                    ),
                  })
                }
              />
              <span className="proofOptionUnit">字</span>
            </label>
            <label className="proofOptionRow">
              <span>一文の読点</span>
              <input
                type="number"
                min={1}
                max={12}
                value={options.maxCommasPerSentence}
                onChange={(event) =>
                  patchOptions({
                    maxCommasPerSentence: Math.max(
                      1,
                      Math.min(12, Number(event.target.value) || 4),
                    ),
                  })
                }
              />
              <span className="proofOptionUnit">個</span>
            </label>
            <label className="proofOptionCheck">
              <input
                type="checkbox"
                checked={options.skipDialogue}
                onChange={(event) => patchOptions({ skipDialogue: event.target.checked })}
              />
              <span>会話文（「」）を対象から外す</span>
            </label>
            <p className="proofOptionNote">
              語句の誤用・敬語・約物のルールは、この設定にかかわらず会話文も見ます。
            </p>
          </div>

          <ul className="proofRuleList">
            {PROOFREAD_RULES.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                count={countByRule.get(rule.id) ?? 0}
                enabled={!disabledRuleIds.includes(rule.id)}
                skipDialogue={options.skipDialogue}
                onToggle={() => toggleRule(rule.id)}
              />
            ))}
          </ul>

          <p className="proofNote">
            出典は各ルールが拠りどころにした資料です。どの語をどう拾うかはThenの実装で、
            資料そのものが定めた検査手順ではありません。指摘を採るかどうかは原稿ごとに判断してください。
          </p>
        </div>
      )}
    </div>
  );
}
