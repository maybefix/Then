import type { FormEvent } from "react";
import type { AppDialog } from "../../types";

type AppDialogModalProps = {
  dialog: AppDialog;
  onClose: () => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onValueChange: (value: string) => void;
};

export function AppDialogModal({
  dialog,
  onClose,
  onSubmit,
  onValueChange,
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
        ) : (
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
        )}
      </section>
    </div>
  );
}
