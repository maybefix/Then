# Idea 分離の手順書

`src/App.tsx`（14,874行）から Idea に関係する処理を切り離すための記録。新機能・保存形式・UI・文言は変えず、今と同じ結果になることを優先する。

- ブランチ: `refactor/idea-separation`
- 戻し先: タグ `checkpoint/before-idea-split`（コミット `f2fcb1c`。中身は main `63c07c7` と同じ）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | Idea 関連コードの調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係の書き出し | 済み（この文書の「工程3」） |
| 4 | 分離した場合の影響範囲 | 済み（この文書の「工程4」） |
| 5 | 分離案 | 済み（この文書の「工程5」） |
| 6 | 人間側の確認 | 済み（2026-10-23。分離案どおり、使われていない処理は案A） |
| 7 | 分離の実施 | 済み（この文書の「工程7」） |
| 8 | 自動テスト | 済み（この文書の「工程8」） |
| 9 | 実機確認 | 済み（この文書の「工程9」） |
| 10 | 完了 | 未着手 |

---

## 工程1: 調査の結果

### Idea のコードがある場所

App.tsx の外にすでにあるもの:

| ファイル | 行数 | 役割 |
|---|---|---|
| `src/components/snippets/IdeaPane.tsx` | 465 | 右サイドバーの一覧・詳細・メニュー・ドラッグ。画面の中だけの状態を持ち、データの変更は全部 App へ頼む |
| `src/components/snippets/QuickIdeaModal.tsx` | 122 | Ctrl+Alt+I の入力窓 |
| `src/components/snippets/IdeaComposerBox.tsx` | 24 | 入力欄の枠 |
| `src/components/binder/BinderPane.tsx` | 88 | IdeaPane へ props を受け渡すだけの古い入口 |
| `src/ideaReferenceModel.ts` | 185 | Idea と資料を混ぜた並び順を整える純粋な処理 |
| `src/types.ts` 14〜157行 | — | 型 |

App.tsx の中にあるもの（約1,500行）は、工程3の表に全部挙げる。

### 気づいた点

1. Idea 本体は `appState.snippets`、スレッド内の並び順は `referenceLayout.ideaThreads` にある。追加や移動のたびに両方を同時に書き換えている。
2. どこからも呼ばれていない Idea の関数が7つある（工程3の C-9）。
3. App.tsx の文字列を直接読むテストがある（工程3の H）。
4. 呼び名が「snippets」（保存名）、「バインダー」（タブ名）、「Idea」（コード）の3つに分かれている。保存形式は変えないので `snippets` の名前は残す。
5. スタイルは `src/App.css` にある。見た目は変えないので対象外。

---

## 工程2: 仕組みの説明

### 言葉

- **状態（state）**: アプリが今覚えている値。画面はこれを見て描かれ、値が変わると描き直される。
- **App.tsx**: アプリ全体の司令塔のファイル。Idea のデータもここが持っている。
- **画面部品（コンポーネント）**: `IdeaPane` のように画面の一部を描くファイル。自分ではデータを持たず、App から「今のデータ」と「変更を頼む関数」を受け取る。この受け渡しを **props** と呼ぶ。
- **正規化**: 保存ファイルを読んだとき、欠けた項目を補ったり壊れた項目を捨てたりして、決まった形に整えること。
- **遅延保存**: 変更のたびにすぐ書かず、0.7秒ほど変更が止まってから書くやり方。続けて打っても書き込みは1回で済む。

### 1. データの形

Idea は「スレッド」という束で整理する。

- **インボックス**: 必ず1つあり、常に先頭にある。未整理メモの受け皿で、削除も名前の変更もできない。ID は `idea-inbox` に固定。
- **通常のスレッド**: 場面・伏線などの話題ごとの束。名前、スター、作成日時、更新日時を持つ。
- **断片（fragment）**: メモ1つ分。本文、作成日時、更新日時、「本文へ挿入済み」の印（used）、Canvas から来た場合はその出どころ（originRef）を持つ。

スレッドの中には、断片のほかに資料ファイル（Reference）へのリンクも並べられる。この「断片と資料が混ざった並び順」は Idea 本体とは別の資料レイアウト（`referenceLayout.ideaThreads`）に入っている。並び順のほうは「断片の ID」と「資料のパス」だけを持ち、本文は持たない。

両者が食い違ったときは、`src/ideaReferenceModel.ts` の `reconcileIdeaThreadLayouts`（並び順の整合処理）が直す。

- 並び順に載っていない断片を、そのスレッドの末尾に足す。
- もう存在しない断片を並び順から外す。
- 同じ資料が二重に載っていたら片方を捨てる。
- 削除されたスレッドに付いていた資料リンクを、インボックスへ移す。
- 作品に取り込まれているのに、どのスレッドにも載っていない資料をインボックスへ足す。

この整合処理は、Idea が変わるたびに App の中で自動的に走る。

### 2. 利用者の操作と内部の処理

**スレッド**

| 操作 | 内部の処理 |
|---|---|
| 「＋スレッド」で作成 | 「新しいスレッド」という名前のスレッドを、インボックスのすぐ後ろに入れる。画面はそのスレッドの詳細に切り替わり、名前欄が選択された状態になる。 |
| 名前の変更 | 詳細画面の名前欄を打ち直すと、1文字ごとに名前が書き換わる。インボックスは変えられない。 |
| スター | スターの有無を反転する。一覧の「スター」フィルタで絞れる（インボックスはフィルタに関係なく常に出る）。 |
| 削除 | 「断片 N 件もまとめて削除されます」と確認する。了承するとスレッドが消え、「元に戻す」付きの通知が出る。元に戻すと元の位置に戻る。 |

**断片**

| 操作 | 内部の処理 |
|---|---|
| 一覧上部の入力欄から追加 | 送り先を選んで Enter（日本語の変換中は反応しない）。どのスレッドでも先頭に入る。並び順の先頭にも同時に入れ、「『○○』に追加しました」と通知する。 |
| スレッド詳細の入力欄から追加 | 同じく先頭に入る。通知は出ない。 |
| 本文の編集 | 本文の欄を直接書き換え、欄から離れた時点で保存する。空にして離れると元の文に戻る。 |
| 別スレッドへ移動 | 移動先の先頭へ移し、並び順も同時に動かす。「元に戻す」で元のスレッドの元の位置へ戻る。移動先が6つより多いと絞り込み欄が出る。 |
| 新規スレッドに移動 | 名前を入力するダイアログ（題「新規スレッドに追加」）を出し、そのスレッドを作って移す。 |
| ドラッグで並べ替え | 日付の行をつかんで同じスレッドの中で動かす。確定するのは落とした時で、上にかざしているだけでは変わらない。変わるのは並び順のほうで、断片本体の配列は動かない。 |
| 削除 | 冒頭36文字を見せて確認する。消した後に「元に戻す」が使える。 |
| カードで開く | 本文の上に浮かぶ「Idea カード」を開く。同じ断片のカードがあればそれを前面に出す。カードの中でも本文を編集できる。 |
| AIに聞く | 右サイドバーを AI に切り替え、本文を AI の入力欄に入れる。送信はしない。 |
| 作品へ／ライブラリへ移動・コピー | ライブラリの中で作業しているときだけ出る（3 の最後）。 |

**スレッドの中の資料**

| 操作 | 内部の処理 |
|---|---|
| クリップ →「ファイルを追加」 | ファイル選択を開き、選んだファイルを作品に取り込み、そのスレッドの並び順の先頭にリンクを入れる。同じ資料がすでにあれば入れない。 |
| クリップ →「新しいテキスト資料」 | ファイル名を聞いて `.txt` / `.md` を作り、そのスレッドに入れる。 |
| 別スレッドへ移動／別スレッドにも追加 | リンクを動かす、または複製する。行き先に同じ資料があれば足さない。新規スレッドを作って移すこともできる。 |
| このスレッドから削除 | ほかのスレッドからも参照されていればリンクを外すだけ。どこからも参照されていなければ「このプロジェクトからの削除になりますが…」と確認して資料ファイルそのものを消す。ファイルが見つからなければ、リンクだけ消してよいかを確認する。 |
| 資料ファイルを削除 | 何個のスレッドから参照されているかを示して確認し、ファイルを消す。すべてのスレッドのリンク、開いているカード、最近使った資料の一覧からも消える。 |
| クリック | 資料カードを開く。左サイドバーは切り替えない。 |

**検索**: スレッド名、断片の本文、資料の名前、テキスト資料の冒頭180文字が対象。テキスト資料の冒頭は、Idea の画面が資料を読みに行って手元に覚えておく。

**Quick Idea**（Ctrl+Alt+I、またはコマンドパレットの「Idea にメモを追加…」）: 右サイドバーを開かずにメモを足す小さな入力窓。最初の送り先はインボックス。Enter で追加して閉じる。追加の中身は一覧上部の入力欄と同じ関数（`captureFragment`）。「AIに聞く」は本文を AI の画面に渡して閉じる。Esc か外側のクリックで、何もせずに閉じる。

### 3. 保存

保存先は設定の「Ideaの管理単位」（内部名 `snippetStorageMode`）で決まる。既定は「作品ごとに分ける」。

| 保存するもの | 作品ごと | 全作品で共有 |
|---|---|---|
| スレッドと断片 | 作品フォルダの `.then/project.json` の `ideaThreads` | アプリ状態ファイルの `profileSnippets` |
| 並び順と、開いている Idea カード | 作品フォルダの `.then/reference-layouts/default.json` | 同じ（並び順は常に作品ごと） |

- 作品ごとに保存しているときも、今の作品の Idea はアプリ状態ファイルの `snippets` に写しとして入る（アプリの状態を丸ごと保存しているため）。起動時に使うのは作品フォルダ側。
- `snippets` は昔の付箋型 Idea の名残の保存名。互換のためそのまま。
- `src/types.ts` のコメントは並び順の保存先を `layout.json` としているが、実際は `default.json`。

**いつ保存するか**

- Idea が変わってから0.7秒後に作品フォルダへ書く（遅延保存）。
- 並び順も0.7秒後に書く。
- 書き込むのは「今の Idea はこの作品から読み込んだものだ」と分かるときだけ（目印は `snippetWorkspacePath`）。作品の切替途中に、前の作品の Idea を新しい作品へ上書きする事故を防ぐため。
- 並び順の整合処理も、その作品の資料レイアウトを読み終えてからしか動かない。読み込みに失敗したら自動保存も止める。

**読み込み・作品切替・起動時の復元**: 作品を開く経路は4つあり、どれも Idea を作品フォルダから読み直す。

1. 起動時に前回の作品を復元する
2. 作品切替の画面で別の作品を選ぶ
3. 別の作品のファイルを開いて、作業中の作品が変わる
4. タブ切替などで作品が変わったのを後から検知する

どの経路も、Idea・プロット・校正辞書・進捗・チェックポイントをひとまとめに読み、まとめて画面へ反映する。

読み込んだデータは正規化する。

- 古い付箋型のデータなら、全部をインボックスの断片に移す。
- 昔のサンプルの Idea（「主人公が改札の前で…」など）が残っていれば捨てる。
- インボックスがなければ作り、複数あれば1つにまとめて先頭に置く。
- Idea が1つもなければ、空のインボックスだけを用意する。

**管理単位を切り替えたとき**: 「作品ごと」にすると今の作品の Idea を作品フォルダから読み込む。「共有」にするとアプリ状態ファイルを読み直して `profileSnippets` を使う。どちらも相互に写しはしない。警告は出ない。並び順への影響は `docs/KNOWN_ISSUES.md` の 2026-10-23 の項。

**別の作品へ移動・コピー**: ライブラリの中で、「作品ごと」のときだけ使える。

- スレッド: ID を振り直したコピーを相手の作品の Idea と並び順へ書く。中の資料も持っていくかを選べる。移動ならこちらから消す。
- 断片: 相手の作品のインボックスの末尾に入れる。

### 4. ほかの機能との関係

- **Reference（資料）**: 並び順の保存先を共有している。Idea から資料を足す・外す・消す処理は、資料側の処理（取り込み、作成、削除）を呼ぶ。資料ファイルを消すと Idea の並び順からもリンクが消える。
- **Idea カード**: 本文の上に浮かぶカードの位置・大きさ・前後関係は、資料カードと同じ一覧（`referenceLayout.cards`）に入っている。断片が消えるとそのカードは自動で閉じる。左サイドバーの「開いているカード」一覧には、スレッド名と本文が出る。
- **Canvas**
  - Ctrl+Alt+B、コマンドパレット、Idea の画面の Canvas ボタンなどから開く。開くときにスレッドと断片の一覧を渡す。
  - 別ウィンドウで開いているときは、Idea が変わってから0.4秒後に最新の一覧を送り続ける。
  - Canvas の「Idea へ送る」は、メインの画面への知らせとして届く。メインの画面は、選ばれたスレッドの**末尾**か新しく作ったスレッドへ断片を足す。出どころを記録し、右サイドバーを Idea に切り替える。
  - Canvas の「元Idea」は、元の断片のあるスレッドを開き、その断片を約2秒強調する。
- **AI**: 「回答を資料に保存する先」の選択肢にスレッドの一覧を使う。保存した資料は、選んだスレッドの先頭に入る。Idea と Quick Idea の「AIに聞く」は、本文を AI の入力欄へ渡すだけ。
- **本文エディタ**: Idea の断片を本文にドラッグしても落とせないようにしてある（`blockIdeaDropOnEditor`）。
- **プロット**: Canvas の「プロットへ送る」は Idea と同じ入口から来るが、Idea のデータには触れない。

### 5. 今の挙動の癖（今回は直さない）

コードを読んだうえでの見込み。工程9で実機確認する。

1. 断片の削除を元に戻すと、断片本体は元の位置に戻るが、並び順からは外れたままなので、整合処理がスレッドの末尾に足し直す。表示上は末尾に戻るはず。並べ替えの「元に戻す」も断片本体の順だけを戻すので、表示順は戻らないはず。
2. スレッドを削除すると、中の資料リンクはインボックスへ移る。削除を元に戻しても資料はインボックスに残る。別の作品へスレッドを「移動」したときも、こちら側では同じことが起きる。
3. メインの画面の Idea を Canvas へドラッグしても、何も起きないように読める。画面には「ドラッグで並び替え / Canvasへ」と出るが、Canvas が受け取るのは本文の文字列で、メインの画面のドラッグは断片の ID しか渡さない。Canvas 自身の側面パネルからのドラッグは本文も渡すので動く。
4. どこからも使われていない Idea の処理が7つある（工程3の C-9）。
5. 「Ideaの管理単位」の切り替えに警告がなく、作品ごとの並び順と資料リンクの所属が崩れる見込み（`docs/KNOWN_ISSUES.md` の 2026-10-23）。

---

## 工程3: 依存関係

表の見方:

- **読む**: その処理が中身を見ている値
- **書く**: その処理が書き換える値
- **呼ばれる**: その処理を呼んでいる場所
- **呼ぶ**: その処理が使っている、ほかの処理
- 行番号は `f2fcb1c` 時点の `src/App.tsx`。

先に、Idea が触る値の一覧を置く。表ではこの名前で書く。

### B. Idea が使う値（state）

| 値 | 中身 | Idea 専用か | 保存先 |
|---|---|---|---|
| `appState.snippets` | 画面に出ている Idea のスレッド一式 | Idea 専用。ただし `appState` 全体の一部で、`setAppState` はほかの機能と共有 | アプリ状態ファイル（丸ごと）。作品ごとのときは `project.json` にも |
| `appState.profileSnippets` | 全作品で共有する Idea | Idea 専用（同上） | アプリ状態ファイル |
| `appState.settings.snippetStorageMode` | 管理単位 | Idea 専用（設定の一部） | アプリ状態ファイル |
| `snippetWorkspacePath` | 今の Idea をどの作品から読んだか。保存してよいかの目印 | Idea 専用 | 保存しない |
| `referenceLayout.ideaThreads` | スレッド内の並び順 | Idea 専用。ただし `referenceLayout` は資料と共有 | `.then/reference-layouts/default.json` |
| `referenceLayout.cards` のうち Idea カード | 浮かぶ Idea カードの位置など | 資料カードと同じ一覧に混ざる | 同上 |
| `isQuickIdeaModalOpen` | Quick Idea を開いているか | Idea 専用 | 保存しない |
| `ideaFocusRequest` | Canvas から「この Idea を見せて」と頼まれた中身 | Idea 専用 | 保存しない |
| `draggingId` | ドラッグ中の断片の ID | Idea 専用 | 保存しない |
| `referenceCandidates` / `sortedReferenceCandidates` | 作品の資料ファイルの一覧 | 資料のもの。Idea は読むだけ | 保存しない（Rust が毎回列挙する） |

### A. React に依存しない処理（App.tsx の外側の階層、または別ファイル）

| 処理 | 場所 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `INBOX_THREAD_ID`、`sampleIdeaThreadIds`、`sampleIdeaFragmentBodies` | 922 | — | — | A の各処理 | — |
| `nextIdeaId` | 934 | ファイル内の連番 `ideaIdCounter` | 連番を1増やす | A の各処理、C-3、C-4、C-6 | — |
| `normalizeIdeaOriginRef` | 939 | 引数 | — | `normalizeIdeaThreads` | — |
| `makeIdeaFragment` | 956 | 現在時刻 | — | `normalizeIdeaThreads`、C-2、C-6 | `nextIdeaId` |
| `makeInboxThread` / `defaultIdeaThreads` | 972 / 1015 | 現在時刻 | — | `normalizeIdeaThreads`、`normalizeState`、`createDefaultState`、`loadWorkspaceSnippets` | — |
| `normalizeIdeaThreads` | 1020 | 引数（保存されていた値） | — | `normalizeState`、`loadWorkspaceSnippets` | 上の4つ |
| `createDefaultState` の Idea 部分 | 1432 | — | — | 起動時 | `defaultIdeaThreads` |
| `normalizeState` の Idea 部分 | 2478 | 保存されていたアプリ状態の `snippets` / `profileSnippets` / `snippetStorageMode` | — | 起動時の読み込み、C-8 | `normalizeIdeaThreads` |
| `loadWorkspaceSnippets` | 2771 | Rust `load_project_snippets` | — | E の4経路、C-7、C-8 | `normalizeIdeaThreads`、`defaultIdeaThreads` |
| `saveWorkspaceSnippets` | 2777 | — | Rust `save_project_snippets`（`project.json`） | D-3、C-7 | — |
| `isIdeaCardRecord` / `normalizeReferenceLayout` の Idea 部分 | 1854 / 1883 | 保存されていた並び順とカード | — | 資料レイアウトの読み込み | `clampReferenceCardToStage` |
| Canvas ボード用の6関数（`listCanvasBoards`、`createCanvasBoard`、`loadCanvasBoard`、`saveCanvasBoard`、`ensureCanvasBoard`、`nextCanvasPlacement`） | 2986〜3052 | Rust の Canvas 系コマンド | Canvas のボード | **C-9 の使われていない関数だけ** | — |
| `ideaReferenceModel.ts` の全関数 | 別ファイル | 引数 | — | App、IdeaPane、OpenCardsPane、CanvasWindowApp | 互いに |
| `threadItemReferencePaths` / `rewriteThreadItems` | `src/utils/libraryTransfer.ts` | 引数 | — | C-7 | — |

### C. 利用者の操作から呼ばれる処理（App の中）

共通して使う App の道具:

- `showToast`（通知）、`requestConfirm` / `setAppDialog`（確認・入力ダイアログ）、`setLastError`（エラーの記録）。どれも App 全体で共有している。
- `updateIdeaThreads`（11452）: `setAppState` で `snippets` を書き換える。共有モードのときは `profileSnippets` も同じ値にする。
- `patchThread`（11467）: スレッドを1つ差し替え、更新日時を今にする。中で `updateIdeaThreads` を呼ぶ。

#### C-1. スレッドの操作

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `createIdeaThread` | 11778 | — | `snippets` | IdeaPane「＋スレッド」 | `nextIdeaId`、`updateIdeaThreads` |
| `renameIdeaThread` | 11925 | — | `snippets` | IdeaPane の名前欄 | `patchThread` |
| `toggleThreadStar` | 11931 | — | `snippets` | IdeaPane のスター | `patchThread` |
| `deleteIdeaThread` | 11935 | `snippets` | `snippets` | IdeaPane の削除 | `requestConfirm`、`updateIdeaThreads`、`showToast`（元に戻す） |
| `requestNewIdeaThreadName` | 11799 | — | `appDialog` | C-2、C-4 | `setAppDialog` |

#### C-2. 断片の操作

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `captureFragment` | 11475 | `snippets` | `snippets`、`referenceLayout.ideaThreads` | IdeaPane の上部入力、QuickIdeaModal | `makeIdeaFragment`、`patchThread`、`makeIdeaItem`、`showToast` |
| `addFragment` | 11497 | — | `snippets`、`referenceLayout.ideaThreads` | IdeaPane の詳細の入力 | 同上（通知なし） |
| `updateFragmentBody` | 11515 | — | `snippets` | IdeaPane の本文欄、ReferenceLayer の Idea カード | `patchThread` |
| `deleteFragment` | 11599 | `snippets` | `snippets` | IdeaPane の削除 | `requestConfirm`、`patchThread`、`showToast`（元に戻す） |
| `moveFragment` | 11632 | `snippets`、`referenceLayout.ideaThreads` | `snippets`、`referenceLayout.ideaThreads` | IdeaPane の移動メニュー | `updateIdeaThreads`、`makeIdeaItem`、`showToast`（元に戻す） |
| `moveFragmentToNewThread` | 11816 | `snippets` | `snippets`、`referenceLayout.ideaThreads` | IdeaPane の「新規スレッドに移動」 | `requestNewIdeaThreadName`、`nextIdeaId`、`reconcileIdeaThreadLayouts`、`makeIdeaItem` |
| `openIdeaBinderCard` | 11546 | `snippets`、`workspaceRef`・`editorShellRef`（画面上の位置） | `referenceLayout.cards` | IdeaPane の「カードで開く」 | `nextReferenceZIndex`、`clampReferenceCardToStage`（どちらも資料カードと共有） |
| `handleFragmentDragStart` / `handleFragmentDragEnd` | 11428 | `snippets` | `draggingId`、ドラッグのデータ（`SNIPPET_DRAG_MIME` に断片 ID） | IdeaPane のドラッグ | — |
| `blockIdeaDropOnEditor` / `isSnippetDragEvent` | 11445 / 11400 | ドラッグのデータ | — | 本文エディタの外枠（13918） | — |

#### C-3. スレッドの中の資料

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `addReferencesToIdeaThread` | 3614 | `appState.snippets` | `referenceLayout`（並び順と最近使った資料） | `handleAddReference`、`handleCreateReference`、AiPane の「資料に保存」 | `reconcileIdeaThreadLayouts`、`makeReferenceLink`、`upsertRecentReferences`（資料） |
| `handleAddReference` | 3646 | `projectFolder` | `referenceCandidates`、`lastError` | IdeaPane のクリップ、資料画面 | Rust `pick_reference_files`、`addReferencesToIdeaThread` か `openReferenceCard` |
| `handleCreateReference` | 3690 | `projectFolder` | `referenceCandidates` | IdeaPane のクリップ、資料画面 | Rust `create_reference_text_file`、同上 |
| `handleDeleteImportedReference` | 3740 | `referenceLayout.ideaThreads` | `referenceLayout`（カード・最近・並び順）、`referenceCandidates` | IdeaPane「資料ファイルを削除」、資料画面 | `countIdeaReferenceLinks`、Rust `delete_imported_reference` |
| `moveIdeaReference` | 3798 | `appState.snippets` | `referenceLayout.ideaThreads` | IdeaPane の資料メニュー | `reconcileIdeaThreadLayouts`、`makeReferenceLink` |
| `moveReferenceToNewThread` | 11871 | `referenceLayout.ideaThreads`、`snippets` | `snippets`、`referenceLayout.ideaThreads` | IdeaPane の資料メニュー | `requestNewIdeaThreadName`、`nextIdeaId`、`reconcileIdeaThreadLayouts`、`makeReferenceLink` |
| `removeIdeaReference` | 3834 | `referenceLayout.ideaThreads`、`referenceCandidates` | `referenceLayout`、`referenceCandidates` | IdeaPane「このスレッドから削除」 | `countIdeaReferenceLinks`、Rust `delete_imported_reference` |
| `reorderIdeaThreadItem` | 3904 | — | `referenceLayout.ideaThreads` | IdeaPane の並べ替え（落とした時） | `ideaThreadItemKey` |

`handleAddReference`・`handleCreateReference`・`handleDeleteImportedReference` は資料の処理で、Idea からも呼ばれている。

#### C-4. Canvas から届く知らせ

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `then-canvas-copy-to-idea` の受け取り | 12119 | 届いた中身 | `snippets`、右サイドバーのタブと開閉、`ideaFocusRequest` | Canvas の「Idea へ送る」 | `nextIdeaId`、`makeIdeaFragment`、`createIdeaOriginRef`、`updateIdeaThreads`、`showToast` |
| `then-canvas-focus-idea` の受け取り | 12190 | 届いた中身 | 右サイドバーのタブと開閉、`ideaFocusRequest` | Canvas の「元Idea」 | — |

この2つを受け取る `useEffect`（12113）は、プロットの `then-canvas-copy-to-plot` の受け取りも一緒に登録している。依存配列は空で、最初の描画のときに1回だけ登録する。

#### C-5. Canvas を開く・Canvas へ送る

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `openIdeaCanvasBoard` | 6166 | `projectFolder`、`settings`、`snippets`、`sortedReferenceCandidates`、右サイドバーの開閉 | `canvasEmbedPayload`、`appMode` | Ctrl+Alt+B、コマンドパレット2件、Idea のヘッダーボタン、新規タブ画面、モード切替（8527）、中間稿画面 | Rust `open_canvas_window` |
| Canvas への最新一覧の送信 | 9897 | `snippets`、`sortedReferenceCandidates` | — | `snippets` が変わるたびに0.4秒後 | `emitTo("idea-canvas", …)` |
| 埋め込み Canvas の `liveIdeaThreads` | 14335 | `snippets` | — | 描画のたび | — |

`openIdeaCanvasBoard` は名前に Idea と付いているが、中身は Canvas 全体を開く処理。Idea 以外の入口からも呼ばれている。

#### C-6. Quick Idea・AI

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| Ctrl+Alt+I | 6603 | キー入力 | `isQuickIdeaModalOpen`、コマンドパレットを閉じる | 本文のキー処理 | — |
| コマンドパレット「Idea にメモを追加…」 | 6919 | — | `isQuickIdeaModalOpen` | コマンドパレット | — |
| Esc で閉じる | 5641 | — | `isQuickIdeaModalOpen` | 画面全体の Esc 処理（ほかのメニューと一緒） | — |
| `handTextToAi` | 8639 | — | フォーカスモード、右サイドバー、`aiInsertRequest` | IdeaPane・QuickIdeaModal の「AIに聞く」、本文の右クリック | — |

`handTextToAi` は AI の処理で、Idea からも呼ばれている。

#### C-7. 別の作品へ移動・コピー

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `ensureIdeaTransferAvailable` | 9291 | `snippetStorageMode` | — | 下の2つ | `showToast` |
| `transferIdeaThread` | 9297 | `snippets`、`referenceLayout.ideaThreads` | 相手の作品の `project.json` と `default.json`、移動ならこちらの `snippets` | IdeaPane の送るボタン | `requestTransferOptions`、`prepareReferenceRewrite`、`threadItemReferencePaths`、`rewriteThreadItems`、`loadWorkspaceSnippets`、`saveWorkspaceSnippets`、`loadReferenceLayout`、`saveReferenceLayout`、`updateIdeaThreads`、`reportTransferError` |
| `transferIdeaFragment` | 9343 | `snippets` | 相手の作品の `project.json`、移動ならこちらの `snippets` | IdeaPane の「その他」メニュー | `requestTransferOptions`、`loadWorkspaceSnippets`、`saveWorkspaceSnippets`、`patchThread` |

`requestTransferOptions`、`prepareReferenceRewrite`、`isExistingReference`、`reportTransferError` は、プロットと資料の移動・コピーと共有している。メニューの文言 `transferMenuLabel`（9158）も共有。

#### C-8. 管理単位の切り替え

| 処理 | 行 | 読む | 書く | 呼ばれる | 呼ぶ |
|---|---|---|---|---|---|
| `handleSnippetStorageModeChange` | 12604 | `projectFolder`、アプリ状態ファイル | 設定、`snippetWorkspacePath`、`snippets` | 設定画面（`FileSettings.tsx`） | `updateSettings`、`loadWorkspaceSnippets`、Rust `load_app_state`、`normalizeState` |

#### C-9. どこからも呼ばれていない処理

| 処理 | 行 | 中身 |
|---|---|---|
| `toggleFragmentUsed` | 11539 | 挿入済みの印を反転する |
| `reorderFragment` | 11737 | 断片本体の配列を並べ替える（今の並べ替えは C-3 の `reorderIdeaThreadItem`） |
| `insertFragmentToEditor` | 11962 | 断片を本文へ挿入する |
| `insertThreadToEditor` | 11972 | 未使用の断片をまとめて本文へ挿入する |
| `openCanvasOrigin` | 11995 | 出どころの Canvas を開く |
| `sendIdeaFragmentToCanvas` | 11999 | 断片を Canvas へ送る |
| `sendIdeaThreadToCanvas` | 12046 | スレッドを Canvas へ送る |

使われていない処理がほかの処理を巻き込んでいる。

- `insertParagraph`（11408）と `markFragmentUsed`（11528）は、上の挿入処理からしか呼ばれていない。
- A の Canvas ボード用の6関数と、`createCanvasTextNode`・`createCanvasGroupNode`・`createCanvasEdge`・`CanvasNode` の読み込みは、上の Canvas 送信からしか使われていない。
- `reorderFragment` の中の通知文「並び順を変更しました」は、テスト（`test:v066-idea`）が App.tsx の中にあることを確かめている。

### D. 自動で走る処理（useEffect）

| 処理 | 行 | 読む | 書く | きっかけ |
|---|---|---|---|---|
| D-1 並び順の整合 | 5013 | `referenceLayout.ideaThreads`、`snippets`、`referenceCandidates` | `referenceLayout.ideaThreads`（変化があるときだけ） | 作品・資料一覧・Idea が変わったとき。資料レイアウトの読み込みが終わった作品のときだけ |
| D-2 消えた Idea のカードを閉じる | 5027 | `snippets`、`referenceLayout.cards` | `referenceLayout.cards` | Idea が変わったとき |
| D-3 作品フォルダへの遅延保存 | 5417 | `snippets`、`snippetWorkspacePath`、`projectFolder`、`snippetStorageMode` | `project.json`（0.7秒後） | Idea が変わったとき。作品ごとのときで、目印が今の作品と一致するときだけ |
| D-4 アプリ状態の遅延保存 | 5379 | `appState` 全体 | アプリ状態ファイル（0.7秒後） | `appState` のどこかが変わったとき。Idea 専用ではない |
| D-5 資料レイアウトの読み込みと遅延保存 | 4948 / 4987 | `projectFolder`、`referenceLayout` | `referenceLayout`、`default.json` | 作品が変わったとき、`referenceLayout` のどこかが変わったとき。資料と共有 |
| D-6 Canvas への最新一覧の送信 | 9897 | C-5 参照 | — | Idea・資料一覧が変わったとき |

### E. 作品を開く経路（Idea の読み込みが混ざっている場所）

| 経路 | 行 | Idea について行うこと | 一緒に行うこと |
|---|---|---|---|
| E-1 `restoreWorkspaceFromState`（起動時の復元） | 5185 | 作品ごとなら `loadWorkspaceSnippets`、共有なら保存されていた `snippets`。`snippetWorkspacePath` を設定 | プロット、校正辞書、無視した指摘、進捗、チェックポイント、タブ |
| E-2 作品の自動検知 | 5469 | `loadWorkspaceSnippets`、`snippetWorkspacePath` を設定 | 同上を `Promise.all` で同時に |
| E-3 `setWorkspaceFromDocumentPath`（ファイルを開いたら作品が変わった） | 7744 | `loadWorkspaceSnippets: true` を指定されたときだけ読む | 同上 |
| E-4 `openWorkspaceFolder`（作品切替の画面） | 8652 | E-1 と同じ | 同上 |
| E-5 `openScratchFromStoredState`（作品なしで開く） | 5158 | `snippetWorkspacePath` を空にする | ほかの作品ごとの値も空に |

どの経路も、最後に1回の `setAppState` で `snippets` とほかの値をまとめて書き換えている。Idea の読み込みだけを取り出すと、この「まとめて1回」が崩れる。

### F. 画面部品への受け渡し（JSX）

| 部品 | 行 | 渡すもの |
|---|---|---|
| `OpenCardsPane`（左の「開いているカード」） | 13783 | `threads={snippets}`、カードの一覧 |
| 本文エディタの外枠 | 13918 | `onDragOverCapture` / `onDropCapture={blockIdeaDropOnEditor}` |
| 新規タブ画面 | 13975 | `onOpenCanvas` → `openIdeaCanvasBoard` |
| 埋め込み `CanvasWindowApp` | 14335 | `liveIdeaThreads`（ID・種類・名前だけ） |
| 右サイドバーのヘッダー | 14385 | `rightSidebarTab === "idea"` のとき Canvas ボタン |
| `AiPane` | 14507 | `threads={snippets}`、`onReferenceSaved` → `addReferencesToIdeaThread` |
| `BinderPane` → `IdeaPane` | 14540 | props 28個（C-1〜C-3、C-6、C-7 のほぼ全部と `draggingId`、`ideaFocusRequest`） |
| `ReferenceLayer`（浮かぶカード） | 14625 | `ideaThreads={snippets}`、`onUpdateIdeaFragment={updateFragmentBody}` |
| `QuickIdeaModal` | 14832 | `threads`、`captureFragment`、`handTextToAi`、閉じる処理 |
| `SettingsModal` → `FileSettings` | 14852 | `onSnippetStorageModeChange` |

右サイドバーでは、`rightSidebarTab` が `"draft"`・`"properties"`・`"proof"`・`"ai"`・`"plot"` のどれでもなく、プラグインの画面でもないとき、残りとして `BinderPane` を出す（14538）。タブの定義は 839（ID `idea`、表示名「バインダー」）。

### G. App の外とのやり取り

| 相手 | 名前 | 向き | 使う処理 |
|---|---|---|---|
| Rust | `load_project_snippets` / `save_project_snippets` | 読む／書く | A の `loadWorkspaceSnippets` / `saveWorkspaceSnippets`（`src-tauri/src/lib.rs:3202`） |
| Rust | `load_app_state` / `save_app_state` | 読む／書く | アプリ状態全体（Idea 専用ではない） |
| Rust | `load_reference_layout` / `save_reference_layout` | 読む／書く | 資料レイアウト（並び順と Idea カードを含む） |
| Rust | `pick_reference_files`、`create_reference_text_file`、`delete_imported_reference`、`transfer_reference_files` | 書く | C-3、C-7 |
| Rust | `read_reference_text`、`read_reference_binary` | 読む | IdeaPane が直接呼ぶ（資料の冒頭と画像のサムネイル） |
| Rust | `open_canvas_window` | — | C-5 |
| Canvas のウィンドウ | `then-canvas-copy-to-idea`、`then-canvas-focus-idea` | Canvas → App | C-4 |
| Canvas のウィンドウ | `CANVAS_LIVE_DATA_EVENT`（宛先 `idea-canvas`） | App → Canvas | D-6 |
| ドラッグのデータ | `application/x-brew-snippet-id` | IdeaPane → Canvas・本文 | App では `SNIPPET_DRAG_MIME`（334）、`canvasTypes.ts` では `IDEA_FRAGMENT_DRAG_MIME` と、同じ文字列を2か所で定義している |

### H. App.tsx の文字列を読んでいるテスト

コードを App.tsx から移すと、中身が同じでも失敗する。

| テスト | 確かめている文字列（App.tsx 内） |
|---|---|
| `test:binder`（`scripts/test-idea-reference-binder.mjs`） | `<BinderPane`、`threadLayouts={referenceLayout.ideaThreads}`、`pick_reference_files`、`addReferencesToIdeaThread`、`items: [...additions, ...layout.items]`、`items: [makeReferenceLink(link.sourcePath), ...layout.items]`、`countIdeaReferenceLinks`、`onMoveReference={moveIdeaReference}`、`moveFragmentToNewThread`、`moveReferenceToNewThread`、`title: "新規スレッドに追加"`、`onReorderItem={reorderIdeaThreadItem}`、`<OpenCardsPane`、`onDragOverCapture={blockIdeaDropOnEditor}`、`onDropCapture={blockIdeaDropOnEditor}`、`setData("text/plain", fragment.body)` が**ない**こと |
| `test:v066-idea`（`scripts/test-v066-idea-ui.mjs`） | `const captureFragment … fragments: [fragment, ...thread.fragments] … items: [makeIdeaItem(fragment.id), ...layout.items]`、`const addFragment …`（同じ形）、`title: "断片を削除"`、`showToast("断片を削除しました", { label: "元に戻す"`、移動の通知、`showToast("並び順を変更しました", …)`（C-9 の `reorderFragment` の中） |
| `test:project-portability`（`scripts/test-project-portability-baseline.mjs`） | `const handleSnippetStorageModeChange` と `const openIdeaCanvasBoard` を、App.tsx の一部を切り出すときの**終わりの目印**に使っている。消したり順番を変えたりすると、切り出す範囲が変わる |
| `test:v058-bundle`（`scripts/test-v058-bundle-splitting.mjs`） | App が `./components/binder/BinderPane` と `./components/binder/OpenCardsPane` を直接読み込んでいること、BinderPane が `../snippets/IdeaPane` を直接読み込んでいること。`lazy(` を使っていないこと |

### まとめ: 切り離すときに引っかかる結び目

1. **`appState` の中にある**: Idea の本体は `appState.snippets` で、`setAppState` はアプリ全体で1つ。保存（D-4）も作品を開く経路（E）も、ほかの値と一緒に1回で書いている。
2. **資料レイアウトの中にある**: 並び順と Idea カードは `referenceLayout` の中にあり、資料の処理と同じ `setReferenceLayout` で書く。資料ファイルの削除（C-3）は Idea の並び順も直す。
3. **1回の操作で2か所を書く**: 追加・移動・新規スレッドへの移動は、`snippets` と `referenceLayout.ideaThreads` を続けて書き換えている。この組を崩すと、整合処理（D-1）が末尾に足し直して表示順が変わる。
4. **App の道具に頼っている**: 通知、確認・入力ダイアログ、エラーの記録、右サイドバーの切り替え、本文エディタの位置（Idea カードを置く場所）。
5. **ほかの機能と共有している処理がある**: 資料の追加・作成・削除、AI に渡す処理、移動・コピーの道具、Canvas を開く処理、Canvas の受け取り（プロットと同じ effect）。
6. **使われていない処理が別の処理を巻き込んでいる**（C-9）。
7. **テストが App.tsx の文字列に依存している**（H）。

---

## 工程4: 分離した場合の影響範囲

どこまで動かすかは工程5で決める。ここでは、工程3の A〜F の「まとまり」ごとに、動かしたら何に響くかを書く。

### 4-1. 変更対象になるファイル

**必ず変わる**

| ファイル | 変わること |
|---|---|
| `src/App.tsx` | Idea の処理を外へ出し、代わりに呼び出す形にする |
| 新しく作るファイル（2〜3個。名前と置き場所は工程5で決める） | 外へ出した処理の置き場所 |
| `scripts/test-idea-reference-binder.mjs` | App.tsx の文字列を確かめている部分（工程3の H）を、移した先のファイルを見るように直す |
| `scripts/test-v066-idea-ui.mjs` | 同上（`captureFragment`、`addFragment`、確認ダイアログと「元に戻す」の文言） |
| `docs/IDEA_SEPARATION_PLAN.md` | この手順書 |

**動かす範囲によっては変わる**

| ファイル | 変わる条件 |
|---|---|
| `scripts/test-project-portability-baseline.mjs` | `handleSnippetStorageModeChange` か `openIdeaCanvasBoard` を App.tsx から出す、または並び順を変える場合。目印が消えると、切り出す範囲が変わってテストが意味を失う |
| `scripts/test-v058-bundle-splitting.mjs` | 新しいファイルを `lazy(` で読む場合（そうしないなら変わらない） |
| `package.json` | 回帰テストを足して `test:` に登録する場合。`scripts/test-idea-composer-state.mjs` はいま登録されていない |

**変えない**（変えたら今回の範囲を超えている）

- Rust 側（`src-tauri/`）: 保存形式も保存の命令も変えない。
- `src/types.ts`: 型の形も名前（`snippets` を含む）も変えない。
- `src/App.css`: 見た目を変えない。
- 画面部品: `IdeaPane.tsx`、`QuickIdeaModal.tsx`、`IdeaComposerBox.tsx`、`BinderPane.tsx`、`OpenCardsPane.tsx`、`ReferenceLayer.tsx`、`AiPane.tsx`、`FileSettings.tsx`。受け取る props は今のまま。
- Canvas 側（`CanvasWindowApp.tsx`、`canvasTypes.ts`）: 送る知らせの名前と中身を変えない。ドラッグ用の文字列が2か所で定義されている件（工程3の G）は、まとめない。
- `src/ideaReferenceModel.ts`、`src/utils/libraryTransfer.ts`: 中身を変えない。

### 4-2. まとまりごとの影響

| まとまり | 動かしたときに起こりうること | 重さ |
|---|---|---|
| A. React に依存しない処理（`nextIdeaId`、`makeIdeaFragment`、`normalizeIdeaThreads` など） | 中身を写し間違えると、読み込み時の正規化が変わる。古い付箋データの移行、サンプルの除去、インボックスを1つにまとめる処理が崩れると、起動時に Idea が消えたように見える。ID の連番（`ideaIdCounter`）が2か所に分かれると、同じ ID ができうる | 高（読み込み） |
| A. `loadWorkspaceSnippets` / `saveWorkspaceSnippets` | 呼ぶ Rust の命令名や引数名を間違えると、保存も読み込みも黙って失敗する。保存の失敗は「ワークスペースのスニペット保存に失敗しました」としか出ない | 高（保存） |
| A. Canvas ボード用の6関数 | 使われていない処理（C-9）からしか呼ばれていない。消すか残すかで、ほかに影響はない | 低 |
| B. 値（state）の置き場所 | `appState.snippets` を App の外の別の値に移すと、アプリ状態の保存（D-4）と作品を開く経路（E）の「まとめて1回」が崩れる。`snippetWorkspacePath` が Idea の読み込みとずれると、**前の作品の Idea を新しい作品に上書きする**。React の共有の仕組み（context）に載せると、Idea を使わない画面まで描き直され、入力の遅れにつながりうる | 高（データ消失） |
| C-1〜C-3. 操作の処理 | `snippets` と `referenceLayout.ideaThreads` の書き換えの組がずれると、表示順が変わる（追加した Idea が末尾に出る、移動した Idea が移動先の末尾に出る、など）。`useCallback` で包んでいる処理（`addReferencesToIdeaThread`、`moveIdeaReference`、`removeIdeaReference`）は、依存の指定を写し間違えると古い Idea を見て並び順を作る。確認ダイアログや「元に戻す」の文言を写し間違える | 中（表示順・資料） |
| C-2. `openIdeaBinderCard` | 本文エディタの位置（`workspaceRef`、`editorShellRef`）を受け取れないと、カードが画面の左上に出る | 低 |
| C-4. Canvas から届く知らせの受け取り | いまはプロットの受け取りと同じ `useEffect` で、最初に1回だけ登録している。分けると登録の順番が変わる。二重に登録すると、Canvas から送った Idea が2回入る。解除し忘れると、作品を切り替えても古い受け取りが残る | 中 |
| C-5. Canvas を開く処理 | `openIdeaCanvasBoard` は Idea 以外（新規タブ、モード切替、中間稿）からも呼ばれる。Idea 側へ移すと、それらの入口が Idea の処理に頼る形になる | 中 |
| C-7. 別の作品への移動・コピー | 移動・コピーの道具（`requestTransferOptions` など）はプロットと資料と共有している。Idea 側だけ移すと、道具を App から渡す必要がある。相手の作品のファイルへ直接書くので、写し間違いは相手の作品のデータを壊す | 高（ほかの作品のデータ） |
| C-8. 管理単位の切り替え | テストの目印（`handleSnippetStorageModeChange`）でもある。中身の写し間違いは、表示する Idea の組の取り違えになる | 中 |
| C-9. 使われていない処理 | 消すと、App.tsx から約300行（巻き込まれている関数を含む）と、Canvas 関係の読み込みが減る。ただし `reorderFragment` の中の文言はテストが確かめているので、テストも直す必要がある。残すなら、移すか App に置いたままにするかを決める | 低（挙動は変わらない） |
| D. 自動で走る処理 | React は、1つの部品の中の `useEffect` を書いた順に動かす。別のファイルの関数（フック）へ移すと、App の中のほかの処理との順番が変わる。並び順の整合（D-1）、資料レイアウトの読み込みと保存（D-5）、Idea の保存（D-3）は互いに関係しているので、順番が変わったときに初回の保存の中身が変わらないかを確かめる必要がある | 中 |
| E. 作品を開く経路 | Idea の読み込みだけを取り出すと、プロットや進捗と一緒に1回で反映していたのが、2回に分かれる。その間に保存（D-3）が走ると、前の作品の Idea が新しい作品に書かれうる | 高（データ消失） |
| F. 画面部品への受け渡し | props の名前や中身を写し間違えると、ボタンを押しても何も起きない。TypeScript の型検査で大半は見つかるが、同じ型の関数の取り違え（`addFragment` と `captureFragment` など）は見つからない | 中 |

### 4-3. 機能ごとに起こりうる回帰不具合

「既存テスト」の列は、今あるテストで気づけるかどうか。「文字列だけ」は、App.tsx の中に特定の書き方があるかを見ているだけで、実際に動かしてはいないという意味。

| 機能 | 起こりうる回帰不具合 | 既存テスト |
|---|---|---|
| スレッドの作成 | インボックスの後ろでなく末尾や先頭に入る。作ったスレッドの詳細が開かない | なし |
| スレッドの名前変更 | インボックスの名前が変えられてしまう。更新日時が変わらない | なし |
| スレッドの削除と元に戻す | 確認なしで消える。元に戻した位置がずれる | なし |
| 断片の追加（一覧・詳細・Quick Idea） | 先頭でなく末尾に出る。並び順と本体の片方にしか入らない。通知が出ない・出すぎる | 文字列だけ |
| 断片の編集（一覧・Idea カード） | 編集が保存されない。空にしたとき元に戻らない | なし |
| 断片の移動と元に戻す | 移動先の末尾に出る。元に戻しても元の位置に戻らない | 文字列だけ（通知の文言） |
| 新規スレッドへの移動 | 断片が元のスレッドにも残る（二重になる） | 文字列だけ |
| 並べ替え | 落としても順番が変わらない。かざしただけで変わる | 文字列だけ（IdeaPane 側） |
| 断片の削除と元に戻す | 確認なしで消える。カードが閉じない | 文字列だけ |
| 資料の追加・作成 | 先頭でなく末尾に入る。同じ資料が二重に入る | 文字列だけ。整合処理だけは実際に動かして確かめている |
| 資料の移動・外す・ファイル削除 | ほかのスレッドが参照しているのにファイルを消す。リンクが残る | 文字列だけ |
| Quick Idea | 開かない。Esc で閉じない。送り先の既定がインボックスでない | なし |
| Idea カード | 開かない、二重に開く、出る位置がずれる。断片を消してもカードが残る | なし |
| AIに聞く／AI の「資料に保存」 | AI の画面に渡らない。保存した資料がスレッドに入らない | なし |
| Canvas を開く | Idea の一覧が Canvas に渡らない | なし |
| Canvas から Idea へ送る／元Idea | 2回入る、入らない。新しいスレッドに名前が付かない。強調表示が出ない | なし |
| 本文へのドロップの禁止 | Idea を本文に落とせてしまう | 文字列だけ |
| 別の作品への移動・コピー | 相手の作品の Idea や並び順を壊す。移動なのにこちらに残る | 道具の関数だけ（`test:library`） |
| 管理単位の切り替え | 取り違えた Idea の組を表示する | なし（設定画面のテストは今、別の理由で失敗している） |
| 作品切替 | **前の作品の Idea が新しい作品に保存される**。Idea が空になる | 文字列だけ（`test:project-portability`） |
| 再起動後の復元 | Idea が空になる。古い形式のデータの移行が崩れる | なし（正規化は App.tsx の中にあり、テストから動かせない） |
| 保存 | 保存されない。保存しすぎて入力が遅くなる | なし |

### 4-4. 今の自動テストの状態（分離前の基準）

`f2fcb1c` で、Idea に関係するテストを動かした結果（Node だけで動き、ブラウザは使わない）。

| テスト | 結果 |
|---|---|
| `scripts/test-idea-reference-binder.mjs`（`test:binder`） | 成功 |
| `scripts/test-v066-idea-ui.mjs`（`test:v066-idea`） | 成功 |
| `scripts/test-project-portability-baseline.mjs`（`test:project-portability`） | 成功 |
| `scripts/test-library-local-state.mjs` / `test-library-transfer.mjs` / `test-library-cross.mjs`（`test:library`） | 成功 |
| `scripts/test-idea-composer-state.mjs`（`package.json` に未登録） | 成功 |
| `scripts/test-settings-modal.mjs` | **失敗**。分離の前から。`BodySettings` が `settings.manuscript` を読むのに、テストの設定データにそれがない。Idea とは関係ない |
| `scripts/test-canvas-board-save.mjs`（`test:canvas-save`） | **失敗**。分離の前から。テストが用意する差し替え部品に `./utils/fontStack` がない。Idea とは関係ない |

`build` と `test:v058-bundle` は工程8でまとめて動かす（`test:v058-bundle` は、先に build しないと古い `dist` を読む）。

**分かったこと**: Idea の操作（追加・移動・元に戻す・保存・読み込み）を実際に動かして確かめるテストは、今は1つもない。実際に動かしているのは、並び順の整合処理、入力欄の枠、移動・コピーの道具だけ。残りは App.tsx の書き方を文字列で見ているだけで、移した先で正しく動くかは分からない。工程8では、少なくとも次を足す必要がある。

1. 読み込み時の正規化（古い形式の移行、サンプルの除去、インボックスを1つにまとめる）を、実際に動かして確かめるテスト。今は App.tsx の中にあって外から呼べないので、外へ出すことでテストできるようになる。
2. 追加・移動・新規スレッドへの移動・元に戻すで、Idea 本体と並び順が同じ順番になることを確かめるテスト。
3. 作品切替のとき、前の作品の Idea を新しい作品へ保存しないことを確かめるテスト（保存の目印 `snippetWorkspacePath` の扱い）。

### 4-5. 影響を小さくするための目安（工程5の材料）

- 重さが「高」のうち、**値の置き場所（B）と作品を開く経路（E）は App に残す**と、データ消失につながる危険をほぼ避けられる。
- 重さが「低」〜「中」で、外へ出すと見通しがよくなるのは、**React に依存しない処理（A）と、操作の処理（C-1〜C-3、C-4）**。
- Canvas を開く処理（C-5）と、移動・コピーの道具（C-7 の共有部分）は Idea 専用ではないので、Idea 側へ移すと逆に結び目が増える。
- 使われていない処理（C-9）を消すかどうかは、挙動に影響しない。テストを1か所直すかどうかの判断になる。

---

## 工程5: 分離案

コードはまだ変えていない。工程6で確認してから工程7に入る。

### 5-1. 方針

1. **値（state）は全部 App に残す。** `appState.snippets`、`referenceLayout`、`snippetWorkspacePath`、`isQuickIdeaModalOpen`、`ideaFocusRequest`、`draggingId` は、今の場所で今のまま持つ。保存（D-3、D-4）と作品を開く経路（E）も App に残す。工程4で「高」とした、データが消える危険を避けるため。
2. **移すのは「引っ越し」だけ。書き換えない。** 処理の中身、文言、条件、順番はそのまま写す。違うのは、App の中の値を直接見ていたところを、引数として受け取るようにする点だけ。新しい共通の部品は作らない（たとえば、5か所にある「インボックスの後ろに入れる」書き方もまとめない）。
3. **新しいファイルには React の仕組みを持ち込まない。** `useState`・`useEffect`・`useCallback` は新しいファイルで使わない。自動で走る処理（D）の実行順も、React が値を覚える順番も、今と変わらないようにするため。

### 5-2. 純粋な処理として別ファイルへ移すもの → `src/ideaThreadModel.ts`（新規）

React にも Tauri にも依存しない、データを作る・整えるだけの処理。今の App.tsx の外側の階層（部品の外）にあるものを、そのまま移す。置き場所は、すでにある `src/ideaReferenceModel.ts` と並べる。

| 移すもの | 今の場所 |
|---|---|
| `INBOX_THREAD_ID` | 922 |
| `sampleIdeaThreadIds`、`sampleIdeaFragmentBodies` | 923〜930 |
| `ideaIdCounter`、`nextIdeaId` | 932〜937 |
| `normalizeIdeaOriginRef` | 939〜954 |
| `makeIdeaFragment` | 956〜970 |
| `makeInboxThread` | 972〜983 |
| `defaultIdeaThreads` | 1015〜1017 |
| `normalizeIdeaThreads` | 1019〜1094 |

- App.tsx からは `import` して使う。ID の連番（`ideaIdCounter`）はこのファイルにだけ置き、App 側には残さない（2つあると同じ ID ができうる）。
- 外から呼べるようになるので、工程8で「読み込み時の正規化」を実際に動かすテストを書ける。

### 5-3. Idea 専用のファイルへ移すもの → `src/ideaThreadActions.ts`（新規）

Idea の操作の処理（工程3の C-1、C-2、C-4 の中身）。`createIdeaThreadActions(deps)` という関数を1つ置き、操作の関数をまとめて返す。App は、今これらの処理が書いてある場所（11400 付近）でこの関数を呼び、返ってきた関数を**今と同じ名前**で取り出す。JSX（画面への受け渡し）は1文字も変えない。

```ts
// App.tsx（イメージ）
const {
  updateIdeaThreads, patchThread, captureFragment, addFragment, ...
} = createIdeaThreadActions({ snippets, referenceIdeaThreads: referenceLayout.ideaThreads, setAppState, ... });
```

**移す処理**

| 処理 | 今の場所 | 工程3 |
|---|---|---|
| `SNIPPET_DRAG_MIME`、`isSnippetDragEvent`、`blockIdeaDropOnEditor` | 334、11400、11445 | C-2 |
| `handleFragmentDragStart`、`handleFragmentDragEnd` | 11428〜11443 | C-2 |
| `updateIdeaThreads`、`patchThread` | 11452〜11473 | 共通の道具 |
| `captureFragment`、`addFragment`、`updateFragmentBody` | 11475〜11526 | C-2 |
| `deleteFragment`、`moveFragment` | 11599〜11735 | C-2 |
| `createIdeaThread` | 11778〜11797 | C-1 |
| `moveFragmentToNewThread`、`moveReferenceToNewThread` | 11816〜11923 | C-2、C-3 |
| `renameIdeaThread`、`toggleThreadStar`、`deleteIdeaThread` | 11925〜11960 | C-1 |
| `CANVAS_NEW_THREAD_TARGET` と、Canvas から届いた「Idea へ送る」「元Idea」を受け取った**後の**処理 | 359、12119〜12197 の中身 | C-4 |

**受け取るもの（deps）**: 今、App の中の値を直接見ているもの。毎回の描画で、その時点の値を渡す（今の書き方と同じ意味になる）。

| 受け取るもの | 使う処理 |
|---|---|
| `snippets`（その描画の時点の Idea） | 本文を探す処理全般 |
| `referenceIdeaThreads`（`referenceLayout.ideaThreads`） | `moveFragment`、`moveReferenceToNewThread` |
| `setAppState`、`setReferenceLayout` | 書き換え全般 |
| `setDraggingId` | ドラッグ |
| `showToast`、`requestConfirm` | 通知、確認ダイアログ |
| `requestNewIdeaThreadName` | 新規スレッドへの移動（関数は App に残して渡す。理由は 5-4） |
| `setRightSidebarTab`、`setIsRightSidebarCollapsed`、`setIdeaFocusRequest` | Canvas からの受け取り |

`showToast` の「元に戻す」ボタンの型（`ToastAction`）は App.tsx の中にしかないので、新しいファイルでは同じ形を書く。`types.ts` は変えない。

**Canvas からの受け取り（C-4）の分け方**: 知らせの受け取りの登録（`listen(...)` と解除）は、App の今の `useEffect`（12113）に残す。プロットの受け取りも同じ場所にあり、最初に1回だけ登録する作りもそのまま。中で行っていた「Idea を足す」「スレッドを開く」処理だけを、`ideaThreadActions.ts` の関数として呼ぶ。今も、最初の描画のときの関数を使い続ける作りなので、意味は変わらない。

### 5-4. App.tsx に残すもの

| 残すもの | 理由 |
|---|---|
| 値（B の全部）と、作品を開く経路（E）、保存と自動で走る処理（D-1〜D-6） | 5-1 の方針1。データ消失を避ける |
| `loadWorkspaceSnippets` / `saveWorkspaceSnippets` | Tauri を呼ぶ。プロットや校正辞書の読み書きと同じ並びに置いてあり、一緒に読む |
| `normalizeState`・`createDefaultState` の Idea 部分 | アプリ状態全体の処理の一部。中で `ideaThreadModel.ts` の関数を呼ぶだけになる |
| `isIdeaCardRecord`、`normalizeReferenceLayout` | 資料レイアウトの読み込みの一部 |
| C-3 の `addReferencesToIdeaThread`、`moveIdeaReference`、`removeIdeaReference`、`reorderIdeaThreadItem` | 資料の処理の並び（3614 付近）にあり、資料の追加・削除から呼ばれる。`useCallback` の依存の指定ごと写すのは、Reference を分けるときにまとめて行うほうが安全 |
| `handleAddReference`、`handleCreateReference`、`handleDeleteImportedReference` | 資料の処理 |
| `openIdeaBinderCard` | 本文の上に浮かぶカードの処理。本文エディタの位置と、資料カード用の部品（`nextReferenceZIndex`、`clampReferenceCardToStage`）を使う。カードの層を分けるときに一緒に扱う |
| `requestNewIdeaThreadName` | App の入力ダイアログの仕組みの一部。テスト（`test:binder`）も App.tsx の中の文言 `title: "新規スレッドに追加"` を確かめている |
| `openIdeaCanvasBoard`、Canvas への最新一覧の送信（C-5） | Canvas を開く処理で、Idea 以外の入口からも呼ばれる |
| `handTextToAi` | AI の処理 |
| C-7 の別の作品への移動・コピー | 移動・コピーの道具をプロットや資料と共有している。ほかの作品のファイルへ直接書くので、今回は動かさない。中で `ideaThreadActions.ts` から受け取った `updateIdeaThreads`・`patchThread` を使う |
| C-8 の `handleSnippetStorageModeChange` | アプリ状態ファイルを読み直す処理。テスト（`test:project-portability`）の目印でもある |
| C-9 の使われていない処理と、それに巻き込まれた処理（`insertParagraph`、`markFragmentUsed`、Canvas ボード用の6関数など） | 5-6 の判断待ち。今回は**触らない**（移しも消しもしない）。中で使っている `patchThread` は、`ideaThreadActions.ts` から受け取ったものに変わるだけ |
| `getEditorView` | Idea の処理の並びにあるが、見出しへの移動（11393）でも使っている |
| JSX の全部 | 画面への受け渡しは、取り出した関数を今と同じ名前で渡すので変わらない |

### 5-5. UI 側（画面部品）へ移すもの

**今回はなし。**

- 画面部品（`IdeaPane`、`QuickIdeaModal`、`BinderPane` など）は、すでに App.tsx の外にある。App に残っているのはデータを変える処理で、画面の部品に持たせると、受け取る props の形が変わる。今回は props の形を変えない。
- 将来の候補として次がある。どれも props か画面の構造が変わるので、今回はやらない。
  - `draggingId`（ドラッグ中の断片）を `IdeaPane` の中だけで持つ。
  - 右サイドバーのヘッダーにある「Idea Board を開く」ボタン（14385）を Idea 側の部品に入れる。
  - `BinderPane` の28個の props を、ひとまとめにして渡す。

### 5-6. 決めてほしいこと: 使われていない処理（C-9）

| 案 | 中身 | よい点 | 気になる点 |
|---|---|---|---|
| **A. 今回は触らない（推す）** | App.tsx に残したまま。使っている `patchThread` の出どころだけ変わる | 今回の変更が「引っ越しだけ」になり、差分を見比べやすい | App.tsx に約300行の使われていないコードが残る |
| B. 分離のあと、別のコミットで消す | 7つの処理と、それにしか使われていない関数・読み込みを消す | App.tsx がさらに約300行減る | `test:v066-idea` は、使われていない `reorderFragment` の中の「並び順を変更しました」と「元に戻す」を確かめている。**今の画面の並べ替え（`reorderIdeaThreadItem`）には「元に戻す」がない**ので、このテストの行を消すと「並べ替えに元に戻すがない」ことを認めることになる。仕様の判断が要る |

**決定（工程6）: A。** A を推すのは、B には仕様の判断（並べ替えに「元に戻す」を付けるかどうか）がついてくるため。分離が終わってから別に決めるほうがよい。

### 5-7. テストの直し方

移した処理の文言は変えないので、テストは「どのファイルを読むか」だけを直す。確かめる中身（正規表現）はそのまま。

| テスト | 直すこと |
|---|---|
| `test:binder` | `moveFragmentToNewThread`・`moveReferenceToNewThread` は App.tsx の JSX に名前が残るので、そのまま通る。`setData("text/plain", fragment.body)` が**ない**ことの確認は、`ideaThreadActions.ts` にも行う（ドラッグの処理がそちらへ移るため） |
| `test:v066-idea` | `captureFragment`・`addFragment`・「断片を削除」・「断片を削除しました」・移動の通知の確認を、`ideaThreadActions.ts` を読むように直す。「並び順を変更しました」は 5-6 が A なら App.tsx のまま |
| `test:project-portability` | 目印の2つ（`handleSnippetStorageModeChange`、`openIdeaCanvasBoard`）は App に残るので、変えない |
| `test:v058-bundle` | `lazy(` を使わないので変えない |

**足すテスト**（工程8）: `scripts/test-idea-thread-actions.mjs` を新しく作り、`package.json` に登録する。

1. `ideaThreadModel.ts` の正規化: 古い付箋データの移行、サンプルの除去、インボックスを1つにまとめて先頭に置く、空のときにインボックスだけを用意する。
2. `ideaThreadActions.ts` の操作: 偽の `setAppState`・`setReferenceLayout` を渡し、追加・移動・新規スレッドへの移動・削除・元に戻す・Canvas からの取り込みで、Idea 本体と並び順が同じ順番になること、通知と確認の文言が今と同じであること。
3. 作品切替のときの保存の目印: 経路（E）は App に残すので、この確認は工程9の実機確認で行う。自動テストで確かめられるのは、今と同じく文字列だけ。

### 5-8. 進め方とコミットの分け方

1. `ideaThreadModel.ts` へ移す → `npm run build`、Idea 関連テストを動かす → コミット
2. `ideaThreadActions.ts` へ移し、Canvas の受け取りの中身を差し替える → `npm run build`、テストを直して動かす → コミット
3. 回帰テスト（5-7 の足すテスト）を書く → コミット
4. 工程8（全体のテスト）、工程9（実機確認）

1つ移すたびに build とテストを動かす。失敗したら、そのコミットだけを戻せる。

### 5-9. 見込み

- App.tsx から約600行が出ていく（`ideaThreadModel.ts` へ約140行、`ideaThreadActions.ts` へ約500行。呼び出しのために App 側に約40行増える）。14,874行が約14,300行になる。
- 変更が App の値の扱いに及ばないので、データの保存先、読み込み、作品切替の流れは変わらない。
- 今回やらないこと: C-3・C-7・`openIdeaBinderCard` の分離（Reference とカードの層を分けるときに）、使われていない処理の削除（5-6）、ドラッグ用の文字列を1か所にまとめること、既知の問題の修正（`docs/KNOWN_ISSUES.md` の 2026-10-23、工程2の 5）。

---

## 工程7: 分離の実施

分離案（工程5）のとおりに行った。中身は変えず、移すだけにした。

| コミット | 内容 |
|---|---|
| `63507e4` | 純粋な処理を `src/ideaThreadModel.ts` へ移す（143行） |
| `8a6bf21` | 操作の処理を `src/ideaThreadActions.ts` へ移す。Canvas の受け取りは、登録を App に残して中身だけを移す。テスト2本の読むファイルを直す |

- `src/App.tsx`: 14,874行 → 14,280行（594行減）
- 移したコードが元と同じであることは、App.tsx から消えた行と新しいファイルの行を突き合わせて確かめた。違うのは次の点だけ。
  - `export` を付けた（`ideaThreadModel.ts` の4つの関数）
  - Canvas の受け取りの中身を関数にしたので、`event.payload` が引数の `request` になり、字下げが2文字浅くなった
  - App.tsx で使わなくなった読み込み（`IdeaFragment`、`Snippet`、`makeIdeaFragment`、`nextIdeaId`、`createIdeaOriginRef`、`makeIdeaItem`、`IdeaThreadItemLink`）を消した
- 型検査（`tsc --noEmit`）と `npm run build` は成功。
- テストの直し方は 5-7 のとおり。`test:v066-idea` の5か所の確認を `ideaThreadActions.ts` を読むように変え、`test:binder` には「本文の文字列をドラッグのデータに入れない」確認を `ideaThreadActions.ts` にも足した。確かめる中身（正規表現）は変えていない。
- 分離後に動かした Idea 関連テスト（`test:binder`、`test:v066-idea`、`test:project-portability`、`test:library`、`test-idea-composer-state`、`test:v065-shell`）は全部成功。
- 本体の JavaScript の大きさ: 分離前 679,306 バイト → 分離後 680,854 バイト（1,548 バイト増）。操作の関数をまとめて返す形にしたため、関数名が圧縮で縮まらなくなった分と見られる。`test:v058-bundle` は、分離前から 500 kB の上限を超えていて失敗している（4-4）。

---

## 工程8: 自動テスト

### 足した回帰テスト

`scripts/test-idea-thread-actions.mjs`（`npm run test:idea-actions`、コミット `18e9c67`）。移した `ideaThreadModel.ts` と `ideaThreadActions.ts` を実際に動かす。App の値の代わりに入れ物を用意し、操作のたびに最新の値で作り直す（App の描画と同じ形）。

- 読み込み時の正規化: 空・壊れた値でインボックスだけを用意する、古い付箋データの移行、サンプルの除去、複数のインボックスを1つにまとめて先頭に置く、欠けた項目の補い、Canvas の出どころの扱い、ID が重ならないこと
- 追加（一覧・Quick Idea・詳細）、本文の編集、別スレッドへの移動と元に戻す、新規スレッドへの移動、断片の削除と元に戻す、スレッドの作成・名前変更・スター・削除と元に戻す、資料リンクを新規スレッドへ移す・足す
- どの操作のあとも、Idea 本体とスレッド内の並び順が食い違わないこと（App の整合処理が直す所がないこと）
- 確認ダイアログと通知の文言
- 管理単位が「共有」のときだけ共有の Idea も書き換えること
- Canvas の「Idea へ送る」「元Idea」
- ドラッグのデータに断片の ID だけを入れること、Idea を本文へ落とせないこと

テストが不具合に気づけることも確かめた。移した処理にわざと2つの不具合（追加した断片を並び順の末尾に入れる、移動を元に戻すと末尾に戻る）を入れると、どちらもテストが失敗した。確かめたあとファイルは元に戻した。

作品切替のときに前の作品の Idea を新しい作品へ保存しないこと（5-7 の3）は、作品を開く経路を App に残したので自動テストでは確かめていない。工程9の実機確認で行う。

### 全体のテスト（分離前と分離後の比べ）

`package.json` の `test:*` を全部動かした。Rust は変えていないので、cargo を使う `test:ai` と `test:sidebar-file-move` は外した。分離前はチェックポイント（`f2fcb1c`）、分離後は `18e9c67`。どちらも先に `npm run build` した（成功）。

| 結果 | テスト |
|---|---|
| 分離前も分離後も成功（62本） | ブラウザで本文やアプリを動かす `test:v070-manuscript-browser`・`test:performance`・`test:heading-dnd-ui` などを含む。Idea と Reference に関係する `test:binder`・`test:v066-idea`・`test:project-portability`・`test:library`・`test:v064-canvas`・`test:v063-draft`・`test:v065-shell` も含む |
| 分離後だけにある（成功） | `test:idea-actions`（今回足したもの） |
| 分離前も分離後も失敗（同じ理由） | `test:canvas-save`（差し替え部品に `./utils/fontStack` がない）、`test:v058-bundle`（本体の JavaScript が 500 kB を超える。分離前 679,306 バイト、分離後 680,854 バイト）、`test:v0511-themes`（朱墨テーマのプロット欄に枠線がある、という確認で失敗） |
| 分離後の一式では止まった | `test:ai-selection`（下に書く） |

**`test:ai-selection` について**: 分離後の一式の2本目で、テスト用の build が終わったあと、テスト用の Edge がいない状態で止まり、CPU を使わないまま待ち続けた。止まったテストのプロセスだけを止めた。そのあと、分離後のコードのまま単独で2回動かすと、2回とも15件すべて成功した（1回目は build から57秒）。分離前の一式でも成功している。止まった原因は分かっていないが、同じ状態では再現しなかった。

アプリが起動することは、内蔵ブラウザでも確かめた（開発版で起動画面から本文の画面まで表示され、コンソールにエラーなし。Quick Idea で断片を足すと「『インボックス』に追加しました」が出た）。

テストのあと、テスト用の node と Edge が残っていないことを確かめた。

`scripts/test-settings-modal.mjs` と `scripts/test-idea-composer-state.mjs` は `package.json` に登録されていないので、一式には入っていない。単独で動かした結果は 4-4 と同じ（設定画面のテストは分離前から失敗、入力欄のテストは成功）。

---

## 工程9: 実機確認

### やり方

- `18e9c67` のコードから、ふだんの Then と別の識別子（`local.then.qa.ideasplit1023`）で QA 用のアプリを build した（`npx tauri build --config`、配布物は作らない）。ふだんの Then と設定・ライブラリを共有しない。
- 一時ライブラリ（作品A・作品B）を scratchpad に作り、作品A に Idea のスレッド2つと Canvas のボード（カード2枚。1枚は作品A の断片を出どころに持つ）を、作品B に別の Idea を入れた。
- WebView2 のデバッグポートから画面を操作した（クリック、文字入力、Enter、Ctrl+Alt+I、マウス操作）。結果は画面と、作品フォルダのファイル（`.then/project.json`、`.then/reference-layouts/default.json`）の両方で確かめた。
- 起動は2回（1回目で操作、2回目で再起動後の復元と管理単位の切り替え）。どちらも終わったあと、QA の Then・WebView2・操作用の node が残っていないことを確かめ、QA アプリのデータフォルダ（`%APPDATA%\local.then.qa.ideasplit1023`、`%LOCALAPPDATA%\local.then.qa.ideasplit1023`）と一時ライブラリを消した。

### 結果

| 確認したこと | 結果 |
|---|---|
| Idea の作成 | 「＋スレッド」でインボックスの直後に「新しいスレッド」ができ、詳細が開いて名前欄が選択された状態になる |
| 名称変更 | 名前欄に打った名前がそのまま一覧に反映される |
| fragment の追加 | 詳細の入力欄から足すと先頭に入り、通知は出ない。一覧上部の入力欄から送り先を選んで足すと、そのスレッドの先頭に入り「『場面』に追加しました」が出る |
| fragment の移動 | 別スレッドへ移すと移動先の先頭に入り、「元に戻す」で元の位置へ戻る |
| fragment の削除 | 「『QA断片2』を削除しますか？」で確認し、「元に戻す」で戻る（戻る位置は下の「今の挙動の癖」1） |
| スレッドの削除 | 「断片 1 件もまとめて削除されます。」で確認し、「元に戻す」で元の位置へ戻る |
| Reference の追加 | クリップ→「新しいテキスト資料」で `.then/references/imports/QA資料.md` ができ、スレッドの先頭に入る。一覧にも資料の件数が出る |
| Quick Idea | Ctrl+Alt+I で開き、送り先はインボックス。Enter で先頭に入り「『インボックス』に追加しました」。Esc では何も足さずに閉じる。本文は変わらない |
| Idea カード | 「カードで開く」でカードが開き、カードで直した本文が Idea の一覧に反映される。同じ断片をもう一度開いてもカードは1枚のまま |
| AI | 「AIに聞く」で右サイドバーが AI になり、入力欄に断片の本文が入る（送信はされない） |
| Canvas | Idea Board を開くと、送信先の選択肢に今のスレッドが並ぶ。カードを「新規スレッド」へ送ると「1 件を Idea へ取り込みました」が出て、ボード名のスレッドがインボックスの直後にでき、そのスレッドが開く。「元Idea」で元の断片のスレッドが開き、その断片が強調される |
| 本文へのドロップの禁止 | Idea のドラッグは本文が受け付けず（`dropEffect: none`）、本文は変わらない |
| 保存 | 画面のスレッド内の並び順と、`project.json`・`default.json` から組み立てた並び順が全スレッドで一致。開いていた Idea カードも `default.json` に残る |
| 作品切替 | 作品A→作品B で作品B の Idea だけが出る。作品B で足した Idea は作品B の `project.json` にだけ入り、作品A の `project.json` は切り替えの前後で同じ。作品A へ戻すと全スレッド・並び順・カードが元のまま |
| 再起動後の復元 | 再起動すると作品A が開き、全スレッドの並び順が再起動前と同じ。Idea カードも開いたまま |

### 今の挙動の癖（工程2の 5）を実機で確かめた結果

どれも分離の前のコードと同じ処理で、今回は直していない。

1. **断片の削除を元に戻すと、表示は末尾に戻る**: 先頭の「QA断片2」を消して元に戻すと、一覧の末尾に出た。見込みどおり。
2. **スレッドを削除すると、中の資料リンクはインボックスへ移る**: 「消す資料.md」を入れたスレッドを消すとインボックスへ移り、スレッドの削除を元に戻してもインボックスに残った。見込みどおり。
3. **メインの画面の Idea を Canvas へドラッグしても何も起きない**: Canvas はドロップを受け付ける（カーソルは「置ける」形になる）が、カードは増えない。ドラッグのデータは断片の ID（`application/x-brew-snippet-id`）だけで、本文の文字列がない。見込みどおり。
4. **「Ideaの管理単位」の切り替え**（`docs/KNOWN_ISSUES.md` の 2026-10-23）: 実機で再現した。下に書く。

**管理単位の切り替え**: 「全作品で共有する」を選ぶと、確認も通知もなく右サイドバーの Idea が共有の組（空のインボックスだけ）に変わり、作品A の `default.json` が次のように書き換わった。

| | インボックス | QAスレッド | 場面・QAボード |
|---|---|---|---|
| 切り替え前 | クイックで追加、インボックスのメモ、[資料] 消す資料.md | [資料] QA資料.md、QA断片1（カードで編集）、QA断片2 | （それぞれの断片） |
| 「共有」にした直後 | [資料] 消す資料.md、[資料] QA資料.md | （並び順ごと消える） | （並び順ごと消える） |
| 「作品ごと」に戻したあと | [資料] 消す資料.md、[資料] QA資料.md、クイックで追加、インボックスのメモ | QA断片2、QA断片1（カードで編集） | 元のまま |

断片そのものは消えなかった（`project.json` の断片の数は切り替えの前後で同じ）。QAスレッドの資料リンクはインボックスへ移ったまま戻らず、インボックスとQAスレッドの並び順も変わった。

### 確認できなかったこと

- 「ファイルを追加」（OS のファイル選択画面を使う）は操作できないので、資料の追加は「新しいテキスト資料」で確かめた。取り込みの処理（`pick_reference_files`）自体は分離で変えていない。
- AI の「資料に保存」は、AI の接続先を設定していないので確かめていない。保存した資料をスレッドに入れる `addReferencesToIdeaThread` は App に残したままで、変えていない。
- 別の作品への移動・コピーは、確かめていない（App に残したままで、変えていない）。
- Canvas を別ウィンドウで開く設定（`canvasOpensInWindow`）は既定のオフのまま確かめた。

### その他

QA 用の build は `src-tauri/target/release/Then.exe` に出る。今そこにあるのは QA 用の識別子で build したものなので、ふだん用の build が必要なときは `npx tauri build` をやり直す。build の途中で `src-tauri/Cargo.toml` の改行が書き換わったので、git の内容に戻した（中身の変更はない）。
