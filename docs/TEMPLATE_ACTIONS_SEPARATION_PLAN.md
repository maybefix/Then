# テンプレート登録の分離の手順書

App.tsx の部品の中にある、テンプレートの一覧を読む関数 `loadTextTemplates` と、ファイルメニューの「このファイルをテンプレートとして登録…」の処理 `handleRegisterCurrentFileAsTemplate` を、`src/templateActions.ts` の `createTemplateActions(deps)` へ移す。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/template-actions`
- 戻し先: タグ `checkpoint/before-template-actions`（コミット `511b774`。中身は main `8721fd9` と同じ）
- 行番号は、断りがなければ `511b774` の時点のもの。App.tsx は 8,685行。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | 確認待ち |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

### コードがある場所

| まとまり | 行 | 行数 | 中身 |
|---|---|---|---|
| 一覧を読む | 6957〜6962 | 6 | `loadTextTemplates`。Rust の `list_text_templates` を呼ぶだけ |
| 登録 | 6964〜7029 | 66 | `handleRegisterCurrentFileAsTemplate`。入力ダイアログ → 同じ名前があれば上書きの確認 → Rust の `register_text_template` |

### 気づいた点

- 呼び出し元は少ない。`handleRegisterCurrentFileAsTemplate` は JSX の `TopbarFileMenu` へ渡す1か所（7969行）だけ。`loadTextTemplates` は登録の中（6998行）と、`createProjectEntryActions` へ渡す1か所（7079行）。新規ファイルのダイアログでテンプレートを選ぶときに使われる。
- App.tsx の文字列を読むテストで、この2つの関数の中身を確かめているものはない。`test:topbar-parts` は、帯のメニューの部品が `handleRegisterCurrentFileAsTemplate` という名前の props を受け取ることだけを確かめている。App の JSX で同じ名前を渡し続ければ、そのまま通る。
- 登録の処理を実際に動かしている自動テストはない（今は手で確かめるしかない）。
- プロパティの組を読む `loadPropertySets`（3812行）も `list_text_templates` を呼んでいるが、作品のパスの取り方（`propertyTypeScopeRef`）と、失敗したときの扱い（空の一覧にする）が違う。まとめない。

## 工程2: 仕組みの説明

### 言葉

- **テンプレート**: 新規ファイルを作るときの、ひな型の中身。`.txt` か `.md` のファイルとして保存されている。
- **保存先（scope）**: 「このワークスペース」（`workspace`。作品のフォルダの `.then/templates/`）か、「すべてのワークスペースで共通」（`profile`。アプリのデータのフォルダの `templates/`）。
- **deps**: 移した先の関数が使う、App の値と道具をまとめて渡すもの。

### 1. データの形

`TextTemplateSummary`（`src/types.ts`）: `id`、`name`（拡張子なし）、`scope`、`extension`（`txt`／`md`）。

### 2. 利用者の操作と内部の処理

| 操作 | 内部の処理 |
|---|---|
| ファイルメニュー →「このファイルをテンプレートとして登録…」 | Tauri 版でなければ「テンプレート登録はTauri版で利用できます」と通知して終わる |
| ダイアログが出る | 名前の初期値は開いているファイルの名前から拡張子を除いたもの（空なら「新規テンプレート」）。保存先は、作品を開いていれば2択（初期値は「このワークスペース」）、開いていなければ「すべてのワークスペースで共通」だけ |
| 「登録」を押す | 一覧を読み、同じ保存先・同じ拡張子・同じ名前（大文字小文字やアクセントの違いは同じとみなす）のテンプレートがあれば「テンプレートを上書き」の確認を出す。やめたら何もしない |
| 登録される | 開いているタブの今の本文（保存していない変更も含む）を、Rust の `register_text_template` で書く。拡張子は開いているファイルが `.md` なら `md`、それ以外は `txt`。成功したら「テンプレート「名前」を登録しました」 |
| 失敗 | 「テンプレートを登録できませんでした」と通知し、エラーの文を `lastError` に入れる |

### 3. 保存

保存するのは Rust 側だけ。React の値やアプリの状態には何も書かない。Rust は名前の前後の空白を削り、使えない文字（`/ \ : * ? " < > |`）があればエラーにし、同じファイルがあって上書きでなければ「template already exists」を返す。

### 4. ほかの機能との関係

- 新規ファイルのダイアログ（`projectEntryActions.ts` の `requestCreateFile` まわり）は、`loadTextTemplates` で一覧を読む。
- ダイアログは `useAppDialog` の `requestMultiInput`／`requestConfirm` を使う。

### 5. 今の挙動の癖（分離では直さない。工程9で実機で確かめる）

1. **名前の前後に空白があると、上書きの確認が出ずに失敗する。** App は空白を削らずに同じ名前を探すので見つからない。Rust は空白を削るので、同じファイルが見つかり「template already exists」になる。利用者には「テンプレートを登録できませんでした」とだけ出る。（コードを読んでの見込み）
2. **新しいタブの開始画面や空のタブでも登録できる。** メニューは本文の有無に関係なく押せ、空の本文が「新しいタブ」などの名前で登録される。（見込み）
3. **全角と半角の違いだけの名前で、上書きの確認が出るのに別のファイルができる。** `localeCompare` の `sensitivity: "accent"` は、文字の幅の違いを同じとみなすことがある。確認で「上書き」を選んでも、Rust は別の名前のファイルを新しく作り、元のテンプレートは残る。（見込み。環境の ICU しだい）

## 工程3: 依存関係

### A. React に依存しない処理

- `isTauriRuntime`（App.tsx 300行の、部品の外の1行の関数）。ほかの `*Actions.ts` と同じく、移した先に同じ1行を置く（`projectEntryActions.ts` などと同じ書き方）。

### B. 値（読むだけ。書くものはない）

| 値 | 使う所 |
|---|---|
| `projectFolder` | 一覧と登録の `rootPath`、保存先の選択肢と初期値 |
| `currentFileName` | 名前の初期値、拡張子 |
| `markdown` | 登録する本文 |

### C. 操作の関数

- C-1 `loadTextTemplates`（一覧を読む）
- C-2 `handleRegisterCurrentFileAsTemplate`（登録）

### D. 自動で走る処理

なし。

### E. 作品を開く経路

関係しない。

### F. 画面部品への受け渡し

`TopbarFileMenu` に `handleRegisterCurrentFileAsTemplate`。`createProjectEntryActions` に `loadTextTemplates`。どちらも名前を変えずに渡し続ける。

### G. App の外とのやり取り

Rust の命令 `list_text_templates`、`register_text_template`。

### H. App.tsx の文字列を読むテスト

この2つの中身を読むものはない。

### 結び目

- App の道具（`showToast`、`setLastError`、`requestMultiInput`、`requestConfirm`）に頼っている。いずれも呼び出し位置（6957行）より前で宣言されている（`requestMultiInput`・`requestConfirm` は 1211行付近の `useAppDialog`、`showToast` は 3874行、`setLastError` は state）。
- `loadTextTemplates` を `createProjectEntryActions`（7043行）より前で取り出す必要がある。元の位置で呼べば満たす。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`、`src/templateActions.ts`（新規）、`scripts/test-template-actions.mjs`（新規）、`package.json`（テストの登録）
- 変えない: Rust、`TopbarFileMenu.tsx`、`projectEntryActions.ts`、`types.ts`

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 登録 | 低 | アプリの状態に何も書かない。失敗しても書くのはテンプレートのファイル1つ |
| 一覧を読む | 中 | 新規ファイルのダイアログのテンプレートの一覧が、作品のパスを正しく受け取り続けること |

### 4-3. 起こりうる回帰不具合

| 不具合 | 既存テストで気づけるか |
|---|---|
| 作品を切り替えた後、古い作品のテンプレートが並ぶ（deps の値が古い） | なし |
| 登録が古い本文を書く | なし |
| メニューを押しても何も起きない | 文字列だけ（`test:topbar-parts`） |

描画のたびにその時点の値で `createTemplateActions` を呼ぶので、元と同じく、その描画の値を見る。

### 4-4. 今の自動テストの状態

「前」の一式（`511b774`、2026-10-31）: build 成功、メインの束 716,732 bytes、92件中4件が失敗。`test:ai-selection`、`test:canvas-save`、`test:v058-bundle`（元から上限超え）、`test:v0511-themes`。いずれも今回の変更より前からの失敗として扱い、「後」と比べる。残ったプロセスはすべて 0。

## 工程5: 案

### 5-1. 方針

これまでの分離（`projectEntryActions.ts`、`headingMoveActions.ts`）と同じ形にする。

- `src/templateActions.ts` に `createTemplateActions(deps)` を置き、`{ loadTextTemplates, handleRegisterCurrentFileAsTemplate }` を返す。
- App は元の位置（6957行）で呼び、同じ名前で取り出す。JSX と `createProjectEntryActions` への受け渡しは変えない。
- 中身・文言・条件・順番はそのまま。違うのは App の値を deps で受け取ることだけ。React の仕組みは持ち込まない。

### 5-2. 移すもの／残すもの

- 移す: C-1、C-2。
- 残す: `loadPropertySets`（別の機能で、作品のパスの取り方も違う）。

### 決めてほしいこと

工程2-5 の癖3つを、分離の後に別のコミット（同じブランチ）で直すかどうか。

- **勧め: 1 と 2 を直し、3 は記録だけにする。** 1 は、上書きできるはずの操作が理由のわからない失敗になる。名前の前後の空白を削ってから探せば直る（1行）。2 は、空のテンプレートが一覧に紛れ込む。開始画面と空のタブではメニューを押せなくする（新しい文は足さない）。3 は環境に左右され、名前の比べ方を Rust と揃える作業になるので、今回は記録だけにする。
- ほかの選択肢: 分離だけにして3つとも記録する／3つとも直す。

### テストの直し方と足すテスト

- 既存のテストは直さなくて済む見込み。
- `scripts/test-template-actions.mjs` を足す。esbuild で `src/templateActions.ts` を束ね、`invoke` とダイアログを入れ物で代えて実際に動かす。確かめること: Tauri 版でないときの通知、保存先の選択肢と初期値（作品あり／なし）、名前の初期値と拡張子、同じ名前での上書きの確認（やめたとき／上書きしたとき）、`invoke` に渡す引数、成功と失敗の通知、`loadTextTemplates` の `rootPath`。
- 効くことの確かめ: 移した先にわざと不具合を2つ入れて落ちることを見て、戻す。

### 進め方とコミットの分け方

1. `refactor: テンプレートの一覧と登録を App.tsx から templateActions.ts へ移す`（move-lines で移し、verify-move で lost 0 を確かめる）
2. `test: テンプレート登録の回帰テストを足す`
3. （癖を直すと決めたら）`fix: …` を癖ごとに1コミット
4. `docs: …の結果を記録`

### 見込みと、今回やらないこと

- App.tsx は約70行減る見込み。
- やらない: `isTauriRuntime` の共通化（10か所に同じ1行がある）、`loadPropertySets` とのまとめ、テンプレートの管理画面への切り出し。

## 工程6: 人の確認

## 工程7: 実施

## 工程8: 自動テスト

## 工程9: 実機確認

## 工程10: 完了
