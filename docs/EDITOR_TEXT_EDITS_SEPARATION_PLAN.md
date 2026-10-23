# 選択範囲の書き換えと本文の検索・置換 分離の手順書

App.tsx の部品の外に置かれている、本文の文字列を書き換える純粋な処理（太字・圏点・見出し・文章方向・記法のクリアと、検索バーの一致の数え上げ・置換）を、`src/editor/` と `src/search/` の新しいファイルへ移す。App.tsx（14,347行）を小さくする作業の続きで、Idea の分離（`docs/IDEA_SEPARATION_PLAN.md`）の次に手を付けやすいところとして選んだ。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/editor-text-edits`
- 戻し先: タグ `checkpoint/before-editor-text-edits`（コミット `557e42b`。中身は main `4889dba` と同じ）
- 行番号は、断りがなければ `557e42b` の時点のもの。

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

### なぜここを選んだか

App.tsx の1〜2,932行目は、部品（`export default function App()`、2,933行目）の外にある関数・型・定数で、React に依存しないものが多い。その中から、次の条件で選んだ。

- React の仕組み（state・useEffect）を使っていない。
- App.tsx の文字列を読むテスト（18本）の中に、名前も中身も出てこない（`text-deps.mjs` と、記法・検索に関する言葉の grep で確かめた）。
- 保存・作品を開く経路・ほかの作品のファイルに触らない（影響の重さが「高」になる所がない）。
- ひとまとまりで、外から使う関数が少ない。

### コードがある場所

| まとまり | 行 | 行数 | 中身 |
|---|---|---|---|
| 型 `LayoutDirection` | 363 | 1 | 文章方向（行頭・中央・行末） |
| 型 `EditorSelectionSnapshot` | 372〜376 | 5 | 選択範囲（開始・終了・その文字列） |
| 型 `EditorFindMatch` | 383〜390 | 8 | 検索バーの一致1件 |
| 選択範囲の書き換え | 1867〜2167 | 301 | `normalizeSelectionRange` 〜 `applyHeadingToSelection`（13の関数と型 `SelectionEdit`） |
| 本文の検索・置換 | 2169〜2276 | 108 | `replaceLiteralMatches`、`replaceMarkdownBodyMatches`、`collectEditorFindMatches` |

合わせて約420行。

### 気づいた点

- 使われていない関数はない。部品の外だけで使う手助けの関数（`stripDirectionMarkers`、`rangesTouch`、`pushClearReplacement`、`clearNotationInLine`）は、同じまとまりの中からだけ呼ばれる。
- この420行を実際に動かしているテストはない。記法を扱うテスト（`test:v057-deep`、`test:property-search`）は書き出しや検索の別の処理を確かめていて、ここは通らない。今は、壊れても自動テストでは気づけない。
- App.tsx の中で、`parseInlines`、`classifyLines`、`findCommentLineRanges`、`replaceTextSearchMatches` は、このまとまりの中でだけ使われている。移すと App.tsx の import から外れる。
- 検索の処理が2系統ある。本文の上の検索バー（Ctrl+F）は `replaceLiteralMatches`（大文字小文字を区別しない単純な一致）、左の検索サイドバーの「このファイルで置換」「プロジェクト全体で置換」は `replaceMarkdownBodyMatches`（`src/search/textSearch.ts` の正規表現・大文字小文字の設定を使う）。まとめない。

## 工程2: 仕組みの説明

### 言葉

- **選択範囲**: 本文エディタで選んでいる文字の範囲。開始と終了の位置（先頭から何文字目か）で表す。何も選んでいないときは、開始と終了が同じ（カーソルの位置）。
- **記法**: 本文に書く、ルビ・圏点・縦中横・太字・文章方向の書き方。例: `[東京(rb,とうきょう)]`、`[重要(em,goma)]`、`[12(tcy)]`、`**太字**`、行末の `[(al:center)]`。青空文庫風の `｜漢字《かんじ》`、`漢字《かんじ》`、`《《傍点》》` も読める。
- **純粋な処理**: 受け取った文字列から結果を計算して返すだけで、画面や保存に触らない処理。
- **AST**: 本文を行やブロックに分けて解析した結果（`DocumentAst`）。検索バーはこれを使って一致を探す。

### 1. データの形

保存するデータはない。どの関数も、本文の文字列と選択範囲を受け取り、「どこからどこまでを、何に書き換えるか」（`from`、`to`、`insert`、書き換えた後のカーソル位置 `cursorPos`）を返す。実際にエディタを書き換えるのは App の中の操作の関数（`editor.replaceRange(...)`）で、こちらは移さない。

### 2. 利用者の操作と内部の処理

| 操作 | App の操作の関数（残す） | 移す処理 |
|---|---|---|
| 右クリックでメニューを開く | `handleEditorContextMenu`（6129行） | `normalizeSelectionRange`（選択範囲を本文の長さに収め、開始と終了の順を整える） |
| メニューの「ルビ」「縦中横」「圏点」 | `applyInlineNotation`（6217行） | `normalizeSelectionRange`、`canWrapInlineSelection`（1行の中の範囲か）、`sanitizeNotationArgument`（ルビの読みから改行と `]` `)` を空白にする） |
| メニューの「文章方向」 | `applyDirectionNotation`（6253行） | `applyDirectionToSelection`（選択を含む各行の末尾に `[(al:…)]` を付ける。前の指示と行頭の `>>` は外す） |
| メニューの「記法をクリア」 | `clearSelectionNotation`（6274行） | `clearNotationFromSelection`（選択に触れている記法を外す。コード・コメントの行と、行内のコードの中は外さない） |
| Ctrl+B | `applyBoldShortcut`（6324行） | `toggleBoldSelection`（`**…**` で囲む／外す。何も選んでいなければ `****` を入れて真ん中にカーソル。複数行は対象外） |
| Ctrl+I | `applyEmphasisShortcut`（6338行） | `toggleEmphasisSelection`（`[…(em,goma)]` を付ける／外す。複数行は対象外） |
| Ctrl+数字 | `applyHeadingShortcut`（6352行） | `applyHeadingToSelection`（選択を含む各行の `#` を付け替える。0 なら外す） |
| コマンドパレットの同じ項目 | 上と同じ関数を、開いたときの選択で呼ぶ | 同じ |
| Ctrl+F で検索バーを開く／打つ | `editorFindMatches`（4504行の `useMemo`） | `collectEditorFindMatches`（AST のブロックごとに一致を探す。最大500件。コメントを含めない設定ならコメントのブロックを飛ばす） |
| 検索バーの「すべて置換」 | `replaceAllEditorFindMatches`（6443行） | `replaceLiteralMatches`（コメントを含めない設定なら、コメント行の間の区間ごとに置換する） |
| 検索サイドバーの「このファイルで置換」 | `handleReplaceInCurrentFile`（9905行） | `replaceMarkdownBodyMatches`（前付け（フロントマター）を除いた本文だけを置換する） |
| 検索サイドバーの「プロジェクト全体で置換」 | `handleReplaceInProject`（9931行） | `replaceMarkdownBodyMatches`（ファイルごと） |

通知の文言（「太字にする単一行の範囲を選択してください」「記法をクリアしました」「〜件を置換しました」など）は、すべて App の操作の関数の中にあり、移さない。

### 3. 保存

このまとまりは保存に触らない。書き換えた本文は、ふだんの編集と同じ経路（エディタの変更 → 遅延保存）で保存される。

### 4. ほかの機能との関係

- 本文エディタ（`editorInstanceRef.current`）: App の操作の関数が、ここで計算した結果でエディタを書き換える。
- AST（`src/editor/ast/documentAst.ts`）: 行の種類（コード・コメント）と行内の記法の解析を借りる。
- 検索（`src/search/textSearch.ts`）: サイドバーの置換で、一致の探し方を借りる。
- 前付け（`src/utils/frontmatter.ts`）: サイドバーの置換で、前付けと本文を分ける。

### 5. 今の挙動の癖（直さない。工程8・9で前と同じことを確かめる）

確かめた（2026-10-23、`557e42b` の App.tsx から移す範囲をそのまま切り出し、esbuild で束ねて動かした）。

1. 検索バーは、検索語の前後の空白を無視する（`" 東京"` で `東京` に一致する）。→ `fix/editor-text-quirks` で直した（`docs/EDITOR_TEXT_QUIRKS_FIX_PLAN.md`）。
2. 検索バーの一致は、行（AST のブロック）をまたがない。
3. 検索バーの一致の位置は、本文と検索語をそれぞれ小文字にしてから探し、元の検索語の長さで範囲を決める。小文字にすると長さが変わる文字（トルコ語の `İ` など）が前にあると、位置がずれる。`İab` の `a` を `X` に「すべて置換」すると、`İaX` になる（`b` が置き換わる）。日本語の本文では起きない。→ 直した（同上）。
4. 文章方向を付けると、行頭の `>>` とその後の空白が消える（`>> 見出し` → `見出し[(al:center)]`）。
5. 「記法をクリア」は、選択に触れていなくても、対象の行にある文章方向の指示 `[(al:…)]` をすべて外す。
6. Ctrl+I で外せるのは `(em…)` の圏点だけ。`《《傍点》》` の中の「傍点」を選んで Ctrl+I を押すと、外れずに `《《[傍点(em,goma)]》》` と二重になる（「記法をクリア」では外れる）。→ 直した（同上）。

## 工程3: 依存関係

### A. React に依存しない処理（移す）

| 関数 | 呼ばれる所（App の中） | 呼ぶもの |
|---|---|---|
| `normalizeSelectionRange` | 6144、6148、6224、6261、6280、6307、6328、6342、6356、6367、6402 | — |
| `sanitizeNotationArgument` | 6230 | — |
| `canWrapInlineSelection` | 6225、6620、6690、13704、13713、13726（JSX のメニューの有効・無効） | — |
| `applyDirectionToSelection` | 6262 | `applyDirectionToLine` → `stripDirectionMarkers` |
| `clearNotationFromSelection` | 6281 | `clearNotationInLine` → `rangesTouch`、`pushClearReplacement`、`parseInlines`、`classifyLines` |
| `toggleBoldSelection` | 6329 | — |
| `toggleEmphasisSelection` | 6343 | — |
| `applyHeadingToSelection` | 6357 | — |
| `replaceLiteralMatches` | 6449 | 自分自身、`findCommentLineRanges` |
| `replaceMarkdownBodyMatches` | 9911、9976 | `parseFrontMatter`、`replaceTextSearchMatches`、`findCommentLineRanges`、`updateMarkdownBody` |
| `collectEditorFindMatches` | 4505（`useMemo` の中） | — |

型: `EditorSelectionSnapshot` は App の中でも26か所（右クリックメニューの state の型 `EditorContextMenuState`、記法のダイアログの型 `NotationModalState`、操作の関数の引数）で使う。`LayoutDirection` は文章方向の選択肢（585行）とダイアログ（6678行）でも使う。`EditorFindMatch` は `selectEditorFindMatch`（6392行）でも使う。移した先から型を書き出し、App は `import type` で読む。

### B〜G

- **B. 値（state）**: なし。
- **C. 操作の関数**: 移さない（2章の表の「App の操作の関数」）。
- **D. useEffect**: なし。`collectEditorFindMatches` は `useMemo` の中で呼ばれるが、`useMemo` は App に残る。
- **E. 作品を開く経路**: 関係しない。
- **F. JSX**: `canWrapInlineSelection` を、右クリックメニューの項目を押せるかどうかに使う（13704〜13726行）。呼び方は変わらない。
- **G. App の外とのやり取り**: なし（Rust の命令・ウィンドウ間の知らせ・ドラッグを使わない）。

### H. App.tsx の文字列を読むテスト

このまとまりの名前・中身を読むテストはない。`[\s\S]*?` でまたいで読む正規表現が、移す範囲を通っていないかは、工程8の一式で確かめる。

### 結び目

1. 型 `EditorSelectionSnapshot`・`LayoutDirection`・`EditorFindMatch` を App も使う。移した先で書き出し、App が読む向きにする（逆にすると、新しいファイルが App を読むことになり、輪になる）。
2. `findCommentLineRanges` を2つの新しいファイルが使う。それぞれが `./ast/documentAst` から読む。
3. `parseFrontMatter`・`updateMarkdownBody` は App の中でもほかに使うので、App の import に残る。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

| 区分 | ファイル |
|---|---|
| 必ず変わる | `src/App.tsx`（約420行を消し、import を2行足して4つ減らす）、`src/editor/selectionEdits.ts`（新規）、`src/search/editorFindReplace.ts`（新規）、回帰テスト `scripts/test-editor-text-edits.mjs`（新規）と `package.json` |
| 条件しだいで変わる | App.tsx を読むテスト（工程8で落ちたときだけ、読むファイルを直す） |
| 変えない | Rust、保存形式、UI の部品、文言、`src/editor/ast/`、`src/search/textSearch.ts`、`src/utils/frontmatter.ts` |

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 選択範囲の書き換え | 低 | 純粋な処理で、保存・作品を開く経路に触らない。壊れると、記法やショートカットの結果が変わる |
| 本文の検索・置換 | 中 | 「プロジェクト全体で置換」は、開いていないファイルにも書く。中身を変えなければ結果は同じだが、壊れたときの被害が広い |
| 型の移動 | 低 | 型だけで、動きはない。型検査で全部わかる |
| import の付け替え | 低 | 型検査と build でわかる |

### 4-3. 起こりうる回帰不具合

| 機能 | 起こりうること | 既存テストで気づけるか |
|---|---|---|
| ルビ・縦中横・圏点・文章方向・記法のクリア | 書き換える範囲やカーソル位置が変わる | なし |
| Ctrl+B／Ctrl+I／Ctrl+数字 | 同上 | なし（パレットの呼び方だけ、`test:v060-editor-position` が文字列で確かめる） |
| 検索バー | 一致の件数・位置が変わる、コメントの扱いが変わる | なし |
| サイドバーの置換 | 前付けまで置換する、件数が変わる | なし（`test:search` は正規表現の部品を確かめるだけ） |
| 起動 | 移した先の読み込みの失敗で、画面が出ない | build と実機 |

「なし」が多いので、工程8で、移した処理を実際に動かす回帰テストを足す。

### 4-4. 今の自動テストの状態（「前」の一式の結果）

`557e42b` で `suite.mjs run before` を動かした（2026-10-23。cargo を使う `test:ai` と `test:sidebar-file-move` は Rust を変えないので外した）。build は成功、いちばん大きい JS は 683,432 バイト。67本中63本が成功し、4本が止まるか失敗した。

| テスト | 結果 | 理由 | 扱い |
|---|---|---|---|
| `test:ai-selection` | 10分で打ち切り | 一式の中でだけ止まる。単独で動かすと成功した | 元からの止まり。「後」でも止まったら単独で確かめる |
| `test:canvas-save` | 失敗 | `./utils/fontStack` を読み込めない（テストの読み込み方の問題） | 元からの失敗 |
| `test:v058-bundle` | 失敗 | いちばん大きい JS が 500 kB の上限を超えている | 元からの失敗 |
| `test:v0511-themes` | 失敗 | 「Shuboku plot surfaces must be borderless」 | 元からの失敗 |

残ったプロセスは、一式の後も単独のテストの後も0。

## 工程5: 案

### 5-1. 方針

Idea の分離（5章）と同じ線引きにする。

1. 移すのは引っ越しだけ。中身・文言・条件・順番は1文字も変えない。違うのは、先頭に `export` を付けることだけ。
2. 新しいファイルに React の仕組みを持ち込まない（もともと使っていない）。
3. App の操作の関数・`useMemo`・JSX は残す。呼ぶ名前は今と同じ。

### 5-2. 移すもの

| 移す先 | 中身 |
|---|---|
| `src/editor/selectionEdits.ts` | 型 `LayoutDirection`、`EditorSelectionSnapshot`、`SelectionEdit`、1867〜2167行の13の関数。App が使う8つ（`normalizeSelectionRange`、`sanitizeNotationArgument`、`canWrapInlineSelection`、`applyDirectionToSelection`、`clearNotationFromSelection`、`toggleBoldSelection`、`toggleEmphasisSelection`、`applyHeadingToSelection`）と3つの型を書き出す |
| `src/search/editorFindReplace.ts` | 型 `EditorFindMatch`、2169〜2276行の3つの関数。全部書き出す |
| `src/components/layout/AppIcon.tsx`（工程6で足した） | 型 `AppIconName` と部品 `AppIcon`（594〜816行、223行）。ほかの名前を何も使わない、アイコンの絵を返すだけの部品。App の JSX の32か所は、そのまま `<AppIcon name=… />` で呼ぶ |

置き場所は、本文の文字列を扱う既存の部品（`src/editor/lineComments.ts`、`src/editor/markdownTables.ts`）と、検索の部品（`src/search/textSearch.ts`）に並べた。

### 5-3. 残すもの

- 2章の表の、App の操作の関数すべて（エディタを書き換える・通知を出す・ダイアログを閉じる処理）。
- `customNotationSpecs`、`directionOptions`、`NotationModalState`、`EditorContextMenuState`、`EditorFindState`（画面の表示や state の型）。

### 決めてほしいこと

1. **範囲**: 選択範囲の書き換えと検索・置換の2つ（約420行）を移すか、ほかの候補も今回に入れるか。
   - 案A（勧め）: この2つだけ。テストが文字列を読まず、保存に触らないので、ほぼ型検査と回帰テストだけで確かめきれる。
   - 案B: 案Aに、アイコンの部品 `AppIcon`（594〜816行、約220行）を `src/components/` へ移す作業を足す。こちらも文字列を読むテストはなく危険は低いが、画面の部品なので実機で見るアイコンが32か所に増える。別のコミットにする。
2. **工程9（実機確認）の深さ**: 
   - 案A（勧め）: QA 用アプリで、2章の表の操作を1回ずつ（右クリックの各記法、Ctrl+B/I/数字、検索バーの検索と置換、サイドバーの置換）と、5章の癖のうち画面で見えるもの（1・4・5・6）を確かめる。
   - 案B: 実機確認は省き、回帰テストだけにする。純粋な処理の引っ越しで、App 側は呼ぶ名前が同じなので、型検査と回帰テストでほぼ確かめられる。ただし、移した先の読み込みの失敗は build でしかわからない。

### テストの直し方と足すテスト

- 既存のテストは、読むファイルを直す必要がない見込み（名前も中身も読んでいないため）。工程8で落ちたら、正規表現は変えずに読むファイルだけ直す。
- 足す: `scripts/test-editor-text-edits.mjs`（`npm run test:editor-text-edits`）。esbuild で2つの新しいファイルを束ねて読み込み、2章の各操作の結果（`from`・`to`・`insert`・`cursorPos`）を、具体的な本文で確かめる。コード・コメントの行、行内のコード、前付け、500件の打ち切り、5章の癖 1・2・4・5・6 を含める。テストの期待値は、移す前の App.tsx の関数でも同じ結果になることを確かめてから決める（移す前のコードを切り出して同じテストを通す）。
- 効くことの確かめ: 移した先にわざと不具合を2つ入れ（例: `rangesTouch` の `<=` を `<` に、`collectEditorFindMatches` の `maxResults` の比べ方を変える）、テストが落ちるのを見てから戻す。

### 進め方とコミットの分け方

1. `selectionEdits.ts` へ移す（`move-lines.mjs`、`verify-move.mjs`、型検査）→ コミット
2. `editorFindReplace.ts` へ移す → コミット
3. 回帰テストを足す → コミット
4. （案Bなら）`AppIcon` を移す → コミット

### 見込みと、今回やらないこと

- App.tsx は約14,347行 → 約13,930行。
- 5章の癖は直さない。
- 2系統の検索をまとめる、操作の関数（`applyBoldShortcut` など、選択の読み取りとエディタの書き換えがほぼ同じ形で並ぶ）をまとめる、といった共通化はしない。
- 次の候補（今回は手を付けない）: 資料（Reference）の正規化と並べ方（1555〜1866行。`normalizeReferenceLayout` は読み込みの経路なので重さ「高」）、チェックポイントの正規化（1341〜1528行。`test:checkpoint` が関数名を目印に読む）、作品ごとの保存の読み書き（2618〜2933行。`test:project-portability` が関数名を目印に読む）、記法のダイアログと右クリックメニューの操作の関数（`createEditorNotationActions` の形）。

## 工程6: 人の確認

2026-10-23 に決まったこと。

1. 範囲: 案B。選択範囲の書き換えと検索・置換の2つに、`AppIcon` の移動を足す。`AppIcon` は別のコミットにする。
2. 実機確認: 案A。2章の表の操作を1回ずつと、5章の癖のうち画面で見えるもの（1・4・5・6）。`AppIcon` を足したので、アイコンが前と同じに出ることも見る（メニュー・ツールバー・左右の切り替え）。

## 工程7: 実施

| コミット | 中身 | App.tsx |
|---|---|---|
| `4c7597d` | 型 `LayoutDirection`・`EditorSelectionSnapshot` と選択範囲の書き換え（13の関数と `SelectionEdit`）を `src/editor/selectionEdits.ts`（311行）へ | 14,347 → 14,049行 |
| `3817c32` | 型 `EditorFindMatch` と検索・置換の3つの関数を `src/search/editorFindReplace.ts`（122行）へ | → 13,931行 |
| `723aeb8` | 型 `AppIconName` と `AppIcon` を `src/components/layout/AppIcon.tsx`（223行）へ | → 13,708行 |
| `21b63aa` | 回帰テスト `scripts/test-editor-text-edits.mjs` と `package.json` の `test:editor-text-edits` | — |

元と同じであることの確かめ方: 3回とも `move-lines.mjs`（行番号と先頭・末尾の行を確かめて移す）で移し、`verify-move.mjs` で突き合わせた。3回とも lost は0で、App.tsx に足した行は import だけ。移した先で変えたのは、行の先頭に `export` を付けたことだけ。

違う点:

- App.tsx の import から、使わなくなった `classifyLines`・`parseInlines`・`findCommentLineRanges`（`./editor/ast/documentAst`）と `replaceTextSearchMatches`（`./search/textSearch`）を外した。`./search/textSearch` の import は `import type { TextSearchOptions }` の1行になった。
- 移した先のファイルは、それぞれ必要な import を先頭に持つ。

各コミットのたびに、`npx tsc --noEmit` と、App.tsx の文字列を読むテスト17本（`test:v058-bundle` を除く。build が要るため）を動かし、すべて通った。

## 工程8: 自動テスト

### 足した回帰テスト

`npm run test:editor-text-edits`。esbuild で3つの新しいファイルを束ね、2章の表の操作ごとに、具体的な本文で結果（`from`・`to`・`insert`・`cursorPos`、置換後の本文と件数、一致の位置と行・列）を確かめる。コード・コメントの行、行内のコード、前付け、正規表現の誤り、500件の打ち切り、2章5の癖 1〜6 を含む。アイコンは、型に並べた名前のすべてで `<svg>` が描かれ、どれも違う絵であること、知らない名前では何も描かないことを確かめる（`react-dom/server` で描いて比べる）。

期待値が移す前の挙動と同じこと: チェックポイント `557e42b` の App.tsx から移す範囲をそのまま切り出し、同じテストをそれに向けて動かして、すべて通った。アイコンは、24の名前のすべてで、移す前と後の `AppIcon` が描く SVG が1文字も違わなかった。

効くことの確かめ（わざと不具合を入れて、戻した）:

| 入れた不具合 | 結果 |
|---|---|
| `rangesTouch` で、カーソルが記法の終わりに接しているときを外す（`<=` → `<`） | 落ちた |
| `collectEditorFindMatches` の打ち切りを1件遅らせる（`>=` → `>`） | 落ちた |
| `AppIcon` の `write` の絵の線を1本変える | 落ちない。このテストは絵の中身までは固定しない。今回の引っ越しで絵が変わっていないことは、上の前後の突き合わせで確かめた |
| `AppIcon` の `write` を描かないようにする（`case "write"` の名前を変える） | 落ちた |

### 前後の比較

「後」は `21b63aa` で動かした。build は成功、いちばん大きい JS は 683,432 → 683,438 バイト（+6）。

| 区分 | 本数 | テスト |
|---|---|---|
| 前後とも成功 | 63 | 「前」で成功した63本すべて |
| 前後とも失敗 | 4 | `test:ai-selection`（一式の中でだけ止まる）、`test:canvas-save`、`test:v058-bundle`、`test:v0511-themes`。理由は前後で同じ（工程4の 4-4） |
| 後だけ | 1 | `test:editor-text-edits`（成功） |
| 新しい失敗 | 0 | — |

`test:ai-selection` は「後」でも一式の中で10分の打ち切りになったので、単独で2回動かし、2回とも成功した。残ったプロセスは、一式の後も単独のテストの後も0。

## 工程9: 実機確認

### やり方

`21b63aa` を識別子 `local.then.qa.textedits1023` で build した QA 用アプリを、scratchpad の一時ライブラリ（作品A に `本文.txt` と、前付けのある `別.txt`）で動かした（2026-10-23）。本文エディタの選択は、画面の中で DOM の選択範囲を作って行い、右クリックは `contextmenu` の知らせを送った。キーは CDP で送った。保存は、操作のあと2秒待って `本文.txt` を読み、画面の行と突き合わせた。

### 確認した項目と結果

| 確認したこと | 結果 |
|---|---|
| 右クリック →「ルビ...」 | 「ルビにする言葉」を選んで読み「るび」を入れ「反映」→ `[ルビにする言葉(rb,るび)]`、通知「ルビを反映しました」 |
| 右クリック →「縦中横」 | 「十二」→ `[十二(tcy)]`、通知「縦中横を反映しました」 |
| 右クリック →「圏点」 | 「圏点の語」→ `[圏点の語(em,goma)]`、通知「圏点を反映しました」 |
| 右クリック →「文章方向...」→「中央」 | `>> 寄せる行` の中にカーソル → `寄せる行[(al:center)]`、通知「文章方向を反映しました」 |
| 右クリック →「記法をクリア」 | 上の行の先頭にカーソル → `寄せる行`、通知「記法をクリアしました」。記法のない行では、本文は変わらず「クリアできる記法がありません」。`《《[傍点(em,goma)]》》と**太字**と[東京(rb,とうきょう)]` の全体を選ぶと `《《傍点》》と太字と東京`（移した関数に同じ行を渡した結果と同じ） |
| Ctrl+I | 次の癖6 |
| Ctrl+B | `**太字**` の中の「太字」を選んで押す → `太字`、もう一度選んで押す → `**太字**` |
| Ctrl+1／Ctrl+0／Ctrl+2 | `## 第一章` → `# 第一章`「見出し1を設定しました」→ `第一章`「見出しを解除しました」→ `## 第一章`「見出し2を設定しました」 |
| コマンドパレット →「太字」 | 「神戸」を選んで Ctrl+P、「太字」を押す → `**神戸**`（開いたときの選択に付いた） |
| 検索バー（Ctrl+F） | `東京` で「1/3」（コメント行を除く）。「次の一致」で「2/3」になり、2件目の「東京」が選ばれた。「コメントを含む」を押すと「2/4」、戻すと「2/3」 |
| 検索バーの「すべて」 | `東京` → `大阪`。通知「3件を置換しました」、コメント行 `// 東京のメモ` は残った |
| 検索バーの「置換」 | `大阪` → `神戸`。「1/3」→「1/2」、最初の1件だけが変わった |
| 検索サイドバー（範囲「文書」） | `大阪` → `京都`。ボタン「2件を置換」、通知「2件をファイル内で置換しました」 |
| 検索サイドバー（範囲「作品」） | `東京` → `名古屋`。ボタン「1ファイル・1件を置換」→ 確認「1ファイルの1件を置換します。」→「置換」、通知「1件をプロジェクト全体で置換しました」。`別.txt` は前付けの `title: 東京の話` が残り、本文だけ `名古屋で会う。`。`本文.txt` のコメント行の「東京」も残った |
| アイコン | 本文の画面で、`AppIcon` と同じ形の SVG が25個（モードメニューを開くと29個）。中身が空のものも、大きさ0のものもない。ファイルメニュー、作品の切り替え、保存点、縦書き・横書き、テーマ、設定、画面モード（本文・キャンバス・エクスポート・チェックポイント）、ファイルツリー、検索、左右のサイドバーなど |
| 保存 | 記法とショートカットの後、置換の後、最後、の3回、`本文.txt` の中身と画面の行が一致した |

### 今の挙動の癖を実機で確かめた結果

| 癖 | 結果 |
|---|---|
| 1. 検索語の前後の空白を無視する | ` 東京` でも「1/3」（`東京` と同じ） |
| 4. 文章方向で行頭の `>>` が消える | `>> 寄せる行` → `寄せる行[(al:center)]` |
| 5. クリアで、触れていない文章方向の指示も外れる | 行の先頭（指示から離れた位置）にカーソルを置いてクリア → 指示が外れた |
| 6. `《《傍点》》` に Ctrl+I を押すと二重になる | `《《[傍点(em,goma)]》》と…` になった |

癖2（行をまたがない）と3（`İ` の位置のずれ）は、画面で見せにくいので、工程8の回帰テストで確かめた。

### 確かめられなかったこと

- 再起動後の復元: このまとまりは値を持たず保存の経路に触らないので、行っていない。
- 画面の写真: QA の道具（`q.mjs cdp`）が画像を返さないため、撮っていない。確かめは DOM の値で行った。
- ルビのダイアログの Enter キーでの反映: CDP で送った Enter では、フォームが送信されなかった（ブラウザ標準の送信は、合成のキーでは起きない）。「反映」ボタンで確かめた。
- 途中の操作の誤り: 最初のルビの確かめで、読みの欄にフォーカスする前に「るび」と Enter を送り、本文の先頭に入った。Ctrl+Z で元に戻し、元の本文に戻ったことを確かめてからやり直した。

### 片付け

`q.mjs stop` と `qa-cleanup.mjs` で、QA の Then・WebView2・テストの Edge と node はすべて0、`%APPDATA%local.then.qa.textedits1023`・`%LOCALAPPDATA%local.then.qa.textedits1023`・一時ライブラリを消した。`src-tauri/target/release/Then.exe` は QA 用の build で上書きされている。`git status` に意図しない変更はない。

## 工程10: 完了

選択範囲の書き換えと検索・置換、AppIcon の分離を完了とする。ブランチ `refactor/editor-text-edits` は、`fix/editor-text-quirks` と一緒に PR #11 で main へ取り込んだ。

### 変わったもの

| ファイル | 変更 |
|---|---|
| `src/editor/selectionEdits.ts`（新規、311行） | 記法・太字・圏点・見出し・文章方向の、選択範囲の書き換え |
| `src/search/editorFindReplace.ts`（新規、122行） | 検索バーの一致と置換、検索サイドバーの置換 |
| `src/components/layout/AppIcon.tsx`（新規、223行） | アイコンの部品 |
| `src/App.tsx` | 14,347行 → 13,708行。上の3つを import する形にした。操作の関数・通知・JSX は変えていない |
| `scripts/test-editor-text-edits.mjs`（新規）と `package.json` | 回帰テスト（`npm run test:editor-text-edits`） |
| `docs/EDITOR_TEXT_EDITS_SEPARATION_PLAN.md` | この手順書 |

保存形式、UI、文言、Rust は変えていない。既存のテストの読むファイルも、直す必要がなかった。

### 確かめたこと

- 自動テスト: 「前」で成功した63本は「後」もすべて成功。元から失敗の4本は同じ理由で失敗。足したテストは成功し、期待値は移す前のコードでも同じになる（工程8）。
- 実機: 2章の表の操作をすべてと、癖1・4・5・6が、移す前の関数の結果どおり（工程9）。

### 残っていること（別の作業）

| 件 | 中身 |
|---|---|
| 次の分離の候補 | 記法のダイアログと右クリックメニューの操作の関数（`applyInlineNotation` 〜 `applyHeadingShortcut`。`createEditorNotationActions` の形）、資料（Reference）の正規化（読み込みの経路なので重さ「高」）、チェックポイントの正規化と作品ごとの保存の読み書き（テストが関数名を目印に読む） |
| 今の挙動の癖 | 2章5の1〜6。特に3（`İ` などで置換の位置がずれる）と6（`《《傍点》》` に Ctrl+I で二重になる）は、直すなら不具合の修正として別に扱う |
| 元から失敗しているテスト | `test:canvas-save`、`test:v058-bundle`、`test:v0511-themes`。`test:ai-selection` は一式の中でだけ止まる |
