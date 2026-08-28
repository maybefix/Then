import { type CSSProperties, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { VerticalTextEditor } from "./VerticalTextEditor";

const SOURCE = String.raw`C:\Users\uest\Documents\テスト_snapshot検証用\02_ログ\Then開発ログ.txt`;
const SCENARIO = new URLSearchParams(window.location.search).get("scenario") ?? "paging";
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
  composing: boolean;
  compositionLength: number;
  shellComposing: string | null;
  snapType: string;
  nudgeKind: number;
  overflowBelow: number;
  overflowAbove: number;
  caretTop: number | null;
  caretBottom: number | null;
  caretLeft: number | null;
  caretRight: number | null;
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

    let composingNode: Text | null = null;
    let composing = false;
    let nudgeKind = 0;
    let compositionLength = 0;
    const onCompositionStart = () => {
      composing = true;
      compositionLength = 0;
    };
    const onCompositionUpdate = (event: Event) => {
      composing = true;
      compositionLength = (event as CompositionEvent).data?.length ?? 0;
    };
    const onCompositionEnd = () => {
      composing = false;
      compositionLength = 0;
    };
    document.addEventListener("compositionstart", onCompositionStart, true);
    document.addEventListener("compositionupdate", onCompositionUpdate, true);
    document.addEventListener("compositionend", onCompositionEnd, true);
    let imeStartedAt: number | null = null;

    const beginFakeComposition = () => {
      // 現在ページの最後の段落の末尾へキャレットを置く。
      const paragraphs = [...document.querySelectorAll<HTMLElement>(".pm-root p")];
      const host = document.querySelector<HTMLElement>(".verticalTypewriterEditor");
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      const onPage = paragraphs.filter((p) => {
        const r = p.getBoundingClientRect();
        return r.bottom >= hostRect.top && r.top <= hostRect.bottom && r.right >= hostRect.left && r.left <= hostRect.right;
      });
      const target = onPage[onPage.length - 1] ?? paragraphs[0];
      if (!target) return;
      const text = [...target.childNodes].reverse().find((n): n is Text => n.nodeType === Node.TEXT_NODE);
      if (!text) return;
      composingNode = text;
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const dom = document.querySelector<HTMLElement>(".pm-root");
      dom?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    };

    const growFakeComposition = () => {
      const node = composingNode;
      const dom = document.querySelector<HTMLElement>(".pm-root");
      if (!node || !dom) return;
      node.appendData("ああああああああああ");
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(node, node.length);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      dom.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: node.data }));
    };

    const endFakeComposition = () => {
      const dom = document.querySelector<HTMLElement>(".pm-root");
      dom?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
      composingNode = null;
    };

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
      if (SCENARIO === "imelive") {
        // 実IMEで打ち込むモード。変換中に「本文を折り返させる」ための小突きを
        // 3種類、20フレームずつ順番に試して overflowBelow の変化を見る。
        if (composing) {
          nudgeKind = Math.floor(frame / 20) % 4;
          const composingParagraph = (() => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            let node: Node | null = sel.getRangeAt(0).startContainer;
            while (node && !(node instanceof HTMLElement && node.tagName === "P")) node = node.parentNode;
            return node instanceof HTMLElement ? node : null;
          })();
          const contentHeightPx = Number.parseFloat(getComputedStyle(surface).getPropertyValue("--paged-content-height")) || 0;
          if (nudgeKind === 1) {
            // 段の内寸をわずかに揺らして再分割を促す
            root.style.height = `${contentHeightPx - 0.01}px`;
          } else if (nudgeKind === 2) {
            root.style.height = "";
            // 変換中の段落へ折り返し幅をpxで明示する
            if (composingParagraph) composingParagraph.style.maxInlineSize = `${contentHeightPx}px`;
          } else if (nudgeKind === 3) {
            if (composingParagraph) {
              composingParagraph.style.maxInlineSize = "";
              // 段落だけをいったんフロー外へ出して戻す（再ライン分割を強制）
              composingParagraph.style.display = "inline-block";
              void composingParagraph.offsetWidth;
              composingParagraph.style.display = "";
            }
          } else {
            root.style.height = "";
            if (composingParagraph) composingParagraph.style.maxInlineSize = "";
          }
        } else {
          nudgeKind = 0;
          root.style.height = "";
        }
        // 計測結果を定期的に書き出す。
        if (frame > 0 && frame % 45 === 0) {
          void invoke("save_text_file", {
            path: TRACE.replace(".json", "-imelive.json"),
            content: JSON.stringify({ source: SOURCE, frames: frames.slice(-900) }, null, 2),
          });
        }
      } else if (SCENARIO === "ime") {
        // 変換中のページ追従を見る。まず中ほどのページまで戻り、そのページの
        // 最後の段落の末尾へキャレットを置いてから、DOMへ直接「あ」を足しつつ
        // compositionupdate を投げる（実IMEの前編集と同じく doc は触らない）。
        if (imeStartedAt === null) {
          if (frame >= 60 && frame % 24 === 12) {
            if (metrics.current > 3) {
              scroller.dispatchEvent(
                new WheelEvent("wheel", { deltaY: -120, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true }),
              );
              wheelDispatches += 1;
            } else {
              imeStartedAt = frame;
              beginFakeComposition();
            }
          }
        } else {
          const since = frame - imeStartedAt;
          if (since > 0 && since <= 240 && since % 10 === 0) growFakeComposition();
          else if (since === 270) endFakeComposition();
        }
      } else if (frame >= 60 && frame % 24 === 12) {
        // ファイルを開いた直後（キャレットは文末＝最終ページ）から先頭まで戻し、
        // もう一度最終ページまで送る。動画で報告された「開いてから最終ページまで
        // スクロールすると本文だけが下へずれる」経路をそのままなぞる。
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
      // 本文（可視の行矩形）がページ枠の本文領域からどれだけはみ出しているか。
      const contentTop = hostRect.top + paddingY;
      const contentBottom = hostRect.bottom - paddingY;
      const overflowBelow = visibleTextBottom === null ? 0 : Math.max(0, visibleTextBottom - contentBottom);
      const overflowAbove = visibleTextTop === null ? 0 : Math.max(0, contentTop - visibleTextTop);
      const domSelection = window.getSelection();
      let caretRect: { top: number; bottom: number; left: number; right: number } | null = null;
      if (domSelection && domSelection.rangeCount > 0) {
        const r = domSelection.getRangeAt(0).getBoundingClientRect();
        caretRect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }
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
        composing,
        compositionLength,
        shellComposing: shell.getAttribute("data-composing"),
        snapType: getComputedStyle(scroller).scrollSnapType,
        nudgeKind,
        overflowBelow: Math.round(overflowBelow * 100) / 100,
        overflowAbove: Math.round(overflowAbove * 100) / 100,
        caretTop: caretRect ? r(caretRect.top) : null,
        caretBottom: caretRect ? r(caretRect.bottom) : null,
        caretLeft: caretRect ? r(caretRect.left) : null,
        caretRight: caretRect ? r(caretRect.right) : null,
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

      if (SCENARIO === "imelive" ? frame >= 40000 : SCENARIO === "ime" ? imeStartedAt !== null && frame >= imeStartedAt + 330 : (finalReachedAt !== null && frame >= finalReachedAt + 180) || frame >= 1500) {
        await invoke("save_text_file", {
          path: SCENARIO === "ime" ? TRACE.replace(".json", "-ime.json") : TRACE,
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
      document.removeEventListener("compositionstart", onCompositionStart, true);
      document.removeEventListener("compositionupdate", onCompositionUpdate, true);
      document.removeEventListener("compositionend", onCompositionEnd, true);
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
