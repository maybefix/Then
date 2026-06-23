import type { ChangeEvent, DragEvent } from "react";
import type { Snippet } from "../../types";

type IdeaPaneProps = {
  snippets: Snippet[];
  query: string;
  draggingId: string | null;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
  onTextChange: (snippetId: string, text: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, snippet: Snippet) => void;
  onDragEnd: () => void;
  onDoubleClick: (snippet: Snippet) => void;
  onMove: (snippetId: string, direction: -1 | 1) => void;
  onDelete: (snippet: Snippet) => void;
};

function parseInlineTags(text: string): string[] {
  const tags = new Set<string>();
  const matches = text.matchAll(/(?:^|\s)#([^\s#.,;:!?()[\]{}「」『』、。]+)/g);
  for (const match of matches) {
    const tag = match[1]?.trim();
    if (tag) tags.add(tag);
  }
  return Array.from(tags);
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="7.25" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6 18 20H6L5 6" />
    </svg>
  );
}

export function IdeaPane({
  snippets,
  query,
  draggingId,
  onQueryChange,
  onCreate,
  onTextChange,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  onMove,
  onDelete,
}: IdeaPaneProps) {
  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(event.target.value);
  };

  return (
    <section className="ideaPane" aria-label="Idea">
      <label className="ideaSearch">
        <SearchIcon />
        <input
          value={query}
          onChange={handleQueryChange}
          placeholder="Ideaを検索..."
          type="search"
        />
      </label>

      <div className="ideaList">
        {snippets.map((snippet, index) => {
          const inlineTags = parseInlineTags(snippet.text);
          const allTags = Array.from(new Set([...snippet.tags, ...inlineTags]));

          return (
            <div
              className={`ideaCard ${draggingId === snippet.id ? "draggingIdeaCard" : ""}`}
              draggable
              key={snippet.id}
              onDragStart={(event) => onDragStart(event, snippet)}
              onDragEnd={onDragEnd}
              onDoubleClick={() => onDoubleClick(snippet)}
              title="ダブルクリックで挿入"
            >
              <div className="ideaTools" aria-label="Ideaの操作">
                <button
                  type="button"
                  aria-label="上へ"
                  disabled={index === 0}
                  onClick={() => onMove(snippet.id, -1)}
                >
                  <ArrowUpIcon />
                </button>
                <button
                  type="button"
                  aria-label="下へ"
                  disabled={index === snippets.length - 1}
                  onClick={() => onMove(snippet.id, 1)}
                >
                  <ArrowDownIcon />
                </button>
                <button type="button" aria-label="削除" onClick={() => onDelete(snippet)}>
                  <TrashIcon />
                </button>
              </div>
              <div
                className="ideaText"
                contentEditable
                data-placeholder="Idea..."
                spellCheck={false}
                onBlur={(event) =>
                  onTextChange(snippet.id, event.currentTarget.textContent ?? "")
                }
                suppressContentEditableWarning
              >
                {snippet.text}
              </div>
              {allTags.length > 0 && (
                <div className="ideaTagList" aria-label="タグ">
                  {allTags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      </div>

      <button className="ideaAdd" type="button" onClick={onCreate}>
        <PlusIcon />
        <span>アイデアを追加</span>
      </button>
    </section>
  );
}
