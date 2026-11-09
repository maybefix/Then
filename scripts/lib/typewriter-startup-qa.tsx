import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { VerticalTextEditor, type TextEditorHandle } from "../../src/VerticalTextEditor";
import { DEFAULT_MANUSCRIPT_SETTINGS, type WritingMode } from "../../src/types";
import "../../src/App.css";
import "../../src/styles/themes/index.css";

// The real editor, synthetic text, and no Tauri/document persistence.
const options = new URLSearchParams(location.search);
const mode = (options.get("mode") ?? "vertical-rl") as WritingMode;
const scenario = options.get("case") ?? "baseline";
const offset = Number(options.get("offset") ?? 63);
const typewriter = scenario !== "saved-viewport-off";
const restoringCaret = scenario === "saved-caret" || scenario === "saved-empty-caret";
const sample = Array.from({ length: 120 }, (_, i) =>
  `段落${i}　「縦書きの中央位置を検証します。」` +
  "これは確認用の文章です。AI Code、English typography 123。".repeat(6),
).join("\n") + (scenario === "saved-empty-caret" ? "\n" : "");
let handle: TextEditorHandle | null = null;
let readyAt = 0;
let fontLoaded = false;
const viewport = options.has("captured") ? JSON.parse(options.get("captured")!) : restoringCaret ? {
  textLength: sample.length, writingMode: mode,
  anchorOffset: sample.length, anchorRatio: 0.6297252774871749,
} : options.has("viewport") ? {
  textLength: sample.length, writingMode: mode,
  anchorOffset: typewriter ? sample.length - 600 : Math.floor(sample.length / 2), anchorRatio: 0.42,
} : null;

function snapshot() {
  if (!handle) return null;
  const scroller = document.querySelector<HTMLElement>(".verticalTypewriterScroller")!;
  const root = document.querySelector<HTMLElement>(".pm-root")!;
  const area = scroller.getBoundingClientRect();
  const selection = handle.getSelection();
  let caret = handle.coordsAtPos(selection.head)!;
  // In vertical text, the public caret rectangle can be on the other column
  // edge. Read the final glyph directly, independently of the scroll code.
  if (mode === "vertical-rl" && selection.head === sample.length) {
    const last = root.lastElementChild!;
    if (!last.textContent) {
      caret = last.getBoundingClientRect();
    } else {
      const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
      let node: Node | null, final: Node | null = null;
      while ((node = walker.nextNode())) if (node.textContent?.length) final = node;
      const range = document.createRange();
      const size = final!.textContent!.length;
      range.setStart(final!, size - 1);
      range.setEnd(final!, size);
      caret = range.getBoundingClientRect();
    }
  }
  const horizontal = mode === "horizontal-tb";
  const start = horizontal ? area.top : area.left;
  const size = horizontal ? area.height : area.width;
  const center = horizontal ? (caret.top + caret.bottom) / 2 : (caret.left + caret.right) / 2;
  const anchor = viewport ? handle.coordsAtPos(viewport.anchorOffset)! : null;
  return {
    elapsed: performance.now() - readyAt,
    width: area.width, height: area.height, delta: center - (start + size * offset / 100),
    anchorDelta: anchor && viewport
      ? (horizontal ? (anchor.top + anchor.bottom) / 2 : (anchor.left + anchor.right) / 2) -
        (start + size * viewport.anchorRatio) : null,
    scroll: horizontal ? scroller.scrollTop : scroller.scrollLeft,
    selection: selection.head, textLength: handle.getValue().length,
    composing: handle.isComposing(), fontLoaded,
  };
}

async function loadLateFont(metricsOnly = false) {
  const font = new FontFace("Startup Late Font",
    metricsOnly ? 'local("YuMincho-Regular"), local("Yu Mincho Regular"), local("Yu Mincho")'
      : `url("/late-font.otf?${Date.now()}")`,
    { display: "swap", ...(metricsOnly ? { ascentOverride: "88%", descentOverride: "12%" } : {}) });
  document.fonts.add(font);
  document.querySelector<HTMLElement>(".appShell")!.style.setProperty(
    "--editor-font-family", '"Startup Late Font", "Yu Mincho", serif');
  await font.load();
  fontLoaded = true;
}

function Harness() {
  const [full, setFull] = useState(scenario !== "decorations");
  const ready = useCallback((value: TextEditorHandle | null) => {
    handle = value;
    if (!value) return;
    readyAt = performance.now();
    // App reapplies the stored typewriter setting on mount. This must not
    // cancel the initial settle or replace a saved viewport with the caret.
    requestAnimationFrame(() => value.scrollCaretIntoView(offset));
    if (scenario.startsWith("width-")) setTimeout(() => {
      document.querySelector<HTMLElement>("#column")!.style.flex = "0 0 calc(100% - 360px)";
    }, Number(scenario.slice(6)));
    if (scenario === "font") void loadLateFont();
    if (scenario === "metrics") setTimeout(() => void loadLateFont(true), 800);
    if (scenario === "decorations") setTimeout(() => setFull(true), 800);
  }, []);
  return <main className="appShell" data-theme="newsroom-light" data-writing-mode={mode}
    style={{ "--editor-font-size": restoringCaret ? "17px" : "24px", "--editor-line-height": restoringCaret ? 1.55 : 1.8,
      "--editor-measure-v-ratio": 0.84, "--editor-measure-h-ratio": 0.85,
      "--editor-font-family": '"Yu Mincho", serif', "--typewriter-guide-position": `${offset}%` } as React.CSSProperties}>
    <section className="appFrame" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <section className="workspace" style={{ minHeight: 0, flex: 1 }}>
        <div className="editorColumn" id="column" style={restoringCaret ? { flex: "0 0 1192px" } : undefined}><div className="editorFrame"><div className="editor">
          <VerticalTextEditor text={sample} editorRevision={null} writingMode={mode}
            editorDisplayMode="continuous" pageFlowDirection="vertical" typewriterScroll={typewriter} showTypewriterGuide
            typewriterOffset={offset} showLineBreakMarks={false} showLineNumbers={full}
            highlightCurrentLine={false} colorizeJapaneseQuotes showComments textLayoutSignature={mode}
            initialSelectionOffset={sample.length} initialViewportState={viewport}
            manuscript={DEFAULT_MANUSCRIPT_SETTINGS} onReady={ready}
            onTextChange={() => {}} onSelectionChange={() => {}} />
        </div></div></div>
      </section>
    </section>
  </main>;
}

Object.assign(window, { __startup: {
  run: options.get("run"), snapshot, capture: () => handle!.getViewportState(), resize: () => {
    document.querySelector<HTMLElement>("#column")!.style.flex = "0 0 calc(100% - 360px)";
  },
  notifyFonts: () => document.fonts.dispatchEvent(new Event("loadingdone")),
  select: () => handle!.selectRange(sample.length - 80, sample.length - 20),
} });
createRoot(document.getElementById("root")!).render(<Harness />);
