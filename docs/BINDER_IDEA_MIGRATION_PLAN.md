# Idea → 投稿・ノートへの移行と、資料の `素材/` への移動（BINDER 2-4・2-5）の手順書

[バインダー再構築 計画書](BINDER_REBUILD_PLAN.md) の第2段階 2-4 と 2-5。どちらも Idea スレッドの資料リンクを触るので、1つの移行として一緒に行う（計画書 3.7・3.8）。

- 2-4: 各作品の `ideaThreads` のうち、インボックスの断片は、その作品を記録してライブラリの投稿（受信箱）へ移す。名前の付いたスレッドは、その作品の素材フォルダのノートにする（スレッド名をノートの名前に、断片を段落に）。アプリ側の `profileSnippets` は、更新後に最初に開いたライブラリの投稿へ移す。設定「Ideaの管理単位」（`snippetStorageMode`）を消す。今の Idea の画面（「以前のアイデア」）を外す。
- 2-5: `.then/references/imports/` の資料を素材フォルダへ移し、資料のパスを持つもの（資料カード・最近の資料・資料の候補・Idea の資料リンク・ボードの資料カード・ノート「プロット（移行）」の本文）をすべて書き換える。

移行の前に元のデータをバックアップする。移行は1回だけで、途中で失敗しても、2回動いても、データが重ならず失われない。結果は 1-3 の期待値（`test:binder-baseline`・`test:binder-baseline-rust`）と比べる。

変えないもの: 投稿の保存形式（2-1。`.then/posts.jsonl` に1行1件、書き換えはその行だけでハッシュを比べる）、ノートの作り方（2-3。素材フォルダがなければ「素材」、同じ名前は「-2」）、ノートかどうかは `role` だけで決めること、1-3a、1-5〜1-7、2-1 の投稿ストリーム、2-2 のノートモード、2-3 の「ノートにする」と札。画面に説明の文は足さない。テーマの色の使い方（特に coral-light）を守る。

- ブランチ: `feat/binder-2-4-5-migrate`
- 戻し先: タグ `checkpoint/before-binder-2-4-5`（コミット `756c691`。中身は main `74b0ac3` と同じ。`demo-video/` と `landing-page/` は含めていない）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 済み（2026-11-15） |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

行番号は、ことわりがなければチェックポイント `756c691` の時点のもの。

---

## 工程1: 調査の結果

### Idea がいまある場所

| まとまり | 場所 | 中身 |
|---|---|---|
| 保存（作品ごと） | `project.json` の `ideaThreads`（旧形式 `snippets` も読む）。`src-tauri/src/lib.rs` 3335〜3365（`load_project_snippets`・`save_project_snippets`）、370〜（`migrate_snippets_to_threads`） | スレッド `{ id, kind: inbox/thread, title, starred, createdAt, updatedAt, fragments }`、断片 `{ id, body, used, createdAt, updatedAt, originRef? }` |
| 保存（全作品で共有） | アプリ状態 `app-state.json` の `profileSnippets` | 同じ形。`snippetStorageMode: "profile"` のときに使う |
| 並び順と資料リンク | 作品の `.then/reference-layouts/default.json` の `ideaThreads`（`threadId` ごとの `items`。断片は `{ sourceType: "idea", fragmentId }`、資料は `{ id, sourceType: "reference", sourcePath, createdAt }`）、`ideaThreadsMode`、`otherIdea`（表示していない側の管理単位の並び順と Idea カード） | 断片の本体は持たない |
| 読み込みの整え | `src/ideaThreadModel.ts` 71〜146（`normalizeIdeaThreads`）、`src/ideaReferenceModel.ts`（`reconcileIdeaThreadLayouts`・`alignIdeaLayoutToMode`） | 1-3 の期待値はこの2つを通した見え方 |
| 操作 | `src/ideaThreadActions.ts`（799行） | 追加・移動・削除・スレッド・資料リンク・Canvas との受け渡し・作品間の移動 |
| 画面 | `src/components/snippets/IdeaPane.tsx`（461行）ほか `snippets/` の5ファイル、`src/components/binder/BinderPane.tsx`・`OpenCardsPane.tsx`、`PostStreamPane.tsx` 151 の「以前のアイデア」 | |
| 資料レイヤーの Idea カード | `src/components/references/ReferenceLayer.tsx` 244・352、`types.ts` の `IdeaBinderCardState` | 断片をカードで開いたもの。レイアウトの `cards` に入る |
| Canvas | `src/CanvasWindowApp.tsx` 863〜（サイドパネルの「Idea」タブ）、2647（「Idea へ送る」）、2676（「元 Idea を表示」、ノードの `thenOrigin`）、App 7002・7008 が受ける | |
| 設定 | `src/components/dialogs/FileSettings.tsx`・`SettingsModal.tsx`、`storedStateModel.ts`、App の管理単位の切り替え・「プロファイルに保存している間は…」の通知（App 6310） | |

### 資料がいまある場所

| まとまり | 場所 | 中身 |
|---|---|---|
| ファイル | 作品・ライブラリ直下の `.then/references/imports/` | txt・md・png・jpg・jpeg・webp・pdf |
| 取り込み | `pick_reference_files`（lib.rs 3867）、`create_reference_text_file`（3914）。どちらも `.then/references/imports/` へ書く | **画面から呼ぶのは Idea の📎だけ**（`RightSidebar.tsx` 398・399） |
| 候補の一覧 | `list_reference_candidates`（3934）。`.then/references/imports/` の中だけを返す | Idea・Canvas のサイドパネル・資料カードで使う |
| 読む・書く | `read_reference_text`・`save_reference_text`・`read_reference_binary`（3980〜）。作品の中のどのパスでも読める（`resolve_reference_absolute_path`） | 移しても読める |
| 削除 | `delete_imported_reference`（3959）。`.then/references/imports/` の中だけ消せる | |
| 「取り込み済み」の印 | `ReferenceFileInfo.imported`（Rust `is_imported_reference`、TS `storedStateModel.ts` 398） | パスが `.then/references/imports/` の下かどうか |
| パスを持つもの | レイアウトの `cards`（資料カード）・`recent`（最近の資料）・`ideaThreads` の資料リンク、ボード `.then/boards/*.canvas` の `type: "reference"` のノード、ノート「プロット（移行）」の本文の `@[[...]]`（場所は `project.json` の `plotMigration.notePath`） | |
| バインダー | `list_project_folder`（4116）は **txt と md だけ**を一覧に入れる（`is_supported_text_extension` 5257） | 画像・PDF は素材フォルダへ移してもバインダーに出ない |

### 手元のデータ（2026-11-15、`Documents/Books` とアプリ状態を読むだけで数えた）

| 作品 | インボックスの断片 | 名前の付いたスレッド（断片数） | 取り込み資料 | 資料リンク | 最近の資料 | ボードの資料カード | ボードの「元 Idea」 |
|---|---|---|---|---|---|---|---|
| ライブラリ直下（Books） | 0 | — | 2 | 4 | 0 | 2 | 1 |
| Then_デモ用 | 1 | — | 0 | 0 | 0 | 0 | 0 |
| workspace | 1 | — | 0 | 0 | 0 | 0 | 0 |
| テスト | 2 | Then開発ログについて(4) | 4 | 0 | 0 | 0 | 0 |
| テスト_snapshot検証用 | 35 | Inspiration Songs(5)、What I have to write(7)、登場人物とかで使う(2)、Then開発ログについて(9) | 12 | 24 | 24 | 3 | 1 |
| 名古屋での一人暮らし2026 | 1 | — | 1 | 2 | 2 | 0 | 0 |
| ほか2作品 | 0 | — | 0 | 0 | 0 | 0 | 0 |

- アプリ側の `profileSnippets` はインボックスだけで断片2件。設定は「作品ごとに分ける」。
- どの作品にも素材フォルダはまだない（1-6 の移行はふだんの Then でまだ動いていない）。資料の移動は、ほぼ全部が「素材」を作る場合になる。
- 資料リンク・ボード・原稿のどれにも、サンプルの ID のスレッド、2つ目のインボックス、資料レイヤーの Idea カード、`otherIdea` はない。
- 原稿・ノートの本文に `.then/references` を書いたファイルはない。

### 気づいた点

- **資料の取り込みは、今の Idea の画面からしかできない。** Idea の画面を外すと、ファイルを取り込む入口がなくなる（工程5の「Idea の画面を外す前の一覧」）。
- **画像・PDF はバインダーに出ない。** 素材フォルダへ移すと、開く入口は「開いているカード」の一覧（すでに開いたものだけ）と Canvas だけになる。
- **「資料の候補」は `.then/references/imports/` しか見ない。** 移したあとは素材フォルダを見るように変えないと、候補が空になる。削除も同じ（取り込み資料しか消せない）。
- **ライブラリ直下には素材フォルダの考えがない**（1-4 で三段にしていない。1-6 はノートを直下に置いた）。手元のライブラリ直下には資料が2つ、資料リンクが4つ、ボードの資料カードが2つある。
- **1-3 の見本データにはボードがない。** ボードの資料カードの書き換えは、別の見本（一時フォルダに写して足す）で確かめる。1-3 の見本と期待値は書き換えない。
- **Canvas のノードの `thenOrigin` は断片の ID を持つ**（手元に2つ）。第4段階の 4-5（コピーカードを参照へ置き換える）が手がかりにするので、断片が何になったかの対応を残す必要がある。
- **作品を開くと、整えた形がファイルに書かれる**（1-3 の E2）。移行は 1-6 と同じく、今の読み込みと同じ整え（`normalizeIdeaThreads` → `reconcileIdeaThreadLayouts`）を通した見え方を入力にする。
- 1-3 の I11（サンプルの ID のスレッドの中の利用者の断片が見えない）と I12（2つ目のインボックスの題が消える）は、この移行で拾うかを決める約束になっている（KNOWN_ISSUES 2026-11-10）。

## 工程2: 仕組みの説明

### 言葉

- **断片**: Idea の1件のメモ。
- **インボックス**: 作品ごとに1つある、スレッドに入れていない断片の置き場。
- **名前の付いたスレッド**: 利用者が作ったスレッド（`kind: "thread"`）。
- **資料リンク**: スレッドの中に並べた、資料ファイルへのリンク。ファイルはスレッドとは別に `.then/references/imports/` にある。
- **移行**: 作品の Idea を投稿とノートにし、資料を素材フォルダへ移して、`ideaThreads` を空にすること。作品ごとに1回だけ。
- **パスの対応表**: 資料の元のパス（`.then/references/imports/設定集.pdf`）と移した先（`素材/資料/設定集.pdf`）の組。書き換えはすべてこの表で行う。

### 1. 移行の前と後（データの形）

| | 前 | 後 |
|---|---|---|
| `project.json` の `ideaThreads`・`snippets` | スレッドの配列 | `[]` |
| `project.json` の移行の印 | なし | `ideaMigration: { backupPath, migratedAt, notes: [{ threadId, path }], posts: N, moved: [{ from, to }], fragments: [{ id, post? , note? }] }`（名前は案。`fragments` は Canvas の `thenOrigin` のため） |
| インボックスの断片 | `ideaThreads` | ライブラリの `.then/posts.jsonl` に1件1行。作品の `workId` と名前を記録 |
| 名前の付いたスレッド | `ideaThreads` と並び順 | `<素材フォルダ>/<スレッド名>.md` |
| 資料ファイル | `.then/references/imports/` | `<素材フォルダ>/資料/`（決めてほしいこと 6） |
| レイアウト `default.json` | `cards`・`recent`・`ideaThreads`・`ideaThreadsMode`・`otherIdea` | 資料カードと最近の資料のパスを書き換え、Idea カード・`ideaThreads`・`ideaThreadsMode`・`otherIdea` を外す |
| ボード `*.canvas` | 資料カードの `sourcePath` が元のパス | 新しいパス |
| ノート「プロット（移行）」 | 本文に `@[[.then/references/imports/…]]` | 新しいパス（ほかの文字は変えない） |
| バックアップ | なし | `.then/backups/idea-<日時>/` に、`project.json`・`reference-layouts/`・`boards/` の `*.canvas`・ノート「プロット（移行）」・`references/` をまるごと |
| アプリ状態の `profileSnippets` | スレッドの配列 | 投稿へ移したら空。印 `profileSnippetsMigration: { library, at }` |
| 設定 `snippetStorageMode` | `workspace` / `profile` | 読み捨てる |

### 2. 投稿の作り方（案）

- 1断片を1件の投稿にする。`at` は断片の `createdAt`（時差つきの ISO 8601。2-1 と同じ）、`body` は断片の本文をそのまま。
- `updatedAt` が `createdAt` より後なら `edited` にその時刻を入れる（2-1 の「直した」と同じ見え方）。
- `used`（本文へ入れた断片）は決めてほしいこと 3。
- `originRef`（Canvas から来た断片）は、投稿の行の知らない欄として `origin` にそのまま残す（2-1 の読み込みは知らない欄を残す）。
- 投稿の ID は断片から決まる値にする（作品の `workId` と断片の ID から作る）。2回動いても、同じ ID の行は足さない（2-1 の取り込み `import_own_file` と同じ作法）。これが「投稿が重ならない」の仕組み。
- 投稿の並びは時刻の順なので、インボックスの並び順は投稿には残らない（バックアップには残る）。

### 3. ノートの書き方（案）

2-3 の「ノートにする」と同じ形（`noteTextFor`）にする。

```markdown
# 場面: 港

港の場面の一

@[[素材/資料/資料a.md]]

港の場面の二

@[[素材/資料/map (2).png]]

Canvasから来た断片
```

- 断片と資料リンクを、画面に見えていた並び順（`reconcileIdeaThreadLayouts` の結果）で1段落ずつ書く。本文は1文字も変えない。
- 資料リンクは、1-6 のノート「プロット（移行）」と同じ `@[[パス]]` の文字にする（エディタは特別に扱わない。押しても開かない。3-1・3-2 のリンク索引で扱う）。
- スター・`used`・時刻・ID はノートに書かない（バックアップと移行の印に残る）。
- 置き場所は素材フォルダ（なければ「素材」を作る。ふつうのフォルダ「素材」があれば「素材-2」）。同じ名前のノートがあれば「-2」。ただし同じ中身のノートがあれば、それを使う（落ちたあとのやり直しで2本にしない）。1-6・2-3 と同じ。
- スレッド名がファイル名に使えない文字（`/ \ : * ? " < > |`）を含むと、2-3 の `note_stem`（`normalize_text_file_name`）は断る。2-3 では利用者が名前を直せばよいが、移行では断ると作品の移行がずっと失敗する。見本「場面: 港」がこれに当たる（手元のスレッド名にはない）。扱いは決めてほしいこと 11。見出しはスレッド名のまま書く。
- 断片も資料リンクもないスレッドは、見出しだけのノートにする（名前は利用者が付けたもの）。

### 4. 資料の移し方（案）

1. 作品の `.then/references/imports/` の中のファイルを、`<素材フォルダ>/資料/` へ移す（中のフォルダの形はそのまま）。同じ名前があれば `-2`（今の取り込みと同じ付け方）。
2. 移した結果からパスの対応表を作り、レイアウト・ボード・ノート「プロット（移行）」・これから作るノートの資料リンクを、すべてこの表で書き換える。
3. 対応表にない資料パス（原稿ツリーのファイル `第一章/a.md`、もうないファイル `消した資料.md`）は書き換えない。
4. 移したあと、`.then/references/imports/` が空なら消す（`.then/references/` はバックアップに残る）。

### 5. 移行の流れ（案）

1-6 と同じく、画面の側が今の読み込みで見え方を作り、Rust の新しい命令（`migrate_project_ideas`、名前は案）に、読んだときのままの `ideaThreads` と一緒に渡す。Rust は `project.json` の鍵を取ったまま、次を順に行う。

1. `project.json` を読み直し、`ideaThreads` が渡されたものと同じかを確かめる。違えば何もせずに断る（次に開いたときにやり直す）。
2. バックアップを書き、読み直して確かめる。
3. 素材フォルダがなければ作る。
4. 資料を移す。移す前に、移す予定（対応表）をバックアップのフォルダに書いておく（途中で落ちたときに、次の回が続きから移すか戻すかを決められるように）。
5. レイアウト・ボード・ノート「プロット（移行）」を書き換える。ノート「プロット（移行）」は、読んだときのハッシュを比べて書く（1-3a の作法。開いて直していたら書かずに失敗にする）。
6. ノートを書く。
7. 投稿をライブラリの `posts.jsonl` へ足す（投稿の鍵を取り、同じ ID は足さない）。
8. `ideaThreads`・`snippets` を空にし、移行の印を書いて `project.json` を保存する。

- 途中で失敗したら、その回に移した資料を元へ戻し、書き換えたファイルをバックアップから戻し、作ったノートと素材フォルダを消す。`project.json` は書かない。足した投稿は残す（ID が決まっているので、次の回に重ならない）。画面は通知だけ出して、作品はそのまま開く。
- 1回だけにする仕組みは、`ideaThreads` が空になること自体（1-6 と同じ）。
- 移行の印の `fragments`（断片 → 投稿の ID／ノートのパス）は、Canvas の「元 Idea」と 4-5 のために残す。

**アプリ側の `profileSnippets`**: 起動時に開いたライブラリで、作品の移行のあとに行う。`.then/backups/profile-ideas-<日時>.json` にそのまま残し、インボックスの断片を作品なしの投稿にする（決めてほしいこと 4）。成功したらアプリ状態の `profileSnippets` を空にし、印を書く。2台目以降のライブラリには移さない。

**きっかけ**: 1-6 と同じ。起動時に、最後に開いていた作品のライブラリの直下と全作品を順に移してから作品を開く。ライブラリの外の作品や、起動時に開かなかったライブラリは、開いたときに移す。1作品の失敗はほかを止めない。通知は「Idea を投稿とノートに移しました」（複数なら「N作品の…」）、失敗は「Idea を投稿とノートに移せませんでした」（決めてほしいこと 1）。

### 6. ほかの機能との関係

| 機能 | 移行の後 |
|---|---|
| 右のペイン「アイデア」 | 投稿の流れだけになる。「以前のアイデア」がなくなる |
| バインダーの投稿の段 | 変えない（受信箱の数。移した断片の分だけ増える） |
| 素材の段 | 移したノートと資料（md・txt）が出る。画像・PDF は決めてほしいこと 7 |
| 資料レイヤー（資料カード） | 移したパスで開いたまま戻る。Idea カードはなくなる |
| 「開いているカード」 | 資料カードだけになる |
| Canvas | 資料カードは新しいパスで開ける。サイドパネルの「Idea」タブ・「Idea へ送る」・「元 Idea を表示」は決めてほしいこと 8 |
| 全文検索・置換 | 移したノートは素材なので含まれる（1-3b） |
| 字数・書き出し・進捗 | 素材なので数えない（1-3b） |
| チェックポイント | ノートと素材の資料（md・txt）は入る（1-3b） |
| 改名・移動 | 素材のノートと資料は、今の改名・移動に付いていく。資料カード・最近の資料のパスの付け替え（`retargetReferenceCard` など）も今のまま効く |
| ライブラリ直下⇄作品の「移動・コピー…」 | Idea の分がなくなる（投稿はライブラリで共有なので要らない） |
| 作品の切り替え・閉じる前の書き切り | Idea の保存がなくなる |
| 1-3 の期待値 | 見本データは書き換えない。移行は一時フォルダに写して試す |

### 7. 今の挙動の癖（工程9で実機で確かめる）

| # | 癖 | 扱い（勧め） |
|---|---|---|
| M1 | どのスレッドにも付いていない取り込み資料は、開くたびにインボックスの末尾に出る（1-3 の I7） | 資料は素材フォルダへ移すだけで、投稿は作らない（決めてほしいこと 2） |
| M2 | もうないスレッドの資料リンクは、インボックスの末尾に出る（I2） | M1 と同じ |
| M3 | サンプルの ID のスレッドは、中に利用者の断片があっても出ない（I11） | 決めてほしいこと 5 |
| M4 | インボックスが2つあると、2つ目の題が消える（I12） | 断片は投稿になるので、題は要らない（記録だけ） |
| M5 | 旧形式 `snippets` の断片は、時刻が「読んだ時刻」になる（I9） | 投稿の時刻も移行した時刻になる（決まらないため。記録だけ） |
| M6 | 「全作品で共有」の並び順は作品ごとに違いうる（I10） | 投稿は時刻の順なので、並び順は使わない |
| M7 | 同じパスの資料リンクは1つにまとめる（I8） | ノートにも1つだけ書く |

## 工程3: 依存関係

| 処理 | 呼ぶもの | 移行の後 |
|---|---|---|
| `load_project_snippets`（Rust） | 作品を開く4つの経路、`test:binder-baseline-rust` | 移行の1. でだけ使う |
| `save_project_snippets` | App の保存、作品間の移動 | 画面からは呼ばない。1-6 の `save_project_plot_cards` と同じく、Rust のテストの比べる相手として残すかは工程7で決める |
| `normalizeIdeaThreads`・`reconcileIdeaThreadLayouts`・`loadWorkspaceSnippets` | 読み込み、`test:binder-baseline`、`test:stored-state-model` | 残す（移行が使う） |
| `alignIdeaLayoutToMode`・`otherIdea`・管理単位の切り替え | App、`test:binder` | 消す |
| `ideaThreadActions.ts`・`IdeaPane.tsx`・`snippets/`・`BinderPane.tsx` | 右のペイン | 消す |
| `IdeaBinderCardState`・資料レイヤーの Idea カード | `ReferenceLayer.tsx`・`OpenCardsPane.tsx` | 消す（読み込みで捨てる） |
| `pick_reference_files`・`create_reference_text_file`・`list_reference_candidates`・`delete_imported_reference` | App の資料の追加・候補・削除 | 取り込み先・候補・削除の範囲を素材フォルダへ（決めてほしいこと 6・7） |
| `is_imported_reference`・`storedStateModel.ts` 398 | 資料の印 | 素材フォルダの資料を「取り込み済み」とみなすか（工程7） |
| `then-canvas-copy-to-idea`・`then-canvas-focus-idea` | Canvas | 決めてほしいこと 8 |
| 投稿の追記（`post_stream.rs` の `append_lines`・`latest_indexes`） | 2-1 | 移行が同じ処理で足す。投稿の形は変えない |
| ノートを書く（`post_stream/note.rs` の `write_note`・`note_stem`、`plot_migration.rs` の `note_folder`・`first_free_name`） | 2-3・1-6 | 移行が同じ処理を使う |

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src-tauri/src/lib.rs`（命令の登録、資料の取り込み先・候補・削除）、新規 `src-tauri/src/idea_migration.rs`（名前は案）、`src-tauri/src/project_state.rs`（移行の印）、`src-tauri/src/post_stream.rs`（移行から投稿を足す入口）、新規 `src/ideaMigration.ts`（見え方を作る）、`src/App.tsx`（4つの経路、Idea の値・保存・管理単位、資料の追加）、`src/components/layout/RightSidebar.tsx`、`src/components/posts/PostStreamPane.tsx`、`src/components/references/ReferenceLayer.tsx`、`src/components/binder/OpenCardsPane.tsx`、`src/CanvasWindowApp.tsx`、`src/storedStateModel.ts`、`src/types.ts`、`src/components/dialogs/FileSettings.tsx`・`SettingsModal.tsx`、消す `src/ideaThreadActions.ts`・`src/components/snippets/`・`src/components/binder/BinderPane.tsx`、CSS（Idea の部分）、テスト（4-3）、`docs/USER_MANUAL.md`
- 条件しだいで変わる: `src-tauri/src/lib.rs` の `list_project_folder`・`WorkspaceSidebar.tsx`（決めてほしいこと 7 が A なら）、`src/utils/libraryTransfer.ts`
- 変えない: 1-3 の見本データと期待値、投稿の保存形式、2-2 のノートモード、2-3 の「ノートにする」と札、素材の判定（`role`）

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 断片を投稿・ノートにして `ideaThreads` を空にする | **高** | 利用者の文章を動かす。失敗や二重実行で消えたり増えたりしうる。バックアップ・鍵の中での確かめ・決まった ID・失敗時の取り消しで守る |
| 資料ファイルを移す | **高** | ファイルそのものを動かす。途中で落ちると、パスと実際の場所がずれうる。移す予定を先に書き、失敗したら戻す |
| パスの書き換え（レイアウト・ボード・プロットのノート） | 中 | 書き漏らすと資料カードが「見つからない」になる。ボードは別ウィンドウで開いていることがある（起動時の移行では開いていない） |
| 資料の取り込み・候補・削除の場所を変える | 中 | 新しく取り込んだ資料が古い場所へ行くと、二つの置き場が残る |
| Idea の画面・設定・Canvas の Idea を外す | 中 | 外すと届かなくなる操作がある（工程5の一覧） |
| `profileSnippets` を移す | 低 | 手元は2件。2台目のライブラリへは移さない |

### 4-3. 起こりうる回帰と、気づけるテスト

| 回帰 | 気づけるテスト |
|---|---|
| 投稿・ノートの中身が Idea の見え方と違う | 新しいテスト（`expected/idea-workspace.json`・`idea-profile.json` と比べる） |
| 資料のパスの書き漏らし | 新しいテスト（`expected/references.json` を対応表で写したものと比べる。ボードは新しい見本） |
| 2回目に開いて投稿・ノートが増える | 新しいテスト（Rust・TS の両方） |
| 途中の失敗で `ideaThreads` だけ消える・資料が片方にだけある | 新しい Rust テスト（失敗を起こして確かめる） |
| 作品を開くときに、ほかの値（校正辞書・並び順・進捗・`plotCards`・`plotMigration`・`materialsFolder`）を書き換える | 新しい Rust テスト（1-6 と同じく、Idea と移行の印以外が変わらないこと） |
| 投稿の行の形が 2-1 と違う・ほかの行を書き換える | `test:post-stream`・`test:post-stream-rust` |
| 素材の数え方・ノートモード | `test:materials`・`test:binder-tiers`・`test:note-mode` |
| 1-6 の移行とぶつかる | `test:plot-migration`・`test:plot-migration-rust` |
| 改名・移動の付け替え | `test:project-entry-actions` |
| 右のペイン | `test:right-sidebar`（「以前のアイデア」の確認を外す） |
| 1-3 の期待値が変わる | `test:binder-baseline`・`test:binder-baseline-rust`（変わらないはず） |

### 4-4. 今の自動テストの状態

「前」の一式（`756c691`、2026-11-15。cargo のテストも外さずに動かした）: build 成功、本体の束 718,574 バイト、118本中 115本が通り、3本が失敗。終わったあとに残ったプロセスは 0（QA Then・QA WebView2・テストの Edge・テストの node）。

| 元からの失敗 | 理由 |
|---|---|
| `test:editor-text-edits` | 1-5・1-6 の「前」「後」と同じ失敗（「every icon draws its own picture」） |
| `test:v058-bundle` | 本体の束が 500 kB を超えている。もとからの状態。増え方だけを見る |
| `test:editor-selection` | 10分で打ち切り（止まった）。1-6 の「前」では通っていた。「後」でも止まれば、単独で2回動かして確かめる |

頼まれた10本（`test:binder-baseline`・`test:binder-baseline-rust`・`test:post-stream`・`test:post-stream-rust`・`test:note-mode`・`test:materials`・`test:plot-migration`・`test:binder-tiers`・`test:right-sidebar`・`test:project-entry-actions`）はすべて通った。

## 工程5: 案

### 5-1. 方針

- 2-4 と 2-5 を、作品ごとに1回の Rust の命令の中で行う（資料を移してから、新しいパスでノートを書くため）。
- 見え方は 1-3 の期待値を作ったのと同じ読み込みを通して作る（1-6 と同じ）。
- 投稿の追記・ノートの作り方・素材フォルダの決め方は、2-1・2-3・1-6 の処理をそのまま使う。新しく作らない。
- Idea の画面と、Idea にしか使わない処理は同じブランチで消す。消す前に、そこからしかできない操作に別の入口を用意する（5-2）。

### 5-2. Idea の画面を外す前の一覧（そこからしかできない操作）

| # | 操作 | 今の入口 | ほかの入口 | 案 |
|---|---|---|---|---|
| U1 | 資料のファイルを取り込む | Idea の📎「ファイルを追加」 | **なし** | 素材の段の「＋」と右クリックに「資料を取り込む…」を足す。取り込み先は `<素材フォルダ>/資料/`（決めてほしいこと 6） |
| U2 | 新しいテキスト資料を作る | Idea の📎 | バインダーの「新しいファイル」（素材の段） | 代わりあり。外す |
| U3 | 資料（画像・PDF・テキスト）を資料カードで開く | Idea の資料の行 | 「開いているカード」（開いたことのあるものだけ）、Canvas の資料カード | 決めてほしいこと 7 |
| U4 | 取り込み資料を消す | Idea の「資料ファイルを削除」 | バインダーの削除（md・txt だけ） | 決めてほしいこと 7 |
| U5 | 断片・スレッド・資料を、ライブラリ直下⇄作品へ移動・コピー | Idea の「…へ移動・コピー…」 | なし | 断片・スレッドは要らなくなる（投稿はライブラリで共有）。ノート・資料ファイルの作品間の移動は今回入れない（記録して残す） |
| U6 | 断片を本文へドラッグして入れる（`used` が付く） | Idea | なし（投稿はドラッグできない） | 今回入れない（記録して残す）。投稿の本文はコピーで写せる |
| U7 | 断片・資料を Canvas へドラッグ | Idea、Canvas のサイドパネル | 資料は Canvas のサイドパネルの「資料」タブ | 決めてほしいこと 8 |
| U8 | 断片を資料レイヤーのカードで開く | Idea の「カードで開く」 | なし | 外す。開いていた Idea カードは閉じる（バックアップに残る） |
| U9 | Idea と資料を検索する | Idea の検索欄 | 全文検索（素材のノートは入る。投稿は入らない） | 投稿の検索は今回入れない（記録して残す） |
| U10 | スレッドにスターを付ける | Idea | なし | ノートには代わりがない（バックアップに残る）。記録して残す |
| U11 | スレッドを作る・改名・消す、断片をスレッドへ移す | Idea | ノートを作る・改名・消す、投稿 →「ノートにする」 | 代わりあり |
| U12 | 「Ideaの管理単位」を切り替える | 設定 | — | 消す（3.8 で決定済み） |

### 決めてほしいこと

| # | 論点 | 選択肢（先頭が勧め） |
|---|---|---|
| 1 | 移行のきっかけ | **A. 1-6 と同じ（起動時にライブラリの直下と全作品、ほかは開いたとき）**。1-6 と同じ所で呼ぶので、経路が増えない／B. 開いた作品だけ |
| 2 | インボックスの資料リンク（どこにも付いていない資料を含む。手元は該当なし〜数件） | **A. ファイルを素材フォルダへ移すだけで、投稿は作らない**（M1 のとおり、多くは開くたびに自動で並んだもの。ファイルは素材の段と資料の候補に出る）／B. 1件ずつ、本文 `@[[素材/資料/…]]` の投稿にする |
| 3 | 本文へ入れた断片（`used`） | **A. 受信箱から外した投稿にする**（「すべて」「この作品」には出る。使い終えた印を、投稿で一番近い意味に移す）／B. 受信箱に入れる |
| 4 | アプリ側の `profileSnippets` の名前の付いたスレッド（手元は0件） | **A. 最初に開いたライブラリの直下にノートとして置く**（1-6 と同じ置き方。スレッドはノート、の決まりに揃う）。インボックスの断片は作品なしの投稿／B. 先頭の断片を投稿、残りをその返信にする |
| 5 | サンプルの ID のスレッドの中の利用者の断片（I11。手元は0件） | **A. 拾う**（利用者が書いた断片だけ。サンプルの本文と同じ断片は今までどおり移さない）。1-3 の期待値と違う点として、比べるテストで明示する／B. 今の見え方どおり移さない（バックアップには残る） |
| 6 | 資料の置き場所と、これからの取り込み先 | **A. `<素材フォルダ>/資料/` に移し、新しく取り込むものもそこへ入れる**（素材のノートと混ざらず、同じ名前もぶつかりにくい）。資料の候補と削除の範囲も素材フォルダにする／B. 素材フォルダの直下 |
| 7 | 画像・PDF を開く・消す入口（U3・U4） | **A. 素材の段に画像・PDF も出し、押すと資料カードで開く。削除・改名・移動はほかのファイルと同じ**（Idea の画面を外すと、ほかに開く入口がない。一覧に入れるのは素材フォルダの中だけで、原稿の段・字数・書き出し・チェックポイントには入れない）／B. 今回は出さず、資料カードは Canvas と「開いているカード」からだけ開く |
| 8 | Canvas の Idea（サイドパネルの「Idea」タブ、「Idea へ送る」、「元 Idea を表示」） | **A. 「Idea へ送る」は「投稿にする」に変える（選んだカードを1件ずつ投稿に。作品を記録）。「Idea」タブと「元 Idea を表示」は外す**（断片がなくなるため。断片が何になったかは移行の印に残し、4-5 で使う）／B. 3つとも外す |
| 9 | ライブラリ直下の資料（手元は2つ、資料リンク4つ、ボードの資料カード2つ） | **A. ライブラリ直下にフォルダ「資料」を作って移す**（同じ名前のフォルダがあれば「資料-2」。直下は三段でないので、素材フォルダは作らない。1-6 がノートを直下に置いたのと同じ考え）／B. 今のまま `.then/references/imports/` に残す（置き場が二つ残る） |
| 10 | 原稿・ノートの本文にある古いパス（手元は0件） | **A. 書き換えない**（3.7 の対象に入っていない。利用者の文章なので、プロットのノート以外は触らない）。移行の印の対応表に残す／B. 素材と原稿の本文の `@[[…]]`・`![](…)` も書き換える |
| 11 | ファイル名に使えない文字を含むスレッド名（見本「場面: 港」。手元は0件） | **A. その文字を全角に置き換えたファイル名にする**（「場面： 港.md」。見出しは元の名前のまま。読んで同じ意味に見える）／B. その文字を消す／C. その作品の移行を止めて知らせる |

### テストの直し方と足すテスト

先に書く（「前」で通ることを確かめてコミットする）:

- 作品を開いたときに、`project.json` の Idea 以外（校正辞書・並び順・進捗・`plotCards`・`plotMigration`・`materialsFolder`・`workId`）を書き換えないこと（1-6 と同じ形。移行のあとも同じテストで、Idea と移行の印以外が変わらないことを見る）。

移行のあとに足す:

- `test:idea-migration`（新規、esbuild）: 見本の各作品から投稿とノートの中身を作り、読み戻して `expected/idea-workspace.json`・`idea-profile.json` と1件ずつ比べる（本文・時刻・`used` の扱い・Canvas の元・並び順）。資料のパスは `expected/references.json` を対応表で写したものと比べる。1-3 の期待値と違うのは、決めてほしいこと 2・3・5 で決めた点だけであることを、違いの一覧として書いて確かめる。
- `test:idea-migration-rust`（新規、cargo）: 見本を一時フォルダに写して命令を動かし、(1) バックアップが元と同じ、(2) `ideaThreads` が空、(3) 移行の印、(4) 2回目は何もしない（投稿もノートも増えない）、(5) `ideaThreads` が途中で変わっていたら断る、(6) 資料を移す途中・ノートを書く途中・投稿を書く途中で失敗させたとき、資料が元の場所に戻り、書き換えたファイルが元に戻り、2回目で重ならずに終わる、(7) 素材フォルダのない作品・ふつうのフォルダ「素材」がある作品・ライブラリ直下、(8) ボードの資料カード（新しい見本を一時フォルダで足す）、(9) 開いて直したノート「プロット（移行）」は書き換えず失敗にする。
- 期待を変えるテスト（工程7でコミットの本文に理由を書く）: `test:right-sidebar`（「以前のアイデア」がない）、`test:idea-actions`・`test:v066-idea`・`test:binder`（Idea の操作・画面が消えるので、残る読み込みの確認だけにするか消す）、`test:startup-idea-order`・`test:save-on-work-switch`（Idea の部分を外す）、`test:stored-state-model`（管理単位・`profileSnippets`）、`test:library`（Idea の移動・コピーを外す）、`test:canvas-save`（Canvas の Idea）、`test:materials`・`test:binder-tiers`（決めてほしいこと 7 が A なら、素材の段に画像・PDF が出る。原稿の段の確認は変わらないはず）。
- 変わらないはず: `test:binder-baseline`・`test:binder-baseline-rust`・`test:post-stream`・`test:post-stream-rust`・`test:note-mode`・`test:plot-migration`・`test:plot-migration-rust`・`test:project-entry-actions`。変わったら止めて知らせる。

### 進め方とコミットの分け方

1. 「前」を固定するテスト（作品を開いても Idea 以外を書き換えない）
2. 見え方から投稿・ノートの中身を作る処理と `test:idea-migration`
3. Rust の移行の命令（資料の移動・パスの書き換え・ノート・投稿・印）と `test:idea-migration-rust`
4. 作品を開く経路から移行を呼び、Idea の値・保存・管理単位をやめる。`profileSnippets` の移行
5. 資料の取り込み先・候補・削除を素材フォルダへ。素材の段の「資料を取り込む…」（と、決めてほしいこと 7 が A なら画像・PDF）
6. Canvas の Idea（決めてほしいこと 8）
7. Idea の画面・設定・資料レイヤーの Idea カードを外す。`ideaThreadActions.ts` ほかを消す。CSS、文書

### 見込みと、今回やらないこと

- 見込み: 消す行は約2,500行（`ideaThreadActions.ts` 799行、`IdeaPane.tsx` 461行、`snippets/` の残り、App の Idea の部分）。足す行は Rust 約400行、TS 約200行とテスト。
- やらないこと: 投稿の検索（U9）、投稿を本文や Canvas へドラッグすること（U6・U7）、ノート・資料ファイルの作品間の移動（U5）、ノートのスター（U10）、`@[[…]]` を押して開くこと（3-1・3-2）、原稿の本文のパスの書き換え（決めてほしいこと 10 が A なら）、Canvas の中間稿（4-4b）。

## 工程6: 人の確認

2026-11-15: 決めてほしいこと 1〜11 はすべて勧めのとおり（1A・2A・3A・4A・5A・6A・7A・8A・9A・10A・11A）。

## 工程7: 実施

## 工程8: 自動テスト

## 工程9: 実機確認

## 工程10: 完了
