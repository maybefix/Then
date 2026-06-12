# 次回セッション: Milkdown 導入方針

## 目的

現在の `contenteditable` ベースの UI プロトタイプを、Markdown ドキュメントとして扱えるエディタへ移行する。

Milkdown は単なる Markdown パーサーではなく、ProseMirror ベースの WYSIWYG Markdown editor framework として導入する。次回は中央エディタの中核を Milkdown に置き換える。

## 推奨ステップ

1. Milkdown 関連パッケージを追加する
   - `@milkdown/core`
   - `@milkdown/kit`
   - 必要に応じて React 連携パッケージ
   - 最初は CommonMark または GFM の最小構成にする

2. 現在の中央エディタを Milkdown コンポーネントに置き換える
   - `contenteditable` の直書き DOM 操作を削除する
   - 初期本文を Markdown 文字列として定義する
   - h1 と段落は Milkdown の Markdown 表現から生成する

3. スニペットのダブルクリック挿入を復旧する
   - まずカーソル位置への段落挿入だけを実装する
   - DOM の `insertBefore` は使わない
   - Milkdown / ProseMirror の command または transaction 経由にする

4. ドラッグアンドドロップ挿入を復旧する
   - ドロップ位置から ProseMirror の挿入位置を求める
   - 横線インジケータは Milkdown 外側の overlay か ProseMirror plugin で検討する

5. 挿入段落の装飾方法を決める
   - Markdown として永続化するなら blockquote など既存 Markdown 記法に寄せる
   - UI上だけの一時装飾なら ProseMirror decoration を使う
   - 独自 node attribute は Markdown 出力との整合性を確認してから採用する

## 注意点

- Monaco Editor や CodeMirror は導入しない
- Markdown プレビューやファイル保存にはまだ進まない
- Rust側に不要な Tauri command を追加しない
- 既存の右側スニペットパネル、パンくず、ステータスバー、トーストは可能な限り維持する
- Milkdown 導入後は React state とエディタ内部状態の責務を明確に分ける

## 完了条件

- `npm run build` が通る
- `npm run tauri build` が通る
- 初期 Markdown 本文が Milkdown に表示される
- スニペット検索が引き続き動く
- ダブルクリックで Milkdown のカーソル位置へスニペットを段落挿入できる
- 現行 UI の見た目が大きく崩れていない
