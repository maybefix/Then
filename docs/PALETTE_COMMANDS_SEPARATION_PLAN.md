# コマンドパレットの一覧の分離の手順書

App.tsx の部品の中にある、コマンドパレット（Ctrl+P で開く、操作を名前で探して実行する画面）に並べる操作の一覧を作る関数 `buildPaletteCommands`（約190行）を、`src/paletteCommands.ts` の `createPaletteCommands(deps)` へ移す。前の手順書（`docs/PROJECT_ENTRY_ACTIONS_SEPARATION_PLAN.md`）が数えた「次の候補」のうちの1つ。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/palette-commands`
- 戻し先: タグ `checkpoint/before-palette-commands`（コミット `3a86f91`。中身は `fix/project-entry-retarget` の `0a92952` と同じ）
- 元のブランチについて: main（`0edd22e`）には、PR #16 の修正（19件）がまだ入っていない。#16 の宛先が `refactor/project-entry-actions` で、そのブランチが先に main へ入ったため。2026-10-24 に、同じ中身を main へ向けた maybefix/Then#17 を作った。#17 が main に入った後の main は `0a92952` と中身が同じになるので、このブランチは `0a92952` から始め、#17 が入ったら main の上に付け替える。
- 行番号は、断りがなければ `3a86f91` の時点のもの。App.tsx は 12,571行。

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
| 一覧を作る関数 | 5691〜5883 | 193 | `buildPaletteCommands`。呼ぶのは JSX の1か所（12512行、`commands={buildPaletteCommands()}`）だけ |
| パレットを開く・閉じる（残す） | 5396〜5414、5618〜5627 | 約30 | `getCurrentEditorSelection`、`closeCommandPalette`、`restoreFocusAfterCommandPalette`、Ctrl+P の受け取り |
| パレットの画面（変えない） | `src/components/dialogs/CommandPalette.tsx` | — | 受け取った一覧を絞り込んで表示し、選んだものの `run` を呼ぶ |

### 気づいた点

1. **ふつうの関数で、`useCallback` で包まれていない。** 描画のたびに今の値で作り直される関数なので、前回までと同じ形で写せる。
2. **一覧が使う値の多くは、関数より後ろで宣言されている。** 入力のダイアログ（`requestMultiInput`、5914行）、保存点を作る（`handleQuickCreateManuscriptSnapshot`、6520行）など。元の関数は、呼ばれたとき（JSX の描画のとき）に読むので問題がない。移した先へ値を渡す所も、同じく「呼ばれたときに渡す」形にしないと、作られる前に読む誤り（TDZ）になる（工程5の5-1）。
3. **App.tsx の文字列を読むテストは2本。**
   - `test:v060-editor-position`: 7つの正規表現（`applyBoldShortcut(selection ?? undefined)` など）で、パレットの操作が「開いたときの選択範囲」を使うことを確かめる。7つとも、App.tsx の中ではこの関数の中にしかない（5703、5785、5792、5833、5841、5855、5860行）。
   - `test:v061-plugins`: `id: "plugin-manage"` から `setIsPluginManagerOpen(true)` までがあること（187行）と、`plugin-uninstall:` がないこと（188行）。
   - 同じテストの、ほかの行（パレットを開くときに選択範囲を覚えること、など）は App に残る所を読むので、変えずに通る。
4. **使われていない処理はない。** 一覧の項目はすべて、パレットに出る。
5. **パレットの画面を動かすテストは1本**（`test:command-palette`）。`CommandPalette.tsx` だけを束ね、一覧は手で作ったものを渡す。今回の移動には関わらない。

## 工程2: 仕組みの説明

### 言葉

| 言葉 | 意味 |
|---|---|
| コマンドパレット | Ctrl+P で開く小さな画面。文字を打つと操作の名前で絞り込み、Enter で実行する |
| コマンド（`PaletteCommand`） | 一覧の1行。名前（`label`）、右側の補助の文字（`hint`）、使えない理由（`disabledReason`）、実行する処理（`run`）を持つ |
| 開いたときの選択範囲 | パレットを開くと、本文から入力の欄へカーソルが移る。その前に本文の選択範囲を覚えておき（`commandPaletteSelectionRef`）、記法などの操作はその範囲に効かせる |

### 1. データの形

一覧は保存しない。パレットが開いているあいだ、App が描画されるたびに作り直して `CommandPalette` に渡す。中身は次の順で並ぶ（並び順はパレットの表示順になる）。

1. 表を挿入…（行数・列数をダイアログで聞いて、カーソルの位置に表を入れる）
2. 表：この列を開始揃え／中央揃え／終了揃え（カーソルが表の中にあるときだけ使える）
3. 行をコメントにする／戻す
4. コメントを表示する／非表示にする（今の設定で文言が変わる）
5. 太字、圏点（傍点）
6. 今の状態を保存点にする、チェックポイントを開く（作品を開いているときだけ使える）
7. Idea にメモを追加…、Idea Board を開く、Project Canvas を開く
8. ルビ…、縦中横
9. 見出し1〜6、見出しを解除
10. 文章方向…、記法をクリア
11. 原稿を整える…
12. 別のプロジェクトを開く...、最近のプロジェクトを1つずつ（「プロジェクトを開く: 名前」）
13. プラグインを管理…、プラグインが登録したコマンド

### 2. 利用者の操作と内部の処理

| 操作 | 内部で起きること |
|---|---|
| Ctrl+P | 本文の選択範囲を覚え（`commandPaletteSelectionRef.current = getCurrentEditorSelection()`）、パレットを開く（App に残る） |
| パレットが開いている | App が描画されるたびに `buildPaletteCommands()` を呼び、その時点の値で一覧を作り直す。覚えた選択範囲がなければ、今の選択範囲を使う |
| 項目を選ぶ | `CommandPalette` が `run` を呼び、パレットを閉じる。`run` の中身は、ほとんどが App のほかの処理（記法の操作、保存点、Idea、作品を開く、プラグイン）を呼ぶだけ |
| 「表を挿入…」 | 本文を覚えておき、ダイアログで行数と列数を聞く。答えるあいだに本文が変わったら「本文が変わったため、挿入位置を選び直してください」と出して入れない。変わっていなければ、前後に空行を足して表を入れ、最初の見出しのセルを選ぶ |
| 「表：この列を〜」 | カーソルのある列の揃えを書き換える |
| Esc・外を押す | パレットを閉じ、覚えた選択範囲を捨てる（App に残る） |

### 3. 保存

一覧そのものは保存しない。項目を選んで呼ばれる処理（保存点を作る、本文を書き換える、など）は、それぞれの機能の保存の流れに乗る。移すのは一覧を作る関数だけなので、保存の流れは変わらない。

### 4. ほかの機能との関係

- 記法の操作（`createEditorNotationActions` が返す7つ）、原稿を整える、表の処理（`src/editor/markdownTables.ts`）
- チェックポイント（保存点を作る、画面を開く）
- Idea（クイックメモ、Canvas を開く）
- 作品を開く（`openWorkspace`）と、最近のプロジェクトの一覧（`appState.recentWorkspaces`）、作品のパスを表示する設定（`settings.showWorkspacePaths`）
- プラグイン（読み込んだプラグインの数、登録されたコマンド、実行の窓口 `pluginRuntimeHostRef`）

### 5. 今の挙動の癖（直さない。工程9で実機で確かめる）

コードを読んで気づいたもの（見込み）。

1. **「Idea Board を開く」と「Project Canvas を開く」は、同じ処理を呼ぶ。** どちらも `openIdeaCanvasBoard("project")`。名前とショートカットの表示（Ctrl+Alt+B／Canvas）だけが違う。
2. **本文を開いていないときの扱いが項目ごとに違う。** 「表を挿入…」「行をコメントにする」は「本文を開いてください」、「原稿を整える…」は「エディタを開いてください」と出して使えなくする。太字・見出しなどは使える表示のままで、選んでも何も起きない。
3. **補助の文字に英語が混ざる。** 「Workspace」「Checkpoint」「Canvas」「N installed」。
4. **今開いている作品も「プロジェクトを開く: 名前」に出る**（最近のプロジェクトの一覧に今の作品が入っているなら）。

## 工程3: 依存関係

### A. React に依存しない処理（部品の外）

| 名前 | 置き場所 | 移した先での扱い |
|---|---|---|
| `tableAtOffset`、`tableAlignmentEdit`、`createMarkdownTable` | `src/editor/markdownTables.ts` | 移した先で import する。App では、ほかに使う所がなければ import を外す |
| `canWrapInlineSelection` | `src/editor/selectionEdits.ts` | 同上 |
| `customNotationSpecs` | `src/editor/editorNotationActions.ts` | 同上 |
| 型 `PaletteCommand` | `src/components/dialogs/CommandPalette.tsx` | 移した先で import する。App は、残す関数の戻り値の型に使う |

### B. 値（state と ref）。すべて App に残す

移す関数が読むだけで、書く値はない。`setIsQuickIdeaModalOpen` と `setIsPluginManagerOpen` は、項目を選んだときに呼ぶ。

| 値 | 読み方 |
|---|---|
| `commandPaletteSelectionRef`、`editorInstanceRef`、`pluginRuntimeHostRef` | ref。`.current` を、一覧を作るときと項目を選んだときに読む |
| `appState`（`recentWorkspaces`）、`settings`（`showWorkspacePaths`、`showComments`）、`projectFolder`、`loadedPlugins`、`pluginCommands` | 一覧を作るときに読む |

### C. 操作の関数（移すのは C-1 だけ）

- **C-1 一覧を作る**: `buildPaletteCommands`。中の `run` が呼ぶ App の関数は、`getCurrentEditorSelection`、`applyHeadingShortcut`、`applyLineCommentToggle`、`applyBoldShortcut`、`applyEmphasisShortcut`、`openRubyNotationModal`、`applyInlineNotation`、`openDirectionNotationModal`、`clearSelectionNotation`、`openManuscriptTidy`、`toggleShowComments`、`requestMultiInput`、`showToast`、`handleQuickCreateManuscriptSnapshot`、`openCheckpointStudio`、`openIdeaCanvasBoard`、`openWorkspace`。
- 残すもの: パレットを開く・閉じる・フォーカスを戻す処理（工程1の表）。

### D. 自動で走る処理（useEffect）

一覧に関わる useEffect はない。Ctrl+P の受け取りは、キー入力の受け取り（`editorShortcutHandlerRef`）の中にあり、App に残る。

### E. 作品を開く経路

関わらない。一覧は、作品が替わった後の描画で、その時点の `appState`・`projectFolder` から作り直される。

### F. 画面部品への受け渡し（JSX）

`<CommandPalette commands={buildPaletteCommands()} onClose={closeCommandPalette} restoreFocus={restoreFocusAfterCommandPalette} />`。変えない。

### G. App の外とのやり取り

一覧を作る関数は、Rust の命令もウィンドウ間の知らせも直接は使わない（呼ぶ先の処理が使う）。

### H. App.tsx の文字列を読むテスト

| テスト | 確かめている文字列 | 移した後 |
|---|---|---|
| `test:v060-editor-position`（12〜25行） | 7つの操作が `selection` を渡していること | 読むファイルを移した先に変える |
| `test:v060-editor-position`（6行・27行） | パレットを開くときに選択範囲を覚えること、ほか | App に残るので変えない |
| `test:v061-plugins`（187・188行） | `id: "plugin-manage"` から `setIsPluginManagerOpen(true)` まで、`plugin-uninstall:` がないこと | 読むファイルを移した先に変える |

### 結び目

1. 渡す値の多く（入力のダイアログ、保存点を作る、など）が、関数より後ろで宣言されている（工程1の2）。
2. 渡す値が27個と多い。ただし、移すコードを1文字も変えずに済むよう、`appState`・`settings` は丸ごと、ref は ref のまま渡す。
3. 文字列を読むテストが2本（工程3の H）。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`（関数の中身が抜け、移した先を呼ぶ数行になる。使わなくなった import を外す）、`src/paletteCommands.ts`（新規）、`scripts/test-v060-editor-position-memory.mjs`・`scripts/test-v061-plugin-platform.mjs`（読むファイル）、`scripts/test-palette-commands.mjs`（新規の回帰テスト）、`package.json`（テストの登録）
- 変えない: `CommandPalette.tsx`、呼ぶ先の機能のファイル、Rust、CSS

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 値を渡す時点 | 中 | 渡すのが早すぎると、作られる前に読む誤りで、パレットを開いた瞬間にアプリが止まる。古い値を渡すと、最近のプロジェクトやプラグインの一覧が古くなる |
| 「表を挿入…」の本文の確かめ | 中 | `editorInstanceRef.current !== editor` の比べ方を変えると、別のファイルに表を入れうる。移すだけなので変わらない |
| 項目の並び・文言 | 低 | 1文字も変えない |
| データの保存 | なし | 一覧は保存しない |

### 4-3. 機能ごとに起こりうる回帰不具合

| 起こりうること | 今のテストで気づけるか |
|---|---|
| パレットを開くとアプリが止まる（TDZ） | なし（`tsc` も気づかない） |
| 記法の操作が開いたときの選択範囲を使わない | 文字列だけ（`test:v060-editor-position`） |
| 表を挿入・列の揃えが動かない | なし |
| プラグインのコマンドが出ない・実行されない | 文字列だけ（`plugin-manage` の1件） |
| 使えない理由の出し分けが変わる | なし |

### 4-4. 今の自動テストの状態

（「前」の一式の結果を、終わってから書く）

## 工程5: 案

### 5-1. 方針

前回までと同じ線引き。値・useEffect・パレットを開く閉じる処理は App に残し、一覧を作る関数の中身だけを `src/paletteCommands.ts` へ引っ越す。中身・文言・条件・順番は変えない。新しいファイルに useState・useEffect・useCallback を持ち込まない。

前回までと違うのは、App に残す呼び出しの形。前回までは、元の場所で `create<Feature>Actions({ ... })` を1回呼んで関数を取り出した。今回は渡す値の多くが後ろで宣言されているので、元の場所に `buildPaletteCommands` という名前の小さな関数を残し、その中で `createPaletteCommands({ ... })` を呼ぶ。

```ts
  const buildPaletteCommands = (): PaletteCommand[] =>
    createPaletteCommands({
      commandPaletteSelectionRef,
      getCurrentEditorSelection,
      editorInstanceRef,
      // …（27個）
    });
```

こうすると、値を読むのは今と同じく「JSX が `buildPaletteCommands()` を呼んだとき」になる。JSX は変えない。

- 呼び出しを関数の外（後ろのほう）に置いて関数を取り出す形も取れるが、置き場所を「全部の値が宣言された後」に選ぶ必要があり、後で値の宣言が動くと壊れる。勧めは上の形。

### 5-2. 移すもの／残すもの

- 移すもの: `buildPaletteCommands` の中身（5692〜5882行、191行）。移した先では、関数の頭で `deps` から名前を取り出すので、中身は1文字も変えずに、字下げだけが2つ浅くなる。
- 残すもの: パレットを開く・閉じる・フォーカスを戻す処理、`getCurrentEditorSelection`（Ctrl+P でも使う）、`requestMultiInput`（ほかの機能でも使う）。
- UI 側へ移すもの: なし。

### 決めてほしいこと

1. **App に残す呼び出しの形**
   - (a) 元の場所に小さな `buildPaletteCommands` を残し、その中で `createPaletteCommands({ ... })` を呼ぶ（5-1）。
   - (b) 全部の値が宣言された後に `const buildPaletteCommands = ...` を置き直す。
   - 勧め: (a)。値を読む時点が今と同じで、宣言の順番に頼らない。
2. **工程2の5の癖（同じ処理の項目が2つ、本文がないときの扱いの違い、補助の文字の英語、今の作品が「開く」に出る）**
   - (a) 今回は触らない。手順書に残し、実機で確かめる。
   - (b) この分離の後に、続けて直す（別のブランチ）。
   - 勧め: (a)。どれも見た目や文言の判断で、分離と混ぜると前後の比較ができなくなる。

### テストの直し方と足すテスト

- `test:v060-editor-position`: 7つの正規表現は変えず、読むファイルを `src/paletteCommands.ts` に変える（その部分だけ）。
- `test:v061-plugins`: 187・188行の正規表現は変えず、読むファイルを `src/paletteCommands.ts` に変える。
- 足す回帰テスト `test:palette-commands`: `src/paletteCommands.ts` を esbuild で束ねて読み込み、App の値の代わりに入れ物を渡して、実際に一覧を作り、`run` を呼ぶ。
  - 並び順と文言（id・label・hint の一覧を、今の App の一覧と突き合わせる）
  - 本文がないとき・表の外・表の中・単一行の選択・複数行の選択で、`disabledReason` が今と同じに出し分けられること
  - 記法の7つの操作が、開いたときの選択範囲を受け取ること（覚えた範囲がないときは、今の選択範囲）
  - 「表を挿入…」: ダイアログの答えで表が入ること、答えるあいだに本文が変わったら入れずに通知すること、断ったら何もしないこと
  - 「表：この列を〜」: 揃えが書き換わり、通知が出ること
  - 最近のプロジェクトの項目と、作品のパスの表示の切り替え
  - プラグインの項目の数・名前、実行で `executeCommand` に渡す値
  - 保存点・チェックポイント・Idea・コメントの表示の項目が、それぞれの処理を呼ぶこと
- 効くことの確かめ: 移した先にわざと不具合を2つ入れ（たとえば表の挿入の本文の確かめを外す、覚えた選択範囲を使わない）、落ちることを見て戻す。

### 進め方とコミットの分け方

1. `docs: コマンドパレットの一覧の分離の手順書（調査と案）`
2. `refactor: コマンドパレットの一覧を paletteCommands.ts へ移す`（テストの読むファイルの変更も一緒に）
3. `test: コマンドパレットの一覧を実際に作って確かめる回帰テストを足す`
4. `docs: 実施・自動テスト・実機確認の結果`

### 見込みと、今回やらないこと

- App.tsx は約190行減って、約12,380行になる見込み。
- やらないこと: 工程2の5の癖を直すこと、パレットを開く閉じる処理を移すこと、ほかの候補（チェックポイント、見出しの移動・切り出し、プラグインの要求）。

## 工程6: 人の確認

## 工程7: 実施

## 工程8: 自動テスト

## 工程9: 実機確認

## 工程10: 完了
