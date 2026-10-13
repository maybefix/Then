# ページ開始位置の不一致：原因調査

2026-10-10。原因は、既存のページ計測が **非表示コメントを1行と数え、その画面上のゼロ座標を本文内の位置へ変換していたこと**。段落差分計測を無効にした対照と有効にしたQA版で、同じ操作・同じ184px差を再現した。QA試作も既存処理との互換のため、この挙動を引き継いでいる。

アプリの動作修正、入力性能比較、配布は実施していない。採用保留は継続する。[QA検証記録](PARAGRAPH_FLOW_QA_2026-10-10.md) の原因未確定という記述は、各試験を停止した時点の記録である。

## 原因となる処理

1. コメント装飾は、現在のコメント群以外に `pm-comment-hidden` を付ける。`src/App.css:3029` はこのクラスを `display:none` にする。
2. `src/editor/pageBreaks.ts:114` は寸法が0でも `Math.max(1, ...)` により1行と数える。このため、非表示コメントがページ先頭として選ばれ得る。
3. 非表示要素の `getBoundingClientRect()` は全座標が0。横書きの `blockStart = rect.top - rootRect.top`（同ファイル99行）は `-rootRect.top` となり、本文内の位置ではなく本文rootの画面位置に依存する。
4. ページ開始offsetは先頭段落の `blockStart + lineStart * linePitch`（同ファイル61行）。ページ表示は `--paged-root-top = paddingY - pageOffset`（`src/VerticalTextEditor.tsx:2816`）でrootを移動するため、保存したoffsetと移動後の再計測値が食い違う。

`src/editor/paragraphFlow.ts:151` の非表示段落用互換処理も `blockStart: -root.top` を返す。差分キャッシュだけの無効化不足ではなく、既存の非表示段落計測とページ先頭選択の問題である。root移動のたびに再計測するだけでは、移動で値が変わる循環を解消できない。

## 変更前対照とQA版の結果

両方の診断用ビルドに記録専用の `VITE_QA_PAGE_DIAGNOSTICS=1` を付け、段落差分計測のみ0／1に切り替えた。同じEdgeハーネス、原稿、操作、IME試験除外条件で比較した。既存の `pageBreaks.ts` は変更していない。

| 項目 | 差分計測無効 | 差分計測有効 |
| --- | ---: | ---: |
| 失敗前の成功チェック | 29 | 29 |
| 3ページ目の保存済みoffset | 1094.28125px | 1094.28125px |
| 移動後の全文再計測offset | 910.28125px | 910.28125px |
| 差 | 184px | 184px |
| 計算時のroot上端 | -1094.28125px | -1094.28125px |
| ページ位置反映後のroot上端 | -910.28125px | -910.28125px |
| 表示段落の本文内座標の変化（最大） | 0px | 0px |
| 非表示段落の本文内座標の変化（最大絶対値） | 184px | 184px |

失敗操作は双方とも `horizontal-tb/paged/distant line-count change`。先頭段落はindex 25の `// コメント行25`、`display:none`、矩形は全値0、計測上は1行だった。保存値と再計測値はそれぞれ、その時点のroot上端の符号を反転した値と一致した。

先行する実WebView2試験では909.4375pxと725.4375pxで、差は同じ184px。ブラウザ試験と画面上の絶対位置が異なるので、offsetの絶対値を混ぜて比較しない。184pxは保存済みoffsetと再計測値の差であり、表示中の各段落の本文内座標が184pxずれたという結果ではない。

## インストール済みThen.exeでの再現確認

追加依頼により、`C:/Users/uest/AppData/Local/Then/Then.exe`（0.6.6）そのものを起動して確認した。実行ファイルのSHA-256は `72671BEAD4F3D571A7BA7D6D9C6DC935A055E363A83F70D40FAA5481DEA76FCB`。実行ファイルの変更・再インストールはしていない。

**インストール済みビルドでも同じ問題を再現した。** 29チェック通過後、同じ `horizontal-tb/paged/distant line-count change` で3ページ目の保存済みoffsetが1093.4375px、全文再計測が909.4375pxとなり、差は184px。先頭はindex 25の非表示コメント、矩形は全値0、計測上は1行だった。

読み込まれた `http://tauri.localhost/assets/index-Dqb83sCs.js` のSHA-256は `834C59CB8D05BE7A940CA38D291D5FB9226F19FEA118E454DFF75E853B30FE36` で、変更前の比較基準JavaScriptと一致した。CDPデバッガでページ割り参照の読み取り用getterを一度だけ公開して照合し、計算処理は変更していない。137pxの移動対照でも対象offsetだけが-137px変化し、非表示を0行とする検証計算では変化最大0.000031pxだった（閾値1/32px内）。

元の `app-state.json` と `main-window-state.json` を退避してから一時的な試験設定で起動し、WebView2データ保存先も隔離した。ユーザー原稿を開かず、未保存の新規試験原稿を使用。終了後は元の設定ファイルを復元し、両方ともバイト単位で一致を確認した。ユーザー自身の原稿・設定条件すべてでの発生頻度を測った試験ではない。

記録は `installed-page-diagnosis.json`、`installed-binary-metadata.json`、`installed-script-metadata.json`、`installed-state-restoration.json`。再現スクリプトは `scripts/audit-installed-page-offsets.mjs`（通常プロファイルの一時退避・復元を伴う）。

## rootの移動だけを変える対照実験

同じ失敗状態でrootを一時的に137px下へ動かし、同期計測後すぐ元に戻した。差分計測無効／有効の双方で次の結果になった。

- 表示中の段落の本文内座標は変化0px。
- 既存計算の3ページ目offsetだけが-137px変化。他ページのoffsetは不変。
- 非表示段落のみ計測入力を `lineCount:0, gapBefore:0, blockStart:0` に置き換えて再計算すると、全ページのoffset変化は0px。ページ分割も移動前後で一致。

本文全体の平行移動で本文内のページ位置が変わることが、座標原点の混入を直接示す。この置き換えは検証内の計算だけであり、アプリへの修正ではない。また、全文再計測側も同じ既存計測関数を使うため、その値を正しい移動先とみなして書き戻す修正は不適切である。

## 修正する場合の範囲

`display:none` の段落は描画行数と間隔を0にし、ページ先頭に選ばれないようにする。配列から除去すると文書の段落index対応が崩れるため、段落の枠は保持する。QAキャッシュの非表示段落にも同じ規則を適用し、rootの画面位置を本文内位置へ持ち込まない。

寸法が0という理由だけで全要素を除外してはいけない。表示中の空段落や表の区切りにある既存の扱いを維持し、非表示状態を明示的に判定する必要がある。修正後は、ページ境界の非表示コメント、コメントの表示切替・カーソル移動、空段落・表、縦横書き、差分計測の無効／有効、実WebView2で回帰確認してから性能比較へ進む。

## 記録と再現

成果物は `artifacts/paragraph-flow-qa-2026-10-10/` に保存した。

- `before-page-diagnosis.json` / `after-page-diagnosis.json`：途中29チェック、失敗時の段落・root・計算履歴、137px移動実験。
- `page-diagnosis-summary.json`：両結果の要約。`scripts/summarize-paragraph-page-diagnosis.mjs` が上記の座標関係と対照結果をassertして生成する。
- `before-diagnostic-dist` / `after-diagnostic-dist`：記録フラグを有効にした専用ビルド。通常版distと既存QA実行ファイルは上書きしていない。

PowerShellでの診断ビルド：

```powershell
$env:VITE_QA_PARAGRAPH_FLOW='0'
$env:VITE_QA_PAGE_DIAGNOSTICS='1'
npm run build -- --outDir artifacts/paragraph-flow-qa-2026-10-10/before-diagnostic-dist
$env:VITE_QA_PARAGRAPH_FLOW='1'
npm run build -- --outDir artifacts/paragraph-flow-qa-2026-10-10/after-diagnostic-dist
Remove-Item Env:VITE_QA_PARAGRAPH_FLOW, Env:VITE_QA_PAGE_DIAGNOSTICS
```

診断実行（双方とも対象不一致で終了コード1になる）：

```powershell
node scripts/audit-visual-line-index-browser.mjs --qa-production --diagnose-page-offsets --skip-ime --project --typewriter --chars 10000 --line-numbers --highlight-line --line-breaks --dist artifacts/paragraph-flow-qa-2026-10-10/before-diagnostic-dist --output artifacts/paragraph-flow-qa-2026-10-10/before-page-diagnosis.json
node scripts/audit-visual-line-index-browser.mjs --qa-production --diagnose-page-offsets --skip-ime --project --typewriter --chars 10000 --line-numbers --highlight-line --line-breaks --dist artifacts/paragraph-flow-qa-2026-10-10/after-diagnostic-dist --output artifacts/paragraph-flow-qa-2026-10-10/after-page-diagnosis.json
node scripts/summarize-paragraph-page-diagnosis.mjs
```

両ビルドと要約スクリプトのassertは成功。診断ハーネスは想定した不一致を双方で検出した。今回追加したアプリ側の記録は診断フラグ付きビルドに限定される。
