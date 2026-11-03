# ピンク系テーマの比較案

`index.html` で4案と縦書き・横書きの計8画面を切り替えて比較できる。

正式実装済み。A・Bを **Aplil**、D・Cを **Blossom** のライト・ダークとしてテーマ選択画面に登録している。

| テーマ名 | ライト | ダーク |
| --- | --- | --- |
| Aplil | B / `aplil-light` | A / `aplil-dark` |
| Blossom | D / `blossom-light` | C / `blossom-dark` |

## 配色

| 案 | 操作部 | 原稿面 | 操作部のアクセント | 原稿面のアクセント |
| --- | --- | --- | --- | --- |
| A · Charcoal Pink | `#3e3e49` | `#41414c` | `#f477a4` | `#f477a4` |
| B · Raspberry Paper | `#faf6f5` | `#fffcfd` | `#c72b68` | `#c72b68` |
| C · Pink Desk | `#3e3e49` | `#fffcfd` | `#f477a4` | `#c72b68` |
| D · Paper Night | `#faf6f5` | `#41414c` | `#c72b68` | `#f477a4` |

Aは添付1枚目の青みのあるチャコールと明るいピンクを優先。Bは添付2枚目の生成り・白・濃いピンクを優先。Cは両者を組み合わせ、明るい本文と暗い操作部で役割を分ける。添付からの厳密な色抽出ではなく、長時間の執筆と文字のコントラストに合わせた提案値。

DはCの反対で、Bのライトテーマをベースに編集面だけをAのチャコールへ切り替える。上部バー・ファイルツリー・プロットはライトのまま、本文と編集面のステータスバーをダークにする。本文・リンク・引用・コード・選択色も編集面のスコープで定義する。

既存Roseは赤茶寄りの低彩度ローズとグラデーション。本案は彩度を上げ、青みのニュートラルと均一な塗りを使う。共通の角丸は操作部8px・カード12px。4案でレイアウト・フォント・文字サイズを揃える。

## コードとの対応

- `preview.html` / `preview.ts` は現行の `src/main.tsx` と `App` を読み込む。画面をHTMLで模写していない。
- `src/styles/themes/aplil-blossom.css` を通常のテーマCSSとして読み込む。共通のカードレイアウトを使い、C・Dは原稿面の文字・リンク・引用・コード・選択色も独立して定義する。
- 通常の `data-theme` 属性で切り替え、プレビュー専用のCSS上書きは使わない。`themes.css` は初期提案の記録としてのみ残している。
- ファイル・原稿・プロットはメモリ内の架空データ。IPCの代替をこのプレビューページ内にだけ用意し、実ファイルの読み書きはしない。
- テーマID・カタログ・4種類のプレビューを登録済み。既存の設定保存・復元とキャンバスへのテーマ受け渡しを利用する。

## 再現

リポジトリのルートで以下を実行する。

```powershell
npm run dev -- --host 127.0.0.1 --port 1421
```

比較画面: <http://127.0.0.1:1421/docs/theme-mockups/pink-proposals/index.html>

ライブ画面: <http://127.0.0.1:1421/docs/theme-mockups/pink-proposals/preview.html?theme=charcoal>

`theme=paper` / `theme=split` / `theme=reverse`、`writing=horizontal` で変更できる。
比較画面のPNG表示はViteを起動せずローカルファイルを直接開いても使える。

撮影・検証を再実行する場合:

```powershell
node scripts/capture-pink-proposals.mjs
```

スクリプトは一時Viteサーバーと一時プロファイルのヘッドレスEdgeを起動し、終了時に閉じる。1600×1000で全8画面を撮影し、登録済みテーマID、各案の主要領域の位置・寸法の一致、実行時例外の有無、通常文字用トークン7組と描画された本文の4.5:1以上のコントラストを検査する。Dではライトの操作部とダークの本文が描画されることも検査する。実際のテーマ選択画面から4種類を選び、即時反映と保存も確認する。結果は `verification.json`。画面全体の全状態についてのアクセシビリティ監査ではない。

タイプライターモードの中央線は、選択背景用の不透明な `--accent-soft` と分け、編集面ごとの `--typewriter-guide-color`（ピンク・不透明度14%）で描く。文字の上を通っても文字を塗り潰さない。共通CSSは専用色がないテーマには従来の `--accent-soft` を使う。

中央線の回帰確認は `node scripts/capture-pink-proposals.mjs --typewriter`。タイプライターモードをONにし、4種類×縦横の8画面で中央線の半透明・1px幅・操作を遮らないこと・編集面に合う線色を検査する。画像は `*-typewriter.png`、結果は `typewriter-verification.json` に保存する。ライブプレビューにも `&typewriter=1` を付けて再現できる。

## 参照

主な配色の根拠はユーザー添付の2枚。補助として配色スキルに同梱されたRaycastの面の明暗差・アクセントの抑制と、noteの本文優先・和文フォントの考え方を参照した。各ブランドの色・ロゴ・フォントを再現するものではない。Thenで設定される本文・UIフォントを維持する。

- [Raycast design reference source](https://github.com/VoltAgent/awesome-design-md)
- [note design reference source](https://github.com/kzhrknt/awesome-design-md-jp)
