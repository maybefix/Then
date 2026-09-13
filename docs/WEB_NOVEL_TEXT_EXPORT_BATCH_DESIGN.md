# 個別テキストファイル出力の拡張設計

2026-09-13 / Phase 4で検討。現在は単一ファイル連結保存のみを提供する。

## 出力モデル案

```ts
type SubmissionOutputFile = {
  sourceId: string;
  sourceName: string;
  order: number;
  fileName: string;
  result: SubmissionExportResult;
};

type SubmissionBatchResult = {
  files: SubmissionOutputFile[];
  totalChars: number;
  warningCount: number;
};
```

生成時は `SubmissionDocument.sections` の順序を維持し、1セクションずつ既存serializerへ渡す。
これによりルビ・見出し・改行・警告を単一ファイル保存と共用する。
各resultのsourceCountは1、ファイル間区切りは使用しない。ASTの再生成は不要。
読み込み失敗は出力ファイルを作らず、バッチ全体の読み込み警告として別途保持する。

## ファイル名と保存

- source名の拡張子を外し、投稿形式と `.txt` を付ける既存の命名規則を使用する。
- 禁止文字置換後、Windowsの大文字小文字を無視した同名判定を行う。
- 衝突は選択順に `_2`、`_3` を付け、候補全体との再衝突も確認する。
- 出力先に既存ファイルがある場合の上書き・スキップは、一括保存UIで明示的に選択する。
- フォルダーを一度選び、確定した出力リストをRustへ渡す。原稿パスを出力先に流用しない。
- ファイル単位の保存成功・失敗・スキップを返し、途中失敗時も成功済みファイルを表示する。
- 実装時には保存先配下へのパス検証、予約名・末尾ドットなどのWindows規則も追加する。

このモデルは設計案のみで、未使用の型や一括保存コマンドは製品コードへ追加していない。
実装着手時に確認する項目は、同名衝突、既存ファイル、途中失敗、空本文、全件読み込み失敗、保存先キャンセル。
