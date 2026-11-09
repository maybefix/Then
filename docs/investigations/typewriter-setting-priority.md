# タイプライターモードの固定位置を優先する修正

タイプライターが有効な連続表示では、初期表示時に保存カーソルを設定値の位置へ配置する。保存済みの表示アンカーは使わない。起動、タブ復帰、作品再読込のすべてが同じ初期配置を通る。

タイプライターがオフの場合とページ表示では、従来どおり保存済みの本文位置を復元する。表示後にホイールなどの操作を始めると、初期位置調整を中止する。

## 前回まで残っていた問題

設定値を固定値に置き換えていたわけではない。centerCaretForEditor には settings.typewriterOffset から渡された値を使っていた。しかし、初期表示で保存済みviewportを優先するとキャレットのセンタリング経路が抑制され、設定値以外の比率で位置を復元していた。

実際の保存状態では、カーソルは本文末尾、表示アンカーは117文字前、保存比率は約66.3%、タイプライターの設定は63%だった。カーソルと表示アンカーが異なる条件を前回の実Appテストは含めていなかった。

その条件を合成文書に適用した実Appテストでは、前回の修正版は3種類の起動すべてで約-67.10 CSS pxずれた。初期viewport選択をタイプライターの有効状態で分岐し、設定値を優先すると、3ケースとも約-0.10 CSS pxになった。

前回の修正は、保存・復元で縦書き空行の測定位置を揃えるだけで、保存アンカーそのものを優先する分岐を残していた。そのため保存アンカーとカーソルが異なる場合には未解決だった。

## 検証

- npm run test:typewriter-startup: 縦横34ケース成功。30・46・63・65%それぞれの設定位置への配置、カーソルと異なる保存アンカー、タイプライターオフ時の読書位置復元、フォント確定、手動操作、範囲選択、IMEを含む。ブラウザ例外0件。
- node scripts/test-startup-idea-order.mjs --dist dist --offset-viewport: 起動画面から続行、ファイル読込1200ms遅延、起動画面スキップの3ケースで約-0.10 CSS px。Ideaの保存・並び順に関する既存検査も成功。
- npm run build、npm run test:typewriter、workspace-document-tabs、v060-editor-position-memory、v060-paged-layout-recovery、v059-editor-visibilityは成功。

最終ログ: typewriter-setting-priority-results.json。

Computer Useは使用していない。利用者の原稿・設定・インストール済みアプリは変更していない。

## Windowsビルド

npm run tauri -- build --bundles nsis は成功。実行ファイル内に今回のフロントエンド index-C0Wyl-0e.js が含まれること、NSISインストーラーの配布用コピーが元ファイルとSHA-256で一致することを確認した。

配布用: artifacts/Then_0.7.0_typewriter-setting-priority_x64-setup.exe
SHA-256: d3e1bc147baa0709d644eedf15bebfd92cc71e908c56debf50b5132588b20fc9
