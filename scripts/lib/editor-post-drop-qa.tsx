import React, { useCallback } from "react";
import { createRoot } from "react-dom/client";
import { VerticalTextEditor, type TextEditorHandle } from "../../src/VerticalTextEditor";
import { CANVAS_POST_DRAG_MIME } from "../../src/canvasTypes";
import { PostStreamPane } from "../../src/components/posts/PostStreamPane";
import type { PostStream } from "../../src/posts/usePostStream";
import { DEFAULT_MANUSCRIPT_SETTINGS, type WritingMode } from "../../src/types";
import "../../src/App.css";
import "../../src/styles/themes/index.css";

// U6（docs/BINDER_POST_DRAG_SEARCH_PLAN.md）: 本物のエディタに、投稿の ID を運ぶ drop を送る。
const options = new URLSearchParams(location.search);
const mode = (options.get("mode") ?? "vertical-rl") as WritingMode;
const text = "朝の港。\n船が出る。";
const posts = new Map([
  ["p1", "灯台の夢\n波の音が遠い"],
  ["p2", "港で拾った言葉"],
]);
let handle: TextEditorHandle | null = null;

/** offset の文字の、行の向きで先の 1/4 の点（その文字の前に落ちる所）。 */
function pointBefore(offset: number) {
  const root = document.querySelector<HTMLElement>(".pm-root")!;
  let rest = offset;
  for (const paragraph of Array.from(root.children)) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const size = node.textContent?.length ?? 0;
      if (rest < size) {
        const range = document.createRange();
        range.setStart(node, rest);
        range.setEnd(node, rest + 1);
        const rect = range.getBoundingClientRect();
        return mode === "horizontal-tb"
          ? { x: rect.left + rect.width / 4, y: (rect.top + rect.bottom) / 2 }
          : { x: (rect.left + rect.right) / 2, y: rect.top + rect.height / 4 };
      }
      rest -= size;
    }
    rest -= 1; // 段落の区切り（改行）
  }
  throw new Error(`no character at ${offset}`);
}

/** offset の文字の箱（K2 の印の位置を比べる）。 */
function charRect(offset: number) {
  const { x, y } = pointBefore(offset);
  const range = document.caretRangeFromPoint?.(x, y);
  const node = range?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const char = document.createRange();
  char.setStart(node, range!.startOffset);
  char.setEnd(node, range!.startOffset + 1);
  const rect = char.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
}

function dragEvent(type: string, offset: number | null, data: Record<string, string>) {
  const { x, y } = offset === null ? { x: 2, y: 2 } : pointBefore(offset);
  const transfer = new DataTransfer();
  for (const [kind, value] of Object.entries(data)) transfer.setData(kind, value);
  const target = offset === null ? document.querySelector(".pm-root")! : document.elementFromPoint(x, y) ?? document.querySelector(".pm-root")!;
  const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer,
    relatedTarget: offset === null ? document.body : null });
  target.dispatchEvent(event);
}

/** K2: 落とす位置の印（見えていれば、その画面上の箱）。 */
function marker() {
  const element = document.querySelector<HTMLElement>(".editorDropMarker");
  if (!element || getComputedStyle(element).display === "none") return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function drop(offset: number, data: Record<string, string>) {
  const { x, y } = pointBefore(offset);
  const transfer = new DataTransfer();
  for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
  const target = document.elementFromPoint(x, y) ?? document.querySelector(".pm-root")!;
  const event = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer });
  target.dispatchEvent(event);
  return { prevented: event.defaultPrevented };
}

function Harness() {
  const ready = useCallback((value: TextEditorHandle | null) => { handle = value; }, []);
  const postBody = useCallback((id: string) => posts.get(id) ?? null, []);
  return <main className="appShell" data-theme="newsroom-light" data-writing-mode={mode}
    style={{ "--editor-font-size": "28px", "--editor-line-height": 1.8,
      "--editor-measure-v-ratio": 0.84, "--editor-measure-h-ratio": 0.85,
      "--editor-font-family": '"Yu Mincho", serif' } as React.CSSProperties}>
    <section className="appFrame" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <section className="workspace" style={{ minHeight: 0, flex: 1 }}>
        <div className="editorColumn"><div className="editorFrame"><div className="editor">
          <VerticalTextEditor text={text} editorRevision={null} writingMode={mode}
            editorDisplayMode="continuous" pageFlowDirection="vertical" typewriterScroll={false} showTypewriterGuide={false}
            typewriterOffset={50} showLineBreakMarks={false} showLineNumbers={false}
            highlightCurrentLine={false} colorizeJapaneseQuotes showComments textLayoutSignature={mode}
            initialSelectionOffset={text.length} initialViewportState={null}
            manuscript={DEFAULT_MANUSCRIPT_SETTINGS} onReady={ready}
            postBodyForDrop={postBody}
            onTextChange={() => {}} onSelectionChange={() => {}} />
        </div></div></div>
      </section>
    </section>
  </main>;
}

// 狭いペイン（docs/BINDER_POST_DRAG_SEARCH_PLAN.md の 4）: 本物の PostStreamPane と CSS を、ペインの幅で描く。
function PaneHarness({ width }: { width: number }) {
  const work = { id: "w-a", name: "作品A" };
  const stream = {
    scoped: true, available: true, work,
    posts: [{ id: "p2", at: "2026-11-22T07:13:00+09:00", body: "港で拾った言葉", work: { id: "w-b", name: "作品B" },
      filed: false, noted: false, hash: "h" }],
    add: async () => true, editBody: async () => true, setFiled: async () => {}, remove: async () => {}, refresh: async () => {},
  } as unknown as PostStream;
  const boards = new Map([["p2", [{ folderPath: "C:/lib/作品B", folderName: "作品B", isLibraryRoot: false, boardId: "b", boardName: "取材", nodeId: "n" }]]]);
  return <main className="appShell" data-theme="newsroom-light">
    <aside className="rightSidebar" style={{ width, position: "static" }}>
      <PostStreamPane stream={stream} filter="all" onFilterChange={() => {}} onMakeNote={() => {}} boards={boards} onOpenBoard={() => {}} />
    </aside>
  </main>;
}

function measurePane() {
  const row = document.querySelector<HTMLElement>(".postItem")!;
  const rect = (selector: string) => row.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
  const work = row.querySelector<HTMLElement>(".postWork")!;
  return {
    workWidth: rect(".postWork").width,
    workTruncated: work.scrollWidth > work.clientWidth + 1,
    boardWidth: rect(".postBoardTag").width,
    headTop: rect(".postHead").top,
    headBottom: rect(".postHead").bottom,
    buttonsTop: rect(".ideaFragmentBtns").top,
    buttonsRight: rect(".ideaFragmentBtns").right,
    footRight: rect(".postFoot").right,
  };
}

Object.assign(window, { __drop: {
  measurePane,
  charRect,
  marker,
  dragOverPost: (offset: number) => dragEvent("dragover", offset, { [CANVAS_POST_DRAG_MIME]: "p1" }),
  dragOver: (offset: number, data: Record<string, string>) => dragEvent("dragover", offset, data),
  dragLeave: () => dragEvent("dragleave", null, { [CANVAS_POST_DRAG_MIME]: "p1" }),
  ready: () => Boolean(handle && document.querySelector(".pm-root")?.textContent),
  value: () => handle!.getValue(),
  selection: () => handle!.getSelection(),
  focus: () => handle!.focus(),
  caretAt: (offset: number) => handle!.selectRange(offset, offset),
  drop,
  post: (offset: number, id: string, extra: Record<string, string> = {}) => drop(offset, { [CANVAS_POST_DRAG_MIME]: id, ...extra }),
  compose: (on: boolean) => document.querySelector(".pm-root")!.dispatchEvent(
    new CompositionEvent(on ? "compositionstart" : "compositionend", { bubbles: true, data: "ふね" })),
  composing: () => handle!.isComposing(),
} });
createRoot(document.getElementById("root")!).render(options.has("pane")
  ? <PaneHarness width={Number(options.get("pane"))} />
  : <Harness />);
