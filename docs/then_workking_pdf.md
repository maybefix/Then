添付した `本文連結エクスポート画面.html` のモックアップを元に、既存の Tauri + React 縦書きエディタへ「本文連結エクスポート画面」を実装してください。

この機能は、単一ファイルPDF出力ではありません。
複数の本文ファイルを連結し、PDFまたはDOCXとして出力するための専用画面です。

## 目的

通常の縦書き編集画面とは別に、エクスポート専用画面を作る。

通常編集画面では本文を書くことに集中する。
PDFプレビューを通常編集画面の右ペインに常設しない。
ユーザーが「エクスポート」または「PDF出力」を押した時だけ、別ウィンドウまたは大きめのモーダルで本文連結エクスポート画面を開く。

## 重要な前提

対象ファイルは `.txt` と `.md` が混在する。
このエディタでは `.txt` でもMarkdown風記法やThen独自記法を使うため、`.txt` を単なるプレーンテキストとして固定しない。

UI上では「Markdownファイル」と表示しない。
「本文ファイル」「出力対象ファイル」「出力対象」と表示する。

## モックアップで実装対象にする要素

添付HTMLのモックアップにある以下の構成を、既存アプリのデザインに合わせて実装する。

### 1. 上部ヘッダー

表示内容:

* エクスポート
* 本文ファイルを連結して書き出します
* 出力形式

  * PDF
  * DOCX
* 閉じるボタン

PDF / DOCX の切り替えは状態として持つ。
初期値はPDFでよい。

### 2. 画面状態の切り替え

モックアップには、画面確認用の状態切り替えがある。

* 初期状態
* プレビューなし
* プレビュー生成中
* 組版失敗
* PDF生成中
* PDF生成完了

実アプリではデバッグ用に露出しなくてもよい。
ただし、内部状態としてはこの区分を持つ。

```ts
type ExportViewState =
  | "idle"
  | "no-preview"
  | "preview-loading"
  | "preview-ready"
  | "preview-error"
  | "pdf-generating"
  | "pdf-complete";
```

### 3. タブ

モックアップには以下のタブがある。

* 出力対象
* 設定
* プレビュー

広い画面では、出力対象、設定、プレビューを同時に見せてもよい。
狭い画面では、このタブ構成で切り替える。

### 4. 出力対象ファイル一覧

複数の本文ファイルを一覧表示する。

各ファイルに必要な情報:

* enabled
* path
* displayName
* extension
* chars
* order
* startMode
* badge または種別表示

開始方法:

* 前の続き
* 改ページ
* 奇数ページ開始
* 偶数ページ開始

操作:

* 出力に含める、含めない
* 並べ替え
* 上へ移動
* 下へ移動
* 開始方法の変更
* 出力対象数の表示

  * 例: 出力 5 / 全 6 ファイル
* 連結順は上からであることを表示

ドラッグ並べ替えは可能なら実装する。
難しい場合でも、上へ、下へボタンは必ず実装する。

### 5. プレビュー領域

モックアップにある紙面プレビューを実装する。

初期段階では、実際のVivliostyle接続が未完でもよい。
ただし、UI構造は本番接続を前提にする。

必要な表示:

* プレビュー更新ボタン
* ページ送り
* 現在ページ表示
* 拡大、縮小
* 見開き風の紙面表示
* 縦書き本文
* ヘッダー
* フッター
* ページ番号
* ルビ、縦中横を含む想定の表示
* プレビューなし状態
* プレビュー生成中状態
* 組版失敗状態

プレビューは完全リアルタイムにしない。
最初は「プレビュー更新」ボタンで再生成する設計にする。

### 6. 組版失敗表示

モックアップにあるエラー表示を実装する。

表示内容:

* 組版処理に失敗しました
* 本文の連結結果を紙面に流し込む処理でエラーが発生しました
* 原因候補
* 詳細ログ
* 該当ファイルを開く
* 再試行

詳細ログは折りたたみ可能にする。

エラー種別は最低限以下を想定する。

```ts
type ExportErrorKind =
  | "source-read"
  | "source-parse"
  | "style-generate"
  | "typeset"
  | "font-missing"
  | "pdf-generate"
  | "docx-generate";
```

ユーザー向け表示と開発者向けログを分ける。

### 7. 設定パネル

モックアップの設定パネルを実装する。

セクション:

* ページ設定
* 本文設定
* ヘッダー
* フッター・ページ番号
* プリセット

各セクションは折りたたみ可能にする。

#### ページ設定

項目:

* ページサイズ

  * B6
  * A5
  * A6
  * B5
  * A4
  * カスタム
* 幅 mm
* 高さ mm
* 余白 mm

  * 天
  * 地
  * ノド
  * 小口

UI上の補足:

* ノド = 綴じ側の余白
* 小口 = ページを開く側の余白

#### 本文設定

項目:

* 本文フォント

  * 源ノ明朝
  * 源ノ角ゴシック
  * 游明朝
  * 既存アプリのフォント選択と連携できるなら連携
* 文字サイズ

  * 単位はQまたはpt。既存実装に合わせる
* 行間
* 段組

  * 1段
  * 2段
* 段間 mm

#### ヘッダー

項目:

* 表示内容

  * なし
  * 作品名
  * 現在の章タイトル
  * 現在のファイル名
  * 任意テキスト
* 章扉では非表示
* 先頭ページでは非表示
* 奇数・偶数ページで出し分け

#### フッター・ページ番号

項目:

* ページ番号を表示
* フッター内容

  * なし
  * ページ番号
  * 作品名
  * 任意テキスト
* 開始番号
* 位置

  * 下中央
  * 上中央
  * 外側
  * 内側

UIでは「ページ番号」を主表示にする。
「ノンブル」は補足扱いにする。

補足:

* 外側 = 見開きの左右端
* 内側 = 綴じ側

#### プリセット

項目:

* 標準・縦書き文庫
* 同人誌 B6・1段
* A5・2段組
* 前回設定を読み込む
* この設定を保存

プリセットの保存処理が未実装の場合でも、UIと状態モデルは用意する。
未実装なら無効表示でもよいが、後付けしにくい構造にはしない。

### 8. 下部操作

モックアップにある下部操作を実装する。

* キャンセル
* 設定を保存
* DOCXを書き出す
* PDFを書き出す

PDF生成中状態:

* PDF生成中…
* 現在ページまたは進捗表示
* パーセント表示

PDF生成完了状態:

* PDFを書き出しました
* 全ページ数
* 連結したファイル数
* ファイル名
* 閉じる
* 保存先を開く

## 状態モデル

単一ファイル前提にしない。
最初から複数本文ファイル連結エクスポートを前提にする。

以下のようなモデルを作る。

```ts
type ExportFormat = "pdf" | "docx";

type ExportStartMode =
  | "continue"
  | "new-page"
  | "odd-page"
  | "even-page";

type ExportSourceFile = {
  id: string;
  path: string;
  extension: string;
  displayName: string;
  title?: string;
  chars?: number;
  enabled: boolean;
  order: number;
  startMode: ExportStartMode;
  markupMode: "then-markup";
};

type ExportPageSize =
  | "B6"
  | "A5"
  | "A6"
  | "B5"
  | "A4"
  | "custom";

type ExportLayoutProfile = {
  name?: string;

  page: {
    size: ExportPageSize;
    widthMm?: number;
    heightMm?: number;
    marginTopMm: number;
    marginBottomMm: number;
    marginInnerMm: number;
    marginOuterMm: number;
    facingPages: boolean;
  };

  body: {
    writingMode: "vertical-rl";
    columns: 1 | 2;
    columnGapMm: number;
    fontFamily: string;
    fontSize: number;
    fontSizeUnit: "Q" | "pt";
    lineHeight: number;
  };

  header: {
    enabled: boolean;
    content: "none" | "title" | "chapter" | "file" | "custom";
    customText?: string;
    hideOnTitlePage: boolean;
    hideOnFirstPage: boolean;
    differentOddEven: boolean;
  };

  footer: {
    enabled: boolean;
    content: "none" | "page-number" | "title" | "custom";
    customText?: string;
    pageNumber: boolean;
    pageNumberPosition:
      | "bottom-center"
      | "top-center"
      | "outer"
      | "inner";
    startPageNumber: number;
    hideOnTitlePage: boolean;
    hideOnFirstPage: boolean;
    differentOddEven: boolean;
  };
};

type ExportJob = {
  format: ExportFormat;
  sources: ExportSourceFile[];
  layout: ExportLayoutProfile;
};
```

既存コードの命名規則がある場合は合わせてよい。
ただし、単一ファイル専用の構造にしない。

## Vivliostyle方針

配布版で `@vivliostyle/core` や `@vivliostyle/viewer` を renderer bundle に静的importしない。

禁止:

* rendererで `@vivliostyle/core` をimportする
* rendererで `@vivliostyle/viewer` をimportする
* dynamic importで別chunk化して解決扱いにする
* Vivliostyle CLI previewを常駐させる
* 通常編集画面にPDFプレビューを右ペイン常設する
* 編集のたびに一時HTMLファイルを書き出す
* 現在開いている1ファイルだけを固定で出力する設計にする
* `.md` だけを出力対象にする
* `.txt` をThen記法の解析対象から外す

PDF最終出力は、書き出しボタンを押した時だけ内部処理で生成する想定にする。
ユーザーにVivliostyle、CLI、Node.jsなどの別途インストールを要求しない。

## 実装範囲

今回の主目的は、添付モックアップを元に、本文連結エクスポート画面のUI、状態モデル、データ接続の入口を作ること。

実装する:

* エクスポート画面を開く導線
* エクスポート画面のUI
* 出力形式切り替え
* 出力対象ファイル一覧
* ファイルの有効、無効
* ファイル順の変更
* 開始方法の変更
* ページ設定UI
* 本文設定UI
* ヘッダー設定UI
* フッター、ページ番号設定UI
* プリセットUI
* プレビュー領域
* プレビューなし状態
* プレビュー生成中状態
* 組版失敗状態
* PDF生成中状態
* PDF生成完了状態
* ExportJob相当の状態モデル

既存のPDF/DOCX出力処理がある場合:

* 既存処理を壊さない
* 可能なら新しいExportJobへ接続する入口だけ作る
* まだ接続が重い場合は、TODOを明示してUI側を先に成立させる

## 既存画面への影響

通常の縦書き編集画面を大きく変更しない。
本文編集領域を狭くしない。
右ペイン常設プレビューを追加しない。

エクスポート画面は、通常画面とは分離する。
別ウィンドウまたは大きめのモーダルとして実装する。
既存アプリのUI方針に合う方を選んでよいが、後で別ウィンドウ化できない構造にはしない。

## 作業ブランチ

この作業は大きいので、現在の作業ブランチからさらに検証ブランチを切って作業すること。

例:

```bash
git status
git branch --show-current
git switch -c experiment/linked-export-screen
```

未コミット変更がある場合は、作業前に確認する。
勝手に破棄しない。

## 完了条件

最低限、以下を満たすこと。

* エクスポート画面を開ける
* 添付モックアップの主要UI要素が実装されている
* `.txt` と `.md` が混在する出力対象ファイル一覧を扱える
* 「Markdownファイル」という表記になっていない
* 出力対象の有効、無効を切り替えられる
* 出力順を変更できる
* 各ファイルの開始方法を変更できる
* ページ設定、本文設定、ヘッダー、フッター、ページ番号の状態を保持できる
* プレビューなし、生成中、失敗、生成完了の状態表示がある
* PDF生成中、PDF生成完了の状態表示がある
* 通常編集画面に右ペインプレビューを追加していない
* renderer bundleにVivliostyle本体を混ぜていない
* 既存の縦書き編集機能を壊していない
* TypeScript型エラーを残さない
* lintまたは既存の確認コマンドが通る
* 変更内容を簡潔に説明する

## 重要

これはMVPとして小さく単一ファイルPDF出力を作るタスクではない。
最初から「複数本文ファイル連結エクスポート画面」として作る。
