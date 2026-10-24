# 左サイドバーの分離の手順書

App.tsx の中にある左サイドバーの部分（画面の枠と配線、ツリーの開閉、検索と置換、見出しの移動・切り出し）を、4段階に分けて App.tsx の外へ移す。危険の小さい段階から順に進め、先の段階で作ったテストを後の段階の守りにする。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/left-sidebar`（段階3・4は、工程6で決める PR の分け方に従う）
- 戻し先: タグ `checkpoint/before-left-sidebar`（コミット `5e5ca0e`。中身は main `aa94561` と同じ。右サイドバーの分離 maybefix/Then#21 を取り込んだ後）
- 行番号は、断りがなければ `5e5ca0e` の時点のもの。App.tsx は 12,074行。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 済み |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

### 左サイドバーに関わるコードの全体

左サイドバーの中身そのものは、すでに部品に分かれている（`src/components/layout/WorkspaceSidebar.tsx` 2,574行、`src/components/binder/OpenCardsPane.tsx`）。ファイルとフォルダの操作（新規・名前の変更・削除・移動・並べ替え）も、前回 `src/projectEntryActions.ts` へ移してある。App.tsx に残っているのは次のとおり。

| まとまり | 行 | 行数 | 段階 |
|---|---|---|---|
| 左の枠の JSX（左端のボタン列、開いているカード、`<WorkspaceSidebar>` への受け渡し） | 11100〜11317 | 218 | 1 |
| 検索中かどうか（`isProjectSearchMode`） | 2152 | 1 | 1 |
| ツリーの開閉の操作3つ（`handleFolderCollapsedChange` ほか） | 9870〜9934 | 65 | 2 |
| 検索の結果を開く（`handleProjectSearchResultOpen`） | 8606〜8633 | 28 | 3 |
| ファイル内の置換・全体の置換・ツリーの見出しから飛ぶ（`handleReplaceInCurrentFile`、`handleReplaceInProject`、`handleProjectOutlineJump`） | 8637〜8782 | 146 | 3 |
| 見出しの移動・切り出し（`handleHeadingMove`、`handleHeadingExtract`） | 8929〜9225 | 297 | 4 |
| 切り出すファイル名の候補（部品の外の `suggestedHeadingFileName`） | 913〜923 | 11 | 4 |

### 気づいた点

1. **移す候補の関数は、どれも左サイドバーの JSX からしか呼ばれない**（`symbol-uses.mjs`）。例外は `handleProjectSearchResultOpen` だけで、`searchResultOpenRef` にも入る（8635行）。ライブラリ全体の検索で別の範囲の結果を選ぶと、範囲を切り替えた後に、3611〜3616行の useEffect がこの ref から呼ぶ。
2. **App.tsx の文字列を読むテストは3本。**
   - `test:binder`: `<OpenCardsPane` があること。
   - `test:v061-plugins`: `leftWorkspaceCluster` の className が `appMode !== "write" && appMode !== "plugin"` で隠れること。
   - `test:project-portability`: `const handleSetFileProgress =` から `const handleSnippetStorageModeChange` までを切り出して読む。`handleSetFileProgress` はこのテストの目印なので**動かさない**。進み具合の保存は、作品の持ち運び用の保存の待ち行列（`fileProgressSaveQueueRef`、`portableProjectRefreshesRef`）と一緒に動く仕組みで、左サイドバーだけのものでもない。
3. **ファイルに書く処理の App 側を、自動テストは動かしていない。** `test:heading-move` は、見出しを移した後の本文を作る純粋な処理（`src/editor/ast/headingMove.ts`）だけを確かめる。全体の置換と、見出しの移動・切り出しの「読む → 書く → タブ・プロジェクトの索引・アプリの状態へ反映する」部分には、今テストがない。
4. **同じ「保存した本文を、タブ・プロジェクトの索引・アプリの状態へ反映する」手順を、全体の置換と見出しの移動に別々に書いている**（`projectEntryActions.ts` にも似た形がある）。分離では1文字も変えずに移し、まとめない。
5. **検索の結果の組み立て（3543〜3768行の useMemo 6つ）は移さない。** はじめの見込みでは約300行を移せると考えていた。読んでみると、useMemo のあいだに useEffect が2つ、独自フック `usePropertyValueIndex`、エディタの中の検索の useMemo が挟まって並んでいる。中身もほとんどが、すでに utils にある関数の呼び出しで、移して減るのは数十行にとどまる。そのためにフックの順番を扱うのは割に合わない。
6. **見出しの移動の確認用ログ（`logHeadingDnd`）は `import.meta.env.DEV` を読む。** 移した後のファイルをテストで束ねるときは、esbuild の `define` でこの値を与える必要がある。

## 工程2: 仕組みの説明

### 言葉

- **左端のボタン列**: 左サイドバーのさらに左にある縦長のボタンの列（`workspaceActivityBar`）。ファイルツリー・プロジェクト検索・開いているカードの切り替えと、新規ファイル・新規フォルダのボタンがある。
- **ビュー**: 左サイドバーに今出ている画面。ファイルツリー（`files`）、プロジェクト検索（`search`）、開いているカード（`reference`）の3つ。検索はファイルツリーと同じ部品（`WorkspaceSidebar`）が出し分ける。
- **部品**: React の画面の部品（コンポーネント）。親から受け取る値を **props** という。
- **deps**: 操作の関数をまとめたファイルに、App から渡す値と関数の束。描画のたびに今の値で作り直すので、元の書き方と同じ意味になる。
- **つなぎ間違い**: 部品のボタンに、違う App の関数を渡してしまうこと。たとえば「名前の変更」に削除の関数を渡すこと。
- **プロジェクトの索引**: 検索とアウトラインに使う、作品の全ファイルの本文の解析結果（`projectAst`）。

### 1. データの形

| 値 | 置き場所 | 保存 |
|---|---|---|
| 今のビュー（`leftSidebarView`） | App の useState | しない（起動のたびにファイルツリー） |
| 畳んでいるか（`isLeftSidebarCollapsed`） | App の useState | しない |
| ツリーで閉じたフォルダ・閉じたファイルのアウトライン・閉じた見出し | `appState.collapsed…ByWorkspace`（作品のパスごとの一覧） | アプリの状態と一緒に保存される |
| 検索語・置換語・正規表現・大小文字・コメントを含む・検索範囲 | App の useState | しない |
| 置換中か（`isProjectReplacing`）、見出しを移動中か（`headingMoveInProgressRef`） | App の useState と ref | しない |

### 2. 利用者の操作と内部の処理

| 操作 | 内部の処理 | 書くもの |
|---|---|---|
| 左端のボタンでビューを切り替える | 畳みを解いて、ビューを替える | なし |
| 新規ファイル・新規フォルダのボタン | `handleNewDocument`、`handleCreateProjectFolder`（作品がなければフォルダを開く） | ファイル（分離済みの処理） |
| 「左サイドバーを畳む」／上の帯の「左サイドバーを表示」 | 畳む値を切り替える | なし |
| ツリーのフォルダ・アウトライン・見出しを開閉する | 今の作品のパスの一覧に足す・外す | アプリの状態 |
| 検索の結果を選ぶ | 別の範囲（ライブラリの別の作品）なら、その作品を開いてから、開き終わった後に同じ結果を開き直す。同じ作品なら、ファイルを開いて該当箇所を選ぶ | なし |
| ファイル内で置換 | 今のファイルの本文を置換し、未保存にする | 本文（自動保存に乗る） |
| 全体で置換 | 確認の後、作品のテキストファイルを1つずつ読み、一致があれば `save_text_file` で保存する。終わったら、開いているタブ・索引・アプリの状態へ反映する | 複数のファイル |
| ツリーの見出しを選ぶ | 別のファイルなら開いて、その行へ飛ぶ | なし |
| ツリーの見出しをドラッグで動かす | 移動中の札を立て、関係するファイルを読み（開いているタブは未保存の本文）、移した本文を作り、`save_heading_move` でまとめて保存して反映する | 1〜複数のファイル |
| 見出しを別ファイルへ切り出す | 子階層を含めるかとファイル名を聞き、`extract_heading_to_file` で新しいファイルと元のファイルを保存し、新しいファイルを開き、ツリーを読み直す | 2つのファイル |

### 3. 保存

- 全体の置換は、ファイルを1つずつ `save_text_file` で保存する。全部を戻す仕組みはない。
- 見出しの移動（`save_heading_move`、Rust の `src-tauri/src/lib.rs` 1844行）は、書く前に全部のファイルを読んで控えを取り、どれかの書き込みに失敗したら全部を書き戻す。
- 見出しの切り出し（`extract_heading_to_file`、1900行）は、同じ名前があれば `-2` などを付けた新しいファイルを先に書き、元のファイルを書く。元のファイルに失敗したら、元を書き戻して新しいファイルを消す。
- ツリーの開閉は、アプリの状態の保存に乗る。

### 4. ほかの機能との関係

- 資料のカードを足したとき（2565行）と、プロパティの一覧から値で検索したとき（4898行、`searchByProperty`）に、ビューを切り替えて畳みを解く。
- 上の帯の「左サイドバーを表示」ボタン（10367行）は、左の枠の外にある。
- パンくずのアウトラインのメニュー（10145、10917行）も `jumpToOutlineItem` を使う。
- Zone モードの CSS（`> .leftWorkspaceCluster > .workspaceSidebar`）と UI 表示サイズの CSS が、左の枠の要素の並びを前提にしている。
- プラグイン画面と集中モードでは、左の枠に `aria-hidden` と `inert` が付く。

### 5. 今の挙動の癖（直さない。工程9で実機で確かめる）

1. 左サイドバーのビューと畳んだ状態は、再起動すると戻らない（右サイドバーのタブは戻る）。
2. 全体の置換が途中のファイルで失敗すると、それまでに保存したファイルは置換されたまま残る。開いているタブへの反映は最後にまとめて行うので、失敗したときは、置換済みのファイルを開いているタブが古い本文のままになる（見込み。コードを読んでの推測）。そのタブで編集して保存すると、置換が元に戻る可能性がある。
3. 全体の置換と見出しの移動は、開いているタブの未保存の本文をもとに書く。未保存の編集も一緒に保存される。
4. 全体の置換が失敗すると、今のファイルが置換に関係なくても、保存の印が「エラー」になる。

## 工程3: 依存関係

### A. React に依存しない処理（部品の外）

- `suggestedHeadingFileName`（913行）: 切り出しだけが使う。段階4で一緒に移す。
- 移す関数が使う外の関数は、どれもすでに別のファイルにある（`moveHeadingSections`・`extractHeadingSection`、`replaceMarkdownBodyMatches`、`collectProjectTextFiles`、`upsertProjectAstDocument`、`parseFrontMatter`、`reconcileSavedDocumentTabs`、`findProjectEntry`、`isPathSameOrInside`、`logHeadingDnd`）。移す先で import する。`isTauriRuntime` は、前回と同じく移す先で同じ1行を持つ。

### B. 値（state と ref）。すべて App に残す

工程2の1の表のとおり。どれも App の useState・useRef・useMemo なので動かさない。左の枠の部品には props で、操作のファイルには deps で渡す。

### C. 操作の関数（移す）

- C-1（段階2）: ツリーの開閉3つ。読むのは `projectFolder`、書くのは `setAppState` だけ。
- C-2（段階3）: 検索の結果を開く。`pendingSearchJumpRef`、`openWorkspace`、`handleProjectFileSelect`、`editorInstanceRef`、`jumpToEditorLine` を使う。
- C-3（段階3）: ファイル内の置換と全体の置換。検索の値5つ、`markdown`、`hasPropertyConditions`、`projectSearchOutcome`、`openTabs`、`currentFilePath`、`requestConfirm`、`showToast`、`setActiveMarkdown`、`setSaveStatus`、`setIsProjectReplacing`、`setLastError`、`setProjectAst`、`setOpenTabs`、`setAppState`、`lastSavedMarkdownRef` を使う。
- C-4（段階3）: ツリーの見出しから飛ぶ。`handleProjectFileSelect`、`jumpToEditorLine`、`setFocusedFolderPath` を使う。
- C-5（段階4）: 見出しの移動・切り出し。`headingMoveInProgressRef`、`openTabs`、`setOpenTabs`、`projectFolder`、`currentFilePath`、`setProjectAst`、`setAppState`、`lastSavedMarkdownRef`、`activeTabIdRef`、`editorInstanceRef`、`settings`（書字方向・タイプライターの位置）、`requestChoice`、`requestInput`、`loadDocumentIntoEditor`、`refreshProjectFolder`、`showToast`、`setLastError` を使う。

deps に渡す値は、どれも移す関数の元の位置より前で作られている（いちばん後ろでも `jumpToEditorLine` の 8541行）。

### D. 自動で走る処理（useEffect）

移さない。3611〜3616行の useEffect は、作品が切り替わった後に `searchResultOpenRef.current` を呼ぶ。段階3の後も、App で `searchResultOpenRef.current = handleProjectSearchResultOpen;` を、取り出した後の位置で続けて行う。

### E. 作品を開く経路

触らない。検索の結果を開く処理が `openWorkspace` を呼ぶが、呼び出しだけで、中身は App に残す。

### F. 画面部品への受け渡し（JSX）

左の枠の JSX は、App の値を約78個読む（うち App の関数が約50個）。段階1で、それをそのまま `LeftSidebar` の props にする。`WorkspaceSidebar` へ渡すときのその場で書いた関数（`(path, item) => void handleProjectOutlineJump(path, item)` など）は、部品の中へそのまま移る。

### G. App の外とのやり取り

Rust の命令 `read_text_file`、`save_text_file`、`save_heading_move`、`extract_heading_to_file`、`log_heading_dnd`（確認用ログ、開発時だけ）。命令名と引数は変えない。

### H. App.tsx の文字列を読むテスト

工程1の気づいた点の2のとおり。`test:binder` と `test:v061-plugins` は段階1で読み先を `LeftSidebar.tsx` に変える。正規表現は変えない。

### 結び目

1. 左の枠は App の値を約78個読む。props にすると、つなぎ間違いの余地がその数だけある。
2. 検索の結果を開く処理は、ref を通して useEffect からも呼ばれる。
3. 置換と見出しの移動は、ファイル・タブ・索引・アプリの状態の4か所を続けて書く。順番が変わると、自動保存が古い本文で上書きしうる（切り出しのコメントにある、タブを先に替える理由）。
4. 見出しの移動中の札（ref）は、移動と切り出しの2つで共有する。
5. 確認用ログが `import.meta.env.DEV` を読む。
6. 文字列を読むテストが3本ある（うち1本の目印は動かさない）。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`、新しい `src/components/layout/LeftSidebar.tsx`、`src/workspaceTreeActions.ts`、`src/projectSearchActions.ts`、`src/headingMoveActions.ts`、`package.json`（テストの追加）、`scripts/test-idea-reference-binder.mjs`、`scripts/test-v061-plugin-platform.mjs`、新しいテスト4本。
- 条件しだいで変わる: なし（CSS は、部品が要素を足さないので変えない）。
- 変えない: `WorkspaceSidebar.tsx`、`OpenCardsPane.tsx`、Rust、CSS、保存形式。

### 4-2. まとまりごとの影響

| 段階 | まとまり | 重さ | 理由 |
|---|---|---|---|
| 1 | 左の枠の JSX | 中 | つなぎ間違いは、そのまま違うファイル操作になる。中身の文字は `verify-move` で確かめられるが、props の名前の対応は確かめられない |
| 2 | ツリーの開閉 | 低〜中 | アプリの状態に保存するが、書く所は作品ごとの開閉の一覧だけ |
| 3 | 検索の結果を開く | 中 | ref と useEffect を通る経路がある |
| 3 | 全体の置換 | **高** | 複数のファイルを書く。タブへの反映を間違えると、自動保存が古い本文で上書きしうる |
| 4 | 見出しの移動・切り出し | **高** | 複数のファイルを書き、新しいファイルを作る。札・タブ・表示位置・ツリーの読み直しが絡む |

### 4-3. 機能ごとに起こりうる回帰不具合

| 起こりうること | 今のテストで気づけるか |
|---|---|
| ボタンや操作に違う関数がつながる | なし |
| 左の枠がプラグイン画面・集中モードで隠れない | 文字列だけ（`test:v061-plugins`） |
| 開いているカードのビューが出ない | 文字列だけ（`test:binder`） |
| 開閉が別の作品の一覧に書かれる | なし |
| 別の作品の検索結果を選んでも、切り替えた後に開かない | なし |
| 全体の置換で、タブ・索引・アプリの状態のどれかが古いまま残る | なし |
| 見出しの移動で、移動中の札が下りない（以後ずっと「移動中です」） | なし |
| 切り出しで、新しいファイルが開かない・表示位置が戻らない | なし |
| 見出しの移動後の本文が違う | 実際に動かしている（`test:heading-move`。純粋な部分だけ） |

### 4-4. 今の自動テストの状態

「前」の一式を `5e5ca0e` で動かしている（結果はここに書き足す）。

## 工程5: 案

### 5-1. 方針

前回まで（`docs/IDEA_SEPARATION_PLAN.md`、`docs/PROJECT_ENTRY_ACTIONS_SEPARATION_PLAN.md`、右サイドバー）と同じ線引きにする。

- 値・保存・useEffect・作品を開く経路は App に残す。
- 移すのは引っ越しだけ。中身・文言・条件・順番は変えない。違うのは、App の値を直接見ていた所を props か deps から受け取ることだけ。似た書き方があってもまとめない。
- 新しいファイルに useState・useEffect・useCallback を持ち込まない。
- 段階ごとにコミットとタグを分け、その段階だけを戻せるようにする。

### 5-2. 段階1: 左の枠の JSX を `LeftSidebar.tsx` へ

- 移すもの: 11100〜11317行の `<div className="leftWorkspaceCluster …">` 全体を、`src/components/layout/LeftSidebar.tsx` の `LeftSidebar` 部品へ。右サイドバーと同じく、App では `<LeftSidebar {...{ … }} />` の1か所で呼ぶ。`isProjectSearchMode`（2152行）も、左の枠でしか使わないので部品の中へ移す。
- 残すもの: 上の帯の「左サイドバーを表示」ボタン（10367行）、値と、ビューを替えるほかの機能（2565、4898行）。
- 部品は要素を足さない。DOM の並び（`leftWorkspaceCluster` の次に `editorColumn`）は変わらないので、CSS は変えない。
- 見込み: −190行前後。

### 5-3. 段階2: ツリーの開閉を `workspaceTreeActions.ts` へ

- 移すもの: 9870〜9934行の3つを、`src/workspaceTreeActions.ts` の `createWorkspaceTreeActions({ projectFolder, setAppState })` へ。呼び出しは元の位置に置く。
- 残すもの: 閉じた一覧から Set を作る useMemo 3つ（3333〜3359行）、`handleSetFileProgress`（工程1の気づいた点の2）。
- 見込み: −60行。

### 5-4. 段階3: 検索と置換を `projectSearchActions.ts` へ

- 移すもの: 8606〜8633行と 8637〜8782行（検索の結果を開く、ファイル内の置換、全体の置換、ツリーの見出しから飛ぶ）を、`src/projectSearchActions.ts` の `createProjectSearchActions(deps)` へ。ツリーの見出しから飛ぶ処理は、検索ではないが、同じ範囲に続けて書かれていて、左サイドバーからだけ呼ばれるので一緒に移す。
- 呼び出しは 8606行の位置に置き、その直後に `searchResultOpenRef.current = handleProjectSearchResultOpen;` を残す。
- 残すもの: 検索の結果の組み立て（工程1の気づいた点の5）、`replaceEditorRange`・`revealEditorRange`（校正が使う）。
- 見込み: −140行。

### 5-5. 段階4: 見出しの移動・切り出しを `headingMoveActions.ts` へ

- 移すもの: 8929〜9225行の2つと、部品の外の `suggestedHeadingFileName` を、`src/headingMoveActions.ts` の `createHeadingMoveActions(deps)` へ。呼び出しは 8929行の位置に置く。
- 残すもの: 移動中の札の ref（2037行。ref のまま渡す）、`jumpToOutlineItem`（パンくずも使う）。
- 見込み: −280行。

### 決めてほしいこと

**1. PR の分け方**
- (a) 段階1＋2で1つ、段階3で1つ、段階4で1つの、3つの PR にする。段階3は段階1＋2の PR を main に取り込んでから、そこから始める。
- (b) 4段階を1つの PR にする。
- 勧め: (a)。ファイルに書く処理を変える段階3・4を、それぞれ単独で戻せる。レビューもしやすい。待ち時間を避けたければ、段階3は段階1＋2のブランチの上に重ねて始めてもよい（その場合は PR の取り込み順を守る）。

**2. 段階3・4の、実機での前後の突き合わせ**
- (a) やる。チェックポイントの時点で QA 用アプリを1回 build し、一時ライブラリで決めた操作（ファイル内の置換、全体の置換、同じファイル内と別のファイルへの見出しの移動、複数の見出しの移動、子階層あり・なしの切り出し、同じ名前があるときの切り出し）を流して、できたファイルの中身を記録する。段階3・4の後の QA 用アプリで同じ操作を流し、ファイルの中身を1バイト単位で比べる。画面（開いているタブ、未保存の印、ツリー）も比べる。
- (b) やらない。自動テストと、いつもの実機確認だけにする。
- 勧め: (a)。工程1の気づいた点の3のとおり、ファイルに書く App 側の処理には、今テストがない。移した後に足す自動テストは「移した後の動き」しか見られない。「移す前と同じ」を確かめられるのはこの突き合わせだけ。そのぶん、段階ごとに1時間ほど余計にかかる（「前」の build は段階3・4で使い回す）。

**3. 全体の置換が途中で失敗したときの癖（工程2の5の2）**
- (a) 今回は直さない。手順書と `docs/KNOWN_ISSUES.md` に記録し、別の修正の作業として出す。
- (b) 段階3の後に、同じ PR で直す。
- 勧め: (a)。分離の強みは、中身が同じことを機械的に確かめられること。直すと中身が変わり、2の突き合わせも「違って当然」の所が混じる。

### テストの直し方と足すテスト

- 段階1:
  - `test:binder` と `test:v061-plugins` の読み先を `LeftSidebar.tsx` に変える。正規表現は変えない。
  - 新しい `test:left-sidebar`（`scripts/test-left-sidebar.mjs`）。**つなぎの確認**: esbuild で `LeftSidebar.tsx` を束ねるとき、`WorkspaceSidebar` と `OpenCardsPane` を、受け取った props を記録するだけの代わりの部品に差し替える。App の関数の代わりに、名前ごとに呼ばれたことと引数を記録する関数を渡して描画する。記録した props のその場で書いた関数を1つずつ見本の引数で呼び、正しい名前の App の関数に、正しい引数が届くことを、すべての関数で確かめる。値の props は、App から渡した値がそのまま届くことを確かめる。**描画の確認**: 左端のボタンの `aria-pressed`、ビューごとの中身、畳んだとき、集中モードとプラグイン画面での `aria-hidden` と `inert`、書く画面以外で隠れること。左端のボタンを押したときに、畳みを解いてビューを替えることも、ボタンの `onClick` を呼んで確かめる。
- 段階2: `test:workspace-tree-actions`。作品ごとの一覧に足す・外すこと、ほかの作品の一覧を変えないこと、作品がないときは何もしないこと。
- 段階3: `test:project-search-actions`。`invoke` を、メモリの中のファイルに読み書きする入れ物に差し替える。全体の置換の確認の文（件数と語）、断ったら何も書かないこと、一致のあるファイルだけを保存すること、開いているタブの本文（今のファイルは編集中の本文）を使うこと、タブ・索引・アプリの状態への反映、置換中の印が最後に下りること、失敗したときの保存の印。ファイル内の置換の通知と未保存の印。検索の結果を開く処理で、別の作品の結果なら `pendingSearchJumpRef` に入れて `openWorkspace` を呼び、開けなかったら戻すこと。
- 段階4: `test:heading-move-actions`。`invoke` を同じく差し替え、`import.meta.env.DEV` を `define` で与える。移動中の札（2回目は断る、最後に必ず下りる。失敗したときも）、保存中のタブがあれば断ること、未保存のタブの本文を使うこと、変わったファイルだけを `save_heading_move` に渡すこと、反映、通知の文の3通り。切り出しで、選択と名前を断ったら何もしないこと、名前の候補、新しいファイルを開くこと、元のタブの表示位置とカーソルの位置、ツリーの読み直し。
- 効くことの確かめ: 段階ごとに、移した処理にわざと不具合を2つ入れ、テストが落ちることを見て `git checkout -- <file>` で戻す（段階1なら、たとえば `onRenameEntry` に削除の関数をつなぐ、`onMoveEntry` の引数の順を入れ替える）。

### 進め方とコミットの分け方

段階ごとに次を繰り返す。各段階の始めにタグ `checkpoint/left-sidebar-stage<N>` を打つ。

1. `move-lines.mjs` で移す。`verify-move.mjs` で lost 0、added が import と呼び出しだけであることを確かめる。`symbol-uses.mjs --call-site` で、呼び出し位置より前で使う所がないことを確かめる。
2. App で使わなくなった import を消す。`npx tsc --noEmit`、build、関係するテスト。`file` で CRLF を確かめる。コミット。
3. 回帰テストを足し、わざと入れた不具合で落ちることを確かめる。コミット。
4. PR の区切り（決めてほしいことの1）で、「後」の一式と前後の比較、実機確認、手順書の更新。

実機確認は、段階1＋2では左サイドバーの操作を一通り（ビューの切り替え、畳む・表示、新規ファイル・新規フォルダ、名前の変更・削除・移動・並べ替え、ツリーの開閉と再起動後の復元、検索と結果を開く、置換、見出しの移動と切り出し、開いているカード、プラグイン画面と集中モード）行う。段階3・4では、決めてほしいことの2の突き合わせを加える。

### 見込みと、今回やらないこと

- App.tsx は約670行減る見込み（12,074 → 約11,400行）。段階1＋2で約250行、段階3で約140行、段階4で約280行。はじめに伝えた約860行より少ないのは、検索の結果の組み立て（約200行）と進み具合の保存（約55行）を残すことにしたため（工程1の気づいた点の2と5）。
- やらないこと:
  - 検索の結果の組み立てを移すこと（フックの順番を扱う別の作業になる）。
  - 保存した本文を反映する手順をまとめること（工程1の気づいた点の4）。
  - 工程2の5の癖を直すこと。
  - `WorkspaceSidebar.tsx`（2,574行）の中を分けること。App.tsx の外の作業として、別に候補に挙げる。
  - 左サイドバーのビューと畳んだ状態を保存すること（仕様の変更になる）。

## 工程6: 人の確認

2026-10-24 に決まったこと:

1. PR は3つに分ける（段階1＋2、段階3、段階4）。
2. 段階3・4では、移す前と後の QA 用アプリに同じ操作を流し、できたファイルを1バイト単位で突き合わせる。
3. 全体の置換が途中で失敗したときの癖（工程2の5の2）は、段階3の後に同じ PR で直す。進め方は次のとおり。
   - 先に段階3の分離を終え、分離の突き合わせ（2）をその時点で済ませる。直した後の動きは突き合わせの対象にしない。
   - 直す前に、癖が本当に起きることを、移した後のファイルを動かすテストで確かめる（今は見込み）。そのテストを「今は失敗する」形で書いてから直す（`then-safe-change` の不具合の修正の手順）。
   - どう直すか（失敗したときに、それまでに保存したファイルをタブへ反映するか、全部を元へ戻すか）は、癖を確かめた後に案を出して決めてもらう。
