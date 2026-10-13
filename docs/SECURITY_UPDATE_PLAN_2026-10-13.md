# セキュリティ更新計画（2026-10-13）

`npm audit --omit=dev` と、攻撃面になりやすい箇所（Tauri 設定・Rust コマンド・HTML 注入箇所・プラグイン実行）の確認結果から、更新が必要なものをまとめる。

## 更新一覧

| # | 対象 | 現在 | 目標 | 理由 | 深刻度 | このアプリでの攻撃可能性 | 副作用リスク | 確認すること | 優先 | 状態 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `pdfjs-dist` | 6.1.200 | 6.4.299（最低 6.2.108） | 細工した PDF で任意の JavaScript が実行される（[GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j)） | high | **あり**。資料 PDF を開くだけで発火する | 低。使っている API（`getDocument` / `getPage` / `numPages` / `getViewport` / `render`）は変更されていない | 資料 PDF の表示、ページ送り | 1 | 完了（6.4.299） |
| 2 | `prosemirror-view` | 1.41.9 | 1.42.3 以上 | 貼り付け処理の XSS（[GHSA-c8x8-7fp4-3x9w](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w)） | high | **あり**。悪意ある HTML の貼り付けで発火する | **中**。1.42.0 で HTML 貼り付け時に装飾がマークとして入りうる。1.42.4 で IME（選択範囲がある状態での変換）の挙動が変わる | IME 系テスト、`test:v058-high-risk`、選択範囲を変換で置き換える操作、Word からの貼り付け | 1 | 完了（1.42.6） |
| 3 | `markdown-it` / `linkify-it` | 14.2.0 / 5.0.1 | 14.3.1 / 修正版 | 巨大な入力で処理が固まる（DoS）（[GHSA-253c-mchw-3w2r](https://github.com/advisories/GHSA-253c-mchw-3w2r)） | moderate / high | ほぼなし。`@tiptap/pm` 経由で入っているだけで、`src` からは import していない | ほぼなし | ビルドが通ること | 2 | 完了（14.3.2 / 5.0.2） |
| 4 | CSP（`tauri.conf.json` の `security.csp`） | `null`（無効） | 下記「CSP 案」 | XSS が成立したとき、Tauri コマンド（ファイル操作を含む109個）に到達されるのを防ぐ最後の防壁 | — | 1・2 の XSS が成立した場合に被害が広がる | **高**。設定を誤るとプラグイン・書き出しプレビュー・画像・Worker が動かなくなる | プラグイン起動、Vivliostyle プレビュー、PDF 資料、Web 画像、ローカル画像、組版と提出用書き出し、開発サーバーの HMR | 2 | 未着手 |
| 5 | `@tiptap/*` | 2.11.5 | 3.30.4 以上 | `mergeAttributes()` の `__proto__` から DOM 属性が注入される（[GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh)）。v2 には修正が出ない | moderate | ほぼなし。`mergeAttributes` を呼ばず、使っているノードに属性がなく、ProseMirror がスキーマ外の属性を捨てる | **高**。メジャー移行。対象は [VerticalTextEditor.tsx](../src/VerticalTextEditor.tsx) の1ファイルだが、エディタの中核（IME・フォーカス・差分処理）に関わる | 下記「tiptap v3 移行」 | 3（保留） | 保留 |
| — | 開発依存（`undici` など） | — | — | 開発ツールの脆弱性。アプリ本体には含まれない | high | なし（配布物に入らない） | `npm audit fix` で一括更新すると、テストやビルドの道具まで変わる | — | 対象外 | — |

更新後の実機確認で、選択範囲を IME 変換で置き換えると変換候補が積み重なる不具合が見つかった。`prosemirror-view` を 1.41.9 に戻しても再現したため、今回の更新とは無関係な既存の不具合として [KNOWN_ISSUES.md](KNOWN_ISSUES.md) に記録した。

### 進め方

- 1〜3 は `npm audit fix` を使わず、対象を絞って更新する（開発依存を巻き込まないため）。
- 依存の更新（1〜3）と CSP（4）は別の commit にする。問題が出たときにどちらが原因か切り分けられるようにするため。
- 着手前にチェックポイントを commit する。

## CSP 案

`script-src 'self'` だけでは次の2つが壊れるため、`'unsafe-eval'` が必要になる。

- プラグイン：`srcDoc` の iframe は親の CSP を引き継ぐため、[PluginRuntimeHost.tsx](../src/plugins/PluginRuntimeHost.tsx) の `new Function` がブロックされる。
- Vivliostyle Viewer：同梱の viewer が Knockout のバインディング処理で `new Function` を使っている。

`'unsafe-eval'` を含めても、`<script>` の注入や `onerror=` などのインライン属性はブロックできる。

| ディレクティブ | 値 | 必要な理由 |
|---|---|---|
| `default-src` | `'self'` | |
| `script-src` | `'self' 'unsafe-eval'` | プラグイン、Vivliostyle Viewer |
| `style-src` | `'self' 'unsafe-inline'` | React の `style` 属性、Vivliostyle |
| `img-src` | `'self' data: blob: http: https:` | Web 画像を `<img>` で直接表示する、PDF の canvas 画像 |
| `font-src` | `'self' data:` | `public/fonts` |
| `connect-src` | `'self' ipc: http://ipc.localhost data:` | Tauri の IPC、Vivliostyle が読む `data:` URL |
| `worker-src` | `'self' blob:` | 組版処理・提出用書き出しの Worker、PDF.js の worker |
| `frame-src` | `'self' data:` | Vivliostyle プレビューの iframe |

未確認事項：

- `convertFileSrc` を使っているが、asset protocol が有効になっていない。この経路が実際に使われているなら `asset: http://asset.localhost` が必要。
- 開発サーバーの HMR のために、`devCsp` を別に設定する（または未設定のままにする）。

## tiptap v3 移行

今は保留。次のどれかに当てはまったら前倒しする。

- tiptap v2 に、このアプリで実際に攻撃できる脆弱性が出たとき
- `@tiptap/pm` v2 の依存範囲では、ProseMirror の修正版が入らなくなったとき
- エディタまわりで大きな改修をするとき

移行前に揃えるテスト：

- IME の変換と確定、選択範囲を変換で置き換える操作
- フォーカスとキャレット位置の復元
- 貼り付けと undo/redo

主なコード変更：

- `@tiptap/extension-history` を `@tiptap/extensions` の `UndoRedo` に置き換える
- `@tiptap/*` のバージョンを揃える

## 問題なしと確認したもの

- Tauri の権限：`core:default`、`dialog:default`、ウィンドウ操作のみ。fs や shell プラグインは入っていない。
- プラグイン実行：`sandbox="allow-scripts"` の iframe 内（`allow-same-origin` なし）で隔離されている。
- 書き出しプレビューと印刷の `innerHTML`：本文・ルビ・キャプション・画像 URL を `escapeHtml` で処理している。
- Rust 側のパス操作：`canonicalize` → `starts_with(root)` でプロジェクト外へのアクセスを防いでいる。
- 外部プロセス起動：`explorer.exe /select,` と `xdg-open` のみ。シェルを経由しないため、コマンド注入の余地はない。

未確認：Rust コマンド109個の個別確認、`cargo audit`。
