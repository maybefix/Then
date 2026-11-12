# BINDER 1-5 概要・キーと表示名の対応表・コルクボード 手順書

[BINDER_REBUILD_PLAN.md](BINDER_REBUILD_PLAN.md) 第1段階 1-5。原稿ファイルのフロントマターに概要（`synopsis`）を持たせ、プロパティ欄に日本語の表示名で出し、中央の表示に「コルクボード」（選んだフォルダの原稿を概要カードで並べる表示）を足す。機能の追加だが、**概要のない作品では、プロパティ欄・本文・保存・書き出し・ツリーが今と変わらない**ことを前後比較で確かめる。保存形式（`project.json` の `order`、フロントマターの書き方）は今のものを使い、新しい欄は足さない。

- ブランチ: `feat/binder-1-5-corkboard`
- 戻し先: タグ `checkpoint/before-binder-1-5-corkboard`（コミット `5ba2f2e`。中身は main `0ee49f4` と同じ）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済（2026-11-12） |
| 2 | 仕組みの説明 | 済 |
| 3 | 依存関係 | 済 |
| 4 | 影響範囲 | 済 |
| 5 | 案 | 済 |
| 6 | 人の確認（確認1） | 済（2026-11-12） |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

行番号は main `0ee49f4` の時点のもの。

## 工程1: 調査の結果

### コードがある場所

| 何 | 場所 |
|---|---|
| プロパティの読み書き（行単位で書き換える） | `src/properties/propertyModel.ts`（330行）。`readProperties` / `setPropertyValue` / `addProperty` |
| 組み込みのプロパティのセット（「記事」） | `src/properties/propertySets.ts`（21行） |
| 型の記憶（ライブラリの `.then/library.json`） | `src/properties/propertyTypeStore.ts` |
| プロパティ欄の枠 | `src/components/properties/PropertiesPanel.tsx`（307行） |
| プロパティ欄の行 | `src/components/properties/PropertiesForm.tsx`（736行）。キーは `PropertyRowView` の `<input className="propertyKey" value={keyDraft}>`（414–439行）で、**キーの文字列をそのまま、書き換えられる欄として出している** |
| フロントマターの分割・差し替え | `src/utils/frontmatter.ts`（`parseFrontMatter` / `replaceFrontMatter`）、YAML 解析は `src/utils/frontmatterYaml.ts`（`readPropertyValues` / `analyzeFrontMatter`。遅延読み込み） |
| 作業中のタブのフロントマター更新 | `src/App.tsx` 3494–3505 `updateFrontMatter`。`replaceFrontMatter` → `setActiveMarkdown(next, "keep")`（本文は変えないのでエディタへは送らない）→ 自動保存 |
| 中央の表示の切り替え | `src/App.tsx` 292 `type AppMode = "write" \| "canvas" \| "export" \| "checkpoint" \| "plugin"`、5540– `switchAppMode`、5570–5632 `modeMenuEntries`（「本文 ▾」の中身）。描画は `TopbarActions.tsx` |
| 中央の描き分け | `src/App.tsx` 7485–7830。本文の列（`.editorColumn`）は外さずに CSS で隠す（`modeHiddenPane` = `display:none`、プラグイン画面は `visibility:hidden` と `inert`） |
| 左のサイドバーを出す条件 | `LeftSidebar.tsx` 148 `appMode !== "write" && appMode !== "plugin" ? "modeHiddenPane"` |
| UI 表示サイズ | `src/styles/app/base.css` 698–714。`.topbar` `.leftWorkspaceCluster` `.rightSidebar` などクロームの根だけに `zoom: var(--ui-font-scale)`。本文エディタは対象外 |
| 並べ替え | `src/projectEntryActions.ts` 1069–1084 `handleSidebarEntryReorder(folderPath, draggedPaths, targetPath, position)` → `movePathsToDropPosition` → `saveProjectEntryOrder`（`project.json` の `order`） |
| 選んでいるフォルダ | `src/App.tsx` 885 `focusedFolderPath`。フォルダを押すと入り（5303 / 5355）、ファイルを開くと `null` に戻る（2909 ほか8か所） |
| 進捗 | `appState.fileProgress: Record<path, FileProgressStatus>`。印は `WorkspaceSidebar.tsx` 257– `PROGRESS_MARKERS`（未・執・推・完・ア） |
| 開いていないファイルへ書く作法 | `src/projectSearchActions.ts` 225–262（プロジェクト全体の置換）。タブで開いていれば `tab.contentHash`、なければ `read_text_file` の `contentHash` を `save_text_file` の `expectedHash` に渡し、`isDocumentConflict` で外部変更を見分ける |
| 開いているタブの保存 | `src/App.tsx` 1797– `setActiveMarkdown`（保存の記録 `recordDocumentChange`）、1840– `enqueueDocumentSave`（`journal_save`、`contentHash` で比べる）。**自動保存（3203–）は作業中のタブだけ**。裏のタブは、作業中にしたときに保存される |
| 書き出しの本文 | `src/export/exportSource.ts` 18 `parseFrontMatter(raw)` の本文だけを使う（フロントマターは丸ごと外す） |
| モック | `docs/mockups/binder-rebuild.html` 画面4（174–193 の CSS、401–425） |

### 気づいた点

- **プロパティ欄のキーは書き換えられる入力欄**で、テスト（`test:properties-ui` 116・158・251・348行）は `.propertyKey` の `value` をキーとして読んでいる。表示名を出すときに、この欄の値を「概要」に変えると、テストの読み方と改名の操作の両方に響く。
- 文字（text）の値は、改行のない1行として読み書きする（`TextEditor` は改行を取り除く。複数行の YAML は「フォームでは編集できない値」になる）。概要もこの決まりに乗せれば、長い概要は「1行の長い値」として保存され、表示だけ折り返す。
- `focusedFolderPath` は、ファイルを開くと `null` に戻る。コルクボードのカードから原稿を開くと、選んでいたフォルダが消える。コルクボードは自分の「対象のフォルダ」を別に持つ必要がある。
- 左のサイドバーは「本文」と「プラグイン画面」のときしか出ない（プラグイン画面は出すが隠す）。コルクボードではバインダーでフォルダを選ぶので、出す条件にコルクボードを足す。
- フロントマターの本文（`body`）だけが索引（AST）に入る（`upsertProjectAstDocument` は `parseFrontMatter(...).body`）。**概要は索引にない**ので、コルクボードは対象のフォルダのファイルを読む必要がある（開いているタブは `tab.markdown` を使う）。
- 裏のタブは自動保存されない。概要を裏のタブへ反映したら、そのタブを保存の列（`enqueueDocumentSave`）へ明示的に入れないと、タブを作業中にするまでファイルに残らない。
- モックのカードは見出しの下線に珊瑚色（`#f0c9c3`）、本文に罫線（`#e6eef6`）を直書きしている。claude テーマ（中立、珊瑚は控えめ）に合わないので、実装ではテーマの変数だけを使う。

## 工程2: 仕組みの説明

### 言葉

| 言葉 | 意味 |
|---|---|
| フロントマター | ファイルの先頭の `---` で囲んだ YAML。プロパティ欄で編集している部分 |
| 概要（`synopsis`） | 原稿1本ごとのあらすじ。フロントマターの1項目（text） |
| 対応表 | キー（`synopsis`）と画面の表示名（「概要」）の組の一覧。新しく足す |
| コルクボード | 中央の表示の一つ。対象のフォルダの原稿を、1ファイル1枚のカードで並べる |
| 対象のフォルダ | コルクボードが並べるフォルダ |
| 作業中のタブ／裏のタブ | エディタに出ているタブ／開いているが出ていないタブ |
| `expectedHash` | 書く前に「読んだときの中身のハッシュ」と今のファイルを比べる作法（1-3a）。違えば書かない |

### 1. データの形

- 概要はファイルのフロントマターに `synopsis: 書庫に眠っていた未発送の手紙。…` と1行で入る。概要がないファイルは何も書かれない（キーも作らない）。
- 並び順は今と同じ `project.json` の `order`（フォルダごとの子の順）。コルクボードの並べ替えはこれを書き換えるだけ。
- 進捗は今と同じ `appState.fileProgress`。
- 対応表は、コードの中の固定の表（保存しない）。

```ts
// src/properties/propertyLabels.ts（新規、案）
export const PROPERTY_LABELS = {
  synopsis: { label: "概要", type: "text" },
  materials: { label: "素材", type: "list" },
  sourceCards: { label: "元のカード", type: "list" },
} as const;
export function propertyLabel(key: string): string | null;
```

YAML の解析器を読み込まなくても使えるよう、`propertySets.ts` と同じく `propertyModel.ts` から切り離した小さなファイルにする（本体の束の大きさを増やさないため）。

### 2. 利用者の操作と内部の処理

| 操作 | 内部の処理（案） |
|---|---|
| 「本文 ▾」→「コルクボード」 | `appMode = "corkboard"`。本文の列は外さずに隠す。左右のサイドバーは今のまま出す。対象のフォルダを決める（下の「対象」） |
| バインダーでフォルダを押す（コルクボード中） | 対象のフォルダがそのフォルダになる |
| バインダーでファイルを押す（コルクボード中） | 今と同じくそのファイルを開き、「本文」に戻る |
| カードをダブルクリック／Enter | そのファイルを開いて「本文」に戻る。エディタへは `view.focus()` の作法（`editorInstanceRef.current.focus()`）でフォーカスを戻す |
| カードをドラッグして別のカードの前後へ落とす | `handleSidebarEntryReorder(対象のフォルダ, [ドラッグしたパス], 落とした先, "before"\|"after")`。バインダーの並べ替えと同じ処理なので、ツリーの順も同時に変わる |
| カードの概要を直す | 下の「概要の書き先」 |
| 「本文 ▾」→「本文」 | `appMode = "write"`。エディタは隠していただけなので、カーソルと表示の位置はそのまま |

**概要の書き先**（3.9 の規則どおり）

| そのファイルは | 書き先 |
|---|---|
| 作業中のタブで開いている | `updateFrontMatter` と同じ経路（`replaceFrontMatter` → `setActiveMarkdown(next, "keep")`）。本文はエディタへ送らない。自動保存が拾う |
| 裏のタブで開いている | そのタブの `markdown` のフロントマターを差し替え、保存の記録に残し（`recordDocumentChange`）、`enqueueDocumentSave` で保存する。外部変更は `journal_save` の比較で見つかり、今の衝突の選択（「ファイルの内容を読み込む」「この内容で上書きする」）に乗る |
| 開いていない | `read_text_file` で読み、`replaceFrontMatter` で概要だけ差し替え、`save_text_file` に読んだときの `contentHash` を `expectedHash` として渡す。外部で変わっていれば書かず、カードを読み直して選んでもらう（下の 5-4） |

概要の書き換えは `propertyModel` の `setPropertyValue` / `addProperty` を使う（ほかのプロパティの行は1文字も変えない）。概要を空にしたら、キーごと消す（`removeProperty`）か空の `synopsis:` を残すかは確認1で決める（勧めはキーごと消す。概要のない作品の状態に戻るため）。

### 3. 保存

- 新しい保存先はない。概要はファイル、順は `project.json`、進捗は今の場所。
- 開いていないファイルへの書き込みは、保存の記録（journal）を通らない `save_text_file` 一回きり。プロジェクト全体の置換と同じ。
- コルクボードを開いていたこと（`appMode`）は、今の「キャンバス」と同じく再起動では復元しない（見込み。`appMode` は保存されていない）。

### 4. ほかの機能との関係

| 機能 | 関係 |
|---|---|
| タブ | コルクボードはタブにしない（モックはタブで出しているが、計画書 2 章は「本文 ▾」で切り替える）。タブの帯は「本文」のときだけ出る今の決まりのまま |
| フォーカス | コルクボードから本文へ戻るときは `editorInstanceRef.current.focus()`（中で `view.focus()`）。素の `focus()` はキャレットを先頭に戻すので使わない |
| UI 表示サイズ | コルクボードはクロームなので、根の要素を `base.css` の zoom の一覧に足す。本文エディタの中には入れない |
| 元に戻す | エディタの Ctrl+Z はフロントマターに効かない（今もそう）。プロパティ欄の Undo は「その文書のプロパティ欄が開いている間の変更」を記録する（`usePropertiesHistory`）。コルクボードでの概要の変更は、作業中のタブなら、プロパティ欄が開いていれば記録される。それ以外は欄の中での入力の取り消しだけ。確認1で扱いを決める |
| チェックポイント | 概要はファイルの一部なので、チェックポイントに入る。開いていないファイルへ書くときに、上書き前の中身を退避するかは確認1（勧め: 退避しない。外部変更があれば書かないので、消えるものはない） |
| 書き出し | フロントマターは丸ごと外れる（`exportSource.ts`）。`synopsis` も入らない（見込み。工程8で回帰テストにする） |
| 素材 | `role: "material"` のファイルはカードにしない。素材フォルダを対象のフォルダにはできない（素材の段のフォルダを押しても対象を変えない） |
| 字数・進捗 | ツリーと同じ値を使う（新しく数えない） |
| プロパティ欄 | 対応表にあるキーは表示名で出す。キーそのものは変えない |
| キャンバス・別ウィンドウ | 1-5 では触らない（4-2 で概要を映す） |

### 5. 今の挙動の癖（直さないもの。工程9で実機で確かめる）

- ファイルを開くと「選んでいるフォルダ」が消える（`focusedFolderPath = null`）。コルクボードは対象のフォルダを別に持つので影響しないが、ツリーの見た目（フォルダの強調）は今のまま消える。
- 裏のタブは、作業中にするまで自動保存されない（今の決まり）。概要の反映だけは保存の列へ入れる。

## 工程3: 依存関係

| 新しく足すもの | 使うもの（既存） | 書くもの |
|---|---|---|
| `src/properties/propertyLabels.ts` | なし | なし |
| プロパティ欄の表示名 | `propertyLabels` | なし（表示だけ） |
| `src/components/corkboard/Corkboard.tsx`（新規）と CSS | `ProjectFolder`、`appState.fileProgress`、ツリーの字数、`readPropertyValues`（遅延）、`propertyLabels` | なし（操作は App から渡す関数で行う） |
| 概要の書き込み（`src/corkboard/synopsisActions.ts` 新規、案） | `parseFrontMatter` / `replaceFrontMatter`、`propertyModel`、`read_text_file` / `save_text_file`、`isDocumentConflict`、App の `updateFrontMatter`・`enqueueDocumentSave`・`recordDocumentChange` | ファイル、タブの `markdown` |
| 並べ替え | `handleSidebarEntryReorder` | `project.json` の `order` |
| 「本文 ▾」の項目 | `modeMenuEntries`、`AppMode` | `appMode` |

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

| 区分 | ファイル |
|---|---|
| 必ず変わる | `src/App.tsx`（`AppMode`、`modeMenuEntries`、`switchAppMode`、コルクボードの描画と関数の受け渡し、対象のフォルダ）、`src/components/layout/LeftSidebar.tsx`（出す条件）、`src/components/properties/PropertiesForm.tsx`（表示名）、`src/styles/app/base.css`（zoom の一覧） |
| 新規 | `src/properties/propertyLabels.ts`、`src/components/corkboard/Corkboard.tsx`、`src/components/corkboard/corkboard.css`、`src/corkboard/synopsisActions.ts`、テスト `scripts/test-corkboard*.mjs`、`scripts/test-property-labels.mjs`、固定のテスト `scripts/test-synopsis-baseline.mjs`、`AppIcon` のアイコン1つ |
| 条件しだいで変わる | `src/components/layout/RightSidebar.tsx`・`TopbarActions.tsx`（`appMode` の分かれ道に `corkboard` を足す場合）、`src/styles/themes/*.css`（`[data-app-mode="write"]` の規則をコルクボードにも効かせる場合） |
| 変えない | `src-tauri/`（Rust）、`propertyModel.ts` の読み書き、`frontmatter.ts`、書き出し、保存の記録、`projectEntryActions.ts` の並べ替え |

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| 開いていないファイルへの概要の書き込み | 高 | 誤るとファイルの本文を失う。`replaceFrontMatter` で本文を変えないこと、外部変更で書かないことをテストで固める |
| 裏のタブへの反映 | 高 | タブの `markdown` を直接変える。保存の列と衝突の選択に乗らないと、本文の編集が消える |
| 並べ替え | 中 | ツリーと同じ処理。素材やフォルダが混じったときの位置 |
| 中央の切り替え・左のサイドバーの出し方 | 中 | 本文に戻ったときのカーソル・表示位置、テーマごとの見た目 |
| プロパティ欄の表示名 | 低〜中 | 対応表にないキーは今と同じ。対応表のキーの改名操作の扱い |

### 4-3. 機能ごとに起こりうる回帰と、気づけるテスト

| 回帰 | 気づけるテスト |
|---|---|
| プロパティ欄のキーの出方・改名・Undo が変わる | `test:properties-ui`、`test:property-model` |
| フロントマターの読み書きが変わる | `test:frontmatter`、`test:frontmatter-yaml` |
| 書き出しに概要が入る | `test:frontmatter-export`、`test:export`、新しく足す固定のテスト |
| ツリーの見た目・段・並べ替えが変わる | `test:binder-tiers`、`test:binder-tree-baseline`、`test:left-sidebar`、`test:project-entry-actions` |
| 保存の衝突の扱いが変わる | `test:save-external-change` |
| トップバーの「本文 ▾」が変わる | `test:topbar-parts`（項目の並びを読んでいる） |
| 本体の束が大きくなる | `test:v058-bundle-splitting`（もとから 500 kB を超えている。増え方を見る） |

### 4-4. 今の自動テストの状態

「前」の一式（`5ba2f2e`、2026-11-12）: build 成功、本体の束 716,333 バイト、106本中 104本が通り、2本が失敗。終わったあとに残ったプロセスは 0。

| 元からの失敗 | 理由 |
|---|---|
| `test:editor-text-edits` | 「every icon draws its own picture」（`AppIcon` に同じ絵のアイコンがある）。コルクボードのアイコンを足すときは、ほかと違う絵にする |
| `test:v058-bundle` | 本体の束が 500 kB を超えている（716,333 バイト）。もとからの状態。増え方だけを見る |

頼まれた9本（`test:properties-ui`・`test:property-model`・`test:frontmatter`・`test:frontmatter-export`・`test:frontmatter-yaml`・`test:binder-tiers`・`test:binder-tree-baseline`・`test:save-external-change`・`test:export`）と、`test:topbar-parts`・`test:left-sidebar`・`test:project-entry-actions` はすべて通った。cargo を使う `test:ai`・`test:sidebar-file-move` は、Rust を変えないので外した。

## 工程5: 案

### 5-1. 方針

- 対応表・カード・概要の書き込みを、それぞれ App.tsx の外の小さなファイルに置く。App.tsx には `appMode` の分かれ道と、関数の受け渡しだけを足す。
- コルクボードは、プラグイン画面と同じく本文の列を外さずに隠す（本文に戻ったときに、カーソルと表示の位置がそのまま残る）。左右のサイドバーは出す。
- 書き込みは既存の関数だけを使う（`replaceFrontMatter`、`setPropertyValue` / `addProperty` / `removeProperty`、`save_text_file` + `expectedHash`、`enqueueDocumentSave`）。Rust は変えない。

### 5-2. 対応表とプロパティ欄

- 対応表にあるキーの行は、キーの欄に表示名（「概要」）を出し、`title` にキー（`synopsis`）を出す。
- 対応表にあるキーは**改名できない欄**にする（アプリが使うキーなので、改名すると概要として読めなくなる）。対応表にないキーは今のまま。
- 「プロパティを追加」の候補にも表示名を出す（「概要」と打って選べる）。保存されるのは英語のキー。
- 型は対応表の型を既定にする（`synopsis` は text、`materials` / `sourceCards` は list）。利用者が別の型を選んだ記憶があれば、そちらが勝つ（今の FM-21 の決まり）。

### 5-3. コルクボードの見た目（勧め）

```
┌ 原稿 ─────────────────────────── 4 ファイル · 1,073字 ┐
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│ │第一章　届かな… 推│ │第二章　坂の上 執│ │第三章　返事の 未│        │
│ │書庫に眠っていた │ │最初の宛先。坂の│ │              │        │
│ │未発送の手紙。…  │ │上の家を訪ね、… │ │  （空）       │        │
│ │            709│ │            237│ │             63│        │
│ └──────────────┘ └──────────────┘ └──────────────┘        │
└───────────────────────────────────────────┘
```

- 見出しに対象のフォルダ名、ファイル数、字数の合計。
- カードは、名前（ツリーと同じ表示名。`.txt` は省く）、進捗の印（ツリーと同じ漢字一文字）、概要、字数。
- 概要は、カードの高さに収まる行数まで出し、あふれた分は「…」で切る。カードを選ぶと全文を編集できる。
- 概要のないカードは、概要の場所を空けたままにし、薄い「空」（プロパティ欄の空の値と同じ文言）を出す。
- 色はテーマの変数（`--bg-*`、`--border-subtle`、`--text-*`）だけ。選んだカードの縁取りにだけアクセントを使う。モックの罫線と珊瑚色の下線は使わない。

### 5-4. 概要の編集と外部変更（勧め）

- カードの概要をクリックすると、その場で編集欄（プロパティ欄と同じ、改行のない折り返す欄）になる。Enter かフォーカスが外れたときに書く。Esc で取り消す。
- 開いていないファイルが外で変わっていたら書かず、ダイアログで「ファイルの内容を読み込む」（入力した概要を捨ててカードを読み直す）と「この概要で上書きする」（今のファイルを読み直し、その上に概要だけ差し替えて書く）を出す。説明の文は出さない。
- 裏のタブと作業中のタブは、今の保存の衝突の選択に任せる。

### 決めてほしいこと

| # | 項目 | 選択肢（先頭が勧め） | 勧めの理由 |
|---|---|---|---|
| 1 | コルクボードの対象 | **A. 選んだフォルダの直下のファイルだけ**。フォルダを選んでいなければ、作業中のファイルのフォルダ、それもなければ原稿の段のいちばん上 ／ B. 直下のファイルに続けて、子フォルダを区切りの見出し（モックの「本編」）にして中身も並べる ／ C. 原稿の段全体 | 計画書 3.5 の「選んだフォルダ」どおりで、並べ替えがフォルダの中で閉じる。B は区切りをまたぐ並べ替えがフォルダの移動になり、1-5 の範囲を超える |
| 2 | カードに出すもの | **A. 名前・進捗の印・概要・字数** ／ B. 名前・概要だけ ／ C. A に「素材の数」も（1-7 以降） | 印と字数はツリーにある値をそのまま使え、新しく数えない。素材はまだ書く手段がない |
| 3 | 並べ替えの範囲 | **A. 対象のフォルダの中だけ。1枚ずつ** ／ B. 複数選択して並べ替え ／ C. バインダーのフォルダへ落としてフォルダの移動も | フォルダの移動はバインダーにある。複数選択は Ctrl/Shift の扱いを新しく決める必要があり、1枚ずつで足りるか実機で見てから |
| 4 | 概要の編集の仕方 | **A. カードの上でその場で直す** ／ B. カードを選ぶと右のペインで直す（1-7 の「この場面」を待つ） ／ C. 開いて（本文に戻って）プロパティ欄で直す | 3.5b で「概要はインスペクタとコルクボードのカードで編集」と決めている。B は 1-7 待ちになる |
| 5 | 対応表に最初から入れるキー | **A. `synopsis`・`materials`・`sourceCards` の3つ** ／ B. A に既存の `title` `slug` `date` `tags` `description`（タイトル・スラッグ・日付・タグ・説明）も ／ C. `synopsis` だけ | 3.5b で表示名まで決まっているのは3つ。B は「記事」のセットの見た目が変わり、今の利用者の画面が変わる |
| 6 | 概要のないカードの見せ方 | **A. 概要の場所に薄く「空」** ／ B. 本文の書き出し数十字を薄く出す ／ C. 何も出さない | プロパティ欄の空の値と同じ文言で、押せば書けることが分かる。B は概要と本文の区別がつきにくく、全ファイルの本文を読む |
| 7 | 概要を全部消したとき | **A. `synopsis` のキーごと消す** ／ B. 空の `synopsis:` を残す | 概要のない作品の状態（今のファイル）に戻る |
| 8 | 開いていないファイルが外で変わっていたとき | **A. 書かずに「ファイルの内容を読み込む」「この概要で上書きする」を選ばせる** ／ B. 書かずに知らせるだけ（カードを読み直す） | 1-3a の作法と同じ文言と動き。概要だけを差し替えるので、上書きでも外部の本文の変更は残る |
| 9 | コルクボードでの概要の Undo | **A. 編集欄の中の取り消しだけ（確定後はチェックポイントで戻す）** ／ B. コルクボードに独自の「元に戻す」を持つ | プロパティ欄の Undo は文書ごとの記録で、開いていないファイルには使えない。B は 1-7 のインスペクタと合わせて作るほうがよい |

### テストの直し方と足すテスト

既存のテストの期待は変えない（`test:topbar-parts` は項目の並びを固定の配列で作っているので、変わらないはず）。足すもの:

1. **固定のテスト（実施の最初のコミット）** `scripts/test-synopsis-baseline.mjs`: 概要のない作品の見本で、(a) プロパティ欄に出るキーと値、(b) `replaceFrontMatter` / `setPropertyValue` の結果、(c) 書き出しの本文（`createLoadedExportSource`）、(d) ツリーの行（`test:binder-tree-baseline` の見本を流用）が今と同じことを確かめる。今のコードで通ることを確かめてからコミットする。
2. `scripts/test-property-labels.mjs`: 対応表の中身、プロパティ欄で `synopsis` が「概要」と出て `title` が `synopsis` になること、対応表にないキーは今のまま、保存される YAML のキーは英語のまま。
3. `scripts/test-synopsis-actions.mjs`: 概要の書き先3通り（作業中・裏のタブ・開いていない）。開いていないファイルで本文とほかのプロパティが1バイトも変わらないこと、外部変更で書かないこと、空にしたらキーが消えること、`.txt` と CRLF のファイル。
4. `scripts/test-corkboard.mjs`（DOM）: 対象のフォルダの直下のファイルだけがカードになり、素材とフォルダが出ないこと、順が `order` どおり、ドラッグで `handleSidebarEntryReorder` が正しい引数で呼ばれること、概要のないカードの「空」、長い概要の切り方。
5. 書き出しに `synopsis` が入らないこと（PDF・DOCX・投稿用テキストの元になる本文）。`test:frontmatter-export` に1件足すか、1. に含める。

効くことの確かめ方: 概要の書き込みで本文を差し替える誤り、素材をカードに入れる誤りをわざと入れ、テストが落ちることを見て戻す。

### 進め方とコミットの分け方

1. 固定のテストを足す（今のコードで通る）
2. 対応表と、そのテスト
3. プロパティ欄の表示名
4. 概要の書き込み（`synopsisActions.ts`）と、そのテスト
5. コルクボードの部品と CSS（zoom の一覧への追加を含む）、DOM のテスト
6. App.tsx への組み込み（`AppMode`、「本文 ▾」、左のサイドバーの出し方、対象のフォルダ、関数の受け渡し）
7. 「後」の一式、実機確認、手順書の結果

1つごとに `npx tsc --noEmit` と関係するテストを動かしてコミットする。

### 見込みと、今回やらないこと

- 見込み（コードを読んでの推測）: 概要のない作品では、プロパティ欄の行・保存・書き出し・ツリーの出力は変わらない。変わるのは「本文 ▾」の項目が1つ増えることだけ。
- やらないこと: 右のペイン「この場面」（1-7）、キャンバスのカードに概要を映すこと（4-2）、`materials` を書く操作（3.2）、Plot の移行（1-6）、コルクボードの「アウトライン」切り替え（モックにあるが計画書の 1-5 にない）、新しい場面をカードから作る「＋」（モックにあるが、ファイルの新規作成はバインダーにある。要るなら確認1で）。

## 工程6: 人の確認

2026-11-12。変えるよう指示があったのは 6 と 7 の2つで、ほかは勧めのとおりに進める。

| # | 決まったこと |
|---|---|
| 1 | 選んだフォルダの直下のファイルだけ（選んでいなければ作業中のファイルのフォルダ、それもなければ原稿の段のいちばん上） |
| 2 | 名前・進捗の印・概要・字数 |
| 3 | フォルダの中だけ、1枚ずつ |
| 4 | カードの上でその場で直す |
| 5 | `synopsis`・`materials`・`sourceCards` の3つ |
| 6 | **概要のないカードは、概要の欄に何も出さない**（「空」も出さない）。欄は押せば書ける場所として残す |
| 7 | **概要を全部消したときは、空の `synopsis:` を残す**（キーは消さない）。一度でも概要を書いたファイルは、プロパティ欄に空の「概要」が出る |
| 8 | 書かずに「ファイルの内容を読み込む」「この概要で上書きする」を選んでもらう |
| 9 | 編集欄の中での取り消しだけ。確定後はチェックポイントで戻す |

## 工程7: 実施

| コミット | 内容 |
|---|---|
| `10457b4` | 固定のテスト `test:synopsis-baseline`（概要のない作品のプロパティ欄の HTML とフロントマターの書き方を、1-5 の前のコードで作った期待値と比べる）。`test:frontmatter-export` に概要・素材・空の概要の見本を足した |
| `46cdeff` | 対応表 `src/properties/propertyLabels.ts`。プロパティ欄で表にあるキーを表示名で出し、キーは `title` に出して改名できない欄にした。追加の欄で表示名をそのまま打つと英語のキーで足す。`test:property-labels` |
| `c8a0df4` | 概要の読み書き `src/corkboard/synopsis.ts` と書き先の振り分け `src/corkboard/synopsisWriter.ts`。`test:synopsis-actions` |
| `6ab9d69` | コルクボードの部品 `src/components/corkboard/Corkboard.tsx`・`corkboard.css`。`test:corkboard` |
| `43314dd` | App.tsx への組み込み（`AppMode` に `corkboard`、「本文 ▾」の2番目に「コルクボード」、対象のフォルダ、概要の書き先、並べ替え、左のサイドバーから開いたら本文へ戻す）。左のサイドバーと右のサイドバーの表示ボタンをコルクボードでも出す。コルクボードのアイコン。UI 表示サイズの zoom の一覧に `.corkboard` |

App.tsx は 183 行増えて 7 行変わった。コルクボードの部品と概要の読み書きは `lazy` で読み込み、本体の束には入れていない（YAML の解析器を引き込むため）。

### 手順書の案と違う点

- 書き込みの処理は `synopsisActions.ts` 1本ではなく、純粋な読み書き（`synopsis.ts`）と書き先の振り分け（`synopsisWriter.ts`）に分けた。振り分けは App から渡す関数だけで動くので、App を通さずにテストできる。
- 確認1の 6・7 のとおり、概要のないカードは概要の欄に何も出さず、全部消したときは空の `synopsis:` を残す。
- プロパティ欄の「追加」で「概要」「素材」「元のカード」と打つと、英語のキーで足す（「概要」という日本語のキーは作れなくなる）。候補の一覧そのものは今までどおり型を覚えたキーだけで、対応表のキーを勝手には足さない（概要のない作品のプロパティ欄を変えないため）。
- Zone モード（サイドバーのホバー表示）の CSS は「本文」と「プラグイン画面」だけに効く。コルクボードでは、キャンバスと同じく左右のサイドバーがふつうに並ぶ。
- コルクボード中に左のサイドバーからファイル・見出し・検索結果を開くと、本文に戻ってから開く。
