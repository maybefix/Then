import { invoke } from "@tauri-apps/api/core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { REFERENCE_FILE_DRAG_MIME } from "../../canvasTypes";
import type {
  ReferenceBinary,
  ReferenceCardState,
  ReferenceFileInfo,
  ReferenceKind,
  ReferenceScope,
} from "../../types";

type ReferenceScopeFilter = "all" | ReferenceScope;
type ReferenceKindFilter = "all" | ReferenceKind;
type ReferenceTopMenu = "add" | "create" | null;
type ReferenceLibraryMenu = { key: string; top: number; right: number } | null;

type ReferencePaneProps = {
  rootPath: string | null;
  cards: ReferenceCardState[];
  candidates: ReferenceFileInfo[];
  query: string;
  onQueryChange: (query: string) => void;
  onAddReference: (scope: ReferenceScope) => void;
  onCreateReference: (scope: ReferenceScope) => void;
  onOpenReference: (file: ReferenceFileInfo) => void;
  onFocusReference: (cardId: string) => void;
  onCloseReference: (cardId: string) => void;
  onPinReference: (cardId: string, pinned: boolean) => void;
  onCopyReference: (file: ReferenceFileInfo, targetScope: ReferenceScope) => void;
  onMoveReference: (file: ReferenceFileInfo, targetScope: ReferenceScope) => void;
  onDeleteImportedReference: (file: ReferenceFileInfo) => void;
};

const scopeLabel = (scope: ReferenceScope) => (scope === "global" ? "共通" : "作品");

const kindLabel = (kind: ReferenceKind) => {
  switch (kind) {
    case "text":
      return "text";
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

const fileNameFromPath = (sourcePath: string) =>
  sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;

const binaryDataUrl = (binary: ReferenceBinary) => `data:${binary.mime};base64,${binary.dataBase64}`;

const base64ToUint8Array = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const referenceKey = (file: Pick<ReferenceFileInfo, "scope" | "sourcePath">) =>
  `${file.scope}:${file.sourcePath.replace(/[\\]+/g, "/").toLocaleLowerCase()}`;

const startReferenceFileDrag = (event: DragEvent<HTMLElement>, file: ReferenceFileInfo) => {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(REFERENCE_FILE_DRAG_MIME, JSON.stringify(file));
  event.dataTransfer.setData("text/plain", file.name);
};

function fileInfoFromCard(
  card: ReferenceCardState,
  candidatesByKey: Map<string, ReferenceFileInfo>,
): ReferenceFileInfo {
  return (
    candidatesByKey.get(referenceKey(card)) ?? {
      scope: card.scope,
      sourcePath: card.sourcePath,
      name: fileNameFromPath(card.sourcePath),
      kind: card.kind,
      size: 0,
      imported: false,
    }
  );
}

function ReferenceKindIcon({ kind }: { kind: ReferenceKind }) {
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

function IconButton({
  label,
  active = false,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`referenceActionButton ${active ? "activeReferenceIconButton" : ""} ${
        danger ? "dangerReferenceButton" : ""
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

const pinIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="M14 4l6 6" />
    <path d="M9 14 4 19" />
    <path d="m7 12 5-5 5 5-5 5-5-5Z" />
  </svg>
);

const closeIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </svg>
);

const focusIcon = (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
    <path d="M8 4H5a1 1 0 0 0-1 1v3" />
    <path d="M16 4h3a1 1 0 0 1 1 1v3" />
    <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
    <path d="M16 20h3a1 1 0 0 0 1-1v-3" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

function ScopeBadge({ scope }: { scope: ReferenceScope }) {
  return <span className={`referenceBadge referenceScope-${scope}`}>{scopeLabel(scope)}</span>;
}

function ReferenceOpenPreview({
  rootPath,
  file,
}: {
  rootPath: string | null;
  file: ReferenceFileInfo;
}) {
  if (file.kind === "image") return <ReferenceImageThumbnail rootPath={rootPath} file={file} />;
  if (file.kind === "pdf") return <ReferencePdfThumbnail rootPath={rootPath} file={file} />;
  if (file.kind === "markdown" || file.kind === "text") {
    return <ReferenceTextThumbnail rootPath={rootPath} file={file} />;
  }
  return (
    <div className="referenceOpenPreview" aria-hidden="true">
      <ReferenceKindIcon kind={file.kind} />
    </div>
  );
}

function ReferenceImageThumbnail({
  rootPath,
  file,
}: {
  rootPath: string | null;
  file: ReferenceFileInfo;
}) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSrc("");
    invoke<ReferenceBinary>("read_reference_binary", {
      rootPath,
      sourcePath: file.sourcePath,
      scope: file.scope,
    })
      .then((binary) => {
        if (!cancelled) setSrc(binaryDataUrl(binary));
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [file.scope, file.sourcePath, rootPath]);

  return (
    <div className="referenceOpenPreview referenceImageThumb" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <ReferenceKindIcon kind="image" />}
    </div>
  );
}

function ReferencePdfThumbnail({
  rootPath,
  file,
}: {
  rootPath: string | null;
  file: ReferenceFileInfo;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPageCount(0);
    setFailed(false);
    const loadPdf = async (): Promise<PDFDocumentProxy> => {
      const [binary, pdfjs] = await Promise.all([
        invoke<ReferenceBinary>("read_reference_binary", {
          rootPath,
          sourcePath: file.sourcePath,
          scope: file.scope,
        }),
        import("pdfjs-dist"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return await pdfjs.getDocument({ data: base64ToUint8Array(binary.dataBase64) }).promise;
    };

    loadPdf()
      .then(async (pdf) => {
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(1);
        if (cancelled) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const viewport = page.getViewport({ scale: 0.18 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [file.scope, file.sourcePath, rootPath]);

  return (
    <div className="referenceOpenPreview referencePdfThumb" aria-hidden="true">
      {failed ? <ReferenceKindIcon kind="pdf" /> : <canvas ref={canvasRef} />}
      <span>1/{pageCount || "-"}</span>
    </div>
  );
}

function ReferenceTextThumbnail({
  rootPath,
  file,
}: {
  rootPath: string | null;
  file: ReferenceFileInfo;
}) {
  const [snippet, setSnippet] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSnippet("");
    invoke<string>("read_reference_text", {
      rootPath,
      sourcePath: file.sourcePath,
      scope: file.scope,
    })
      .then((text) => {
        if (cancelled) return;
        const compact = text
          .replace(/^---[\s\S]*?---\s*/m, "")
          .replace(/[#>*_`~\-[\]()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        setSnippet(compact.slice(0, 42));
      })
      .catch(() => {
        if (!cancelled) setSnippet("");
      });
    return () => {
      cancelled = true;
    };
  }, [file.scope, file.sourcePath, rootPath]);

  return (
    <div className="referenceOpenPreview referenceTextThumb" aria-hidden="true">
      <ReferenceKindIcon kind={file.kind} />
      {snippet && <p>{snippet}</p>}
    </div>
  );
}

function ReferenceMenu({
  file,
  onCopyReference,
  onMoveReference,
  onDeleteImportedReference,
  onClose,
  className = "",
  style,
}: {
  file: ReferenceFileInfo;
  onCopyReference: (file: ReferenceFileInfo, targetScope: ReferenceScope) => void;
  onMoveReference: (file: ReferenceFileInfo, targetScope: ReferenceScope) => void;
  onDeleteImportedReference: (file: ReferenceFileInfo) => void;
  onClose?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const targetScope: ReferenceScope = file.scope === "project" ? "global" : "project";
  const runMenuAction = (action: () => void) => {
    onClose?.();
    action();
  };
  return (
    <div className={`referenceContextMenu ${className}`.trim()} role="menu" style={style}>
      <button
        type="button"
        role="menuitem"
        onClick={() => runMenuAction(() => onCopyReference(file, "global"))}
      >
        共通へコピー
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => runMenuAction(() => onCopyReference(file, "project"))}
      >
        この作品へコピー
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => runMenuAction(() => onMoveReference(file, targetScope))}
      >
        移転
      </button>
      <button
        type="button"
        role="menuitem"
        className="dangerMenuItem"
        disabled={!file.imported}
        onClick={() => runMenuAction(() => onDeleteImportedReference(file))}
      >
        削除
      </button>
    </div>
  );
}

export function ReferencePane({
  rootPath,
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
  onCopyReference,
  onMoveReference,
  onDeleteImportedReference,
}: ReferencePaneProps) {
  const [scopeFilter, setScopeFilter] = useState<ReferenceScopeFilter>("all");
  const [kindFilter, setKindFilter] = useState<ReferenceKindFilter>("all");
  const [topMenu, setTopMenu] = useState<ReferenceTopMenu>(null);
  const [libraryMenu, setLibraryMenu] = useState<ReferenceLibraryMenu>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const candidatesByKey = useMemo(
    () => new Map(candidates.map((file) => [referenceKey(file), file])),
    [candidates],
  );
  const openKeys = useMemo(() => new Set(cards.map((card) => referenceKey(card))), [cards]);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleCandidates = useMemo(
    () =>
      candidates
        .filter((file) => !openKeys.has(referenceKey(file)))
        .filter((file) => scopeFilter === "all" || file.scope === scopeFilter)
        .filter((file) => kindFilter === "all" || file.kind === kindFilter)
        .filter((file) =>
          normalizedQuery
            ? `${file.name}\n${file.sourcePath}\n${scopeLabel(file.scope)} ${kindLabel(file.kind)}`
                .toLocaleLowerCase()
                .includes(normalizedQuery)
            : true,
        )
        .slice(0, 12),
    [candidates, kindFilter, normalizedQuery, openKeys, scopeFilter],
  );
  const menuPortalRoot = paneRef.current?.closest(".appShell") ?? document.body;

  useEffect(() => {
    setLibraryMenu(null);
  }, [kindFilter, query, scopeFilter]);

  const toggleLibraryMenu = (key: string, button: HTMLButtonElement) => {
    setLibraryMenu((current) => {
      if (current?.key === key) return null;
      const rect = button.getBoundingClientRect();
      const estimatedMenuHeight = 132;
      const viewportPadding = 8;
      const top =
        window.innerHeight - rect.bottom < estimatedMenuHeight && rect.top > estimatedMenuHeight
          ? rect.top - estimatedMenuHeight - 4
          : rect.bottom + 4;
      const boundedTop = Math.min(window.innerHeight - estimatedMenuHeight - viewportPadding, top);
      return {
        key,
        top: Math.max(viewportPadding, boundedTop),
        right: Math.max(viewportPadding, window.innerWidth - rect.right),
      };
    });
  };

  return (
    <section className="referencePane" aria-label="資料" ref={paneRef}>
      <div className="referencePaneTop referenceScopeTop">
        <div className="referenceScopeTabs" aria-label="資料の表示範囲">
          {[
            ["all", "すべて"],
            ["project", "作品"],
            ["global", "共通"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={scopeFilter === value ? "isActive" : ""}
              onClick={() => setScopeFilter(value as ReferenceScopeFilter)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="referenceTopActions">
          <button
            className={`referenceTopAddButton ${topMenu === "add" ? "isActive" : ""}`}
            type="button"
            aria-label="既存ファイルを資料に追加"
            title="既存ファイルを資料に追加"
            onClick={() => setTopMenu((menu) => (menu === "add" ? null : "add"))}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <path d="M3.5 7.5h6l1.8 2h9.2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />
              <path d="M12 12.5v5" />
              <path d="M9.5 15h5" />
            </svg>
          </button>
          <button
            className={`referenceTopAddButton ${topMenu === "create" ? "isActive" : ""}`}
            type="button"
            aria-label="新規資料を作成"
            title="新規資料を作成"
            onClick={() => setTopMenu((menu) => (menu === "create" ? null : "create"))}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <path d="M7 3.5h7l3 3V20H7V3.5Z" />
              <path d="M14 3.5V7h3.5" />
              <path d="M12 11v5" />
              <path d="M9.5 13.5h5" />
            </svg>
          </button>
          {topMenu === "add" && (
            <div className="referenceContextMenu referenceTopMenu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTopMenu(null);
                  onAddReference("project");
                }}
              >
                作品へ追加
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTopMenu(null);
                  onAddReference("global");
                }}
              >
                共通へ追加
              </button>
            </div>
          )}
          {topMenu === "create" && (
            <div className="referenceContextMenu referenceTopMenu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTopMenu(null);
                  onCreateReference("project");
                }}
              >
                作品に作成
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTopMenu(null);
                  onCreateReference("global");
                }}
              >
                共通に作成
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="referencePaneTop">
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
        <div className="referenceKindFilters" aria-label="資料の種類">
          {[
            ["all", "すべて"],
            ["image", "画像"],
            ["pdf", "PDF"],
            ["markdown", "MD"],
            ["text", "Text"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={kindFilter === value ? "isActive" : ""}
              onClick={() => setKindFilter(value as ReferenceKindFilter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="referencePaneSection">
        <div className="referenceSectionHeader">
          <span>開いている資料</span>
          <span>{cards.length}</span>
        </div>
        <div className="referenceOpenCardList">
          {cards.length === 0 ? (
            <p className="referenceEmpty">開いている資料はありません</p>
          ) : (
            cards.map((card) => {
              const file = fileInfoFromCard(card, candidatesByKey);
              return (
                <article
                  className="referenceOpenCard"
                  key={card.id}
                  draggable
                  onDragStart={(event) => startReferenceFileDrag(event, file)}
                >
                  <ReferenceOpenPreview rootPath={rootPath} file={file} />
                  <div className="referenceOpenMain">
                    <strong>{fileNameFromPath(card.sourcePath)}</strong>
                    <div className="referenceBadgeRow">
                      <ScopeBadge scope={card.scope} />
                    </div>
                    {card.scope === "project" && (
                      <small>共通ボードではコピーして追加</small>
                    )}
                  </div>
                  <div className="referenceOpenActions">
                    <IconButton label="フォーカス" onClick={() => onFocusReference(card.id)}>
                      {focusIcon}
                    </IconButton>
                    <IconButton
                      label={card.pinned ? "ピン留め解除" : "ピン留め"}
                      active={card.pinned}
                      onClick={() => onPinReference(card.id, !card.pinned)}
                    >
                      {pinIcon}
                    </IconButton>
                    <IconButton label="閉じる" onClick={() => onCloseReference(card.id)}>
                      {closeIcon}
                    </IconButton>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <div className="referencePaneSection referenceCandidatesSection">
        <div className="referenceSectionHeader">
          <span>ライブラリ</span>
          <span>{visibleCandidates.length}</span>
        </div>
        <div className="referenceList">
          {visibleCandidates.length === 0 ? (
            <p className="referenceEmpty">候補はありません</p>
          ) : (
            visibleCandidates.map((file) => {
              const key = referenceKey(file);
              return (
                <article
                  className="referenceRow"
                  key={key}
                  draggable
                  onDragStart={(event) => startReferenceFileDrag(event, file)}
                >
                  <ReferenceKindIcon kind={file.kind} />
                  <button
                    className="referenceRowMain referenceRowOpenButton"
                    type="button"
                    title={file.sourcePath}
                    onClick={() => onOpenReference(file)}
                  >
                    <strong>{file.name}</strong>
                    <span>{file.sourcePath}</span>
                  </button>
                  <div className="referenceBadgeRow">
                    <ScopeBadge scope={file.scope} />
                  </div>
                  <div className="referenceRowActions referenceMenuHost">
                    <button
                      className="referenceActionButton"
                      type="button"
                      aria-label="資料操作"
                      title="資料操作"
                      onClick={(event) => toggleLibraryMenu(key, event.currentTarget)}
                    >
                      ︙
                    </button>
                    {libraryMenu?.key === key &&
                      createPortal(
                        <ReferenceMenu
                          file={file}
                          className="referenceFloatingMenu"
                          style={{ position: "fixed", top: libraryMenu.top, right: libraryMenu.right }}
                          onClose={() => setLibraryMenu(null)}
                          onCopyReference={onCopyReference}
                          onMoveReference={onMoveReference}
                          onDeleteImportedReference={onDeleteImportedReference}
                        />,
                        menuPortalRoot,
                      )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
