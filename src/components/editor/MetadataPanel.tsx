import type { ChangeEvent } from "react";

type MetadataPanelProps = {
  metadata: string;
  hasFrontMatter: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onAddProperty: () => void;
  onClear: () => void;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

export function MetadataPanel({
  metadata,
  hasFrontMatter,
  isOpen,
  onToggle,
  onAddProperty,
  onClear,
  onChange,
}: MetadataPanelProps) {
  const metadataCount = metadata.trim()
    ? `${metadata.split(/\r?\n/).filter(Boolean).length}件`
    : "空";

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
        <textarea
          className="metadataEditor"
          value={metadata}
          placeholder="title:&#10;tags: []"
          spellCheck={false}
          onChange={onChange}
        />
      )}
    </section>
  );
}
