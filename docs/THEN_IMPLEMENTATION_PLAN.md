# Then 実装計画

作成日: 2026-06-08

作業ブランチ: `codex/then`

## 目的

`brew` の既存実装を土台に、新しいアプリ `Then` として、Markdown 執筆アプリから txt ベースの縦書き執筆環境へ進化させる。

Then では Markdown を主保存形式として扱わない。`.txt` を標準にしつつ、既存資産を読めるよう `.md` も開ける。ただし、Markdown の積極的な構文パースや WYSIWYG 化は行わず、見出しと最低限のインデントだけを「偽 Markdown 記法」として再現する。

## 現状認識

- フロントエンドは Tauri v2 + React + TypeScript + Vite。
- エディタは CodeMirror ベースだが、`CodeMirrorMarkdownEditor` と `vendor/silkdown` が Markdown パース、装飾、ショートカットを担っている。
- 状態型、Tauri コマンド名、ファイルダイアログ、保存拡張子、フォルダ一覧が `Markdown` / `.md` 前提になっている。
- タブ、パンくず、スニペットは実用最小版として存在するが、Then で求める VSCode 風デザインと左右パネルの表示切替には再設計が必要。
- typewriter scroll は横書き前提の DOM 計算で実装されているため、縦書きでは scroll axis、caret 座標、余白計算を作り直す必要がある。

## プロダクト方針

### アプリ名

- 表示名、Tauri productName、ウィンドウタイトル、パッケージ名を段階的に `Then` / `then` へ移行する。
- 既存の `brew.app-state.v1` は初回移行用に読み取り可能にするが、Then 側の新しい保存キーを用意する。
- プロジェクト設定フォルダ `.brew` は将来的に `.then` へ移行する。初期実装では `.brew` 読み取り互換を残す。

### 文書モデル

- 標準文書型は `TextDocument` とする。
- 標準保存拡張子は `.txt`。
- `.md` は開けるが、Markdown として深く解釈しない。
- 内部状態名は `markdown` から `text` へ移行する。
- Tauri command は新しい `*_text_file*` 系を追加し、既存 `*_markdown_file*` 系は互換期間だけラップとして残す。

### 偽 Markdown 記法

対応する最小記法:

- 見出し: Markdown 準拠の `#` から `######` まで。
- 見出し構造: `#` の数を階層として扱い、パンくず/アウトラインに反映する。
- インデント: 行頭半角スペースを最低限そのまま視覚表現する。

対応しない、または積極的に扱わない記法:

- 強調、リンク、画像、リスト、引用、コードブロック、表、HTML、タスクチェックボックス。
- Markdown 補完や Markdown 固有ショートカット。
- frontmatter の積極的な編集 UI。既存文書に含まれている場合は本文として扱うか、互換フェーズでのみ保持する。

## 主要実装フェーズ

## 実装進捗

### ステップ5以降の検証ルール

- ステップ5以降は、各ステップの最後に `npm run tauri:build` を実行してインストーラーをビルドする。
- インストーラー生成先は `src-tauri/target/release/bundle/` とする。
- ビルド済みインストーラーでの起動確認は、必要に応じて後続の実機確認ステップで行う。

### 2026-06-09 実装済み

- Then 化の土台を追加した。
  - `package.json` / `package-lock.json` の package name を `then` に変更した。
  - `src-tauri/tauri.conf.json` の `productName`、`identifier`、window title を Then 用に変更した。
  - `index.html` とアプリ上部の表示名を `Then` に変更した。
  - 永続化キーを `then.app-state.v1` に変更し、ブラウザ実行時は旧 `brew.app-state.v1` からの読み取り互換を残した。
  - `TextDocument` 型を追加し、既存 `MarkdownDocument` は互換 alias として残した。
- `.txt` ファイル I/O を追加した。
  - Tauri command として `open_text_file_dialog`、`read_text_file`、`save_text_file_dialog`、`save_text_file`、`list_project_text_files`、`create_text_file` を追加した。
  - 既存 `*_markdown_file*` command は互換ラッパとして残した。
  - ファイルダイアログは `Text` / `txt` を標準、`Markdown` / `md` を互換フィルタにした。
  - 保存ダイアログの既定名を `untitled.txt` にした。
  - フォルダ一覧は `.txt` と `.md` の両方を対象にした。
  - 新規 scratch / 新規ファイルの UI 文言と既定名を `.txt` 標準へ変更した。
- 検証:
  - `npm run build` 成功。
  - `cargo check` 成功。

### 2026-06-09 ステップ3実装

- 偽 Markdown エディタの初期実装として、本文エディタを `CodeMirrorTextEditor` へ切り替えた。
  - `CodeMirrorMarkdownEditor` を `CodeMirrorTextEditor` に置き換えた。
  - `silkdown()`、Markdown parser、Markdown keymap、`vendor/silkdown/theme.css` の読み込みをエディタ本体から外した。
  - CodeMirror は当面プレーンテキスト編集基盤として継続し、`history()`、検索 keymap、標準 keymap、line wrapping のみを使う。
  - `parseMarkdownOutline` を `parseTextOutline` に改名し、`#` から `######` の見出し抽出だけを維持した。
  - CSS から silkdown 用の見出し、リンク、リスト、表、HTML 装飾セレクタを削除した。
- 注意:
  - `vendor/silkdown` と Markdown 関連 npm dependencies は、参照切り離し後も TypeScript のコンパイル対象に残るため、このステップでは削除しない。削除は不要ファイル整理の別ステップで行う。
  - frontmatter 互換 UI は現時点では残す。Then 方針に合わせた削除または本文扱いへの変更は後続で判断する。

### 2026-06-09 ステップ4初期実装

- 本文エリアを縦書き表示へ切り替えた。
  - `.editor .cm-editor` に `writing-mode: vertical-rl` と `text-orientation: mixed` を適用した。
  - エディタ外枠は `overflow-x: auto` / `overflow-y: hidden` に変更し、縦書きの主スクロール軸を横方向へ切り替えた。
  - `.editorContent` は右側始点の余白と左側終端余白を CSS 変数で持つようにした。
- typewriter scroll の計算を縦書き向けに変更した。
  - 旧実装の `scrollTop`、`coords.top`、上下 padding を使う計算をやめた。
  - `coordsAtPos()` の `right` と `scrollLeft` を使い、caret を右からの水平方向 offset に寄せる計算へ変更した。
  - IME composition 中と範囲選択中はスクロール補正しない既存制御を維持した。
- 注意:
  - CodeMirror の縦書きにおける `scrollLeft` の符号とブラウザ差は実機確認が必要。破綻する場合は `textarea` / `contenteditable plaintext-only` への切り替え判断に戻る。
  - ドラッグ挿入の drop indicator はまだ縦書き専用位置計算にしていない。
- 検証:
  - `npm run build` 成功。
  - `cargo check` 成功。
  - `http://127.0.0.1:5173/` のブラウザ確認で `.cm-content` / `.cm-editor` が `writing-mode: vertical-rl` になっていることを確認した。
  - テスト入力で改行と行頭半角スペースが `.cm-line` 上に保持されることを確認した。
  - 入力中に `.editor.scrollLeft` が変化し、縦書き typewriter scroll の横方向補正が発火することを確認した。

### 2026-06-09 ステップ5初期実装

- VSCode 風パンくず刷新の初期実装を入れた。
  - ファイル/フォルダの breadcrumb popover がナビ全体ではなく各 segment 直下に開くようにした。
  - outline popover も現在見出し segment 直下に開くようにした。
  - breadcrumb menu を暗色のコンパクトなリストへ調整し、選択行のハイライトとアイコン表示を維持した。
  - 既存の新規タブ、並び替え、リネーム、削除操作は行末ツールとして控えめに残した。
  - ArrowUp / ArrowDown / Home / End によるメニュー内フォーカス移動を追加した。
- 注意:
  - Enter 選択はブラウザ標準の focused button activation に任せる。Esc で閉じる既存挙動は維持している。
  - ファイル管理操作の最終配置は後続の UI 再設計でさらに整理する。
- 検証:
  - `npm run build` 成功。

### 2026-06-09 ステップ6初期実装

- タブ刷新の初期実装を入れた。
  - `TabRail` を `DocumentTabs` へ改名し、開いている文書を扱うパネルとして役割を明確化した。
  - ヘッダーに開いている文書数を表示した。
  - タブ行に文書アイコン、ファイル名、保存先パス、保存状態 dot を表示するようにした。
  - dirty / error / active / close / new tab の既存動作を維持した。
  - 縦書きエディタとの相性を優先し、今回は上部横タブではなく左側パネル型を維持した。
- 注意:
  - 多数タブ時の overflow は縦スクロールで維持している。折りたたみ表示はステップ7で扱う。
  - 実行ファイル名は Rust crate 名の `brew.exe` のまま。配布物名は Then になっている。
- 検証:
  - `npm run build` 成功。
  - `cargo check` 成功。
  - `npm run tauri:build` 成功。

### 2026-06-09 縦書きタイプライタースクロール再検証

- ステップ4の CodeMirror 縦書き初期実装は、実用水準に達していないため採用しない。
  - 改行後に内容が消えたように見える、縦幅がエディタ領域と一致しない、typewriter scroll が安定しない問題を確認した。
  - CodeMirror の `.cm-scroller` と外側 `.editor` の overflow / height / padding が縦書きのスクロール軸と噛み合っていなかった。
  - CodeMirror はプレーンテキスト編集機能としては強いが、Then の核である縦書き typewriter editing では座標計算とスクロール制御の不確実性が大きい。
- Web 検証結果:
  - MDN の `writing-mode` は、テキスト行の配置方向とブロック進行方向を制御する CSS として説明されており、`vertical-rl` は Then の右から左へ流れる本文方向に合う。
  - MDN の vertical form controls と Chrome Developers の解説では、`textarea` に `writing-mode: vertical-rl` を適用でき、複数行が右から左へ進むフォームとして扱えることが確認できる。
  - CodeMirror 公式リファレンスには `coordsAtPos()` や `scrollIntoView()` はあるが、縦書き本文を安定編集するための保証は見当たらない。
  - CodeMirror discussion では `.cm-scroller { overflow: auto }` と固定 height が必要とされており、今回の外側スクロール前提の実装と相性が悪いことを確認した。
- 実装修正:
  - 本文編集面を `TextAreaTextEditor` に差し替え、ネイティブ `textarea + writing-mode: vertical-rl` を使う。
  - `CodeMirrorTextEditor` は削除し、アクティブな編集経路から CodeMirror を外す。
  - `.editorContent` と `.textAreaTextEditor` の高さ/幅を 100% に固定し、textarea 自身を唯一のスクロールコンテナにする。
  - typewriter scroll は textarea の現在行数から縦列位置を近似し、`scrollLeft` の正負差を吸収して横方向へ補正する。
  - outline jump、スニペット挿入、選択取得は `selectionStart` / `selectionEnd` ベースへ移行した。
- 残課題:
  - textarea は caret の画面座標を直接返す標準 API が弱いため、typewriter scroll は現時点では行数ベースの近似である。
  - ドラッグした位置への厳密な挿入は未実装で、現在選択位置への挿入にフォールバックしている。
  - 精密な caret 固定が必要なら、mirror DOM 計測または `contenteditable plaintext-only` の追加検証を行う。
- 追加検討:
  - 外部事例と実装アプローチは `docs/VERTICAL_TYPEWRITER_SCROLL_APPROACHES.md` にまとめた。
  - 現時点の推奨は、textarea を最終解にせず、`contenteditable plaintext-only` で caret DOMRect を測るプロトタイプを作り、破綻する場合は Clara Editor と同じ Lexical PlainText 方式へ進むこと。

### 2026-06-09 contenteditable 版 typewriter scroll 実装

- `docs/VERTICAL_TYPEWRITER_SCROLL_APPROACHES.md` の Prototype 1 方針に従い、本文編集面を `VerticalTextEditor` へ差し替えた。
  - `contenteditable="plaintext-only"` を使い、txt-first の編集面を維持する。
  - `Selection` / `Range.getBoundingClientRect()` で collapsed caret の DOMRect を取得する。
  - collapsed Range が空 rect を返す場合は、一時 marker span を挿入して caret 位置を測定する。
  - scroll port と editable を分離し、scroll port を唯一の horizontal scroll container にした。
  - wheel の `deltaY` を horizontal scroll へ変換する。
  - `scrollLeft` の正負差に備え、最初の scroll が効かない場合は反対方向へ再試行する adapter を追加した。
  - IME composition 中は typewriter scroll 補正を止め、composition end 後に selection change 経由で補正する。
- 既存連携:
  - outline jump は文字 offset へ変換して selection を移動する。
  - snippet insert は selection offset ベースで本文を置換する。
  - drop position は `caretPositionFromPoint()` / `caretRangeFromPoint()` が使える場合に文字 offset へ変換する。
- 注意:
  - `contenteditable` の Undo/Redo、IME、貼り付け、改行正規化は実機確認が必要。
  - Browser 自動入力環境が安定しない場合は、Tauri インストーラー版で手入力確認を行う。
  - 長い無改行テキストでは、caret rect が取得できても列計算とスクロール体験が悪化する可能性がある。

### 2026-06-09 方針転換: custom renderer 方式

- 実機確認で `contenteditable="plaintext-only"` 版も Then の中核機能として不十分と判断した。
- 追加 Web 調査の結果、次の方針へ転換する。
  - 可視編集面を textarea / contenteditable にしない。
  - Monaco / Ace 型のように、入力捕捉と表示レンダリングを分離する。
  - 独自 text model と独自 vertical renderer を持つ。
  - Chromium/WebView2 では EditContext API を第一候補にする。
  - EditContext 非対応時は hidden textarea input bridge に fallback する。
  - caret / selection / typewriter scroll は renderer の layout mapping から自前計算する。
- 詳細は `docs/VERTICAL_EDITOR_ARCHITECTURE_REBOOT.md` にまとめた。
- 現行 `VerticalTextEditor` は failed prototype として扱い、次ステップでは本体から custom renderer へ差し替える。

### 2026-06-09 Lexical 版縦書きエディタ実装

- custom renderer 方針は実装規模が大きすぎるため、先に Clara Editor 型の Lexical PlainText 実装へ転換した。
  - 依存として `lexical`、`@lexical/react`、`@lexical/utils`、`@lexical/selection` を追加した。
  - `VerticalTextEditor` を Lexical Composer / PlainTextPlugin / ContentEditable / HistoryPlugin ベースに差し替えた。
  - App から見える `TextEditorHandle` は維持した。
  - scroll port は維持し、wheel `deltaY` を horizontal scroll へ変換する。
  - caret 追従は Lexical root DOM 上の collapsed selection rect を測定し、scroll port の右側 offset へ寄せる。
  - Clara と同様、縦書き用 keymap として左右キーを line 移動、上下キーを character 移動に差し替えた。
  - 既存の snippet insert / outline jump / drop position は DOM text offset ベースで接続した。
- 注意:
  - Lexical 版はビルド通過済みだが、Tauri/WebView2 上での日本語 IME、Enter 改行、Undo/Redo、長文 typewriter scroll の実機確認が必要。
  - Lexical 版で失敗した場合でも、ただちに縦書き編集を諦めるのではなく、失敗点を切り分けて次の代替案を決める。

### 2026-06-10 指定 HTML 版の採用

- `C:/Users/uest/Downloads/tategaki-typewriter.html` で縦書きタイプライタースクロールが成立しているため、これを実装の基準として採用した。
- Lexical 版は撤回し、追加していた Lexical dependencies も削除した。
- `VerticalTextEditor` は指定 HTML の構成を React wrapper 化した。
  - `scroller` 相当の横スクロール外枠。
  - `editor` 相当の `contenteditable="true"` 本文。
  - `caretRect()`。
  - `centerCaret()`。
  - `target` / `requestAnimationFrame(step)` による滑らかな追従。
  - `wheel` の縦回転から `scrollLeft -= d` への変換。
  - `paste` の plain text 化。
  - `Ctrl+S` の `.txt` ダウンロード。
  - 中央 guide、status、hint。
- Then 側の既存連携に必要な最小 wrapper として、`TextEditorHandle`、`onTextChange`、outline jump、snippet insert 用の selection offset 取得だけを追加した。

### 2026-06-10 スニペット挿入の HTML 版エディタ対応

- 指定 HTML の編集フローに合わせ、スニペット挿入も `contenteditable` のネイティブ挿入経路へ寄せた。
  - 旧実装のように `innerText` 全体を直接置換しない。
  - `replaceRange()` は対象 range を DOM selection に設定し、`document.execCommand("insertText", false, insertedText)` で挿入する。
  - 挿入後に `editor.innerText` を読み直し、`onTextChange`、文字数、caret 中央追従を更新する。
  - drop 位置指定時も `positionFromPoint()` で得た offset を selection range に変換して同じ経路へ入れる。

### 2026-06-11 Markdown Lite LineClass 版の採用

- `F:/tategaki-md-lite-lineclass.html` の実装を基準として、見出し記法とリスト記法の簡易 class 付与を取り込んだ。
  - 本文 DOM を `.line` の直下行構造に変更した。
  - `#` から `######` は `.heading.h1` から `.heading.h6` を付与する。
  - `-` / `*` / `+` / `1.` / `1)` 形式は `.list-line` を付与し、行頭 indent から `data-level` を計算する。
  - Enter は `beforeinput` で捕捉し、現在行を split して `.line` を追加する。
  - paste と snippet 挿入は複数行 text を `.line` 群に展開する。
  - `readText()` は `.line` を `\n` で連結し、保存・App state・スニペット挿入の基準文字列にする。
- スニペット挿入対応:
  - App 側の `replaceRange()` API は維持した。
  - 内部では global offset に対して本文文字列を置換し、`.line` DOM を再構築する。
  - 再構築時に各行の heading/list class を再計算する。
  - drop 位置指定は `positionFromPoint()` から global offset を取得し、同じ replace 経路に流す。

### 2026-06-11 LineClass UI 調整

- エディタ右下の hint 表示 `# 見出し ／ - リスト ／ Ctrl+S で .md 保存` を削除した。
- 中央 guide の上下端マーカーを削除した。
- エディタ内ステータスの `／ Markdown Lite LineClass` 表記を削除した。
- エディタ内文字数表示は右下へ寄せた。
- 文字数カウント差の原因は、エディタ内が空白・改行を除外していた一方、App 側ステータスは全文の文字数を数えていたこと。エディタ内も `Array.from(text).length` に揃えた。

### 2026-06-11 App 側文字数カウントへ一本化

- エディタ内の文字数カウント DOM を削除し、文字数表示は App 側 status bar のみにした。
- App 側文字数が読み込み直後に `0文字` のまま残る問題を避けるため、`editorText` の変化に合わせて `charCount` を再計算するようにした。
- 画面右端の `▲▼` は、エディタ本体ではなく App 側の `scrollCue` JSX/CSS だったため、`scrollCueTop` / `scrollCueBottom` を削除した。

### 2026-06-11 現在見出し追跡の LineClass 対応

- パンくずの現在見出しがカーソル位置ではなく先頭見出しの子孫に固定される問題を修正した。
  - 原因は `findLastOutlineChain()` が現在行を見ず、先頭見出しから最初の子を辿るだけだったこと。
  - `VerticalTextEditor.getSelection().head` を App 側に同期し、本文 offset から現在行番号を計算する。
  - 現在行以前の最後の見出し chain を `findActiveOutlineChain()` で求める。
- パンくず/アウトラインメニューの `⌄` / `▾` 記号を削除した。

### 0. エディタ基盤の再選定

目的:

- Then の核である縦書き typewriter editing を、CodeMirror 前提に固定せず再検討する。
- `.txt` 主体、偽 Markdown 最小対応、縦書き、IME 安定性、カーソル追従の観点で、最も単純で破綻しにくい編集基盤を選ぶ。

背景:

- CodeMirror は横書きコードエディタとして強い一方、縦書きでは selection/caret 座標、scroll axis、DOM 計測、仮想行、IME 合成状態の扱いが複雑になる。
- Then は Markdown パースやリッチ編集を目的にしないため、CodeMirror の強みよりも座標計算の重さが目立つ可能性が高い。
- 縦書き typewriter scroll はアプリの主機能なので、ここが不安定な基盤は避ける。

候補:

- `textarea` + `writing-mode: vertical-rl`
  - 長所: プレーンテキスト、IME、Undo/Redo、選択、入力イベントがブラウザ標準に近く安定しやすい。
  - 短所: 行単位の見出し装飾ができない。選択位置は `selectionStart` / `selectionEnd` と `setSelectionRange()` で扱えるが、caret の画面座標を直接取る標準 API は弱く、typewriter scroll の精密制御には mirror 計測が必要。
- `contenteditable="plaintext-only"` + `writing-mode: vertical-rl`
  - 長所: raw text 編集に寄せられ、ブラウザの Selection / Range API で caret rect を取りやすい。縦書き本文の自然な DOM フローを使える。
  - 短所: ブラウザ差、Undo/Redo、IME、改行正規化、貼り付け制御の検証が必要。見出し装飾は別途 DOM 分割が必要。
- 独自 text model + render layer + hidden textarea
  - 長所: 保存形式、見出し描画、インデント表示、typewriter scroll を完全制御できる。
  - 短所: selection、IME、Undo/Redo、アクセシビリティの実装コストが高い。初期実装では過剰になりやすい。
- CodeMirror 継続
  - 長所: 既存実装を流用でき、検索、履歴、キーマップ、選択操作が揃っている。
  - 短所: 縦書き typewriter scroll のための座標計算が重く、Then の中心価値と相性が悪い可能性がある。

最初の検証:

- まず `textarea` と `contenteditable plaintext-only` の2案で、縦書き長文、IME入力、選択、貼り付け、scrollLeft、caret追従の小さなプロトタイプを作る。
- 見出し装飾は最初から入れず、`#` 行がテキストとして自然に編集できるかを優先する。
- typewriter scroll は、入力中の caret が固定位置に追従できるかだけを見る。
- この検証で `textarea` が十分なら、Then の初期版は `textarea` ベースにする。
- `textarea` の caret 計測が不安定なら、`contenteditable plaintext-only` を本命にする。
- どちらも破綻する場合に限り、CodeMirror 継続または独自 text model を再検討する。

受け入れ条件:

- 日本語IME入力中に表示位置が暴れない。
- 長文の縦書き入力で自然に右から左へ流れる。
- カーソル付近を固定位置へ寄せる typewriter scroll が成立する。
- `.txt` として保存する文字列が DOM 構造に依存せず取得できる。
- 見出し装飾なしでも、プレーンテキストエディタとして使える。

Web調査メモ:

- MDN の `writing-mode` は、縦横のテキスト配置とブロック進行方向を制御する CSS として説明されている。`vertical-rl` では内容が上から下へ流れ、次の縦行は前の行の左側に置かれる。Then の本文方向はこの挙動に合う。
- MDN の vertical form controls ガイドでは、`textarea` などのテキスト系フォームコントロールにも `writing-mode: vertical-rl` を適用でき、複数行では後続行が前行の左側へ現れると説明されている。したがって `textarea` は最小プロトタイプとして必ず検証する価値がある。
- MDN の `contenteditable` では `plaintext-only` が raw text editable で rich text formatting disabled とされている。Then は txt-first なので、HTML混入を避けたい編集ホストとして相性がよい。
- MDN の `Selection` は contenteditable 等の編集可能要素における選択や caret を表す API として説明されている。`contenteditable plaintext-only` 案では Selection / Range を使って caret rect を取得し、typewriter scroll の基準点にできる。
- MDN の `HTMLTextAreaElement.setSelectionRange()` は textarea の選択範囲を文字インデックスで扱える安定 API だが、画面上の caret rect を直接返すものではない。textarea 案では scroll 制御のために mirror DOM を使うか、精密な caret 固定を諦めて近似する判断が必要。
- Lexical は単一の contenteditable 要素に editor instance を attach する editor framework と説明されている。Then のような txt-first では、Lexical/ProseMirror 系を導入するとモデル層が重くなるため、まず素の `contenteditable plaintext-only` を検証し、必要になるまで採用しない。

暫定判断:

- CodeMirror は本命から外す。
- 第1プロトタイプは `textarea + writing-mode: vertical-rl` で、IME、保存文字列、scrollLeft、基本入力を確認する。
- 第2プロトタイプは `contenteditable="plaintext-only" + writing-mode: vertical-rl` で、Selection / Range による caret rect と typewriter scroll を確認する。
- 実装本命は、caret固定が不要に近い品質で許容できるなら `textarea`、固定位置追従を重視するなら `contenteditable plaintext-only` とする。
- Then の初期版では見出し装飾より、縦書き入力と typewriter scroll の安定を優先する。

### 1. Then 化の土台

状態: 実装済み。

目的:

- アプリ名と文書モデル名を Then / Text へ移行できる足場を作る。

実装内容:

- `package.json` の name を `then` に変更する。
- `src-tauri/tauri.conf.json` の productName、identifier、window title を Then 用に変更する。
- UI 表示の `brew` を `Then` に変更する。
- `TextDocument` 型を追加し、既存 `MarkdownDocument` から段階移行する。
- `DocumentTab.markdown` / `savedMarkdown` を `text` / `savedText` へリネームする計画を確定する。
- 永続化キーを `then.app-state.v1` とし、`brew.app-state.v1` からの読み込み互換を用意する。

受け入れ条件:

- 起動時の表示名が `Then` になる。
- 既存の scratch とタブが壊れない。
- `npm run build` が成功する。

### 2. txt ファイル I/O への移行

状態: 実装済み。

目的:

- `.txt` を標準として開く、保存する、フォルダ一覧に出す。

実装内容:

- Tauri に `open_text_file_dialog`、`read_text_file`、`save_text_file_dialog`、`save_text_file`、`list_project_text_files`、`create_text_file` を追加する。
- ファイルダイアログの標準フィルタを `Text` / `txt` にする。
- 互換フィルタとして `Markdown` / `md` も開けるようにする。
- 保存ダイアログの既定名を `untitled.txt` にする。
- フォルダ一覧は `.txt` と `.md` を対象にする。既定作成は `.txt`。
- 新規文書の初期内容は `# タイトル\n` ではなく、必要ならファイル名ベースの見出し 1 行に留める。

受け入れ条件:

- `.txt` を作成、保存、再読込できる。
- `.md` を開けるが、Markdown 特有の装飾が走らない。
- パンくずメニューから `.txt` と `.md` の両方へ到達できる。

### 3. 偽 Markdown エディタ

状態: 初期実装済み。

目的:

- Markdown パーサ依存を外し、txt を素直に編集しながら見出しだけを扱う。

実装内容:

- `CodeMirrorMarkdownEditor` を、ステップ0で選定したプレーンテキスト編集基盤へ置き換える。
- `silkdown()` と Markdown parser/keymap 依存を外す。
- 見出し行の視覚スタイルは初期版では必須にしない。縦書き入力と保存が安定してから、必要に応じて別レイヤーで扱う。
- `parseMarkdownOutline` を `parseTextOutline` へ改名し、`#` 見出しだけを抽出する。
- Markdown keymap を外し、偽 Markdown を壊さない標準入力にする。
- 行頭半角スペースは CSS と編集基盤の設定で潰れないように扱う。

受け入れ条件:

- `#` 見出しがアウトラインとパンくずに反映される。
- 強調、リンク、リストなどの Markdown 装飾は発生しない。
- 既存のスニペット挿入と検索が動く。

### 4. 完全縦書きタイプライタースクロール

状態: CodeMirror 版の初期実装は不採用。`textarea + writing-mode: vertical-rl` 版へ差し替え済み。精密な caret 固定は追加調整が必要。

目的:

- 中央本文を縦書きにし、カーソル位置が固定ラインへ追従するタイプライタースクロールを実現する。

設計方針:

- CSS は `writing-mode: vertical-rl` を基本にする。
- 縦書き時のスクロール主軸は横方向になるため、`scrollTop` 前提の既存計算を分離する。
- `coordsAtPos` から caret rect を取得し、縦書きでは `left/right` と `scrollLeft` を使って固定位置へ補正する。
- 設定として縦書き typewriter offset を水平方向の割合で持つ。
- 横書きフォールバックを残すか、Then では縦書き固定にするかを実装前に決める。

実装内容:

- 本文編集面は `TextAreaTextEditor` に集約し、`textarea` 自身をスクロールコンテナにする。
- CSS は `.textAreaTextEditor` に `writing-mode: vertical-rl` と `text-orientation: mixed` を適用する。
- typewriter scroll は textarea の現在行数から縦列位置を近似し、`scrollLeft` で横方向へ補正する。
- `scrollLeft` はブラウザ差に備えて正負両方向の補正を許容する。
- 日本語句読点、英数字、インデント、選択範囲、IME 入力中の挙動を確認する。

受け入れ条件:

- 縦書き本文で入力中の caret が固定位置に追従する。
- 長文で横方向にスクロールし、本文が破綻しない。
- IME 変換中にスクロールが暴れない。

### 5. VSCode 風パンくず刷新

状態: 初期実装済み。キーボード操作と操作配置の追加整理が必要。

目的:

- 添付画像の VSCode と同じ操作感を持つパンくずに刷新する。

必要な動き:

- パンくず各 segment はクリックで sibling/child メニューを開く。
- メニューは VSCode 風の暗色リスト、左アイコン、選択行ハイライト、スクロールバーを持つ。
- フォルダ segment では配下のフォルダと文書を表示する。
- 見出し segment では文書内アウトラインを表示する。
- キーボード操作は最低限、Esc で閉じる、上下で移動、Enter で選択を目標にする。
- ファイル操作ボタンは VSCode 風の動きと混ぜず、必要なら別アクション領域へ逃がす。

実装内容:

- `DocumentBar` / `BreadcrumbBar` コンポーネントを切り出す。
- ファイルパンくずとアウトラインパンくずを同じ segment モデルで扱う。
- メニュー行の rename/delete/move など現行独自操作は再配置する。
- ポップオーバー位置、幅、スクロール、アクティブ行の CSS を刷新する。

受け入れ条件:

- 添付画像と同じく、パンくず segment 直下にリストが開く。
- 現在ファイルと現在見出しが視覚的に分かる。
- フォルダ/ファイル/見出しの選択で既存機能が動く。

### 6. タブ刷新

状態: 初期実装済み。パネル折りたたみはステップ7で扱う。

目的:

- 現在の左レール型タブから、Then の作業導線に合うタブへ刷新する。

検討方針:

- VSCode 風に上部横タブへ寄せるか、縦書きエディタに合わせて左/右の切替面にするかを決める。
- タブとパンくずの関係を明確にし、タブは「開いている文書」、パンくずは「場所と見出し」に限定する。
- dirty、保存失敗、閉じる、未保存確認は維持する。

実装内容:

- `TabRail` を `DocumentTabs` へ改名するか、新コンポーネントを作る。
- タブサイズ、アクティブ状態、閉じるボタン、dirty marker を刷新する。
- 多数タブ時の overflow とスクロールを設計する。

受け入れ条件:

- 開いている複数文書をタブで切り替えられる。
- 未保存状態が分かる。
- タブを閉じる時の確認が維持される。

### 7. 左右パネル表示切替

目的:

- 左側のタブパネルと右側のスニペットパネルは維持したまま、それぞれを表示/非表示できるようにする。

設計方針:

- 左側タブパネルには、タブパネルを畳む/開くトグルを置く。
- 右側スニペットパネルには、スニペットパネルを畳む/開くトグルを置く。
- タブとスニペットは排他的なモード切替にしない。両方表示、左だけ表示、右だけ表示、両方非表示の4状態を許容する。
- スニペット検索、追加、編集、削除、挿入は維持する。
- パネルを畳んだ状態でも、再表示できる細いレールまたはアイコンボタンを残す。

実装内容:

- `isTabPanelVisible` と `isSnippetPanelVisible` を app state に追加する。
- `DocumentTabs` と `SnippetPane` は左右の独立パネルとして維持する。
- パネル幅、折りたたみ幅、再表示ボタン、エディタ中央カラムのリサイズを整理する。

受け入れ条件:

- 左タブと右スニペットを独立に表示/非表示できる。
- パネル表示状態を変えてもエディタ幅が不自然に崩れない。
- 既存スニペット操作が維持される。

## 実装順序

1. この計画をベースラインとしてコミットする。
2. エディタ基盤の縦書きプロトタイプを作り、CodeMirror 継続可否を判断する。
3. Then 化の最小変更を入れる。
4. Tauri の txt I/O を追加し、`.txt` 標準へ切り替える。
5. 選定した編集基盤で偽 Markdown エディタを作る。
6. 縦書き表示だけを先に成立させる。
7. 縦書き typewriter scroll を完成させる。
8. パンくずを VSCode 風へ切り出して刷新する。
9. タブ UI を刷新する。
10. 左タブと右スニペットの表示/非表示トグルを実装する。
11. スクリーンショットとビルドで主要状態を検証する。
12. 未コミット分をコミットする。
13. 動きを確認するため、最後にインストーラーをビルドする。

## ステップ見積もり

結論:

- Then 開発は、最低でも **15ステップ** で見る。
- 15ステップは「使える初期版」までの見積もりであり、配布品質まで含めるなら **18ステップ** を見ておく。
- 既存 `brew` の UI とファイル操作を活かせる一方、核になる縦書きエディタは再選定から始めるため、通常のUI刷新よりリスクが高い。

Web調査からの根拠:

- MDN の `writing-mode` は `vertical-rl` を標準の縦書き方向として説明しており、Then の本文方向には合う。ただし、縦書きフォームコントロールの完全サポートは近年の改善領域で、実機検証を独立ステップにする必要がある。
- MDN の vertical form controls ガイドでは、`textarea` にも `writing-mode: vertical-rl` を適用できるとされている。したがって `textarea` プロトタイプは必須だが、caret座標取得は別問題として扱う。
- MDN の `contenteditable="plaintext-only"` は raw text 編集に寄せられるため、Then の txt-first 方針に合う。Selection / Range と `beforeinput` / `getTargetRanges()` の検証を別ステップに分ける必要がある。
- Tauri v2 は dialog plugin と fs plugin で open/save/read/write の道があるが、既存コードは Rust command 経由で実装済みなので、Then では互換を壊さず `.txt` 標準へ移すステップを独立させる。
- Playwright は `toHaveScreenshot()` による visual comparison を提供するが、公式ドキュメントも実行環境差による揺れに注意している。Then は縦書き・スクロール・パネル表示状態の視覚確認が重要なので、スクリーンショット検証は最後にまとめず中盤から入れる。

### 15ステップ版

1. ベースライン固定
   - 計画書、モックアップ、現在ブランチ状態をコミットして、以後の差分を追えるようにする。
   - 完了条件: `docs/THEN_IMPLEMENTATION_PLAN.md` と `docs/then-ui-mockup-v2.*` が基準として残る。

2. エディタ基盤プロトタイプA: `textarea`
   - `textarea + writing-mode: vertical-rl` で、長文、IME、選択、貼り付け、scrollLeft を検証する。
   - 完了条件: 日本語入力と保存文字列取得が成立するか判断できる。

3. エディタ基盤プロトタイプB: `contenteditable plaintext-only`
   - `contenteditable="plaintext-only" + writing-mode: vertical-rl` で、Selection / Range、beforeinput、改行正規化、貼り付けを検証する。
   - 完了条件: caret rect と typewriter scroll の実現性を判断できる。

4. エディタ基盤の決定
   - `textarea`、`contenteditable plaintext-only`、CodeMirror継続、独自モデルのどれで初期版を作るか決める。
   - 完了条件: 以後の実装対象コンポーネント名とデータ取得方法が決まる。

5. Then 化の最小変更
   - 表示名、Tauri productName、window title、package name、保存キーを `Then` / `then` へ移す。
   - 完了条件: 起動表示とビルドが壊れない。

6. 文書モデルの `TextDocument` 化
   - `MarkdownDocument` 前提を `TextDocument` へ移行する準備を入れる。
   - 完了条件: active tab の本文状態を `text` として扱える。

7. `.txt` ファイルI/O
   - `.txt` を標準の open/save/create/list 対象にする。`.md` は読み取り互換として残す。
   - 完了条件: `.txt` 作成、保存、再読み込み、フォルダ一覧表示ができる。

8. エディタ本体の差し替え
   - 選定した編集基盤で本文編集を置き換える。Markdownパーサ依存を外す。
   - 完了条件: プレーンテキスト編集、Undo/Redo、IME、保存が成立する。

9. 偽 Markdown outline
   - `#` から `######` の見出しだけを解析し、アウトラインとパンくずに流す。
   - 完了条件: `.txt` 内の `#` 見出しが現在見出しとして追跡される。

10. 縦書き表示の本実装
   - 本文カラム、余白、スクロール軸、フォント、句読点、英数字混在を調整する。
   - 完了条件: 長文が右から左へ自然に流れる。

11. typewriter scroll
   - caret 付近を固定位置へ寄せる。IME中の暴れを抑える。
   - 完了条件: 入力中、選択変更中、長文移動中に破綻しない。

12. パンくず刷新
   - VSCode風の segment と dropdown を実装する。ファイル階層と見出し階層を同じ見た目で扱う。
   - 完了条件: フォルダ、文書、見出しの移動ができる。

13. タブ刷新
   - 左タブパネルをモックアップ方向に刷新し、dirty、close、新規タブを維持する。
   - 完了条件: 複数 `.txt` / `.md` の切替と未保存確認が維持される。

14. スニペット刷新と左右パネルトグル
   - 右スニペットパネルをモックアップ方向に刷新し、左タブ/右スニペットを独立に表示/非表示できるようにする。
   - 完了条件: 両パネルの表示状態を変えても本文編集が崩れない。

15. 統合検証
   - `npm run build`、Tauri実機、スクリーンショット、ネイティブファイルダイアログ、主要状態を確認する。
   - 完了条件: scratch、`.txt`、`.md`、縦書き長文、パンくず、タブ、スニペット、パネルトグルが通る。

16. 未コミット分のコミット
   - 統合検証で問題がない状態の未コミット変更をコミットする。
   - 完了条件: 作業ツリーの実装差分がコミットとして固定される。

### 配布品質まで見る場合の追加3ステップ

17. インストーラービルド
   - 動作確認用に `npm run tauri:build` でインストーラーを生成する。
   - 完了条件: 生成されたインストーラーで Then として起動確認できる状態になる。

18. 視覚回帰テスト整備
   - Playwright または既存CDP撮影で、主要状態のスクリーンショットを固定化する。
   - 完了条件: UI変更時に差分を確認できる。

19. 既存データ移行と互換確認
   - `brew.app-state.v1`、`.brew/project.json`、既存 `.md`、workspace snippets の互換を確認する。
   - 完了条件: 既存ユーザー状態を失わず Then へ入れる。

20. Tauri build と配布物確認
   - `npm run tauri:build`、生成exe/msi/nsis、アプリ名、アイコン、保存先、権限を確認する。
   - 完了条件: Then としてインストール可能な成果物ができる。

### ゲート判断

- Gate 1: ステップ4でエディタ基盤を決める。ここを越えるまでUI本実装へ進まない。
- Gate 2: ステップ11で typewriter scroll が成立するか判断する。成立しない場合は見出し装飾やUI刷新より前に基盤へ戻る。
- Gate 3: ステップ15で初期版として使えるか判断する。配布品質が必要なら16-18へ進む。

### 見積もり上の注意

- 最も不確実なのはステップ2-4とステップ11。
- `textarea` で十分なら全体は短くなる。`contenteditable plaintext-only` でUndo/IME制御が重くなると、ステップ8と11が膨らむ。
- 独自text modelへ進む場合、15ステップでは収まらない。その場合は追加で selection、IME、Undo/Redo、アクセシビリティ、検索置換を個別ステップ化する。

## 検証計画

- `npm run build`
- `npm run tauri:build`
- ブラウザ表示で以下をスクリーンショット確認する。
  - scratch 起動
  - `.txt` 文書を開いた状態
  - `.md` 文書を開いた状態
  - 縦書き長文入力中の typewriter scroll
  - パンくずメニュー表示
  - 複数タブ表示
  - スニペット表示
  - 左タブ/右スニペットの表示切替
- Tauri 実機でネイティブファイルダイアログを確認する。

## リスクと注意点

- 縦書き CodeMirror はブラウザの selection/caret 実装差の影響を受けやすい。最初に小さい検証を作ってから本実装に入る。
- Markdown 依存を外すと既存 frontmatter UI と silkdown 装飾は不要になる。削除範囲を段階的に決める。
- `.brew/project.json` と `brew.app-state.v1` を急に捨てると既存ユーザー状態が消えるため、Then 初期版では読み取り互換を残す。
- パンくずメニュー内にファイル管理操作を詰め込むと VSCode の操作感から外れる。操作の配置は再設計する。
- 右スニペットパネルを非表示にするとスニペットの常時視認性が落ちるため、挿入頻度が高い場合はキーボード導線を後続で補う。

## 最初の実装チェックリスト

- [ ] `Then` 表示名への変更。
- [ ] エディタ基盤の縦書きプロトタイプ。
- [ ] CodeMirror 継続可否の判断。
- [ ] `then.app-state.v1` の導入。
- [ ] `TextDocument` 型の追加。
- [ ] `.txt` open/save/list/create の Tauri command 追加。
- [ ] `.md` 読み取り互換。
- [ ] 選定した編集基盤による `TextEditor` の新設。
- [ ] `#` 見出し outline の維持。
- [ ] 縦書き CSS の最小検証。
- [ ] 縦書き typewriter scroll の座標検証。
- [ ] VSCode 風 breadcrumb component の分離。
- [ ] 新タブ UI の設計確定。
- [ ] 左タブ/右スニペット表示切替の state 導入。
