済 |済 |済 |済 |# 上部の帯の部品化の手順書

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
| 7 | 実施 | 済 |
| 8 | 自動テスト | 済 |
| 9 | 実機確認 | 済 |
| 10 | 完了（確認2） | 済 |

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

## 工程7: 実施

| コミット | 中身 |
|---|---|
| `b95c929` | 右のアイコンと画面モードを `TopbarActions.tsx` へ（props 19） |
| `57b5f5d` | ファイルメニューを `TopbarFileMenu.tsx` へ（props 15） |
| `0b9b966` | パンくずと描画関数2つを `TopbarBreadcrumbs.tsx` へ（props 53）。App で使わなくなった import（`Fragment`、`isOutlineBreadcrumbItemVisible`、`getBreadcrumbFolderNavigation`、`getVisibleWorkspaceFolderTreeRows`）を外す |
| `8293d18` | `test:topbar-parts` を足す |
| `8b09b60` | 癖1・癖2の期待をテストに書く（今は失敗する） |
| `c67f68b` | 癖2を直す |
| `01b764e` | 癖1を直す |

- App.tsx は 11,393行 → 10,535行（分離の後。−858行）→ 10,537行（癖1の修正で +2）。部品は `TopbarActions.tsx` 193行、`TopbarFileMenu.tsx` 113行、`TopbarBreadcrumbs.tsx` 784行。
- App から部品へは、左サイドバーの部品と同じ `{...{ appMode, isEditorFocusMode, … }}` の形で、1行に名前を詰めて渡した。このため App に残った帯の部分は約55行で、確認1で伝えた見込み（案 A で約107行、App は約10,590行）より少ない。案 B との差（約20行）は変わらない。
- 元と同じであることの確かめ方: `move-lines.mjs` で行番号と先頭・末尾の行を確かめて移し、`verify-move.mjs` で突き合わせた。lost は3回とも0（パンくずだけ、App から外した `Fragment,` の import の1行が出る。部品の側では1行の import にまとめたため）。added は import と部品への受け渡しの行だけ。
- 移す途中で1つ足した: パンくずの中で使う `scratchWorkspaceName`（「一時ファイル」）は App のファイルの先頭にある定数で、移した JSX から見えなくなったため、props で渡した（工程2の1では値に数えていた）。
- 違う点（意図したもの）: 癖2の修正で、App の `isOutlineMenuOpen`（真偽値）を `openOutlineMenuId`（開いている見出しの id か null）に置き換えた。閉じる所（パンくずの中の Escape、本文の右クリック、見出しへの移動、「…」を押す）は `setOpenOutlineMenuId(null)` にした。見出しのパンくずを押すと、その見出しの id を入れる（同じ見出しなら閉じる）。メニューはその見出しの下に開き、`aria-expanded` はその見出しだけが true になる。癖1の修正で、App の外側のクリック（パンくずの外）と Escape の処理に `setOpenOutlineMenuId(null)` を足した。

## 工程8: 自動テスト

### 足したテスト

- `test:topbar-parts`（`scripts/test-topbar-parts.mjs`）: `test:left-sidebar` と同じ形。3つの部品を関数として呼び、返ってきた要素の木をたどる。App の値は名前ごとに違う目印、App の関数は呼ばれた名前と引数を記録する入れ物にする。
  - ファイルメニュー: 8項目の並び、各項目が `closeFileMenuAndRun` に決めた関数を渡すこと、「原稿を整える…」が選択範囲を取ってから `openManuscriptTidy` を呼ぶこと、書く画面以外で押せないこと、集中モードの `aria-hidden`・`inert`、`fileMenuRef` が `div.fileMenu` に届くこと。
  - 右のアイコン: 画面モードごとに出るボタン、集中モード・右サイドバー・保存点・縦横・テーマ・設定のつなぎ、画面モードのボタンの矢印キー、項目を選ぶと閉じてボタンにフォーカスを戻してから切り替えること、`modeMenuRef`・`modeMenuButtonRef` が届くこと。
  - パンくず: ライブラリ名、作品の切り替え（検索、フォルダの木の開閉と選択、最近の作品、別のフォルダを開く）、フォルダのメニュー（↑↓✎×、新規作成、ドラッグの4つ、辿った先と戻る）、作品のないとき、見出しのパンくずとアウトラインのメニュー、省き方ごとの「…」の位置と中身、`breadcrumbMenuRef` が `nav` に届くこと。
  - 3つの部品とも、関数の props がすべて何かにつながっていること。
  - App の外側のクリックと Escape の処理（App.tsx から切り出して動かす）: パンくずの中のクリックではパンくずのメニューを閉じず、外のクリックと Escape では、ファイルメニュー・画面モード・作品の切り替え・アウトラインのメニューを閉じること。

### テストが効くことの確かめ方

わざと不具合を入れて落ちることを見てから、`git checkout` で戻した。

| 入れた不具合 | 結果 |
|---|---|
| フォルダのメニューの ✎ に削除の関数をつなぐ | 「リネーム (deferred) must call handleRenameProjectEntry」で落ちた |
| 画面モードの `ref={modeMenuRef}` を外す | 「the mode menu must hand its element to App's ref」で落ちた |
| ファイルメニューの「保存」に別名で保存をつなぐ | 「保存 must run saveCurrentDocument」で落ちた |
| 癖1の修正（外側のクリック）を戻す | 「a click outside the breadcrumbs must close the outline menu」で落ちた |
| 癖2の修正（押した見出しの下）を戻す | 「the outline menu opens under h-1」で落ちた |

### 前後の比較（`aca842c` → `01b764e`）

| | 本数 |
|---|---|
| 前後とも通る | 80 |
| 前後とも落ちる（元から。理由も同じ） | 3（`test:canvas-save`、`test:v058-bundle`、`test:v0511-themes`） |
| 後だけにある（通る） | 1（`test:topbar-parts`） |
| 新しく落ちた | 0 |

最大の JS は 703,030 → 707,303 バイト（+4.3 kB）。props を名前で受け取るので、名前が圧縮で縮まない分が増えた（左サイドバーの部品化のときは +4.0 kB）。残ったプロセスは0。

## 工程9: 実機確認

### やり方

QA 用アプリ（識別子 `local.then.qa.topbar1025`）を、一時ライブラリ（QAライブラリ。作品A に「第一部／一章.md・二章.md・資料／人物.md」と「メモ.md」、作品B に「本文.md」。一章.md は見出しが3段）で動かした。1回目は、分離が済んで癖を直す前の `8293d18` から build し、癖の再現と分離の確認をした。2回目は、癖を直した後に build し直して確かめる。

### 1回目（`8293d18`）: 確認した項目と結果

| 確認したこと | 結果 |
|---|---|
| 帯の形 | 帯の子は `div.fileMenu`・`nav.breadcrumbs`・`div.topbarActions` の3つで、分離の前と同じ。パンくずは「QAライブラリ› / 作品A / ›第一部 / ›一章.md / 第一章」 |
| ファイルメニュー | 8項目が並ぶ。「保存」で「『二章.md』を保存しました」。「原稿を整える…」でダイアログが開く。帯の外を本物のマウスで押すと閉じた |
| 画面モード | 開くと今のモード「本文」にフォーカスが移り、↓で「キャンバス」へ。キャンバスを選ぶとメニューが閉じ、ボタンにフォーカスが戻り、「画面モード：キャンバス」になった。キャンバスでは集中モードのボタンが隠れた |
| 右のアイコン | 縦横の切り替え（`data-writing-mode` が変わり、ボタンが強調される）、テーマを選択・設定の画面、集中モード（帯の左右が `aria-hidden` と `inert`、Escape で戻る）、保存点（「保存点『2026/10/25 07:07』を作りました」） |
| 左右のサイドバーを畳む | 帯に「左サイドバーを表示」「右サイドバーを表示」が出て、押すと戻った |
| 作品の切り替え | 「現在のプロジェクト」「最近開いたプロジェクト」。フォルダの木で第一部を展開し、二章.md を押すと開いてメニューが閉じた。検索欄に「作品B」と入れると作品B だけになった。作品B へ切り替えて作品A へ戻れた |
| フォルダのメニュー | 「資料・一章.md・二章.md」。↓↑で並べ替え、端のボタンは押せない。✎・×・新規ファイル・新規フォルダで、それぞれ「二章.md」などを対象にしたダイアログが開いた（キャンセル）。ドラッグで二章.md を一章.md の前へ移せた（↓で戻した）。資料を押すと中へ辿り（「人物.md」）、「第一部 に戻る」で戻った。↓キーで次の項目へ、Escape で閉じた。帯の外の本物のクリックで閉じた |
| 帯の幅 | 画面の幅を 880px にすると `compact`、640px で `minimal` になり「…」が出た。「…」の「第一部」を押すと「『第一部』へ移動しました」 |

### 今の挙動の癖を実機で確かめた結果（1回目、直す前）

1. 癖1: アウトラインのメニューを開いたまま本文を本物のマウスでクリックしても、本文にフォーカスがある状態で Escape を押しても、開いたままだった（再現した）。
2. 癖2: 見出しのパンくず「第一章」（左端 360px）を押すと、メニューは「場面一」（426px）の下に開き、`aria-expanded` は2つとも true だった（再現した）。

### 2回目（`01b764e`、癖を直した後）: 確認した項目と結果

| 確認したこと | 結果 |
|---|---|
| 癖2: 押した見出しの下に開く | 「第一章」（左端 360px）を押すと、メニューは 360px の「第一章」の下に開き、`aria-expanded` は「第一章」だけが true。続けて「場面一」を押すと「場面一」の下へ移り、もう一度押すと閉じた |
| 癖1: 帯の外のクリックと Escape で閉じる | 本文を本物のマウスでクリックすると閉じた。本文にフォーカスがある状態の Escape でも閉じた |
| メニューの中のクリック | 検索欄を本物のマウスで押しても開いたまま。「場面」と入れると「場面一・場面二・小場面」に絞られた |
| 閉じる操作（今までどおり） | 見出しへ移動すると閉じた（パンくずが「第一章 › 場面二」に変わる）。メニューの中の Escape、幅 640px での「…」、本文の右クリックで閉じた |
| ほかのメニュー（今までどおり） | フォルダのメニューは本物のクリックで開き、帯の外のクリックで閉じた。「…」のメニューも帯の外のクリックで閉じた |

### 確かめられなかったこと

- 起動画面から作品の画面に替わったときの帯の幅の測り直しを、狭い幅のまま起動して確かめること。今回は作品の画面で幅を狭めて、ResizeObserver が反応することを確かめた（エディタが出た後に付けた観察が働いているので、`[startupView]` での付け直しも効いている）。
- ファイルメニューの「ファイルを開く」「別名で保存」「エクスポート…」「フォルダを開く」と、作品の切り替えの「別のフォルダを開く...」: OS のダイアログやエクスプローラーが開くため押していない。つなぎは `test:topbar-parts` で確かめた。
- q.mjs の Enter はボタンの押下にならなかったので、画面モードの項目は Enter ではなく押して選んだ（矢印キーでの移動は確かめた）。

### 片付け

`qa-cleanup.mjs` で、QA の Then・WebView2・テストの node と Edge、テストのプロファイルが0、`%APPDATA%local.then.qa.topbar1025`・`%LOCALAPPDATA%local.then.qa.topbar1025`・一時ライブラリを消した。ふだん用の build（`src-tauri/target/release/Then.exe`）は QA 用の build で上書きされている。

## 工程10: 完了

### 変わったもの

- 上部の帯の JSX を、`TopbarFileMenu`・`TopbarBreadcrumbs`・`TopbarActions` の3つの部品に分けた。外枠の `<header>` と左サイドバーを表示するボタンは App に残した。App.tsx は 11,393行 → 10,537行。画面・操作・保存は変わらない。
- 見出しのパンくずのメニューを、押した見出しの下に開くようにした（癖2）。帯の外のクリックと Escape で閉じるようにした（癖1）。

### 確かめたこと

- 自動テスト: `test:topbar-parts`。わざと入れた不具合5つがすべて落ちた。一式の前後比較で新しい失敗は0。
- 実機: 工程9のとおり（分離は1回目、癖の修正は2回目）。

### 残っている別の作業

| 作業 | 中身 | 出どころ |
|---|---|---|
| 作品のあるとき・ないときの切り替えメニューの JSX が似ている | `TopbarBreadcrumbs` の中に、検索欄・最近の作品の一覧・「別のフォルダを開く...」がほぼ同じ形で2つある。まとめるなら、作品のないときだけライブラリの一覧が出る違いを残す | 工程5のやらないこと |
| Promise の帯の右側のアイコン、白い帯のテーマの区切り「›」 | 前回の修正で記録のみとしたもの（`docs/KNOWN_ISSUES.md`） | `docs/TITLEBAR_CONTRAST_FIX_PLAN.md` |
