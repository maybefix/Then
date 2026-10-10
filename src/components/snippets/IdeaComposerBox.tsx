import { useState, type ReactNode } from "react";

/** Keep the composer's CSS state local. Relational selectors combining :has()
 * and :not() made Chromium invalidate the entire editor on unrelated edits. */
export function IdeaComposerBox({ text, children }: { text: string; children: ReactNode }) {
  const [clipFocused, setClipFocused] = useState(false);
  return (
    <div
      className="ideaCaptureBox ideaCaptureStacked"
      data-empty={text.length === 0 ? "true" : undefined}
      data-clip-focused={clipFocused ? "true" : undefined}
      onFocusCapture={(event) => setClipFocused(Boolean(
        (event.target as HTMLElement).closest(".ideaClipHost"),
      ))}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        setClipFocused(next instanceof HTMLElement && event.currentTarget.contains(next) &&
          Boolean(next.closest(".ideaClipHost")));
      }}
    >
      {children}
    </div>
  );
}
