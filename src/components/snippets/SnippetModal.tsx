import type { ChangeEvent, FormEvent } from "react";
import type { SnippetDraft } from "../../types";

type SnippetModalProps = {
  draft: SnippetDraft;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (
    key: keyof SnippetDraft,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

export function SnippetModal({
  draft,
  onClose,
  onSubmit,
  onDraftChange,
}: SnippetModalProps) {
  const title = draft.id ? "スニペットを編集" : "スニペットを追加";

  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modal" aria-label={title} role="dialog" aria-modal="true">
        <header className="modalHeader">
          <h2>{title}</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="modalForm" onSubmit={onSubmit}>
          <label>
            <span>タイトル</span>
            <input value={draft.title} onChange={onDraftChange("title")} />
          </label>
          <label>
            <span>本文</span>
            <textarea value={draft.text} onChange={onDraftChange("text")} rows={6} />
          </label>
          <div className="modalFormGrid">
            <label>
              <span>カテゴリ</span>
              <input value={draft.category} onChange={onDraftChange("category")} />
            </label>
            <label>
              <span>タグ</span>
              <input value={draft.tags} onChange={onDraftChange("tags")} />
            </label>
          </div>
          <footer className="modalActions">
            <button type="button" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit">{draft.id ? "更新" : "追加"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
