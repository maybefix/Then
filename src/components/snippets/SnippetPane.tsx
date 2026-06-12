import type { ChangeEvent, DragEvent } from "react";
import type { Snippet } from "../../types";
import { SnippetCard } from "./SnippetCard";

type SnippetPaneProps = {
  snippets: Snippet[];
  query: string;
  draggingId: string | null;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, snippet: Snippet) => void;
  onDragEnd: () => void;
  onDoubleClick: (snippet: Snippet) => void;
  onMove: (snippetId: string, direction: -1 | 1) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
};

export function SnippetPane({
  snippets,
  query,
  draggingId,
  onQueryChange,
  onCreate,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  onMove,
  onEdit,
  onDelete,
}: SnippetPaneProps) {
  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(event.target.value);
  };

  return (
    <aside className="snippetPanel" aria-label="スニペット">
      <div className="panelHeader">
        <h2>スニペット</h2>
        <span className="panelCount">{snippets.length}</span>
        <button
          className="addButton"
          type="button"
          aria-label="スニペットを追加"
          onClick={onCreate}
        >
          +
        </button>
      </div>

      <div className="panelSearch">
        <label className="searchBox">
          <svg
            className="searchIcon"
            aria-hidden="true"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <circle cx="10.5" cy="10.5" r="7.25" />
            <path d="m16 16 5 5" />
          </svg>
          <input
            value={query}
            onChange={handleQueryChange}
            placeholder="スニペットを検索..."
            type="search"
          />
        </label>
      </div>

      <div className="snippetList">
        {snippets.map((snippet) => (
          <SnippetCard
            key={snippet.id}
            snippet={snippet}
            isDragging={draggingId === snippet.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDoubleClick={onDoubleClick}
            onMove={onMove}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </aside>
  );
}
