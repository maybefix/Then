# Idea / Canvas 連携 要件定義

作成日: 2026-07-04

## 目的

Then の右サイドバーにある現在の Idea 機能を活かしつつ、別ウィンドウの Canvas / Idea Board を追加する。

Idea は現在プロジェクト内で本文へ使うための作業メモとして維持する。Canvas はプロジェクト未満の着想、複数プロジェクト横断の構想、アイデア同士の関係整理を扱う広い作業空間とする。

このドキュメントは実装前の要件整理であり、仕様確定ではない。実装・試用に合わせて更新する。

## 基本方針

- 既存の Idea 機能は、現在プロジェクト用の作業メモとして残す。
- Canvas は Canvas として独立させ、Idea と完全には統合しない。
- Idea と Canvas は相互に内容を送り合える。
- 相互送信は同期ではなくコピー作成とする。
- 正本はそれぞれにある。Idea の正本は Idea 側、Canvas の正本は Canvas 側にある。
- コピー元への参照情報は残すが、自動同期はしない。
- Canvas の保存形式は JSON Canvas (`.canvas`) の採用を前提に検討する。

## 用語

### Idea

右サイドバーにある、現在プロジェクト用のメモ機能。

主な用途:

- 現在書いているプロジェクトの作業メモ
- 場面、伏線、セリフ、方針、修正メモの保持
- 本文へ挿入・消化するための補助
- スレッド単位での整理

### Canvas / Idea Board

別ウィンドウで開く、自由配置型の構想ボード。

主な用途:

- まだプロジェクトになっていないアイデアの整理
- 複数プロジェクトにまたがる構想
- アイデア同士の関係、距離感、候補群の視覚化
- 作品候補の育成
- Idea へ送る前の発想・分類・組み替え

## 対象範囲

### 対象に含める

- 現在プロジェクト用 Idea の維持
- Canvas / Idea Board の追加
- Idea から Canvas へのコピー送信
- Canvas から Idea へのコピー送信
- コピー元情報の保持
- コピー元へのジャンプ導線
- JSON Canvas 形式での保存・読み込み
- プロジェクト Canvas と共通 Canvas の整理

### 対象に含めない

- Idea と Canvas のリアルタイム同期
- コピー先の自動更新
- コピー元の自動更新
- Obsidian Canvas UI の完全再現
- 汎用ドローイングツール化
- Canvas を本文データの正本にすること

## 保存スコープ

### Project Idea

現在プロジェクトの Idea は、プロジェクトフォルダ内に保存する。

想定保存先:

- `.then/project.json`
- キー: `ideaThreads`

既存実装の `snippets` / `profileSnippets` 命名は旧スニペット時代の名残であり、将来的には Idea 名義へ整理する。

### Project Canvas

現在プロジェクトに紐づく Canvas は、プロジェクトフォルダ内に保存する。

想定保存先:

- `.then/boards/*.canvas`

用途:

- その作品専用の構想ボード
- 章、人物、伏線、資料、プロット候補の視覚整理

### Global Canvas

プロジェクト未満、複数プロジェクト横断、共通の着想はアプリデータ側に保存する。

想定保存先:

- アプリデータフォルダ配下の `boards/*.canvas`

用途:

- 未所属のアイデア
- 作品候補
- 複数作品に使い回せそうな種
- 共通ネタ帳

## データモデル方針

### Idea 側

Idea は現在の `IdeaThread` / `IdeaFragment` モデルをベースにする。

必要に応じて、コピー元情報を追加する。

```ts
type OriginRef = {
  source: "canvas";
  sourceId: string;
  sourceBoardId: string;
  copiedAt: number;
};
```

### Canvas 側

Canvas は JSON Canvas 形式を基礎とする。

Then 固有情報は、JSON Canvas の標準フィールドだけで表現できる範囲に収めることを優先する。必要な場合のみ Then 独自メタデータを追加する。

```ts
type OriginRef = {
  source: "idea";
  sourceId: string;
  sourceThreadId: string;
  sourceWorkspacePath: string;
  copiedAt: number;
};
```

### 正本分離

Idea と Canvas は同じ内容を持つことがあるが、同一オブジェクトとして扱わない。

例:

- Idea fragment を Canvas に送ると、Canvas text node が新規作成される。
- Canvas text node を Idea に送ると、Idea fragment が新規作成される。
- 送信後に片方を編集しても、もう片方は自動変更されない。

## 相互送信

### Idea から Canvas へ送る

#### 単一 fragment

Idea fragment を Canvas の text node としてコピーする。

要件:

- 送信先 Canvas を選べる。
- 既定では現在開いている Canvas に送る。
- Canvas が開いていない場合は、Project Canvas または Global Canvas を選べる。
- 作成された Canvas node にはコピー元 Idea の情報を持たせる。
- Idea 側には「Canvas へ送信済み」を示す控えめな表示を出せるとよい。

#### thread 全体

Idea thread を Canvas に送る。

要件:

- thread タイトルを group または見出し的な text node として配置する。
- thread 内 fragment を text node として配置する。
- fragment 間は必要に応じて edge でつなぐ。
- group と fragment node にはコピー元情報を持たせる。

#### 複数 fragment

選択した複数 fragment を Canvas に送る。

要件:

- まとめて近い位置へ配置する。
- 必要に応じて group 化できる。
- 配置後に Canvas 側で自由に並べ替えられる。

### Canvas から Idea へ送る

#### 単一 text node

Canvas text node を現在プロジェクトの Idea fragment としてコピーする。

要件:

- 送信先 thread を選べる。
- 既定では Idea の inbox thread に追加する。
- 作成された Idea fragment にはコピー元 Canvas node の情報を持たせる。

#### group

Canvas group 内の text node を Idea thread としてコピーする。

要件:

- group 名を Idea thread のタイトルに使う。
- group 内 text node を fragment として追加する。
- node の位置順、または選択順を fragment 順に反映する。
- edge label がある場合は、補足メモとして扱うか、fragment 間の区切りとして扱う。

#### 複数 node

選択した複数 node を Idea thread としてコピーする。

要件:

- 新規 thread として取り込める。
- 既存 thread に追記できる。
- node の順序決定ルールを明示する。

## コピー元参照とジャンプ

### Idea 側の導線

コピー元が Canvas の場合:

- 「元 Canvas を開く」
- 「元 node を Canvas 上で選択」
- 「Canvas へ再送」

### Canvas 側の導線

コピー元が Idea の場合:

- 「元 Idea を開く」
- 「元 thread を表示」
- 「Idea へ再送」

### 再送時の選択肢

再送は自動同期ではなく、明示操作とする。

選択肢:

- 新規コピーとして送る
- 既存コピーを上書きする
- 既存コピーへ追記する

初期実装では「新規コピーとして送る」のみでよい。

## UI 要件

### 右サイドバー Idea

既存の右サイドバー Idea は、現在プロジェクト用として維持する。

必要な追加操作:

- fragment のメニューから「Canvas へ送る」
- thread のメニューから「Canvas へ送る」
- コピー元 Canvas がある fragment に「元 Canvas を開く」

### Canvas 別ウィンドウ

Canvas は別ウィンドウで開く。

必要な基本操作:

- Canvas の作成
- Canvas の一覧
- Canvas の切り替え
- text node の作成、編集、削除
- group の作成、編集、削除
- node の移動、リサイズ
- edge の作成、編集、削除
- pan / zoom
- 選択 node を Idea に送る
- コピー元 Idea を開く

### コマンドパレット

追加候補:

- `Idea Board を開く`
- `現在の Idea を Canvas へ送る`
- `選択 Canvas node を Idea へ送る`
- `Global Canvas を開く`
- `Project Canvas を開く`

### ショートカット

追加候補:

- `Ctrl + Alt + I`: 既存どおり Quick Idea
- `Ctrl + Alt + B`: Idea Board を開く

ショートカットは既存操作と衝突しないように調整する。

## JSON Canvas 採用方針

Canvas の保存形式は JSON Canvas (`.canvas`) を優先候補とする。

期待する利点:

- Obsidian Canvas と互換性を持てる可能性がある。
- ファイル形式がテキスト JSON で扱いやすい。
- `text` / `file` / `link` / `group` / `edge` の基本表現が用途に合う。
- Then 外のツールで確認・移行しやすい。

注意点:

- JSON Canvas は保存形式であり、Canvas 編集 UI そのものではない。
- Then 固有の「Idea へ送る」「本文へ送る」「使用済み」などは別途実装する。
- Obsidian 互換を保つため、独自メタデータの入れ方は慎重に決める。

## 実装段階

### Phase 1: 要件整理と命名整理

- 既存の「スニペット保存先」設定の扱いを決める。
- 現在の `snippets` / `profileSnippets` 命名を Idea 文脈へ整理する方針を決める。
- Idea は現在プロジェクト用として扱うことをドキュメント化する。
- Canvas は別機能として要件定義する。

### Phase 2: Canvas 保存・読み込み

- JSON Canvas 型を追加する。
- Project Canvas の保存・読み込みを追加する。
- Global Canvas の保存・読み込みを追加する。
- Canvas 一覧を取得できるようにする。

### Phase 3: Canvas ウィンドウ MVP

- 別ウィンドウで Canvas を開く。
- text node を作成・編集・移動できる。
- group を作成・編集・移動できる。
- edge を作成できる。
- pan / zoom ができる。
- 保存・復元できる。

### Phase 4: Idea から Canvas へ送る

- Idea fragment を Canvas text node にコピーする。
- Idea thread を Canvas group + text nodes にコピーする。
- コピー元情報を保存する。
- Canvas 側から元 Idea を開けるようにする。

### Phase 5: Canvas から Idea へ送る

- Canvas text node を Idea fragment にコピーする。
- Canvas group を Idea thread にコピーする。
- コピー元情報を保存する。
- Idea 側から元 Canvas を開けるようにする。

### Phase 6: 再送・差分確認

- コピー済み項目を再送できるようにする。
- 新規コピー、上書き、追記の選択肢を検討する。
- 差分表示は必要性を見て判断する。

## 未決事項

- Global Canvas の正確な保存場所
- Project Canvas の既定ファイル名
- Canvas 一覧 UI の置き場所
- JSON Canvas に Then 独自メタデータをどう持たせるか
- Obsidian 互換をどこまで重視するか
- Canvas 編集 UI の実装方式
- edge label を Idea へ送るときの扱い
- Idea の「使用済み」と Canvas node の関係
- Canvas から本文へ直接挿入するか
- 複数プロジェクトをまたぐ Canvas node の扱い

## 優先度

### P0

- Idea は現在プロジェクト用として維持する。
- Canvas は別ウィンドウ・別機能として作る。
- 相互送信はコピー作成とする。
- 正本はそれぞれにある。
- 自動同期はしない。

### P1

- JSON Canvas 形式で保存する。
- Project Canvas と Global Canvas を分ける。
- コピー元情報を保持する。
- 相互ジャンプできる。
- group を Idea thread として取り込める。

### P2

- 再送時の上書き・追記
- 差分確認
- Canvas から本文への直接挿入
- Obsidian 互換性の検証
- 複数 Canvas 間のコピー

## 期待する利用シナリオ

### シナリオ 1: 未所属アイデアを育てる

1. Global Canvas を開く。
2. 思いついた断片を text node として置く。
3. 関係がありそうな node を近くへ寄せる。
4. group 化して作品候補にする。
5. 必要になったら現在プロジェクトの Idea thread として送る。

### シナリオ 2: 現在プロジェクトのメモを Canvas で広げる

1. 右サイドバーの Idea thread を Canvas へ送る。
2. Canvas 上で場面、人物、伏線ごとに並べ替える。
3. edge で関係をつなぐ。
4. 整理後の group を新しい Idea thread としてプロジェクトへ戻す。

### シナリオ 3: Canvas から執筆用 Idea へ落とす

1. Canvas 上で複数 node を選ぶ。
2. 「現在プロジェクトの Idea へ送る」を実行する。
3. Idea 側で本文へ使う順に整理する。
4. 必要な fragment を本文へ挿入する。

## 実装メモ

- 初期実装では同期や差分確認を持たない。
- MVP は text node と group の往復だけで成立する。
- edge は最初は Canvas 内だけで意味を持てばよい。
- 既存 Idea の保存方式を壊さない。
- 既存の未コミット作業と衝突しないよう、段階的に導入する。
