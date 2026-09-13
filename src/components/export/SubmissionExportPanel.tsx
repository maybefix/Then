import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LoadedExportSource } from "../../export/types";
import { useSubmissionPreview } from "./useSubmissionPreview";
import { readSubmissionOptions, saveSubmissionOptions } from "../../export/submission/options";
import { copySubmissionText, saveSubmissionText, submissionFileName } from "../../export/submission/submissionHostActions";
import type { SubmissionExportOptions, SubmissionTarget } from "../../export/submission/types";
import "./submissionExport.css";

const labels: Record<SubmissionTarget, string> = { kakuyomu: "カクヨム", narou: "小説家になろう", plain: "プレーンテキスト" };
const separators = { blank: "\n\n\n", stars: "\n\n＊　＊　＊\n\n" };

export function SubmissionExportPanel({ title, sources, sourceError, activeTab, sourceSelector, onClose, onOpenSource }: {
  title: string; sources: LoadedExportSource[]; sourceError?: string;
  activeTab: "files" | "settings" | "preview"; sourceSelector: ReactNode;
  onClose: () => void; onOpenSource: (path: string) => void;
}) {
  const [options, setOptions] = useState(readSubmissionOptions);
  const [separatorMode, setSeparatorMode] = useState(() => options.sourceSeparator === separators.blank ? "blank" : options.sourceSeparator === separators.stars ? "stars" : "custom");
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [storageError, setStorageError] = useState("");
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const copyPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    try { saveSubmissionOptions(options); setStorageError(""); }
    catch { setStorageError("設定を保存できません。この画面では引き続き使用できます。"); }
    setNotice(null);
  }, [options, sources]);

  const converted = useSubmissionPreview(sources, title, options);
  const result = converted.result;
  const readWarnings = sourceError ? sourceError.split("\n").filter(Boolean) : [];
  const warningCount = (result?.warnings.length ?? 0) + readWarnings.length;
  const patch = (value: Partial<SubmissionExportOptions>) => setOptions(current => ({ ...current, ...value }));
  const copy = async () => {
    if (!result || copyPending.current) return;
    copyPending.current = true;
    setCopying(true);
    setNotice(null);
    try {
      // Start the clipboard call in the click handler, before any await.
      await copySubmissionText(result.text);
      if (mounted.current) setNotice({ error: false, text: `${labels[result.target]}形式をコピーしました（${result.chars.toLocaleString()}字、${warningCount ? `${warningCount}件の警告があります` : "警告なし"}）` });
    } catch (error) {
      if (mounted.current) setNotice({ error: true, text: `コピーに失敗しました: ${String(error)}` });
    } finally {
      copyPending.current = false;
      if (mounted.current) setCopying(false);
    }
  };

  const save = async () => {
    if (!result || copyPending.current) return;
    copyPending.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const saved = await saveSubmissionText(result.text, submissionFileName(title, sources, result.target));
      if (mounted.current) setNotice({ error: false, text: saved
        ? `${saved.name}を保存しました（${result.chars.toLocaleString()}字、${warningCount ? `${warningCount}件の警告があります` : "警告なし"}）`
        : "保存をキャンセルしました" });
    } catch (error) {
      if (mounted.current) setNotice({ error: true, text: `保存に失敗しました: ${String(error)}` });
    } finally {
      copyPending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <>
    <div className="exportModalBody">
      {sourceSelector}
      <section className={`exportPreviewPanel submissionPreview ${activeTab === "preview" ? "mobileActive" : ""}`} aria-label="投稿用プレビュー">
        <div className="submissionSummary">{labels[options.target]} · {result?.chars.toLocaleString() ?? 0}字 · {result?.sourceCount ?? 0}ファイル · 警告{warningCount}件</div>
        {converted.loading ? <p role="status">投稿用テキストを変換中…</p> : converted.error ? <div role="alert"><p>{converted.error}</p><button type="button" className="exportBtn" onClick={converted.retry}>再試行</button></div> :
          <textarea className="submissionText" aria-label="変換後テキスト" readOnly value={result?.text ?? ""} spellCheck={false} />}
        {warningCount > 0 && <details className="submissionWarnings" open>
          <summary>変換警告（{warningCount}件）</summary>
          <ul>{readWarnings.map((message, index) => <li key={`read-${index}`}>読み込み失敗: {message}</li>)}
          {result?.warnings.map((warning, index) => {
            const source = sources.find(item => item.id === warning.sourceId);
            return <li key={index}>{source?.path ? <button type="button" onClick={() => onOpenSource(source.path)}>{warning.sourceName}</button> : warning.sourceName}
              {warning.line ? ` ${warning.line}行` : ""}: {warning.message}</li>;
          })}</ul>
        </details>}
      </section>
      <aside className={`exportSettingsPanel ${activeTab === "settings" ? "mobileActive" : ""}`} aria-label="投稿用設定">
        <fieldset className="exportSettingsContent submissionSettings" disabled={copying || saving}>
          <legend>投稿用テキスト設定</legend>
          <label>投稿先<select value={options.target} onChange={event => patch({ target: event.target.value as SubmissionTarget })}>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>見出し<select value={options.headingMode} onChange={event => patch({ headingMode: event.target.value as SubmissionExportOptions["headingMode"] })}>
            <option value="keep-text">記号のみ除去</option><option value="remove-first">各ファイルの先頭見出しを除外</option><option value="remove-all">すべて除外</option>
          </select></label>
          <label>ファイル間区切り<select value={separatorMode} onChange={event => {
            const mode = event.target.value; setSeparatorMode(mode);
            if (mode !== "custom") patch({ sourceSeparator: separators[mode as keyof typeof separators] });
          }}><option value="blank">空行2行</option><option value="stars">＊　＊　＊</option><option value="custom">任意文字列</option></select></label>
          {separatorMode === "custom" && <label>区切り文字列（改行を含めて入力）<textarea value={options.sourceSeparator} onChange={event => patch({ sourceSeparator: event.target.value })} /></label>}
          <label>改行コード<select value={options.lineEnding} onChange={event => patch({ lineEnding: event.target.value as SubmissionExportOptions["lineEnding"] })}>
            <option value="crlf">Windows（CRLF）</option><option value="lf">LF</option>
          </select></label>
          {options.target === "narou" && <label>なろうの傍点<select value={options.narouEmphasisMode} onChange={event => patch({ narouEmphasisMode: event.target.value as SubmissionExportOptions["narouEmphasisMode"] })}>
            <option value="ruby-dots">1文字ずつルビ化</option><option value="plain">解除</option>
          </select></label>}
          <p className="exportHelp">文字数は出力記法・空白を含み、改行は1字として数えます。</p>
          {storageError && <p role="alert">{storageError}</p>}
        </fieldset>
      </aside>
    </div>
    <footer className="exportModalFooter">
      <span className="submissionNotice" role={notice?.error ? "alert" : "status"}>{notice?.text ?? "投稿用設定は自動保存されます"}</span>
      <button type="button" className="exportBtn ghost" onClick={onClose}>キャンセル</button>
      <button type="button" className="exportBtn" disabled={!result || copying || saving} onClick={() => void copy()}>{copying ? "コピー中…" : "クリップボードへコピー"}</button>
      <button type="button" className="exportBtn primary" disabled={!result || copying || saving} onClick={() => void save()}>{saving ? "保存中…" : "テキストファイルに保存"}</button>
    </footer>
  </>;
}
