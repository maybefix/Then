# 縦書きエディタ方針転換メモ

作成日: 2026-06-09

## 背景

Then では以下の2案を試したが、どちらも「完全縦書きタイプライタースクロール」の土台として不十分だった。

1. `textarea + writing-mode: vertical-rl`
2. `contenteditable="plaintext-only" + Range.getBoundingClientRect()`

このため、ブラウザ標準の可視編集要素を直接エディタ本体にする方針をやめる。

## 結論

次の方針へ転換する。

**可視編集面を textarea / contenteditable にしない。独自 text model と独自 vertical renderer を持ち、入力だけを EditContext または hidden textarea で受ける。**

優先順位:

1. Chromium/WebView2 向け: `EditContext API`
2. fallback: hidden textarea input bridge
3. 表示: DOM ベースの縦書き renderer
4. caret / selection / typewriter scroll: 自前描画・自前計算

この方針は、Monaco / Ace などの実績ある web editor が採っている「入力捕捉と表示レンダリングの分離」に寄せるもの。

## Web 調査からの根拠

### EditContext API

参照:

- https://developer.mozilla.org/en-US/docs/Web/API/EditContext
- https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API/Guide
- https://developer.chrome.com/blog/introducing-editcontext-api
- https://blogs.windows.com/msedgedev/2024/02/13/custom-web-editing-experiences-with-editcontext/
- https://www.w3.org/TR/edit-context/

要点:

- EditContext は、IME composition など高度な text input を web editor が扱うための API。
- DOM を直接編集せず、入力サービスと editor model をつなぐ。
- Chrome / Edge 121 以降で提供されている。
- Microsoft Edge チームと Chrome チームが、custom web editing experiences のために実装している。
- MDN は experimental / limited availability としているため、fallback は必須。

Then への判断:

- Then は Tauri on Windows / WebView2 が主対象なので、EditContext を第一候補にする価値がある。
- ただし WebView2 runtime のバージョン差があるため、必ず `typeof EditContext !== "undefined"` と `HTMLElement.prototype.editContext` 相当の feature detection を行う。
- 非対応なら hidden textarea bridge に落とす。

### Monaco / Ace 型の editor architecture

参照:

- https://microsoft.github.io/monaco-editor/
- https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IEditorScrollbarOptions.html
- https://microsoft.github.io/monaco-editor/typedoc/enums/editor.EditorOption.html
- https://ace.c9.io/api/classes/src_editor.Editor.html
- https://stackoverflow.com/questions/57525147/apply-monaco-editor-to-textarea-instead-of-div
- https://stackoverflow.com/questions/6440439/how-do-i-make-a-textarea-an-ACE-editor/19513428

要点:

- Monaco は textarea を editor 本体にせず、空 container に独自 editor を作る。
- Monaco / Ace のような editor は scroll、cursor、selection、rendering、input pipeline を editor 側が管理する。
- Ace API には cursor / selection / scroll / composition / text input が editor の明示的な責務として並んでいる。
- Stack Overflow の実務知見でも、Ace/Monaco は textarea を直接 editor 化するものではなく、別 container に editor を構築し textarea とは同期する考え方が示されている。

Then への判断:

- Then も textarea/contenteditable を直接可視編集面にするのをやめる。
- `.txt` 文字列は editor model に保持し、表示は renderer が作る。
- 入力だけを browser text input bridge に任せる。

### textarea / contenteditable の限界

参照:

- https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/setSelectionRange
- https://developer.mozilla.org/docs/Web/API/Selection
- https://developer.mozilla.org/en-US/docs/Web/API/Range/getBoundingClientRect
- https://developer.chrome.com/blog/introducing-editcontext-api

判断:

- textarea は selection offset API が安定しているが、可視 caret の rect を直接返さない。
- contenteditable は Range rect を取れるが、DOM 編集、IME、Undo/Redo、改行、React 再描画、縦書き scroll が絡むと制御不能になりやすい。
- Chrome の EditContext 記事は、既存の `<input>` / `<textarea>` / `contenteditable` は desired editing experience に不十分なことがあり、web-based editors は自分の view を持つ方向へ進んでいると説明している。

## 新アーキテクチャ

### 1. Editor Model

責務:

- 本文を単一の `string` として保持する。
- selection を `{ anchor: number; head: number }` で保持する。
- undo / redo stack を持つ。
- insert / delete / replace / paste / newline を command として適用する。
- 行、縦列、文字 offset の mapping を生成する。

初期版の制限:

- rich text は扱わない。
- 見出し装飾は renderer で後付けする。
- ルビ、禁則、ぶら下がり、縦中横は後続。

### 2. Layout Engine

責務:

- `text` を縦書き column に分解する。
- 各文字 offset に対して rect を持つ。
- 改行は明示的な column break として扱う。
- wrap は column height と font metrics から決める。
- caret offset から caret rect を返す。

初期版:

- monospace に近い固定 metrics で始める。
- `line-height` を column width として扱う。
- grapheme segmentation は `Intl.Segmenter` が使えれば使う。なければ `Array.from(text)`。
- font metrics は最初は CSS `font-size` / `line-height` から計算する。

### 3. Renderer

推奨は DOM renderer。

理由:

- canvas より accessibility と text selection の補助を作りやすい。
- CSS font rendering を使える。
- 開発初期の検証がしやすい。

構造案:

```text
.verticalEditorRoot
  .verticalScrollPort
    .verticalPageSurface
      .verticalColumn[]
        .verticalGlyph[]
      .verticalCaret
      .verticalSelectionLayer
      .verticalCompositionLayer
  .verticalInputBridge
```

重要:

- 可視 glyph は編集可能 DOM にしない。
- selection はネイティブ selection に頼らず、overlay で描く。
- caret も native caret に頼らず、absolute positioned element として描く。

### 4. Input Bridge

#### Primary: EditContext

使う条件:

- `EditContext` が存在する。
- Tauri / WebView2 で IME composition が安定する。

責務:

- `textupdate`
- `selectionchange`
- `compositionstart` / composition update 相当
- `updateText()`
- `updateSelection()`
- `updateControlBounds()`
- `updateSelectionBounds()`
- `updateCharacterBounds()`

方針:

- DOM は EditContext に直接編集させない。
- EditContext の text buffer と Then の editor model を同期する。
- composition range は renderer の composition layer で描く。

#### Fallback: hidden textarea

使う条件:

- EditContext がない。
- EditContext が WebView2 で不安定。

責務:

- key input / paste / IME composition を受ける。
- 入力文字を model command に変換する。
- textarea は可視編集面にしない。

注意:

- textarea の value 全文同期は重くなる可能性がある。
- 可能なら現在 selection 周辺だけを textarea に持つ方式を検討する。
- 初期版は全文同期でもよいが、大文書で性能検証する。

### 5. Typewriter Scroll

自前 layout なら当てずっぽうにしない。

手順:

1. model selection の `head` offset を得る。
2. layout engine から caret rect を得る。
3. scroll port rect を得る。
4. 目標 x を `scrollRect.right - scrollRect.width * offsetPercent / 100` とする。
5. `deltaX = caretRect.right - targetX` を計算する。
6. scroll port を `scrollLeft += deltaX` する。
7. layout が RTL/vertical でも、renderer 自前座標なので符号問題を持ち込まない。

ポイント:

- ブラウザの `Range.getBoundingClientRect()` に依存しない。
- CSS writing-mode の scrollLeft 符号差に依存しない。
- caret を固定位置へ寄せる計算が deterministic になる。

## 実装ステップ案

### Step A: 現行 contenteditable 版を凍結

- `VerticalTextEditor` は failed prototype として扱う。
- すぐ消すより、比較用として残すか、`DeprecatedVerticalTextEditor` にリネームして隔離する。
- App 本体は次の custom renderer に差し替える。

### Step B: Layout model prototype

コード対象:

- `src/editor/verticalModel.ts`
- `src/editor/verticalLayout.ts`

作るもの:

- text string
- selection offsets
- grapheme list
- columns
- offset to rect mapping
- caret rect

この段階では入力不要。固定 text を描画して typewriter scroll だけ検証する。

### Step C: DOM renderer prototype

コード対象:

- `src/VerticalCanvasTextEditor.tsx` ではなく、まず `src/VerticalCustomTextEditor.tsx`
- canvas ではなく DOM glyph renderer から始める。

作るもの:

- scroll port
- absolute positioned glyphs
- caret layer
- selection layer
- typewriter scroll

この段階では、クリックで caret 移動、キーボード入力なしでもよい。

### Step D: EditContext bridge

コード対象:

- `src/editor/EditContextInputBridge.ts`
- fallback として `src/editor/HiddenTextareaInputBridge.ts`

作るもの:

- feature detection
- textupdate -> model command
- selection update
- IME composition rendering
- control bounds / selection bounds / character bounds update

### Step E: Editing commands

作るもの:

- insert text
- newline
- backspace/delete
- paste
- arrow movement
- home/end
- undo/redo

### Step F: App integration

- `TextEditorHandle` は維持する。
- outline jump / snippet insert / save / dirty state を新 model command に接続する。

## 採用しないもの

- textarea を可視編集面にする。
- contenteditable を可視編集面にする。
- Range DOMRect に依存して typewriter scroll を作る。
- CSS writing-mode の native scroll を主機能にする。
- CodeMirror を縦書き化する。
- Lexical を可視編集面の最終解として採用する。

Lexical は Clara の実例として参考にはするが、今回 `contenteditable` 系が実機でダメだったため、Then の本命からは外す。

## 判断

Then の要件は「普通の web editor」ではなく、縦書き typewriter scroll が中核。したがって、ブラウザの editable DOM に寄せるより、Monaco/Ace/EditContext 型の custom editor として作るのが妥当。

実装コストは上がるが、これ以上 textarea/contenteditable の挙動を調整するより、失敗の種類を減らせる。

