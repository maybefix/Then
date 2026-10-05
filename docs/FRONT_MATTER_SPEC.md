# Then 書き出し 表紙・目次（前付け）仕様

作成日: 2026-10-02
状態: v1 実装済み（2026-10-04。旧未決事項は §8 で確定）

## 0. 目的

印刷用の書き出し（Vivliostyle経由PDF・DOCX）で、本文の前に表紙（扉）と目次を自動生成できるようにする。

前付けの順序は **表紙 → 目次 → 本文** で固定する。投稿用テキスト書き出しは対象外。

現状の関連箇所:

| 場所 | 役割 |
| --- | --- |
| `src/export/types.ts` | `ExportJob` / `ExportLayoutProfile` / `LinkedExportDocument` |
| `src/export/linkedDocument.ts` | 連結文書の生成、`chapterTitle` の決定、アプリ内プレビュー用の自前ページ分割 |
| `src/export/vivliostyleHtml.ts` | Vivliostyle に渡す流し込みHTML（`@page` で柱・ノンブル） |
| `src/export/wordprocessingMl.ts` | DOCX 生成（ファイルごとにセクション分割） |
| `src/components/export/LinkedExportScreen.tsx` | 書き出し画面、プリセット保存（localStorage） |
| `src/export/frontMatterStore.ts` / `src-tauri/src/export_front_matter.rs` | 作品ごとの値（タイトル上書き・副題・著者名・表紙画像）の保存 |

アプリ内プレビューは PDF と同じ Vivliostyle の流し込み HTML を表示しているため、前付けの描画は **Vivliostyle と DOCX の2系統**で足りる（`paginateLinkedDocument` は進捗表示用のページ数の目安にだけ使い、前付け分は `estimateFrontMatterPages` で足す）。

## 1. 表紙（扉）

### 1.1 v1: 文字扉

- 表示項目: タイトル（既存の `job.title`）、副題、著者名。副題・著者名は空なら出さない。
- 組方向は本文の `writingMode` に従う（縦書き本文なら縦組みの扉）。
- 調整項目は最小限にする:
  - 配置: 天地中央 / やや上寄せ
  - タイトル文字サイズの倍率
- 扉ページには柱・ノンブルを出さない（§3）。
- 見開き有効時は扉の裏を白ページにする。

### 1.2 画像表紙（v1 に含めた）

- 画像（PNG / JPEG）を余白なしでページ全面に配置する。縦横比が合わない分は `object-fit: cover` 相当で切り取る。
- 画像表紙を選んで画像が未設定のときは文字扉にする。
- オプションで画像の上にタイトル・副題・著者名を重ねられる（`cover.overlayText`、文字色は白／黒の `cover.textColor`）。配置・倍率は文字扉と同じ設定を使い、文字は通常のページ余白の内側に組む。
  - Vivliostyle: 余白0のページいっぱいの要素の背景に画像を敷き（`background-size: cover`。PDF 印刷は背景を出力する設定）、余白ぶんの padding の内側に文字扉と同じボックスを置く。可読性のため薄い text-shadow を付ける。
  - DOCX: 文字扉と同じ余白・`vAlign` のセクションに文字を組み、先頭段落にページ全面・背面の画像アンカーを入れる。文字色は `w:color`。
- 画像は作品の `.then/export/cover.<ext>` にコピーして保存する（project.json にはファイル名のみ）。
- Vivliostyle: 名前付きページ `thencover`（`margin: 0`）に、ページ大の要素を置いて背景に画像を敷く。組版文書は data URL の hash で Viewer に渡るため画像は埋め込まず、Rust のカスタムスキーム `then-cover` で配信する（`<project>/.then/export/cover.*` 以外は返さない）。
- DOCX: 余白0のセクションに、ページ左上基準・ページ全面の `wp:anchor`（背面）で配置。切り取りは `a:srcRect`。

## 2. 目次

### 2.1 収録対象

- 既定: **ファイル単位**。各セクションの `chapterTitle`（ファイルの title → 先頭見出し → ファイル名の順で決まる既存ロジック）を1項目とする。
- オプション: 本文中の見出しも含める（h1まで / h2まで）。
  - ファイル先頭の見出しが `chapterTitle` と同一の場合は重複させず1項目にまとめる。
- 目次見出しの文字列は設定可能（既定「目次」）。

### 2.2 ページ番号の解決

| 出力系 | 方式 |
| --- | --- |
| Vivliostyle | 各項目の対象（セクション／見出し）に一意な id を振り、目次側は `<a href="#id">` + `target-counter(attr(href url), page)` で参照する。番号は組版エンジンが確定させる |
| DOCX | 見出しにブックマークを振り、`TOC` フィールド（`\h` 付き）を出力する。`settings.xml` に `w:updateFields` を入れ、開いた時に Word に番号を確定させる。自前ページ分割の番号は Word の組版と一致しないため埋め込まない（フィールドのキャッシュには項目名のみ） |
| アプリ内プレビュー | Vivliostyle と同じ（プレビューは Vivliostyle の組版結果） |

- DOCX の目次項目はすべて `TC` フィールドで立てる（ファイル項目はセクション先頭段落、見出し項目はその見出し段落）。`TOC  l "1-3" h z` で TC だけから目次を作るため、見出しスタイルとの二重登録や、先頭に見出しが無いファイルの扱いに悩まない。
- ファイル内で最初の見出しが `chapterTitle` の由来である場合（文字列が一致する場合）は、その見出しを項目に加えない。

### 2.3 体裁

- 項目名 … リーダー … ページ番号 の1行構成。
- リーダーは Vivliostyle の `leader()` 対応が不確かなため、flex＋点線ボーダーで組む前提とする。
- 縦書き時、ページ番号は縦中横（3桁まで）。漢数字表記はv1では提供しない。
- 見出しを含める場合、下位レベルは1字下げ。

### 2.4 範囲外

- PDF しおり（アウトライン）。WebView2 PrintToPdf 経由では失われる可能性が高く、別途調査とする。

## 3. ノンブル・柱

- 前付けページ（扉・扉裏・目次）には**柱・ノンブルを出さない**。
- 本文の先頭ページを既存の `footer.startPageNumber`（既定1）から数える。
  - Vivliostyle: 前付けを名前付きページ（`thencover` / `thenfront`）にして margin box を空にし、`counter-increment: page 0` で数えない。最初の前付けページ（`:first`）だけ `startPageNumber-1` を足して、本文先頭を `startPageNumber` にする。
    - **要素への `counter-reset: page` は使わない。** Vivliostyle は要素側に `page` カウンタがあると `target-counter()` をそれで解決してしまい、目次の番号が全項目同じ値になる（2026-10-04 に検証）。
    - 本文を `thenmain` ページでくくり、本文直前に挿入される白ページを `@page thenmain:nth(1 of thenmain):blank` で数えず柱も出さない。本文途中の白ページ（奇数ページ始まり等）は従来どおり。
  - DOCX: 前付けを独立セクションにし、ヘッダー・フッター参照なし。本文先頭セクションに `w:pgNumType w:start`。
- 既存の `hideOnFirstPage`（先頭ページで非表示）は「本文の先頭ページ」を指すものとして扱う。

## 4. 改ページ

- 見開き有効時: 目次・本文はそれぞれ奇数ページ（recto）から開始。必要なら白ページを挟む。
  - Vivliostyle は `break-before: recto`。
  - DOCX: Word は奇数／偶数ページ区切りをノンブルで判定するため、本文で番号を振り直すと `oddPage` が物理位置を表せない。前付けは番号を振り直さず物理ページ＝番号なので、扉の裏は白ページのセクションを明示し、目次の末尾には `IF MOD(PAGE,2) = 1` で改ページを入れて偶数ページで終える。本文は `nextPage`。
- 見開き無効時: 単純に改ページ。
- 前付けがある場合、先頭ファイルの `startMode` は無視し、上記規則で本文を開始する。

## 5. データモデル

内容（作品ごと）と体裁（プリセットで持ち回る）を分ける。

```ts
// ExportJob に追加: 作品ごとの中身。プロジェクト単位で保存する
frontMatter?: {
  subtitle?: string;
  author?: string;
};

// ExportLayoutProfile に追加: プリセットに含まれる体裁
frontMatter: {
  cover: {
    enabled: boolean;
    align: "center" | "upper";
    titleScale: number; // 本文比
  };
  toc: {
    enabled: boolean;
    depth: "file" | 1 | 2; // file = ファイル単位のみ
    title: string;         // 既定 "目次"
  };
};
```

- 著者名・副題をプリセットに入れないのは、プリセットを作品間で使い回すため。
- 既存の保存済みプリセット・前回レイアウト（localStorage）に `frontMatter` が無い場合は、両方 `enabled: false` で補完する（`withFrontMatterDefaults`）。
- 作品ごとの値は `.then/project.json` の `exportFrontMatter`（`title` / `subtitle` / `author` / `coverImage`）に保存する。`title` は作品名の上書きで、空ならフォルダ名。扉だけでなく柱・DOCX のタイトル・出力ファイル名にも使う。著者名は DOCX の作成者にも入れる。
- **表紙・目次の体裁（`ExportLayoutProfile.frontMatter`）は作品ごとに記憶する。** 書き出しを待たず変更のたびに `.then/project.json` の `exportFrontMatter.layout` へ保存し、あわせて直前の値を localStorage（`then-linked-export-front-matter-v1`）にも保存する。画面を開いたときは、作品の保存値 → 直前の値 → 前回レイアウトの値の順に使う。
- プリセット（標準・保存済み・前回の書き出し設定）を適用しても表紙・目次の設定は切り替えない。標準プリセットは表紙・目次を無効で持つため、適用のたびに表紙が消えてしまうのを避ける。
- `DEFAULT_EXPORT_LAYOUT`（標準・縦書き文庫）の既定値は §8 の決定に従う。
- `LinkedExportDocument` には解決済みの前付け（扉の文字列、目次項目と参照id）を持たせ、3つの出力系はそれを描画するだけにする。

## 6. UI

- 書き出し画面「印刷用」の設定タブに「表紙・目次」セクションを追加。
  - 表紙: 有効化チェック、副題、著者名、配置、タイトル倍率
  - 目次: 有効化チェック、収録範囲（ファイル単位 / h1まで / h2まで）、目次見出し
- 設定サマリ表示（既存の柱・ノンブルのサマリ行）に「表紙・目次」の有無を追加。

## 7. 検証

- 縦書き・横書き × 見開きあり・なし × 表紙/目次の有無の組合せで、プレビュー・PDF・DOCX を目視確認。
- Vivliostyle の `target-counter` が縦書き・段組みで正しい番号を返すこと。
- DOCX を Word で開き、目次更新後の番号が本文と一致すること。LibreOffice での表示も確認する。
- 前付けページに柱・ノンブルが出ないこと、本文1ページ目が `startPageNumber` になること。

## 8. 決定事項（旧・未決事項）

| # | 論点 | 決定 |
| --- | --- | --- |
| 1 | 目次の既定収録範囲 | ファイル単位 |
| 2 | 前付けのノンブル | 番号なし・本文が開始番号から |
| 3 | DOCX 目次の更新ダイアログ | 許容して `TOC` フィールド |
| 4 | 画像表紙 | **v1 に含める** |
| 5 | 文庫プリセットの既定 | 表紙・目次とも無効（既存出力を変えない） |

関連して直したこと:

- DOCX の `w:type`（セクションの開始方法）が1つ後ろのファイルの設定で決まっていた。ECMA-376 では sectPr の `w:type` はそのセクション自身の開始方法なので、各ファイルの設定を自分のセクションに付けるよう修正した。
- DOCX の sectPr の子要素をスキーマ順（`pgNumType` → `cols` → `titlePg` → `textDirection`）に並べ替えた。
