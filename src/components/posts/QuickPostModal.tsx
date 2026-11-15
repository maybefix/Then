import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

type QuickPostModalProps = {
  onPost: (body: string) => Promise<boolean>;
  onClose: () => void;
  /** Hands focus back on close (the manuscript needs its own restorer to keep the caret). */
  onRestoreFocus?: (previouslyFocused: HTMLElement) => void;
};

function SendIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** Ctrl+Alt+I：右のペインを開かずに投稿する（BINDER 2-1）。見た目は以前の Idea の小窓と同じ。 */
export function QuickPostModal({ onPost, onClose, onRestoreFocus }: QuickPostModalProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const restoreFocusRef = useRef(onRestoreFocus);
  restoreFocusRef.current = onRestoreFocus;

  useEffect(() => {
    // 開く前の場所（本文など）を控え、閉じたらそこへ戻す。
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    textareaRef.current?.focus();
    return () => {
      if (!previouslyFocused?.isConnected) return;
      if (restoreFocusRef.current) restoreFocusRef.current(previouslyFocused);
      else previouslyFocused.focus();
    };
  }, []);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const posted = await onPost(text);
    setBusy(false);
    if (posted) onClose();
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <div className="modalBackdrop quickIdeaBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="quickIdeaModal"
        role="dialog"
        aria-modal="true"
        aria-label="投稿"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="ideaCaptureBox quickIdeaCaptureBox">
          <textarea
            ref={textareaRef}
            value={text}
            rows={6}
            aria-label="投稿"
            onChange={(event) => setText(event.target.value)}
            onCompositionStart={() => (composingRef.current = true)}
            onCompositionEnd={() => (composingRef.current = false)}
            onKeyDown={handleTextareaKeyDown}
          />
          <div className="ideaCaptureRow">
            <span className="ideaCaptureSpacer" />
            <button
              className="ideaPrimaryBtn quickIdeaSubmit"
              type="button"
              disabled={!text.trim() || busy}
              onClick={() => void submit()}
            >
              <SendIcon />
              <span>投稿</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
