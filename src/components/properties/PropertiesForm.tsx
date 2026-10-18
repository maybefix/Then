// The properties form: one row per top-level property (type, name, value), a YAML
// source view, and adding with name suggestions. Loaded lazily (see
// PropertiesPanel) because it pulls in the YAML parser.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  addProperty,
  readProperties,
  removeProperty,
  renameProperty,
  setPropertyValue,
  type PropertyRow,
  type PropertyType,
  type PropertyTypeSettings,
  type PropertyValue,
} from "../../properties/propertyModel";
import { analyzeFrontMatter } from "../../utils/frontmatterYaml";
import "./properties.css";

export type PropertiesFormProps = {
  /** Identifies the document, so a draft in the source view survives tab switches. */
  documentKey: string;
  metadata: string;
  typeSettings: PropertyTypeSettings;
  view: "form" | "source";
  onViewChange: (view: "form" | "source") => void;
  onChangeMetadata: (next: string) => void;
  onRememberType: (key: string, type: PropertyType) => void;
  /** Escape: hand focus back to the body without moving it. */
  onExit: () => void;
  /** Set by the panel when "+" in its header is pressed. */
  addRequest: number;
  /** Search the work for a property value (FM-28). */
  onSearchProperty?: (key: string, value: string) => void;
};

export const PROPERTY_TYPES: ReadonlyArray<[PropertyType, string]> = [
  ["text", "テキスト"],
  ["list", "リスト"],
  ["number", "数値"],
  ["checkbox", "チェックボックス"],
  ["date", "日付"],
  ["datetime", "日時"],
];
const TYPE_LABEL = Object.fromEntries(PROPERTY_TYPES) as Record<PropertyType, string>;

export function TypeIcon({ type }: { type: PropertyType | "raw" }) {
  const common = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (type) {
    case "number":
      return <svg {...common}><path d="M6 2.5 4.8 13.5M11.2 2.5 10 13.5M2.5 6h11M2 10h11" /></svg>;
    case "checkbox":
      return <svg {...common}><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="m5.2 8.2 2 2 3.8-4.2" /></svg>;
    case "date":
      return <svg {...common}><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 7h11M5.5 2v3M10.5 2v3" /></svg>;
    case "datetime":
      return <svg {...common}><circle cx="8" cy="8" r="5.6" /><path d="M8 4.8V8l2.2 1.6" /></svg>;
    case "list":
      return <svg {...common}><path d="M6 4h7.5M6 8h7.5M6 12h7.5" /><circle cx="3" cy="4" r=".7" fill="currentColor" /><circle cx="3" cy="8" r=".7" fill="currentColor" /><circle cx="3" cy="12" r=".7" fill="currentColor" /></svg>;
    case "raw":
      return <svg {...common}><path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5" /></svg>;
    default:
      return <svg {...common}><path d="M3 4h10M3 8h10M3 12h6" /></svg>;
  }
}

/** Convert a value for a new type, or null when information would be lost. */
function convertValue(row: PropertyRow, to: PropertyType): { value: PropertyValue } | null {
  const value = row.value;
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return { value: to === "list" ? [] : to === "checkbox" ? false : null };
  }
  const text = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : String(value);
  switch (to) {
    case "text":
      return text === null ? null : { value: text };
    case "list":
      return { value: Array.isArray(value) ? value : [String(value)] };
    case "number":
      return text !== null && /^-?\d+(?:\.\d+)?$/.test(text) ? { value: text } : null;
    case "checkbox":
      return text === "true" || text === "false" ? { value: text === "true" } : null;
    case "date":
      return text !== null && /^\d{4}-\d{2}-\d{2}/.test(text) ? { value: text.slice(0, 10) } : null;
    case "datetime":
      return text !== null && /^\d{4}-\d{2}-\d{2}/.test(text)
        ? { value: text.length === 10 ? `${text}T00:00` : text }
        : null;
  }
}

function emptyValue(type: PropertyType): PropertyValue {
  return type === "list" ? [] : type === "checkbox" ? false : null;
}

// Source-view drafts that are not valid YAML yet, kept per document so switching
// tabs does not lose them (FM-23). They are never written to the file.
const sourceDrafts = new Map<string, string>();

export default function PropertiesForm({
  documentKey,
  metadata,
  typeSettings,
  view,
  onViewChange,
  onChangeMetadata,
  onRememberType,
  onExit,
  addRequest,
  onSearchProperty,
}: PropertiesFormProps) {
  const sheet = useMemo(() => readProperties(metadata, typeSettings), [metadata, typeSettings]);
  const [pendingType, setPendingType] = useState<{ key: string; type: PropertyType } | null>(null);
  const [adding, setAdding] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  const write = (next: string) => {
    if (next !== metadata) onChangeMetadata(next);
  };

  useEffect(() => {
    if (addRequest > 0) {
      onViewChange("form");
      setAdding(true);
    }
    // Only a new "+" press opens the add row.
  }, [addRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // After adding or renaming, put the caret into that row's value.
  useLayoutEffect(() => {
    if (!focusKey) return;
    const row = rowsRef.current?.querySelector<HTMLElement>(`[data-property-key="${CSS.escape(focusKey)}"]`);
    row?.querySelector<HTMLElement>(".propertyValue input, .propertyValue textarea, .propertyValue button")?.focus();
    setFocusKey(null);
  }, [focusKey, sheet]);

  const onEscape = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onExit();
    }
  };

  if (view === "source") {
    return (
      <SourceView
        documentKey={documentKey}
        metadata={metadata}
        onChangeMetadata={write}
        onEscape={onEscape}
      />
    );
  }

  if (sheet.errors.length > 0) {
    return (
      <div className="propertiesBlocked">
        <ErrorList errors={sheet.errors} />
        <button type="button" className="propertiesLinkButton" onClick={() => onViewChange("source")}>
          ソースで修正
        </button>
      </div>
    );
  }

  const changeType = (row: PropertyRow, to: PropertyType) => {
    if (to === row.type) return;
    const converted = convertValue(row, to);
    if (!converted) {
      setPendingType({ key: row.key, type: to });
      return;
    }
    setPendingType(null);
    write(setPropertyValue(metadata, row.key, to, converted.value, typeSettings));
    onRememberType(row.key, to);
  };

  const existingKeys = new Set(sheet.rows.map((row) => row.key));

  return (
    <div className="propertiesForm" onKeyDown={onEscape}>
      <div className="propertyRows" role="list" ref={rowsRef}>
        {sheet.rows.map((row) => (
          <div key={row.key} role="listitem">
            <PropertyRowView
              row={row}
              existingKeys={existingKeys}
              onType={(type) => changeType(row, type)}
              onValue={(value) => write(setPropertyValue(metadata, row.key, row.type, value, typeSettings))}
              onRename={(nextKey) => {
                write(renameProperty(metadata, row.key, nextKey));
                setFocusKey(nextKey);
              }}
              onRemove={() => write(removeProperty(metadata, row.key))}
              onEditSource={() => onViewChange("source")}
              onSearch={onSearchProperty ? (value) => onSearchProperty(row.key, value) : undefined}
            />
            {pendingType?.key === row.key && (
              <div className="propertyConfirm">
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setPendingType(null);
                    write(setPropertyValue(metadata, row.key, pendingType.type, emptyValue(pendingType.type), typeSettings));
                    onRememberType(row.key, pendingType.type);
                  }}
                >
                  値を消して{TYPE_LABEL[pendingType.type]}にする
                </button>
                <button type="button" onClick={() => setPendingType(null)}>
                  {TYPE_LABEL[row.type]}のままにする
                </button>
              </div>
            )}
          </div>
        ))}
        {adding && (
          <AddRow
            existingKeys={existingKeys}
            typeSettings={typeSettings}
            onAdd={(key, type) => {
              setAdding(false);
              write(addProperty(metadata, key, type, emptyValue(type)));
              setFocusKey(key);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
      {!adding && (
        <button type="button" className="propertyAddButton" onClick={() => setAdding(true)}>
          <TypeIcon type="text" />
          <span>プロパティを追加</span>
        </button>
      )}
    </div>
  );
}

function ErrorList({ errors }: { errors: { line: number; message: string }[] }) {
  return (
    <ul className="propertiesErrors">
      {errors.map((error) => (
        <li key={`${error.line}-${error.message}`}>
          <span className="propertiesErrorLine">{error.line}行目</span>
          {error.message}
        </li>
      ))}
    </ul>
  );
}

function SourceView({
  documentKey,
  metadata,
  onChangeMetadata,
  onEscape,
}: {
  documentKey: string;
  metadata: string;
  onChangeMetadata: (next: string) => void;
  onEscape: (event: ReactKeyboardEvent) => void;
}) {
  // The draft remembers which document it belongs to. Switching documents shows
  // that document's own draft (or its YAML) in the same render, so a draft of
  // one manuscript can never be edited, or written, as another's.
  const [draftState, setDraftState] = useState(() => ({
    documentKey,
    text: sourceDrafts.get(documentKey) ?? metadata,
  }));
  const draft = draftState.documentKey === documentKey
    ? draftState.text
    : sourceDrafts.get(documentKey) ?? metadata;
  const setDraft = (text: string) => setDraftState({ documentKey, text });
  const composingRef = useRef(false);
  const errors = useMemo(() => (draft.trim() ? analyzeFrontMatter(draft).errors : []), [draft]);

  // Another document, or the file changed from elsewhere (form, undo, another
  // window): follow it unless an invalid draft of this document is kept.
  useEffect(() => {
    setDraftState({ documentKey, text: sourceDrafts.get(documentKey) ?? metadata });
  }, [metadata, documentKey]);

  const commit = (text: string) => {
    if (composingRef.current) return;
    const valid = !text.trim() || analyzeFrontMatter(text).errors.length === 0;
    if (valid) {
      sourceDrafts.delete(documentKey);
      onChangeMetadata(text);
    } else {
      sourceDrafts.set(documentKey, text);
    }
  };

  return (
    <div className="propertiesSource">
      <textarea
        className="propertiesSourceText"
        value={draft}
        spellCheck={false}
        aria-label="プロパティのYAML"
        aria-invalid={errors.length > 0}
        rows={Math.max(4, draft.split("\n").length + 1)}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            const target = event.currentTarget;
            target.setRangeText("  ", target.selectionStart, target.selectionEnd, "end");
            setDraft(target.value);
            commit(target.value);
            return;
          }
          onEscape(event);
        }}
      />
      {errors.length > 0 && <ErrorList errors={errors} />}
    </div>
  );
}

function PropertyRowView({
  row,
  existingKeys,
  onType,
  onValue,
  onRename,
  onRemove,
  onEditSource,
  onSearch,
}: {
  row: PropertyRow;
  existingKeys: Set<string>;
  onType: (type: PropertyType) => void;
  onValue: (value: PropertyValue) => void;
  onRename: (key: string) => void;
  onRemove: () => void;
  onEditSource: () => void;
  onSearch?: (value: string) => void;
}) {
  const [keyDraft, setKeyDraft] = useState(row.key);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setKeyDraft(row.key), [row.key]);
  const keyTaken = keyDraft.trim() !== row.key && existingKeys.has(keyDraft.trim());
  const keyInvalid = !keyDraft.trim() || keyTaken;

  const commitKey = () => {
    const next = keyDraft.trim();
    if (!next || keyTaken || next === row.key) {
      setKeyDraft(row.key);
      return;
    }
    onRename(next);
  };

  return (
    <div className={`propertyRow${row.readOnly ? " readOnly" : ""}`} data-property-key={row.key}>
      <div className="propertyTypeCell">
        <button
          type="button"
          className="propertyTypeButton"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={row.readOnly === "structure" ? "フォームでは編集できない値" : TYPE_LABEL[row.type]}
          disabled={row.readOnly === "structure"}
          onClick={() => setMenuOpen((open) => !open)}
          onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
          }}
        >
          <TypeIcon type={row.readOnly === "structure" ? "raw" : row.type} />
        </button>
        {menuOpen && (
          <div className="propertyTypeMenu" role="menu">
            {PROPERTY_TYPES.map(([type, label]) => (
              <button
                key={type}
                type="button"
                role="menuitemradio"
                aria-checked={type === row.type}
                onClick={() => {
                  setMenuOpen(false);
                  onType(type);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setMenuOpen(false);
                  }
                }}
              >
                <TypeIcon type={type} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        className={`propertyKey${keyInvalid ? " invalid" : ""}`}
        data-dirty={keyDraft !== row.key}
        value={keyDraft}
        spellCheck={false}
        aria-label="プロパティ名"
        aria-invalid={keyInvalid}
        title={keyTaken ? "同じ名前のプロパティがあります" : undefined}
        onChange={(event) => setKeyDraft(event.target.value)}
        onBlur={commitKey}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commitKey();
          } else if (event.key === "Escape") {
            setKeyDraft(row.key);
          }
        }}
      />
      <div className="propertyValue">
        <ValueEditor row={row} onValue={onValue} onEditSource={onEditSource} onSearch={onSearch} />
      </div>
      <button type="button" className="propertyRemove" aria-label={`${row.key}を削除`} onClick={onRemove}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}

function rawValueText(row: PropertyRow): string {
  const lines = row.raw.split(/\r?\n/);
  const first = lines[0].replace(/^[^:]*:\s?/, "");
  return [first, ...lines.slice(1)].filter((line, index) => index > 0 || line !== "").join("\n");
}

function ValueEditor({
  row,
  onValue,
  onEditSource,
  onSearch,
}: {
  row: PropertyRow;
  onValue: (value: PropertyValue) => void;
  onEditSource: () => void;
  onSearch?: (value: string) => void;
}) {
  if (row.readOnly) {
    return (
      <div className="propertyRaw">
        <pre>{rawValueText(row)}</pre>
        <button type="button" className="propertiesLinkButton" onClick={onEditSource}>
          ソースで編集
        </button>
      </div>
    );
  }
  switch (row.type) {
    case "checkbox":
      return (
        <label className="propertyCheck">
          <input
            type="checkbox"
            checked={row.value === true}
            ref={(element) => {
              if (element) element.indeterminate = row.value === null;
            }}
            onChange={(event) => onValue(event.target.checked)}
          />
          {row.value === null && <span className="propertyHint">未設定</span>}
        </label>
      );
    case "number":
      return <CommitInput type="number" value={(row.value as string | null) ?? ""} onCommit={(text) => onValue(text === "" ? null : text)} />;
    case "date":
      return <CommitInput type="date" value={(row.value as string | null) ?? ""} onCommit={(text) => onValue(text || null)} />;
    case "datetime":
      return <CommitInput type="datetime-local" value={(row.value as string | null) ?? ""} onCommit={(text) => onValue(text || null)} />;
    case "list":
      return <ListEditor items={(row.value as string[] | null) ?? []} onChange={onValue} onSearch={onSearch} />;
    default:
      return <TextValue value={(row.value as string | null) ?? ""} onCommit={(text) => onValue(text === "" ? null : text)} />;
  }
}

/** An input that writes on blur or Enter, never mid-composition. */
function CommitInput({ type, value, onCommit }: { type: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="propertyInput"
      data-dirty={draft !== value}
      type={type}
      step={type === "number" ? "any" : undefined}
      value={draft}
      placeholder="空"
      onChange={(event) => {
        setDraft(event.target.value);
        // Pickers have no typing; their changes are final.
        if (type === "date" || type === "datetime-local") onCommit(event.target.value);
      }}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (draft !== value) onCommit(draft);
        }
      }}
    />
  );
}

/** One-line text that wraps instead of being cut off. */
function TextValue({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => setDraft(value), [value]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight + 2}px`;
    };
    fit();
    // The wrapped height also changes when the pane is resized.
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === lastWidth) return;
      lastWidth = element.clientWidth;
      fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft]);
  return (
    <textarea
      ref={ref}
      className="propertyInput propertyText"
      data-dirty={draft !== value}
      rows={1}
      value={draft}
      placeholder="空"
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value.replace(/\r?\n/g, ""))}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (draft !== value) onCommit(draft);
        }
      }}
    />
  );
}

function ListEditor({
  items,
  onChange,
  onSearch,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  onSearch?: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onChange([...items, text]);
  };
  return (
    <div className="propertyChips">
      {items.map((item, index) => (
        <span className="propertyChip" key={`${index}-${item}`}>
          {onSearch ? (
            <button type="button" className="propertyChipText" title={`「${item}」で検索`} onClick={() => onSearch(item)}>
              {item}
            </button>
          ) : (
            <span>{item}</span>
          )}
          <button
            type="button"
            aria-label={`${item}を削除`}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="propertyChipInput"
        data-dirty={draft !== ""}
        value={draft}
        placeholder={items.length ? "" : "空"}
        aria-label="項目を追加"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && !draft && items.length) {
            onChange(items.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

function AddRow({
  existingKeys,
  typeSettings,
  onAdd,
  onCancel,
}: {
  existingKeys: Set<string>;
  typeSettings: PropertyTypeSettings;
  onAdd: (key: string, type: PropertyType) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [active, setActive] = useState(0);
  const trimmed = name.trim();
  const suggestions = Object.entries(typeSettings)
    .filter(([key]) => !existingKeys.has(key) && key.toLowerCase().includes(trimmed.toLowerCase()))
    .slice(0, 8);
  const duplicate = existingKeys.has(trimmed);
  const type: PropertyType = typeSettings[trimmed] ?? "text";

  const finish = (key: string) => {
    const next = key.trim();
    if (!next) return onCancel();
    if (existingKeys.has(next)) return;
    onAdd(next, typeSettings[next] ?? "text");
  };

  return (
    <div className="propertyRow adding">
      <div className="propertyTypeCell">
        <span className="propertyTypeButton" aria-hidden="true">
          <TypeIcon type={type} />
        </span>
      </div>
      <div className="propertyAddName">
        <input
          className={`propertyKey${duplicate ? " invalid" : ""}`}
          data-dirty="true"
          autoFocus
          value={name}
          placeholder="名前"
          spellCheck={false}
          aria-label="新しいプロパティ名"
          aria-invalid={duplicate}
          title={duplicate ? "同じ名前のプロパティがあります" : undefined}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          onChange={(event) => {
            setName(event.target.value);
            setActive(0);
          }}
          onBlur={(event) => {
            if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
            if (!trimmed) onCancel();
            else if (!duplicate) finish(name);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setActive((active + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setActive((active - 1 + suggestions.length) % suggestions.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const picked = suggestions[active]?.[0];
              finish(picked && !typeSettings[trimmed] && trimmed !== picked && suggestions.length ? picked : name);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        {suggestions.length > 0 && (
          <div className="propertySuggestions" role="listbox">
            {suggestions.map(([key, suggestedType], index) => (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => finish(key)}
              >
                <TypeIcon type={suggestedType} />
                <span>{key}</span>
                <small>{TYPE_LABEL[suggestedType]}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
