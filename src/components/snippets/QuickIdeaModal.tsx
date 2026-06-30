import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { IdeaThread } from "../../types";

type QuickIdeaModalProps = {
  threads: IdeaThread[];
  onCapture: (body: string, destId: string) => void;
  onClose: () => void;
};

function SendIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function QuickIdeaModal({ threads, onCapture, onClose }: QuickIdeaModalProps) {
  const inbox = useMemo(() => threads.find((thread) => thread.kind === "inbox"), [threads]);
  const inboxId = inbox?.id ?? threads[0]?.id ?? "";
  const [destId, setDestId] = useState(inboxId);
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!threads.some((thread) => thread.id === destId)) {
      setDestId(inboxId);
    }
  }, [threads, destId, inboxId]);

  const submit = () => {
    const body = text.trim();
    const targetId = destId || inboxId;
    if (!body || !targetId) return;
    onCapture(body, targetId);
    onClose();
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="modalBackdrop quickIdeaBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="quickIdeaModal"
        role="dialog"
        aria-modal="true"
        aria-label="Idea にメモを追加"
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
            placeholder="メモを書いて Enter で追加..."
            onChange={(event) => setText(event.target.value)}
            onCompositionStart={() => (composingRef.current = true)}
            onCompositionEnd={() => (composingRef.current = false)}
            onKeyDown={handleTextareaKeyDown}
          />
          <div className="ideaCaptureRow">
            <select
              className="ideaDestSelect quickIdeaDestSelect"
              aria-label="追加先スレッド"
              value={destId}
              onChange={(event) => setDestId(event.target.value)}
            >
              {threads.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.kind === "inbox" ? "▾ " : ""}
                  {thread.title}
                </option>
              ))}
            </select>
            <button
              className="ideaPrimaryBtn quickIdeaSubmit"
              type="button"
              disabled={!text.trim() || !destId}
              onClick={submit}
            >
              <SendIcon />
              <span>追加</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
