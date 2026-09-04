import { useEffect, useMemo, useState } from "react";
import { runProofread, type ProofreadResult } from "../../proofread/engine";
import { PROOFREAD_RULES, proofreadRuleById } from "../../proofread/rules";
import {
  mergeProofreadTerms,
  parseProofreadTermInput,
  validateTermSurface,
  type ProofreadTerm,
  type ProofreadTermScope,
} from "../../proofread/terms";
import ProofreadDictionary from "./ProofreadDictionary";
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
  /** このワークスペースの校正辞書。 */
  projectTerms: ProofreadTerm[];
  /** 全ワークスペース共通の校正辞書。 */
  globalTerms: ProofreadTerm[];
  hasProject: boolean;
  onProjectTermsChange: (terms: ProofreadTerm[]) => void;
  onGlobalTermsChange: (terms: ProofreadTerm[]) => void;
  /** 辞書をファイルへ書き出す。保存したパスを返す。 */
  onExportTermFile: (content: string) => Promise<string | null>;
  /** ファイルから辞書のテキストを読む。 */
  onImportTermFile: () => Promise<string | null>;
  /** ファイルのやり取りができるか（Tauri版のみ）。 */
  canUseTermFiles: boolean;
  /** このファイルで無視している指摘のキー。 */
  ignoredKeys: string[];
  onIgnoredKeysChange: (keys: string[]) => void;
  /** 止めている検出項目のID。 */
  disabledCheckIds: string[];
  onDisabledCheckIdsChange: (checkIds: string[]) => void;
};

const sourceLabel = (rule: ProofreadRule) =>
  rule.sources.map((source) => source.title).join(" / ");

function IssueCard({
  issue,
  isSelected,
  canAddTerm,
  hasProject,
  onJump,
  onReplace,
  onIgnore,
  onAddTerm,
}: {
  issue: ProofreadIssue;
  isSelected: boolean;
  /** この指摘が語を指していて、辞書に登録できるか。 */
  canAddTerm: boolean;
  hasProject: boolean;
  onJump: () => void;
  onReplace: () => void;
  onIgnore: () => void;
  /** 登録できなければ理由を返す。 */
  onAddTerm: (surface: string, scope: ProofreadTermScope) => string | null;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [surface, setSurface] = useState(issue.excerpt.match);
  const [scope, setScope] = useState<ProofreadTermScope>(hasProject ? "project" : "global");
  const [error, setError] = useState<string | null>(null);

  const openAdd = () => {
    setSurface(issue.excerpt.match);
    setScope(hasProject ? "project" : "global");
    setError(null);
    setIsAdding(true);
  };

  const submit = () => {
    const failure = onAddTerm(surface, hasProject ? scope : "global");
    if (failure) {
      setError(failure);
      return;
    }
    setIsAdding(false);
  };

  return (
    <li className={`proofIssue ${isSelected ? "isSelected" : ""}`}>
      <button className="proofIssueMain" type="button" onClick={onJump}>
        <span className="proofIssueHead">
          <span className={`proofSeverity is${issue.severity}`}>
            {proofreadSeverityLabels[issue.severity]}
          </span>
          <span className="proofIssueRule">{issue.ruleName}</span>
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
        {canAddTerm && (
          <button
            className="proofActionButton"
            type="button"
            title="この語を辞書に登録して、以後どのルールも触れないようにする"
            onClick={() => (isAdding ? setIsAdding(false) : openAdd())}
          >
            辞書
          </button>
        )}
        <button className="proofActionButton" type="button" onClick={onIgnore}>
          無視
        </button>
      </div>
      {isAdding && (
        <div className="proofIssueAdd">
          <label className="proofTermField">
            <span>表記</span>
            <input
              value={surface}
              spellCheck={false}
              aria-label="辞書に登録する表記"
              onChange={(event) => {
                setSurface(event.target.value);
                setError(null);
              }}
            />
          </label>
          {hasProject && (
            <div className="proofScopeSwitch" role="group" aria-label="辞書の保存範囲">
              <button
                className={`proofScopeTab ${scope === "project" ? "isActive" : ""}`}
                type="button"
                onClick={() => setScope("project")}
              >
                プロジェクト
              </button>
              <button
                className={`proofScopeTab ${scope === "global" ? "isActive" : ""}`}
                type="button"
                onClick={() => setScope("global")}
              >
                共通
              </button>
            </div>
          )}
          <p className="proofNote">
            指摘された語より広い範囲が名前のこともあります。必要なら書き足してください。
          </p>
          {error && <p className="proofTermError">{error}</p>}
          <div className="proofTermEditorActions">
            <button
              className="proofActionButton"
              type="button"
              onClick={() => setIsAdding(false)}
            >
              やめる
            </button>
            <button
              className="proofActionButton isPrimary"
              type="button"
              disabled={!surface.trim()}
              onClick={submit}
            >
              辞書に追加
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function RuleCard({
  rule,
  count,
  enabled,
  skipDialogue,
  disabledCheckIds,
  onToggle,
  onToggleCheck,
}: {
  rule: ProofreadRule;
  count: number;
  enabled: boolean;
  skipDialogue: boolean;
  disabledCheckIds: string[];
  onToggle: () => void;
  onToggleCheck: (checkId: string) => void;
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
      {rule.checks && rule.checks.length > 0 && (
        <ul className="proofCheckList">
          {rule.checks.map((check) => (
            <li key={check.id}>
              <label className="proofCheckRow">
                <input
                  type="checkbox"
                  checked={!disabledCheckIds.includes(check.id)}
                  disabled={!enabled}
                  onChange={() => onToggleCheck(check.id)}
                />
                <span>
                  <span className="proofCheckName">{check.name}</span>
                  <span className="proofCheckSummary">{check.summary}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
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
  projectTerms,
  globalTerms,
  hasProject,
  onProjectTermsChange,
  onGlobalTermsChange,
  onExportTermFile,
  onImportTermFile,
  canUseTermFiles,
  ignoredKeys,
  onIgnoredKeysChange,
  disabledCheckIds,
  onDisabledCheckIdsChange,
}: ProofreadPaneProps) {
  const [view, setView] = useState<"issues" | "rules" | "dictionary">("issues");
  const [result, setResult] = useState<ProofreadResult>(EMPTY_RESULT);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [ruleFilter, setRuleFilter] = useState<string | null>(null);
  const [termNotice, setTermNotice] = useState<string | null>(null);

  const enabledRules = useMemo(
    () => PROOFREAD_RULES.filter((rule) => !disabledRuleIds.includes(rule.id)),
    [disabledRuleIds],
  );

  // プロジェクトの辞書を先に置き、同じ表記が共通側にもあればプロジェクト側を採る。
  const activeTerms = useMemo(() => {
    const bySurface = new Map<string, ProofreadTerm>();
    for (const term of [...projectTerms, ...globalTerms]) {
      if (!bySurface.has(term.surface)) bySurface.set(term.surface, term);
    }
    return [...bySurface.values()];
  }, [globalTerms, projectTerms]);

  useEffect(() => {
    setSelectedKey(null);
    setShowIgnored(false);
  }, [documentKey]);

  useEffect(() => {
    if (!active) return;
    setIsScanning(true);
    const timer = window.setTimeout(() => {
      setResult(runProofread(text, options, enabledRules, activeTerms));
      setIsScanning(false);
    }, SCAN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, text, options, enabledRules, activeTerms]);

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

  /**
   * 無視した指摘の一覧。本文が変わって同じ指摘が出なくなっていることもあるため、
   * 見つからないものはキーから読める範囲を出す。
   */
  const ignoredIssues = useMemo(() => {
    const byKey = new Map(result.issues.map((issue) => [issue.key, issue]));
    return ignoredKeys.map((key) => ({
      key,
      issue: byKey.get(key),
      label: key.split(":").slice(2).join(":") || key,
    }));
  }, [ignoredKeys, result.issues]);

  const toggleRule = (ruleId: string) => {
    onDisabledRuleIdsChange(
      disabledRuleIds.includes(ruleId)
        ? disabledRuleIds.filter((id) => id !== ruleId)
        : [...disabledRuleIds, ruleId],
    );
  };

  const patchOptions = (patch: Partial<ProofreadOptions>) =>
    onOptionsChange({ ...options, ...patch });

  /**
   * 指摘から辞書へ語を足す。登録できないときは理由を返し、カードの中に出す。
   * 扱いは「守る」で入れる。指摘を黙らせたくて押す操作なので。
   */
  const addTermFromIssue = (surface: string, scope: ProofreadTermScope): string | null => {
    const target = scope === "project" ? projectTerms : globalTerms;
    const trimmed = surface.trim();
    const failure = validateTermSurface(trimmed, target);
    if (failure) return failure;

    const parsed = parseProofreadTermInput(trimmed, scope);
    if (!parsed.terms.length) {
      return parsed.rejected[0]?.reason ?? "この表記は辞書に登録できません";
    }

    const merged = mergeProofreadTerms(target, parsed.terms);
    if (scope === "project") onProjectTermsChange(merged.terms);
    else onGlobalTermsChange(merged.terms);

    setTermNotice(
      `「${trimmed}」を${scope === "project" ? "このプロジェクト" : "共通"}の辞書に追加しました。`,
    );
    return null;
  };

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
          <button
            className={`proofViewTab ${view === "dictionary" ? "isActive" : ""}`}
            type="button"
            role="tab"
            aria-selected={view === "dictionary"}
            onClick={() => setView("dictionary")}
          >
            辞書
            <span className="proofViewCount">{projectTerms.length + globalTerms.length}</span>
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

          {termNotice && (
            <button
              className="proofNote proofTermNotice"
              type="button"
              title="閉じる"
              onClick={() => setTermNotice(null)}
            >
              {termNotice}
            </button>
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
                  canAddTerm={proofreadRuleById.get(issue.ruleId)?.wordScoped ?? false}
                  hasProject={hasProject}
                  onAddTerm={addTermFromIssue}
                  onJump={() => {
                    setSelectedKey(issue.key);
                    onJump(issue.from, issue.to);
                  }}
                  onReplace={() => {
                    setSelectedKey(issue.key);
                    onReplace(issue.from, issue.to, issue.replacement ?? "");
                  }}
                  onIgnore={() => onIgnoredKeysChange([...ignoredKeys, issue.key])}
                />
              ))}
            </ul>
          )}

          {result.truncated && (
            <p className="proofNote">指摘が多いため途中で打ち切りました。直してから再度確認します。</p>
          )}
          {ignoredKeys.length > 0 && (
            <div className="proofIgnoredArea">
              <button
                className="proofSourceToggle"
                type="button"
                aria-expanded={showIgnored}
                onClick={() => setShowIgnored((open) => !open)}
              >
                {showIgnored ? "無視した指摘を閉じる" : `無視した指摘 ${ignoredKeys.length}件`}
              </button>
              {showIgnored && (
                <>
                  <ul className="proofIgnoredList">
                    {ignoredIssues.map((entry) => (
                      <li className="proofIgnoredItem" key={entry.key}>
                        <span className="proofIgnoredText">
                          {entry.issue ? (
                            <>
                              <span className="proofIssueRule">{entry.issue.ruleName}</span>
                              <span className="proofIgnoredExcerpt">
                                {entry.issue.excerpt.match}
                              </span>
                            </>
                          ) : (
                            <span className="proofIgnoredExcerpt">{entry.label}</span>
                          )}
                        </span>
                        <button
                          className="proofActionButton"
                          type="button"
                          onClick={() =>
                            onIgnoredKeysChange(ignoredKeys.filter((key) => key !== entry.key))
                          }
                        >
                          戻す
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    className="proofActionButton proofRestoreIgnored"
                    type="button"
                    onClick={() => onIgnoredKeysChange([])}
                  >
                    すべて戻す
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : view === "rules" ? (
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
                disabledCheckIds={disabledCheckIds}
                onToggle={() => toggleRule(rule.id)}
                onToggleCheck={(checkId) =>
                  onDisabledCheckIdsChange(
                    disabledCheckIds.includes(checkId)
                      ? disabledCheckIds.filter((id) => id !== checkId)
                      : [...disabledCheckIds, checkId],
                  )
                }
              />
            ))}
          </ul>

          <p className="proofNote">
            出典は各ルールが拠りどころにした資料です。どの語をどう拾うかはThenの実装で、
            資料そのものが定めた検査手順ではありません。指摘を採るかどうかは原稿ごとに判断してください。
          </p>
        </div>
      ) : (
        <div className="proofBody">
          <ProofreadDictionary
            text={text}
            projectTerms={projectTerms}
            globalTerms={globalTerms}
            hasProject={hasProject}
            onProjectTermsChange={onProjectTermsChange}
            onGlobalTermsChange={onGlobalTermsChange}
            onExportFile={onExportTermFile}
            onImportFile={onImportTermFile}
            canUseFiles={canUseTermFiles}
          />
        </div>
      )}
    </div>
  );
}
