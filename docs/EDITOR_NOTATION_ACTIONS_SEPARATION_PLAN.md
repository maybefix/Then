# 記法の操作の関数 分離の手順書

App.tsx の部品の中にある、記法を本文に入れる操作の関数（右クリックメニューの「ルビ」「縦中横」「圏点」「記法をクリア」「文章方向」、ルビと行指示のダイアログ、Ctrl+B・Ctrl+I・Ctrl+数字・Ctrl+/）を、`src/editor/editorNotationActions.ts` の `createEditorNotationActions(deps)` へ移す。前の分離（`docs/EDITOR_TEXT_EDITS_SEPARATION_PLAN.md`）で文字列を書き換える純粋な処理を `src/editor/selectionEdits.ts` へ移したので、その処理を呼んでエディタを書き換える側を、続けて切り離す。両方の手順書が次の候補として挙げていた。仕様・保存形式・UI・文言・Rust は変えない。

- ブランチ: `refactor/editor-notation-actions`
- 戻し先: タグ `checkpoint/before-editor-notation-actions`（コミット `72b6efb`。中身は main `3842b3c` に、手順書3つの「main へ取り込んだ」の書き換え（`7bbb0d2`）を足したもの）
- 行番号は、断りがなければ `72b6efb` の時点のもの。App.tsx は 13,708行。

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
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

### コードがある場所

| まとまり | 行 | 行数 | 中身 |
|---|---|---|---|
| 型 `NotationModalState` | 541〜551 | 11 | ルビのダイアログ（選択・読み・誤りの文）と行指示のダイアログ（選択）の state の形 |
| 定数 `customNotationSpecs` | 553〜578 | 26 | ルビ・縦中横・圏点・文章方向の名前と書き方（メニューの title、ダイアログ、通知の文言に使う） |
| 右クリックの記法 | 5577〜5659 | 83 | `applyInlineNotation`、`applyDirectionNotation`、`clearSelectionNotation` |
| ショートカットの記法 | 5685〜5737 | 53 | `applyBoldShortcut`、`applyEmphasisShortcut`、`applyHeadingShortcut`、`applyLineCommentToggle` |
| ダイアログを開く | 5980〜5994 | 15 | `openRubyNotationModal`、`openDirectionNotationModal` |
| ダイアログで決める | 6031〜6045 | 15 | `submitRubyNotation`、`chooseDirectionNotation` |

関数は11、合わせて約170行。塊は4つに分かれていて、間に別の機能の関数がある（下の「残すもの」）。

### 気づいた点

- 使われていない関数はない（`symbol-uses.mjs` で、11の関数はどれも2回以上出る）。
- App.tsx の文字列を読むテスト（18本）の中に、11の関数の名前も、通知の文言も出てこない（`text-deps.mjs` で確かめた）。名前の近くを読むのは `test:v060-editor-position` の `getCurrentEditorSelection` だけで、これは移さない。
- 11の関数を実際に動かしているテストはない。中で呼ぶ純粋な処理（`toggleBoldSelection` など）は `test:editor-text-edits` が確かめているが、エディタを書き換える・通知を出す・ダイアログを閉じる、の部分は、壊れても自動テストでは気づけない。
- 右クリックメニューの「コピー」「切り取り」「貼り付け」（`copyEditorSelection` など、5520〜5575行）も同じメニューの操作だが、記法ではない。`writeClipboardText` をタブのパスのコピー（6631行）と共有している。今回の範囲に入れるかは確認1で決める（5章）。
- 4つの塊の間にある `getCurrentEditorSelection`・`closeCommandPalette`・`restoreFocusAfterCommandPalette`（5665〜5683行、コマンドパレット）、`openManuscriptTidy`・`applyManuscriptTidy`（5996〜6029行、原稿を整える）は、別の機能なので移さない。`getCurrentEditorSelection` はテストの目印でもある。

## 工程2: 仕組みの説明

### 言葉

- **記法**: 本文に書く、ルビ・圏点・縦中横・太字・見出し・文章方向の書き方。例: `[東京(rb,とうきょう)]`、`[重要(em,goma)]`、`[12(tcy)]`、`**太字**`、`# 見出し`、行末の `[(al:center)]`。
- **操作の関数**: 利用者の操作を受けて、エディタの本文を書き換え、通知を出し、ダイアログを開け閉めする関数。どう書き換えるかの計算は、前の分離で移した純粋な処理（`src/editor/selectionEdits.ts`、`src/editor/lineComments.ts`）に任せている。
- **エディタの取っ手**（`editorInstanceRef.current`）: 本文エディタを外から操作する入り口。本文を読む（`getValue`）、選択を読む（`getSelection`）、範囲を書き換える（`replaceRange`）、選ぶ（`selectRange`）、フォーカスを戻す（`focus`）。エディタがまだ無いときは空。
- **選択の控え**（`EditorSelectionSnapshot`）: 右クリックしたとき・コマンドパレットを開いたときの選択範囲を、開始・終了・その文字列で覚えたもの。メニューを押すときにはエディタのフォーカスが外れているので、この控えを使う。

### 1. データの形

保存するデータはない。App の値で関係するのは次の2つで、どちらも App に残る。

- `notationModal`（2443行）: 開いている記法のダイアログ。`{ type: "ruby", selection, reading, error }` か `{ type: "direction", selection }`。閉じているときは `null`。
- `editorContextMenu`（2441行）: 開いている右クリックメニューの位置と選択の控え。操作の関数は、閉じる（`closeEditorContextMenu`）だけを使う。

### 2. 利用者の操作と内部の処理

| 操作 | 操作の関数（移す） | 中で起きること | 通知 |
|---|---|---|---|
| 右クリック →「ルビ…」 | `openRubyNotationModal` | 選択が1行の中でなければ通知して終わり。そうなら、読みが空のルビのダイアログを開く。メニューは閉じる | 「ルビを付ける単一行の範囲を選択してください」 |
| ルビのダイアログで「反映」か Enter | `submitRubyNotation` → `applyInlineNotation(…, "ruby", 読み)` | 読みが空ならダイアログに「ルビを入力してください」を出す。そうでなければ `[本文(rb,読み)]` に書き換え、ダイアログを閉じる | 「ルビを反映しました」 |
| 右クリック →「縦中横」「圏点」 | `applyInlineNotation(…, "tcy" / "emphasis")`（JSX から直接） | 選択を今の本文の長さに収め直し、1行の中なら `[本文(tcy)]` / `[本文(em,goma)]` に書き換える。成功したら JSX の側でメニューを閉じる | 「縦中横を反映しました」「圏点を反映しました」／「単一行の範囲を選択してください」 |
| 右クリック →「記法をクリア」 | `clearSelectionNotation` | 選択に触れている記法を外す。外すものが無ければ通知だけ。どちらでもメニューは閉じる | 「記法をクリアしました」／「クリアできる記法がありません」 |
| 右クリック →「文章方向…」 | `openDirectionNotationModal` | 行指示のダイアログを開き、メニューを閉じる | — |
| 行指示のダイアログで「行頭」「中央」「行末」 | `chooseDirectionNotation` → `applyDirectionNotation` | 選択を含む各行の末尾に `[(al:…)]` を付け、ダイアログを閉じる | 「文章方向を反映しました」 |
| Ctrl+B | `applyBoldShortcut` | `**…**` で囲む／外す。何も選んでいなければ `****` を入れて真ん中にカーソル | 失敗のときだけ「太字にする単一行の範囲を選択してください」 |
| Ctrl+I | `applyEmphasisShortcut` | 圏点を付ける／外す | 失敗のときだけ「圏点を付ける単一行の範囲を選択してください」 |
| Ctrl+1〜6、Ctrl+0 | `applyHeadingShortcut` | 選択を含む各行の `#` を付け替える。0 なら外す | 「見出しNを設定しました」「見出しを解除しました」 |
| Ctrl+/ | `applyLineCommentToggle` | 選択を含む行を `// ` でコメントにする／戻す。複数行なら書き換えた範囲を選び直す | コードの中だけ「コード内ではコメントにできません（…）」 |
| コマンドパレット（Ctrl+P）の同じ項目 | 上と同じ関数を、パレットを開いたときの選択の控えで呼ぶ | 同じ | 同じ |

Ctrl+B・I・数字・/ は、本文エディタにフォーカスがあるときだけ効く（キーの受け取り `editorShortcutHandlerRef`、5843〜5972行。これは残す）。どの操作も、書き換えた後に `editor.focus()` でエディタへフォーカスを戻す。

### 3. 保存

保存には触らない。書き換えた本文は、ふだんの入力と同じ経路（エディタの変更 → 遅延保存）で保存される。元に戻す（Ctrl+Z）も、エディタの履歴にそのまま入る。

### 4. ほかの機能との関係

- 右クリックメニュー（JSX、12985〜13130行）: 「縦中横」「圏点」「記法をクリア」「ルビ…」「文章方向…」が、移す関数を呼ぶ。項目を押せるかどうかは `canWrapInlineSelection`（前の分離で移した純粋な処理）で決める。
- 記法のダイアログ（JSX、13541〜13620行）: `submitRubyNotation`・`chooseDirectionNotation` を呼ぶ。読みの入力欄は `setNotationModal` を直接呼ぶ（残す）。
- コマンドパレット（`buildPaletteCommands`、6046行〜）: 9つの項目が移す関数を呼ぶ。
- Escape キー（4876〜4887行の useEffect）: メニューとダイアログを閉じる（`setNotationModal(null)`）。残す。

### 5. 今の挙動の癖（直さない。工程9で前と同じことを確かめる）

コードを読んでの見込み。工程8・9で確かめる。

1. 右クリックの「圏点」は、いつも外側に `[…(em,goma)]` を足す。すでに圏点の付いた `[傍点(em,goma)]` を選んで押すと、二重になる。Ctrl+I は付け外しを切り替える（`toggleEmphasisSelection`）ので、同じ「圏点」でも入口によって振る舞いが違う。
2. コマンドパレットの「圏点（傍点）」は、1行の中の選択でないと押せないが、「太字」はいつも押せて、押すと通知で断る。
3. Ctrl+B・Ctrl+I・Ctrl+/ は成功しても通知を出さないが、Ctrl+数字は「見出しNを設定しました」を出す。
4. コマンドパレットの「記法をクリア」でも、右クリックメニューを閉じる処理が走る（メニューは開いていないので、見た目は何も起きない）。
5. 「文章方向…」は、1行に収まらない選択でも開ける（選択を含む各行に付く）。「ルビ…」は1行の中の選択でないと開けない。

## 工程3: 依存関係

### A. React に依存しない処理

- `NotationModalState`（型）と `customNotationSpecs`（定数）は、部品の外にある。`customNotationSpecs` は、移す `applyInlineNotation` のほか、App の JSX（メニューの title 4か所、ダイアログ2か所）とコマンドパレット（3か所）でも使う。
- 中で呼ぶ純粋な処理は、もう別のファイルにある: `normalizeSelectionRange`・`canWrapInlineSelection`・`sanitizeNotationArgument`・`applyDirectionToSelection`・`clearNotationFromSelection`・`toggleBoldSelection`・`toggleEmphasisSelection`・`applyHeadingToSelection`（`src/editor/selectionEdits.ts`）、`toggleLineComments`（`src/editor/lineComments.ts`）。

### B. 値（state）

| 値 | 持つ所 | 移す関数の使い方 |
|---|---|---|
| `notationModal` | App（2443行） | 読む（`submitRubyNotation`、`chooseDirectionNotation`） |
| `setNotationModal` | App（2443行） | 書く（ダイアログを開く・閉じる・誤りの文を出す） |
| `editorInstanceRef` | App（2318行） | 読む（`.current` を呼ぶたびに読む） |

どれも保存されない。`appState` の一部でもない。

### C. 操作の関数（移す）

| 関数 | 呼ばれる所 | 呼ぶもの（App の道具） |
|---|---|---|
| C-1 `applyInlineNotation` | 6034（移す）、6196（パレット）、13077・13090（JSX） | `showToast`、`setNotationModal` |
| C-2 `applyDirectionNotation` | 6041（移す） | `showToast` |
| C-3 `clearSelectionNotation` | 6215（パレット）、13101（JSX） | `showToast`、`closeEditorContextMenu` |
| C-4 `applyBoldShortcut` | 5961（キー）、6140（パレット） | `showToast` |
| C-5 `applyEmphasisShortcut` | 5964（キー）、6147（パレット） | `showToast` |
| C-6 `applyHeadingShortcut` | 5967（キー）、6058（パレットの見出し1〜6）、6204（パレット） | `showToast` |
| C-7 `applyLineCommentToggle` | 5970（キー）、6128（パレット） | `showToast` |
| C-8 `openRubyNotationModal` | 6188（パレット）、13067（JSX） | `showToast`、`setNotationModal`、`closeEditorContextMenu` |
| C-9 `openDirectionNotationModal` | 6210（パレット）、13113（JSX） | `setNotationModal`、`closeEditorContextMenu` |
| C-10 `submitRubyNotation` | 13563（JSX の form） | C-1、`setNotationModal` |
| C-11 `chooseDirectionNotation` | 13604（JSX） | C-2、`setNotationModal` |

App の道具の宣言の位置: `showToast` 5223行、`closeEditorContextMenu` 5472行。どちらも最初の塊（5577行）より前にある。

### D. 自動で走る処理（useEffect）

移すものはない。Escape でダイアログを閉じる useEffect（4876行〜）と、キーの受け取りを登録する useEffect（5974行）は残す。キーの受け取りは `editorShortcutHandlerRef.current` を描画のたびに差し替える形なので、押した時点の最新の関数が呼ばれる。

### E. 作品を開く経路

関係しない。

### F. 画面部品への受け渡し（JSX）

JSX は変えない。呼ぶ名前（`applyInlineNotation`、`openRubyNotationModal` など）は、App の中で今と同じ名前で取り出す。

### G. App の外とのやり取り

なし（Rust の命令・ウィンドウ間の知らせ・ドラッグを使わない）。

### H. App.tsx の文字列を読むテスト

11の関数の名前・通知の文言を読むテストはない。`[\s\S]*?` で範囲をまたぐ正規表現が、移す範囲を通っていないかは、工程8の一式で確かめる。

### 結び目

1. `customNotationSpecs` を App の JSX とパレットでも使う。
2. `NotationModalState` の型を、App の state と移す関数の両方で使う。
3. 移す関数どうしが呼び合う（C-10 → C-1、C-11 → C-2）。同じファイルの中に置けば、呼び方は変わらない。
4. 呼び出しの位置: 返ってきた関数を、キーの受け取り（5844行〜）とパレット（6046行〜）が使う。どちらも後から呼ばれる関数の中なので、作られる前に読む心配はないが、呼び出しを最初の塊の位置（5577行）に置けば、使う所がすべて後ろになる。
5. 塊の間に、残す関数（コマンドパレットと原稿を整える）がある。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.tsx`、`src/editor/editorNotationActions.ts`（新規）、`scripts/test-editor-notation-actions.mjs`（新規）、`package.json`（テストの登録）、この手順書。
- 条件しだいで変わる: App.tsx の文字列を読むテスト（工程8で落ちたら、読むファイルを足す）。
- 変えない: 前の分離で移したファイル（`selectionEdits.ts`、`lineComments.ts`）、CSS、Rust、保存の形。

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 右クリックの記法（C-1〜3） | 中 | エディタを書き換える。書き換える範囲を間違えると本文が崩れる（保存されるので、元に戻す（Ctrl+Z）で戻す必要がある）。ただしデータの置き場所・保存の条件には触らない |
| ショートカットの記法（C-4〜7） | 中 | 同上。毎日使う操作 |
| ダイアログ（C-8〜11） | 中 | `notationModal` の読み書き。描画のたびにその時の値を渡すので、元の書き方と同じ意味になる |
| `customNotationSpecs` と型の置き場所 | 低 | 中身は変えない。import が変わるだけ |

高（データ消失）に当たるものはない。

### 4-3. 機能ごとに起こりうる回帰不具合

| 起こりうること | 今のテストで気づけるか |
|---|---|
| 記法が付かない／違う範囲に付く | なし（純粋な処理は `test:editor-text-edits` が見るが、エディタへの書き換えは見ない） |
| 通知の文言が変わる・出ない | なし |
| ダイアログが閉じない／誤りの文が出ない | なし |
| Ctrl+B などが効かない（関数が作られる前に読まれる） | 型検査とビルドで一部。実際に押すテストはない |
| 右クリックの「コピー」などが壊れる（触らないが近くを動かす） | 実際に動かしている（`test:ai-selection`） |

工程8で、11の関数を実際に動かす回帰テストを足す。

### 4-4. 今の自動テストの状態

「前」の一式（`72b6efb`）: 68本のうち64本が成功。元から失敗の4本は `test:ai-selection`（一式の中でだけ10分で止まる）、`test:canvas-save`（`./utils/fontStack` を読み込めない）、`test:v058-bundle`（メインのバンドルが 500 kB の上限を超えている。683,311 バイト）、`test:v0511-themes`（朱墨のプロットの枠）。

## 工程5: 案

### 5-1. 方針

Idea の分離・前の分離と同じ線引きにする。

1. 値（`notationModal`、`editorContextMenu`）は App に残す。
2. 移すのは引っ越しだけ。中身・文言・条件・順番は変えない。違うのは、App の値と道具を `deps` で受け取ることだけ。
3. 新しいファイルに useState・useEffect・useCallback を持ち込まない。`createEditorNotationActions(deps)` が11の関数をまとめて返し、App は描画のたびに呼んで今と同じ名前で取り出す。
4. JSX、コマンドパレット、キーの受け取りは変えない。

### 5-2. 移すもの

`src/editor/editorNotationActions.ts`（新規）:

- `export type NotationModalState`（541〜551行をそのまま）
- `export const customNotationSpecs`（553〜578行をそのまま。App は import して、JSX・パレットの使い方は変えない）
- `export function createEditorNotationActions(deps)`: C-1〜C-11 を、元の順番で中に置く。`deps` は次の5つ。

```ts
type EditorNotationActionDeps = {
  editorInstanceRef: RefObject<TextEditorHandle | null>;
  notationModal: NotationModalState | null;
  setNotationModal: Dispatch<SetStateAction<NotationModalState | null>>;
  showToast: (message: string) => void;
  closeEditorContextMenu: () => void;
};
```

App 側は、最初の塊の位置（5577行）に次を置く。

```ts
  const {
    applyInlineNotation,
    applyDirectionNotation,
    clearSelectionNotation,
    applyBoldShortcut,
    applyEmphasisShortcut,
    applyHeadingShortcut,
    applyLineCommentToggle,
    openRubyNotationModal,
    openDirectionNotationModal,
    submitRubyNotation,
    chooseDirectionNotation,
  } = createEditorNotationActions({
    editorInstanceRef,
    notationModal,
    setNotationModal,
    showToast,
    closeEditorContextMenu,
  });
```

App で使わなくなる import（`sanitizeNotationArgument`、`applyDirectionToSelection`、`clearNotationFromSelection`、`toggleBoldSelection`、`toggleEmphasisSelection`、`applyHeadingToSelection`、`toggleLineComments` の見込み）は、`symbol-uses.mjs` で1回しか出ないものだけ消す。

### 5-3. 残すもの

- 値: `notationModal`、`editorContextMenu` とその setter、ref。
- `closeEditorContextMenu`、`handleEditorContextMenu`（右クリックで控えを取る。メニュー以外の state を6つ閉じる）。
- コマンドパレット（`getCurrentEditorSelection` はテストの目印）、原稿を整える、キーの受け取り、Escape の useEffect。
- `directionOptions`（行指示のダイアログの選択肢。JSX だけが使う）。

### 決めてほしいこと

**1. 右クリックメニューの「コピー」「切り取り」「貼り付け」も一緒に移すか**

- **記法の11の関数だけを移す（勧め）**: 新しいファイルの中身が「記法」に揃う。コピーなどはクリップボードの手助け（`writeClipboardText`）をタブのパスのコピーと共有していて、移すと deps に足すか、共有の処理を別に切り出す判断が要る。`test:ai-selection` が実際に動かしている所でもあるので、別の機会に右クリックメニューの部品の分離とまとめて扱うほうが筋がよい。
- コピー・切り取り・貼り付け（約55行）も移す: App.tsx がそのぶん小さくなる。`writeClipboardText` は App に残して deps で渡し、`readClipboardText` は一緒に移す。ファイル名は `editorContextMenuActions.ts` のような、記法に限らない名前にする。

**2. 今の挙動の癖（2章5の1〜5）**: 分離では直さない。直すなら別の修正の作業にする（勧め: 今回は記録だけ）。特に1（右クリックの「圏点」が二重になる）は、前の修正（`docs/EDITOR_TEXT_QUIRKS_FIX_PLAN.md` の癖6、Ctrl+I が `《《傍点》》` を二重にする）と同じ種類。

### テストの直し方と足すテスト

- 既存のテストで、App.tsx の読むファイルを直す必要は無い見込み（名前・文言を読むテストがない）。工程8の一式で確かめる。
- `scripts/test-editor-notation-actions.mjs`（新規、`npm run test:editor-notation-actions`）: esbuild で `src/editor/editorNotationActions.ts` を束ね、エディタの取っ手の代わりに、本文と選択を持つだけの入れ物（`getValue`・`getSelection`・`replaceRange`・`selectRange`・`focus` を記録する）を渡す。`notationModal` は入れ物に持ち、操作のたびに最新の値で `createEditorNotationActions` を作り直す（App の描画と同じ形）。2章2の表の操作をすべて、成功と断られる場合の両方で動かし、本文・カーソル・通知・ダイアログの値・メニューを閉じたかを確かめる。癖1〜4のうち関数で決まるもの（1・3・4）も、今の振る舞いとして確かめる。
- 期待値は、移す前の App.tsx の関数でも同じになることを確かめる（移す前の範囲を切り出して、同じテストを通す）。
- 効くことの確かめ: 移した関数に不具合を2つ入れて、テストが落ちることを見てから戻す。

### 進め方とコミットの分け方

1. この手順書（工程1〜5）をコミット。
2. 移す: `move-lines.mjs` で4つの塊と型・定数を新しいファイルへ移し、`verify-move.mjs` で lost 0 を確かめる。型検査、`file` で CRLF。コミット。
3. 回帰テストを足す。効くことを確かめてコミット。
4. 「後」の一式 → QA 用アプリで実機確認 → 手順書に結果を書いてコミット。

### 見込みと、今回やらないこと

- App.tsx は約170行と型・定数の37行が減り、呼び出しの約20行が増える。工程6でクリップボードの約60行も移すことにしたので、13,708行 → 約13,470行（見込み）。
- やらないこと: 癖の修正、右クリックメニューの部品（JSX）の分離、コマンドパレットの分離、原稿を整えるの分離、`handleEditorContextMenu` の移動。
- バンドルは、まとめて返す関数名が縮まなくなるぶん、少し増える見込み（Idea の分離では 1.5 kB）。

## 工程6: 人の確認

2026-10-23 に決まったこと。

1. 右クリックメニューの「コピー」「切り取り」「貼り付け」も移す。記法とは別のファイル `src/editor/editorClipboardActions.ts` の `createEditorClipboardActions(deps)` にする（利用者の判断。利点と手間を説明したうえで、「別ファイルで一緒に移す」を選んだ）。
   - 移すもの: `readClipboardText`（5483〜5488行。貼り付けだけが使う）、`copyEditorSelection`・`cutEditorSelection`・`pasteIntoEditorSelection`（5520〜5575行）。
   - 残すもの: `writeClipboardText`（5476〜5481行）。タブの「パスをコピー」（6631行）と共有しているので App に残し、deps で渡す。
   - deps: `editorInstanceRef`、`writeClipboardText`、`showToast`、`closeEditorContextMenu`。呼び出しは元の位置（5520行）に置く。どれも前で宣言されている。
   - 足すテストで、コピー・切り取り・貼り付けも動かす。実機確認にも3つを足す。
2. 今の挙動の癖（2章5の1〜5）は、今回は記録だけ。直さない。

コミットは、記法の移動とクリップボードの移動を分ける。

## 工程7: 実施

| コミット | 中身 |
|---|---|
| `2126cf9` | 記法の11の関数と `NotationModalState`・`customNotationSpecs` を `src/editor/editorNotationActions.ts` へ移した。App で使わなくなった import 7つ（`sanitizeNotationArgument`・`applyDirectionToSelection`・`clearNotationFromSelection`・`toggleBoldSelection`・`toggleEmphasisSelection`・`applyHeadingToSelection`・`toggleLineComments`）を消した |
| `0e0799a` | `readClipboardText` と、コピー・切り取り・貼り付けの3つの関数を `src/editor/editorClipboardActions.ts` へ移した |
| `dd5465d` | 回帰テスト `scripts/test-editor-notation-actions.mjs`（`npm run test:editor-notation-actions`） |

行数: App.tsx は 13,708行 → 13,459行（249行減）。`editorNotationActions.ts` は253行、`editorClipboardActions.ts` は82行。

元と同じであることの確かめ方: `move-lines.mjs` で、行番号と先頭・末尾の行の中身を確かめてから移し、`verify-move.mjs` で突き合わせた。記法は「消えた188行、lost 0、足した24行」、クリップボードは「消えた57行、lost 0、足した7行」。足した行は、どちらも import と `create…Actions({ … })` の呼び出しだけ。型検査（`npx tsc --noEmit`）は各コミットで通った。改行は3つのファイルとも CRLF のまま。

手順書の案と違う点:

- `applyDirectionNotation` は、App の中では移した `chooseDirectionNotation` からしか呼ばれないので、App の取り出し（`const { … } = createEditorNotationActions(…)`）には入れなかった。`createEditorNotationActions` は11の関数をすべて返す。
- 呼び出しの位置: 記法は最初の塊の位置（`clearSelectionNotation` などがあった所）、クリップボードは `copyEditorSelection` があった所。`symbol-uses.mjs --call-site` で、取り出した名前を呼び出しより前で使う所がない（使う所はすべて、クリック・キー・パレットの中）ことを確かめた。

## 工程8: 自動テスト

### 足した回帰テスト

`scripts/test-editor-notation-actions.mjs`（`npm run test:editor-notation-actions`）。esbuild で2つの新しいファイルを束ね、エディタの取っ手とクリップボードの代わりに入れ物を渡して、操作のたびに最新の値で `create…Actions` を作り直す。

- 記法: 2章2の表の操作をすべて、成功・断られる場合・エディタが無い場合で動かし、本文・カーソル・フォーカス・通知・ダイアログの値・メニューを閉じた回数を確かめる。ルビの読みの整え方、古い控えを今の本文に収め直すこと、パレットの控えを使うこと、ダイアログの種類が違うときに何もしないことも見る。
- 癖: 1（右クリックの「圏点」は二重になり、Ctrl+I は外す）、3（Ctrl+B などは成功しても通知を出さない）、4（文章方向で `>>` が外れる）を、今の振る舞いとして確かめる。
- クリップボード: コピー・切り取り・貼り付けの成功、空の選択、クリップボードの失敗、Clipboard API が無い場合、空のクリップボード。切り取りは、クリップボードへ書けなければ本文を消さないこと。

移した行は元と1行も違わない（工程7の lost 0）ので、このテストの期待値は、移す前の App.tsx の関数でも同じになる。

効くことの確かめ: 圏点の書き方を `em,goma` から `em,sesame` に変える不具合と、切り取った後のカーソルを選択の末尾に置く不具合を、1つずつ入れて動かし、どちらも落ちることを見て `git checkout` で戻した。

### 前後の比較

| | 「前」 `72b6efb` | 「後」 `dd5465d` |
|---|---|---|
| build | 成功 | 成功 |
| メインのバンドル | 683,311 バイト | 684,314 バイト（1.0 kB 増。まとめて返す関数名が縮まないため） |
| 成功 | 64本 | 64本（同じ顔ぶれ）＋足した `test:editor-notation-actions` |
| 失敗 | 4本 | 同じ4本。理由も同じ |
| 残ったプロセス | 0 | 0 |

`test:ai-selection` は一式の中では前後とも10分で止まった。右クリックの「コピー」を実際のブラウザで動かすテストなので、「後」で単独で2回動かし、2回とも成功した（「選択の外を右クリックすると、選択が外れてコピーは押せない」まで）。残ったプロセスは0。

## 工程9: 実機確認

## 工程10: 完了
