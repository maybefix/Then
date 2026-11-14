// 「この場面」(BINDER 1-7): the right pane that shows the synopsis and the
// progress of the document shown in the body. The synopsis is written into the
// shown tab's front matter, like the properties pane does, when the field is
// committed (Enter or leaving it); the tab saves it with the body. Progress is
// saved by the same call as the binder's progress mark.
import { useEffect, useRef, useState } from "react";
import type { SynopsisState } from "../../corkboard/synopsis";
import { loadSynopsis, loadedSynopsis } from "../../corkboard/loadSynopsis";
import { SYNOPSIS_KEY, propertyLabel } from "../../properties/propertyLabels";
import {
  fileProgressLabels,
  fileProgressMarkers,
  fileProgressStatuses,
  type FileProgressStatus,
} from "../../types";
import "./scene.css";

export type ScenePaneProps = {
  /** Changes when another tab is shown; a half-typed synopsis is dropped then. */
  documentKey: string;
  /** Text of the shown document, or null when there is none (an empty tab, another screen). */
  markdown: string | null;
  /** Put the new text into the shown tab (only its front matter differs). */
  onChangeMarkdown: (next: string) => void;
  /** Progress of the shown manuscript; null when it has none (a material, a file outside a work, an untitled document). */
  progress: FileProgressStatus | null;
  onSetProgress: (status: FileProgressStatus) => void;
  /** Escape: back to the body. */
  onExit: () => void;
};

export function ScenePane({ documentKey, markdown, onChangeMarkdown, progress, onSetProgress, onExit }: ScenePaneProps) {
  const [synopsisModule, setSynopsisModule] = useState(loadedSynopsis);
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const latest = useRef({ documentKey, markdown });
  latest.current = { documentKey, markdown };

  useEffect(() => {
    if (synopsisModule) return;
    let cancelled = false;
    void loadSynopsis().then((module) => {
      if (!cancelled) setSynopsisModule(module);
    });
    return () => {
      cancelled = true;
    };
  }, [synopsisModule]);

  // Another tab: what was typed for the previous one is not written anywhere.
  useEffect(() => {
    setDraft((current) => (current && current.key !== documentKey ? null : current));
  }, [documentKey]);

  if (markdown === null) return <div className="scenePane" aria-label="この場面" />;

  const state: SynopsisState | null = synopsisModule ? synopsisModule.readSynopsis(markdown) : null;
  const editable = state?.kind === "text" || state?.kind === "none";
  const shown = state?.kind === "text" || state?.kind === "readonly" ? state.text : "";
  const value = draft && draft.key === documentKey ? draft.text : shown;

  const commit = () => {
    const pending = draft;
    setDraft(null);
    const now = latest.current;
    if (!pending || pending.key !== now.documentKey || now.markdown === null || !synopsisModule) return;
    const current = synopsisModule.readSynopsis(now.markdown);
    if (current.kind !== "text" && current.kind !== "none") return;
    const next = synopsisModule.writeSynopsis(now.markdown, pending.text);
    if (next !== now.markdown) onChangeMarkdown(next);
  };

  const synopsisLabel = propertyLabel(SYNOPSIS_KEY) ?? SYNOPSIS_KEY;
  return (
    <div className="scenePane" aria-label="この場面">
      <section className="sceneSection">
        <h3 className="sceneSectionTitle">{synopsisLabel}</h3>
        <textarea
          className="sceneSynopsis"
          aria-label={synopsisLabel}
          rows={4}
          value={value}
          readOnly={!editable}
          spellCheck={false}
          onChange={(event) => setDraft({ key: documentKey, text: event.target.value.replace(/\r?\n/g, "") })}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              onExit();
            }
          }}
        />
      </section>
      {progress && (
        <section className="sceneSection">
          <h3 className="sceneSectionTitle">進捗</h3>
          <div className="sceneProgress" role="radiogroup" aria-label="進捗">
            {fileProgressStatuses.map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={status === progress}
                aria-label={fileProgressLabels[status]}
                title={fileProgressLabels[status]}
                className={`sceneProgressOption progressText-${status}`}
                onClick={() => {
                  if (status !== progress) onSetProgress(status);
                }}
              >
                {fileProgressMarkers[status]}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default ScenePane;
