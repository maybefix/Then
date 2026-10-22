import {
  DEFAULT_MANUSCRIPT_SETTINGS,
  MANUSCRIPT_CHARACTERS_MAX,
  MANUSCRIPT_CHARACTERS_MIN,
  MANUSCRIPT_FONT_SIZE_MAX,
  MANUSCRIPT_FONT_SIZE_MIN,
  MANUSCRIPT_FONT_SIZE_OFFSET,
  MANUSCRIPT_LINES_MAX,
  MANUSCRIPT_LINES_MIN,
  type ManuscriptProgress,
  type ManuscriptSettings,
} from "../types";

/**
 * 原稿用紙モードの計算。
 *
 * 字詰めはCSS（1字＝1ic）、行の割りはブラウザ組版に任せ、ここでは
 * 測った結果の数え方と、欧文ランをセルへ揃える量だけを扱う。どれも
 * DOMに触れない純粋な計算なので、入力ごとに全文を見る処理は含まない。
 */

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 保存値を正規化する。原稿用紙の文字サイズがまだないとき（0.7.0 の最初の
 * 版で保存した設定など）は、通常の文字サイズ＋6 を使う。
 */
export function normalizeManuscriptSettings(value: unknown, bodyFontSize?: number): ManuscriptSettings {
  const source = (value && typeof value === "object" ? value : {}) as Partial<ManuscriptSettings>;
  const defaults = DEFAULT_MANUSCRIPT_SETTINGS;
  return {
    layoutMode: source.layoutMode === "manuscript" ? "manuscript" : "normal",
    charactersPerLine: clampInteger(
      source.charactersPerLine, MANUSCRIPT_CHARACTERS_MIN, MANUSCRIPT_CHARACTERS_MAX, defaults.charactersPerLine,
    ),
    linesPerPage: clampInteger(
      source.linesPerPage, MANUSCRIPT_LINES_MIN, MANUSCRIPT_LINES_MAX, defaults.linesPerPage,
    ),
    showGrid: typeof source.showGrid === "boolean" ? source.showGrid : defaults.showGrid,
    showPageBoundaries:
      typeof source.showPageBoundaries === "boolean" ? source.showPageBoundaries : defaults.showPageBoundaries,
    fontSize: clampInteger(
      source.fontSize, MANUSCRIPT_FONT_SIZE_MIN, MANUSCRIPT_FONT_SIZE_MAX,
      typeof bodyFontSize === "number" && Number.isFinite(bodyFontSize)
        ? Math.min(MANUSCRIPT_FONT_SIZE_MAX, Math.max(MANUSCRIPT_FONT_SIZE_MIN, Math.round(bodyFontSize + MANUSCRIPT_FONT_SIZE_OFFSET)))
        : defaults.fontSize,
    ),
  };
}

/** 物理行番号（1始まり）が載るページ（0始まり）。 */
export function manuscriptPageIndex(visualLineNumber: number, linesPerPage: number): number {
  return Math.floor((visualLineNumber - 1) / linesPerPage);
}

/** この行の後ろでページが終わるか。最終行のあとには境界を出さない。 */
export function endsManuscriptPage(visualLineNumber: number, linesPerPage: number, totalLines: number): boolean {
  return visualLineNumber > 0 && visualLineNumber < totalLines && visualLineNumber % linesPerPage === 0;
}

/** 組版済みの総行数から進み具合を出す。字数を400で割る概算は使わない。 */
export function manuscriptProgress(totalLines: number, linesPerPage: number): ManuscriptProgress {
  const lines = Math.max(0, Math.floor(totalLines));
  const fullPages = Math.floor(lines / linesPerPage);
  const usedLinesOnCurrentPage = lines - fullPages * linesPerPage;
  return { fullPages, currentPage: fullPages + 1, usedLinesOnCurrentPage, linesPerPage };
}

/** 枚数の表記。7ページ完了・8ページ目12行なら「7.6」。 */
export function formatManuscriptSheets(progress: ManuscriptProgress): string {
  const sheets = progress.fullPages + progress.usedLinesOnCurrentPage / progress.linesPerPage;
  // 1行でも書けば端数として見せる（切り上げ表示ではなく、小数1桁の切り捨て）。
  return (Math.floor(sheets * 10) / 10).toFixed(1);
}

/**
 * 欧文ラン：和文の中に続けて現れるラテン文字・数字・半角記号・半角空白。
 * 1つのランを1単位としてセル数を割り当てる（「あ b い」の「 b 」は1ラン）。
 * 全角文字や和文の約物は含まない（それらは1字＝1セルで送られる）。
 */
const LATIN_RUN = /[\u0020-\u007e\u00a1-\u024f\u2018\u2019\u201c\u201d]+/g;

export type LatinRun = { from: number; to: number; text: string };

export function findLatinRuns(text: string): LatinRun[] {
  const runs: LatinRun[] = [];
  LATIN_RUN.lastIndex = 0;
  for (let match = LATIN_RUN.exec(text); match; match = LATIN_RUN.exec(text)) {
    runs.push({ from: match.index, to: match.index + match[0].length, text: match[0] });
  }
  return runs;
}

/**
 * 行末でぶら下げる約物：句読点と閉じ括弧。続けて並ぶもの（「。」」など）は
 * まとめて1つのランにする（行末でまとめて欄外へ出す）。
 */
const HANGING_RUN = /[、。，．」』）〕］｝〉》】〙〗〟｣]+/g;
/**
 * ぶら下げの装飾は約物の後ろに空白を置くので、そこが改行できる位置になる。
 * 約物の直後で改行してはいけない字（リーダー・ダッシュ）が続くときは装飾せず、
 * これまでどおり追い出しに任せる。
 */
const NO_BREAK_AFTER_HANGING = /^[…‥—―]/;

export type HangingRun = { from: number; to: number; cells: number };

export function findHangingRuns(text: string): HangingRun[] {
  const runs: HangingRun[] = [];
  HANGING_RUN.lastIndex = 0;
  for (let match = HANGING_RUN.exec(text); match; match = HANGING_RUN.exec(text)) {
    const to = match.index + match[0].length;
    if (NO_BREAK_AFTER_HANGING.test(text.slice(to, to + 1))) continue;
    runs.push({ from: match.index, to, cells: match[0].length });
  }
  return runs;
}

/** 欧文の字形がセルの外へはみ出してよい量（セル幅に対する比）。 */
export const LATIN_OVERHANG = 0.1;

/**
 * 欧文ランの自然幅（em）を整数セル（1セル＝icEm em）へ揃えるための送りの調整量（em）。
 * 自然幅がセルの倍数をわずかに超えるだけなら、字形のはみ出しを許して
 * 少ないほうのセル数に収め、調整量は負（送りを詰める）になる。半角数字
 * 2字（約1.03字幅）が1セルに入るのはこのため。
 */
export function latinRunAdjustment(widthEm: number, icEm: number): { cells: number; adjustEm: number } {
  const cells = Math.max(1, Math.ceil(widthEm / icEm - LATIN_OVERHANG));
  return { cells, adjustEm: cells * icEm - widthEm };
}

export type RunMetricKey = {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  writingMode: "vertical-rl" | "horizontal-tb";
  text: string;
};

export type RunFontKey = Omit<RunMetricKey, "text">;

/**
 * 欧文ランの送り幅を条件ごとに覚えておく。
 *
 * 幅は実際の DOM で測る。Canvas の measureText は横組みの送り幅しか返さず、
 * 縦組みの欧文（横倒し）は Chromium が別の送り幅で組むため、1〜2% 食い違って
 * 後続の和文がセルからずれた。測るのは本文とは別の隠し要素（contain 付き）
 * で、本文のレイアウトには触れない。未計測のランは prepare() でまとめて
 * 1回のレイアウトで測り、以後はキャッシュから返す。フォント・文字サイズ・
 * 書字方向が変わればキーが変わるので、古い値は使われない。
 */
export class LatinRunMetrics {
  private widths = new Map<string, number>();
  private probe: HTMLElement | null = null;
  readonly stats = { measured: 0, reused: 0, layouts: 0 };

  constructor(private readonly host: HTMLElement | null, private readonly limit = 20000) {}

  private fontId(key: RunFontKey): string {
    return `${key.writingMode}|${key.fontStyle}|${key.fontWeight}|${key.fontSize}|${key.fontFamily}`;
  }

  private ensureProbe(): HTMLElement | null {
    if (this.probe?.isConnected) return this.probe;
    if (!this.host) return null;
    const probe = document.createElement("div");
    probe.className = "manuscriptMeasureProbe";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = [
      "position:absolute", "top:0", "left:0", "visibility:hidden", "pointer-events:none",
      "contain:layout style paint", "white-space:pre", "letter-spacing:0", "font-kerning:none",
      "text-orientation:mixed", "line-height:normal", "font-variant:normal",
    ].join(";");
    this.host.appendChild(probe);
    this.probe = probe;
    return probe;
  }

  clear(): void {
    this.widths.clear();
  }

  dispose(): void {
    this.probe?.remove();
    this.probe = null;
  }

  /** 未計測のランをまとめて測る。読み取りは最後に1回だけレイアウトを起こす。 */
  prepare(key: RunFontKey, runs: Iterable<string>): void {
    const font = this.fontId(key);
    const missing = new Set<string>();
    for (const text of runs) {
      if (!this.widths.has(`${font}|${text}`)) missing.add(text);
    }
    if (!this.widths.has(`${font}|水`)) missing.add("水");
    if (!missing.size) return;
    const probe = this.ensureProbe();
    if (!probe) {
      for (const text of missing) this.store(font, text, text === "水" ? key.fontSize : text.length * key.fontSize * 0.5);
      return;
    }
    probe.style.writingMode = key.writingMode;
    probe.style.fontFamily = key.fontFamily;
    probe.style.fontSize = `${key.fontSize}px`;
    probe.style.fontWeight = key.fontWeight;
    probe.style.fontStyle = key.fontStyle;
    const texts = Array.from(missing);
    const spans = texts.map((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    });
    probe.replaceChildren(...spans);
    const vertical = key.writingMode === "vertical-rl";
    spans.forEach((span, index) => {
      const rect = span.getBoundingClientRect();
      this.store(font, texts[index], vertical ? rect.height : rect.width);
    });
    probe.replaceChildren();
    this.stats.layouts++;
  }

  private store(font: string, text: string, widthPx: number): void {
    if (this.widths.size >= this.limit) this.widths.clear();
    this.widths.set(`${font}|${text}`, widthPx);
    this.stats.measured++;
  }

  private read(key: RunFontKey, text: string): number {
    const id = `${this.fontId(key)}|${text}`;
    let width = this.widths.get(id);
    if (width === undefined) {
      this.prepare(key, [text]);
      width = this.widths.get(id) ?? 0;
    } else {
      this.stats.reused++;
    }
    return width;
  }

  /** そのフォントの和文1字（「水」）の送り幅（em）。CSSの ic と同じ基準。 */
  icEm(key: RunFontKey): number {
    return this.read(key, "水") / key.fontSize || 1;
  }

  widthEm(key: RunMetricKey): number {
    return this.read(key, key.text) / key.fontSize;
  }
}
