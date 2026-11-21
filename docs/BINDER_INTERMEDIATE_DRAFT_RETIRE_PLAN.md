# 中間稿の退役（BINDER 4-4b）の手順書

中間稿専用の保存と版管理（`.then/boards/.intermediate-drafts/`、`save_intermediate_draft`／`load_intermediate_draft`）と、その画面（右サイドバーの「中間稿」ペイン、Canvas の「稿」ボタン、別ウィンドウの横のパネル）をなくす。既存の中間稿は、ボードごとに最新版を素材のノート「（ボード名）の中間稿」へ移し、`.then/boards/.intermediate-drafts/` はバックアップしてから消す。中身は [BINDER_REBUILD_PLAN.md](BINDER_REBUILD_PLAN.md) の 3.4 の最後の2項目（D-6）と 4-4b。

変えないもの: 「この順で原稿を作る」（4-4）の画面と動き（並べ替えの一覧・初期の順序・除外・作る先・カードごと・1本につなげる・元に戻す）。ボードの保存形式（`.canvas`）、ボードのゴミ箱の形（`.trash/<日時>--<ID>.canvas`）、ファイルのカード（4-2）、Plot・Idea の移行（1-6・2-4）。コピーカードの移行（4-5）には手を付けない。画面に説明の文は足さない。

- ブランチ: `feat/binder-retire-intermediate-draft`
- 戻し先: タグ `checkpoint/before-binder-retire-intermediate-draft`（コミット `3a559a0`。中身は main `6d8a5ad` と同じ）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み（2026-11-21） |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 待ち |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

### 前提の確かめ

- 4-4（PR #71）は main に merge 済み（merge コミット `6d8a5ad`、`origin/main` と一致）。作業はそこから切ったブランチで行う。
- 行番号は、とくに書かない限り `6d8a5ad` の時点のもの。

### コードがある場所

| ファイル | 行数 | 関係するところ |
|---|---|---|
| `src/intermediateDraft.ts` | 88 | 型（`DraftBoard`・`DraftCanvasContext`・`DraftCapture`・`DraftVersion`・`DraftHistory`）、`draftBoardKey`（28〜30行）、`captureDraft`（33〜57行。4-4 も使う）、`generateDraft`（59〜73行。中間稿だけ）、`moveDraftCard`・`toggleDraftCard`（75〜88行。4-4 も使う） |
| `src/intermediateDraftStore.ts` | 167 | 中間稿の保存の仕組み。ボードの一覧と読み込み（ペイン用）、`DraftSession`（400ms 遅れの保存、版の競合の検出、終了前の一時保存 `then.draft-recovery.<窓の名前>.<ボードの鍵>`）、`flushDraftBoard`（送る前に保存を済ませる）、`prepareDraftBoardTrash`（ボードをゴミ箱へ移す前に保存を済ませる）、閉じる前の確認（`beforeunload`） |
| `src/components/canvas/IntermediateDraftPane.tsx` | 238 | 中間稿のペイン。ボードの選択と「開く」、版の選択、「取得／再取得」、タブ「並べ替え」「テキスト」、「テキストを生成」、本文の編集（最新版だけ）、「コピー」「書き出し」（`save_submission_text_dialog` で `中間稿-v<版>.txt`）、保存の失敗・競合の表示と「再試行」「保存版を読み直す」 |
| `src/components/canvas/intermediateDraft.css` | 97 | ペインの見た目。並べ替えの一覧の規則（37〜72行）は 4-4 の画面も使う（`.intermediateDraftPane` の下に書いてあるため、4-4 の画面にも `intermediateDraftPane` のクラスが付いている） |
| `src/components/canvas/DraftOrderList.tsx` | 82 | 並べ替えの一覧（4-4 で切り出した）。ペインと 4-4 の画面の両方が使う。`onSelect`（行の抜粋を押すとカードを選ぶ）はペインだけが渡す |
| `src/components/canvas/CanvasToManuscriptDialog.tsx` | 87 | 4-4 の画面。`DraftOrderList` と `intermediateDraft.css`、型 `DraftCapture` を使う |
| `src/canvasToManuscript.ts` | 144 | 4-4 の処理。`captureDraft` を使う（`captureManuscriptCards`、48〜52行） |
| `src/canvasBoardStore.ts` | — | ボードのゴミ箱へ移す `trashBoard`（306〜330行。先に `prepareDraftBoardTrash`。ブラウザ版はゴミ箱の項目に `draft` を入れ、`then.draft.*` を消す）、戻す `restoreTrashedBoard`（376〜379行。ブラウザ版は `draft` を新しい ID で戻す）、型 `LocalTrashedCanvasBoard.draft`（36行） |
| `src/CanvasWindowApp.tsx` | — | import（79・81・92行）、props `onDraftCanvasChange`・`draftSelectRequest`・`onDraftSelectionConsumed`・`onOpenDraft`（932〜935・954〜957行）、ペインへ今のボードを知らせる（1055〜1059行）、`selectDraftNode` とその要求の受け口（1060〜1073行）、`isDraftPanelOpen`（1029行）、送る `submitTransfer`（2252〜2341行のうち 2266行の `flushDraftBoard`、2316〜2328行の中間稿の写し）、「稿」ボタン（3399〜3403行）、パネルの切り替え（3422・3464行）、別ウィンドウの横のパネル（4007〜4014行）、送る画面の注記「中間稿もボードと一緒に送ります。」（4146行） |
| `src/App.tsx` | — | import（298行）、`draftCanvasContext`・`draftSelectRequest`・`hasOpenedDraft`（1162〜1165行）、作品を切り替えたときに消す（6276〜6277行）、埋め込みの Canvas へ渡す（7863〜7866行）、右サイドバーへ渡す（7902〜7903行） |
| `src/components/layout/RightSidebar.tsx` | — | import（2・19行）、タブ「中間稿」（79〜88行）、props（115〜118・165行）、ペインの置き場 `draftPaneHost`（255〜261行。一度開いたら隠しても残す） |
| `src/utils/rightSidebarState.ts` | — | 保存できるタブの一覧に `"draft"`（1行） |
| `src-tauri/src/intermediate_draft.rs` | 323 | `load_intermediate_draft`・`save_intermediate_draft`（版の検査、`v<版>.txt` と `history.json` の書き込み）、`move_board_with_draft`（ボードと中間稿を一緒に動かし、失敗したら戻す）、Rust のテスト4つ |
| `src-tauri/src/lib.rs` | — | `mod intermediate_draft`（16行）、命令の登録（788〜789行）、`trash_canvas_board`（3883〜3910行。中間稿を `.trash/<日時>--<ID>.draft` へ）、`restore_canvas_board`（3958〜4004行。中間稿を新しい ID で戻す） |
| `src/plotMigration.ts`・`src-tauri/src/plot_migration.rs` | 99・227 | 1-6 の移行（手本）。`note_folder`（素材フォルダ、なければ「素材」を作る。ライブラリ直下は直下）、`write_note`（同じ名前は `-2`、同じ中身のノートがあればそれを使う）、`backup_stamp`、`write_new_file` |
| `src/ideaMigration.ts`・`src-tauri/src/idea_migration.rs` | 215・820 | 2-4 の移行（手本）。`.then/backups/idea-<日時>/` に `.then/boards` をまるごと写して確かめる（`copy_tree_verified`）。中間稿もこのバックアップに入っている（2-4 のあとに作った中間稿は入っていない） |
| `src/App.tsx` の `migratePlotBeforeOpening` | 2760〜2780行 | 起動時（ライブラリ直下と全作品、2795〜2802行）と作品を開いたとき（3039・4754・5669行）に、Plot → Idea の順に移し、まとめて1つの通知を出す |

### 保存されているもの（中間稿）

- 作品の `.then/boards/.intermediate-drafts/<ボード ID>/history.json`（版の一覧。版ごとにカードの写し・順序・除外・本文・日時）と `v1.txt`、`v2.txt` …（版ごとの本文。外で読むため。Then は読まない）。
- ゴミ箱へ移したボードの中間稿: `.then/boards/.trash/<日時>--<ボード ID>.draft/`（中身は同じ形）。ゴミ箱のボードは完全に消す操作がないので、ずっと残る。
- 終了前の一時保存: localStorage の `then.draft-recovery.<窓の名前>.["project","<作品のパス>","<ボード ID>"]`（`{ history, expectedRevision }`）。保存が済めば消える。保存の前に窓が閉じたときだけ残る。
- ブラウザ版（開発用）だけ: localStorage の `then.draft.<ボードの鍵>` と、ボードのゴミ箱の項目の `draft`。
- 作品の外（ライブラリの共通 Canvas）の中間稿は v0.6.6 で消えた（`canvas_boards_dir` は `global` を受け付けない）。

### 気づいた点

- ペインは作品のボードしか出さない（`listDraftBoards("project", …)`）。
- `draftCanvasReadyRef`（CanvasWindowApp）は名前に draft が付くが、中間稿のほかに、ファイルのカードの書き戻し（1217・1263・1291・1927行）でも「ボードを読み終えたか」の印に使っている。中間稿をなくしても残る。
- [USER_MANUAL.md](USER_MANUAL.md) の「中間稿」の節は、ボタンの文言が今の画面とずれている（「この順序でテキストを生成」→ 実際は「テキストを生成」、「全文コピー」→「コピー」、「Canvasから再生成」→「再取得」）。節を書き換えるので、一緒に直る。
- ボードを別の作品へ送る（コピー・移動）と、中間稿も写していた。移行後のノートは作品のファイルなので、送っても写らない。
- 4-4 の並べ替えの画面は Canvas の上に出る画面なので、一覧の行を押してキャンバスのカードを選ぶことはできない（`onSelect` を渡していない）。

### 文字列を読むテスト・差し替え表

| テスト | 読み方 | 今回の影響 |
|---|---|---|
| `test:breadcrumb` | App.tsx の `const updateLayout` から `const sortedReferenceCandidates` まで | そのあいだにコードを足さない（消すところ 1162〜1165行はその外） |
| `test:canvas-save`（`test-canvas-board-save.mjs` 70〜92行） | CanvasWindowApp・canvasBoardStore を差し替え表で読む。`./components/canvas/IntermediateDraftPane`・`./intermediateDraft`・`./intermediateDraftStore` を差し替えている | import を消したら表からも消す |
| `test:canvas-store`（`test-canvas-board-store.mjs`） | canvasBoardStore を動かす。ゴミ箱へ移す前に `prepareDraftBoardTrash` を呼ぶこと、ブラウザ版で中間稿がゴミ箱へ移り戻ること（71・123〜160行） | その確かめを外し、「ゴミ箱と戻すはボードだけ」に書き換える |
| `test:canvas-file-nodes`（39〜41・108行）・`test:canvas-to-manuscript`（`test-canvas-to-manuscript-ui.mjs` 35〜36・71行） | CanvasWindowApp を差し替え表で読む。`load_intermediate_draft` の返事を偽物で返す | 表と偽物の返事を消す。`.draftOrderList`・`.draftCardName` で行を探している（142・163・168行）ので、クラス名を変えるならここも直す |
| `test:heading-dnd-ui` | CanvasWindowApp の import を差し替え表で読む | 中間稿の項目はない。import の数が変われば確かめる |
| `test:right-sidebar` | RightSidebar を動かす。`hasOpenedDraft`・`draftCanvasContext` を渡す（49・54行）、中間稿のペインの出し方（119〜133行）、タブの一覧に `draft:中間稿`（226行） | 中間稿の確かめを外し、タブの一覧から `draft:中間稿` を除く |
| `test:v058-bundle` | RightSidebar の静的な import の一覧 | IntermediateDraftPane が消える。ほかの条件（lazy を使わない）は変わらない |
| `test:v061-plugins` | RightSidebar の `<aside` から `</aside>` まで | 中のペインの置き場が1つ減るだけ。並びは変えない |
| `test:v065-native-shell`（51行） | `normalizeRightSidebarTab("draft")` が `"draft"` を返す | `"draft"` を外したら、`"plot"` と同じ扱いの確かめに移す |
| `test:v063-draft` | 中間稿の処理・保存・ペインを実際に動かす | ペインと保存の部分はなくなる。残す並べ方・並べ替え・除外の確かめは移す（案の 3） |

## 工程2: 仕組みの説明

### 言葉

- **中間稿**: Canvas のテキストカードを並べ替えてつないだ文章。版（v1、v2 …）を持ち、ボードごとに1つの履歴がある。本文の原稿には自動で入らない。
- **版**: 「テキストを生成」を押すたびに増える。そのときのカードの写し・順序・除外・本文を持つ。本文を直せるのは最新版だけ。過去の版は読むだけ。
- **取得／再取得**: Canvas のボードから、そのときのテキストカードを写し、矢印の順に並べた一覧を作ること。
- **一時保存**: 本文を直すたびに localStorage へ書く写し。400ms 後の保存が済めば消える。窓を閉じて保存が済まなかったとき、次に同じボードを開くと戻る。
- **素材のノート**: 作品の素材フォルダ（`project.json` の `materialsFolder`）の中の `.md`。Plot・Idea の移行もここへノートを作った。

### 1. データの形

`history.json`:

```json
{ "schemaVersion": 1, "boardId": "board", "revision": 3,
  "versions": [{ "version": 1, "capturedAt": 0, "boardUpdatedAt": 0, "createdAt": 0, "updatedAt": 0,
    "cards": [{ "id": "a", "text": "最初" }], "order": ["a"], "excluded": [], "text": "最初" }] }
```

- `revision` は保存のたびに1つ増える。別の画面で保存されたかを見分けるため。
- `v<版>.txt` は、その版の `text` と同じ中身。外のエディタで直しても Then には戻らない。

### 2. 利用者の操作と内部の処理

| 操作 | 内部で起きること |
|---|---|
| 右サイドバーの「中間稿」を開く／Canvas の「稿」 | 埋め込みの Canvas では右サイドバーのペインを開く。別ウィンドウの Canvas では窓の右にパネルを出す。ボードの一覧を読み、今の Canvas のボード（なければ先頭）を選ぶ |
| 初めて開いたボード | 版がなければ、すぐにカードを取得して「並べ替え」に出す |
| 並べ替え・除外 | 手元の一覧だけが変わる（`moveDraftCard`・`toggleDraftCard`）。Canvas のカードは変わらない |
| 一覧の行の抜粋を押す | Canvas のそのカードを選び、画面の中央に寄せる（`selectDraftNode`）。ペインを開いている Canvas が同じボードのときだけ |
| 「テキストを生成」 | 除外していない空でないカードの文章を空行でつなぎ、新しい版を足す（`generateDraft`）。400ms 後に保存 |
| 「テキスト」で本文を直す | 最新版の `text` を書き換え、一時保存に書いてから 400ms 後に保存 |
| 版を選ぶ | その版の本文と一覧を出す。過去の版は読むだけ |
| 「再取得」 | 保存を済ませてから、Canvas のカードを取り直して「並べ替え」に出す |
| 「コピー」 | 選んでいる版の本文をクリップボードへ |
| 「書き出し」 | 保存の窓で `中間稿-v<版>.txt` を書く |
| 保存の失敗・競合 | 下に知らせと「再試行」「保存版を読み直す」を出す。読み直すときは、未保存なら確かめる |
| ボードをゴミ箱へ移す・戻す | 中間稿の保存を済ませてから、ボードと中間稿を一緒に動かす。戻すときは新しい ID に合わせる |
| ボードを別の作品へ送る | 中間稿の保存を済ませ、版があれば送り先の新しいボードの中間稿として写す |
| 窓を閉じる | 未保存があれば閉じる前の確認を出し、保存を始める |

### 3. 保存

- 保存先・形は上のとおり。保存は Rust の `save_intermediate_draft` が、`revision` が読んだときと同じことと、過去の版が変わっていないことを確かめてから書く。
- 読み込みは `load_intermediate_draft`。ボードがなければ失敗する（ボードが消えた中間稿は画面から読めない）。

### 4. ほかの機能との関係

- 4-4「この順で原稿を作る」: `captureDraft`・`moveDraftCard`・`toggleDraftCard`・型 `DraftCapture`・`DraftOrderList`・`intermediateDraft.css` の一覧の規則を使う。中間稿をなくしても、これらは残す（案の 3）。
- ボードのゴミ箱・戻す・送る: 上の表のとおり、中間稿を一緒に動かしている。
- 2-4 の Idea の移行のバックアップ（`.then/backups/idea-<日時>/boards/`）: そのときの中間稿の写しが入っている。今回は触らない。
- チェックポイント: 中間稿は入らない（`.then/checkpoints` は原稿のファイルだけ）。

### 5. 今の挙動の癖（直さないもの）

- 中間稿の本文を外のエディタで `v1.txt` を直しても Then には戻らない。移行では `history.json` の本文を使う。
- ゴミ箱のボードは完全に消せないので、ゴミ箱の中間稿もずっと残る。移行でこれも片付く（案の 2）。

### 画面を隠す・動かすので、そこからしか届かなくなる操作

4-4 の手順書（[BINDER_CANVAS_TO_MANUSCRIPT_PLAN.md](BINDER_CANVAS_TO_MANUSCRIPT_PLAN.md)）の工程1の表を出発点にした。

| 操作 | 今の入口 | 退役のあとのほかの入口 | 扱い |
|---|---|---|---|
| ボード全体のカードを並べ替えて文章にする | 中間稿の「取得」→「並べ替え」→「テキストを生成」 | 全部を囲んで選んで「この順で原稿を作る」→「1本の原稿につなげる」（原稿ができる） | ある |
| 生成した文章を直す | 中間稿の「テキスト」 | 作った原稿を本文で直す。移行したノートも本文で直せる | ある |
| 版を残す・見比べる | 中間稿の版の選択 | 原稿のチェックポイント（D-6 の決定どおり）。移行で過去の版はノートにならない（案の 2） | **過去の版の見比べはなくなる**。バックアップに残る |
| 文章をコピー | 中間稿の「コピー」 | 原稿・ノートを開いてコピー | ある |
| 文章を .txt に書き出す | 中間稿の「書き出し」 | 原稿の書き出し（投稿用テキスト）。ノートは書き出しの対象外 | 原稿ならある。**移行したノートの .txt 書き出しは、ノートを原稿のフォルダへ動かせばできる** |
| 一覧の行からカードを選ぶ（キャンバスがその位置へ動く） | 中間稿の一覧の抜粋を押す | なし（4-4 の画面はキャンバスの上に出るので選べない） | **なくなる**（案の 3 で決める） |
| 生成前に一覧を残しておく（版を切り替えても並べ替えを保つ） | 中間稿の「再取得」のあとの状態 | なし（4-4 の画面は閉じると並べ替えを残さない） | **なくなる**。4-4 の画面は毎回カードから作り直す |
| ボードを送るときに文章も一緒に送る | 送る画面（「中間稿もボードと一緒に送ります。」） | なし（ノートは作品のファイル） | **なくなる**（案の 5） |

## 工程3: 依存関係

- **消すもの → 使っているもの**
  - `IntermediateDraftPane.tsx` ← RightSidebar（ペイン）、CanvasWindowApp（別ウィンドウのパネル）。
  - `intermediateDraftStore.ts` ← IntermediateDraftPane、canvasBoardStore（`prepareDraftBoardTrash`）、CanvasWindowApp（`flushDraftBoard`）。
  - `intermediateDraft.ts` の `draftBoardKey`・`generateDraft`・型 `DraftBoard`・`DraftCanvasContext`・`DraftVersion`・`DraftHistory` ← 上の3つと App・RightSidebar・CanvasWindowApp・canvasBoardStore。
  - Rust `load_intermediate_draft`・`save_intermediate_draft` ← intermediateDraftStore、CanvasWindowApp の送る処理。`move_board_with_draft` ← `trash_canvas_board`・`restore_canvas_board`。
- **残すもの → 使っているもの**
  - `captureDraft`・`moveDraftCard`・`toggleDraftCard`・型 `DraftCapture` ← canvasToManuscript、DraftOrderList、CanvasToManuscriptDialog、CanvasWindowApp（`manuscriptDialog` の型、1031行）。
  - `DraftOrderList.tsx` ← CanvasToManuscriptDialog。
  - `intermediateDraft.css` の一覧の規則 ← CanvasToManuscriptDialog（`intermediateDraftPane` のクラス）と canvas.css の `.canvasManuscriptModal.intermediateDraftPane`（1711〜1790行）。
- **移行が読むもの・書くもの**
  - 読む: `.then/boards/.intermediate-drafts/*/history.json`、`.then/boards/<ID>.canvas` の `then.name`（ボード名）、`.then/boards/.trash/*.draft/history.json` と対の `.canvas`、`project.json` の `materialsFolder`。localStorage の `then.draft-recovery.*`（画面の側）。
  - 書く: `.then/backups/intermediate-drafts-<日時>/`（バックアップ）、素材フォルダのノート、素材フォルダがなければ `project.json` の `materialsFolder`。最後に `.intermediate-drafts/` と `.trash/*.draft/` を消す。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`、`src/CanvasWindowApp.tsx`、`src/canvasBoardStore.ts`、`src/components/layout/RightSidebar.tsx`、`src/utils/rightSidebarState.ts`、`src/canvasToManuscript.ts`、`src/components/canvas/CanvasToManuscriptDialog.tsx`、`src/components/canvas/canvas.css`、`src-tauri/src/lib.rs`、新しい `src/intermediateDraftMigration.ts` と `src-tauri/src/intermediate_draft_migration.rs`（名前は仮）。消す: `IntermediateDraftPane.tsx`、`intermediateDraftStore.ts`、`intermediate_draft.rs`、`intermediateDraft.css`（案の 3 による）、`intermediateDraft.ts`（同）。
- テスト: 上の「文字列を読むテスト・差し替え表」の全部と、`test-v063-intermediate-draft.mjs`（移すか消す）、新しい移行のテスト（TS と Rust）。
- 文書: [USER_MANUAL.md](USER_MANUAL.md) の「中間稿」の節と目次、[CANVAS_INTERMEDIATE_DRAFT_DESIGN.md](CANVAS_INTERMEDIATE_DRAFT_DESIGN.md)（状態を「退役」にし、移行先を書く）、[BINDER_REBUILD_PLAN.md](BINDER_REBUILD_PLAN.md) の 1 の表・3.4・4-4b、[RELEASE_NOTES_NEXT.md](RELEASE_NOTES_NEXT.md)（案の 5）、`package.json`（`test:v063-draft` の扱い）。
- 変えない: `.canvas` の形、ボードのゴミ箱の `.canvas` の名前の付け方、4-4 の画面の文言と動き、Plot・Idea の移行。

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 移行（ノートを作って `.intermediate-drafts/` を消す） | 高 | 失敗の順番を間違えると文章を失う。バックアップを書いて読み直してから消す。ノートを書けなければ消さない |
| ボードのゴミ箱・戻す（Rust） | 中 | `move_board_with_draft` を `rename` に置き換える。ゴミ箱へ移せない・戻せないと、ボードの操作が止まる |
| 送る | 中 | `flushDraftBoard` と中間稿の写しを外す。外し方を間違えると送る処理が途中で止まる |
| 右サイドバー・保存済みタブ | 低〜中 | `"draft"` のまま起動すると、何も出ないペインになるおそれ（案の 4 で直す） |
| 4-4 の画面（名前とクラスを変えるなら） | 中 | 一覧の見た目が崩れる・テストが行を見つけられない |
| 文書 | 低 | |

### 4-3. 機能ごとに起こりうる回帰不具合

| 機能 | 起こりうること | 今のテストで気づけるか |
|---|---|---|
| 4-4「この順で原稿を作る」 | 並べ方・除外・一覧の見た目が変わる | `test:canvas-to-manuscript`・`test:v063-draft` の並べ方の部分（移せば）で気づける。見た目は実機で |
| ボードのゴミ箱・戻す | 移せない、戻した ID がずれる | `test:canvas-store`（ブラウザ版の形）。Rust の `trash_canvas_board`・`restore_canvas_board` のテストはない（中間稿の Rust テスト `board_trash_restore_and_failed_move_preserve_history` が移動の部分だけ見ていた）→ 足す |
| 送る | 途中で止まる | `test:canvas-save` の送るの部分（あれば）。実機で |
| 右サイドバー | タブの並び、保存したタブの復元 | `test:right-sidebar`・`test:v065-native-shell`・`test:stored-state-model` |
| 起動・作品を開く | 移行の失敗で開けない | 移行の失敗でも開くことを新しいテストで確かめる |
| 包みの大きさ | | `test:v058-bundle`（先に build。dist が古いと誤る） |

### 4-4. 今の自動テストの状態（「前」の一式の結果）

`3a559a0` で 130 本を動かした（build 成功、main の塊 725,002 バイト）。失敗は5本で、どれも今回の変更の前からのもの。

| テスト | 結果 |
|---|---|
| `test:window-controls`・`test:tree-row-contrast` | 失敗（終了コード 13） |
| `test:save-on-work-switch` | 時間切れ |
| `test:editor-text-edits` | 失敗（`release failed`） |
| `test:v058-bundle` | 失敗（main の塊が 500 kB を超えている。元からの状態） |

今回に関係するテスト（`test:v063-draft`・`canvas-save`・`canvas-store`・`canvas-file-nodes`・`canvas-to-manuscript`・`right-sidebar`・`heading-dnd-ui`・`breadcrumb`・`v061-plugins`・`stored-state-model`・`idea-migration`・`plot-migration`・`library`）はすべて通った。残ったプロセス: QA Then 0、QA WebView2 0、keep-screen 0、テストの Edge 0、テストの node 0。

## 工程5: 案

### 5-1. 方針

1. 先に移行を足す（新しいファイル2つと、`migratePlotBeforeOpening` への1行）。ここまでは中間稿の画面が残っていても動く。
2. 次に、4-4 が使う部分を残す場所へ移す（案の 3）。
3. 最後に、中間稿の画面・保存・Rust の命令・ゴミ箱との結びつきを消す。
4. 文書を書き換える。

### 5-2. 移行の流れ（勧めの形）

作品ごとに、Rust の命令（仮の名前 `migrate_intermediate_drafts`）が1回で行う。

1. `.then/boards/.intermediate-drafts/` と `.then/boards/.trash/*.draft/` がどちらもなければ、何もしない（「済んだ」の印は、これらがないこと。Plot の移行で `plotCards` が空なことを印にしたのと同じ考え方）。
2. バックアップ: `.then/backups/intermediate-drafts-<日時>/` に、`.intermediate-drafts/` をまるごと（`drafts/`）と `.trash/*.draft/`（`trash/`）を写し、読み直して確かめる（2-4 の `copy_tree_verified`）。画面の側から渡された一時保存（下の 4）があれば `recovery.json` として書く。
3. ボードごとに、`history.json` の最新版の `text` でノートを作る。
   - 名前は「（ボード名）の中間稿」。ボード名は `.canvas` の `then.name`。ファイル名に使えない文字（`/ \ : * ? " < > |`）は取り除く。ボードが消えていれば、ボード ID を名前に使う。
   - 置き場は 1-6 の `note_folder`（素材フォルダ。なければ「素材」を作って `project.json` に記録する。ライブラリ直下は直下）。
   - 同じ名前があれば `-2` …。同じ中身のノートがあれば、それを使う（前回、ノートを書いたあとで止まったときに2本目を作らない。1-6 の `write_note`）。
   - 最新版の本文が空（空白だけ）なら、ノートを作らない（バックアップには残る）。
4. 終了前の一時保存: 画面の側が localStorage の `then.draft-recovery.*` から、この作品の分を読んで渡す。一時保存の最新版の本文が `history.json` の最新版と違えば、一時保存のほうでノートを作る（利用者が最後に見ていた文）。
5. ノートが全部書けたら、`.intermediate-drafts/` と `.trash/*.draft/` を消す。途中で失敗したら、その回に作ったノートと「素材」フォルダを消し、中間稿は消さない（次に開いたときにやり直す）。
6. 画面の側は、済んだら localStorage の `then.draft-recovery.*`（この作品の分）と、ブラウザ版の `then.draft.*` を消す。通知は Plot・Idea と同じ1つにまとめ、「中間稿をノート「（ボード名）の中間稿」に移しました」（2本以上なら「中間稿を N 本のノートに移しました」）。

### 5-3. 消すもの

- ファイル: `IntermediateDraftPane.tsx`、`intermediateDraftStore.ts`、`src-tauri/src/intermediate_draft.rs`。`intermediateDraft.ts`・`intermediateDraft.css`・`DraftOrderList.tsx` は案の 3 による。
- Rust: 命令 `save_intermediate_draft`・`load_intermediate_draft` の登録、`mod intermediate_draft`。`trash_canvas_board`・`restore_canvas_board` の `move_board_with_draft` は `std::fs::rename` に戻す（`.canvas` だけ動かす）。
- canvasBoardStore: `prepareDraftBoardTrash` の呼び出し、ブラウザ版のゴミ箱の `draft`（型・入れる・戻す）、`draftBoardKey` の import。
- CanvasWindowApp: import 3つ、props 4つ（`onDraftCanvasChange`・`draftSelectRequest`・`onDraftSelectionConsumed`・`onOpenDraft`）、ペインへ知らせる effect、`selectDraftNode` と受け口、`isDraftPanelOpen` とその切り替え（「Idea・資料パネル」の押下で閉じる部分、`hasCanvasDraftPanel`）、「稿」ボタン、別ウィンドウのパネル、送る処理の `flushDraftBoard`・中間稿の写し・注記「中間稿もボードと一緒に送ります。」・説明のコメント。`draftCanvasReadyRef` は書き戻しが使うので残す（名前は案の 5）。
- App: import、`draftCanvasContext`・`draftSelectRequest`・`hasOpenedDraft` と effect、作品の切り替えで消す2行、埋め込みの Canvas へ渡す4つ、右サイドバーへ渡す3つ。
- RightSidebar: import 2つ、タブ「中間稿」、props 3つ、`draftPaneHost`。`rightSidebarTab === "draft" ? null :` の分かれ道も外す。
- rightSidebarState: `"draft"` を一覧から外す（案の 4）。

### 決めてほしいこと

#### 1. 移行の時期と入口

| 選択肢 | 内容 |
|---|---|
| **A（勧め）** | 1-6・2-4 と同じく、起動時（ライブラリ直下と全作品）と作品を開いたときに自動で移す。`migratePlotBeforeOpening` の Plot・Idea のあとに並べ、通知も1つにまとめる。失敗しても作品は開き、次に開いたときにやり直す |
| B | 初めて見つけたときに一度だけ「中間稿をノートに移します」と聞く。断ったら次の起動でまた聞く |
| C | 設定やコマンドから利用者が移す。それまでは何もしない（画面はないので、中間稿は見えないまま残る） |

勧めの理由: 画面をなくすので、移さないと中間稿が見えなくなる。1-6・2-4 と同じ時期・同じ通知にすれば、利用者から見て1回の「移しました」で済む。バックアップを先に書き、ノートが書けなければ消さないので、自動でも文章は失わない。

#### 2. ノートの中身と、端の場合

| 項目 | 勧め | ほかの選択肢 |
|---|---|---|
| ノートの中身 | **最新版の本文だけ**を、そのまま書く（フロントマターも見出しも足さない）。版の一覧・カードの写し・順序・除外は、バックアップの `history.json` と `v<版>.txt` に残る | B: 最新版のあとに、過去の版を `## v1` などの見出しで同じノートに足す。C: 版ごとに別のノート「（ボード名）の中間稿 v1」 |
| 名前が重なる | `-2`、`-3` …。同じ中身のノートがあれば作らない（1-6 と同じ） | — |
| 名前に使えない文字 | 取り除く。残りが空ならボード ID | — |
| 素材フォルダがない作品 | 「素材」を作り、`project.json` に記録する（1-6 と同じ。普通のフォルダ「素材」があれば「素材-2」） | 作品の直下に置く |
| ボードが消えている中間稿（`.intermediate-drafts/<ID>` に `.canvas` がない） | 移す。名前は「（ボード ID）の中間稿」 | バックアップだけにして、ノートは作らない |
| ゴミ箱のボードの中間稿（`.trash/*.draft/`） | 移す。名前はゴミ箱の `.canvas` のボード名 | バックアップだけにして、ノートは作らない（ゴミ箱を戻しても中間稿はもう戻らない） |
| 終了前の一時保存（`then.draft-recovery.*`） | 保存版と違えば、一時保存の最新版でノートを作る。一時保存の中身もバックアップへ。済んだらキーを消す | 保存版でノートを作り、一時保存はバックアップにだけ残す |
| 本文が空の最新版 | ノートを作らない（バックアップには残る） | 空のノートを作る |

勧めの理由: 3.4 の決定は「最新版を移す」。過去の版は見比べのためのもので、ノートに入れると読み物として邪魔になる。消えたボード・ゴミ箱のボードの中間稿は、退役のあとはどこからも開けなくなるので、ノートにしておくほうが失いにくい（要らなければノートを消せばよい）。

#### 3. 4-4 が使う部分を残す場所と名前、一覧からカードを選ぶ操作

| 選択肢 | 内容 |
|---|---|
| **A（勧め）** | 「中間稿」の名前を残さない。`captureDraft`・`moveDraftCard`・`toggleDraftCard`・型 `DraftCapture` を `canvasToManuscript.ts` へ移し、名前を `captureCardOrder`・`moveOrderedCard`・`toggleOrderedCard`・`CardOrder` にする。`DraftOrderList.tsx` は `ManuscriptOrderList.tsx` に改名。`intermediateDraft.css` の一覧の規則（37〜72行と、使っているボタンの規則）を canvas.css の `.canvasManuscriptModal` の下へ移し、`intermediateDraftPane` のクラスと `draft*` のクラス名を `manuscriptOrder*` に変える。テストの行の探し方も直す。見た目は変えない（計算された CSS を前後で比べる） |
| B | ファイル名・関数名・クラス名はそのまま残し、中間稿だけの部分を消す（差分が最小。名前に「中間稿」が残る） |
| C | A のうち、ファイルと関数の名前だけ変え、CSS のクラス名は残す |

一覧の行からカードを選ぶ操作（今は中間稿のペインだけ）:

| 選択肢 | 内容 |
|---|---|
| **a（勧め）** | なくす。4-4 の画面は Canvas の上に出る画面で、選んでも見えないため |
| b | 4-4 の画面で行の抜粋を押すと、その画面を閉じずに Canvas のカードを選び、中央に寄せる |

勧めの理由: 退役のあと「中間稿」は利用者の画面にもコードにも出てこなくなるので、名前を残すと読む人が迷う。見た目は前後で計算された値を比べて同じことを確かめる。

#### 4. 保存されている右サイドバーのタブが `"draft"` のとき

| 選択肢 | 内容 |
|---|---|
| **A（勧め）** | アプリ状態の読み込み（`normalizeRightSidebarTab`）で、`"plot"` と同じく「アイデア」で開く。`"draft"` を保存できるタブの一覧から外す |
| B | 「この場面」で開く |

勧めの理由: 1-6 で Plot のタブをなくしたときと同じ直し方で、テストの形（`test:v065-native-shell`・`test:stored-state-model`）もそろう。

#### 5. 調べていて見つけた癖・ついでに決めること

| # | 癖 | 勧め | ほかの選択肢 |
|---|---|---|---|
| 5-1 | ボードを別の作品へ送るとき、今は中間稿も写していた。退役のあとはノートは写らない | 写さない（注記「中間稿もボードと一緒に送ります。」を消すだけ。送り先で要るなら、ノートを手で写す） | 移行したノート「（ボード名）の中間稿」があれば、送り先の素材フォルダにも写す |
| 5-2 | `draftCanvasReadyRef`（CanvasWindowApp）は中間稿をなくしても書き戻しが使い、名前だけが中間稿の名残になる | 一緒に名前を変える（`boardReadyRef` など。中身は変えない） | 記録のみ |
| 5-3 | USER_MANUAL の「中間稿」の節のボタンの文言が、今の画面とずれている | 節を書き換えるので一緒に直る（「この順で原稿を作る」の節へ案内し、移行の説明を短く書く） | — |
| 5-4 | RELEASE_NOTES_NEXT.md に中間稿の退役が書かれていない | 一緒に足す（中間稿をノートに移すこと、バックアップの場所） | 別にする |
| 5-5 | ゴミ箱のボードは完全に消せない（ゴミ箱の中間稿もずっと残っていた） | 記録のみ（移行でゴミ箱の中間稿は片付く。ボードのゴミ箱を空にする操作は今回作らない） | 別の作業にする |

### テストの直し方と足すテスト

- 移行（Rust、`intermediate_draft_migration.rs` のテスト）: 版が2つある中間稿 → 最新版の本文のノート、同じ名前 → `-2`、同じ中身があれば作らない、素材フォルダがない → 「素材」を作り `materialsFolder` を記録、ボードが消えた → ID の名前、ゴミ箱の中間稿、空の本文 → ノートなし、名前に使えない文字、バックアップの中身が元と同じ、ノートを書けないとき（読み取り専用のフォルダなど）→ 中間稿を消さず、作ったノートとフォルダを消す、2回目は何もしない。
- 移行（TS、`test-intermediate-draft-migration.mjs` 仮）: 一時保存の読み分け（この作品の分だけ、保存版と同じなら渡さない）、通知の文、`migratePlotBeforeOpening` の並び（Plot → Idea → 中間稿）と、失敗しても作品が開くこと。
- Rust のボードのゴミ箱・戻す: `.canvas` だけが動き、`.draft` を作らないこと（今は中間稿のテストの中で移動だけ見ていた）。
- 4-4 の並べ方: `test:v063-draft` の並べ方・並べ替え・除外の確かめを、残す先のテスト（`test:canvas-to-manuscript` の純粋な部分）へ移し、`test:v063-draft` は package.json から外す。
- 上の「文字列を読むテスト・差し替え表」を直す。
- 効くことの確かめ: 移行で「ノートを書く前に中間稿を消す」順にした不具合と、「最新版でなく最初の版を書く」不具合を入れて落ちることを見る（先にコミットしてから）。

### 進め方とコミットの分け方

1. 移行の Rust（命令・テスト）。
2. 移行の TS と `migratePlotBeforeOpening` への組み込み、テスト。
3. 4-4 が使う部分を残す先へ移す（案の 3）。テストの差し替え。
4. 中間稿の画面・保存を消す（App・CanvasWindowApp・RightSidebar・canvasBoardStore・rightSidebarState）。テストの差し替え。
5. Rust の中間稿の命令と `move_board_with_draft` を消し、ゴミ箱・戻すのテストを足す。
6. 文書（USER_MANUAL・CANVAS_INTERMEDIATE_DRAFT_DESIGN・BINDER_REBUILD_PLAN・RELEASE_NOTES_NEXT）。
7. 手順書の結果と KNOWN_ISSUES。

### 実機確認で見る項目（見込み）

- 一時ライブラリ: 作品A（素材フォルダあり、版が2つの中間稿・ボードが消えた中間稿・ゴミ箱のボードの中間稿）、作品B（素材フォルダなし、中間稿1つ）、作品C（中間稿なし）。qa-seed のあとに node で `.then/boards/.intermediate-drafts/` を書く。一時保存も localStorage に1つ入れる。
- 起動の通知、ノートの場所・名前・中身、バックアップの中身、`.intermediate-drafts/` が消えたこと、2回目の起動で何も起きないこと。
- 右サイドバーに「中間稿」がない。保存済みタブ `"draft"` で起動して「アイデア」が開く。Canvas（埋め込み・別ウィンドウ）に「稿」がない。
- 「この順で原稿を作る」の画面の見た目と動き（並べ替え・除外・1本につなげる）が 4-4 と同じ。
- ボードをゴミ箱へ移して戻す、別の作品へ送る。

### 見込みと、今回やらないこと

- 見込み: 消すのは約 900 行（TS 約 500、Rust 約 330、CSS 約 60）。足すのは移行の約 300 行とテスト。
- やらない: コピーカードの移行（4-5）、ボードのゴミ箱を空にする操作、2-4 のバックアップ（`.then/backups/idea-*/boards/`）の中の中間稿の片付け、4-4 の画面の文言・動きの変更（案の 3-b を選んだときを除く）。

## 工程6: 人の確認

## 工程7: 実施

## 工程8: 自動テスト

## 工程9: 実機確認

## 工程10: 完了
