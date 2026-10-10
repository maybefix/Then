# 本文・補助表示・レイアウト更新の分離：実装と検証

2026-10-10。既存機能を削らず、次の三項目を実装した。

1. 外部本文更新と全文を渡す編集コマンドを、実際の変更範囲だけを置換する一つの ProseMirror transaction にまとめる。
2. transaction の変更段落と DOM の装飾変更から補助表示を無効化し、段落ごとの行の形を再利用する。
3. フォント・表示幅・書字方向・表示方式の変更は、本文編集とは別の全体レイアウト無効化として処理する。

文字入力・改行・太字・一か所だけ変更する「すべて置換」でスクリプト処理時間が減った。一方、通常入力の同期時間は中央値で 1.5ms 増え、IME シナリオには明確な改善がなかった。すべての時間指標が改善したとは判断しない。

## 実装

対象は `src/VerticalTextEditor.tsx`、`src/editor/visualLineIndex.ts`、`src/editor/textOffsetMapping.ts`。

外部から全文を受け取った場合、共通の接頭・接尾部分を正確に比較し、それ以外の範囲だけを置換する。改行は正規化し、選択の anchor/head を新本文へ写した後、一つの transaction を dispatch する。更新通知を抑止する既存の `preventUpdate` と、古い revision を拒否する処理を維持した。`TextEditorHandle.replaceRange` の全文要求も同じ経路を使う。複数の離れた変更があるときは、それらを含む一つの連続範囲を置換する。

`onTransaction` は、通常の `onUpdate` を抑止したコマンドについても変更段落を記録する。単一の通常編集では StepMap と解決済み選択位置を使い、それ以外は全段落の比較へ戻す。DOM の装飾変更は MutationObserver でも検出する。

表示行の形は段落内の相対座標で保持する。前の段落が伸びて後続段落が移動しても、形の再生成は不要となる。実際の行数を累計する Fenwick tree で後続行番号を求め、可視段落とキャレット段落だけ表示用の行帯を生成する。コメント行は番号を消費しない。可視判定には実際の行帯の和集合を使い、段落外へはみ出す表示も含める。

フォント読み込み完了、文字寸法設定の signature、書字方向、連続／ページ表示、寸法変更によるレイアウト無効化では全段落を再計測する。IME 変換中のレイヤー保持、キャレット隣接文字による所属行判定、ページ版面のクリッピング、既存のオーバーレイ DOM 再利用は維持した。

行数・寸法の推定は追加していない。Range の実測結果から、既存の `createVisualLineBands` と同じ行の統合を行う。本文・装飾・レイアウトの変更時には、後続段落の移動を正しく反映するため全段落の外接矩形を読む。したがって全処理が O(変更段落数) になったわけではない。削減したのは未変更段落の行断片の再計測・再集計と、画面外の行帯の大量生成である。

## 正しさ

| 検証 | 結果 |
| --- | --- |
| 全段落を毎回集計する方式との数値照合 | 1,800 状態、不一致 0 |
| 2,400 段落の局所編集 | 行断片の読み取り 1 段落、全体無効化では 2,400 段落 |
| 本文の範囲置換 | 9,240 ケース、Undo/Redo 6 ケース、不一致 0 |
| 全文要求の局所変更 | 直接の局所置換と同じ一つの step。遠方の PM ノードの参照を維持 |
| 装飾の差分更新 | 混在 5,027 transaction、網羅 15,967 ケース、不一致 0 |
| 実 Edge の表示照合 | 43 ケース、番号の欠落・余分な番号 0、座標誤差最大 0.5px |
| 実 React コンポーネントへの外部本文更新 | 一つの transaction、遠方ノード維持、選択写像、Undo/Redo、古い revision 拒否、改行正規化、二重通知なし |
| 寸法設定の signature 変更 | 外部更新用の実コンポーネントで全段落再計測を確認（Range 呼び出し 104 回） |

数値照合には、段落の挿入・削除・並べ替え、折り返しの増減、コメント行、非表示段落、複数インライン断片、段落外へのはみ出し、全体の位置移動、全体 revision を含む。

実ブラウザは、見出し・太字・ルビ・箇条書き・空行・コメント・表・コードを含む原稿で検証した。縦横書き × 連続／ページ表示について、局所編集、遠方の行数変更、Enter、Undo/Redo、太字コマンド、コメント表示切替、CDP の IME composition／確定を操作した。ページ送りの縦横切替、画面サイズ変更、文字サイズ変更も含む。表示されている番号だけを検査するのでなく、全文を新しく実測して得た可視行番号の集合全体と座標を比較している。

追加の回帰確認は、typewriter、表示行と IME、本文更新、選択 metrics、表示装飾、ページ復旧、位置記憶、ページ分割、表解析・IME・ナビゲーション、コード、コメント、性能、high-risk の各スクリプトで通過した。`npm run build` も通過。既存の大きな bundle に関する Vite 警告は残る。

旧実装のソース文字列 `setContent(..., false)` などを要求する静的テストは、新しい共通 helper と `preventUpdate` を検査する形へ変更した。更新通知の有無は上記の実ブラウザでも検証している。

## 性能比較

Windows の隔離された headless Edge 154.0.4258.62、要求 100,000 字・初期 2,139 段落。縦書き、typewriter scroll、行番号、現在行強調、改行記号をすべて有効にした。同じブラウザで変更前後を交互の順序で 3 回ずつ実行し、並行した性能測定は行っていない。ユーザーの原稿ファイルへの書き込みはなく、メモリ上の mock backend を使った。

数値は各実行の中央値をさらに 3 回の中央値にしたもの。コマンドは毎回新規ロードした原稿で実行し、10 回のうち先頭 2 回を除いた 8 回を使った。ThreadTicks の ScriptDuration、LayoutDuration、RecalcStyleDuration を別々に取得した。`twoFrames` は操作開始から二つの requestAnimationFrame を通過するまでの時間であり、物理ディスプレイへの描画完了時刻ではない。

| 操作・指標 | 変更前 ms | 変更後 ms | 差 |
| --- | ---: | ---: | ---: |
| 文字入力・スクリプト処理／入力数 | 62.54 | 42.15 | −32.6% |
| 改行シナリオ・スクリプト処理／入力数 | 116.37 | 74.33 | −36.1% |
| 太字コマンド・スクリプト処理 | 67.71 | 45.19 | −33.3% |
| 太字コマンド・twoFrames | 118.4 | 91.0 | −23.1% |
| すべて置換・スクリプト処理 | 69.82 | 33.78 | −51.6% |
| すべて置換・同期時間 | 19.8 | 13.5 | −31.8% |
| すべて置換・twoFrames | 123.9 | 67.7 | −45.4% |
| 文字入力・同期時間 | 13.1 | 14.6 | **+1.5ms** |
| 文字入力・次の RAF まで | 20.2 | 21.4 | **+1.2ms** |
| 文字入力・本文と文字数表示の同期後の RAF まで | 144.6 | 128.6 | −11.1% |
| IME シナリオ・スクリプト処理／入力数 | 152.48 | 154.11 | +1.1% |
| IME シナリオ・フレーム間隔 p95 | 814.4 | 803.0 | −1.4% |
| 強制 setContent 全文差し替え・twoFrames | 171.0 | 169.4 | −0.9% |

「すべて置換」は実際の検索 UI から、原稿中に一つだけある文字列を同じ長さの別文字列へ変更した条件。広範囲・多数箇所の置換に同率の改善を保証する値ではない。変更前後で、各コマンド実行後の文書・選択・全装飾の SHA-256 が一致した。

改行／IME の CPU 値は、操作後の待機や検証用 Undo/Redo を含むシナリオ全体を入力数で割った比較値であり、一回のキーイベントだけの実行時間ではない。本文の一致、スクロールで選択が変わらないこと、Undo/Redo も両版・全反復で確認した。IME の長い停止は引き続き残る。

通常入力の同期時間の各実行中央値は、変更前 `[11.1, 13.1, 14.8]`、変更後 `[14.6, 14.5, 15.2]`。改善だけを抜き出さず記録する。別の入力フック診断（選択範囲を置換する条件、10 操作）では新規 transaction 通知が中央値 0.1ms、最大 0.2ms だった。この診断だけでは同期時間差全体の原因を特定できない。安定性確保のために必然的に増えたコストとは断定しない。

強制 setContent 比較には最初の実行の外れ方が大きい。各実行の twoFrames 中央値は、前 `[71.6, 171.0, 179.1]`、後 `[175.3, 156.9, 169.4]`。除外せず集計し、この経路の体感改善は確認できなかったと判断する。この比較は外部 props の差分置換を経由しないため、経路を混同しない。

## 再実行と記録

`artifacts/visual-line-index-2026-10-10/` に変更前後の dist、変更前後のエディタ source、各 JSON、`summary.json`、SHA-256 の `provenance.json` を保存した（artifacts は Git の対象外）。

- 変更前 source SHA-256: `2DA4BDD8C03B0EF23BA90C55B5B1A727306152195D1D8949FD2B1CE819B61D0D`
- 変更後 source SHA-256: `1E9185C0D2BD81C349C86CBD8F1B1EC21C5C84490CF111379E74136825A1BDEF`
- 変更前 main asset: `index-Dy9WQspA.js`
- 変更後 main asset: `index-Dqb83sCs.js`

```powershell
npm run test:visual-line-index
npm run test:decoration-mapping
npm run test:typewriter
node scripts/audit-visual-line-index-browser.mjs --project --typewriter --chars 10000 --line-numbers --highlight-line --line-breaks --dist dist --output artifacts/visual-line-index-2026-10-10/browser-oracle.json
node scripts/audit-editor-props-browser.mjs --project --typewriter --chars 10000 --dist dist --output artifacts/visual-line-index-2026-10-10/props-browser.json
node scripts/profile-decoration-commands.mjs --project --typewriter --at middle --chars 100000 --samples 25 --line-numbers --highlight-line --line-breaks --dist artifacts/visual-line-index-2026-10-10/before-dist --before-dist artifacts/visual-line-index-2026-10-10/before-dist --after-dist artifacts/visual-line-index-2026-10-10/after-dist --repeats 3 --output artifacts/visual-line-index-2026-10-10/command-profile.json
node scripts/profile-decoration-commands.mjs --project --typewriter --at middle --chars 100000 --samples 25 --line-numbers --highlight-line --line-breaks --dist artifacts/visual-line-index-2026-10-10/before-dist --before-dist artifacts/visual-line-index-2026-10-10/before-dist --after-dist artifacts/visual-line-index-2026-10-10/after-dist --scenarios replace-all --repeats 3 --output artifacts/visual-line-index-2026-10-10/replace-all-profile.json
node scripts/benchmark-decoration-mapping-browser.mjs --project --typewriter --at middle --chars 100000 --samples 25 --line-numbers --highlight-line --line-breaks --dist artifacts/visual-line-index-2026-10-10/before-dist --before-dist artifacts/visual-line-index-2026-10-10/before-dist --after-dist artifacts/visual-line-index-2026-10-10/after-dist --repeats 3 --skip-commands --output artifacts/visual-line-index-2026-10-10/input-performance.json
node scripts/summarize-visual-line-index.mjs
```

## 評価の限界

既存機能を削る変更はしておらず、上記の範囲で機能維持を検証した。実際の Windows IME 候補ウィンドウ、インストール版 Tauri WebView2、長時間使用の全操作を検証したという意味ではない。ブラウザに残るスタイル再計算・レイアウト・IME 時の装飾写像の負荷は、この変更だけではなくならない。

今回の結果は、既存フレームワークのままで補助表示の重複処理を削減できることを示す。ネイティブ層への移行が必要かどうかの結論を出す測定ではない。
