/**
 * 左サイドバーのナビゲータ方式で使うプレビュー本文の生成。
 *
 * 編集用ソースをそのまま出さず、レイアウトシステムや Markdown / 青空文庫系の
 * 記法を「正規化した本文」へ変換して表示する。
 *
 * 変換例:
 *   [漢字(rb,かんじ)] → 漢字
 *   [ここ(em)]        → ここ
 *   [12(tcy)]         → 12
 *   [(al:center)]     → （表示しない）
 *   **強調**          → 強調
 *   見出し記号 #       → （表示しない）
 */

/** インライン記法を表示用テキストへ変換する（改行はそのまま保持）。 */
export function normalizePreviewInline(text: string): string {
  return (
    text
      // [(al:center)] などの配置コマンドは表示しない。
      .replace(/\[\(al:(?:start|center|end)\)\]/g, "")
      // [漢字(rb,かんじ)] / [ここ(em)] / [12(tcy)] → 内容だけ残す。
      .replace(/\[([^\[\]\n]*?)\s*\((?:rb|em|tcy)(?:,[^)]*)?\)\]/g, "$1")
      // 青空文庫ルビ ｜漢字《かんじ》 / 漢字《かんじ》 → ベースのみ。
      .replace(/｜([^《》｜\n]+)《[^《》\n]*》/g, "$1")
      .replace(/([一-龠々〆ヶ]+)《[^《》\n]*》/g, "$1")
      // 圏点 《《強調》》 → 強調。
      .replace(/《《([^《》\n]+)》》/g, "$1")
      // 青空文庫注記 ［＃地付き］ などは表示しない。
      .replace(/［＃[^］\n]*］/g, "")
      // Markdown 強調・打ち消し記号を外す。
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/~~([^~\n]+)~~/g, "$1")
      .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "$1")
      // インラインコードのバッククォートを外す。
      .replace(/`([^`\n]+)`/g, "$1")
  );
}

/** 1 行ぶんの表示用テキスト（行頭マーカーも除去）。 */
export function normalizePreviewLine(line: string): string {
  let text = line;
  // 見出し記号 # は表示しない。
  text = text.replace(/^\s{0,3}#{1,6}\s*/, "");
  // 引用・地付きマーカー。
  text = text.replace(/^\s*>>?\s*/, "");
  // リストマーカー（記号・番号）。
  text = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
  // タスクリストのチェックボックス。
  text = text.replace(/^\[[ xX]\]\s*/, "");
  return normalizePreviewInline(text).trim();
}

/** 複数行テキストを正規化し、空行を畳んだプレビュー本文へ変換する。 */
export function normalizePreviewText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizePreviewLine(line))
    .filter((line) => line.length > 0)
    .join(" ");
}

/** 正規化済みテキストを最大文字数で切り詰める（超過時は省略記号を付与）。 */
export function truncatePreview(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, maxChars).join("")}…`;
}

/** ファイル冒頭の一定文字数のプレビューを返す。 */
export function buildFilePreview(text: string, maxChars = 80): string {
  return truncatePreview(normalizePreviewText(text), maxChars);
}

/**
 * 見出し配下（次の同レベル以下の見出しが現れるまで）の本文冒頭プレビューを返す。
 * `lines` は 0 始まりの行配列、`headingLine` は 1 始まりの見出し行番号。
 */
export function buildHeadingPreview(
  lines: string[],
  headingLine: number,
  maxChars = 80,
): string {
  const startIndex = headingLine; // 見出し行の次の行から。
  const collected: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const raw = lines[index];
    // 次の見出しが来たら打ち切る。
    if (/^\s{0,3}#{1,6}\s+/.test(raw)) break;
    const normalized = normalizePreviewLine(raw);
    if (normalized.length > 0) collected.push(normalized);
    if (Array.from(collected.join(" ")).length >= maxChars) break;
  }
  return truncatePreview(collected.join(" "), maxChars);
}
