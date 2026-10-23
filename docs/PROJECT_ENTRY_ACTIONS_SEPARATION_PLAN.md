# ファイルとフォルダの操作の分離の手順書

App.tsx の部品の中にある、作品のファイルとフォルダを操作する関数（新規ファイル・新規フォルダ、名前の変更、削除、別のフォルダへの移動、並べ替え）を、`src/projectEntryActions.ts` の `createProjectEntryActions(deps)` へ移す。前の手順書（`docs/EDITOR_NOTATION_ACTIONS_SEPARATION_PLAN.md`）が次の候補に挙げた「作品ごとの保存の読み書き」に近い、App.tsx でいちばん大きな操作のまとまり（約840行）にあたる。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/project-entry-actions`
- 戻し先: タグ `checkpoint/before-project-entry-actions`（コミット `fd0b789`。中身は main `1f16bb1` と同じ）
- 行番号は、断りがなければ `fd0b789` の時点のもの。App.tsx は 13,460行。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 済み |
| 7 | 実施 | 済み |
| 8 | 自動テスト | 済み |
| 9 | 実機確認 | 済み |
| 10 | 完了（確認2） | 確認待ち |

## 工程1: 調査の結果

### App.tsx の中の大きなまとまり（次の分離の候補を選ぶために数えた）

App の部品は 2254〜13460行（約11,200行）。そのうち JSX が約2,100行、useEffect が55個で約1,140行。操作の関数で大きいものは次のとおり。

| まとまり | 行数 | 主な関数 |
|---|---|---|
| **ファイルとフォルダの操作（今回）** | 約840 | `handleRenameProjectEntry`、`handleDeleteProjectEntry`、`handleMoveProjectEntryToFolder`、`handleMoveProjectEntriesToFolder` ほか |
| チェックポイント（作る・戻す・一部を戻す・詳細の編集） | 約800 | `buildManuscriptSnapshot`、`handleRestoreManuscriptSnapshot` ほか。どれも `useCallback` で包まれている |
| 見出しの移動・切り出し | 約300 | `handleHeadingMove`、`handleHeadingExtract` |
| プラグインの要求 | 約270 | `handlePluginRequest` |
| コマンドパレットの一覧 | 約190 | `buildPaletteCommands` |

ファイルとフォルダの操作を選んだ理由: `useCallback` で包まれていない（ふつうの `async` の関数なので、描画のたびに今の値で作り直す形に、そのまま写せる）、呼ぶ場所が JSX だけ、そして下の「気づいた点」の3に書く構造の問題が、ここにまとまって見えるため。

### コードがある場所

| まとまり | 行 | 行数 | 中身 |
|---|---|---|---|
| 新規ファイル | 9184〜9213 | 30 | `handleCreateProjectFile` |
| （残す）テンプレートとして登録 | 9215〜9280 | 66 | `handleRegisterCurrentFileAsTemplate`。テンプレートの機能なので移さない |
| 新規フォルダ〜並べ替え | 9282〜10090 | 809 | `handleCreateProjectFolder`、`handleRenameProjectEntry`、`handleDeleteProjectEntry`、`handleMoveProjectEntryToFolder`、`handleMoveProjectEntriesToFolder`、`saveProjectEntryOrder`、`handleMoveProjectEntry`、`handleBreadcrumbEntryDragStart`・`DragOver`・`Drop`・`DragEnd`、`handleSidebarEntryReorder` |
| 部品の外の型と定数 | 349、423〜437 | 14 | `BREADCRUMB_ENTRY_DRAG_MIME`、`MoveProjectEntryResult`、`MovedProjectEntry`、`MoveProjectEntriesResult`。移す関数の中でだけ使う |
| 部品の外の資料のパスの付け替え | 1380〜1426 | 47 | `retargetReferenceSourcePath`、`retargetReferenceFileInfo`、`retargetReferenceCard`。移す関数の中でだけ使う |

関数は13、合わせて約840行。

### 気づいた点

1. **使われていない関数はない。** 13の関数はどれも JSX から呼ばれる（`symbol-uses.mjs`）。`handleMoveProjectEntryToFolder` は JSX からは呼ばれず、複数の移動（`handleMoveProjectEntriesToFolder`）が1件だけのときに呼ぶ。`saveProjectEntryOrder` は並べ替えの3つの関数から呼ばれる。
2. **App.tsx の文字列を読むテストは1本。** `test:project-portability` が、関数名を目印に3つの範囲（名前の変更、1件の移動、複数の移動）を切り出し、その中に `fileProgress: retargetRecord(current.fileProgress)` があるかを確かめる。範囲の終わりの目印（`const handleDeleteProjectEntry = async`、`const saveProjectEntryOrder = async`）も一緒に移るので、読むファイルを変えれば正規表現は変えずに通る。ほかに、移す関数の名前・通知の文言を読むテストはない（`text-deps.mjs` で確かめた）。
3. **同じ「パスの付け替え」を3か所に書いている（構造の問題）。** ファイルやフォルダのパスは、App の中の8か所に別々に持たれている（下の工程2の1）。名前の変更・1件の移動・複数の移動は、そのたびに8か所を順に書き換える同じ手順を、それぞれ全部書いている（約120行ずつ）。削除はそのうちの一部だけを片付ける。パスを持つ場所が増えると、3か所（と削除）を全部直さないと食い違う。今回の分離では、手順は1文字も変えずに移す。まとめるかは別の作業として残す（工程5の「やらないこと」）。
4. **部品の外の小さな関数を、移す先でも使う。** 移す関数は、App.tsx の部品の外にある `isSamePath`・`toProjectRelativePath`・`isDirtyDocumentTab`・`createScratchDocumentTab`・`isTauriRuntime`・`isPathInsideFolder`、資料の `referenceKindFromPath`・`referenceNameFromPath` を使う。これらは App のほかの場所でも使う（`isSamePath` は41か所）。新しいファイルから App.tsx を import すると、App.tsx と互いに読み合う形（循環）になるので、置き場所を決める必要がある（工程5の5-3）。
   - `isPathInsideFolder` と、その中で使う `normalizePathForCompare` は、`src/utils/projectTree.ts` に1文字も違わない同じものがすでにある（App.tsx の 872〜874、925〜932 と、`projectTree.ts` の 277〜288 を突き合わせた）。
   - `isDirtyDocumentTab` は `src/components/layout/DocumentTabs.tsx` の中にも同じものがある（書き出してはいない）。
   - `isTauriRuntime` は、`CanvasWindowApp.tsx` など4つのファイルが、それぞれ同じ1行を持つ書き方になっている。

## 工程2: 仕組みの説明

### 言葉

- **項目（エントリ）**: 作品のフォルダの中のファイルかフォルダ。左のサイドバーの一覧と、上のパンくず（今のファイルの場所を「作品 › 章 › ファイル」と並べた帯）のメニューに出る。
- **作品のフォルダ（`projectFolder`）**: 開いている作品のフォルダの中身の木。Rust が作って返す。
- **未保存のタブ**: 開いているタブのうち、書いた内容がまだファイルに入っていないもの（`isDirtyDocumentTab`）。
- **付け替え（retarget）**: ファイルやフォルダの名前や場所が変わったとき、古いパスを覚えている所を新しいパスに書き換えること。
- **パスの変更中の札（`projectEntryPathChangeInProgressRef`）**: 名前の変更と移動のあいだ立てておく札。立っているあいだは、本文の自動保存（700ミリ秒後の保存）を止める。古いパスに書き戻さないため。
- **AST**: 作品の全ファイルの見出しや文字数を集めた索引（`projectAst`）。パスが変わると作り直す。

### 1. データの形（パスを持っている所）

| 置き場所 | 中身 | 保存 |
|---|---|---|
| `openTabs` | 開いているタブ。`path`・`id`（`file:<パス>`）・`documentKey` にパスが入る | アプリの状態（作品ごとのタブの記憶） |
| `appState.lastFilePath` | 最後に開いたファイル | アプリの状態 |
| `appState.fileProgress` | ファイルごとの進み具合（執筆中・完了など） | 作品の設定ファイル（作品と一緒に持ち運ぶ） |
| `appState.cursorPositions` | ファイルごとのカーソルの位置 | アプリの状態 |
| `plotCards` の本文 | プロットのカードに書いたファイルへのリンク | 作品のプロットのファイル |
| `referenceLayout.cards`・`recent` | 資料ボードの資料カードと、最近の資料 | 作品の資料のレイアウト |
| `referenceCandidates` | 資料の候補の一覧 | 保存しない |
| プラグインのアンカー（`pluginAnchorsRef`） | プラグインが本文に付けた目印の文書のパス | プラグインの保存先 |
| `focusedFolderPath`・`collapsedWorkspaceFolderPaths`・パンくずの2つのパス | 今選んでいるフォルダ、閉じたフォルダ、パンくずで見ているフォルダ | 一部はアプリの状態 |

### 2. 利用者の操作と内部の処理

| 操作 | 関数 | 内部で起きること |
|---|---|---|
| 新規ファイル（サイドバーの＋、パンくずのメニュー） | `handleCreateProjectFile` | テンプレートの一覧を読み、ファイル名とテンプレートを聞くダイアログを出す。Rust でファイルを作り（`create_text_file` か `create_text_file_from_template`）、作品のフォルダを読み直して、作ったファイルを開く |
| 新規フォルダ | `handleCreateProjectFolder` | 名前を聞き、Rust でフォルダを作り（`create_project_folder`）、作品のフォルダを読み直す |
| 名前の変更 | `handleRenameProjectEntry` | 名前を聞く。札を立て、影響するタブの未保存の内容を先に保存する。Rust で名前を変え（`rename_project_entry`）、上の表の8か所を付け替え、作品のフォルダを読み直し、AST を作り直す。札を下ろす |
| 削除 | `handleDeleteProjectEntry` | Rust で消す範囲を数え（`plan_delete_project_entry`）、件数と未保存のタブを書いた確認を出す。Rust でゴミ箱（なければ Then の Trash）へ移す（`delete_project_entry_to_trash`）。プラグインのアンカー、AST、選んでいるフォルダ、パンくず、タブ、進み具合、カーソルの位置、最後に開いたファイルから、消したものを取り除く。開いていたファイルを消したら、作品の最初のファイルを開く（なければ空のタブ） |
| 別のフォルダへ移動（ドラッグ、1件） | `handleMoveProjectEntryToFolder` | 同じフォルダへの移動と、フォルダを自分の中へ入れる移動を断る。あとは名前の変更と同じ流れで、Rust の `move_project_entry` を呼ぶ。作品のフォルダは Rust が返したものに置き換える |
| 別のフォルダへ移動（ドラッグ、複数） | `handleMoveProjectEntriesToFolder` | 1件なら上へ回す。複数はファイルだけを許し、`move_project_entries` を呼んで、移ったものごとに付け替える |
| 並べ替え（パンくずの上下ボタン、パンくずのドラッグ、サイドバーのドラッグ） | `handleMoveProjectEntry`、`handleBreadcrumbEntryDrag*`、`handleSidebarEntryReorder` | 新しい並び順を作り、`saveProjectEntryOrder` が Rust の `reorder_project_entries` で保存する。作品のフォルダの、そのフォルダの子だけを置き換える |

### 3. 保存

- ファイルとフォルダそのものは、Rust がディスクの上で作る・名前を変える・動かす・ゴミ箱へ移す。
- 並び順は、Rust が作品の設定ファイル（`config.order`）に書く。
- 付け替えた値は、それぞれの置き場所の保存の仕組み（App の useEffect の遅延保存）で保存される。今回は、その保存の仕組みには触らない。

### 4. ほかの機能との関係

- **資料（Reference）・プロット**: 名前の変更と移動のときに、資料カードと最近の資料、プロットの本文のリンクを付け替える。資料の付け替えの関数3つは、ここでしか使わない。
- **プラグイン**: アンカーの付け替え（`retargetPluginAnchors`）と、削除のときの取り除き（`persistPluginAnchors`）を呼ぶ。
- **タブと保存**: 未保存のタブの保存（`enqueueDocumentSave`）、開き直し（`loadDocumentIntoEditor`、`replaceActiveTab`）を呼ぶ。
- **ダイアログ**: 名前の入力（`requestInput`）、確認（`requestConfirm`）、新規ファイル（`requestCreateFile`）を呼ぶ。

### 5. 今の挙動の癖（直さない。工程9で実機で確かめる）

コードを読んでの見込み。

1. **削除は、資料カード・最近の資料・プロットの本文のリンクを片付けない。** 名前の変更と移動は付け替えるが、削除したファイルを指す資料カードやリンクは、そのまま残る（気づいた点の3の結果）。
2. **削除は、パスの変更中の札を立てない。** 名前の変更と移動は立てる。確認のダイアログのあいだは書けないので、自動保存が消したファイルを書き戻すことは、ふつうは起きないと見込む。
3. **名前の変更は作品のフォルダ全体を読み直し、移動は Rust が返した木に置き換える。** 結果は同じになる見込み。
4. **複数の移動では、移した先のフォルダが選ばれる。** 1件の移動では、フォルダなら移したフォルダ、ファイルなら移した先のフォルダが選ばれる。
5. **並べ替えを保存すると「並び順を保存しました」と出る。** 元に戻すボタンはない。

## 工程3: 依存関係

### A. React に依存しない処理（部品の外）

| 名前 | 行 | 使う所 | 扱い |
|---|---|---|---|
| `BREADCRUMB_ENTRY_DRAG_MIME` | 349 | 移す関数だけ | 移す |
| `MoveProjectEntryResult`・`MovedProjectEntry`・`MoveProjectEntriesResult`（型） | 423〜437 | 移す関数だけ | 移す |
| `retargetReferenceSourcePath`・`retargetReferenceFileInfo`・`retargetReferenceCard` | 1380〜1426 | 移す関数だけ | 移す（5-3） |
| `referenceKindFromPath`・`referenceNameFromPath` | 1287〜1300 | 資料の付け替えと、App の資料の正規化 | 置き場所を決める（5-3） |
| `isSamePath`・`toProjectRelativePath` | 921〜941 | 移す関数と、App の多くの場所 | 置き場所を決める（5-3） |
| `isDirtyDocumentTab`・`createScratchDocumentTab`・`scratchFileName` | 352、813〜837、1012〜1018 | 移す関数と、App のタブの処理 | 置き場所を決める（5-3） |
| `isPathInsideFolder`・`normalizePathForCompare` | 872、925 | 移す関数と、App のほかの場所 | 移す先は `utils/projectTree` の同じものを import する。App のものは残す |
| `isTauriRuntime` | 355 | 移す関数と、App の77か所 | 移す先で、ほかの4つのファイルと同じ1行を持つ |

### B. 値（state と ref）。すべて App に残す

読む: `projectFolder`、`openTabs`、`activeTab`、`currentFilePath`、`focusedFolderPath`、`activeBreadcrumbPath`、`breadcrumbDropTarget`。
書く: `setProjectFolder`、`setOpenTabs`、`setActiveTabId`、`setAppState`、`setPlotCards`、`setReferenceLayout`、`setReferenceCandidates`、`setProjectAst`、`setFocusedFolderPath`、`setActiveBreadcrumbPath`、`setBreadcrumbBrowsePath`、`setCollapsedWorkspaceFolderPaths`、`setBreadcrumbDropTarget`、`setDraggingBreadcrumbEntryPath`、`setSaveStatus`、`setLastError`。
ref: `activeTabIdRef`、`projectEntryPathChangeInProgressRef`、`pluginAnchorsRef`、`didMountEditorRef`、`lastSavedMarkdownRef`、`breadcrumbDragEntryRef`、`projectAstBuildIdRef`。

### C. 操作の関数（移す）

C-1 新規ファイル、C-2 新規フォルダ、C-3 名前の変更、C-4 削除、C-5 1件の移動、C-6 複数の移動、C-7 並び順の保存、C-8 上下の並べ替え、C-9 パンくずのドラッグ（4つ）、C-10 サイドバーの並べ替え。どれも JSX だけから呼ばれ、ほかの操作の関数からは呼ばれない（C-5 は C-6 から、C-7 は C-8〜C-10 から呼ばれる。どれも移す側の中）。

### D. 自動で走る処理（useEffect）

移さない。関係するのは、本文の自動保存の effect（4772〜4791行）が、パスの変更中の札を見て保存を止めること。

### E. 作品を開く経路

触らない。移す関数は、作品の切り替えや起動時の復元からは呼ばれない。

### F. 画面部品への受け渡し（JSX）

変えない。`WorkspaceSidebar` の `onCreateFile`・`onCreateFolder`・`onRenameEntry`・`onDeleteEntry`・`onMoveEntriesToFolder`・`onReorderEntries`、パンくずのメニューの行（ドラッグの4つ、上下、名前の変更、削除、新規）、左の活動バーの新規フォルダから呼ぶ。名前を同じにして取り出すので、JSX は1文字も変わらない。

### G. App の外とのやり取り

Rust の命令: `list_text_templates`（App に残る `loadTextTemplates` の中）、`create_text_file`、`create_text_file_from_template`、`create_project_folder`、`rename_project_entry`、`plan_delete_project_entry`、`delete_project_entry_to_trash`、`read_text_file`、`move_project_entry`、`move_project_entries`、`reorder_project_entries`、`list_project_text_files`（App に残る `refreshProjectFolder` の中）。ドラッグのデータの種類: `application/x-brew-project-entry-path`。ウィンドウ間の知らせはない。

### H. App.tsx の文字列を読むテスト

`test:project-portability` の3つの範囲だけ（気づいた点の2）。

### 結び目

1. 移す関数が、App の部品の外の小さな関数を使う（気づいた点の4）。
2. App の道具（通知、名前の入力、確認、新規ファイルのダイアログ、テンプレートの一覧、保存の列、作品のフォルダの読み直し、ファイルを開く処理、タブの差し替え、プラグインのアンカー）に頼る。約20個を deps で渡す。
3. 既定の引数 `folderPath = activeBreadcrumbPath` が、App の値を読む。deps で渡した値で同じ意味になる。
4. テストが関数名を範囲の目印に読む。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

| | ファイル |
|---|---|
| 必ず変わる | `src/App.tsx`（関数と部品の外の定義を取り除き、import と呼び出しを足す）、`src/projectEntryActions.ts`（新規）、`scripts/test-project-portability-baseline.mjs`（読むファイルを足す）、`package.json`（回帰テストを足す）、`scripts/test-project-entry-actions.mjs`（新規） |
| 5-3 の決め方で変わる | 部品の外の小さな関数の置き場所（`src/utils/projectTree.ts`、`src/editor/documentTabState.ts`、`src/referencePathModel.ts`（新規）） |
| 変えない | Rust、型（`src/types.ts`）、画面部品、CSS、文言 |

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 名前の変更・移動の付け替え | 高 | 付け替えを1つでも落とすと、進み具合やタブが古いパスのまま残り、保存のときに別のファイルを指す。札の上げ下ろしを落とすと、古いパスに書き戻す |
| 削除 | 高 | 開いていたファイルを消したときの開き直しと、取り除きの範囲 |
| 新規・並べ替え | 中 | 失敗しても消えるものはないが、並び順の保存先を誤ると並びが崩れる |
| 部品の外の小さな関数の置き場所 | 低 | 中身を変えずに場所だけ移す。`isSamePath` は App の41か所で使う |
| deps の渡し方 | 中 | 渡し忘れは型検査で落ちる。古い値を渡すと（たとえば ref の `.current` を渡すと）、操作の時点の値でなくなる |

### 4-3. 機能ごとに起こりうる回帰不具合

| 機能 | 起こりうること | 今のテストで気づけるか |
|---|---|---|
| 名前の変更・移動 | 付け替えの抜け | 文字列だけ（`fileProgress` の付け替えが書いてあるか） |
| 削除 | 取り除きの抜け、開き直しの誤り | なし |
| 新規 | 作った後に開かない | なし |
| 並べ替え | 並び順が保存されない | なし（Rust 側は `test:sidebar-file-move` が確かめる） |
| パンくずのドラッグ | ドロップの位置の誤り | なし |

### 4-4. 今の自動テストの状態

「前」の一式（main `1f16bb1`、69本）で失敗したのは5本。`test:ai-selection`（一式の中でだけ止まる）、`test:canvas-save`（`./utils/fontStack` を解決できない）、`test:v058-bundle`（メインの JS が 500 kB を超える。686,088 バイト）、`test:v0511-themes`（朱墨のプロットの枠線）、`test:v070-manuscript-browser`（10分で打ち切り）。最後の1本は前の分離までの記録になく、「後」では通った（工程8）。

## 工程5: 案

### 5-1. 方針

`docs/IDEA_SEPARATION_PLAN.md` と同じ線引きにする。値・保存・useEffect・作品を開く経路は App に残し、操作の関数だけを `createProjectEntryActions(deps)` へ引っ越す。中身・文言・条件・順番は変えない。違うのは、App の値を直接見ていた所を deps から受け取ることだけ。新しいファイルに useState・useEffect・useCallback を持ち込まない。

### 5-2. 移すもの／残すもの

移すもの（`src/projectEntryActions.ts`）:
- 13の操作の関数（9184〜9213、9282〜10090行）。
- 移す関数の中でだけ使う、部品の外の定数1つと型3つ。

残すもの:
- `loadTextTemplates`（テンプレートの登録でも使う）と `handleRegisterCurrentFileAsTemplate`。deps で渡す。
- `refreshProjectFolder`・`retargetPluginAnchors`・`persistPluginAnchors`（`useCallback` で包まれていて、ほかの機能も使う）。deps で渡す。
- 見出しの移動・切り出し（10092行〜）。ファイルを書き換えるが、アウトラインの機能なので別にする。

呼び出しは、9282行の位置（元の `handleCreateProjectFolder` があった所）に置く。deps に渡す値は、どれもそれより前（いちばん後ろでも 9177行の `loadTextTemplates`）で作られている。返ってきた関数を呼び出しより前で使う所はない（`symbol-uses.mjs --call-site` で確かめた。使うのは 11771行より後の JSX だけ）。

### 5-3. 部品の外の小さな関数の置き場所

新しいファイルから App.tsx を import すると循環になるので、App.tsx の外へ出す必要がある。中身は1文字も変えずに、場所だけ移す。

| 関数 | 移す先 | 理由 |
|---|---|---|
| `isSamePath`、`toProjectRelativePath` | `src/utils/projectTree.ts` に書き出しで足す | パスを比べる関数の仲間（`normalizePathForCompare`・`isPathInsideFolder`・`retargetFilesystemPath`）がすでにここにある。`isSamePath` が中で使う `normalizePathForCompare` も、ここに同じものがある |
| `isDirtyDocumentTab`、`createScratchDocumentTab`、`scratchFileName` | `src/editor/documentTabState.ts` に書き出しで足す | タブの状態を扱う、React に依存しない関数のファイル |
| `referenceKindFromPath`、`referenceNameFromPath`、資料の付け替え3つ | `src/referencePathModel.ts`（新規） | 資料のパスの扱い。次の候補の「資料の正規化」を分けるときに、ここへ足していける |
| `isPathInsideFolder` | 移す先は `utils/projectTree` の同じものを import する。App.tsx のものは残す | App.tsx の中の別の場所でも使う。App のものを消して import に替えるのは「まとめる」作業になるので、今回はしない |
| `isTauriRuntime` | 移す先で、`CanvasWindowApp.tsx` など4つのファイルと同じ1行を持つ | このリポジトリの書き方に合わせる |

### 決めてほしいこと

**1. 範囲**
- (a) 13の関数を全部移す。
- (b) 名前の変更・削除・移動の4つ（約670行）だけを移し、新規と並べ替えは残す。
- 勧め: (a)。13の関数は同じ「作品の項目の操作」で、使う deps もほぼ同じ。分けると、同じ deps を2回書くことになる。

**2. 部品の外の小さな関数の置き場所**
- (a) 5-3 の表のとおり、仲間のいるファイルへ分けて移す。
- (b) 新しいファイル `src/appShared.ts` に全部まとめて移す。
- 勧め: (a)。(b) は持ち主のない置き場所を新しく作ることになり、次の分離でも何でもそこへ入れたくなる。

**3. 同じ付け替えを3か所に書いている構造（気づいた点の3）と、削除が資料やリンクを片付けない癖（癖の1）**
- (a) 今回は触らない。手順書に残し、別の作業（付け替えを1つの関数にまとめ、削除も同じ置き場所の一覧から片付ける）として出す。
- (b) 今回の分離の後に、同じブランチで続けてまとめる。
- 勧め: (a)。分離は「中身が同じ」ことを `verify-move.mjs` で機械的に確かめられるのが強み。まとめる作業は中身を変えるので、別の確認（どの置き場所を付け替えるべきかの仕様の判断）がいる。

### テストの直し方と足すテスト

- `test:project-portability`: 3つの範囲を、`src/projectEntryActions.ts` から切り出すように変える。正規表現は変えない。
- 新しい回帰テスト `test:project-entry-actions`（`scripts/test-project-entry-actions.mjs`）: esbuild で `src/projectEntryActions.ts` を束ね、`@tauri-apps/api/core` の `invoke` を入れ物に差し替える。App の値の代わりの入れ物を用意し、操作のたびに今の値で `createProjectEntryActions` を作り直す（`scripts/test-idea-thread-actions.mjs` と同じ形）。確かめること:
  - 名前の変更（ファイル、フォルダ）: Rust に渡す引数、タブ・最後に開いたファイル・進み具合・カーソルの位置・資料カード・最近の資料・資料の候補・プロットの本文・閉じたフォルダの付け替え、札が操作のあいだだけ立つこと、未保存のタブを先に保存すること、通知。
  - 削除: 確認の文（件数と未保存のタブ）、断ったら何もしないこと、取り除き、開いていたファイルを消したら最初のファイルを開くこと、ファイルがなければ空のタブ。
  - 1件と複数の移動: 同じフォルダへの移動と、フォルダを自分の中へ入れる移動を断ること、付け替え、選ばれるフォルダ、複数でフォルダが混じったら断ること。
  - 新規ファイル・新規フォルダ、並び順の保存、パンくずのドラッグの位置。
  - 失敗したとき（`invoke` が投げたとき）の保存の状態と誤りの文。
- 効くことの確かめ: 移した処理にわざと不具合を2つ入れ（例: 名前の変更で `fileProgress` の付け替えを外す、削除でタブの取り除きを外す）、テストが落ちることを見て戻す。

### 進め方とコミットの分け方

1. 部品の外の小さな関数を、5-3 の移す先へ移す（App は import に替える）。型検査、関係するテスト、コミット。
2. 13の関数と、型・定数・資料の付け替えを `src/projectEntryActions.ts` へ移す。`verify-move.mjs` で突き合わせ、テストの読むファイルを直す。型検査、build、関係するテスト、コミット。
3. 回帰テストを足して、効くことを確かめる。コミット。
4. 「後」の一式と前後の比較。実機確認。手順書と片付け。

### 見込みと、今回やらないこと

- App.tsx は約900行減る見込み（13,460 → 約12,560行）。
- やらないこと: 付け替えを1つにまとめること、削除の片付けの範囲を広げること（癖の1）、App.tsx の `isPathInsideFolder`・`normalizePathForCompare` を `utils/projectTree` のものに替えること、見出しの移動・切り出しの分離、テンプレートの登録の分離。

## 工程6: 人の確認

2026-10-24 に、3つとも勧めの案で決まった。

| 決めること | 決まったこと |
|---|---|
| 1. 範囲 | (a) 13の関数を全部移す |
| 2. 部品の外の小さな関数の置き場所 | (a) 5-3 の表のとおり、仲間のいるファイルへ分けて移す |
| 3. 同じ付け替えを3か所に書いている構造と、削除の癖 | (a) 今回は触らない。別の作業として残す |

## 工程7: 実施

| コミット | 中身 |
|---|---|
| `1238e04` | 部品の外の小さな関数を移した。`isSamePath`・`toProjectRelativePath` を `src/utils/projectTree.ts`、`scratchFileName`・`createScratchDocumentTab`・`isDirtyDocumentTab` を `src/editor/documentTabState.ts`、資料のパスの関数5つを新しい `src/referencePathModel.ts` へ。App は import に替えた |
| `038a8a3` | 13の操作の関数と、そこでだけ使う型3つと定数1つを `src/projectEntryActions.ts` の `createProjectEntryActions(deps)` へ移した。App で使わなくなった import 13個を消した。`test:project-portability` の3つの範囲を、移した先から読むようにした |
| `98057ca` | 回帰テスト `test:project-entry-actions` を足した（工程8） |

- 行数: App.tsx は 13,460 → 12,550行（910行減）。`src/projectEntryActions.ts` は 1,027行（deps の型が約70行）。`src/referencePathModel.ts` は 69行。
- 元と同じであることの確かめ方: `verify-move.mjs`。1つめは lost 1（書き換えた `documentTabState` の import の1行だけ）、2つめは lost 0。足した行は import と、元の `handleCreateProjectFolder` の位置に置いた `createProjectEntryActions({ ... })` の呼び出しだけ。
- 元と違う点: 移した先で `isTauriRuntime` を1行で持つ（ほかの4つのファイルと同じ書き方）。`isPathInsideFolder` は `utils/projectTree` の同じものを import する（App.tsx のものは残した）。`handleMoveProjectEntryToFolder` と `saveProjectEntryOrder` は、App の JSX から呼ばれないので外へ返さない。
- 型検査（`npx tsc --noEmit`）、build、関係するテスト（`test:project-portability`・`test:checkpoint`・`test:document-tabs`・`test:workspace-tabs`・`test:binder`・`test:idea-actions`・`test:editor-notation-actions`・`test:breadcrumb`）は、コミットごとに通った。

## 工程8: 自動テスト

### 足した回帰テスト

`scripts/test-project-entry-actions.mjs`（`test:project-entry-actions`）。esbuild で `src/projectEntryActions.ts` を束ね、`@tauri-apps/api/core` の `invoke` を入れ物に差し替える。App の値の代わりの入れ物を用意し、操作のたびに今の値で `createProjectEntryActions` を作り直す。確かめていること:

- 名前の変更（ファイル・フォルダ）: 未保存のタブを先に保存すること、Rust に渡す引数、札が Rust を呼ぶあいだだけ立つこと、タブ・最後に開いたファイル・本文・進み具合・カーソルの位置・プロットのリンク・資料カード・最近の資料・資料の候補・プラグインのアンカー・選んでいるフォルダ・閉じたフォルダの付け替え、通知。同じ名前・断ったときは何もしないこと。失敗したときの誤りの文と、札が下りること。
- 削除: 確認の文（件数・未保存のタブ・注意）、断ったら消さないこと、取り除き、開いていたファイルを消したら最初のファイルを開くこと、ファイルがなくなれば空のタブ、Then の Trash の通知、Tauri の外での通知。今の癖（工程2の5の1）として、資料カードとプロットのリンクが残ることも書いた。
- 1件の移動（ファイル・フォルダ）と複数の移動: 断る条件、付け替え、選ばれるフォルダ、移した先にあるものは除くこと、1件なら1件の移動へ回ること。
- 新規ファイル（テンプレートなし・あり）、新規フォルダ、フォルダを開いていないとき。
- 並べ替え: 上下（端では保存しない）、パンくずのドラッグ（別のフォルダへの持ち込みは受けない、上半分なら前・下半分なら後ろ）、サイドバーの並べ替え、失敗したとき。

効くことの確かめ: 移した処理にわざと不具合を3つ入れ、どれもテストが落ちることを見て `git checkout` で戻した。
1. 名前の変更で `fileProgress` を付け替えない → 進み具合の比較で落ちた。
2. 削除でタブを取り除かない → タブの一覧の比較で落ちた。
3. 1件の移動で札を立てない → 「Rust を呼ぶあいだ札が立つ」で落ちた。

### 前後の比較

| | 前（`1f16bb1`） | 後（`98057ca`） |
|---|---|---|
| build | 通った | 通った |
| メインの JS | 686,088 バイト | 688,782 バイト（+2.7 kB。関数をまとめて返すので、名前が圧縮で縮まない） |
| テストの本数 | 69 | 70（`test:project-entry-actions` を足した） |
| 両方で通った | 64 | 64 |
| 両方で失敗 | 4（`test:ai-selection`、`test:canvas-save`、`test:v058-bundle`、`test:v0511-themes`。理由は前後で同じ） | 同じ |
| 前だけ失敗 | `test:v070-manuscript-browser`（10分で打ち切り） | 通った |
| 新しい失敗 | — | なし |

`test:v070-manuscript-browser` は、今回変えたファイルを読まない（原稿のページ送りをブラウザで確かめるテスト）。「前」の一式でだけ止まったと見ている。


## 工程9: 実機確認

### やり方

`98057ca` を識別子 `local.then.qa.entryops1024` で build した QA 用アプリを、scratchpad の一時ライブラリで動かした。作品Aに `第一章/a.txt`（開いている、進み具合「執筆中」）・`第一章/b.txt`・`c.txt`（「完了」）を置き、プロットのカードと資料ボードのカード2枚・最近の資料に `第一章/a.txt` と `c.txt` へのリンクを入れた。作品Bは切り替えの確認に使った。右クリックのメニュー、サイドバーのドラッグ（CDP の本物のマウス操作）、パンくずのメニューから操作し、画面と、作品のフォルダのファイル・`.then/project.json`・`.then/reference-layouts/default.json` を突き合わせた。

### 確認した項目と結果

| 確認したこと | 結果 |
|---|---|
| 名前の変更（ファイル）。本文に書き足してすぐ、右クリックの「リネーム」で `a.txt` → `a2.txt` | ダイアログは「名前を変更」「テキストファイル名」、初期値 `a.txt`。通知「「a.txt」をリネームしました」。ディスクは `第一章/a2.txt` だけになり、書き足した内容が入った。タブ・本文・サイドバーが `a2.txt` に変わった。`fileProgress` は `第一章/a2.txt: writing`、プロットは `@[[第一章/a2.txt]]` に付け替わった |
| 名前の変更（フォルダ）。`第一章` → `第1章` | ダイアログは「フォルダ名」。通知「「第一章」をリネームしました」。中のファイル・タブ・`fileProgress`・プロットのリンクが `第1章/…` に付け替わった |
| 1件の移動。サイドバーで `c.txt` を `第1章` へドラッグ | 通知「「c.txt」を移動しました」。ディスク・`fileProgress`（`第1章/c.txt: done`）・プロットのリンクが付け替わり、並び順を Rust が書いた |
| 並べ替え。サイドバーで同じフォルダの中をドラッグ（2回）、パンくずのメニューの「下へ移動」 | 3回とも並び順が `.then/project.json` の `order` に保存され、画面の順と合った。通知「並び順を保存しました」（1回目は、下の「確かめられなかったこと」の理由で通知を見ていない） |
| 新規フォルダ・新規ファイル。右クリックの「フォルダを追加」「ファイルを追加」 | 「新規フォルダを作成」（初期値「新規フォルダ」）で `下書き` を作り、通知「「下書き」を作成しました」。「新規ファイルを作成」で `メモ` を作ると、`下書き/メモ.txt`（本文 `# メモ`）ができて新しいタブで開き、通知「「メモ.txt」を作成しました」 |
| 削除（開いていないファイル）。`c.txt` | 確認は「項目を削除」「「c.txt」を削除しますか？」「ファイルをThenのTrashへ移動します。 チェックポイントには影響しません。」。通知「「c.txt」をゴミ箱へ移動しました」。ディスクと `fileProgress` から消えた |
| 削除（開いているファイル）。`メモ.txt` | 通知「「メモ.txt」をゴミ箱へ移動しました」。そのタブが閉じ、作品の最初のファイル `b.txt` が開いた |
| 複数の移動。`b.txt` を選び、Ctrl を押したまま `a2.txt` を `下書き` へドラッグ | 通知「2件のファイルを移動しました」。2つのファイル・タブ・`fileProgress`・プロットのリンクが `第1章/下書き/…` に付け替わった |
| 作品の切り替え。A → B → A を2回 | 作品Aのファイルは切り替えの前後で1つも変わらなかった（`.bak` を除く全ファイルの md5 で比べた）。作品Bの `.then` は初めて開いたときの初期化（インボックスと空の資料ボード）だけで、作品Aのプロットや進み具合は入らなかった。Aへ戻ると、名前を変えた後のタブと本文、並び順が戻った |
| 再起動 | 止める前と起動した後で、開いている作品・サイドバー・タブ・本文が完全に同じだった |

### 今の挙動の癖を実機で確かめた結果

| 癖 | 結果 |
|---|---|
| 1. 削除は資料カード・プロットのリンクを片付けない | 確かめた。`c.txt` を消した後も、プロットに `@[[第1章/c.txt]]` が残った |
| 2. 削除は札を立てない | 確かめていない（確認のダイアログのあいだは書けないので、実機では差が出ない見込み） |
| 3. 名前の変更は木を読み直し、移動は Rust の木に置き換える | どちらも、サイドバーの木はディスクと合った |
| 4. 選ばれるフォルダ | 移動のあと、サイドバーで移した先のフォルダが開いた |
| 5. 並べ替えに元に戻すがない | 通知は「並び順を保存しました」だけで、ボタンはなかった |

### 新しく見つけた癖（分離の前からある）

実機確認で2つ見つけた。どちらも、チェックポイント `fd0b789`（分離の前）を識別子 `local.then.qa.entryopsbase1024` で build し、同じ一時ライブラリで同じ操作をして、**分離の前も同じ**ことを確かめた。

1. **名前の変更・移動で、資料ボードの資料カードと最近の資料が古いパスに戻る。** 資料カードは「failed to resolve reference path: 指定されたファイルが見つかりません。」になる。原因（コードから）: 名前の変更と移動は資料のレイアウトを付け替えるが、同じ操作で作品のフォルダの木（`projectFolder`）が新しくなるので、App の資料の読み込みの useEffect（`[isHydrated, projectFolder]`）が、保存を止めてからディスクの資料のレイアウトを読み直す。付け替えはまだ保存されていない（0.7秒後の保存を待っている）ので、古い内容に戻る。プロットのリンクと進み具合は、別の保存の経路なので付け替わる。
2. **書きかけのファイルの名前を変えた後にアプリが強制的に終わると、次の起動で古い名前の「保存されていない編集が残っています」が出る。** 保存ジャーナル（書きかけを守る記録）は、タブの名前（`file:<パス>`）ごとに持つ。名前の変更でタブの名前が変わるので、古い名前の記録が片付かずに残る。中身は新しい名前のファイルに保存された内容と同じだった。ふつうに閉じたときに出るかは確かめていない（QA の止め方は強制的に止める）。

### 確かめられなかったこと

- 1回目の並べ替えの通知: 確認の途中で、私が通知の要素を画面の中から直接取り除いた。そのため通知が出なくなり、続く作品の切り替えで React の画面全体が外れて白くなった。再起動して、要素に触れずに同じ切り替えを2回行い、画面が外れないことを確かめた。並べ替えの通知は、再起動後の2回で確かめた。
- 削除は OS のごみ箱へ移す。QA の一時ファイル `c.txt` と `メモ.txt` が、Windows のごみ箱に残っている（ごみ箱を空にすると、ほかのものまで消えるので、空にしていない）。Then の Trash へ回る経路（`appTrash`）は、回帰テストだけで確かめた。
- 名前の入力で「キャンセル」を押したとき、複数の移動にフォルダが混じったときは、回帰テストだけで確かめた。

### 片付け

`qa-cleanup.mjs` で2つの識別子の `%APPDATA%`・`%LOCALAPPDATA%` と一時ライブラリを消した。残りは QA の Then 0、WebView2 0、テストの Edge 0、node 0、%TEMP% のテスト用プロファイル 0。`src-tauri/target/release/Then.exe` は、最後に build したチェックポイントの QA 用（`local.then.qa.entryopsbase1024`）になっている。

## 工程10: 完了

### 変わったもの

| ファイル | 中身 |
|---|---|
| `src/App.tsx` | 13,460 → 12,550行。13の操作の関数と、部品の外の小さな関数を取り除き、`createProjectEntryActions({ ... })` の呼び出しと import を足した |
| `src/projectEntryActions.ts`（新規、1,027行） | 新規ファイル・新規フォルダ・名前の変更・削除・移動・並べ替えの13の関数、型3つ、定数1つ |
| `src/referencePathModel.ts`（新規、69行） | 資料のパスの関数5つ |
| `src/utils/projectTree.ts`、`src/editor/documentTabState.ts` | `isSamePath`・`toProjectRelativePath`、`scratchFileName`・`createScratchDocumentTab`・`isDirtyDocumentTab` を足した |
| `scripts/test-project-entry-actions.mjs`（新規）、`package.json` | 回帰テスト `test:project-entry-actions` |
| `scripts/test-project-portability-baseline.mjs` | 3つの範囲を、移した先から読む |

仕様・保存形式・UI・文言・Rust は変えていない。

### 残っていること（別の作業）

| 件 | 中身 | 記録 |
|---|---|---|
| パスの付け替えの構造 | 同じ付け替えを、名前の変更・1件の移動・複数の移動の3か所にそれぞれ全部書いている。削除はその一部しか片付けない。パスを持つ置き場所の一覧を1つにまとめ、3つの操作と削除が同じ一覧を使う形にすると、下の3つの癖もまとめて直せる | 工程1の気づいた点の3、確認1の3 |
| 資料カードが古いパスに戻る | 名前の変更・移動のあと、資料ボードの読み直しが付け替えを上書きする（分離の前からある） | 工程9、`docs/KNOWN_ISSUES.md` の 2026-10-24 |
| 古い名前の書きかけの記録が残る | 書きかけのファイルの名前を変えると、保存ジャーナルの古いタブの名前の記録が残る（分離の前からある） | 工程9、`docs/KNOWN_ISSUES.md` の 2026-10-24 |
| 削除でリンクが残る | 削除は資料カード・最近の資料・プロットのリンクを片付けない | 工程2の5の1、工程9、`docs/KNOWN_ISSUES.md` の 2026-10-24 |
| 次の分離の候補 | チェックポイント（作る・戻す、約800行。`useCallback` で包まれている）、見出しの移動・切り出し（約300行）、プラグインの要求（約270行）、App.tsx の `isPathInsideFolder`・`normalizePathForCompare` を `utils/projectTree` のものに替えること | 工程1、5-3 |
| 元から失敗しているテスト | `test:ai-selection`（一式の中でだけ止まる）、`test:canvas-save`、`test:v058-bundle`、`test:v0511-themes` | 工程8 |
