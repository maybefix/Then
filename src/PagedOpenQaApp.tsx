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
  fragmentY: string;
  computedTransformY: number;
  recomputedBase: number | null;
  visibleTextTop: number | null;
  visibleTextBottom: number | null;
  wheelDispatches: number;
};

type PageMetrics = { current: number; total: number };

export default function PagedOpenQaApp() {
  const [text, setText] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const metricsRef = useRef<PageMetrics>({ current: 1, total: 1 });

  useEffect(() => {
    void invoke<string>("read_text_file", { path: SOURCE }).then(setText);
  }, []);

  useEffect(() => {
    if (!ready || text === null) return;
    let cancelled = false;
    let frameId = 0;
    let frame = 0;
    let wheelDispatches = 0;
    let finalReachedAt: number | null = null;
    const frames: Frame[] = [];

    const capture = async () => {
      if (cancelled) return;
      const shell = document.querySelector<HTMLElement>(".verticalTypewriterShell");
      const scroller = shell?.querySelector<HTMLElement>(".verticalTypewriterScroller");
      const host = shell?.querySelector<HTMLElement>(".verticalTypewriterEditor");
      const root = host?.querySelector<HTMLElement>(".pm-root");
      if (!shell || !scroller || !host || !root) {
        frameId = requestAnimationFrame(() => void capture());
        return;
      }

      if (frame >= 60 && frame % 24 === 12 && metricsRef.current.current < metricsRef.current.total) {
        scroller.dispatchEvent(
          new WheelEvent("wheel", { deltaY: 120, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true }),
        );
        wheelDispatches += 1;
      }

      const transform = getComputedStyle(root).transform;
      const computedTransformY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      const hostRect = host.getBoundingClientRect();
      const first = root.firstElementChild instanceof HTMLElement ? root.firstElementChild : null;
      const paddingY = Number.parseFloat(getComputedStyle(shell).getPropertyValue("--paged-padding-y")) || 0;
      const recomputedBase = first
        ? hostRect.top + paddingY - (first.getBoundingClientRect().top - computedTransformY)
        : null;
      const visibleRects: DOMRect[] = [];
      for (const paragraph of root.querySelectorAll("p")) {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        for (const rect of range.getClientRects()) {
          if (rect.bottom >= hostRect.top && rect.top <= hostRect.bottom) visibleRects.push(rect);
        }
        range.detach();
      }
      const metrics = metricsRef.current;
      frames.push({
        frame,
        current: metrics.current,
        total: metrics.total,
        scrollTop: scroller.scrollTop,
        fragmentY: root.style.getPropertyValue("--paged-fragment-y"),
        computedTransformY,
        recomputedBase,
        visibleTextTop: visibleRects.length ? Math.min(...visibleRects.map((rect) => rect.top)) : null,
        visibleTextBottom: visibleRects.length ? Math.max(...visibleRects.map((rect) => rect.bottom)) : null,
        wheelDispatches,
      });
      if (metrics.current === metrics.total && finalReachedAt === null) finalReachedAt = frame;
      frame += 1;

      if ((finalReachedAt !== null && frame >= finalReachedAt + 180) || frame >= 900) {
        await invoke("save_text_file", {
          path: TRACE,
          contents: JSON.stringify({ source: SOURCE, textLength: text.length, finalReachedAt, wheelDispatches, frames }, null, 2),
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
