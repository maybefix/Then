# プラグインの受け口 分離の手順書

プラグインからの頼み（`handlePluginRequest`）、プラグインの読み込み（`reloadInstalledPlugins`）、導入と削除、アンカー（プラグインが本文に付ける目印）の保存を、App.tsx から別のファイルへ移す。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/plugin-host`
- 戻し先: タグ `checkpoint/before-plugin-host`（コミット `a931e22`。中身は main `d3760ce` と同じ）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 済み（2026-10-26） |
| 7 | 実施 | 済み |
| 8 | 自動テスト | 済み |
| 9 | 実機確認 | 済み |
| 10 | 完了（確認2） | 済み（2026-10-26） |

## 工程1: 調査の結果

行番号は `a931e22` の時点（App.tsx は 9416 行）。

| まとまり | 行 | 行数 | 中身 |
|---|---|---|---|
| 部品の外の関数 | 597–640 | 44 | `pluginDocumentPath`、`pluginPermissionForMethod`、`objectArgs`、`pluginViewIcon` |
| ref | 1144–1155 | 12 | `pluginRuntimeHostRef` ほか8つ |
| state | 1205–1215 | 11 | 読み込んだプラグイン、登録されたコマンド・横の欄・画面・モーダル・状態表示、開いている画面とモーダル、置き場所の要素2つ、アンカー |
| 派生の値と表示の effect | 1391–1440 | 50 | 開いている横の欄・画面・モーダルを探す、選択範囲のメニューに出すコマンド、表示の切り替えの effect 4つ |
| 読み込みとアンカーの保存 | 1453–1573 | 121 | ref の同期、`reloadInstalledPlugins`、起動時の読み込み、作品の切り替えの知らせ、アンカーの読み込み、`persistPluginAnchors`、`retargetPluginAnchors` |
| 受け口と導入・削除 | 6993–7388 | 396 | 文書を探す・読む・見せる、アンカーをつなぎ直す、プラグインのデータの順番待ち、`handlePluginRequest`（268行）、`handleInstallPlugin`、`handleUninstallPlugin` |

App に残る、プラグインへの「送り出し」側（今回は動かさない）:
- 本文が変わったときの知らせとアンカーの追従（2531 の `useLayoutEffect`、3934 の `handleTextChange`）
- 選択範囲の知らせ（4094）、ショートカットでのコマンド実行（4612）、コマンドパレット（4755）、モードの切り替えの画面ボタン（6090）
- JSX（右クリックのメニュー 8965、状態表示 9073、画面の枠 9101、`<ThenPluginRuntimeHost>` 9140、プラグインの管理画面 9340）
- `isPluginManagerOpen`（管理画面を開いているか）

気づいた点:
- `handleProjectFileSelect`（6972）と `showToast`（4116）が後ろで宣言されているので、受け口と導入・削除は 6993 より前へ持っていけない。一方、state は 1391 から使われる。1つのフックにまとめると、どちらかが宣言前の値を読むことになる（工程5）。
- 文字列を読むテストは `test:v061-plugins` だけ（工程3 の H）。`text-deps.mjs` は `editor.getSelection` などの行を拾わなかったので、テストのファイルを直接読んで確かめた。
- `test:project-entry-actions` は `pluginAnchorsRef`・`persistPluginAnchors`・`retargetPluginAnchors` を偽物で渡している。App が同じ名前で渡し続ければ変わらない。
- 使われていない処理はない（`symbol-uses` で確かめた）。

## 工程2: 仕組みの説明

### 言葉
- **プラグイン**: 利用者が導入する追加の機能。Then 全体に入る（作品ごとではない）。中身は隔離された iframe（`ThenPluginRuntimeHost`）の中で動く。
- **受け口（ホスト）**: iframe の中のプラグインが「選択範囲をください」「画面を登録して」と頼んだときに、App の側で答える処理。`handlePluginRequest`。
- **権限**: プラグインの `manifest.json` に書かれた、使ってよい機能の一覧。頼みごとに必要な権限が決まっていて（`pluginPermissionForMethod`）、書かれていなければ断る。
- **アンカー**: プラグインが本文の範囲に付ける目印。範囲の前後の文字列も覚えていて、Then を閉じているあいだに本文が書き換わっても、前後の文字列から付け直す（つなぎ直し）。
- **プラグインのデータ**: プラグインが作品ごとに保存できる値（`storage.*`）。

### 1. データの形
- 読み込んだプラグイン: `LoadedThenPlugin[]`（manifest と中身）。
- 登録されたもの: コマンド（ショートカット・選択範囲のメニュー）、横の欄（右の欄のタブ）、画面（モードの切り替えに出る全面の画面）、モーダル、状態表示。どれも「プラグインの id ＋ 登録の id」で1つ。同じ組でもう一度登録すると置き換える。
- 開いているもの: 画面とモーダルは「プラグインの id:登録の id」の文字列で覚える。横の欄は右の欄のタブ名 `plugin:<プラグイン>:<id>` で覚える。
- アンカー: `ThenPluginAnchor[]`。保存の形は `{ version: 1, anchors }`。

### 2. 利用者の操作と内部の処理

| 操作 | 内部の処理 |
|---|---|
| 起動 | `list_installed_plugins` で読み込み、登録されたものと開いているモーダルを空にする。読めないプラグインがあれば、上のエラー表示に出す |
| 管理画面の「再読み込み」 | 同じ読み込み。失敗があれば「プラグインの再読み込みでエラーが発生しました」 |
| 管理画面の「導入」 | フォルダを選ぶダイアログ（`inspect_plugin_dialog`）→ 名前・版・権限を見せて確認 → `install_plugin` → 読み込み直し → 「プラグイン「…」を導入しました」。ブラウザで開いたときは「デスクトップ版で利用してください」 |
| 管理画面の「削除」 | 確認（作品ごとのデータとアンカーは残すと書いてある）→ `uninstall_plugin` → 読み込み直し → 「プラグイン「…」を削除しました」 |
| プラグインの頼み | 読み込まれているか、権限があるかを確かめてから、頼みの種類ごとに答える（下の表） |
| 作品を切り替える | プラグインへ `workspace.change` を知らせる。アンカーを読み込み直す（前の作品のまだ保存していないアンカーは、前の作品へ保存してから） |
| ファイルの名前の変更・移動 | アンカーの文書のパスを付け替える（`retargetPluginAnchors`。呼ぶのは `projectEntryActions`） |
| 開いている画面・横の欄・モーダルの登録が消える | 画面なら書くモードへ、横の欄ならプロットのタブへ戻す。モーダルは閉じる |
| モーダルを開いているときに Esc | モーダルを閉じる |

頼みの種類（`handlePluginRequest`）:

| 頼み | 権限 | 答え |
|---|---|---|
| `editor.getSelection` | document:selection | 今の文書のパス、選択範囲、選んだ文字列 |
| `editor.moveCursor` | document:navigate | アンカーか、文書と位置を受けて、書くモードにして（必要ならファイルを開いて）範囲を選ぶ |
| `anchors.create` / `resolve` / `reveal` / `delete` | document:anchors | 作る・つなぎ直す・見せる・消す |
| `storage.get` / `set` / `delete` | storage | 作品ごとのデータ。書き込みはプラグインごとに順番待ち |
| `commands.register` / `unregister` | commands | ショートカットの形を確かめて登録する |
| `views.register` / `registerScreen` / `registerModal` と、その `unregister*` | views | 横の欄・画面（manifest に icon が必要）・モーダル |
| `views.open` / `openModal` / `closeModal` | views | 画面なら画面のモードへ、横の欄なら右の欄を開いてそのタブへ。モーダルは今の画面のまま重ねる |
| `statusbar.set` / `remove` | statusbar | 160 文字以内 |

### 3. 保存
- アンカー: `load_plugin_anchors`／`save_plugin_anchors`（Rust）。作品のフォルダの中のファイル。書き換えのたびに 0.18 秒待ってまとめて保存する（`persistPluginAnchors`）。作品を切り替えるときは、待っている保存をすぐ前の作品へ書く。読み込みの途中でアンカーが書き換わったら、読み込んだ値は使わない（`pluginAnchorMutationVersionRef`）。
- プラグインのデータ: `load_plugin_project_data`／`save_plugin_project_data`。読む → 書き換える → 書く を、プラグインごとに1つずつ順に行う（`pluginStorageQueuesRef`）。
- 導入したプラグインそのもの: Rust が Then 全体の場所に置く。

### 4. ほかの機能との関係
- 本文のエディタ: 選択範囲・本文の変化を知らせる、アンカーを追従させる（App に残す）。
- 作品のファイルを開く処理（`handleProjectFileSelect`）: `moveCursor`・`reveal` で別の文書へ移るときに使う。
- ファイルの名前の変更・移動・削除（`projectEntryActions`）: アンカーを付け替える・片付ける。
- アプリ内ダイアログ（`requestConfirm`）、通知（`showToast`）、上のエラー表示（`setLastError`）。
- 右の欄（`RightSidebar`）、モードの切り替え、状態表示、右クリックのメニュー、コマンドパレット。

### 5. 今の挙動の癖（工程9で実機で確かめる）
1. **アンカーのファイルが読めないと、次の保存で上書きして消す**（見込み。コードから）。ファイルが壊れている（JSON として読めない）と「アンカーの読み込みに失敗しました」を出して空として扱う。`version` が 1 でないときは、知らせずに空として扱う。そのあとプラグインがアンカーを1つ作ったり、アンカーのある文書を書き換えたりすると、空から始めた一覧で元のファイルを書き換える。読めなかった中身は残らない。
2. **アンカーを書き換えてから 0.18 秒以内に Then を閉じると、その書き換えは保存されない**（見込み。コードから）。本文は打つたびに Rust の保存の記録（`save_journal`）へ送っていて、閉じても次の起動で戻せるが、アンカーの保存待ちには閉じるときの書き出しも、戻す手立てもない。次に開いたとき、本文とアンカーの位置がずれ、前後の文字列からのつなぎ直しに頼ることになる。（2026-10-26 に `fix/anchor-save-on-close` で直した。`docs/ANCHOR_SAVE_ON_CLOSE_FIX_PLAN.md`）
3. ブラウザで開いたときの削除は、確認を出してから失敗する（導入は先に「デスクトップ版で利用してください」を出す）。開発のときだけの違いなので、直さない。

## 工程3: 依存関係

**A. React に依存しない処理**
- `pluginDocumentPath`: App の送り出し側（4か所）と受け口の両方が使う。
- `pluginPermissionForMethod`・`objectArgs`・`pluginViewIcon`: 受け口だけが使う。

**B. 値（state と ref）**: すべて App の中だけ。`appState` には入っていない（保存の状態とは別）。
- 読む側: 派生の値、受け口、送り出し側、JSX。
- 書く側: 読み込み（空にする）、受け口（登録・開く）、表示の effect（消えたら戻す）、JSX（置き場所の要素）。

**C. 操作の関数**
- C-1 `reloadInstalledPlugins`（`useCallback`、依存なし）: 起動の effect、導入・削除、管理画面の再読み込み。
- C-2 `persistPluginAnchors`（`useCallback`、依存は作品のパス）: 送り出し側2か所、受け口、`retargetPluginAnchors`、`projectEntryActions`。
- C-3 `retargetPluginAnchors`（`useCallback`）: `projectEntryActions`。
- C-4 `handlePluginRequest`: `<ThenPluginRuntimeHost onRequest>`。描画のたびに作り直す（今も）。`handleProjectFileSelect`・`setAppMode`・`setRightSidebarTab`・`setIsRightSidebarCollapsed`・エディタを使う。
- C-5 `handleInstallPlugin`・C-6 `handleUninstallPlugin`: 管理画面。`requestConfirm`・`showToast`・`setLastError` を使う。

**D. 自動で走る処理**（書いてある順）
1. 1417 画面の登録が消えたら書くモードへ
2. 1422 横の欄の登録が消えたら、右の欄をプロットへ
3. 1427 モーダルの登録が消えたら、開いているモーダルを空に
4. 1430 モーダルを開いているあいだ、Esc で閉じる
5. 1482 起動時の読み込み
6. 1486 作品が変わったら `workspace.change`
7. 1496 作品が変わったらアンカーを読み込み直す（後片付けで、待っている保存を前の作品へ書く）

1441–1452 は資料・プロットの `useState` だけで、effect はない。

**E. 作品を開く経路**: D-6 と D-7 が作品のパスを見て動く。前の作品のアンカーの保存は D-7 の後片付けで書く。

**F. 画面部品への受け渡し**: `ThenPluginRuntimeHost`（plugins、activeView、visible、modal、anchorElement、onRequest）、`PluginManagerModal`（plugins、onInstall、onReload、onUninstall）、`RightSidebar`（pluginViews、loadedPlugins、activePluginView、setSidebarPluginRuntimeAnchor、isDockedPluginRuntimeVisible）、`StatusBar`（pluginItems）。

**G. App の外とのやり取り**: Rust の命令 `list_installed_plugins`、`inspect_plugin_dialog`、`install_plugin`、`uninstall_plugin`、`load_plugin_anchors`、`save_plugin_anchors`、`load_plugin_project_data`、`save_plugin_project_data`、`read_text_file`。iframe とのやり取りは `PluginRuntimeHost.tsx` の中（動かさない）。

**H. App.tsx の文字列を読むテスト**（`scripts/test-v061-plugin-platform.mjs`）

| 行 | 確かめている文字列 | 移った後にある場所 |
|---|---|---|
| 56 | `pluginRuntimeHostRef.current?.emit(… "document.change"` | App（残る） |
| 57 | `pluginRuntimeHostRef.current?.emit("workspace.change"` | フック |
| 58–65, 66–70, 71–72, 74 | `editor.getSelection`、`editor.moveCursor`、`const revealPluginRange … setAppMode("write")`、`views.*`、`views.openModal` から `views.closeModal` までに `setAppMode` がないこと、`statusbar.*`、`commands.register` | 受け口のファイル |
| 73 | `command.menus?.includes("editor.selection")` | フック |
| 84, 109–114, 144, 158, 201–203 | JSX の位置と props | App（残る） |

**結び目**
1. 受け口が後ろで宣言されるもの（`handleProjectFileSelect`、`showToast`）に頼り、state は前で使われる。
2. 表示の effect（D-1〜4）と保存の effect（D-5〜7）が、この順で並んでいる。
3. アンカーは state と ref の2か所に持ち、`persistPluginAnchors` が両方を書く。送り出し側は ref を読む。
4. `projectEntryActions` がアンカーの ref と関数を名前で受け取る。
5. 文字列を読むテストの 57–74 行。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル
- 必ず変わる: `src/App.tsx`、新しい `src/plugins/usePluginHost.ts`・`src/plugins/pluginHostActions.ts`・`src/plugins/pluginHostModel.ts`、`scripts/test-v061-plugin-platform.mjs`（読むファイルを足す）、`package.json`（回帰テスト）、新しい回帰テスト。
- 条件しだいで変わる: `docs/KNOWN_ISSUES.md`（癖を直す・記録する）。
- 変えない: `PluginRuntimeHost.tsx`、`anchors.ts`、`keybindings.ts`、`types.ts`、画面部品、Rust。

### 4-2. まとまりごとの影響
| まとまり | 重さ | 理由 |
|---|---|---|
| アンカーの読み込みと保存（D-7、C-2） | 高 | 作品を切り替えるときに、前の作品のアンカーを新しい作品へ書く事故が起こりうる。保存先のパスを、どの時点の値で取るかが要 |
| 受け口（C-4） | 中 | 引数で受け取る値が描画の時点の値でないと、登録・開く処理が古い一覧を見る |
| effect の順番（D-1〜7） | 中 | 順番が変わると、登録が消えたときの戻し方と読み込みが入れ替わりうる |
| `useCallback` の依存 | 中 | 写し間違えると、古い作品のパスで保存する |
| 導入・削除（C-5、C-6） | 低 | 文言が変わらなければよい |
| 部品の外の関数 | 低 | 純粋な処理 |

### 4-3. 起こりうる回帰と、今のテストで気づけるか
| 回帰 | 気づけるか |
|---|---|
| 頼みの種類の取り違え・権限の確かめ漏れ | 文字列だけ（`test:v061-plugins`） |
| アンカーを前の作品へ保存しない・新しい作品へ書く | なし |
| 名前の変更でアンカーを付け替えない | 偽物で渡しているので、なし（`test:project-entry-actions` は呼ばれたことだけ） |
| 導入・削除の確認の文言 | なし |
| 登録が消えたときの戻し方 | なし |

### 4-4. 今の自動テストの状態
「前」の一式（`a931e22`）: build は成功、86 本のうち 3 本が元から失敗（`test:canvas-save`、`test:v058-bundle`、`test:v0511-themes`）。今回とは関係ない。

## 工程5: 案

### 5-1. 方針
3つのファイルに分け、中身・文言・条件・順番はそのまま写す。

1. **`src/plugins/pluginHostModel.ts`**（純粋な処理）: 597–640 の4つ。App は `pluginDocumentPath` を import する。
2. **`src/plugins/usePluginHost.ts`**（値・読み込み・アンカーの保存）: `usePluginHost({ projectFolder, setLastError, appMode, setAppMode, rightSidebarTab, setRightSidebarTab, isRightSidebarCollapsed, isEditorFocusMode })`。
   - 中身: ref 9つ（1144–1155）、state 11（1205–1215）、派生の値と表示の effect 4つ（1391–1440）、ref の同期から `retargetPluginAnchors` まで（1453–1573）。
   - App では 1391 の位置で呼び、今と同じ名前で取り出す。effect は D-1〜7 の順のまま、ほかの effect との前後も変わらない（1441–1452 には effect がない）。state と ref は、1391 より前で使われていないことを確かめた。
   - 渡す値は、どれも 1391 より前で宣言されている。
3. **`src/plugins/pluginHostActions.ts`**（受け口と導入・削除）: `createPluginHostActions(deps)` が `{ handlePluginRequest, handleInstallPlugin, handleUninstallPlugin }` を返す。React の仕組みは持ち込まない。App は 6993 の位置で呼び、描画のたびにその時点の値を渡す（今も描画のたびに作り直しているので、同じ意味）。

送り出し側（工程1の一覧）と `isPluginManagerOpen` は App に残す。

### 決めてほしいこと

**1. 分け方**
- **フック＋操作の2つに分ける（5-1 のとおり）。** 勧め。宣言の順番の都合で、1つのフックにまとめるには受け口を描画の後ろへ遅らせる仕掛け（ref で最新の関数を持つなど）が要り、引っ越しではなくなる。この形なら、値と保存は `usePluginHost` にそろい、App はプラグインの state を1つも持たなくなる。
- 値と effect は App に残し、関数だけを移す（Idea の分離と同じ形）。effect の順番は確実に変わらないが、App に state 11 と ref 9 が残り、`usePluginHost` という形にはならない。
- 1つのフックに全部入れる（上の仕掛けを入れる）。

**2. 癖1（読めないアンカーのファイルを上書きして消す）**
- このブランチで、分離の後に直す。勧め。読み込みに失敗した作品では、アンカーを保存しない（その作品を開いているあいだ、アンカーは画面の中だけで動き、ファイルはそのまま残る）。`version` が 1 でないときも同じに扱い、エラーを出す。先に今は落ちるテストを書く。データが消える癖なので、移した後のフックで直接確かめられるうちに直したい。
- 別のブランチで直す。
- 記録だけにする（`docs/KNOWN_ISSUES.md`）。

**3. 癖2（閉じる直前のアンカーの書き換えが保存されない）**
- 記録だけにする。勧め。直すには、閉じるときに画面の側から保存を書き切る仕組み（Rust の `CloseRequested` で画面の保存を待つ）が要り、プラグインの外にも関わる。影響は、次に開いたときに前後の文字列でつなぎ直すことで多くが吸収される。
- 別のブランチで直す。
- このブランチで直す。

### テストの直し方と足すテスト
- 直す: `test:v061-plugins` の 57–74 行は、正規表現を変えず、`usePluginHost.ts` と `pluginHostActions.ts` も読むようにする（工程3 の H の表のとおり）。
- 足す: `test:plugin-host`（`scripts/test-plugin-host.mjs`）。esbuild で束ね、`@tauri-apps/api/core` の `invoke` を偽物に差し替える。
  - 受け口: 読み込まれていない・権限がないときに断ること、頼みの種類ごとの答え（コマンドの登録と置き換え・ショートカットの形の確かめ、横の欄と画面の登録と `views.open` の行き先、画面の登録に icon が要ること、モーダルを開いても `setAppMode` を呼ばないこと、状態表示の 160 文字、アンカーを作る・消す・つなぎ直す、`storage.set` を2回続けても順に書くこと、`moveCursor` で別の文書を開くこと）。
  - 導入・削除: 確認の文言、断ったら何もしないこと、読み込み直しと通知。
  - フック: `react` を、useState・useRef・useCallback・useEffect を描画の順に覚える小さな入れ物に差し替え、描画を呼び直す形で動かす。作品の切り替えで、待っているアンカーの保存が前の作品へ行き、新しい作品へは行かないこと。読み込みの途中で書き換えたら、読み込んだ値で上書きしないこと。名前の変更での付け替え。登録が消えたときの戻し方。
  - （決めてほしいこと2で直すなら）読めなかった作品では保存しないこと。
- 効くことの確かめ: 移した処理にわざと不具合を2つ入れて（権限の確かめを外す、後片付けで保存するパスを新しい作品のものにする）、落ちることを見て戻す。

### 進め方とコミットの分け方
1. `refactor:` 部品の外の関数を `pluginHostModel.ts` へ移す。
2. `refactor:` 値・読み込み・アンカーの保存を `usePluginHost.ts` へ移す。
3. `refactor:` 受け口と導入・削除を `pluginHostActions.ts` へ移す（`test:v061-plugins` の読むファイルも、このコミットまでに直す）。
4. `test:` `test:plugin-host` を足す。
5. （2 を直すなら）`test:` 今は落ちるテスト → `fix:` 読めなかった作品では保存しない。
6. `docs:` 結果を書く。

どのコミットも move-lines と verify-move で、元と同じことを確かめる（lost 0、added は import・呼び出し・ファイルの枠だけ）。

### 見込みと、今回やらないこと
- App.tsx は約 560 行減る見込み。
- やらない: 送り出し側（本文・選択範囲の知らせ、ショートカット、JSX）の移動、`PluginRuntimeHost.tsx` の変更、頼みの種類ごとの処理の書き直し（268 行の `if` の並びはそのまま）、癖3。

## 工程6: 人の確認

2026-10-26 に決まったこと。
1. 分け方: フック＋操作の2つ（5-1 のとおり）。
2. 癖1: このブランチで、分離の後に直す。
3. 癖2: 記録だけにする。

確認2（2026-10-26）で、実施の途中で見つけた癖4もこのブランチで直してから、push して PR を作ることになった。

## 工程7: 実施

| コミット | 内容 |
|---|---|
| `9e06de1` | `refactor:` 部品の外の関数4つを `src/plugins/pluginHostModel.ts` へ |
| `d0b9986` | `refactor:` ref 9・state 11・派生の値と表示の effect・読み込みとアンカーの保存を `src/plugins/usePluginHost.ts` へ。`test:v061-plugins` の2行の読み先をフックに |
| `8cd27c3` | `refactor:` 受け口と導入・削除を `src/plugins/pluginHostActions.ts` へ。`test:v061-plugins` の16行の読み先を受け口のファイルに |
| `1e019ba` | `test:` `test:plugin-host` |
| `53916e6` | `test:` 癖1（今は落ちる） |
| `de22947` | `fix:` 癖1 |
| `18e5dd7` | `test:` 癖4（今は落ちる） |
| `7916fa5` | `fix:` 癖4 |

- App.tsx は 9416 行から 8831 行へ（585 行減）。新しいファイルは、純粋な処理 49 行、フック 286 行（癖1の修正を含む）、受け口 495 行。
- 元と同じであることの確かめ方: 3つの `refactor:` のコミットごとに `move-lines.mjs` で移し、`verify-move.mjs` で突き合わせた。どれも lost 0。added は import の行、`usePluginHost(...)` と `createPluginHostActions(...)` の呼び出しの行、新しいファイルの枠（import、引数の型、`return`）だけ。
- 元と違う点:
  - フックの呼び出しは、元の 1391 行（派生の値）の位置。ref と state はそこへ寄せた（どれも 1391 行より前では使われていない）。effect は D-1〜7 の順のままで、ほかの effect との前後も変わらない。
  - `isTauriRuntime` は、ほかの分けたファイルと同じく、新しいファイルの中にも1行で書いた。
  - App で使わなくなった import（型 9 つ、`createThenPluginAnchor`、`resolveThenPluginAnchor`、`isValidThenPluginKeybinding`、`ThenPluginRuntimeHostHandle`）を消した。`ThenPluginIcon` は1つ目のコミットから使われていなかったので、2つ目で消した。
- 癖1の直し方（`de22947`）: アンカーのファイルが読めない（`load_plugin_anchors` が失敗する、または `version` が 1 でない・`anchors` が配列でない）作品を `pluginAnchorUnreadableRootRef` で覚え、その作品では 0.18 秒後の保存も、作品を切り替えるときの保存もしない。形が違うときは「アンカーの読み込みに失敗しました: 対応していない形式です」を出す。作品を開き直すたびに覚えた値を消して、読み直す。
- 実施の途中で見つけた癖（工程2の5に足す）:
  4. **`anchors.delete` は、消せたときも false を返す**（自動テストで確かめた）。`persistPluginAnchors` が ref を先に新しい一覧へ書き換えるため、比べる2つの数がいつも同じになる。SDK の型は `Promise<boolean>` だが、答えを使っているプラグイン（`docs/plugin-example`）はない。分離のあいだは直さず、今の答え（false）をテストで固定した。確認2で直すことになり、`7916fa5` で、`persistPluginAnchors` を呼ぶ前に数を比べるようにした。消したかどうかに関係なく保存する点は変えていない。

## 工程8: 自動テスト

### 足した回帰テスト `test:plugin-host`（`scripts/test-plugin-host.mjs`）
esbuild で `pluginHostActions.ts` と `usePluginHost.ts` を束ね、`invoke` とタイマーを入れ物に差し替えて動かす。`react` は、描画の順に useState・useRef・useCallback・useEffect を覚える小さな入れ物にした。値が変わるたびにフックを呼び直し、effect を書いた順に流す（後片付けが先）。
- 受け口: 読み込まれていないプラグインと権限のない頼みを断ること、コマンド（置き換え・ショートカットとメニューの確かめ）、横の欄と画面（icon の確かめ・`views.open` の行き先）、モーダル（開いても `setAppMode` を呼ばない・閉じる・取り消す）、状態表示の 160 文字、選択範囲、カーソルの移動（別の文書を開いてから範囲を選ぶ・見つからない文書）、アンカー（作る・つなぎ直して保存・見せる・消す・作品の外の文書）、プラグインのデータ（書き込みが1つずつ・読むときは書き込みを待つ）、導入と削除（確認の文言・断ったとき・失敗したとき）。
- フック: 起動時の読み込みとエラー表示、読み込み直しで登録を空にすること、登録が消えたときの戻し方と Esc、アンカーの遅延保存、作品の切り替え（待っている保存は前の作品へ。新しい作品へは書かない）、読み込み中の書き換えを読み込んだ値で上書きしないこと、名前の変更での付け替え、`workspace.change`。
- 癖1: 壊れた・`version` が違う・`anchors` が配列でない、の3つで、エラーを出し、画面の中ではアンカーが動き、保存も切り替え時の保存もしないこと。読める作品では保存すること。

### 効くことの確かめ
コミットしてから、移した処理にわざと不具合を2つ入れ、落ちることを見て `git checkout` で戻した。
| 入れた不具合 | 落ちた確認 |
|---|---|
| 受け口の権限の確かめを外す（`pluginHostActions.ts`） | 「権限がありません: commands」で断ること（Missing expected rejection） |
| 作品を切り替えるときの、前の作品への保存を消す（`usePluginHost.ts`） | 「a pending save must go to the previous work when switching」 |

癖1のテストは、直す前のコミット `53916e6` で「broken: an unreadable anchor file must not be overwritten」で落ち、`de22947` で通った。癖4のテスト（あるアンカーを消すと true、ないアンカーなら false）は、`18e5dd7` で「deleting an existing anchor must answer true」で落ち、`7916fa5` で通った。

癖4の修正は受け口の1行なので、「後」の一式は動かし直さず、`npx tsc --noEmit`、`test:plugin-host`、`test:v061-plugins`、`test:project-entry-actions` を動かした（どれも通った）。下の比較の表は `de22947` の時点のもの。

### 前後の比較
| | 前（`a931e22`） | 後（`de22947`） |
|---|---|---|
| build | 成功 | 成功 |
| いちばん大きい JS | 706,891 バイト | 710,265 バイト（+3.4 kB） |
| テスト | 86 本、失敗 3 | 87 本、失敗 3 |

- 両方で通った: 83 本（`test:v061-plugins`、`test:project-entry-actions` を含む）。
- 両方で失敗（元からの失敗。理由も前後で同じ）: `test:canvas-save`（`./utils/fontStack` を解決できない）、`test:v058-bundle`（いちばん大きい JS が 500 kB を超えている）、`test:v0511-themes`（朱墨のプロットの枠）。
- 後だけ: `test:plugin-host`（通った）。
- 新しい失敗: なし。
- バンドルが増えたのは、受け口の関数をまとめて返すと関数名が圧縮で縮まなくなるため（Idea の分離と同じ）。

## 工程9: 実機確認

### やり方
識別子 `local.then.qa.pluginhost1026` で build した QA 用アプリを、scratchpad の一時ライブラリ（作品A: `本文.txt`・`第二章.txt`、作品B: `本文.txt` と壊れた `.then/anchors.json`）で動かした。導入のダイアログは OS のものなので、QA 用プラグイン2つ（全部の権限を持つ `qa.host`、`statusbar` と `commands` だけの `qa.limited`）を、QA アプリのプラグインの置き場所（`%APPDATA%\local.then.qa.pluginhost1026\plugins`）へ直接置いた。`qa.host` は、頼みごとのコマンドを状態表示のボタンとして登録し、答えを状態表示の欄に書く。画面は WebView2 のデバッグポートから操作した。

### 確認した項目と結果
| 確認したこと | 結果 |
|---|---|
| 起動時の読み込み | 2つのプラグインが読み込まれ、状態表示にボタンと「QA待機」が出た。エラーの表示はなし |
| `editor.getSelection` | 「追跡」を選んで押すと `sel:追跡@本文.txt` |
| `anchors.create` と保存 | `anc:5-7 追跡`。1.5 秒後の `.then/anchors.json` に、同じ文書・範囲・文字のアンカーが1つ |
| 本文の書き換えにアンカーが追いかける（App に残した送り出し側） | 先頭に「前置き。」を足すと、ファイルのアンカーが 9-11 になり、`anchors.resolve` も `res:9-11 追跡` |
| `editor.moveCursor` で別の文書へ | `mv:true`。`第二章.txt` が開き、「章の」が選ばれた |
| `anchors.reveal` | `rev:true`。`本文.txt` に戻り、「追跡」が選ばれた |
| 横の欄 `views.open` | 書くモードのまま右の欄が開き、見出しが「QA横」 |
| 画面 `views.open` | 画面のモードになり、「QA画面」の枠が出た |
| モーダル `views.openModal` と Esc | 画面は「QA画面」のまま、モーダルの枠が出た。Esc で閉じ、画面はそのまま |
| `storage.set`／`get` | `st:{"n":7} 二`。`.then/plugin-data/qa.host/storage.json` に `k` と `k2` |
| 権限のない頼み | `qa.limited` が横の欄を登録しようとすると「Error: 権限がありません: views」 |
| ショートカット（Ctrl+Alt+Q） | 「末尾」を選んで押すと `sel:末尾@本文.txt` |
| 右クリックのメニュー | 選択範囲で開くと「QA sel」が出て、押すと `sel:範囲@本文.txt` |
| コマンドパレット → 管理画面 | 「プラグインを管理…2個を導入済み」から開き、2つが並んだ |
| 再読み込み | 登録がいったん空になり、プラグインが登録し直した（出力の欄が「QA待機」に戻った） |
| 削除の確認と、断ったとき | 「「QA Limited」v0.1.0 をThenから削除しますか？」と注意の文。キャンセルでは何も消えない |
| 削除 | 「プラグイン「QA Limited」を削除しました」。置き場所のフォルダが消え、状態表示の「lim」もなくなった |
| 作品の切り替え（作品A → 作品B） | 作品A の `anchors.json` は切り替えの前後でハッシュが同じ。`workspace.change` は作品B の名前で届いた（`ev:ws2 作品B`） |
| 癖1の修正 | 作品B を開くと「アンカーの読み込みに失敗しました: failed to parse plugin anchors: key must be a string at line 1 column 3」。アンカーを作り（`anc:4-6 本文`）本文を書き換えても、壊れたファイルの中身はそのまま。作品A のファイルも変わらない |
| 名前の変更での付け替え | 作品A の `本文.txt` を「改題」にすると、アンカーの文書が `改題.txt` に変わった |
| 再起動 | 削除した QA Limited は出ず、QA Host だけが読み込まれた。本文と名前の変更が残り、先頭に文字を足すとアンカーが 4-6 から 9-11 へ追いかけた（読み込めている） |

### 今の挙動の癖を実機で確かめた結果
- 癖1: 上の表のとおり、直した後の挙動を確かめた。
- 癖4: 直す前は、`anchors.delete` が `del:false` を返し、`anchors.json` からは消えて `anchors: []` になった。直した後（`7916fa5`）は、QA 用アプリを build し直して同じ一時ライブラリで確かめた。アンカーを作って消すと `del:true`（ファイルのアンカーは 1 から 0）、同じアンカーをもう一度消すと `del:false`。片付けの後の残りは、どれも 0。
- 癖2: 確かめていない（0.18 秒以内に閉じる操作を作れない。記録だけ）。
- 癖3: 確かめていない（開発のときだけの違い）。

### 確かめられなかったこと
- 導入（「プラグインを追加…」）: OS のフォルダ選択のダイアログを操作できない。確認の文言、断ったとき、失敗したとき、導入後の読み込み直しと通知は `test:plugin-host` で確かめた。
- 途中で1回、管理画面を閉じるつもりで、同じ「閉じる」のラベルを持つウィンドウの閉じるボタンを押し、アプリが終わった。QA のプロセスは残らず、同じ識別子で起動し直して続けた。
- 名前の変更のダイアログで、`q.mjs key Enter` では確定しなかった。`text: "\r"` を付けて CDP で送ると確定したので、アプリの癖ではなく、`q.mjs` の Enter の送り方の違い。

### 片付け
`qa-cleanup.mjs` で、QA アプリのアプリ状態（`%APPDATA%`・`%LOCALAPPDATA%` の `local.then.qa.pluginhost1026`）と一時ライブラリを消した。残りは QA の Then 0、QA の WebView2 0、テストの Edge 0、テストの node 0、`%TEMP%` のテストのプロファイル 0。`git status` に意図しない変更（`src-tauri/Cargo.toml` の改行など）はない。`src-tauri/target/release/Then.exe` は QA 用の build で上書きされている。

## 工程10: 完了

### 変わったもの
- App.tsx から、プラグインの受け口（`handlePluginRequest`）、読み込み（`reloadInstalledPlugins`）、導入と削除、アンカーの保存を、`src/plugins/usePluginHost.ts`・`src/plugins/pluginHostActions.ts`・`src/plugins/pluginHostModel.ts` へ移した。App.tsx は 585 行減った。
- 癖1（読めないアンカーのファイルを上書きして消す）を直した。
- 癖4（`anchors.delete` が消せたときも false を返す）を直した。

### 確かめたこと
- 移したコードが元と同じこと（verify-move、lost 0）。
- 自動テスト: 新しい失敗なし。`test:plugin-host` を足し、わざと入れた不具合2つで落ちることを確かめた。
- 実機: 工程9の表のとおり。

### 残っている別の作業
| 作業 | 理由 |
|---|---|
| 癖2（閉じる直前のアンカーの書き換えが保存されない） | 確認1で記録だけにした。閉じるときの書き出しの仕組みが要る |
| プラグインへの送り出し側（本文・選択範囲の知らせ、ショートカット、JSX）の分離 | 今回の範囲の外。エディタの処理と結び付いている |
