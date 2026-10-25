# 保存状態の正規化 分離の手順書

App.tsx の部品の外にある「保存状態（`then.app-state.v1`、Tauri では `load_app_state` / `save_app_state`）を読み込んだときに、形と値を整える関数」を、新しいファイル `src/appStateModel.ts` へ移す。仕様・保存形式・UI・文言・Rust は変えない。移すのは React を使わない純粋な関数と定数だけで、読み込み・保存の処理（`loadStoredState` / `saveStoredState`）と、それを呼ぶ App の中の処理は動かさない。

- ブランチ: `refactor/app-state-normalize`
- 戻し先: タグ `checkpoint/before-app-state-normalize`（コミット `f3f4cc5`。中身は main `6bf3946` と同じ）
- この手順書の行番号は、すべて `f3f4cc5` の時点の src/App.tsx のもの。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済 |
| 2 | 仕組みの説明 | 済 |
| 3 | 依存関係 | 済 |
| 4 | 影響範囲 | 済 |
| 5 | 案 | 済 |
| 6 | 人の確認（確認1） | 待ち |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

移す対象（合わせて約 520 行）:

| 塊 | 行 | 中身 |
|---|---|---|
| 初期の本文 | 535–550 | `documentData`、`initialMarkdown`（初回起動の見本の本文「剣士の目覚め」） |
| フォント名 | 582–628 | `hiraginoCssFontFamilyAliases`、`resolveCssFontFamilyAlias`、`toCssFontFamilyValue`、`normalizeEditorMeasure`、`normalizeStoredFontFamily` |
| 既定の設定 | 647–694 | `defaultSettings` |
| パスの比べ方 | 737–739 | `normalizePathForCompare` |
| 既定の状態 | 864–891 | `createDefaultState` |
| 空白の型 | 893–894 | `WHITESPACE_PATTERN` |
| チェックポイント | 959–1094 | `snapshotId`、`MAX_AUTO_SHELTER_SNAPSHOTS`、`trimAutoShelterSnapshots`、`normalizeSnapshots` |
| 本体 | 1353–1646 | `normalizeCollapsedPathListsByWorkspace`、`knownProofreadRuleIds` / `knownProofreadCheckIds`、`normalizeProofreadSettings`、`normalizeState` |
| 進み具合・カーソル | 1648–1695 | `normalizeFileProgressMigrationVersions`、`normalizeCursorPositions`、`normalizeFileProgress` |

気づいた点:

- 使われていない関数はない（`symbol-uses.mjs` で全部 2 回以上）。
- 移したあとも App が使い続けるもの: `normalizeState`（1700, 1706, 9575）、`createDefaultState`（2074）、`initialMarkdown`（2064, 2083, 2086）、`normalizeFileProgress`（1823, 9505）、`normalizeSnapshots`（1894）、`snapshotId`（6158）、`normalizePathForCompare`（32 か所）、`toCssFontFamilyValue`（638 の `createFontOptions`）、`WHITESPACE_PATTERN`（901 の `countDisplayCharacters`）。この 9 つを export し、App で import する。
- 2210–2211 の `snapshotId` は `openCheckpointStudio` の引数名で、関数とは別物。触らない。
- 同じ名前の「正規化」でも、作品のファイルを読むときのもの（`normalizePlotCards` 1097、`normalizeReferenceLayout` 1225 とその手伝いの関数、`normalizeProofreadIgnored` 1767）は保存状態とは別の流れなので、今回は移さない（5-3）。

## 工程2: 仕組みの説明

### 言葉
- **保存状態（AppState）**: 作品をまたいで覚えておく値の全部。設定、最近開いた作品、サイドバーの状態、ファイルの進み具合、カーソル位置、作品ごとのタブ、古い形式のチェックポイントなど。
- **正規化**: 読み込んだ値が古い形式・壊れた値・範囲外でも、アプリが扱える形にそろえること。足りない値は既定値で埋め、範囲外は丸め、知らない値は捨てる。

### 1. データの形
`types.ts` の `AppState` と `EditorSettings`。正規化の結果は必ず `AppState` の全項目を持つ。

### 2. 利用者の操作と内部の処理

| 場面 | 内部の処理 |
|---|---|
| 起動 | `loadStoredState`（1697）が Tauri の `load_app_state`、ブラウザでは localStorage の `then.app-state.v1`（なければ旧名 `brew.app-state.v1`）を読み、`normalizeState` に通す |
| 最初の描画 | `useState(() => createDefaultState())`（2074）。読み込みが終わるまでの仮の値 |
| 作品の切り替えなど | 9575 で保存状態を読み直して `normalizeState` に通す |
| 作品の進み具合・チェックポイントを読む | `loadWorkspaceFileProgress`（1800）、`loadWorkspaceCheckpoints`（1870）が、Rust から返った値を `normalizeFileProgress` / `normalizeSnapshots` に通す |
| 保存点を作る | 6158 で `snapshotId` が新しい ID を作る |

### 3. 保存
正規化の関数は保存しない。保存は `saveStoredState`（1709）で、App に残る。

### 4. ほかの機能との関係
左右のサイドバー（`utils/leftSidebarState.ts`・`utils/rightSidebarState.ts`）、テーマ、AI 設定、原稿用紙、校正、作品ごとのタブ、ライブラリの統計は、それぞれのファイルの正規化の関数を `normalizeState` が呼ぶだけ。呼び方は変えない。

### 5. 今の挙動の癖（直さないもの。工程9で実機で確かめる）
1. **改行の印（`showLineBreakMarks`）だけ確かめずに通す**: 設定のうち、これだけ `normalizeState` の中に行がない。保存ファイルに文字列などが入っていても、そのまま使う。手で書き換えない限り起きない。
2. **知らない設定の項目が残る**: `...settings` で保存された値を全部広げてから上書きするため、今は使っていない古い項目も、保存のたびに書き戻される（`zoneMode` だけは取り除いて `sidebarHoverMode` に読み替える）。
3. **古いチェックポイントの ID が読み込むたびに変わる**: 保存状態の中の古い形式のチェックポイントで `id` や `createdAt` がないものは、読み込むたびに新しい値を作る。

## 工程3: 依存関係

- **A. React に依存しない処理**: 移すものは全部ここ。新しいファイルが import するのは `types`、`ideaThreadModel`、`themes`、`ai/settings`、`utils/fontStack`、`utils/leftSidebarState`、`utils/rightSidebarState`、`editor/manuscriptLayout`、`editor/workspaceDocumentTabs`、`editor/ast/documentAst`（`hash16`）、`proofread/rules`・`proofread/types`・`proofread/terms`、`library/libraryData`、`export/types`。どれも App を import しないので、循環しない。
- **B. 値（state）**: なし。`appState` は App に残る。
- **C. 操作の関数**: なし。
- **D. useEffect**: なし。
- **E. 作品を開く経路**: `normalizeState` を呼ぶ 3 か所（1700, 1706, 9575）はそのまま App に残る。
- **F. JSX**: 変わらない。
- **G. App の外とのやり取り**: なし（Rust の命令を呼ぶ処理は App に残る）。
- **H. App.tsx の文字列を読むテスト**:

| テスト | 確かめている文字列 | 移したあと |
|---|---|---|
| test:document-tabs 16 行 | `typeof settings.showDocumentTabs === "boolean"` … `defaultSettings.showDocumentTabs` | 新しいファイルも読ませる |
| test:left-sidebar 400–401 行 | `leftSidebarView: normalizeLeftSidebarView(value?.leftSidebarView)` など | 同上 |
| test:right-sidebar 146–147 行 | `rightSidebarCollapsed: normalizeRightSidebarCollapsed(…)` など | 同上 |
| test:project-portability 34–35 行 | `fileProgress: normalizeFileProgress(value?.fileProgress)`、`snapshots: normalizeSnapshots(value?.snapshots)` | 同上 |
| test:v059-visibility 291 行 | `showLineNumbers: false` などの既定値 | 同上 |
| test:checkpoint 32–35 行 | `selectedSnapshotFolderTree` から `restoreSnapshotTreeOrder` までを切り出す | 両方 App に残るので変えない |
| test:v059-visibility 523–524 行 | `settings.sidebarHoverMode === "both" \|\| …` を1行で | App の 3287 行あたりの行に当たっている（正規化の中は改行で分かれていて当たらない）。変えない |

結び目:
1. `normalizePathForCompare` を、チェックポイントの整理（`trimAutoShelterSnapshots`）と、App の 30 か所以上が両方使う。新しいファイルに置いて App が import する形にしかできない（App から import し返すと循環する）。
2. `toCssFontFamilyValue` を、既定の設定（移す）とフォントの一覧（`createFontOptions`、残す）が両方使う。
3. `WHITESPACE_PATTERN` を、チェックポイントの正規化（移す）と文字数（`countDisplayCharacters`、残す）が両方使う。
4. モジュールを読み込んだ時点で値を作るもの（`defaultSettings` が `toCssFontFamilyValue` を呼び、その中で `hiraginoCssFontFamilyAliases` を読む）があるので、新しいファイルの中でも今と同じ順に並べる。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル
- 必ず変わる: `src/App.tsx`（約 520 行減り、import が増える）、`src/appStateModel.ts`（新規）、H の 5 つのテスト（読むファイルを足すだけ）、`package.json`（回帰テストの登録）、`scripts/test-app-state-model.mjs`（新規）
- 変えない: ほかのソース、Rust、CSS、保存形式

### 4-2. まとまりごとの影響
| まとまり | 重さ | 理由 |
|---|---|---|
| `normalizeState` と既定値 | 高（データ消失） | 読み込み時の正規化。1つでも項目が抜けると、起動のたびにその設定が既定値に戻る |
| `normalizeSnapshots` / `trimAutoShelterSnapshots` | 高 | 古い形式のチェックポイントを捨てる条件 |
| `normalizePathForCompare` | 中 | 32 か所で同じ関数を使う。import が抜けると型検査で止まる |
| フォント名の読み替え | 中 | ヒラギノの別名の読み替え |
| `initialMarkdown` など | 低 | 初回起動の見本 |

### 4-3. 起こりうる回帰と、既存テストで気づけるか
| 回帰 | 気づけるか |
|---|---|
| 項目の抜け・既定値の違い | 文字列だけ（一部の項目）。→ 足すテストで実際に動かす |
| モジュールの読み込み順で `defaultSettings` が壊れる | なし。→ 足すテストと build で確かめる |
| import 忘れ | 型検査で止まる |

### 4-4. 今の自動テストの状態
「前」の一式の結果を、終わり次第ここに書く。

## 工程5: 案

### 5-1. 方針
`references/separation.md` の線引きのとおり。中身・文言・条件・順番は1文字も変えず、場所だけ移す。違うのは、App が使い続ける 9 つに `export` を付けることと、App 側の import の行だけ。

### 5-2. 移すもの
工程1の表の全部を、今と同じ順で `src/appStateModel.ts` へ。

### 5-3. 残すもの
- `loadStoredState` / `saveStoredState`、`STORAGE_KEY` / `LEGACY_STORAGE_KEY`、`isTauriRuntime`（保存と読み込みそのもの）
- `createFontOptions`、`fallbackFontFamilies`、`fallbackFontOptions`、`loadSystemFonts`（フォントの一覧で、保存状態ではない）
- 作品のファイルの正規化: `normalizePlotCards`、`normalizeReferenceLayout` とその手伝いの関数（`makeReferenceFileInfo` など、App の資料の操作も使う）、`normalizeProofreadIgnored`。資料（Reference）やプロットを分けるときに、その機能と一緒に移すほうがまとまりがよい。
- `countDisplayCharacters`、`selectedSnapshotFolderTree`、`restoreSnapshotTreeOrder` などチェックポイントの復元の手伝い（test:checkpoint が App の文字列から切り出している）

### 決めてほしいこと
1. **移す範囲**
   - (勧め) 保存状態の正規化だけ（5-2 のとおり）。資料・プロットの正規化は、その機能の分離のときに移す。資料の手伝いの関数は App の操作も使うので、今一緒に移すと export が 10 個以上増える。
   - 作品のファイルの正規化（プロット・資料のレイアウト・校正の無視リスト）も一緒に移す。
2. **見つけた癖（工程2-5）を直すか**
   - (勧め) 今回は直さず、分離が終わってから別の修正として扱う。分離のコミットに挙動の変更が混ざると、前後の比較で「元と同じ」と言えなくなる。
   - 分離のあと、同じブランチで別のコミットとして 2-5 の 1（改行の印を真偽値で確かめる）だけ直す。2 と 3 は保存の中身が変わるので触らない。

### テストの直し方と足すテスト
- H の 5 つのテストは、正規表現を変えず、読む中身に `src/appStateModel.ts` を足す。
- `scripts/test-app-state-model.mjs` を足す（`test:app-state-model`）。esbuild で新しいファイルを束ねて読み込み、実際に動かす:
  - 空・`null`・壊れた値から、`AppState` の全項目がそろう
  - 古い `zoneMode: true` が `sidebarHoverMode: "both"` になる
  - 範囲外の文字サイズ・行間・タイプライターの位置・透明度・UI の大きさが丸められる
  - ヒラギノの別名が読み替えられる
  - 知らない校正ルールの ID が捨てられる
  - 古い形式のチェックポイントが整えられ、自動の退避は作品ごとに新しい 3 つだけ残る
  - 進み具合・カーソル位置・開閉の記録の壊れた項目が捨てられる
- 加えて、その場限りの突き合わせを scratchpad で行う（コミットしない）: チェックポイント `f3f4cc5` の App.tsx から同じ範囲を切り出した元のコードと、新しいファイルに、同じ入力（上の例と、ランダムに壊した保存状態）を与え、結果が完全に同じであることを確かめる。

### 進め方とコミットの分け方
1. 移す（`move-lines.mjs` → `verify-move.mjs`で lost 0 → 型検査 → 関係するテスト）→ コミット
2. 回帰テストを足し、わざと不具合を2つ入れて落ちることを確かめる → コミット
3. 「後」の一式と前後の比較、QA 用アプリでの実機確認 → 手順書を更新してコミット

### 見込みと、今回やらないこと
- 見込み: App.tsx は約 10,537 行から約 10,030 行へ。
- やらないこと: 作品のファイルの正規化の移動、`loadStoredState` などの読み書きの移動、癖の修正（確認1で決めない限り）、似た関数のまとめ。

## 工程6: 人の確認

## 工程7: 実施

## 工程8: 自動テスト

## 工程9: 実機確認

## 工程10: 完了
