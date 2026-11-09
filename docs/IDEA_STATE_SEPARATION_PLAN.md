# Idea の状態と保存の分離（BINDER 1-2）の手順書

[バインダー再構築 計画書](BINDER_REBUILD_PLAN.md) の第1段階 1-2。Idea は 2026-10-23 に一度分離した（[IDEA_SEPARATION_PLAN.md](IDEA_SEPARATION_PLAN.md)。`ideaThreadModel.ts` / `ideaThreadActions.ts`）。そのとき App に残したもののうち、何がまだ `src/App.tsx` にあるかを洗い出し、1-1（[PLOT_SEPARATION_PLAN.md](PLOT_SEPARATION_PLAN.md)）と同じ線引きで、読み書きと操作を App の外へ移す。仕様・保存形式・UI・文言・Rust は変えない。

「Ideaの管理単位」（`snippetStorageMode`）は、計画書 3.8 で第2段階に廃止すると決まっている。この設定にしか関わらない処理は移さず、2-4 で消す候補として 5-6 に分けて書く。

- ブランチ: `refactor/binder-1-2-idea-state`
- 戻し先: タグ `checkpoint/before-binder-1-2-idea-state`（コミット `ff412c4`。中身は main `1659ac6` と同じ。`demo-video/` と `landing-page/` は含めていない）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み（前回の手順書を参照し、変わった所だけ書く） |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 待ち |
| 7 | 実施 | |
| 8 | 自動テスト | 「前」の一式は済み |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

行番号は、ことわりがなければチェックポイント `ff412c4` の時点の `src/App.tsx`（8,386行）のもの。

---

## 工程1: 調査の結果

### 前回 App に残したものの、今の行方

前回の手順書 5-4 で「App に残す」とした項目を、一つずつ今の App.tsx と突き合わせた。

| 前回残したもの | 今 | 場所（行） |
|---|---|---|
| 値: `appState.snippets` / `profileSnippets` / `settings.snippetStorageMode` | App にある（`appState` の一部） | 1991 で `snippets`・`settings` を取り出す |
| 値: `snippetWorkspacePath` | App にある | 949 |
| 値: `isQuickIdeaModalOpen`、`ideaFocusRequest`、`draggingId` | App にある | 1010、1159、980 |
| 値: `referenceLayout.ideaThreads` と Idea カード | App にある（資料と共有） | — |
| `loadWorkspaceSnippets` / `saveWorkspaceSnippets` | **App にある**（部品の外） | 624〜633 |
| `normalizeState`・`createDefaultState` の Idea 部分 | `src/storedStateModel.ts` へ移っている（別の分離で） | storedStateModel.ts 173〜177、657〜670、699 |
| `isIdeaCardRecord` / `normalizeReferenceLayout` | `src/storedStateModel.ts` へ移っている | storedStateModel.ts 473〜510 |
| 保存の useEffect（D-3、キー `workspace-idea`、700 ms） | App にある | 3121〜3131 |
| 並び順の整合（D-1）、消えた Idea のカードを閉じる（D-2） | App にある | 2733〜2744、2746〜2759 |
| 資料レイアウトの読み込み（管理単位に合わせる処理を含む） | App にある | 2622〜2650（2637 で `alignIdeaLayoutToMode`） |
| Canvas への最新一覧の送信（D-6） | App にある | 6606〜6630 |
| 作品を開く経路 E-1〜E-5 | App にある | 下の表 |
| C-3 `addReferencesToIdeaThread`・`moveIdeaReference`・`removeIdeaReference`・`reorderIdeaThreadItem`（`useCallback`） | App にある | 1299〜1329、1474〜1508、1510〜1574、1576〜1596 |
| C-3 `handleAddReference`・`handleCreateReference`・`handleDeleteImportedReference`（資料の処理） | App にある | 1331〜1472 |
| `openIdeaBinderCard`（Idea カードを開く） | App にある | 6883〜6934 |
| `requestNewIdeaThreadName` | App にある | 6977〜6987 |
| `openIdeaCanvasBoard` | App にある | 3867〜3923 |
| `handTextToAi` | なくなっている（`src/` のどこにもない。Idea・Quick Idea の「AIに聞く」も今はない） | — |
| C-7 `ensureIdeaTransferAvailable`・`transferIdeaThread`・`transferIdeaFragment` | **App にある** | 6354〜6436 |
| C-8 `handleSnippetStorageModeChange` | App にある（その後 `fix/idea-bugs` で確認と書き切りが足された） | 7506〜7564 |
| C-9 使われていない処理と、それに巻き込まれた処理 | **App にある**（約290行） | 下の表 |
| `getEditorView` | App にある。見出しへの移動（`jumpToOutlineItem`）でも使う | 6841〜6843 |
| Canvas からの受け取りの登録（`listen`） | App にある。中身は `receiveCanvasCopyToIdea` / `receiveCanvasFocusIdea`（`ideaThreadActions.ts`） | 7173〜7200 付近 |
| JSX | App にある。右サイドバーへの受け渡しは `RightSidebar` 経由になった | 7745、7788〜7789、7845、8059、8088〜8105、8135〜8136、8331〜8335、8350〜8351 |

作品を開く経路（Idea の読み込みと保存の目印 `snippetWorkspacePath` が混ざっている場所）:

| 経路 | 行 |
|---|---|
| E-5 作品なしで開く（`openScratchFromStoredState`） | 2877〜2901（2883 で目印を空に） |
| E-1 起動時の復元（`restoreWorkspaceFromState`） | 2903〜2990 付近（2915〜2918 読み込み、2963〜2965 目印、2931 `snippets`） |
| E-2 作品の自動検知（useEffect） | 3169〜3264 |
| E-3 ファイルを開いたら作品が変わった（`setWorkspaceFromDocumentPath`） | 4825〜4960（4871〜4874、4893〜4895、4914） |
| E-4 作品の切り替え（`openWorkspaceFolder`） | 5730〜5800 付近（5738〜5741、5767、5795） |

### 使われていない処理（前回の C-9）の今の範囲

`symbol-uses.mjs` で、次の7つは定義の1回しか出ない（どこからも呼ばれていない）。

| 処理 | 行 |
|---|---|
| `toggleFragmentUsed` | 6876〜6881 |
| `reorderFragment` | 6936〜6975 |
| `insertFragmentToEditor` | 7022〜7030 |
| `insertThreadToEditor` | 7032〜7053 |
| `openCanvasOrigin` | 7055〜7057 |
| `sendIdeaFragmentToCanvas` | 7059〜7104 |
| `sendIdeaThreadToCanvas` | 7106〜7169 |

これらにしか使われていないもの:

- `insertParagraph`（6845〜6863）、`markFragmentUsed`（6865〜6874）
- 部品の外の Canvas ボード用の5関数 `listCanvasBoards`・`createCanvasBoard`・`loadCanvasBoard`・`saveCanvasBoard`・`ensureCanvasBoard`（812〜867）
- import: `createCanvasEdge`、`createCanvasGroupNode`、`createCanvasTextNode`、`type CanvasNode`（157〜166）、`nextCanvasPlacement`（199）、`IdeaOriginRef`（240）。ほかの名前（`CanvasScope`、`CanvasBoardSummary`、`createCanvasDocument`、`normalizeCanvasDocument` など）は、消したあとに `symbol-uses.mjs` で確かめる。

合わせて約290行。`getEditorView` は `jumpToOutlineItem` でも使うので巻き込まれていない。

### 気づいた点

- App.tsx の文字列を読む Idea のテスト（`text-deps.mjs`）:
  - `test:binder`: `app`（App.tsx・RightSidebar.tsx・LeftSidebar.tsx をつないだもの）に `addReferencesToIdeaThread`、`items: [...additions, ...layout.items]`、`items: [makeReferenceLink(link.sourcePath), ...layout.items]`、`countIdeaReferenceLinks`、`onMoveReference={moveIdeaReference}`、`title: "新規スレッドに追加"`、`onReorderItem={reorderIdeaThreadItem}` があること
  - `test:v066-idea`: App.tsx に `showToast("並び順を変更しました", { label: "元に戻す"`（使われていない `reorderFragment` の中）があること
  - `test:project-portability`: `const handleSnippetStorageModeChange` と `const openIdeaCanvasBoard` を、App.tsx の一部を切り出す**終わりの目印**に使っている
- Idea を実際に動かしているテスト: `test:idea-actions`（`ideaThreadModel.ts`・`ideaThreadActions.ts` を束ねて動かす）、`test:save-on-work-switch`（作品の切り替え直前の Idea が前の作品に残る）、`test:startup-idea-order`（起動・作品を開くときに並び順を書き直さない）、`test:stored-state-model`。
- 作品間の移動・コピー（`transferIdeaThread` / `transferIdeaFragment`）を実際に動かすテストはない。

## 工程2: 仕組みの説明

Idea のデータの形、操作、保存、ほかの機能との関係は、[IDEA_SEPARATION_PLAN.md](IDEA_SEPARATION_PLAN.md) の工程2から変わっていない。その後に変わったのは次の点。

- 管理単位を切り替える前に確認を出し、作品の Idea の遅延保存を書き終えてから切り替える。資料レイアウト（`default.json`）は、並び順がどちらの管理単位のものか（`ideaThreadsMode`）と、表示していない側の並び順と Idea カード（`otherIdea`）を持ち、作品を開いたときと切り替えたときに `alignIdeaLayoutToMode` で入れ替える（`docs/IDEA_BUGFIX_PLAN.md`）。
- 断片・スレッドの削除を元に戻すと、並び順・資料リンク・Idea カードも戻る。メインの画面の Idea を Canvas へドラッグできる。
- 起動・ファイルを開く経路でも、作品のパス・目印・作品の Idea を同じ描画で入れる（`docs/STARTUP_IDEA_ORDER_FIX_PLAN.md`）。
- 作品を切り替える直前の遅延保存は、前の作品へ書き切る（`schedulePendingSave` の第4引数。`docs/SAVE_ON_WORK_SWITCH_FIX_PLAN.md`）。

### 今回の対象の動き

**作品の Idea の読み書き**（`loadWorkspaceSnippets` / `saveWorkspaceSnippets`）

- 読む: Rust `load_project_snippets` が `.then/project.json` の `ideaThreads` を返す。空なら空のインボックスだけ（`defaultIdeaThreads`）、あれば正規化（`normalizeIdeaThreads`）。ブラウザ版は常に空のインボックス。
- 書く: Rust `save_project_snippets`。ブラウザ版は何もしない。
- 呼ぶ所: 作品を開く4経路、保存の useEffect、管理単位の切り替え、作品間の移動・コピー。

**作品間の移動・コピー**（ライブラリの中で、管理単位が「作品ごと」のときだけ）

| 操作 | 内部の処理 |
|---|---|
| スレッドの「〜へ移動・コピー」 | インボックスなら何もしない。中の資料の数を数えて行き先を聞く（`requestTransferOptions`）。必要なら資料をコピーしてリンクを書き換える（`prepareReferenceRewrite`）。ID を振り直したスレッドを、行き先の `project.json` の末尾に足す。並び順があれば、行き先の `default.json` を作品ごとの側に合わせてから（`alignIdeaLayoutToMode(…, "workspace")`）並び順を足す。移動なら手元から消す。通知「スレッドを〇〇へ移動しました／コピーしました」 |
| 断片の「〜へ移動・コピー」 | 行き先を聞き、行き先のインボックスの末尾に新しい ID で足す。移動なら手元のスレッドから消す。通知「断片を〇〇のインボックスへ移動しました／コピーしました」 |
| 管理単位が「全作品で共有」のとき | 通知「Idea をプロファイルに保存している間は、作品ごとの移動・コピーはできません」を出して何もしない（`ensureIdeaTransferAvailable`） |
| 失敗したとき | `reportTransferError` で知らせる。移動でも手元には残る |

**新規スレッドの名前を聞く**（`requestNewIdeaThreadName`）: 入力ダイアログ（題「新規スレッドに追加」、ボタン「作成」）。空白だけなら `null`。`moveFragmentToNewThread`・`moveReferenceToNewThread`・Canvas の「新しいスレッドへ送る」が使う。

### 今の挙動の癖（直さないもの。工程9で実機で確かめる）

コードを読んだうえでの見込み。

1. 断片を別の作品へ「移動」すると、行き先では**インボックスの末尾**に入るが、同じ作品の中で足した断片はスレッドの**先頭**に入る。
2. スレッドを別の作品へ「移動」したとき、手元のスレッドに付いていた資料リンクは、並び順の整合処理でインボックスへ移る（前回の手順書の癖2と同じ。削除の取り消しの修正は、移動には及んでいない）。

「移動・コピー」のメニューは、ライブラリの中で作業しているときだけ出る（`transferMenuLabel`、6231。ライブラリの直下なら「作品へ移動・コピー…」、作品の中なら「ライブラリへ移動・コピー…」）。

## 工程3: 依存関係

### A. React に依存しない処理

| 名前 | 読む／呼ぶ | 呼ばれる |
|---|---|---|
| `loadWorkspaceSnippets`（624） | `isTauriRuntime`、`invoke("load_project_snippets")`、`normalizeIdeaThreads`、`defaultIdeaThreads` | E-1〜E-4、C-8、C-7 |
| `saveWorkspaceSnippets`（630） | `isTauriRuntime`、`invoke("save_project_snippets")` | D-3、C-8、C-7 |
| Canvas ボード用5関数（812〜867） | Rust の Canvas の命令 | C-9 だけ |

### B. 値（state）

前回と同じ（前回の手順書 工程3 B）。持つ場所はすべて App。

### C. 操作の関数（今 App にあるもの）

- C-3 スレッドの中の資料（`useCallback` 4つと、資料の処理3つ）。`appState.snippets`・`referenceLayout.ideaThreads`・`referenceCandidates` を依存に持つ。`handleAddReference`・`handleCreateReference` は `addReferencesToIdeaThread` を依存に持つ。
- C-5' `openIdeaBinderCard`（`snippets`、`workspaceRef`・`editorShellRef`、`nextReferenceZIndex`、`clampReferenceCardToStage`）
- C-7 作品間の移動・コピー: `ensureIdeaTransferAvailable`（`settings.snippetStorageMode`、`showToast`）、`transferIdeaThread`（`snippets`、`referenceLayout`、`requestTransferOptions`、`isExistingReference`、`prepareReferenceRewrite`、`threadItemReferencePaths`、`rewriteThreadItems`、`loadWorkspaceSnippets`、`saveWorkspaceSnippets`、`loadReferenceLayout`、`saveReferenceLayout`、`alignIdeaLayoutToMode`、`updateIdeaThreads`、`showToast`、`reportTransferError`）、`transferIdeaFragment`（`snippets`、`requestTransferOptions`、`loadWorkspaceSnippets`、`saveWorkspaceSnippets`、`patchThread`、`showToast`、`reportTransferError`）
- C-8 `handleSnippetStorageModeChange`
- C-9 使われていない処理（工程1）
- `requestNewIdeaThreadName`（`requestInput`）

**呼び出しの順の制約**: `updateIdeaThreads`・`patchThread` は `createIdeaThreadActions({...})`（6988〜7020）の戻り値で、`const` で受けている。C-7 の2関数は 6354〜6436 にあり、中で `updateIdeaThreads`・`patchThread` を使うが、クリックで後から呼ばれるので今は問題ない。ただし、6354 付近で別の `create…Actions({ updateIdeaThreads, … })` を呼ぶ形にすると、まだ作られていない値を読んで壊れる（TDZ）。

### D. 自動で走る処理（useEffect）

| 処理 | 行 | 管理単位に関わるか |
|---|---|---|
| 資料レイアウトの読み込み | 2622〜2650 | 2637 の `alignIdeaLayoutToMode(layout, snippetStorageModeRef.current)` |
| D-1 並び順の整合 | 2733〜2744 | なし |
| D-2 消えた Idea のカードを閉じる | 2746〜2759 | なし |
| D-3 作品の Idea の遅延保存 | 3121〜3131 | 条件 `settings.snippetStorageMode !== "workspace"` で止める |
| E-2 作品の自動検知 | 3169〜3264 | 条件 `settings.snippetStorageMode !== "workspace"` で止める |
| D-6 Canvas への最新一覧の送信 | 6606〜6630 | なし |

### E. 作品を開く経路

工程1の表。どの経路も、`snippets` をほかの値と同じ1回の `setAppState` で入れ、`snippetWorkspacePath` を同じ描画で入れる。

### F. 画面部品への受け渡し

前回と同じ部品へ、同じ名前で渡す。右サイドバーは `RightSidebar` 経由（8088〜8105）、設定は `onSnippetStorageModeChange`（8350）。

### G. App の外とのやり取り

- Rust: `load_project_snippets` / `save_project_snippets`、`load_reference_layout` / `save_reference_layout`、`load_app_state`（C-8）、資料の命令、`open_canvas_window`
- ウィンドウ間: `then-canvas-copy-to-idea`、`then-canvas-focus-idea`（Canvas → App）、`CANVAS_LIVE_DATA_EVENT`（App → Canvas）

### H. App.tsx の文字列を読むテスト

工程1の「気づいた点」。

### 結び目

1. 値と保存の目印（`snippetWorkspacePath`）が、作品を開く5経路の「同じ描画でまとめて入れる」処理に混ざっている（1-1 の Plot と同じ）。
2. 作品間の移動・コピーが、`createIdeaThreadActions` の戻り値（`updateIdeaThreads`・`patchThread`）を使う。移すなら、`createIdeaThreadActions` の中へ入れるしかない（別の `create…Actions` を元の位置で呼ぶと TDZ）。
3. C-3 は `useCallback` で、資料の処理（`handleAddReference` など）がその関数を依存に持つ。外へ出すと、毎回の描画で新しい関数になり、資料の処理まで毎回作り直される。
4. 管理単位の処理が、作品を開く経路・保存の条件・資料レイアウトの読み込み・移動・コピーの中に1〜3行ずつ散っている。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`、`src/ideaThreadActions.ts`、新規 `src/ideaThreadStorage.ts`（5-2。決めてほしいこと D-c しだいで `ideaThreadModel.ts`）、`scripts/test-idea-thread-actions.mjs`（回帰テストを足す）
- 条件しだいで変わる: `scripts/test-idea-reference-binder.mjs`（`requestNewIdeaThreadName` を移すので、`title: "新規スレッドに追加"` を `ideaActions` から確かめる）、`scripts/test-v066-idea-ui.mjs`（D-a で使われていない処理を消すとき）
- 変えない: 画面部品、`storedStateModel.ts`、`ideaReferenceModel.ts`、`types.ts`、Rust、保存形式

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 値・保存の useEffect・作品を開く経路・資料レイアウトの読み込み | 高（データ消失） | 動かすと、前の作品の Idea を次の作品へ書く事故が起こりうる → 今回は動かさない |
| `loadWorkspaceSnippets` / `saveWorkspaceSnippets` の移動 | 中 | 中身は同じ。呼び出し元は名前を変えずに import する |
| 作品間の移動・コピーの移動 | 中 | ほかの作品のファイルへ書く。App の道具を deps で受け取る |
| `requestNewIdeaThreadName` の移動 | 低 | 入力ダイアログを開くだけ。テストの読むファイルが変わる |
| 使われていない処理の削除（D-a） | 低 | どこからも呼ばれていない。型検査で確かめられる。テストの1行が仕様の判断に触れる |

### 4-3. 起こりうる回帰と、既存テストで気づけるか

| 回帰 | 気づけるか |
|---|---|
| 作品の切り替えで Idea が混ざる | 実際に動かしている（`test:save-on-work-switch`） |
| 起動・作品を開くときに並び順が崩れる | 実際に動かしている（`test:startup-idea-order`） |
| 読み込みの正規化が抜ける（空の作品にインボックスが出ない） | `test:save-on-work-switch` が読み込みを通るが、空の場合はなし → 回帰テストを足す |
| 移動・コピーで行き先に入らない／手元から消えない／並び順が付かない | なし → 回帰テストを足す |
| 管理単位が「共有」のときに移動・コピーが通ってしまう | なし → 回帰テストを足す |
| 新規スレッドへの移動で名前を聞かない | `test:idea-actions` は名前を返す入れ物を渡している。入力ダイアログそのものは実機で |

### 4-4. 今の自動テストの状態

「前」の一式（`ff412c4`）: build 成功、本体の JavaScript 707,313 バイト、97本のうち失敗3本。どれも今回とは関係がない。

| テスト | 失敗の中身 |
|---|---|
| `test:editor-selection` | 600秒で時間切れになり、止めた（Edge を使うテスト。止めたあとの残りは 0） |
| `test:editor-text-edits` | 「every icon draws its own picture」（アイコンの数。1-1 の「前」「後」でも同じ理由で落ちている） |
| `test:v058-bundle` | 本体の JavaScript が 500 kB の上限を超えている（元から） |

Idea に関係するテスト（`test:idea-actions`、`test:binder`、`test:v066-idea`、`test:save-on-work-switch`、`test:startup-idea-order`、`test:stored-state-model`、`test:project-portability`、`test:library`）はすべて通った。終わったあとの残り: QA Then 0、QA WebView2 0、テストの Edge 0、テストの node 0。

## 工程5: 案

### 5-1. 方針

1-1（Plot）と同じ線引きにする。

1. **値・保存の useEffect・作品を開く経路・自動で走る処理は App に残す。** 計画書の題は「状態と保存を切り離す」だが、値を移すと作品を開く5経路の「同じ描画でまとめて入れる」形が崩れ、データ消失の危険が高い。保存の処理そのもの（Rust の命令を呼ぶ部分）は移す。Idea は 2-1・2-4 で投稿へ作り直すので、そのときは App に残った値と経路を差し替えることになる。
2. **移すのは引っ越しだけ。** 中身・文言・条件・順番は変えない。
3. **新しいファイルに React の仕組みを持ち込まない。**

### 5-2. 読み書き → `src/ideaThreadStorage.ts`（新規、約15行）

`loadWorkspaceSnippets`、`saveWorkspaceSnippets` をそのまま移す。`isTauriRuntime` はほかの `*Actions.ts` と同じく、ファイルの中に1行で持つ。App は同じ名前で import する。

Plot では読み書きを `plotCardModel.ts` に入れたが、Idea では別のファイルにしたい。`ideaThreadModel.ts` は `storedStateModel.ts` からも読む、React にも Tauri にも依存しない処理のファイルで、そこへ Tauri の命令を持ち込むと、アプリ状態の正規化まで Tauri を引き込むことになるため（決めてほしいこと D-c）。

### 5-3. 操作 → `src/ideaThreadActions.ts`（`createIdeaThreadActions` に足す、約95行）

| 移す処理 | 今の行 | deps に足すもの |
|---|---|---|
| `transferIdeaThread`、`transferIdeaFragment` | 6360〜6436 | `requestTransferOptions`、`isExistingReference`、`prepareReferenceRewrite`、`reportTransferError`、`loadReferenceLayout`、`saveReferenceLayout`、`ensureIdeaTransferAvailable` |
| `requestNewIdeaThreadName` | 6977〜6987 | `requestInput`（今 deps にある `requestNewIdeaThreadName` は外す） |

- `createIdeaThreadActions` の中に入れるのは、結び目2の TDZ を避けるため（`updateIdeaThreads`・`patchThread` を同じ関数の中で使える）。呼び出し位置（6988）は変えない。足す deps はどれも 6354 より前で宣言されているか、部品の外の関数（`loadReferenceLayout` 793、`saveReferenceLayout` 799）。
- `ensureIdeaTransferAvailable` は管理単位にしか関わらないので移さず（5-6）、App に残して deps で渡す。移した2関数の1行目の呼び出しは、そのまま残る。
- `transferIdeaThread` の中の `alignIdeaLayoutToMode(targetLayout, "workspace")` も管理単位の処理だが、移動・コピーの手順の途中の1行なので、そのまま一緒に移す（2-4 で消す候補として 5-6 に書く）。
- `threadItemReferencePaths`・`rewriteThreadItems`・`alignIdeaLayoutToMode` は、移した先で import する。App で使わなくなった import は消す。
- 移した2関数と `requestNewIdeaThreadName` は戻り値に足し、App は今と同じ名前で取り出す。JSX は変えない。

### 5-4. App に残すもの

| 残すもの | 理由 |
|---|---|
| 値（`snippets`、`snippetWorkspacePath`、`isQuickIdeaModalOpen`、`ideaFocusRequest`、`draggingId`、`referenceLayout`） | 5-1 の1。データ消失を避ける |
| 保存の useEffect（D-3）、作品を開く5経路、資料レイアウトの読み込み、D-1・D-2・D-6 | 同上。自動で走る処理の順番を変えない |
| C-3 の `useCallback` 4つ（`addReferencesToIdeaThread`、`moveIdeaReference`、`removeIdeaReference`、`reorderIdeaThreadItem`） | 結び目3。資料の処理が依存に持つ。`test:binder` が App の文字列を確かめている。1-1 でも `useCallback` は残した（決めてほしいこと D-b） |
| C-3 の資料の処理3つ | 資料の処理 |
| `openIdeaBinderCard` | 本文の上に浮かぶカードの処理。本文エディタの位置と資料カードの部品を使う |
| `openIdeaCanvasBoard`、Canvas からの受け取りの登録 | Canvas の処理。`openIdeaCanvasBoard` は `test:project-portability` の目印 |
| 管理単位にしか関わらない処理 | 5-6。2-4 で消す |
| `getEditorView` | 見出しへの移動でも使う |
| JSX | 名前を変えずに渡すので変わらない |

### 5-5. UI 側へ移すもの

なし（props の形を変えないため）。前回の手順書 5-5 の候補（`draggingId` を `IdeaPane` の中で持つ、など）は、2-1 で IdeaPane を作り直すときに扱う。

### 5-6. 管理単位（`snippetStorageMode`）にしか関わらない処理 — 移さず、2-4 で消す候補

今回は移しも消しもしない。2-4（Idea スレッド → 投稿への移行）で、`profileSnippets` を移したあとに消す。消すときに直すテストも書いておく。

| 場所 | 中身 | 2-4 で |
|---|---|---|
| App.tsx 873〜874、1992 | `snippetStorageModeRef`（資料レイアウトを読んだ時点の管理単位） | 消す |
| App.tsx 2637 | 資料レイアウトの読み込みで `alignIdeaLayoutToMode(layout, snippetStorageModeRef.current)` | 読み込んだ値をそのまま使う |
| App.tsx 3122 | 保存の useEffect の条件 `settings.snippetStorageMode !== "workspace"` | 条件から外す |
| App.tsx 3171 | 作品の自動検知の条件と、依存の配列の `settings.snippetStorageMode`（3262） | 同上 |
| App.tsx 2915〜2918、2963〜2965 | 起動時の復元の分かれ道（共有なら `state.snippets` を使い、目印を `null`） | 作品側だけにする |
| App.tsx 4872 | ファイルを開いたときの分かれ道 | 同上 |
| App.tsx 5738〜5741、5767 | 作品の切り替えの分かれ道 | 同上 |
| App.tsx 6354〜6358 | `ensureIdeaTransferAvailable`（と、移した2関数の1行目の呼び出し） | 消す |
| `ideaThreadActions.ts`（移したあと） | `transferIdeaThread` の `alignIdeaLayoutToMode(targetLayout, "workspace")` | 相手の並び順をそのまま使う |
| App.tsx 7506〜7564 | `handleSnippetStorageModeChange`（確認、書き切り、組の入れ替え、`load_app_state` の読み直し） | 消す。**`test:project-portability` が `const handleSnippetStorageModeChange` を目印にしているので、目印を直す** |
| App.tsx 8350〜8351 | 設定画面への `onSnippetStorageModeChange` | 消す |
| `ideaThreadActions.ts` 114〜117 | `updateIdeaThreads` が、共有のときに `profileSnippets` も書く | 消す |
| `ideaReferenceModel.ts` 195〜 | `alignIdeaLayoutToMode` | 消す（`test:idea-actions` の「切り替えて戻すと元どおり」の確認も消す） |
| `storedStateModel.ts` 148、500〜510、657〜670、699 | 設定の既定値と正規化、`profileSnippets` の読み込み、資料レイアウトの `ideaThreadsMode`・`otherIdea` | 移行が読み終えてから消す（`profileSnippets` は移行の入力なので、移行より先に消さない） |
| `types.ts` 158〜164、393、528 | `ideaThreadsMode`、`otherIdea`、`snippetStorageMode`、`profileSnippets` | 消す |
| `FileSettings.tsx` 102〜110、`SettingsModal.tsx` 21 | 設定画面の選択欄 | 消す |
| Rust `ReferenceLayoutConfig` | `ideaThreadsMode`・`otherIdea` を落とさず読み書きする | 古いファイルを読めるように残すか、2-4 で決める |

### 5-7. 決めてほしいこと

**D-a. 使われていない約290行（前回の C-9）**

| 案 | 中身 |
|---|---|
| **A. 今回、別のコミットで消す（推す）** | 7つの処理と、それにしか使われていない `insertParagraph`・`markFragmentUsed`・Canvas ボード用5関数・import を消す。`test:v066-idea` の「並び順を変更しました」の行も消す |
| B. 触らない | App.tsx に残したまま。2-1 で IdeaPane を作り直すときに消す |

A を推す理由: 前回は、消すと「並べ替えに元に戻すがない」ことを認める仕様の判断になるので見送った。今は計画書で、第2段階に IdeaPane を投稿ストリームへ作り直す（2-1）と決まっていて、今の並べ替えに「元に戻す」を付けるかを決める意味がなくなった。消すコードはどこからも呼ばれていないので、画面の動きは変わらない（型検査で確かめる）。1-4 以降で App.tsx を読む量も減る。

**D-b. C-3 の `useCallback` 4つ（スレッドの中の資料）**

| 案 | 中身 |
|---|---|
| **A. 残す（推す）** | 1-1 と同じく、`useCallback` は依存の指定ごと App に残す |
| B. 移す | `ideaThreadActions.ts` へ移し、App 側で `useCallback` に包み直す |

A を推す理由: 資料の追加・作成（`handleAddReference` など）がこの関数を依存に持っていて、包み直しを誤ると、資料の処理が毎回作り直されたり、古い Idea を見続けたりする。中身は並び順（資料レイアウト）を書く処理で、Idea 本体には触れない。2-5 で資料を `素材/` へ移すときに、資料の処理と一緒に扱うほうが安全。

**D-c. 読み書きの置き場所**

| 案 | 中身 |
|---|---|
| **A. 新しい `src/ideaThreadStorage.ts`（推す）** | `ideaThreadModel.ts` は React にも Tauri にも依存しないまま |
| B. `ideaThreadModel.ts` に足す（1-1 の `plotCardModel.ts` と同じ形） | ファイルは増えない。`storedStateModel.ts` が Tauri の命令の読み込みまで引き込む |

A を推す理由は 5-2。

### テストの直し方と足すテスト

- `test:binder`: `title: "新規スレッドに追加"` の確認を、すでに読んでいる `ideaActions`（`ideaThreadActions.ts`）に向ける。正規表現は変えない。ほかの確認（C-3 の文字列）は App に残るのでそのまま。
- `test:v066-idea`: D-a が A なら、「並び順を変更しました」の1行を消す。
- `test:project-portability`: 目印の2つは App に残るので変えない。
- 足す: `scripts/test-idea-thread-actions.mjs` に、`ideaThreadStorage.ts` を束ねて次を実際に動かす確認を足す（`window.__TAURI_INTERNALS__.invoke` の入れ物で、作品ごとの `ideaThreads` と `default.json` を持たせる。見本は `test:plot-card-actions`）。
  - 読み書き: 空なら空のインボックスだけ、あれば正規化して返す。保存は `save_project_snippets` へ渡す
  - スレッドのコピー: 行き先の末尾に新しい ID で足し、断片の ID も振り直す。並び順の断片の ID も同じく書き換え、資料リンクは新しい ID とコピー先のパスになる。行き先の並び順は作品ごとの側に合わせてから足す。手元には残す。通知の文言
  - スレッドの移動: 手元から消す。インボックスは送らない
  - 断片のコピー・移動: 行き先のインボックスの末尾に入る。移動なら手元のスレッドから消える
  - 共有のとき: 行き先を聞かずに通知だけ出す
  - やめたとき・保存に失敗したとき: 手元は変わらない。失敗は `reportTransferError` へ
  - 新規スレッドの名前: 入力ダイアログの題とボタン、空白だけなら `null`

### 進め方とコミットの分け方

1. `ideaThreadStorage.ts` へ読み書きを移す（`move-lines.mjs`、`verify-move.mjs`、型検査、関係するテスト、コミット）
2. 移動・コピーと `requestNewIdeaThreadName` を `ideaThreadActions.ts` へ移す。`test:binder` の読むファイルを直す（同上）
3. D-a が A なら、使われていない処理を消す（型検査、`test:v066-idea` の1行、コミット）
4. 回帰テストを足す（わざと不具合を2つ以上入れて、落ちることを確かめる）
5. 「後」の一式と前後の比較、QA 用アプリでの実機確認

### 見込みと、今回やらないこと

- App.tsx は約110行減る（読み書き 約10行、移動・コピー 約80行、名前を聞く処理 約11行。呼び出しのために数行増える）。D-a が A なら、さらに約290行減って約7,990行になる。
- やらない: 値・保存・作品を開く経路の移動、C-3 の `useCallback`（D-b）、`openIdeaBinderCard`、管理単位の処理の削除（2-4）、工程2の癖を直すこと。

## 工程6: 人の確認

（確認1の答えを書く）
