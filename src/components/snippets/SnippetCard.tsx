import type { DragEvent } from "react";
import type { Snippet } from "../../types";

type SnippetCardProps = {
  snippet: Snippet;
  isDragging: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>, snippet: Snippet) => void;
  onDragEnd: () => void;
  onDoubleClick: (snippet: Snippet) => void;
  onMove: (snippetId: string, direction: -1 | 1) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
};

function getTextLength(text: string): number {
  return Array.from(text).length;
}

export function SnippetCard({
  snippet,
  isDragging,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  onMove,
  onEdit,
  onDelete,
}: SnippetCardProps) {
  return (
    <div
      className={`snippetCard ${isDragging ? "dragging" : ""}`}
      draggable
      onDragStart={(event) => onDragStart(event, snippet)}
      onDragEnd={onDragEnd}
      onDoubleClick={() => onDoubleClick(snippet)}
      title="ダブルクリックで挿入"
    >
      <div className="snippetCardHeader">
        <div className="snippetTitle">{snippet.title}</div>
        <div className="snippetTools">
          <button type="button" aria-label="上へ" onClick={() => onMove(snippet.id, -1)}>
            ↑
          </button>
          <button type="button" aria-label="下へ" onClick={() => onMove(snippet.id, 1)}>
            ↓
          </button>
          <button type="button" aria-label="編集" onClick={() => onEdit(snippet)}>
            ✎
          </button>
          <button type="button" aria-label="削除" onClick={() => onDelete(snippet)}>
            ×
          </button>
        </div>
      </div>
      <div className="snippetPreview">{snippet.text}</div>
      <div className="snippetMeta">
        <span>{getTextLength(snippet.text)}文字</span>
        {snippet.category && <span>{snippet.category}</span>}
        {snippet.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>
    </div>
  );
}
