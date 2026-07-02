import type { ReactNode } from "react";
import type { ReferenceCardState, ReferenceFileInfo } from "../../types";

type ReferencePaneProps = {
  cards: ReferenceCardState[];
  candidates: ReferenceFileInfo[];
  query: string;
  onQueryChange: (query: string) => void;
  onAddReference: () => void;
  onCreateReference: () => void;
  onOpenReference: (sourcePath: string) => void;
  onFocusReference: (cardId: string) => void;
  onCloseReference: (cardId: string) => void;
  onPinReference: (cardId: string, pinned: boolean) => void;
  onDeleteImportedReference: (sourcePath: string) => void;
};

const kindLabel = (kind: ReferenceFileInfo["kind"]) => {
  switch (kind) {
    case "text":
      return "txt";
    case "markdown":
      return "md";
    case "image":
      return "image";
    case "pdf":
      return "pdf";
    default:
      return "file";
  }
};

const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const fileNameFromPath = (sourcePath: string) =>
  sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;

function ReferenceKindIcon({ kind }: { kind: string }) {
  return (
    <span className={`referenceKindIcon referenceKind-${kind}`} aria-hidden="true">
      {kind === "image" ? (
        <svg viewBox="0 0 24 24">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="m7 16 3.5-4 3 3 2-2.5L18 16" />
          <circle cx="9" cy="9" r="1.2" />
        </svg>
      ) : kind === "pdf" ? (
        <svg viewBox="0 0 24 24">
          <path d="M7 3.5h7l3 3V20H7V3.5Z" />
          <path d="M14 3.5V7h3.5" />
          <path d="M8.5 14h7" />
          <path d="M8.5 17h5" />
        </svg>
      ) : kind === "markdown" ? (
        <svg viewBox="0 0 24 24">
          <rect x="4" y="6" width="16" height="12" rx="2" />
          <path d="M7 15V9l3 3 3-3v6" />
          <path d="M15.5 10.5 18 13l-2.5 2.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <path d="M7 3.5h10V20H7V3.5Z" />
          <path d="M9.5 8h5" />
          <path d="M9.5 11h5" />
          <path d="M9.5 14h4" />
        </svg>
      )}
    </span>
  );
}

function ReferenceActionButton({
  label,
  danger = false,
  active = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`referenceActionButton ${danger ? "dangerReferenceButton" : ""} ${
        active ? "activeReferenceIconButton" : ""
      }`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const focusIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="M8 4H5a1 1 0 0 0-1 1v3" />
    <path d="M16 4h3a1 1 0 0 1 1 1v3" />
    <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
    <path d="M16 20h3a1 1 0 0 0 1-1v-3" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const closeIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </svg>
);

const deleteIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="M4 7h16" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M6 7l1 14h10l1-14" />
    <path d="M9 7V4h6v3" />
  </svg>
);

const pinIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="M14 4l6 6" />
    <path d="M9 14 4 19" />
    <path d="m7 12 5-5 5 5-5 5-5-5Z" />
  </svg>
);

const openIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="M7 17 17 7" />
    <path d="M9 7h8v8" />
  </svg>
);

export function ReferencePane({
  cards,
  candidates,
  query,
  onQueryChange,
  onAddReference,
  onCreateReference,
  onOpenReference,
  onFocusReference,
  onCloseReference,
  onPinReference,
  onDeleteImportedReference,
}: ReferencePaneProps) {
  const infoByPath = new Map(candidates.map((file) => [file.sourcePath, file]));
  const openPaths = new Set(cards.map((card) => card.sourcePath));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredCandidates = candidates
    .filter((file) => !openPaths.has(file.sourcePath))
    .filter((file) =>
      normalizedQuery
        ? `${file.name}\n${file.sourcePath}`.toLocaleLowerCase().includes(normalizedQuery)
        : true,
    )
    .slice(0, 8);

  return (
    <section className="referencePane" aria-label="資料">
      <div className="referencePaneTop">
        <div className="referenceSearchRow">
          <label className="referenceSearch">
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
            <input
              value={query}
              placeholder="資料を検索"
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
          <button
            className="referenceTopAddButton"
            type="button"
            aria-label="資料を新規作成"
            title="資料を新規作成"
            onClick={onCreateReference}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <path d="M7 3.5h8l3 3V20H7V3.5Z" />
              <path d="M15 3.5V7h3" />
              <path d="M12.5 11v5" />
              <path d="M10 13.5h5" />
            </svg>
          </button>
          <button
            className="referenceTopAddButton"
            type="button"
            aria-label="既存ファイルを資料に追加"
            title="既存ファイルを資料に追加"
            onClick={onAddReference}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="referencePaneSection">
        <div className="referenceSectionHeader">
          <span>表示中の資料</span>
          <span>{cards.length}</span>
        </div>
        <div className="referenceList">
          {cards.length === 0 ? (
            <p className="referenceEmpty">開いている資料はありません</p>
          ) : (
            cards.map((card) => (
              <article className="referenceRow" key={card.id}>
                <ReferenceKindIcon kind={card.kind} />
                <div className="referenceRowMain">
                  <strong>{fileNameFromPath(card.sourcePath)}</strong>
                  <span>{card.kind}</span>
                </div>
                <div className="referenceRowActions">
                  <ReferenceActionButton label="フォーカス" onClick={() => onFocusReference(card.id)}>
                    {focusIcon}
                  </ReferenceActionButton>
                  <ReferenceActionButton label="閉じる" onClick={() => onCloseReference(card.id)}>
                    {closeIcon}
                  </ReferenceActionButton>
                  {infoByPath.get(card.sourcePath)?.imported && (
                    <ReferenceActionButton
                      label="削除"
                      danger
                      onClick={() => onDeleteImportedReference(card.sourcePath)}
                    >
                      {deleteIcon}
                    </ReferenceActionButton>
                  )}
                  <ReferenceActionButton
                    label={card.pinned ? "ピン留め解除" : "ピン留め"}
                    active={card.pinned}
                    onClick={() => onPinReference(card.id, !card.pinned)}
                  >
                    {pinIcon}
                  </ReferenceActionButton>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="referencePaneSection referenceCandidatesSection">
        <div className="referenceSectionHeader">
          <span>{query.trim() ? "検索結果" : "最近使った資料 / 候補"}</span>
          <span>{filteredCandidates.length}</span>
        </div>
        <div className="referenceList">
          {filteredCandidates.length === 0 ? (
            <p className="referenceEmpty">候補はありません</p>
          ) : (
            filteredCandidates.map((file) => (
              <article className="referenceRow" key={file.sourcePath}>
                <ReferenceKindIcon kind={file.kind} />
                <div className="referenceRowMain">
                  <strong>{file.name}</strong>
                  <span>
                    {kindLabel(file.kind)}
                    {formatBytes(file.size) ? ` · ${formatBytes(file.size)}` : ""}
                  </span>
                </div>
                <div className="referenceRowActions">
                  <ReferenceActionButton label="開く" onClick={() => onOpenReference(file.sourcePath)}>
                    {openIcon}
                  </ReferenceActionButton>
                  {file.imported && (
                    <ReferenceActionButton
                      label="削除"
                      danger
                      onClick={() => onDeleteImportedReference(file.sourcePath)}
                    >
                      {deleteIcon}
                    </ReferenceActionButton>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </div>

    </section>
  );
}
