// Header and frame of the properties editor. The form itself (and the YAML parser
// it needs) loads lazily, so documents without front matter never pay for it.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { PropertyType, PropertyTypeSettings } from "../../properties/propertyModel";
import { countFrontMatterProperties } from "../../utils/frontmatter";
import type { FrontMatterAnalysis } from "../../utils/frontmatterYaml";

const PropertiesForm = lazy(() => import("./PropertiesForm"));

type FrontMatterAnalyzer = typeof import("../../utils/frontmatterYaml");
let loadedAnalyzer: FrontMatterAnalyzer | null = null;
const EMPTY_ANALYSIS: FrontMatterAnalysis = { properties: [], errors: [] };

// Re-runs only when the metadata text changes; typing in the body leaves it alone (FM-12).
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

export type PropertiesPanelProps = {
  documentKey: string;
  metadata: string;
  hasFrontMatter: boolean;
  onChangeMetadata: (next: string) => void;
  onClear: () => void;
  typeSettings: PropertyTypeSettings;
  onRememberType: (key: string, type: PropertyType) => void;
  onExit: () => void;
};

/** The right sidebar's properties pane, the same in vertical and horizontal writing. */
export function PropertiesPanel({
  documentKey,
  metadata,
  hasFrontMatter,
  onChangeMetadata,
  onClear,
  typeSettings,
  onRememberType,
  onExit,
}: PropertiesPanelProps) {
  const [view, setView] = useState<"form" | "source">("form");
  const [addRequest, setAddRequest] = useState(0);
  const analysis = useFrontMatterAnalysis(metadata);
  const errors = analysis?.errors ?? [];
  const propertyCount = analysis && errors.length === 0
    ? analysis.properties.length
    : countFrontMatterProperties(metadata);

  useEffect(() => {
    setAddRequest(0);
  }, [documentKey]);

  const requestAdd = () => {
    setView("form");
    setAddRequest((count) => count + 1);
  };

  return (
    <section className="propertiesPanel" aria-label="プロパティ">
      <div className="propertiesHeader">
        <span className="propertiesCount">{hasFrontMatter && propertyCount > 0 ? `${propertyCount}件` : "空"}</span>
        {errors.length > 0 && <span className="propertiesErrorCount">エラー {errors.length}</span>}
        <span className="propertiesHeaderSpacer" />
        <button
          className="propertiesActionButton"
          type="button"
          aria-label="YAMLで編集"
          aria-pressed={view === "source"}
          title="YAMLで編集"
          disabled={!hasFrontMatter}
          onClick={() => setView(view === "source" ? "form" : "source")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5" />
          </svg>
        </button>
        <button
          className="propertiesActionButton"
          type="button"
          aria-label="プロパティを追加"
          title="プロパティを追加"
          disabled={errors.length > 0}
          onClick={requestAdd}
        >
          +
        </button>
        <button
          className="propertiesActionButton"
          type="button"
          aria-label="プロパティをすべて削除"
          title="プロパティをすべて削除"
          disabled={!hasFrontMatter}
          onClick={onClear}
        >
          ×
        </button>
      </div>
      {(hasFrontMatter || addRequest > 0) && (
        <Suspense fallback={null}>
          <PropertiesForm
            documentKey={documentKey}
            metadata={metadata}
            typeSettings={typeSettings}
            view={view}
            onViewChange={setView}
            onChangeMetadata={onChangeMetadata}
            onRememberType={onRememberType}
            onExit={onExit}
            addRequest={addRequest}
          />
        </Suspense>
      )}
    </section>
  );
}
