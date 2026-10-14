# ファイルツリーのフォルダ移動調査（2026-10-14）

初回は約5分の調査。再調査でRust側の自己デッドロックを確認し、移動後のツリー再読込をロック外へ移して修正した。Computer Useは使用していない。実ファイルを使う回帰テスト13ケースと既存Rustテスト60件はすべて通過した。追加したRustテストモジュールは `#[cfg(test)]` で製品ビルドから除外される。

## 修正後の確認

`scripts\test-sidebar-file-move.cmd` または `npm run test:sidebar-file-move` で再実行できる。子プロセスが5秒以内に戻らない場合や、内容・設定・戻り値が不整合な場合はテストを失敗させる。

| 回帰ケース | 結果 |
| --- | --- |
| 単一ファイル移動・フォルダ移動・2ファイル移動 | 完了。実ファイル・戻り値のツリー・進捗ラベルを確認 |
| 移動先の特定ファイルの前／後へ移動 | 完了。設定と戻り値の両方で順序を確認 |
| ライブラリ内の作品で単一・フォルダ・複数移動 | 完了。作品ツリーに加えライブラリ情報の再読込も完了 |
| 空の複数移動 | 正常終了 |
| 同じ親への移動・名前衝突 | エラーを返し、ファイル・設定を維持 |
| 同一フォルダ内の並べ替え | 正常終了、指定順序を確認 |
| 複数移動の2件目のrenameをWindows共有モードで拒否 | エラーを返し、先行移動・順序・進捗を復元。revisionが後退しないことも確認 |

13ケースの実行時間は各51〜370ms（プロセス起動を含む）。性能ベンチマークではなく停止解消の確認である。単一ファイルでは返された内容・パス・WindowsファイルIDも確認した。

- 証跡：`test-artifacts/sidebar-move-lock/1791964087329/results.json`
- バッチ実行ログ：`test-artifacts/sidebar-move-lock/regression.log`
- `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib`：60 passed、1 ignored。ignoredの診断用テストは上記バッチから13回、独立した子プロセスで実行済み。
- `node scripts/test-file-move.mjs`：通過。
- `node scripts/test-project-portability-baseline.mjs`：通過。
- `node scripts/test-heading-dnd-ui.mjs`：通過。

ネイティブウィンドウでの手動ドロップは未実施。今回の修正対象はアプリ全体の応答なしを引き起こすロック待ち。末尾に記載した初回調査のドロップ領域・pointerup再判定の挙動は別件として残している。

## 再調査：アプリ全体の応答なしにつながる自己デッドロック

ユーザーから「操作だけが無反応ではなく、アプリ全体が応答なしになる」と補足を受け、実際のRustコマンドを検証した。初回のnullによる移動スキップは、この症状の原因ではなかった。

### 原因

以下は修正前の呼出経路と行番号。

1. `src-tauri/src/lib.rs:2739` の `move_project_entry` が `PROJECT_CONFIG_LOCK` を取得する。
2. ガードを保持したまま `move_project_entry_unlocked` を呼び、ファイルの移動と設定保存を済ませる。
3. `src-tauri/src/lib.rs:2866` で `list_project_folder` を呼ぶ。
4. `src-tauri/src/lib.rs:3846` のフォルダ読込が `load_project_config` を呼ぶ。
5. `src-tauri/src/project_state.rs:398` が同じ `PROJECT_CONFIG_LOCK` を取得しようとする。
6. 非再入Mutexなので、同じ処理が自分のロック解放を待ち続ける。外側のガードは関数が戻るまで解放されず、永久待ちになる。

複数移動の `move_project_entries` も `lib.rs:2940` で外側のロックを保持し、同じヘルパーを呼ぶため、1件目で止まる。また `lib.rs:3008` の最後のフォルダ再読込にも同じ問題がある。ヘルパー内の再読込だけを直しても十分ではない。

これらは同期Tauriコマンド。インストール済みTauriの `tauri-macros-2.6.2/src/command/wrapper.rs:404` では同期関数を直接実行し、Wryの `wry-0.55.1/src/webview2/mod.rs:890` ではWebMessageReceivedコールバックからIPCハンドラーを直接呼ぶ。待ちをワーカーへ退避する指定はなく、ネイティブUIのイベント処理を塞ぐ構造である。

### 実関数の再現結果

診断用のRustテストから製品の実関数を直接呼んだ。各ケースは独立した子プロセスと専用フォルダを使用し、5秒で打ち切る。全ケースで事前の `list_project_folder` は正常に戻った。

| ケース | コマンドの結果 | タイムアウト時のディスク状態 |
| --- | --- | --- |
| ファイル1件を別フォルダへ | 戻らず5秒で終了 | 移動済み・設定保存済み |
| フォルダを別フォルダへ | 戻らず5秒で終了 | 配下ファイルごと移動済み・設定保存済み |
| ファイル2件を別フォルダへ | 戻らず5秒で終了 | 1件目のみ移動済み・2件目は元の場所 |
| 同じ親フォルダへ移動 | 約48msでエラーを返す | 移動なし |
| 移動先で名前が衝突 | 約73msでエラーを返す | 元ファイルと移動先の既存ファイルを維持 |
| 同じフォルダ内の並べ替え | 約75msで正常に戻る | 設定保存済み |

移動後に停止しているので、画面が更新されなくても実ファイルが元の場所にあるとは限らない。検証ではユーザーのプロジェクトを操作していない。

### 実施した修正

移動と設定保存・失敗時の巻き戻しをロック内で完結させ、ロック解放後にツリーを再読込するよう変更した。

- `move_project_entry_unlocked` は移動結果だけを返し、内部で `list_project_folder` を呼ばない。
- 単一移動はロック内で移動結果を取得し、スコープを抜けてから `MoveProjectEntryResult` 用のツリーを読む。
- 複数移動は全件の移動または巻き戻しが完了するまでロックを保持し、最後のツリー読込より前に解放する。
- 同期コマンドを非同期化するだけでは自己デッドロックは解消しない。
- 診断を回帰テストにし、単一・フォルダ・複数・順序指定移動・失敗時の巻き戻し・ライブラリ配下でコマンドが戻ることと、実ファイル・設定・戻り値のツリーを確認した。

### 再現バッチと証跡

`scripts\investigate-sidebar-move-lock.cmd` を実行する。Rustテストをビルドし、UI操作なしで各実関数を子プロセスから実行する。タイムアウトは再現結果として記録するため、バッチの終了コード0はバグ解消を意味しない。

- `scripts/investigate-sidebar-move-lock.mjs`：ビルドと子プロセスの監視
- `src-tauri/src/file_move_diagnostics.rs`：製品の実関数を呼ぶ診断用テスト
- `test-artifacts/sidebar-move-lock/latest.json`：最新の検証フォルダと結果
- `test-artifacts/sidebar-move-lock/1791963523104/results.json`：今回の6ケースの結果
- 同フォルダの各ケースの `probe.log`：実関数の開始・戻りログ

Rustでの実ファイル移動と停止は再現済み。ネイティブウィンドウ上のWindows「応答なし」表示そのものは未操作・未観測。初回のJSDOMテストはRustを呼ばず、UIコールバック到達までしか見ていなかったため、この問題を検出できなかった。

## 初回調査：移動が実行されない条件（フリーズとは別）

実際のWorkspaceSidebarをReact/JSDOMで描画し、pointerdown / pointermove / pointerupを送った。既存の見出し・ファイル複数選択テストも通過した。

| 条件 | 結果 |
| --- | --- |
| フォルダ行の中央50%の位置 | onMoveEntryが呼ばれる |
| フォルダ行の上側20%の位置 | フォルダの前へ並べ替えになる |
| フォルダ行の下側80%の位置 | フォルダの後へ並べ替えになる |
| フォルダの直前にあるファイルをフォルダ行の上側へ落とす | 並べ替え結果がnull。保存・移動が呼ばれず、操作が何もせず終了する。アプリ全体のフリーズではない |
| 最後のpointermoveでは元ファイル上、pointerup時には移動先フォルダ中央 | 古いnull判定が使われ、移動・並べ替えとも呼ばれない |

## 原因と修正候補

- `src/components/layout/WorkspaceSidebar.tsx:977`：フォルダ内移動の判定範囲は行高の28%〜72%だけ。上下に落とすと並べ替えへ分岐する。行高28pxなら中央約12pxが移動判定範囲。フォルダ内移動範囲を広げ、並べ替え領域を明確にするのが修正候補。
- `src/components/layout/WorkspaceSidebar.tsx:1096`：pointerup時に座標から移動先を更新せず、最後のpointermoveで保存したdropTargetRefを使用する。ドラッグ終了時に座標から再判定するのが修正候補。
- `src/App.tsx` の `handleSidebarEntryReorder`：並べ替え結果がnullなら保存しないため、隣接ファイルをフォルダ上側へ落とす条件では通知も出ない。

## 再実行

リポジトリのルートで `scripts\investigate-sidebar-file-drop.cmd` を実行する。バッチは画面操作を行わず、ログをファイルへ出力する。

- `test-artifacts/sidebar-file-drop/results.json`：判定・呼び出し結果・並べ替え結果
- `test-artifacts/sidebar-file-drop/run.log`：実行ログ
- `scripts/investigate-sidebar-file-drop.mjs`：既存UIテストのハーネスを再利用する再現コード

`node scripts/test-heading-dnd-ui.mjs` と `node scripts/test-file-move.mjs` は通過。

この確認はUIイベントとハンドラー到達まで。実機WebViewでのマウスイベント配送、Rust側での実ファイル移動、ユーザーが遭遇した操作との完全一致は未検証。上記2条件が実装上存在することを確認した。
