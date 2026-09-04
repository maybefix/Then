import { useEffect, useMemo, useState } from "react";
import {
  collectTermCandidates,
  termCandidateSourceLabels,
  type TermCandidate,
} from "../../proofread/candidates";
import {
  formatProofreadTermsForExport,
  formatVariants,
  parseVariantInput,
  mergeProofreadTerms,
  parseProofreadTermInput,
  proofreadTermKindLabels,
  proofreadTermKinds,
  proofreadTermPolicies,
  proofreadTermPolicyLabels,
  retargetProofreadTerm,
  sortProofreadTerms,
  updateProofreadTerm,
  validateTermSurface,
  type ProofreadTerm,
  type ProofreadTermKind,
  type ProofreadTermOrder,
  type ProofreadTermPolicy,
  type ProofreadTermScope,
} from "../../proofread/terms";

const BULK_PLACEHOLDER = [
  "橘沙耶\tたちばなさや\t人物\t両方\t橘紗耶/立花沙耶",
  "エルディア\t\t地名",
  "サーバ管理課\t\t組織",
  "魔導\t\t用語\t揃える\t魔道",
].join("\n");

/** 候補を一括入力と同じ書式へ組み立てるための区切り。 */
const COLUMN = String.fromCharCode(9);
const LINE_BREAK = String.fromCharCode(10);

type TermDraft = {
  surface: string;
  reading: string;
  kind: ProofreadTermKind;
  policy: ProofreadTermPolicy;
  variants: string;
  note: string;
};

const toDraft = (term: ProofreadTerm): TermDraft => ({
  surface: term.surface,
  reading: term.reading,
  kind: term.kind,
  policy: term.policy,
  variants: formatVariants(term.variants),
  note: term.note,
});

type ProofreadDictionaryProps = {
  /** 候補を拾う対象の本文。 */
  text: string;
  projectTerms: ProofreadTerm[];
  globalTerms: ProofreadTerm[];
  /** ワークスペースを開いていないときはプロジェクト辞書に保存できない。 */
  hasProject: boolean;
  onProjectTermsChange: (terms: ProofreadTerm[]) => void;
  onGlobalTermsChange: (terms: ProofreadTerm[]) => void;
  /** 辞書をファイルへ書き出す。保存したパスを返す。Tauri版でのみ働く。 */
  onExportFile: (content: string) => Promise<string | null>;
  /** ファイルから辞書のテキストを読む。Tauri版でのみ働く。 */
  onImportFile: () => Promise<string | null>;
  /** ファイルのやり取りができるか。 */
  canUseFiles: boolean;
};

export default function ProofreadDictionary({
  text,
  projectTerms,
  globalTerms,
  hasProject,
  onProjectTermsChange,
  onGlobalTermsChange,
  onExportFile,
  onImportFile,
  canUseFiles,
}: ProofreadDictionaryProps) {
  const [scope, setScope] = useState<ProofreadTermScope>(hasProject ? "project" : "global");
  const [mode, setMode] = useState<"list" | "bulk">("bulk");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ProofreadTermKind | "all">("all");
  const [order, setOrder] = useState<ProofreadTermOrder>("surface");
  const [notice, setNotice] = useState<string | null>(null);
  const [rejected, setRejected] = useState<{ line: string; reason: string }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TermDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<TermCandidate[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const activeScope: ProofreadTermScope = hasProject ? scope : "global";
  const terms = activeScope === "project" ? projectTerms : globalTerms;
  const applyTerms = activeScope === "project" ? onProjectTermsChange : onGlobalTermsChange;

  // 保存範囲を切り替えたら、別の辞書の行を編集したままにしない。
  useEffect(() => {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
    setCandidates(null);
    setPicked([]);
  }, [activeScope]);

  const visibleTerms = useMemo(() => {
    const needle = query.trim();
    const filtered = terms.filter((term) => {
      if (kindFilter !== "all" && term.kind !== kindFilter) return false;
      if (!needle) return true;
      return (
        term.surface.includes(needle) ||
        term.reading.includes(needle) ||
        term.note.includes(needle)
      );
    });
    return sortProofreadTerms(filtered, order);
  }, [kindFilter, order, query, terms]);

  const importText = (text: string, label: string) => {
    const parsed = parseProofreadTermInput(text, activeScope);
    setRejected(parsed.rejected);

    if (!parsed.terms.length) {
      setNotice(parsed.rejected.length ? "取り込める語がありませんでした。" : null);
      return;
    }

    const merged = mergeProofreadTerms(terms, parsed.terms);
    applyTerms(merged.terms);
    setNotice(
      merged.updated
        ? `${label}${merged.added}語を追加し、${merged.updated}語を更新しました。`
        : `${label}${merged.added}語を追加しました。`,
    );
    setMode("list");
  };

  const handleImportDraft = () => {
    importText(draft, "");
    setDraft("");
  };

  const handleImportFile = async () => {
    const text = await onImportFile();
    if (text === null) return;
    importText(text, "ファイルから");
  };

  const handleExportFile = async () => {
    const path = await onExportFile(formatProofreadTermsForExport(terms));
    if (path) setNotice(`${path} に書き出しました。`);
  };

  const handleExportToDraft = () => {
    setDraft(formatProofreadTermsForExport(terms));
    setRejected([]);
    setNotice("一括入力欄に書き出しました。コピーして保管できます。");
    setMode("bulk");
  };

  const handleCollectCandidates = () => {
    const found = collectTermCandidates(text, [...projectTerms, ...globalTerms]);
    setCandidates(found);
    setPicked(found.filter((candidate) => candidate.source === "ruby").map((c) => c.surface));
    setRejected([]);
    setNotice(
      found.length
        ? `${found.length}件の候補が見つかりました。登録するものを選んでください。`
        : "候補は見つかりませんでした。ルビ・敬称・繰り返し出てくる片仮名語を手がかりにしています。",
    );
  };

  const handleImportPicked = () => {
    if (!candidates) return;
    const chosen = candidates.filter((candidate) => picked.includes(candidate.surface));
    if (!chosen.length) return;

    const lines = chosen.map((candidate) =>
      [
        candidate.surface,
        candidate.reading,
        proofreadTermKindLabels[candidate.kind],
        "守る",
      ].join(COLUMN),
    );
    importText(lines.join(LINE_BREAK), "候補から");
    setCandidates(null);
    setPicked([]);
  };

  const handleRemove = (id: string) => {
    applyTerms(terms.filter((term) => term.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setEditDraft(null);
    }
    setNotice(null);
  };

  const startEditing = (term: ProofreadTerm) => {
    if (editingId === term.id) {
      setEditingId(null);
      setEditDraft(null);
      setEditError(null);
      return;
    }
    setEditingId(term.id);
    setEditDraft(toDraft(term));
    setEditError(null);
  };

  const handleSaveEdit = (term: ProofreadTerm) => {
    if (!editDraft) return;
    const error = validateTermSurface(editDraft.surface, terms, term.id);
    if (error) {
      setEditError(error);
      return;
    }
    applyTerms(
      updateProofreadTerm(terms, term.id, {
        surface: editDraft.surface,
        reading: editDraft.reading.trim(),
        kind: editDraft.kind,
        policy: editDraft.policy,
        variants: parseVariantInput(editDraft.variants, editDraft.surface.trim()),
        note: editDraft.note.trim(),
      }),
    );
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
    setNotice(`「${editDraft.surface.trim()}」を更新しました。`);
  };

  const handleMoveScope = (term: ProofreadTerm) => {
    const target: ProofreadTermScope = activeScope === "project" ? "global" : "project";
    const targetTerms = target === "project" ? projectTerms : globalTerms;
    const applyTarget = target === "project" ? onProjectTermsChange : onGlobalTermsChange;

    if (targetTerms.some((entry) => entry.surface === term.surface)) {
      setEditError("移動先の辞書に同じ表記があります");
      return;
    }

    applyTerms(terms.filter((entry) => entry.id !== term.id));
    applyTarget([...targetTerms, retargetProofreadTerm(term, target)]);
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
    setNotice(
      `「${term.surface}」を${target === "project" ? "このプロジェクト" : "共通"}へ移しました。`,
    );
  };

  return (
    <div className="proofDictionary">
      <div className="proofDictHead">
        <div className="proofScopeSwitch" role="group" aria-label="辞書の保存範囲">
          <button
            className={`proofScopeTab ${activeScope === "project" ? "isActive" : ""}`}
            type="button"
            disabled={!hasProject}
            title={
              hasProject
                ? "このワークスペースの .then/project.json に保存します"
                : "フォルダを開くとプロジェクト辞書を使えます"
            }
            onClick={() => setScope("project")}
          >
            プロジェクト
            <span className="proofScopeCount">{projectTerms.length}</span>
          </button>
          <button
            className={`proofScopeTab ${activeScope === "global" ? "isActive" : ""}`}
            type="button"
            title="すべてのワークスペースで使う辞書"
            onClick={() => setScope("global")}
          >
            共通
            <span className="proofScopeCount">{globalTerms.length}</span>
          </button>
        </div>
        <div className="proofDictModes">
          <button
            className={`proofActionButton ${mode === "bulk" ? "isPrimary" : ""}`}
            type="button"
            onClick={() => setMode("bulk")}
          >
            一括入力
          </button>
          <button
            className={`proofActionButton ${mode === "list" ? "isPrimary" : ""}`}
            type="button"
            onClick={() => setMode("list")}
          >
            一覧
          </button>
        </div>
      </div>

      {mode === "bulk" ? (
        <div className="proofBulkArea">
          <p className="proofNote">
            1行に1語。タブ・カンマ・2つ以上の空白で区切ると、
            <strong>表記 / 読み / 種別 / 扱い / 別表記</strong>まで指定できます。
            種別は人物・地名・組織・用語、扱いは「守る」「揃える」「両方」。
            別表記は誤りやすい形を「/」で並べます。
            省いた欄は種別「その他」、扱い「守る」になります。
          </p>
          <textarea
            className="proofBulkInput"
            value={draft}
            spellCheck={false}
            placeholder={BULK_PLACEHOLDER}
            aria-label="辞書の一括入力"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="proofBulkActions">
            <button
              className="proofActionButton"
              type="button"
              disabled={!text.trim()}
              title="ルビ・敬称・繰り返し出てくる片仮名語を手がかりに、原稿から候補を拾います"
              onClick={handleCollectCandidates}
            >
              原稿から候補を出す
            </button>
            <button
              className="proofActionButton"
              type="button"
              disabled={!terms.length}
              onClick={handleExportToDraft}
            >
              現在の辞書を書き出す
            </button>
            <button
              className="proofActionButton isPrimary"
              type="button"
              disabled={!draft.trim()}
              onClick={handleImportDraft}
            >
              取り込む
            </button>
          </div>
          {candidates && candidates.length > 0 && (
            <div className="proofCandidates">
              <div className="proofCandidateHead">
                <span>候補 {candidates.length}件</span>
                <div className="proofDictModes">
                  <button
                    className="proofActionButton"
                    type="button"
                    onClick={() =>
                      setPicked(
                        picked.length === candidates.length
                          ? []
                          : candidates.map((candidate) => candidate.surface),
                      )
                    }
                  >
                    {picked.length === candidates.length ? "すべて解除" : "すべて選ぶ"}
                  </button>
                  <button
                    className="proofActionButton isPrimary"
                    type="button"
                    disabled={!picked.length}
                    onClick={handleImportPicked}
                  >
                    選んだ{picked.length}語を登録
                  </button>
                </div>
              </div>
              <ul className="proofCandidateList">
                {candidates.map((candidate) => (
                  <li key={candidate.surface}>
                    <label className="proofCandidate">
                      <input
                        type="checkbox"
                        checked={picked.includes(candidate.surface)}
                        onChange={(event) =>
                          setPicked((current) =>
                            event.target.checked
                              ? [...current, candidate.surface]
                              : current.filter((surface) => surface !== candidate.surface),
                          )
                        }
                      />
                      <span className="proofTermSurface">{candidate.surface}</span>
                      {candidate.reading && (
                        <span className="proofTermReading">{candidate.reading}</span>
                      )}
                      <span className="proofTarget">
                        {termCandidateSourceLabels[candidate.source]}
                      </span>
                      <span className="proofCandidateCount">{candidate.count}回</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="proofNote">
                登録すると扱いは「守る」になります。表記を揃えたい語は、登録したあとに
                一覧で「揃える」に変えて別表記を足してください。
              </p>
            </div>
          )}

          {canUseFiles && (
            <div className="proofBulkActions">
              <button className="proofActionButton" type="button" onClick={handleImportFile}>
                ファイルから読み込む
              </button>
              <button
                className="proofActionButton"
                type="button"
                disabled={!terms.length}
                onClick={handleExportFile}
              >
                ファイルへ保存
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="proofDictList">
          <input
            className="proofDictSearch"
            type="search"
            value={query}
            placeholder="表記・読み・覚書から検索"
            aria-label="辞書を検索"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="proofDictFilters">
            <select
              value={kindFilter}
              aria-label="種別で絞り込む"
              onChange={(event) =>
                setKindFilter(event.target.value as ProofreadTermKind | "all")
              }
            >
              <option value="all">すべての種別</option>
              {proofreadTermKinds.map((kind) => (
                <option value={kind} key={kind}>
                  {proofreadTermKindLabels[kind]}
                </option>
              ))}
            </select>
            <select
              value={order}
              aria-label="並び順"
              onChange={(event) => setOrder(event.target.value as ProofreadTermOrder)}
            >
              <option value="surface">表記順</option>
              <option value="recent">更新が新しい順</option>
            </select>
          </div>

          {visibleTerms.length === 0 ? (
            <p className="proofEmpty">
              {terms.length
                ? "この絞り込みに合う語はありません。"
                : "まだ語が登録されていません。「一括入力」から並べて登録できます。"}
            </p>
          ) : (
            <ul className="proofTermList">
              {visibleTerms.map((term) => {
                const isEditing = editingId === term.id;
                return (
                  <li className={`proofTerm ${isEditing ? "isEditing" : ""}`} key={term.id}>
                    <button
                      className="proofTermRow"
                      type="button"
                      aria-expanded={isEditing}
                      onClick={() => startEditing(term)}
                    >
                      <span className="proofTermMain">
                        <span className="proofTermSurface">{term.surface}</span>
                        {term.reading && (
                          <span className="proofTermReading">{term.reading}</span>
                        )}
                      </span>
                      <span className="proofTermBadges">
                        <span className="proofTarget">
                          {proofreadTermKindLabels[term.kind]}
                        </span>
                        {term.variants.length > 0 && (
                          <span className="proofTermPolicyBadge">
                            別表記{term.variants.length}
                          </span>
                        )}
                        <span className="proofTermPolicyBadge">
                          {proofreadTermPolicyLabels[term.policy]}
                        </span>
                      </span>
                    </button>

                    {isEditing && editDraft && (
                      <div className="proofTermEditor">
                        <label className="proofTermField">
                          <span>表記</span>
                          <input
                            value={editDraft.surface}
                            spellCheck={false}
                            onChange={(event) =>
                              setEditDraft({ ...editDraft, surface: event.target.value })
                            }
                          />
                        </label>
                        <label className="proofTermField">
                          <span>読み</span>
                          <input
                            value={editDraft.reading}
                            spellCheck={false}
                            onChange={(event) =>
                              setEditDraft({ ...editDraft, reading: event.target.value })
                            }
                          />
                        </label>
                        <label className="proofTermField">
                          <span>種別</span>
                          <select
                            value={editDraft.kind}
                            onChange={(event) =>
                              setEditDraft({
                                ...editDraft,
                                kind: event.target.value as ProofreadTermKind,
                              })
                            }
                          >
                            {proofreadTermKinds.map((kind) => (
                              <option value={kind} key={kind}>
                                {proofreadTermKindLabels[kind]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="proofTermField">
                          <span>扱い</span>
                          <select
                            value={editDraft.policy}
                            onChange={(event) =>
                              setEditDraft({
                                ...editDraft,
                                policy: event.target.value as ProofreadTermPolicy,
                              })
                            }
                          >
                            {proofreadTermPolicies.map((policy) => (
                              <option value={policy} key={policy}>
                                {proofreadTermPolicyLabels[policy]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="proofTermField">
                          <span>別表記</span>
                          <input
                            value={editDraft.variants}
                            spellCheck={false}
                            placeholder="誤りやすい表記を / で区切る"
                            onChange={(event) =>
                              setEditDraft({ ...editDraft, variants: event.target.value })
                            }
                          />
                        </label>
                        <label className="proofTermField">
                          <span>覚書</span>
                          <input
                            value={editDraft.note}
                            placeholder="設定や由来のメモ"
                            onChange={(event) =>
                              setEditDraft({ ...editDraft, note: event.target.value })
                            }
                          />
                        </label>

                        {editError && <p className="proofTermError">{editError}</p>}

                        <div className="proofTermEditorActions">
                          <button
                            className="proofActionButton"
                            type="button"
                            disabled={!hasProject}
                            title={
                              hasProject
                                ? undefined
                                : "フォルダを開くとプロジェクト辞書へ移せます"
                            }
                            onClick={() => handleMoveScope(term)}
                          >
                            {activeScope === "project" ? "共通へ移す" : "プロジェクトへ移す"}
                          </button>
                          <button
                            className="proofActionButton"
                            type="button"
                            onClick={() => handleRemove(term.id)}
                          >
                            削除
                          </button>
                          <button
                            className="proofActionButton isPrimary"
                            type="button"
                            onClick={() => handleSaveEdit(term)}
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {notice && <p className="proofNote proofDictNotice">{notice}</p>}
      {rejected.length > 0 && (
        <ul className="proofRejectedList">
          {rejected.map((entry) => (
            <li key={`${entry.line}:${entry.reason}`}>
              <code>{entry.line}</code> — {entry.reason}
            </li>
          ))}
        </ul>
      )}

      <p className="proofNote">
        「守る」に指定した語は、どのルールも触れません。「揃える」に指定した語は、
        別表記の混入とルビの読みの食い違いを「辞書の表記ゆれ」ルールが見ます。
        {activeScope === "project"
          ? "この辞書はワークスペースの .then/project.json に保存されます。"
          : "この辞書はどのワークスペースでも使われます。"}
      </p>
    </div>
  );
}
