import { useMemo, useState, type FormEvent } from "react";
import {
  tidyManuscript,
  type ManuscriptTidyLineRange,
  type ManuscriptTidyOptions,
  type ManuscriptTidyResult,
} from "../../editor/manuscriptTidy";
import { useModalFocus } from "./useModalFocus";

type ManuscriptTidyModalProps = {
  text: string;
  /** 選択範囲が掛かっている行。選択がなければ null。 */
  selectionLines: ManuscriptTidyLineRange | null;
  onApply: (result: ManuscriptTidyResult) => void;
  onClose: () => void;
  /** 閉じたときに、開く前のフォーカスを戻す方法（エディタはキャレットを保ったまま戻す）。 */
  onRestoreFocus?: (previouslyFocused: HTMLElement) => void;
};

export function ManuscriptTidyModal({
  text,
  selectionLines,
  onApply,
  onClose,
  onRestoreFocus,
}: ManuscriptTidyModalProps) {
  const dialogRef = useModalFocus(onClose, 'input[type="checkbox"]', onRestoreFocus);
  const [options, setOptions] = useState<ManuscriptTidyOptions>({
    indentParagraphs: true,
    spaceAfterExclamation: true,
  });
  const [scope, setScope] = useState<"document" | "selection">(selectionLines ? "selection" : "document");
  const lineRange = scope === "selection" && selectionLines ? selectionLines : undefined;
  const result = useMemo(() => tidyManuscript(text, options, lineRange), [text, options, lineRange?.from, lineRange?.to]);
  const changeCount = result.indented + result.spaced;

  const toggle = (key: keyof ManuscriptTidyOptions, checked: boolean) =>
    setOptions((current) => ({ ...current, [key]: checked }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (changeCount > 0) onApply(result);
  };

  return (
    <div className="modalBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="modal compactModal manuscriptTidyModal"
        aria-label="原稿を整える"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <header className="modalHeader">
          <h2>原稿を整える</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="modalForm" onSubmit={submit}>
          <label className="checkSetting descriptiveCheckSetting">
            <input
              type="checkbox"
              checked={options.indentParagraphs}
              onChange={(event) => toggle("indentParagraphs", event.target.checked)}
            />
            <span className="checkSettingCopy">
              <span>段落の頭を字下げする{options.indentParagraphs && `（${result.indented}行）`}</span>
              <small>行頭に全角スペースを入れます。字下げ済みの行、「」などの括弧で始まる行、見出し・リスト・配置指示のある行は除きます。</small>
            </span>
          </label>
          <label className="checkSetting descriptiveCheckSetting">
            <input
              type="checkbox"
              checked={options.spaceAfterExclamation}
              onChange={(event) => toggle("spaceAfterExclamation", event.target.checked)}
            />
            <span className="checkSettingCopy">
              <span>「！」「？」のあとを一字空ける{options.spaceAfterExclamation && `（${result.spaced}か所）`}</span>
              <small>「！？」「！！」のように続くときは最後の記号のあとに入れます。閉じ括弧・句読点・行末の前には入れません。</small>
            </span>
          </label>
          {selectionLines && (
            <fieldset className="manuscriptTidyScope">
              <legend>対象</legend>
              <label>
                <input
                  type="radio"
                  name="manuscript-tidy-scope"
                  checked={scope === "selection"}
                  onChange={() => setScope("selection")}
                />
                <span>選択範囲の行</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="manuscript-tidy-scope"
                  checked={scope === "document"}
                  onChange={() => setScope("document")}
                />
                <span>文書全体</span>
              </label>
            </fieldset>
          )}
          <p className="manuscriptTidySummary" aria-live="polite">
            {changeCount > 0 ? `${changeCount}か所を整えます。元に戻す（Ctrl+Z）で取り消せます。` : "整える箇所はありません。"}
          </p>
          <footer className="modalActions">
            <button type="button" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" disabled={changeCount === 0}>
              整える
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
