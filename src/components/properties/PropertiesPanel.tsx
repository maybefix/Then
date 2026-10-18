// Header and frame of the properties editor. The form itself (and the YAML parser
// it needs) loads lazily, so documents without front matter never pay for it.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PropertyType, PropertyTypeSettings } from "../../properties/propertyModel";
import { historyShortcut, PropertiesHistory } from "../../properties/propertiesHistory";
import type { PropertySet } from "../../properties/propertySets";
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

// Kept outside the component so a document's history survives switching panes or tabs.
const propertiesHistory = new PropertiesHistory();

/**
 * Records every change of the metadata (form, YAML source, clear-all) and
 * returns undo/redo that write the recorded text back (FM-22).
 */
function usePropertiesHistory(documentKey: string, metadata: string, onChangeMetadata: (next: string) => void) {
  const previousRef = useRef({ documentKey, metadata });
  const restoringRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { documentKey, metadata };
    if (previous.documentKey !== documentKey || previous.metadata === metadata) return;
    if (restoringRef.current === metadata) {
      restoringRef.current = null;
      return;
    }
    restoringRef.current = null;
    propertiesHistory.record(documentKey, previous.metadata);
  }, [documentKey, metadata]);

  const restore = (target: string | null) => {
    if (target === null) return false;
    restoringRef.current = target;
    onChangeMetadata(target);
    return true;
  };
  return {
    undo: () => restore(propertiesHistory.undo(documentKey, metadata)),
    redo: () => restore(propertiesHistory.redo(documentKey, metadata)),
  };
}

type SetChoice = { set: PropertySet; missing: number };

/**
 * FM-27: add the missing properties of a set (the built-in article set or a
 * template's front matter). Sets that would add nothing are disabled.
 */
function PropertySetMenu({
  metadata,
  disabled,
  typeSettings,
  loadPropertySets,
  onChangeMetadata,
  onRememberType,
}: {
  metadata: string;
  disabled: boolean;
  typeSettings: PropertyTypeSettings;
  loadPropertySets: () => Promise<PropertySet[]>;
  onChangeMetadata: (next: string) => void;
  onRememberType: (key: string, type: PropertyType) => void;
}) {
  const [choices, setChoices] = useState<SetChoice[] | "loading" | null>(null);
  const modelRef = useRef<typeof import("../../properties/propertyModel") | null>(null);

  const open = async () => {
    if (choices) {
      setChoices(null);
      return;
    }
    setChoices("loading");
    try {
      const [model, sets] = await Promise.all([import("../../properties/propertyModel"), loadPropertySets()]);
      modelRef.current = model;
      setChoices(sets.flatMap((set) => {
        try {
          return [{ set, missing: model.addMissingProperties(metadata, set, typeSettings).added.length }];
        } catch {
          return []; // A template whose front matter is not valid YAML is left out.
        }
      }));
    } catch {
      setChoices(null);
    }
  };

  const apply = (set: PropertySet) => {
    setChoices(null);
    const model = modelRef.current;
    if (!model) return;
    const result = model.addMissingProperties(metadata, set, typeSettings);
    if (result.metadata !== metadata) onChangeMetadata(result.metadata);
    for (const added of result.added) {
      if (added.type) onRememberType(added.key, added.type);
    }
  };

  return (
    <span
      className="propertiesSetMenuAnchor"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setChoices(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && choices) {
          event.stopPropagation();
          setChoices(null);
        }
      }}
    >
      <button
        className="propertiesActionButton"
        type="button"
        aria-label="項目のセットを追加"
        title="項目のセットを追加"
        aria-haspopup="menu"
        aria-expanded={choices !== null}
        disabled={disabled}
        onClick={() => void open()}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M2.5 4h7M2.5 8h7M2.5 12h4.5M12 9.5v5M9.5 12h5" />
        </svg>
      </button>
      {Array.isArray(choices) && (
        <div className="propertiesSetMenu" role="menu">
          {choices.map(({ set, missing }) => (
            <button
              key={set.id}
              type="button"
              role="menuitem"
              disabled={missing === 0}
              onClick={() => apply(set)}
            >
              <span>{set.name}</span>
              <small>{missing > 0 ? `+${missing}` : "追加済み"}</small>
            </button>
          ))}
        </div>
      )}
    </span>
  );
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
  /** The built-in article set and every template that has properties (FM-25, FM-27). */
  loadPropertySets: () => Promise<PropertySet[]>;
  /** Search the work for a property value (FM-28). */
  onSearchProperty?: (key: string, value: string) => void;
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
  loadPropertySets,
  onSearchProperty,
}: PropertiesPanelProps) {
  const [view, setView] = useState<"form" | "source">("form");
  const [addRequest, setAddRequest] = useState(0);
  const analysis = useFrontMatterAnalysis(metadata);
  const errors = analysis?.errors ?? [];
  const propertyCount = analysis && errors.length === 0
    ? analysis.properties.length
    : countFrontMatterProperties(metadata);

  const history = usePropertiesHistory(documentKey, metadata, onChangeMetadata);

  useEffect(() => {
    setAddRequest(0);
  }, [documentKey]);

  // Property undo/redo while focus is in the pane. A field with unconfirmed typing
  // (data-dirty) and the YAML source keep the field's own undo.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    const action = historyShortcut(event);
    if (!action) return;
    const target = event.target as HTMLElement;
    if (target.closest(".propertiesSource") || target.dataset.dirty === "true") return;
    event.preventDefault();
    if (action === "undo") history.undo();
    else history.redo();
  };

  const requestAdd = () => {
    setView("form");
    setAddRequest((count) => count + 1);
  };

  return (
    <section className="propertiesPanel" aria-label="プロパティ" onKeyDown={onKeyDown}>
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
        <PropertySetMenu
          metadata={metadata}
          disabled={errors.length > 0}
          typeSettings={typeSettings}
          loadPropertySets={loadPropertySets}
          onChangeMetadata={onChangeMetadata}
          onRememberType={onRememberType}
        />
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
            onSearchProperty={onSearchProperty}
          />
        </Suspense>
      )}
    </section>
  );
}
