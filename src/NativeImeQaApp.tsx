import { useCallback, useRef, useState, type CSSProperties } from "react";
import { VerticalTextEditor, type TextEditorHandle } from "./VerticalTextEditor";
import { DEFAULT_MANUSCRIPT_SETTINGS, type WritingMode, type EditorDisplayMode } from "./types";

const sample = (long: boolean) => long
  ? ["入力試験。ここへ日本語を入力します。", ...Array.from({ length: 1500 }, (_, i) =>
    `段落${i + 1}　「縦書きの入力と変換候補を確かめます。」` + "文章を書きながら表示とスクロールの追従を比較します。".repeat(3))].join("\n")
  : "入力試験。ここへ日本語を入力します。\n「括弧」、ルビ｜東京《とうきょう》、**強調**。\n別の段落でも入力します。";

/** No documents are opened or saved: this is the real editor with synthetic text. */
export default function NativeImeQaApp() {
  const [text, setText] = useState(() => sample(false));
  const [writing, setWriting] = useState<WritingMode>("vertical-rl");
  const [display, setDisplay] = useState<EditorDisplayMode>("continuous");
  const [manuscript, setManuscript] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const handle = useRef<TextEditorHandle | null>(null);
  const ready = useCallback((value: TextEditorHandle | null) => { handle.current = value; }, []);
  const changed = useCallback((value: string, nextRevision: number) => { setText(value); setRevision(nextRevision); }, []);
  const replace = (long: boolean) => { setRevision(null); setText(sample(long)); };
  return <main className="appShell" data-theme="newsroom-light" data-writing-mode={writing}
    style={{ "--editor-font-size": "24px", "--editor-line-height": 1.8, "--editor-font-family": '"Yu Mincho", serif' } as CSSProperties}>
    <section className="appFrame" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 10, flexShrink: 0 }}>
        <strong>TSF入力比較（保存しない試験文書）</strong>
        <button onClick={() => replace(false)}>短文</button>
        <button onClick={() => replace(true)}>10万字以上</button>
        <button onClick={() => setWriting(writing === "vertical-rl" ? "horizontal-tb" : "vertical-rl")}>{writing === "vertical-rl" ? "縦書き" : "横書き"}</button>
        <button onClick={() => setDisplay(display === "continuous" ? "paged" : "continuous")}>{display === "continuous" ? "連続表示" : "ページ表示"}</button>
        <button onClick={() => setManuscript(!manuscript)}>{manuscript ? "原稿用紙ON" : "原稿用紙OFF"}</button>
        <span>{text.length.toLocaleString()}字</span>
        <a href="/?native-ime=1">通常画面で比較</a>
      </div>
      <section className="workspace" style={{ minHeight: 0, flex: 1 }}>
        <div className="editorColumn"><div className="editorFrame"><div className="editor">
          <VerticalTextEditor text={text} editorRevision={revision} writingMode={writing}
            editorDisplayMode={display} pageFlowDirection="vertical" typewriterScroll
            showTypewriterGuide={false} typewriterOffset={46} showLineBreakMarks={false}
            showLineNumbers highlightCurrentLine={false} colorizeJapaneseQuotes showComments
            textLayoutSignature={`${writing}|24|1.8`} initialSelectionOffset={0}
            manuscript={{ ...DEFAULT_MANUSCRIPT_SETTINGS, layoutMode: manuscript ? "manuscript" : "normal" }}
            onReady={ready} onTextChange={changed} onSelectionChange={() => {}} />
        </div></div></div>
      </section>
    </section>
  </main>;
}
