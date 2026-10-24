# ウィンドウ操作ボタンの配色 修正の手順書

右上のウィンドウ操作ボタン（最小化・最大化・閉じる）が、上部の帯が暗いライトテーマ（Workbench・Precious・Hands・Air・Passion・Tech など）で見えにくい。ボタンの色を、ボタンの下にある上部の帯の文字色に合わせる。あわせて、App.tsx から関係する部分を切り離せるかを調べる。保存形式・文言・Rust は変えない。

- ブランチ: `fix/titlebar-contrast`
- 戻し先: タグ `checkpoint/before-titlebar-contrast`（コミット `b802749`。中身は main `314ea7d` と同じ）

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済 |
| 2 | 仕組みの説明 | 済 |
| 3 | 依存関係 | 済 |
| 4 | 影響範囲 | 済 |
| 5 | 案 | 済 |
| 6 | 人の確認（確認1） | 済 |
| 7 | 実施 | 済 |
| 8 | 自動テスト | 済 |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

### コードがある場所（`b802749` の時点）

| もの | 場所 | 中身 |
|---|---|---|
| ボタンの部品 | `src/components/layout/WindowControls.tsx`（127行） | Tauri で動いているときだけ、3つのボタンを出す。全画面のときは隠す |
| ボタンの置き場所 | `src/App.tsx` 9749行 `<WindowControls />` | `main.appShell` の最初の子。画面の右上に固定（`position: fixed`、`z-index: 2400`） |
| ボタンの色 | `src/App.css` 885〜942行 | 文字色 `var(--text-secondary)`、ホバーの背景 `rgba(255, 255, 255, 0.08)`、押したとき `rgba(255, 255, 255, 0.13)`、閉じるのホバーは赤 `#c42b1c` |
| 上部の帯の色 | `src/styles/themes/foundations.css` 55〜74、298〜304行 | 帯の背景 `--topbar-bg`、帯の文字 `--topbar-text-primary／secondary／muted／faint` |
| 帯の文字色を決めているテーマ | 13ファイル | air、bronze、drive、flat、hands、moss、passion、precious、promise、rose、tech、violet、workbench |

### 気づいた点

1. **ボタンだけが、帯の文字色ではなく本文の文字色を使っている。** 帯のほかのボタン（ファイルメニュー、パンくず、右のアイコン）は `--topbar-text-*` を使うので、暗い帯でも明るい色になる。ウィンドウ操作ボタンは `--text-secondary`（ライトテーマでは暗い色）なので、暗い帯の上で沈む。
2. **ホバーの背景が「白の8%」に決め打ちされている。** 白い帯のテーマ（ライトテーマのほとんど）では、白に白を重ねるので、最小化・最大化にマウスを乗せても背景が変わらない（測ったコントラスト 1.00〜1.02）。
3. **ボタンの下が帯ではない画面がある。** 起動中の「Then を読み込んでいます…」（`.startupPortalLoading`）と、ライブラリの準備（`.librarySetup`）は、ふつうの背景（`--bg-root`）がボタンの下に来る。ボタンを帯の文字色にすると、Workbench などではここで明るい背景に明るいボタンが乗る。
4. **Promise（ライト・ダーク）は帯の右端が明るい緑。** 帯の背景が左の濃い緑から右の明るい緑へのグラデーションなので、ボタンのある右上は明るい。帯の文字色（白に近い色）にすると、ライトでは今より見えにくくなる。
5. **帯のほかのボタンのホバーの背景も、暗い帯のライトテーマでは見えない。** 帯のボタンのホバーは `--control-hover`（明るい面のための薄い暗色）を使うので、暗い帯ではほぼ変わらない（1.01〜1.03）。
6. **App.tsx の文字列を読むテストは `test:v065-shell`。** `<WindowControls />`、`className="topbar" data-tauri-drag-region="deep"`、`.windowCloseButton:hover` の `#c42b1c` を確かめている。どれも今回変えない。`test:v059-visibility` が `data-zone-left=` と `data-shell-app-mode={appMode}` を確かめている。

### 測った結果（開発サーバー、作品を開いた後の帯。起動画面の帯も同じ値）

ボタンの色とボタンの下の色のコントラスト比（WCAG の計算。文字以外の部品は 3 以上が目安）。グラデーションのテーマは、ボタンの中心の位置の色を計算した。

| テーマ | 今 | 帯の文字色にした場合 |
|---|---|---|
| Workbench（ライト） | 2.06 | 11.89 |
| Drive（ライト） | 3.03 | 13.69 |
| Precious（ライト） | 1.27 | 8.85 |
| Hands（ライト） | 1.41 | 11.00 |
| Air（ライト） | 1.23〜1.28 | 8.38〜8.75 |
| Passion（ライト） | 1.30〜1.34 | 4.80〜4.95 |
| Tech（ライト） | 1.77 | 18.42 |
| Promise（ライト） | 3.55〜3.99 | **2.40〜2.69（悪くなる）** |
| Promise（ダーク） | 1.53〜1.94 | 1.73〜2.19 |
| Flat（ダーク） | 3.04〜3.56 | 3.49〜4.08 |
| Passion（ダーク） | 4.02〜4.21 | 4.02〜4.21 |
| ほかの 51 テーマ | 5.9 以上 | 変わらない（帯の文字色＝本文の文字色） |

Promise の2つは、黒に近い色なら 5.8〜10.9 になる。

「前」のテスト一式（`b802749`）: 80本のうち3本が元から失敗。`test:canvas-save`（`./utils/fontStack` を解決できない）、`test:v058-bundle`（最大の JS が 500 kB を超える: 702,931 バイト）、`test:v0511-themes`（Shuboku のプロット面の枠）。どれも今回の範囲と関係しない。

## 工程2: 仕組みの説明

### 言葉

- **ウィンドウ操作ボタン**: 右上の「最小化」「最大化（元に戻す）」「閉じる」。Then はWindows の標準のタイトルバーを消して（`decorations: false`）、自前のボタンを出している。
- **上部の帯（topbar）**: ファイルメニュー、パンくず、右のアイコンが並ぶ高さ 36px の帯。起動画面では `.startupPortalHeader` が同じ役をする。
- **`--topbar-text-*`**: 帯の文字色を決める CSS の変数。ライトテーマの既定では本文の文字色と同じ。帯が暗いテーマは、明るい色を自分のファイルで決めている。
- **コントラスト比**: 2つの色の明るさの比。1 は同じ明るさ、21 が白と黒。

### 1. ボタンはどこに乗っているか

ボタンは `main.appShell` の直下に、画面の右上へ固定して置かれている。上部の帯の中の部品ではないので、帯の CSS 変数の値を受け取ってはいるが、「下に何があるか」は知らない。下に来るものは画面ごとに違う。

| 画面 | ボタンの下 | 今の重なり方 |
|---|---|---|
| 作品を開いた画面 | 上部の帯（`--topbar-bg`） | 帯の右端に、ボタンの幅だけ余白を空けている（`data-native-window="true"` のとき） |
| 起動画面 | 起動画面の帯（`--topbar-bg`） | 同じく余白を空けている |
| 起動中 | ふつうの背景（`--bg-root`） | 帯はない |
| ライブラリの準備 | ふつうの背景（`--bg-root`） | 画面いっぱいに重なる（`z-index: 950`。ボタンより下） |
| ダイアログを開いているとき | 帯の上に暗い幕（`rgba(20, 22, 20, 0.58)`） | 幕はボタンより下 |
| 書き出しの画面 | 帯の上に暗い幕（`--overlay` に近い色） | 同じ |
| 全画面 | なし | ボタンを隠す |

### 2. 利用者の操作と内部の処理

| 操作 | 内部 |
|---|---|
| ボタンにマウスを乗せる | 背景を白の8%にし、文字色を `--text-primary` にする。閉じるだけは赤い背景と白 |
| ボタンを押している | 背景を白の13%にする。閉じるだけは濃い赤 |
| テーマを変える | `main.appShell` の `data-theme` が変わり、テーマの CSS 変数が入れ替わる。ボタンは `--text-secondary` を受け取る |

### 3. 保存

配色は保存しない。テーマの名前だけがアプリの設定に保存される（今回変えない）。

### 4. ほかの機能との関係

- 帯の右端の余白（`--window-controls-width`、138px）は、帯・起動画面の帯・集中モードの出口のボタンが使う。今回変えない。
- 帯のほかのボタンの色（`foundations.css`）は、ボタンと同じ `--topbar-text-*` を使う。

### 5. 今の挙動の癖（工程9で実機で確かめる）

1. 白い帯のテーマで、最小化・最大化のホバーの背景が出ない（気づいた点の2）。
2. 暗い帯のライトテーマで、帯のほかのボタンのホバーの背景が出ない（気づいた点の5）。
3. ダイアログや書き出しの画面を開いているとき、白い帯のテーマでは、暗い幕の上に暗いボタンが乗る（見込み。工程9で測る）。

## 工程3: 依存関係

- **原因の処理**: `src/App.css` の `.windowControls` の `color: var(--text-secondary)` と、`.windowControlButton:hover`・`:active` の白の背景。
- **読む値**: `--text-secondary`、`--text-primary`（テーマの変数）。
- **書く値**: なし（見た目だけ）。
- **呼ぶもの**: `WindowControls.tsx` が `windowControls`・`windowControlButton`・`windowCloseButton` の class を付ける。部品の中身（Tauri の呼び出し、全画面の判定）は今回変えない。
- **同じ見た目を確かめるテスト**: `test:v065-shell`（閉じるのホバーの赤）。

## 工程4: 影響範囲

### 4-1. 変更対象になるファイル

- 必ず変わる: `src/App.css`（ボタンの色の規則）、`src/styles/themes/promise.css`（Promise の2つのボタンの色）
- 条件しだいで変わる: 帯のボタンのホバー（決めてほしいことの2）なら、暗い帯のライトテーマ8ファイルと `foundations.css`。分離（決めてほしいことの3）をするなら `src/App.tsx` と新しいファイル1つ
- 変えない: `WindowControls.tsx`、Rust、保存形式、文言

### 4-2. まとまりごとの影響

| まとまり | 重さ | 理由 |
|---|---|---|
| ボタンの色 | 低 | 見た目だけ。データに触れない |
| 帯でない画面での色 | 中 | 戻し忘れると、起動中とライブラリの準備でボタンが消える |
| 帯のボタンのホバー | 中 | 帯の中のメニュー（ポップアップ）にまで色が流れると、メニューのホバーが見えなくなる |
| 分離（App の style） | 低〜中 | 描画のたびに作る CSS 変数。名前を1つ落とすと、フォントや字の大きさが変わる |

### 4-3. 起こりうる回帰と、今のテストで気づけるか

| 回帰 | 今のテスト |
|---|---|
| 閉じるのホバーが赤でなくなる | 文字列だけ（`test:v065-shell`） |
| 起動中・ライブラリの準備でボタンが見えない | なし |
| 白い帯のテーマでボタンの色が変わる | なし |
| フォント・字の大きさの CSS 変数が落ちる（分離した場合） | なし |

### 4-4. 今の自動テストの状態

工程1の末尾のとおり（80本中3本が元から失敗）。

## 工程5: 案

### 5-1. 方針

ボタンの色は「ボタンの下にあるものの文字色」に合わせる。下にあるものは画面で決まるので、CSS だけで次のように分ける。

- ふだん（帯の上）: 帯の文字色 `--topbar-text-secondary`、ホバーは `--topbar-text-primary`。
- 帯のない画面（起動中、ライブラリの準備）: 本文の文字色 `--text-secondary`／`--text-primary`（今と同じ）。`.appShell:has(> .librarySetup, > .startupPortalLoading)` で切り替える。
- ホバーと押したときの背景は、白の決め打ちをやめ、ボタンの文字色を薄く混ぜた色（`color-mix(in srgb, currentColor 10%, transparent)`、押したとき 16%）にする。暗い帯では明るく、白い帯では暗く、どちらでも見える。
- 閉じるのホバー（赤と白）は変えない。

ボタン用の変数 `--window-controls-color`／`--window-controls-hover-color` を置き、既定を上の値にする。テーマが帯の文字色と別の色を使いたいとき（Promise）だけ、テーマのファイルで決める。

### 5-2. 直し方の選択肢（ボタンの色）

| 案 | 中身 | よい点 | 気になる点 |
|---|---|---|---|
| **A. 帯の文字色に合わせ、帯のない画面では本文の色に戻す（推す）** | 5-1 のとおり。CSS だけ | 帯のほかのボタンと同じ色になる。白い帯のテーマは今と同じ色のまま。ホバーが全テーマで見える | `:has()` を使う（WebView2 の Chromium は対応済み） |
| B. ボタンの後ろに帯と同じ背景を敷く | `.windowControls { background: var(--topbar-bg) }` | 色の指定は要らない | ライブラリの準備・起動中で、右上に帯の色の四角が出る。グラデーションのテーマで継ぎ目が出る |
| C. 暗い帯のライトテーマの帯を明るくする | テーマの見た目を変える | ボタンの規則を変えない | テーマの意図（濃色の操作盤）が変わる |

### 5-3. 決めてほしいこと

1. **Promise（ライト・ダーク）のボタンの色**（気づいた点の4）
   - **a. 濃い色にする（推す）**: ライトは今と同じ本文の文字色（`--text-secondary`、3.55〜3.99）、ダークはテーマの一番濃い緑（`--bg-root`、8.6〜10.9 の見込み）。帯の左側のアイコン（白に近い色）とは色が違うが、ボタンが乗っている右端の明るい緑の上では見える
   - b. 帯のほかのアイコンと同じ白に近い色にそろえる（ライト 2.40〜2.69、ダーク 1.73〜2.19。今より悪いか、ほぼ同じ）
   - c. グラデーションの右端を暗くする（テーマの見た目が変わる。グラデーションはほかの面でも使う）
2. **帯のほかのボタンのホバー**（気づいた点の5、癖の2）
   - **a. 一緒に直す（推す）**: 帯の中のボタン（ファイルメニュー、パンくずのフォルダ、右のアイコン）のホバーの背景を `--topbar-control-hover` で決め、ないときは今の `--control-hover` を使う。暗い帯のライトテーマ8つ（Workbench・Drive・Precious・Hands・Air・Passion・Tech・Promise）だけ、帯の文字色を薄く混ぜた色を決める。ほかのテーマは変わらない。変数は帯の中のメニュー（ポップアップ）には使わないので、メニューのホバーは変わらない
   - b. 今回はウィンドウ操作ボタンだけ直し、これは記録して別の作業にする
3. **App.tsx からの分離**
   - **a. `main.appShell` の style（CSS 変数を12個作る約22行（数え直して12個）、9725〜9746行）を `src/appShellStyle.ts` の純粋な関数へ移す（推す）**: テーマと一緒に画面の外枠に効く値で、今回の範囲に近い。React に依存せず、テストで実際に動かして確かめられる。`data-*` の属性は JSX に残す（`test:v059-visibility` が文字列で読む）
   - b. 上部の帯の JSX（9820〜10606行、約790行。受け渡す値が約70個）を部品に分ける。App.tsx は大きく減るが、新しい props の形を作ることになり、影響が広い。**別のセッションの候補として出す**
   - c. 今回は分離しない

癖の3（ダイアログの幕の上のボタン）は、工程9で測ってから記録する（今回は直さない見込み。幕の濃さは画面ごとに違い、ボタンの色を幕に合わせる仕組みが別に要る）。

### 5-4. テストの直し方と足すテスト

- 足す: `scripts/test-window-controls-contrast.mjs`（`test:window-controls`）。ヘッドレス Edge で、`App.css` と全テーマの CSS を読み込み、帯・起動画面の帯・起動中・ライブラリの準備の4つの画面を組む。全テーマ（`themeCatalog`）で、ボタンの色とボタンの下の色のコントラストが 3 以上であること、ホバーの背景が下の色と違うこと、閉じるのホバーが赤と白であることを、計算した色で確かめる。2-a を選んだら、帯のボタンのホバーも同じ形で確かめる。
- 分離をするなら: 移した関数を esbuild で読み込み、設定の値から作った CSS 変数を、移す前の式と同じ結果になるかで確かめる（`test:app-shell-style`）。
- 既存のテストの期待は変えない。

### 5-5. 進め方とコミットの分け方

1. 失敗するテストを書く（今のコードで、暗い帯のライトテーマとホバーが落ちる）→ コミット
2. ボタンの色を直す（`App.css`、`promise.css`）→ コミット
3. （2-a）帯のボタンのホバーを直す → コミット
4. （3-a）分離 → テスト → コミット
5. 「後」の一式、QA 用アプリでの実機確認、手順書と KNOWN_ISSUES の更新 → コミット

### 5-6. 見込みと、今回やらないこと

- 見込み: 白い帯のテーマ（51）でのボタンの色は変わらない。変わるのはホバーの背景（今は見えない）だけ。
- やらないこと: 帯の高さや右端の余白、ボタンの形と並び、`WindowControls.tsx` の中身、Promise のグラデーション、ダイアログの幕の上でのボタンの色、上部の帯の部品化（3-b）。

## 工程6: 人の確認

2026-10-25 に決まったこと。

- 直し方: 案A（帯の文字色に合わせ、帯のない画面では本文の色に戻す）。
- 1-a: Promise は濃い色（ライトは本文の文字色、ダークはテーマの一番濃い緑）。
- 2-a: 帯のほかのボタンのホバーも一緒に直す。
- 3-a: `main.appShell` の style を `src/appShellStyle.ts` へ移す。
- 3-b（上部の帯の部品化）は、必ず記録し、この修正が終わったときに提案する。

### 実施の途中で決まったこと（2026-10-25）

帯のない画面（起動中、ライブラリの準備）でボタンを本文の色に戻すのに、はじめ `.appShell:has(> .startupPortalLoading, > .librarySetup)` を使ったところ、`test:v059-visibility` が落ちた。`.appShell` を主語にした `:has()` は、原稿への挿入のたびにアプリ全体の style を計算し直させるので使わない、という決まり（`d73e4b1`）。利用者に聞いて、**App からボタンに渡す** 形にした。App が `<WindowControls overPage={startupView === "loading" || Boolean(librarySetupRequest)} />` を渡し、ボタンの要素にだけ `data-over-page="true"` を付ける。style の計算し直しはボタンの中だけで済む。`test:v065-shell` の `<WindowControls />` の確認を、この形に変えた（了承済み）。

### 実機確認の途中で見つかったこと: 起動画面の帯の文字（2026-10-25）

QA 用アプリの起動画面（Workbench）を見た利用者が、下部の帯の「次回から前回のライブラリ・作品を直接開く」が見にくいと気づいた。測ると、起動画面の上下の帯は `--topbar-bg`（暗い色）で塗るのに、その上の文字が本文の色のままだった。ボタンと同じ原因。

| 部品（Workbench） | 直す前 |
|---|---|
| 上部のロゴ「Then」（`--text-primary`） | 1.02 |
| 上部のメニューのアイコン（`--text-muted`） | 2.56 |
| 下部のチェックの文（`--text-secondary`） | 2.06 |
| 下部の版の表示「Then 0.7.0」（`--text-muted`） | 2.56 |

決まったこと:

- 上下とも一緒に直す。ロゴは `--topbar-text-primary`、アイコンと版の表示は `--topbar-text-muted`、チェックの文は `--topbar-text-secondary`。下部の「設定」は自分の背景（`--bg-panel`）を持つボタンなので、本文の色のまま。
- グラデーションの帯のテーマ（Promise ライト・ダーク、Flat ダーク、Passion ダーク）では、下部の右端が明るくなり、版の表示が 1.49〜2.53 だった。**帯の右端に置くものの色を `--topbar-end-text`（ホバーは `--topbar-end-text-hover`）にまとめ、テーマで決める。** ウィンドウ操作ボタンの Promise の指定（`--window-controls-color`）もこの変数に寄せた。Promise は濃い色（ライトは本文の色、ダークは一番濃い緑）、Flat ダークは帯の一番明るい文字色、Passion ダークは本文の一番明るい色。Promise ライトのチェックの文（4.48）は、帯の一番明るい文字色（白）にした。

## 工程7: 実施

| コミット | 中身 |
|---|---|
| `ec4ea72` | 失敗するテスト `test:window-controls` を足す（今のコードで343件の不合格） |
| `728f545` | ボタンの色を帯の文字色にし、ホバーを文字色を混ぜた色にする。Promise の色、帯のボタンのホバー（`--topbar-control-hover`） |
| `2371eb5` | `main.appShell` の style を `src/appShellStyle.ts` の `buildAppShellStyle` へ移す。`test:app-shell-style` を足す |
| `052557f` | 帯のない画面の印を `:has()` から `overPage` に変える |
| `1cbf5ee` | 起動画面の上下の帯の文字のテストを足す（今のコードで31件の不合格） |
| `e87e986` | 起動画面の上下の帯の文字を帯の文字色にする。`--topbar-end-text` を足す |

変えたもの:

- `src/App.css`: `.windowControls` の色を `var(--window-controls-color, var(--topbar-text-secondary, var(--text-secondary)))`、ホバーを `--window-controls-hover-color`（既定は `--topbar-text-primary`）にする。ホバーと押したときの背景を `color-mix(in srgb, currentColor 10%／16%, transparent)` にする。`.windowControls[data-over-page="true"]` で本文の色に戻す。閉じるのホバー（赤と白）は変えない。
- `src/styles/themes/foundations.css`: 帯のボタンのホバーとメニューを開いたときの背景を `var(--topbar-control-hover, var(--control-hover))` にする。
- 帯が暗いライトテーマ7つ（air・drive・hands・passion・precious・tech・workbench）と Promise の2つ: `--topbar-control-hover: color-mix(in srgb, var(--topbar-text-primary) 12%, transparent)`。Promise ダークは確認1の8つには入れていなかったが、テストで帯のボタンのホバーが見えない（1.00）と分かったので、同じ原因として入れた。
- `src/styles/themes/promise.css`: ライトは `--window-controls-color: var(--text-secondary)`（今と同じ色）、ダークは `var(--bg-root)`（テーマの一番濃い緑）。
- `src/components/layout/WindowControls.tsx`: `overPage` を受け取り、`data-over-page` を付ける。
- `src/App.tsx`: `overPage` を渡す。appShell の style を `buildAppShellStyle(settings, editorFontFamily, editorHeadingFontFamily)` で作る。使わなくなった `withIdeographicSpaceFont` の import を外す。11,414行 → 11,393行。
- `src/appShellStyle.ts`（新しい、34行）。

元と同じであることの確かめ方（分離）: `move-lines.mjs` で行番号と先頭・末尾の行を確かめて移し、`verify-move.mjs` で突き合わせた。lost は import の `withIdeographicSpaceFont,` の1行だけ（App で使わなくなった）、added は import と呼び出しの2行だけ。

## 工程8: 自動テスト

### 足したテスト

- `test:window-controls`（`scripts/test-window-controls-contrast.mjs`）: ヘッドレス Edge で、`App.css` と全テーマの CSS を読み込み、作品の帯・起動画面の帯・起動中・ライブラリの準備の4つの画面を、62のテーマで組む。ボタンの色とボタンの下の色のコントラストが3以上、最小化・最大化のホバーの背景が下の色と見分けられる（1.09以上。白い帯のテーマで、帯のボタンのホバーがいちばん薄い Coral が1.10）、ホバー中のアイコンも3以上、閉じるのホバーが赤と白であること。起動画面では、上下の帯の部品（ロゴ・チェックの文・設定は4.5以上、メニューのアイコン・版の表示は3以上）も確かめる。作品の帯では、帯のボタン4つのホバーの背景も確かめる（`--control-hover` が `transparent` のテーマ、つまりホバーをわざと出さない Shuboku は除く）。ホバーは CDP のマウスの移動で、本物の `:hover` を起こして読む。グラデーションの帯は、ボタンの中心の位置の色を計算する。
- `test:app-shell-style`（`scripts/test-app-shell-style.mjs`）: `buildAppShellStyle` を esbuild で読み込んで動かし、12個の変数の名前と順番、値を確かめる。本文と見出しは引数（縦書きのために選び直した名前）を、プロットと起動画面は設定のフォント名を使うこと。

### テストが効くことの確かめ方

わざと不具合を入れて落ちることを見てから、`git checkout` で戻した。

| 入れた不具合 | 結果 |
|---|---|
| ボタンの色を `var(--window-controls-color, var(--text-secondary))` に戻す ＋ Promise ダークの `--window-controls-color` を消す | `test:window-controls` が42件で落ちた（Workbench・Tech・Precious・Passion・Hands・Air のライトと Promise ダークの、作品と起動画面の帯） |
| `--zone-sidebar-opacity` を消す | `test:app-shell-style` が変数の一覧で落ちた |
| 本文のフォントを引数ではなく `settings.editorFontFamily` から作る | `test:app-shell-style` が「the body uses the re-resolved family」で落ちた |
| 起動画面のロゴの色の指定を消す ＋ Passion ダークの `--topbar-end-text` を消す | `test:window-controls` が9件で落ちた（帯が暗い・グラデーションのライトテーマ8つのロゴ、Passion ダークの版の表示） |

### 前後の比較（`b802749` → `052557f`）

| | 本数 |
|---|---|
| 前後とも通る | 77 |
| 前後とも落ちる（元から。理由も同じ） | 3（`test:canvas-save`、`test:v058-bundle`、`test:v0511-themes`） |
| 後だけにある（通る） | 2（`test:window-controls`、`test:app-shell-style`） |
| 新しく落ちた | 0 |

最大の JS は 702,931 → 703,030 バイト（+99）。残ったプロセスは0。
