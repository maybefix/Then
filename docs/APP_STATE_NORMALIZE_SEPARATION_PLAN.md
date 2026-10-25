# 保存状態の正規化 分離の手順書

App.tsx の部品の外にある「保存状態（`then.app-state.v1`、Tauri では `load_app_state` / `save_app_state`）を読み込んだときに、形と値を整える関数」と、作品のファイル（プロット・資料のレイアウト・校正の無視リスト）を読み込んだときに整える関数を、新しいファイル `src/storedStateModel.ts` へ移す（作品のファイルの分は確認1で範囲に加えた）。仕様・保存形式・UI・文言・Rust は変えない。移すのは React を使わない純粋な関数と定数だけで、読み込み・保存の処理（`loadStoredState` / `saveStoredState`）と、それを呼ぶ App の中の処理は動かさない。

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
| 6 | 人の確認（確認1） | 済（2026-10-25） |
| 7 | 実施 | 済 |
| 8 | 自動テスト | 済 |
| 9 | 実機確認 | 済 |
| 10 | 完了（確認2） | 確認2 待ち |

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
| 資料の最近の数（確認1で追加） | 362 | `MAX_RECENT_REFERENCES` |
| プロット（確認1で追加） | 1097–1125 | `normalizePlotCards`、`normalizeReferenceScope` |
| 資料の情報（確認1で追加） | 1131–1159 | `isReferenceFileInfo`、`makeReferenceFileInfo` |
| 資料のレイアウト（確認1で追加） | 1182–1342 | `referenceInitialSize`、`isReferenceCardRecord`、`isIdeaCardRecord`、`clampReferenceCardToStage`、`normalizeReferenceLayout` |
| 校正の無視リスト（確認1で追加） | 1764–1778 | `ProofreadIgnoredByPath`、`normalizeProofreadIgnored` |

気づいた点:

- 使われていない関数はない（`symbol-uses.mjs` で全部 2 回以上）。
- 移したあとも App が使い続けるもの: `normalizeState`（1700, 1706, 9575）、`createDefaultState`（2074）、`initialMarkdown`（2064, 2083, 2086）、`normalizeFileProgress`（1823, 9505）、`normalizeSnapshots`（1894）、`snapshotId`（6158）、`normalizePathForCompare`（32 か所）、`toCssFontFamilyValue`（638 の `createFontOptions`）、`WHITESPACE_PATTERN`（901 の `countDisplayCharacters`）。この 9 つを export し、App で import する。確認1で加えた分では、`normalizePlotCards`（1742）、`normalizeReferenceLayout`（1927, 3932）、`makeReferenceFileInfo`（2522）、`referenceInitialSize`（2545）、`clampReferenceCardToStage`（2550, 8902）、`MAX_RECENT_REFERENCES`（1171 の `upsertRecentReference`）、`normalizeProofreadIgnored`（1787）、`ProofreadIgnoredByPath`（1782, 1792, 2116）の 8 つも App が使い続ける。合わせて 17 を export する。
- 資料の手伝いのうち、正規化が使わない `referenceCardKey`、`upsertRecentReference(s)`、`nextReferenceZIndex` とその定数は App に残す。`referenceKindFromPath` と `referenceNameFromPath` は移す関数しか使わなくなるので、App の import から外れる。
- 2210–2211 の `snapshotId` は `openCheckpointStudio` の引数名で、関数とは別物。触らない。

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
1. **（直した。`37d20a3`）改行の印（`showLineBreakMarks`）だけ確かめずに通す**: 設定のうち、これだけ `normalizeState` の中に行がない。保存ファイルに文字列などが入っていても、そのまま使う。手で書き換えない限り起きない。
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
- 必ず変わる: `src/App.tsx`（約 520 行減り、import が増える）、`src/storedStateModel.ts`（新規）、H の 5 つのテスト（読むファイルを足すだけ）、`package.json`（回帰テストの登録）、`scripts/test-app-state-model.mjs`（新規）
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
「前」の一式（`f3f4cc5`）: build 成功、84 本のうち 3 本が元から失敗（test:canvas-save は `./utils/fontStack` を読み込めない、test:v058-bundle は main chunk 705,760 バイトが上限超え、test:v0511-themes は Shuboku のプロットの枠線）。今回とは関係ない。

## 工程5: 案

### 5-1. 方針
`references/separation.md` の線引きのとおり。中身・文言・条件・順番は1文字も変えず、場所だけ移す。違うのは、App が使い続ける 9 つに `export` を付けることと、App 側の import の行だけ。

### 5-2. 移すもの
工程1の表の全部を、今と同じ順で `src/storedStateModel.ts` へ。

### 5-3. 残すもの
- `loadStoredState` / `saveStoredState`、`STORAGE_KEY` / `LEGACY_STORAGE_KEY`、`isTauriRuntime`（保存と読み込みそのもの）
- `createFontOptions`、`fallbackFontFamilies`、`fallbackFontOptions`、`loadSystemFonts`（フォントの一覧で、保存状態ではない）
- 資料の手伝いのうち正規化が使わないもの: `referenceCardKey`、`upsertRecentReference(s)`、`nextReferenceZIndex`、`PINNED_REFERENCE_Z_BASE` / `NORMAL_REFERENCE_Z_LIMIT`、`defaultReferenceLayout`、`defaultPlotCards`
- 作品のファイルを読み書きする処理: `loadWorkspacePlotCards`、`loadReferenceLayout`、`loadWorkspaceProofreadIgnored` など（Rust の命令を呼ぶ）
- `countDisplayCharacters`、`selectedSnapshotFolderTree`、`restoreSnapshotTreeOrder` などチェックポイントの復元の手伝い（test:checkpoint が App の文字列から切り出している）

### 決めてほしいこと
1. **移す範囲**
   - (勧め) 保存状態の正規化だけ（5-2 のとおり）。資料・プロットの正規化は、その機能の分離のときに移す。資料の手伝いの関数は App の操作も使うので、今一緒に移すと export が 10 個以上増える。
   - 作品のファイルの正規化（プロット・資料のレイアウト・校正の無視リスト）も一緒に移す。
2. **見つけた癖（工程2-5）を直すか**
   - (勧め) 今回は直さず、分離が終わってから別の修正として扱う。分離のコミットに挙動の変更が混ざると、前後の比較で「元と同じ」と言えなくなる。
   - 分離のあと、同じブランチで別のコミットとして 2-5 の 1（改行の印を真偽値で確かめる）だけ直す。2 と 3 は保存の中身が変わるので触らない。

### テストの直し方と足すテスト
- H の 5 つのテストは、正規表現を変えず、読む中身に `src/storedStateModel.ts` を足す。
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
- 見込み: App.tsx は 10,538 行から 9,687 行へ（`move-lines.mjs --dry-run` の数。858 行を 13 の塊で移す）。新しいファイルは 924 行。
- やらないこと: `loadStoredState` などの読み書きの移動、癖の 2 と 3 の修正、似た関数のまとめ。

## 工程6: 人の確認

2026-10-25 に決まったこと:

1. 移す範囲: 保存状態の正規化に加えて、作品のファイルの正規化（プロット・資料のレイアウトとその手伝い・校正の無視リスト）も移す。
2. 見つけた癖: 1（改行の印の設定を確かめていない）だけ、分離のあと同じブランチの別のコミットで直す。2 と 3 は保存の中身が変わるので触らない。

## 工程7: 実施

| コミット | 内容 |
|---|---|
| `25c5191` | 13 の塊（858 行）を `move-lines.mjs` で `src/storedStateModel.ts` へ移し、App が使い続ける 17 を export。App で使わなくなった import を外した。文字列を読む 5 つのテストに、新しいファイルも読ませた |
| `d61e2eb` | 回帰テスト `test:stored-state-model` を足した |
| `1a762c3` | 癖 1 のテスト（この時点では落ちる） |
| `37d20a3` | 癖 1 の修正: `normalizeState` に `showLineBreakMarks` の行を足した（真偽値でなければ既定値の false） |

- 行数: App.tsx 10,538 行 → 9,642 行（移した 858 行と、外した import の行）。`src/storedStateModel.ts` は 923 行（癖 1 の修正で 927 行）。
- 元と同じであることの確かめ方: `verify-move.mjs` で、App から消えた行のうち新しいファイルに見つからないものは、外した import の行だけ（21 行）。`npx tsc --noEmit` と `npm run build` が通った。
- 違う点: 移した関数のうち 17 に `export` が付いたこと、新しいファイルの import と先頭の説明 2 行。中身・順番・文言は同じ。
- テストの直し方: test:document-tabs・test:left-sidebar・test:right-sidebar・test:project-portability・test:v059-visibility は、正規表現を変えずに、読む文字列に `src/storedStateModel.ts` を足した（App の後ろにつなぐので、App の中の位置を使う確認はそのまま）。

## 工程8: 自動テスト

### 足した回帰テスト
`scripts/test-stored-state-model.mjs`（`test:stored-state-model`）。esbuild で `src/storedStateModel.ts` を束ねて読み込み、実際に動かす。空・壊れた保存状態から全項目がそろうこと、`zoneMode` の読み替え、範囲外の丸め、ヒラギノの別名、校正の設定、開閉・進み具合・カーソル位置、古い形式のチェックポイントと自動の退避の数、プロット、資料のレイアウト（global の除外・ステージへの収め方・最近の数）、校正の無視リスト、癖 1 の修正を確かめる。

効くことの確かめ方: `25c5191` の後に、わざと不具合を 2 つ入れて落ちることを見て、`git checkout` で戻した。

| 入れた不具合 | 回帰テスト | 元のコードとの突き合わせ |
|---|---|---|
| 文字サイズの下限 12 → 10 | 落ちた | 違い 374 件 |
| 自動の退避の上限 `>=` → `>` | 落ちた | 違い 688 件（退避の多い入力を足した後） |

### 元のコードとの突き合わせ（その場限り、コミットしない）
チェックポイント `f3f4cc5` の App.tsx から同じ 13 の塊を切り出したものと、`25c5191` の `src/storedStateModel.ts` に、ランダムに壊した入力を 30,000 件（保存状態・チェックポイント・プロット・資料のレイアウト・無視リストなど 9 種類）与え、時刻と乱数をそろえて結果を比べた。違いは 0 件。既定の状態と、ステージの大きさを渡した資料のレイアウトも同じだった。

### 前後の比較
| | 前（`f3f4cc5`） | 後（`37d20a3`） |
|---|---|---|
| build | 成功 | 成功 |
| main chunk | 705,760 バイト | 705,873 バイト（+113） |
| 両方で通った | 81 | 81 |
| 両方で失敗 | 3（工程4-4 の 3 本、同じ理由） | 3 |
| 新しい失敗 | — | 0 |
| 後だけ | — | test:stored-state-model（通過） |
| 残ったプロセス | 0 | 0 |

## 工程9: 実機確認

### やり方
`37d20a3` を識別子 `local.then.qa.storedstate1025` で build した QA 用アプリを、scratchpad の一時ライブラリ（作品A・作品B）で動かした。保存状態には、わざと古い形式・壊れた値を入れた: `zoneMode: true`、`fontSize: 18`、`showLineNumbers: true`、`showLineBreakMarks: "yes"`、`editorFontFamily: "ヒラギノ明朝 Pro W3"`、知らない項目 `qaUnknownSetting`。作品A には章 1 つと場面 1 つのプロット、横位置 5000 の資料カードと global の資料カード、重複と空の項目を含む校正の無視リストを入れた。

### 確認した項目と結果
| 確認したこと | 結果 |
|---|---|
| 起動時に保存状態が画面に出る | 本文の文字サイズ 18px、フォントは `"Hiragino Mincho Pro", "ヒラギノ明朝 Pro"` に読み替わって使われた。右サイドバーはプロット |
| 設定の画面 | 「本文」タブで「行番号を表示」がオン、「改行記号を表示」がオフ（癖 1 の修正の効果） |
| 書き戻した保存状態（app-state.json） | `sidebarHoverMode: "both"`、`zoneMode` はなし、`showLineBreakMarks: false`、`fontSize: 18`、校正の設定は既定値でそろった |
| プロット（作品のファイルの正規化） | 「第一章」の下に「001 A場面」 |
| 資料のレイアウト | project のカードだけが出て、global のカードは除かれた。横位置は 888 に収まり、保存し直したファイルも同じ（最近の資料にカードのファイルが入った） |
| 校正の無視リスト | 保存し直した project.json で `{"本文.txt": ["qa-key"]}`（重複と空の項目が除かれた） |
| 保存点を作る（Ctrl+Shift+S） | 通知「保存点「2026/10/25 16:48」を作りました」。ファイルは `.then/checkpoints/snapshot-mvnj03f2-aslmhj.json`（`snapshotId` の形） |
| 作品の切り替え（A → B） | プロットは「B場面」、資料のカードはなし。作品A の project.json・資料のレイアウト・保存点のファイルは、切り替えの前後で同じ（ハッシュで比べた） |
| 再起動後の復元 | 作品B、プロット「B場面」、文字サイズ 18px が戻った。設定は再起動の前後で 1 項目も変わらなかった |
| 作品A に戻る | 保存点の表示「保存点 1分前 · ±0字」、資料のカード、プロット「A場面」が戻った |

### 今の挙動の癖を実機で確かめた結果
- 癖 2（知らない項目が残る）: `qaUnknownSetting: "kept"` が書き戻した保存状態に残った。分離の前と同じ。
- 癖 3（古いチェックポイントの ID）: 実機では確かめていない。作品ごとの保存へ移す前の古い保存状態が要るため。回帰テストと突き合わせで、元と同じ結果になることを確かめた。

### 新しく見つけた癖（直さない）
4. **起動直後に開いた作品では、資料のカードがはみ出す**: 資料のレイアウトを読むとき（App に残した `loadReferences`）、本文の枠の大きさで収めるが、起動直後はまだ枠を測れず、仮の 1200×800 で収める。幅 960 の窓で、横位置 5000 のカードが 888 に置かれ、右端がはみ出した。作品を切り替えて開き直すと、本物の枠の大きさで 604 に置かれた。今回動かしていない処理なので、分離の前からある。`docs/KNOWN_ISSUES.md` に記録した。→ 2026-10-25 に `fix/reference-layout-startup-fit` で直した（`docs/REFERENCE_LAYOUT_STARTUP_FIT_PLAN.md`）。

### 確かめられなかったこと
- 校正の無視リストが画面の指摘から外れること（無視のキーを作るには指摘を出す本文が要る）。正規化の結果はファイルで確かめた。
- ブラウザで動かしたときの localStorage からの読み込み（Tauri の QA 用アプリで確かめた）。

### 片付け
`q.mjs stop` と `qa-cleanup.mjs` で、QA の Then・WebView2・テストの Edge と node はすべて 0、%APPDATA% と %LOCALAPPDATA% の QA 用フォルダと一時ライブラリを消した。`src-tauri/target/release/Then.exe` は QA 用の build で上書きされている。

## 工程10: 完了

### 変わったもの
- `src/storedStateModel.ts`（新規）: 保存状態と作品のファイルを読み込んだときの正規化。App.tsx は 10,538 行から 9,642 行へ。
- 挙動の変更は癖 1 の修正だけ（改行の印の設定が真偽値でなければ既定値のオフ）。
- `test:stored-state-model` を足した。文字列を読む 5 つのテストに、新しいファイルを読ませた。

### 残っている別の作業
| 作業 | 理由 |
|---|---|
| 癖 2: 知らない設定の項目を書き戻さない | 保存の中身が変わる |
| 癖 3: 古い形式のチェックポイントの ID を読み込みごとに変えない | 古い保存状態だけに関係する |
| 癖 4: 起動直後の資料のカードを、本物の枠の大きさで収める | App の `loadReferences` の測り方の問題 |
