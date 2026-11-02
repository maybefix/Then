# AI機能削除の追加検証

2026-11-02。AI機能の削除後、利用者の依頼により、then-safe-change の自動テスト一式の前後比較と、QA用Thenアプリの実機確認を追加で実施した。

作業前のチェックポイントや事前確認を実施した記録ではない。「前」は削除作業を始めた時点の HEAD `36b47ac50a4d65d814b61de40e69c5c7f4affbba` を隔離したGit worktreeに再現して、事後に測定する。削除前に未コミットの追跡対象ファイルはなく、未追跡の `landing-page/` は今回の変更対象に含めていない。

| 確認 | 状態 |
|---|---|
| 変更前の全テスト | 95本実行、92成功・3失敗。build成功。残存プロセス0 |
| 変更後の全テストと比較 | 94本実行、91成功・3失敗。前と同じ3失敗で新しい失敗0 |
| QA用アプリのビルド | 別識別子でreleaseビルド成功 |
| 旧設定の移行・操作・保存・再起動 | 実アプリで確認済み。停止前後の画面状態が完全一致 |
| 後始末と残存プロセス数 | QAデータ・検証用worktreeを削除。対象プロセスはすべて0 |

## テストの条件と記録

- 共通の実行ツール: `.claude/skills/then-safe-change/scripts/suite.mjs`
- 前: `tmp/ai-removal-check-20261102/before`（HEADと同じ内容の隔離したworktree）
- 後: 現在の未コミットのAI削除実装
- 生の記録: `tmp/ai-removal-check-20261102/suite/suite-before.json`、`suite-after.json`
- 変更の識別: `tmp/ai-removal-check-20261102/manifest.json`、`implementation.patch`
- Rust関連テストも含めて、前95本・後94本を実行する。各テストの上限は10分。
- `test:ai-selection` は `test:editor-selection` に改名した。本文の選択・コピーを確認する同じテストであり、比較時に対応付ける。
- `test:ai` は削除したAI実装のテストを含んでいた。外部リンクの検証は `test:external-url` として残す。
- `test:ai-pane-layout` はAI画面の削除とともに廃止した。前だけにあることは意図した差分。

## 変更前の結果

HEAD `36b47ac` を再現したworktreeは、追跡対象ファイルの変更がない状態で実行した。全95本のうち92本が成功、次の3本が失敗した。タイムアウトは0。buildは成功し、メインJavaScriptは717,207 bytesだった。

| テスト | 変更前の失敗内容 |
|---|---|
| `test:canvas-save` | テストがdata URLから `./utils/fontStack` を読み込めない |
| `test:v058-bundle` | メインJavaScriptが500 kBの検査上限を超えている |
| `test:v0511-themes` | 朱墨テーマのプロットの枠に関する検査が失敗する |

終了時にQA Then・QA WebView2・テスト用Edge・テスト用nodeはすべて0だった。

## 前後比較の結果

| 項目 | 変更前 | 変更後 |
|---|---|---|
| build | 成功 | 成功 |
| 全テスト | 95 | 94 |
| 成功 | 92 | 91 |
| 失敗 | 3 | 3 |
| タイムアウト | 0 | 0 |
| メインJavaScript | 717,207 bytes | 700,110 bytes |
| QA Then / QA WebView2 / テスト用Edge / テスト用node | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

失敗した3本は前と同じで、原因も一致した。新たな失敗は0。本文選択テストの改名を対応付けると、前後に共通する93本のうち90本が成功し、3本が同じ理由で失敗した。AI専用テスト2本の廃止と、外部リンクテスト1本の独立は意図した差分である。

比較ツールの出力は `tmp/ai-removal-check-20261102/suite/comparison.txt`、改名を対応付けた比較は `comparison-renamed.txt`、全テストの表は `all-tests.md`、集計は `summary.json` に保存した。変更前後とも各テストを最後まで実行し、今回の比較では単独再実行が必要な新しい失敗や時間切れはなかった。

## QAビルドの経過

最初のQAビルドは、Rustアーカイブを書き込む際にディスク容量不足（OS error 112）で失敗した。通常版Thenがインストール先から動作していることと、開発用debugビルドを使用するThenがないことを確認し、対象パスを検査したうえで `cargo clean --profile dev` を実行した。再生成できる開発用キャッシュ3.7 GiBを整理し、約3.9 GiBの空きを確保した。原稿、設定、通常版Then、テスト結果の記録は削除していない。初回のログは `qa/build.log`、再試行のログは `qa/build-retry.log` に残す。

## 実機確認の条件

別識別子 `local.then.qa.airemoval1102` のQA用Thenアプリを使用する。一時ライブラリに作品A・B、本文、Idea、プロット、AI回答から保存した資料、旧会話ファイルを作る。アプリ状態には旧AI設定と `rightSidebarTab: "ai"` を入れ、実際の旧データからの移行を確認する。

利用者のアプリ状態、資格情報、作品には触れない。QA用アプリは各確認のあと停止し、同じ識別子で再起動して保存状態を確かめる。最後にQA用のデータと一時ライブラリを削除し、残存プロセスを数える。

| 確認項目 | 結果 |
|---|---|
| 旧AIタブの選択からプロットへ復元 | 成功。「補助ペイン：プロット」で起動。原稿と20pxの文字サイズを保持 |
| 右サイドバー・設定・本文メニュー・Ideaメニュー・クイックメモからAI操作が消えている | 5か所すべてで確認。通常のメニュー項目は利用できる |
| 本文の編集・保存・作品切替 | 「QA本文追記」を実入力・保存。作品Bを開いてからAへ戻っても保持し、Bの原稿は不変 |
| Ideaの追加・保存 | クイックメモ「QAクイックメモ」と通常追加「QA追加Idea」を保存ファイルと照合 |
| 保存済みのAI資料を通常の資料として開く | AI_過去の資料_1.mdを資料カードで開き、本文を確認 |
| プロットの表示・編集・保存 | 既存の本文を保持し、タイトル「冒頭（QA編集）」の編集と保存を確認 |
| 原稿・Idea・資料・プロットの再起動後の復元 | 本文・Idea・プロット・文字サイズ・選択ペインが停止前のJSONと完全一致。資料も開き直せた |
| 過去の会話ファイルと保存済み資料の保持 | 起動前と再起動後のSHA-256が一致（会話一覧・会話本体・保存済み資料の3ファイル） |
| QA Then・WebView2・テスト用Edge・テスト用nodeの残存数 | 0 / 0 / 0 / 0。テスト用ブラウザプロファイルも0 |

## 実機確認の記録と後始末

- `qa/actions.jsonl`: 個々の画面操作と検査結果。
- `qa/before-restart.json`・`qa/after-restart.json`・`qa/restart-comparison.json`: 再起動前後の画面状態と完全一致の検査結果。
- `qa/disk-before-restart.json`・`qa/evidence/`: 保存ファイルとの照合結果と検証用データの写し。
- `qa/original-hashes.json`・`qa/hashes-after-restart.json`: 過去の会話・資料が不変であることの記録。
- `qa/pane-menu.png`・`qa/settings.png`・`qa/saved-reference.png`・`qa/after-restart.png`: 実アプリの画面写真。
- `qa/cleanup.log`・`qa/cleanup.json`: QAデータの削除とプロセス数の記録。

以上の `qa/` は `tmp/ai-removal-check-20261102/qa/` を指す。QA設定・WebView2データ・一時ライブラリは後始末済みで、証拠ファイルだけを別の場所に保持した。削除前の検証用worktreeも、追跡対象が変更されていないことを確認して削除した。

実アプリから `ai_providers`・`ai_send`・`ai_store_key` を呼び、すべて「Command ... not found」となることも確認した。AI通信もキー保存も実行できる状態ではない。実際のAPIキーには触れていない。

検証スクリプトは、初回の作品B切替で本文が自動的に開くと仮定して1回停止した。画面を読み取り、作品Bではまだ文書を開いていないことを確認し、左のツリーから本文を開く通常操作で再実行して成功した。製品コードは変更していない。

QAビルドでは開発用の `src-tauri/target/release/Then.exe` をQA版に置き換えた。その後の利用者の依頼により、通常識別子 `local.then` のアプリとNSISインストーラーをビルドしたため、現在の開発用EXEは通常版である。インストール済みの通常版Thenは同じプロセスIDで動作し続けており、終了も変更もしていない。

## 限界と作業範囲

今回追加するのは、自動テストの前後比較と実機確認である。事前の手続きが実施済みだったことにはしない。コミット、push、PR作成は今回の依頼には含めない。

## 通常版インストーラーのビルド

利用者の依頼により、バージョン0.7.0の通常版NSISインストーラーを作成した。ソースの変更はなく、通常製品名Then、x64のアプリ、NSIS形式、成果物の更新日時を検査した。

- 成果物: `src-tauri/target/release/bundle/nsis/Then_0.7.0_x64-setup.exe`
- サイズ: 35,951,333 bytes
- SHA-256: `28b2d01b6fb160fceb16e1a439d310bbbdeb536e0088a9733fc5bd5e6123d4ed`
- App.tsx: 8,608行（空行・コメントを含む。変更前8,623行から15行減）
- ビルドログと検査結果: `tmp/ai-removal-check-20261102/installer-build.log`・`installer-build.json`
