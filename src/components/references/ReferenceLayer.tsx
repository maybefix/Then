import { invoke } from "@tauri-apps/api/core";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BinderCardState,
  BinderCardFrame,
  IdeaBinderCardState,
  IdeaFragment,
  IdeaThread,
  ReferenceBinary,
  ReferenceCardState,
  ReferenceKind,
  ReferenceLayout,
  ReferenceScope,
} from "../../types";
import { isIdeaBinderCard } from "../../types";
import { binaryDataUrl, MarkdownLite } from "../markdown/MarkdownLite";

type ReferenceLayerProps = {
  rootPath: string | null;
  layout: ReferenceLayout;
  onLayoutChange: (updater: (layout: ReferenceLayout) => ReferenceLayout) => void;
  onReturnFocusToEditor: () => void;
  onTextSaved: (sourcePath: string, scope: ReferenceScope, text: string) => void;
  ideaThreads: IdeaThread[];
  onUpdateIdeaFragment: (threadId: string, fragmentId: string, body: string) => void;
};

type ReferenceCardProps = {
  rootPath: string;
  card: BinderCardState;
  isFocused: boolean;
  onPatch: (patch: BinderCardPatch) => void;
  onClose: () => void;
  onBringToFront: () => void;
  onTextSaved: (sourcePath: string, scope: ReferenceScope, text: string) => void;
  ideaThread?: IdeaThread;
  ideaFragment?: IdeaFragment;
  onUpdateIdeaFragment: (threadId: string, fragmentId: string, body: string) => void;
};

type BinderCardPatch = Partial<BinderCardFrame> & {
  scrollTop?: number;
  zoom?: number;
  page?: number;
  editing?: boolean;
};

type DragMode =
  | { kind: "move"; startX: number; startY: number; original: BinderCardState }
  | { kind: "resize"; startX: number; startY: number; original: BinderCardState };

const MIN_CARD_WIDTH = 220;
const MIN_CARD_HEIGHT = 140;
const PINNED_REFERENCE_Z_BASE = 10000;
const NORMAL_REFERENCE_Z_LIMIT = PINNED_REFERENCE_Z_BASE - 1;

const fileNameFromPath = (sourcePath: string) =>
  sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;

const isTextualReference = (kind: ReferenceKind) => kind === "text" || kind === "markdown";


const base64ToUint8Array = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const renderPdfPageAtDisplayScale = (
  pdfPage: PDFPageProxy,
  canvas: HTMLCanvasElement,
  displayScale: number,
) => {
  const viewport = pdfPage.getViewport({ scale: displayScale });
  const outputScale = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  const context = canvas.getContext("2d");
  if (!context) return null;
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = "auto";
  return pdfPage.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  });
};

function patchCard(
  layout: ReferenceLayout,
  cardId: string,
  patch: BinderCardPatch,
): ReferenceLayout {
  return {
    ...layout,
    cards: layout.cards.map((card) =>
      card.id === cardId ? ({ ...card, ...patch } as BinderCardState) : card,
    ),
  };
}

function removeCard(layout: ReferenceLayout, cardId: string): ReferenceLayout {
  return {
    ...layout,
    cards: layout.cards.filter((card) => card.id !== cardId),
  };
}

function bringCardToFront(layout: ReferenceLayout, cardId: string): ReferenceLayout {
  const target = layout.cards.find((card) => card.id === cardId);
  if (!target) return layout;
  const maxZ = layout.cards
    .filter((card) => (target.pinned ? card.pinned : !card.pinned))
    .reduce((max, card) => Math.max(max, card.zIndex), target.pinned ? PINNED_REFERENCE_Z_BASE : 0);
  return patchCard(layout, cardId, {
    zIndex: target.pinned ? Math.max(PINNED_REFERENCE_Z_BASE, maxZ + 1) : Math.min(NORMAL_REFERENCE_Z_LIMIT, maxZ + 1),
  });
}

export function ReferenceLayer({
  rootPath,
  layout,
  onLayoutChange,
  onReturnFocusToEditor,
  onTextSaved,
  ideaThreads,
  onUpdateIdeaFragment,
}: ReferenceLayerProps) {
  const maxZ = useMemo(
    () => layout.cards.reduce((max, card) => Math.max(max, card.zIndex), 0),
    [layout.cards],
  );
  const visibleCards = rootPath
    ? layout.cards
    : layout.cards.filter(isIdeaBinderCard);

  if (visibleCards.length === 0) return null;

  return (
    <div className="referenceLayer" aria-label="バインダーカードレイヤー" onDoubleClick={onReturnFocusToEditor}>
      {visibleCards.map((card) => (
        <BinderCard
          key={card.id}
          rootPath={rootPath ?? ""}
          card={card}
          isFocused={card.zIndex === maxZ}
          onPatch={(patch) => onLayoutChange((current) => patchCard(current, card.id, patch))}
          onClose={() => onLayoutChange((current) => removeCard(current, card.id))}
          onBringToFront={() => onLayoutChange((current) => bringCardToFront(current, card.id))}
          onTextSaved={onTextSaved}
          ideaThread={
            isIdeaBinderCard(card)
              ? ideaThreads.find((thread) => thread.id === card.threadId)
              : undefined
          }
          ideaFragment={
            isIdeaBinderCard(card)
              ? ideaThreads
                  .find((thread) => thread.id === card.threadId)
                  ?.fragments.find((fragment) => fragment.id === card.fragmentId)
              : undefined
          }
          onUpdateIdeaFragment={onUpdateIdeaFragment}
        />
      ))}
    </div>
  );
}

function BinderCard({
  rootPath,
  card,
  isFocused,
  onPatch,
  onClose,
  onBringToFront,
  onTextSaved,
  ideaThread,
  ideaFragment,
  onUpdateIdeaFragment,
}: ReferenceCardProps) {
  const [dragMode, setDragMode] = useState<DragMode | null>(null);

  const startMove = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragMode({
      kind: "move",
      startX: event.clientX,
      startY: event.clientY,
      original: card,
    });
    onBringToFront();
  };

  const startResize = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragMode({
      kind: "resize",
      startX: event.clientX,
      startY: event.clientY,
      original: card,
    });
    onBringToFront();
  };

  const updateDrag = (event: ReactPointerEvent) => {
    if (!dragMode) return;
    const dx = event.clientX - dragMode.startX;
    const dy = event.clientY - dragMode.startY;
    if (dragMode.kind === "move") {
      onPatch({
        x: Math.max(0, dragMode.original.x + dx),
        y: Math.max(0, dragMode.original.y + dy),
      });
      return;
    }

    onPatch({
      width: Math.max(MIN_CARD_WIDTH, dragMode.original.width + dx),
      height: Math.max(MIN_CARD_HEIGHT, dragMode.original.height + dy),
    });
  };

  const stopDrag = () => {
    setDragMode(null);
  };

  const cardTitle = isIdeaBinderCard(card)
    ? ideaThread?.title ?? "削除された Idea"
    : fileNameFromPath(card.sourcePath);

  return (
    <article
      className={`referenceCard ${isFocused ? "focusedReferenceCard" : ""} ${
        card.collapsed ? "collapsedReferenceCard" : ""
      } ${card.pinned ? "pinnedReferenceCard" : ""}`}
      style={{
        transform: `translate(${card.x}px, ${card.y}px)`,
        width: card.width,
        height: card.collapsed ? undefined : card.height,
        zIndex: card.zIndex,
      }}
      onPointerDown={onBringToFront}
    >
      <header
        className="referenceCardHeader"
        onPointerDown={startMove}
        onPointerMove={updateDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <span className={`binderCardSource ${isIdeaBinderCard(card) ? "idea" : "reference"}`}>
          {isIdeaBinderCard(card) ? "Idea" : "資料"}
        </span>
        <strong>{cardTitle}</strong>
        <div className="referenceCardActions" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            aria-label={card.pinned ? "ピン留め解除" : "ピン留め"}
            title={card.pinned ? "ピン留め解除" : "ピン留め"}
            onClick={() => onPatch({ pinned: !card.pinned })}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <path d="M14 4l6 6" />
              <path d="M9 14 4 19" />
              <path d="m7 12 5-5 5 5-5 5-5-5Z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={card.collapsed ? "展開" : "折り畳み"}
            title={card.collapsed ? "展開" : "折り畳み"}
            onClick={() => onPatch({ collapsed: !card.collapsed })}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <path d={card.collapsed ? "M6 12h12M12 6v12" : "M6 12h12"} />
            </svg>
          </button>
          <button type="button" aria-label="閉じる" title="閉じる" onClick={onClose}>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <path d="m6 6 12 12" />
              <path d="m18 6-12 12" />
            </svg>
          </button>
        </div>
      </header>
      {!card.collapsed && (
        <>
          {isIdeaBinderCard(card) ? (
            <IdeaBinderCardBody
              card={card}
              thread={ideaThread}
              fragment={ideaFragment}
              onUpdate={onUpdateIdeaFragment}
            />
          ) : (
            <ReferenceCardBody
              rootPath={rootPath}
              card={card}
              onPatch={onPatch}
              onTextSaved={onTextSaved}
            />
          )}
          <span
            className="referenceResizeHandle"
            role="presentation"
            onPointerDown={startResize}
            onPointerMove={updateDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          />
        </>
      )}
    </article>
  );
}

function IdeaBinderCardBody({
  card,
  thread,
  fragment,
  onUpdate,
}: {
  card: IdeaBinderCardState;
  thread?: IdeaThread;
  fragment?: IdeaFragment;
  onUpdate: (threadId: string, fragmentId: string, body: string) => void;
}) {
  const [draft, setDraft] = useState(fragment?.body ?? "");
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(fragment?.body ?? "");
  }, [fragment?.body]);

  if (!thread || !fragment) {
    return <div className="referenceCardBody referencePlaceholder">この Idea は削除されています</div>;
  }

  const save = () => {
    editingRef.current = false;
    if (draft.trim() && draft !== fragment.body) {
      onUpdate(card.threadId, card.fragmentId, draft);
    } else if (!draft.trim()) {
      setDraft(fragment.body);
    }
  };

  return (
    <div className="referenceCardBody binderIdeaCardBody">
      <textarea
        aria-label={`${thread.title}のIdea本文`}
        value={draft}
        onFocus={() => {
          editingRef.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <div className="binderIdeaCardFooter">
        <span>{draft.length} 文字</span>
      </div>
    </div>
  );
}

function ReferenceCardBody({
  rootPath,
  card,
  onPatch,
  onTextSaved,
}: {
  rootPath: string;
  card: ReferenceCardState;
  onPatch: (patch: BinderCardPatch) => void;
  onTextSaved: (sourcePath: string, scope: ReferenceScope, text: string) => void;
}) {
  if (isTextualReference(card.kind)) {
    return (
      <TextReferenceBody
        rootPath={rootPath}
        card={card}
        onPatch={onPatch}
        onTextSaved={onTextSaved}
      />
    );
  }
  if (card.kind === "image") {
    return <ImageReferenceBody rootPath={rootPath} card={card} onPatch={onPatch} />;
  }
  if (card.kind === "pdf") {
    return <PdfReferenceBody rootPath={rootPath} card={card} onPatch={onPatch} />;
  }
  return <div className="referenceCardBody referencePlaceholder">未対応の資料です</div>;
}

export function ReferenceReadOnlyPreview({
  rootPath,
  sourcePath,
  scope,
  kind,
  title,
}: {
  rootPath: string | null;
  sourcePath: string;
  scope: ReferenceScope;
  kind: ReferenceKind;
  title?: string;
}) {
  if (isTextualReference(kind)) {
    return <ReadOnlyTextReferencePreview rootPath={rootPath} sourcePath={sourcePath} scope={scope} kind={kind} />;
  }
  if (kind === "image") {
    return <ReadOnlyImageReferencePreview rootPath={rootPath} sourcePath={sourcePath} scope={scope} title={title} />;
  }
  if (kind === "pdf") {
    return <ReadOnlyPdfReferencePreview rootPath={rootPath} sourcePath={sourcePath} scope={scope} />;
  }
  return <div className="referenceReadOnlyPreview referencePlaceholder">未対応の資料です</div>;
}

function ReadOnlyTextReferencePreview({
  rootPath,
  sourcePath,
  scope,
  kind,
}: {
  rootPath: string | null;
  sourcePath: string;
  scope: ReferenceScope;
  kind: ReferenceKind;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    invoke<string>("read_reference_text", {
      rootPath,
      sourcePath,
      scope,
    })
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, scope, sourcePath]);

  if (loading) {
    return <div className="referenceReadOnlyPreview referencePlaceholder">読み込み中...</div>;
  }
  if (error) {
    return <div className="referenceReadOnlyPreview referenceError">{error}</div>;
  }

  return (
    <div className="referenceReadOnlyPreview referenceTextPreview">
      {kind === "markdown" ? (
        <MarkdownLite rootPath={rootPath ?? ""} sourcePath={sourcePath} scope={scope} text={text} />
      ) : (
        <pre>{text}</pre>
      )}
    </div>
  );
}

function ReadOnlyImageReferencePreview({
  rootPath,
  sourcePath,
  scope,
  title,
}: {
  rootPath: string | null;
  sourcePath: string;
  scope: ReferenceScope;
  title?: string;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSrc("");
    setError("");
    invoke<ReferenceBinary>("read_reference_binary", {
      rootPath,
      sourcePath,
      scope,
    })
      .then((binary) => {
        if (!cancelled) setSrc(binaryDataUrl(binary));
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, scope, sourcePath]);

  if (error) {
    return <div className="referenceReadOnlyPreview referenceError">{error}</div>;
  }

  return (
    <div className="referenceReadOnlyPreview referenceImageScroller">
      {src ? <img src={src} alt={title ?? ""} /> : <div className="referencePlaceholder">読み込み中...</div>}
    </div>
  );
}

function ReadOnlyPdfReferencePreview({
  rootPath,
  sourcePath,
  scope,
}: {
  rootPath: string | null;
  sourcePath: string;
  scope: ReferenceScope;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setPage(1);
    setError("");
    const loadPdf = async () => {
      const [binary, pdfjs] = await Promise.all([
        invoke<ReferenceBinary>("read_reference_binary", {
          rootPath,
          sourcePath,
          scope,
        }),
        import("pdfjs-dist"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return await pdfjs.getDocument({ data: base64ToUint8Array(binary.dataBase64) }).promise;
    };

    loadPdf()
      .then((document) => {
        if (!cancelled) setPdf(document);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, scope, sourcePath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdf) return;
    let cancelled = false;

    pdf.getPage(Math.min(page, pdf.numPages))
      .then((pdfPage) => {
        if (cancelled) return;
        const renderTask = renderPdfPageAtDisplayScale(pdfPage, canvas, 1);
        if (!renderTask) return;
        void renderTask.promise.catch((reason) => {
          if (!cancelled) setError(String(reason));
        });
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });

    return () => {
      cancelled = true;
    };
  }, [pdf, page]);

  if (error) {
    return <div className="referenceReadOnlyPreview referenceError">{error}</div>;
  }

  const numPages = pdf?.numPages ?? 0;

  return (
    <div className="referenceReadOnlyPreview referenceReadOnlyPdf">
      <div className="referencePdfMiniNav">
        <button
          type="button"
          aria-label="前のページ"
          disabled={!pdf || page <= 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          前
        </button>
        <span>
          {pdf ? page : "-"} / {numPages || "-"}
        </span>
        <button
          type="button"
          aria-label="次のページ"
          disabled={!pdf || page >= numPages}
          onClick={() => setPage((value) => (pdf ? Math.min(pdf.numPages, value + 1) : value))}
        >
          次
        </button>
      </div>
      <div className="referencePdfScroller">
        {pdf ? <canvas ref={canvasRef} /> : <div className="referencePlaceholder">読み込み中...</div>}
      </div>
    </div>
  );
}

function TextReferenceBody({
  rootPath,
  card,
  onPatch,
  onTextSaved,
}: {
  rootPath: string;
  card: ReferenceCardState;
  onPatch: (patch: Partial<ReferenceCardState>) => void;
  onTextSaved: (sourcePath: string, scope: ReferenceScope, text: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    invoke<string>("read_reference_text", {
      rootPath,
      sourcePath: card.sourcePath,
      scope: card.scope,
    })
      .then((value) => {
        if (cancelled) return;
        setText(value);
        setDraft(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, card.scope, card.sourcePath]);

  useEffect(() => {
    if (!bodyRef.current || typeof card.scrollTop !== "number") return;
    bodyRef.current.scrollTop = card.scrollTop;
  }, [card.id]);

  const save = async () => {
    setError("");
    try {
      await invoke("save_reference_text", {
        rootPath,
        sourcePath: card.sourcePath,
        scope: card.scope,
        text: draft,
      });
      setText(draft);
      onTextSaved(card.sourcePath, card.scope, draft);
      onPatch({ editing: false });
    } catch (reason) {
      setError(String(reason));
    }
  };

  if (loading) return <div className="referenceCardBody referencePlaceholder">読み込み中...</div>;

  return (
    <div className="referenceCardBody referenceTextBody">
      <div className="referenceBodyToolbar">
        {card.editing ? (
          <>
            <button type="button" onClick={() => void save()}>
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(text);
                onPatch({ editing: false });
              }}
            >
              キャンセル
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onPatch({ editing: true })}>
              編集
            </button>
            <button type="button" onClick={() => onPatch({ width: 560, height: 640 })}>
              大きく開く
            </button>
          </>
        )}
      </div>
      {error && <p className="referenceError">{error}</p>}
      {card.editing ? (
        <textarea
          className="referenceTextEditor"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <div
          ref={bodyRef}
          className="referenceTextPreview"
          onScroll={(event) => onPatch({ scrollTop: event.currentTarget.scrollTop })}
        >
          {card.kind === "markdown" ? (
            <MarkdownLite rootPath={rootPath} sourcePath={card.sourcePath} scope={card.scope} text={text} />
          ) : (
            <pre>{text}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function ImageReferenceBody({
  rootPath,
  card,
  onPatch,
}: {
  rootPath: string;
  card: ReferenceCardState;
  onPatch: (patch: Partial<ReferenceCardState>) => void;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const zoom = card.zoom ?? 1;

  useEffect(() => {
    let cancelled = false;
    setError("");
    invoke<ReferenceBinary>("read_reference_binary", {
      rootPath,
      sourcePath: card.sourcePath,
      scope: card.scope,
    })
      .then((binary) => {
        if (!cancelled) setSrc(binaryDataUrl(binary));
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, card.scope, card.sourcePath]);

  return (
    <div className="referenceCardBody referenceImageBody">
      <div className="referenceBodyToolbar">
        <button type="button" onClick={() => onPatch({ zoom: Math.max(0.25, zoom - 0.25) })}>
          縮小
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => onPatch({ zoom: Math.min(4, zoom + 0.25) })}>
          拡大
        </button>
      </div>
      {error ? (
        <p className="referenceError">{error}</p>
      ) : src ? (
        <div className="referenceImageScroller">
          <img src={src} alt="" style={{ transform: `scale(${zoom})` }} />
        </div>
      ) : (
        <div className="referencePlaceholder">読み込み中...</div>
      )}
    </div>
  );
}

function PdfReferenceBody({
  rootPath,
  card,
  onPatch,
}: {
  rootPath: string;
  card: ReferenceCardState;
  onPatch: (patch: Partial<ReferenceCardState>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const page = Math.max(1, card.page ?? 1);
  const zoom = card.zoom ?? 1;

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError("");
    const loadPdf = async () => {
      const [binary, pdfjs] = await Promise.all([
        invoke<ReferenceBinary>("read_reference_binary", {
          rootPath,
          sourcePath: card.sourcePath,
          scope: card.scope,
        }),
        import("pdfjs-dist"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return await pdfjs.getDocument({ data: base64ToUint8Array(binary.dataBase64) }).promise;
    };

    loadPdf()
      .then((document) => {
        if (!cancelled) setPdf(document);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, card.scope, card.sourcePath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdf) return;
    let cancelled = false;

    pdf.getPage(Math.min(page, pdf.numPages)).then((pdfPage) => {
      if (cancelled) return;
      const renderTask = renderPdfPageAtDisplayScale(pdfPage, canvas, zoom);
      if (!renderTask) return;
      void renderTask.promise.catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [pdf, page, zoom]);

  return (
    <div className="referenceCardBody referencePdfBody">
      <div className="referenceBodyToolbar">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPatch({ page: Math.max(1, page - 1) })}
        >
          前
        </button>
        <span>
          {page} / {pdf?.numPages ?? "-"}
        </span>
        <button
          type="button"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => onPatch({ page: pdf ? Math.min(pdf.numPages, page + 1) : page + 1 })}
        >
          次
        </button>
        <button type="button" onClick={() => onPatch({ zoom: Math.max(0.5, zoom - 0.2) })}>
          -
        </button>
        <button type="button" onClick={() => onPatch({ zoom: Math.min(2.5, zoom + 0.2) })}>
          +
        </button>
      </div>
      {error && <p className="referenceError">{error}</p>}
      <div className="referencePdfScroller">
        {pdf ? <canvas ref={canvasRef} /> : <div className="referencePlaceholder">読み込み中...</div>}
      </div>
    </div>
  );
}
