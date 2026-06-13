# AST管理方針

作成日: 2026-06-13

## 目的

Then の本文エディタで、入力のたびに全文を評価したり、画面外の記法まで表示用 DOM として構築したりする負荷を減らす。

AST はリッチテキストの保存形式ではなく、`.txt` 本文から派生する編集・表示・検索用のキャッシュとして扱う。本文の正本は常にプレーンテキストであり、AST は再生成可能でなければならない。

## 背景

現在の Then は txt-first 方針を採っている。Markdown を主保存形式として扱わず、見出しや最低限の記法だけを本文執筆向けに解釈する。

一方で、現行実装には次の負荷が残っている。

- `src/VerticalTextEditor.tsx` は DOM 上の `.line` 群を読み、入力後に行クラスや状態を更新する。
- `src/App.tsx` は本文変更のたびに `parseTextOutline(editorText)` で見出し一覧を再計算する。
- 文字数、現在行、アウトライン、スニペット挿入などが、それぞれ本文文字列や DOM を別々に走査しがちである。
- 将来、ルビ、傍点、地付き、青空文庫風注記などを増やすと、表示装飾のための再パース範囲がさらに広がる。

参考:

- https://taiyolab.com/ja/2026/06/06/with%e3%81%aeast/
- `C:/Users/uest/Downloads/then_editor_8.html`

## 結論

AST 管理は採用する。ただし、添付 HTML の実装をそのまま移植しない。

採用する考え方:

- 行または段落ごとに構文解析する。
- 変更されていない単位は再パースしない。
- 編集中の行は raw 表示、非編集行は読みやすい表示にする。
- 見出し、アウトライン、表示装飾を同じ解析結果から派生させる。

採用しない形:

- DOM の `dataset.text` / `dataset.hash` を文書モデル代わりにする。
- 表示 DOM を正本として `readText()` で全文復元し続ける。
- 画面外の全行を常に装飾 DOM として構築する。
- CommonMark 全体の WYSIWYG 化を目指す。

## 用語

### Source Text

保存対象の本文文字列。Then の正本。`.txt` を標準とし、`.md` は互換入力として扱う。

### Document Model

Source Text、選択範囲、Undo/Redo、行 index、AST cache をまとめるエディタ内部状態。

### AST

Source Text から派生する構文情報。保存形式ではない。再生成可能な cache として扱う。

### Render Decoration

AST から生成する表示用情報。DOM そのものではなく、どの source range をどう見せるかの指示。

## AST の責務

AST は次を担う。

- 行、段落、見出し、リスト、空行、地付きなどの block 判定。
- ルビ、傍点、太字、青空文庫風注記などの inline 判定。
- 見出し outline の生成。
- 現在 offset から所属 block / heading chain を求める処理。
- 表示対象範囲だけの decoration 生成。
- 変更範囲に応じた部分再パース。

AST は次を担わない。

- 保存形式そのもの。
- リッチテキストの永続化。
- ブラウザ DOM の直接管理。
- UI コンポーネント状態。
- 全 CommonMark 互換。

## ノード設計

初期の block node は次の形を目標にする。

```ts
type BlockKind = "blank" | "paragraph" | "heading" | "list" | "jitsuki";

type DocumentBlock = {
  id: string;
  kind: BlockKind;
  from: number;
  to: number;
  lineStart: number;
  lineEnd: number;
  textHash: string;
  semanticHash: string;
  attrs: Record<string, string | number | boolean>;
  inlineMarks: InlineMark[];
};
```

inline mark は次の形を目標にする。

```ts
type InlineMarkKind = "ruby" | "emphasisDots" | "bold" | "aozora";

type InlineMark = {
  kind: InlineMarkKind;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  attrs: Record<string, string | number | boolean>;
  children: InlineMark[];
};
```

offset はまず JavaScript / DOM Selection と相性のよい UTF-16 code unit offset で管理する。縦書き layout や禁則処理で必要になった時点で、grapheme index を別レイヤーに追加する。

## ID と hash

`id` は block の同一性を保つために使う。保存対象ではなく、セッション中の editor model 内で安定すればよい。

`textHash` は raw text の変更検出に使う。

`semanticHash` は見出し、注記、装飾など、意味に関わる結果の変更検出に使う。たとえば同じ段落内の空白変更で outline が変わらない場合、outline 側の再計算を省ける。

hash は高速化の補助であり、正しさの根拠にしない。必要な箇所では text range または node 内容の比較も併用する。

## 更新単位

初期実装は「行単位」でよい。ただし設計上は「段落単位」へ拡張できるようにする。

理由:

- 現行 `VerticalTextEditor` は `.line` DOM を単位としている。
- 見出し、地付き、単純なルビ、傍点、太字は行単位で扱える。
- まず入力時の全行更新を止める効果が大きい。

段落単位へ進める条件:

- 複数行にまたがる注記や引用を扱う。
- 行折り返しと論理段落を分離する。
- custom renderer / layout engine へ移行する。

## 編集時の流れ

1. 入力 bridge が text operation を作る。
2. Document Model に operation を適用する。
3. line index を差分更新する。
4. 変更 range を含む block を dirty にする。
5. dirty block と必要な隣接 block だけを再パースする。
6. outline / heading chain / char count などの派生 cache を差分更新する。
7. renderer は visible range と active block だけの decoration を要求する。

React state への同期は保存や UI 表示に必要な粒度へ抑える。入力ごとに DOM 全体から本文を読み戻す設計には戻さない。

## 表示方針

編集体験は次を基本にする。

- active block は raw text を表示する。
- inactive visible block は decoration 表示にする。
- offscreen block は原則として DOM を持たない。
- selection がまたぐ block は raw 優先にする。
- IME composition 中は DOM 再構築を避ける。

現行 `contenteditable` 実装では、まず active line / previous line だけを差分更新する段階から始める。最終的には `docs/VERTICAL_EDITOR_ARCHITECTURE_REBOOT.md` の方針に合わせ、可視編集 DOM と model を分離した renderer へ移す。

## 添付 HTML 仮実装の評価

`then_editor_8.html` の AST 層はスパイクとして有用である。

良い点:

- `parseLine()` が block kind と inline marks を返している。
- `renderLine()` が hash と raw/decorated 状態を見て不要な再描画を避けている。
- active line を raw 表示、非 active line を decorated 表示へ切り替える方針が明確である。
- ルビ、傍点、太字、青空文庫風注記の見た目の方向性を確認できる。

そのまま採用しない理由:

- parse result を AST として保持せず、描画後に捨てている。
- `dataset.text` と `dataset.raw` に論理テキストを持たせており、DOM が model に近づきすぎている。
- 初期表示や全文差し替えでは全行を DOM 化する。
- `readText()` / `updateStatus()` は全行を読むため、入力経路に全文走査が残る。
- regex parser は限定記法の検証には十分だが、今後の拡張や曖昧ケースに弱い。
- hidden marker と `contenteditable` の組み合わせは、selection、copy、IME で破綻しやすい。

## 導入フェーズ

### Phase 1: Parser 抽出

目的:

- 添付 HTML の考え方を TypeScript の純粋関数として抽出する。
- DOM と React から独立してテストできる状態にする。

作るもの:

- `src/editor/ast/parseLine.ts`
- `src/editor/ast/types.ts`
- parser unit tests

対象記法:

- blank
- heading
- list
- jitsuki
- ruby
- emphasis dots
- bold
- aozora note

完了条件:

- 同じ input から同じ AST が返る。
- source range が元文字列へ正しく対応する。
- nested inline の最小ケースをテストできる。

### Phase 2: 現行 VerticalTextEditor への限定統合

目的:

- 入力ごとの全行クラス更新をやめる。
- active line raw / inactive line decorated の体験を検証する。

方針:

- Source Text の正本は React 側の text と editor model に置く。
- DOM `dataset` は最小限の cache としてのみ使う。
- `updateAllLineClasses()` を status 更新だけにするのではなく、そもそも全文走査を必要としない設計へ寄せる。
- IME composition 中は対象 line の DOM 再構築を止める。

完了条件:

- 日本語 IME 入力で caret が飛ばない。
- 改行、貼り付け、Undo/Redo、スニペット挿入が壊れない。
- 5,000 行程度で 1 文字入力時に全行 parse が走らない。

### Phase 3: DocumentAst 導入

目的:

- outline、現在見出し、文字数、表示 decoration を同じ model から派生させる。

方針:

- `parseTextOutline()` を AST 由来へ置き換える。
- `getLineNumberAtOffset()` は line index 由来へ置き換える。
- 文字数は text operation の差分から更新できるようにする。
- `DocumentTab.markdown` / `savedMarkdown` は別計画どおり `text` / `savedText` へ移行する。

完了条件:

- 本文変更時に outline 全文再生成が不要になる。
- active heading chain が AST から取得できる。
- 保存形式は今までどおり plain text のまま。

### Phase 4: Visible Range Rendering

目的:

- 画面外の装飾 DOM を作らない。

方針:

- scroll position から visible block range を求める。
- renderer は visible range と overscan のみを materialize する。
- offscreen block は高さ、幅、column 位置だけを layout cache に持つ。
- active block は必ず materialize する。

完了条件:

- 長文で初期表示が全行 DOM 数に比例しない。
- scroll 中に必要範囲だけが materialize される。
- typewriter scroll が visible range 更新と衝突しない。

### Phase 5: Project AST Index

目的:

- 開いていないファイルも含めて、検索、見出し一覧、関連メモ参照を高速化する。

方針:

- まず active document の AST を安定させる。
- 次に workspace の text file へ shallow index を作る。
- project index は保存対象ではなく、再構築可能な cache とする。

完了条件:

- workspace の outline / search が本文エディタの入力性能を阻害しない。

## パフォーマンス目標

初期目標:

- 5,000 行、100,000 文字程度の文書で 1 文字入力が 16ms budget を大きく超えない。
- 1 文字入力で再パースされる block は dirty block と必要な隣接 block に限る。
- visible rendering は visible range + overscan に限る。
- outline 更新は変更された heading block の影響範囲に限る。

計測項目:

- parse count per input
- rendered line count per input
- DOM node count
- input to paint latency
- IME composition 中の DOM mutation count
- initial document load time

## 実装ルール

- AST parser は DOM に依存させない。
- Source Text を正本とし、DOM からの全文復元を通常経路にしない。
- AST は保存しない。必要なら cache として破棄可能にする。
- Markdown という名前を新規設計へ増やさない。Then の内部語彙は `text` / `document` / `block` / `mark` に寄せる。
- 記法の追加は parser tests を先に増やす。
- 表示装飾は active selection と IME composition を壊さないことを優先する。
- regex で扱えない曖昧さが増えた時点で parser combinator または Lezer grammar を検討する。

## 未決定事項

- Then 記法として正式採用する inline mark の範囲。
- ルビの省略記法をどこまで許すか。
- 青空文庫風注記を表示装飾にするか、単なる muted text にするか。
- 行単位 AST から段落単位 AST へ移るタイミング。
- custom renderer への移行前に `contenteditable` 統合をどこまで続けるか。
- project AST index の保存場所と invalidation 方式。

## 次の一手

次に実装するなら、Phase 1 から始める。

最小 PR の範囲:

1. `src/editor/ast/types.ts` を追加する。
2. `src/editor/ast/parseLine.ts` を追加する。
3. 添付 HTML の `parseLine()` / `parseInlines()` 相当を TypeScript 化する。
4. ruby、emphasis dots、bold、heading、jitsuki の unit test を追加する。
5. まだ `VerticalTextEditor` には接続しない。

この順序なら、AST 方針の正しさをテストで固めてから表示実装へ進められる。
