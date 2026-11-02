# 見た目の定義と適用の置き場所

`src/main.tsx` は `src/App.css`、`src/styles/themes/index.css` の順で読み込む。
`App.css` は用途別CSSへの入口で、分離前の適用順を保っている。importを名前順に並べ替えると、同じ優先度の指定の勝ち負けが変わる。

| 変更するもの | 編集先 |
|---|---|
| 各テーマの配色や固有の見た目 | `themes/<テーマ名>.css`。同じ系統のライト・ダークは同じファイル |
| 全テーマで共通する見た目 | `themes/foundations.css` |
| 特定の複数テーマが共有する見た目 | `themes/shared-variants.css` |
| Idea・アウトライン・サイドバー・進捗色の明暗別の共通指定 | `themes/shared-idea.css`、`shared-outline.css`、`shared-sidebar.css`、`shared-progress.css` |
| 設定がないときのフォント・配色・寸法 | `app/defaults.css`、`app/progressDefaults.css` |
| キャンバス本体・埋め込み・サイドパネル | `../components/canvas/canvas.css`、`canvasEmbedded.css`、`canvasSidePanel.css` |
| テーマ選択画面 | `../components/dialogs/themePicker.css` |
| フォントの読み込み | `../fonts.css`。アセットへの相対URLを保つためsrc直下に置く |
| その他のアプリ共通CSS | `app/`。`base.css`のさらなる部品別分割は今後の作業 |

新しく分けた `shared-idea`、`shared-outline`、`shared-sidebar`、`shared-progress` は、元の上書き位置を保つため **App.cssから読み込む**。`themes/index.css`にも追加すると、二重に読み込まれて適用順が変わる。

テーマの名前・説明・一覧は `../themes.ts` にある。既存テーマを編集するときは、そのテーマのファイルを編集し、読み込み順は維持する。共通ルールからテーマ固有の指定を分ける際は、セレクタの優先度と宣言順も確認する。

画面への適用は `../appShellStyle.ts`、キャンバスの外観設定の受け渡しと適用は `../canvasAppearance.ts` が組み立てる。設定の保存・復元や縦書きフォントの補正フックは呼び出し元に残している。埋め込みキャンバスは親の外観を継承し、別窓は開いたときのpayloadから適用する。

確認には `npm run test:appearance`、`npm run test:app-shell-style`、`npm run test:window-controls`、`npm run test:tree-row-contrast` を使う。今回の分離の手順・前後比較・実機確認は `../../docs/APPEARANCE_SEPARATION_PLAN.md` に記録する。
