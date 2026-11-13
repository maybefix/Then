# Plot → ノート「プロット（移行）」への移行（BINDER 1-6）の手順書

[バインダー再構築 計画書](BINDER_REBUILD_PLAN.md) の第1段階 1-6。Plot（右のペインの章・セクションのカード）を廃止し、作品ごとの Plot 全体を、素材のノート1本「プロット（移行）」に移す（計画書 3.5、D-1）。`project.json` の `plotCards` はバックアップしてから空にし、`PlotPane.tsx` を退役させる。移行では、今の Plot の中身を1文字も失わない。その確かめは、1-3 の見本データ `scripts/fixtures/binder-migration/` と期待値 `expected/plot.json` と比べて行う。

変えないもの: 1-4・1-5 で決めた扱い（素材は一覧の `role` だけで決める、右のペインの名前は「アイデア」、概要は `synopsis` でコルクボードに素材は出さない）。Idea・資料・Canvas のデータ。画面に説明の文は足さない。

- ブランチ: `feat/binder-1-6-plot-migration`
- 戻し先: タグ `checkpoint/before-binder-1-6-plot-migration`（コミット `e147e34`。中身は main `90d5854` と同じ。`demo-video/` と `landing-page/` は含めていない）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 待ち |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

行番号は、ことわりがなければチェックポイント `e147e34` の時点のもの。

---

## 工程1: 調査の結果

### Plot がいまある場所

| まとまり | 場所 | 中身 |
|---|---|---|
| 保存の形 | `src-tauri/src/lib.rs` 408〜418（`PlotCardConfig`）、`src-tauri/src/project_state.rs` 50〜51 | `project.json` の `plotCards`。`{ id, kind, num, title, body, expanded, managerCollapsed }` の配列 |
| 読み書きの命令 | `src-tauri/src/lib.rs` 3355〜3381（`load_project_plot_cards`・`save_project_plot_cards`） | 作品の `project.json` を読む／`plotCards` だけ書き換えて保存する |
| 読み込みの整え | `src/storedStateModel.ts` 341〜365（`normalizePlotCards`）、`src/plotCardModel.ts`（46行。`loadWorkspacePlotCards`・`saveWorkspacePlotCards`・見本カード3枚 `defaultPlotCards`） | 1-1 で切り離した |
| 作品の外とのやり取り | `src/plotCardActions.ts`（103行） | ライブラリ直下と作品のあいだの「移動・コピー…」、Canvas の「プロットへ送る」の受け取り |
| カードの部品 | `src/components/plot/plotCardUtils.ts`（72行） | 番号の振り直し、章・セクションの追加、リンクのパスの付け替え |
| 表示 | `src/components/plot/PlotPane.tsx`（1,665行）、`src/styles/app/ideaPlot.css` の Plot の部分 | 右のペインの「プロット」と、プロット管理画面 |
| App が持つ値 | `src/App.tsx` 883・891（`plotWorkspacePath`・`plotCards`）、1091〜1109（管理画面の開閉、追加） | |
| 作品を開く経路（4つ） | `src/App.tsx` 2863（起動時の復元）、3132（ファイルから作品が変わったとき）、4821（`setWorkspaceFromDocumentPath`）、5719（`openWorkspaceFolder`） | どれも `loadWorkspacePlotCards` を呼び、`setPlotCards` する |
| 保存 | `src/App.tsx` 3077〜3087 | 値が変わると 0.7 秒後に `save_project_plot_cards`（作品の切り替え・閉じる前にも書き切る） |
| 右のペイン | `src/components/layout/RightSidebar.tsx` 52〜64（タブ「プロット」）、243〜249（見出しの操作）、291、368〜（`PlotPane`） | |
| 右のペインの保存 | `src/utils/rightSidebarState.ts` | 戻せるタブは `idea`・`plot`・`proof`・`draft`・`properties`。**分からない値と既定は `plot`**。`src/storedStateModel.ts` 179 の既定、`src/App.tsx` 1009 の初期値も `plot` |
| プラグインの退避先 | `src/plugins/usePluginHost.ts` 104 | プラグインの画面が消えたら右のペインを `plot` にする |
| 作品の最初の画面 | `src/components/layout/ScopeStartPage.tsx` 61、`src/App.tsx` 7755 | ボタン「プロットを開く」 |
| Canvas | `src/CanvasWindowApp.tsx` 2689〜2709、3477〜3484 | 選んだカードの「プロットへ送る」。App が `then-canvas-copy-to-plot` を受けて末尾に足す |
| ファイルの改名・移動 | `src/projectEntryActions.ts` 222〜227 | Plot 本文の `@[[旧パス]]` を新しいパスへ付け替える（削除では残す） |
| ライブラリ間のコピー | `src/utils/libraryTransfer.ts` 31〜47 | カードの資料を一緒にコピーするとき、本文のパスを書き換える |
| 設定 | `src/components/dialogs/BodySettings.tsx` 67〜（「プロット表示フォント」）、`src/appShellStyle.ts` 14、`--plot-font-family` | Plot のカードの番号・本文・章題の字体にだけ効く |
| 「本文 ▾」 | `src/App.tsx` 5581〜（本文・コルクボード・キャンバス・エクスポート・チェックポイント・プラグイン） | **Plot は入っていない**。変えるところはない |
| 文書 | `docs/USER_MANUAL.md` の「Plot」の節（361〜）ほか4か所、`README.md` 7 | |

### 素材フォルダとノートを作る処理（1-3b・1-4 で入ったもの）

- `create_project_materials_folder`（`lib.rs` 2474〜2490）: 作品直下にフォルダを作り、`materialsFolder` に名前を書く。同じ名前のものがあれば作らない（既存のフォルダを黙って素材にしない）。素材フォルダがすでにあれば断る。
- `create_text_file`（`lib.rs` 2216〜2239）: 同じ名前があれば `名前-2.md`、`名前-3.md` … にする。中身は `# 名前` の1行。
- ライブラリ直下（`library.role === "root"`）は三段にしていない（`WorkspaceSidebar.tsx` 886〜889）。素材フォルダの考えがない。

### 手元のデータ（2026-11-14、`Documents/Books` を読むだけで数えた）

| 作品 | カード | 章 | 資料リンク | 素材フォルダ |
|---|---|---|---|---|
| Then_デモ用 | 2 | 1 | 0 | なし |
| workspace | 2 | 1 | 0 | なし |
| テスト | 5 | 1 | 0 | なし |
| テスト_snapshot検証用 | 11 | 2 | 1 | なし |
| ほか3作品・ライブラリ直下 | 0 | — | — | なし |

- **Plot に中身のある作品は、どれも素材フォルダがない。** 素材フォルダのない作品の扱い（決めてほしいこと 2）は、例外ではなく、ふつうの場合になる。
- 本文の行の先頭が Markdown の記号（`#`・`>`・`- `・`1. `・`//`・`|` など）で始まるものはない。題が空のカード、題の中の改行もない。
- 見本カード（ID `plot-1`〜`plot-3`）が保存されている作品はない。

### 気づいた点

- **右のペインの既定が `plot`。** 保存値がないとき・分からない値のとき・プラグインの画面が消えたときに「プロット」へ戻る。外すときは、この3か所の行き先を変える。
- **Plot 本文のリンクは、今はファイルの改名・移動に付いていく。** ノートに移したあとは、ノートの本文はただの文字なので、付いていかない（リンク索引の 3-3 まで）。2-5（資料を `素材/` へ移す）は、計画書 3.7 で「ノート『プロット（移行）』の本文」を書き換える対象にしている。そのため、移行したノートの場所を `project.json` に残しておく必要がある。
- **エディタは `@[[...]]` を特別に扱わない**（`src/` で `@[[` を読むのは Plot の3ファイルだけ）。ノートでは資料リンクは文字のまま見え、押しても開かない。KNOWN_ISSUES 2026-11-10 の (1)「原稿ツリーのファイルへのリンクが『@空リンク』と出る」は、Plot と一緒になくなる。
- **エディタは行ごとの文字をそのまま持つ**（`src/editor/ast/documentAst.ts` は行に役割を付けるだけ）。ノートの文字は、開いて保存しても書き換わらない見込み。工程9で、開いて1文字打って戻して保存したあとの中身を比べる。
- **`project.json.bak` はバックアップにならない。** 保存のたびに1つ前の版で置き換わる（`project_state.rs` 468〜）。移行のバックアップは別に持つ。
- **1-3 の `test:binder-baseline` は `src/plotCardModel.ts` の `loadWorkspacePlotCards` を読み込む**（`scripts/test-binder-migration-baseline.mjs` 41）。この関数を消すと、期待値と比べるテストが動かなくなる。
- Rust は、カードに `num`・`title`・`body`・`expanded` のどれかが欠けていると `project.json` 全体を読めない（1-3 の P9）。Then が書くカードは必ず全部を持つ。移行でも扱いは変えない（記録だけ）。

## 工程2: 仕組みの説明

### 言葉

- **移行**: 作品の `plotCards` を読み、ノートを1本作り、`plotCards` を空にすること。1作品につき1回だけ行う。
- **バックアップ**: 移行の直前の `plotCards` を、そのまま別のファイルに残したもの。
- **移行の印**: 「この作品は移行が済んだ」「ノートはここ」を `project.json` に書いたもの。
- **見え方**: 1-3 の期待値と同じ意味。画面で Plot を開いたときに見えていたもの（読み込みで整えたあとの種類・番号・題・本文）。

### 1. 移行の前と後（データの形）

| | 前 | 後 |
|---|---|---|
| `project.json` の `plotCards` | カードの配列 | `[]` |
| `project.json` の移行の印 | なし | `plotMigration: { notePath, backupPath, migratedAt }`（名前は案） |
| バックアップ | なし | `.then/backups/plot-cards-<日時>.json`（決めてほしいこと 3） |
| ノート | なし | `<素材フォルダ>/プロット（移行）.md` |
| 素材フォルダ | ない作品が多い | 決めてほしいこと 2 |

### 2. ノートの書き方（案）

章カードを `#` の見出し、セクションカードを `##` の番号付きの小見出しにし、本文はそのまま続ける。カードのあいだに空行を1つ入れる。1-3 の見本 作品A なら次のようになる。

```markdown
# 第一章　港町

## 001 港に着く
主人公が港に着く。@[[第一章/a.md]] を見ながら書く。

## 003 坂の上の家
地図は @[[.then/references/imports/map (2).png]]。
二行目の本文。

# （無題の章）

## 004
題のないセクション。@[[.then/references/imports/資料a.md]] と @[[.then/references/imports/資料a.md]] を二度参照する。@[[消した資料.md]] は行き先がない
```

- 番号は、画面に見えていた番号をそのまま書く（001・003・004 の欠番も。1-3 の P1）。振り直さない。
- 本文は1文字も変えない。`@[[...]]` も、行き先のないリンク・重複も含めてそのまま。
- 題が空の章は、画面ではプレースホルダしか見えていなかった。見出しに何を書くかは決めてほしいこと 6。
- `expanded`・`managerCollapsed`（開閉の状態）と ID はノートに書かない（バックアップには残る）。

### 3. 移行の流れ（案）

作品を開いたとき、Plot を読む代わりに次を行う。

1. 画面の側が `plotCards` を今までどおり読み、`normalizePlotCards` で見え方に整え、ノートの文字を作る（1-3 の期待値を作ったのと同じ処理を通すので、見え方がずれない）。
2. 空なら何もしない（ノートを作らない。印も書かない）。
3. 空でなければ、Rust の新しい命令（`migrate_project_plot_to_note`、名前は案）に、読んだ `plotCards` とノートの文字を渡す。Rust は `project.json` の鍵を取ったまま、次を順に行う。
   1. `project.json` を読み直し、`plotCards` が渡されたものと同じかを確かめる。違えば何もせずに断る（次に開いたときにやり直す）。
   2. バックアップを書き、読み直して確かめる。
   3. 素材フォルダがなければ作る（決めてほしいこと 2）。
   4. ノートを新しいファイルとして書く。同じ名前があれば別の名前にする（決めてほしいこと 4）。
   5. `plotCards` を空にし、移行の印を書いて `project.json` を保存する。
4. 途中で失敗したら、その回に作ったもの（ノート・素材フォルダ）を消し、`project.json` は書かない。バックアップは残す（害がないため）。画面は通知だけ出し、作品はそのまま開く。次に開いたときにやり直す。
5. 成功したら、ファイル一覧を読み直して、素材の段にノートが出るようにする。

1回だけにする仕組みは、`plotCards` が空になること自体。移行の印は、2-5 がノートの場所を知るためと、何が起きたかを後から追えるために書く。5. の手前でアプリが落ちても、`project.json` が書かれていなければ次回やり直し、ノートが残っていれば「同じ中身のノートがすでにあれば、それを使う」で2本目を作らない。

### 4. ほかの機能との関係

| 機能 | 移行の後 |
|---|---|
| 右のペイン | タブ「プロット」がなくなる。保存値が `plot` の人は「アイデア」で開く（決めてほしいこと 5） |
| プラグインの画面が消えたとき | 右のペインは「アイデア」へ戻る |
| 作品の最初の画面 | 「プロットを開く」がなくなる |
| Canvas の「プロットへ送る」 | なくなる（「Idea へ送る」は残る） |
| ライブラリ直下⇄作品の「移動・コピー…」 | Plot のカードの分がなくなる。Idea の分は変えない |
| ファイルの改名・移動 | Plot 本文のリンクの付け替えがなくなる。ノートの本文は付け替えない（3-3 まで） |
| 設定「プロット表示フォント」 | 効く先がなくなる。消すかどうかは決めてほしいこと 7 |
| 別ウィンドウの Canvas | 移行は作品を開いたときにメインのウィンドウだけで行う。Canvas は `plotCards` を読み書きしないので影響しない |
| 作品の切り替え・閉じる前の書き切り | Plot の保存がなくなる（`test:save-on-work-switch`・`test:pending-saves` の Plot の部分の扱いは工程5） |
| ライブラリ直下の `plotCards` | ライブラリ直下を開いたときに同じく移行する（決めてほしいこと 2 の後半） |
| 開かない作品 | 移行しない。`plotCards` は開くまでそのまま残る。作品フォルダをコピー・移動しても、開いたときに移行する |
| チェックポイント | ノートは素材なので、チェックポイントに入る（1-3b） |
| 1-3 の期待値 | 見本データのフォルダは書き換えない。移行は一時フォルダに写して試す |

### 5. 今の挙動の癖（工程9で実機で確かめる）

| # | 癖 | 扱い（勧め） |
|---|---|---|
| M1 | 番号の欠番（001・003・004）。1-3 の P1 | 見えていた番号のまま書く |
| M2 | 番号のないセクションは、並びの何番目か（章も数える）を番号にする。1-3 の P6 | 見えていた番号のまま書く |
| M3 | 種類が分からないカードはセクション。1-3 の P7 | 見えていたとおりセクションにする |
| M4 | 題が空の章はプレースホルダ「章のタイトル…」だけが見える。1-3 の P8 | 決めてほしいこと 6 |
| M5 | 見本カード3枚と同じ ID・題のカードは、普通のカードとして出る。1-3 の P5 | 普通のカードとして移す |
| M6 | 原稿ツリーのファイルへのリンクが「@空リンク」と出る（KNOWN_ISSUES 2026-11-10 の (1)） | ノートでは文字のまま見える。Plot と一緒に解消として記録する |
| M7 | ファイルを削除しても Plot 本文のリンクは残る（KNOWN_ISSUES 2026-10-24） | ノートでも残る（利用者の文章なので消さない） |

## 工程3: 依存関係

| 処理 | 呼ぶもの | 移行の後 |
|---|---|---|
| `load_project_plot_cards` | 作品を開く4つの経路、`transferPlotCard`、1-3 の Rust テスト | 移行の1. でだけ使う。1-3 の Rust テストはそのまま |
| `save_project_plot_cards` | App の保存、`transferPlotCard` | 使わなくなる。命令を消すか残すかは工程7で、`test:save-on-work-switch` などの差し替えと合わせて決める |
| `normalizePlotCards` | `loadWorkspacePlotCards`、`test:stored-state-model`、`test:binder-baseline` | 残す（移行が使う） |
| `loadWorkspacePlotCards` | 4つの経路、`transferPlotCard`、`test:binder-baseline` | 残す（移行が使う）。見本カード `defaultPlotCards` は消す |
| `saveWorkspacePlotCards`、`plotCardActions.ts`、`plotCardUtils.ts`、`PlotPane.tsx`、Plot の CSS | Plot の画面 | 消す |
| `replacePlotReferencePath` | `projectEntryActions.ts` | 消す（Plot の付け替えをやめる） |
| `plotCardReferencePaths`・`rewritePlotCard` | `plotCardActions.ts` | 消す（`test:library` の該当部分も） |
| `rightSidebarState.ts` | App、`storedStateModel.ts`、`usePluginHost.ts` | `plot` を外し、既定と行き先を `idea` に |

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src-tauri/src/lib.rs`（移行の命令）、`src-tauri/src/project_state.rs`（移行の印）、新規 `src/plotMigration.ts`（ノートの文字を作る。名前は案）、`src/plotCardModel.ts`、`src/App.tsx`（4つの経路、保存、Plot の値と受け取り）、`src/components/layout/RightSidebar.tsx`、`src/utils/rightSidebarState.ts`、`src/storedStateModel.ts`（既定）、`src/plugins/usePluginHost.ts`、`src/components/layout/ScopeStartPage.tsx`、`src/CanvasWindowApp.tsx`、`src/projectEntryActions.ts`、`src/utils/libraryTransfer.ts`、`src/styles/app/ideaPlot.css`、消す `src/components/plot/`・`src/plotCardActions.ts`、テスト（下の表）、`docs/USER_MANUAL.md`、`README.md`
- 条件しだいで変わる: `src/components/dialogs/BodySettings.tsx`・`src/appShellStyle.ts`・`src/types.ts`（決めてほしいこと 7）
- 変えない: 1-3 の見本データと期待値、Idea・資料・Canvas のデータの形、`WorkspaceSidebar.tsx` の三段の決め方

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 移行（ノートを作り `plotCards` を空にする） | **高** | 利用者の文章を動かす。失敗や二重実行で文章が消えたり増えたりしうる。バックアップ・鍵の中での確かめ・失敗時の取り消しで守る |
| 素材フォルダを作る | 中 | 作品のツリーが三段になる（1-4 の見た目）。同じ名前のフォルダがあるときの扱い |
| 右のペインの「プロット」を外す | 中 | 保存値が `plot` の人の起動時の見た目。プラグインの退避先 |
| Canvas・最初の画面・設定のボタンを外す | 低 | 押す先がなくなるものを外すだけ |
| 改名・移動でのリンクの付け替えがなくなる | 中 | ノートの本文は古いパスのまま残る（3-3・2-5 で扱う） |

### 4-3. 起こりうる回帰と、気づけるテスト

| 回帰 | 気づけるテスト |
|---|---|
| ノートの見え方が Plot と違う（番号・題・本文・リンク） | 新しいテスト（`expected/plot.json` と比べる） |
| 2回目に開いて、もう一度ノートができる | 新しいテスト |
| 移行の途中の失敗で、`plotCards` だけ消える／ノートだけ増える | 新しい Rust テスト（失敗を起こして確かめる） |
| Plot が空の作品にノートや素材フォルダができる | 新しいテスト |
| 作品を開くときに Idea・校正辞書などが読めなくなる | `test:startup-idea-order`・`test:save-on-work-switch`・`test:binder-baseline` |
| 右のペインが空になる・プラグインの退避先がない | `test:right-sidebar`・`test:plugin-host`・`test:v065-native-shell`（期待を `idea` に変える） |
| 素材の数え方（字数・書き出し）にノートが入る | `test:materials`・`test:binder-tiers`・`test:corkboard` |
| 1-3 の期待値が変わる | `test:binder-baseline`・`test:binder-baseline-rust`（変わらないはず） |

### 4-4. 今の自動テストの状態

「前」の一式（`e147e34`、2026-11-14）: build 成功、本体の束 724,628 バイト、110本中 108本が通り、2本が失敗。終わったあとに残ったプロセスは 0（QA Then・QA WebView2・テストの Edge・テストの node）。

| 元からの失敗 | 理由 |
|---|---|
| `test:editor-text-edits` | 1-5 の「前」「後」と同じ失敗（「every icon draws its own picture」） |
| `test:v058-bundle` | 本体の束が 500 kB を超えている。もとからの状態。増え方だけを見る |

頼まれた8本（`test:binder-baseline`・`test:binder-baseline-rust`・`test:plot-card-actions`・`test:binder`・`test:right-sidebar`・`test:materials`・`test:binder-tiers`・`test:corkboard`）はすべて通った。

## 工程5: 案

### 5-1. 方針

- 移行は Rust の鍵の中で1回の流れとして行い、確かめてから書く（工程2の3）。
- ノートの文字は、1-3 の期待値を作ったのと同じ読み込み（`loadWorkspacePlotCards` → `normalizePlotCards`）を通して作る。
- Plot の画面と、Plot にしか使わない処理は同じブランチで消す。

### 決めてほしいこと

| # | 論点 | 選択肢（先頭が勧め） |
|---|---|---|
| 1 | 移行のきっかけ | **A. 作品を開いたとき自動**（Plot の画面を消すので、押す場所を残すと説明の文が要る。開いたときなら開いた作品だけが対象になる）／B. 素材の段などにボタン「プロットをノートに移す」／C. 起動時にライブラリの全作品 |
| 2 | 素材フォルダのない作品 | **A. 「素材」を作って素材フォルダにし、そこへノートを置く**（D-3 どおり。手元の4作品はすべてこれ）。作品直下に「素材」という名前のフォルダがすでにあれば、それを黙って素材フォルダにはせず、「素材-2」を作る／B. 作品直下にノートを置く（原稿として数えられ、書き出しにも入る）／C. 移行を待つ（その間 Plot が見えなくなる）。ライブラリ直下は三段でないので、**ライブラリ直下にそのまま置く**（手元は0件、見本に1件） |
| 3 | バックアップの置き場所と期間 | **A. `.then/backups/plot-cards-<日時>.json` に、元の `plotCards` を ID・開閉の状態ごとそのまま。消さない**（数 KB。作品フォルダごと移せる）／B. `project.json` の中に残す／C. 一定期間で消す |
| 4 | 同じ名前のノートがあるとき | **A. 「プロット（移行）-2.md」**（新規ファイルと同じ付け方）。ただし同じ中身のノートがあれば、それを使う（落ちたあとのやり直しで2本にしない）／B. 日付を付ける「プロット（移行）2026-11-14.md」 |
| 5 | 右のペインの「プロット」を消す時期 | **A. 移行と同時**（残すと空のペインに足したカードがまた `plotCards` に貯まり、二重になる）。保存値が `plot` の人は「アイデア」で開く／B. あとで（しばらく空のタブが残る） |
| 6 | 題が空の章の見出し | **A. 「# 無題の章」**（いま章を消したときの通知と同じ語。見出しが空だと章の区切りが見えない）／B. 「#」だけにする。題が空のセクションは番号だけ（「## 004」）にする |
| 7 | 一緒に消すもの | **A. Canvas の「プロットへ送る」、最初の画面の「プロットを開く」、設定の「プロット表示フォント」も消す**（どれも効く先がなくなる。保存された設定値は読み捨てる）／B. 設定だけ残す |

### テストの直し方と足すテスト

先に書く（「前」で通ることを確かめてコミットする）:

- 作品を開いたときに、`project.json` の `plotCards` 以外（Idea・校正辞書・並び順・進捗・`materialsFolder`）を書き換えないこと。見本データの各作品を一時フォルダに写して確かめる（移行のあとも同じテストで、`plotCards` と移行の印以外が変わらないことを見る）。

移行のあとに足す:

- `test:plot-migration`（新規、esbuild）: 見本の各作品からノートの文字を作り、見出し・番号・本文・リンクを読み戻して `expected/plot.json` と1件ずつ比べる。リンクの並びも `links` と同じであること。空の作品（C・D）はノートを作らないこと。
- `test:plot-migration-rust`（新規、cargo）: 見本を一時フォルダに写して移行の命令を動かし、(1) バックアップが元の `plotCards` と同じ、(2) `plotCards` が空、(3) 移行の印、(4) 2回目は何もしない、(5) `plotCards` が途中で変わっていたら断る、(6) ノートを書けないときは何も変わらない、(7) 素材フォルダのない作品・「素材」という名前のフォルダがある作品・ライブラリ直下、を確かめる。
- 期待を変えるテスト（工程7でコミットの本文に理由を書く）: `test:right-sidebar`（タブ「プロット」がない、分からない値は `idea`）、`test:v065-native-shell`・`test:plugin-host`・`test:stored-state-model`（既定・退避先が `idea`）、`test:project-entry-actions`（Plot の付け替えの確認を外す）、`test:library`（Plot のカードの確認を外す）、`test:plot-card-actions`（画面の操作が消えるので、残る読み込みの確認だけにする）、`test:save-on-work-switch`・`test:startup-idea-order`（Plot の部分を外す）、`test:app-shell-style`・`test:appearance`（決めてほしいこと 7 が A なら）。
- 変わらないはず: `test:binder-baseline`・`test:binder-baseline-rust`・`test:binder`・`test:materials`・`test:binder-tiers`・`test:corkboard`。変わったら止めて知らせる。

### 進め方とコミットの分け方

1. 「前」を固定するテスト（作品を開いても `plotCards` 以外を書き換えない）
2. ノートの文字を作る処理と `test:plot-migration`
3. Rust の移行の命令と `test:plot-migration-rust`
4. 作品を開く4つの経路から移行を呼び、Plot の値・保存をやめる
5. 右のペインの「プロット」と退避先・既定
6. Canvas・最初の画面・設定・改名の付け替え・ライブラリ間のコピーの Plot の部分
7. `PlotPane.tsx` ほかを消す、CSS、文書

### 見込みと、今回やらないこと

- 見込み: 消す行は約2,000行（`PlotPane.tsx` 1,665行、ほか）。足す行は Rust 約150行、TS 約80行とテスト。
- やらないこと: ノートモード（2-2。このノートも原稿と同じ縦書きのエディタで開く）、ノートの資料リンクを押して開くこと、改名でノートのリンクを付け替えること（3-3）、資料を `素材/` へ移すこと（2-5）、章を原稿ファイルの概要へ割り当てること（3.5 で行わないと決めた）。

## 工程6: 人の確認

（確認1の答えを書く）
