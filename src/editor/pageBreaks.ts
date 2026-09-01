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
 * そこでページの割りを自前で持ち、表示するページの行だけを描くようにする。
 * 段落は断片に分かれないので、ブラウザの座標計算はそのまま正しく働く。
 *
 * 行分割そのものはブラウザに任せたまま（禁則・ルビ・縦中横は既存のCSS組版が
 * 担当する）、実際に描かれた行数を測って割り付けだけを計算する。mejiro の
 * paginate は行数を入力として受け取る純粋な計算なので、この分担ができる。
 */

export type PageBreaks = {
  /** ページごとの、段落の行範囲。 */
  pages: PageSlice[][];
  /**
   * 各ページ先頭のブロック方向オフセット（px）。段落を連続して流し込んだときの
   * 位置で、表示するページを出すための移動量になる。
   */
  offsets: number[];
};

const EMPTY: PageBreaks = { pages: [], offsets: [] };

/**
 * 1ページに収まるブロック方向の寸法と段落の実測値から、ページの割りを決める。
 *
 * @param pageBlockSize 版面のブロック方向の寸法（縦書きなら横幅）。
 * @param paragraphs 段落ごとの行数・行送り・前隙間。
 */
export function computePageBreaks(
  pageBlockSize: number,
  paragraphs: ParagraphMeasure[],
): PageBreaks {
  if (!(pageBlockSize > 0) || paragraphs.length === 0) return EMPTY;

  const pages = paginate(pageBlockSize, paragraphs);
  const offsets: number[] = [];
  let consumed = 0;

  for (const page of pages) {
    offsets.push(consumed);
    let atPageStart = true;
    for (const slice of page) {
      const measure = paragraphs[slice.paragraphIndex];
      if (!measure) continue;
      // 段落の前隙間はページ先頭では詰める。paginate の割り付けと合わせる。
      if (!atPageStart && slice.lineStart === 0) consumed += measure.gapBefore;
      consumed += (slice.lineEnd - slice.lineStart) * measure.linePitch;
      atPageStart = false;
    }
  }

  return { pages, offsets };
}

/** 本文オフセットではなく段落番号で、その段落を含むページを引く。 */
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
 * margin-top を見る。断片化している要素（移行期の multicol）では矩形が複数
 * 返るので合算する。
 */
export function measureParagraphs(
  root: HTMLElement,
  writingMode: WritingMode,
): ParagraphMeasure[] {
  const vertical = writingMode === "vertical-rl";
  const measures: ParagraphMeasure[] = [];

  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue;

    const style = getComputedStyle(child);
    const linePitch = Number.parseFloat(style.lineHeight);
    if (!Number.isFinite(linePitch) || linePitch <= 0) {
      measures.push({ lineCount: 0, linePitch: 0, gapBefore: 0 });
      continue;
    }

    let blockSize = 0;
    for (const rect of Array.from(child.getClientRects())) {
      blockSize += vertical ? rect.width : rect.height;
    }
    if (blockSize <= 0) {
      const rect = child.getBoundingClientRect();
      blockSize = vertical ? rect.width : rect.height;
    }

    const gapBefore = vertical
      ? Number.parseFloat(style.marginRight) || 0
      : Number.parseFloat(style.marginTop) || 0;

    measures.push({
      // 空行でも1行分の高さを持つので、最低1行として数える。
      lineCount: Math.max(1, Math.round(blockSize / linePitch)),
      linePitch,
      gapBefore,
    });
  }

  return measures;
}
