import type { FormEvent } from "react";
import type { AppDialog } from "../../types";

type AppDialogModalProps = {
  dialog: AppDialog;
  onClose: () => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onValueChange: (value: string) => void;
  onFieldValueChange: (fieldId: string, value: string) => void;
  onChoice: (value: "primary" | "secondary") => void;
};

export function AppDialogModal({
  dialog,
  onClose,
  onSubmit,
  onValueChange,
  onFieldValueChange,
  onChoice,
}: AppDialogModalProps) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section
        className="modal compactModal"
        aria-label={dialog.title}
        role="dialog"
        aria-modal="true"
      >
        <header className="modalHeader">
          <h2>{dialog.title}</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        {dialog.type === "input" ? (
          <form className="modalForm" onSubmit={onSubmit}>
            <label>
              <span>{dialog.label}</span>
              <input
                autoFocus
                value={dialog.value}
                placeholder={dialog.placeholder}
                onChange={(event) => onValueChange(event.target.value)}
              />
            </label>
            {dialog.error && (
              <p className="dialogError" role="alert">
                {dialog.error}
              </p>
            )}
            <footer className="modalActions">
              <button type="button" onClick={onClose}>
                キャンセル
              </button>
              <button type="submit">{dialog.confirmLabel}</button>
            </footer>
          </form>
        ) : dialog.type === "multiInput" ? (
          <form className="modalForm" onSubmit={onSubmit}>
            {dialog.fields.map((field, index) => (
              <label key={field.id}>
                <span>{field.label}</span>
                {field.options ? (
                  <select
                    autoFocus={index === 0}
                    value={field.value}
                    onChange={(event) => onFieldValueChange(field.id, event.target.value)}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.multiline ? (
                  <textarea
                    autoFocus={index === 0}
                    value={field.value}
                    placeholder={field.placeholder}
                    onChange={(event) => onFieldValueChange(field.id, event.target.value)}
                  />
                ) : (
                  <input
                    autoFocus={index === 0}
                    value={field.value}
                    placeholder={field.placeholder}
                    onChange={(event) => onFieldValueChange(field.id, event.target.value)}
                  />
                )}
              </label>
            ))}
            {dialog.error && (
              <p className="dialogError" role="alert">
                {dialog.error}
              </p>
            )}
            <footer className="modalActions">
              <button type="button" onClick={onClose}>
                キャンセル
              </button>
              <button type="submit">{dialog.confirmLabel}</button>
            </footer>
          </form>
        ) : dialog.type === "createFile" ? (
          <form className="modalForm" onSubmit={onSubmit}>
            <label>
              <span>テキストファイル名</span>
              <input
                autoFocus
                value={dialog.fileName}
                placeholder="例: chapter-01.txt"
                onChange={(event) => onFieldValueChange("fileName", event.target.value)}
              />
            </label>
            <label>
              <span>テンプレート</span>
              <select
                value={dialog.templateId}
                onChange={(event) => onFieldValueChange("templateId", event.target.value)}
              >
                <option value="">なし</option>
                {dialog.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}（{template.scope === "workspace" ? "ワークスペース" : "共通"}）
                  </option>
                ))}
              </select>
              <small className="dialogFieldHint">
                選択したテキストを、そのまま新規ファイルの本文へコピーします
              </small>
            </label>
            {dialog.error && (
              <p className="dialogError" role="alert">
                {dialog.error}
              </p>
            )}
            <footer className="modalActions">
              <button type="button" onClick={onClose}>
                キャンセル
              </button>
              <button type="submit">{dialog.confirmLabel}</button>
            </footer>
          </form>
        ) : dialog.type === "confirm" ? (
          <form className="modalForm" onSubmit={onSubmit}>
            <div className="dialogMessage">
              <p>{dialog.message}</p>
              {dialog.detail && <span>{dialog.detail}</span>}
            </div>
            <footer className="modalActions">
              <button type="button" onClick={onClose}>
                キャンセル
              </button>
              <button className={dialog.danger ? "dangerAction" : ""} type="submit">
                {dialog.confirmLabel}
              </button>
            </footer>
          </form>
        ) : dialog.type === "choice" ? (
          <div className="modalForm">
            <div className="dialogMessage">
              <p>{dialog.message}</p>
              {dialog.detail && <span>{dialog.detail}</span>}
            </div>
            <footer className="modalActions">
              <button type="button" onClick={() => onChoice("secondary")}>
                {dialog.secondaryLabel}
              </button>
              <button type="button" onClick={() => onChoice("primary")}>
                {dialog.primaryLabel}
              </button>
            </footer>
          </div>
        ) : null}
      </section>
    </div>
  );
}
