// Markdown 画像記法 `![alt](src)` の src を、表示できる URL に解決する。
// Web の画像（http/https）はそのまま使い、取得・保存はしない。ローカルの画像は
// 原稿ファイルからの相対パスとして解決し、then-image スキームで配信する
// （作品フォルダ外のファイルは Rust 側が拒否する）。

import { imageMarkupPattern } from "../editor/ast/documentAst";

export const IMAGE_SCHEME = "then-image";

const WEB_URL = /^https?:\/\//i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

function decodeSrc(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

function joinPath(directory: string, relative: string): string {
  const separator = /\\|^[a-z]:$/i.test(directory) ? "\\" : "/";
  const segments = `${directory}/${relative}`.split(/[\\/]+/);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") {
      if (out.length === 0 && segment === "") out.push("");
      continue;
    }
    if (segment === "..") {
      // The first segment is the root ("" or a drive); ".." never climbs past it.
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join(separator);
}

/** 原稿ファイル（documentPath）を基準に、ローカル画像の絶対パスを返す。 */
export function resolveLocalImagePath(src: string, documentPath: string | null | undefined): string | null {
  const decoded = decodeSrc(src.trim());
  if (!decoded || WEB_URL.test(decoded)) return null;
  if (WINDOWS_ABSOLUTE.test(decoded)) return joinPath(decoded.slice(0, 2), decoded.slice(3));
  if (OTHER_SCHEME.test(decoded)) return null;
  if (decoded.startsWith("/") || decoded.startsWith("\\")) return null;
  if (!documentPath) return null;
  const cut = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
  if (cut < 0) return null;
  return joinPath(documentPath.slice(0, cut), decoded);
}

/**
 * src を表示用の URL にする。schemeBase は `convertFileSrc("", IMAGE_SCHEME)`
 * の結果（Worker では convertFileSrc が使えないため呼び出し側で渡す）。
 * 表示できない src（file: や javascript: など、基準のない相対パス）は null。
 */
export function resolveImageUrl(
  src: string,
  documentPath: string | null | undefined,
  schemeBase: string | null | undefined,
): string | null {
  const trimmed = src.trim();
  if (WEB_URL.test(trimmed)) return trimmed;
  if (!schemeBase) return null;
  const path = resolveLocalImagePath(trimmed, documentPath);
  return path ? `${schemeBase}${encodeURIComponent(path)}` : null;
}

/** 本文中の画像記法の src を、構文解析をせずに拾う（書き出し前の読み込み確認用）。 */
export function scanImageSources(text: string): string[] {
  const out: string[] = [];
  const pattern = imageMarkupPattern();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) out.push(match[2]);
  return out;
}
