import { type CSSProperties, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { VerticalTextEditor } from "./VerticalTextEditor";

const SOURCE = String.raw`C:\Users\uest\Documents\テスト_snapshot検証用\02_ログ\Then開発ログ.txt`;
const TRACE = String.raw`C:\Users\uest\Documents\then\.tmp\paged-video-regression-trace.json`;

type Frame = {
  frame: number;
  current: number;
  total: number;
  scrollTop: number;
  hostY: number;
  fragmentY: number;
  columnStep: number;
  paddingY: number;
  rootOffsetTop: number;
  lastOffsetTop: number;
  // レイアウト座標で見た「ページ枠の本文上端」と断片位置のズレ。0が正しい。
  layoutError: number;
  hostTop: number | null;
  hostScrollTop: number;
  hostScrollLeft: number;
  computedTransformY: number;
  rootRectTop: number | null;
  firstRectTop: number | null;
  lastRectTop: number | null;
  paintAnomaly: number | null;
  firstLineLabel: string | null;
  visibleTextTop: number | null;
  visibleTextBottom: number | null;
  // 実描画で見た本文上端のズレ（hostTop + paddingY からの差）。0が正しい。
  paintedError: number | null;
  wheelDispatches: number;
  frame_geometry: Record<string, unknown>;
};

type PageMetrics = { current: number; total: number };

export default function PagedOpenQaApp() {
  const [text, setText] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const metricsRef = useRef<PageMetrics>({ current: 1, total: 1 });

  useEffect(() => {
    void invoke<{ content: string }>("read_text_file", { path: SOURCE }).then((doc) => setText(doc.content));
  }, []);

  useEffect(() => {
    if (!ready || text === null) return;
    let cancelled = false;
    let frameId = 0;
    let frame = 0;
    let wheelDispatches = 0;
    let finalReachedAt: number | null = null;
    let reachedFirstPage = false;
    const frames: Frame[] = [];

    const capture = async () => {
      if (cancelled) return;
      const shell = document.querySelector<HTMLElement>(".verticalTypewriterShell");
      const scroller = shell?.querySelector<HTMLElement>(".verticalTypewriterScroller");
      const surface = shell?.querySelector<HTMLElement>(".verticalTypewriterPageSurface");
      const host = shell?.querySelector<HTMLElement>(".verticalTypewriterEditor");
      const root = host?.querySelector<HTMLElement>(".pm-root");
      if (!shell || !scroller || !surface || !host || !root) {
        frameId = requestAnimationFrame(() => void capture());
        return;
      }

      const metrics = metricsRef.current;
      // ファイルを開いた直後（キャレットは文末＝最終ページ）から先頭まで戻し、
      // もう一度最終ページまで送る。動画で報告された「開いてから最終ページまで
      // スクロールすると本文だけが下へずれる」経路をそのままなぞる。
      if (frame >= 60 && frame % 24 === 12) {
        const goingUp = !reachedFirstPage;
        if (goingUp && metrics.current <= 1) reachedFirstPage = true;
        const delta = reachedFirstPage ? 120 : -120;
        if (!(reachedFirstPage && metrics.current >= metrics.total)) {
          scroller.dispatchEvent(
            new WheelEvent("wheel", { deltaY: delta, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true }),
          );
          wheelDispatches += 1;
        }
      }

      const surfaceStyle = getComputedStyle(surface);
      const num = (name: string) => Number.parseFloat(surfaceStyle.getPropertyValue(name)) || 0;
      const paddingY = num("--paged-padding-y");
      const columnStep = num("--paged-content-height") + num("--paged-column-gap");
      const fragmentY = Number.parseFloat(root.style.getPropertyValue("--paged-fragment-y")) || 0;
      const hostY = Number.parseFloat(host.style.getPropertyValue("--paged-host-y")) || 0;
      const last = root.lastElementChild instanceof HTMLElement ? root.lastElementChild : null;
      const layoutError =
        root.offsetTop + (metrics.current - 1) * columnStep + fragmentY - paddingY;

      const hostRect = host.getBoundingClientRect();
      const rootStyle = getComputedStyle(root);
      const matrix = rootStyle.transform === "none" ? null : new DOMMatrixReadOnly(rootStyle.transform);
      const computedTransformY = matrix ? matrix.m42 : 0;
      const first = root.firstElementChild instanceof HTMLElement ? root.firstElementChild : null;
      const firstRectTop = first ? first.getBoundingClientRect().top : null;
      const lastRectTop = last ? last.getBoundingClientRect().top : null;
      const visibleRects: DOMRect[] = [];
      for (const paragraph of root.querySelectorAll("p")) {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        for (const rect of range.getClientRects()) {
          if (rect.bottom >= hostRect.top && rect.top <= hostRect.bottom) visibleRects.push(rect);
        }
        range.detach();
      }
      const visibleTextTop = visibleRects.length ? Math.min(...visibleRects.map((rect) => rect.top)) : null;
      const visibleTextBottom = visibleRects.length ? Math.max(...visibleRects.map((rect) => rect.bottom)) : null;
      const lineLayer = document.querySelector<HTMLElement>(".visibleLineNumberLayer");
      const firstLineLabel = lineLayer?.firstElementChild?.textContent ?? null;
      const r = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
      frames.push({
        frame,
        current: metrics.current,
        total: metrics.total,
        scrollTop: scroller.scrollTop,
        hostY,
        fragmentY,
        columnStep,
        paddingY,
        rootOffsetTop: root.offsetTop,
        lastOffsetTop: last ? last.offsetTop : -1,
        layoutError: Math.round(layoutError * 100) / 100,
        hostTop: r(hostRect.top),
        hostScrollTop: host.scrollTop,
        hostScrollLeft: host.scrollLeft,
        computedTransformY,
        rootRectTop: r(root.getBoundingClientRect().top),
        firstRectTop: r(firstRectTop),
        lastRectTop: r(lastRectTop),
        // 描画座標とレイアウト座標のズレ（0なら transform どおりに描かれている）
        paintAnomaly:
          firstRectTop === null
            ? null
            : Math.round((firstRectTop - hostRect.top - computedTransformY - root.offsetTop) * 100) / 100,
        firstLineLabel,
        visibleTextTop,
        visibleTextBottom,
        paintedError:
          visibleTextTop === null ? null : Math.round((visibleTextTop - hostRect.top - paddingY) * 100) / 100,
        wheelDispatches,
        frame_geometry: (() => {
          const sc = scroller.getBoundingClientRect();
          const sheets = shell.querySelectorAll<HTMLElement>(".pagedEditorSheet");
          const sheet = sheets[Math.max(0, metrics.current - 1)];
          const sr = sheet ? sheet.getBoundingClientRect() : null;
          const frameEl = document.querySelector<HTMLElement>(".editorFrame");
          const fr = frameEl ? frameEl.getBoundingClientRect() : null;
          return {
            scrollerTop: r(sc.top), scrollerBottom: r(sc.bottom), clientH: scroller.clientHeight,
            clientW: scroller.clientWidth, scrollerLeft: r(sc.left), scrollerRight: r(sc.right),
            sheetTop: sr ? r(sr.top) : null, sheetBottom: sr ? r(sr.bottom) : null,
            sheetLeft: sr ? r(sr.left) : null, sheetRight: sr ? r(sr.right) : null,
            frameTop: fr ? r(fr.top) : null, frameBottom: fr ? r(fr.bottom) : null,
            frameLeft: fr ? r(fr.left) : null, frameRight: fr ? r(fr.right) : null,
            dpr: window.devicePixelRatio,
          };
        })(),
      });
      if (reachedFirstPage && metrics.current === metrics.total && finalReachedAt === null) finalReachedAt = frame;
      frame += 1;

      if ((finalReachedAt !== null && frame >= finalReachedAt + 180) || frame >= 1500) {
        await invoke("save_text_file", {
          path: TRACE,
          content: JSON.stringify({ source: SOURCE, textLength: text.length, finalReachedAt, wheelDispatches, frames }, null, 2),
        });
        await getCurrentWindow().close();
        return;
      }
      frameId = requestAnimationFrame(() => void capture());
    };

    frameId = requestAnimationFrame(() => void capture());
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [ready, text]);

  const shellStyle = {
    "--editor-font-family": '"BIZ UDゴシック"',
    "--ui-font-family": '"BIZ UDゴシック"',
    "--ui-font-scale": 1.05,
    "--editor-font-size": "17px",
    "--editor-line-height": 1.55,
    "--editor-measure-h-ratio": 0.85,
    "--editor-measure-v-ratio": 0.81,
    "--editor-heading-font-family": '"BIZ UDゴシック"',
  } as CSSProperties;

  return (
    <main className="appShell" data-theme="newsroom-light" data-writing-mode="vertical-rl" style={shellStyle}>
      <section className="appFrame" aria-label="Then paging regression QA">
        <section className="workspace">
          <div className="editorColumn">
            <div className="editorFrame">
              <div className="editor">
                {text !== null && (
                  <VerticalTextEditor
                    text={text}
                    editorRevision={null}
                    writingMode="vertical-rl"
                    editorDisplayMode="paged"
                    pageFlowDirection="vertical"
                    typewriterScroll
                    showTypewriterGuide={false}
                    typewriterOffset={46}
                    showLineBreakMarks={false}
                    showLineNumbers
                    highlightCurrentLine={false}
                    colorizeJapaneseQuotes={false}
                    textLayoutSignature={'"BIZ UDゴシック"|body|"游ゴシック"|17|1.55|85|81'}
                    initialSelectionOffset={text.length}
                    initialViewportState={null}
                    onReady={() => setReady(true)}
                    onTextChange={() => undefined}
                    onSelectionChange={() => undefined}
                    onPageMetricsChange={(metrics) => {
                      if (metrics) metricsRef.current = metrics;
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
