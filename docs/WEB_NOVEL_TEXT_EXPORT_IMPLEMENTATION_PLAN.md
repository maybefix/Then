# Web小説投稿用テキストエクスポート実装方針

作成日: 2026-09-10
対象: Then v0.6.x 以降

## 1. 目的

Thenで執筆した本文を、Web小説投稿サイトへ貼り付けられるプレーンテキストへ変換し、次の2経路で出力できるようにする。

- クリップボードへコピー
- UTF-8テキストファイル（`.txt`）として保存

初期対応プロファイルは次の3種類とする。

- カクヨム形式
- 小説家になろう形式（以下「なろう形式」）
- 装飾記法を除去したプレーンテキスト形式

PDF／DOCXエクスポートが紙面の組版を目的とするのに対し、本機能は投稿先で解釈されるテキスト記法への変換を目的とする。出力対象の選択UIは共用するが、変換パイプラインと設定モデルは分離する。

## 2. 基本方針

1. Thenの原稿文字列へ正規表現を連続適用せず、既存の文書ASTを変換元とする。
2. PDF／DOCX用の `ExportFormat` とページレイアウト設定へ投稿形式を混在させない。
3. 原稿の改行と空行を保存する。PDF用の段落統合処理は再利用しない。
4. 投稿先固有の規則はプロファイル別serializerへ閉じ込める。
5. 変換できない要素を暗黙に失わず、プレビューへ警告を表示する。
6. コピー内容とファイル保存内容には、同じ変換結果を使用する。
7. 初期リリースでは投稿サイトへのログインや直接投稿を行わない。

## 3. 現状の実装との関係

既存実装には、今回再利用できる要素がすでに存在する。

- `src/components/export/LinkedExportScreen.tsx`
  - 複数本文ファイルの選択、全選択、解除、並べ替え
  - 埋め込み表示と別ウィンドウ表示で共用されるエクスポート画面
- `src/export/types.ts`
  - `LoadedExportSource`、`ExportSourceFile` などの出力対象モデル
- `src/editor/ast/documentAst.ts`
  - 見出し、ルビ、圏点、縦中横、太字、行揃え、青空文庫注記の解析
- `src/App.tsx`
  - `navigator.clipboard.writeText()` を利用したクリップボード書き込み
- `src-tauri/src/lib.rs`
  - テキストファイルおよびバイナリエクスポートの保存ダイアログ

一方、`src/export/linkedDocument.ts` の `createLinkedExportDocument()` は、紙面組版のために連続する本文行を一つの段落へ統合し、空行を段落間隔へ置き換える。この処理を投稿用テキストへ適用すると原稿の改行構造が変わるため、本機能では使用しない。

## 4. 対象範囲

### 4.1 初期リリースに含めるもの

- 現在のエクスポート画面から「投稿用テキスト」へ切り替える導線
- 既存の出力対象選択と並べ替え
- カクヨム、なろう、プレーンの変換
- 変換後テキストのプレビュー
- 変換警告の表示
- クリップボードへのコピー
- 選択本文を連結した単一 `.txt` ファイルの保存
- 改行コードの選択（CRLF／LF）
- 見出しの扱いとファイル間区切りの設定

### 4.2 初期リリースに含めないもの

- 投稿サイトへのログイン、API連携、自動投稿
- 投稿済みエピソードとの差分同期
- 作品情報、あらすじ、タグ、公開日時などの投稿
- 複数ファイルを個別の `.txt` としてフォルダーへ一括保存
- 投稿サイトの実画面を内蔵した最終プレビュー
- 投稿サイト仕様の自動取得

個別ファイルの一括保存は、単一ファイル出力が安定した後の拡張候補とする。

## 5. UI設計

### 5.1 出力用途の切り替え

エクスポート画面へ、次の用途切り替えを追加する。

- 印刷・文書
  - PDF
  - DOCX
- 投稿用テキスト
  - カクヨム
  - 小説家になろう
  - プレーンテキスト

「印刷・文書」では既存の紙面プレビューとレイアウト設定を表示する。「投稿用テキスト」では紙面設定を隠し、投稿用設定とテキストプレビューを表示する。

出力対象一覧は両用途で共用する。既存のファイルごとの開始方法（前の続き、改ページ、奇数ページ開始、偶数ページ開始）は紙面専用のため、投稿用テキスト選択時には表示しない。代わりに、ファイル間区切りを投稿用設定で一括指定する。

### 5.2 投稿用設定

初期リリースでは次の設定を提供する。

| 設定 | 値 | 既定値 |
|---|---|---|
| 投稿先 | カクヨム／なろう／プレーン | カクヨム |
| 見出し | 記号のみ除去／先頭見出しを除外／すべて除外 | 記号のみ除去 |
| ファイル間区切り | 空行／`＊　＊　＊`／任意文字列 | 空行2行 |
| 改行コード | Windows（CRLF）／LF | CRLF |
| なろうの傍点 | 1文字ずつルビ化／解除 | 1文字ずつルビ化 |

「なろうの傍点」は変換結果を明示するため設定として表示してもよいが、内部の標準動作は「1文字ずつルビ化」とする。UIを簡潔にする場合、「解除」は詳細設定へ移す。

### 5.3 プレビュー

中央ペインへ読み取り専用の等幅テキストプレビューを表示する。最低限、次の情報を併記する。

- 出力文字数
- 選択ファイル数
- 投稿プロファイル名
- 警告件数
- 変換結果の先頭から末尾まで

プレビューは選択ファイル、並び順、投稿先、変換設定の変更時に再生成する。原稿量が多い場合にUIを停止させないため、PDF／DOCXと同様にWorkerへ移せる境界を用意する。ただし初期実装は、計測のうえ同期処理で十分なら過剰にWorker化しない。

### 5.4 実行ボタン

投稿用テキスト選択時のフッターは次の構成とする。

- キャンセル
- クリップボードへコピー
- テキストファイルに保存

コピー成功時は、例えば次のトーストを表示する。

```text
カクヨム形式をコピーしました（4,820字、警告なし）
```

警告が存在してもコピーと保存は禁止しない。ただし、ボタン操作後にも「3件の警告があります」のように通知し、利用者が見落とさないようにする。

## 6. データモデル

PDF／DOCX用の `ExportFormat` は変更せず、投稿用の型を追加する。

```ts
export type SubmissionTarget = "kakuyomu" | "narou" | "plain";

export type SubmissionHeadingMode =
  | "keep-text"
  | "remove-first"
  | "remove-all";

export type SubmissionLineEnding = "crlf" | "lf";

export type NarouEmphasisMode = "ruby-dots" | "plain";

export type SubmissionExportOptions = {
  target: SubmissionTarget;
  headingMode: SubmissionHeadingMode;
  sourceSeparator: string;
  lineEnding: SubmissionLineEnding;
  narouEmphasisMode: NarouEmphasisMode;
};

export type SubmissionWarningKind =
  | "unsupported-markup"
  | "ruby-limit"
  | "nested-decoration"
  | "literal-notation-conflict"
  | "decoration-removed";

export type SubmissionWarning = {
  sourceId: string;
  sourceName: string;
  line?: number;
  kind: SubmissionWarningKind;
  message: string;
};

export type SubmissionExportResult = {
  target: SubmissionTarget;
  text: string;
  chars: number;
  sourceCount: number;
  warnings: SubmissionWarning[];
};
```

投稿用の中立モデルは、元の行境界を保持できることを必須とする。

```ts
export type SubmissionLine = {
  sourceLine: number;
  kind: "blank" | "paragraph" | "heading" | "list";
  level: number;
  inlines: ExportInline[];
};

export type SubmissionSection = {
  source: ExportSourceFile;
  lines: SubmissionLine[];
};

export type SubmissionDocument = {
  schemaVersion: 1;
  title: string;
  sections: SubmissionSection[];
};
```

`ExportInline` を共用するとPDF側の変更が投稿側へ波及する可能性がある。実装時に依存が複雑になる場合は `SubmissionInline` を別定義し、ASTから明示的に写像する。

## 7. ファイル構成

投稿用処理を `src/export/submission` 配下へ分離する。

```text
src/export/submission/
  types.ts
  createSubmissionDocument.ts
  serializeSubmission.ts
  graphemes.ts
  profiles/
    kakuyomu.ts
    narou.ts
    plain.ts
```

責務は次のように分ける。

- `createSubmissionDocument.ts`
  - `LoadedExportSource[]` からASTを作成
  - 選択順に `SubmissionSection` を構築
  - 原稿の行、空行、インライン要素を保持
- `profiles/*.ts`
  - 一つのインライン要素または行を投稿先記法へ変換
  - 投稿先固有の警告を生成
- `serializeSubmission.ts`
  - 見出し設定を適用
  - セクションを指定区切りで連結
  - 最後に改行コードを正規化
  - `SubmissionExportResult` を返す
- `graphemes.ts`
  - Unicode書記素単位の分割
  - なろう傍点変換で利用

## 8. 変換パイプライン

```text
LoadedExportSource[]
  -> enabledなsourceをorder順に抽出
  -> createDocumentAst()
  -> SubmissionDocument
  -> 投稿先profileで各inlineを変換
  -> 見出し規則を適用
  -> ファイル間区切りを挿入
  -> LFへ一度正規化
  -> 指定されたCRLFまたはLFへ変換
  -> SubmissionExportResult
  -> プレビュー／コピー／保存
```

フロントマターは現在のエクスポート開始処理で本文から分離されているため、初期実装では投稿本文へ含めない。将来、タイトルや前書きへ写像する場合は別機能として設計する。

## 9. 投稿先別の変換規則

### 9.1 共通規則

- 原稿内の改行と空行を維持する。
- Thenの行揃え指示は投稿本文へ出力しない。
- 縦中横は投稿サイト側で再現せず、内容文字列だけを出力する。
- 太字は内容文字列だけを出力し、必要に応じて警告する。
- 未知のインライン要素は内容文字列を残し、`unsupported-markup` 警告を生成する。
- 変換結果の改行コード適用は全変換の最後に一度だけ行う。
- 出力末尾の改行は1つに正規化する。

### 9.2 変換表

| Then要素 | カクヨム | なろう | プレーン |
|---|---|---|---|
| 通常本文 | そのまま | そのまま | そのまま |
| ルビ | `｜本文《ルビ》` | `｜本文《ルビ》` | 本文のみ |
| 圏点・傍点 | `《《本文》》` | 1文字ごとに `｜字《・》` | 本文のみ |
| 縦中横 | 本文のみ | 本文のみ | 本文のみ |
| 太字 | 本文のみ | 本文のみ | 本文のみ |
| 行揃え | 指示を除去 | 指示を除去 | 指示を除去 |
| 青空文庫注記 | 対応注記は保持、未知は警告 | 対応注記は保持、未知は警告 | 既定では除去 |
| 見出し | 見出し設定に従う | 見出し設定に従う | 見出し設定に従う |

### 9.3 ルビ

カクヨム、なろうとも、省略形を使わず次の明示形へ統一する。

```text
｜親文字《ルビ》
```

親文字が漢字だけの場合でも `｜` を付ける。これにより、直前の本文と親文字の境界や、漢字以外を含む親文字の範囲が曖昧になることを避ける。

モノルビとして解析された要素は、ASTの `rubyItems` を順番に個別出力する。グループルビは一つの明示形として出力する。

カクヨムについては親文字最大20文字、ルビ文字最大50文字という公式仕様があるため、超過時には `ruby-limit` 警告を生成する。自動分割は読みとの対応を壊す可能性があるため行わない。

### 9.4 カクヨムの傍点

次の記法へ変換する。

```text
Then:      [重要(em,goma)]
カクヨム:  《《重要》》
```

`goma`、`dot`、`auto` は、初期実装ではすべてカクヨムの傍点記法へ正規化する。スタイル差が失われる場合は警告ではなく、投稿プロファイルの仕様として扱う。

### 9.5 なろうの傍点

なろう形式では、傍点対象をUnicode書記素単位に分割し、それぞれへ `・` のルビを付ける。

```text
Then:   [重要(em,goma)]
なろう: ｜重《・》｜要《・》
```

JavaScriptの添字や `split("")` ではUTF-16コード単位に分割され、サロゲートペア、結合文字、異体字セレクタを壊す。そのため `Intl.Segmenter` の `grapheme` を使用する。

```ts
export function splitGraphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
  return [...segmenter.segment(text)].map(({ segment }) => segment);
}

export function serializeNarouEmphasis(text: string): string {
  return splitGraphemes(text)
    .map((segment) => /^\s+$/u.test(segment) ? segment : `｜${segment}《・》`)
    .join("");
}
```

空白と改行には傍点を付けない。句読点や記号は、利用者が選択範囲に含めた意図を尊重して傍点化する。`goma`、`dot`、`auto` は初期実装ではすべて `・` に正規化する。

実行環境で `Intl.Segmenter` が利用できない場合は `Array.from(text)` をフォールバックにできるが、結合文字を完全には保護できない。現在のTauri WebView2を対応環境とするなら、`Intl.Segmenter` を必須として明示的に失敗させる方が安全である。

### 9.6 プレーンテキスト

ルビ、傍点、縦中横、太字、行揃えなどの制御記法を除き、読者が読む本文だけを残す。ルビは親文字のみを出力する。装飾が失われることはプロファイルの目的どおりなので、通常は警告しない。

### 9.7 リテラル記号

本文中に記法ではない `｜`、`《`、`》` が存在する場合、投稿サイト側で意図せずルビ記法として解釈される可能性がある。

初期実装では原稿を推測で書き換えず、ASTで装飾として認識されていない記号の組み合わせを検査し、`literal-notation-conflict` 警告を表示する。自動エスケープは、投稿先ごとの仕様を十分に検証してから追加する。

## 10. 見出しと複数ファイル連結

### 10.1 見出し

- `keep-text`
  - Markdown／Thenの見出し記号だけを除き、見出し文字列を本文へ残す。
- `remove-first`
  - 各ファイルの最初の見出しをエピソードタイトル相当として除外する。
  - 2つ目以降の見出しは文字列として残す。
- `remove-all`
  - すべての見出し行を除外する。

既定値は、情報を失わない `keep-text` とする。

### 10.2 連結

有効なsourceを `order` 順に変換し、`sourceSeparator` で連結する。区切り文字列自体もLFへ正規化してから使用する。

先頭または末尾へ不要な区切りは付けない。各source末尾の過剰な改行は、本文中の空行を壊さない範囲で正規化し、source間に設定どおりの区切りを一度だけ挿入する。

## 11. クリップボード出力

クリップボード書き込みは、既存コードと同じ `navigator.clipboard.writeText()` を使用する。呼び出しを `src/export/submission/submissionHostActions.ts` などへ共通化し、埋め込み画面と別ウィンドウの両方から利用する。

```ts
export async function copySubmissionText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("クリップボードへ書き込めません");
  }
  await navigator.clipboard.writeText(text);
}
```

書き込みは必ず利用者のボタンクリックから直接開始する。失敗時にファイル保存へ自動で切り替えず、エラーを表示して利用者に選択を委ねる。

## 12. テキストファイル保存

既存の `save_text_file_dialog` は既定ファイル名を引数で受け取らないため、投稿用保存コマンドを追加する。

```rust
#[tauri::command]
fn save_submission_text_dialog(
    app: tauri::AppHandle,
    content: String,
    file_name: String,
) -> Result<Option<ExportResult>, String>
```

要件は次のとおり。

- 保存形式はUTF-8、BOMなし
- 拡張子がない場合は `.txt` を付ける
- ダイアログのフィルターは「テキスト文書（txt）」
- キャンセルはエラーではなく `Ok(None)`
- ファイル名の禁止文字は既存の `exportFileName()` と同等に置換

推奨ファイル名は次のとおり。

```text
第01話_旅立ち_kakuyomu.txt
第01話_旅立ち_narou.txt
作品名_kakuyomu.txt
```

1ファイルだけを出力する場合はsource名、複数ファイルの場合はworkspace／作品タイトルを基準にする。

## 13. Reactコンポーネントの分割

`LinkedExportScreen` へすべての状態とUIを追加すると責務が大きくなるため、次の分割を行う。

```text
components/export/
  LinkedExportScreen.tsx
  ExportSourceSelector.tsx
  PrintExportPanel.tsx
  SubmissionExportPanel.tsx
```

- `LinkedExportScreen`
  - 出力用途の切り替え
  - source選択状態の所有
  - 閉じる、元ファイルを開くなどの共通操作
- `ExportSourceSelector`
  - 有効／無効、並べ替え、全選択、全解除
- `PrintExportPanel`
  - 既存のPDF／DOCX設定、プレビュー、進捗
- `SubmissionExportPanel`
  - 投稿先設定、テキストプレビュー、警告、コピー、保存

既存画面の大規模な分割を同時に行うリスクが高い場合、最初に `SubmissionExportPanel` とserializerだけを追加し、`ExportSourceSelector`／`PrintExportPanel` の抽出は別コミットに分ける。

## 14. 状態と設定の保存

投稿用設定はPDFレイアウト設定と別のlocalStorageキーへ保存する。

```text
then-submission-export-options-v1
```

保存対象は投稿先、見出し設定、区切り、改行コード、なろう傍点設定とする。原稿本文、変換後テキスト、警告は保存しない。

保存データには将来の移行用バージョンを持たせる。

```ts
type StoredSubmissionOptions = {
  version: 1;
  options: SubmissionExportOptions;
};
```

不正または古い値を読み込んだ場合は、項目ごとに検証して既定値へ戻す。

## 15. エラーと警告

### 15.1 エラー

処理を続行できないものをエラーとする。

- 出力対象が0件
- sourceの読み込み失敗により出力可能な本文が0件
- AST生成失敗
- クリップボードAPIの失敗
- 保存ダイアログまたはファイル書き込みの失敗

### 15.2 警告

本文を残したまま処理を続行できるものを警告とする。

- カクヨムのルビ文字数制限超過
- 投稿先で再現できない装飾
- 装飾の入れ子や競合
- リテラル記号が投稿先記法として解釈される可能性
- 未知の青空文庫注記
- sourceの一部読み込み失敗。ただし他に出力可能なsourceがある場合

警告にはsource名と可能なら原稿行番号を含める。

## 16. テスト方針

serializerはUIやTauriから独立した純粋関数として実装し、決定的なテストを用意する。

### 16.1 単体テスト

最低限、次の入力を対象に期待文字列を固定する。

- 通常本文、連続行、空行、末尾改行
- H1〜H6
- Then形式のグループルビ
- Then形式のモノルビ
- 青空文庫形式のルビ
- `goma`、`dot`、`auto` の圏点
- 縦中横、太字、行揃え
- 複数装飾を含む1行
- 半角／全角空白、タブ
- CRLF、LF、CRの混在
- 絵文字、サロゲートペア、結合文字、異体字セレクタ
- リテラルの `｜《》`
- 複数sourceの並び順、無効source、区切り文字

なろう傍点の必須fixtureは次のとおり。

```text
重要       -> ｜重《・》｜要《・》
とても重要 -> ｜と《・》｜て《・》｜も《・》｜重《・》｜要《・》
A級        -> ｜A《・》｜級《・》
重要！     -> ｜重《・》｜要《・》｜！《・》
重要 語句  -> ｜重《・》｜要《・》 ｜語《・》｜句《・》
```

異体字セレクタを含む字や結合文字については、分割後の要素数と出力文字列の双方を検証する。

### 16.2 AST不変テスト

投稿用変換の前後で元のASTとsource本文が変更されないことを検証する。既存の `test:export` と同様に、変換関数が入力を書き換えないことを保証する。

### 16.3 UIテスト

- 出力用途を切り替えてもsourceの選択と順序が維持される
- 投稿先変更でプレビューが更新される
- 出力対象0件ではコピー／保存が無効になる
- コピー成功／失敗の通知
- 警告一覧からsourceを識別できる
- 埋め込み表示と別ウィンドウ表示の双方で操作できる
- 狭い画面では対象、設定、プレビューをタブ切り替えできる

### 16.4 Tauriテスト

- 指定ファイル名が保存ダイアログへ渡される
- 拡張子なしの場合に `.txt` が付く
- UTF-8内容と指定改行コードが保持される
- キャンセルが正常系として返る

新しいテストスクリプトには、例えば次の名前を使用する。

```json
"test:submission-export": "node scripts/test-submission-export.mjs"
```

## 17. 実装順序

### Phase 1: 変換コア

1. 投稿用の型を追加する。
2. `SubmissionDocument` の生成を実装する。
3. 3つの投稿プロファイルを実装する。
4. なろう傍点の書記素分割を実装する。
5. 単体テストとAST不変テストを追加する。

### Phase 2: UIとコピー

1. エクスポート画面へ用途切り替えを追加する。
2. 投稿用設定とプレビューを追加する。
3. 警告一覧を追加する。
4. クリップボードコピーを接続する。
5. 埋め込み表示と別ウィンドウ表示を確認する。

### Phase 3: ファイル保存

1. `save_submission_text_dialog` をRust側へ追加する。
2. React側の保存操作を接続する。
3. ファイル名、文字コード、改行コードを検証する。

### Phase 4: リファクタリングと拡張準備

1. 必要に応じてsource selectorと印刷パネルを分割する。
2. 性能計測に基づきserializerのWorker化を判断する。
3. 個別ファイル一括保存用の出力モデルを検討する。

各Phaseは独立したコミットに分け、PDF／DOCXの既存動作を各段階で回帰確認する。

## 18. 完了条件

次をすべて満たした時点で初期実装を完了とする。

- カクヨム、なろう、プレーンを選択できる。
- 選択したsourceだけが画面上の順序で出力される。
- 改行と空行が期待どおり保持される。
- ルビが両投稿形式で明示形へ変換される。
- カクヨムの傍点が `《《本文》》` になる。
- なろうの傍点が書記素ごとの `｜字《・》` になる。
- 変換できない要素が本文ごと消失せず、警告される。
- プレビュー、クリップボード、保存ファイルの本文が一致する。
- UTF-8 `.txt` を指定ファイル名で保存できる。
- 既存のPDF／DOCXエクスポートが回帰しない。
- `npm run build`、既存 `npm run test:export`、新しい投稿用テストが成功する。

## 19. 参照した投稿仕様

- カクヨム「ルビや傍点を付ける（カクヨム記法を使う）」
  https://kakuyomu.jp/help/entry/notation
- 小説家になろう「ルビの挿入」
  https://syosetu.com/helpcenter/helppage/helppageid/42
- 小説家になろう「傍点の挿入」
  https://syosetu.com/helpcenter/helppage/helppageid/43

投稿サイト側の仕様は変更される可能性がある。プロファイルの変換規則を変更する場合は、参照日、fixture、変更理由を同じコミットで更新する。
