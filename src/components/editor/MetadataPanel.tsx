import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { countFrontMatterProperties } from "../../utils/frontmatter";
import type { FrontMatterAnalysis } from "../../utils/frontmatterYaml";

type MetadataPanelProps = {
  metadata: string;
  hasFrontMatter: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onAddProperty: () => void;
  onClear: () => void;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

type FrontMatterAnalyzer = typeof import("../../utils/frontmatterYaml");

const EMPTY_ANALYSIS: FrontMatterAnalysis = { properties: [], errors: [] };
// The YAML parser loads the first time a document with front matter is shown.
let loadedAnalyzer: FrontMatterAnalyzer | null = null;

// Re-runs only when the metadata text changes; typing in the body leaves it alone.
function useFrontMatterAnalysis(metadata: string): FrontMatterAnalysis | null {
  const needed = metadata.trim() !== "";
  const [analyzerReady, setAnalyzerReady] = useState(loadedAnalyzer !== null);

  useEffect(() => {
    if (!needed || loadedAnalyzer) return;
    let cancelled = false;
    import("../../utils/frontmatterYaml").then(
      (module) => {
        loadedAnalyzer = module;
        if (!cancelled) setAnalyzerReady(true);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [needed]);

  return useMemo(() => {
    if (!needed) return EMPTY_ANALYSIS;
    return loadedAnalyzer ? loadedAnalyzer.analyzeFrontMatter(metadata) : null;
    // analyzerReady re-runs this once the parser has loaded.
  }, [metadata, needed, analyzerReady]);
}

export function MetadataPanel({
  metadata,
  hasFrontMatter,
  isOpen,
  onToggle,
  onAddProperty,
  onClear,
  onChange,
}: MetadataPanelProps) {
  const analysis = useFrontMatterAnalysis(metadata);
  const errors = analysis?.errors ?? [];
  const propertyCount = analysis && errors.length === 0
    ? analysis.properties.length
    : countFrontMatterProperties(metadata);
  const metadataCount = propertyCount > 0 ? `${propertyCount}件` : "空";

  return (
    <section className="metadataPanel" aria-label="メタデータ">
      <div className="metadataHeader">
        <button
          className="metadataToggle"
          type="button"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <span aria-hidden="true">{isOpen ? "⌄" : "›"}</span>
          <span>プロパティ</span>
        </button>
        <span className="metadataCount">{metadataCount}</span>
        {errors.length > 0 && <span className="metadataErrorCount">エラー {errors.length}</span>}
        <button
          className="metadataActionButton"
          type="button"
          aria-label="プロパティを追加"
          onClick={onAddProperty}
        >
          +
        </button>
        <button
          className="metadataActionButton"
          type="button"
          aria-label="メタデータを削除"
          disabled={!hasFrontMatter}
          onClick={onClear}
        >
          ×
        </button>
      </div>
      {isOpen && (
        <>
          <textarea
            className="metadataEditor"
            value={metadata}
            placeholder="title:&#10;tags: []"
            spellCheck={false}
            aria-invalid={errors.length > 0}
            onChange={onChange}
          />
          {errors.length > 0 && (
            <ul className="metadataErrors">
              {errors.map((error) => (
                <li key={`${error.line}-${error.message}`}>
                  <span className="metadataErrorLine">{error.line}行目</span>
                  {error.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
