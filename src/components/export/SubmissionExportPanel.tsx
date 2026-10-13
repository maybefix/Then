import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { LoadedExportSource } from "../../export/types";
import { useSubmissionPreview } from "./useSubmissionPreview";
import { readSubmissionOptions, saveSubmissionOptions } from "../../export/submission/options";
import { copySubmissionText, saveSubmissionText, submissionFileName } from "../../export/submission/submissionHostActions";
import type { SubmissionExportOptions, SubmissionTarget } from "../../export/submission/types";
import { ExportTopbar, type ExportMobileTab } from "./ExportTopbar";
import "./submissionExport.css";

const labels: Record<SubmissionTarget, string> = { kakuyomu: "カクヨム", narou: "小説家になろう", plain: "プレーンテキスト" };
const separators = { blank: "\n\n\n", stars: "\n\n＊　＊　＊\n\n" };

type TopbarCommon = Omit<ComponentProps<typeof ExportTopbar>, "status" | "statusTone" | "menu" | "primary">;

export function SubmissionExportPanel({ title, sources, sourceError, activeTab, sourceSelector, topbar, onOpenSource }: {
  title: string; sources: LoadedExportSource[]; sourceError?: string;
  activeTab: ExportMobileTab; sourceSelector: ReactNode;
  topbar: TopbarCommon; onOpenSource: (path: string) => void;
}) {
  const [options, setOptions] = useState(readSubmissionOptions);
  const [separatorMode, setSeparatorMode] = useState(() => options.sourceSeparator === separators.blank ? "blank" : options.sourceSeparator === separators.stars ? "stars" : "custom");
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [storageError, setStorageError] = useState("");
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
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

  const busy = copying || saving;
  const summary = `${labels[options.target]}・${(result?.chars ?? 0).toLocaleString()}字・${result?.sourceCount ?? 0}ファイル`;

  return <>
    <ExportTopbar
      {...topbar}
      status={notice?.text ?? summary}
      statusTone={notice ? (notice.error ? "error" : "ok") : undefined}
      menu={[]}
      primary={<>
        <button type="button" className="stBtnLine exTopbarLine" disabled={!result || busy} onClick={() => void copy()}>{copying ? "コピー中…" : "クリップボードへコピー"}</button>
        <button type="button" className="stBtnPrimary" disabled={!result || busy} onClick={() => void save()}>{saving ? "保存中…" : "テキストファイルに保存"}</button>
      </>}
    />
    <div className="exLayout">
      {sourceSelector}
      <main className={`exMain${activeTab === "preview" ? " mobileActive" : ""}`} aria-label="投稿用プレビュー">
        <div className="exMainBar">
          <span className="exMainTitle">投稿用テキスト</span>
          <span className="exMainMeta">{summary}</span>
        </div>
        {warningCount > 0 && <div className="exNotice" role="status">
          <div className="exNoticeRow">
            <span>変換の警告が{warningCount}件あります。</span>
            <button type="button" aria-expanded={warningsOpen} onClick={() => setWarningsOpen((open) => !open)}>{warningsOpen ? "閉じる" : "内容を見る"}</button>
          </div>
          {warningsOpen && <ul>{readWarnings.map((message, index) => <li key={`read-${index}`}>読み込み失敗: {message}</li>)}
            {result?.warnings.map((warning, index) => {
              const source = sources.find(item => item.id === warning.sourceId);
              return <li key={index}>{source?.path ? <button type="button" className="exLinkButton" onClick={() => onOpenSource(source.path)}>{warning.sourceName}</button> : warning.sourceName}
                {warning.line ? ` ${warning.line}行` : ""}: {warning.message}</li>;
            })}</ul>}
        </div>}
        <div className="exStage exStagePadded">
          {converted.loading ? <div className="exEmpty" role="status"><span className="exSpinner"/><strong>投稿用テキストに変換しています…</strong></div>
            : converted.error ? <div className="exEmpty isError" role="alert"><strong>変換できませんでした</strong><p>{converted.error}</p><button type="button" className="stBtnPrimary sm" onClick={converted.retry}>もう一度試す</button></div>
            : <textarea className="submissionText" aria-label="変換後テキスト" readOnly value={result?.text ?? ""} spellCheck={false} />}
        </div>
      </main>
      <aside className={`exSettings${activeTab === "settings" ? " mobileActive" : ""}`} aria-label="投稿用設定">
        <fieldset className="exCard exCardStatic" disabled={busy}>
          <legend className="exCardLegend">記法の変換</legend>
          <div className="exCardBody">
            <label className="exField">投稿先<select value={options.target} onChange={event => patch({ target: event.target.value as SubmissionTarget })}>
              {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label className="exField">見出し<select value={options.headingMode} onChange={event => patch({ headingMode: event.target.value as SubmissionExportOptions["headingMode"] })}>
              <option value="keep-text">記号のみ除去</option><option value="remove-first">各ファイルの先頭見出しを除外</option><option value="remove-all">すべて除外</option>
            </select></label>
            {options.target === "narou" && <label className="exField">なろうの傍点<select value={options.narouEmphasisMode} onChange={event => patch({ narouEmphasisMode: event.target.value as SubmissionExportOptions["narouEmphasisMode"] })}>
              <option value="ruby-dots">1文字ずつルビ化</option><option value="plain">解除</option>
            </select></label>}
          </div>
        </fieldset>
        <fieldset className="exCard exCardStatic" disabled={busy}>
          <legend className="exCardLegend">ファイルの区切り</legend>
          <div className="exCardBody">
            <label className="exField">ファイル間区切り<select value={separatorMode} onChange={event => {
              const mode = event.target.value; setSeparatorMode(mode);
              if (mode !== "custom") patch({ sourceSeparator: separators[mode as keyof typeof separators] });
            }}><option value="blank">空行2行</option><option value="stars">＊　＊　＊</option><option value="custom">任意の文字列</option></select></label>
            {separatorMode === "custom" && <label className="exField">区切りの文字列（改行を含めて入力）<textarea value={options.sourceSeparator} onChange={event => patch({ sourceSeparator: event.target.value })} /></label>}
            <label className="exField">改行コード<select value={options.lineEnding} onChange={event => patch({ lineEnding: event.target.value as SubmissionExportOptions["lineEnding"] })}>
              <option value="crlf">Windows（CRLF）</option><option value="lf">LF</option>
            </select></label>
          </div>
        </fieldset>
        {storageError && <p className="exFootnote exDanger" role="alert">{storageError}</p>}
      </aside>
    </div>
  </>;
}
