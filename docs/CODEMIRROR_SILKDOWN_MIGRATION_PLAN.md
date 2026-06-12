# CodeMirror 6 + Silkdown 移行プラン

## 目的

brew の Markdown エディタを Milkdown/ProseMirror から CodeMirror 6 ベースへ移行し、Obsidian 風の Live Preview を実現する。

要求する体験は次の通り。

- Markdown ソースは常に `.md` のプレーンテキストとして保持する
- 通常時は見出し、太字、リンク、引用、リストなどを読みやすく表示する
- カーソルがある行、または選択範囲では Markdown 記法を表示して修正しやすくする
- 既存のファイル操作、スニペット、アウトライン、タイプライタースクロール、scratch 復元を維持する

## 採用方針

第一候補として `Silkdown` を採用する。

理由:

- CodeMirror 6 は Markdown ソース文字列を本文そのものとして扱える
- Silkdown は CodeMirror 6 向けに Obsidian/Typora 風 Live Preview を提供する方針の拡張である
- Markdown 記法をカーソル行で再表示する方向性が、今回の要求に直接合っている
- Milkdown の AST 編集モデルへ無理なハックを入れるより、将来の Markdown エディタとして筋がよい

ただし Silkdown の npm package/API/React + Vite + Tauri 適合性は実装時に確認する。採用に問題が出た場合は、CodeMirror 6 decorations による自前 Live Preview 実装へ切り替える。

## 実装範囲

### 1. 依存関係

追加候補:

- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/lang-markdown`
- `@codemirror/language`
- `@codemirror/commands`
- `@codemirror/search`
- Silkdown の core package

削除候補:

- `@milkdown/core`
- `@milkdown/kit`
- `@milkdown/react`

削除は CodeMirror 側の移行が通ってから行う。途中で戻せるよう、最初は併存可能な差分にする。

### 2. Editor Component

新規に `CodeMirrorMarkdownEditor` を作る。

責務:

- `markdown` を受け取って CodeMirror document に反映する
- 編集変更を `onMarkdownChange(markdown, text)` へ通知する
- 外部からファイルが切り替わったときに editor state を作り直す
- フォント、文字サイズ、行間、テーマを既存設定から反映する
- selection/cursor 更新を `onSelectionChange` へ通知する

### 3. Live Preview

Silkdown が使える場合:

- Silkdown 拡張を CodeMirror extensions に追加する
- カーソル行では Markdown markers を表示する
- 非カーソル行では markers を隠す、または薄くする
- 見出し、リスト、引用、リンク、強調、インラインコード、コードブロックを見やすく表示する

Silkdown が使えない場合:

- CodeMirror syntax tree と decorations で最小限を自前実装する
- 対象は headings、emphasis、strong、inline code、links、quotes、lists、fenced code
- 置換 decorations はカーソル行と選択範囲には適用しない

### 4. 既存機能の接続

#### 保存/読み込み

- 既存の `markdown` state を唯一の保存元として維持する
- `read_markdown_file`、`save_markdown_file`、`save_markdown_file_dialog` は変更しない
- ファイル切り替え時は CodeMirror editor state を再生成する

#### Frontmatter

- 既存のプロパティ欄は維持する
- `parseFrontMatter`、`composeMarkdown`、`updateMarkdownBody` をそのまま使う
- CodeMirror に渡す本文は frontmatter を除いた body とする

#### スニペット

- ダブルクリック挿入は CodeMirror transaction へ置換する
- ドラッグ&ドロップ挿入は drop 座標から `posAtCoords` 相当で挿入位置を取得する
- 既存のスニペット保存先設定は維持する

#### アウトライン

- 既存の Markdown 文字列パースを維持する
- アウトライン項目クリック時は該当行の document position に selection を移動する
- パンくず UI は維持する

#### タイプライタースクロール

- CodeMirror の cursor coordinates を取得して scrollTop を調整する
- 既存の `typewriterOffset` 設定を維持する
- IME 中に不自然なスクロールが起きる場合は composition 中だけ抑制する

### 5. UI

- 既存の editor shell、statusbar、snippet panel、breadcrumb は維持する
- CodeMirror の DOM に合わせて `.editor .cm-editor` 系の CSS を追加する
- 本文幅、余白、行間、日本語フォントの見え方を現在のデザインに寄せる
- Source mode 切替は初回移行後に必要なら追加する

## 検証項目

必須:

- `npm run build`
- `cargo check`
- `npm run tauri:build`
- Markdown 入力が保存される
- ファイル切替で本文が混ざらない
- 日本語 IME 入力が壊れない
- 新規ファイル作成後に CodeMirror へ反映される
- スニペットのダブルクリック挿入
- スニペットのドラッグ挿入
- アウトラインクリックで該当見出しへ移動
- タイプライタースクロール
- scratch 起動と復元失敗アラート

重点確認:

- カーソル行で Markdown 記法が見えること
- 非カーソル行で Live Preview として読めること
- `**bold**`、`*italic*`、`` `code` ``、`[label](url)` が編集しやすいこと
- 日本語と Markdown 記号が混ざる行でカーソル位置が破綻しないこと

## リスク

- Silkdown の package/API が現行 React/Vite/Tauri 環境に合わない可能性
- Live Preview decorations が IME 入力や選択範囲編集と衝突する可能性
- ドラッグ挿入やタイプライタースクロールは Milkdown/ProseMirror API 依存なので置換が必要
- 既存 CSS が CodeMirror DOM に当たらず見た目が崩れる可能性

## フォールバック

Silkdown が使えない場合でも CodeMirror 6 移行は続行する。

フォールバック方針:

1. CodeMirror 6 + `@codemirror/lang-markdown` で Source mode を成立させる
2. decorations でカーソル行以外の Markdown markers を薄くする
3. 見出し、引用、コード、リンクだけ Live Preview 風に整える
4. Silkdown 相当の挙動は段階的に自前拡張として育てる

## 実装順

1. 依存追加と package lock 更新
2. `CodeMirrorMarkdownEditor` 作成
3. 既存 Milkdown surface と差し替え
4. 保存/読み込み同期の確認
5. Silkdown 拡張接続
6. スニペット挿入の CodeMirror 化
7. アウトラインジャンプの CodeMirror 化
8. タイプライタースクロールの CodeMirror 化
9. CSS 調整
10. build/check/installer 生成

## 完了条件

- Milkdown なしで Markdown 編集が動く
- カーソル行で Markdown 記法が表示される
- 非カーソル行で Live Preview 表示になる
- 既存のファイル管理とスニペット操作が維持される
- インストーラーが生成できる
