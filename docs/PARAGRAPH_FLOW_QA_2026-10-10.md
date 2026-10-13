# 段落差分計測のQA検証：ページ境界不一致で停止

2026-10-10。[依頼元の最終見出し](PARAGRAPH_FLOW_FEASIBILITY_2026-10-10.md) に従い、既存変更を保存・統合した後、QA専用の試作を組み込んだ。ページ境界の追加照合で不一致を検出したため、実装の拡張と性能比較を停止した。**採用保留。速度向上も機能維持も認定していない。**

**最新結果：インストール済みThen 0.6.6そのものでも同じ184px差を再現し、非表示コメントの既存計測が原因と確認した。[原因調査](PARAGRAPH_FLOW_PAGE_OFFSET_DIAGNOSIS_2026-10-10.md)を参照。追加依頼の性能比較も24実行・1,152入力を完了。段落再計測は1〜2段落に減ったが、入力全体の負荷・遅延は改善と悪化が混在し、変動も大きかったため、安定した高速化は認定しない。[性能比較](PARAGRAPH_FLOW_INPUT_PERFORMANCE_2026-10-10.md)を参照。動作修正・配布は未実施、採用保留を継続する。以下の原因未確定・性能比較未実施という記述は各試験停止時点の記録。**

## Gitと配布の状態

- 既存の変更46ファイルを `ad9b2b2e7f258a2286349d0293ee6b49e8289884` にコミット。
- `perf/typing-latency` をローカル `main` へ fast-forward 統合。
- 更新済みmainから `codex/paragraph-flow-qa` を作成。QA試作と本記録はこのブランチの未コミット変更として保持。
- push、リリース、インストーラー作成、インストール、配布は実施していない。
- 通常ビルドでは段落差分計測を無効にした。`VITE_QA_PARAGRAPH_FLOW=1` を指定したQAビルドだけで有効。
- 既存 `dist/assets/index-Dqb83sCs.js` のSHA-256は比較基準ビルドと同じ `834C59CB8D05BE7A940CA38D291D5FB9226F19FEA118E454DFF75E853B30FE36`。通常版distをQAビルドで上書きしていない。

## QA試作の範囲

`src/editor/paragraphFlow.ts` に段落border boxの実寸を保持し、累計から後続段落の位置を求めるキャッシュを追加した。行番号・現在行の計測とページ割りの両方へ接続した。本文transaction、装飾DOM、組版設定、フォント通知、stylesheetのDOM更新を無効化経路にした。座標を読む前にMutationObserverの記録を同期回収し、ResizeObserverを補助に使う。

rootの位置変更は段落内部の形状変更と分離した。外部CSSOMの直接変更など、明示的な無効化経路を通らない全操作を保証したものではない。全段落配列の生成や探索は残っており、処理全体を変更段落数だけに比例させた実装でもない。

## 通過した照合

| 確認内容 | 結果 |
| --- | --- |
| 実際に接続したQAキャッシュの段落座標 | 125状態・延べ47,099段落、全文実測との差最大0px |
| QAキャッシュのページ割り入力値 | 同125状態で `lineCount`・`linePitch`・`gapBefore`・`blockStart` の差最大0 |
| 同時に動かした既存の独立試作 | 延べ981,167文字断片、差最大0px |
| 実際の行番号集合・現在行表示 | 43状態、不一致0、座標の丸め差最大0.5px |
| 関連回帰試験 | 本文、high-risk、表示範囲、ページ復旧、ページ割り、IME表示行、位置記憶の7スクリプト通過 |

125状態には縦横書き、連続／ページ表示、局所編集、段落分割、Undo/Redo、太字、表、見出し、ルビ、コメント、CDPのIME変換中／確定、ページ送り方向、画面寸法、小数の文字寸法、フォント変更、2,139段落の長文を含む。長文の局所編集では、QAアプリ側の再計測実績は1操作あたり3段落だった。既存の独立試作の2段落と混同しない。

43状態の補助表示試験には、後述のページ境界の追加判定はまだ入っていない。上表の成功から、保存済みページ割りまで正しいとは結論しない。

最初のコミット前にはtypewriterの4試験、装飾差分の3試験、表示行インデックス、Idea入力欄も通過。変更前後のTypeScript・Viteビルドは成功。既存のバンドルサイズ警告は残る。

## 停止した検証

補助表示試験に、全文を新しく `measureParagraphs` で測り、`computePageBreaks` で再計算したページ割りとの照合を追加した。QAアプリが保持しているページ分割とページ数の判定を通過した後、ページ開始offsetの判定で次のエラーになった。

```text
Error: Page offset differs
    at Array.forEach
    at window.__checkLines
```

判定閾値は1/32px。したがって少なくとも一つの保存済みページ開始位置に、それを越える差がある。ただし、当該ハーネスは失敗時のラベル・実値・期待値・途中結果を保存する実装ではなかったため、**差の数値と厳密な操作ラベルは未取得**。エラーはツール出力に記録され、当該実行のJSONは生成されていない。

キャッシュが返す段落座標・ページ用入力値の一致と、アプリが保持するページ割り結果の一致は別の判定である。今回の不一致が試作に起因するか、既存処理や検証側のタイミングに起因するかは未確定。変更前に同じ追加判定を適用した対照実験も未実施。ページ表示の正しさに関わるため、依頼の停止条件を適用して、修正や追加性能試験へ進まなかった。

**入力処理全体の変更前後性能比較は未実施。** 独立試作の座標読み出しタイミングもJSONに残るが、このQA統合版の性能改善の根拠には使用しない。

## Windows QAビルドと実WebView2の限界

初回に `artifacts/paragraph-flow-qa-2026-10-10/Then-paragraph-flow-qa.exe` を作成した。Tauri identifierは `local.then.qa.paragraphflow20261010`、インストーラーなし。初回の実行ファイルのSHA-256は `5F6F546CD7281680F373EB18E6D26B391D7F9C39FC4BC4A89E3AA3BBC104419E`。再試行時にこの初回ファイルを `Then-paragraph-flow-qa-initial-invalid.exe` に保存し、元の名前には修正したビルドを配置した。

実WebView2の検証を試みたが、ハーネスが対象ページを取得できず `QA WebView2 page was not found` で終了した。最初は起動待ちを追加して再試行したが、同じ結果だった。実WebView2での照合成功とは扱わない。停止時のQA専用プロセスの確認では対象プロセスは見つからず、停止対象は残っていなかった。Windowsの実IME候補ウィンドウも未検証。

## 保存先と再現コマンド

Git対象外の `artifacts/paragraph-flow-qa-2026-10-10/` に比較基準 `before-dist`、QA版 `after-dist`、`flow-oracle.json`、`overlays-oracle.json`、QA用Tauri設定、Windows実行ファイルを保持する。初回のEdge試験原稿はメモリ上のmock backendを使用。

以下は失敗した追加照合を再現するためのコマンド記録であり、停止後には再実行していない。

```powershell
node scripts/audit-visual-line-index-browser.mjs --qa-production --project --typewriter --chars 10000 --line-numbers --highlight-line --line-breaks --dist artifacts/paragraph-flow-qa-2026-10-10/after-dist --output artifacts/paragraph-flow-qa-2026-10-10/overlays-pages-oracle.json
```

再開する場合の未完了項目は、失敗時の数値とラベルの保存、同じ照合の変更前対照、原因の特定、実WebView2ハーネスの接続確認、機能一致後の入力処理全体の交互順序・複数反復での性能比較。今回の停止後には進めていない。

## 通常版Thenを停止した状態での再試行

ユーザーの再試行依頼に基づいて実施。プロセス一覧で通常版・QA版とも起動していない状態を確認してから、QA版だけを起動した。

起動診断で、初回QA実行ファイルはプロセスとWebView2自体は起動していたものの、`file:///C:/Users/uest/Documents/then/artifacts/paragraph-flow-qa-2026-10-10/after-dist/` のフォルダー一覧を表示していたと判明した。QA生成スクリプトで `frontendDist` にWindowsのドライブ文字付き絶対パスを渡していたため、素材の埋め込み先ではなくURLとして扱われていた。ハーネスの `tauri.localhost` ページ検索が失敗していた直接の理由である。通常版との同時起動が原因だったとする根拠は得ていない。

`scripts/build-paragraph-flow-qa.mjs` の設定出力を、`src-tauri` からの相対パス `../artifacts/paragraph-flow-qa-2026-10-10/after-dist` に修正。フロントエンドの試作実装は変更せず、Tauri実行ファイルを再ビルドした。修正版のサイズは44,664,832バイト、SHA-256は `A0C602D0FA3B1AEC3100BC43D232A2A7DFA7542324F4BF15FC1E2936A059B6F5`。

修正版は `http://tauri.localhost/` の初期画面を正しく読み込み、QA版のmain assetも確認できた。WebView2は `Edg/154.0.4258.62`。起動時の記録は `webview-launch-retry.json` と `webview-startup-retry.png` に保存した。

ブラウザ用のmock backendはTauriの読み取り専用IPC初期化を置き換えられず、最初の本文自動検証では初期画面から進めなかった。ハーネスを修正し、ネイティブQAでは初期ライブラリ作成をスキップし、**未保存の新規原稿とQA専用の実バックエンド**を使用した。QAアプリIDは引き続き通常版と分離しており、ライブラリの新規作成やユーザーの原稿ファイルへの保存は行っていない。表示設定はQA専用の設定に反映した。

実WebView2の本文画面で29チェックが成功。縦書きの連続／ページ表示、横書きの連続表示、局所編集、前方の行数変更、段落分割、Undo/Redo、太字、コメント表示、ページ送り方向を含む。横書きのページ表示も切替と局所編集までは通過した。

次のチェックでページ境界の不一致を検出し、依頼の停止条件に従って検証を終了した。

| 項目 | 記録値 |
| --- | --- |
| 操作 | `horizontal-tb/paged/distant line-count change` |
| 内容 | 横書き・ページ表示で、前方の段落へ文字を追加して行数を増やす |
| 対象ページ | 3ページ目（`pageIndex: 2`） |
| 保存済みページ開始位置 | 909.4375px |
| 全文再計測による期待値 | 725.4375px |
| 差 | +184px |
| ページ先頭の段落 | `paragraphIndex: 25` |

失敗ラベル、実値、期待値、直前までの29チェックを `webview-oracle-retry.json` に保存した。初回Edgeで検出した不一致と同じ原因か、試作導入に起因するかはまだ確定していない。変更前対照や原因修正、入力全体の性能比較へは進んでいない。Windowsの実IME候補ウィンドウも未検証。

```powershell
node scripts/audit-visual-line-index-browser.mjs --qa-production --webview-exe C:/Users/uest/Documents/then/artifacts/paragraph-flow-qa-2026-10-10/Then-paragraph-flow-qa.exe --typewriter --chars 10000 --line-numbers --highlight-line --line-breaks --dist artifacts/paragraph-flow-qa-2026-10-10/after-dist --output artifacts/paragraph-flow-qa-2026-10-10/webview-oracle-retry.json
```

QA版の起動・本文画面での操作確認は成功したが、ページ境界の不一致により採用保留は継続する。本番へのデプロイは実施していない。
