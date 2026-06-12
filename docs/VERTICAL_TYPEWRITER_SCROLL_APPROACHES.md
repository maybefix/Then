# 縦書きタイプライタースクロール実装方針メモ

作成日: 2026-06-09

## 目的

Then の「完全縦書きタイプライタースクロール」は、現状の textarea 近似ではほぼ機能していない。実装に入る前に、外部事例とブラウザ API の制約を踏まえて、採るべきアプローチを整理する。

この文書は実装案の比較と推奨方針のみを扱う。コード実装は行わない。

## 結論

更新: 2026-06-09 の実機確認で `contenteditable="plaintext-only"` 方針も不採用にした。

新しい推奨は **独自 text model + 独自 vertical renderer + EditContext / hidden textarea input bridge**。

詳細は `docs/VERTICAL_EDITOR_ARCHITECTURE_REBOOT.md` を参照する。

旧推奨は以下だったが、現在は採用しない。

> `contenteditable` 系の編集面で caret の実 DOMRect を取得し、専用 scroll port を水平方向に制御する方式。

Then の txt-first 方針を踏まえると、最初に試すべき順序は次の通り。

1. `contenteditable="plaintext-only"` の小型プロトタイプ
2. 破綻する場合は Clara Editor と同じく Lexical PlainTextEditor 方式
3. textarea はフォールバックに留める
4. CodeMirror の縦書き継続は避ける

理由:

- `textarea` は `selectionStart` / `selectionEnd` / `setSelectionRange()` が安定している一方、caret の画面座標を直接取得できない。typewriter scroll を精密にするには mirror DOM が必要になり、縦書きでは実装が複雑になる。
- `contenteditable` は `Selection` / `Range` / `Range.getBoundingClientRect()` で caret 近傍の実座標を取りやすい。
- Clara Editor は Lexical + `contenteditable` + 横スクロール制御で縦書き小説エディタを成立させている。
- CodeMirror は横書きコードエディタとしての前提が強く、縦書きの selection / scroll / IME / block flow を Then の中心機能として安定させるにはコストが高い。

## 参照した外部事例

### m19e/clara-editor

Repository: https://github.com/m19e/clara-editor

確認した構成:

- `@lexical/react` / `lexical` を使った plain text editor
- `ContentEditable` を `writing-mode: vertical-rl` の親要素内に配置
- `react-perfect-scrollbar` を scroll port として使う
- wheel の `deltaY` を `scrollBy({ left: ... })` に変換し、縦書き本文を横方向にスクロール
- `AutoHorizontalScrollPlugin` で selection focus node の DOMRect を scroll port の DOMRect と比較し、必要に応じて `scrollIntoView()` を呼ぶ
- `VerticalPlugin` で矢印キーの意味を縦書き向けに差し替える

重要なファイル:

- https://github.com/m19e/clara-editor/blob/main/renderer/components/organisms/Editor.tsx
- https://github.com/m19e/clara-editor/blob/main/renderer/plugins/AutoHorizontalScrollPlugin.tsx
- https://github.com/m19e/clara-editor/blob/main/renderer/plugins/VerticalPlugin.tsx
- https://github.com/m19e/clara-editor/blob/main/renderer/lib/selection.ts
- https://github.com/m19e/clara-editor/blob/main/renderer/styles/globals.css

Clara から得られる示唆:

- 縦書き編集面では、scroll container を明確に分離する必要がある。
- 通常ホイールは縦方向 delta なので、縦書き本文では horizontal scroll へ変換する。
- `scrollIntoView()` は「見えるようにする」には使えるが、typewriter scroll のように caret を固定位置へ置くには不足する。
- 矢印キーは横書きの直感とずれるため、キー操作の再定義が必要になる。
- focus node の rect を使うだけでは、長い無改行テキスト内の caret 位置までは取れない。Clara もこのケースはコメント上「検出できない」としている。

### TateGaki VSCode extension

Marketplace: https://marketplace.visualstudio.com/items?itemName=KentaAratani.tategaki

確認できた範囲:

- `.txt` 専用の縦書き editor を VSCode webview で開く方式。
- 元の `.txt` と同期する。
- known issues として、複雑な文字組みや混在スクリプトは完全ではないと明記されている。

Then への示唆:

- txt 専用に割り切る判断は妥当。
- VSCode 本体の editor を縦書き化するのではなく、別の縦書き editor surface を用意して同期する形は、Then でも「通常 editor ライブラリを無理に縦書き化しない」根拠になる。

### Lexical

Repository: https://github.com/facebook/lexical

公式説明では、Lexical は単一の contenteditable 要素に editor instance を attach する editor framework。Clara はこの構成を使って縦書き plain text editor を作っている。

Then への示唆:

- textarea では足りないが、独自 editor model をフルスクラッチするほどでもない場合、Lexical plain text は現実的な中間案。
- Undo/Redo、selection、IME、history をある程度任せられる。
- ただし Then は Markdown rich editor ではないため、Lexical を入れるなら PlainTextPlugin 相当に限定する。

### contenteditable 系の小型ライブラリ

例:

- https://github.com/FormidableLabs/use-editable
- https://github.com/lovasoa/react-contenteditable

示唆:

- React と contenteditable の同期は素朴にやると壊れやすいため、何らかの selection 保存・復元や DOM 差分制御が必要。
- Then が装飾を最小にするなら、ライブラリ導入より `contenteditable="plaintext-only"` の薄い adapter を先に作る価値がある。
- 装飾や補完が増えるなら、小型ライブラリより Lexical の方が長期的に安全。

## ブラウザ API と制約

### `writing-mode: vertical-rl`

MDN と Chrome Developers は、縦書きフォームコントロールに `writing-mode: vertical-rl` を適用できると説明している。

- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/writing-mode
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Writing_modes/Vertical_controls
- https://developer.chrome.com/blog/vertical-form-controls

ただし、`writing-mode` は文字の流れと block flow を変えるだけで、editor として必要な caret 固定、IME、矢印キー、typewriter scroll を自動で提供するものではない。

### textarea

MDN:

- https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/setSelectionRange

利点:

- 文字列取得が単純。
- `selectionStart` / `selectionEnd` / `setSelectionRange()` が安定している。
- IME と Undo/Redo はブラウザ標準に乗りやすい。

問題:

- caret の画面上の DOMRect を直接取れない。
- `Range.getBoundingClientRect()` を textarea 内のテキストに直接使えない。
- 精密な typewriter scroll には、textarea と同じ font / line-height / writing-mode / wrapping を持つ mirror DOM が必要。
- 縦書き mirror は横書き textarea mirror よりずれやすい。

判断:

- 現在の Then の textarea 実装は、入力面としては残せるが、完全 typewriter scroll の本命ではない。

### contenteditable / Selection / Range

MDN:

- https://developer.mozilla.org/docs/Web/API/Selection
- https://developer.mozilla.org/en-US/docs/Web/API/Range/getBoundingClientRect

利点:

- caret または selection の Range から画面座標を取得できる。
- 縦書き DOM の実レイアウト結果を測れる。
- typewriter scroll の固定位置計算に必要な `caretRect` を作りやすい。

問題:

- Undo/Redo、IME、改行、貼り付け、React 再描画との相性を慎重に扱う必要がある。
- `contenteditable="plaintext-only"` は txt-first に合うが、ブラウザ差と IME の検証が必要。
- collapsed Range の rect が空になるケースがある。その場合は一時 marker span を挿入して測る必要がある。

判断:

- Then の主機能を成立させるには、textarea より contenteditable 系が向いている。

## 実装アプローチ候補

### A. textarea + mirror DOM

概要:

- 実入力は textarea。
- 同じ text / style / width / writing-mode の hidden mirror DOM を作る。
- caret index までの文字列を mirror に流し、末尾に marker span を置いて `getBoundingClientRect()` する。
- marker rect をもとに scrollLeft を調整する。

長所:

- 入力、IME、Undo/Redo、文字列保存が安定しやすい。
- 現在の Then 実装から差分が小さい。

短所:

- 縦書き mirror の再現が難しい。
- wrapping、禁則、句読点、英数字、フォント fallback、padding、scroll offset がずれると caret 追従が壊れる。
- textarea のネイティブ selection と mirror の layout を同期し続ける必要がある。

採用判断:

- 短期の改善としてはあり。
- 「完全縦書きタイプライタースクロール」の本命にはしない。

### B. `contenteditable="plaintext-only"` + Range rect

概要:

- 実入力面を `contenteditable="plaintext-only"` にする。
- DOM は可能な限り単純にし、保存文字列は `textContent` から取得する。
- selectionchange / beforeinput / input / keyup / compositionend で rAF に scroll 補正を予約する。
- collapsed selection の Range rect を取得し、scroll port 内の固定 x 座標に寄せる。
- rect が取れない場合のみ一時 marker span を差し込んで測る。

長所:

- 実 caret 位置を直接測れる。
- `writing-mode: vertical-rl` の実レイアウト結果に従える。
- Then の fake Markdown 方針なら、rich text model を持たずに済む。

短所:

- 改行正規化、貼り付け、Undo/Redo、IME、React 再描画との境界が難しい。
- selection 保存・復元を自前で持つ必要がある。

採用判断:

- 最初に検証すべき本命プロトタイプ。
- 2日程度で「IME、改行、typewriter scroll」が通らないなら Lexical に移る。

### C. Lexical PlainText + Clara 型 horizontal scroll

概要:

- Clara と同様に Lexical PlainTextPlugin + ContentEditable を使う。
- editor state / history / selection / input handling は Lexical に寄せる。
- Then 側は plain text serialization、outline extraction、scroll plugin、vertical keymap を持つ。
- typewriter scroll は Clara の node-level `scrollIntoView()` より一段精密にし、caret Range または marker rect を使って固定位置へ scrollBy する。

長所:

- Clara という先行実装がある。
- Undo/Redo、selection、IME まわりを完全自作しなくてよい。
- 将来、見出し装飾や検索ハイライトを重ねる余地がある。

短所:

- 依存が増える。
- Then の txt-first に対して editor framework がやや重い。
- Lexical の state と `.txt` 文字列の同期設計が必要。

採用判断:

- `contenteditable plaintext-only` が Undo/IME/selection で破綻した場合の本命。
- Clara の実装は参考にするが、Then では scrollIntoView ではなく typewriter 固定位置を実装する。

### D. 独自 text model + hidden textarea + canvas/DOM renderer

概要:

- 入力は hidden textarea で受ける。
- 文書は独自 text model。
- 表示は DOM または canvas で完全制御。
- caret、selection、IME composition、Undo/Redo を自前実装する。

長所:

- 縦書き typewriter scroll、禁則、ルビ、見出し表示を完全制御できる。

短所:

- 実装コストが非常に高い。
- IME とアクセシビリティが難しい。
- 現段階の Then には過剰。

採用判断:

- 初期版では採用しない。
- 将来、商用執筆ツール並みの組版制御が必要になった場合の最終手段。

### E. CodeMirror 縦書き継続

概要:

- CodeMirror に `writing-mode: vertical-rl` を当て、coordsAtPos / scrollIntoView を使う。

長所:

- 既存の検索、履歴、keymap を使える。

短所:

- 現在すでに、改行、縦幅、scroll container、typewriter scroll が破綻している。
- CodeMirror は縦書き prose editor を主目的にしていない。
- `.cm-scroller` と外側 layout の責務分離が難しい。

採用判断:

- 採用しない。

## 推奨アーキテクチャ

### Editor surface

- `VerticalTextEditor` を新設する。
- 内部実装は最初 `contenteditable="plaintext-only"`。
- 成功しなければ同じ外部 API のまま Lexical 実装へ差し替える。

Then 側に公開する API:

- `getText(): string`
- `setText(text: string): void`
- `getSelection(): { from: number; to: number; head: number }`
- `replaceRange(from, to, text): void`
- `focus(): void`
- `jumpToLine(line): void`
- `scrollCaretToTypewriterLine(offsetPercent): void`

### DOM layout

- `.editor` は overflow hidden。
- `.verticalScrollPort` は唯一の scroll container。
- `.verticalEditable` は `writing-mode: vertical-rl`。
- wheel は `deltaY` を horizontal scroll に変換する。
- scroll port と editable の padding は CSS logical properties で管理する。

### Typewriter scroll algorithm

イベント:

- `selectionchange`
- `input`
- `keyup`
- `pointerup`
- `compositionend`
- editor state update

制御:

1. IME composition 中は原則スクロール補正しない。
2. collapsed selection でない場合は補正しない。
3. rAF で 1 フレームに 1 回だけ実行する。
4. Selection から Range を作る。
5. `range.getBoundingClientRect()` で caret rect を取る。
6. rect が空なら一時 marker を挿入して測る。
7. `scrollPort.getBoundingClientRect()` を取る。
8. 目標 x 座標を `scrollRect.right - scrollRect.width * offsetPercent / 100` とする。
9. `deltaX = caretRect.right - targetX` を計算する。
10. scrollLeft の正負差を吸収する adapter 経由で `scrollByX(deltaX)` する。

補足:

- `scrollIntoView()` は fallback としてのみ使う。
- fixed typewriter line を作るには、`scrollIntoView()` ではなく `scrollBy()` で目標位置へ寄せる。
- scrollLeft の符号は vertical/rtl 系で差が出るため、初期化時に probe 要素で検出する。

### Vertical keymap

最低限:

- `ArrowUp` / `ArrowDown`: 同じ縦行内の前後文字へ移動
- `ArrowLeft` / `ArrowRight`: 前後の縦行へ移動
- `Ctrl+ArrowUp/Down`: 単語移動
- `Home/End`: 縦行の先頭/末尾

Clara は Lexical command と `Selection.modify()` を使っている。ただし `Selection.modify()` は非標準寄りなので、Then では WebView2 対象に限定して検証し、Firefox 等への一般化は後回しでよい。

### IME policy

- `compositionstart` から `compositionend` までは typewriter scroll を抑制する。
- composition 中にどうしても caret が見切れる場合のみ、低頻度で `scrollIntoView()` fallback を使う。
- `compositionend` の次 rAF で固定位置補正を実行する。
- 入力イベントで React state を即時再描画しすぎない。contenteditable の DOM と React state の責務を分ける。

## 検証プロトタイプ計画

### Prototype 1: plaintext contenteditable

目的:

- Then の最小要求を満たせるか判断する。

検証項目:

- 日本語 IME 入力
- 改行
- 長文で右から左へ列が増えること
- caret rect 取得
- typewriter scroll 固定位置
- 選択範囲
- 貼り付け時の plain text 化
- Undo/Redo
- outline jump
- snippet insert

成功条件:

- 1000 行程度の txt で入力、改行、スクロールが破綻しない。
- IME 変換中に表示位置が大きく暴れない。
- caret が指定 offset 付近に戻る。

失敗条件:

- IME 中に文字が欠落する。
- Undo/Redo が壊れる。
- selection 復元が頻繁にずれる。
- React 再描画と DOM 編集が衝突する。

### Prototype 2: Lexical PlainText

目的:

- Prototype 1 が selection / undo / IME で不安定な場合の代替。

検証項目:

- Clara と同じ vertical container + horizontal scroll
- PlainTextPlugin の text serialization
- custom typewriter scroll plugin
- vertical keymap plugin
- snippet insert command
- outline jump command

成功条件:

- Prototype 1 の失敗点が解消される。
- 依存追加に見合う安定性がある。

## Then における段階的判断

### 短期

- 現在の textarea 実装を「暫定入力面」として扱う。
- typewriter scroll の完成扱いを取り消す。
- `contenteditable plaintext-only` プロトタイプを作る。

### 中期

- contenteditable が通れば textarea を置き換える。
- contenteditable が破綻すれば Lexical PlainText へ移行する。
- Clara の `AutoHorizontalScrollPlugin` / `VerticalPlugin` を設計参考にし、Then 用に typewriter 固定位置へ拡張する。

### 長期

- ルビ、禁則、見出し装飾、原稿用紙表示などを入れるなら、Lexical または独自 renderer を再検討する。
- txt-first のままなら、rich editor 化は避ける。

## 推奨する次アクション

1. `textarea` 版を「暫定」と明記する。完了。
2. `VerticalContentEditablePrototype` を作る。`VerticalTextEditor` として本体へ初期実装済み。
3. scroll port / editable / caret marker / signed scroll adapter を最小実装する。完了。
4. 日本語 IME と長文入力を Browser + Tauri 実機で確認する。未完了。
5. 通れば本体へ差し替え、通らなければ Lexical PlainText へ進む。判定待ち。

## 2026-06-09 実装メモ

- `src/VerticalTextEditor.tsx` を追加し、textarea 版を置き換えた。
- 実装したもの:
  - `contenteditable="plaintext-only"` の編集面
  - `textContent` ベースの txt serialization
  - selection offset と DOM selection の相互変換
  - `Range.getBoundingClientRect()` と marker span による caret rect 測定
  - horizontal scroll port
  - wheel delta の horizontal scroll 変換
  - `scrollLeft` 正負差の fallback
  - IME composition 中の scroll 抑制
- 次に見るべきもの:
  - Tauri / WebView2 での日本語 IME 入力
  - Enter 改行が `\n` として保持されるか
  - Undo/Redo が contenteditable 内で自然に残るか
  - 長文入力時に caret が指定 offset へ戻るか
  - `contenteditable="plaintext-only"` 非対応時の fallback

## 採用しない方針

- CodeMirror に `writing-mode` を当て続けて調整する方針。
- textarea の行数近似だけで「完全 typewriter scroll」とする方針。
- 初期版から独自 editor engine を作る方針。
- `scrollIntoView()` だけで typewriter scroll を名乗る方針。
