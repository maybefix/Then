# brew 0.2.0 保守性改善と UI 刷新設計

## 目的

0.2.0 では、現在の機能差異を出さずに、実装の保守性を高めながら UI を添付モックアップの方向へ刷新する。

この設計は、刷新実装時に同じモックアップ画像を参照する前提で、画面構成、状態管理、リファクタリング境界、移行手順を固定するためのもの。

## 前提

- 既存機能は維持する。
- Markdown 編集体験は CodeMirror ベースのまま維持する。
- workspace-ready と scratch のユーザー向け状態方針は既存設計に従う。
- スニペット、プロパティ、パンくず、保存状態、ファイル操作、ドラッグ挿入の動作は維持する。
- UI 刷新は見た目と構造整理を主目的とし、保存形式や Tauri コマンドの互換性を壊さない。

## モックアップから読み取る UI 方針

モックアップは、暗色のデスクトップエディタとして、左のタブレール、中央の本文編集面、右のスニペットパネルを常時見せる構成になっている。

- 最上段はアプリ名とウィンドウ操作に近い薄いバー。
- その下に、現在ファイルの場所を示すパンくずバーと主要アクションを置く。
- 左側は複数の Markdown ファイルを開いて切り替えるタブ一覧として実装し、作業対象の切り替えを素早くする。
- 中央本文は余白を広く取り、プロパティ、タイトル、本文を縦に流す。
- 右側はスニペット専用パネルとして、検索、件数、追加、カード一覧をまとめる。
- 下部ステータスは保存状態、現在パス、文字数を静かに表示する。

## 画面レイアウト

0.2.0 の画面は、次の領域に分割する。

```text
AppShell
  WindowBar
  MainFrame
    TabRail
    WorkArea
      DocumentBar
      EditorPane
      StatusBar
    SnippetPane
```

### WindowBar

- アプリ名 `brew` とグローバルメニューを表示する。
- Tauri の標準ウィンドウ操作と衝突しない高さにする。
- 編集中ファイル名や状態エラーは置かない。

### TabRail

- 開いている Markdown ファイルを一覧表示する。
- 各タブはファイルアイコン、ファイル名、閉じる操作を持つ。
- 下部に新しいタブ作成操作を置く。
- 0.2.0 では、複数の Markdown ファイルを同時に開き、左側タブからアクティブファイルを切り替えられる状態モデルを導入する。
- タブを切り替えても、各ファイルの本文、保存状態、ファイルパス、選択中のアウトライン文脈が混線しないようにする。
- scratch もタブとして扱い、保存後は同じタブを保存先ファイルのタブへ昇格させる。

### DocumentBar

- 現在の workspace とファイルのパンくずを表示する。
- ユーザーに見せる状態名は `workspace-ready` と `scratch` の2系統に収める。
- undo、redo、settings などの軽い操作を右側に置く。
- 復元失敗や権限エラーの説明文は置かない。

### EditorPane

- プロパティ、タイトル、本文エディタを中央カラムに配置する。
- 本文カラム幅は読み書きしやすい固定上限を持たせる。
- typewriter scroll の挙動、IME、ドラッグ挿入、選択追従を維持する。
- メタデータ編集は既存 frontmatter 仕様を維持し、表示だけモックアップに寄せる。

### SnippetPane

- 右パネルはスニペット専用にする。
- 検索、件数、追加操作、カード一覧を上から順に配置する。
- カードにはタイトル、本文プレビュー、文字数、カテゴリ、タグを表示する。
- ダブルクリック挿入、ドラッグ挿入、並び替え、編集、削除は維持する。

### StatusBar

- 保存状態、現在パス、エラー、文字数を表示する。
- 作業中の注意は短く出し、詳細は必要な箇所のアラートやモーダルに逃がす。

## リファクタリング方針

現在の `App.tsx` は状態、Tauri I/O、UI、エディタ制御、スニペット操作が集中している。UI 刷新前に、機能単位で分割して差分を追いやすくする。

### コンポーネント分割

- `components/layout/WindowBar.tsx`
- `components/layout/TabRail.tsx`
- `components/layout/DocumentBar.tsx`
- `components/editor/EditorPane.tsx`
- `components/editor/MetadataPanel.tsx`
- `components/snippets/SnippetPane.tsx`
- `components/snippets/SnippetCard.tsx`
- `components/status/StatusBar.tsx`
- `components/dialogs/AppDialog.tsx`
- `components/dialogs/SettingsModal.tsx`
- `components/dialogs/SnippetModal.tsx`

### ロジック分割

- `state/appState.ts`: 永続化対象の型、初期値、正規化。
- `state/workspaceState.ts`: workspace-ready と scratch の状態遷移。
- `services/tauriWorkspace.ts`: Tauri invoke のラッパー。
- `services/snippetStore.ts`: profile/workspace スニペットの読み書き。
- `utils/frontmatter.ts`: frontmatter の parse/compose。
- `utils/projectTree.ts`: ProjectEntry の検索、並び替え、親探索。
- `hooks/useTypewriterScroll.ts`: typewriter scroll の DOM 計算。
- `hooks/useEditorDrop.ts`: スニペットドラッグ挿入。

### 分割時の制約

- 分割だけの PR では CSS や見た目を大きく変えない。
- UI 刷新だけの PR では保存仕様、Tauri コマンド、永続化キーを変えない。
- 既存データの読み込みに必要な `brew.app-state.v1` は維持する。
- Tauri command の引数名と戻り値は互換性を維持する。

## 実装運用ルール

このあとの 0.2.0 実装作業では、各作業単位ごとに次を必須とする。

- 作業開始前に、現在の未コミット差分を確認し、必要なものをコミットしてから実装に入る。
- 作業後は `npm run tauri:build` を実行し、Windows インストーラー `.exe` を生成できることを確認する。
- 作業後はこの設計書に、実装した内容、残タスク、設計判断の変更点を加筆する。
- インストーラー生成に失敗した場合は、その原因と未完了の確認内容をこの設計書に記録する。
- コード変更、インストーラー生成、設計書加筆の3点を同じ作業単位の完了条件として扱う。

## 状態遷移

ユーザー向けの主状態は次の2つにする。

- `workspace-ready`: 作業フォルダが確定している。
- `scratch`: 保存先未確定の無題 Markdown を編集している。

内部的には、復元失敗、権限エラー、ファイル未選択などの原因状態を持ってよい。ただし、DocumentBar には原因状態を表示しない。

```text
起動
  前回 workspace を復元できる -> workspace-ready
  前回 workspace がない -> scratch
  前回 workspace を開けない -> scratch + EditorPane alert

scratch 保存
  保存先フォルダとファイル名を確定 -> workspace-ready

workspace-ready で新規ファイル
  現在 workspace 配下に作成 -> workspace-ready

scratch で新規ファイル
  未保存確認 -> 新しい scratch
```

## CSS 設計

- レイアウト用 CSS とコンポーネント用 CSS を分ける。
- 色は CSS custom properties に集約する。
- カードの角丸は 8px 以下に保つ。
- 文字サイズは viewport 幅で変化させない。
- パネル幅、ツールバー高さ、ステータスバー高さは CSS 変数で固定値を管理する。
- ダークテーマはモックアップに合わせるが、単一色相だけの画面にならないよう、背景、境界、アクセント、警告色を分ける。

## 互換性を守る対象

- Markdown ファイルの読み書き。
- フォルダ配下 Markdown の一覧、再帰表示、並び順保存。
- ファイルとフォルダの作成、リネーム、削除、並び替え。
- workspace snippets と profile snippets。
- frontmatter の保持と本文編集。
- typewriter scroll。
- スニペットのダブルクリック挿入、ドラッグ挿入。
- 設定の永続化。
- 前回 workspace と最近使った workspace の復元。

## 実装順序

1. 0.2.0 ブランチを作成し、バージョンを `0.2.0` に更新する。
2. 既存差分をコミットして、UI 刷新前のベースラインを固定する。
3. `App.tsx` から純粋関数を `utils` に分離する。
4. Tauri invoke を `services` に分離する。
5. `SnippetPane`、`MetadataPanel`、`StatusBar` からコンポーネント分割する。
6. `WindowBar`、`TabRail`、`DocumentBar` を導入し、モックアップ構成へ寄せる。
7. CSS 変数とレイアウト CSS を整理し、既存クラスから段階的に移行する。
8. Playwright または手動スクリーンショットで、モックアップと主要状態を比較する。
9. `npm run build` と Tauri build で回帰を確認する。

## 受け入れ条件

- `npm run build` が成功する。
- 起動時に workspace-ready と scratch の表示仕様が崩れない。
- 既存 Markdown の編集、保存、再読み込みができる。
- スニペットの検索、追加、編集、削除、挿入ができる。
- フォルダツリーとパンくずから既存ファイルを開ける。
- モックアップと同じ主要領域が表示される。
- UI 刷新後も保存データ形式に破壊的変更がない。

## 実装ログ

### 2026-06-07: ステップ2 ドキュメントタブ状態モデル導入

実装内容:

- `DocumentTab` 型を追加し、`file` と `scratch` の両方を表現できるようにした。
- `openTabs: DocumentTab[]` と `activeTabId` を `App.tsx` に導入した。
- 既存UIはまだ単一ドキュメント表示のまま、`currentFilePath`、`currentFileName`、`documentKey`、`saveStatus`、`markdown` を active tab から導出する形に寄せた。
- 読み込み、scratch 作成、保存成功、frontmatter 更新、本文更新が active tab の `markdown` / `savedMarkdown` / `saveStatus` と同期するようにした。
- 既存の永続化互換性のため、当面は `appState.markdown` も active tab の本文と同期する。

残タスク:

- ステップ3で、ファイルを開く時に既存タブを再利用し、未オープンなら新規タブを追加する操作を実装する。
- ステップ3で、左側タブから active tab を切り替える処理と、タブを閉じる時の未保存確認を実装する。
- 現時点では内部状態モデルの導入までで、左側 TabRail UI はまだ表示していない。

確認:

- `npm run build` 成功。
- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ3 タブ操作の実装

実装内容:

- 既存ファイルを開く時、同じパスのタブが既にあれば読み直さずにそのタブをアクティブ化するようにした。
- 未オープンの Markdown ファイルを開く時は、現在タブを破棄せず新しい file tab として追加するようにした。
- workspace 未選択時の新規ファイルは、現在タブを破棄せず新しい scratch tab として追加するようにした。
- scratch を保存した時は、同じタブを保存先ファイルの file tab へ昇格するようにした。
- ファイルメニューに、ステップ4の TabRail UI 導入前でも確認できる一時操作として `前のタブ`、`次のタブ`、`タブを閉じる` を追加した。
- タブを閉じる時、未保存または保存失敗状態なら破棄確認を出すようにした。
- リネーム時は、開いている該当ファイルタブの path/name/documentKey を更新するようにした。
- 削除時は、開いている該当ファイルタブを閉じるか、アクティブファイル削除時は次の候補ファイルまたは scratch に切り替えるようにした。

残タスク:

- ステップ4で、左側 TabRail UI を表示し、各タブのクリック切り替えと閉じるボタンを接続する。
- タブ一覧の表示順、アクティブ表示、dirty 表示はステップ4で視覚仕様を確定する。
- workspace 切り替え時に、非アクティブタブも含めた未保存確認をより厳密化する余地がある。

確認:

- `npm run build` 成功。
- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ4 TabRail UI 導入

実装内容:

- モックアップに合わせて、左側に開いている Markdown ファイルを表示する `TabRail` 領域を追加した。
- 各タブにファイルアイコン、ファイル名、閉じるボタン、未保存または保存失敗状態を示すステータスドットを表示するようにした。
- タブクリックで active tab を切り替え、閉じるボタンでステップ3の未保存確認付きクローズ処理を呼び出すようにした。
- 下部に `新しいタブ` ボタンを置き、workspace-ready では現在 workspace に新規ファイルを作成し、scratch では新しい scratch tab を追加する既存動作へ接続した。
- 既存のファイルメニューとパンくずは残し、TabRail は段階導入として `workspace` 配下の左ペインに固定配置した。

残タスク:

- ステップ5で `TabRail` を独立コンポーネントへ分割し、`App.tsx` の JSX 密度を下げる。
- ステップ7で WindowBar / DocumentBar / TabRail の境界をまとめて調整し、モックアップの二段バー構成へさらに寄せる。
- in-app Browser 接続が sandbox 側で失敗したため、今回の視覚確認はビルド確認までに留めた。次ステップ以降でブラウザまたは手動スクリーンショット確認を再実施する。

確認:

- `npm run build` 成功。
- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ5 レイアウトコンポーネント分割

実装内容:

- `TabRail` を `src/components/layout/TabRail.tsx` に分離し、開いているタブ一覧、アクティブ表示、閉じる操作、新規タブ操作を props で受ける表示コンポーネントにした。
- `StatusBar` を `src/components/status/StatusBar.tsx` に分離し、保存状態、保存先パス、エラー、文字数の表示を `App.tsx` から切り出した。
- `MetadataPanel` を `src/components/editor/MetadataPanel.tsx` に分離し、frontmatter の表示、開閉、追加、削除、編集操作を props 境界にした。
- 状態の所有、保存処理、ファイル I/O、タブ操作、frontmatter 更新ロジックは `App.tsx` に残し、今回の分割では挙動差異を出さない方針を維持した。

残タスク:

- `WindowBar` と `DocumentBar` はパンくず、フォルダ操作、アウトラインメニューの依存が大きいため、次の分割単位で扱う。
- `SnippetPane`、`SnippetCard`、`SnippetModal`、`SettingsModal`、`AppDialog` はステップ6で分離する。
- 分割後も `App.tsx` にイベントハンドラが集中しているため、ステップ6以降で UI と操作ロジックの境界をさらに薄くする。

確認:

- `npm run build` 成功。
- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ6 スニペットと設定 UI の分割

実装内容:

- `SnippetPane` を `src/components/snippets/SnippetPane.tsx` に分離し、検索、件数、追加ボタン、カード一覧を props で受ける表示コンポーネントにした。
- `SnippetCard` を `src/components/snippets/SnippetCard.tsx` に分離し、ドラッグ、ダブルクリック挿入、並び替え、編集、削除操作を handler props として受ける形にした。
- `SnippetModal` を `src/components/snippets/SnippetModal.tsx` に分離し、スニペット作成/編集フォームを `App.tsx` から切り出した。
- `SettingsModal` を `src/components/dialogs/SettingsModal.tsx` に分離し、フォント、文字サイズ、行間、typewriter scroll、スニペット保存先の設定 UI を props 境界にした。
- `AppDialogModal` を `src/components/dialogs/AppDialogModal.tsx` に分離し、入力ダイアログと確認ダイアログの表示を共通化した。
- スニペット永続化、設定保存、Tauri I/O、入力/確認ダイアログの resolve 処理は `App.tsx` に残し、今回の分割では挙動差異を出さない方針を維持した。

残タスク:

- `WindowBar` と `DocumentBar` はパンくず、アウトライン、ファイル操作の依存を整理してから分離する。
- ステップ7で CSS 変数と領域ごとのスタイルを整理し、モックアップ準拠の視覚刷新に進む。
- `App.tsx` には handler がまだ集中しているため、必要に応じて次フェーズで hooks または service 層へ移す。

確認:

- `npm run build` 成功。
- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ7 モックアップ準拠の視覚刷新

実装内容:

- 上部を `WindowBar` 相当のアプリバーと `DocumentBar` 相当のパンくずバーに分け、モックアップの二段構成へ寄せた。
- `WindowBar` にはファイルメニュー、アプリ名、疑似ウィンドウ操作表示を置き、既存のファイルメニュー機能は維持した。
- 左 `TabRail` の幅、行高、ファイルアイコン、アクティブ表示、下部の新規タブ操作をモックアップ寄りに調整した。
- 中央 `EditorPane` は背景、本文カラム幅、見出しサイズ、プロパティ行の余白を調整した。
- 右 `SnippetPane` は幅、見出し、検索ボックス、カード余白、カード文字サイズをモックアップ寄りに調整した。
- 下部 `StatusBar` は高さ、余白、背景を二段バーと揃えた。
- 色、パネル幅、バー高さを CSS custom properties に寄せ、以後の微調整をしやすくした。

検証:

- `npm run build` 成功。
- Edge headless で `http://127.0.0.1:5174/` を撮影し、スクリーンショット `ui-check-step7.png` を生成した。
- スクリーンショット上で、二段バー、左タブ、右スニペット、下部ステータスの領域崩れがないことを確認した。
- 撮影時のブラウザ localStorage により本文は空の scratch 表示だったため、本文あり状態の視覚確認はステップ8の回帰確認で再実施する。

残タスク:

- ステップ8で、本文あり、複数タブ、スニペット挿入、設定モーダル表示を含む主要状態のスクリーンショット確認を行う。
- `WindowBar` / `DocumentBar` はまだ `App.tsx` 内 JSX のままなので、次フェーズで独立コンポーネント化する余地がある。
- スニペットカードや検索ボックスの最終的な文字量あふれは、実データを使って再確認する。

確認:

- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ11 ヘッダーと紙アイコンの整理

実装内容:

- OS 標準のウィンドウ操作と重複していた疑似の最小化、最大化、閉じる表示を削除した。
- 独立していた `WindowBar` 相当の表示を廃止し、ファイルメニューのハンバーガーと `brew` 表示をパンくずバー先頭へ統合した。
- パンくずバー上以外の紙マークを削除し、左タブ一覧はノート名と閉じる操作だけにした。
- 左タブ一覧の上部紙アイコン領域を最小化し、タブ行の余白を紙アイコンなしの表示に合わせて調整した。

検証:

- `npm run build` 成功。

残タスク:

- Tauri 実機で OS タイトルバーとアプリ内 topbar の見た目が重複しないことを確認する。

確認:

- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-08: ステップ8残タスク 主要状態スクリーンショット回帰確認

実施内容:

- ステップ7で残していた、本文あり、複数タブ、スニペット欄、設定モーダル表示を含む主要状態の視覚確認を実施した。
- Edge headless + CDP で `http://127.0.0.1:5177/` を操作し、実ブラウザ描画を撮影した。
- `ui-check-step8-body-tabs.png` で本文あり状態と複数タブ表示を確認した。
- `ui-check-step8-settings.png` で設定モーダル表示を確認した。
- `ui-check-step8-new-tab.png` でノート未選択の新しいタブ開始画面を確認した。
- `ui-check-step8-snippet-delete.png` でスニペット削除確認ダイアログを確認した。

検証:

- Edge headless + CDP で `.settingsModal`、`.newTabStart`、`.compactModal`、スニペットカード表示を DOM でも確認した。

残タスク:

- Tauri のネイティブファイルダイアログを伴う `フォルダを開く` / `Markdownファイルを開く` は、実アプリ上での手動確認が必要。

確認:

- `npm run build` 成功。
- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ10 タブ切替時のスニペット同期修正

実装内容:

- workspace スニペットがどの workspace path に属しているかを `snippetWorkspacePath` として明示的に保持するようにした。
- アクティブタブの Markdown ファイルパスから workspace root を解決し、タブ切替時にその workspace のスニペットを読み直す effect を追加した。
- workspace スニペットの自動保存は、現在の `projectFolder.path` と `snippetWorkspacePath` が一致する場合だけ実行するようにし、切替直後に別 workspace のスニペットを誤保存しないようにした。
- 初期復元、フォルダを開く、単体ファイルを開く、workspace 復元リトライ、スニペット保存先設定の切替で `snippetWorkspacePath` を更新するようにした。

検証:

- `npm run build` 成功。

残タスク:

- Tauri 実機で、異なるフォルダ由来のタブを切り替えた際にスニペット欄が workspace ごとに切り替わることを確認する。

確認:

- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ9 ノート周辺導線と削除確認の改善

実装内容:

- 単体の Markdown ファイルを開いた場合でも、その親フォルダを `ProjectFolder` として読み込み、パンくずから同じフォルダ配下の他ノートへ到達できるようにした。
- Tauri 側の `list_project_markdown_files` は既に再帰的なフォルダツリーを返すため、フロントエンド側では親フォルダ読み込みと recent workspace 更新を共通化した。
- パンくずメニューのファイル行に `新しいタブで開く` 操作を追加し、フォルダ内の別ノートをタブとして開ける導線を明示した。
- スニペット検索欄の記号アイコンをやめ、SVG の虫眼鏡アイコンへ差し替えた。
- スニペット削除時は即時削除せず、既存の確認ダイアログを経由してから削除するようにした。

検証:

- `npm run build` 成功。
- in-app Browser で `http://127.0.0.1:5176/` を開き、検索欄に `.searchIcon` SVG が 1 件表示され、旧 `span` アイコンが 0 件であることを DOM で確認した。
- in-app Browser でスニペットカードの `削除` を押し、`スニペットを削除` ダイアログと `キャンセル` / `削除` ボタンが表示されることを確認した。

残タスク:

- Tauri 実機で `ファイルを開く` から任意の Markdown を開き、親フォルダ配下のノートがパンくずメニューに再帰表示されることを確認する。
- パンくずメニュー内の `+` 操作は機能優先の暫定表示なので、アイコンライブラリ導入または共通アイコン化時に視覚を整理する。

確認:

- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`

### 2026-06-07: ステップ8 左上メニューと新規タブの責務整理

実装内容:

- 左上のハンバーガーはファイルメニューの入口に限定し、左ペイン上部にあった別のハンバーガー操作を削除した。
- `TabRail` 上部は操作ボタンではなく非操作のファイル領域アイコンにし、メニュー入口が複数あるように見える状態を避けた。
- `DocumentBar` 先頭のファイルアイコン横にあった chevron を削除し、クリック可能な操作に見える要素を減らした。
- 左下の `新しいタブ` は新規ファイル作成ではなく、ノートを開いていない `新しいタブ` 状態を作る操作へ変更した。
- `新しいタブ` 状態ではエディタを表示せず、フォルダを開く、または Markdown ファイルを開く開始画面を表示する。
- ファイルメニュー内の `新規ファイル` は従来通り、workspace 配下では Markdown ファイル作成、scratch では未保存ノート作成に接続した。

検証:

- `npm run build` 成功。
- in-app Browser で `http://127.0.0.1:5175/` を開き、左ペインヘッダー内のボタンが 0 件であることを DOM で確認した。
- in-app Browser で `新しいタブ` をクリックし、`.newTabStart` が表示され、開始画面に `フォルダを開く` と `Markdownファイルを開く` が表示されることを確認した。
- Edge headless + CDP で `新しいタブ` クリック後のスクリーンショット `ui-check-new-tab-menu.png` を生成した。

残タスク:

- Tauri 実機で `新しいタブ` から `フォルダを開く` を実行し、選択後にアクティブタブへ first file が読み込まれることを確認する。
- `WindowBar` と `DocumentBar` の独立コンポーネント化時に、ファイルメニュー入口とパンくず表示の責務を型で分ける。

確認:

- `npm run tauri:build` 成功。
- Windows インストーラー生成確認: `src-tauri/target/release/bundle/nsis/brew_0.2.0_x64-setup.exe`
- MSI 生成確認: `src-tauri/target/release/bundle/msi/brew_0.2.0_x64_en-US.msi`
