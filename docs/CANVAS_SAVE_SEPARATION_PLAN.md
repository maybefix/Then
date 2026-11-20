# Canvas の保存部分の切り出し（BINDER 4-1）の手順書

`src/CanvasWindowApp.tsx`（3,593行）から、ボードを読み書きする部分（Tauri の命令と、ブラウザで動かすときの localStorage の読み書き、保存の順番待ち）を新しいファイル `src/canvasBoardStore.ts` へ移す。`docs/BINDER_REBUILD_PLAN.md` の 4-1。仕様・保存形式（`.then/boards/*.canvas`）・UI・文言・Rust は変えず、今と同じ結果になることを優先する。

4-2（`file` ノードの表示と参照先への書き戻し）と 4-3（Canvas を中央の表示の一つにする）は、ここで切り出した保存部分の上に乗る。今回はその中身には手を付けず、どこで切れば足しやすいかだけを工程5に書く。

- ブランチ: `refactor/canvas-save-separation`
- 戻し先: タグ `checkpoint/before-canvas-save-separation`（コミット `998356e`。中身は main `0fb6f4b` と同じ）
- 前提: 3-5（PR #65）は main に merge 済み（`46c6f5d` は `0fb6f4b` の祖先）。始めたときのブランチは main。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 済み（2026-11-21） |
| 7 | 実施 | 済み |
| 8 | 自動テスト | 済み |
| 9 | 実機確認 | 済み |
| 10 | 完了（確認2） | 確認2の待ち |

行番号は、断りがなければ `998356e` の時点のもの。

---

## 工程1: 調査の結果

### コードがある場所

| ファイル | 行数 | 役割 |
|---|---|---|
| `src/CanvasWindowApp.tsx` | 3,593 | Canvas の画面すべて。別ウィンドウ（`idea-canvas`、`src/main.tsx` から）と、メイン画面への埋め込み（`src/App.tsx` 7564行、`appMode === "canvas"`）の両方で同じ部品を使う |
| `src/canvasBoardSaveQueue.ts` | 34 | 保存の順番待ち（`CanvasBoardSaveQueue`）。React を使わない |
| `src/canvasTypes.ts` | 503 | ボードの型、正規化（`normalizeCanvasDocument`）、ウィンドウ間の知らせの名前 |
| `src/intermediateDraftStore.ts` | — | 中間稿。ボードの一覧と読み込みを、Canvas とは別に自分でも持っている（42行目まで） |
| `src-tauri/src/lib.rs` 3683〜3940行・4578〜4840行 | — | ボードの命令8つ（一覧・作成・読み込み・保存・並び順・ゴミ箱・ゴミ箱の一覧・復元）。今回は変えない |

CanvasWindowApp.tsx の中で保存に関わる所:

| 行 | 中身 | 今回 |
|---|---|---|
| 71 | `LOCAL_STORAGE_PREFIX`（ブラウザで動かすときの localStorage のキーの頭） | 移す |
| 79〜95 | 型 `TrashedCanvasBoardSummary`・`LocalTrashedCanvasBoard` | 移す |
| 172 | `isTauriRuntime`（Tauri の中で動いているか） | 移す（Canvas 側でも9か所で使うので、書き出して import し直す） |
| 187〜332 | localStorage の読み書き10個と、`listBoards`・`createBoard`・`loadBoard`・`saveBoard` | 移す |
| 334〜336 | 保存の順番待ちの1つだけの実体 `canvasBoardSaveQueue` | 移す |
| 338〜432 | `reorderBoards`・`trashBoard`・`listTrashedBoards`・`restoreTrashedBoard` | 移す |
| 598〜600 | `boardName`（ボードの名前、空なら「Idea Board」） | 移す（`listTrashedBoards` が使う。Canvas 側でも5か所で使う） |
| 611〜618 | `formatSaveTime`（「保存済み 12:34:56」の時刻） | 残す（画面の文言） |
| 959〜966 | 保存の時計・世代・読み込み済みの印などの ref | 残す |
| 1186〜1264 | `patchBoard`・履歴（元に戻す・やり直す） | 残す |
| 1266〜1300 | 名前の変更 | 残す |
| 1308〜1332 | ゴミ箱を開く・新しいボード | 残す |
| 1414〜1468 | `loadBoardList`（一覧を読み、ボードを1つ開く） | 残す |
| 1548〜1591 | 遅延保存の useEffect、閉じるときの書き出しの useEffect | 残す |
| 1782〜1832 | 並び順の保存（`persistBoardOrder`）・並べ替え | 残す |
| 1852〜1944 | ほかの作品へ送る（`openTransfer`・`submitTransfer`） | 残す |
| 1946〜2010 | ゴミ箱へ・復元（`trashBoardAndRefresh`・`restoreBoard`） | 残す |

### 気づいた点

1. 保存の層（Tauri とブラウザの読み書き）は、部品の外の関数としてすでにまとまっている（187〜432行）。React の値を何も読まないので、そのまま別のファイルへ移せる。
2. 保存の流れ（いつ保存するか、切り替えの前に書き切る、世代で古い応答を捨てる）は、部品の中の ref と useEffect に絡んでいる。
3. ボードを書く経路が `saveBoard` のほかに2つある。ほかの作品へ送る処理（1910行）は `invoke("save_canvas_board")` を直接呼び、中間稿（`intermediateDraftStore.ts`）は一覧と読み込みを自分で持っている。localStorage のキーの形 `then.canvas-board.<scope>.<rootPath>` も、両方のファイルに別々に書いてある。
4. 使われていない保存の関数はない（`symbol-uses.mjs` で、移す関数はすべて2回以上出る）。
5. Canvas の 0.5 秒の遅延保存は、閉じる前に書き切る仕組み（`src/pendingSaves.ts`）に載っていない（工程2の5の癖1）。

### Canvas の保存に関わる今のテスト

| テスト（npm の名前） | 確かめていること | 今回の扱い |
|---|---|---|
| `test:canvas-save`（`scripts/test-canvas-board-save.mjs`） | 順番待ち `CanvasBoardSaveQueue` そのもの（書く先と中身の写しを固定する、続けての編集、別の作品、失敗のあとの再試行）。`CanvasWindowApp.tsx` を jsdom で実際に動かし、ボードの切り替え直後・保存中の切り替え・保存の失敗・作品の切り替え・遅い読み込み・閉じるとき・開き直し・ゴミ箱・StrictMode・改名と移動の知らせで、どの命令がどの中身で呼ばれるかを見る | **読み込みの差し替え表に `./canvasBoardStore` を足す必要がある**。CanvasWindowApp.tsx をその場で変換し、import の名前を1つずつ差し替えて読むため、新しい import があると読み込めない |
| `test:v063-draft`（`scripts/test-v063-intermediate-draft.mjs`） | 中間稿。localStorage のキー `then.canvas-board.project.one` に直接ボードを置く | 変えない（中間稿の側は動かさない） |
| `test:v064-canvas` | `canvasTypes`・`canvasThreads`・`canvasResize` の純粋な処理 | 変えない |
| `test:library`（`test-library-transfer.mjs` など） | 送る処理の `boardReferencePaths`・`rewriteBoard` | 変えない |
| `test:connections` | 読むだけの `list_board_references`（Rust） | 変えない |
| Rust の `cargo test`（lib.rs 5791・5906行など） | 全作品の資料カードの消去、ボードのファイル | 変えない |

### ソースの文字列を確かめているテスト（`text-deps.mjs src/CanvasWindowApp.tsx`）

| テスト | 確かめている文字列 | 今回 |
|---|---|---|
| `test:performance`（`scripts/test-performance-regressions.mjs` 513行） | `createLatestFrameScheduler`（ポインタの動きを画面の描画に合わせてまとめる） | 移さないので、そのまま通る |
| `test:v058-bundle`（`scripts/test-v058-bundle-splitting.mjs` 41・51行） | `./CanvasWindowApp` を遅れて読み込む形で import していること（`dist` の大きさも見る） | 移さない。元から上限を超えていて失敗する（工程4の4-4） |
| `test:canvas-save` | 文字列は読まず、ファイルを実際に動かす | 上の表のとおり |

---

## 工程2: 仕組みの説明

### 言葉

- **ボード**: Canvas の1枚。中身は JSON Canvas の形（カード `nodes` と線 `edges`）に、Then の項目 `then`（名前・範囲・作った時刻・直した時刻）を足したもの。
- **保存の層**: ボードを「どこに・どう書くか」だけを知っている処理。Tauri の中では Rust の命令を呼び、ブラウザで動かすとき（開発の画面）は localStorage に書く。
- **遅延保存**: 変更のたびにすぐ書かず、変更が 0.5 秒止まってから書くやり方。
- **保存の順番待ち（キュー）**: 書く先（範囲・作品・ボード）と中身の写しを組にして並べ、1つずつ順に書く仕組み。ボードを切り替えても、Canvas が閉じても、書く先が入れ替わらない。
- **世代**: ボードを読み込むたびに1つ増える番号。古い読み込みの応答や古い保存の完了が届いても、番号が違えば捨てる。
- **埋め込み**: メイン画面の中で Canvas を開いた状態（`appMode === "canvas"`）。別ウィンドウは `idea-canvas` という名前の窓。

### 1. データの形

- 作品のボード: `<作品>/.then/boards/<ボードID>.canvas`（Rust が書く。整形した JSON）。並び順は同じフォルダの順番のファイル、ゴミ箱は同じフォルダのゴミ箱のフォルダ（`canvas_board_order_path`・`canvas_board_trash_dir`）。
- 保存するとき Rust は、`then.version` を 1、`then.scope` を渡された範囲、`then.updatedAt` を今の時刻に書き直し、名前が空なら「Idea Board」を入れる（`stamp_canvas_board`）。全作品の資料カードがあれば消す。
- ブラウザで動かすとき: localStorage の `then.canvas-board.<scope>.<rootPath>`（ボードIDから中身への表）、`….order`（並び順）、`….trash`（ゴミ箱。中間稿も一緒に持つ）。

### 2. 利用者の操作と内部の処理

| 操作 | 内部の処理 |
|---|---|
| Canvas を開く | 渡された作品のボードの一覧を読み（`listBoards`）、指定のボードか先頭を読み込み（`loadBoard`）、正規化して出す。読む前に、前の Canvas が書き残した保存を書き切る（`boardSaveQueue.flush()`）。表示は「読み込み中」→「保存済み」 |
| カードを足す・動かす・書く・色を変える・線を引く・名前を変える | ボードの値を書き換える（`patchBoard`）。`then.updatedAt` を今にする。変わるたびに遅延保存の useEffect が、書く先と中身を順番待ちに入れ、「保存中」と出す。0.5 秒止まると書き、ボードの一覧を読み直して「保存済み 12:34:56」と出す |
| ボードを切り替える | 待っている時計を止め、順番待ちを書き切ってから、次のボードを読む。書けなかったら切り替えずに、エラーの文を出す |
| 新しいボード | `createBoard` のあと、そのボードを開く |
| 並べ替え（上へ・下へ・ドラッグ） | 一覧の順を変えて `reorderBoards`。並び順の保存は、それ用の順番待ち（部品ごとの ref）で1つずつ |
| ゴミ箱へ | 開いているボードなら時計を止め、世代を進める。並び順と順番待ちを書き切ってから、中間稿の後始末（`prepareDraftBoardTrash`）、`trashBoard`、一覧を読み直して隣のボードを開く |
| ゴミ箱から戻す | `restoreTrashedBoard` のあと、ゴミ箱の一覧と、開いていたボード（なければ戻したボード）を読み直す |
| ほかの作品へ送る | 順番待ちと中間稿を書き切り、ボードを読み、資料を写すか外し、送り先にボードを作って直接 `save_canvas_board` で書く。中間稿があれば写す。移動なら元をゴミ箱へ |
| 作品の中の改名・移動 | Rust がボードのファイルを書き換えたあと、`then-canvas-path-changes` を受けて、持っているボードと履歴の資料カードを付け替える。付け替えたら遅延保存で書く |
| Canvas を閉じる（モードの切り替え・窓を閉じる） | 世代を進め、順番待ちを書き切る（失敗は黙って捨てる）。順番待ちは部品の外の1つの実体なので、次に開いた Canvas がその書き切りを待ってから読む |

### 3. 保存

- 保存先は工程2の1。いつ書くかは、変更が 0.5 秒止まったとき、ボードを切り替えるとき、ゴミ箱へ入れる・送る前、Canvas が閉じるとき。
- 読み込んだ直後と、ボードがなくなったときの1回は、保存しない（`suppressNextSaveRef`）。
- 読み込みが終わるまでは編集を受け付けない（`draftCanvasReadyRef`）。
- 開いているボードの書く先（`loadedBoardTargetRef`）が今の作品・範囲・ボードと違えば、保存しない。作品を切り替えた直後に、前の作品のボードを新しい作品へ書く事故を防ぐ。

### 4. ほかの機能との関係

- 中間稿: Canvas が選んでいるボードとカードを、右サイドバーの中間稿のペインへ渡す（`onDraftCanvasChange`）。ゴミ箱へ入れる・送るときに中間稿も扱う。
- 資料: 資料カード（`reference` ノード）は資料のパスを持つ。改名・移動で付け替える。
- つながり（3-4）: Rust の `list_board_references` が `.canvas` を直接読む。
- 投稿: Canvas から投稿へコピーする（`then-canvas-copy-to-post`）。ボードは書かない。
- メイン画面の閉じる処理（`then-before-close` → `flushPendingSaves`）: Canvas は載っていない。

### 5. 今の挙動の癖（直さないもの。工程9で、分離の前と同じであることを確かめる）

| # | 癖 | 確かめ方 |
|---|---|---|
| 1 | カードを直してから 0.5 秒以内に Then を閉じると、その変更は保存されないことがある。Canvas の遅延保存が、閉じる前に書き切る仕組み（`pendingSaves`）に載っていないため。メインを閉じると Canvas の別ウィンドウも消される（`close_linked_child_windows`）ので、別ウィンドウでも同じ | 見込み（コードを読んで）。実機で確かめるかは確認1で決める |
| 2 | 同じボードを埋め込みと別ウィンドウの両方で開いて両方で直すと、後から書いたほうが勝ち、先に書いたほうの変更は消える。互いの変更を知らせ合わない（順番待ちは窓ごとに1つ） | 見込み。4-2・3.9 の「どこで編集中か」と関係する |
| 3 | 外のアプリで `.canvas` を書き換えても気づかず、開いている Canvas が次に保存すると上書きする | 見込み |
| 4 | 読み込み中（「読み込み中」と出ている間）の編集は、何も言わずに捨てる | 見込み |
| 5 | Canvas が閉じるときの書き切りに失敗しても、何も出ない。変更は順番待ちに残り、同じ窓で次に Canvas を開くときに書き直す。その前にアプリを閉じれば失われる | 見込み（再試行は `test:canvas-save` が確かめている） |
| 6 | 保存するたびに、ボードの一覧を読み直す（0.5 秒ごとに `list_canvas_boards`） | コードで確かめた |
| 7 | 読み込んだ直後の表示は「保存済み」（時刻なし）で、保存したあとは「保存済み 12:34:56」 | 実機で確かめる |
| 8 | ブラウザで動かすとき、ないボードを読むと空のボードが返る。Tauri では「canvas board does not exist」のエラーになる | コードで確かめた（工程8のテストで固定する） |
| 9 | ほかの作品へ送る処理と中間稿は、保存の層を通らずにボードを読み書きする（工程1の気づいた点3） | コードで確かめた |
| 10 | Rust は、全作品の資料カードがあると、読むだけでもファイルを書き直す（`load_canvas_board`） | コードで確かめた |
| 11 | 開いているボードをゴミ箱へ移すと、隣のボードを開き直すので、表示は「保存済み」になり、「ボードをゴミ箱へ移動しました」は出ない（開いていないボードを移したときだけ出る） | 工程9で、実機で見つけた |

---

## 工程3: 依存関係

### A. React に依存しない処理（移すもの）

| 名前 | 読む | 書く | 呼ぶ | 呼ばれる |
|---|---|---|---|---|
| `localStorageKey`・`…OrderKey`・`…TrashKey` | `LOCAL_STORAGE_PREFIX` | — | — | localStorage の読み書き6つ |
| `readLocalBoards`・`writeLocalBoards` | localStorage | localStorage | `normalizeCanvasDocument` | 保存の層の中だけ |
| `readLocalBoardOrder`・`writeLocalBoardOrder` | 同上 | 同上 | — | 同上 |
| `readLocalBoardTrash`・`writeLocalBoardTrash` | 同上 | 同上 | — | 同上 |
| `summarizeLocalBoard` | — | — | — | 同上 |
| `listBoards` | — | — | `invoke("list_canvas_boards")` | `loadBoardList`・遅延保存・並び順の失敗・ゴミ箱へ・`restoreTrashedBoard` |
| `createBoard` | — | — | `invoke("create_canvas_board")`・`createCanvasDocument` | `submitCreate` |
| `loadBoard` | — | — | `invoke("load_canvas_board")`・`createCanvasDocument` | `loadBoardList`・`openTransfer`・`submitTransfer` |
| `saveBoard` | — | — | `invoke("save_canvas_board")` | 順番待ちの実体だけ |
| `canvasBoardSaveQueue` | — | — | `new CanvasBoardSaveQueue(saveBoard)` | 部品の `boardSaveQueue` |
| `reorderBoards` | — | — | `invoke("reorder_canvas_boards")` | `persistBoardOrder` |
| `trashBoard` | localStorage の中間稿 | 同 | `prepareDraftBoardTrash`・`draftBoardKey`・`invoke("trash_canvas_board")` | `trashBoardAndRefresh` |
| `listTrashedBoards` | — | — | `invoke("list_trashed_canvas_boards")`・`boardName` | ゴミ箱を開く・復元 |
| `restoreTrashedBoard` | — | localStorage の中間稿 | `invoke("restore_canvas_board")`・`listBoards`・`draftBoardKey` | `restoreBoard` |
| `isTauriRuntime` | `window` | — | — | 保存の層の8か所と、部品の9か所 |
| `boardName` | — | — | — | `listTrashedBoards` と、部品の5か所 |

### B. 値（state）

すべて部品の中に残す: `payload`・`scope`・`boards`・`activeBoardId`・`board`・`status`・`trashedBoards`ほか。ref は `saveTimerRef`（遅延保存の時計）・`loadedBoardTargetRef`（開いているボードの書く先）・`boardLoadGenerationRef`（世代）・`boardOrderSaveQueueRef`（並び順の順番待ち）・`suppressNextSaveRef`・`boardRef`・`draftCanvasReadyRef`。

### C. 操作の関数（すべて残す）

- C-1 開く・切り替える: `loadBoardList`（`useCallback`。依存は `payload`・`clearHistory`・`boardSaveQueue`・`setThreadDropTarget`）、`switchBoard`
- C-2 作る・名前を変える: `submitCreate`、`renameBoard`
- C-3 並べ替え: `persistBoardOrder`・`moveBoard`・`dropBoard`
- C-4 ゴミ箱: `openTrashModal`・`confirmDeleteBoard`・`trashBoardAndRefresh`・`restoreBoard`
- C-5 送る: `openTransfer`・`submitTransfer`（`invoke("create_canvas_board")`・`invoke("save_canvas_board")` を直接呼ぶ。資料の写し・中間稿も扱う）

### D. 自動で走る処理（すべて残す）

- D-0 payload を受け取る（1470〜1493行。埋め込みなら props、別ウィンドウなら `get_canvas_window_payload` と `then-canvas-payload`）
- D-1 payload を受けたら `loadBoardList`（1495〜1502行）
- D-2 改名・移動の知らせ（1517〜1545行）
- D-3 遅延保存（1548〜1582行）。依存は `activeBoardId`・`board`・`payload`・`scope`・`boardSaveQueue`
- D-4 閉じるときの書き切り（1585〜1591行）。依存は `boardSaveQueue`
- D-5 送り先の一覧（1834〜1850行）

### E. 作品を開く経路

`payload`（作品のパス）が変わると D-1 が走り、`loadBoardList` が順番待ちを書き切ってから新しい作品のボードを読む。書く先は `loadedBoardTargetRef` に固定され、D-3 は今の作品と書く先が同じときだけ保存する。今回は動かさない。

### F. 画面部品への受け渡し

変えない。保存に関わる props は、App から渡す `embedded`・`embeddedPayload`・`onDraftCanvasChange` などで、保存の層は関わらない。

### G. App の外とのやり取り

- Rust の命令: `list_canvas_boards`・`create_canvas_board`・`load_canvas_board`・`save_canvas_board`・`reorder_canvas_boards`・`trash_canvas_board`・`list_trashed_canvas_boards`・`restore_canvas_board`（保存の層へ移る）、`library_transfer_destinations`・`transfer_reference_files`・`load_intermediate_draft`・`save_intermediate_draft`・`get_canvas_window_payload`（残る）。命令の名前と引数は1文字も変えない。
- ウィンドウ間の知らせ: `then-canvas-payload`・`then-canvas-live-data`・`then-canvas-path-changes`・`then-canvas-copy-to-post`（残る）。

### H. CanvasWindowApp.tsx を読むテスト

工程1の2つの表のとおり。文字列を確かめるのは `test:performance` の `createLatestFrameScheduler` だけで、移さない。

### 結び目

1. 順番待ちの実体は、部品の外に1つだけある。Canvas が閉じて開き直しても、同じものを使うことで、前の保存を待ってから読める。移した先でも1つのままにする（移した先のファイルの中で作る）。
2. `isTauriRuntime` と `boardName` は、保存の層と部品の両方で使う。
3. `test:canvas-save` は import の名前を1つずつ差し替えて読むので、新しい import を足すと、テストの表も直す必要がある。
4. 中間稿と送る処理は、保存の層を通らずにボードを読み書きする。
5. 保存の流れ（時計・世代・書く先の固定）は、部品の ref と useEffect に絡んでいる。

---

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/CanvasWindowApp.tsx`（約255行減る）、`src/canvasBoardStore.ts`（新しく、約270行）、`scripts/test-canvas-board-save.mjs`（読み込みの差し替え表に1項目）、新しい回帰テスト `scripts/test-canvas-board-store.mjs`、`package.json`（テストの名前を1つ足す）、この手順書。
- 条件しだいで変わる: `docs/KNOWN_ISSUES.md`（癖を記録すると決めたら）、`docs/BINDER_REBUILD_PLAN.md`（4-1 を実施済みにする）。
- 変えない: Rust、`src/App.tsx`、`src/canvasTypes.ts`、`src/canvasBoardSaveQueue.ts`、`src/intermediateDraftStore.ts`、CSS、画面の文言。

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 保存の層の関数（`listBoards` から `restoreTrashedBoard` まで） | 高 | 書く先や引数を取り違えると、ほかのボードやほかの作品を上書きする。ただし中身は1文字も変えずに移すので、起こるのは import の取り違えくらい |
| 順番待ちの実体 | 高 | 2つできてしまうと、開き直しのときに前の保存を待たずに読み、古い中身を出して上書きしうる。移した先で1つだけ作る |
| `isTauriRuntime` | 中 | 取り違えると、Tauri の中で localStorage に書く（ファイルに保存されない） |
| `boardName` | 低 | ゴミ箱の一覧と画面の名前の表示 |
| 保存の流れ（残す） | — | 動かさない |

### 4-3. 機能ごとに起こりうる回帰不具合と、今のテストで気づけるか

| 機能 | 起こりうること | 今のテスト |
|---|---|---|
| 開く・切り替え・閉じる・開き直し・作品の切り替え | 前の保存を待たずに読む、別の作品へ書く | 実際に動かしている（`test:canvas-save`。ただし Tauri の側だけ） |
| ゴミ箱へ | 消したボードを書き戻す | 実際に動かしている（同上） |
| 新しいボード・並べ替え・ゴミ箱の一覧・復元 | 命令の引数の取り違え | **なし**（工程8で足す） |
| ブラウザで動かすとき（localStorage） | キー・並び順・ゴミ箱・復元の名前の付け直し | **なし**（工程8で足す） |
| 送る | 送り先のボード | `test:library` は資料の書き換えだけ。送る処理は動かさないので影響しない |
| 実機（Rust とファイル） | — | 工程9で確かめる |

### 4-4. 今の自動テストの状態（「前」の一式の結果）

「前」の一式は `998356e`（main `0fb6f4b` と同じ中身）で動かした。build は通り、メインの塊は 721,150 バイト。125 本のうち 122 本が通り、次の3本が落ちた。どれも Canvas とは関係ない元からの失敗として扱う。

| テスト | 結果 | 中身 |
|---|---|---|
| `test:editor-selection` | 600 秒で打ち切り | 終わらなかった（エラーの文なし） |
| `test:editor-text-edits` | 失敗 | 「every icon draws its own picture」の確かめで落ちる |
| `test:v058-bundle` | 失敗 | メインの塊が 500 kB の上限を超えている（721,150 バイト）。元から超えている |

Canvas に関わる `test:canvas-save`・`test:v063-draft`・`test:v064-canvas`・`test:library`・`test:connections`・`test:performance` は通った。残っていたプロセスは全部 0。

---

## 工程5: 案

### 5-1. 方針

`references/separation.md` の線引きのとおり、値・保存の流れ・useEffect は部品に残し、React を使わない保存の層だけを、中身を変えずに `src/canvasBoardStore.ts` へ移す。違うのは、`export` を付けることと、import の行だけ。

### 5-2. 移すもの

工程1の表で「移す」とした所（71・79〜95・172・187〜432・598〜600行）。新しいファイルの並びは元の順のまま:

```text
src/canvasBoardStore.ts
  import（invoke, canvasTypes, intermediateDraft, intermediateDraftStore, canvasBoardSaveQueue）
  LOCAL_STORAGE_PREFIX
  export type TrashedCanvasBoardSummary / type LocalTrashedCanvasBoard
  export const isTauriRuntime
  localStorage の読み書き10個
  export listBoards / createBoard / loadBoard / saveBoard
  export const canvasBoardSaveQueue
  export reorderBoards / trashBoard / listTrashedBoards / restoreTrashedBoard
  export boardName
```

`saveBoard` は順番待ちの実体だけが使うので、書き出さなくてもよいが、4-2 で使う見込みと回帰テストのために書き出す（決めてほしいこと 3）。

### 5-3. 残すもの

- 遅延保存の時計・世代・書く先の固定・読み込み済みの印（ref と D-3・D-4）。
- 開く・切り替え・並べ替え・ゴミ箱・送るの操作（C-1〜C-5）。`useCallback` の依存の指定ごと。
- `formatSaveTime`・`fallbackPayload`・画面の文言。
- 中間稿と送る処理の、保存の層を通らない読み書き（癖9）。まとめない。

### 5-4. 4-2・4-3 が足しやすい切り方

調べて分かったこと（今回は実装しない）:

- **4-2（参照先のファイルへの書き戻し）**: 書き戻しは、ボードの `.canvas` とは別の書く先（ノート・原稿の md）への保存になる。保存の層に「書く先とファイルの内容の写しを組にして並べる順番待ち」をもう1つ足し、`canvasBoardSaveQueue` と並べて置ける。今の部品は順番待ちを書き切る所が5か所ある（`loadBoardList`・`openTransfer`・`submitTransfer`・`trashBoardAndRefresh`・閉じるときの useEffect）ので、4-2 ではそこへ書き戻しの書き切りも並べることになる。外の変更の確かめ（3.9 の `expected_hash`）も、この層に入れれば部品は触らずに済む。癖1（閉じるときの書き切り）・癖2（窓どうし）・癖3（外の変更）は、4-2 の書き戻しでも同じ形で問題になるので、4-2 の手順書で一緒に扱うのがよい。
- **4-3（Canvas を中央の表示に）**: 埋め込みの Canvas（`appMode === "canvas"`）を土台にすると、タブを切り替えるたびに Canvas が閉じて開き直す。順番待ちの実体が部品の外に1つあることが、開き直しの前に書き切るのを支えている（`test:canvas-save` の remount の確認）。保存の層を別ファイルにしておけば、中央の表示の側（App）からも、同じ実体を import して「閉じる前に書き切る」を呼べる。
- **今回やらない**: 保存の流れ（時計・世代・書く先）を、React を使わない「保存の係」にまとめること（下の案 B）。4-2 で書き戻しの書き切りを5か所に並べるのは手間なので、4-2 の最初の1歩として、その時に `flushAll` のような入口を作るほうが、何を書き切るかが決まってから形を決められる。

### 決めてほしいこと

**1. どこまで切り出すか**

- **A（勧め）: 保存の層だけを移す。** 中身は1文字も変えず、引っ越しだけで済む。保存の流れは部品に残すので、useEffect の順番も React が値を覚える順番も変わらない。4-2 は、この層に書き戻しの順番待ちを足す形で始められる。
- B: 保存の層に加え、遅延保存の時計・世代・書き切りを「保存の係」（React を使わない入れ物）にまとめる。4-2 で書き切る所を1つにまとめられるが、ref と useEffect の中身を書き換えるので、引っ越しでは済まず、切り替え・閉じる・作品の切り替えの順番が変わりうる（影響は高）。

**2. 部品と共有する `isTauriRuntime`・`boardName` の置き場**

- **保存の層から書き出し、部品はそれを import する（勧め）。** 同じ定義が2か所にならない。部品の側の9か所・5か所は、名前が同じなので書き換えなし。
- 部品の側にも同じ定義を残す（2つになる）。

**3. `saveBoard` を書き出すか**

- **書き出す（勧め）。** 回帰テストで、ブラウザのときと Tauri のときの書き方を直接確かめられる。4-2 でも使う見込み。
- 書き出さない（今と同じく、順番待ちの実体の中だけで使う）。

**4. 今の挙動の癖（工程2の5）をどうするか**

- **今回は直さず、手順書に残す。癖1〜3 は 4-2 の手順書で扱う候補として `BINDER_REBUILD_PLAN.md` の 4-2 の行に一言添える（勧め）。** 分離では仕様を変えないため。癖1〜3 は書き戻しでも同じ形で起きるので、4-2 で一緒に決めるほうが一度で済む。
- 癖1（閉じる前の 0.5 秒）だけは、別の修正として先に直す（`pendingSaves` に載せる。`docs/ANCHOR_SAVE_ON_CLOSE_FIX_PLAN.md` と同じ形）。今回の分離が終わってから、別のブランチで。
- `docs/KNOWN_ISSUES.md` にも癖1〜3 を記録する（直すかは別に決める）。

**5. 癖1 を実機で確かめるか**

- **確かめる（勧め）。** カードを直してすぐ（0.5 秒以内）閉じ、再起動してどうなるかを、分離の前（今の Then.exe）ではなく分離の後の QA 用アプリで見る。分離で変わらないことの確認にはならないが、4-2 の判断の材料になる。数分で済む。
- 確かめない（見込みのまま残す）。

### テストの直し方と足すテスト

- `test:canvas-save`: 読み込みの差し替え表に `"./canvasBoardStore"` を足す。中身は、保存の層を同じやり方で変換したもの（その中の `@tauri-apps/api/core`・`./canvasTypes`・`./intermediateDraft`・`./intermediateDraftStore`・`./canvasBoardSaveQueue` も、今の表と同じものに差し替える）。順番待ちの部分のテスト（前半）は今のまま。確かめる中身は変えない。
- 新しい回帰テスト `scripts/test-canvas-board-store.mjs`（`npm run test:canvas-store`）。移した関数を実際に動かす:
  - Tauri のとき: 8つの関数が、どの命令を、どの引数で呼ぶか（範囲・作品・ボードID・中身・並び順・ゴミ箱のID）。`trashBoard` が中間稿の後始末を先に呼ぶこと。`canvasBoardSaveQueue` が `save_canvas_board` で書くこと。
  - ブラウザのとき（localStorage）: 作る → 一覧 → 読む → 書く → 並べ替え（並び順にあるものが先、ないものは直した時刻の新しい順）→ ゴミ箱へ（中間稿も一緒に移り、並び順から外れる）→ ゴミ箱の一覧（消した時刻の新しい順、名前は `boardName`）→ 戻す（同じIDがあれば `-2`、中間稿もIDを付け替えて戻り、並び順の最後に付く）。ないボードを読むと空のボード（癖8）。作品ごとにキーが分かれること。
  - 効くことの確かめ: 移した処理にわざと不具合を2つ入れ（並び順の比べ方、復元の名前の付け直し）、テストが落ちるのを見て `git checkout -- src/canvasBoardStore.ts` で戻す（その前にコミットしておく）。

### 進め方とコミットの分け方

1. `move-lines.mjs` で5つの塊（71行、79〜95行、172行、187〜432行、598〜600行）を `src/canvasBoardStore.ts` へ移し、`verify-move.mjs` で lost 0 を確かめる。`export` を付け、部品の import を直す。使わなくなった import（`createCanvasDocument`・`draftBoardKey`・`prepareDraftBoardTrash`・`CanvasBoardSaveQueue` など）は `symbol-uses.mjs` で確かめて外す。`test:canvas-save` の差し替え表を直す。`npx tsc --noEmit`・`test:canvas-save`・`test:performance`・`npm run build` を通してコミット。
2. 回帰テストを足し、効くことを確かめてコミット。
3. 「後」の一式と前後の比較。
4. 実機確認（下）。
5. 手順書・`BINDER_REBUILD_PLAN.md`（と、決めたなら KNOWN_ISSUES）を書いてコミット。

### 実機確認の項目（工程9）

`src-tauri/target/release/Then.exe` を識別子 `local.then.qa.linksyntax1117` で build し直して使う。始める前に Then.exe が動いていないことを確かめ、`%APPDATA%\local.then.qa.linksyntax1117` と `%LOCALAPPDATA%\local.then.qa.linksyntax1117` を退避し、終わったら戻して、中身がチェックポイントのときと同じであることを確かめる。入力は OS の入力（SendInput）、浮く部品は rect・`elementFromPoint`・実画面のスクリーンショットで確かめる。qa-session の ready の行の `screen:` が `keeping` であることを確かめ、そうでなければ CDP で代えて、そう書く。

| # | 項目 | 確かめ方 |
|---|---|---|
| 1 | ボードを開く | バインダーの行・メニューから Canvas を開き、カードが `.canvas` のとおりに出る |
| 2 | カードを動かす | ドラッグで動かし、2秒待って `.canvas` の `x`・`y` が変わる。「保存済み 時刻」が出る |
| 3 | 保存して再起動で戻る | 再起動して同じボードを開き、カードの位置・本文・色が同じ。画面の全体を再起動の前後で突き合わせる |
| 4 | カードを書く・色・線・名前の変更 | `.canvas` と画面を突き合わせる |
| 5 | ボードの切り替え・新しいボード・並べ替え | 切り替えた先で直しても前のボードのファイルが変わらない。並び順のファイル |
| 6 | ゴミ箱へ・戻す | 消したボードが書き戻されない。戻すと一覧に戻る |
| 7 | 埋め込みと別ウィンドウ | どちらでも開いて保存できる |
| 8 | 作品の切り替え | 切り替える前の作品の `.canvas` が、切り替えの前後で同じ |
| 9 | 癖7（「保存済み」の表示）、癖1（決めてほしいこと 5 で決めたら） | 画面の表示と、再起動のあとのファイル |

### 見込みと、今回やらないこと

- 見込み: CanvasWindowApp.tsx は約255行減り 3,340 行ほど、`src/canvasBoardStore.ts` は約270行。実施は30分ほど、「後」の一式が20分、QA 用アプリの build と実機確認で1時間ほど。
- 今回やらない: 4-2・4-3 の中身、保存の流れの「保存の係」へのまとめ（案 B）、中間稿と送る処理を保存の層へ寄せること、癖の修正、Rust。

---

## 工程6: 人の確認

2026-11-21 に、決めてほしいこと 1〜5 をすべて勧めのとおりに決めた。

1. 切り出すのは保存の層だけ（案 A）。保存の流れは部品に残す。
2. `isTauriRuntime`・`boardName` は保存の層から書き出し、部品は import する。
3. `saveBoard` も書き出す。
4. 癖は直さず手順書に残す。癖1〜3 は `BINDER_REBUILD_PLAN.md` の 4-2 の行に、4-2 で扱う候補として一言添える。KNOWN_ISSUES には書かない。
5. 癖1（閉じる前の 0.5 秒）は、分離の後の QA 用アプリで確かめる。

---

## 工程7: 実施

| コミット | 内容 |
|---|---|
| `1558474` | 保存の層を `src/canvasBoardStore.ts` へ移す。`test:canvas-save` の読み込みの差し替え表に `./canvasBoardStore` を足す |
| `3781223` | 回帰テスト `test:canvas-store` を足す |
| `ce20b79` | 回帰テストを強める（工程8の「効くことの確かめ」で見つけた抜け） |

- 行数: `CanvasWindowApp.tsx` 3,594 → 3,336 行（行番号で数えた数）。`src/canvasBoardStore.ts` は 287 行。
- 移し方: `move-lines.mjs` で5つの塊（72行、80〜95行、172行、187〜432行、599〜601行。`998356e` の時点の行番号）を移した。
- 元と同じであることの確かめ: `verify-move.mjs` で、消えた 247 行のうち、移した先にない行（lost）は 0。CanvasWindowApp.tsx に足したのは `./canvasBoardStore` からの import の13行だけ。
- 違う点: 移した先で `export` を付けた（`TrashedCanvasBoardSummary`・`isTauriRuntime`・`listBoards`・`createBoard`・`loadBoard`・`saveBoard`・`canvasBoardSaveQueue`・`reorderBoards`・`trashBoard`・`listTrashedBoards`・`restoreTrashedBoard`・`boardName`）。移した先の先頭に import とコメント2行を足した。CanvasWindowApp.tsx で使わなくなった import（`createCanvasDocument`・`draftBoardKey`・`prepareDraftBoardTrash`・`CanvasBoardSaveQueue`）を外した。
- 確かめたこと: `npx tsc --noEmit`、`test:canvas-save`（10本の PASS がすべて出る）、`test:performance`、`test:v063-draft`、`npm run build`（メインの塊は前と同じ 721,150 バイト。Canvas は別の塊）。

## 工程8: 自動テスト

### 足した回帰テスト `test:canvas-store`（`scripts/test-canvas-board-store.mjs`）

- Tauri のとき: 8つの関数と順番待ちの実体が、どの命令をどの引数で呼ぶかを、順番ごと確かめる。ゴミ箱へ入れるときは、中間稿の後始末が先。localStorage には書かない。
- ブラウザのとき: 作る・一覧（並び順のあるものが先、ないものは直した時刻の新しい順）・読む（ないボードは空のボード。癖8）・作品ごとのキー（作品がなければ `unbound`）・並べ替え・ゴミ箱へ（中間稿も移り、並び順から外れる。ないボードはエラー）・ゴミ箱の一覧（消した時刻の新しい順）・戻す（同じ ID が1つなら `-2`、2つなら `-3`、空いていれば元の ID。中間稿も新しい ID で戻る。並び順の最後に付く）・順番待ち・`boardName`。

### 効くことの確かめ

コミットしてから、移した処理にわざと不具合を入れ、`git checkout -- src/canvasBoardStore.ts` で戻した。

| 入れた不具合 | `test:canvas-store` | `test:canvas-save` |
|---|---|---|
| 並び順の比べ方を逆にする | 落ちた（「並び順にあるものが先…」） | — |
| 復元のときの付け直しを1つ先から数える | 1回目は**通ってしまった**。「c と c-2 があるとき c-3」の場合しか試しておらず、答えが同じになるため。「同じ ID が1つだけなら -2」を足して（`ce20b79`）、落ちることを確かめた | — |
| 保存の命令の引数に余計な項目を足す | 落ちた（命令の引数の比べ） | 通った（10本とも PASS）。元のテストは保存の中身しか見ていない |

### 前後の比較

| | 「前」`998356e` | 「後」`ce20b79` |
|---|---|---|
| build | 通った | 通った |
| メインの塊 | 721,150 バイト | 721,150 バイト |
| テストの数 | 125 | 126（`test:canvas-store` を足した） |
| 両方で通った | 122 | 122 |
| 両方で落ちた | `test:editor-selection`（600 秒で打ち切り）・`test:editor-text-edits`（every icon draws its own picture）・`test:v058-bundle`（塊の大きさ） | 同じ3本、同じ理由 |
| 新しい失敗 | — | なし |
| 残ったプロセス | 全部 0 | 全部 0 |

## 工程9: 実機確認

### やり方

- `src-tauri` で `cargo build --release --bins --features tauri/custom-protocol` を先に動かし（8分57秒）、`qa-build.mjs local.then.qa.linksyntax1117` で `src-tauri/target/release/Then.exe` を作った（`ce20b79` の中身）。
- 始める前に Then.exe が動いていないことを確かめ、`%APPDATA%\local.then.qa.linksyntax1117`（2ファイル）と `%LOCALAPPDATA%\local.then.qa.linksyntax1117`（277ファイル、約73 MB）を scratchpad へ退避し、SHA-256 の一覧を取った。
- 一時ライブラリ: 作品A（「QAボード」カード2枚と矢印1本、「第二ボード」カード1枚）、作品B（「Bのボード」カード1枚）。
- qa-session の ready の行は、4回の起動すべてで `screen: keeping`。
- 入力はすべて OS の入力（SendInput）。クリック・文字・キーは `osinput.ps1`。ドラッグとダブルクリックは `osinput.ps1` にないので、同じ作りの小さな道具を scratchpad に書いた（押す → 少しずつ動かす → 離す、など）。押す位置は、毎回 CDP で rect を測り、`elementFromPoint` でその点がねらいの部品であることを確かめてから送った。
- 結果は、画面の値（CDP で読んだ）、`.canvas` ファイルのハッシュと中身、Then の窓の撮影（`osinput.ps1 -Shot`）で確かめた。

### 確認した項目と結果

| 確認したこと | 結果 |
|---|---|
| ボードを開く | 右のペイン「アイデア」の「Idea Board を開く」を OS のクリックで押すと、メイン画面の中に「QAボード」が開いた。カード2枚が `.canvas` の位置（120,120）（460,120）に出た。表示は「保存済み」。撮影で、カードと矢印が見えることを確かめた |
| カードを動かす | 1枚目を OS のドラッグで下へ動かすと、画面の位置が y 120 → 340.8 になり、「保存済み 04:47:57」と出た。`.canvas` も (120, 340.8) になった（撮影でも確かめた） |
| カードを書く | ダブルクリック（OS）で本文の欄に入り、Ctrl+End と文字（OS）で「一枚目のカード（実機で書き足した）」にすると、欄と `.canvas` の両方がその文になった（「保存済み 04:48:41」） |
| ボードの切り替え | メニューから OS のクリックで「第二ボード」へ切り替え、カードを (200,200) → (50,100) へ動かした。QAボードのファイルはハッシュが変わらなかった |
| 新しいボード | 「ボードを作成」→ 名前に「（実機）」を足して「作成」で、「作品A ボード（実機）」が開き、`作品a-ボード実機.canvas` ができた |
| 並べ替え | 「「QAボード」を上へ移動」で一覧が「作品A ボード（実機）・QAボード・第二ボード」になり、「並び順を保存しました」と出た。`.board-order.json` も同じ順 |
| ゴミ箱へ・戻す | 開いている新しいボードをゴミ箱へ移すと、`.trash/<時刻>--作品a-ボード実機.canvas` へ移り、並び順から外れ、隣の QAボードが開いた。ゴミ箱の画面の「復元」で「ボードを復元しました」と出て、ファイルが戻り、並び順の最後に付いた |
| 作品の切り替え | 作品B へ切り替えると Canvas は閉じて本文の画面に戻った。作品B で Idea Board を開き、カードを動かすと、作品B のボードだけが変わり、作品A の4つのファイル（並び順を含む）はハッシュが変わらなかった |
| 保存して再起動で戻る | 作品A の QAボードを開いた画面（作品・ボード・保存の表示・カードの位置と大きさと本文・線）を記録し、QA アプリを止めて起動し直し、同じボードを開いた。画面の記録は完全に同じ、ボードのファイルのハッシュもすべて同じ。撮影でも、書き足した本文と位置のまま |
| 別ウィンドウ | 設定「キャンバス」の「キャンバスを別ウィンドウで開く」を OS のクリックで入れ、「Idea Board を開く」で「Then - Idea Board」の窓が開いた。その窓で OS のドラッグでカードを (120,341) → (320,191) へ動かすと「保存済み 04:59:06」と出て、`.canvas` も同じ位置になった。この窓の rect・`elementFromPoint`・保存の表示は CDP で読んだ。撮影はしていない（`osinput.ps1 -Shot` はメインの窓だけを撮るため） |

### 今の挙動の癖を実機で確かめた結果

- 癖1: カードを OS のドラッグで動かしてから約 60 ミリ秒後に、窓の「閉じる」を OS のクリックで押すと、その移動は保存されなかった（`.canvas` は前のまま、再起動後も前の位置、「保存されていない編集」の知らせも出ない）。同じ操作で、閉じるまでの間を 1.5 秒にすると保存された。ドラッグは届いていて、消えたのは 0.5 秒の遅延保存が閉じる前に書き切られないためと分かる。分離の後の Then.exe での結果だが、保存の流れは分離で変えていない。
- 癖7: 開いた直後の表示は「保存済み」（時刻なし）、保存したあとは「保存済み 04:47:57」のように時刻付き。
- 新しく気づいたこと（癖11）: 開いているボードをゴミ箱へ移すと、隣のボードを開き直すので、表示は「保存済み」になり、「ボードをゴミ箱へ移動しました」は出ない（開いていないボードを移したときだけ出る）。コードの流れのとおりで、分離では変えていない。

### 確かめられなかったこと

- 別ウィンドウの Canvas の撮影（上の理由）。
- 癖2（埋め込みと別ウィンドウで同じボードを直す）・癖3（外の変更）は、確認1で 4-2 の候補にしたので、実機では試していない。
- ほかの作品へ送る（移動・コピー）は、今回移した処理を通らないので、試していない。

### 片付け

- `q.mjs stop`、`qa-cleanup.mjs`: QA の Then・WebView2・keep-screen・テストの Edge と node・%TEMP% のテストのプロフィールはすべて 0。一時ライブラリと、その identifier の2つのフォルダを消した。
- 退避したフォルダを戻し、退避のときの SHA-256 の一覧と突き合わせた。Roaming 2/2、Local 277/277 が一致し、ファイルの数も同じ。
- `src-tauri/target/release/Then.exe` は、このブランチの中身（`ce20b79`）の QA 用 build（identifier `local.then.qa.linksyntax1117`）になっている。
- 3回目の起動で、qa-session をバックグラウンドの仕組みではなくシェルの `&` で動かした。qa-session 自身の止める条件で止まり、あとで数えて残りは 0。

## 工程10: 完了

### 変わったもの

- `src/canvasBoardStore.ts`（新しく）: ボードを読み書きする層。CanvasWindowApp.tsx から中身を変えずに移した。
- `src/CanvasWindowApp.tsx`: 3,594 → 3,336 行。保存の層を import する。保存の流れ・画面・文言は同じ。
- `scripts/test-canvas-board-save.mjs`: 読み込みの差し替え表に1項目。
- `scripts/test-canvas-board-store.mjs`・`package.json` の `test:canvas-store`: 回帰テスト。
- `docs/BINDER_REBUILD_PLAN.md`: 4-1 を実施済みにし、4-2 の行に癖1〜3 と書き戻しの置き場を添えた。
- 変えていない: Rust、保存形式、UI、文言、`src/App.tsx`、中間稿。

### 残っている別の作業

| 作業 | どこで |
|---|---|
| 4-2: `file` ノードと書き戻し。癖1〜3 もここで決める | `BINDER_REBUILD_PLAN.md` の 4-2。このブランチが main に入ってから |
| 4-3: Canvas を中央の表示に | 4-2 のあと |
| 癖11（ゴミ箱へ移したときの表示）をどうするか | 決めていない。直すなら別の修正として |
