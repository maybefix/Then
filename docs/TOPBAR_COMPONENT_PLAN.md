# 上部の帯の部品化の手順書

App.tsx の中に直接書かれている上部の帯（ファイルメニュー、パンくず、右のアイコンと画面モード）の JSX を、`src/components/layout/` の部品に移す。`docs/TITLEBAR_CONTRAST_FIX_PLAN.md` の工程5の 3-b で「必ず提案する」と決めた作業。仕様・保存形式・UI・文言・CSS・Rust は変えない。

- ブランチ: `refactor/topbar-component`
- 戻し先: タグ `checkpoint/before-topbar-component`（コミット `aca842c`。中身は main `9fdfde6` と同じ）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済 |
| 2 | 仕組みの説明 | 済 |
| 3 | 依存関係 | 済 |
| 4 | 影響範囲 | 済 |
| 5 | 案 | 済 |
| 6 | 人の確認（確認1） | 済 |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

### コードがある場所（`aca842c` の時点）

| もの | 行 | 行数 | 中身 |
|---|---|---|---|
| 帯の外枠 | 9800、10586 | 2 | `<header className="topbar" data-tauri-drag-region="deep">` と `</header>` |
| ファイルメニュー | 9801〜9878 | 78 | 「≡」のボタンと、新規ファイル・ファイルを開く・保存・別名で保存・テンプレートとして登録・原稿を整える・エクスポート・フォルダを開く |
| 左サイドバーを表示するボタン | 9879〜9891 | 13 | 左サイドバーを畳んでいるときだけ出る |
| パンくず | 9892〜10442 | 551 | ライブラリ名、作品の切り替えメニュー、フォルダごとのメニュー（並べ替え・名前の変更・削除・新規作成・ドラッグ）、作品のないときの切り替えメニュー、ファイル名、見出しのパンくずとアウトラインのメニュー |
| 右のアイコンと画面モード | 10443〜10585 | 143 | 集中モード、右サイドバーを表示、保存点を作る、縦書き・横書き、テーマ、設定、画面モードのメニュー |
| パンくずの描画関数 | 9584〜9638、9640〜9703 | 55＋64 | `renderWorkspaceFolderTree`（作品の切り替えメニューの中のフォルダの木）、`renderBreadcrumbOverflow`（パンくずを省いたときの「…」メニュー）。どちらも帯の中からしか呼ばれない |

帯は 787行。描画関数を含めると 906行。

### 気づいた点

1. **帯の中にフック（useState・useEffect など）は1つもない。** 値と開閉の状態はすべて App の state で、帯は読むだけ。部品は「受け取って描くだけ」の関数にできる。
2. **App が帯の要素を ref で直接見ている。** `fileMenuRef`・`modeMenuRef`・`breadcrumbMenuRef`（外側をクリックしたら閉じる処理、4608〜4650行）、`breadcrumbMenuRef`（帯の幅を測ってパンくずの省き方を決める処理、3824〜3849行。`[startupView]` で付け直す）、`modeMenuButtonRef`（画面モードを選んだ後にボタンへフォーカスを戻す、7246行）。ref は App に残し、部品には ref の入れ物を props で渡す。
3. **App.tsx の文字列を読むテストのうち、帯に関わるのは2本。** `text-deps.mjs src/App.tsx` で、App.tsx を読む全部の確かめ（194行）を見た。
   - `test:v065-shell`: `className="topbar" data-tauri-drag-region="deep"` が App.tsx にあること。
   - `test:document-tabs`: App.tsx の中で `<header className="topbar"` から `</header>` までを帯とみなし、その直後に `<DocumentTabs` があること（タブの帯が上部の帯の真下にあること）。
   - ほかの確かめ（`data-shell-app-mode={appMode}`、`className="appFrame"`、`pluginModeSwitcherIcon` など）は、帯の外にあって動かさない。「App.tsx にないこと」を確かめるもの（`doesNotMatch`）で、帯を移すと素通りになるものはない。
4. **画面モードのメニューの中身（`modeMenuEntries`、7162〜7228行）は帯の外で作っている。** アイコンの要素と、選んだときの処理を持つ一覧。App に残して、一覧ごと渡す。
5. 前例: 左サイドバーの部品化（`docs/LEFT_SIDEBAR_SEPARATION_PLAN.md`）。JSX を `LeftSidebar` へ移し、App の値を約78個 props にした。テストは、部品を関数として呼んで、返ってきた要素の木をたどって確かめた（`test:left-sidebar`）。

「前」のテスト一式（`aca842c`）: 83本のうち3本が元から失敗。`test:canvas-save`、`test:v058-bundle`（最大の JS 703,030 バイト）、`test:v0511-themes`。前回の修正（`docs/TITLEBAR_CONTRAST_FIX_PLAN.md`）と同じ3本で、今回の範囲と関係しない。

## 工程2: 仕組みの説明

### 言葉

- **部品（コンポーネント）**: React の画面の部品。親から受け取る値を **props** という。
- **ref**: 画面の要素そのものを、後から JavaScript で触るための入れ物。App が「この要素の外をクリックしたか」「この要素の幅はいくつか」を調べるのに使う。
- **パンくず**: 帯の中ほどの「ライブラリ › 作品 › フォルダ › ファイル / 見出し」の並び。
- **省き方（`breadcrumbLayout`）**: 帯の幅が狭いとき、パンくずの途中を「…」にまとめる。`full`（全部）・`compact`（先頭の後ろを「…」）・`minimal`（ほぼ全部「…」）。

### 1. データの形

帯が持つ値はない。読む値はすべて App の state か、App が描画のたびに計算する値。

| 種類 | 例 | 数 |
|---|---|---|
| 値 | `appMode`、`projectFolder`、`breadcrumbTrail`、`isFileMenuOpen`、`settings` | 31 |
| ref | `fileMenuRef`、`breadcrumbMenuRef`、`modeMenuRef`、`modeMenuButtonRef` | 4 |
| state を書く関数 | `setIsFileMenuOpen`、`setActiveBreadcrumbPath`、`setIsSettingsModalOpen` | 13 |
| App の操作 | `handleNewDocument`、`handleRenameProjectEntry`、`openWorkspace`、`updateSettings` | 32 |

### 2. 利用者の操作と内部の処理

| 操作 | 内部 |
|---|---|
| 「≡」を押す | `isFileMenuOpen` を反転。メニューの項目は `closeFileMenuAndRun` でメニューを閉じてから各操作を呼ぶ |
| 作品名を押す | 作品の切り替えメニューを開く（`isWorkspaceSwitcherOpen`）。検索欄は `workspaceSwitcherQuery` |
| フォルダ名を押す・右クリック | そのフォルダのメニューを開く（`activeBreadcrumbPath`、中で辿った先は `breadcrumbBrowsePath`） |
| フォルダのメニューで ↑↓・✎・× | `handleMoveProjectEntry`・`handleRenameProjectEntry`・`handleDeleteProjectEntry` |
| フォルダのメニューの行をドラッグ | `handleBreadcrumbEntryDragStart`／`Over`／`Drop`／`End`。落とす位置の印は `breadcrumbDropTarget` |
| 「…」を押す | 省いたパンくずのメニュー（`isBreadcrumbOverflowOpen`） |
| 見出しのパンくずを押す | アウトラインのメニュー（`isOutlineMenuOpen`）。項目を押すと `jumpToOutlineItem` |
| パンくずの中で ↑↓・Home・End・Escape | `handleBreadcrumbKeyDown`（開いているメニューの項目を移動する、閉じる） |
| 右のアイコン | 集中モード `toggleEditorFocusMode`、右サイドバー `setIsRightSidebarCollapsed(false)`、保存点 `handleQuickCreateManuscriptSnapshot`、縦横 `updateSettings("writingMode", …)`、テーマ・設定の画面を開く |
| 画面モードのボタン | メニューを開く。開くと今のモードにフォーカスが移る（App の useEffect が `modeMenuRef` の中を探す）。項目を選ぶと閉じ、ボタンにフォーカスを戻してから切り替える |
| 帯の外をクリック・Escape | App の useEffect（4608〜4650行）が、ref の外なら各メニューを閉じる |

### 3. 保存

帯が保存するものはない。縦書き・横書きは `updateSettings` を通して設定に保存される（今回変えない）。

### 4. ほかの機能との関係

- 帯の幅の測り方（3824〜3849行）は、`breadcrumbMenuRef` の要素の幅を見る。起動画面から作品の画面に替わったとき（`startupView`）に付け直す。
- タブの帯（`DocumentTabs`）は、上部の帯の真下に置く（`test:document-tabs`）。
- 帯の色（`--topbar-*`）とウィンドウ操作ボタンの余白は CSS。今回は触らない。

### 5. 今の挙動の癖（工程9で実機で確かめる）

1. **アウトラインのメニューが、帯の外をクリックしても閉じない（見込み）。** 外側のクリックと Escape で閉じる処理（4608〜4650行）は、ファイルメニュー・画面モード・フォルダ・作品の切り替え・「…」のメニューを閉じるが、`setIsOutlineMenuOpen(false)` がない。閉じるのは、見出しのパンくずをもう一度押す、項目を選ぶ、パンくずの中にフォーカスがあるときの Escape、「…」を押す、本文で右クリックするとき。
2. **見出しのパンくずが複数並ぶとき（帯が広いとき）、どの見出しを押しても、メニューは一番下の見出しの下に開く（見込み）。** `isOutlineMenuOpen && index === activeOutlineChain.length - 1`（10410行）。メニューの中身は、どれを押しても同じ全部の見出しの一覧。

## 工程3: 依存関係

### A. React に依存しない処理

帯の中で使う部品の外の関数: `getBreadcrumbFolderNavigation`・`isBreadcrumbTrailItemVisible`・`isOutlineBreadcrumbItemVisible`（`src/utils/breadcrumbLayout.ts` など）、`scopeDisplayName`、`getVisibleWorkspaceFolderTreeRows`・`isSamePath`（描画関数の中）。部品のファイルから直接 import する。

### B. 値（state と ref）。すべて App に残す

| まとまり | 読む値 | ref | 書く関数 |
|---|---|---|---|
| ファイルメニュー | `appMode`、`isEditorFocusMode`、`isFileMenuOpen` | `fileMenuRef` | `setIsFileMenuOpen` |
| パンくず | `activeBreadcrumbPath`、`activeOutlineChain`、`breadcrumbBrowsePath`、`breadcrumbDropTarget`、`breadcrumbLayout`、`breadcrumbOverflowItems`、`breadcrumbTrail`、`currentFileName`、`currentFilePath`、`draggingBreadcrumbEntryPath`、`filteredOutlineItems`、`hasActiveOutlineBreadcrumb`、`isOutlineMenuOpen`、`isWorkspaceSwitcherOpen`、`libraryContext`、`outlineItems`、`outlineQuery`、`projectFolder`、`scratchWorkspaceName`、`settings`（`showWorkspacePaths`）、`visibleKnownLibraries`、`visibleRecentWorkspaces`、`workspaceSwitcherQuery` | `breadcrumbMenuRef` | `setActiveBreadcrumbPath`、`setBreadcrumbBrowsePath`、`setIsOutlineMenuOpen`、`setIsWorkspaceSwitcherOpen`、`setOutlineQuery`、`setWorkspaceSwitcherQuery` |
| 描画関数2つ（移すなら追加） | `isBreadcrumbOverflowOpen`、`collapsedWorkspaceFolderPaths`、`focusedFolderPath` | — | `setIsBreadcrumbOverflowOpen` |
| 右のアイコンと画面モード | `appMode`、`isEditorFocusMode`、`isModeMenuOpen`、`isRightSidebarCollapsed`、`projectFolder`、`settings`（`focusModeUsesNativeFullscreen`・`writingMode`）、`activeModeMenuEntry`、`modeMenuEntries` | `modeMenuRef`、`modeMenuButtonRef` | `setIsModeMenuOpen`、`setIsRightSidebarCollapsed`、`setIsSettingsModalOpen`、`setIsThemePickerModalOpen`、`setShouldReturnToSettingsAfterThemePicker` |

### C. 操作の関数（App に残し、props で渡す）

- C-1 ファイルメニュー: `closeFileMenuAndRun`、`handleNewDocument`、`handleOpenTextFile`、`saveCurrentDocument`、`handleSaveAs`、`handleRegisterCurrentFileAsTemplate`、`openManuscriptTidy`、`getCurrentEditorSelection`、`handleOpenLinkedExport`、`handleOpenProjectFolder`
- C-2 パンくずの移動: `closeBreadcrumbMenuAndRun`、`enterLibraryRoot`、`handleBreadcrumbFolderSelect`、`handleBreadcrumbKeyDown`、`handleProjectFileSelect`、`openWorkspace`、`jumpToOutlineItem`
- C-3 フォルダのメニューの操作: `handleMoveProjectEntry`、`handleRenameProjectEntry`、`handleDeleteProjectEntry`、`handleCreateProjectFile`、`handleCreateProjectFolder`、`handleBreadcrumbEntryDragStart`／`DragOver`／`Drop`／`DragEnd`
- C-4 描画関数の中（移すなら追加）: `toggleWorkspaceFolderCollapse`、`handleWorkspaceFolderTreeSelect`
- C-5 右のアイコン: `toggleEditorFocusMode`、`handleQuickCreateManuscriptSnapshot`、`updateSettings`、`handleModeMenuKeyDown`

### D. 自動で走る処理（useEffect）。すべて App に残す

- 帯の幅を測る（3824〜3849行、`useLayoutEffect`、`[startupView]`）
- 「…」に省くものがなくなったら「…」のメニューを閉じる（3851行〜）
- 画面モードのメニューを開いたらフォーカスを移す（4598〜4606行）
- 外側のクリックと Escape でメニューを閉じる（4608〜4650行、`[]`）

### E. 作品を開く経路

帯は関わらない（作品の切り替えメニューは `openWorkspace` を呼ぶだけ）。

### F. 画面部品への受け渡し（JSX）

帯の中で使う部品は `AppIcon` と `Fragment` だけ。画面モードのアイコン（`PluginIcon` を含む）は `modeMenuEntries` の中で App が作る。

### G. App の外とのやり取り

帯の中にはない。`data-tauri-drag-region="deep"`（帯をつかんでウィンドウを動かす印）は外枠の `<header>` にある。

### H. App.tsx の文字列を読むテスト

工程1の気づいた点の3のとおり（`test:v065-shell`、`test:document-tabs`）。

### 結び目

1. 受け渡す値と関数が約80個。つなぎ間違い（たとえば「名前の変更」に削除の関数をつなぐ）は、`verify-move` では見つからない。
2. ref を4つ、App と帯の部品で共有する。
3. テスト2本が、App.tsx の中の `<header className="topbar"` を目印にしている。
4. パンくずの描画関数2つが App の本体に別にある。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`、新しい部品のファイル（案による。1〜3つ）、`package.json`（テストを足す）、新しいテスト `scripts/test-topbar-parts.mjs`
- 条件しだいで変わる: 分け方の案 B なら `scripts/test-v065-native-shell.mjs`・`scripts/test-document-tabs.mjs`（読むファイルと目印）。癖を直すなら `src/App.tsx` の外側のクリックの処理
- 変えない: CSS、文言、保存形式、Rust、`WindowControls.tsx`、`DocumentTabs`

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| フォルダのメニューの操作（C-3） | 中 | つなぎ間違いは、そのまま違うファイル操作（削除・名前の変更・並べ替え）になる |
| ref の受け渡し | 中 | 落とすと、外側のクリックでメニューが閉じない、帯の幅を測れずパンくずが省かれない、画面モードを選んだ後にフォーカスが迷子になる |
| 描画関数を移す場合 | 中 | 「…」のメニューと作品の切り替えメニューの中のフォルダの木 |
| ファイルメニュー・右のアイコン | 低〜中 | つなぎ間違いは違う画面が開く程度。保存は `saveCurrentDocument` を呼ぶだけ |
| DOM の形 | 低 | 部品は今と同じ要素を1つ返す（`div.fileMenu`、`nav.breadcrumbs`、`div.topbarActions`）ので、CSS の当たり方は変わらない |

データに触れる処理（保存、作品を開く経路、state の置き場所）は動かさないので、「高」はない。

### 4-3. 機能ごとに起こりうる回帰不具合

| 回帰 | 今のテスト |
|---|---|
| フォルダのメニューの操作の取り違え | なし |
| ファイルメニューの項目の取り違え | なし |
| 外側のクリックでメニューが閉じない（ref の落とし） | なし |
| 帯の幅の測り直しが効かない | 文字列だけ（`test:breadcrumb` が `[startupView]` を確かめる） |
| タブの帯の位置 | 文字列だけ（`test:document-tabs`） |
| パンくずの省き方の計算 | 実際に動かしている（`test:breadcrumb` が `breadcrumbLayout.ts` を動かす。今回は動かさない） |

### 4-4. 今の自動テストの状態

工程1の末尾のとおり（83本中3本が元から失敗）。

## 工程5: 案

### 5-1. 方針（左サイドバーの部品化と同じ線引き）

- 値・ref・useEffect・操作の関数は、すべて App に残す。
- 移すのは JSX の引っ越しだけ。中身・文言・条件・順番・字下げの不揃いは変えない。違うのは、App の値を直接見ていた所を props から受け取ることだけ。
- props の名前は App の変数の名前と同じにし、部品の先頭で `const { … } = props;` と受け取る。こうすると移す JSX は1文字も変わらず、`verify-move` で突き合わせられる。
- 部品にフックを持ち込まない（今も帯の中にフックはない）。`memo` もしない（描画の回数を今と同じにする）。
- ref は、`fileMenuRef` などの名前の props で ref の入れ物を渡し、部品の中で今と同じ `ref={fileMenuRef}` に付ける（React 18 では `ref` という名前の props は使えないため、名前はそのまま）。

### 5-2. 分け方の選択肢

| 案 | 中身 | よい点 | 気になる点 |
|---|---|---|---|
| A. 帯の中身を3つの部品に分け、外枠の `<header>` と左サイドバーのボタン（13行）は App に残す | `TopbarFileMenu`（props 15）、`TopbarBreadcrumbs`（props 48。描画関数も移すなら 52）、`TopbarActions`（props 19） | 既存のテストを1本も変えずに済む（`<header className="topbar"` が App に残る）。部品ごとに受け取る値が分かれていて、重なりは `appMode`・`isEditorFocusMode`・`projectFolder`・`settings` だけ。パンくずだけを後で直すときに、ほかを読まずに済む | App の帯の部分は、外枠と3つの部品への受け渡しで約110行残る |
| B. 帯全体を1つの部品 `Topbar` にする | 外枠の `<header>` と左サイドバーのボタンも移す。props 約84 | App の帯の部分が `<Topbar … />` の約90行だけになる。左サイドバーの部品化と同じ形 | テスト2本を直す。`test:v065-shell` は読むファイルを変えるだけだが、`test:document-tabs` は目印を `<header className="topbar"` から `<Topbar` に変えることになり、確かめる中身の書き換えになる。1つの部品が約900行になる |

App.tsx の行数の見込み（描画関数も移す場合）: 11,393行 → 約10,500行（−約800行）。案 A と B の差は20行ほど。

### 5-3. 描画関数2つの扱い

- 移す: `renderWorkspaceFolderTree` と `renderBreadcrumbOverflow`（計120行）をパンくずの部品の中へ移す。帯の中でしか使わない。props は差し引き4つ増える（`isBreadcrumbOverflowOpen`、`setIsBreadcrumbOverflowOpen`、`collapsedWorkspaceFolderPaths`、`focusedFolderPath`、`toggleWorkspaceFolderCollapse`、`handleWorkspaceFolderTreeSelect` が増え、関数2つが減る）。
- 残す: App に置いたまま、関数ごと props で渡す。移す行は減るが、パンくずの中身の一部が App に残る。

### 決めてほしいこと

1. **分け方**: A（3つの部品、テストを変えない）／ B（1つの部品、テスト2本を直す）。勧めは **A**。テストを変えずに済むことと、受け取る値が3つでほとんど重ならないため。
2. **描画関数2つ**: 移す／残す。勧めは **移す**。帯の中でしか使わず、パンくずの中身が1か所にまとまるため。
3. **癖1（アウトラインのメニューが外側のクリックで閉じない。見込み）**: 一緒に直す／別に直す／記録のみ。勧めは **一緒に直す**。まず実機で再現し、今は失敗するテストを書いてから、外側のクリックと Escape の処理（4608〜4650行）に `setIsOutlineMenuOpen(false)` を足す。分離のコミットとは分ける。
4. **癖2（見出しのパンくずのどれを押しても、メニューが一番下の見出しの下に開く。見込み）**: 直す／記録のみ。勧めは **記録のみ**。メニューの中身はどれを押しても同じ一覧で、押した位置の下に出すかは見た目の判断になるため。

### テストの直し方と足すテスト

- 足す: `test:topbar-parts`（`scripts/test-topbar-parts.mjs`）。`test:left-sidebar` と同じ形。部品はフックを使わないので、関数として呼び、返ってきた要素の木をたどる。App の値は名前ごとに違う目印にし、App の関数は呼ばれた名前と引数を記録する入れ物にする。
  - **つなぎの確認**: 木の中の `onClick`・`onChange`・`onKeyDown`・`onContextMenu`・`onDrag*` をすべて見本の引数で呼び、決めた App の関数が決めた引数で呼ばれること（ファイルメニュー8項目、フォルダのメニューの ↑↓✎× と新規作成とドラッグ、作品の切り替え、右のアイコン、画面モードの選択）。
  - **ref**: 4つの ref の入れ物が、決めた要素（`div.fileMenu`、`nav.breadcrumbs`、`div.modeMenu`、`button.modeMenuButton`）の `ref` に届くこと。
  - **描画の確認**: メニューが開いている印のときだけ出ること、作品のあるとき・ないとき、ライブラリの中の作品のとき、省き方 `full`／`compact`／`minimal` での「…」の位置、集中モードでの `aria-hidden` と `inert`、書く画面以外で出ないボタン。
- 効くことの確かめ: 移した部品にわざと取り違えを2つ入れて（たとえば ✎ に削除の関数をつなぐ、`ref` を外す）落ちることを見て、`git checkout` で戻す。
- 既存のテストは変えない（案 A の場合）。
- 癖1を直すなら、外側のクリックの処理は App に残るので、`test:topbar-parts` ではなく、実機（QA 用アプリ）と、App.tsx の処理を切り出して動かす小さなテストで確かめる（詳しくは確認1の後に書く）。

### 進め方とコミットの分け方

1. 右のアイコンと画面モードを `TopbarActions.tsx` へ（`move-lines` → `verify-move` → `tsc` → 関係するテスト）→ コミット
2. ファイルメニューを `TopbarFileMenu.tsx` へ → コミット
3. パンくず（と描画関数2つ）を `TopbarBreadcrumbs.tsx` へ → コミット
4. `test:topbar-parts` を足し、効くことを確かめる → コミット
5. （癖1を直すなら）失敗するテスト → 直す → コミット
6. 「後」の一式、QA 用アプリでの実機確認、手順書と KNOWN_ISSUES の更新 → コミット

### 見込みと、今回やらないこと

- 見込み: 画面・操作・保存は何も変わらない。いちばん大きい JavaScript は、props の名前が圧縮で縮まない分だけ増える（左サイドバーのときは +4.0 kB）。`test:v058-bundle` は元から上限を超えていて失敗する。
- やらないこと: state や useEffect を部品へ移すこと、`modeMenuEntries` を移すこと、似た JSX（作品のあるとき・ないときの切り替えメニュー）をまとめること、`memo` での描画の削減、CSS と文言の変更、起動画面の帯（`StartupPortal`）。

## 工程6: 人の確認

2026-10-25 に決まったこと。

- 分け方: 案 A（帯の中身を3つの部品に分け、外枠の `<header>` と左サイドバーのボタンは App に残す）。B との差は App の行数で約20行（A は約10,590行、B は約10,570行の見込み）と伝えたうえで決まった。
- 描画関数2つ: パンくずの部品へ移す。
- 癖1（アウトラインのメニューが外側のクリックで閉じない）: 一緒に直す。分離とは別のコミット。
- 癖2（見出しのパンくずのどれを押しても、メニューが一番下の見出しの下に開く）: 直す。押した見出しの下にメニューを開く。分離とは別のコミット。
- どちらの癖も、先に実機で再現し、今は失敗するテストを書いてから直す。
