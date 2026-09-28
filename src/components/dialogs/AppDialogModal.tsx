import { useLayoutEffect, useRef, type FormEvent } from "react";
import type { AppDialog } from "../../types";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type AppDialogModalProps = {
  dialog: AppDialog;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableElements = () =>
      Array.from(dialogElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
    const isTopmostDialog = () => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      return dialogs[dialogs.length - 1] === dialogElement;
    };

    const initialFocus = dialogElement.querySelector<HTMLElement>("input, select, textarea")
      ?? (dialog.type === "confirm"
        ? dialogElement.querySelector<HTMLElement>(".modalActions button")
        : null)
      ?? dialogElement.querySelector<HTMLElement>(".modalClose");
    (initialFocus ?? dialogElement).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialogElement.contains(active) || active === dialogElement) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (isTopmostDialog() && !dialogElement.contains(event.target as Node)) {
        (focusableElements()[0] ?? dialogElement).focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className="modalBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="modal compactModal"
        aria-label={dialog.title}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
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
            {dialog.fields.map((field) => (
              <label key={field.id}>
                <span>{field.label}</span>
                {field.options ? (
                  <select
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
                    value={field.value}
                    placeholder={field.placeholder}
                    onChange={(event) => onFieldValueChange(field.id, event.target.value)}
                  />
                ) : (
                  <input
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
