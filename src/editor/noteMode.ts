import type { EditorSettings } from "../types";
import { normalizePathForCompare } from "../utils/projectTree";

/** エディタの2つの見え方。原稿は設定どおり、ノートは横書きの連続表示（BINDER 3.1）。 */
export type EditorDocumentMode = "manuscript" | "note";

/**
 * 素材（ファイル一覧で `role: "material"` が付いたもの）のパスの集合。
 * ノートかどうかはこの区分だけで決め、パスの文字列からは判定しない（BINDER 3.6）。
 */
export function collectMaterialPaths(
  files: ReadonlyArray<{ path: string; role?: string | null }>,
): Set<string> {
  const paths = new Set<string>();
  for (const file of files) {
    if (file.role === "material") paths.add(normalizePathForCompare(file.path));
  }
  return paths;
}

export function documentModeFor(
  path: string | null | undefined,
  materialPaths: ReadonlySet<string>,
): EditorDocumentMode {
  return path && materialPaths.has(normalizePathForCompare(path)) ? "note" : "manuscript";
}

/**
 * エディタへ渡す設定。原稿なら設定をそのまま返す。ノートなら縦書き・ページ表示・
 * 原稿用紙・タイプライターだけを外し、ほかの値（フォント・行間・横書きの幅・記号の表示）は使う。
 * 保存される設定は書き換えない。
 */
export function editorSettingsFor(settings: EditorSettings, mode: EditorDocumentMode): EditorSettings {
  if (mode !== "note") return settings;
  return {
    ...settings,
    writingMode: "horizontal-tb",
    editorDisplayMode: "continuous",
    typewriterScroll: false,
    showTypewriterGuide: false,
    manuscript: { ...settings.manuscript, layoutMode: "normal" },
  };
}
