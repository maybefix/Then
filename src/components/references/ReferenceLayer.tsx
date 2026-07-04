import { invoke } from "@tauri-apps/api/core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { ReactNode } from "react";
import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ReferenceBinary,
  ReferenceCardState,
  ReferenceKind,
  ReferenceLayout,
} from "../../types";

type ReferenceLayerProps = {
  rootPath: string | null;
  layout: ReferenceLayout;
  onLayoutChange: (updater: (layout: ReferenceLayout) => ReferenceLayout) => void;
  onReturnFocusToEditor: () => void;
  onTextSaved: (sourcePath: string, text: string) => void;
};

type ReferenceCardProps = {
  rootPath: string;
  card: ReferenceCardState;
  isFocused: boolean;
  onPatch: (patch: Partial<ReferenceCardState>) => void;
  onClose: () => void;
  onBringToFront: () => void;
  onTextSaved: (sourcePath: string, text: string) => void;
};

type DragMode =
  | { kind: "move"; startX: number; startY: number; original: ReferenceCardState }
  | { kind: "resize"; startX: number; startY: number; original: ReferenceCardState };

const MIN_CARD_WIDTH = 220;
const MIN_CARD_HEIGHT = 140;
const PINNED_REFERENCE_Z_BASE = 10000;
const NORMAL_REFERENCE_Z_LIMIT = PINNED_REFERENCE_Z_BASE - 1;

const fileNameFromPath = (sourcePath: string) =>
  sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;

const isTextualReference = (kind: ReferenceKind) => kind === "text" || kind === "markdown";

const binaryDataUrl = (binary: ReferenceBinary) => `data:${binary.mime};base64,${binary.dataBase64}`;

const base64ToUint8Array = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

function patchCard(
  layout: ReferenceLayout,
  cardId: string,
  patch: Partial<ReferenceCardState>,
): ReferenceLayout {
  return {
    ...layout,
    cards: layout.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
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
}: ReferenceLayerProps) {
  const maxZ = useMemo(
    () => layout.cards.reduce((max, card) => Math.max(max, card.zIndex), 0),
    [layout.cards],
  );

  if (!rootPath || layout.cards.length === 0) return null;

  return (
    <div className="referenceLayer" aria-label="資料レイヤー" onDoubleClick={onReturnFocusToEditor}>
      {layout.cards.map((card) => (
        <ReferenceCard
          key={card.id}
          rootPath={rootPath}
          card={card}
          isFocused={card.zIndex === maxZ}
          onPatch={(patch) => onLayoutChange((current) => patchCard(current, card.id, patch))}
          onClose={() => onLayoutChange((current) => removeCard(current, card.id))}
          onBringToFront={() => onLayoutChange((current) => bringCardToFront(current, card.id))}
          onTextSaved={onTextSaved}
        />
      ))}
    </div>
  );
}

function ReferenceCard({
  rootPath,
  card,
  isFocused,
  onPatch,
  onClose,
  onBringToFront,
  onTextSaved,
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
        <strong>{fileNameFromPath(card.sourcePath)}</strong>
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
          <ReferenceCardBody
            rootPath={rootPath}
            card={card}
            onPatch={onPatch}
            onTextSaved={onTextSaved}
          />
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

function ReferenceCardBody({
  rootPath,
  card,
  onPatch,
  onTextSaved,
}: {
  rootPath: string;
  card: ReferenceCardState;
  onPatch: (patch: Partial<ReferenceCardState>) => void;
  onTextSaved: (sourcePath: string, text: string) => void;
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
  kind,
  title,
}: {
  rootPath: string;
  sourcePath: string;
  kind: ReferenceKind;
  title?: string;
}) {
  if (isTextualReference(kind)) {
    return <ReadOnlyTextReferencePreview rootPath={rootPath} sourcePath={sourcePath} kind={kind} />;
  }
  if (kind === "image") {
    return <ReadOnlyImageReferencePreview rootPath={rootPath} sourcePath={sourcePath} title={title} />;
  }
  if (kind === "pdf") {
    return <ReadOnlyPdfReferencePreview rootPath={rootPath} sourcePath={sourcePath} />;
  }
  return <div className="referenceReadOnlyPreview referencePlaceholder">未対応の資料です</div>;
}

function ReadOnlyTextReferencePreview({
  rootPath,
  sourcePath,
  kind,
}: {
  rootPath: string;
  sourcePath: string;
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
  }, [rootPath, sourcePath]);

  if (loading) {
    return <div className="referenceReadOnlyPreview referencePlaceholder">読み込み中...</div>;
  }
  if (error) {
    return <div className="referenceReadOnlyPreview referenceError">{error}</div>;
  }

  return (
    <div className="referenceReadOnlyPreview referenceTextPreview">
      {kind === "markdown" ? (
        <MarkdownLite rootPath={rootPath} sourcePath={sourcePath} text={text} />
      ) : (
        <pre>{text}</pre>
      )}
    </div>
  );
}

function ReadOnlyImageReferencePreview({
  rootPath,
  sourcePath,
  title,
}: {
  rootPath: string;
  sourcePath: string;
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
  }, [rootPath, sourcePath]);

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
}: {
  rootPath: string;
  sourcePath: string;
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
  }, [rootPath, sourcePath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdf) return;
    let cancelled = false;

    pdf.getPage(Math.min(page, pdf.numPages))
      .then((pdfPage) => {
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: 1 });
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        void pdfPage.render({ canvas, canvasContext: context, viewport }).promise.catch((reason) => {
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
  onTextSaved: (sourcePath: string, text: string) => void;
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
  }, [rootPath, card.sourcePath]);

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
        text: draft,
      });
      setText(draft);
      onTextSaved(card.sourcePath, draft);
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
            <MarkdownLite rootPath={rootPath} sourcePath={card.sourcePath} text={text} />
          ) : (
            <pre>{text}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function MarkdownLite({
  rootPath,
  sourcePath,
  text,
}: {
  rootPath: string;
  sourcePath: string;
  text: string;
}) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const codeFence = line.match(/^```\s*([^\s`]*)\s*$/);
    if (codeFence) {
      const language = codeFence[1].trim();
      const codeLines = [];
      const key = index;
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(renderMarkdownCodeBlock(language, codeLines.join("\n"), key));
      continue;
    }

    if (isMarkdownTableSeparator(line) && index + 1 < lines.length && isMarkdownTableRowLine(lines[index + 1])) {
      const key = index;
      const columnCount = splitMarkdownTableRow(line).length;
      const rows = [];
      index += 1;
      while (index < lines.length && isMarkdownTableRowLine(lines[index])) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push(renderMarkdownTable(rootPath, sourcePath, null, rows, key, columnCount));
      continue;
    }

    if (isMarkdownTableRowLine(line) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      const key = index;
      const header = splitMarkdownTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRowLine(lines[index])) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push(renderMarkdownTable(rootPath, sourcePath, header, rows, key));
      continue;
    }

    blocks.push(renderMarkdownLine(rootPath, sourcePath, line, index));
    index += 1;
  }

  return <div className="referenceMarkdown">{blocks}</div>;
}

function renderMarkdownLine(
  rootPath: string,
  sourcePath: string,
  line: string,
  key: number,
) {
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    return renderMarkdownHeading(rootPath, sourcePath, heading[1].length, heading[2], key);
  }

  if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
    const checked = /\[[xX]\]/.test(line);
    return (
      <label className="referenceTask" key={key}>
        <input type="checkbox" checked={checked} readOnly />
        <span>
          {renderInlineMarkdown(
            rootPath,
            sourcePath,
            line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, ""),
          )}
        </span>
      </label>
    );
  }

  if (/^\s*[-*]\s+/.test(line)) {
    return (
      <p key={key}>
        • {renderInlineMarkdown(rootPath, sourcePath, line.replace(/^\s*[-*]\s+/, ""))}
      </p>
    );
  }

  if (/^\s*\d+\.\s+/.test(line)) {
    return <p key={key}>{renderInlineMarkdown(rootPath, sourcePath, line)}</p>;
  }

  if (!line.trim()) return <div className="referenceMarkdownBlank" key={key} />;

  return (
    <p key={key}>{renderInlineMarkdown(rootPath, sourcePath, line)}</p>
  );
}

function renderMarkdownCodeBlock(language: string, code: string, key: number) {
  return (
    <figure className="referenceCodeBlock" key={key}>
      {language && <figcaption>{language}</figcaption>}
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

function splitMarkdownTableRow(line: string): string[] {
  let normalized = line.trim();
  if (normalized.startsWith("|")) normalized = normalized.slice(1);
  if (normalized.endsWith("|") && !normalized.endsWith("\\|")) {
    normalized = normalized.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "\\" && next === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "`") {
      inCode = !inCode;
      cell += char;
      continue;
    }
    if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed) && trimmed.includes("|") && splitMarkdownTableRow(trimmed).length >= 2;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownTable(
  rootPath: string,
  sourcePath: string,
  header: string[] | null,
  rows: string[][],
  key: number,
  minimumColumnCount = header?.length ?? 0,
) {
  const columnCount = Math.max(
    minimumColumnCount,
    header?.length ?? 0,
    ...rows.map((row) => row.length),
  );

  return (
    <div className="referenceTableScroller" key={key}>
      <table className="referenceMarkdownTable">
        {header && (
          <thead>
            <tr>
              {Array.from({ length: columnCount }, (_, cellIndex) => (
                <th key={cellIndex}>
                  {renderInlineMarkdown(rootPath, sourcePath, header[cellIndex] ?? "")}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columnCount }, (_, cellIndex) => (
                <td key={cellIndex}>
                  {renderInlineMarkdown(rootPath, sourcePath, row[cellIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdownHeading(
  rootPath: string,
  sourcePath: string,
  level: number,
  text: string,
  key: number,
) {
  const children = renderInlineMarkdown(rootPath, sourcePath, text);
  if (level === 1) return <h3 key={key}>{children}</h3>;
  if (level === 2) return <h4 key={key}>{children}</h4>;
  if (level === 3) return <h5 key={key}>{children}</h5>;
  return <h6 key={key}>{children}</h6>;
}

function renderInlineMarkdown(rootPath: string, sourcePath: string, text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      return (
        <ReferenceMarkdownImage
          key={index}
          rootPath={rootPath}
          sourcePath={sourcePath}
          alt={image[1]}
          target={image[2]}
        />
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

function resolveMarkdownAssetPath(sourcePath: string, target: string): string | null {
  const cleanTarget = target.trim().replace(/^<|>$/g, "");
  if (!cleanTarget || /^[a-z][a-z0-9+.-]*:/i.test(cleanTarget)) return null;

  const sourceParts = sourcePath.split("/").filter(Boolean);
  sourceParts.pop();
  const parts = cleanTarget.startsWith("/")
    ? cleanTarget.split("/")
    : [...sourceParts, ...cleanTarget.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(decodeURIComponent(part));
  }
  return resolved.join("/");
}

function ReferenceMarkdownImage({
  rootPath,
  sourcePath,
  alt,
  target,
}: {
  rootPath: string;
  sourcePath: string;
  alt: string;
  target: string;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const direct = target.trim();
    if (/^(https?:|data:image\/)/i.test(direct)) {
      setSrc(direct);
      setFailed(false);
      return;
    }

    const resolved = resolveMarkdownAssetPath(sourcePath, direct);
    if (!resolved) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    setSrc("");
    setFailed(false);
    invoke<ReferenceBinary>("read_reference_binary", {
      rootPath,
      sourcePath: resolved,
    })
      .then((binary) => {
        if (!cancelled) setSrc(binaryDataUrl(binary));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [rootPath, sourcePath, target]);

  if (failed) {
    return <span className="referenceMissingImage">[画像を表示できません: {alt || target}]</span>;
  }
  if (!src) return <span className="referenceMissingImage">[画像を読み込み中]</span>;
  return <img className="referenceMarkdownImage" src={src} alt={alt} />;
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
  }, [rootPath, card.sourcePath]);

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
  }, [rootPath, card.sourcePath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdf) return;
    let cancelled = false;

    pdf.getPage(Math.min(page, pdf.numPages)).then((pdfPage) => {
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: zoom });
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      void pdfPage.render({ canvas, canvasContext: context, viewport }).promise.catch((reason) => {
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
