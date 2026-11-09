# Plot 分離の手順書

[バインダー再構築 計画書](BINDER_REBUILD_PLAN.md) の第1段階 1-1。`src/App.tsx` から Plot（右サイドバーのプロット）に関係する処理を切り離し、1-6 で Plot を退役させるときに App.tsx を触る範囲を小さくする。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/binder-1-1-plot-state`
- 戻し先: タグ `checkpoint/before-binder-1-1-plot-state`（コミット `ece2885`。main `3cba5b3` に、着手時の未コミットの作業を足したもの。`demo-video/` と `landing-page/` は含めていない）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 省略（利用者の指示「最初のステップに確認なしで進む」。5章の勧めどおりに進める） |
| 7 | 実施 | 済み |
| 8 | 自動テスト | 済み（新しい失敗なし） |
| 9 | 実機確認 | 済み |
| 10 | 完了（確認2） | 確認2を待つ |

行番号は、ことわりがなければチェックポイント `ece2885` の時点のもの。

---

## 工程1: 調査の結果

### Plot のコードがある場所

App.tsx の外にすでにあるもの:

| ファイル | 行数 | 役割 |
|---|---|---|
| `src/components/plot/PlotPane.tsx` | 1,665 | 右サイドバーのプロット一覧と、プロット管理画面。カードの編集・並べ替えは画面の中で行い、`onCardsChange`（= `setPlotCards`）で App へ返す |
| `src/components/plot/plotCardUtils.ts` | 72 | 番号の振り直し、章・セクションの追加（純粋な処理） |
| `src/storedStateModel.ts` の `normalizePlotCards` | — | 読み込んだカードの形を整える |
| `src/utils/libraryTransfer.ts` の `plotCardReferencePaths` `rewritePlotCard` | — | 作品間の移動・コピーで、本文中の資料リンクを書き換える |
| `src/projectEntryActions.ts`（約220行目） | — | ファイルの改名・移動のとき、カード本文の `@[[...]]` のパスを書き換える（すでに分離済み） |
| `src/components/layout/RightSidebar.tsx` | — | Plot タブの見出しの操作（章・セクションの追加、管理画面を開く）と PlotPane の受け渡し |
| `src-tauri/src/lib.rs` 3251〜3273行 | — | `load_project_plot_cards` / `save_project_plot_cards`。`.then/project.json` の `plotCards` を読み書きする |

App.tsx の中（69行が「plot」を含む）:

| 行 | 中身 |
|---|---|
| 128〜129, 165, 174〜177, 211, 248 | import |
| 488〜516 | `defaultPlotCards`（作品がないときの見本カード3枚） |
| 667〜676 | `loadWorkspacePlotCards` / `saveWorkspacePlotCards`（Rust の命令を呼ぶだけ） |
| 993, 1001 | state: `plotWorkspacePath`、`plotCards` |
| 1201 | state: `isPlotManagerOpen` |
| 1213〜1219 | `addPlotSection` / `addPlotChapter`（`useCallback`） |
| 2635〜2646 | `openPlotReference`（`useCallback`。資料カードを開く処理を呼ぶ） |
| 2927〜2928 | 作品を閉じて下書きへ戻るときの初期化 |
| 2962, 3009〜3010 | 起動時の復元で読み込み |
| 3176〜3186 | 遅延保存の useEffect（700 ms、キー `workspace-plot`） |
| 3231〜3257 | 開いたファイルの作品が変わったときの読み込み |
| 4918, 4939〜4940 | ファイルから作品を開くときの読み込み |
| 5785, 5811〜5812 | 作品の切り替えでの読み込み |
| 6385〜6407 | `transferPlotCard`（作品間の移動・コピー） |
| 6842 | `createProjectEntryActions` へ `setPlotCards` を渡す |
| 7245〜7283 | Canvas からの「プロットへ送る」の受け取り（`then-canvas-copy-to-plot`） |
| 7922〜7924 | 作品の最初の画面の「プロット」ボタン |
| 8168〜8179 | `RightSidebar` へ渡す props |

### 気づいた点

- 使われていない Plot の処理はない（`symbol-uses.mjs` で、どの名前も2回以上出る）。
- App.tsx の Plot の文字列を直接読むテストはない（`text-deps.mjs src/App.tsx Plot plot` が空）。移しても、読むファイルを直すテストはない。
- Plot を実際に動かしているテスト: `test:save-on-work-switch`（作品の切り替え直前に足したカードが前の作品に残り、次の作品へ混ざらない）、`test:startup-idea-order`、`test:project-entry-actions`（改名でリンクが書き換わる）、`test:library-transfer`、`test:right-sidebar`、`test:stored-state-model`。

## 工程2: 仕組みの説明

### 言葉

- **カード**: プロットの1項目。`kind` が `section`（番号・題・本文を持つ通常のプロット）か `chapter`（章ラベル。本文なし）。
- **作品のパス（`plotWorkspacePath`）**: いまの `plotCards` がどの作品から読んだものかの印。これが開いている作品と一致しているときだけ保存する。
- **遅延保存（`schedulePendingSave`）**: 変更から700 ms 待って保存する。作品の切り替えの直前には、待っている保存を先に済ませる。

### 1. データの形

`PlotCard = { id, kind, num, title, body, expanded, managerCollapsed }`。作品ごとに `.then/project.json` の `plotCards` へ配列のまま入る。アプリ状態（`appState`）には入らない。

### 2. 利用者の操作と内部の処理

| 操作 | 内部の処理 |
|---|---|
| 右サイドバーでカードを書く・並べ替える・畳む | PlotPane が新しい配列を作り `setPlotCards` |
| 見出しの「＋」で章・セクションを足す | `addPlotChapter` / `addPlotSection` → `plotCardUtils` で末尾に足して番号を振り直す |
| 本文の `@[[資料]]` を開く | `openPlotReference` → 資料カードを開く（資料タブへは切り替えない） |
| カードのメニュー「〜へ移動・コピー」 | `transferPlotCard` → 行き先を聞き、必要なら資料もコピーして、行き先の作品の `plotCards` の末尾に足して保存。移動なら手元から消す |
| Canvas で「プロットへ送る」 | Canvas のウィンドウが `then-canvas-copy-to-plot` を送り、App がカードにして末尾に足す。右サイドバーを Plot に切り替えて開き、「n 件をプロットへ追加しました」と出す |
| 作品の最初の画面の「プロット」 | 右サイドバーを Plot に切り替えて開く |
| ファイルを改名・移動 | `projectEntryActions` が、カード本文の資料パスを書き換える |

### 3. 保存

- 保存先: 作品の `.then/project.json` の `plotCards`（Rust の `update_project_config` で、ほかのキーを残して書き換える）。
- いつ: `plotCards` が変わってから700 ms 後。`isHydrated` で、`plotWorkspacePath` が開いている作品と同じときだけ。保存のあいだに別の作品へ移ったら、その保存は捨てる。
- 読み込み: 作品を開く4つの経路（起動時の復元、作品の切り替え、ファイルから作品を開く、開いたファイルの作品が変わったとき）で、ほかの作品データと一緒に読み、同じ描画で `plotWorkspacePath` と `plotCards` を入れる。
- 作品を閉じたとき: `plotWorkspacePath` を空にし、`plotCards` を見本カードへ戻す（保存はしない）。

### 4. ほかの機能との関係

資料（本文のリンク、移動・コピー時の資料のコピー）、Canvas（プロットへ送る）、ファイルツリー（改名・移動）、右サイドバー（タブの切り替えと復元）、作品の最初の画面。

### 5. 今の挙動の癖（今回は直さない。1-6 で Plot ごと退役する）

1. 作品を開いていないとき、Plot には「縦書きプロットテストです」という見本カードが3枚出る（`defaultPlotCards`）。ブラウザ版では作品を開いても同じカードが出る。
2. 作品を開いていないときに Canvas から「プロットへ送る」と、カードは足されるが保存されない（作品のパスがないため）。
3. Canvas から送ったカードの ID は `plot-<時刻>-<連番>`、画面の「＋」で足したカードの ID は `plotCardUtils` の形と、作り方が2通りある。
4. カードを別の作品やライブラリへ「移動」すると、手元に残ったカードの番号が振り直されない（例: 002 を移すと 001・003・004 のまま）。`transferPlotCard` が `filter` だけをしているため。次に何かを編集して `renumberPlotCards` が走るまで欠番のまま。工程9の実機確認で見つけた。

## 工程3: 依存関係

### A. React に依存しない処理

| 名前 | 読む／呼ぶ | 呼ばれる |
|---|---|---|
| `defaultPlotCards` | — | state の初期値、作品を閉じたとき、`loadWorkspacePlotCards`（ブラウザ版） |
| `loadWorkspacePlotCards` | `isTauriRuntime`、`invoke("load_project_plot_cards")`、`normalizePlotCards` | 作品を開く4経路、`transferPlotCard` |
| `saveWorkspacePlotCards` | `isTauriRuntime`、`invoke("save_project_plot_cards")` | 遅延保存、`transferPlotCard` |

### B. 値（state）

| 値 | 持つ場所 | 保存 |
|---|---|---|
| `plotCards` | App の `useState` | `.then/project.json`（遅延保存） |
| `plotWorkspacePath` | App の `useState` | しない（保存の条件） |
| `isPlotManagerOpen` | App の `useState` | しない |

ほかの機能と共有している値はない。ただし作品を開く経路では、Idea・校正辞書・進捗などと同じ描画でまとめて入れている。

### C. 操作の関数

- C-1 `addPlotSection` / `addPlotChapter`（`useCallback`、`setPlotCards` だけ）
- C-2 `openPlotReference`（`useCallback`、`sortedReferenceCandidates` と `openReferenceCard` を使う。資料の処理）
- C-3 `transferPlotCard`（`plotCards`、`setPlotCards`、`requestTransferOptions`、`isExistingReference`、`prepareReferenceRewrite`、`showToast`、`reportTransferError` を使う）
- C-4 Canvas からの受け取り（`setPlotCards`、`setRightSidebarTab`、`setIsRightSidebarCollapsed`、`showToast`。登録は依存 `[]` の useEffect の中）

### D. 自動で走る処理

- 遅延保存の useEffect（3176〜3186行）。依存は `isHydrated, plotCards, plotWorkspacePath, projectFolder`。

### E. 作品を開く経路

工程2の 3. の4経路と、作品を閉じるとき。どれも複数の値を同じ描画で入れている。

### F. 画面部品への受け渡し

- `RightSidebar`: `addPlotSection`, `addPlotChapter`, `setIsPlotManagerOpen`, `plotCards`, `setPlotCards`, `openPlotReference`, `isPlotManagerOpen`, `transferPlotCard`
- `ScopeStartPage`: `onOpenPlot`
- `createProjectEntryActions`: `setPlotCards`

### G. App の外とのやり取り

- Rust: `load_project_plot_cards`, `save_project_plot_cards`
- ウィンドウ間の知らせ: `then-canvas-copy-to-plot`（Canvas → メイン）

### H. App.tsx の文字列を読むテスト

なし。

### 結び目

1. 値と保存の条件（`plotWorkspacePath`）が、作品を開く4経路の「同じ描画でまとめて入れる」処理に混ざっている。
2. Canvas からの受け取りは、Idea の受け取りと同じ useEffect で、最初の描画のときに1回だけ登録される。
3. 移動・コピーは、資料のコピーと書き換えという App の共有の道具に頼っている。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`、新規 `src/plotCardModel.ts`、新規 `src/plotCardActions.ts`、新規の回帰テスト `scripts/test-plot-card-actions.mjs` と `package.json`
- 変えない: `PlotPane.tsx`、`RightSidebar.tsx`、`projectEntryActions.ts`、Rust、保存形式

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| state・保存の useEffect・作品を開く経路 | 高（データ消失） | 動かすと、前の作品のカードを次の作品へ保存する事故が起こりうる → 今回は動かさない |
| `loadWorkspacePlotCards` / `saveWorkspacePlotCards` の移動 | 中 | 中身は同じ。呼び出し元は変えない |
| `transferPlotCard` の移動 | 中 | 行き先の作品のファイルへ書く。App の道具を deps で受け取る |
| Canvas からの受け取りの移動 | 中 | 最初の描画のときの関数を使い続ける。使うのが関数型の更新と変わらない関数だけなので、意味は変わらない |
| `defaultPlotCards` の移動 | 低 | 値だけ |

### 4-3. 起こりうる回帰と、既存テストで気づけるか

| 回帰 | 気づけるか |
|---|---|
| 作品の切り替えでカードが混ざる | 実際に動かしている（`test:save-on-work-switch`） |
| 起動時にカードが戻らない | 実際に動かしている（`test:startup-idea-order` が読み込みを通る） |
| 移動・コピーで行き先に入らない／手元から消えない | なし → 回帰テストを足す |
| Canvas から送ったカードの形・番号・トースト | なし → 回帰テストを足す |

### 4-4. 今の自動テストの状態

「前」の一式（`ece2885`）: 96本のうち失敗3本。いずれも今回とは関係がない（工程8の表）。

## 工程5: 案

### 5-1. 方針

[references/separation.md](../.claude/skills/then-safe-change/references/separation.md) の線引き（Idea の分離で確認1を通ったもの）に従う。

1. **値・保存・作品を開く経路は App に残す。** 計画書の題は「状態と保存を切り離す」だが、値を移すと作品を開く4経路の「同じ描画でまとめて入れる」形が崩れ、データ消失の危険が高い。保存の処理そのもの（Rust の命令を呼ぶ部分）は移す。Plot は 1-6 で退役するので、そのときは App に残った値と経路を消すだけになる。
2. **移すのは引っ越しだけ。** 中身・文言・条件・順番は変えない。

### 5-2. 純粋な処理 → `src/plotCardModel.ts`（新規）

`defaultPlotCards`、`loadWorkspacePlotCards`、`saveWorkspacePlotCards`。`isTauriRuntime` は、ほかの `*Actions.ts` と同じく、ファイルの中に1行で持つ。

### 5-3. 操作 → `src/plotCardActions.ts`（新規）

`createPlotCardActions(deps)` が `transferPlotCard` と `receiveCanvasCopyToPlot` を返す。

- `transferPlotCard`: 元の位置（`reportTransferError` の直後）で作る。deps は `plotCards, setPlotCards, requestTransferOptions, isExistingReference, prepareReferenceRewrite, showToast, reportTransferError`。
- `receiveCanvasCopyToPlot`: Canvas の受け取りの中身。引数名を元のまま `event` にし、中身を1文字も変えない。`listen` の登録は App の useEffect に残す。

### 5-4. App に残すもの

- 値（`plotCards`、`plotWorkspacePath`、`isPlotManagerOpen`）、遅延保存の useEffect、作品を開く4経路と閉じる処理
- `addPlotSection` / `addPlotChapter`（`useCallback`。依存の指定ごと写すことになるので、今回は動かさない）
- `openPlotReference`（`useCallback`、資料の処理）
- JSX と props

### 5-5. UI 側へ移すもの

なし（props の形を変えないため）。

### テストの直し方と足すテスト

- 直すテストはない（工程3の H が空）。
- 足す: `scripts/test-plot-card-actions.mjs`（`test:plot-card-actions`）。esbuild で `plotCardActions.ts` を束ね、App の値の代わりに入れ物を置いて、移動・コピー・Canvas からの受け取りを実際に動かす。

### 進め方とコミットの分け方

1. `plotCardModel.ts` へ移す（型検査、関係するテスト、コミット）
2. `plotCardActions.ts` へ移す（同上）
3. 回帰テストを足す（効くことを、わざと不具合を2つ入れて確かめる）
4. 「後」の一式と前後の比較、QA 用アプリでの実機確認

### 見込みと、今回やらないこと

- App.tsx は約80行減る見込み。
- やらない: 工程2の 5. の癖を直すこと、値と経路の移動、Plot の退役（1-6）。

## 工程6: 人の確認

確認1は、利用者の指示（2026-11-09「最初のステップに確認なしで進んでください」）により省いた。5章の勧めどおりに進める。

## 工程7: 実施

| コミット | 内容 | App.tsx |
|---|---|---|
| `fc772d1` | `defaultPlotCards`・`loadWorkspacePlotCards`・`saveWorkspacePlotCards` を `src/plotCardModel.ts`（47行）へ | 8,468 → 8,427 行 |
| `6a4381e` | `transferPlotCard` と Canvas からの受け取りの中身を `src/plotCardActions.ts`（104行）へ。App は元の位置で `createPlotCardActions({...})` を呼び、同じ名前で取り出す | 8,427 → 8,387 行 |
| `227e504` | 回帰テスト `scripts/test-plot-card-actions.mjs`（`test:plot-card-actions`） | — |

元と同じであることの確かめ方:

- `verify-move.mjs` で、移した行を元と突き合わせた。どちらのコミットも lost 0。App に足した行は、import と `createPlotCardActions({...})` の呼び出し、`receiveCanvasCopyToPlot(event);` だけ。
- Canvas からの受け取りは、引数名を元のまま `event` にしたので、中身は字下げ以外1文字も変えていない。
- `symbol-uses.mjs --call-site` で、`createPlotCardActions` に渡す値がすべて呼び出し位置より前で宣言されていること、返す2つの関数を呼び出し位置より前で使っていないことを確かめた。
- `listen` の登録は依存 `[]` の useEffect のまま。最初の描画のときの `receiveCanvasCopyToPlot` を使い続けるが、元の書き方でも最初の描画のときの `showToast` などを使っていたので、意味は変わらない。
- App で使わなくなった import（`normalizePlotCards`、`renumberPlotCards`、`plotCardReferencePaths`、`rewritePlotCard`）を消した。
- 元と違う点: `plotCardModel.ts` に `isTauriRuntime` を1行で持たせた（ほかの `*Actions.ts` と同じ書き方）。

途中の手違い: 「前」の一式が動いているあいだに最初の移動をしてしまい、気づいてすぐ scratchpad へ退避して戻した（約2分）。一式の build はその前に終わっていた。そのあいだに動いていたのは `test:external-url` だけで、これは Rust のコンパイル中に時間切れになっており、App.tsx の中身とは関係がない。

## 工程8: 自動テスト

### 足した回帰テスト

`scripts/test-plot-card-actions.mjs`（`test:plot-card-actions`）。esbuild で `plotCardModel.ts` と `plotCardActions.ts` を束ねて読み込み、Rust の命令は `window.__TAURI_INTERNALS__.invoke` の入れ物で受けて、作品ごとの `plotCards` を持たせる。操作のたびに、その時点の値で `createPlotCardActions` を作り直す（App の描画と同じ形）。

- 読み書き: 読み込んだカードを正規化して返す。保存は `save_project_plot_cards` へ渡す。見本カードは3枚
- コピー: 尋ねる資料の数は作品にあるものだけ。行き先の末尾に新しい ID で1枚足し、コピーした資料へリンクを書き換える。手元には残す。通知「作品Bへコピーしました」
- 移動（章ラベル）: 尋ねる名前が「章ラベル」。手元から消す。通知「作品Cへ移動しました」
- やめたとき・ないカード: 何も読み書きしない。ないカードでは行き先を聞かない
- 保存に失敗したとき: エラーを知らせ、移動でも手元に残す
- Canvas からの受け取り: 空のカードだけなら何もしない。複数行は1行目を題に、1行だけなら本文に。ID は `plot-<時刻>-<連番>`、番号は章を飛ばして振り直す。右サイドバーを Plot にして開き、「2 件をプロットへ追加しました」

効くことの確かめ方: コミットのあと、わざと不具合を3つ入れて、どれも落ちることを見てから `git checkout` で戻した（移動とコピーの取り違え、1行だけのカードにも題を付ける、読み込みの正規化を抜く）。

### 全体のテスト（前後の比べ）

| | 前（`ece2885`） | 後（`227e504`） |
|---|---|---|
| build | 成功 | 成功 |
| 本体の JavaScript | 706,786 バイト | 707,313 バイト（+527） |
| テスト | 96本、失敗3 | 97本、失敗2 |

- 両方で通った: 93本（`test:save-on-work-switch`、`test:startup-idea-order`、`test:project-entry-actions`、`test:right-sidebar`、`test:library` を含む）
- 両方で失敗: `test:editor-text-edits`（アイコンの数 32 と 33。着手時に未コミットだった `AppIcon.tsx` の変更による。チェックポイントの状態で単独で動かしても落ちる）、`test:v058-bundle`（元から 500 kB の上限を超えている）
- 前だけ失敗: `test:external-url`（前は Rust のコンパイル中に時間切れ。後はコンパイル済みで通った）
- 後だけにある: `test:plot-card-actions`（通った）
- 新しい失敗: なし

## 工程9: 実機確認

### やり方

`227e504` を識別子 `local.then.qa.plotsplit1109` で build した QA 用アプリを、scratchpad の一時ライブラリ（作品A: 章1つとセクション2つ、作品B: セクション1つ）で動かした。右サイドバーは Plot で始めた。保存は、操作から2秒以上待って各作品の `.then/project.json` を読み、画面と突き合わせた。

### 結果

| 確認したこと | 結果 |
|---|---|
| 起動時の読み込み | 作品Aのカード（Aの第一章、Aの港、Aの坂）が出た |
| 編集と保存 | 「セクションを追加」して題「Aの灯台」を入力 → 作品Aの `plotCards` の末尾に `003 Aの灯台`。作品Bは元のまま |
| 編集の直後に作品を切り替える | 作品Aでセクションを足してすぐ作品Bへ → 作品Bの画面は「Bの駅」だけ。作品Aのファイルに足したカードが入り、作品Bのファイルは元のまま。作品Aに戻すと足したカードも出た |
| ライブラリへコピー | カードのメニュー「ライブラリへ移動・コピー…」→ ダイアログ「プロットを移動・コピー」→ 実行 → 通知「ライブラリ「QAライブラリ」の直下へコピーしました」。ライブラリの `.then/project.json` に新しい ID で「Aの港」が入り、作品Aには残った |
| ライブラリへ移動 | 方法を「移動（元から取り除く）」にして実行 → 通知「…の直下へ移動しました」。ライブラリに「Aの坂」が足され、作品Aの画面とファイルから消えた |
| Canvas からの受け取り | `then-canvas-copy-to-plot` をアプリへ送った（3件、うち1件は空白だけ）→ 通知「2 件をプロットへ追加しました」。「Canvasの題／Canvasの本文」と「（題なし）／一行のカード」が末尾に入り、番号が振り直された。ID は `plot-<時刻>-0`、`-1` |
| 受け取りで右サイドバーが切り替わる | 補助ペインを「バインダー」にして右サイドバーを畳んでから送る → 補助ペインが「プロット」になり、右サイドバーが開いた |
| 再起動後の復元 | 止めて同じアプリ状態で起動し直す → Plot の入力欄9つの中身が、再起動前と同じ |

### 今の挙動の癖（工程2の 5）を実機で確かめた結果

- 4（移動のあと番号が振り直されない）を、実機で見つけた。分離の前のコードも同じ書き方なので、今回の変更によるものではない。
- 1〜3 は、実機では確かめていない（1 は作品を開いていない画面、2 は作品のない状態で Canvas を開く必要がある）。3 は回帰テストで ID の形を確かめている。

### 確かめられなかったこと

- Canvas のウィンドウの「プロットへ送る」ボタンそのものは押していない。Canvas のウィンドウが送るのと同じ知らせを、メインのウィンドウから送って確かめた（受け取る側は同じ）。
- 資料を参照しているカードの移動・コピー（資料のコピーと書き換え）は、実機では確かめていない。回帰テストで確かめている。

### 片付け

`qa-cleanup.mjs` で、QA アプリのアプリ状態（`%APPDATA%`・`%LOCALAPPDATA%` の `local.then.qa.plotsplit1109`）と一時ライブラリを消した。残り: QA Then 0、QA WebView2 0、テストの Edge 0、テストの node 0、`%TEMP%` のテスト用プロファイル 0。`src-tauri/target/release/Then.exe` は QA 用の build で上書きされている。

## 工程10: 完了

### 変わったもの

- 新規: `src/plotCardModel.ts`（見本カード、読み込み、保存）、`src/plotCardActions.ts`（作品間の移動・コピー、Canvas からの受け取り）、`scripts/test-plot-card-actions.mjs`
- `src/App.tsx`: 約80行減。Plot の値・保存の useEffect・作品を開く経路・JSX は App に残した
- 仕様・保存形式・UI・文言・Rust: 変えていない

### 確かめたこと

- 移した行は元と同じ（lost 0）。型検査が通る
- テスト一式: 新しい失敗なし。足した回帰テストは、わざと入れた不具合3つをすべて捕まえた
- 実機: 編集と保存、作品の切り替え、ライブラリへのコピーと移動、Canvas からの受け取り、再起動後の復元

### 残っていること

| 作業 | メモ |
|---|---|
| 工程2の癖 4（移動のあと番号が振り直されない） | 直すかは利用者が決める。1-6 で Plot を退役させるなら、直さずに済む |
| 1-2: App.tsx から Idea の状態と保存を切り離す | 計画書の次の段階 |
