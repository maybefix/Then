# Then

日本語の縦書き執筆に特化した、Windows向けデスクトップエディタです。

Markdown / テキストファイルをそのまま原稿として扱いながら、本文執筆、構成管理、資料参照、保存点の比較・復元、PDF / DOCX出力までを一つのワークスペースで行えます。

- 現在のバージョン: `v0.4.6`
- 対応環境: Windows x64
- 技術構成: Tauri v2 + React + TypeScript + Vite + Tiptap / ProseMirror
- ダウンロード: [Then v0.4.6](https://github.com/maybefix/Then/releases/tag/v0.4.6)

## 主な機能

### 縦書き本文エディタ

- Tiptap / ProseMirrorと独自ASTを組み合わせた縦書き編集
- 入力位置を画面内の一定位置に保つタイプライタースクロール
- タブごとのカーソル位置と表示位置の復元
- 見出し、引用、リストなどのMarkdown表示
- 太字 `**…**`（`Ctrl+B`）
- 圏点 `[…(em,goma)]`（`Ctrl+I`）
- ルビ `[…(rb,ルビ)]` と青空文庫形式 `｜…《ルビ》`
- 縦中横 `[…(tcy)]`
- 行揃え `[(al:start|center|end)]`
- 見出し1〜6（`Ctrl+1`〜`Ctrl+6`）と解除（`Ctrl+0`）
- `Ctrl+P` で開くコマンドパレット
- 改行記号、文字数、保存状態の表示

### ワークスペースとファイル管理

- 起動ポータルから最近使ったワークスペースを再開
- `.md` / `.txt` ファイルの作成、オープン、保存、別名保存
- 複数ファイルをタブで同時編集
- ファイルツリーとナビゲータ表示
- 見出しアウトラインからのジャンプとセクション移動
- ファイル／フォルダの作成、リネーム、移動、並び替え、Trashへの削除
- パンくずによるフォルダ階層の移動
- 現在のファイルまたはプロジェクト全体を対象とした検索・置換

### Idea・プロット・キャンバス

- Ideaをスレッドと断片に分けて整理
- `Ctrl+Alt+I` で本文画面から素早くIdeaを追加
- Ideaの検索、並び替え、本文へのダブルクリック／ドラッグ&ドロップ挿入
- 章とセクションのカードによるプロット管理
- セクション番号の自動付与と折りたたみ状態の保存
- Ideaや資料を自由配置し、線でつなげられるIdea Board
- プロジェクト専用と全ワークスペース共通の保存範囲

### 資料

- テキスト、Markdown、画像、PDFを資料として登録
- プロジェクト資料と共通資料の切り替え
- 資料の検索、プレビュー、コピー、移転
- 本文の上に資料カードを重ねて参照
- Idea Boardへの資料配置

### チェックポイント

- プロジェクト全体の手動保存点を作成
- 保存点と現在のプロジェクト、または保存点同士をファイル単位で比較
- プロジェクト全体または選択したファイル／フォルダだけを復元
- 競合時の上書き、別ファイルとして復元、スキップを選択
- 復元実行前に現在の状態を自動退避

### PDF / DOCXエクスポート

- 複数ファイルを任意の順序で束ねて出力
- PDFとWord（DOCX）に対応
- ページサイズ、余白、本文フォント、段組み、ヘッダー、ノンブルを設定
- 実際の出力エンジンを使ったプレビュー
- 生成進捗の表示

### 表示と設定

- ライト／ダークを含む多数のカラーテーマ
- Windowsにインストールされたフォントの利用
- 本文フォント、文字サイズ、行間、本文表示幅の調整
- 左右サイドバーや各作業画面の状態を保存

## データの保存

- 原稿はワークスペース内の `.md` / `.txt` ファイルとして保存されます。
- ワークスペース固有の並び順、Idea、プロットなどは `.then/project.json` に保存されます。
- Idea Board、取り込んだ資料、資料の表示状態などもワークスペースの `.then` ディレクトリ以下で管理されます。
- アプリ設定、最近使ったワークスペース、開いていたタブなどはTauriのアプリデータディレクトリに保存されます。
- ブラウザ実行時はUI確認用として `localStorage` を使用します。

`.then` ディレクトリはThenが管理します。通常はファイルを直接編集せず、アプリ上から操作してください。

## インストール

[GitHub Releases](https://github.com/maybefix/Then/releases) から最新版をダウンロードできます。

- 通常のインストール: `Then_*_x64-setup.exe`
- MSI形式: `Then_*_x64_en-US.msi`

現在のWindowsインストーラーはコード署名されていないため、Windows SmartScreenが警告を表示する場合があります。

## 開発

### 必要なもの

- Node.js / npm
- Rust
- Tauri v2のWindows向け前提ツール

依存関係をインストールしてデスクトップアプリを起動します。

```powershell
npm install
npm run tauri:dev
```

ブラウザでUIだけを確認する場合:

```powershell
npm run dev:local
```

## ビルドと検証

```powershell
npm run build
npm run test:heading-move
npm run test:heading-dnd-ui
npm run test:export
npm run tauri:build
```

Windowsインストーラーは次の場所に生成されます。

```text
src-tauri/target/release/bundle/msi/
src-tauri/target/release/bundle/nsis/
```

## ドキュメント

- `docs/USER_MANUAL.md`: 操作マニュアル
- `docs/AST_MANAGEMENT_POLICY.md`: 原稿ASTの管理方針
- `docs/VERTICAL_EDITOR_ARCHITECTURE_REBOOT.md`: 縦書きエディタの設計資料
- `docs/`: 機能設計、検証記録、実装計画
