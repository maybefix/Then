# App.tsxの責務マップと分離リスク

作成日: 2026-11-02（日本時間）

分離前の調査対象: `main` / `bf95eb7bc42d7a23e28b0128586051503be31c39` の `src/App.tsx`（8,603行）

## A・Bの実施後（2026-11-02）

Aの小さな計算・モデル補助とBのフォント一覧を分離した。Bは確認1で、state・Effectも専用Hookへ移すことが選ばれた。実施ブランチはcodex/refactor-app-model-fonts、コードの基準は6bcc496。App.tsxは8,603行から8,452行へ151行減った。

| 分離した責務 | 現在の置き場所 | Appに残したこと |
|---|---|---|
| 資料カードのキー・履歴・重なり順 | src/referenceCardModel.ts | カードの操作、state、保存 |
| タブの生成・挿入・閉じたタブの作品判定 | src/editor/documentTabState.ts | タブの選択・開閉・復元、本文保存、state |
| 選択文字数の計算 | src/editor/displayCharacterCount.ts | 選択範囲の取得とステータスへの反映 |
| Canvasの追加位置 | src/canvasPlacement.ts | ボードの取得・更新・保存、Idea連携 |
| フォント一覧の整形と取得 | src/systemFonts.ts | 実行環境の判定関数を渡し、取得関数を一度だけ組み立てる |
| フォント一覧のstate・取得Effect | src/useSystemFonts.ts | 元のフォント取得Effectの位置でHookを呼び、設定画面へ一覧を渡す |

実施・検証は完了。記録はdocs/APP_MODEL_FONTS_SEPARATION_PLAN.mdにまとめた。Canvasの配置補助を呼ぶ2つの操作は現在UIへ接続されておらず、座標自体は単体テスト、実機では現在のドラッグ経路の周辺動作を確認した。未接続の操作は削除していない。以下の配置マップと行番号は、分離前のbf95eb7の調査記録として残す。A・Bの現在の場所は上表を参照し、次の候補はC以降から選ぶ。

App.tsxには、画面部品そのものよりも、**本文・タブ・保存・作品の切り替えをつなぐ処理**が多く残っている。分離前の評価では、小さな計算処理、フォント取得、文書内検索などを着手しやすい候補とした。保存キュー、起動時の復元、作品の切り替え、チェックポイント復元は、更新順序と非同期処理を保つ必要があるため後半に回す。

この資料は、分離する範囲を決めるための整理。後続作業でA・Bを実施した結果を上に追記している。行番号は調査時点のもので、変更後は併記した関数名を検索する。過去の分離計画にある旧行番号・未実施の候補は、現在の配置と区別する。

## 1. リスクの読み方

ここでいうリスクは「分離したときに挙動を崩しやすい度合いと、その影響」。不具合の発生確率や作業時間の見積もりではない。

| 評価 | 判断の目安 | 必要な確認 |
|---|---|---|
| 低 | 引数と戻り値で閉じ、Reactの状態・保存先・実行順序を変えずに移せる | 入出力の比較、型検査 |
| 中 | DOM、フォーカス、限定された状態・Effect・IPCに依存する | 対象操作の回帰確認、表示・フォーカスの確認 |
| 高 | 複数機能の状態、遅延保存、作品の識別、読み込み中の状態に依存する | 複数経路・切り替え中・失敗時の結合確認 |
| 最も高 | 原稿の保存・上書き・復元を扱い、順序や対象を誤ると本文や復旧手段に影響する | 保存中の編集、復元の途中失敗、再起動を含む確認 |

同じ責務でも、**関数を中身そのままで別ファイルに移す場合**と、**state・ref・Effectの所有者まで移す場合**でリスクが違う。以下では必要に応じて分けて記載する。行数が短くても、本文更新の入口などは高リスクになる。

## 2. 上から見た配置マップ

### 2.1 Appコンポーネントの外（1〜1,045行）

| 行 | 処理・目印 | 所属する責務 | 分離リスク |
|---|---|---|---|
| 1〜296 | import | 画面部品、AST、操作ファクトリー、永続化、プラグインなどの接続先 | 移す責務に合わせて整理 |
| 298〜371 | `AppMode`、`EditorFindState`、`DocumentSaveQueue`、`CheckpointLoadResult`など | 定数と型。複数の領域が混在 | 型だけなら低。領域ごとの移動が適切 |
| 373〜452 | `detectPortableProjectConflict`、`detectPortableCheckpointConflict`、エラー文言 | 作品の管理データの競合判定 | 移動は低〜中。判定変更は高 |
| 454〜512 | `directionOptions`、`debugLog`、`EMPTY_WORKSPACE_SEARCH`、`defaultPlotCards` | 記法UI、開発ログ、検索・Plotの初期値 | 低。開発ログはDEV時のみ出す |
| 514〜543 | `createFontOptions`、`fallbackFontOptions` | フォント一覧の整形と代替値 | 低 |
| 546〜604 | `createEmptyDocumentTab`、`insertTabAfter`、`createFileDocumentTab`など | タブ生成・挿入・履歴の判定 | 低〜中。ID生成も含む |
| 606〜648 | `loadWorkspaceDocumentTabs` | 保存されたタブの照合、ファイル読み込み、移動・欠落の集計 | 中。モデル計算とI/Oを区別 |
| 654〜711 | `countDisplayCharacters`、`documentAstToText`、`restoredCopyPath`、`selectedSnapshotFolderTree`、`restoreSnapshotTreeOrder` | 文字数とチェックポイント復元の補助 | 計算は低〜中。並び順の書き込みは高 |
| 714〜746 | `referenceCardKey`、`upsertRecentReference(s)`、`nextReferenceZIndex` | 資料カードのキー・履歴・重なり順 | 低 |
| 748〜777 | `loadStoredState`、`saveStoredState`、`loadSystemFonts` | アプリ状態の読み書き、OSフォント取得 | 中。ブラウザとTauriの分岐あり |
| 779〜831 | `load/saveWorkspaceSnippets`、Plot、校正辞書・無視リストの読み書き | 作品ごとの保存窓口 | 窓口の移動は中。保存契機の移動は高 |
| 833〜957 | `loadWorkspaceFileProgress`、`loadWorkspaceCheckpoints`、`replaceWorkspace*`、`mark*Migration` | 進捗・チェックポイントの移行読み込みと状態の差し替え | 中〜高。読み込み時に移行用データを渡す |
| 959〜976 | `load/saveReferenceLayout`、`listReferenceCandidates` | 資料レイアウトの読み書き・候補取得 | 中 |
| 978〜1,045 | `list/create/load/save/ensureCanvasBoard`、`nextCanvasPlacement` | Canvasの保存窓口・ボード確保・配置 | 窓口は中。配置計算は低 |

### 2.2 Appコンポーネント内（1,047〜7,787行）

範囲は処理のまとまりを探すための目安。同じ責務が複数の範囲に分かれており、この表の連続した行をそのまま切り出せるとは限らない。

| 行 | 処理・目印 | 何をしているか | 分離リスク |
|---|---|---|---|
| 1,047〜1,346 | `appState`、`openTabs`、各種ref、`useAppDialog`、`usePluginHost` | 共有状態、保存・作品切り替えの制御値、UI状態、既存Hookの接続 | 高。全体をまとめて移さない |
| 1,348〜1,818 | `openReferenceCard`、`handleAddReference`、`removeIdeaReference`、`handleReferenceTextSaved`など | Plotの追加、資料カード操作、資料作成・削除、Ideaとのリンク・並び順、本文との同期 | 高 |
| 1,820〜1,913 | `workspaceTabSessionSignature`、`rememberCurrentWorkspaceTabs`、`knownLibraries` | 作品ごとのタブ記憶、最近の作品・ライブラリの表示候補 | タブ記憶は高、表示候補の計算は低 |
| 1,914〜2,167 | `syncDocumentTabToEditor`、`setActiveMarkdown`、`enqueueDocumentSave` | タブ操作、本文の同期、変更記録、タブ単位の保存キュー | 最も高 |
| 2,169〜2,282 | ネイティブ全画面Effect、`activeWorkspaceRootPath`、`useCheckpointStatusInfo` | ホバー表示、全画面制御、ツリー折りたたみの参照、現在作品・保存点の導出 | 中〜高 |
| 2,285〜2,434 | `frontMatter`、`pluginActiveDocumentRef`、`checkpointCurrentProjectFiles`、`activeDocumentAst` | 本文抽出、プラグイン通知、チェックポイント比較用本文、AST・文字数・アウトライン | 高。更新頻度と本文の優先順位に注意 |
| 2,435〜2,661 | `projectSearchOptions`、`libraryCorpus`、`propertySearchOutcome` | 文書・作品・ライブラリの検索、プロパティ検索、検索索引の取得 | 計算は中、索引取得を含めると高 |
| 2,662〜2,738 | `breadcrumbTrail`、`breadcrumbOverflowItems`、`ResizeObserver` | パンくずの階層・省略項目・幅による表示切り替え | 中 |
| 2,739〜2,937 | `sortedReferenceCandidates`、資料読み込み・保存・整合のEffect群 | 最近使った資料の順序、読み込み完了管理、初回サイズ調整、700ms遅延保存、Ideaとの整合 | 高 |
| 2,939〜3,053 | フォルダの折りたたみ初期化、`projectAstBuildIdRef`、`indexFiles` | 作品ASTの構築、編集中本文の反映、12件ごとのまとめ更新、中断管理 | 高 |
| 3,055〜3,264 | `openScratchFromStoredState`、`restoreWorkspaceFromState`、初回Effect | 起動時の保存状態復元、旧作品の扱い、タブ・作品データの反映、起動画面の選択 | 高 |
| 3,266〜3,280 | `loadSystemFonts`を呼ぶEffect | OSフォント一覧取得、失敗時の代替 | 低〜中 |
| 3,282〜3,359 | `schedulePendingSave`を呼ぶEffect群 | アプリ状態、カーソル、Idea、Plot、校正辞書・無視リストの遅延保存 | 高 |
| 3,361〜3,456 | `activeWorkspaceRootPath`に応じた追加読み込み | 開いた文書に合わせた作品データの補完、切り替え世代による古い結果の除外 | 高 |
| 3,458〜3,478 | 本文自動保存Effect | 700ms後に本文を保存キューへ渡す。パス変更中は止める | 最も高 |
| 3,480〜3,543 | タイマー清掃、メニューのフォーカス、外側クリック・Escape | 一時UIとイベント購読の後始末 | 中 |
| 3,545〜3,688 | `handleEditorReady`、`editorMeasureLimit`、`handleBreadcrumbKeyDown`、`scheduleTypewriterScroll` | 選択文字数・カーソル、フォント・幅、パンくずのキー操作、設定変更後のスクロール | 中〜高 |
| 3,689〜3,869 | `handleTextChange`、`updateFrontMatter`、プロパティ型・セット、`handleSelectionChange` | 本文編集の入口、プラグインへの変更通知、前付け編集、プロパティ操作、選択通知 | 本文の入口は最も高。型・セット管理は中 |
| 3,871〜4,057 | `showToast`、`refreshPortableProjectState`、`waitForPortableProjectWrite` | 通知、外部同期後の再読込、巻き戻り・分岐検出、管理データの書き込み制御 | 通知は中、競合制御は高 |
| 4,059〜4,211 | `openIdeaCanvasBoard`、コンテキストメニュー、クリップボード・記法操作の接続 | Canvasを開く、選択の保存、既存操作の呼び出し、パレット後のフォーカス復帰 | 中〜高 |
| 4,213〜4,307 | `openEditorFind`〜`handleEditorFindKeyDown` | 文書内検索バーの開閉、次・前、一件・全件置換 | 中 |
| 4,310〜4,512 | `editorShortcutHandlerRef`、原稿整形、`buildPaletteCommands` | 全体ショートカットの振り分け、プラグインキーとの優先順位、整形の適用、コマンド一覧の接続 | 中〜高 |
| 4,514〜4,690 | `confirmDiscardDirtyWorkspace`、`closeDocumentTabs`、`reopenClosedDocumentTab`、`loadDocumentIntoEditor` | 未保存確認、タブを閉じる・戻す、履歴、文書をエディタへ読み込む | 高 |
| 4,692〜5,007 | `applyCheckpointStoreResult`、`buildManuscriptSnapshot`、`handleCreate/Delete/EditManuscriptSnapshot*` | 保存点の生成・作成・削除・名称編集、管理データとの同期 | 高 |
| 5,009〜5,156 | `setWorkspaceFromDocumentPath`、`refreshProjectFolder` | ファイルを開く・保存する経路から作品を判定し、作品データとタブを切り替える | 高 |
| 5,159〜5,541 | `handleRestoreManuscriptSnapshot`、`*Files`、`*Order` | 全体・選択ファイル・並び順の復元、事前退避、ファイル操作、タブ・ASTの更新 | 最も高 |
| 5,543〜5,720 | フォルダ選択、新規文書、`handleOpenTextFile`、`saveCurrentDocument`、`handleSaveAs` | ファイル・フォルダを開く、新規タブ、手動保存、名前を付けて保存 | 選択UIは中、開く・保存は高〜最も高 |
| 5,722〜5,909 | `handleOpenLinkedExport`、`switchAppMode`、モードメニュー、集中モード | 未保存本文を含む出力元の収集、別窓・埋め込み分岐、モードの選択 | 中〜高 |
| 5,911〜6,225 | `openWorkspaceFolder`、`resolveWorkspaceFolder`、`importProjectIntoLibrary`、`openWorkspace` | 作品の解決・取り込み・切り替え、作品データとタブの復元 | 高 |
| 6,227〜6,411 | `refreshLibraryHome`、`editWorkInfo`、`reorderLibraryProjects` | ライブラリ内の移動、作品の作成・一覧・統計・情報編集・並べ替え | 中〜高 |
| 6,417〜6,673 | `requestTransferOptions`、`prepareReferenceRewrite`、`transfer*` | Plot・Idea・資料の作品間コピー／移動と参照先の書き換え | 高 |
| 6,675〜6,826 | 復元の再試行、`handleProjectFileSelect`、`createPluginHostActions`、Tauriイベント | 文書選択、プラグイン操作の接続、終了前の保存、Canvasへのライブデータ送信 | 高 |
| 6,828〜7,027 | 校正辞書I/O、`createProjectSearchActions`、`createTemplateActions`、`createProjectEntryActions`、`createHeadingMoveActions` | 校正、検索・置換、テンプレート、ファイル管理、見出し移動の既存モジュールへの依存注入 | 高。実処理の多くは分離済み |
| 7,029〜7,426 | `insertParagraph`、Ideaカード・並び順、`createIdeaThreadActions`、`sendIdea*ToCanvas`、Canvasイベント | Idea本文の挿入、使用済み管理、資料ボード・Canvas・中間稿との連携 | 高 |
| 7,428〜7,527 | `updateSettings`、`handleContinueFromPortal`、LibrarySetup関連、旧データ整理Effect | 設定変更、前回作業の再開、ライブラリ準備、廃止データの整理 | 中〜高 |
| 7,531〜7,644 | `scanRecovery`、`restoreRecoveredText`、回復確認Effect | 未保存編集の検出、タブ・チェックポイントへの回復、回復記録の破棄 | 最も高 |
| 7,646〜7,671 | 起動画面の操作、`createWorkspaceTreeActions` | 起動画面から開く、履歴消去、ツリー折りたたみ操作の接続 | 中〜高 |
| 7,673〜7,787 | `handleSetFileProgress`、`handleSnippetStorageModeChange` | 進捗の直列保存、Ideaの作品別／全作品共有の切り替えと保存 | 高 |

### 2.3 JSX（7,789〜8,602行）

表示部品の分離は進んでいる。App側には表示条件、propsの組み立て、操作の結び付けが残る。

| 行 | 表示するもの | 分離時に保つもの |
|---|---|---|
| 7,790〜7,810 | アプリ全体の外観、`WindowControls` | CSS用data属性、ドラッグ領域、全体ref |
| 7,811〜7,869 | `LibrarySetup`、読み込み画面、`StartupPortal`、起動画面の`AppDialogModal` | 準備画面の優先順位、起動画面でも確認ダイアログが使えること |
| 7,871〜7,983 | 上部メニュー、パンくず、`DocumentTabs`、`LeftSidebar` | タブの表示条件、ショートカットとの接続、ツリー操作 |
| 7,984〜8,265 | 文書画面、警告、開始ページ、検索バー、`VerticalTextEditor`、右クリック、`StatusBar` | エディタのkey・ref・revision・位置復元、検索フォーカス、非表示時の保持 |
| 8,268〜8,297 | `CanvasWindowApp`、プラグイン画面の表示先 | Canvasのpayload、中間稿の選択要求、プラグインの表示先ref |
| 8,299〜8,355 | `RightSidebar`、`ThenPluginRuntimeHost`、`ReferenceLayer` | runtimeの配置、props、資料レイヤーの重なり、フォーカス復帰 |
| 8,357〜8,409 | `LinkedExportScreen`、`CheckpointStudio` | 埋め込みの条件、元文書への移動、復元操作の引数 |
| 8,411〜8,597 | 通知、記法・整形・プラグイン・コマンド・Idea・設定・テーマの各ダイアログ、`AppDialogModal` | 選択範囲の保持、設定に戻る動作、Promiseを解決する接続 |

JSXだけを移す場合の目安は「中」。ただし文書画面は、条件分岐やkeyの位置が変わるとエディタが再マウントされ、選択・スクロール・編集中の状態に影響するため「高」と見る。

## 3. すでに分離されている責務

新しい分離先を増やす前に、以下を再利用できるか確認する。ここにある処理を「Appにまだ残っている」と扱わない。

| 責務 | 現在の主な分離先（src配下） | Appに残っていること |
|---|---|---|
| 保存状態の既定値・正規化 | `storedStateModel.ts` | 実際のI/O、読み込み結果を各stateへ反映する順序 |
| ダイアログ | `components/dialogs/useAppDialog.ts`、`AppDialogModal.tsx` | 操作ごとの確認内容、表示位置、回答後の処理 |
| 左右サイドバー・上部・タブ・ステータス | `components/layout/`、`components/status/` | 状態の所有、props、操作・保存への接続 |
| 外観 | `appShellStyle.ts`、`canvasAppearance.ts` | 設定の所有、実測、適用先の選択 |
| エディタ・選択編集・記法・クリップボード | `VerticalTextEditor.tsx`、`editor/selectionEdits.ts`、`editor/editorNotationActions.ts`、`editor/editorClipboardActions.ts` | 本文更新・選択通知の入口、ref、操作の接続 |
| 変更記録・遅延保存の共通機構 | `editor/saveJournal.ts`、`pendingSaves.ts` | タブ別保存キュー、タイマーの登録条件、回復UI |
| 文書・作品AST | `editor/ast/documentAst.ts`、`editor/ast/projectAst.ts` | 再計算の契機、編集中本文の取り込み、非同期構築の寿命 |
| 検索計算・作品検索操作 | `search/editorFindReplace.ts`、`projectSearchActions.ts`、`properties/usePropertyValueIndex.ts` | 検索条件、ライブラリ索引取得、文書内検索バーの操作 |
| ファイル・ツリー・見出し・テンプレート操作 | `projectEntryActions.ts`、`workspaceTreeActions.ts`、`headingMoveActions.ts`、`templateActions.ts` | 依存注入、パス変更中ref、タブ・本文・ASTとの接続 |
| Ideaの基本操作 | `ideaThreadActions.ts`、`ideaThreadModel.ts`、`ideaReferenceModel.ts` | 資料カード、作品間転送、本文挿入、Canvas連携、保存単位切り替え |
| プラグインホスト | `plugins/usePluginHost.ts`、`plugins/pluginHostActions.ts`、`plugins/PluginRuntimeHost.tsx` | 本文・選択イベントの発行、全体キーの優先順位、表示先 |
| コマンド一覧 | `paletteCommands.ts` | 開いた時の選択、操作関数の注入、フォーカス復帰 |
| 出力処理 | `export/exportHostActions.ts`、`export/exportSource.ts`、`components/export/LinkedExportScreen.tsx` | 出力元文書の収集、未保存タブの優先、表示モードの切り替え |
| ライブラリの計算・参照書き換え | `library/libraryData.ts`、`utils/libraryTransfer.ts` | 一覧の取得契機、作品操作、転送の手順と結果反映 |

## 4. 責務ごとの分離候補とリスク

以下のファイル名は**提案**。新規作成済みのファイルではない。App全体を`useApp`に包むよりも、入力・出力・保持する状態を説明できる範囲で分ける。

| 候補 | 切り出す範囲・関連箇所 | 分離先の案 | リスクと理由 |
|---|---|---|---|
| A. 小さな計算とモデル補助 | 資料のキー・履歴・重なり順714〜746、タブの生成・挿入546〜597、文字数654〜657、Canvas配置1,035〜1,045 | 既存の`referenceFileKeys.ts`・`editor/documentTabState.ts`への追加、または用途別のmodel | **低**。順序・既定値・IDの作り方を保持する。チェックポイント補助は別単位にする |
| B. フォント一覧 | 514〜543、769〜777、state1,225、Effect3,266〜3,280 | `app/fontOptions.ts`、`app/useSystemFonts.ts` | **低〜中**。対象が閉じている。名称の整形・並び・取得失敗・アンマウント時の無効化を保つ |
| C. 通知 | `showToast`3,871〜3,884、state1,156〜1,157、timer ref、清掃、通知JSX | `app/useToast.ts` | **中**。`refreshPortableProjectState`3,893〜3,902にも独自の通知処理があり、timerを共有している。通常・操作付き・長時間通知のすべてを扱う |
| D. 文書内検索バー | state1,149〜1,155、導出2,473〜2,488、操作4,213〜4,307、JSX8,126〜8,235 | `search/useEditorFind.ts`、`components/editor/EditorFindBar.tsx` | **中**。検索計算は既存関数を使用。`searchIncludeComments`はサイドバー検索とも共有し、複製しない。置換は既存のエディタ更新経路を通す |
| E. パンくず・メニュー・全画面 | 2,662〜2,738、3,489〜3,543、3,613〜3,655、2,178〜2,224、5,780〜5,909 | パンくず用Hook、`app/useNativeFocusMode.ts`など、操作ごとの単位 | **中〜高**。DOMとフォーカス、全画面要求ID、最大化復帰を扱う。複数のUIを一つのHookへ集めない |
| F. プロパティ型・セット | 3,764〜3,840、辞書I/O6,855〜6,876 | `properties/usePropertyActions.ts`など | **中**。作品切り替え後に旧結果を反映しないことが必要。`updateFrontMatter`は本文更新の窓口として維持 |
| G. ライブラリ一覧・作品情報 | 6,264〜6,411 | `library/useLibraryHome.ts`、`library/libraryActions.ts` | **中〜高**。統計キャッシュ・実行ID・一覧更新・保存がある。`openWorkspace`自体は境界の外に残せる |
| H. 出力画面を開く操作 | 5,722〜5,777、payloadのstate、JSX8,357〜8,378 | `export/openLinkedExport.ts`など | **中〜高**。画面部品とPDF/DOCX処理は分離済み。開いているタブの未保存本文、ファイル順、読めないファイル、YAML検査、別窓設定を保持 |
| I. 作品データのI/O窓口 | 748〜767、779〜976、Canvas978〜1,033 | `app/appStateStore.ts`、用途別のstore | **中（移動のみ）／高（契機も変更）**。React非依存でも、移行・正規化・ブラウザ代替動作を含む。遅延保存Effectは同時に動かさない |
| J. 作品AST・検索索引 | 2,403〜2,434、2,435〜2,661、2,783〜2,797、2,966〜3,053 | `editor/ast/useProjectAst.ts`、`search/useWorkspaceSearch.ts` | **高**。中断・世代・編集中本文の優先・エラー・部分結果を管理。検索、アウトライン、保存点、文字数、応答速度に波及 |
| K. 資料ボードとIdeaの連携 | 1,356〜1,818、2,739〜2,937、7,079〜7,171、7,729〜7,787 | `references/`配下のmodel・actions・保存Hook | **高**。資料の実体、カード、Ideaリンク、並び順、管理単位が結合。まず計算とカード操作、その後にI/O・Effectを分ける |
| L. Idea／Plot／Canvas連携・作品間転送 | 6,417〜6,673、7,041〜7,426、4,059〜4,115、6,805〜6,826 | `library/transferActions.ts`、`canvas/canvasHostActions.ts`など | **高**。複数データを更新し、参照先の書き換え・イベント・別窓・中間稿へ波及。基本Idea操作の分離済み範囲と区別 |
| M. 進捗・保存点の競合制御 | 373〜452、833〜957、3,886〜4,057、4,692〜4,716、7,673〜7,727 | `project/portableProjectModel.ts`、競合管理Hook | **高**。revision/hash、削除済みID、書き込みと再読込の待ち合わせ、世代を一組で保つ。本文保存キューとは別の制御 |
| N. タブ・本文・保存 | 1,820〜1,868、1,914〜2,167、3,292〜3,311、3,458〜3,478、3,689〜3,759、4,514〜4,690、5,647〜5,720 | `editor/useDocumentTabs.ts`、本文保存サービスなど | **最も高**。本文・保存済み本文・revision・ref・変更記録を同期する。タブの計算処理だけの分離から段階化する |
| O. 起動・作品の切り替え | 3,055〜3,264、3,361〜3,456、5,009〜5,147、5,911〜6,225、7,441〜7,491 | `workspace/`配下の読み込み・適用・起動制御 | **高**。複数入口がある。読み込み結果をまとめて作り、作品パス・Idea・Plot・校正・進捗・保存点・タブの反映順を保つ |
| P. チェックポイント作成・復元・未保存編集の回復 | 4,692〜5,007、5,159〜5,541、7,531〜7,637、補助659〜711 | 保存点生成model、保存点actions、回復Hookを別単位に | **最も高**。作成側は未保存タブとAST、復元側は退避・上書き・削除・順序・タブ・ASTを扱う。回復記録の破棄時点も重要 |

### 4.1 小さく始める場合の具体例

最初の候補はAまたはB。実際の状態管理を分ける一歩としてはBが取り組みやすい。

フォント一覧を分ける場合は、入力を「現在の実行環境でOSフォントを取得する関数」、出力を「フォント選択肢の配列」とし、一覧stateと取得Effectをその用途のHookへ移す。Appには、設定画面へ`systemFonts`を渡す接続を残す。縦書き用フォントの計測処理や本文の外観設定は、この分離に含めない。

文書内検索バーを分ける場合は、一致計算・選択移動・置換・入力フォーカス・表示をそろえて扱う。ただし、作品検索やプロパティ検索までまとめない。検索語と検索対象の違いを保ち、既存の`editorFindReplace.ts`を再実装しない。

## 5. 分離前に押さえる状態と順序

### 5.1 同じ情報に見えて役割が違う値

| 値 | 現在の役割 | 分離時の注意 |
|---|---|---|
| `openTabs[].markdown` / `savedMarkdown` / `editorRevision` | タブごとの現在本文・保存済み本文・エディタとの同期識別 | 保存終了を理由に、保存中に増えた編集まで保存済みにしない |
| `appState.markdown` / `activeMarkdownRef` / `activeTabIdRef` / `openTabsRef` | アプリ状態への反映、再描画より前の最新本文、非同期処理から読む現在値 | 「重複している」だけの理由で一方を削除しない。本文とプロパティの連続編集を保つ |
| `lastSavedMarkdownRef` / `didMountEditorRef` | 自動保存の比較基準と、読み込み直後か編集済みかの区別 | タブ切り替えやエディタ準備時の初期化と一緒に扱う |
| `projectFolder` / `openProjectPathRef` / `snippetWorkspacePath` / `plotWorkspacePath` / `proofreadTermsWorkspacePath` | 表示中の作品、保存時に照合する作品、各データの読み込み元 | 読み込み前・切り替え途中に、旧データを新しい作品へ保存しない |
| `referenceLayoutLoadedRootRef` / `referenceLayoutOnDiskRef` / `referenceLayoutFitRoot` | 読み込み成功、保存不要の判定、画面サイズ確定後の初回調整 | 読み込み失敗時に空レイアウトを保存しない。画面サイズ0の間は調整を待つ |
| `workspaceSwitchGenerationRef` / `projectAstBuildIdRef` / `libraryHomeRunRef` | 非同期結果を採用する世代・実行の識別 | 対象のstateとEffectの寿命を合わせる |
| `fileProgressStoreVersionsRef` / `portableProject*Ref` / `deletedCheckpointIdsRef` | 管理データの版・競合・再読込中・変更世代・削除履歴 | 単なるキャッシュではなく書き込み制御の一部として扱う |

### 5.2 本文の変更から保存まで

主な経路は次のとおり。

1. `VerticalTextEditor.onTextChange` → `handleTextChange`（3,689行）。プラグインのアンカー・変更通知を更新し、前付けを保って本文を再結合する。
2. `setActiveMarkdown`（2,049行）。最新本文refを先に更新し、既存ファイルの変更記録、タブ本文、アプリ状態を更新する。プロパティ編集もこの窓口を使う。
3. 自動保存Effect（3,458行）。編集後700msで、タブID・パス・本文・変更記録の位置を保存キューに渡す。
4. `enqueueDocumentSave`（2,086行）→ `saveThroughJournal`。同じタブの保存を直列化し、待機中の要求を最新にまとめる。保存結果と現在本文が一致するときだけ保存済みにする。

保存キューを移す場合、要求時点の本文と変更記録の位置、待っている呼び出しへの結果通知を保つ。手動保存・名前を付けて保存・復元の書き込みには別経路もあるため、自動保存だけの検証では足りない。

### 5.3 遅延保存には二つの仕組みがある

`pendingSaves.ts`に登録する保存と、本文の保存キューを混同しない。

| 仕組み | App内の主な箇所 | 対象 |
|---|---|---|
| `schedulePendingSave` | 2,895〜2,908、3,282〜3,359 | 資料レイアウト、アプリ状態、カーソル、Idea、Plot、校正情報 |
| タイマー → `enqueueDocumentSave` | 3,458〜3,478、2,086〜2,167 | 原稿本文 |
| 直列のPromise列 | 7,673〜7,727 | 作品の進捗。revision/hashを渡す |
| 終了前のイベント | 6,782〜6,790 | `flushPendingSaves()`後に`finish_close_preparation`を呼ぶ |

したがって、`flushPendingSaves()`の呼び出しだけでApp内のすべての保存が同じ仕組みにまとまっているとは扱えない。分離時は、対象の保存がどこに登録され、切り替え・終了で何を待つかを個別に追う。

Idea・Plot・校正情報の遅延保存には、読み込み元のパスの確認と、切り替え時に保存するための条件がある。Effectを移す際には、登録・取り消し・切り替え直前の保存を一緒に確認する。

### 5.4 作品を開く入口は一つではない

| 入口 | 主な経路 | 特に保つ挙動 |
|---|---|---|
| 起動画面を飛ばして起動／前回の執筆を続ける | 初回Effect／`handleContinueFromPortal` → `restoreWorkspaceFromState` | 前回の作品・タブ、旧形式の作品、開けない場合の表示 |
| フォルダを開く／作品一覧から移動 | `openWorkspace` → `resolveWorkspaceFolder` → `openWorkspaceFolder` | 未保存確認、作品判定・取り込み、タブ記憶と復元 |
| 文書を開く／一時文書の保存／名前を付けて保存 | `handleOpenTextFile`・保存操作 → `setWorkspaceFromDocumentPath` | ライブラリ外ファイルの扱い、指定文書と復元タブの統合 |
| 現在文書に応じた補完 | 3,361〜3,456のEffect | 読み込み済み作品との一致、切り替え中の抑止、古い応答の除外 |

`restoreWorkspaceFromState`の3,135〜3,136行と`setWorkspaceFromDocumentPath`の5,069〜5,070行には、作品パスをIdeaなどより先に反映すると、旧Ideaで新しい作品の並び順を作り直すことへの注意が書かれている。**読み込みを待っている途中で一部のstateだけ反映する形に変えない**ことが重要。

これらの経路を将来共通化するなら、「読み込んだ結果を返す処理」と「stateへまとめて反映する処理」に分ける案がある。ただし、各入口の確認ダイアログ・旧作品・ライブラリ外ファイルの扱いは、先に同じだと仮定しない。

### 5.5 復元・回復で保つ順序

チェックポイント復元は「現在の退避を保存 → ファイル／フォルダの復元・必要な削除 → 並び順 → タブ・本文・ASTの更新」という複数段階の処理。全体復元・選択復元・並び順復元で手順が違う。選択復元には上書き・別名コピー・スキップ、移動先の認識もある。

未保存編集の回復には、別タブへ出す経路、チェックポイントへ入れる経路、既存原稿の未保存編集として開く経路がある。既存原稿に戻す場合は`recordRestoredText`（7,590行）を待ち、回復処理の成功後に`discardRecovery`（7,627行）を呼ぶ。この順序を保つ。

## 6. 推奨する着手順

| 順序 | 対象 | その段階の完了目安 |
|---|---|---|
| 1 | Aの小さな計算・モデル補助、Bのフォント一覧 | Appへ逆依存せず、入出力・既定値が同じ。小さな単位で変更を確認できる |
| 2 | Dの文書内検索バー、Cの通知、Fのプロパティ型・セット管理 | state・ref・Effect・清掃を用途ごとにまとめ、Appには接続が残る。共有値を二重管理しない |
| 3 | Eのメニュー・全画面、Gのライブラリ一覧、Hの出力画面を開く操作 | フォーカス・非同期結果・未保存本文・表示条件を維持 |
| 4 | IのI/O窓口、JのAST・索引、K・Lの資料／Idea／Canvasの操作 | I/Oの移動とEffectの移動を分け、パス・世代・保存条件を確認 |
| 5 | Mの競合制御、Nの本文・タブ保存、Oの起動・作品切り替え | 単位ごとに移動し、保存先と更新順序の結合確認を通す。NとOを一度に全面変更しない |
| 6 | Pのチェックポイント復元・未保存編集の回復 | 事前退避、途中失敗、再起動後の回復まで確認 |

各段階で「移動」と「挙動の変更」を別の変更にすると、差分を判断しやすい。`setAppState`を含む全state・全refを一括で渡すだけの巨大なHookやContextは、依存関係の把握を難しくするため、この資料では最初の案にしない。

Appに残す役割の目安は、機能ごとのHook／操作を組み立てること、起動・モード・画面の配置を決めること、機能間の明示的な接続。本文保存や作品データの反映順序などの規則は、対応する責務の中で読める状態を目指す。

## 7. テスト上の制約と分離時の確認

### 7.1 コードを移しただけでも対応が必要なテスト

一部のテストはApp.tsxを文字列として読み、関数名や次の関数の位置で範囲を切り出す。以下はその具体例。網羅的な一覧ではない。

| テスト | 現在の依存 | 関係する候補 |
|---|---|---|
| `scripts/test-checkpoint-comparison.mjs` 31〜35行 | `selectedSnapshotFolderTree`から`restoreSnapshotTreeOrder`直前までを切り出す | Aのうち保存点補助、P |
| `scripts/test-breadcrumb-navigation.mjs` 206〜217行 | `const updateLayout = (width: number)`から`const sortedReferenceCandidates`まで | E |
| `scripts/test-topbar-parts.mjs` 870行以降 | Appの外側クリック・EscapeのEffectを切り出して実行し、開始ページ条件も読む | D・E、JSX |
| `scripts/test-project-portability-baseline.mjs` | 読み込み・進捗・保存点などを開始／終了文字列で切り出し、IPCと状態更新の順序を検査 | I・M・O・P |
| `scripts/test-project-entry-actions.mjs` 792行以降 | Appに残るコールバックの依存配列を目印から取得 | N・O |
| `scripts/test-workspace-document-tabs.mjs` 189行以降 | App内のタブ記憶・復元の呼び出しや通知を検査 | N・O |
| `scripts/test-left-sidebar.mjs`、`test-right-sidebar.mjs` | 保存用setterと復元時setterの出現回数などを検査 | UI状態の所有、O |
| `scripts/test-performance-regressions.mjs`、`test-v058-selection-metrics.mjs`、`test-v061-plugin-platform.mjs` | 本文変更、選択計測、プラグイン通知などの接続をソースで検査 | J・L・N |
| `scripts/test-document-tabs.mjs`、`test-v058-bundle-splitting.mjs` | JSXの位置、import・読み込み方などを検査 | JSX、機能の読み込み |

分離前には、対象名と`App.tsx`を`rg`で検索し、**読む先だけ直すもの／新しい接続を検査するもの／実行結果を確かめるもの**を決める。失敗を避けるためだけにassertionを削除したり、Appと移動先を無条件に連結して接続の欠落を隠したりしない。

### 7.2 候補ごとに使える既存の確認

次のコマンドは現在のpackage.jsonに登録されている。ここでは、将来の分離時に使う候補として挙げる。

| 対象 | 既存の確認コマンド | 別途確認すること |
|---|---|---|
| 共通 | `npm run build` | 読み込み、画面の表示、分離した機能との接続 |
| 文書内検索・記法 | `npm run test:editor-text-edits`、`npm run test:search`、`npm run test:editor-notation-actions` | Ctrl+F、Enter／Shift+Enter、Esc、置換後の本文・カーソル・保存 |
| メニュー・サイドバー・モード | `npm run test:topbar-parts`、`npm run test:breadcrumb`、`npm run test:left-sidebar`、`npm run test:right-sidebar`、`npm run test:v065-shell` | 外側クリック、フォーカス、全画面からの復帰、モード往復 |
| 前付け・プロパティ | `npm run test:frontmatter`、`npm run test:properties-ui`、`npm run test:property-type-store`、`npm run test:property-search` | 本文未編集でプロパティだけ変更した場合、同じフレーム内の連続編集、作品切り替え |
| タブ・本文保存 | `npm run test:document-tabs`、`npm run test:workspace-tabs`、`npm run test:pending-saves`、`npm run test:save-journal-client`、`npm run test:save-journal-splice` | 保存処理中の追加入力・タブ移動・閉じる・保存失敗・名前変更。補助機構の成功だけでAppの保存キュー全体を保証しない |
| 起動・作品切り替え | `npm run test:save-on-work-switch`、`npm run test:startup-idea-order`、`npm run test:project-portability` | すべての入口、読み込み失敗、古い応答、切り替え直前の遅延保存、再起動 |
| 資料・Idea・Canvas・転送 | `npm run test:binder`、`npm run test:idea-actions`、`npm run test:canvas-save`、`npm run test:v063-draft`、`npm run test:library` | 資料削除、Idea管理単位切り替え、別窓の送受信、参照先の書き換え、途中失敗 |
| ファイル・見出し操作との接続 | `npm run test:project-entry-actions`、`npm run test:heading-move-actions`、`npm run test:project-search-actions` | 開いている／保存中の文書の移動・名前変更、見出し移動後の本文とAST |
| チェックポイント・回復 | `npm run test:checkpoint`、`npm run test:checkpoint-diff`、`npm run test:checkpoint-ui`、`npm run test:project-portability` | 全体・一部・順序の復元、退避失敗、途中失敗、未保存タブの保護、回復成功後の記録破棄 |
| AST・選択・プラグイン | `npm run test:performance`、`npm run test:v058-selection`、`npm run test:plugin-host`、`npm run test:v061-plugins` | 日本語入力、長文、入力中の索引構築、選択通知、アンカーの移動、二重通知 |
| 出力 | `npm run test:export`、`npm run test:frontmatter-export` | 未保存タブを含む複数文書、読込失敗、埋め込みと別窓、出力元へ戻る |

`test:save-on-work-switch`と`test:startup-idea-order`はApp全体をブラウザで動かし、Rustの代わりに保存先を記録する仕組みを使う。保存先や起動順序の確認に使えるが、Tauri実機のI/O・終了・別窓の確認は別に必要。

### 7.3 この資料作成で確認した範囲

- App.tsxの構文上の関数・Hook・JSXの位置、関連モジュール、package.json、代表的なテストのソースを照合した。
- 既存の分離計画は、現在のコードと照合する参考資料として読んだ。過去のテスト成功・失敗を現在の結果として転記していない。
- 実装変更、ビルド、自動テスト、Tauri実機確認は行っていない。この資料のリスク評価はコードの依存関係からの判断。

## 8. 関連資料

既存の手順書は、その作業時点の詳細を知るために使う。現在の場所と新しい分離候補は、この資料と現行コードを基準にする。

- `docs/APP_STATE_NORMALIZE_SEPARATION_PLAN.md`: 正規化と読み書きの線引き。
- `docs/APP_DIALOG_SEPARATION_PLAN.md`: ダイアログの状態管理とPromiseの扱い。
- `docs/PROJECT_ENTRY_ACTIONS_SEPARATION_PLAN.md`: パス変更とタブ・本文・ASTの接続。
- `docs/PLUGIN_HOST_SEPARATION_PLAN.md`: ホストの状態・操作とApp側の通知の線引き。
- `docs/EDITOR_TEXT_EDITS_SEPARATION_PLAN.md`: 文字列の計算とエディタ操作の線引き。
- `docs/SAVE_ON_WORK_SWITCH_FIX_PLAN.md`: 切り替え直前の遅延保存。
- `docs/STARTUP_IDEA_ORDER_FIX_PLAN.md`: 起動時の作品データ反映順。
- `docs/ANCHOR_SAVE_ON_CLOSE_FIX_PLAN.md`: 終了前の遅延保存。
- `docs/PROJECT_PORTABILITY_IMPLEMENTATION_PLAN.md`: 作品内の管理データと競合制御。
