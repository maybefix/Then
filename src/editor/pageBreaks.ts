import { paginate, type PageSlice, type ParagraphMeasure } from "@libraz/mejiro";
import type { WritingMode } from "../types";

/**
 * ページ割りの計算。
 *
 * これまでページ表示は、本文全体を1つの CSS multicol へ流し、ブラウザに
 * ページ寸法の断片へ切ってもらっていた。この方式だと、ページの境目にかかる
 * 段落のレイアウトが断片に分かれる。断片化した要素では、ブラウザが OS へ渡す
 * キャレット座標が最初の断片（＝前のページ）のものになるため、IMEの変換候補
 * ウィンドウが前のページへ出てしまう。
 *
 * そこでページの割りを自前で持ち、表示するページの行だけを見せるようにする。
 * 段落は断片に分かれないので、ブラウザの座標計算はそのまま正しく働く。
 *
 * 行分割そのものはブラウザに任せたまま（禁則・ルビ・縦中横は既存のCSS組版が
 * 担当する）、実際に描かれた行数を測って割り付けだけを計算する。mejiro の
 * paginate は行数を入力として受け取る純粋な計算なので、この分担ができる。
 */

/** 段落の実測値。mejiro へ渡す値に、流し込みの中での実位置を足したもの。 */
export type ParagraphGeometry = ParagraphMeasure & {
  /** 本文の流れの先頭から、この段落の先頭までのブロック方向の距離（px）。 */
  blockStart: number;
};

export type PageBreaks = {
  /** ページごとの、段落の行範囲。 */
  pages: PageSlice[][];
  /**
   * 各ページ先頭のブロック方向オフセット（px）。表示するページを出すための
   * 移動量になる。
   */
  offsets: number[];
};

const EMPTY: PageBreaks = { pages: [], offsets: [] };

/**
 * 1ページに収まるブロック方向の寸法と段落の実測値から、ページの割りを決める。
 *
 * オフセットは行送りの積み上げではなく、段落の実位置から出す。積み上げると
 * 端数が溜まってページ境界が実際の行の境目から少しずれ、前のページの行が
 * 版面へ覗いてしまう（そこへカーソルも置けてしまう）。
 *
 * @param pageBlockSize 版面のブロック方向の寸法（縦書きなら横幅）。
 * @param paragraphs 段落ごとの行数・行送り・前隙間・実位置。
 */
export function computePageBreaks(
  pageBlockSize: number,
  paragraphs: ParagraphGeometry[],
): PageBreaks {
  if (!(pageBlockSize > 0) || paragraphs.length === 0) return EMPTY;

  const pages = paginate(pageBlockSize, paragraphs);
  const offsets = pages.map((page) => {
    const first = page[0];
    if (!first) return 0;
    const measure = paragraphs[first.paragraphIndex];
    if (!measure) return 0;
    return measure.blockStart + first.lineStart * measure.linePitch;
  });

  return { pages, offsets };
}

/** 段落番号から、その段落を含むページ（0始まり）を引く。 */
export function pageIndexOfParagraph(breaks: PageBreaks, paragraphIndex: number): number {
  for (let index = 0; index < breaks.pages.length; index += 1) {
    for (const slice of breaks.pages[index]) {
      if (slice.paragraphIndex === paragraphIndex) return index;
    }
  }
  return -1;
}

/**
 * 描画済みの本文から段落ごとの実測値を集める。
 *
 * 行送りは computed style の line-height、行数はブロック方向の寸法から割り出す。
 * ブロック方向は書字方向で入れ替わる。縦書き（vertical-rl）は右から左へ流れる
 * ので横幅と margin-right、横書き（horizontal-tb）は上から下なので高さと
 * margin-top を見る。
 */
export function measureParagraphs(
  root: HTMLElement,
  writingMode: WritingMode,
): ParagraphGeometry[] {
  const vertical = writingMode === "vertical-rl";
  const rootRect = root.getBoundingClientRect();
  const measures: ParagraphGeometry[] = [];

  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue;

    const style = getComputedStyle(child);
    const rect = child.getBoundingClientRect();
    // 縦書きは右から左へ流れるので、流れの先頭は本文の右端。
    const blockStart = vertical ? rootRect.right - rect.right : rect.top - rootRect.top;
    const linePitch = Number.parseFloat(style.lineHeight);

    if (!Number.isFinite(linePitch) || linePitch <= 0) {
      measures.push({ lineCount: 0, linePitch: 0, gapBefore: 0, blockStart });
      continue;
    }

    const blockSize = vertical ? rect.width : rect.height;
    const gapBefore = vertical
      ? Number.parseFloat(style.marginRight) || 0
      : Number.parseFloat(style.marginTop) || 0;

    measures.push({
      // 空行でも1行分の高さを持つので、最低1行として数える。
      lineCount: Math.max(1, Math.round(blockSize / linePitch)),
      linePitch,
      gapBefore,
      blockStart,
    });
  }

  return measures;
}
