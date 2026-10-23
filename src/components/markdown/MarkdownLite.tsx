import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { openableUrl, openExternalUrl } from "../../externalUrl";
import type { ReferenceBinary, ReferenceScope } from "../../types";

export const binaryDataUrl = (binary: ReferenceBinary) => `data:${binary.mime};base64,${binary.dataBase64}`;

export function MarkdownLite({
  rootPath,
  sourcePath,
  scope,
  text,
}: {
  rootPath: string;
  sourcePath: string;
  scope: ReferenceScope;
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
      blocks.push(renderMarkdownTable(rootPath, sourcePath, scope, null, rows, key, columnCount));
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
      blocks.push(renderMarkdownTable(rootPath, sourcePath, scope, header, rows, key));
      continue;
    }

    blocks.push(renderMarkdownLine(rootPath, sourcePath, scope, line, index));
    index += 1;
  }

  return <div className="referenceMarkdown">{blocks}</div>;
}

function renderMarkdownLine(
  rootPath: string,
  sourcePath: string,
  scope: ReferenceScope,
  line: string,
  key: number,
) {
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    return renderMarkdownHeading(rootPath, sourcePath, scope, heading[1].length, heading[2], key);
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
            scope,
            line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, ""),
          )}
        </span>
      </label>
    );
  }

  if (/^\s*[-*]\s+/.test(line)) {
    return (
      <p key={key}>
        • {renderInlineMarkdown(rootPath, sourcePath, scope, line.replace(/^\s*[-*]\s+/, ""))}
      </p>
    );
  }

  if (/^\s*\d+\.\s+/.test(line)) {
    return <p key={key}>{renderInlineMarkdown(rootPath, sourcePath, scope, line)}</p>;
  }

  if (!line.trim()) return <div className="referenceMarkdownBlank" key={key} />;

  return (
    <p key={key}>{renderInlineMarkdown(rootPath, sourcePath, scope, line)}</p>
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
  scope: ReferenceScope,
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
                  {renderInlineMarkdown(rootPath, sourcePath, scope, header[cellIndex] ?? "")}
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
                  {renderInlineMarkdown(rootPath, sourcePath, scope, row[cellIndex] ?? "")}
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
  scope: ReferenceScope,
  level: number,
  text: string,
  key: number,
) {
  const children = renderInlineMarkdown(rootPath, sourcePath, scope, text);
  if (level === 1) return <h3 key={key}>{children}</h3>;
  if (level === 2) return <h4 key={key}>{children}</h4>;
  if (level === 3) return <h5 key={key}>{children}</h5>;
  return <h6 key={key}>{children}</h6>;
}

function renderInlineMarkdown(rootPath: string, sourcePath: string, scope: ReferenceScope, text: string) {
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
          scope={scope}
          alt={image[1]}
          target={image[2]}
        />
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const url = openableUrl(link[2]);
      if (!url) return <span key={index}>{link[1]}</span>;
      return (
        <a
          key={index}
          href={url}
          onClick={(event) => {
            // The WebView must never navigate or open a window of its own.
            event.preventDefault();
            openExternalUrl(url).catch((error) => console.error(error));
          }}
          onAuxClick={(event) => event.preventDefault()}
        >
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
  scope,
  alt,
  target,
}: {
  rootPath: string;
  sourcePath: string;
  scope: ReferenceScope;
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
      scope,
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
  }, [rootPath, scope, sourcePath, target]);

  if (failed) {
    return <span className="referenceMissingImage">[画像を表示できません: {alt || target}]</span>;
  }
  if (!src) return <span className="referenceMissingImage">[画像を読み込み中]</span>;
  return <img className="referenceMarkdownImage" src={src} alt={alt} />;
}
